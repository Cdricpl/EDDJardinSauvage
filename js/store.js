/* ------------------------------------------------------------------
 * store.js — Couche de données unifiée.
 *
 * Expose un objet `Store` avec la même interface, que l'on soit :
 *   - en MODE FIREBASE (Firestore) si config.js contient FIREBASE_CONFIG
 *   - en MODE DÉMO     (localStorage) sinon — pour tester sans hébergement
 *
 * Toutes les méthodes sont asynchrones (retournent des promesses), pour que
 * le reste de l'application soit identique dans les deux modes.
 * ------------------------------------------------------------------ */

const HAS_FIREBASE =
  window.APP_CONFIG &&
  window.APP_CONFIG.FIREBASE_CONFIG &&
  window.APP_CONFIG.FIREBASE_CONFIG.apiKey &&
  window.APP_CONFIG.FIREBASE_CONFIG.projectId;

/* ================================================================
 * Utilitaires partagés
 * ================================================================ */
const Util = {
  ym(date) { const [y, m] = date.split('-').map(Number); return { y, m }; },
  pad(n) { return String(n).padStart(2, '0'); },
  monthKey(y, m) { return `${y}-${Util.pad(m)}`; },
  minToTimeSafe(min) { return `${Util.pad(Math.floor(min / 60))}:${Util.pad(min % 60)}`; },
  daysInMonth(y, m) { return new Date(y, m, 0).getDate(); },
  today() {
    const d = new Date();
    return `${d.getFullYear()}-${Util.pad(d.getMonth() + 1)}-${Util.pad(d.getDate())}`;
  },
  uuid() {
    return (crypto && crypto.randomUUID) ? crypto.randomUUID()
      : 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  },
};

/* ================================================================
 * MODE DÉMO — localStorage
 * ================================================================ */
class DemoStore {
  constructor() {
    this.KEY = 'ecole_db';
    this.SESSION = 'ecole_session';
    this._seed();
  }

  _seed() {
    if (localStorage.getItem(this.KEY)) return;
    const adminId = 'u-admin', e1 = 'u-flora', e2 = 'u-sarah';
    const db = {
      profiles: [
        { id: adminId, full_name: 'Admin',      email: 'admin@ecole.be', password: 'admin123', role: 'admin',    active: true },
        { id: e1,      full_name: 'Employée 1',  email: 'flora@ecole.be', password: 'flora123', role: 'employee', active: true },
        { id: e2,      full_name: 'Employée 2',  email: 'sarah@ecole.be', password: 'sarah123', role: 'employee', active: true },
      ],
      months: [],       // { employee_id, year, month, status }
      entries: [],      // { id, employee_id, entry_date, planned_*, start_time, end_time, worked_minutes, justification }
      kids: [           // liste nominative des enfants
        { id: 'k1', first_name: 'Lucas', last_name: 'Martin', active: true },
        { id: 'k2', first_name: 'Emma', last_name: 'Bernard', active: true },
        { id: 'k3', first_name: 'Noah', last_name: 'Dubois', active: true },
      ],
      kidatt: [],       // présences : { kid_id, entry_date }
      // Horaire type hebdomadaire par employée : slots[weekday] = {start,end} (0=Dim..6=Sam)
      templates: [
        { employee_id: e1, slots: { 1: { start: '14:00', end: '18:00' }, 2: { start: '14:00', end: '18:00' }, 3: { start: '14:00', end: '18:00' }, 4: { start: '14:00', end: '18:00' }, 5: { start: '14:00', end: '18:00' } } },
        { employee_id: e2, slots: { 1: { start: '14:00', end: '18:00' }, 2: { start: '14:00', end: '18:00' }, 3: { start: '14:00', end: '18:00' }, 4: { start: '14:00', end: '18:00' }, 5: { start: '14:00', end: '18:00' } } },
      ],
    };
    // Quelques données d'exemple sur le mois courant (pour les stats/graphiques).
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth() + 1;
    const dim = Util.daysInMonth(y, m);
    for (let d = 1; d <= Math.min(dim, now.getDate()); d++) {
      const date = `${y}-${Util.pad(m)}-${Util.pad(d)}`;
      const dow = new Date(y, m - 1, d).getDay();
      if (dow === 0 || dow === 6) continue; // week-end
      [e1, e2].forEach((emp, i) => {
        // Horaire prévu par l'admin : 14:00–18:00 (4h).
        const pStart = '14:00', pEnd = '18:00', planned = 240;
        // Certains jours diffèrent (horaire réel modifié) ; les autres sont pré-remplis.
        const extra = (d % 5 === 0 ? 30 : 0) - (d % 7 === 0 ? 15 : 0);
        const touched = extra !== 0;
        const end = touched ? Util.minToTimeSafe(18 * 60 + extra) : pEnd;
        const start = pStart;
        const worked = touched ? planned + extra : planned;
        db.entries.push({
          id: Util.uuid(), employee_id: emp, entry_date: date,
          planned_start: pStart, planned_end: pEnd, planned_minutes: planned,
          start_time: start, end_time: end, worked_minutes: worked,
          worked_touched: touched,
          justification: touched ? 'Activité prolongée' : '',
        });
      });
      // Présences d'exemple : chaque enfant présent la plupart des jours (avec quelques absences).
      db.kids.forEach((k, ki) => {
        if ((d + ki) % 6 !== 0) db.kidatt.push({ kid_id: k.id, entry_date: date }); // ~1 absence / 6 jours
      });
    }
    localStorage.setItem(this.KEY, JSON.stringify(db));
  }

