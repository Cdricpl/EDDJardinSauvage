# 🕒 Pointeuse — École des devoirs

Application web de **pointeuse** pour **2 employées** avec un **accès administrateur** :
horaires imposés, justification des heures effectuées hors horaire, validation par
l'admin (heures supplémentaires / récupérations) et statistiques.

**Version 100 % navigateur** : aucune installation, aucun serveur. Les données sont
enregistrées dans le navigateur (`localStorage`). Fonctionne en ligne sur **GitHub Pages**
ou simplement en ouvrant `index.html`.

---

## 🌐 Utiliser en ligne (GitHub Pages)

Une fois GitHub Pages activé, l'application est accessible à une adresse du type :

```
https://cdricpl.github.io/Pointeuse-/
```

### Activer / vérifier GitHub Pages
1. Dépôt GitHub → **Settings** → **Pages**.
2. **Source** : `Deploy from a branch`.
3. **Branch** : `main` · dossier `/ (root)` → **Save**.
4. Attendre ~1 minute puis ouvrir l'adresse affichée.

> ⚠️ Les fichiers de l'application doivent être **à la racine** du dépôt
> (c'est le cas ici : `index.html` est à la racine, pas dans un sous-dossier).
> Assure-toi que la branche choisie dans Pages contient bien ces fichiers
> (fusionne la Pull Request dans `main`, ou sélectionne la branche concernée).

---

## 💻 Utiliser hors ligne (sans internet)

Télécharge le dépôt (bouton vert **Code → Download ZIP**), décompresse-le,
puis **double-clique sur `index.html`**. L'application s'ouvre dans ton navigateur.

---

## 👥 Comptes par défaut

| Compte      | Rôle      | Code PIN |
|-------------|-----------|----------|
| Employée 1  | Employée  | `1111`   |
| Employée 2  | Employée  | `2222`   |
| Admin       | Admin     | `0000`   |

---

## ⚠️ Important : où sont stockées les données ?

Les données (pointages, horaires) sont enregistrées **dans le navigateur utilisé**
(`localStorage`). Conséquences :

- Les données **ne sont pas partagées** entre plusieurs ordinateurs / téléphones.
- Si l'Employée 1 pointe sur son téléphone, l'Admin sur un autre appareil **ne verra pas**
  ces pointages.
- Vider les données du navigateur efface aussi les pointages.

👉 Cette version convient bien si **tout le monde utilise le même ordinateur / navigateur**
(ex. l'ordinateur de l'école). Pour un vrai partage entre appareils, il faut la version
avec serveur (voir la section plus bas).

---

## ✨ Fonctionnalités

### Pour les employées
- **▶️ Commencer le travail** / **⏹️ Terminer le travail**.
- Récapitulatif **du jour** et **de la semaine**.
- Historique personnel **en lecture seule** : une employée ne peut jamais modifier ses heures.

### Horaires imposés (définis par l'admin)
- Heure de **début** / **fin** (ex. 14h–18h) et **jours obligatoires**.
- Les employées **voient** leur horaire mais ne peuvent pas le changer.

### Justification automatique des écarts
Quand une employée pointe **en dehors de l'horaire imposé** (arrivée en avance, départ en
retard, ou jour non prévu) et que l'écart dépasse **5 minutes** :
1. L'écart est **calculé automatiquement**.
2. Une **justification** est **obligatoire**.
3. Le pointage passe **« En attente de validation Admin »**.

### Espace admin
- Vue **globale** des pointages, avec **filtres** (employée, période).
- **Justifications en attente** : valider / refuser + classer en **Heures supplémentaires**
  ou **Récupération**.
- **Statistiques** par employée (heures prestées, heures sup., récupérations).
- Bouton **Réinitialiser les données**.

---

## 🗂️ Fichiers

```
Pointeuse-/
├── index.html      # Page de connexion
├── employee.html   # Espace employée (pointeuse + historique)
├── admin.html      # Espace admin (horaires + validations + stats)
├── common.js       # Données locales (localStorage) + logique + formatage
├── style.css       # Feuille de style
└── README.md
```

---

## 🔐 Règles de sécurité

- Les employées **ne peuvent jamais modifier leurs heures** (aucune action ne le permet).
- Seul l'**admin** peut : modifier les horaires, valider/refuser les justifications,
  réinitialiser les données.

---

## 🔁 Besoin d'un vrai partage entre appareils ?

Cette version (localStorage) est locale à chaque navigateur. Si tu as besoin que les deux
employées et l'admin partagent **les mêmes données depuis des appareils différents**, il
faut une version **avec serveur** (base de données commune). Cette version existe dans
l'historique Git du projet (serveur Node.js) et peut être hébergée sur un service qui
exécute Node (Render, Railway, etc.). Dis-le si tu veux que je la remette en place.
