-- ============================================================================
-- École des devoirs — Schéma Supabase (PostgreSQL)
-- ============================================================================
-- À exécuter dans Supabase : SQL Editor → coller ce fichier → Run.
-- Il crée les tables, les relations, la sécurité par rôle (RLS), l'audit
-- et les déclencheurs de solde reporté.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. PROFILS (lié à auth.users de Supabase)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null,
  role        text not null default 'employee' check (role in ('admin', 'employee')),
  active      boolean not null default true,        -- false = archivée (lecture seule)
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. MOIS (statut de verrouillage + solde reporté, par employée et par mois)
-- ---------------------------------------------------------------------------
create table if not exists public.months (
  id                 uuid primary key default gen_random_uuid(),
  employee_id        uuid not null references public.profiles (id) on delete cascade,
  year               int  not null,
  month              int  not null check (month between 1 and 12),
  status             text not null default 'open' check (status in ('open', 'validated', 'locked')),
  carry_in_minutes   int  not null default 0,       -- solde reporté du mois précédent
  locked_at          timestamptz,
  created_at         timestamptz not null default now(),
  unique (employee_id, year, month)
);

-- ---------------------------------------------------------------------------
-- 3. PRESTATIONS JOURNALIÈRES
--    planned_minutes : heures à prester (défini par l'admin)
--    worked_minutes  : heures prestées (encodé par l'employée)
-- ---------------------------------------------------------------------------
create table if not exists public.day_entries (
  id               uuid primary key default gen_random_uuid(),
  employee_id      uuid not null references public.profiles (id) on delete cascade,
  entry_date       date not null,
  planned_minutes  int  not null default 0,     -- heures à prester (admin)
  worked_minutes   int  not null default 0,     -- heures prestées effectives (calculées)
  start_time       text default '',             -- heure de début "HH:MM" (tranches de 15 min)
  end_time         text default '',             -- heure de fin "HH:MM"
  break_minutes    int  not null default 0,     -- pause éventuelle à déduire
  worked_touched   boolean not null default false, -- true si l'employée a encodé une plage horaire
  kind             text not null default 'normal' check (kind in ('normal', 'conge', 'recuperation', 'autre')),
  justification    text default '',
  updated_by       uuid references public.profiles (id),
  updated_at       timestamptz not null default now(),
  unique (employee_id, entry_date)
);

-- ---------------------------------------------------------------------------
-- 4. PRÉSENCES ENFANTS (à l'échelle de l'école, une ligne par jour)
-- ---------------------------------------------------------------------------
create table if not exists public.children_attendance (
  entry_date   date primary key,
  children     int  not null default 0 check (children >= 0),
  note         text default '',
  updated_by   uuid references public.profiles (id),
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 5. JOURNAL D'AUDIT (historique des modifications)
-- ---------------------------------------------------------------------------
create table if not exists public.audit_log (
  id          bigserial primary key,
  actor_id    uuid references public.profiles (id),
  actor_name  text,
  action      text not null,          -- ex: 'update_entry', 'lock_month', 'archive_employee'
  entity      text not null,          -- ex: 'day_entry', 'month', 'profile'
  entity_id   text,
  details     jsonb,
  created_at  timestamptz not null default now()
);

-- Migration pour une base déjà existante (sans effet si les colonnes existent déjà) :
alter table public.day_entries add column if not exists start_time     text default '';
alter table public.day_entries add column if not exists end_time       text default '';
alter table public.day_entries add column if not exists break_minutes  int  not null default 0;
alter table public.day_entries add column if not exists worked_touched boolean not null default false;

create index if not exists idx_day_entries_emp_date on public.day_entries (employee_id, entry_date);
create index if not exists idx_audit_created on public.audit_log (created_at desc);

-- ============================================================================
-- FONCTIONS UTILITAIRES
-- ============================================================================

-- Rôle de l'utilisateur courant (utilisé par les policies).
create or replace function public.current_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false);
$$;

-- Un mois est-il modifiable par l'employée ? (statut 'open' uniquement)
create or replace function public.month_is_open(emp uuid, d date) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select status = 'open' from public.months
      where employee_id = emp
        and year = extract(year from d)::int
        and month = extract(month from d)::int),
    true  -- si le mois n'existe pas encore, il est considéré ouvert
  );
