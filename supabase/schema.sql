-- ============================================================================
-- École des devoirs — Schéma Supabase (PostgreSQL)
-- ============================================================================
-- À exécuter dans Supabase : SQL Editor → coller ce fichier → Run.
-- Il crée les tables, les relations et la sécurité par rôle (RLS).
--
-- Ce fichier est ré-exécutable sans erreur (colonnes IF NOT EXISTS,
-- policies drop/create, fonctions create-or-replace).
--
-- NB : pour une base DÉJÀ en production qui contient l'ancien schéma
-- (audit_log, colonnes kind/break_minutes, solde reporté SQL…), exécutez
-- d'abord `supabase/migration_cleanup.sql` pour retirer l'infra devenue morte.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. PROFILS (lié à auth.users de Supabase)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null,
  email       text,                                 -- copie de l'email (affichage + reset)
  role        text not null default 'employee' check (role in ('admin', 'employee')),
  active      boolean not null default true,        -- false = archivée (lecture seule)
  created_at  timestamptz not null default now()
);
alter table public.profiles add column if not exists email text;

-- ---------------------------------------------------------------------------
-- 2. MOIS (statut par employée et par mois : 'open' = modifiable, 'validated' = figé)
-- ---------------------------------------------------------------------------
create table if not exists public.months (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references public.profiles (id) on delete cascade,
  year         int  not null,
  month        int  not null check (month between 1 and 12),
  status       text not null default 'open' check (status in ('open', 'validated')),
  created_at   timestamptz not null default now(),
  unique (employee_id, year, month)
);

