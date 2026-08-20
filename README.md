# 🌳 EDD Jardin Sauvage — Application de gestion

Outil web **centralisé et responsive** pour gérer une école des devoirs :
horaires mensuels, encodage des prestations, calcul automatique des soldes (heures
supplémentaires / à récupérer), présences des enfants, statistiques, export PDF,
gestion et archivage des employées — avec **synchronisation temps réel** entre
plusieurs appareils via le cloud.

> **Deux modes, un même code :**
> - 🧪 **Mode démo** : données locales au navigateur — pour tester sans rien installer.
> - 🔥 **Mode Firebase** (production) : données partagées et synchronisées en temps réel,
>   sur l'offre gratuite Firebase (qui ne se met jamais en pause).

---

## 📱 Installer sur smartphone (application)

L'app est une **PWA** : on peut l'installer comme une vraie application.
- **Android (Chrome)** : ouvre le site → menu ⋮ → **« Installer l'application »** (ou « Ajouter à l'écran d'accueil »).
- **iPhone (Safari)** : ouvre le site → bouton **Partager** → **« Sur l'écran d'accueil »**.

Une icône « Jardin Sauvage » 🌳 apparaît ; l'app s'ouvre en plein écran, sans barre du navigateur.

## 🚀 Essayer immédiatement (mode démo)

Ouvre simplement `index.html` (ou visite le site GitHub Pages). Comptes de test :

| Compte | Email | Mot de passe | Rôle |
|--------|-------|--------------|------|
| Admin | `admin@ecole.be` | `admin123` | administrateur |
| Employée 1 | `flora@ecole.be` | `flora123` | employée |
| Employée 2 | `sarah@ecole.be` | `sarah123` | employée |

Des données d'exemple (prestations + présences enfants du mois en cours) sont
pré-remplies pour visualiser les récaps et les graphiques.

---

## 🔥 Hébergement : Firebase (gratuit, sans mise en pause)

L'application tourne sur **Firebase** (Firestore + Authentication), offre gratuite
**Spark** qui ne se met jamais en pause. La configuration est dans
[`js/config.js`](js/config.js) (`FIREBASE_CONFIG`) et les règles de sécurité dans
[`firebase/firestore.rules`](firebase/firestore.rules).

👉 Pour (re)mettre en place un projet Firebase depuis zéro, suivre
**[`docs/migration-firebase.md`](docs/migration-firebase.md)**.

Ces clés sont **publiques par conception** : la sécurité est assurée côté serveur par
les **règles Firestore**, pas par le secret.

---

## ✨ Fonctionnalités

- **Horaires prévus (admin)** : l'admin définit, par jour, une **heure de début** et une
  **heure de fin** prévues (tranches de 15 min), dans un tableau mensuel type Excel ;
  validation d'un mois (un mois validé n'est plus modifiable par l'employée).
- **Horaire type hebdomadaire (admin)** : un modèle Lun→Dim par employée qui **pré-remplit
  automatiquement les nouveaux mois**. Modifiable à tout moment ; les **mois validés ne
  sont jamais recalculés**, et les jours déjà modifiés gardent leur horaire réel.
- **Prestations (employées)** : l'employée voit l'horaire prévu et ne modifie que
  l'**heure de début / fin réelle** (tranches de 15 min) ; le presté et l'écart sont
  calculés automatiquement. Les jours sont **pré-remplis** avec l'horaire prévu — on ne
  modifie que les jours différents, et un changement d'horaire n'écrase pas une saisie
  déjà faite. Justification obligatoire en cas d'écart.
- **Identité visuelle** : logo (accueil, entête, PDF) et **code couleur par rôle**
  (administrateur = bleu, employée = vert) ; jours modifiés et écarts (+/−) mis en évidence.
- **Calculs automatiques** : écart journalier, totaux mensuels, **solde reporté de mois
  en mois** (recalculé à la volée côté application), heures sup. et heures à récupérer.
- **Validation d'un mois** : un mois validé n'est plus modifiable par l'employée (seul
  l'admin peut intervenir) — imposé côté serveur via les règles Firestore.
