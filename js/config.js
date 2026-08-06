/* ------------------------------------------------------------------
 * Configuration de l'application.
 *
 * L'app choisit automatiquement son hébergement :
 *   1. FIREBASE — si FIREBASE_CONFIG est rempli (hébergement de production).
 *   2. DÉMO     — sinon : données locales au navigateur (pour tester).
 *
 * ⚠️ Ces clés sont conçues pour être publiques : la sécurité est assurée
 *    côté serveur par les règles Firestore (firebase/firestore.rules),
 *    pas par le secret.
 * ------------------------------------------------------------------ */

window.APP_CONFIG = {
  // Objet fourni par Firebase (Paramètres du projet → Vos applications → Web).
  FIREBASE_CONFIG: {
    apiKey: 'AIzaSyDRMIvzpvLPYlGTGDfhapmZZFdLsciGjJ8',
    authDomain: 'edd-jardin-sauvage.firebaseapp.com',
    projectId: 'edd-jardin-sauvage',
    storageBucket: 'edd-jardin-sauvage.firebasestorage.app',
    messagingSenderId: '497384745382',
    appId: '1:497384745382:web:fc4ab98d29d81bce9f4767',
  },
};
