# EDD Jardin Sauvage — mémo projet

Programme de gestion d'une école des devoirs (Belgique) : feuilles d'heures des employées,
présences des enfants, statistiques pour le dossier d'agrément.

## Comment le programme est réellement utilisé

- **Sur ORDINATEUR, essentiellement.** Chrome ou Edge, souvent depuis le raccourci créé par
  le bouton « 📥 Installer » (fenêtre sans barre d'adresse). C'est le cas d'usage à
  privilégier : largeur d'écran disponible, souris et **clavier** (Tab, saisie rapide).
  Le smartphone reste possible mais **secondaire** — ne pas sacrifier le confort sur
  ordinateur pour une contrainte tactile.
- **En ligne uniquement.** Le fonctionnement hors ligne n'est pas demandé : sans réseau,
  l'application affiche « Connexion Internet requise » (et surtout jamais le mode démo, qui
  ferait encoder dans une base factice).
- Deux rôles : **administration** (Stéphanie Lejeune, PIELTAIN Cédric) et **employées**.
- Données réelles de mineurs (noms, dates de naissance, écoles) : prudence sur tout ce qui
  touche aux droits d'accès.

## Architecture

- Projet statique, sans build : `index.html`, `js/config.js`, `js/store.js`, `js/app.js`,
  `css/styles.css`, `sw.js`. Hébergé par **GitHub Pages**.
- `js/store.js` expose deux implémentations de la même interface :
  `FirebaseStore` (Firestore, production) et `DemoStore` (localStorage, tests et démo,
  forcé par `?store=demo`).
- Bibliothèques externes par CDN : Firebase (gstatic), Chart.js et jsPDF (chargés seulement
  au moment où ils servent).
- Sécurité côté serveur : `firebase/firestore.rules` (à publier à la main dans la console
  Firebase — un changement de règles ne se déploie pas avec le code).

## Règles à ne pas oublier

- **Numéro de version : trois endroits doivent concorder** à chaque déploiement —
  `APP_VERSION` (`js/app.js`), `CACHE` (`sw.js`), les `?v=` (`index.html`).
  Format : `vAAAA.MM.JJ-N` (date du jour + n° de correctif du jour).
- **Année scolaire = 1er août → 31 juillet.** L'année ouverte est décidée par
  l'administration (bouton « Ouvrir l'année… »), mémorisée côté serveur, jamais déduite de
  l'horloge. Les années passées restent consultables, en lecture seule pour les employées.
- Le programme démarre en **août 2026** (`MIN_YM`) ; premier jour d'accueil des enfants :
  **24 août 2026** (`KIDS_MIN_ISO`).
- Ne pas « moderniser » : pas de framework, pas de changement de bibliothèque, pas de
  restructuration. Les corrections se font par lots, avec un point d'arrêt par lot.
- Avant de supprimer du code jugé mort : **le prouver** (compter les références).

## Tests

```bash
cd tests && npx playwright test          # 39 tests end-to-end, mode démo
PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npx playwright test
```

CI GitHub Actions : `.github/workflows/ci.yml` rejoue la suite à chaque push.

## Git

- Branche de développement : `claude/audit-jardin-sauvage-6psaz4`.
- Une pull request par lot ; l'utilisateur fusionne lui-même.
