# Audit — EDD Jardin Sauvage

**Date :** 20 août 2026 · **Version auditée :** `v2026.08.20-2` (commit `3b3a456`)
**Périmètre :** `index.html`, `js/app.js` (1606 l.), `js/store.js` (782 l.), `js/config.js`,
`css/styles.css` (344 l.), `sw.js`, `manifest.webmanifest`, `firebase/firestore.rules`, `tests/`.

> Ce n'est pas un fichier HTML autonome mais un petit projet statique : 3 scripts applicatifs,
> une feuille de style, un service worker, et 6 bibliothèques externes chargées par CDN.
> Aucune transpilation Babel dans le navigateur, aucune image stockée en base64 :
> **deux des causes de lenteur que vous soupçonniez sont absentes du projet.**

**Aucun fichier n'a été modifié.** Base de départ saine : les 21 tests Playwright passent (10,4 s).

## Comment ça a été mesuré

Toutes les valeurs chiffrées ci-dessous viennent d'exécutions réelles, pas d'estimations :
Chromium piloté par Playwright, serveur local avec gzip et en-têtes de cache réalistes,
réseau bridé à **1,6 Mb/s / 100 ms de latence**, processeur ralenti **×4** (smartphone
milieu de gamme). Les bibliothèques CDN ont été récupérées depuis npm dans leurs versions
exactes et servies localement pour mesurer leur coût réel.
Chaque bug marqué **CONFIRMÉ** a été reproduit par un scénario automatisé.

---

## 1. BUGS

### B1 — Boucle de rendu infinie : l'application se fige complètement · **BLOQUANT** · effort : XS
**`js/app.js:443-449`**

```js
if (ME.role === 'admin' && month.status === 'open' && entries.length === 0 && templateHasSlots(tpl) && !APPLYING) {
  APPLYING = true;
  try { await applyTemplate(...); }
  catch (e) { console.error('[auto-prefill]', e); toast('Pré-remplissage impossible : ' + e.message, 'error'); }
  finally { APPLYING = false; }
  return render();          // <-- relance viewSheet, qui retrouve entries.length === 0…
}
```

Si l'écriture du pré-remplissage échoue (règle Firestore qui refuse, quota plein, coupure
réseau), `entries` reste vide au tour suivant et `APPLYING` est déjà repassé à `false` :
`render()` → `viewSheet()` → échec → `render()`… sans jamais rendre la main. Comme tout
s'enchaîne en micro-tâches, la boucle **gèle l'onglet** — plus aucun `setTimeout` ne
s'exécute, la page ne répond plus, seule la fermeture de l'onglet en sort.

**CONFIRMÉ** — avec une écriture qui échoue systématiquement, l'onglet ne répond plus du
tout au bout de 10 s (aucun `setTimeout` exécuté) ; avec une écriture qui réussit, il répond
normalement.

Le pré-encodage des enfants (`app.js:817-828`) a exactement la garde qui manque ici — le
commentaire y explique même précisément ce danger. La feuille du mois ne l'a jamais reçue.

---

### B2 — Une déconnexion manuelle affiche « vous avez été déconnecté après 15 minutes d'inactivité » · **MAJEUR** · effort : XS
**`js/app.js:1604`** avec **`js/app.js:1564-1570`**

```js
document.getElementById('logoutBtn').onclick = doLogout;   // 1604
async function doLogout(auto) { … if (auto) sessionStorage.setItem('autoLogout', '1'); … }
```

Le gestionnaire reçoit l'objet `MouseEvent` comme premier argument : `auto` est donc
toujours *truthy* lors d'un clic sur « Déconnexion ». Le drapeau est posé, et
`renderLogin()` (`app.js:327-332`) affiche le message d'inactivité à chaque déconnexion
volontaire.

**CONFIRMÉ** — après un clic sur « Déconnexion », l'écran de connexion affiche
« Vous avez été déconnecté après 15 minutes d'inactivité. Reconnectez-vous. »

---

### B3 — Effacer une présence est annulé au rechargement suivant · **MAJEUR** · effort : S
**`js/app.js:820-836`** (pré-encodage) contre **`js/app.js:1047-1071`** (cycle à 3 états)

Le bouton cycle `présent → absent → non défini`, et le 3ᵉ état **supprime**
l'enregistrement (`setKidAttendance(kid, date, null)`). Or le pré-encodage automatique ne
sait pas distinguer « effacé volontairement » de « jamais encodé » : il ne saute que les
cases qui portent déjà un statut (`if (stat.get(...)) return;`). `PREFILLED_KIDS` protège
la session en cours, mais il est vidé à chaque rechargement.

Résultat : sur un jour habituel, l'éducatrice efface une case → au prochain chargement de
l'onglet, la case est **remise à « présent »**. L'état « non défini » est donc impossible à
conserver sur un jour habituel.

**CONFIRMÉ** — case du 24/08/2026 effacée (0 enregistrement en base), puis rechargement :
l'enregistrement est revenu avec `status: "present"`.

---

### B4 — Les jours à venir sont comptés dans la moyenne annuelle et les critères d'agrément · **MAJEUR** · effort : S
**`js/app.js:814-836`** (écriture) et **`js/app.js:1083-1085`, `1108-1121`** (lecture)

