# Migrer vers Firebase (hébergement gratuit qui ne se met JAMAIS en pause)

**Pourquoi ?** L'offre gratuite Supabase met le projet **en pause** après ~7 jours
d'inactivité. L'offre gratuite Firebase (**Spark**) **ne se met jamais en pause**.
Pour 3 comptes et quelques dizaines d'enfants, on reste **très loin** des limites
gratuites (50 000 lectures / 20 000 écritures **par jour** ; l'app en consomme
quelques centaines).

⏱️ **Durée : ~20 minutes.** Vos données actuelles sont conservées et transférées.

> 💾 **Étape 0 — indispensable.** Dans l'application **actuelle** (Supabase), connectez‑vous
> en admin et cliquez sur **💾** (barre du haut) pour télécharger la sauvegarde
> `edd-sauvegarde_AAAA-MM-JJ.json`. **Gardez ce fichier**, tout repose dessus.

---

## 1. Créer le projet Firebase

1. Allez sur **https://console.firebase.google.com** → **Créer un projet**.
2. Nom : `EDD Jardin Sauvage`. **Désactivez Google Analytics** (inutile ici) → **Créer**.

## 2. Activer la connexion par email

1. Menu de gauche → **Build → Authentication** → **Commencer**.
2. Onglet **Sign-in method** → **E‑mail/Mot de passe** → **Activer** → **Enregistrer**.

## 3. Créer la base de données

1. Menu de gauche → **Build → Firestore Database** → **Créer une base de données**.
2. Choisissez **Mode production**.
3. Emplacement : **eur3 (europe-west)** — vos données restent en Europe (RGPD).

## 4. Coller les règles de sécurité ⚠️ (important)

1. Firestore Database → onglet **Règles**.
2. **Effacez tout** et collez le contenu du fichier
   [`firebase/firestore.rules`](../firebase/firestore.rules) de ce dépôt.
3. **Publier**.

Ces règles reproduisent la confidentialité mise en place côté Supabase : une employée
ne voit **que ses propres prestations**, ne peut pas se promouvoir administratrice, et
seule l'admin peut renommer/retirer un enfant.

## 5. Récupérer la configuration

1. Roue dentée ⚙️ (en haut à gauche) → **Paramètres du projet**.
2. Section **Vos applications** → icône **`</>`** (Web) → nom : `EDD Web` → **Enregistrer l'application**.
3. Firebase affiche un bloc `firebaseConfig` : **copiez les valeurs**.
4. Ouvrez **`js/config.js`** dans le dépôt GitHub et remplissez `FIREBASE_CONFIG` :

```js
FIREBASE_CONFIG: {
  apiKey: 'AIza…',
  authDomain: 'edd-jardin-sauvage.firebaseapp.com',
  projectId: 'edd-jardin-sauvage',
  storageBucket: 'edd-jardin-sauvage.appspot.com',
  messagingSenderId: '1234567890',
  appId: '1:1234567890:web:abcdef…',
},
```

Dès que `apiKey` et `projectId` sont remplis, l'application bascule automatiquement
sur Firebase (le badge en haut affiche **🔥 Firebase**). Supabase n'est plus utilisé.

> Ces clés sont **publiques par conception** (comme la clé « anon » de Supabase) :
> la sécurité vient des **règles Firestore**, pas du secret.

## 6. Créer les comptes

Dans **Authentication → Users → Ajouter un utilisateur**, créez **chaque compte avec le
MÊME email qu'avant** (c'est l'email qui permet de rattacher les prestations existantes) :

| Email | Mot de passe |
|---|---|
| votre email admin | choisissez-en un |
| email employée 1 | choisissez-en un |
| email employée 2 | choisissez-en un |

## 7. Vous nommer administrateur (une seule fois)

1. Ouvrez l'application et **connectez‑vous avec votre compte admin** → un profil est créé
   automatiquement (en « employée » par défaut, c'est normal).
2. Retournez dans **Firestore Database → Données → collection `profiles`** → ouvrez le
   document qui porte **votre** email.
3. Modifiez le champ **`role`** : remplacez `employee` par **`admin`** → **Mettre à jour**.
4. Rechargez l'application : vous avez les onglets d'administration.

*(C'est l'équivalent exact du `update profiles set role='admin'` fait sur Supabase.)*

## 8. Restaurer vos données

1. Demandez aux employées de **se connecter une fois** (cela crée leur profil et permet
   de rattacher leurs prestations). Sinon la restauration vous préviendra qu'il manque des comptes.
2. Connecté en admin : onglet **👥 Utilisateurs** → carte **🗄️ Données** → section
   **Restauration** → choisissez le fichier `edd-sauvegarde_….json` de l'étape 0 → **⬆️ Restaurer**.

Les identifiants internes changent d'un hébergeur à l'autre : l'application **rattache
automatiquement** chaque prestation à la bonne employée **via son email**. Si un compte
manque, un message vous le dira — créez‑le et relancez la restauration.

## 9. Vérifier

- [ ] Badge **🔥 Firebase** en haut.
- [ ] La feuille du mois affiche bien les prestations reprises.
- [ ] Les présences des enfants sont là (onglet 🧒).
- [ ] Une employée connectée **ne voit pas** les prestations de sa collègue (onglet 📊).
- [ ] Un nouvel encodage apparaît sur un **autre appareil** (temps réel).

---

## Après la migration

- ✅ **Plus jamais de mise en pause**, aucun entretien.
- 🗑️ Vous pouvez **supprimer le projet Supabase** et le workflow GitHub
  `.github/workflows/keep-supabase-awake.yml` (devenu inutile).
- 💾 Continuez à cliquer **💾** de temps en temps : une sauvegarde reste une bonne habitude.

## En cas de souci

| Message | Cause / solution |
|---|---|
| `Missing or insufficient permissions` | Les règles de l'étape 4 ne sont pas publiées, ou votre profil n'est pas encore `admin` (étape 7). |
| « … employée(s) … n'ont pas de compte ici » | Créez le compte manquant avec le **même email**, faites‑le se connecter une fois, puis relancez la restauration. |
| Connexion impossible | Vérifiez que **E‑mail/Mot de passe** est activé (étape 2). |
