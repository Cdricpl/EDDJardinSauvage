/* ------------------------------------------------------------------
 * Configuration de l'application.
 *
 * MODE DÉMO (par défaut) : laisse SUPABASE_URL / SUPABASE_ANON_KEY vides.
 *   → Les données sont stockées localement dans le navigateur (localStorage).
 *   → Parfait pour tester l'interface immédiatement, sans rien installer.
 *
 * MODE CLOUD (production) : colle l'URL et la clé "anon public" de ton projet
 *   Supabase (Settings → API). Les données sont alors partagées en temps réel
 *   entre tous les appareils.
 *
 * ⚠️ La clé "anon" est conçue pour être publique : la sécurité est assurée
 *    côté serveur par les règles RLS (voir supabase/schema.sql).
 * ------------------------------------------------------------------ */

window.APP_CONFIG = {
  SUPABASE_URL: '',       // ex: 'https://xxxxxxxx.supabase.co'
  SUPABASE_ANON_KEY: '',  // ex: 'eyJhbGciOi...'
};