Le pré-encodage remplit **tout le mois affiché**, jours futurs compris, en « présent ».
Côté statistiques, `inYear` ne filtre que la borne basse (`>= KIDS_MIN_ISO`), jamais la
date du jour. Les jours pas encore vécus entrent donc dans :
- la moyenne journalière annuelle affichée en gros (`app.js:1162`) ;
- le nombre de « jours avec encodage » ;
- le critère « au moins 8 enfants de 6 à 15 ans par jour » (`app.js:1140-1143`) ;
- le critère « ouvert ≥ 2 h/semaine sur 20 semaines » n'est pas touché (il lit les
  prestations), mais les deux premiers le sont.

**CONFIRMÉ** — le 20/08/2026, l'onglet Statistiques affiche « 6 enfants encodés · 6 jour(s)
avec encodage » alors que **les 6 présences sont datées du 24 au 31 août**, c'est-à-dire
entièrement dans le futur. Le chiffre présenté comme un constat d'activité est en réalité
une prévision.

C'est le bug qui coûte le plus cher en conséquences : ces chiffres servent à justifier un
agrément.

---

### B5 — Ouvrir un menu d'heures efface une valeur hors quart d'heure · **MAJEUR** · effort : XS
**`js/app.js:130-136`**

```js
function hydrateTimeSelect(sel) {
  if (!sel || sel.dataset.full) return;
  const v = sel.value;
  sel.innerHTML = timeOptionsHTML(v);   // ne contient que les quarts d'heure
  sel.value = v;                        // échoue si v n'est pas dans la liste -> ''
}
```

`TIME_LIST` (`app.js:110`) ne contient que 06:00 → 21:00 par pas de 15 min. Une donnée
existante à 14:07 (import, ancienne saisie, restauration) s'affiche correctement au rendu
grâce à `timeStubHTML`, mais **disparaît dès qu'on touche le menu**. `setTimeValue`
(`app.js:138-143`) gère justement ce cas — `hydrateTimeSelect` ne le fait pas.

**CONFIRMÉ** — valeur `14:07` avant ouverture du menu, valeur vide après.

---

### B6 — Une heure refusée reste affichée alors que la base garde l'ancienne · **MAJEUR** · effort : XS
**`js/app.js:601`** et **`js/app.js:615`**

```js
if (s != null && f != null && f <= s) { toast("L'heure de fin doit être après le début.", 'error'); return; }
```

Le `return` abandonne l'enregistrement sans remettre le menu sur sa valeur précédente.
L'écran et la base divergent silencieusement jusqu'au prochain rendu complet.

**CONFIRMÉ** — fin passée à `09:00` sur un jour 14:00–18:00 : l'écran affiche `09:00`,
la base contient toujours `18:00`. L'utilisatrice croit avoir enregistré.

---

### B7 — Les employées n'ont aucune mise à jour temps réel des prestations (et une erreur console à chaque ouverture) · **MAJEUR** · effort : S
**`js/store.js:742-761`** croisé avec **`firebase/firestore.rules:58-60`**

```js
// store.js — écoute globale sur l'année, sans filtre d'employée
['day_entries', 'months', 'kids', 'kid_attendance', 'profiles', 'schedule_templates']
```
```
// firestore.rules — lecture d'une prestation réservée à l'admin ou à sa propriétaire
allow read: if isAdmin() || (signedIn() && resource.data.employee_id == request.auth.uid);
```

L'écouteur `day_entries` ne filtre pas sur `employee_id`. Pour une employée (non admin), la
requête porte sur des documents qu'elle n'a pas le droit de lire : Firestore refuse
l'abonnement entier. Conséquences : `console.warn('[firestore:onSnapshot]', …)` à chaque
ouverture, et surtout **une employée ne voit jamais en direct** l'horaire prévu qu'une
administratrice vient de modifier — il faut recharger.

*Diagnostic par lecture croisée du code et des règles ; non reproductible ici, l'accès
réseau vers Firebase étant coupé dans cet environnement. À vérifier en 30 s sur le
déploiement réel : ouvrir la console d'une employée connectée.*

---

### B8 — La case « non définie » ne s'affiche pas pareil selon le chemin · **MINEUR** · effort : XS
**`js/app.js:1059`** contre **`js/app.js:862`**

Au rendu, une case non définie est vide (`sym = ''`, commentaire explicite ligne 859-860 :
« un tiret se confondait avec le ✓ »). Après un cycle de clics, la même case affiche `·`
(`app.js:1059`) — reste de la version précédente qui n'a pas suivi le changement.

**CONFIRMÉ** — `·` juste après le clic, contenu différent après rechargement.

Note : `el.classList.remove('pres-p','pres-a','pres-exp')` (`app.js:1055`) oublie
`pres-v`, sans conséquence visible ici (même fond) mais c'est la même omission.

---

### B9 — Aucune borne haute sur la navigation des mois · **MINEUR** · effort : XS
**`js/app.js:389`** — `if (n) n.onclick = () => { CUR.m++; … }` sans garde, alors que
`prevM` est correctement borné par `atOrBeforeMin()`.

**CONFIRMÉ** — 14 clics sur « ▶ » mènent à octobre 2027, où le pré-encodage écrit des
présences « présent » (voir B4) plus d'un an à l'avance.

---