  _db() { return JSON.parse(localStorage.getItem(this.KEY)); }
  _save(db) {
    localStorage.setItem(this.KEY, JSON.stringify(db));
    // Notifie les autres onglets (simulation "temps réel").
    localStorage.setItem('ecole_ping', String(Date.now()));
  }
  _session() { try { return JSON.parse(localStorage.getItem(this.SESSION) || 'null'); } catch { return null; } }

  async init() {}

  /* ---- Auth ---- */
  async signIn(email, password) {
    const db = this._db();
    const u = db.profiles.find(p => p.email === email && p.password === password);
    if (!u) throw new Error('Email ou mot de passe incorrect.');
    localStorage.setItem(this.SESSION, JSON.stringify(u));
    return u;
  }
  async signOut() { localStorage.removeItem(this.SESSION); }
  async getCurrentUser() {
    const s = this._session(); if (!s) return null;
    // relit le profil (rôle/active à jour)
    return this._db().profiles.find(p => p.id === s.id) || null;
  }

  /* ---- Profils ---- */
  async listProfiles() { return this._db().profiles.slice(); }
  async addProfile({ full_name, email, password, role }) {
    const db = this._db();
    if (db.profiles.some(p => p.email === email)) throw new Error('Cet email existe déjà.');
    const prof = { id: Util.uuid(), full_name, email, password: password || 'changeme', role: role || 'employee', active: true };
    db.profiles.push(prof);
    this._save(db);
    return prof;
  }
  async setActive(id, active) {
    const db = this._db();
    const p = db.profiles.find(x => x.id === id);
    if (p) { p.active = active; this._save(db); }
  }
  async setRole(id, role) {
    if (role !== 'admin' && role !== 'employee') throw new Error('Rôle invalide.');
    const db = this._db();
    const p = db.profiles.find(x => x.id === id);
    if (p) { p.role = role; this._save(db); }
  }

  /* ---- Horaire type ---- */
  async getTemplate(employee_id) {
    const db = this._db();
    const t = (db.templates || []).find(x => x.employee_id === employee_id);
    return t ? t.slots : {};
  }
  async setTemplate(employee_id, slots) {
    const db = this._db();
    db.templates = db.templates || [];
    let t = db.templates.find(x => x.employee_id === employee_id);
    if (!t) { t = { employee_id, slots }; db.templates.push(t); }
    t.slots = slots;
    this._save(db);
  }

