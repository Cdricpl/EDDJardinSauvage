/* ------------------------------------------------------------------
 * app.js — Interface et logique de l'application.
 * Utilise Store (js/store.js) : fonctionne en mode démo ou cloud.
 * ------------------------------------------------------------------ */

/* Version affichée dans l'entête : permet de vérifier d'un coup d'œil que
 * l'appareil utilise bien la dernière version publiée.
 * ⚠️ À incrémenter à CHAQUE déploiement, en même temps que `CACHE` dans sw.js. */
const APP_VERSION = 'v2026.08.21-4';

let STORE = null, MODE = 'demo', ME = null;
let VIEW = 'sheet';
let SEL_EMP = null;                 // employée sélectionnée (vue admin)
let APPLYING = false;               // garde anti-réentrance du pré-remplissage (feuille)
let APPLYING_KIDS = false;          // garde anti-réentrance du pré-encodage des présences enfants
let CHART = null;                   // instance Chart.js courante (détruite avant réutilisation)
const PREFILLED_KIDS = new Set();   // mois déjà pré-encodés cette session (anti-boucle)
const PREFILLED_SHEETS = new Set(); // feuilles déjà pré-remplies cette session (anti-boucle)
let CUR = (() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() + 1 }; })();

/* Le système démarre en AOÛT 2026 : aucun mois antérieur n'est accessible, et
 * rien de ce qui précède n'entre dans les calculs. Ce qui a été presté avant
 * est repris une seule fois via le « solde de départ » de chaque employée
 * (onglet Utilisateurs), et non mois par mois. */
const MIN_YM = { y: 2026, m: 8 };
// (`pad` est défini plus bas : on formate ici sans l'utiliser.)
const MIN_ISO = `${MIN_YM.y}-${String(MIN_YM.m).padStart(2, '0')}-01`;
/* Premier jour d'accueil des enfants. Aucun enfant n'est présent le 23 août 2026
 * ni avant : ces jours ne sont ni pré-encodés, ni encodables, et ils n'entrent
 * pas dans les statistiques (sinon la moyenne serait faussée par des jours
 * d'ouverture fictifs). */
const KIDS_MIN_ISO = '2026-08-24';
// Formaté une seule fois : l'infobulle « aucun accueil avant… » est posée sur
// chaque cellule de la grille (près de 700 par mois), ce qui rappelait ce
// formatage autant de fois pour une valeur qui ne change jamais.
const KIDS_MIN_LISIBLE = new Date(KIDS_MIN_ISO).toLocaleDateString('fr-FR');
/* ---- Année scolaire : du 1er août au 31 juillet ----
 * Les statistiques et les critères d'agrément portent sur l'année SCOLAIRE,
 * pas sur l'année civile : le dossier d'agrément se raisonne en septembre-juin,
 * et couper au 31 décembre séparait en deux un même cycle d'accueil. */
const anneeScolaireDe = (y, m) => (m >= 8 ? y : y - 1);
const debutAnnee   = (a) => `${a}-08-01`;
const finAnnee     = (a) => `${a + 1}-07-31`;
const libelleAnnee = (a) => `${a}-${a + 1}`;
// Mois dans l'ordre scolaire, avec l'année civile à laquelle chacun appartient.
const moisAnnee = (a) => [8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7]
  .map((m) => ({ m, y: m >= 8 ? a : a + 1 }));

const ymNum = (y, m) => y * 12 + (m - 1);
/* Borne HAUTE : juin, fin de l'année scolaire en cours. Sans elle, le bouton ▶
 * n'avait aucune limite — quatorze clics menaient à octobre 2027, où le
 * pré-encodage écrivait des présences plus d'un an à l'avance. De juillet à
 * décembre, l'année scolaire en cours se termine en juin de l'année suivante. */
/* ANNEE = année scolaire OUVERTE, décidée par l'administration (bouton
 * « Nouvelle année ») et mémorisée côté serveur, pas déduite de l'horloge :
 * une année ne se clôture pas toute seule un 31 juillet à minuit, elle se
 * clôture quand l'administration a fini de la vérifier. */
let ANNEE = MIN_YM.y;              // année scolaire ouverte (2026 = 2026-2027)
let ANNEE_VUE = MIN_YM.y;          // année scolaire affichée (peut être passée)

// Bornes de navigation : l'année AFFICHÉE, jamais avant la mise en service ni
// après la fin de l'année ouverte.
const borneBasse = () => {
  const d = { y: ANNEE_VUE, m: 8 };
  return ymNum(d.y, d.m) < ymNum(MIN_YM.y, MIN_YM.m) ? { ...MIN_YM } : d;
};
const borneHaute = () => ({ y: ANNEE_VUE + 1, m: 7 });
const atOrBeforeMin = () => ymNum(CUR.y, CUR.m) <= ymNum(borneBasse().y, borneBasse().m);
const atOrAfterMax = () => ymNum(CUR.y, CUR.m) >= ymNum(borneHaute().y, borneHaute().m);
function clampMonth() {
  const bas = borneBasse(), haut = borneHaute();
  if (ymNum(CUR.y, CUR.m) < ymNum(bas.y, bas.m)) { CUR.y = bas.y; CUR.m = bas.m; return; }
  if (ymNum(CUR.y, CUR.m) > ymNum(haut.y, haut.m)) { CUR.y = haut.y; CUR.m = haut.m; }
}
// Une année scolaire close n'est plus modifiable par les employées.
const anneeClose = () => ANNEE_VUE < ANNEE;
// L'année ouverte est terminée : l'administration doit ouvrir la suivante.
const anneeAEcheance = () => todayISO() > finAnnee(ANNEE);
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
/* Mode « en ligne » (données partagées + envoi d'emails de réinitialisation). */
const isCloud = () => MODE === 'firebase';
/* Échappe un texte avant de l'insérer dans du HTML.
 * Le risque n'est pas l'administratrice qui tape son propre texte, mais un
 * fichier de sauvegarde corrompu ou d'origine incertaine : `importAll` écrit
 * les noms tels quels, et ils repartent ensuite dans le DOM. Un nom contenant
 * « < » cassait l'affichage ; il s'affiche maintenant littéralement. */
const echapper = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ---------------- Helpers temps ---------------- */
const pad = (n) => String(n).padStart(2, '0');
const daysInMonth = (y, m) => new Date(y, m, 0).getDate();
const monthName = (y, m) => new Date(y, m - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
const DOW = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

/* Implantations scolaires (critère d'agrément : au moins deux, dont les principales). */
const SCHOOLS = ['Saint-Remacle', 'ARAHF'];
// Même liste, sous le nom qu'elle porte dans les critères d'agrément. Écrite une
// seule fois : dupliquée, ajouter une implantation dans l'une laissait l'autre
// en arrière, et le critère d'agrément devenait faux sans prévenir.
const REQUIRED_SCHOOLS = SCHOOLS;

/* Responsables à contacter pour toute correction d'une fiche enfant.
 * Les employées ne modifient pas ces fiches : elles signalent le changement. */
const ADMINS_CONTACT = 'Stéphanie Lejeune ou PIELTAIN Cédric';

/* Pastille d'initiales devant chaque enfant : repère visuel qui aide à
 * retrouver sa ligne dans une grille de 31 colonnes. La couleur est tirée du
 * nom, donc stable d'un mois à l'autre et d'un appareil à l'autre. */
const AVATAR_COLORS = ['#34568b', '#7d5ba6', '#2f7d4f', '#c07a1e', '#b23a3a', '#2a7d8c', '#8a1f1f', '#4a6fa5'];
function avatarColor(nom) {
  let h = 0;
  for (let i = 0; i < nom.length; i++) h = (h * 31 + nom.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function initials(k) {
  const a = (k.last_name || k.first_name || '?').trim()[0] || '?';
  const b = (k.first_name || '').trim()[0] || '';
  return (a + b).toUpperCase();
}

/* Année scolaire suivie par l'enfant (colonne « Année » de l'horaire papier). */
const GRADES = ['M1', 'M2', 'M3', '1re', '2e', '3e', '4e', '5e', '6e'];
function gradeOptions(value) {
  const opts = ['<option value="">— non précisée —</option>']
    .concat(GRADES.map((g) => `<option value="${g}"${g === value ? ' selected' : ''}>${g}</option>`));
  if (value && !GRADES.includes(value)) opts.push(`<option value="${value}" selected>${value}</option>`);
  return opts.join('');
}
function schoolOptions(value) {
  const opts = ['<option value="">— non précisé —</option>']
    .concat(SCHOOLS.map((s) => `<option value="${s}"${s === value ? ' selected' : ''}>${s}</option>`));
  // Conserve une valeur personnalisée éventuelle (ex. import).
  if (value && !SCHOOLS.includes(value)) opts.push(`<option value="${value}" selected>${value}</option>`);
  return opts.join('');
}
// Âge (en années) à une date donnée, depuis une date de naissance "AAAA-MM-JJ".
function ageAt(birthdate, dateISO) {
  if (!birthdate || !dateISO) return null;
  const b = new Date(birthdate), d = new Date(dateISO);
  if (isNaN(b) || isNaN(d)) return null;
  let a = d.getFullYear() - b.getFullYear();
  const m = d.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && d.getDate() < b.getDate())) a--;
  return a;
}
// Numéro de semaine ISO (pour compter les semaines d'ouverture).
function isoWeekKey(dateISO) {
  const d = new Date(dateISO); if (isNaN(d)) return dateISO;
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((t - yearStart) / 86400000) + 1) / 7);
  return `${t.getUTCFullYear()}-S${String(week).padStart(2, '0')}`;
}

