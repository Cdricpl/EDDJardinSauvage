/* ------------------------------------------------------------------
 * Configuration de l'application.
 *
 * L'app choisit automatiquement son hébergement, dans cet ordre :
 *   1. FIREBASE  (recommandé) — si FIREBASE_CONFIG est rempli.
 *      → L'offre gratuite Firebase ne met JAMAIS le projet en pause.
 *   2. SUPABASE  — si SUPABASE_URL + SUPABASE_ANON_KEY sont remplis.
 *   3. DÉMO      — sinon : données locales au navigateur (pour tester).
 *
 * ⚠️ Ces clés sont conçues pour être publiques : la sécurité est assurée
 *    côté serveur (règles Firestore / RLS Supabase), pas par le secret.
 *
 * 👉 Pour basculer sur Firebase : voir docs/migration-firebase.md
 * ------------------------------------------------------------------ */

window.APP_CONFIG = {
  // --- 1. Firebase (laisser vide tant que la migration n'est pas faite) ---
  // Collez ici l'objet fourni par Firebase (Paramètres du projet → Vos applications → Web).
  FIREBASE_CONFIG: {
    apiKey: 'AIzaSyDRMIvzpvLPYlGTGDfhapmZZFdLsciGjJ8',
    authDomain: 'edd-jardin-sauvage.firebaseapp.com',
    projectId: 'edd-jardin-sauvage',
    storageBucket: 'edd-jardin-sauvage.firebasestorage.app',
    messagingSenderId: '497384745382',
    appId: '1:497384745382:web:fc4ab98d29d81bce9f4767',
  },

  // --- 2. Supabase (ancien hébergement — plus utilisé depuis la bascule Firebase) ---
  SUPABASE_URL: 'https://sbuwxpecmsglbkeiaikz.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNidXd4cGVjbXNnbGJrZWlhaWt6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2NDkzMTcsImV4cCI6MjA5OTIyNTMxN30.-_YtmodUzMCbVPHzYGT6sdyLro86mK1pqBEg8QcCN-c',
};
