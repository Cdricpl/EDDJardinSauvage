/* ------------------------------------------------------------------
 * store.js — Couche de données unifiée.
 *
 * Expose un objet `Store` avec la même interface, que l'on soit :
 *   - en MODE DÉMO   (localStorage) si aucune clé Supabase n'est fournie
 *   - en MODE CLOUD  (Supabase) si config.js contient les clés
 *
 * Toutes les méthodes sont asynchrones (retournent des promesses), pour que
 * le reste de l'application soit identique dans les deux modes.
 * ------------------------------------------------------------------ */

const HAS_SUPABASE =
  window.APP_CONFIG &&
  window.APP_CONFIG.SUPABASE_URL &&
  window.APP_CONFIG.SUPABASE_ANON_KEY;

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
      months: [],       // { employee_id, year, month, status, carry_in_minutes }
      entries: [],      // { id, employee_id, entry_date, planned_minutes, worked_minutes, kind, justification }
      children: [],     // { entry_date, children, note }
      audit: [],        // { id, actor_name, action, entity, entity_id, details, created_at }
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
          break_minutes: 0, worked_touched: touched,
          kind: 'normal',
          justification: touched ? 'Activité prolongée' : '',
        });
      });
      db.children.push({ entry_date: date, children: 8 + ((d * 3) % 7), note: '' });
    }
    localStorage.setItem(this.KEY, JSON.stringify(db));
  }

  _db() { return JSON.parse(localStorage.getItem(this.KEY)); }
  _save(db) {
    localStorage.setItem(this.KEY, JSON.stringify(db));
    // Notifie les autres onglets (simulation "temps réel").
    localStorage.setItem('ecole_ping', String(Date.now()));
  }
  _log(db, action, entity, entity_id, details) {
    const s = this._session();
    db.audit.unshift({
      id: Util.uuid(), actor_name: s ? s.full_name : '?',
      action, entity, entity_id, details: details || {},
      created_at: new Date().toISOString(),
    });
    db.audit = db.audit.slice(0, 500);
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
    this._log(db, 'add_employee', 'profile', prof.id, { full_name });
    this._save(db);
    return prof;
  }
  async setActive(id, active) {
    const db = this._db();
    const p = db.profiles.find(x => x.id === id);
    if (p) { p.active = active; this._log(db, active ? 'reactivate_employee' : 'archive_employee', 'profile', id, { full_name: p.full_name }); this._save(db); }
  }
  async setRole(id, role) {
    const db = this._db();
    const p = db.profiles.find(x => x.id === id);
    if (p) { p.role = role; this._log(db, 'set_role', 'profile', id, { role }); this._save(db); }
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
    this._log(db, 'set_template', 'template', employee_id, {});
    this._save(db);
  }

  /* ---- Email / mot de passe ---- */
  async setEmail(id, email) {
    const db = this._db();
    email = (email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Adresse email invalide.');
    if (db.profiles.some(p => p.email === email && p.id !== id)) throw new Error('Cet email est déjà utilisé.');
    const p = db.profiles.find(x => x.id === id);
    if (p) { p.email = email; this._log(db, 'set_email', 'profile', id, { email }); this._save(db); }
  }
  async sendPasswordReset(email) {
    // Pas d'envoi d'email possible en mode démo.
    throw new Error("Envoi d'email indisponible en mode démo (fonctionne en mode cloud).");
  }

  /* ---- Mois ---- */
  async getMonth(employee_id, year, month) {
    return this._db().months.find(x => x.employee_id === employee_id && x.year === year && x.month === month)
      || { employee_id, year, month, status: 'open', carry_in_minutes: 0 };
  }
  async setMonthStatus(employee_id, year, month, status) {
    const db = this._db();
    let mo = db.months.find(x => x.employee_id === employee_id && x.year === year && x.month === month);
    if (!mo) { mo = { employee_id, year, month, status: 'open', carry_in_minutes: 0 }; db.months.push(mo); }
    mo.status = status;
    if (status === 'locked') mo.locked_at = new Date().toISOString();
    this._log(db, status === 'locked' ? 'lock_month' : status === 'validated' ? 'validate_month' : 'unlock_month',
      'month', Util.monthKey(year, month), { employee_id });
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
  async upsertEntry(entry) {
    const db = this._db();
    let e = db.entries.find(x => x.employee_id === entry.employee_id && x.entry_date === entry.entry_date);
    if (!e) {
      e = { id: Util.uuid(), employee_id: entry.employee_id, entry_date: entry.entry_date,
            planned_start: '', planned_end: '', planned_minutes: 0, worked_minutes: 0,
            start_time: '', end_time: '', break_minutes: 0, worked_touched: false,
            kind: 'normal', justification: '' };
      db.entries.push(e);
    }
    ['planned_start', 'planned_end', 'planned_minutes', 'worked_minutes', 'start_time',
     'end_time', 'break_minutes', 'worked_touched', 'kind', 'justification'].forEach(k => {
      if (entry[k] !== undefined) e[k] = entry[k];
    });
    this._log(db, 'update_entry', 'day_entry', e.entry_date, { employee_id: entry.employee_id });
    this._save(db);
    return e;
  }

  /* ---- Enfants ---- */
  async childrenForMonth(year, month) {
    const prefix = Util.monthKey(year, month);
    return this._db().children.filter(c => c.entry_date.startsWith(prefix));
  }
  async allChildren() { return this._db().children.slice(); }
  async upsertChildren(entry_date, children, note) {
    const db = this._db();
    let c = db.children.find(x => x.entry_date === entry_date);
    if (!c) { c = { entry_date, children: 0, note: '' }; db.children.push(c); }
    c.children = children; c.note = note || '';
    this._log(db, 'update_children', 'children', entry_date, { children });
    this._save(db);
    return c;
  }

  /* ---- Audit ---- */
  async listAudit(limit = 100) { return this._db().audit.slice(0, limit); }

  /* ---- Temps réel (autres onglets) ---- */
  onChange(cb) {
    window.addEventListener('storage', (e) => {
      if (e.key === 'ecole_ping' || e.key === this.KEY) cb();
    });
  }
}

/* ================================================================
 * MODE CLOUD — Supabase
 * ================================================================ */
class SupabaseStore {
  constructor(sb) { this.sb = sb; this._profile = null; this._entriesCache = {}; }
  async init() {}

  async signIn(email, password) {
    const { error } = await this.sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    return this.getCurrentUser();
  }
  async signOut() { await this.sb.auth.signOut(); this._profile = null; }
  async getCurrentUser() {
    const { data: { user } } = await this.sb.auth.getUser();
    if (!user) return null;
    const { data } = await this.sb.from('profiles').select('*').eq('id', user.id).single();
    this._profile = data;
    return data;
  }

  async listProfiles() {
    const { data, error } = await this.sb.from('profiles').select('*').order('full_name');
    if (error) throw error; return data;
  }
  async addProfile({ full_name, email, password, role }) {
    // Création du compte + profil (nécessite que l'admin soit connecté ;
    // en production on passera par une Edge Function pour ne pas déconnecter l'admin).
    const { data, error } = await this.sb.auth.signUp({
      email, password, options: { data: { full_name } },
    });
    if (error) throw new Error(error.message);
    if (role === 'admin' && data.user) {
      await this.sb.from('profiles').update({ role: 'admin' }).eq('id', data.user.id);
    }
    return data.user;
  }
  async setActive(id, active) {
    const { error } = await this.sb.from('profiles').update({ active }).eq('id', id);
    if (error) throw error;
    await this._audit(active ? 'reactivate_employee' : 'archive_employee', 'profile', id, {});
  }
  async setRole(id, role) {
    const { error } = await this.sb.from('profiles').update({ role }).eq('id', id);
    if (error) throw new Error(error.message);
    await this._audit('set_role', 'profile', id, { role });
  }
  async setEmail(id, email) {
    email = (email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Adresse email invalide.');
    const { error } = await this.sb.from('profiles').update({ email }).eq('id', id);
    if (error) throw new Error(error.message);
    await this._audit('set_email', 'profile', id, { email });
  }
  async sendPasswordReset(email) {
    const { error } = await this.sb.auth.resetPasswordForEmail((email || '').trim(), {
      redirectTo: location.origin + location.pathname,
    });
    if (error) throw new Error(error.message);
  }

  async getTemplate(employee_id) {
    const { data } = await this.sb.from('schedule_templates').select('slots').eq('employee_id', employee_id).maybeSingle();
    return data ? data.slots : {};
  }
  async setTemplate(employee_id, slots) {
    const { error } = await this.sb.from('schedule_templates')
      .upsert({ employee_id, slots }, { onConflict: 'employee_id' });
    if (error) throw new Error(error.message);
    await this._audit('set_template', 'template', employee_id, {});
  }

  async getMonth(employee_id, year, month) {
    const { data } = await this.sb.from('months').select('*')
      .eq('employee_id', employee_id).eq('year', year).eq('month', month).maybeSingle();
    return data || { employee_id, year, month, status: 'open', carry_in_minutes: 0 };
  }
  async setMonthStatus(employee_id, year, month, status) {
    const patch = { employee_id, year, month, status };
    const { data, error } = await this.sb.from('months')
      .upsert(patch, { onConflict: 'employee_id,year,month' }).select().single();
    if (error) throw error;
    await this._audit('set_month_' + status, 'month', Util.monthKey(year, month), { employee_id });
    return data;
  }

  // Cache : une seule requête "toutes les entrées de l'employée" par session,
  // réutilisée pour le mois affiché et le calcul du solde reporté. Invalidée
  // à chaque écriture (locale) et sur tout changement temps réel.
  async entriesForEmployee(employee_id) {
    if (this._entriesCache[employee_id]) return this._entriesCache[employee_id];
    const { data, error } = await this.sb.from('day_entries').select('*').eq('employee_id', employee_id);
    if (error) throw new Error(error.message);
    const list = data || [];
    this._entriesCache[employee_id] = list;
    return list;
  }
  async entriesForMonth(employee_id, year, month) {
    const prefix = Util.monthKey(year, month);
    const all = await this.entriesForEmployee(employee_id);
    return all.filter((e) => (e.entry_date || '').startsWith(prefix));
  }
  async upsertEntry(entry) {
    const { data, error } = await this.sb.from('day_entries')
      .upsert({ ...entry }, { onConflict: 'employee_id,entry_date' }).select().single();
    if (error) throw new Error(error.message);
    // Met à jour le cache local sans refaire une requête.
    const list = this._entriesCache[entry.employee_id];
    if (list) {
      const i = list.findIndex((e) => e.entry_date === data.entry_date);
      if (i >= 0) list[i] = data; else list.push(data);
    }
    await this._audit('update_entry', 'day_entry', entry.entry_date, { employee_id: entry.employee_id });
    return data;
  }

  async childrenForMonth(year, month) {
    const from = `${Util.monthKey(year, month)}-01`, to = `${Util.monthKey(year, month)}-31`;
    const { data } = await this.sb.from('children_attendance').select('*')
      .gte('entry_date', from).lte('entry_date', to);
    return data || [];
  }
  async allChildren() {
    const { data } = await this.sb.from('children_attendance').select('*');
    return data || [];
  }
  async upsertChildren(entry_date, children, note) {
    const { data, error } = await this.sb.from('children_attendance')
      .upsert({ entry_date, children, note }, { onConflict: 'entry_date' }).select().single();
    if (error) throw error;
    return data;
  }

  async listAudit(limit = 100) {
    const { data } = await this.sb.from('audit_log').select('*')
      .order('created_at', { ascending: false }).limit(limit);
    return data || [];
  }
  async _audit(action, entity, entity_id, details) {
    await this.sb.from('audit_log').insert({
      actor_id: this._profile ? this._profile.id : null,
      actor_name: this._profile ? this._profile.full_name : null,
      action, entity, entity_id, details,
    });
  }

  onChange(cb) {
    // Abonnement temps réel Supabase sur les tables clés.
    ['day_entries', 'months', 'children_attendance', 'profiles', 'schedule_templates'].forEach((t) => {
      this.sb.channel('rt-' + t)
        .on('postgres_changes', { event: '*', schema: 'public', table: t }, () => {
          if (t === 'day_entries') this._entriesCache = {}; // invalide le cache si un autre appareil écrit
          cb();
        })
        .subscribe();
    });
  }
}

/* ================================================================
 * Fabrique : choisit le bon store
 * ================================================================ */
async function createStore() {
  if (HAS_SUPABASE && window.supabase) {
    const sb = window.supabase.createClient(
      window.APP_CONFIG.SUPABASE_URL, window.APP_CONFIG.SUPABASE_ANON_KEY);
    const s = new SupabaseStore(sb);
    await s.init();
    return { store: s, mode: 'cloud' };
  }
  const s = new DemoStore();
  await s.init();
  return { store: s, mode: 'demo' };
}
