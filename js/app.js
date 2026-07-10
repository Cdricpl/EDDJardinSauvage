/* ------------------------------------------------------------------
 * app.js — Interface et logique de l'application.
 * Utilise Store (js/store.js) : fonctionne en mode démo ou cloud.
 * ------------------------------------------------------------------ */

let STORE = null, MODE = 'demo', ME = null;
let VIEW = 'sheet';
let SEL_EMP = null;                 // employée sélectionnée (vue admin)
let APPLYING = false;               // garde anti-réentrance du pré-remplissage
let CUR = (() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() + 1 }; })();

/* Le système démarre en janvier 2026 : aucun mois antérieur n'est accessible. */
const MIN_YM = { y: 2026, m: 1 };
const ymNum = (y, m) => y * 12 + (m - 1);
const atOrBeforeMin = () => ymNum(CUR.y, CUR.m) <= ymNum(MIN_YM.y, MIN_YM.m);
function clampMonth() {
  if (ymNum(CUR.y, CUR.m) < ymNum(MIN_YM.y, MIN_YM.m)) { CUR.y = MIN_YM.y; CUR.m = MIN_YM.m; }
}
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

/* ---------------- Helpers temps ---------------- */
const pad = (n) => String(n).padStart(2, '0');
const daysInMonth = (y, m) => new Date(y, m, 0).getDate();
const monthName = (y, m) => new Date(y, m - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
const DOW = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

/* Encodage par heure de début/fin — menu déroulant limité aux quarts d'heure. */
function timeToMin(t) { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + m; }
function minToTime(min) { return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`; }
// Liste des heures autorisées : uniquement les quarts d'heure (minutes 00/15/30/45).
const TIME_LIST = (() => { const o = []; for (let m = 6 * 60; m <= 21 * 60; m += 15) o.push(minToTime(m)); return o; })();
function timeOptionsHTML(value) {
  return '<option value="">--:--</option>' +
    TIME_LIST.map((t) => `<option value="${t}"${t === value ? ' selected' : ''}>${t}</option>`).join('');
}
function timeSelect(k, date, value, disabled) {
  return `<select class="cell time" data-k="${k}" data-date="${date}" ${disabled ? 'disabled' : ''}>${timeOptionsHTML(value || '')}</select>`;
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
  clampMonth();
  const created = await createStore();
  STORE = created.store; MODE = created.mode;
  document.getElementById('modeBadge').textContent = MODE === 'cloud' ? '☁️ Cloud' : '🧪 Démo (local)';
  document.getElementById('modeBadge').className = 'badge ' + (MODE === 'cloud' ? 'validated' : 'pending');

  // Temps réel : re-rendu groupé (debounce) pour éviter les rendus en rafale,
  // et jamais pendant une saisie active (sinon on volerait le focus du champ).
  STORE.onChange(debounce(() => {
    if (!ME) return;
    const ae = document.activeElement;
    if (ae && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName) && ae.closest('#app')) return;
    render();
  }, 400));

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
      <p class="center" style="margin-top:10px"><a href="#" id="forgotLink" class="muted small">Mot de passe oublié ?</a></p>
      ${MODE === 'demo' ? `<p class="muted small" style="margin-top:6px">
        Mode démo — comptes de test :<br>
        admin@ecole.be / admin123 · flora@ecole.be / flora123 · sarah@ecole.be / sarah123</p>` : ''}
    </div>`;
  const loginMsg = (html, kind = 'error') => {
    document.getElementById('loginMsg').innerHTML = `<div class="msg ${kind}">${html}</div>`;
  };
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
    if (MODE !== 'cloud') { loginMsg('La réinitialisation par email est disponible en mode cloud uniquement.'); return; }
    try {
      await STORE.sendPasswordReset(email);
      loginMsg('Un email de réinitialisation a été envoyé à ' + email + ' (pensez à vérifier les spams).', 'ok');
    } catch (err) { loginMsg(err.message); }
  };
}