/* Encodage par heure de début/fin — menu déroulant limité aux quarts d'heure. */
function timeToMin(t) { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + m; }
function minToTime(min) { return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`; }
// Liste des heures autorisées : uniquement les quarts d'heure (minutes 00/15/30/45).
const TIME_LIST = (() => { const o = []; for (let m = 6 * 60; m <= 21 * 60; m += 15) o.push(minToTime(m)); return o; })();
// Chaîne d'options construite UNE seule fois (la feuille du mois affiche ~140
// menus de 61 options : la reconstruire à chaque fois coûtait cher au rendu).
const TIME_OPTIONS_BASE = '<option value="">--:--</option>' +
  TIME_LIST.map((t) => `<option value="${t}">${t}</option>`).join('');
function timeOptionsHTML(value) {
  if (!value) return TIME_OPTIONS_BASE;
  return TIME_OPTIONS_BASE.replace(`<option value="${value}">`, `<option value="${value}" selected>`);
}

/* Menus d'heures REMPLIS À LA DEMANDE.
 * Au départ un menu ne contient QUE sa valeur affichée ; ses 61 options ne sont
 * créées qu'au premier clic (ou à la tabulation) dessus. Sans cela la feuille du
 * mois fabriquait ~8 500 balises <option> à CHAQUE affichage — d'où les saccades
 * au changement de mois ou d'employée. Avec ce remplissage différé il en reste
 * moins de 150 : le rendu est plusieurs fois plus rapide, et l'utilisation reste
 * strictement identique (menu déroulant natif, mêmes heures). */
function timeStubHTML(value) {
  return value ? `<option value="${value}" selected>${value}</option>` : '<option value="">--:--</option>';
}
function hydrateTimeSelect(sel) {
  if (!sel || sel.dataset.full) return;
  const v = sel.value;
  sel.dataset.full = '1';
  sel.innerHTML = timeOptionsHTML(v);
  /* `sel.value = v` échouerait pour une heure absente de TIME_LIST — 14:07 venu
   * d'un import, d'une ancienne saisie ou d'une restauration : le menu se
   * vidait, et la donnée réelle disparaissait au simple fait de l'ouvrir.
   * setTimeValue ajoute l'option manquante, comme il le fait déjà ailleurs. */
  setTimeValue(sel, v);
}
// Affecte une valeur par programme, même si le menu n'est pas encore rempli.
function setTimeValue(sel, v) {
  if (!sel) return;
  v = v || '';
  if (v && ![...sel.options].some((o) => o.value === v)) sel.add(new Option(v, v));
  sel.value = v;
}
// Délégation posée UNE seule fois sur #app (survit aux re-rendus innerHTML).
function wireLazyTimes() {
  const app = document.getElementById('app');
  if (!app || app.dataset.lazyWired) return;
  app.dataset.lazyWired = '1';
  const hyd = (ev) => {
    const t = ev.target;
    if (t && t.closest) hydrateTimeSelect(t.closest('select.time'));
  };
  ['pointerdown', 'focusin', 'keydown'].forEach((e) => app.addEventListener(e, hyd, true));
}
function timeSelect(k, date, value, disabled) {
  return `<select class="cell time" data-k="${k}" data-date="${date}" ${disabled ? 'disabled' : ''}>${timeStubHTML(value || '')}</select>`;
}
// Heures PRÉVUES : durée définie par l'admin via heure de début/fin prévue.
function plannedMinutes(e) {
  const s = timeToMin(e.planned_start), f = timeToMin(e.planned_end);
  if (s != null && f != null) return Math.max(0, f - s);
  return e.planned_minutes || 0; // compat anciennes données
}
// Heures PRESTÉES effectives : calculées depuis début/fin réels ; si l'employée
// n'a rien modifié, on retombe sur l'horaire prévu (pré-remplissage).
function effectiveWorked(e) {
  const s = timeToMin(e.start_time), f = timeToMin(e.end_time);
  if (s != null && f != null) return Math.max(0, f - s);
  if (!e.worked_touched) return plannedMinutes(e);
  return e.worked_minutes || 0;
}
function fmtHM(min) {
  const sign = min < 0 ? '-' : '';
  min = Math.abs(Math.round(min));
  return `${sign}${Math.floor(min / 60)}h${pad(min % 60)}`;
}
// Écart signé : « + » explicite pour le positif (indice non basé uniquement sur la couleur).
function fmtDelta(min) { return !min ? '—' : (min > 0 ? '+' : '') + fmtHM(min); }
/* Lit une durée saisie à la main : « 12h30 », « 12:30 », « 12h », « 12 »,
 * précédée au besoin de « - » pour des heures à récupérer. Renvoie des minutes,
 * ou null si la saisie n'est pas exploitable (on préfère refuser que deviner).
 * Les décimales sont volontairement rejetées : « 12.30 » voudrait dire 12h18
 * pour l'ordinateur et 12h30 pour l'utilisatrice. */
function parseHM(txt) {
  const s = String(txt == null ? '' : txt).trim().replace(/\s+/g, '');
  if (!s || s === '-' || s === '+') return 0;
  const m = s.match(/^([+-]?)(\d{1,3})(?:[h:](\d{1,2})?)?$/i);
  if (!m) return null;
  const min = Number(m[3] || 0);
  if (min > 59) return null;
  const total = Number(m[2]) * 60 + min;
  return m[1] === '-' ? -total : total;
}
function toast(msg, kind = 'ok') {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast ' + kind; t.style.display = 'block';
  clearTimeout(t._t); t._t = setTimeout(() => (t.style.display = 'none'), 3000);
}

/* ---------------- Téléchargement de fichiers (sans dépendance) ---------------- */
function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type: type || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
// Transforme un tableau de lignes (tableaux) en CSV (séparateur « ; » pour Excel FR).
function toCSV(rows) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return '﻿' + rows.map((r) => r.map(esc).join(';')).join('\r\n'); // BOM = accents OK dans Excel
}
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
// Sauvegarde complète (JSON) — partagée par la carte « Données » et le bouton 💾 de l'entête.
async function backupJSON() {
  try {
    const data = await STORE.exportAll();
    downloadFile(`edd-sauvegarde_${todayISO()}.json`, JSON.stringify(data, null, 2), 'application/json');
    toast('Sauvegarde JSON téléchargée');
  } catch (e) { toast('Export impossible : ' + e.message, 'error'); }
}

/* ================================================================
 * Chargement À LA DEMANDE des bibliothèques d'affichage
 * ----------------------------------------------------------------
 * Chart.js (70 Ko) et jsPDF + autoTable (127 Ko) pèsent 194 Ko compressés à
 * elles seules, et ne servent QU'À l'onglet Statistiques et aux boutons
 * « Export PDF ». Chargées au démarrage comme avant, elles retardaient le
 * premier affichage d'environ une seconde à chaque ouverture de l'application,
 * y compris pour une éducatrice qui ne fait qu'encoder ses présences.
 * On les télécharge donc au moment où elles servent réellement.
 *
 * Les replis existants (« Graphique indisponible », impression navigateur)
 * restent en place et prennent le relais si le téléchargement échoue —
 * typiquement hors ligne : le comportement est alors exactement celui d'avant.
 * ================================================================ */
const CDN = {
  chart:     'https://cdn.jsdelivr.net/npm/chart.js@4',
  jspdf:     'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
  autotable: 'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js',
};
// On mémorise la PROMESSE : deux clics rapprochés ne téléchargent qu'une fois.
const SCRIPTS = new Map();
function chargerScript(url) {
  if (SCRIPTS.has(url)) return SCRIPTS.get(url);
  const p = new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = url; el.async = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error('Téléchargement impossible : ' + url));
    document.head.appendChild(el);
  }).catch((e) => { SCRIPTS.delete(url); throw e; });   // un échec doit pouvoir être retenté
  SCRIPTS.set(url, p);
  return p;
}
// Renvoient `false` si la bibliothèque reste indisponible : l'appelant bascule
// alors sur son repli, comme il le faisait déjà quand le CDN était injoignable.
async function assurerChart() {
  if (window.Chart) return true;
  try { await chargerScript(CDN.chart); }
  catch (e) { console.warn('[chart]', e.message); }
  return !!window.Chart;
}
async function assurerPdf() {
  if (window.jspdf && window.jspdf.jsPDF) return true;
  try {
    await chargerScript(CDN.jspdf);
    await chargerScript(CDN.autotable);   // le plugin s'accroche à jsPDF : il vient APRÈS
  } catch (e) { console.warn('[jspdf]', e.message); }
  return !!(window.jspdf && window.jspdf.jsPDF);
}
// Les exports PDF partent d'un clic, hors du cycle de rendu : on réutilise la
// barre de chargement existante pour que l'attente du téléchargement se voie.
async function avecBarre(travail) {
  const bar = document.getElementById('loadbar');
  if (bar) bar.classList.add('on');
  try { return await travail(); }
  finally { if (bar) bar.classList.remove('on'); }
}

/* Relit l'année scolaire ouverte (réglage partagé). Par défaut : la première. */
async function chargerAnnee({ replacer = true } = {}) {
  let a = MIN_YM.y;
  try { a = Number((await STORE.getReglages()).annee_scolaire) || MIN_YM.y; }
  catch (e) { console.warn('[annee]', e && e.message); }
  ANNEE = Math.max(MIN_YM.y, a);
  /* Au démarrage et à l'ouverture d'une année, on se place sur l'année ouverte :
   * conserver l'année précédemment affichée paraissait plus courtois, mais au
   * démarrage cette valeur vaut encore la première année, et l'application
   * s'ouvrait alors sur une année close sans que personne l'ait demandé.
   * En revanche, sur une simple mise à jour temps réel (`replacer: false`), on
   * ne déplace personne : quelqu'un qui consulte une année passée doit y
   * rester. On corrige seulement une année devenue impossible. */
  if (replacer || ANNEE_VUE > ANNEE || ANNEE_VUE < MIN_YM.y) ANNEE_VUE = ANNEE;
  clampMonth();
}

/* ---------------- Calculs mensuels + solde reporté ---------------- */
// Solde de départ d'une employée : les heures supplémentaires (ou à récupérer)
// accumulées AVANT la mise en service du programme. Saisi une seule fois par
// l'administratrice, il sert de point de départ au tout premier mois.
async function openingMinutes(empId, annee) {
  const p = (await STORE.listProfiles()).find((x) => x.id === empId);
  if (!p) return 0;
  // Première année : le solde saisi une fois par l'administration.
  // Années suivantes : le solde reporté au moment d'ouvrir l'année.
  if (annee === MIN_YM.y) return Number(p.opening_minutes) || 0;
  return Number((p.soldes || {})[String(annee)]) || 0;
}
async function monthSummary(empId, y, m) {
  const annee = anneeScolaireDe(y, m);
  // Début de l'année scolaire du mois demandé : le cumul repart de là, sur le
  // solde reporté. Les prestations des années précédentes sont déjà comprises
  // dans ce solde — les recompter ferait double emploi.
  const depart = debutAnnee(annee) > MIN_ISO ? debutAnnee(annee) : MIN_ISO;
  const all = await STORE.entriesForEmployee(empId);
  const firstOfMonth = `${y}-${pad(m)}-01`;
  let planned = 0, worked = 0, carryIn = await openingMinutes(empId, annee);
  all.forEach((e) => {
    const w = effectiveWorked(e), p = plannedMinutes(e);
    if (e.entry_date < depart) return;
    if (e.entry_date < firstOfMonth) carryIn += (w - p);
    else if (e.entry_date.startsWith(`${y}-${pad(m)}`)) { planned += p; worked += w; }
  });
  const delta = worked - planned;
  return { planned, worked, delta, carryIn, closing: carryIn + delta };
}

/* ================================================================
 * Démarrage
 * ================================================================ */
async function boot() {
  const created = await createStore();
  STORE = created.store; MODE = created.mode;
  await chargerAnnee();
  const vEl = document.getElementById('appVersion');
  if (vEl) vEl.textContent = APP_VERSION;
  document.getElementById('modeBadge').textContent = MODE === 'firebase' ? '🔥 Firebase' : '🧪 Démo (local)';
  document.getElementById('modeBadge').className = 'badge ' + (MODE === 'firebase' ? 'validated' : 'pending');

  // Temps réel : re-rendu groupé (debounce) pour éviter les rendus en rafale,
  // et jamais pendant une saisie active (sinon on volerait le focus du champ).
  STORE.onChange(debounce(async () => {
    if (!ME) return;
    const ae = document.activeElement;
    if (ae && /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(ae.tagName) && ae.closest('#app')) return;
    /* L'année scolaire ouverte peut avoir changé depuis le chargement : sans
     * cette relecture, une éducatrice dont l'onglet restait ouvert ne voyait
     * jamais l'année que l'administration venait d'ouvrir — il fallait
     * recharger la page. La lecture est mémorisée, elle ne coûte un aller-retour
     * que si le réglage a réellement changé. */
    await chargerAnnee({ replacer: false });
    render();
  }, 800));

  ME = await STORE.getCurrentUser();
  if (ME) await afterLogin(); else renderLogin();
}

async function afterLogin() {
  if (ME.role === 'employee') SEL_EMP = ME.id;
  else {
    const profs = await STORE.listProfiles();
    const firstEmp = profs.find((p) => p.role === 'employee' && p.active);
    SEL_EMP = firstEmp ? firstEmp.id : ME.id;
  }
  VIEW = 'sheet';
  document.body.dataset.role = ME.role;   // thème couleur : admin=bleu, employée=vert
  const loginEl = document.getElementById('login');
  loginEl.style.display = 'none';
  loginEl.innerHTML = '';   // retire le champ mot de passe du DOM (sinon le mobile propose de l'enregistrer en boucle)
  document.getElementById('appShell').style.display = 'block';
  document.getElementById('meName').textContent = ME.full_name + (ME.role === 'admin' ? ' (Admin)' : '');
  // Bouton de sauvegarde rapide dans l'entête (accessible partout) — admin uniquement.
  const backupBtn = document.getElementById('backupBtn');
  if (ME.role === 'admin') { backupBtn.style.display = ''; backupBtn.onclick = () => backupJSON(); }
  else { backupBtn.style.display = 'none'; }
  startIdleTimer();   // déconnexion auto après 15 min d'inactivité
  buildNav();
  render();
}

/* ---------------- Connexion ---------------- */
function renderLogin() {
  document.getElementById('appShell').style.display = 'none';
  const el = document.getElementById('login');
  el.style.display = 'flex';
  document.body.removeAttribute('data-role');
  el.innerHTML = `
    <div class="card login-card">
      <img src="assets/logo.png" onerror="this.onerror=null;this.src='assets/logo.svg'" alt="Jardin Sauvage" class="logo-login" />
      <h1>EDD Jardin Sauvage</h1>
      <p class="muted">Gestion des horaires, prestations et présences</p>
      <label for="email">Email</label>
      <input id="email" type="email" autocomplete="username" value="${MODE === 'demo' ? 'admin@ecole.be' : ''}" placeholder="votre email" />
      <label for="pwd">Mot de passe</label>
      <input id="pwd" type="password" autocomplete="current-password" value="${MODE === 'demo' ? 'admin123' : ''}" placeholder="votre mot de passe" />
      <div id="loginMsg"></div>
      <button class="big" id="loginBtn">Se connecter</button>
      <p class="center" style="margin-top:10px"><a href="#" id="forgotLink" class="muted small">Mot de passe oublié ?</a></p>
      ${MODE === 'demo' ? `<p class="muted small" style="margin-top:6px">
        Mode démo — comptes de test :<br>
        admin@ecole.be / admin123 · flora@ecole.be / flora123 · sarah@ecole.be / sarah123</p>` : ''}
      <p class="muted small" style="margin-top:14px">${APP_VERSION}</p>
    </div>`;
  const loginMsg = (html, kind = 'error') => {
    document.getElementById('loginMsg').innerHTML = `<div class="msg ${kind}">${html}</div>`;
  };
  // Message informatif après une déconnexion automatique pour inactivité.
  try {
    if (sessionStorage.getItem('autoLogout')) {
      sessionStorage.removeItem('autoLogout');
      loginMsg('Vous avez été déconnecté après 15 minutes d\'inactivité. Reconnectez-vous.', 'ok');
    }
  } catch {}
  const go = async () => {
    try {
      ME = await STORE.signIn(document.getElementById('email').value.trim(), document.getElementById('pwd').value);
      await afterLogin();
    } catch (e) { loginMsg(e.message); }
  };
  document.getElementById('loginBtn').onclick = go;
  document.getElementById('pwd').onkeydown = (e) => { if (e.key === 'Enter') go(); };
  document.getElementById('forgotLink').onclick = async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value.trim();
    if (!email) { loginMsg('Entrez d\'abord votre email, puis cliquez sur « Mot de passe oublié ».'); return; }
    if (!isCloud()) { loginMsg('La réinitialisation par email est disponible en mode cloud uniquement.'); return; }
    try {
      await STORE.sendPasswordReset(email);
      loginMsg('Un email de réinitialisation a été envoyé à ' + email + ' (pensez à vérifier les spams).', 'ok');
    } catch (err) { loginMsg(err.message); }
  };
}

/* ---------------- Navigation ---------------- */
function buildNav() {
  // L'onglet Statistiques reste réservé à l'administration tant qu'il n'est pas finalisé.
  const items = ME.role === 'admin'
    ? [['sheet', '📅 Feuille du mois'], ['recap', '📊 Récapitulatif'], ['children', '🧒 Enfants'],
       ['stats', '📈 Statistiques'], ['employees', '👥 Utilisateurs']]
    : [['sheet', '📅 Ma feuille'], ['recap', '📊 Mon récap'], ['children', '🧒 Enfants']];
  document.getElementById('nav').innerHTML = items.map(
    ([v, l]) => `<button class="navbtn ${v === VIEW ? 'active' : ''}" data-v="${v}">${l}</button>`).join('');
  document.querySelectorAll('.navbtn').forEach((b) => b.onclick = () => { VIEW = b.dataset.v; buildNav(); render(); });
}

/* ---------------- Barre de sélection mois / employée ---------------- */
async function toolbar(showEmployee, actionHTML) {
  let empSel = '';
  if (showEmployee && ME.role === 'admin') {
    const profs = (await STORE.listProfiles()).filter((p) => p.role === 'employee');
    empSel = `<select id="empSel">${profs.map((p) =>
      `<option value="${p.id}" ${p.id === SEL_EMP ? 'selected' : ''}>${echapper(p.full_name)}${p.active ? '' : ' (archivée)'}</option>`).join('')}</select>`;
  }
  const now = new Date();
  const onCurrentMonth = CUR.y === now.getFullYear() && CUR.m === now.getMonth() + 1;
  const bas = borneBasse(), haut = borneHaute();
  /* Sélecteur d'année scolaire : n'apparaît QUE s'il existe une année passée.
   * Tant qu'il n'y en a qu'une, il n'aurait rien à proposer et encombrerait la
   * barre — les années passées se consultent « en cas de besoin ». */
  let anneeSel = '';
  if (ANNEE > MIN_YM.y) {
    const options = [];
    for (let a = ANNEE; a >= MIN_YM.y; a--) {
      options.push(`<option value="${a}" ${a === ANNEE_VUE ? 'selected' : ''}>${libelleAnnee(a)}${a < ANNEE ? ' (close)' : ''}</option>`);
    }
    anneeSel = `<select id="anneeSel" title="Année scolaire">${options.join('')}</select>`;
  }
  return `<div class="toolbar">
    <button class="small" id="prevM" ${atOrBeforeMin() ? `disabled title="${monthName(bas.y, bas.m)} = premier mois de l'année"` : ''}>◀</button>
    <strong style="min-width:170px;text-align:center;text-transform:capitalize">${monthName(CUR.y, CUR.m)}</strong>
    <button class="small" id="nextM" ${atOrAfterMax() ? `disabled title="${monthName(haut.y, haut.m)} = dernier mois de l'année"` : ''}>▶</button>
    <button class="small gray" id="todayM" ${onCurrentMonth ? 'disabled' : ''} title="Aller au mois en cours">📅 Aujourd'hui</button>
    ${anneeSel}
    ${empSel}
    <span style="flex:1"></span>
    ${actionHTML || ''}
  </div>
  ${anneeClose() ? `<div class="msg" style="margin:0 0 12px">📁 Année scolaire <strong>${libelleAnnee(ANNEE_VUE)}</strong> — close, en consultation.
     ${ME.role === 'admin' ? "Vous pouvez encore la corriger ; les employées n'y ont plus accès en écriture."
                           : 'Cette année n\'est plus modifiable. Contactez l\'administration si une correction est nécessaire.'}</div>` : ''}
  ${(!anneeClose() && anneeAEcheance()) ? `<div class="msg error" style="margin:0 0 12px">📅 L'année scolaire <strong>${libelleAnnee(ANNEE)}</strong> est terminée depuis le ${finAnnee(ANNEE)}.
     ${ME.role === 'admin' ? "Ouvrez l'année suivante dans l'onglet 👥 <strong>Utilisateurs</strong> pour continuer à encoder."
                           : "L'administration doit ouvrir la nouvelle année avant de pouvoir encoder au-delà."}</div>` : ''}`;
}
function wireToolbar() {
  const p = document.getElementById('prevM'), n = document.getElementById('nextM'),
        t = document.getElementById('todayM'), s = document.getElementById('empSel');
  if (p) p.onclick = () => { if (atOrBeforeMin()) return; CUR.m--; if (CUR.m < 1) { CUR.m = 12; CUR.y--; } clampMonth(); render(); };
  if (n) n.onclick = () => { if (atOrAfterMax()) return; CUR.m++; if (CUR.m > 12) { CUR.m = 1; CUR.y++; } clampMonth(); render(); };
  if (t) t.onclick = () => {
    // « Aujourd'hui » ramène aussi sur l'année ouverte : sinon, depuis une année
    // close, le mois courant serait hors bornes et aussitôt ramené à juillet.
    ANNEE_VUE = ANNEE;
    const d = new Date(); CUR.y = d.getFullYear(); CUR.m = d.getMonth() + 1; clampMonth(); render();
  };
  if (s) s.onchange = () => { SEL_EMP = s.value; render(); };
  const a = document.getElementById('anneeSel');
  if (a) a.onchange = () => {
    ANNEE_VUE = Number(a.value);
    // On se place en août, premier mois de l'année choisie.
    CUR.y = ANNEE_VUE; CUR.m = 8; clampMonth(); render();
  };
}

/* ================================================================
 * Rendu principal (avec filet de sécurité : jamais d'écran blanc)
 * ================================================================ */
async function render() {
  const map = { sheet: viewSheet, recap: viewRecap, children: viewChildren, stats: viewStats, employees: viewEmployees };
  // Libère le graphique avant tout nouveau rendu (il sera recréé par viewStats si besoin) :
  // évite d'accumuler des instances Chart.js orphelines en mémoire.
  if (CHART) { try { CHART.destroy(); } catch {} CHART = null; }
  // Remet à zéro les gestionnaires délégués : chaque vue pose les siens, sinon
  // celui de la feuille resterait actif sous l'onglet Enfants.
  const appEl = document.getElementById('app');
  if (appEl) {
    appEl.onchange = null; appEl.onclick = null;
    // Seul l'onglet Enfants s'élargit : il doit afficher les 31 jours du mois.
    appEl.classList.toggle('wide', VIEW === 'children');
  }
  wireLazyTimes();
  const bar = document.getElementById('loadbar');
  if (bar) bar.classList.add('on');
  try {
    await (map[VIEW] || viewSheet)();
  } catch (e) {
    console.error('[render:' + VIEW + ']', e);
    showFatal(e && e.message ? e.message : String(e));
  } finally {
    if (bar) bar.classList.remove('on');
  }
}

function showFatal(msg) {
  /* `#app` est à l'intérieur de `#appShell`, masqué tant qu'on n'est pas
   * connecté : une erreur au démarrage s'écrivait donc dans un conteneur
   * INVISIBLE, et l'utilisatrice ne voyait qu'une page blanche. On bascule sur
   * l'écran de connexion, lui toujours affichable, dans ce cas. */
  const shell = document.getElementById('appShell');
  const visible = shell && shell.style.display !== 'none';
  const contenu = `<div class="card">
    <div class="msg error"><strong>Une erreur est survenue.</strong><br>${echapper(msg)}</div>
    <p class="muted small">Vos données sont en sécurité. Réessayez, ou rechargez l'application.</p>
    <button onclick="location.reload()">Recharger</button>
  </div>`;
  if (visible) { document.getElementById('app').innerHTML = contenu; return; }
  const login = document.getElementById('login');
  if (login) { login.style.display = 'flex'; login.innerHTML = `<div class="login-card">${contenu}</div>`; }
}