  /* ---- Email / mot de passe ---- */
  async setEmail(id, email) {
    const db = this._db();
    email = (email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Adresse email invalide.');
    if (db.profiles.some(p => p.email === email && p.id !== id)) throw new Error('Cet email est déjà utilisé.');
    const p = db.profiles.find(x => x.id === id);
    if (p) { p.email = email; this._save(db); }
  }
  async setFullName(id, full_name) {
    full_name = (full_name || '').trim();
    if (!full_name) throw new Error('Le nom ne peut pas être vide.');
    const db = this._db();
    const p = db.profiles.find(x => x.id === id);
    if (p) { p.full_name = full_name; this._save(db); }
  }
  async sendPasswordReset(email) {
    // Pas d'envoi d'email possible en mode démo.
    throw new Error("Envoi d'email indisponible en mode démo (fonctionne en mode cloud).");
  }

  /* ---- Mois ---- */
  async getMonth(employee_id, year, month) {
    return this._db().months.find(x => x.employee_id === employee_id && x.year === year && x.month === month)
      || { employee_id, year, month, status: 'open' };
  }
  async setMonthStatus(employee_id, year, month, status) {
    const db = this._db();
    let mo = db.months.find(x => x.employee_id === employee_id && x.year === year && x.month === month);
    if (!mo) { mo = { employee_id, year, month, status: 'open' }; db.months.push(mo); }
    mo.status = status;
    this._save(db);
    return mo;
  }

  /* ---- Prestations ---- */
  async entriesForMonth(employee_id, year, month) {
    const prefix = Util.monthKey(year, month);
    return this._db().entries.filter(e => e.employee_id === employee_id && e.entry_date.startsWith(prefix));
  }
  async entriesForEmployee(employee_id) {
    return this._db().entries.filter(e => e.employee_id === employee_id);
  }
  _applyEntry(db, entry) {
    let e = db.entries.find(x => x.employee_id === entry.employee_id && x.entry_date === entry.entry_date);
    if (!e) {
      e = { id: Util.uuid(), employee_id: entry.employee_id, entry_date: entry.entry_date,
            planned_start: '', planned_end: '', planned_minutes: 0, worked_minutes: 0,
            start_time: '', end_time: '', worked_touched: false, justification: '' };
      db.entries.push(e);
    }
    ['planned_start', 'planned_end', 'planned_minutes', 'worked_minutes', 'start_time',
     'end_time', 'worked_touched', 'justification'].forEach(k => {
      if (entry[k] !== undefined) e[k] = entry[k];
    });
    return e;
  }
  async upsertEntry(entry) {
    const db = this._db();
    const e = this._applyEntry(db, entry);
    this._save(db);
    return e;
  }
  // Écriture groupée (un seul enregistrement) — utilisé par le pré-remplissage.
  async upsertEntries(entries) {
    const db = this._db();
    const out = (entries || []).map((entry) => this._applyEntry(db, entry));
    this._save(db);
    return out;
  }

  /* ---- Enfants (liste nominative + présences) ---- */
  async listKids(includeArchived = false) {
    return this._db().kids
      .filter(k => includeArchived || k.active)
      .sort((a, b) => (a.last_name + a.first_name).localeCompare(b.last_name + b.first_name));
  }
  async addKid(first_name, last_name, school, birthdate, days, grade) {
    const db = this._db();
    const k = { id: Util.uuid(), first_name: (first_name || '').trim(), last_name: (last_name || '').trim(),
      school: school || '', birthdate: birthdate || '', grade: grade || '',
      days: Array.isArray(days) ? days : [], active: true };
    if (!k.first_name) throw new Error('Le prénom est requis.');
    db.kids.push(k); this._save(db); return k;
  }
  async setKidInfo(id, info) {
    const first = (info.first_name || '').trim();
    if (!first) throw new Error('Le prénom est requis.');
    const db = this._db();
    const k = db.kids.find(x => x.id === id);
    if (k) { k.first_name = first; k.last_name = (info.last_name || '').trim();
      k.school = info.school || ''; k.birthdate = info.birthdate || '';
      k.grade = info.grade || '';
      if (Array.isArray(info.days)) k.days = info.days;
      this._save(db); }
  }
  // Charge une liste d'enfants SANS rien supprimer : les fiches déjà présentes
  // (même identifiant) sont mises à jour, les autres ajoutées. Rejouable sans
  // créer de doublon.
  async importKids(list) {
    const db = this._db();
    let ajoutes = 0, misAJour = 0;
    (list || []).forEach((k) => {
      const fiche = {
        id: String(k.id), first_name: (k.first_name || '').trim(), last_name: (k.last_name || '').trim(),
        school: k.school || '', birthdate: k.birthdate || '', grade: k.grade || '',
        days: Array.isArray(k.days) ? k.days : [], active: k.active !== false,
      };
      const i = db.kids.findIndex((x) => x.id === fiche.id);
      if (i >= 0) { db.kids[i] = { ...db.kids[i], ...fiche }; misAJour++; }
      else { db.kids.push(fiche); ajoutes++; }
    });
    this._save(db);
    return { ajoutes, misAJour };
  }
  async setKidActive(id, active) {
    const db = this._db();
    const k = db.kids.find(x => x.id === id);
    if (k) { k.active = active; this._save(db); }
  }
  async kidAttendanceForMonth(year, month) {
    const prefix = Util.monthKey(year, month);
    return this._db().kidatt.filter(a => a.entry_date.startsWith(prefix));
  }
  async kidAttendanceForYear(year) {
    return this._db().kidatt.filter(a => (a.entry_date || '').startsWith(`${year}-`));
  }
  async allEntriesForYear(year) {
    return this._db().entries.filter(e => (e.entry_date || '').startsWith(`${year}-`));
  }
  // status : 'present' | 'absent' | null (efface l'enregistrement).
  async setKidAttendance(kid_id, entry_date, status) {
    const db = this._db();
    const i = db.kidatt.findIndex(a => a.kid_id === kid_id && a.entry_date === entry_date);
    if (!status) { if (i >= 0) db.kidatt.splice(i, 1); }
    else if (i >= 0) db.kidatt[i].status = status;
    else db.kidatt.push({ kid_id, entry_date, status });
    this._save(db);
  }
  // Écriture groupée (pré-remplissage des présences habituelles).
  async setKidAttendances(list) {
    const db = this._db();
    (list || []).forEach(({ kid_id, entry_date, status }) => {
      const i = db.kidatt.findIndex(a => a.kid_id === kid_id && a.entry_date === entry_date);
      if (!status) { if (i >= 0) db.kidatt.splice(i, 1); }
      else if (i >= 0) db.kidatt[i].status = status;
      else db.kidatt.push({ kid_id, entry_date, status });
    });
    this._save(db);
  }
  // Comptes agrégés par jour (enfants PRÉSENTS) — pour les statistiques.
  async allChildren() {
    const byDate = {};
    this._db().kidatt.forEach(a => {
      if (a.status === 'absent') return; // absence = pas comptée
      byDate[a.entry_date] = (byDate[a.entry_date] || 0) + 1;
    });
    return Object.entries(byDate).map(([entry_date, children]) => ({ entry_date, children }));
  }

  /* ---- Export / sauvegarde ---- */
  async exportAll() {
    const db = this._db();
    return {
      exported_at: new Date().toISOString(), mode: 'demo',
      profiles: (db.profiles || []).map(({ password, ...p }) => p), // jamais les mots de passe
      months: db.months || [], day_entries: db.entries || [],
      schedule_templates: db.templates || [],
      kids: db.kids || [], kid_attendance: db.kidatt || [],
    };
  }
  // Restaure une sauvegarde. Remplace les tables de données ; pour les profils on
  // met à jour les champs sans écraser les mots de passe existants (mode démo).
  async importAll(data) {
    if (!data || typeof data !== 'object') throw new Error('Fichier de sauvegarde invalide.');
    const db = this._db();
    const counts = {};
    if (Array.isArray(data.months))             { db.months = data.months;                 counts.months = db.months.length; }
    if (Array.isArray(data.day_entries))        { db.entries = data.day_entries;            counts.day_entries = db.entries.length; }
    if (Array.isArray(data.schedule_templates)) { db.templates = data.schedule_templates;   counts.schedule_templates = db.templates.length; }
    if (Array.isArray(data.kids))               { db.kids = data.kids;                      counts.kids = db.kids.length; }
    if (Array.isArray(data.kid_attendance))     { db.kidatt = data.kid_attendance;          counts.kid_attendance = db.kidatt.length; }
    if (Array.isArray(data.profiles)) {
      data.profiles.forEach((p) => {
        const ex = db.profiles.find((x) => x.id === p.id);
        if (ex) Object.assign(ex, p, { password: ex.password }); // conserve le mot de passe local
        else db.profiles.push({ ...p, password: p.password || 'changeme' });
      });
      counts.profiles = db.profiles.length;
    }
    this._save(db);
    return counts;
  }

  /* ---- Temps réel (autres onglets) ---- */
  onChange(cb) {
    window.addEventListener('storage', (e) => {
      if (e.key === 'ecole_ping' || e.key === this.KEY) cb();
    });
  }
}

/* ================================================================
 * MODE FIREBASE — Firestore + Firebase Auth
 * ----------------------------------------------------------------
 * Avantage principal : l'offre gratuite (Spark) ne met JAMAIS le
 * projet en pause (offre gratuite Spark).
 *
 * Identifiants de documents déterministes (= "upsert" naturel) :
 *   profiles/{uid} · months/{emp}_{AAAA-MM} · day_entries/{emp}_{AAAA-MM-JJ}
 *   schedule_templates/{emp} · kids/{id} · kid_attendance/{kid}_{AAAA-MM-JJ}
 * ================================================================ */
const FB_MAX_BATCH = 400;   // limite Firestore = 500 écritures par lot

class FirebaseStore {
  constructor(app) {
    this.app = app;
    this.auth = app.auth();
    this.db = app.firestore();
    this._profile = null; this._entriesCache = {}; this._profilesCache = null;
  }
  async init() {
    // Session conservee sur l'appareil.
    try { await this.auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL); } catch {}
  }