/* ---------------- Navigation ---------------- */
function buildNav() {
  const items = ME.role === 'admin'
    ? [['sheet', '📅 Feuille du mois'], ['recap', '📊 Récapitulatif'], ['children', '🧒 Enfants'],
       ['stats', '📈 Statistiques'], ['employees', '👥 Utilisateurs']]
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
    <button class="small" id="prevM" ${atOrBeforeMin() ? 'disabled title="Janvier 2026 = premier mois"' : ''}>◀</button>
    <strong style="min-width:170px;text-align:center;text-transform:capitalize">${monthName(CUR.y, CUR.m)}</strong>
    <button class="small" id="nextM">▶</button>
    ${empSel}
    <span style="flex:1"></span>
  </div>`;
}
function wireToolbar() {
  const p = document.getElementById('prevM'), n = document.getElementById('nextM'), s = document.getElementById('empSel');
  if (p) p.onclick = () => { if (atOrBeforeMin()) return; CUR.m--; if (CUR.m < 1) { CUR.m = 12; CUR.y--; } clampMonth(); render(); };
  if (n) n.onclick = () => { CUR.m++; if (CUR.m > 12) { CUR.m = 1; CUR.y++; } render(); };
  if (s) s.onchange = () => { SEL_EMP = s.value; render(); };
}

/* ================================================================
 * Rendu principal (avec filet de sécurité : jamais d'écran blanc)
 * ================================================================ */
async function render() {
  const map = { sheet: viewSheet, recap: viewRecap, children: viewChildren, stats: viewStats, employees: viewEmployees };
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
  const app = document.getElementById('app');
  if (!app) return;
  app.innerHTML = `<div class="card">
    <div class="msg error"><strong>Une erreur est survenue.</strong><br>${msg || ''}</div>
    <p class="muted small">Vos données sont en sécurité. Réessayez, ou rechargez l'application.</p>
    <button onclick="location.reload()">Recharger</button>
  </div>`;
}

/* ---------------- Vue : Feuille mensuelle (type Excel) ---------------- */
async function viewSheet() {
  const app = document.getElementById('app');
  const empId = SEL_EMP;
  const month = await STORE.getMonth(empId, CUR.y, CUR.m);
  let entries = await STORE.entriesForMonth(empId, CUR.y, CUR.m);
  const tpl = ME.role === 'admin' ? await STORE.getTemplate(empId) : {};

  // Pré-remplissage automatique : mois OUVERT + vide + un horaire type existe.
  // (Les mois validés ne sont jamais touchés.) Garde anti-réentrance.
  if (ME.role === 'admin' && month.status === 'open' && entries.length === 0 && templateHasSlots(tpl) && !APPLYING) {
    APPLYING = true;
    try { await applyTemplate(empId, CUR.y, CUR.m, tpl, true); }
    catch (e) { console.error('[auto-prefill]', e); toast('Pré-remplissage impossible : ' + e.message, 'error'); }
    finally { APPLYING = false; }
    return render();
  }

  const byDate = {}; entries.forEach((e) => (byDate[e.entry_date] = e));
  const dim = daysInMonth(CUR.y, CUR.m);

  const canEditPlanned = ME.role === 'admin';
  const editableProf = await currentEmpProfile(empId);
  const monthEditable = month.status === 'open';
  const canEditWorked = ME.role === 'admin' || (empId === ME.id && monthEditable && editableProf.active);

  const statusBadge = { open: '<span class="badge open">En cours</span>',
    validated: '<span class="badge validated">✓ Validé</span>' }[month.status];

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
      <td class="${delta > 0 ? 'pos' : delta < 0 ? 'neg' : ''}">${delta ? fmtHM(delta) : '—'}</td>
      <td><input class="cell wide ${needJustif ? 'err' : ''}" data-k="justification" data-date="${date}" value="${(e.justification || '').replace(/"/g, '&quot;')}" ${canEditWorked ? '' : 'disabled'} placeholder="${needJustif ? 'Justification requise' : ''}"/></td>
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
        <table class="grid">
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
        <div class="stat"><div class="num ${sum.delta >= 0 ? 'pos' : 'neg'}" id="tDelta">${fmtHM(sum.delta)}</div><div class="lbl">Écart du mois</div></div>
        <div class="stat"><div class="num" id="tCarry">${fmtHM(sum.carryIn)}</div><div class="lbl">Solde reporté</div></div>
        <div class="stat"><div class="num ${sum.closing >= 0 ? 'pos' : 'neg'}" id="tClosing">${fmtHM(sum.closing)}</div><div class="lbl">Solde cumulé</div></div>
      </div>
      <p class="muted small">
        <span class="legend"><span class="sw grp-plan-h"></span> Horaire prévu (défini par l'admin)</span>
        <span class="legend"><span class="sw grp-real-h"></span> Horaire réel (encodé par l'employée)</span>
        <span class="legend"><span class="dot">●</span> jour modifié</span>
        <span class="legend"><span class="pos">▲ heures sup.</span> / <span class="neg">▼ à récupérer</span></span><br>
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
    ec.textContent = delta ? fmtHM(delta) : '—';
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
    setTile('tDelta', fmtHM(delta), delta >= 0); setTile('tCarry', fmtHM(baseCarry));
    setTile('tClosing', fmtHM(closing), closing >= 0);
    const wb = document.getElementById('warnBanner');
    if (wb) { wb.textContent = warn + ' jour(s) avec un écart non justifié.'; wb.style.display = warn ? '' : 'none'; }
  }
  const flashSaved = (el) => { el.classList.add('saved'); setTimeout(() => el.classList.remove('saved'), 700); };

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
        // L'employée (ou l'admin) modifie l'horaire réel.
        // On lit les DEUX sélecteurs réels de la ligne (ce qui est affiché).
        const tr = el.closest('tr');
        const start = tr.querySelector('[data-k="start_time"]').value;
        const end = tr.querySelector('[data-k="end_time"]').value;
        const s = timeToMin(start), f = timeToMin(end);
        if (s != null && f != null && f <= s) { toast("L'heure de fin doit être après le début.", 'error'); return; }
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
          const rs = tr.querySelector('[data-k="start_time"]'); if (rs) rs.value = saved.start_time || '';
          const re = tr.querySelector('[data-k="end_time"]'); if (re) re.value = saved.end_time || '';
        }
        refreshRow(tr, date);
        refreshTotals();
        flashSaved(el);
      } catch (e) {
        console.error('[sheet:save]', e);
        toast('Enregistrement impossible : ' + e.message, 'error');
      }
    });
  });

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
  document.getElementById('pdfBtn').onclick = () => exportSheetPDF(empId).catch((e) => toast('Export impossible : ' + e.message, 'error'));
}

async function currentEmpProfile(id) {
  return (await STORE.listProfiles()).find((p) => p.id === id) || { active: true };
}

/* ---------------- Horaire type (template hebdomadaire) ---------------- */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Lun..Dim
const DOW_FULL = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

function templateHasSlots(tpl) {
  return tpl && Object.values(tpl).some((s) => s && s.start && s.end);
}
function templateCardHTML(tpl, month) {
  const tin = (id, v) => `<select id="${id}" style="width:110px">${timeOptionsHTML(v || '')}</select>`;
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
    try { await STORE.setTemplate(empId, slots); toast('Horaire type enregistré'); render(); }
    catch (e) { document.getElementById('tplMsg').innerHTML = `<div class="msg error">${e.message}</div>`; }
  };

  const apply = document.getElementById('tplApply');
  if (apply) apply.onclick = async () => {
    if (month.status !== 'open') { toast('Mois validé — non modifié', 'error'); return; }
    const tpl = await STORE.getTemplate(empId);
    if (!templateHasSlots(tpl)) { toast("Définis d'abord un horaire type.", 'error'); return; }
    if (!confirm(`Appliquer l'horaire type à ${monthName(CUR.y, CUR.m)} ? Les jours déjà modifiés sont préservés.`)) return;
    await applyTemplate(empId, CUR.y, CUR.m, tpl, false);
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
  for (let d = 1; d <= dim; d++) {
    const w = new Date(y, m - 1, d).getDay();
    const slot = slots[w];
    if (!slot || !slot.start || !slot.end) continue; // jour non travaillé → ignoré
    const date = `${y}-${pad(m)}-${pad(d)}`;
    const dur = Math.max(0, timeToMin(slot.end) - timeToMin(slot.start));
    const ex = existing[date] || {};
    const patch = { employee_id: empId, entry_date: date, planned_start: slot.start, planned_end: slot.end, planned_minutes: dur };
    if (!ex.worked_touched) { patch.start_time = slot.start; patch.end_time = slot.end; patch.worked_minutes = dur; }
    await STORE.upsertEntry(patch);
  }
  if (!silent) { toast('Horaire type appliqué au mois'); render(); }
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
      <td>${{ open: 'En cours', validated: '✓ Validé' }[mo.status] || 'En cours'}</td>
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

/* ---------------- Vue : Enfants (liste nominative + présences) ---------------- */
async function viewChildren() {
  const app = document.getElementById('app');
  const kids = await STORE.listKids();
  const att = await STORE.kidAttendanceForMonth(CUR.y, CUR.m);
  const present = new Set(att.map((a) => a.kid_id + '|' + a.entry_date));
  const dim = daysInMonth(CUR.y, CUR.m);
  const days = [];
  for (let d = 1; d <= dim; d++) {
    const dow = new Date(CUR.y, CUR.m - 1, d).getDay();
    days.push({ d, dow, date: `${CUR.y}-${pad(CUR.m)}-${pad(d)}`, weekend: dow === 0 || dow === 6 });
  }
  const kidPresentCount = (kid) => days.reduce((n, day) => n + (present.has(kid.id + '|' + day.date) ? 1 : 0), 0);
  const dayPresentCount = (day) => kids.reduce((n, k) => n + (present.has(k.id + '|' + day.date) ? 1 : 0), 0);

  // En-têtes des jours (numéro + initiale du jour).
  const headDays = days.map((day) =>
    `<th class="daycol${day.weekend ? ' weekend' : ''}"><div>${day.d}</div><div class="dini">${DOW[day.dow][0]}</div></th>`).join('');

  const kidRows = kids.length ? kids.map((k) => {
    const cells = days.map((day) => {
      const on = present.has(k.id + '|' + day.date);
      return `<td class="daycell${day.weekend ? ' weekend' : ''}">
        <input type="checkbox" class="pres" data-kid="${k.id}" data-date="${day.date}" ${on ? 'checked' : ''}/></td>`;
    }).join('');
    return `<tr>
      <td class="kidname nowrap">${k.last_name ? k.last_name.toUpperCase() + ' ' : ''}${k.first_name}
        <button class="linkx" data-arch="${k.id}" title="Retirer de la liste">✕</button></td>
      ${cells}
      <td class="kidtot"><strong id="kidtot_${k.id}">${kidPresentCount(k)}</strong></td>
    </tr>`;
  }).join('') : `<tr><td colspan="${dim + 2}" class="muted" style="padding:16px">Aucun enfant. Ajoutez-en ci-dessus.</td></tr>`;

  const footCells = days.map((day) => `<td class="daycell${day.weekend ? ' weekend' : ''}"><strong id="daytot_${day.d}">${dayPresentCount(day)}</strong></td>`).join('');

  app.innerHTML = `${await toolbar(false)}
    <div class="card">
      <h2>🧒 Présences des enfants — ${monthName(CUR.y, CUR.m)}</h2>
      <div class="row" style="align-items:end; max-width:560px">
        <div><label>Prénom</label><input id="kFirst" placeholder="Prénom"/></div>
        <div><label>Nom</label><input id="kLast" placeholder="Nom"/></div>
        <div style="flex:0"><label>&nbsp;</label><button id="kAdd">+ Ajouter</button></div>
      </div>
      <div id="kMsg"></div>
      <p class="muted small">Cochez les jours de présence de chaque enfant. Une case décochée un jour d'ouverture = absence.</p>
      <div class="table-wrap" style="margin-top:8px"><table class="attend">
        <thead><tr><th class="kidname">Enfant</th>${headDays}<th class="kidtot">Prés.</th></tr></thead>
        <tbody>${kidRows}</tbody>
        <tfoot><tr><td class="kidname">Total / jour</td>${footCells}<td class="kidtot"><strong>${att.length}</strong></td></tr></tfoot>
      </table></div>
      <p class="muted small">« Prés. » = nombre de jours de présence de l'enfant ce mois-ci. La moyenne annuelle est dans l'onglet 📈 Statistiques.</p>
    </div>`;
  wireToolbar();

  // Ajout d'un enfant.
  document.getElementById('kAdd').onclick = async () => {
    const msg = document.getElementById('kMsg');
    try {
      await STORE.addKid(document.getElementById('kFirst').value, document.getElementById('kLast').value);
      toast('Enfant ajouté'); render();
    } catch (e) { msg.innerHTML = `<div class="msg error">${e.message}</div>`; }
  };
  // Retirer un enfant (archivage : données conservées).
  app.querySelectorAll('[data-arch]').forEach((b) => b.onclick = async () => {
    if (!confirm('Retirer cet enfant de la liste ? (ses présences passées restent comptées)')) return;
    try { await STORE.setKidActive(b.dataset.arch, false); toast('Enfant retiré'); render(); }
    catch (e) { toast('Erreur : ' + e.message, 'error'); }
  });
  // Cocher/décocher une présence — sans re-rendu (mise à jour ciblée des totaux).
  app.querySelectorAll('input.pres').forEach((el) => el.addEventListener('change', async () => {
    const kid = el.dataset.kid, date = el.dataset.date, on = el.checked;
    const key = kid + '|' + date;
    if (on) present.add(key); else present.delete(key);
    // Totaux ligne + colonne + total général, en place.
    const dNum = Number(date.slice(8));
    const kt = document.getElementById('kidtot_' + kid); if (kt) kt.textContent = kids.reduce ? days.reduce((n, day) => n + (present.has(kid + '|' + day.date) ? 1 : 0), 0) : 0;
    const dt = document.getElementById('daytot_' + dNum); if (dt) dt.textContent = kids.reduce((n, k) => n + (present.has(k.id + '|' + date) ? 1 : 0), 0);
    try { await STORE.setKidPresence(kid, date, on); }
    catch (e) { el.checked = !on; if (on) present.delete(key); else present.add(key); toast('Erreur : ' + e.message, 'error'); }
  }));
}

/* ---------------- Vue : Statistiques (graphiques) ---------------- */
async function viewStats() {
  const app = document.getElementById('app');
  const all = await STORE.allChildren();
  const inYear = all.filter((c) => (c.entry_date || '').startsWith(`${CUR.y}-`));
  const annualTotal = inYear.reduce((s, c) => s + (Number(c.children) || 0), 0);
  const dailyYear = inYear.length ? annualTotal / inYear.length : 0;

  // Détail mois par mois (moyenne / total / jours encodés).
  const months = [];
  for (let mm = 1; mm <= 12; mm++) {
    const arr = inYear.filter((c) => c.entry_date.startsWith(`${CUR.y}-${pad(mm)}`));
    const tot = arr.reduce((s, c) => s + (Number(c.children) || 0), 0);
    months.push({
      short: new Date(CUR.y, mm - 1, 1).toLocaleDateString('fr-FR', { month: 'short' }),
      long: new Date(CUR.y, mm - 1, 1).toLocaleDateString('fr-FR', { month: 'long' }),
      days: arr.length, total: tot, avg: arr.length ? tot / arr.length : 0,
    });
  }
  const stats = { dailyYear, annualTotal, annualDays: inYear.length, year: CUR.y };

  app.innerHTML = `${await toolbar(false)}
    <div class="card">
      <div class="row-between">
        <h2 style="margin:0">📈 Statistiques — année ${CUR.y}</h2>
        <button class="small" id="statsPdfBtn">🖨️ Export PDF</button>
      </div>
      <div class="hero-stat">
        <div class="big">${dailyYear.toFixed(1)}</div>
        <div class="lbl2">enfants en moyenne <strong>par jour</strong> sur l'année ${CUR.y}</div>
        <div class="muted small">${annualTotal} enfants encodés · ${inYear.length} jour(s) avec encodage</div>
      </div>
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

  if (!window.Chart) {
    const c = document.getElementById('chartMonthly');
    if (c) c.replaceWith(Object.assign(document.createElement('p'), { className: 'muted small', textContent: 'Graphique indisponible hors ligne — voir le tableau ci-dessous.' }));
    document.getElementById('statsPdfBtn').onclick = () => exportStatsPDF(stats, null, null);
    return;
  }
  const chartMonthly = new Chart(document.getElementById('chartMonthly'), {
    type: 'bar',
    data: { labels: months.map((m) => m.short), datasets: [{ label: 'Moyenne/jour', data: months.map((m) => +m.avg.toFixed(1)), backgroundColor: '#2f9e44' }] },
    options: { animation: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
  });
  document.getElementById('statsPdfBtn').onclick = () => exportStatsPDF(stats, null, chartMonthly);
}

/* ---------------- Export PDF des statistiques ANNUELLES ---------------- */
// N'inclut que les statistiques de l'année : moyenne annuelle, total, et le
// graphique de moyenne mensuelle sur l'année.
async function exportStatsPDF(stats, chartDaily, chartMonthly) {
  // Repli impression si jsPDF absent (hors ligne).
  if (!window.jspdf) {
    const w = window.open('', '_blank');
    w.document.write(`<img src="assets/logo.svg" style="height:60px"><h2>Statistiques annuelles ${stats.year} — Fréquentation</h2>
      <ul>
        <li>Moyenne journalière (année) : <b>${stats.dailyYear.toFixed(1)}</b> enfants</li>
        <li>Total enfants sur l'année : <b>${stats.annualTotal}</b> (sur ${stats.annualDays} jours encodés)</li>
      </ul>
      ${chartMonthly ? `<img src="${chartMonthly.toBase64Image()}" style="max-width:100%"/>` : ''}
      <button onclick="print()">Imprimer</button>`);
    w.document.close(); return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  let y = await pdfHeader(doc, 'Statistiques annuelles de fréquentation', `Année ${stats.year}`);

  doc.autoTable({
    startY: y,
    head: [['Indicateur (année ' + stats.year + ')', 'Valeur']],
    body: [
      ['Moyenne journalière', stats.dailyYear.toFixed(1) + ' enfants'],
      ['Total sur l\'année', stats.annualTotal + ' enfants'],
      ['Jours encodés', String(stats.annualDays)],
    ],
    styles: { fontSize: 11 }, headStyles: { fillColor: [59, 91, 219] },
  });
  y = doc.lastAutoTable.finalY + 10;

  if (chartMonthly) {
    doc.setTextColor(0); doc.setFontSize(12);
    doc.text(`Moyenne d'enfants par jour, mois par mois — ${stats.year}`, 14, y); y += 4;
    doc.addImage(chartMonthly.toBase64Image('image/png', 1), 'PNG', 14, y, 180, 180 * 0.42);
  }
  doc.save(`statistiques_annuelles_${stats.year}.pdf`);
}