/* Écran dédié quand l'application ne peut pas joindre le serveur au démarrage.
 * Distinct d'une erreur : il n'y a rien à réparer, il faut du réseau. */
function showHorsLigne() {
  const shell = document.getElementById('appShell');
  if (shell) shell.style.display = 'none';
  const login = document.getElementById('login');
  if (!login) return;
  login.style.display = 'flex';
  login.innerHTML = `
    <div class="card login-card">
      <img src="assets/logo.png" onerror="this.onerror=null;this.src='assets/logo.svg'" alt="Jardin Sauvage" class="logo-login" />
      <h1>Connexion Internet requise</h1>
      <p class="muted">Les horaires et les présences sont enregistrés sur le serveur.
        L'application a besoin d'une connexion pour les lire et les enregistrer.</p>
      <div class="msg error" style="margin-top:14px">Aucune connexion détectée.</div>
      <p class="muted small">Vérifiez le wifi ou les données mobiles, puis réessayez.
        Rien n'est perdu : aucune saisie n'est conservée sur l'appareil.</p>
      <button class="big" id="retryBtn">Réessayer</button>
      <p class="muted small" style="margin-top:14px">${APP_VERSION}</p>
    </div>`;
  const b = document.getElementById('retryBtn');
  if (b) b.onclick = () => location.reload();
}

/* ---------------- Vue : Feuille mensuelle (type Excel) ---------------- */
async function viewSheet() {
  const app = document.getElementById('app');
  const empId = SEL_EMP;
  /* Ces quatre lectures ne dependent pas les unes des autres : les enchainer
   * faisait payer quatre allers-retours reseau (100-300 ms chacun) la ou un
   * seul suffit. Groupees, l'onglet s'ouvre en une attente au lieu de quatre. */
  const [month, entries, tpl, editableProf] = await Promise.all([
    STORE.getMonth(empId, CUR.y, CUR.m),
    STORE.entriesForMonth(empId, CUR.y, CUR.m),
    ME.role === 'admin' ? STORE.getTemplate(empId) : Promise.resolve({}),
    currentEmpProfile(empId),
  ]);

  // Pré-remplissage automatique : mois OUVERT + vide + un horaire type existe.
  // (Les mois validés ne sont jamais touchés.) Garde anti-réentrance.
  // Verrou : on ne tente le pré-remplissage qu'UNE fois par mois, par employée et
  // par session. Indispensable : sinon un échec d'écriture (règle serveur, quota,
  // réseau coupé) laisserait le mois vide, et le `render()` de fin relancerait
  // aussitôt viewSheet → pré-remplissage → render()… en boucle, jusqu'à figer
  // l'appareil. Le pré-encodage des présences enfants a la même protection.
  const sheetKey = `${empId}|${CUR.y}-${pad(CUR.m)}`;
  if (ME.role === 'admin' && month.status === 'open' && !anneeClose() && entries.length === 0 && templateHasSlots(tpl)
      && !APPLYING && !PREFILLED_SHEETS.has(sheetKey)) {
    PREFILLED_SHEETS.add(sheetKey);   // marqué comme tenté AVANT l'écriture (anti-boucle)
    APPLYING = true;
    try { await applyTemplate(empId, CUR.y, CUR.m, tpl, true); }
    catch (e) { console.error('[auto-prefill]', e); toast('Pré-remplissage impossible : ' + e.message, 'error'); }
    finally { APPLYING = false; }
    return render();
  }

  const byDate = {}; entries.forEach((e) => (byDate[e.entry_date] = e));
  const dim = daysInMonth(CUR.y, CUR.m);

  /* L'administration garde la main sur une année close (correction d'après
   * coup) ; les employées n'y écrivent plus, comme sur un mois validé. */
  const canEditPlanned = ME.role === 'admin';
  const monthEditable = month.status === 'open' && !anneeClose();
  const canEditWorked = ME.role === 'admin' || (empId === ME.id && monthEditable && editableProf.active);

  const statusBadge = { open: '<span class="badge open">En cours</span>',
    validated: '<span class="badge validated">✓ Validé</span>' }[month.status];

  let rows = '';
  let warnings = 0;
  for (let d = 1; d <= dim; d++) {
    const date = `${CUR.y}-${pad(CUR.m)}-${pad(d)}`;
    const dow = new Date(CUR.y, CUR.m - 1, d).getDay();
    const e = byDate[date] || { planned_start: '', planned_end: '', start_time: '', end_time: '', worked_touched: false, justification: '' };
    const planned = plannedMinutes(e);
    const worked = effectiveWorked(e);
    const delta = worked - planned;
    const modified = !!e.worked_touched;
    const needJustif = delta !== 0 && !e.justification;
    if (needJustif) warnings++;
    // Valeurs réelles affichées : par défaut = prévu (pré-remplissage) si non modifié.
    const realStart = e.start_time || (!modified ? (e.planned_start || '') : '');
    const realEnd = e.end_time || (!modified ? (e.planned_end || '') : '');
    const cls = [(dow === 0 || dow === 6) ? 'weekend' : '', modified ? 'modified' : ''].filter(Boolean).join(' ');
    rows += `<tr${cls ? ` class="${cls}"` : ''}>
      <td class="nowrap">${pad(d)}/${pad(CUR.m)}${modified ? ' <span class="dot" title="Jour modifié">●</span>' : ''}</td>
      <td>${DOW[dow]}</td>
      <td class="grp-plan">${timeSelect('planned_start', date, e.planned_start || '', !canEditPlanned)}</td>
      <td class="grp-plan">${timeSelect('planned_end', date, e.planned_end || '', !canEditPlanned)}</td>
      <td class="grp-real">${timeSelect('start_time', date, realStart, !canEditWorked)}</td>
      <td class="grp-real">${timeSelect('end_time', date, realEnd, !canEditWorked)}</td>
      <td class="nowrap"><strong>${worked ? fmtHM(worked) : '—'}</strong></td>
      <td class="${delta > 0 ? 'pos' : delta < 0 ? 'neg' : ''}">${fmtDelta(delta)}</td>
      <td><input class="cell wide ${needJustif ? 'err' : ''}" data-k="justification" data-date="${date}" value="${echapper(e.justification)}" ${canEditWorked ? '' : 'disabled'} placeholder="${needJustif ? 'Justification requise' : ''}"/></td>
    </tr>`;
  }

  const sum = await monthSummary(empId, CUR.y, CUR.m);
  let adminControls = '';
  if (ME.role === 'admin') {
    adminControls = `
      <button class="small" id="tplBtn">🗓️ Horaire type</button>
      <button class="small ${month.status === 'validated' ? 'gray' : 'green'}" id="validBtn">
        ${month.status === 'validated' ? '↩︎ Repasser en cours' : '✓ Valider le mois'}</button>`;
  }

  app.innerHTML = `${await toolbar(true)}
    ${ME.role === 'admin' ? templateCardHTML(tpl, month) : ''}
    <div class="card">
      <div class="row-between">
        <h2 style="margin:0">Feuille mensuelle ${statusBadge}</h2>
        <div>${adminControls} <button class="small" id="pdfBtn">🖨️ Export PDF</button></div>
      </div>
      <div class="msg error" id="warnBanner" ${warnings ? '' : 'style="display:none"'}>${warnings} jour(s) avec un écart non justifié.</div>
      ${!monthEditable && empId === ME.id && ME.role === 'employee'
        ? '<div class="msg">Ce mois est validé : vous ne pouvez plus le modifier. Contactez l\'administrateur si besoin.</div>' : ''}
      <div class="table-wrap">
        <table class="grid" id="sheetTable">
          <thead>
            <tr>
              <th rowspan="2">Date</th><th rowspan="2">Jour</th>
              <th colspan="2" class="grp-plan-h">Horaire prévu (admin)</th>
              <th colspan="2" class="grp-real-h">Horaire réel</th>
              <th rowspan="2">Presté</th><th rowspan="2">Écart</th><th rowspan="2">Justification</th>
            </tr>
            <tr>
              <th class="grp-plan-h">Début</th><th class="grp-plan-h">Fin</th>
              <th class="grp-real-h">Début</th><th class="grp-real-h">Fin</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="stat-grid" style="margin-top:16px">
        <div class="stat"><div class="num" id="tPlanned">${fmtHM(sum.planned)}</div><div class="lbl">Total prévu</div></div>
        <div class="stat"><div class="num" id="tWorked">${fmtHM(sum.worked)}</div><div class="lbl">Total presté</div></div>
        <div class="stat"><div class="num ${sum.delta >= 0 ? 'pos' : 'neg'}" id="tDelta">${fmtDelta(sum.delta)}</div><div class="lbl">Écart du mois</div></div>
        <div class="stat"><div class="num" id="tCarry">${fmtHM(sum.carryIn)}</div><div class="lbl">Solde reporté</div></div>
        <div class="stat"><div class="num ${sum.closing >= 0 ? 'pos' : 'neg'}" id="tClosing">${fmtHM(sum.closing)}</div><div class="lbl">Solde cumulé</div></div>
      </div>
      <p class="muted small">
        <span class="legend"><span class="sw grp-plan-h"></span> Horaire prévu (défini par l'admin)</span>
        <span class="legend"><span class="sw grp-real-h"></span> Horaire réel (encodé par l'employée)</span>
        <span class="legend"><span class="dot">●</span> jour modifié</span>
        <span class="legend"><span class="pos">▲ vert = heures supplémentaires</span> / <span class="neg">▼ rouge = heures récupérées</span></span><br>
        Heures par tranches de 15 min. Enregistrement automatique.
      </p>
    </div>`;
  wireToolbar();

  if (ME.role === 'admin') wireTemplateCard(empId, month);

  // --- Mise à jour ciblée (sans reconstruire la table = fluide, focus préservé) ---
  const baseCarry = sum.carryIn;
  const setTile = (id, txt, positive) => {
    const el = document.getElementById(id); if (!el) return;
    el.textContent = txt;
    if (positive !== undefined) { el.classList.toggle('pos', positive); el.classList.toggle('neg', !positive); }
  };
  function refreshRow(tr, date) {
    const e = byDate[date] || {};
    const planned = plannedMinutes(e), worked = effectiveWorked(e), delta = worked - planned;
    const modified = !!e.worked_touched;
    const needJustif = delta !== 0 && !e.justification;
    const weekend = new Date(date.slice(0, 4), Number(date.slice(5, 7)) - 1, Number(date.slice(8))).getDay();
    tr.className = [(weekend === 0 || weekend === 6) ? 'weekend' : '', modified ? 'modified' : ''].filter(Boolean).join(' ');
    const [, mo, dd] = date.split('-');
    tr.children[0].innerHTML = `${dd}/${mo}${modified ? ' <span class="dot" title="Jour modifié">●</span>' : ''}`;
    tr.children[6].innerHTML = `<strong>${worked ? fmtHM(worked) : '—'}</strong>`;   // Presté
    const ec = tr.children[7];                                                       // Écart
    ec.textContent = fmtDelta(delta);
    ec.className = delta > 0 ? 'pos' : delta < 0 ? 'neg' : '';
    const jinp = tr.children[8].querySelector('input');                              // Justification
    if (jinp) { jinp.classList.toggle('err', needJustif); jinp.placeholder = needJustif ? 'Justification requise' : ''; }
  }
  function refreshTotals() {
    let P = 0, W = 0, warn = 0;
    for (let d = 1; d <= dim; d++) {
      const e = byDate[`${CUR.y}-${pad(CUR.m)}-${pad(d)}`]; if (!e) continue;
      const p = plannedMinutes(e), w = effectiveWorked(e); P += p; W += w;
      if ((w - p) !== 0 && !e.justification) warn++;
    }
    const delta = W - P, closing = baseCarry + delta;
    setTile('tPlanned', fmtHM(P)); setTile('tWorked', fmtHM(W));
    setTile('tDelta', fmtDelta(delta), delta >= 0); setTile('tCarry', fmtHM(baseCarry));
    setTile('tClosing', fmtHM(closing), closing >= 0);
    const wb = document.getElementById('warnBanner');
    if (wb) { wb.textContent = warn + ' jour(s) avec un écart non justifié.'; wb.style.display = warn ? '' : 'none'; }
  }
  const flashSaved = (el) => { el.classList.add('saved'); setTimeout(() => el.classList.remove('saved'), 700); };

  // Sauvegarde automatique des cellules (avec pré-remplissage et calcul début/fin).
  // Un SEUL écouteur délégué sur #app : attacher ~140 écouteurs à chaque rendu
  // coûtait cher pour rien (l'événement « change » remonte naturellement).
  app.onchange = async (ev) => {
    const el = ev.target;
    if (!el || !el.matches || !el.matches('input.cell, select.cell')) return;
    const date = el.dataset.date, k = el.dataset.k;
    const prev = byDate[date] || {};
    const patch = { employee_id: empId, entry_date: date };

    if (k === 'planned_start' || k === 'planned_end') {
      // L'admin définit l'horaire prévu (référence).
      const ps = k === 'planned_start' ? el.value : (prev.planned_start || '');
      const pe = k === 'planned_end' ? el.value : (prev.planned_end || '');
      patch.planned_start = ps; patch.planned_end = pe;
      const s = timeToMin(ps), f = timeToMin(pe);
      if (s != null && f != null && f <= s) {
        toast("L'heure de fin doit être après le début.", 'error');
        // Rien n'est enregistré : l'écran doit revenir à ce que contient la base,
        // sinon il affiche une heure que personne n'a jamais sauvegardée et
        // l'utilisatrice croit sa correction prise en compte.
        setTimeValue(el, prev[k] || '');
        return;
      }
      patch.planned_minutes = (s != null && f != null) ? Math.max(0, f - s) : 0;
      // Pré-remplissage : tant que l'employée n'a pas modifié, le réel suit le prévu.
      if (!prev.worked_touched) {
        patch.start_time = ps; patch.end_time = pe;
        patch.worked_minutes = patch.planned_minutes;
      }
    } else if (k === 'start_time' || k === 'end_time') {
      // L'employée (ou l'admin) modifie l'horaire réel.
      // On lit les DEUX sélecteurs réels de la ligne (ce qui est affiché).
      const tr = el.closest('tr');
      const start = tr.querySelector('[data-k="start_time"]').value;
      const end = tr.querySelector('[data-k="end_time"]').value;
      const s = timeToMin(start), f = timeToMin(end);
      if (s != null && f != null && f <= s) {
        toast("L'heure de fin doit être après le début.", 'error');
        setTimeValue(el, prev[k] || '');   // idem : l'écran suit la base
        return;
      }
      const bothEmpty = !start && !end;
      const differsFromPlanned = start !== (prev.planned_start || '') || end !== (prev.planned_end || '');
      if (bothEmpty || !differsFromPlanned) {
        // Réel effacé (--:--) ou identique au prévu → jour non « modifié » (retour au pré-rempli).
        patch.start_time = bothEmpty ? '' : start;
        patch.end_time = bothEmpty ? '' : end;
        patch.worked_touched = false;
        patch.worked_minutes = bothEmpty ? plannedMinutes(prev) : Math.max(0, (f || 0) - (s || 0));
      } else {
        patch.start_time = start; patch.end_time = end;
        patch.worked_touched = true;
        patch.worked_minutes = (s != null && f != null) ? Math.max(0, f - s) : 0;
      }
    } else if (k === 'justification') {
      patch.justification = el.value;
    }
    try {
      const saved = await STORE.upsertEntry(patch);
      byDate[date] = saved;                      // état local à jour
      const tr = el.closest('tr');
      // Si l'admin change le prévu d'un jour non modifié, refléter dans le réel affiché.
      if ((k === 'planned_start' || k === 'planned_end') && !saved.worked_touched) {
        setTimeValue(tr.querySelector('[data-k="start_time"]'), saved.start_time);
        setTimeValue(tr.querySelector('[data-k="end_time"]'), saved.end_time);
      }
      refreshRow(tr, date);
      refreshTotals();
      flashSaved(el);
    } catch (e) {
      console.error('[sheet:save]', e);
      toast('Enregistrement impossible : ' + e.message, 'error');
    }
  };

  if (ME.role === 'admin') {
    // Bascule validation : un mois validé n'est plus modifiable par l'employée
    // (seul l'admin peut encore intervenir). « Repasser en cours » réouvre.
    const vb = document.getElementById('validBtn');
    if (vb) vb.onclick = async () => {
      try {
        const next = month.status === 'validated' ? 'open' : 'validated';
        await STORE.setMonthStatus(empId, CUR.y, CUR.m, next);
        toast(next === 'validated' ? 'Mois validé' : 'Mois repassé en cours');
        render();
      } catch (e) { toast('Erreur : ' + e.message, 'error'); }
    };
  }
  document.getElementById('pdfBtn').onclick = () => avecBarre(() => exportSheetPDF(empId)).catch((e) => toast('Export impossible : ' + e.message, 'error'));
}

