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
    if (e.entry_date < firstOfMonth) carryIn += (e.worked_minutes - e.planned_minutes);
    else if (e.entry_date.startsWith(`${y}-${pad(m)}`)) { planned += e.planned_minutes; worked += e.worked_minutes; }
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
  el.innerHTML = `
    <div class="card login-card">
      <h1>🏫 École des devoirs</h1>
      <p class="muted">Gestion des horaires, prestations et présences</p>
      <label>Email</label>
      <input id="email" type="email" value="admin@ecole.be" />
      <label>Mot de passe</label>
      <input id="pwd" type="password" value="admin123" />
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
    const e = byDate[date] || { planned_minutes: 0, worked_minutes: 0, kind: 'normal', justification: '' };
    const delta = e.worked_minutes - e.planned_minutes;
    const needJustif = delta !== 0 && (e.kind === 'normal' || e.kind === 'autre') && !e.justification;
    if (needJustif) warnings++;
    const weekend = (dow === 0 || dow === 6) ? ' class="weekend"' : '';
    rows += `<tr${weekend} ${needJustif ? 'data-warn="1"' : ''}>
      <td class="nowrap">${pad(d)}/${pad(CUR.m)}</td>
      <td>${DOW[dow]}</td>
      <td><input class="cell" data-k="planned" data-date="${date}" value="${e.planned_minutes ? minToHoursInput(e.planned_minutes) : ''}" ${canEditPlanned ? '' : 'disabled'} placeholder="0"/></td>
      <td><input class="cell" data-k="worked" data-date="${date}" value="${e.worked_minutes ? minToHoursInput(e.worked_minutes) : ''}" ${canEditWorked ? '' : 'disabled'} placeholder="0"/></td>
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
          <thead><tr><th>Date</th><th>Jour</th><th>À prester</th><th>Presté</th><th>Type</th><th>Écart</th><th>Justification</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="stat-grid" style="margin-top:16px">
        <div class="stat"><div class="num">${fmtHM(sum.planned)}</div><div class="lbl">Total à prester</div></div>
        <div class="stat"><div class="num">${fmtHM(sum.worked)}</div><div class="lbl">Total presté</div></div>
        <div class="stat"><div class="num ${sum.delta >= 0 ? 'pos' : 'neg'}">${fmtHM(sum.delta)}</div><div class="lbl">Écart du mois</div></div>
        <div class="stat"><div class="num">${fmtHM(sum.carryIn)}</div><div class="lbl">Solde reporté</div></div>
        <div class="stat"><div class="num ${sum.closing >= 0 ? 'pos' : 'neg'}">${fmtHM(sum.closing)}</div><div class="lbl">Solde cumulé</div></div>
      </div>
      <p class="muted small">Heures en décimales (ex. 4 = 4h, 4.5 = 4h30). Enregistrement automatique.</p>
    </div>`;
  wireToolbar();

  // Sauvegarde automatique des cellules.
  app.querySelectorAll('input.cell, select.cell').forEach((el) => {
    const ev = el.tagName === 'SELECT' ? 'change' : 'change';
    el.addEventListener(ev, async () => {
      const date = el.dataset.date, k = el.dataset.k;
      const patch = { employee_id: empId, entry_date: date };
      if (k === 'planned') patch.planned_minutes = hoursToMin(el.value);
      else if (k === 'worked') patch.worked_minutes = hoursToMin(el.value);
      else if (k === 'kind') patch.kind = el.value;
      else if (k === 'justification') patch.justification = el.value;
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
        <thead><tr><th>Employée</th><th>À prester</th><th>Presté</th><th>Écart mois</th><th>Solde reporté</th><th>Solde cumulé</th><th>Statut</th></tr></thead>
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

  app.innerHTML = `${await toolbar(false)}
    <div class="card">
      <h2>📈 Statistiques de fréquentation</h2>
      <div class="stat-grid" style="margin-bottom:16px">
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

  if (!window.Chart) { document.getElementById('chartDaily').replaceWith(Object.assign(document.createElement('p'), { className: 'muted', textContent: 'Graphiques indisponibles hors ligne (Chart.js).' })); return; }

  // Histogramme journalier
  const dim = daysInMonth(CUR.y, CUR.m);
  const labels = [], data = [];
  const byDate = {}; inMonth.forEach((c) => (byDate[c.entry_date] = Number(c.children || 0)));
  for (let d = 1; d <= dim; d++) { labels.push(pad(d)); data.push(byDate[`${CUR.y}-${pad(CUR.m)}-${pad(d)}`] || 0); }
  new Chart(document.getElementById('chartDaily'), {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Enfants', data, backgroundColor: '#3b5bdb' }] },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
  });
  // Courbe moyenne mensuelle sur l'année
  const mLabels = [], mData = [];
  for (let mm = 1; mm <= 12; mm++) {
    const arr = inYear.filter((c) => c.entry_date.startsWith(`${CUR.y}-${pad(mm)}`));
    mLabels.push(new Date(CUR.y, mm - 1, 1).toLocaleDateString('fr-FR', { month: 'short' }));
    mData.push(arr.length ? +(arr.reduce((s, c) => s + Number(c.children || 0), 0) / arr.length).toFixed(1) : 0);
  }
  new Chart(document.getElementById('chartMonthly'), {
    type: 'line',
    data: { labels: mLabels, datasets: [{ label: 'Moyenne/jour', data: mData, borderColor: '#2f9e44', tension: 0.3, fill: false }] },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
  });
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

