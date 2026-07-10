# 🏫 École des devoirs — Application de gestion

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

- **Horaires (admin)** : définition des heures à prester par jour dans un tableau
  mensuel type Excel ; verrouillage / déverrouillage / validation d'un mois.
- **Prestations (employées)** : encodage journalier (heures + type : normal, congé,
  récupération, autre) ; justification obligatoire en cas d'écart.
- **Calculs automatiques** : écart journalier, totaux mensuels, **solde reporté de mois
  en mois**, heures supplémentaires et heures à récupérer.
- **Verrouillage** : un mois verrouillé n'est plus modifiable par l'employée (seul
  l'admin peut intervenir) — imposé côté base via RLS.
- **Présences enfants** : encodage quotidien + historique.
- **Statistiques** : moyennes hebdo / mensuelle / annuelle, histogrammes et courbes.
- **Export PDF** : fiche mensuelle par employée (tableau, totaux, cases de signature).
- **Employées** : ajout, **archivage** (données conservées en lecture seule), réactivation.
- **Temps réel** : mise à jour automatique sur tous les appareils connectés.
- **Bonus** : journal d'audit, sauvegarde automatique, alerte d'erreur d'encodage.

---

## 🗂️ Structure du projet

```
.
├── index.html            # Shell de l'application (SPA)
├── css/styles.css        # Styles (responsive)
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

---

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
