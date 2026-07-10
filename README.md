# 🌳 EDD Jardin Sauvage — Application de gestion

Outil web **centralisé et responsive** pour gérer une école des devoirs :
horaires mensuels, encodage des prestations, calcul automatique des soldes (heures
supplémentaires / à récupérer), présences des enfants, statistiques, export PDF,
gestion et archivage des employées — avec **synchronisation temps réel** entre
plusieurs appareils via le cloud.

> **Deux modes, un même code :**
> - 🧪 **Mode démo** (par défaut) : données locales au navigateur — pour tester tout
>   de suite, sans rien installer. Sert aussi de maquette interactive.
> - ☁️ **Mode cloud** (Supabase) : données partagées et synchronisées en temps réel.

---

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

## ☁️ Passer en mode cloud (Supabase) — synchronisation multi-appareils

1. Crée un compte gratuit sur **https://supabase.com** puis un nouveau projet.
2. Dans **SQL Editor**, colle et exécute le contenu de [`supabase/schema.sql`](supabase/schema.sql)
   (crée les tables, la sécurité par rôle, l'audit et le report de solde).
3. Dans **Authentication → Users**, crée les comptes (admin + employées).
   Puis dans **SQL Editor** passe l'admin en administrateur :
   ```sql
   update public.profiles set role = 'admin' where full_name = 'Admin';
   ```
4. Dans **Settings → API**, copie l'**URL du projet** et la clé **anon public**.
5. Colle-les dans [`js/config.js`](js/config.js) :
   ```js
   window.APP_CONFIG = {
     SUPABASE_URL: 'https://xxxx.supabase.co',
     SUPABASE_ANON_KEY: 'eyJhbGciOi...',
   };
   ```
6. Recharge la page : le badge en haut passe de **🧪 Démo** à **☁️ Cloud**.

> La clé « anon » est publique par conception : la sécurité est assurée côté serveur
> par les règles **RLS** définies dans `schema.sql`.

---

## ✨ Fonctionnalités

- **Horaires prévus (admin)** : l'admin définit, par jour, une **heure de début** et une
  **heure de fin** prévues (tranches de 15 min), dans un tableau mensuel type Excel ;
  verrouillage / déverrouillage / validation d'un mois.
- **Horaire type hebdomadaire (admin)** : un modèle Lun→Dim par employée qui **pré-remplit
  automatiquement les nouveaux mois**. Modifiable à tout moment ; les **mois verrouillés ne
  sont jamais recalculés**, et les jours déjà modifiés gardent leur horaire réel.
- **Prestations (employées)** : l'employée voit l'horaire prévu et ne modifie que
  l'**heure de début / fin réelle** (tranches de 15 min) ; le presté et l'écart sont
  calculés automatiquement. Les jours sont **pré-remplis** avec l'horaire prévu — on ne
  modifie que les jours différents, et un changement d'horaire n'écrase pas une saisie
  déjà faite. Justification obligatoire en cas d'écart.
- **Identité visuelle** : logo (accueil, entête, PDF) et **code couleur par rôle**
  (administrateur = bleu, employée = vert) ; jours modifiés et écarts (+/−) mis en évidence.
- **Calculs automatiques** : écart journalier, totaux mensuels, **solde reporté de mois
  en mois**, heures supplémentaires et heures à récupérer.
- **Verrouillage** : un mois verrouillé n'est plus modifiable par l'employée (seul
  l'admin peut intervenir) — imposé côté base via RLS.
- **Présences enfants** : encodage quotidien + historique.
- **Statistiques** : moyennes hebdo / mensuelle / annuelle, histogrammes et courbes,
  avec **export PDF** (moyennes + graphiques inclus).
- **Export PDF** : fiche mensuelle par employée (tableau début/fin, totaux, signatures).
- **Employées** : ajout, **archivage** (données conservées en lecture seule), réactivation.
- **Temps réel** : mise à jour automatique sur tous les appareils connectés.
- **Bonus** : journal d'audit, sauvegarde automatique, alerte d'erreur d'encodage.

---

## 🗂️ Structure du projet

```
.
├── index.html            # Shell de l'application (SPA)
├── assets/logo.svg       # Logo (accueil, entête, PDF)
├── css/styles.css        # Styles (responsive, couleurs par rôle)
├── js/
│   ├── config.js         # Clés Supabase (vide = mode démo)
│   ├── store.js          # Couche de données : démo (localStorage) OU Supabase
│   └── app.js            # Interface, calculs, vues, PDF, graphiques
├── supabase/
│   └── schema.sql        # Schéma PostgreSQL : tables, RLS, audit, report de solde
├── docs/
│   └── ARCHITECTURE.md   # Proposition d'architecture + schéma de BDD + écrans
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

- Le système **démarre en janvier 2026** : impossible d'accéder à un mois antérieur.
- **Verrouillage en cascade** : verrouiller un mois verrouille automatiquement **tous les
  mois précédents** (depuis janvier 2026).
- Un mois **verrouillé** n'est plus modifiable par l'employée (seul l'admin peut intervenir).

## 🛡️ Stabilité & fiabilité

- **Filet anti-crash** : toute erreur affiche un message clair (jamais d'écran blanc), avec
  bouton « Recharger ». Gestionnaires globaux `error` / `unhandledrejection` + logs console.
- **Performances** : en mode cloud, les entrées **et** les profils sont **mis en cache**
  (moins de requêtes par rendu) ; l'audit réseau sur le chemin d'écriture a été supprimé
  (latence de saisie divisée) ; la feuille se met à jour **cellule par cellule** sans
  reconstruire le tableau (saisie fluide, focus préservé, éclat « enregistré ») ; les
  menus d'heures sont des **champs `time` natifs** (DOM allégé, meilleur sur mobile) ;
  rendus temps réel **groupés (debounce)** ; seul le **mois actif** est chargé ; barre de
  chargement pendant les requêtes.
- Toutes les actions (lecture, écriture, navigation) sont encapsulées en `try/catch`.

## 🔐 Rôles et sécurité

- **Administrateur** : accès complet (horaires, verrouillage, employées, audit, tout modifier).
- **Employée** : encode ses prestations tant que le mois est ouvert ; ne peut pas
  modifier ses horaires imposés ni un mois verrouillé/validé.
- Une employée **archivée** ne peut plus se connecter ; ses données restent consultables.

En **mode cloud**, ces règles sont **imposées par la base** (RLS) et pas seulement par
l'interface — elles ne peuvent donc pas être contournées.

---

## 🧭 Détails techniques

Voir [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) pour l'architecture, le schéma de
base de données (tables et relations), les règles de sécurité et la description des écrans.