- **Présences enfants** : liste nominative (prénom + nom) et **grille de présences**
  journalières par enfant (case décochée un jour d'ouverture = absence).
- **Statistiques** : moyenne annuelle d'enfants par jour + détail mensuel, graphique,
  avec **export PDF** (moyennes + graphique inclus).
- **Export PDF** : fiche mensuelle par employée (tableau début/fin, totaux, signatures).
- **Sauvegarde** (admin) : export **JSON complet** + **CSV** (prestations, présences) et
  **restauration** d'une sauvegarde JSON. Lecture des prestations restreinte à
  « soi-même ou admin ».
- **Export PDF récap global** (admin) : une page reprenant toutes les employées d'un mois
  (prévu, presté, écart, soldes, statut), en plus de la fiche individuelle par employée.
- **Employées** : ajout, **archivage** (données conservées en lecture seule), réactivation.
- **Temps réel** : mise à jour automatique sur tous les appareils connectés.
- **Fiabilité** : filet anti-crash (jamais d'écran blanc), enregistrement automatique.

---

## 🗂️ Structure du projet

```
.
├── index.html            # Shell de l'application (SPA)
├── assets/logo.svg       # Logo (accueil, entête, PDF)
├── css/styles.css        # Styles (responsive, couleurs par rôle)
├── js/
│   ├── config.js         # Config Firebase (vide = mode démo)
│   ├── store.js          # Couche de données : démo (localStorage) OU Firebase
│   └── app.js            # Interface, calculs, vues, PDF, graphiques
├── offline.html          # Page de repli hors-ligne (PWA)
├── firebase/
│   └── firestore.rules   # Règles de sécurité Firestore (cloisonnement des données)
├── tests/                # Tests end-to-end Playwright (mode démo)
├── docs/
│   ├── ARCHITECTURE.md       # Architecture + écrans
│   └── migration-firebase.md # Mise en place d'un projet Firebase
└── README.md
```

### 🖼️ Remplacer le logo par le vrai
Le logo est le fichier **`assets/logo.svg`**. Pour mettre le logo officiel de l'école :
remplace simplement ce fichier par ton image (garde le nom `logo.svg`), **ou** dépose
ton image (ex. `logo.png`) dans `assets/` et remplace `assets/logo.svg` par
`assets/logo.png` dans `index.html` et `js/app.js` (recherche `logo.svg`). Il apparaîtra
automatiquement sur l'accueil, dans l'entête et dans les PDF.

---

## 🧱 Règles métier (mois)

- Le système **démarre en août 2026** : impossible d'accéder à un mois antérieur.
- Les heures accumulées avant cette date se reprennent **une seule fois** via le
  **solde de départ** de chaque employée (onglet Utilisateurs).
- Un mois **validé** n'est plus modifiable par l'employée (seul l'admin peut intervenir) ;
  « Repasser en cours » le rouvre.

## 🛡️ Stabilité & fiabilité

- **Filet anti-crash** : toute erreur affiche un message clair (jamais d'écran blanc), avec
  bouton « Recharger ». Gestionnaires globaux `error` / `unhandledrejection` + logs console.
- **Performances** : en mode Firebase, les entrées **et** les profils sont **mis en cache**
  (moins de requêtes par rendu) ; la feuille se met à jour **cellule par cellule** sans
  reconstruire le tableau (saisie fluide, focus préservé, éclat « enregistré ») ; le
  pré-remplissage d'un mois est envoyé **en un seul lot** ; rendus temps réel **groupés
  (debounce)** ; seul le **mois actif** est chargé ; barre de chargement pendant les requêtes.
- Toutes les actions (lecture, écriture, navigation) sont encapsulées en `try/catch`.

## 🔐 Rôles et sécurité

- **Administrateur** : accès complet (horaires, validation des mois, utilisateurs,
  export/sauvegarde, tout modifier).
- **Employée** : encode ses prestations tant que le mois est ouvert ; ne peut pas
  modifier ses horaires imposés ni un mois validé ; **ne voit pas** les prestations d'une
  collègue (cloisonnement Firestore).
- Une employée **archivée** ne peut plus se connecter ; ses données restent consultables.

En mode Firebase, ces règles sont **imposées côté serveur** (règles Firestore) et pas seulement par
l'interface — elles ne peuvent donc pas être contournées.

---

## 🧪 Tests

Des tests **end-to-end (Playwright)** couvrent les parcours clés en **mode démo**
(déterministe, hors-ligne) : connexion + navigation entre les onglets, mise à jour du
presté sur la feuille, ajout d'un enfant et comptage des présences, export de sauvegarde,
et blocage du premier mois (août 2026).

```bash
cd tests
npm install
npx playwright install chromium   # première fois seulement
npm test
```

Ils tournent aussi automatiquement en **intégration continue** (GitHub Actions,
`.github/workflows/ci.yml`) à chaque *push* et *pull request*.

## 🧭 Détails techniques

Voir [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) pour l'architecture, le schéma de
base de données (tables et relations), les règles de sécurité et la description des écrans.
