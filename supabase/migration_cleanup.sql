-- ============================================================================
-- Migration — Nettoyage + confidentialité (à coller dans Supabase → SQL Editor)
-- ============================================================================
-- À exécuter UNE FOIS sur la base de production existante. Elle :
--   1) restreint la lecture des prestations à « soi-même OU admin » (RGPD/RH) ;
--   2) supprime l'infrastructure devenue morte (audit, solde reporté SQL,
--      colonnes et statut inutilisés, ancienne table de présences agrégées).
-- Ré-exécutable sans erreur (tout est en « if exists »).
-- ============================================================================

-- 1. CONFIDENTIALITÉ — lecture des prestations : soi-même ou admin uniquement.
drop policy if exists entries_read on public.day_entries;
create policy entries_read on public.day_entries for select
  using (employee_id = auth.uid() or is_admin());

-- 2. SOLDE REPORTÉ SQL (mort — recalculé côté application) : trigger, fonctions, colonnes.
drop trigger  if exists trg_propagate_carry on public.months;
drop function if exists public.propagate_carry() cascade;
drop function if exists public.month_closing_balance(uuid, int, int) cascade;
alter table public.months drop column if exists carry_in_minutes;
alter table public.months drop column if exists locked_at;

-- 3. STATUT 'locked' abandonné (verrouillage retiré) → n'autoriser que open/validated.
--    On normalise d'éventuelles lignes 'locked' en 'validated' avant de resserrer la contrainte.
update public.months set status = 'validated' where status = 'locked';
alter table public.months drop constraint if exists months_status_check;
alter table public.months add  constraint months_status_check check (status in ('open', 'validated'));

-- 4. COLONNES mortes de day_entries.
alter table public.day_entries drop column if exists kind;
alter table public.day_entries drop column if exists break_minutes;

-- 5. FONCTION public.current_role() (inutilisée, nom réservé).
drop function if exists public.current_role() cascade;

-- 6. AUDIT_LOG (l'app n'écrit plus d'audit).
drop policy   if exists audit_read   on public.audit_log;
drop policy   if exists audit_insert on public.audit_log;
drop table    if exists public.audit_log cascade;

-- 7. CHILDREN_ATTENDANCE (remplacée par kids + kid_attendance).
drop policy if exists children_read  on public.children_attendance;
drop policy if exists children_write on public.children_attendance;
drop table  if exists public.children_attendance cascade;

-- Recharge le cache de schéma PostgREST.
notify pgrst, 'reload schema';
