/* ------------------------------------------------------------------
 * Pointeuse - VERSION SANS SERVEUR (GitHub Pages)
 * ------------------------------------------------------------------
 * Toutes les données sont stockées dans le navigateur (localStorage).
 * La fonction api() reproduit exactement les mêmes réponses que
 * l'ancien serveur Node : les pages HTML n'ont donc pas besoin de changer.
 *
 * ⚠️ Les données sont LOCALES à ce navigateur/appareil : elles ne sont
 *    pas partagées entre plusieurs ordinateurs ou téléphones.
 * ------------------------------------------------------------------ */

/* ---------------- Base de données locale ---------------- */

const DB_KEY = 'pointeuse_db';

// Données par défaut créées à la première utilisation.
const DEFAULT_DB = {
  users: [
    { id: 'emp1',  name: 'Employée 1', role: 'employee', pin: '1111' },
    { id: 'emp2',  name: 'Employée 2', role: 'employee', pin: '2222' },
    { id: 'admin', name: 'Admin',      role: 'admin',    pin: '0000' },
  ],
  schedules: {
    emp1: { start: '14:00', end: '18:00', days: [1, 2, 3, 4, 5] },
    emp2: { start: '14:00', end: '18:00', days: [1, 2, 3, 4, 5] },
  },
  punches: [],
};

function loadDB() {
  const raw = localStorage.getItem(DB_KEY);
  if (!raw) {
    const fresh = JSON.parse(JSON.stringify(DEFAULT_DB));
    localStorage.setItem(DB_KEY, JSON.stringify(fresh));
    return fresh;
  }
  try {
    return JSON.parse(raw);
  } catch {
    const fresh = JSON.parse(JSON.stringify(DEFAULT_DB));
    localStorage.setItem(DB_KEY, JSON.stringify(fresh));
    return fresh;
  }
}

function saveDB(db) {
  localStorage.setItem(DB_KEY, JSON.stringify(db));
}

// Réinitialise complètement les données.
function resetDB() {
  localStorage.removeItem(DB_KEY);
  loadDB();
}

/* ---------------- Session ---------------- */

function getSession() {
  try {
    return JSON.parse(localStorage.getItem('pointeuse_session') || 'null');
  } catch {
    return null;
  }
}
function setSession(s) {
  localStorage.setItem('pointeuse_session', JSON.stringify(s));
}
function clearSession() {
  localStorage.removeItem('pointeuse_session');
}

/* ---------------- Utilitaires temps ---------------- */

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
function weekday(dateStr) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  return new Date(y, mo - 1, d).getDay();
}
function minutesOutsideSchedule(dateStr, clockIn, clockOut, schedule) {
  const inMin = toMinutes(clockIn);
  const outMin = toMinutes(clockOut);
  const worked = Math.max(0, outMin - inMin);
  if (!schedule || !schedule.days.includes(weekday(dateStr))) return worked;
  const sStart = toMinutes(schedule.start);
  const sEnd = toMinutes(schedule.end);
  let outside = 0;
  if (inMin < sStart) outside += Math.min(outMin, sStart) - inMin;
  if (outMin > sEnd) outside += outMin - Math.max(inMin, sEnd);
  return Math.max(0, outside);
}
function nowParts() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}
function workedMinutes(p) {
  if (!p.clockIn || !p.clockOut) return 0;
  return Math.max(0, toMinutes(p.clockOut) - toMinutes(p.clockIn));
}
function uuid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}

/* ------------------------------------------------------------------
 * api() : même signature et mêmes réponses que l'ancien serveur,
 * mais tout se passe en local. Renvoie { status, data }.
 * ------------------------------------------------------------------ */

