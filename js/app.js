/* ------------------------------------------------------------------
 * app.js — Interface et logique de l'application.
 * Utilise Store (js/store.js) : fonctionne en mode démo ou cloud.
 * ------------------------------------------------------------------ */

let STORE = null, MODE = 'demo', ME = null;
let VIEW = 'sheet';
let SEL_EMP = null;                 // employée sélectionnée (vue admin)
let CUR = (() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() + 1 }; })();
const KINDS = { normal: 'Normal', conge: 'Congé', recuperation: 'Récupération', autre: 'Autre' };

/* ---------------- Helpers temps ---------------- */
const pad = (n) => String(n).padStart(2, '0');
const daysInMonth = (y, m) => new Date(y, m, 0).getDate();
const monthName = (y, m) => new Date(y, m - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
const DOW = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

function hoursToMin(h) { const v = parseFloat(String(h).replace(',', '.')); return isNaN(v) ? 0 : Math.round(v * 60); }
function minToHoursInput(min) { return (min / 60).toFixed(2).replace(/\.00$/, ''); }

/* Encodage par heure de début/fin, tranches de 15 minutes (06:00 → 21:00). */
function timeToMin(t) { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + m; }
function minToTime(min) { return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`; }
const TIME_OPTIONS = (() => { const o = []; for (let m = 6 * 60; m <= 21 * 60; m += 15) o.push(minToTime(m)); return o; })();
function timeSelect(k, date, value, disabled) {
  const opts = ['<option value="">--:--</option>']
    .concat(TIME_OPTIONS.map((t) => `<option value="${t}" ${t === value ? 'selected' : ''}>${t}</option>`));
  return `<select class="cell time" data-k="${k}" data-date="${date}" ${disabled ? 'disabled' : ''}>${opts.join('')}</select>`;
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
function toast(msg, kind = 'ok') {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast ' + kind; t.style.display = 'block';
  clearTimeout(t._t); t._t = setTimeout(() => (t.style.display = 'none'), 3000);
}

/* ---------------- Calculs mensuels + solde reporté ---------------- */
async function monthSummary(empId, y, m) {
  const all = await STORE.entriesForEmployee(empId);
  const firstOfMonth = `${y}-${pad(m)}-01`;
  let planned = 0, worked = 0, carryIn = 0;
  all.forEach((e) => {
    const w = effectiveWorked(e), p = plannedMinutes(e);
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
  document.getElementById('modeBadge').textContent = MODE === 'cloud' ? '☁️ Cloud' : '🧪 Démo (local)';
  document.getElementById('modeBadge').className = 'badge ' + (MODE === 'cloud' ? 'validated' : 'pending');

  STORE.onChange(() => { if (ME) render(); });   // temps réel

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
  document.getElementById('login').style.display = 'none';
  document.getElementById('appShell').style.display = 'block';
  document.getElementById('meName').textContent = ME.full_name + (ME.role === 'admin' ? ' (Admin)' : '');
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
      <label>Email</label>
      <input id="email" type="email" value="${MODE === 'demo' ? 'admin@ecole.be' : ''}" placeholder="votre email" />
      <label>Mot de passe</label>
      <input id="pwd" type="password" value="${MODE === 'demo' ? 'admin123' : ''}" placeholder="votre mot de passe" />
      <div id="loginMsg"></div>
      <button class="big" id="loginBtn">Se connecter</button>
      ${MODE === 'demo' ? `<p class="muted small" style="margin-top:14px">
        Mode démo — comptes de test :<br>
        admin@ecole.be / admin123 · flora@ecole.be / flora123 · sarah@ecole.be / sarah123</p>` : ''}
    </div>`;
  const go = async () => {
    try {
      ME = await STORE.signIn(document.getElementById('email').value.trim(), document.getElementById('pwd').value);
      await afterLogin();
    } catch (e) {
      document.getElementById('loginMsg').innerHTML = `<div class="msg error">${e.message}</div>`;
    }
  };
  document.getElementById('loginBtn').onclick = go;
  document.getElementById('pwd').onkeydown = (e) => { if (e.key === 'Enter') go(); };
}

/* ---------------- Navigation ---------------- */
function buildNav() {
  const items = ME.role === 'admin'
    ? [['sheet', '📅 Feuille du mois'], ['recap', '📊 Récapitulatif'], ['children', '🧒 Enfants'],
       ['stats', '📈 Statistiques'], ['employees', '👥 Employées'], ['audit', '📝 Journal']]
    : [['sheet', '📅 Ma feuille'], ['recap', '📊 Mon récap'], ['children', '🧒 Enfants'], ['stats', '📈 Statistiques']];
  document.getElementById('nav').innerHTML = items.map(
    ([v, l]) => `<button class="navbtn ${v === VIEW ? 'active' : ''}" data-v="${v}">${l}</button>`).join('');
  document.querySelectorAll('.navbtn').forEach((b) => b.onclick = () => { VIEW = b.dataset.v; buildNav(); render(); });
}

/* ---------------- Barre de sélection mois / employée ---------------- */
async function toolbar(showEmployee) {
  let empSel = '';
  if (showEmployee && ME.role === 'admin') {
    const profs = (await STORE.listProfiles()).filter((p) => p.role === 'employee');
    empSel = `<select id="empSel">${profs.map((p) =>
      `<option value="${p.id}" ${p.id === SEL_EMP ? 'selected' : ''}>${p.full_name}${p.active ? '' : ' (archivée)'}</option>`).join('')}</select>`;
  }
  return `<div class="toolbar">
    <button class="small" id="prevM">◀</button>
    <strong style="min-width:170px;text-align:center;text-transform:capitalize">${monthName(CUR.y, CUR.m)}</strong>
    <button class="small" id="nextM">▶</button>
    ${empSel}
    <span style="flex:1"></span>
    <span id="toolbarExtra"></span>
  </div>`;
}
function wireToolbar() {
  const p = document.getElementById('prevM'), n = document.getElementById('nextM'), s = document.getElementById('empSel');
  if (p) p.onclick = () => { CUR.m--; if (CUR.m < 1) { CUR.m = 12; CUR.y--; } render(); };
  if (n) n.onclick = () => { CUR.m++; if (CUR.m > 12) { CUR.m = 1; CUR.y++; } render(); };
  if (s) s.onchange = () => { SEL_EMP = s.value; render(); };
}

/* ================================================================
 * Rendu principal
 * ================================================================ */
async function render() {
  const map = { sheet: viewSheet, recap: viewRecap, children: viewChildren, stats: viewStats, employees: viewEmployees, audit: viewAudit };
  await (map[VIEW] || viewSheet)();
}

/* ---------------- Vue : Feuille mensuelle (type Excel) ---------------- */
async function viewSheet() {
  const app = document.getElementById('app');
  const empId = SEL_EMP;
  const month = await STORE.getMonth(empId, CUR.y, CUR.m);
  const entries = await STORE.entriesForMonth(empId, CUR.y, CUR.m);
  const byDate = {}; entries.forEach((e) => (byDate[e.entry_date] = e));
  const dim = daysInMonth(CUR.y, CUR.m);

  const canEditPlanned = ME.role === 'admin';
  const editableProf = await currentEmpProfile(empId);
  const monthEditable = month.status === 'open';
  const canEditWorked = ME.role === 'admin' || (empId === ME.id && monthEditable && editableProf.active);

  const statusBadge = { open: '<span class="badge open">En cours</span>',
    validated: '<span class="badge validated">Validé</span>', locked: '<span class="badge refused">🔒 Verrouillé</span>' }[month.status];

  let rows = '';
  let warnings = 0;
  for (let d = 1; d <= dim; d++) {
    const date = `${CUR.y}-${pad(CUR.m)}-${pad(d)}`;
    const dow = new Date(CUR.y, CUR.m - 1, d).getDay();
    const e = byDate[date] || { planned_start: '', planned_end: '', start_time: '', end_time: '', worked_touched: false, kind: 'normal', justification: '' };
    const planned = plannedMinutes(e);
    const worked = effectiveWorked(e);
    const delta = worked - planned;
    const modified = !!e.worked_touched;
    const needJustif = delta !== 0 && (e.kind === 'normal' || e.kind === 'autre') && !e.justification;
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
      <td><select class="cell" data-k="kind" data-date="${date}" ${canEditWorked ? '' : 'disabled'}>
        ${Object.entries(KINDS).map(([k, l]) => `<option value="${k}" ${e.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
      <td class="${delta > 0 ? 'pos' : delta < 0 ? 'neg' : ''}">${delta ? fmtHM(delta) : '—'}</td>
      <td><input class="cell wide ${needJustif ? 'err' : ''}" data-k="justification" data-date="${date}" value="${(e.justification || '').replace(/"/g, '&quot;')}" ${canEditWorked ? '' : 'disabled'} placeholder="${needJustif ? 'Justification requise' : ''}"/></td>
    </tr>`;
  }

  const sum = await monthSummary(empId, CUR.y, CUR.m);
  let adminControls = '';
  if (ME.role === 'admin') {
    adminControls = `
      <button class="small ${month.status === 'locked' ? 'gray' : 'green'}" id="lockBtn">
        ${month.status === 'locked' ? '🔓 Déverrouiller' : '🔒 Verrouiller le mois'}</button>
      ${month.status === 'open' ? '<button class="small" id="validBtn">Marquer validé</button>' : ''}`;
  }

  app.innerHTML = `${await toolbar(true)}
    <div class="card">
      <div class="row-between">
        <h2 style="margin:0">Feuille mensuelle ${statusBadge}</h2>
        <div>${adminControls} <button class="small" id="pdfBtn">🖨️ Export PDF</button></div>
      </div>
      ${warnings ? `<div class="msg error">${warnings} jour(s) avec un écart non justifié.</div>` : ''}
      ${!monthEditable && empId === ME.id && ME.role === 'employee'
        ? '<div class="msg">Ce mois est ' + (month.status === 'locked' ? 'verrouillé' : 'validé') + ' : vous ne pouvez plus le modifier.</div>' : ''}
      <div class="table-wrap">
        <table class="grid">
          <thead>
            <tr>
              <th rowspan="2">Date</th><th rowspan="2">Jour</th>
              <th colspan="2" class="grp-plan-h">Horaire prévu (admin)</th>
              <th colspan="2" class="grp-real-h">Horaire réel</th>
              <th rowspan="2">Presté</th><th rowspan="2">Type</th><th rowspan="2">Écart</th><th rowspan="2">Justification</th>
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
        <div class="stat"><div class="num">${fmtHM(sum.planned)}</div><div class="lbl">Total prévu</div></div>
        <div class="stat"><div class="num">${fmtHM(sum.worked)}</div><div class="lbl">Total presté</div></div>
        <div class="stat"><div class="num ${sum.delta >= 0 ? 'pos' : 'neg'}">${fmtHM(sum.delta)}</div><div class="lbl">Écart du mois</div></div>
        <div class="stat"><div class="num">${fmtHM(sum.carryIn)}</div><div class="lbl">Solde reporté</div></div>
        <div class="stat"><div class="num ${sum.closing >= 0 ? 'pos' : 'neg'}">${fmtHM(sum.closing)}</div><div class="lbl">Solde cumulé</div></div>
      </div>
      <p class="muted small">
        <span class="legend"><span class="sw grp-plan-h"></span> Horaire prévu (défini par l'admin)</span>
        <span class="legend"><span class="sw grp-real-h"></span> Horaire réel (encodé par l'employée)</span>
        <span class="legend"><span class="dot">●</span> jour modifié</span>
        <span class="legend"><span class="pos">▲ heures sup.</span> / <span class="neg">▼ à récupérer</span></span><br>
        Heures par tranches de 15 min. Le réel est pré-rempli avec le prévu : ne modifiez que les jours différents. Enregistrement automatique.
      </p>
    </div>`;
  wireToolbar();

  // Sauvegarde automatique des cellules (avec pré-remplissage et calcul début/fin).
  app.querySelectorAll('input.cell, select.cell').forEach((el) => {
    el.addEventListener('change', async () => {
      const date = el.dataset.date, k = el.dataset.k;
      const prev = byDate[date] || {};
      const patch = { employee_id: empId, entry_date: date };

      if (k === 'planned_start' || k === 'planned_end') {
        // L'admin définit l'horaire prévu (référence).
        const ps = k === 'planned_start' ? el.value : (prev.planned_start || '');
        const pe = k === 'planned_end' ? el.value : (prev.planned_end || '');
        patch.planned_start = ps; patch.planned_end = pe;
        const s = timeToMin(ps), f = timeToMin(pe);
        if (s != null && f != null && f <= s) { toast("L'heure de fin doit être après le début.", 'error'); return; }
        patch.planned_minutes = (s != null && f != null) ? Math.max(0, f - s) : 0;
        // Pré-remplissage : tant que l'employée n'a pas modifié, le réel suit le prévu.
        if (!prev.worked_touched) {
          patch.start_time = ps; patch.end_time = pe;
          patch.worked_minutes = patch.planned_minutes;
        }
      } else if (k === 'start_time' || k === 'end_time') {
        // L'employée (ou l'admin) modifie l'horaire réel → jour marqué comme modifié.
        const start = k === 'start_time' ? el.value : (prev.start_time || prev.planned_start || '');
        const end = k === 'end_time' ? el.value : (prev.end_time || prev.planned_end || '');
        const s = timeToMin(start), f = timeToMin(end);
        if (s != null && f != null && f <= s) { toast("L'heure de fin doit être après le début.", 'error'); return; }
        patch.start_time = start; patch.end_time = end;
        patch.worked_touched = true;
        patch.worked_minutes = (s != null && f != null) ? Math.max(0, f - s) : 0;
      } else if (k === 'kind') {
        patch.kind = el.value;
      } else if (k === 'justification') {
        patch.justification = el.value;
      }
      try { await STORE.upsertEntry(patch); render(); }
      catch (e) { toast(e.message, 'error'); }
    });
  });

  if (ME.role === 'admin') {
    const lb = document.getElementById('lockBtn');
    if (lb) lb.onclick = async () => {
      await STORE.setMonthStatus(empId, CUR.y, CUR.m, month.status === 'locked' ? 'open' : 'locked');
      toast(month.status === 'locked' ? 'Mois déverrouillé' : 'Mois verrouillé — solde reporté au mois suivant');
      render();
    };
    const vb = document.getElementById('validBtn');
    if (vb) vb.onclick = async () => { await STORE.setMonthStatus(empId, CUR.y, CUR.m, 'validated'); toast('Mois marqué validé'); render(); };
  }
  document.getElementById('pdfBtn').onclick = () => exportSheetPDF(empId);
}

async function currentEmpProfile(id) {
  return (await STORE.listProfiles()).find((p) => p.id === id) || { active: true };
}

/* ---------------- Vue : Récapitulatif (toutes employées pour l'admin) ---------------- */
async function viewRecap() {
  const app = document.getElementById('app');
  const profs = (await STORE.listProfiles()).filter((p) => ME.role === 'admin' ? p.role === 'employee' : p.id === ME.id);
  let rows = '';
  for (const p of profs) {
    const s = await monthSummary(p.id, CUR.y, CUR.m);
    const mo = await STORE.getMonth(p.id, CUR.y, CUR.m);
    rows += `<tr>
      <td>${p.full_name}${p.active ? '' : ' <span class="badge open">archivée</span>'}</td>
      <td>${fmtHM(s.planned)}</td><td>${fmtHM(s.worked)}</td>
      <td class="${s.delta >= 0 ? 'pos' : 'neg'}">${fmtHM(s.delta)}</td>
      <td>${fmtHM(s.carryIn)}</td>
      <td class="${s.closing >= 0 ? 'pos' : 'neg'}"><strong>${fmtHM(s.closing)}</strong></td>
      <td>${{ open: 'En cours', validated: 'Validé', locked: '🔒 Verrouillé' }[mo.status]}</td>
    </tr>`;
  }
  app.innerHTML = `${await toolbar(false)}
    <div class="card">
      <h2>Récapitulatif — ${monthName(CUR.y, CUR.m)}</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Employée</th><th>Prévu</th><th>Presté</th><th>Écart mois</th><th>Solde reporté</th><th>Solde cumulé</th><th>Statut</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <p class="muted small">Le solde cumulé = solde reporté + écart du mois. Un solde positif = heures supplémentaires ; négatif = heures à récupérer.</p>
    </div>`;
  wireToolbar();
}

/* ---------------- Vue : Enfants ---------------- */
async function viewChildren() {
  const app = document.getElementById('app');
  const list = await STORE.childrenForMonth(CUR.y, CUR.m);
  const byDate = {}; list.forEach((c) => (byDate[c.entry_date] = c));
  const dim = daysInMonth(CUR.y, CUR.m);
  let rows = '', total = 0, count = 0;
  for (let d = 1; d <= dim; d++) {
    const date = `${CUR.y}-${pad(CUR.m)}-${pad(d)}`;
    const dow = new Date(CUR.y, CUR.m - 1, d).getDay();
    const c = byDate[date] || { children: '', note: '' };
    if (c.children !== '' && c.children != null) { total += Number(c.children); count++; }
    rows += `<tr${(dow === 0 || dow === 6) ? ' class="weekend"' : ''}>
      <td class="nowrap">${pad(d)}/${pad(CUR.m)}</td><td>${DOW[dow]}</td>
      <td><input class="cell" style="width:80px" data-date="${date}" data-k="children" type="number" min="0" value="${c.children}" placeholder="0"/></td>
      <td><input class="cell wide" data-date="${date}" data-k="note" value="${(c.note || '').replace(/"/g, '&quot;')}" placeholder="Note"/></td>
    </tr>`;
  }
  app.innerHTML = `${await toolbar(false)}
    <div class="card">
      <h2>🧒 Présences enfants — ${monthName(CUR.y, CUR.m)}</h2>
      <div class="stat-grid" style="margin-bottom:14px">
        <div class="stat"><div class="num">${total}</div><div class="lbl">Total du mois</div></div>
        <div class="stat"><div class="num">${count ? (total / count).toFixed(1) : '0'}</div><div class="lbl">Moyenne / jour</div></div>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>Jour</th><th>Enfants</th><th>Note</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
    </div>`;
  wireToolbar();
  app.querySelectorAll('input.cell').forEach((el) => el.addEventListener('change', async () => {
    const date = el.dataset.date;
    const cur = byDate[date] || { children: 0, note: '' };
    const children = el.dataset.k === 'children' ? Number(el.value || 0) : Number(cur.children || 0);
    const note = el.dataset.k === 'note' ? el.value : (cur.note || '');
    await STORE.upsertChildren(date, children, note); render();
  }));
}

/* ---------------- Vue : Statistiques (graphiques) ---------------- */
async function viewStats() {
  const app = document.getElementById('app');
  const all = await STORE.allChildren();
  // Moyennes
  const inMonth = all.filter((c) => c.entry_date.startsWith(`${CUR.y}-${pad(CUR.m)}`));
  const inYear = all.filter((c) => c.entry_date.startsWith(`${CUR.y}-`));
  const avg = (arr) => arr.length ? (arr.reduce((s, c) => s + Number(c.children || 0), 0) / arr.length) : 0;
  // Moyenne hebdo : moyenne des totaux par semaine ISO du mois
  const weeks = {};
  inMonth.forEach((c) => { const wk = isoWeek(c.entry_date); weeks[wk] = (weeks[wk] || 0) + Number(c.children || 0); });
  const weekVals = Object.values(weeks);
  const weeklyAvg = weekVals.length ? weekVals.reduce((a, b) => a + b, 0) / weekVals.length : 0;

  const stats = {
    weeklyAvg: weeklyAvg, dailyMonth: avg(inMonth), dailyYear: avg(inYear),
  };

  app.innerHTML = `${await toolbar(false)}
    <div class="card">
      <div class="row-between">
        <h2 style="margin:0">📈 Statistiques de fréquentation</h2>
        <button class="small" id="statsPdfBtn">🖨️ Export PDF</button>
      </div>
      <div class="stat-grid" style="margin:16px 0">
        <div class="stat"><div class="num">${weeklyAvg.toFixed(0)}</div><div class="lbl">Moyenne hebdomadaire (mois)</div></div>
        <div class="stat"><div class="num">${avg(inMonth).toFixed(1)}</div><div class="lbl">Moyenne journalière (mois)</div></div>
        <div class="stat"><div class="num">${avg(inYear).toFixed(1)}</div><div class="lbl">Moyenne journalière (année)</div></div>
      </div>
      <h3 class="muted">Enfants présents par jour — ${monthName(CUR.y, CUR.m)}</h3>
      <canvas id="chartDaily" height="110"></canvas>
      <h3 class="muted" style="margin-top:24px">Moyenne mensuelle — ${CUR.y}</h3>
      <canvas id="chartMonthly" height="110"></canvas>
    </div>`;
  wireToolbar();

  if (!window.Chart) {
    document.getElementById('chartDaily').replaceWith(Object.assign(document.createElement('p'), { className: 'muted', textContent: 'Graphiques indisponibles hors ligne (Chart.js).' }));
    document.getElementById('statsPdfBtn').onclick = () => exportStatsPDF(stats, null, null);
    return;
  }

  // Histogramme journalier
  const dim = daysInMonth(CUR.y, CUR.m);
  const labels = [], data = [];
  const byDate = {}; inMonth.forEach((c) => (byDate[c.entry_date] = Number(c.children || 0)));
  for (let d = 1; d <= dim; d++) { labels.push(pad(d)); data.push(byDate[`${CUR.y}-${pad(CUR.m)}-${pad(d)}`] || 0); }
  const chartDaily = new Chart(document.getElementById('chartDaily'), {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Enfants', data, backgroundColor: '#3b5bdb' }] },
    options: { animation: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
  });
  // Courbe moyenne mensuelle sur l'année
  const mLabels = [], mData = [];
  for (let mm = 1; mm <= 12; mm++) {
    const arr = inYear.filter((c) => c.entry_date.startsWith(`${CUR.y}-${pad(mm)}`));
    mLabels.push(new Date(CUR.y, mm - 1, 1).toLocaleDateString('fr-FR', { month: 'short' }));
    mData.push(arr.length ? +(arr.reduce((s, c) => s + Number(c.children || 0), 0) / arr.length).toFixed(1) : 0);
  }
  const chartMonthly = new Chart(document.getElementById('chartMonthly'), {
    type: 'line',
    data: { labels: mLabels, datasets: [{ label: 'Moyenne/jour', data: mData, borderColor: '#2f9e44', tension: 0.3, fill: false }] },
    options: { animation: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
  });

  document.getElementById('statsPdfBtn').onclick = () => exportStatsPDF(stats, chartDaily, chartMonthly);
}

/* ---------------- Export PDF des statistiques (avec graphiques) ---------------- */
async function exportStatsPDF(stats, chartDaily, chartMonthly) {
  // Repli impression si jsPDF absent (hors ligne).
  if (!window.jspdf) {
    const w = window.open('', '_blank');
    w.document.write(`<img src="assets/logo.svg" style="height:60px"><h2>Statistiques de fréquentation — ${monthName(CUR.y, CUR.m)}</h2>
      <ul>
        <li>Moyenne hebdomadaire (mois) : <b>${stats.weeklyAvg.toFixed(0)}</b></li>
        <li>Moyenne journalière (mois) : <b>${stats.dailyMonth.toFixed(1)}</b></li>
        <li>Moyenne journalière (année) : <b>${stats.dailyYear.toFixed(1)}</b></li>
      </ul>
      ${chartDaily ? `<img src="${chartDaily.toBase64Image()}" style="max-width:100%"/>` : ''}
      ${chartMonthly ? `<img src="${chartMonthly.toBase64Image()}" style="max-width:100%"/>` : ''}
      <button onclick="print()">Imprimer</button>`);
    w.document.close(); return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  let y = await pdfHeader(doc, 'Statistiques de fréquentation', `${monthName(CUR.y, CUR.m)} · Année ${CUR.y}`);

  // Tableau des moyennes
  doc.autoTable({
    startY: y,
    head: [['Indicateur', 'Valeur']],
    body: [
      ['Moyenne hebdomadaire (mois)', stats.weeklyAvg.toFixed(0) + ' enfants'],
      ['Moyenne journalière (mois)', stats.dailyMonth.toFixed(1) + ' enfants'],
      ['Moyenne journalière (année)', stats.dailyYear.toFixed(1) + ' enfants'],
    ],
    styles: { fontSize: 11 }, headStyles: { fillColor: [59, 91, 219] },
  });
  y = doc.lastAutoTable.finalY + 10;

  // Graphiques (rendus en images depuis les canvases Chart.js)
  const W = 180;
  if (chartDaily) {
    doc.setTextColor(0); doc.setFontSize(12);
    doc.text(`Enfants présents par jour — ${monthName(CUR.y, CUR.m)}`, 14, y); y += 4;
    doc.addImage(chartDaily.toBase64Image('image/png', 1), 'PNG', 14, y, W, W * 0.42); y += W * 0.42 + 10;
  }
  if (chartMonthly) {
    if (y > 240) { doc.addPage(); y = 20; }
    doc.setFontSize(12);
    doc.text(`Moyenne mensuelle — ${CUR.y}`, 14, y); y += 4;
    doc.addImage(chartMonthly.toBase64Image('image/png', 1), 'PNG', 14, y, W, W * 0.42);
  }
  doc.save(`statistiques_${CUR.y}-${pad(CUR.m)}.pdf`);
}
function isoWeek(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d); const day = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - day + 3);
  const first = new Date(date.getFullYear(), 0, 4);
  return 1 + Math.round(((date - first) / 864e5 - 3 + ((first.getDay() + 6) % 7)) / 7);
}

/* ---------------- Vue : Employées (admin) ---------------- */
async function viewEmployees() {
  const app = document.getElementById('app');
  const profs = await STORE.listProfiles();
  const rows = profs.map((p) => `<tr>
    <td>${p.full_name}</td><td>${p.email || '—'}</td>
    <td><span class="badge ${p.role === 'admin' ? 'validated' : 'open'}">${p.role}</span></td>
    <td>${p.active ? '<span class="badge validated">Active</span>' : '<span class="badge refused">Archivée</span>'}</td>
    <td>${p.role === 'employee' ? (p.active
        ? `<button class="small red" data-arch="${p.id}">Archiver</button>`
        : `<button class="small green" data-react="${p.id}">Réactiver</button>`) : ''}</td>
  </tr>`).join('');
  app.innerHTML = `<div class="card">
      <div class="row-between"><h2>👥 Employées</h2><button class="small" id="addBtn">+ Ajouter une employée</button></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Nom</th><th>Email</th><th>Rôle</th><th>Statut</th><th>Action</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <p class="muted small">Archiver conserve toutes les données en lecture seule (l'employée ne peut plus se connecter/encoder).</p>
    </div>
    <div class="card hidden" id="addForm">
      <h3>Nouvelle employée</h3>
      <div class="row">
        <div><label>Nom complet</label><input id="nName" placeholder="Prénom Nom"/></div>
        <div><label>Email</label><input id="nEmail" type="email" placeholder="prenom@ecole.be"/></div>
        <div><label>Mot de passe initial</label><input id="nPwd" placeholder="au moins 6 caractères"/></div>
      </div>
      <div id="addMsg"></div>
      <button id="saveEmp" style="margin-top:10px">Créer</button>
    </div>`;
  document.getElementById('addBtn').onclick = () => document.getElementById('addForm').classList.toggle('hidden');
  document.getElementById('saveEmp').onclick = async () => {
    const full_name = document.getElementById('nName').value.trim();
    const email = document.getElementById('nEmail').value.trim();
    const password = document.getElementById('nPwd').value;
    if (!full_name || !email || password.length < 6) {
      document.getElementById('addMsg').innerHTML = '<div class="msg error">Nom, email et mot de passe (6+) requis.</div>'; return;
    }
    try { await STORE.addProfile({ full_name, email, password, role: 'employee' }); toast('Employée ajoutée'); render(); }
    catch (e) { document.getElementById('addMsg').innerHTML = `<div class="msg error">${e.message}</div>`; }
  };
  app.querySelectorAll('[data-arch]').forEach((b) => b.onclick = async () => {
    if (confirm('Archiver cette employée ? Ses données restent consultables.')) { await STORE.setActive(b.dataset.arch, false); toast('Employée archivée'); render(); }
  });
  app.querySelectorAll('[data-react]').forEach((b) => b.onclick = async () => { await STORE.setActive(b.dataset.react, true); toast('Employée réactivée'); render(); });
}

/* ---------------- Vue : Journal d'audit (admin) ---------------- */
async function viewAudit() {
  const app = document.getElementById('app');
  const list = await STORE.listAudit(150);
  const rows = list.map((a) => `<tr>
    <td class="nowrap">${new Date(a.created_at).toLocaleString('fr-FR')}</td>
    <td>${a.actor_name || '—'}</td><td>${a.action}</td><td>${a.entity}</td><td class="muted">${a.entity_id || ''}</td>
  </tr>`).join('');
  app.innerHTML = `<div class="card">
    <h2>📝 Journal des modifications</h2>
    <div class="table-wrap"><table>
      <thead><tr><th>Date</th><th>Auteur</th><th>Action</th><th>Objet</th><th>Réf.</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" class="muted">Aucune activité.</td></tr>'}</tbody></table></div>
  </div>`;
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
async function pdfHeader(doc, title, subtitle) {
  const logo = await logoDataURL();
  if (logo) { const h = 18, w = h * (logo.w / logo.h); doc.addImage(logo.url, 'PNG', 14, 10, w, h); }
  doc.setFontSize(16); doc.setTextColor(0); doc.text('EDD Jardin Sauvage', 14, 36);
  doc.setFontSize(13); doc.setTextColor(40); doc.text(title, 14, 44);
  if (subtitle) { doc.setFontSize(10); doc.setTextColor(110); doc.text(subtitle, 14, 50); }
  return 56; // ordonnée de départ pour la suite
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
      KINDS[e.kind], fmtHM(worked - planned), e.justification || '']);
  }

  if (!window.jspdf) { // fallback impression
    const w = window.open('', '_blank');
    w.document.write(`<img src="assets/logo.svg" style="height:60px"><h2>Prestations — ${prof.full_name} — ${monthName(CUR.y, CUR.m)}</h2>
      <table border=1 cellpadding=5 style="border-collapse:collapse"><tr><th>Date</th><th>Prévu début</th><th>Prévu fin</th><th>Réel début</th><th>Réel fin</th><th>Presté</th><th>Type</th><th>Écart</th><th>Justif.</th></tr>
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
    head: [['Date', 'Prévu déb.', 'Prévu fin', 'Réel déb.', 'Réel fin', 'Presté', 'Type', 'Écart', 'Justification']],
    body, styles: { fontSize: 9 }, headStyles: { fillColor: [59, 91, 219] },
  });
  let y = doc.lastAutoTable.finalY + 10;
  doc.setFontSize(11); doc.setTextColor(0);
  doc.text(`Total prévu : ${fmtHM(sum.planned)}      Total presté : ${fmtHM(sum.worked)}`, 14, y);
  doc.text(`Écart du mois : ${fmtHM(sum.delta)}      Solde reporté : ${fmtHM(sum.carryIn)}      Solde cumulé : ${fmtHM(sum.closing)}`, 14, y + 7);
  doc.text('Signature employée : ______________        Signature responsable : ______________', 14, y + 24);
  doc.save(`prestations_${prof.full_name.replace(/\s/g, '_')}_${CUR.y}-${pad(CUR.m)}.pdf`);
}

/* ---------------- Déconnexion ---------------- */
async function doLogout() { await STORE.signOut(); ME = null; location.reload(); }

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('logoutBtn').onclick = doLogout;
  boot();
});