### B10 — Le pré-cache du service worker ne contient aucun fichier réellement demandé · **MINEUR** · effort : XS
**`sw.js:11-16`**

`APP_SHELL` pré-cache `css/styles.css`, `js/app.js`… alors que `index.html` demande
`css/styles.css?v=v2026.08.20-2`. `caches.match` respecte la chaîne de requête : ces
entrées ne seront **jamais** servies.

**CONFIRMÉ** — inspection du cache après installation :

| Pré-caché par `addAll` | Réellement demandé |
|---|---|
| `/css/styles.css` | `/css/styles.css?v=v2026.08.20-2` |
| `/js/app.js` | `/js/app.js?v=v2026.08.20-2` |
| `/js/store.js` | `/js/store.js?v=v2026.08.20-2` |
| `/js/config.js` | `/js/config.js?v=v2026.08.20-2` |

Le cache runtime (`cache.put`) rattrape le coup après un premier chargement en ligne, mais
la protection hors-ligne promise par `install` n'existe pas. Voir aussi **R5**.

---

### B11 — `window.open` bloqué (repli impression) provoque une exception · **MINEUR** · effort : XS
**`js/app.js:1211-1212`, `1501-1502`, `1539-1540`** — `const w = window.open(...)` puis
`w.document.write(...)` sans vérifier `w`. Un bloqueur de fenêtres surgissantes (fréquent
sur mobile) renvoie `null` → `TypeError`. Ce repli ne sert qu'hors ligne, quand jsPDF n'a
pas pu être chargé — c'est-à-dire exactement quand on en a besoin.

---

### B12 — Export PDF d'une employée disparue · **MINEUR** · effort : XS
**`js/app.js:1521`, `1549`, `1560`** — `currentEmpProfile` renvoie `{ active: true }` en
repli (`app.js:667`) ; `prof.full_name.replace(...)` lève alors un `TypeError`.

---