  /* ---- Helpers ---- */
  _entryId(emp, date) { return `${emp}_${date}`; }
  _monthId(emp, y, m) { return `${emp}_${Util.monthKey(y, m)}`; }
  _docs(snap) { return snap.docs.map((d) => ({ id: d.id, ...d.data() })); }
  async _commit(ops) {   // ops = [{ref, data, merge}] — découpé en lots
    for (let i = 0; i < ops.length; i += FB_MAX_BATCH) {
      const batch = this.db.batch();
      ops.slice(i, i + FB_MAX_BATCH).forEach((o) => {
        if (o.delete) batch.delete(o.ref); else batch.set(o.ref, o.data, { merge: true });
      });
      await batch.commit();
    }
  }

  /* ---- Auth ---- */
  async signIn(email, password) {
    try {
      await this.auth.signInWithEmailAndPassword((email || '').trim(), password);
    } catch (e) { throw new Error(this._authMsg(e)); }
    return this.getCurrentUser();
  }
  _authMsg(e) {
    const c = (e && e.code) || '';
    if (/wrong-password|invalid-credential|user-not-found/.test(c)) return 'Email ou mot de passe incorrect.';
    if (/too-many-requests/.test(c)) return 'Trop de tentatives. Réessayez dans quelques minutes.';
    if (/network/.test(c)) return 'Connexion au serveur impossible. Vérifiez votre réseau.';
    if (/email-already-in-use/.test(c)) return 'Cet email est déjà utilisé.';
    if (/weak-password/.test(c)) return 'Mot de passe trop court (6 caractères minimum).';
    return (e && e.message) || String(e);
  }
  async signOut() { await this.auth.signOut(); this._profile = null; }
  async getCurrentUser() {
    // Attend la restauration de session au démarrage.
    const user = this.auth.currentUser || await new Promise((resolve) => {
      const un = this.auth.onAuthStateChanged((u) => { un(); resolve(u); });
    });
    if (!user) return null;
    const snap = await this.db.collection('profiles').doc(user.uid).get();
    if (!snap.exists) {
      // Compte créé directement dans la console Firebase : on initialise son profil.
      // TOUJOURS en 'employee' — le passage en admin se fait dans la console
      // (les règles Firestore interdisent de s'auto-promouvoir).
      const prof = {
        full_name: user.displayName || user.email, email: user.email,
        role: 'employee', active: true,
        created_at: new Date().toISOString(),
      };
      await this.db.collection('profiles').doc(user.uid).set(prof);
      this._profilesCache = null;
      return (this._profile = { id: user.uid, ...prof });
    }
    return (this._profile = { id: user.uid, ...snap.data() });
  }