$$;

-- ============================================================================
-- SÉCURITÉ (Row Level Security)
-- ============================================================================
alter table public.profiles            enable row level security;
alter table public.months              enable row level security;
alter table public.day_entries         enable row level security;
alter table public.children_attendance enable row level security;
alter table public.audit_log           enable row level security;

-- PROFILES : tout le monde (connecté) peut lire ; seul l'admin modifie.
create policy profiles_read   on public.profiles for select using (auth.uid() is not null);
create policy profiles_admin  on public.profiles for all using (is_admin()) with check (is_admin());

-- MONTHS : lecture pour tous ; écriture admin ; l'employée peut créer son mois "open".
create policy months_read   on public.months for select using (auth.uid() is not null);
create policy months_admin  on public.months for all using (is_admin()) with check (is_admin());

-- DAY_ENTRIES :
--   - lecture pour tous les utilisateurs connectés
--   - l'admin écrit tout (y compris planned_minutes et mois verrouillés)
--   - l'employée écrit SES entrées seulement si le mois est 'open'
create policy entries_read  on public.day_entries for select using (auth.uid() is not null);
create policy entries_admin on public.day_entries for all using (is_admin()) with check (is_admin());
create policy entries_employee_insert on public.day_entries for insert
  with check (employee_id = auth.uid() and month_is_open(employee_id, entry_date));
create policy entries_employee_update on public.day_entries for update
  using  (employee_id = auth.uid() and month_is_open(employee_id, entry_date))
  with check (employee_id = auth.uid() and month_is_open(employee_id, entry_date));

-- CHILDREN : lecture pour tous ; écriture pour tout utilisateur actif (admin + employées).
create policy children_read  on public.children_attendance for select using (auth.uid() is not null);
create policy children_write on public.children_attendance for all
  using (auth.uid() is not null) with check (auth.uid() is not null);

-- AUDIT : lecture admin ; insertion par tous (via triggers/app).
create policy audit_read   on public.audit_log for select using (is_admin());
create policy audit_insert on public.audit_log for insert with check (auth.uid() is not null);

-- ============================================================================
-- SOLDE REPORTÉ (report automatique de mois en mois)
-- ============================================================================
-- Solde de clôture d'un mois = carry_in + Σ(worked - planned) du mois.
create or replace function public.month_closing_balance(emp uuid, yr int, mo int) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select carry_in_minutes from public.months
                   where employee_id = emp and year = yr and month = mo), 0)
       + coalesce((select sum(worked_minutes - planned_minutes) from public.day_entries
                   where employee_id = emp
                     and extract(year from entry_date)::int = yr
                     and extract(month from entry_date)::int = mo), 0);
$$;

-- Quand un mois est verrouillé, on écrit le solde reporté dans le mois suivant.
create or replace function public.propagate_carry() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  ny int; nm int; bal int;
begin
  if new.status = 'locked' and (old.status is distinct from 'locked') then
    bal := public.month_closing_balance(new.employee_id, new.year, new.month);
    nm := new.month + 1; ny := new.year;
    if nm > 12 then nm := 1; ny := ny + 1; end if;
    insert into public.months (employee_id, year, month, carry_in_minutes)
    values (new.employee_id, ny, nm, bal)
    on conflict (employee_id, year, month)
      do update set carry_in_minutes = excluded.carry_in_minutes;
    new.locked_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_propagate_carry on public.months;
create trigger trg_propagate_carry before update on public.months
  for each row execute function public.propagate_carry();

-- ============================================================================
-- CRÉATION AUTOMATIQUE DU PROFIL À L'INSCRIPTION
-- ============================================================================
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email), 'employee')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- FIN — Après exécution : créez vos utilisateurs dans Authentication,
-- puis passez l'un d'eux en role='admin' :
--   update public.profiles set role='admin' where full_name = 'Admin';
-- ============================================================================