async function currentEmpProfile(id) {
  // Le nom de repli évite un plantage des exports PDF si la fiche a disparu
  // (compte supprimé dans la console Firebase, sauvegarde partielle restaurée).
  return (await STORE.listProfiles()).find((p) => p.id === id)
    || { active: true, full_name: 'Employée inconnue' };
}

/* ---------------- Horaire type (template hebdomadaire) ---------------- */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Lun..Dim
const DOW_FULL = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

function templateHasSlots(tpl) {
  return tpl && Object.values(tpl).some((s) => s && s.start && s.end);
}
function templateCardHTML(tpl, month) {
  const tin = (id, v) => `<select class="time" id="${id}" style="width:110px">${timeStubHTML(v || '')}</select>`;
  const rows = WEEK_ORDER.map((w) => {
    const s = (tpl && tpl[w]) || {};
    return `<tr>
      <td>${DOW_FULL[w]}</td>
      <td>${tin(`tpl_${w}_s`, s.start)}</td>
      <td>${tin(`tpl_${w}_e`, s.end)}</td>
    </tr>`;
  }).join('');
  return `<div class="card hidden" id="tplCard">
    <h3 style="margin-top:0">🗓️ Horaire type hebdomadaire</h3>
    <p class="muted small">Définis l'horaire habituel de cette employée. Il sert à
      <strong>pré-remplir automatiquement les nouveaux mois</strong>. Laisse « --:-- » pour un jour non travaillé.</p>
    <div class="table-wrap"><table class="grid" style="max-width:420px">
      <thead><tr><th>Jour</th><th>Début</th><th>Fin</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <div id="tplMsg"></div>
    <div style="margin-top:12px; display:flex; gap:10px; flex-wrap:wrap">
      <button id="tplSave">💾 Enregistrer l'horaire type</button>
      <button class="green" id="tplApply" ${month.status !== 'open' ? 'disabled title="Mois validé"' : ''}>
        ⤵️ Appliquer au mois affiché</button>
    </div>
    <p class="muted small" style="margin-top:8px">
      « Appliquer » remplit le mois courant avec cet horaire (les jours déjà modifiés gardent leur horaire réel).
      ${month.status !== 'open' ? '<strong>Ce mois est validé : il ne sera pas modifié.</strong>' : ''}</p>
  </div>`;
}
function wireTemplateCard(empId, month) {
  const btn = document.getElementById('tplBtn');
  if (btn) btn.onclick = () => document.getElementById('tplCard').classList.toggle('hidden');

  const save = document.getElementById('tplSave');
  if (save) save.onclick = async () => {
    const slots = {};
    for (const w of WEEK_ORDER) {
      const s = document.getElementById(`tpl_${w}_s`).value, e = document.getElementById(`tpl_${w}_e`).value;
      if (s && e) {
        if (timeToMin(e) <= timeToMin(s)) {
          document.getElementById('tplMsg').innerHTML = `<div class="msg error">${DOW_FULL[w]} : la fin doit être après le début.</div>`;
          return;
        }
        slots[w] = { start: s, end: e };
      }
    }
    try { await STORE.setTemplate(empId, slots); PREFILLED_SHEETS.clear(); toast('Horaire type enregistré'); render(); }
    catch (e) { document.getElementById('tplMsg').innerHTML = `<div class="msg error">${e.message}</div>`; }
  };

  const apply = document.getElementById('tplApply');
  if (apply) apply.onclick = async () => {
    if (month.status !== 'open') { toast('Mois validé — non modifié', 'error'); return; }
    const tpl = await STORE.getTemplate(empId);
    if (!templateHasSlots(tpl)) { toast("Définis d'abord un horaire type.", 'error'); return; }
    if (!confirm(`Appliquer l'horaire type à ${monthName(CUR.y, CUR.m)} ? Les jours déjà modifiés sont préservés.`)) return;
    try { await applyTemplate(empId, CUR.y, CUR.m, tpl, false); }
    catch (e) { toast("Application impossible : " + e.message, 'error'); }
  };
}

// Remplit un mois avec l'horaire type. Ne touche jamais un mois validé,
// ni l'horaire réel d'un jour déjà modifié (worked_touched).
async function applyTemplate(empId, y, m, slots, silent) {
  const month = await STORE.getMonth(empId, y, m);
  if (month.status !== 'open') { if (!silent) toast('Mois validé — non modifié', 'error'); return; }
  const existing = {};
  (await STORE.entriesForMonth(empId, y, m)).forEach((e) => (existing[e.entry_date] = e));
  const dim = daysInMonth(y, m);
  // On construit tous les jours à écrire puis on les envoie en UN SEUL lot (rapide, moins de latence).
  const patches = [];
  for (let d = 1; d <= dim; d++) {
    const w = new Date(y, m - 1, d).getDay();
    const slot = slots[w];
    if (!slot || !slot.start || !slot.end) continue; // jour non travaillé → ignoré
    const date = `${y}-${pad(m)}-${pad(d)}`;
    const dur = Math.max(0, timeToMin(slot.end) - timeToMin(slot.start));
    const ex = existing[date] || {};
    const patch = { employee_id: empId, entry_date: date, planned_start: slot.start, planned_end: slot.end, planned_minutes: dur };
    if (!ex.worked_touched) { patch.start_time = slot.start; patch.end_time = slot.end; patch.worked_minutes = dur; }
    patches.push(patch);
  }
  if (patches.length) await STORE.upsertEntries(patches);
  if (!silent) { toast('Horaire type appliqué au mois'); render(); }
}

/* ---------------- Vue : Récapitulatif (toutes employées pour l'admin) ---------------- */
async function viewRecap() {
  const app = document.getElementById('app');
  const profs = (await STORE.listProfiles()).filter((p) => ME.role === 'admin' ? p.role === 'employee' : p.id === ME.id);
  // Chargement des soldes EN PARALLÈLE (récap plus rapide que l'attente séquentielle).
  const data = await Promise.all(profs.map(async (p) => {
    // Le solde et le statut du mois sont independants : groupes eux aussi.
    const [s, mo] = await Promise.all([
      monthSummary(p.id, CUR.y, CUR.m),
      STORE.getMonth(p.id, CUR.y, CUR.m),
    ]);
    return { p, s, mo };
  }));
  const rows = data.map(({ p, s, mo }) => `<tr>
      <td>${echapper(p.full_name)}${p.active ? '' : ' <span class="badge open">archivée</span>'}</td>
      <td>${fmtHM(s.planned)}</td><td>${fmtHM(s.worked)}</td>
      <td class="${s.delta >= 0 ? 'pos' : 'neg'}">${fmtDelta(s.delta)}</td>
      <td>${fmtHM(s.carryIn)}</td>
      <td class="${s.closing >= 0 ? 'pos' : 'neg'}"><strong>${fmtDelta(s.closing)}</strong></td>
      <td>${{ open: 'En cours', validated: '✓ Validé' }[mo.status] || 'En cours'}</td>
    </tr>`).join('');
  const pdfBtn = ME.role === 'admin' ? '<button class="small" id="recapPdfBtn">🖨️ Export PDF récap</button>' : '';
  app.innerHTML = `${await toolbar(false)}
    <div class="card">
      <div class="row-between"><h2 style="margin:0">Récapitulatif — ${monthName(CUR.y, CUR.m)}</h2>${pdfBtn}</div>
      <div class="table-wrap"><table>
        <thead><tr><th>Employée</th><th>Prévu</th><th>Presté</th><th>Écart mois</th><th>Solde reporté</th><th>Solde cumulé</th><th>Statut</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <p class="muted small">Le solde cumulé = solde reporté + écart du mois. Un solde positif = heures supplémentaires ; négatif = heures à récupérer.</p>
    </div>`;
  wireToolbar();
  if (ME.role === 'admin') {
    const b = document.getElementById('recapPdfBtn');
    if (b) b.onclick = () => avecBarre(() => exportRecapPDF(data)).catch((e) => toast('Export impossible : ' + e.message, 'error'));
  }
}

