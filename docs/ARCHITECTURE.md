# Architecture technique — Application École des devoirs

## 1. Vue d'ensemble

Application web **responsive**, hébergée en **frontend statique** (GitHub Pages) qui
communique avec une **base de données cloud Supabase** (PostgreSQL). Aucune couche
serveur à maintenir : la logique de sécurité vit dans la base (règles RLS) et
l'interface est du HTML/CSS/JS pur.

```
┌────────────────────────┐        HTTPS + WebSocket (temps réel)
│  Navigateur (PC/tablette)│ ─────────────────────────────────────┐
│  index.html + JS         │                                       │
│  - store.js (abstraction)│                                       ▼
│  - app.js (interface)    │                          ┌───────────────────────────┐
└────────────────────────┘                           │        SUPABASE           │
        │  mode démo (localStorage)                   │  - Auth (email + mot de   │
        └── fonctionne sans cloud                     │    passe, rôles)          │
                                                      │  - PostgreSQL + RLS       │
                                                      │  - Realtime (sync live)   │
                                                      └───────────────────────────┘
```

**Point clé — double mode :** la couche `store.js` expose une interface unique.
- Sans clés Supabase → **mode démo** (localStorage), utile pour tester/maquetter.
- Avec clés Supabase → **mode cloud**, données partagées et synchronisées en temps réel.

L'application peut donc être développée et démontrée immédiatement, puis basculée en
production en collant simplement l'URL + la clé du projet Supabase dans `js/config.js`.

## 2. Stack technique

| Couche | Choix | Pourquoi |
|--------|-------|----------|
| Frontend | HTML/CSS/JS natif (pas de framework) | Simple à maintenir, léger, aucune étape de build |
| Hébergement front | GitHub Pages | Gratuit, HTTPS, déploiement par `git push` |
| Base de données | Supabase (PostgreSQL) | Relationnel (idéal pour tableaux mensuels + soldes), gratuit |
| Authentification | Supabase Auth | Mot de passe + rôles, sécurisé |
| Temps réel | Supabase Realtime | Synchronisation multi-appareils automatique |
| Sécurité | Row Level Security (RLS) | Les règles d'accès sont dans la base, impossibles à contourner côté client |
| Graphiques | Chart.js (CDN) | Courbes/histogrammes simples |
| Export PDF | jsPDF + autoTable (CDN) | Génération PDF côté navigateur |

## 3. Structure de la base de données

### Tables et relations

```
profiles (utilisateurs)
  id (uuid, = auth.users.id)  PK
  full_name, role('admin'|'employee'), active(bool), created_at
        │
        │ 1─N
        ▼
months (statut de verrouillage par employée/mois)
  id PK · employee_id FK→profiles · year · month
  status('open'|'validated'|'locked') · carry_in_minutes · locked_at
  UNIQUE(employee_id, year, month)

day_entries (prestations journalières)
  id PK · employee_id FK→profiles · entry_date
  planned_minutes (admin) · worked_minutes (employée)
  kind('normal'|'conge'|'recuperation'|'autre') · justification · updated_at
  UNIQUE(employee_id, entry_date)

children_attendance (présences enfants, à l'échelle de l'école)
  entry_date PK · children(int) · note · updated_at

audit_log (historique des modifications)
  id PK · actor_id FK→profiles · action · entity · entity_id · details(jsonb) · created_at
```

Le fichier SQL complet (tables, index, RLS, déclencheurs) est dans
[`supabase/schema.sql`](../supabase/schema.sql).

### Règles de sécurité (RLS) — résumé

- **profiles** : lecture pour tout utilisateur connecté ; écriture réservée à l'admin.
- **day_entries** : l'admin écrit tout ; une employée n'écrit que **ses** lignes et
  **seulement si le mois est `open`** (le verrouillage est donc imposé côté serveur).
- **months** : seul l'admin change le statut (verrouiller/déverrouiller/valider).
- **children_attendance** : lecture/écriture pour tout utilisateur actif.
- **audit_log** : lecture admin uniquement.

### Calculs et report de solde

- **Écart journalier** = `worked_minutes − planned_minutes`.
- **Totaux mensuels** = somme des heures à prester / prestées.
- **Solde cumulé** = `solde_reporté + Σ(écarts du mois)`.
- **Report automatique** : à la clôture (verrouillage) d'un mois, un déclencheur SQL
  (`propagate_carry`) écrit le solde de clôture dans le `carry_in_minutes` du mois
  suivant. En mode démo, ce report est recalculé à la volée à partir de l'historique.

## 4. Écrans principaux (maquettes = prototype interactif)

Le prototype **est** la maquette (haute fidélité, cliquable). Écrans livrés :

1. **Connexion** — email + mot de passe, gestion des rôles.
2. **Feuille du mois** — tableau type Excel : une ligne par jour, colonnes
   *À prester / Presté / Type / Écart / Justification*. Enregistrement automatique.
   Bandeau de statut (En cours / Validé / 🔒 Verrouillé) et contrôles admin.
3. **Récapitulatif** — totaux par employée, solde reporté et solde cumulé, statut du mois.
4. **Enfants** — encodage du nombre d'enfants par jour + note, moyenne du mois, historique.
5. **Statistiques** — moyennes hebdo/mensuelle/annuelle + histogramme journalier et
   courbe de moyenne mensuelle.
6. **Employées** (admin) — liste, ajout, archivage/réactivation (lecture seule si archivée).
7. **Journal** (admin) — audit horodaté des modifications.

## 5. Bonus couverts

- **Audit** : journal des modifications (`audit_log`).
- **Sauvegarde automatique** : chaque cellule est enregistrée à la volée (pas de bouton « Enregistrer »).
- **Notifications d'erreur d'encodage** : les jours avec écart non justifié sont
  surlignés en rouge et comptés en haut de la feuille.

## 6. Évolutions possibles

- Création d'employées via une **Edge Function** Supabase (pour ne pas déconnecter
  l'admin lors du `signUp`).
- Verrouillage automatique d'un mois à date fixe.
- Export PDF multi-employées et export administratif global.
- Rôle « responsable » intermédiaire, notifications par email.