/* ---------------- Export PDF ---------------- */
async function exportSheetPDF(empId) {
  const prof = await currentEmpProfile(empId);
  const entries = await STORE.entriesForMonth(empId, CUR.y, CUR.m);
  const byDate = {}; entries.forEach((e) => (byDate[e.entry_date] = e));
  const dim = daysInMonth(CUR.y, CUR.m);
  const sum = await monthSummary(empId, CUR.y, CUR.m);
  const body = [];
  for (let d = 1; d <= dim; d++) {
    const date = `${CUR.y}-${pad(CUR.m)}-${pad(d)}`;
    const e = byDate[date]; if (!e || (!e.planned_minutes && !e.worked_minutes)) continue;
    body.push([`${pad(d)}/${pad(CUR.m)}`, fmtHM(e.planned_minutes), fmtHM(e.worked_minutes),
      KINDS[e.kind], fmtHM(e.worked_minutes - e.planned_minutes), e.justification || '']);
  }

  if (!window.jspdf) { // fallback impression
    const w = window.open('', '_blank');
    w.document.write(`<h2>Prestations — ${prof.full_name} — ${monthName(CUR.y, CUR.m)}</h2>
      <table border=1 cellpadding=5 style="border-collapse:collapse"><tr><th>Date</th><th>À prester</th><th>Presté</th><th>Type</th><th>Écart</th><th>Justif.</th></tr>
      ${body.map((r) => '<tr>' + r.map((c) => `<td>${c}</td>`).join('') + '</tr>').join('')}</table>
      <p><b>Total presté:</b> ${fmtHM(sum.worked)} — <b>Solde cumulé:</b> ${fmtHM(sum.closing)}</p>
      <button onclick="print()">Imprimer</button>`);
    w.document.close(); return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFontSize(15); doc.text(`Prestations — ${prof.full_name}`, 14, 18);
  doc.setFontSize(11); doc.setTextColor(90); doc.text(`${monthName(CUR.y, CUR.m)} · École des devoirs`, 14, 25);
  doc.autoTable({
    startY: 32, head: [['Date', 'À prester', 'Presté', 'Type', 'Écart', 'Justification']], body,
    styles: { fontSize: 9 }, headStyles: { fillColor: [59, 91, 219] },
  });
  let y = doc.lastAutoTable.finalY + 10;
  doc.setFontSize(11); doc.setTextColor(0);
  doc.text(`Total à prester : ${fmtHM(sum.planned)}      Total presté : ${fmtHM(sum.worked)}`, 14, y);
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