/* ---------------- Vue : Enfants (liste nominative + présences) ---------------- */
async function viewChildren() {
  const app = document.getElementById('app');
  // Lectures independantes : groupees pour n'attendre qu'un aller-retour.
  // L'administration lit AUSSI les fiches archivees, pour pouvoir en réactiver
  // une retirée par erreur ; la grille, elle, ne montre que les enfants actifs.
  const [tousKids, att] = await Promise.all([
    STORE.listKids(ME.role === 'admin'),
    STORE.kidAttendanceForMonth(CUR.y, CUR.m),
  ]);
  const kids = tousKids.filter((k) => k.active !== false);
  const archives = tousKids.filter((k) => k.active === false);
  // Statut par (kid,date) : 'present' | 'absent'. Ancien enregistrement sans statut = présent.
  const stat = new Map();
  att.forEach((a) => stat.set(a.kid_id + '|' + a.entry_date, a.status === 'absent' ? 'absent' : 'present'));
  const getSt = (kid, date) => stat.get(kid + '|' + date);
  const dim = daysInMonth(CUR.y, CUR.m);
  const days = [];
  for (let d = 1; d <= dim; d++) {
    const dow = new Date(CUR.y, CUR.m - 1, d).getDay();
    days.push({ d, dow, date: `${CUR.y}-${pad(CUR.m)}-${pad(d)}`, weekend: dow === 0 || dow === 6 });
  }
  const isExpected = (kid, dow) => Array.isArray(kid.days) && kid.days.includes(dow);

  // Pré-encodage AUTOMATIQUE : pour le mois affiché (courant ou à venir), TOUS les
  // jours habituels de chaque enfant sont marqués « présent » s'ils ne sont pas déjà
  // notés (on n'écrase jamais une présence/absence saisie). L'éducatrice n'a plus
  // qu'à basculer les absences. Les mois passés ne sont pas remplis rétroactivement.
  //
  // Le pré-encodage n'a lieu qu'UNE SEULE FOIS par enfant et par mois, et cela est
  // MÉMORISÉ EN BASE (`kidPrefilledFor`). Sans cette mémoire, effacer une case
  // (3e état du cycle) supprime l'enregistrement, et une case effacée redevient
  // indiscernable d'une case jamais encodée : au chargement suivant le
  // pré-encodage la remettait à « présent », annulant la correction.
  const _now = new Date();
  const monthIsCurrentOrFuture = ymNum(CUR.y, CUR.m) >= ymNum(_now.getFullYear(), _now.getMonth() + 1);
  const prefillKey = `${CUR.y}-${pad(CUR.m)}`;
  // Verrou de session, en plus de la mémoire en base : sinon un échec d'écriture
  // (ou un retour temps réel) relancerait render() → pré-encodage → render()…
  // en boucle, saturant l'appareil.
  if (monthIsCurrentOrFuture && !anneeClose() && !APPLYING_KIDS && !PREFILLED_KIDS.has(prefillKey)) {
    PREFILLED_KIDS.add(prefillKey);   // marqué comme tenté AVANT l'écriture (anti-boucle)
    const dejaFait = new Set(await STORE.kidPrefilledFor(CUR.y, CUR.m));
    const aMarquer = kids.filter((k) => !dejaFait.has(k.id)).map((k) => k.id);
    const toWrite = [];
    kids.forEach((k) => {
      if (dejaFait.has(k.id)) return;               // mois déjà pré-encodé pour cet enfant
      days.forEach((day) => {
        if (day.date < KIDS_MIN_ISO) return;        // avant l'ouverture : aucun accueil
        if (!isExpected(k, day.dow)) return;
        if (stat.get(k.id + '|' + day.date)) return; // déjà présent/absent → on ne touche pas
        toWrite.push({ kid_id: k.id, entry_date: day.date, status: 'present' });
      });
    });
    if (aMarquer.length) {
      APPLYING_KIDS = true;
      // Les présences d'abord, le marqueur ensuite : si l'écriture échoue, le mois
      // n'est pas marqué et sera retenté à la prochaine session, jamais à demi-fait.
      try {
        if (toWrite.length) await STORE.setKidAttendances(toWrite);
        await STORE.markKidPrefilled(CUR.y, CUR.m, aMarquer);
      }
      catch (e) { console.error('[kids:auto-prefill]', e); }
      finally { APPLYING_KIDS = false; }
      if (toWrite.length) return render();   // redessine une seule fois avec les présences pré-encodées
    }
  }

  // Un enregistrement antérieur à l'ouverture ne compte nulle part.
  const compte = (kidId, date) => (date >= KIDS_MIN_ISO && getSt(kidId, date) === 'present') ? 1 : 0;
  const kidPresentCount = (kid) => days.reduce((n, day) => n + compte(kid.id, day.date), 0);
  const dayPresentCount = (day) => kids.reduce((n, k) => n + compte(k.id, day.date), 0);
  const totalPresent = days.reduce((s, day) => s + dayPresentCount(day), 0);

  // En-tête : numéro du jour au-dessus de son initiale. Le dimanche est mis en
  // évidence, c'est le repère qui permet de compter les semaines d'un coup d'œil.
  const headDays = days.map((day) =>
    `<th scope="col" class="daycol${day.weekend ? ' weekend' : ''}${day.dow === 0 ? ' dim' : ''}"><div class="dnum">${day.d}</div><div class="dini">${DOW[day.dow][0]}</div></th>`).join('');

  const kidLabel = (k) => `${k.last_name ? k.last_name.toUpperCase() + ' ' : ''}${k.first_name}`.trim();
  const cellHtml = (k, day) => {
    // Avant le premier jour d'accueil, la case est neutralisée : on ne peut rien
    // y cocher, et un éventuel enregistrement résiduel n'est pas affiché.
    if (day.date < KIDS_MIN_ISO) {
      return `<td class="daycell${day.weekend ? ' weekend' : ''}"><span class="presbtn pres-off"
        title="Aucun accueil avant le ${KIDS_MIN_LISIBLE}"></span></td>`;
    }
    const st = getSt(k.id, day.date);
    const expected = isExpected(k, day.dow);
    // Seuls les états SAISIS portent un symbole : ✓ vert, ✗ rouge. Une case non
    // définie reste vide — un tiret se confondait avec le ✓ d'un coup d'œil.
    const cls = st === 'present' ? 'pres-p' : st === 'absent' ? 'pres-a' : (expected ? 'pres-exp' : 'pres-v');
    const sym = st === 'present' ? '✓' : st === 'absent' ? '✗' : '';
    const lbl = `${kidLabel(k)} le ${day.d}/${pad(CUR.m)} : ${st === 'present' ? 'présent' : st === 'absent' ? 'absent' : 'non défini'}`;
    return `<td class="daycell${day.weekend ? ' weekend' : ''}"><button type="button" class="presbtn ${cls}" data-kid="${k.id}" data-date="${day.date}" title="Cliquer : présent → absent → non défini" aria-label="${echapper(lbl)}">${sym}</button></td>`;
  };
  const kidRows = kids.length ? kids.map((k) => {
    const cells = days.map((day) => cellHtml(k, day)).join('');
    const nom = kidLabel(k);
    const esc = echapper(nom);
    const habituels = (k.days || []).length
      ? `<div class="kidmeta">Habituels : ${(k.days || []).slice().sort().map((w) => DOW[w]).join(' ')}</div>` : '';
    const lignes = [k.grade, k.school].filter(Boolean)
      .map((t) => `<div class="kidmeta">${echapper(t)}</div>`).join('');
    return `<tr>
      <th scope="row" class="kidname">
        <div class="kidcell">
          <span class="avatar" style="background:${avatarColor(nom)}" aria-hidden="true">${echapper(initials(k))}</span>
          <div class="kidinfo">
            <div class="kidnom">${echapper(nom)}</div>
            ${lignes}${habituels}
          </div>
          ${ME.role === 'admin' ? `<div class="kidacts">
            <button class="iconbtn edit" data-editkid="${k.id}" aria-label="Modifier ${esc}" title="Modifier (nom, école, année, naissance, jours)">✏️</button>
            <button class="iconbtn del" data-arch="${k.id}" aria-label="Retirer ${esc} de la liste" title="Retirer de la liste">🗑️</button>
          </div>` : ''}
        </div>
      </th>
      ${cells}
      <td class="kidtot"><strong id="kidtot_${k.id}">${kidPresentCount(k)}</strong></td>
    </tr>`;
  }).join('') : `<tr><td colspan="${dim + 2}" class="muted" style="padding:16px">Aucun enfant. Cliquez sur « + Ajouter un enfant ».</td></tr>`;

  // Ligne des totaux, répétée en haut ET en bas de la grille : avec 12 enfants
  // et 31 colonnes, il faut pouvoir lire le total sans remonter jusqu'au pied.
  // Repérage par attribut (et non par id) puisque chaque total existe en double.
  const totalCells = () => days.map((day) =>
    `<td class="daycell${day.weekend ? ' weekend' : ''}"><strong data-daytot="${day.d}">${dayPresentCount(day)}</strong></td>`).join('');
  const totalRow = `<tr class="totrow"><th scope="row" class="kidname">Total présents / jour</th>
    ${totalCells()}<td class="kidtot"><strong data-grandtot>${totalPresent}</strong></td></tr>`;
  const dayCheckboxes = WEEK_ORDER.map((w) => `<label class="daychk"><input type="checkbox" class="kd" data-w="${w}"/> ${DOW[w]}</label>`).join(' ');

  const legende = `<span class="pres-leg"><span class="presbtn pres-p" aria-hidden="true">✓</span> Présent</span>
    <span class="pres-leg"><span class="presbtn pres-a" aria-hidden="true">✗</span> Absent</span>
    <span class="pres-leg"><span class="presbtn pres-v" aria-hidden="true"></span> Non défini</span>`;

  app.innerHTML = `${await toolbar(false, ME.role === 'admin'
      ? '<button id="kToggle" class="addkid">+ Ajouter un enfant</button>' : '')}
    <div class="card">
      <h2 style="margin:0 0 4px">🧒 Présences des enfants — ${monthName(CUR.y, CUR.m)}</h2>
      ${ME.role === 'admin' ? `
      <div class="card sub hidden" id="addKidCard">
        <div class="row" style="align-items:end">
          <div><label for="kFirst">Prénom</label><input id="kFirst" placeholder="Prénom"/></div>
          <div><label for="kLast">Nom</label><input id="kLast" placeholder="Nom"/></div>
          <div><label for="kSchool">École</label><select id="kSchool">${schoolOptions('')}</select></div>
          <div style="flex:0 0 130px"><label for="kGrade">Année</label><select id="kGrade">${gradeOptions('')}</select></div>
          <div><label for="kBirth">Naissance</label><input id="kBirth" type="date"/></div>
        </div>
        <div style="margin-top:8px"><label>Jours habituels de présence</label><div class="daychks">${dayCheckboxes}</div></div>
        <div id="kMsg"></div>
        <div style="margin-top:10px; display:flex; gap:10px; flex-wrap:wrap">
          <button id="kAdd">+ Ajouter</button>
          <button class="gray" id="kCancel">Annuler</button>
        </div>
      </div>
      <div class="card hidden" id="editKidCard" style="background:#fbf6ec; margin-top:12px">
        <h3 style="margin-top:0">✏️ Modifier la fiche de l'enfant</h3>
        <input type="hidden" id="eId"/>
        <div class="row" style="align-items:end; max-width:900px">
          <div><label for="eFirst">Prénom</label><input id="eFirst"/></div>
          <div><label for="eLast">Nom</label><input id="eLast"/></div>
          <div><label for="eSchool">École</label><select id="eSchool">${schoolOptions('')}</select></div>
          <div style="flex:0 0 110px"><label for="eGrade">Année</label><select id="eGrade">${gradeOptions('')}</select></div>
          <div><label for="eBirth">Naissance</label><input id="eBirth" type="date"/></div>
        </div>
        <div style="margin-top:6px"><label>Jours habituels de présence</label>
          <div class="daychks">${WEEK_ORDER.map((w) => `<label class="daychk"><input type="checkbox" class="ek" data-w="${w}"/> ${DOW[w]}</label>`).join(' ')}</div></div>
        <div id="eMsg"></div>
        <div style="margin-top:10px; display:flex; gap:10px; flex-wrap:wrap">
          <button class="green" id="eSave">💾 Enregistrer</button>
          <button class="gray" id="eCancel">Annuler</button>
        </div>
      </div>` : `
      <div class="msg">
        Vous encodez les <strong>présences</strong> ; les fiches des enfants (nom, école,
        année, date de naissance, jours habituels) sont gérées par l'administration.<br>
        <strong>En cas de changement de situation pour un enfant</strong>, soumettez la
        correction à un administrateur : <strong>${ADMINS_CONTACT}</strong>.
      </div>`}
      <div class="legbar">
        <div><span class="legtitle">Légende :</span> ${legende}</div>
        <p class="muted small" style="margin:0">Les jours habituels de chaque enfant sont
          <strong>pré-encodés « présent » automatiquement</strong>.</p>
      </div>
      <div class="table-wrap attend-wrap" style="margin-top:8px"><table class="attend">
        <caption class="sr-only">Présences et absences des enfants pour ${monthName(CUR.y, CUR.m)}.</caption>
        <thead>
          <tr><th scope="col" class="kidname">Enfant</th>${headDays}<th scope="col" class="kidtot">Prés.</th></tr>
          ${totalRow}
        </thead>
        <tbody>${kidRows}</tbody>
        <tfoot>${totalRow}</tfoot>
      </table></div>
      <div class="legbar foot">
        <div class="kidcount">👥 <strong>${kids.length}</strong> enfant${kids.length > 1 ? 's' : ''}</div>
        <div>${legende}</div>
      </div>
      ${ME.role === 'admin' && archives.length ? `
      <label class="daychk" style="margin-top:10px">
        <input type="checkbox" id="showArch"/> Afficher ${archives.length === 1 ? "l'enfant retiré" : `les ${archives.length} enfants retirés`} de la liste
      </label>
      <div id="archList" class="card sub hidden" style="margin-top:8px">
        <p class="muted small" style="margin-top:0">Ces fiches sont conservées ; leurs présences déjà encodées ne sont
          pas perdues. Réactiver une fiche la remet dans la grille ci-dessus.</p>
        ${archives.map((k) => `<div class="row" style="align-items:center; gap:10px; margin-top:6px">
          <span class="avatar" style="background:${avatarColor(kidLabel(k))}" aria-hidden="true">${echapper(initials(k))}</span>
          <span style="flex:1">${echapper(kidLabel(k))}${k.school ? ` <span class="muted small">— ${echapper(k.school)}</span>` : ''}</span>
          <button class="small green" data-reactkid="${k.id}">Réactiver</button>
        </div>`).join('')}
      </div>` : ''}
      <p class="muted small">« Prés. » = jours de présence de l'enfant ce mois-ci.${
        ME.role === 'admin' ? ' La moyenne annuelle est dans l\'onglet 📈 Statistiques.' : ''}</p>
    </div>`;
  wireToolbar();

  // Le formulaire d'ajout reste replié : la grille est ainsi lisible d'emblée.
  const addCard = document.getElementById('addKidCard');
  const kToggle = document.getElementById('kToggle');
  if (kToggle) kToggle.onclick = () => {
    addCard.classList.toggle('hidden');
    if (!addCard.classList.contains('hidden')) {
      document.getElementById('kFirst').focus();
      addCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  };
  const kCancel = document.getElementById('kCancel');
  if (kCancel) kCancel.onclick = () => addCard.classList.add('hidden');

  const readDays = () => [...app.querySelectorAll('input.kd:checked')].map((c) => Number(c.dataset.w));

  // Gestion des fiches : réservée à l'administration. Chez une employée, les
  // deux formulaires ne sont pas rendus du tout — rien à brancher ici.
  if (ME.role === 'admin') {
    // Ajout d'un enfant.
    document.getElementById('kAdd').onclick = async () => {
      const msg = document.getElementById('kMsg');
      try {
        await STORE.addKid(document.getElementById('kFirst').value, document.getElementById('kLast').value,
          document.getElementById('kSchool').value, document.getElementById('kBirth').value, readDays(),
          document.getElementById('kGrade').value);
        PREFILLED_KIDS.clear(); toast('Enfant ajouté'); render();
      } catch (e) { msg.innerHTML = `<div class="msg error">${e.message}</div>`; }
    };
    // Modifier un enfant : ouvre le formulaire pré-rempli (nom, école, naissance, jours).
    const editCard = document.getElementById('editKidCard');
    app.querySelectorAll('[data-editkid]').forEach((b) => b.onclick = () => {
      const k = kids.find((x) => x.id === b.dataset.editkid) || {};
      document.getElementById('eId').value = k.id || '';
      document.getElementById('eFirst').value = k.first_name || '';
      document.getElementById('eLast').value = k.last_name || '';
      document.getElementById('eSchool').innerHTML = schoolOptions(k.school || '');
      document.getElementById('eGrade').innerHTML = gradeOptions(k.grade || '');
      document.getElementById('eBirth').value = k.birthdate || '';
      const set = new Set(k.days || []);
      app.querySelectorAll('input.ek').forEach((c) => (c.checked = set.has(Number(c.dataset.w))));
      document.getElementById('eMsg').innerHTML = '';
      editCard.classList.remove('hidden');
      editCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    document.getElementById('eCancel').onclick = () => editCard.classList.add('hidden');
    document.getElementById('eSave').onclick = async () => {
      const id = document.getElementById('eId').value;
      const info = {
        first_name: document.getElementById('eFirst').value,
        last_name: document.getElementById('eLast').value,
        school: document.getElementById('eSchool').value,
        grade: document.getElementById('eGrade').value,
        birthdate: document.getElementById('eBirth').value,
        days: [...app.querySelectorAll('input.ek:checked')].map((c) => Number(c.dataset.w)),
      };
      // Si les jours habituels changent, le pré-encodage de cet enfant est à refaire ;
      // sinon (simple correction de nom) on garde sa mémoire, donc ses cases effacées.
      const avant = ((kids.find((x) => x.id === id) || {}).days || []).slice().sort().join(',');
      try {
        await STORE.setKidInfo(id, info);
        if (avant !== info.days.slice().sort().join(',')) await STORE.clearKidPrefill(id);
        PREFILLED_KIDS.clear(); toast('Fiche enfant modifiée'); render();
      }
      catch (e) { document.getElementById('eMsg').innerHTML = `<div class="msg error">${e.message}</div>`; }
    };
    // Retirer un enfant (archivage : données conservées).
    app.querySelectorAll('[data-arch]').forEach((b) => b.onclick = async () => {
      if (!confirm('Retirer cet enfant de la liste ? (ses présences passées restent comptées)')) return;
      try { await STORE.setKidActive(b.dataset.arch, false); toast('Enfant retiré'); render(); }
      catch (e) { toast('Erreur : ' + e.message, 'error'); }
    });
    // Remettre dans la liste un enfant retiré par erreur. Sans ce bouton, le
    // seul recours était de restaurer une sauvegarde ou d'éditer la base.
    const showArch = document.getElementById('showArch');
    if (showArch) showArch.onchange = () =>
      document.getElementById('archList').classList.toggle('hidden', !showArch.checked);
    app.querySelectorAll('[data-reactkid]').forEach((b) => b.onclick = async () => {
      try { await STORE.setKidActive(b.dataset.reactkid, true); toast('Enfant remis dans la liste'); render(); }
      catch (e) { toast('Erreur : ' + e.message, 'error'); }
    });
  }

  // Les totaux figurent en double (au-dessus et sous la grille) : on met donc à
  // jour TOUTES les cellules portant le repère, pas seulement la première.
  const setTotal = (sel, valeur) => app.querySelectorAll(sel).forEach((el) => (el.textContent = valeur));
  const setGrandTotal = () => setTotal('[data-grandtot]',
    days.reduce((s, day) => s + kids.reduce((n, k) => n + compte(k.id, day.date), 0), 0));
  // Cellule à 3 états : présent (✓) → absent (✗) → vide. Mise à jour ciblée.
  // Écouteur unique délégué : le tableau compte jusqu'à ~1 100 cases, leur
  // attacher un gestionnaire chacune ralentissait l'ouverture de l'onglet.
  app.onclick = async (ev) => {
    const el = ev.target && ev.target.closest ? ev.target.closest('button.presbtn') : null;
    if (!el) return;
    // Année close : lecture seule pour les employées, corrigeable par l'admin.
    if (anneeClose() && ME.role !== 'admin') {
      toast(`Année ${libelleAnnee(ANNEE_VUE)} close — encodage impossible.`, 'error');
      return;
    }
    const kid = el.dataset.kid, date = el.dataset.date, key = kid + '|' + date;
    const cur = stat.get(key);                              // 'present' | 'absent' | undefined
    const next = cur === 'present' ? 'absent' : cur === 'absent' ? null : 'present';
    if (next) stat.set(key, next); else stat.delete(key);
    // Rendu de la cellule.
    el.classList.remove('pres-p', 'pres-a', 'pres-exp', 'pres-v');   // 'pres-v' était oublié
    const day = days.find((d) => d.date === date);
    const kk = kids.find((k) => k.id === kid);
    // `day` peut manquer si un rendu concurrent (temps réel) a changé le mois
    // affiché entre l'affichage de la case et le clic : sans cette garde, le
    // clic levait une exception au lieu d'être simplement sans effet.
    const expected = !!(kk && day && isExpected(kk, day.dow));
    // Exactement la même règle qu'au rendu (voir `sym` / `cls` plus haut) : une
    // case non définie reste VIDE. Elle affichait « · » juste après le clic, puis
    // se vidait au rechargement — deux apparences pour le même état.
    el.textContent = next === 'present' ? '✓' : next === 'absent' ? '✗' : '';
    el.classList.add(next === 'present' ? 'pres-p' : next === 'absent' ? 'pres-a' : (expected ? 'pres-exp' : 'pres-v'));
    // Totaux en place.
    const kt = document.getElementById('kidtot_' + kid);
    if (kt) kt.textContent = days.reduce((n, d) => n + compte(kid, d.date), 0);
    // Le total du jour existe en double (en-tête et pied) : on met à jour les deux.
    setTotal(`[data-daytot="${Number(date.slice(8))}"]`,
      kids.reduce((n, k) => n + compte(k.id, date), 0));
    setGrandTotal();
    try { await STORE.setKidAttendance(kid, date, next); }
    catch (e) { if (cur) stat.set(key, cur); else stat.delete(key); toast('Erreur : ' + e.message, 'error'); render(); }
  };
}

/* ---------------- Vue : Statistiques (graphiques) ---------------- */
async function viewStats() {
  // Onglet retiré de la navigation des employées : on refuse aussi l'accès direct
  // (état résiduel, retour arrière du navigateur) plutôt que d'afficher la vue.
  if (ME.role !== 'admin') { VIEW = 'sheet'; buildNav(); return viewSheet(); }
  const app = document.getElementById('app');
  /* Les quatre lectures de cette vue sont independantes : on les groupe.
   * Les trois dernieres ne servent qu'aux criteres d'agrement (admin) ; pour
   * une non-admin on ne les demande pas — la garde ci-dessus rend ce cas
   * theorique, mais la vue ne doit jamais lire ce qu'elle n'affiche pas. */
  const estAdmin = ME.role === 'admin';
  /* Période couverte : l'année scolaire du mois affiché, bornée à la mise en
   * service d'un côté et à aujourd'hui de l'autre. */
  const ANNEE = anneeScolaireDe(CUR.y, CUR.m);
  const auj = todayISO();
  const debut = debutAnnee(ANNEE) > MIN_ISO ? debutAnnee(ANNEE) : MIN_ISO;
  const fin = finAnnee(ANNEE) < auj ? finAnnee(ANNEE) : auj;
  const [all, kidsAll, attAnnee, prestationsAnnee] = await Promise.all([
    STORE.allChildrenEntre(debut, fin),
    estAdmin ? STORE.listKids(true) : Promise.resolve([]),
    estAdmin ? STORE.kidAttendanceEntre(debut, fin) : Promise.resolve([]),
    estAdmin ? STORE.allEntriesEntre(debut, fin) : Promise.resolve([]),
  ]);
  // Rien avant le premier jour d'accueil : sinon des jours d'ouverture fictifs
  // (issus d'un pré-encodage antérieur) tireraient la moyenne vers le bas.
  // Rien après aujourd'hui non plus : le pré-encodage des présences et le
  // pré-remplissage des prestations portent sur le MOIS ENTIER, jours à venir
  // compris. Sans cette borne, les statistiques et les critères d'agrément
  // comptaient des journées qui n'ont pas encore eu lieu — une prévision
  // présentée comme un constat.
  const inYear = all.filter((c) => c.entry_date >= KIDS_MIN_ISO && c.entry_date <= auj);
  const annualTotal = inYear.reduce((s, c) => s + (Number(c.children) || 0), 0);
  const dailyYear = inYear.length ? annualTotal / inYear.length : 0;

  // Détail mois par mois, dans l'ordre SCOLAIRE (août → juillet).
  // Le suivi commence avec la mise en service : pas de mois vides avant.
  const months = moisAnnee(ANNEE)
    .filter(({ y, m }) => ymNum(y, m) >= ymNum(MIN_YM.y, MIN_YM.m))
    .map(({ y, m }) => {
      const arr = inYear.filter((c) => c.entry_date.startsWith(`${y}-${pad(m)}`));
      const tot = arr.reduce((s, c) => s + (Number(c.children) || 0), 0);
      const d = new Date(y, m - 1, 1);
      return {
        short: d.toLocaleDateString('fr-FR', { month: 'short' }),
        long: d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }),
        days: arr.length, total: tot, avg: arr.length ? tot / arr.length : 0,
      };
    });
  const stats = { dailyYear, annualTotal, annualDays: inYear.length,
                  annee: libelleAnnee(ANNEE), debut, fin, months };

  /* ---- Critères d'agrément (public accueilli + ouverture) ----
   * Le calcul lit les prestations de TOUTES les employées : il est réservé à
   * l'administration. La vue est déjà refusée aux employées plus haut, donc
   * cette garde n'est jamais fausse aujourd'hui — elle est CONSERVÉE À DESSEIN :
   * c'est le dernier verrou avant une lecture de données cloisonnées, et il
   * doit survivre à une modification de la navigation. */
  let crit = null;
  if (ME.role === 'admin') {
  const kidById = {}; kidsAll.forEach((k) => (kidById[k.id] = k));
  const att = attAnnee.filter((a) => (a.entry_date || '') >= KIDS_MIN_ISO);
  // Par jour d'ouverture : nombre d'enfants présents âgés de 6 à 15 ans.
  const byDay = {};
  att.forEach((a) => {
    if (a.status === 'absent') return; // les absences ne comptent pas comme présence
    const k = kidById[a.kid_id]; if (!k) return;
    (byDay[a.entry_date] = byDay[a.entry_date] || { total: 0, eligible: 0 }).total++;
    const age = ageAt(k.birthdate, a.entry_date);
    if (age == null || (age >= 6 && age <= 15)) byDay[a.entry_date].eligible++;
  });
  const openDays = Object.keys(byDay);
  const avgEligible = openDays.length
    ? openDays.reduce((s, d) => s + byDay[d].eligible, 0) / openDays.length : 0;
  // Écoles représentées parmi les enfants présents cette année.
  const presentKidIds = new Set(att.filter((a) => a.status !== 'absent').map((a) => a.kid_id));
  const schoolsPresent = new Set();
  presentKidIds.forEach((id) => { const s = (kidById[id] || {}).school; if (s) schoolsPresent.add(s); });
  const missingSchools = REQUIRED_SCHOOLS.filter((s) => !schoolsPresent.has(s));
  // Semaines d'ouverture : semaines ISO avec ≥ 2h de prestation (heures d'ouverture).
  const entriesYear = prestationsAnnee;   // déjà borné à la période par la lecture
  const weekMinutes = {};
  entriesYear.forEach((e) => {
    const w = effectiveWorked(e); if (!w) return;
    const key = isoWeekKey(e.entry_date); weekMinutes[key] = (weekMinutes[key] || 0) + w;
  });
  const openWeeks = Object.values(weekMinutes).filter((min) => min >= 120).length;
  const kidsNoBirth = kidsAll.filter((k) => k.active && !k.birthdate).length;
  const kidsNoSchool = kidsAll.filter((k) => k.active && !k.school).length;

  crit = [
    { ok: avgEligible >= 8,
      label: 'Au moins 8 enfants de 6 à 15 ans par jour (moyenne annuelle)',
      val: `${avgEligible.toFixed(1)} enfant(s)/jour`,
      note: kidsNoBirth ? `${kidsNoBirth} enfant(s) sans date de naissance (comptés par défaut)` : '' },
    { ok: missingSchools.length === 0,
      label: 'Enfants d’au moins deux implantations (Saint-Remacle et ARAHF)',
      val: schoolsPresent.size ? [...schoolsPresent].join(', ') : 'aucune renseignée',
      note: missingSchools.length ? `manque : ${missingSchools.join(', ')}` : (kidsNoSchool ? `${kidsNoSchool} enfant(s) sans école` : '') },
    { ok: openWeeks >= 20,
      label: 'Ouvert ≥ 2 h/semaine sur au moins 20 semaines',
      val: `${openWeeks} semaine(s) ≥ 2 h`,
      note: '' },
  ];
  }
  stats.crit = crit;   // le PDF doit contenir tout ce que l'écran affiche

  app.innerHTML = `${await toolbar(false)}
    <div class="card">
      <div class="row-between">
        <h2 style="margin:0">📈 Statistiques — année scolaire ${libelleAnnee(ANNEE)}</h2>
        <button class="small" id="statsPdfBtn">🖨️ Export PDF</button>
      </div>
      <div class="hero-stat">
        <div class="big">${dailyYear.toFixed(1)}</div>
        <div class="lbl2">enfants en moyenne <strong>par jour</strong> sur l'année scolaire ${libelleAnnee(ANNEE)}</div>
        <div class="muted small">${annualTotal} enfants encodés · ${inYear.length} jour(s) avec encodage</div>
      </div>
      ${crit ? `<h3 style="margin-top:20px">✅ Critères d'agrément — ${libelleAnnee(ANNEE)}</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>Critère</th><th>Situation</th><th>État</th></tr></thead>
        <tbody>${crit.map((c) => `<tr>
          <td>${c.label}</td>
          <td>${echapper(c.val)}${c.note ? `<br><span class="muted small">${echapper(c.note)}</span>` : ''}</td>
          <td class="nowrap ${c.ok ? 'pos' : 'neg'}">${c.ok ? '✔ atteint' : '✘ non atteint'}</td>
        </tr>`).join('')}</tbody>
      </table></div>
      <p class="muted small" style="margin-top:8px">Renseignez l'<strong>école</strong> et la <strong>date de naissance</strong> de chaque enfant (onglet 🧒 Enfants) pour un calcul exact.</p>` : ''}
      <h3 class="muted" style="margin-top:22px">Moyenne d'enfants par jour, mois par mois</h3>
      <canvas id="chartMonthly" height="130"></canvas>
      <div class="table-wrap" style="margin-top:14px"><table>
        <thead><tr><th>Mois</th><th>Moyenne / jour</th><th>Total</th><th>Jours</th></tr></thead>
        <tbody>${months.map((m) => `<tr>
          <td style="text-transform:capitalize">${m.long}</td>
          <td><strong>${m.avg ? m.avg.toFixed(1) : '—'}</strong></td>
          <td>${m.total || '—'}</td><td>${m.days || '—'}</td></tr>`).join('')}</tbody>
      </table></div>
      <p class="muted small" style="margin-top:10px">Encodez les présences dans l'onglet 🧒 <strong>Enfants</strong> ; la moyenne annuelle se met à jour automatiquement.</p>
    </div>`;
  wireToolbar();

  if (!(await assurerChart())) {
    const c = document.getElementById('chartMonthly');
    if (c) c.replaceWith(Object.assign(document.createElement('p'), { className: 'muted small', textContent: 'Graphique indisponible hors ligne — voir le tableau ci-dessous.' }));
    document.getElementById('statsPdfBtn').onclick = () => avecBarre(() => exportStatsPDF(stats, null)).catch((e) => toast('Export impossible : ' + e.message, 'error'));
    return;
  }
  if (CHART) { try { CHART.destroy(); } catch {} }   // libère le graphique précédent (évite une fuite mémoire)
  CHART = new Chart(document.getElementById('chartMonthly'), {
    type: 'bar',
    data: { labels: months.map((m) => m.short), datasets: [{ label: 'Moyenne/jour', data: months.map((m) => +m.avg.toFixed(1)), backgroundColor: '#2f9e44' }] },
    options: { animation: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
  });
  const chartMonthly = CHART;
  document.getElementById('statsPdfBtn').onclick = () => avecBarre(() => exportStatsPDF(stats, chartMonthly)).catch((e) => toast('Export impossible : ' + e.message, 'error'));
}

/* ---------------- Export PDF des statistiques de l'année scolaire ----------------
 * Le PDF doit contenir TOUT ce que l'onglet Statistiques affiche : c'est lui
 * qui part dans le dossier d'agrément, et il ne doit rien laisser à retrouver
 * à l'écran. Dans l'ordre : la moyenne d'enfants par jour, les critères
 * d'agrément avec leur état, le graphique mensuel, puis le tableau mois par
 * mois. Une page est ajoutée dès que la suivante ne tient plus. */
async function exportStatsPDF(stats, chartMonthly) {
  const titre = "Statistiques de fréquentation";
  const sousTitre = `Année scolaire ${stats.annee}`;
  const lignesMois = stats.months.map((m) => [
    m.long.charAt(0).toUpperCase() + m.long.slice(1),
    m.avg ? m.avg.toFixed(1) : '—',
    m.total || '—',
    m.days || '—',
  ]);

  // Repli impression si jsPDF reste indisponible (hors ligne).
  if (!(await assurerPdf())) {
    const w = window.open('', '_blank');
    if (!w) { toast("Impression bloquée par le navigateur. Autorisez les fenêtres surgissantes pour ce site.", 'error'); return; }
    const tableau = (entetes, lignes) =>
      `<table border=1 cellpadding=5 style="border-collapse:collapse">
        <tr>${entetes.map((h) => `<th>${h}</th>`).join('')}</tr>
        ${lignes.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}
      </table>`;
    w.document.write(`<img src="assets/logo.svg" style="height:60px">
      <h2>${titre} — ${sousTitre}</h2>
      <ul>
        <li>Moyenne d'enfants par jour : <b>${stats.dailyYear.toFixed(1)}</b></li>
        <li>Total d'enfants encodés : <b>${stats.annualTotal}</b> sur ${stats.annualDays} jour(s)</li>
        <li>Période : du ${stats.debut} au ${stats.fin}</li>
      </ul>
      ${stats.crit ? `<h3>Critères d'agrément</h3>${tableau(['Critère', 'Situation', 'État'],
        stats.crit.map((c) => [c.label, c.val + (c.note ? ' — ' + c.note : ''), c.ok ? 'atteint' : 'non atteint']))}` : ''}
      ${chartMonthly ? `<h3>Moyenne d'enfants par jour, mois par mois</h3><img src="${chartMonthly.toBase64Image()}" style="max-width:100%"/>` : ''}
      <h3>Détail mensuel</h3>${tableau(['Mois', 'Moyenne / jour', 'Total', 'Jours'], lignesMois)}
      <button onclick="print()">Imprimer</button>`);
    w.document.close(); return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const BLEU = [59, 91, 219];
  const BAS = doc.internal.pageSize.getHeight() - 18;
  let y = await pdfHeader(doc, titre, sousTitre);

  // Saut de page dès que le bloc suivant ne tient plus.
  const place = (hauteur) => { if (y + hauteur > BAS) { doc.addPage(); y = 20; } };
  const sousTitreBloc = (texte) => {
    place(14);
    doc.setTextColor(0); doc.setFontSize(12);
    doc.text(texte, 14, y); y += 6;
  };

  // 1. Synthèse de l'année.
  doc.autoTable({
    startY: y,
    head: [[`Fréquentation — année scolaire ${stats.annee}`, 'Valeur']],
    body: [
      ["Moyenne d'enfants par jour", stats.dailyYear.toFixed(1) + ' enfants'],
      ["Total d'enfants encodés", stats.annualTotal + ' enfants'],
      ['Jours avec encodage', String(stats.annualDays)],
      ['Période prise en compte', `du ${stats.debut} au ${stats.fin}`],
    ].map((r) => r.map(pourPdf)),
    styles: { fontSize: 11 }, headStyles: { fillColor: BLEU },
  });
  y = doc.lastAutoTable.finalY + 10;

  // 2. Critères d'agrément — la raison d'être du document.
  if (stats.crit && stats.crit.length) {
    sousTitreBloc("Critères d'agrément");
    doc.autoTable({
      startY: y,
      head: [['Critère', 'Situation', 'État']],
      body: lignesPdf(stats.crit.map((c) => [
        c.label,
        c.val + (c.note ? '\n' + c.note : ''),
        c.ok ? 'atteint' : 'non atteint',
      ])),
      styles: { fontSize: 9, cellPadding: 3 },
      columnStyles: { 0: { cellWidth: 78 }, 2: { cellWidth: 26, halign: 'center' } },
      headStyles: { fillColor: BLEU },
      // Vert si le critère est atteint, rouge sinon : lisible d'un coup d'œil.
      didParseCell: (data) => {
        if (data.section !== 'body' || data.column.index !== 2) return;
        const ok = data.cell.raw === 'atteint';
        data.cell.styles.textColor = ok ? [47, 122, 62] : [190, 50, 40];
        data.cell.styles.fontStyle = 'bold';
      },
    });
    y = doc.lastAutoTable.finalY + 10;
  }

  // 3. Graphique mensuel.
  if (chartMonthly) {
    const hauteur = 180 * 0.42;
    place(hauteur + 14);
    sousTitreBloc("Moyenne d'enfants par jour, mois par mois");
    doc.addImage(chartMonthly.toBase64Image('image/png', 1), 'PNG', 14, y, 180, hauteur);
    y += hauteur + 10;
  }

  // 4. Détail mensuel chiffré, sous le graphique.
  sousTitreBloc('Détail mensuel');
  doc.autoTable({
    startY: y,
    head: [['Mois', 'Moyenne / jour', 'Total', 'Jours encodés']],
    body: lignesPdf(lignesMois),
    styles: { fontSize: 10 },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
    headStyles: { fillColor: BLEU },
  });

  doc.save(`statistiques_${stats.annee}.pdf`);
}

/* ---------------- Vue : Utilisateurs (admin) ---------------- */
async function viewEmployees() {
  const app = document.getElementById('app');
  const profs = await STORE.listProfiles();
  const nbAdmins = profs.filter((p) => p.role === 'admin' && p.active).length;
  const rows = profs.map((p) => {
    const activeBtn = p.role === 'employee'
      ? (p.active ? `<button class="small red" data-arch="${p.id}">Archiver</button>`
                  : `<button class="small green" data-react="${p.id}">Réactiver</button>`)
      : '';
    // Sélecteur de rôle. On empêche de retirer le dernier administrateur (sinon
    // plus personne ne pourrait gérer les utilisateurs).
    const isLastAdmin = p.role === 'admin' && nbAdmins <= 1;
    const roleSel = `<select class="rolesel" data-role="${p.id}" ${isLastAdmin ? 'disabled title="Dernier administrateur"' : ''}>
        <option value="employee" ${p.role === 'employee' ? 'selected' : ''}>Employée</option>
        <option value="admin" ${p.role === 'admin' ? 'selected' : ''}>Administrateur</option>
      </select>`;
    // Solde de départ : uniquement pour les employées (un admin ne preste pas d'heures suivies ici).
    const soldeCell = p.role === 'employee'
      ? `<td class="nowrap"><input class="opening" data-open="${p.id}" style="width:96px;text-align:center"
           value="${p.opening_minutes ? fmtDelta(p.opening_minutes) : ''}" placeholder="0h00"
           aria-label="Solde de départ de ${echapper(p.full_name)}" /></td>`
      : '<td class="muted">—</td>';
    return `<tr>
      <td class="nowrap">${echapper(p.full_name)} <button class="small gray" data-name="${p.id}" title="Modifier le nom" aria-label="Modifier le nom de ${echapper(p.full_name)}">✏️</button></td>
      <td class="nowrap">${p.email ? echapper(p.email) : '—'} <button class="small gray" data-email="${p.id}" title="Modifier l'email" aria-label="Modifier l'email de ${echapper(p.full_name)}">✏️</button></td>
      <td>${roleSel}</td>
      ${soldeCell}
      <td>${p.active ? '<span class="badge validated">Actif</span>' : '<span class="badge refused">Archivé</span>'}</td>
      <td class="nowrap">
        <button class="small" data-reset="${p.id}">✉️ Réinit. mot de passe</button>
        ${activeBtn}
      </td>
    </tr>`;
  }).join('');
  // Aperçu du report : ce que chaque employée emporterait dans la nouvelle année.
  const emps = profs.filter((x) => x.role === 'employee' && x.active);
  const soldesFin = await Promise.all(emps.map(async (x) => ({
    p: x, cloture: (await monthSummary(x.id, ANNEE + 1, 7)).closing,
  })));

  app.innerHTML = `<div class="card">
      <div class="row-between">
        <h2 style="margin:0">📅 Année scolaire ${libelleAnnee(ANNEE)}</h2>
        <button class="small green" id="nouvelleAnnee">Ouvrir l'année ${libelleAnnee(ANNEE + 1)}</button>
      </div>
      <p class="muted small" style="margin-top:8px">
        L'encodage est ouvert du <strong>1<sup>er</sup> août ${ANNEE}</strong> au <strong>31 juillet ${ANNEE + 1}</strong>.
        ${ANNEE > MIN_YM.y ? `Les années précédentes restent consultables via le sélecteur d'année, en lecture seule pour les employées.` : ''}
      </p>
      ${anneeAEcheance() ? `<div class="msg error">Cette année scolaire est terminée depuis le ${finAnnee(ANNEE)}.
        Ouvrez la suivante pour continuer à encoder.</div>` : ''}
      <div class="table-wrap"><table>
        <thead><tr><th>Employée</th><th>Solde au 31 juillet ${ANNEE + 1}</th></tr></thead>
        <tbody>${soldesFin.map(({ p, cloture }) => `<tr>
          <td>${echapper(p.full_name)}</td>
          <td class="${cloture >= 0 ? 'pos' : 'neg'}"><strong>${fmtDelta(cloture)}</strong></td>
        </tr>`).join('') || '<tr><td colspan="2" class="muted">Aucune employée active.</td></tr>'}</tbody>
      </table></div>
      <p class="muted small" style="margin-top:8px">
        À l'ouverture de la nouvelle année, ces soldes deviennent le <strong>solde de départ</strong> du 1<sup>er</sup> août ${ANNEE + 1} :
        rien ne se perd. Les enfants et leurs jours habituels sont conservés — vous retirerez ceux qui partent
        et ajouterez les nouveaux. L'année ${libelleAnnee(ANNEE)} passe alors en lecture seule pour les employées ;
        vous pourrez encore la corriger.
      </p>
    </div>
    <div class="card">
      <div class="row-between"><h2>👥 Utilisateurs</h2><button class="small" id="addBtn">+ Ajouter un utilisateur</button></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Nom</th><th>Email</th><th>Rôle</th>
          <th title="Heures supplémentaires (ou à récupérer) au 1er août 2026">Solde de départ</th>
          <th>Statut</th><th>Actions</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <div class="msg">
        <strong>Solde de départ</strong> — heures supplémentaires (ou à récupérer) de chaque employée
        <strong>au 1<sup>er</sup> août 2026</strong>, reprises de votre ancien suivi.
        À saisir <strong>une seule fois</strong> : ensuite le programme cumule tout seul.
        Formats acceptés : <code>12h30</code>, <code>12:30</code>, <code>12</code>, et
        <code>-3h15</code> pour des heures à récupérer.
      </div>
      <p class="muted small">
        Le <strong>rôle</strong> se change directement dans la liste (le dernier administrateur ne peut pas être rétrogradé).
        « ✏️ » modifie le nom ou l'email ; « ✉️ » envoie un email de réinitialisation du mot de passe.
        Archiver conserve les données en lecture seule.
        ${isCloud() ? "L'email modifié sert de contact/réinitialisation." : ''}
      </p>
    </div>
    <div class="card hidden" id="addForm">
      <h3>Nouvel utilisateur</h3>
      <div class="row">
        <div><label for="nName">Nom complet</label><input id="nName" placeholder="Prénom Nom"/></div>
        <div><label for="nEmail">Email</label><input id="nEmail" type="email" placeholder="prenom@ecole.be"/></div>
        <div><label for="nPwd">Mot de passe initial</label><input id="nPwd" placeholder="au moins 6 caractères"/></div>
      </div>
      <div id="addMsg"></div>
      <p class="muted small">Les nouveaux comptes sont créés comme <strong>Employée</strong> ; vous pourrez ensuite changer leur rôle dans la liste.
        ${MODE === 'firebase' ? 'La création ne vous déconnecte pas.' : ''}</p>
      <button id="saveEmp" style="margin-top:10px">Créer</button>
    </div>
    <div class="card" id="dataCard">
      <h2>🗄️ Données</h2>
      <p class="muted small">Sauvegardez régulièrement vos données : c'est votre protection
        en cas de perte ou de fausse manipulation.</p>
      <h3 style="margin-bottom:6px">Sauvegarde / export</h3>
      <div class="row" style="flex-wrap:wrap; gap:10px">
        <button class="small" id="expJson">⬇️ Exporter tout (JSON)</button>
        <button class="small" id="expCsvPresta">⬇️ CSV prestations</button>
        <button class="small" id="expCsvKids">⬇️ CSV présences enfants</button>
      </div>
      <h3 style="margin:16px 0 6px">Restauration</h3>
      <p class="muted small" style="margin-top:0">Réimporte une sauvegarde <strong>JSON</strong>. ${isCloud()
        ? `Le contenu de la sauvegarde est <strong>réinjecté par-dessus</strong> les données actuelles : ce qui existait
           déjà est écrasé, mais <strong>ce qui a été ajouté depuis la sauvegarde n'est pas supprimé</strong>.
           Les comptes de connexion ne sont pas modifiés.`
        : `Les données existantes sont <strong>remplacées</strong>.`} Faites d'abord un export.</p>
      <div class="row" style="flex-wrap:wrap; gap:10px">
        <input id="impFile" type="file" accept="application/json,.json" aria-label="Fichier de sauvegarde JSON à restaurer" style="max-width:100%"/>
        <button class="small red" id="impBtn">⬆️ Restaurer</button>
      </div>
    </div>`;

  /* Ouverture d'une nouvelle année scolaire.
   * Les soldes sont écrits AVANT de changer l'année : si l'écriture échoue en
   * cours de route, l'année reste ouverte et l'opération est simplement à
   * refaire — jamais une année neuve avec des soldes manquants. */
  const nouvelle = document.getElementById('nouvelleAnnee');
  if (nouvelle) nouvelle.onclick = async () => {
    const suivante = ANNEE + 1;
    const detail = soldesFin.map(({ p, cloture }) => `  · ${p.full_name} : ${fmtDelta(cloture)}`).join('\n');
    if (!confirm(
      `Ouvrir l'année scolaire ${libelleAnnee(suivante)} ?\n\n`
      + `Soldes reportés au 1er août ${suivante} :\n${detail || '  (aucune employée active)'}\n\n`
      + `Les enfants et leurs jours habituels sont conservés.\n`
      + `L'année ${libelleAnnee(ANNEE)} passera en lecture seule pour les employées ; `
      + `vous pourrez encore la corriger.`)) return;
    nouvelle.disabled = true;
    try {
      for (const { p, cloture } of soldesFin) await STORE.setSoldeAnnee(p.id, suivante, cloture);
      await STORE.setAnneeScolaire(suivante);
      CUR.y = ANNEE + 1; CUR.m = 8;   // on se place en août de la nouvelle année
      await chargerAnnee();
      PREFILLED_KIDS.clear(); PREFILLED_SHEETS.clear();
      toast(`Année ${libelleAnnee(ANNEE)} ouverte`);
      render();
    } catch (e) {
      console.error('[nouvelle-annee]', e);
      nouvelle.disabled = false;
      toast("Ouverture impossible : " + e.message, 'error');
    }
  };

  document.getElementById('addBtn').onclick = () => document.getElementById('addForm').classList.toggle('hidden');
  document.getElementById('saveEmp').onclick = async () => {
    const msg = document.getElementById('addMsg');
    try {
      const full_name = document.getElementById('nName').value.trim();
      const email = document.getElementById('nEmail').value.trim();
      const password = document.getElementById('nPwd').value;
      if (!full_name || !email || password.length < 6) {
        msg.innerHTML = '<div class="msg error">Nom, email et mot de passe (6+ caractères) requis.</div>'; return;
      }
      await STORE.addProfile({ full_name, email, password, role: 'employee' }); // rôle toujours employée
      toast('Employée ajoutée'); render();
    } catch (e) { msg.innerHTML = `<div class="msg error">${e.message}</div>`; }
  };
  app.querySelectorAll('[data-name]').forEach((b) => b.onclick = async () => {
    const p = profs.find((x) => x.id === b.dataset.name) || {};
    const name = prompt('Nom complet (Prénom Nom) :', p.full_name || '');
    if (name == null) return;
    try { await STORE.setFullName(b.dataset.name, name); toast('Nom mis à jour'); render(); }
    catch (e) { toast('Erreur : ' + e.message, 'error'); }
  });
  app.querySelectorAll('select.rolesel').forEach((s) => s.onchange = async () => {
    const p = profs.find((x) => x.id === s.dataset.role) || {};
    const role = s.value, label = role === 'admin' ? 'administrateur' : 'employée';
    if (!confirm(`Changer le rôle de ${p.full_name} en « ${label} » ?`)) { s.value = p.role; return; }
    try { await STORE.setRole(s.dataset.role, role); toast('Rôle mis à jour'); render(); }
    catch (e) { s.value = p.role; toast('Erreur : ' + e.message, 'error'); }
  });
  // Solde de départ : enregistré à la sortie du champ (ou sur Entrée).
  app.querySelectorAll('input.opening').forEach((inp) => {
    const p = profs.find((x) => x.id === inp.dataset.open) || {};
    const initial = p.opening_minutes || 0;
    const enregistrer = async () => {
      const minutes = parseHM(inp.value);
      if (minutes === null) {
        toast('Solde non compris. Écrivez par exemple 12h30, ou -3h15.', 'error');
        inp.value = initial ? fmtDelta(initial) : '';
        inp.focus();
        return;
      }
      if (minutes === initial) { inp.value = minutes ? fmtDelta(minutes) : ''; return; }
      try {
        await STORE.setOpeningMinutes(inp.dataset.open, minutes);
        toast(`Solde de départ de ${p.full_name} : ${fmtDelta(minutes)}`);
        render();
      } catch (e) {
        inp.value = initial ? fmtDelta(initial) : '';
        toast('Erreur : ' + e.message, 'error');
      }
    };
    inp.onchange = enregistrer;
    inp.onkeydown = (ev) => { if (ev.key === 'Enter') inp.blur(); };
  });
  app.querySelectorAll('[data-email]').forEach((b) => b.onclick = async () => {
    const p = profs.find((x) => x.id === b.dataset.email) || {};
    const email = prompt(`Nouvel email pour ${p.full_name} :`, p.email || '');
    if (email == null) return;
    try { await STORE.setEmail(b.dataset.email, email); toast('Email mis à jour'); render(); }
    catch (e) { toast('Erreur : ' + e.message, 'error'); }
  });
  app.querySelectorAll('[data-reset]').forEach((b) => b.onclick = async () => {
    const p = profs.find((x) => x.id === b.dataset.reset) || {};
    if (!p.email) { toast("Cet utilisateur n'a pas d'email.", 'error'); return; }
    if (!isCloud()) { toast("Envoi d'email disponible uniquement en mode cloud.", 'error'); return; }
    if (!confirm(`Envoyer un email de réinitialisation à ${p.email} ?`)) return;
    try { await STORE.sendPasswordReset(p.email); toast('Email de réinitialisation envoyé à ' + p.email); }
    catch (e) { toast('Erreur : ' + e.message, 'error'); }
  });
  app.querySelectorAll('[data-arch]').forEach((b) => b.onclick = async () => {
    try { if (confirm('Archiver cette employée ? Ses données restent consultables.')) { await STORE.setActive(b.dataset.arch, false); toast('Employée archivée'); render(); } }
    catch (e) { toast('Erreur : ' + e.message, 'error'); }
  });
  app.querySelectorAll('[data-react]').forEach((b) => b.onclick = async () => {
    try { await STORE.setActive(b.dataset.react, true); toast('Employée réactivée'); render(); }
    catch (e) { toast('Erreur : ' + e.message, 'error'); }
  });

  // --- Données & confidentialité (export / restauration / rétention) ---
  document.getElementById('expJson').onclick = () => backupJSON();
  document.getElementById('impBtn').onclick = async () => {
    const f = document.getElementById('impFile').files[0];
    if (!f) { toast('Choisissez d\'abord un fichier de sauvegarde.', 'error'); return; }
    // Le message doit décrire le comportement RÉEL, qui diffère selon le mode :
    // remplacement en mode démo, réinjection par-dessus (fusion) en mode cloud.
    if (!confirm(isCloud()
      ? "Restaurer cette sauvegarde ?\n\nSon contenu sera réinjecté par-dessus les données actuelles.\nCe qui a été ajouté depuis la sauvegarde NE SERA PAS supprimé."
      : 'Restaurer cette sauvegarde ? Les données actuelles seront REMPLACÉES.')) return;
    try {
      const parsed = JSON.parse(await f.text());
      const counts = await STORE.importAll(parsed);
      const n = Object.values(counts).reduce((a, b) => a + b, 0);
      toast(`Sauvegarde restaurée (${n} enregistrement(s)).`); render();
    } catch (e) { toast('Restauration impossible : ' + e.message, 'error'); }
  };
  document.getElementById('expCsvPresta').onclick = async () => {
    try {
      const data = await STORE.exportAll();
      const nameById = {}; (data.profiles || []).forEach((p) => (nameById[p.id] = p.full_name));
      const rows = [['Employée', 'Date', 'Prévu début', 'Prévu fin', 'Réel début', 'Réel fin', 'Presté (min)', 'Écart (min)', 'Justification']];
      (data.day_entries || [])
        .slice().sort((a, b) => (a.entry_date + a.employee_id).localeCompare(b.entry_date + b.employee_id))
        .forEach((e) => {
          const p = plannedMinutes(e), w = effectiveWorked(e);
          rows.push([nameById[e.employee_id] || e.employee_id, e.entry_date,
            e.planned_start || '', e.planned_end || '', e.start_time || '', e.end_time || '',
            w, w - p, e.justification || '']);
        });
      downloadFile(`prestations_${todayISO()}.csv`, toCSV(rows), 'text/csv;charset=utf-8');
      toast('CSV prestations téléchargé');
    } catch (e) { toast('Export impossible : ' + e.message, 'error'); }
  };
  document.getElementById('expCsvKids').onclick = async () => {
    try {
      const data = await STORE.exportAll();
      const kidById = {}; (data.kids || []).forEach((k) => (kidById[k.id] = k));
      const rows = [['Nom', 'Prénom', 'Date de présence']];
      (data.kid_attendance || [])
        .slice().sort((a, b) => (a.entry_date + a.kid_id).localeCompare(b.entry_date + b.kid_id))
        .forEach((a) => {
          const k = kidById[a.kid_id] || {};
          rows.push([k.last_name || '', k.first_name || '', a.entry_date]);
        });
      downloadFile(`presences_enfants_${todayISO()}.csv`, toCSV(rows), 'text/csv;charset=utf-8');
      toast('CSV présences téléchargé');
    } catch (e) { toast('Export impossible : ' + e.message, 'error'); }
  };
}