-- ---------------------------------------------------------------------------
-- 3. PRESTATIONS JOURNALIÈRES
--    planned_* : horaire PRÉVU (défini par l'admin)
--    start/end : horaire RÉEL (encodé par l'employée)
--    Le solde reporté est recalculé à la volée côté application (js/app.js),
--    il n'est donc PAS stocké ici.
-- ---------------------------------------------------------------------------
create table if not exists public.day_entries (
  id               uuid primary key default gen_random_uuid(),
  employee_id      uuid not null references public.profiles (id) on delete cascade,
  entry_date       date not null,
  planned_start    text default '',             -- heure de début PRÉVUE "HH:MM" (admin)
  planned_end      text default '',             -- heure de fin PRÉVUE "HH:MM" (admin)
  planned_minutes  int  not null default 0,     -- durée prévue (calculée = fin - début)
  worked_minutes   int  not null default 0,     -- heures prestées effectives (calculées)
  start_time       text default '',             -- heure de début RÉELLE "HH:MM" (tranches de 15 min)
  end_time         text default '',             -- heure de fin RÉELLE "HH:MM"
  worked_touched   boolean not null default false, -- true si l'employée a modifié l'horaire réel
  justification    text default '',
  updated_by       uuid references public.profiles (id),
  updated_at       timestamptz not null default now(),
  unique (employee_id, entry_date)
);

-- ---------------------------------------------------------------------------
-- 3bis. HORAIRE TYPE hebdomadaire par employée (sert à pré-remplir les mois)
--       slots : JSON { "1": {"start":"14:00","end":"18:00"}, ... } (0=Dim..6=Sam)
-- ---------------------------------------------------------------------------
create table if not exists public.schedule_templates (
  employee_id  uuid primary key references public.profiles (id) on delete cascade,
  slots        jsonb not null default '{}'::jsonb,
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 4. ENFANTS — liste nominative + présences journalières
-- ---------------------------------------------------------------------------
create table if not exists public.kids (
  id          uuid primary key default gen_random_uuid(),
  first_name  text not null,
  last_name   text not null default '',
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
-- Une ligne = un enfant présent un jour donné (absence = pas de ligne).
create table if not exists public.kid_attendance (
  kid_id      uuid not null references public.kids (id) on delete cascade,
  entry_date  date not null,
  primary key (kid_id, entry_date)
);
create index if not exists idx_kid_att_date on public.kid_attendance (entry_date);

-- Migration douce pour une base déjà existante (sans effet si déjà présent) :
alter table public.day_entries add column if not exists planned_start  text default '';
alter table public.day_entries add column if not exists planned_end    text default '';
alter table public.day_entries add column if not exists start_time     text default '';
alter table public.day_entries add column if not exists end_time       text default '';
alter table public.day_entries add column if not exists worked_touched boolean not null default false;

create index if not exists idx_day_entries_emp_date on public.day_entries (employee_id, entry_date);

-- Règle métier imposée en base : aucune prestation avant janvier 2026.
alter table public.day_entries drop constraint if exists day_entries_min_date;
alter table public.day_entries add  constraint day_entries_min_date check (entry_date >= date '2026-01-01');

-- ============================================================================
-- FONCTIONS UTILITAIRES
-- ============================================================================

-- L'utilisateur courant est-il administrateur ? (utilisé par les policies)
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
alter table public.schedule_templates  enable row level security;
alter table public.kids                enable row level security;
alter table public.kid_attendance      enable row level security;

-- Note : les policies sont "droppées" avant d'être recréées, pour que ce fichier
-- puisse être ré-exécuté sans erreur (« policy already exists »).

-- SCHEDULE_TEMPLATES : lecture pour tous ; écriture admin.
drop policy if exists templates_read  on public.schedule_templates;
drop policy if exists templates_admin on public.schedule_templates;
create policy templates_read  on public.schedule_templates for select using (auth.uid() is not null);
create policy templates_admin on public.schedule_templates for all using (is_admin()) with check (is_admin());

-- ENFANTS : lecture + ajout pour tout utilisateur connecté ; RENOMMAGE/RETRAIT
-- (update) et SUPPRESSION (delete) réservés à l'admin. Les présences (kid_attendance)
-- restent ouvertes à l'équipe (encadrement quotidien).
drop policy if exists kids_read   on public.kids;
drop policy if exists kids_write  on public.kids;
drop policy if exists kids_insert on public.kids;
drop policy if exists kids_update on public.kids;
drop policy if exists kids_delete on public.kids;
create policy kids_read   on public.kids for select using (auth.uid() is not null);
create policy kids_insert on public.kids for insert with check (auth.uid() is not null);
create policy kids_update on public.kids for update using (is_admin()) with check (is_admin());
create policy kids_delete on public.kids for delete using (is_admin());
drop policy if exists katt_read  on public.kid_attendance;
drop policy if exists katt_write on public.kid_attendance;
create policy katt_read  on public.kid_attendance for select using (auth.uid() is not null);
create policy katt_write on public.kid_attendance for all using (auth.uid() is not null) with check (auth.uid() is not null);

-- PROFILES : tout le monde (connecté) peut lire ; seul l'admin modifie.
drop policy if exists profiles_read  on public.profiles;
drop policy if exists profiles_admin on public.profiles;
create policy profiles_read   on public.profiles for select using (auth.uid() is not null);
create policy profiles_admin  on public.profiles for all using (is_admin()) with check (is_admin());

-- MONTHS : lecture pour tous ; écriture admin. Le mois est créé au besoin
-- (par défaut « ouvert » via month_is_open), la validation est réservée à l'admin.
drop policy if exists months_read  on public.months;
drop policy if exists months_admin on public.months;
create policy months_read   on public.months for select using (auth.uid() is not null);
create policy months_admin  on public.months for all using (is_admin()) with check (is_admin());

-- DAY_ENTRIES (données RH — confidentialité) :
--   - lecture : SES propres prestations, ou l'admin voit tout
--   - l'admin écrit tout (horaire prévu inclus)
--   - l'employée écrit SES entrées seulement si le mois est 'open'
drop policy if exists entries_read            on public.day_entries;
drop policy if exists entries_admin           on public.day_entries;
drop policy if exists entries_employee_insert on public.day_entries;
drop policy if exists entries_employee_update on public.day_entries;
create policy entries_read  on public.day_entries for select
  using (employee_id = auth.uid() or is_admin());
create policy entries_admin on public.day_entries for all using (is_admin()) with check (is_admin());
create policy entries_employee_insert on public.day_entries for insert
  with check (employee_id = auth.uid() and month_is_open(employee_id, entry_date));
create policy entries_employee_update on public.day_entries for update
  using  (employee_id = auth.uid() and month_is_open(employee_id, entry_date))
  with check (employee_id = auth.uid() and month_is_open(employee_id, entry_date));

-- ============================================================================
-- CRÉATION AUTOMATIQUE DU PROFIL À L'INSCRIPTION
-- ============================================================================
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email), new.email, 'employee')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Force Supabase (PostgREST) à recharger son cache de schéma.
notify pgrst, 'reload schema';

-- ============================================================================
-- FIN — Après exécution : créez vos utilisateurs dans Authentication,
-- puis passez l'un d'eux en role='admin' :
--   update public.profiles set role='admin' where full_name = 'Admin';
-- ============================================================================