### B13 — `_db()` sans garde (mode démo) · **MINEUR** · effort : XS
**`js/store.js:103`** — `JSON.parse(localStorage.getItem(this.KEY))` renvoie `null` si un
autre onglet (ou l'utilisateur) a vidé le stockage pendant la session ; tout accès à
`db.profiles` échoue ensuite. `_session()` (ligne 109), lui, est bien protégé.

---

### B14 — Promesses non catchées · **MINEUR** · effort : XS
**`js/app.js:1192`, `1202`** (`exportStatsPDF(...)` sans `.catch`) et **`js/app.js:733`**
(`await applyTemplate(...)` sans `try`). Les trois autres exports ont bien leur `.catch`
(lignes 663, 789). Le filet global `unhandledrejection` (`app.js:1597`) les rattrape, donc
pas d'écran blanc — mais le message affiché est générique au lieu d'être contextualisé.

---

### B15 — Recherches non gardées dans le gestionnaire de présences · **MINEUR** · effort : XS
**`js/app.js:1056-1058`** — `days.find(...)` puis `day.dow` : si la ligne cliquée n'appartient
plus au mois affiché (rendu concurrent déclenché par le temps réel), `day` est `undefined`
et le clic lève une exception. `kids.find` est protégé (`kk &&`), pas `days.find`.

---

### B16 — Quota localStorage plein (mode démo uniquement) · **MINEUR** · effort : S
**`js/store.js:100`, `104-108`** — `_seed()` écrit sans `try` : si le quota est saturé, le
démarrage échoue. `_save()` non plus n'est pas protégé, mais l'exception remonte jusqu'aux
`try/catch` des vues, qui affichent un toast — la donnée est perdue sans état intermédiaire
cohérent (l'objet en mémoire a été muté, pas la base). **Sans effet en production** : votre
déploiement tourne en mode Firebase.

---

## 2. CODE MORT

Chaque entrée est justifiée : soit compteur de références à zéro, soit branche démontrée
inatteignable par un test.

### D1 — `viewStats` : toute la branche `if (ME.role === 'admin')` est inatteignable · effort : XS
**`js/app.js:1104-1153`** (le `if`), **`1166`** et **`1175`** (le ternaire `crit ? … : ''`)

La fonction commence ligne 1078 par `if (ME.role !== 'admin') { VIEW = 'sheet'; … return viewSheet(); }`.
Passé cette garde, `ME.role === 'admin'` est **toujours vrai** ; `crit` n'est jamais `null`.

**Preuve** : connexion en tant qu'employée → l'onglet Statistiques n'est pas dans la
navigation (`📅 Ma feuille / 📊 Mon récap / 🧒 Enfants`), et un accès forcé par
`VIEW = 'stats'; render()` retombe sur `VIEW === 'sheet'` sans jamais produire `.hero-stat`.
Le commentaire ligne 1102-1103 (« admin uniquement, car… ») décrit une protection qui a été
déplacée ligne 1078 sans que la première soit retirée.

### D2 — `if (CHART) { try { CHART.destroy(); } catch {} }` toujours faux · effort : XS
**`js/app.js:1195`** — `render()` détruit et remet `CHART = null` ligne 401 avant d'appeler
la vue, et `viewStats` ne le réaffecte pas avant la ligne 1195. `render()` est le seul
appelant de `viewStats` (`app.js:398`).

### D3 — Alias redondant · effort : XS
**`js/app.js:1201`** — `const chartMonthly = CHART;` juste après `CHART = new Chart(...)`.

### D4 — Paramètre jamais utilisé · effort : XS
**`js/app.js:1208`** — `exportStatsPDF(stats, chartDaily, chartMonthly)` : `chartDaily`
n'apparaît **nulle part** dans le corps de la fonction, et vaut `null` aux deux appels
(lignes 1192 et 1202). Reste d'une version à deux graphiques.

### D5 — `Util.ym` · **0 référence** · effort : XS
**`js/store.js:22`** — `grep -c 'Util\.ym'` sur `app.js` + `store.js` = **0**.

### D6 — `Util.today` · **0 référence** · effort : XS
**`js/store.js:27-30`** — 0 référence. Doublon fonctionnel de `todayISO()` (`app.js:216`),
qui est, lui, utilisé.

### D7 — Garde morte dans `allChildren` · effort : XS
**`js/store.js:308`** — `if (year != null && …)` : l'unique appelant (`app.js:1080`) passe
toujours `CUR.y`.

### D8 — CSS `.linkx` · **0 référence** · effort : XS
**`css/styles.css:273-274`** — aucune occurrence dans `app.js`, `store.js`, `index.html`.

### D9 — CSS `.badge.overtime` et `.badge.recovery` · **0 référence** · effort : XS
**`css/styles.css:294-295`** — les badges réellement utilisés sont `open`, `validated`,
`pending`, `refused`. Reste d'un ancien affichage de solde.

### D10 — `SCHOOLS` et `REQUIRED_SCHOOLS` sont deux tableaux identiques · effort : XS
**`js/app.js:48-49`** — `['Saint-Remacle', 'ARAHF']` défini deux fois. Deux sources de
vérité pour la même liste : si vous ajoutez une implantation dans l'une, le critère
d'agrément de l'autre ne suit pas.

### D11 — Logique dupliquée entre `app.js` et `store.js` · effort : S
| Fonction | `js/app.js` | `js/store.js` |
|---|---|---|
| `pad` | ligne 42 | `Util.pad`, ligne 23 |
| `daysInMonth` | ligne 43 | `Util.daysInMonth`, ligne 26 |
| `minToTime` | ligne 108 | `Util.minToTimeSafe`, ligne 25 |
| date du jour | `todayISO`, ligne 216 | `Util.today`, ligne 27 (mort) |

### D12 — Corps dupliqué dans `DemoStore` · effort : XS
**`js/store.js:283-290`** et **`js/store.js:292-301`** — `setKidAttendance` et
`setKidAttendances` répètent mot pour mot la logique `findIndex / splice / push`.

### D13 — `assets/icon.svg` jamais référencé · effort : XS
Absent de `index.html`, `manifest.webmanifest` (qui pointe `icon-192.png` / `icon-512.png`),
`sw.js`, du CSS et du JS.

### D14 — `id="loginVersion"` jamais utilisé · effort : XS
**`js/app.js:321`** — identifiant posé, aucun sélecteur CSS ni JS ne le cible.

### D15 — Traces textuelles de l'ancienne version Supabase · effort : XS
**`sw.js:35`** (« Supabase / CDN : réseau direct »), `tests/playwright.config.js:6`,
`tests/specs/app.spec.js:8`. Le projet est passé à Firebase (cf. `docs/migration-firebase.md`) ;
ces commentaires induisent en erreur à la lecture.

### D16 — Déclarations inutilement mutables / commentaires obsolètes · effort : XS
- **`js/app.js:438`** — `let entries = …` jamais réassigné.
- **`js/app.js:25`** — « (`pad` est défini plus bas : on formate ici sans l'utiliser.) » :
  note de refactoring restée dans le code.
- **`js/app.js:1494`** — `statusLbl` réimplémente la table `{ open: 'En cours', validated: '✓ Validé' }`
  déjà écrite en ligne (`app.js:775`).

> **Faux positif écarté** — `import-enfants-2025-2026.json` (racine) : le bouton « import en
> un clic » a bien été retiré (commit `9ea9c0f`), mais le fichier reste un livrable actif,
> restauré via « Restaurer une sauvegarde » et couvert par `tests/specs/app.spec.js:242`.
> **Ne pas le supprimer.**

---

## 3. PERFORMANCE

### Ce qui coûte réellement — mesuré

Protocole : Chromium, gzip actif, réseau 1,6 Mb/s / 100 ms, base de démonstration réaliste.
Médiane de 3 à 4 exécutions.

#### P1 — 6 bibliothèques bloquantes au démarrage, dont 2 inutiles avant un clic · **MAJEUR** · effort : M
**`index.html:45-50`**

| Bibliothèque | Brut | gzip | Nécessaire pour afficher l'écran de connexion ? |
|---|---:|---:|---|
| `firebase-app-compat.js` | 31 Ko | 10 Ko | oui |
| `firebase-auth-compat.js` | 139 Ko | 39 Ko | oui |
| `firebase-firestore-compat.js` | 342 Ko | 101 Ko | oui |
| `chart.js@4` | 209 Ko | 70 Ko | **non** — seulement l'onglet Statistiques |
| `jspdf@2.5.1` | 364 Ko | 115 Ko | **non** — seulement les boutons « Export PDF » |
| `jspdf-autotable@3.8.2` | 39 Ko | 12 Ko | **non** — idem |
| **Total** | **1 125 Ko** | **347 Ko** | |

Les six balises `<script>` sont sans `defer`/`async`, placées avant les scripts applicatifs :
le navigateur doit tout télécharger et tout exécuter avant la première ligne de `app.js`.

**Mesure — première peinture (FCP), médiane de 3 :**

| Configuration | FCP (CPU normal) | FCP (CPU ×4) | Transféré |
|---|---:|---:|---:|
| Actuelle (6 bibliothèques) | **2 404 ms** | **2 608 ms** | 342 Ko |
| Sans `chart.js` ni `jsPDF` | **1 412 ms** | **1 544 ms** | 148 Ko |
| Les 6 en `defer` | 2 404 ms | 2 612 ms | 342 Ko |

**≈ 1 seconde et 194 Ko économisés** en chargeant Chart.js et jsPDF **à la demande**, au
moment où l'utilisatrice ouvre Statistiques ou clique sur « Export PDF ».
L'application sait déjà fonctionner sans elles (replis `if (!window.Chart)` `app.js:1189`,
`if (!window.jspdf)` `app.js:1210`) : le repli devient un chargement.

> ⚠️ **`defer` seul ne règle rien et casserait l'application** : la mesure ci-dessus le
> confirme (0 ms gagné), et `store.js` teste `window.firebase` au chargement — avec `defer`
> sur les seules bibliothèques, `app.js` s'exécuterait avant elles et l'application
> basculerait en mode démo. C'est le chargement à la demande qu'il faut, pas `defer`.

#### P2 — Chaînes d'`await` séquentielles : chaque onglet paie 2 à 4 allers-retours au lieu d'un · **MAJEUR** · effort : S
`store.js` chiffre lui-même le coût (`js/store.js:383-385`) : *« Chaque `.get()` Firestore
est un aller-retour réseau (100-300 ms) »*. Or les lectures indépendantes sont enchaînées
au lieu d'être groupées :

| Vue | Lectures indépendantes, exécutées l'une après l'autre | Lignes |
|---|---|---|
| `viewSheet` | `getMonth` → `entriesForMonth` → `getTemplate` → `listProfiles` | 437-439, 456 |
| `viewChildren` | `listKids` → `kidAttendanceForMonth` | 796-797 |
| `viewStats` | `allChildren` → `listKids(true)` → `allEntriesForYear` | 1080, 1106, 1128 |

Sur un premier affichage (mémo vide), la feuille du mois coûte **4 allers-retours en série,
soit 400 à 1 200 ms** là où un `Promise.all` en demanderait un seul. C'est la lenteur la
plus visible au clic sur un onglet en mode cloud, et **la corriger ne change ni le
comportement ni l'affichage** : ce sont des lectures indépendantes.

`viewRecap` fait déjà bien (`Promise.all`, `app.js:766`) — mais garde deux `await` en série
à l'intérieur (`app.js:767`).

#### P3 — Reconstruction complète du DOM à chaque changement d'onglet · **MAJEUR** · effort : M
Chaque vue réassigne `app.innerHTML` en entier ; il n'y a pas de rendu incrémental.

| Scénario | CPU normal | **CPU ×4 (smartphone)** | Nœuds DOM |
|---|---:|---:|---:|
| Enfants — 12 enfants, 1 mois | 87 ms | **336 ms** | 1 281 |
| Enfants — 30 enfants, 12 mois | 120 ms | **458 ms** | 2 649 |
| Feuille — 12 enfants, 1 mois | 117 ms | **296 ms** | 755 |
| Feuille — 30 enfants, 12 mois | 103 ms | **331 ms** | 755 |

Au-delà de 200 ms un clic cesse d'être perçu comme instantané : **sur téléphone, chaque
changement d'onglet est à 300-460 ms.** À noter que la feuille du mois ne grossit pas avec
l'historique (755 nœuds constants) — le remplissage différé des menus d'heures
(`app.js:120-136`) fait bien son travail, et la grille des enfants reste raisonnable.
Le rendu par `innerHTML` est structurel : ne le retouchez pas avant d'avoir traité P1 et P2,
qui coûtent plus cher pour moins de risque.

> ✅ **RÉÉVALUÉ (21/08/2026) — ne rien faire, et voici pourquoi.**
>
> **1. Les chiffres ci-dessus étaient gonflés.** Ils incluaient les lectures enchaînées du
> store, supprimées depuis par P2. Sur le même scénario (12 enfants, 1 mois), le
> basculement mesuré aujourd'hui est de **30 ms** sur un ordinateur et **154 ms** en CPU ×4 —
> et non 87 / 336 ms. Le code d'origine, remesuré dans les mêmes conditions, donne
> 29 / 153 ms : l'écart annoncé venait bien de la méthode de mesure, pas du rendu.
>
> **2. Le rendu incrémental ne toucherait que 19 % du coût.** Décomposition à CPU ×4
> (30 enfants), compteurs du navigateur :
>
> | | |
> |---|---:|
> | calcul JavaScript | 31 ms |
> | affectation `innerHTML` | 26 ms |
> | **recalcul des styles** | **49 ms** |
> | **mise en page** | **78 ms** |
> | **peinture et composition** | **≈ 139 ms** |
>
> Soit **81 % de travail du navigateur** que le rendu incrémental ne supprime pas : il faut
> de toute façon poser, mesurer et peindre la même grille.
>
> **3. Sept pistes testées, aucune ne gagne quoi que ce soit** (médiane de 5, CPU ×4) :
> `content-visibility: auto` sur les lignes, `contain: layout style paint`, les deux
> combinés, `table-layout: fixed`, `fixed` + `content-visibility`, suppression des ombres
> de cellule, et suppression du bouton interne de chaque cellule. Toutes les variantes
> restent dans le bruit (±20 ms sur 300 ms) au volume réel.
>
> **4. La grille ne grandit pas avec l'historique.** Elle n'affiche jamais qu'**un mois** :
> sa taille dépend du seul nombre d'enfants. Avec les **12 enfants** de la liste actuelle,
> l'onglet s'ouvre en 30 ms sur les appareils de l'administration.
>
> **Seuil de réévaluation** : si la liste approche **30 enfants**, le basculement monte à
> ~310 ms en CPU ×4 et la virtualisation des lignes redevient discutable — c'est la seule
> piste qui réduirait réellement le travail de mise en page, puisqu'elle réduit le nombre
> d'éléments. En dessous, elle ne gagnerait rien : presque toutes les lignes sont visibles.

#### P4 — `entriesForEmployee` lit tout l'historique, sans borne de date · **MINEUR (aujourd'hui) / MAJEUR (dans 3 ans)** · effort : S
**`js/store.js:538-542`** — la requête ne filtre que sur `employee_id` : elle rapporte
**toutes** les prestations depuis août 2026, indéfiniment. Elle est mise en cache
(`_entriesCache`), mais `onChange` vide ce cache **entièrement** à chaque écriture d'une
collègue (`js/store.js:752`) → rechargement complet de l'historique.
Les écouteurs temps réel, eux, sont correctement bornés à l'année en cours
(`js/store.js:733-745`) : c'est la lecture qui ne l'est pas. À ~250 prestations/an et par
employée, comptez ~750 documents rechargés en année 3.

> ⚠️ **CORRECTION (21/08/2026) — la solution proposée ici était FAUSSE.**
> Borner cette lecture à l'année en cours **fait disparaître le solde reporté des années
> précédentes**. `monthSummary` (`js/app.js:236`) cumule les prestations depuis la mise en
> service pour calculer le report : la borne annuelle remet ce cumul à zéro chaque
> 1ᵉʳ janvier. **Mesuré** : pour une employée ayant accumulé +10 h en 2026, le report
> affiché en janvier 2027 passait de **10,0 h à 0,0 h**.
>
> Ce qui a été fait à la place (lot 2) : la lecture reste complète — elle doit l'être —
> mais `onChange` ne vide plus **tout** le cache quand une collègue enregistre une heure ;
> seules les employées réellement concernées par la modification sont relues. C'est le coût
> décrit ci-dessus qui est traité, sans toucher au calcul du report.

#### P5 — Recalculs redondants dans la boucle de rendu · **MINEUR** · effort : XS
**`js/app.js:855`** — `new Date(KIDS_MIN_ISO).toLocaleDateString('fr-FR')` est évalué
**dans chaque cellule** de la grille.

**Mesuré : 694 appels pour l'onglet Enfants… mais seulement 2,7 ms au total.** Le formateur
`Intl` est mis en cache par le moteur JS après le premier appel (les 2 premiers appels de la
page coûtent 15 à 34 ms, les suivants sont quasi gratuits).
**Correction propre à faire, gain réel négligeable.** Ne pas la vendre comme une
optimisation de performance.

### Hypothèses vérifiées puis écartées

Vous citiez cinq causes probables. Trois sont absentes, deux sont mesurées comme non
coupables. Autant de temps à ne pas y passer :

| Piste | Verdict |
|---|---|
| **Transpilation Babel dans le navigateur** | **Absente du projet.** Aucun `@babel/standalone`, aucun `type="text/babel"`. |
| **Images non redimensionnées en base64** | **Absentes.** Le seul `toDataURL` (`app.js:1466-1478`) sert aux PDF, est mis en cache, et n'est jamais évalué au démarrage. |
| **Écritures localStorage à chaque frappe (debounce manquant)** | **Mesuré, non coupable.** Une saisie = 1 `JSON.parse` + 1 `JSON.stringify` + 2 `setItem`, soit **0,3 ms** (petite base) à **19 ms** (base de 1,2 Mo). Et surtout : **cela ne concerne que le mode démo** — en production c'est Firestore. |
| **Listes longues non virtualisées** | **Mesuré, non critique.** 2 649 nœuds au maximum testé (30 enfants × 31 jours). Le défilement de la grille tient les **60 images/seconde** (image médiane 16,9 ms, p90 18,5 ms) malgré 129 cellules en `position: sticky`. La virtualisation n'apporterait rien à cette échelle. |
| **Service worker qui force un retéléchargement** (mon hypothèse initiale, `sw.js:42-43`) | **Mesuré, non coupable.** Sur 3 visites répétées après installation : 8 requêtes réseau pour les fichiers de l'application, contre 3 sans service worker. Les fichiers applicatifs pèsent 45 Ko gzip au total. Écart réel négligeable. |
| **Sélecteurs DOM répétés dans des boucles** | **Rien de significatif.** `document.getElementById` est appelé hors boucle ; les gestionnaires sont délégués (`app.js:588`, `app.js:1047`), ce qui est déjà le bon choix. |

**En résumé : le démarrage (P1, ~1 s) et les allers-retours réseau en série (P2, 0,4 à 1,2 s
par onglet) expliquent l'essentiel de la lenteur. Le reste est du bruit.**

---

## 4. RISQUES — ce qui peut vous faire perdre des données

### R1 — Des présences effacées réapparaissent d'elles-mêmes · **BLOQUANT**
Voir **B3**. Une correction manuelle (« finalement cet enfant n'était pas là, et je ne veux
pas noter d'absence ») est annulée sans avertissement au chargement suivant. C'est une
perte de saisie silencieuse, et elle contamine ensuite les statistiques d'agrément.

### R2 — Un enfant archivé par erreur ne peut plus être récupéré depuis l'application · **MAJEUR**
**`js/app.js:1032-1036`** — le bouton 🗑️ appelle `setKidActive(id, false)`. La liste
n'affiche que les enfants actifs (`listKids()` sans argument, `app.js:796`) et **aucun
écran ne propose de réactivation** : `listKids(true)` n'est utilisé que par les statistiques
(`app.js:1106`). Comparez avec les employées, qui ont bien un bouton « Réactiver »
(`app.js:1253`, `app.js:1404`).

**CONFIRMÉ** — après archivage : 0 ligne affichée, 1 enfant `active: false` en base,
0 bouton de réactivation dans toute l'application. Seul recours : restaurer une sauvegarde
JSON, ou éditer la base dans la console Firebase.

### R3 — Le bouton « Restaurer » ne fait pas la même chose selon le mode · **MAJEUR**
| | Mode démo (`js/store.js:327-346`) | Mode Firebase (`js/store.js:671-731`) |
|---|---|---|
| Tables de données | **Remplacées** (`db.kids = data.kids`) | **Fusionnées** (`set(..., { merge: true })`) |
| Enregistrements absents du fichier | **Supprimés** | **Conservés** |

L'interface annonce pourtant un seul comportement : « Les données existantes sont
**remplacées** » (`app.js:1324-1325`). En production (Firebase), restaurer une sauvegarde
**ne supprime pas** les enfants ou présences ajoutés depuis : vous obtenez un mélange des
deux états, sans le savoir. Un utilisateur qui restaure pour « revenir en arrière » après
une fausse manipulation ne revient pas en arrière.

### R4 — Une sauvegarde faite en mode démo ne contient pas les mots de passe · **MAJEUR**
**`js/store.js:319`** — `profiles: (db.profiles || []).map(({ password, ...p }) => p)`.
Choix défendable en sécurité, mais restaurer une telle sauvegarde dans un navigateur vierge
donne des comptes avec le mot de passe `changeme` (`js/store.js:340`), sans que rien ne
l'annonce à l'écran.

### R5 — Fenêtre de casse hors-ligne à chaque déploiement · **MAJEUR**
Combinaison de **B10** et de **`sw.js:23-29`** : `activate` **supprime tous les caches**
dont le nom diffère de la nouvelle version, et le nouveau pré-cache ne contient que des URL
que l'application ne demande jamais (les versions sans `?v=`). Entre l'activation du nouveau
service worker et un premier chargement en ligne réussi, un appareil hors réseau n'a **ni
CSS ni JS en cache** : il tombe sur `index.html` sans style ni logique, ou sur
`offline.html`. Sur un téléphone en zone de réseau faible, la fenêtre peut durer.

### R6 — Aucune sauvegarde automatique, aucun rappel · **MAJEUR**
La sauvegarde est entièrement manuelle (bouton 💾, `app.js:292-293`) et réservée à
l'administratrice. Le texte de l'interface conseille de « sauvegarder régulièrement »
(`app.js:1315`) mais rien ne le rappelle, rien n'indique la date de la dernière sauvegarde.
Combiné à R2 et R3, c'est votre seul filet, et il dépend d'une habitude.

### R7 — Les noms sont injectés en HTML brut · **MINEUR (sécurité)**
**`js/app.js:879`** (`<div class="kidnom">${nom}</div>`), **`app.js:770`** et **`1269`**
(`${p.full_name}`), **`app.js:1171`** (`${c.val}`, qui contient les noms d'écoles).
Aucun échappement `<` `>`. Le risque n'est pas l'administratrice qui tape son propre texte,
mais **un fichier JSON de restauration corrompu ou d'origine incertaine** : `importAll`
écrit ces champs tels quels, et ils sont ensuite injectés dans le DOM.
Les attributs, eux, sont bien protégés (`.replace(/"/g, '&quot;')`).

### R8 — Écouteurs jamais retirés · **MINEUR**
`startIdleTimer` (`app.js:1585-1589`) ajoute 6 écouteurs `window` que `stopIdleTimer`
(`app.js:1590`) ne retire pas ; `FirebaseStore.onChange` (`js/store.js:742-761`) ouvre
6 abonnements `onSnapshot` sans jamais conserver les fonctions de désabonnement ;
`DemoStore.onChange` (`js/store.js:349-353`) ajoute un écouteur `storage` définitif.
**Sans conséquence aujourd'hui** : chacun n'est posé qu'une fois par chargement, et
`doLogout` fait un `location.reload()`. À garder en tête si un jour la déconnexion cesse de
recharger la page.

### Non-risques vérifiés
- **Clés Firebase publiques dans `js/config.js`** : normal et documenté (`config.js:8-10`).
  La sécurité repose sur `firebase/firestore.rules`, qui sont correctement écrites :
  cloisonnement RH des prestations, impossibilité de s'auto-promouvoir administrateur
  (`rules:46-48`), refus par défaut (`rules:88-90`), blocage des dates antérieures à
  août 2026 (`rules:37`). **Rien à corriger de ce côté.**
- **Mots de passe en clair dans `localStorage`** : mode démo uniquement, jamais en production.

---

## Plan d'action ordonné

Trié par **gain ÷ risque**. Les efforts sont cumulés par lot.

### Lot 1 — Bugs bloquants · gain : très élevé · risque : très faible · ~1 h
Corrections locales, chacune de quelques lignes, aucune n'affecte l'interface.

| # | Correction | Fichier | Pourquoi d'abord |
|---|---|---|---|
| 1 | **B1** — garde anti-boucle sur le pré-remplissage (même mécanisme que `PREFILLED_KIDS`) | `app.js:443` | Seul bug qui **fige l'appareil**. Correctif : un `Set` de mois déjà tentés. |
| 2 | **R1/B3** — le 3ᵉ état doit être persistable | `app.js:1052`, `store.js` | Perte de saisie silencieuse. |
| 3 | **B4** — exclure les jours à venir du pré-encodage **et** des statistiques | `app.js:822`, `1083` | Vos chiffres d'agrément sont faux aujourd'hui. |
| 4 | **B2** — `onclick = () => doLogout(false)` | `app.js:1604` | 1 ligne, message trompeur à chaque déconnexion. |

> Pour le point 2 et le point 3, deux arbitrages **d'interface** vous appartiennent — je
> vous les poserai avant de coder, comme convenu : (a) effacer une case doit-il enregistrer
> un état « non défini » explicite, ou bloquer le pré-encodage sur ce jour ? (b) les jours à
> venir doivent-ils rester pré-encodés à l'écran (pratique pour préparer le mois) tout en
> étant exclus des statistiques, ou ne plus être pré-encodés du tout ?

### Lot 2 — Performance · gain : élevé · risque : faible · ~2 h
| # | Correction | Gain mesuré |
|---|---|---|
| 5 | **P1** — charger `chart.js` et `jsPDF` à la demande | **−1 000 ms au démarrage, −194 Ko** |
| 6 | **P2** — grouper en `Promise.all` les lectures indépendantes de `viewSheet`, `viewChildren`, `viewStats` | **−300 à −900 ms par ouverture d'onglet** (cloud) |
| — | ~~**P3** — rendu incrémental~~ → **NE PAS FAIRE** : 81 % du coût est du travail navigateur que le rendu ne touche pas (voir la réévaluation en P3). | — |
| 7 | ~~**P4** — borner `entriesForEmployee` sur l'année~~ → **NE PAS FAIRE** (efface le solde reporté, voir la correction en P4). Vider le cache par employée au lieu de le vider entièrement. | évite la dégradation progressive |
| 8 | **P5** — sortir `toLocaleDateString` de la boucle de cellules | ~3 ms — pour la propreté |

Aucune de ces corrections ne change de bibliothèque, ne restructure l'architecture ni ne
touche à l'apparence. Le point 5 réutilise les replis `if (!window.Chart)` / `if (!window.jspdf)`
déjà présents.

### Lot 3 — Bugs majeurs restants · gain : moyen · risque : faible · ~1 h 30
9. **B5** — `hydrateTimeSelect` doit préserver une valeur hors liste (aligner sur `setTimeValue`).
10. **B6** — remettre le menu sur sa valeur précédente quand l'heure est refusée.
11. **B7** — filtrer l'écouteur `day_entries` sur `employee_id` pour les non-admins (**à confirmer sur le déploiement réel avant de coder**).
12. **R2** — rendre un enfant archivé récupérable (choix d'interface à valider avec vous).
13. **R3/R5** — aligner le texte de « Restaurer » sur le comportement réel ; corriger le pré-cache du service worker.

### Lot 4 — Code mort · gain : lisibilité · risque : très faible · ~45 min
D1 à D16 dans l'ordre du rapport. Chaque suppression est déjà justifiée ci-dessus
(compteur à zéro ou branche démontrée inatteignable). Les 21 tests Playwright servent de
filet de sécurité. **Ne pas toucher à `import-enfants-2025-2026.json`.**

### Lot 5 — Mineurs · gain : robustesse · risque : très faible · ~45 min
B8, B9, B11 à B16, R7 (échappement HTML des noms), R8.

---

**Total estimé : 6 à 7 heures**, dont **1 h pour l'essentiel du risque** (lot 1) et
**2 h pour l'essentiel de la lenteur** (lot 2).

Je m'arrête ici comme demandé. Dites-moi quels lots lancer, et dans quel ordre — je
reprendrai catégorie par catégorie, un point d'arrêt et un résumé de 3 lignes par lot,
sans rien modifier au comportement ni à l'interface sans vous avoir demandé d'abord.