/* ---------------- Logo pour les PDF (SVG → PNG dataURL, mis en cache) ---------------- */
let _logoCache;
function _loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}
async function logoDataURL() {
  if (_logoCache !== undefined) return _logoCache;
  // Utilise le vrai logo (assets/logo.png) s'il existe, sinon le SVG par défaut.
  const img = (await _loadImage('assets/logo.png')) || (await _loadImage('assets/logo.svg'));
  if (!img) { _logoCache = null; return null; }
  try {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth || 320; c.height = img.naturalHeight || 200;
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    _logoCache = { url: c.toDataURL('image/png'), w: c.width, h: c.height };
  } catch { _logoCache = null; }
  return _logoCache;
}
// En-tête commun des PDF : logo + titre.
/* Les polices standard de jsPDF n'écrivent qu'un jeu de caractères restreint :
 * l'apostrophe typographique « ’ » disparaissait purement et simplement
 * (« Enfants d’au moins » devenait « Enfants dau moins »), et « ≥ » ressortait
 * déformé. On normalise le texte À L'ENTRÉE DU PDF seulement — l'écran garde
 * sa typographie. */
const pourPdf = (v) => String(v == null ? '' : v)
  .replace(/[\u2018\u2019]/g, "'")
  .replace(/[\u201C\u201D]/g, '"')
  .replace(/\u2265/g, '>=').replace(/\u2264/g, '<=')
  .replace(/\u2212/g, '-').replace(/[\u2013\u2014]/g, '-')
  .replace(/\u2026/g, '...')
  .replace(/\u00A0/g, ' ');
