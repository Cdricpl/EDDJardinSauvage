-- ============================================================================
-- Migration — Durcissement (à coller dans Supabase → SQL Editor, UNE FOIS)
-- ============================================================================
-- 1) Impose en base la règle « aucune prestation avant janvier 2026 ».
-- 2) Réserve la MODIFICATION / SUPPRESSION des fiches enfants à l'admin
--    (l'ajout reste possible pour l'équipe ; les présences restent ouvertes).
-- Ré-exécutable sans erreur.
-- ============================================================================

-- 1. Borne de dates des prestations (défense en profondeur, en plus du client).
alter table public.day_entries drop constraint if exists day_entries_min_date;
alter table public.day_entries
  add  constraint day_entries_min_date check (entry_date >= date '2026-01-01');

-- 2. Fiches enfants : lecture pour tous ; AJOUT pour tout compte connecté ;
--    RENOMMAGE / RETRAIT (update) et SUPPRESSION (delete) réservés à l'admin.
drop policy if exists kids_write  on public.kids;
drop policy if exists kids_insert on public.kids;
drop policy if exists kids_update on public.kids;
drop policy if exists kids_delete on public.kids;
create policy kids_insert on public.kids for insert with check (auth.uid() is not null);
create policy kids_update on public.kids for update using (is_admin()) with check (is_admin());
create policy kids_delete on public.kids for delete using (is_admin());
-- (kids_read et les policies de kid_attendance restent inchangées.)

notify pgrst, 'reload schema';