async function api(path, method = 'GET', body = null) {
  const db = loadDB();
  const url = new URL(path, location.origin);
  const route = url.pathname;
  const params = url.searchParams;

  const findUser = (id) => db.users.find((u) => u.id === id);
  const ok = (data) => ({ status: 200, data });
  const err = (status, error, extra = {}) => ({ status, data: { error, ...extra } });

  /* ---- Routes publiques ---- */

  if (route === '/api/login' && method === 'POST') {
    const user = db.users.find(
      (u) => u.id === body.userId && String(u.pin) === String(body.pin)
    );
    if (!user) return err(401, 'Identifiant ou code PIN incorrect.');
    return ok({
      token: uuid(),
      user: { id: user.id, name: user.name, role: user.role },
    });
  }

  if (route === '/api/users' && method === 'GET') {
    return ok({
      users: db.users.map((u) => ({ id: u.id, name: u.name, role: u.role })),
    });
  }

  /* ---- À partir d'ici : session requise ---- */
  const session = getSession();
  const me = session && session.user ? findUser(session.user.id) : null;
  if (!me) return err(401, 'Non authentifié.');

  if (route === '/api/logout' && method === 'POST') return ok({ ok: true });

  if (route === '/api/me' && method === 'GET') {
    return ok({
      user: { id: me.id, name: me.name, role: me.role },
      schedule: db.schedules[me.id] || null,
    });
  }

  /* ---- Espace employée ---- */

  if (route === '/api/clock/status' && method === 'GET') {
    const open = db.punches.find((p) => p.userId === me.id && !p.clockOut);
    return ok({ open: open || null });
  }

  if (route === '/api/clock/in' && method === 'POST') {
    if (me.role !== 'employee') return err(403, 'Réservé aux employées.');
    if (db.punches.find((p) => p.userId === me.id && !p.clockOut))
      return err(409, 'Un pointage est déjà en cours.');
    const { date, time } = nowParts();
    const punch = {
      id: uuid(), userId: me.id, date, clockIn: time, clockOut: null,
      status: 'open', type: null, justification: '', deviationMinutes: 0,
    };
    db.punches.push(punch);
    saveDB(db);
    return ok({ punch });
  }

  if (route === '/api/clock/out' && method === 'POST') {
    if (me.role !== 'employee') return err(403, 'Réservé aux employées.');
    const punch = db.punches.find((p) => p.userId === me.id && !p.clockOut);
    if (!punch) return err(409, 'Aucun pointage en cours.');
    const { time } = nowParts();
    const deviation = minutesOutsideSchedule(
      punch.date, punch.clockIn, time, db.schedules[me.id]
    );
    if (deviation > 5) {
      const justif = ((body && body.justification) || '').trim();
      if (!justif) {
        return err(
          422,
          "Vous pointez en dehors de l'horaire imposé (" + deviation +
            ' min). Une justification est obligatoire.',
          { needJustification: true, deviationMinutes: deviation }
        );
      }
      punch.clockOut = time;
      punch.deviationMinutes = deviation;
      punch.justification = justif;
      punch.status = 'pending';
      punch.type = null;
    } else {
      punch.clockOut = time;
      punch.deviationMinutes = 0;
      punch.status = 'normal';
    }
    saveDB(db);
    return ok({ punch });
  }

  if (route === '/api/my-punches' && method === 'GET') {
    const list = db.punches
      .filter((p) => p.userId === me.id)
      .map((p) => ({ ...p, workedMinutes: workedMinutes(p) }))
      .sort((a, b) => (a.date + a.clockIn < b.date + b.clockIn ? 1 : -1));
    return ok({ punches: list });
  }

  /* ---- Espace admin ---- */

  if (route.startsWith('/api/admin/')) {
    if (me.role !== 'admin') return err(403, 'Accès administrateur requis.');

    if (route === '/api/admin/punches' && method === 'GET') {
      const userId = params.get('userId');
      const from = params.get('from');
      const to = params.get('to');
      let list = db.punches.slice();
      if (userId) list = list.filter((p) => p.userId === userId);
      if (from) list = list.filter((p) => p.date >= from);
      if (to) list = list.filter((p) => p.date <= to);
      list = list
        .map((p) => ({
          ...p,
          workedMinutes: workedMinutes(p),
          userName: (findUser(p.userId) || {}).name,
        }))
        .sort((a, b) => (a.date + a.clockIn < b.date + b.clockIn ? 1 : -1));
      return ok({ punches: list });
    }

    if (route === '/api/admin/pending' && method === 'GET') {
      const list = db.punches
        .filter((p) => p.status === 'pending')
        .map((p) => ({
          ...p,
          workedMinutes: workedMinutes(p),
          userName: (findUser(p.userId) || {}).name,
        }))
        .sort((a, b) => (a.date < b.date ? 1 : -1));
      return ok({ punches: list });
    }

    if (route === '/api/admin/validate' && method === 'POST') {
      const punch = db.punches.find((p) => p.id === body.punchId);
      if (!punch) return err(404, 'Pointage introuvable.');
      if (body.decision === 'validate') {
        punch.status = 'validated';
        punch.type = body.type === 'recovery' ? 'recovery' : 'overtime';
      } else if (body.decision === 'refuse') {
        punch.status = 'refused';
        punch.type = null;
      } else {
        return err(400, 'Décision invalide.');
      }
      saveDB(db);
      return ok({ punch });
    }

    if (route === '/api/admin/schedules' && method === 'GET') {
      return ok({
        schedules: db.schedules,
        users: db.users
          .filter((u) => u.role === 'employee')
          .map((u) => ({ id: u.id, name: u.name })),
      });
    }

    if (route === '/api/admin/schedule' && method === 'POST') {
      const target = db.users.find(
        (u) => u.id === body.userId && u.role === 'employee'
      );
      if (!target) return err(404, 'Employée introuvable.');
      db.schedules[body.userId] = {
        start: body.start || '14:00',
        end: body.end || '18:00',
        days: Array.isArray(body.days) ? body.days.map(Number) : [1, 2, 3, 4, 5],
      };
      saveDB(db);
      return ok({ schedule: db.schedules[body.userId] });
    }

    if (route === '/api/admin/edit-punch' && method === 'POST') {
      const punch = db.punches.find((p) => p.id === body.punchId);
      if (!punch) return err(404, 'Pointage introuvable.');
      if (body.clockIn) punch.clockIn = body.clockIn;
      if (body.clockOut !== undefined) punch.clockOut = body.clockOut;
      if (body.status) punch.status = body.status;
      if (body.type !== undefined) punch.type = body.type;
      if (punch.clockIn && punch.clockOut) {
        punch.deviationMinutes = minutesOutsideSchedule(
          punch.date, punch.clockIn, punch.clockOut, db.schedules[punch.userId]
        );
      }
      saveDB(db);
      return ok({ punch });
    }

    if (route === '/api/admin/stats' && method === 'GET') {
      const stats = {};
      db.users
        .filter((u) => u.role === 'employee')
        .forEach((u) => {
          stats[u.id] = {
            name: u.name, workedMinutes: 0, overtimeMinutes: 0,
            recoveryMinutes: 0, pendingCount: 0,
          };
        });
      db.punches.forEach((p) => {
        const s = stats[p.userId];
        if (!s) return;
        if (p.clockOut && p.status !== 'refused') s.workedMinutes += workedMinutes(p);
        if (p.status === 'validated' && p.type === 'overtime') s.overtimeMinutes += p.deviationMinutes;
        if (p.status === 'validated' && p.type === 'recovery') s.recoveryMinutes += p.deviationMinutes;
        if (p.status === 'pending') s.pendingCount += 1;
      });
      return ok({ stats });
    }
  }

  return err(404, 'Route inconnue.');
}

/* ---------------- Garde d'accès ---------------- */

function requireRole(role) {
  const s = getSession();
  if (!s || !s.user) {
    location.href = 'index.html';
    return null;
  }
  if (role && s.user.role !== role) {
    location.href = s.user.role === 'admin' ? 'admin.html' : 'employee.html';
    return null;
  }
  return s;
}

async function logout() {
  clearSession();
  location.href = 'index.html';
}

/* ---------------- Formatage / affichage ---------------- */

function fmtMinutes(min) {
  min = Math.round(min || 0);
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h${String(m).padStart(2, '0')}`;
}

const DAYS_FR = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

function statusBadge(p) {
  const labels = {
    open: 'En cours', normal: 'Normal', pending: 'En attente',
    validated: 'Validé', refused: 'Refusé',
  };
  return `<span class="badge ${p.status}">${labels[p.status] || p.status}</span>`;
}

function typeBadge(type) {
  if (type === 'overtime') return '<span class="badge overtime">Heures sup.</span>';
  if (type === 'recovery') return '<span class="badge recovery">Récupération</span>';
  return '';
}