// Normalise chaque cellule d'un tableau autoTable.
const lignesPdf = (lignes) => lignes.map((r) => r.map(pourPdf));

async function pdfHeader(doc, title, subtitle) {
  const logo = await logoDataURL();
  if (logo) { const h = 18, w = h * (logo.w / logo.h); doc.addImage(logo.url, 'PNG', 14, 10, w, h); }
  doc.setFontSize(16); doc.setTextColor(0); doc.text('EDD Jardin Sauvage', 14, 36);
  doc.setFontSize(13); doc.setTextColor(40); doc.text(title, 14, 44);
  if (subtitle) { doc.setFontSize(10); doc.setTextColor(110); doc.text(subtitle, 14, 50); }
  return 56; // ordonnée de départ pour la suite
}

/* ---------------- Export PDF : récapitulatif global (toutes les employées) ---------------- */
// `data` = [{ p, s, mo }] déjà calculé par viewRecap.
async function exportRecapPDF(data) {
  const title = 'Récapitulatif mensuel';
  const sub = monthName(CUR.y, CUR.m);
  const statusLbl = (st) => ({ open: 'En cours', validated: 'Validé' }[st] || 'En cours');
  const body = data.map(({ p, s, mo }) => [
    p.full_name + (p.active ? '' : ' (archivée)'),
    fmtHM(s.planned), fmtHM(s.worked), fmtDelta(s.delta), fmtHM(s.carryIn), fmtDelta(s.closing), statusLbl(mo.status),
  ]);

  if (!(await assurerPdf())) { // repli impression
    const w = window.open('', '_blank');
    if (!w) { toast("Impression bloquée par le navigateur. Autorisez les fenêtres surgissantes pour ce site.", 'error'); return; }
    w.document.write(`<img src="assets/logo.svg" style="height:60px"><h2>${title} — ${sub}</h2>
      <table border=1 cellpadding=5 style="border-collapse:collapse"><tr><th>Employée</th><th>Prévu</th><th>Presté</th><th>Écart</th><th>Reporté</th><th>Cumulé</th><th>Statut</th></tr>
      ${body.map((r) => '<tr>' + r.map((c) => `<td>${c}</td>`).join('') + '</tr>').join('')}</table>
      <button onclick="print()">Imprimer</button>`);
    w.document.close(); return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const startY = await pdfHeader(doc, title, sub);
  doc.autoTable({
    startY,
    head: [['Employée', 'Prévu', 'Presté', 'Écart mois', 'Solde reporté', 'Solde cumulé', 'Statut']],
    body: lignesPdf(body), styles: { fontSize: 10 }, headStyles: { fillColor: [59, 91, 219] },
  });
  doc.save(`recapitulatif_${CUR.y}-${pad(CUR.m)}.pdf`);
}

/* ---------------- Export PDF : fiche de prestations ---------------- */
async function exportSheetPDF(empId) {
  const prof = await currentEmpProfile(empId);
  const entries = await STORE.entriesForMonth(empId, CUR.y, CUR.m);
  const byDate = {}; entries.forEach((e) => (byDate[e.entry_date] = e));
  const dim = daysInMonth(CUR.y, CUR.m);
  const sum = await monthSummary(empId, CUR.y, CUR.m);
  const body = [];
  for (let d = 1; d <= dim; d++) {
    const date = `${CUR.y}-${pad(CUR.m)}-${pad(d)}`;
    const e = byDate[date]; if (!e) continue;
    const planned = plannedMinutes(e), worked = effectiveWorked(e);
    if (!planned && !worked) continue;
    body.push([`${pad(d)}/${pad(CUR.m)}`,
      e.planned_start || '—', e.planned_end || '—',
      e.start_time || '—', e.end_time || '—', fmtHM(worked),
      fmtHM(worked - planned), e.justification || '']);
  }

  if (!(await assurerPdf())) { // repli impression
    const w = window.open('', '_blank');
    if (!w) { toast("Impression bloquée par le navigateur. Autorisez les fenêtres surgissantes pour ce site.", 'error'); return; }
    w.document.write(`<img src="assets/logo.svg" style="height:60px"><h2>Prestations — ${prof.full_name} — ${monthName(CUR.y, CUR.m)}</h2>
      <table border=1 cellpadding=5 style="border-collapse:collapse"><tr><th>Date</th><th>Prévu début</th><th>Prévu fin</th><th>Réel début</th><th>Réel fin</th><th>Presté</th><th>Écart</th><th>Justif.</th></tr>
      ${body.map((r) => '<tr>' + r.map((c) => `<td>${c}</td>`).join('') + '</tr>').join('')}</table>
      <p><b>Total presté:</b> ${fmtHM(sum.worked)} — <b>Solde cumulé:</b> ${fmtHM(sum.closing)}</p>
      <button onclick="print()">Imprimer</button>`);
    w.document.close(); return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const startY = await pdfHeader(doc, `Prestations — ${prof.full_name}`, monthName(CUR.y, CUR.m));
  doc.autoTable({
    startY,
    head: [['Date', 'Prévu déb.', 'Prévu fin', 'Réel déb.', 'Réel fin', 'Presté', 'Écart', 'Justification']],
    body: lignesPdf(body), styles: { fontSize: 9 }, headStyles: { fillColor: [59, 91, 219] },
  });
  let y = doc.lastAutoTable.finalY + 10;
  doc.setFontSize(11); doc.setTextColor(0);
  doc.text(`Total prévu : ${fmtHM(sum.planned)}      Total presté : ${fmtHM(sum.worked)}`, 14, y);
  doc.text(`Écart du mois : ${fmtHM(sum.delta)}      Solde reporté : ${fmtHM(sum.carryIn)}      Solde cumulé : ${fmtHM(sum.closing)}`, 14, y + 7);
  doc.text('Signature employée : ______________        Signature responsable : ______________', 14, y + 24);
  doc.save(`prestations_${prof.full_name.replace(/\s/g, '_')}_${CUR.y}-${pad(CUR.m)}.pdf`);
}

/* ---------------- Déconnexion ---------------- */
async function doLogout(auto) {
  stopIdleTimer();
  try { await STORE.signOut(); } catch (e) { console.error('[logout]', e); }
  ME = null;
  if (auto) { try { sessionStorage.setItem('autoLogout', '1'); } catch {} }
  location.reload();
}

/* ---------------- Déconnexion automatique après inactivité ---------------- */
const IDLE_MINUTES = 15;
let _idleTimer = null, _idleLast = 0;
function resetIdleTimer() {
  if (!ME) return;
  // Throttle : au plus une réinitialisation toutes les 5 s (évite de recréer un
  // timer à chaque pixel de défilement/souris sur mobile).
  const now = Date.now();
  if (now - _idleLast < 5000) return;
  _idleLast = now;
  clearTimeout(_idleTimer);
  _idleTimer = setTimeout(() => doLogout(true), IDLE_MINUTES * 60 * 1000);
}
const IDLE_EVENTS = ['click', 'keydown', 'mousemove', 'touchstart', 'scroll', 'change'];
function startIdleTimer() {
  IDLE_EVENTS.forEach((ev) => window.addEventListener(ev, resetIdleTimer, { passive: true }));
  resetIdleTimer();
}
// Retire aussi les écouteurs : `stopIdleTimer` prétendait tout défaire alors
// qu'il ne coupait que le minuteur. Sans conséquence tant que la déconnexion
// recharge la page — mais c'est précisément ce sur quoi il ne faut pas compter.
function stopIdleTimer() {
  clearTimeout(_idleTimer);
  IDLE_EVENTS.forEach((ev) => window.removeEventListener(ev, resetIdleTimer));
}

/* ---------------- Filet de sécurité global ---------------- */
window.addEventListener('error', (ev) => {
  console.error('[window.error]', ev.error || ev.message);
  try { toast('Erreur inattendue. Réessayez.', 'error'); } catch {}
});
window.addEventListener('unhandledrejection', (ev) => {
  console.error('[unhandledrejection]', ev.reason);
  const m = (ev.reason && ev.reason.message) || 'Opération impossible.';
  try { toast('Erreur : ' + m, 'error'); } catch {}
});

document.addEventListener('DOMContentLoaded', () => {
  // `doLogout(auto)` : sans la fonction fléchée, le clic transmettrait l'objet
  // MouseEvent comme `auto` — toujours vrai — et l'écran de connexion annoncerait
  // à tort une déconnexion pour inactivité.
  document.getElementById('logoutBtn').onclick = () => doLogout(false);
  boot().catch((e) => {
    console.error('[boot]', e);
    if (e && e.code === 'hors-ligne') return showHorsLigne();
    showFatal((e && e.message) || 'Démarrage impossible.');
  });
});