/* ---------------- Vue : Utilisateurs (admin) ---------------- */
async function viewEmployees() {
  const app = document.getElementById('app');
  const profs = await STORE.listProfiles();
  const roleLbl = (r) => (r === 'admin' ? 'Administrateur' : 'Employée');
  const rows = profs.map((p) => {
    const activeBtn = p.role === 'employee'
      ? (p.active ? `<button class="small red" data-arch="${p.id}">Archiver</button>`
                  : `<button class="small green" data-react="${p.id}">Réactiver</button>`)
      : '';
    return `<tr>
      <td>${p.full_name}</td>
      <td class="nowrap">${p.email || '—'} <button class="small gray" data-email="${p.id}" title="Modifier l'email">✏️</button></td>
      <td><span class="badge ${p.role === 'admin' ? 'validated' : 'open'}">${roleLbl(p.role)}</span></td>
      <td>${p.active ? '<span class="badge validated">Actif</span>' : '<span class="badge refused">Archivé</span>'}</td>
      <td class="nowrap">
        <button class="small" data-reset="${p.id}">✉️ Réinit. mot de passe</button>
        ${activeBtn}
      </td>
    </tr>`;
  }).join('');
  app.innerHTML = `<div class="card">
      <div class="row-between"><h2>👥 Utilisateurs</h2><button class="small" id="addBtn">+ Ajouter un utilisateur</button></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Nom</th><th>Email</th><th>Rôle</th><th>Statut</th><th>Actions</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <p class="muted small">
        🔒 Le rôle <strong>Administrateur est fixe</strong> : une employée ne peut pas être promue admin.
        « ✏️ » modifie l'email ; « ✉️ » envoie un email de réinitialisation du mot de passe.
        Archiver conserve les données en lecture seule.
        ${MODE === 'cloud' ? "En cloud, l'email modifié sert de contact/réinitialisation." : ''}
      </p>
    </div>
    <div class="card hidden" id="addForm">
      <h3>Nouvel utilisateur</h3>
      <div class="row">
        <div><label>Nom complet</label><input id="nName" placeholder="Prénom Nom"/></div>
        <div><label>Email</label><input id="nEmail" type="email" placeholder="prenom@ecole.be"/></div>
        <div><label>Mot de passe initial</label><input id="nPwd" placeholder="au moins 6 caractères"/></div>
      </div>
      <div id="addMsg"></div>
      <p class="muted small">Les nouveaux comptes sont créés comme <strong>Employée</strong>. Le rôle admin est réservé et contrôlé.
        ${MODE === 'cloud' ? "En cloud, la création peut vous déconnecter (limite Supabase) ; reconnectez-vous si besoin." : ''}</p>
      <button id="saveEmp" style="margin-top:10px">Créer</button>
    </div>`;

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
    if (MODE !== 'cloud') { toast("Envoi d'email disponible uniquement en mode cloud.", 'error'); return; }
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
      fmtHM(worked - planned), e.justification || '']);
  }

  if (!window.jspdf) { // fallback impression
    const w = window.open('', '_blank');
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
async function doLogout() {
  try { await STORE.signOut(); } catch (e) { console.error('[logout]', e); }
  ME = null; location.reload();
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
  document.getElementById('logoutBtn').onclick = doLogout;
  boot().catch((e) => { console.error('[boot]', e); showFatal((e && e.message) || 'Démarrage impossible.'); });
});