  /* ---- Profils ---- */
  async listProfiles() {
    if (this._profilesCache) return this._profilesCache;
    const snap = await this.db.collection('profiles').get();
    const list = this._docs(snap).sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));
    return (this._profilesCache = list);
  }
  async addProfile({ full_name, email, password, role }) {
    // Astuce : on crée le compte via une instance SECONDAIRE de Firebase, ce qui
    // évite de déconnecter l'administrateur (limitation classique côté client).
    const second = firebase.initializeApp(this.app.options, 'creation-' + Date.now());
    try {
      const cred = await second.auth().createUserWithEmailAndPassword((email || '').trim(), password);
      await this.db.collection('profiles').doc(cred.user.uid).set({
        full_name, email: (email || '').trim(), role: role === 'admin' ? 'admin' : 'employee',
        active: true, created_at: new Date().toISOString(),
      });
      await second.auth().signOut();
      this._profilesCache = null;
      return { id: cred.user.uid };
    } catch (e) { throw new Error(this._authMsg(e)); }
    finally { try { await second.delete(); } catch {} }
  }
  async setActive(id, active) {
    await this.db.collection('profiles').doc(id).set({ active }, { merge: true });
    this._profilesCache = null;
  }
  async setRole(id, role) {
    if (role !== 'admin' && role !== 'employee') throw new Error('Rôle invalide.');
    await this.db.collection('profiles').doc(id).set({ role }, { merge: true });
    this._profilesCache = null;
  }
  async setEmail(id, email) {
    email = (email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Adresse email invalide.');
    // Note : modifie l'email de CONTACT (l'email de connexion se change via Firebase Auth).
    await this.db.collection('profiles').doc(id).set({ email }, { merge: true });
    this._profilesCache = null;
  }
  async setFullName(id, full_name) {
    full_name = (full_name || '').trim();
    if (!full_name) throw new Error('Le nom ne peut pas être vide.');
    await this.db.collection('profiles').doc(id).set({ full_name }, { merge: true });
    this._profilesCache = null;
  }
  async sendPasswordReset(email) {
    try { await this.auth.sendPasswordResetEmail((email || '').trim()); }
    catch (e) { throw new Error(this._authMsg(e)); }
  }

  /* ---- Horaire type ---- */
  async getTemplate(employee_id) {
    const s = await this.db.collection('schedule_templates').doc(employee_id).get();
    return s.exists ? (s.data().slots || {}) : {};
  }
  async setTemplate(employee_id, slots) {
    await this.db.collection('schedule_templates').doc(employee_id)
      .set({ employee_id, slots, updated_at: new Date().toISOString() }, { merge: true });
  }

  /* ---- Mois ---- */
  async getMonth(employee_id, year, month) {
    const s = await this.db.collection('months').doc(this._monthId(employee_id, year, month)).get();
    return s.exists ? { id: s.id, ...s.data() } : { employee_id, year, month, status: 'open' };
  }
  async setMonthStatus(employee_id, year, month, status) {
    const data = { employee_id, year, month, status };
    await this.db.collection('months').doc(this._monthId(employee_id, year, month)).set(data, { merge: true });
    return data;
  }

  /* ---- Prestations (avec cache local) ---- */
  async entriesForEmployee(employee_id) {
    if (this._entriesCache[employee_id]) return this._entriesCache[employee_id];
    const snap = await this.db.collection('day_entries').where('employee_id', '==', employee_id).get();
    return (this._entriesCache[employee_id] = this._docs(snap));
  }
  async entriesForMonth(employee_id, year, month) {
    const prefix = Util.monthKey(year, month);
    const all = await this.entriesForEmployee(employee_id);
    return all.filter((e) => (e.entry_date || '').startsWith(prefix));
  }
  _mergeCache(entry) {
    const list = this._entriesCache[entry.employee_id];
    if (!list) return;
    const i = list.findIndex((e) => e.entry_date === entry.entry_date);
    if (i >= 0) list[i] = { ...list[i], ...entry }; else list.push({ ...entry });
  }
  async upsertEntry(entry) {
    const data = { ...entry, updated_at: new Date().toISOString() };
    await this.db.collection('day_entries').doc(this._entryId(entry.employee_id, entry.entry_date))
      .set(data, { merge: true });
    // Relit la version fusionnee pour renvoyer l'etat complet.
    const s = await this.db.collection('day_entries').doc(this._entryId(entry.employee_id, entry.entry_date)).get();
    const saved = { id: s.id, ...s.data() };
    this._mergeCache(saved);
    return saved;
  }
  async upsertEntries(entries) {
    if (!entries || !entries.length) return [];
    const now = new Date().toISOString();
    await this._commit(entries.map((e) => ({
      ref: this.db.collection('day_entries').doc(this._entryId(e.employee_id, e.entry_date)),
      data: { ...e, updated_at: now },
    })));
    delete this._entriesCache[entries[0].employee_id];
    return entries;
  }

  /* ---- Enfants ---- */
  async listKids(includeArchived = false) {
    const snap = await this.db.collection('kids').get();
    return this._docs(snap)
      .filter((k) => includeArchived || k.active !== false)
      .sort((a, b) => ((a.last_name || '') + a.first_name).localeCompare((b.last_name || '') + b.first_name));
  }
  async addKid(first_name, last_name, school, birthdate, days, grade) {
    first_name = (first_name || '').trim(); last_name = (last_name || '').trim();
    if (!first_name) throw new Error('Le prénom est requis.');
    const data = { first_name, last_name, school: school || '', birthdate: birthdate || '',
      grade: grade || '', days: Array.isArray(days) ? days : [], active: true,
      created_at: new Date().toISOString() };
    const ref = await this.db.collection('kids').add(data);
    return { id: ref.id, ...data };
  }
  // Charge une liste d'enfants SANS rien supprimer (voir DemoStore.importKids).
  async importKids(list) {
    if (!list || !list.length) return { ajoutes: 0, misAJour: 0 };
    const connus = new Set((await this.listKids(true)).map((k) => k.id));
    await this._commit(list.map((k) => ({
      ref: this.db.collection('kids').doc(String(k.id)),
      data: {
        first_name: (k.first_name || '').trim(), last_name: (k.last_name || '').trim(),
        school: k.school || '', birthdate: k.birthdate || '', grade: k.grade || '',
        days: Array.isArray(k.days) ? k.days : [], active: k.active !== false,
      },
    })));
    const misAJour = list.filter((k) => connus.has(String(k.id))).length;
    return { ajoutes: list.length - misAJour, misAJour };
  }
  async setKidActive(id, active) {
    await this.db.collection('kids').doc(id).set({ active }, { merge: true });
  }
  async setKidInfo(id, info) {
    const first_name = (info.first_name || '').trim();
    if (!first_name) throw new Error('Le prénom est requis.');
    const patch = { first_name, last_name: (info.last_name || '').trim(),
      school: info.school || '', birthdate: info.birthdate || '', grade: info.grade || '' };
    if (Array.isArray(info.days)) patch.days = info.days;
    await this.db.collection('kids').doc(id).set(patch, { merge: true });
  }
  async kidAttendanceForMonth(year, month) {
    const p = Util.monthKey(year, month);
    const snap = await this.db.collection('kid_attendance')
      .where('entry_date', '>=', `${p}-01`).where('entry_date', '<=', `${p}-31`).get();
    return this._docs(snap);
  }
  async kidAttendanceForYear(year) {
    const snap = await this.db.collection('kid_attendance')
      .where('entry_date', '>=', `${year}-01-01`).where('entry_date', '<=', `${year}-12-31`).get();
    return this._docs(snap);
  }
  async allEntriesForYear(year) {
    const snap = await this.db.collection('day_entries')
      .where('entry_date', '>=', `${year}-01-01`).where('entry_date', '<=', `${year}-12-31`).get();
    return this._docs(snap);
  }
  // status : 'present' | 'absent' | null (efface l'enregistrement).
  async setKidAttendance(kid_id, entry_date, status) {
    const ref = this.db.collection('kid_attendance').doc(`${kid_id}_${entry_date}`);
    if (!status) await ref.delete();
    else await ref.set({ kid_id, entry_date, status });
  }
  async setKidAttendances(list) {
    if (!list || !list.length) return;
    const ops = list.map(({ kid_id, entry_date, status }) => ({
      ref: this.db.collection('kid_attendance').doc(`${kid_id}_${entry_date}`),
      data: status ? { kid_id, entry_date, status } : null, delete: !status,
    }));
    await this._commit(ops);
  }
  async allChildren() {
    const snap = await this.db.collection('kid_attendance').get();
    const byDate = {};
    snap.docs.forEach((d) => {
      const a = d.data(); if (a.status === 'absent') return;
      byDate[a.entry_date] = (byDate[a.entry_date] || 0) + 1;
    });
    return Object.entries(byDate).map(([entry_date, children]) => ({ entry_date, children }));
  }

  /* ---- Export / restauration ---- */
  async exportAll() {
    const get = async (c) => this._docs(await this.db.collection(c).get());
    const [profiles, months, day_entries, schedule_templates, kids, kid_attendance] = await Promise.all(
      ['profiles', 'months', 'day_entries', 'schedule_templates', 'kids', 'kid_attendance'].map(get));
    return { exported_at: new Date().toISOString(), mode: 'firebase',
      profiles, months, day_entries, schedule_templates, kids, kid_attendance };
  }
  // Restaure une sauvegarde JSON (y compris une ancienne sauvegarde exportee).
  // Les identifiants d'employées diffèrent d'un hébergeur à l'autre : on les
  // REMAPPE via l'email (puis le nom) vers les comptes Firebase existants.
  async importAll(data) {
    if (!data || typeof data !== 'object') throw new Error('Fichier de sauvegarde invalide.');
    const here = await this.listProfiles();
    const byEmail = {}, byName = {};
    here.forEach((p) => {
      if (p.email) byEmail[String(p.email).toLowerCase()] = p.id;
      if (p.full_name) byName[String(p.full_name).toLowerCase()] = p.id;
    });
    const map = {};   // ancien id → nouvel id
    (data.profiles || []).forEach((p) => {
      const hit = byEmail[String(p.email || '').toLowerCase()] || byName[String(p.full_name || '').toLowerCase()];
      if (hit) map[p.id] = hit;
    });
    const emp = (id) => map[id] || id;
    const missing = new Set();
    (data.day_entries || []).forEach((e) => { if (!map[e.employee_id]) missing.add(e.employee_id); });

    const ops = [];
    // On conserve TOUTE la fiche de l'enfant. Sans école / date de naissance /
    // jours habituels, une restauration ferait perdre les données qui servent
    // aux critères d'agrément et au pré-encodage des présences.
    (data.kids || []).forEach((k) => ops.push({
      ref: this.db.collection('kids').doc(String(k.id)),
      data: {
        first_name: k.first_name || '', last_name: k.last_name || '',
        school: k.school || '', birthdate: k.birthdate || '', grade: k.grade || '',
        days: Array.isArray(k.days) ? k.days : [],
        active: k.active !== false,
      },
    }));
    // `status` est indispensable : sans lui, toutes les absences enregistrées
    // seraient relues comme des présences après une restauration.
    (data.kid_attendance || []).forEach((a) => ops.push({
      ref: this.db.collection('kid_attendance').doc(`${a.kid_id}_${a.entry_date}`),
      data: { kid_id: String(a.kid_id), entry_date: a.entry_date,
        status: a.status === 'absent' ? 'absent' : 'present' },
    }));
    (data.schedule_templates || []).forEach((t) => ops.push({
      ref: this.db.collection('schedule_templates').doc(emp(t.employee_id)),
      data: { employee_id: emp(t.employee_id), slots: t.slots || {} },
    }));
    (data.months || []).forEach((m) => ops.push({
      ref: this.db.collection('months').doc(this._monthId(emp(m.employee_id), m.year, m.month)),
      data: { employee_id: emp(m.employee_id), year: m.year, month: m.month, status: m.status === 'validated' ? 'validated' : 'open' },
    }));
    (data.day_entries || []).forEach((e) => {
      const id = emp(e.employee_id);
      const { id: _drop, ...rest } = e;
      ops.push({
        ref: this.db.collection('day_entries').doc(this._entryId(id, e.entry_date)),
        data: { ...rest, employee_id: id },
      });
    });
    await this._commit(ops);
    this._entriesCache = {}; this._profilesCache = null;
    if (missing.size) {
      throw new Error(`Import effectué, mais ${missing.size} employée(s) de la sauvegarde n'ont pas de compte ici. `
        + 'Créez leurs comptes avec le MÊME email, puis relancez la restauration.');
    }
    return { total: ops.length };
  }

  /* ---- Temps réel ----
   * IMPORTANT : les deux collections qui grossissent sans fin (prestations et
   * présences des enfants) sont écoutées UNIQUEMENT sur l'année en cours.
   * Sans cette borne, chaque ouverture de l'application téléchargeait tout
   * l'historique (plusieurs milliers de fiches après quelques années) et le
   * gardait en mémoire en permanence : démarrage lent et appareil qui rame.
   * Les années passées restent consultables normalement (lecture à la demande),
   * elles ne sont simplement pas rafraîchies en direct — sans conséquence,
   * puisqu'on ne modifie pas une année clôturée à plusieurs en même temps. */
  onChange(cb) {
    const y = new Date().getFullYear();
    const thisYear = (col) => col.where('entry_date', '>=', `${y}-01-01`).where('entry_date', '<=', `${y}-12-31`);
    const BOUNDED = { day_entries: thisYear, kid_attendance: thisYear };
    ['day_entries', 'months', 'kids', 'kid_attendance', 'profiles', 'schedule_templates'].forEach((c) => {
      const base = this.db.collection(c);
      (BOUNDED[c] ? BOUNDED[c](base) : base).onSnapshot(
        { includeMetadataChanges: false },
        (snap) => {
          if (snap.metadata.hasPendingWrites) return;   // ignore nos propres écritures
          if (c === 'day_entries') this._entriesCache = {};
          if (c === 'profiles') this._profilesCache = null;
          cb();
        },
        (err) => console.warn('[firestore:onSnapshot]', c, err && err.message));
    });
  }
}

/* ================================================================
 * Fabrique : choisit le bon store
 * Priorité : Firebase (si configuré) → démo (localStorage)
 * ================================================================ */
async function createStore() {
  // ...?store=demo force le mode local (utile pour tester sans toucher au cloud).
  const forced = new URLSearchParams(location.search).get('store');
  if (forced !== 'demo' && HAS_FIREBASE && window.firebase) {
    const app = firebase.apps && firebase.apps.length
      ? firebase.app() : firebase.initializeApp(window.APP_CONFIG.FIREBASE_CONFIG);
    const s = new FirebaseStore(app);
    await s.init();
    return { store: s, mode: 'firebase' };
  }
  const s = new DemoStore();
  await s.init();
  return { store: s, mode: 'demo' };
}
