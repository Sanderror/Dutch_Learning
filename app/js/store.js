// Her progress: which lessons are done, streak, points, and the answers she
// reported as wrongly rejected. Kept in localStorage as one JSON document,
// with export and import so a new phone or a cleared browser is not the end
// of a year of history. Pure logic over an injected storage and clock, so it
// is tested without a browser (app/tests/store.test.mjs).

const KEY = 'tegeltjes.progress.v1';
export const SCHEMA = 2;

// How to keep her progress across app updates:
// - Progress is keyed by lesson id ("u03l2") and dialogue id ("u03d"). Those ids
//   never change meaning; tools/validate_content.py fails if a published id
//   disappears (content/published_ids.json).
// - When the shape of this document changes, SCHEMA goes up by one and a
//   function is added here that turns the previous shape into the new one.
//   Old data is upgraded on load and on import, never thrown away.
//   app/tests/fixtures/progress_schema1.json is a real save from schema 1; the
//   tests load it with every later version.
// - Data from a newer version than this one is set aside, not overwritten.
export const MIGRATIONS = {
  // 2: review sessions. Adds the review schedule, empty; the app fills it from
  // the lessons she has finished (review.js sync), spread over the coming days.
  1: (data) => ({ ...data, schema: 2, reviews: { cards: {} } }),
};

/** Bring stored data up to SCHEMA. Returns null when it cannot be read. */
export function upgrade(data) {
  if (!data || typeof data !== 'object' || typeof data.schema !== 'number') return null;
  let d = data;
  while (d.schema < SCHEMA) {
    const step = MIGRATIONS[d.schema];
    if (!step) return null;
    const before = d.schema;
    d = step(d);
    if (!d || d.schema !== before + 1) return null;
  }
  if (!isValid(d)) return null;
  // fields added without a schema change get their defaults
  if (!d.settings) d.settings = {};
  if (!d.days) d.days = {};
  if (!d.backup) d.backup = { lastAt: null, snoozeUntil: null };
  return d;
}

const BACKUP_EVERY_DAYS = 30;
const BACKUP_SNOOZE_DAYS = 14;
const BACKUP_AFTER_LESSONS = 5;

export function dayKey(date) {
  const y = date.getFullYear(), m = date.getMonth() + 1, d = date.getDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function daysBetween(a, b) {
  const [ya, ma, da] = a.split('-').map(Number), [yb, mb, db] = b.split('-').map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86400000);
}

function empty(now) {
  return { schema: SCHEMA, createdAt: now.toISOString(), xp: 0, lessons: {}, days: {},
    streak: { current: 0, best: 0, lastDay: null }, reports: [], settings: { slow: false, sounds: true },
    backup: { lastAt: null, snoozeUntil: null }, reviews: { cards: {} } };
}

function isValid(data) {
  return data && typeof data === 'object' && data.schema === SCHEMA &&
    data.lessons && typeof data.lessons === 'object' && data.streak && Array.isArray(data.reports) &&
    data.reviews && typeof data.reviews.cards === 'object';
}

/**
 * @param {{getItem(k: string): string|null, setItem(k: string, v: string): void}|null} storage
 * @param {() => Date} now
 */
export function createStore(storage, now = () => new Date()) {
  let persisted = true;
  let data = null;
  let unreadable = null;       // stored text this version cannot read
  try {
    const raw = storage ? storage.getItem(KEY) : null;
    if (raw) {
      try {
        data = upgrade(JSON.parse(raw));
      } catch (e) { /* not JSON */ }
      if (!data) unreadable = raw;
    }
  } catch (e) { /* storage blocked: work in memory */ }
  if (!data) data = empty(now());

  function save() {
    try {
      // Never destroy what could not be read (damaged, or written by a newer
      // version): set it aside before the first save replaces it.
      if (unreadable !== null) { storage.setItem(KEY + '.unreadable', unreadable); unreadable = null; }
      storage.setItem(KEY, JSON.stringify(data));
      persisted = true;
    } catch (e) { persisted = false; }
    return persisted;
  }

  /** A streak is alive if she practised today or yesterday. */
  function streakNow() {
    const s = data.streak;
    if (!s.lastDay) return 0;
    return daysBetween(s.lastDay, dayKey(now())) <= 1 ? s.current : 0;
  }

  function touchDay(xp, lessons) {
    const today = dayKey(now());
    const s = data.streak;
    if (s.lastDay !== today) {
      const gap = s.lastDay ? daysBetween(s.lastDay, today) : null;
      s.current = gap === 1 ? s.current + 1 : 1;
      s.lastDay = today;
      s.best = Math.max(s.best, s.current);
    }
    const d = data.days[today] || (data.days[today] = { xp: 0, lessons: 0 });
    d.xp += xp; d.lessons += lessons;
  }

  return {
    get data() { return data; },
    get persisted() { return persisted; },
    isDone(id) { return !!(data.lessons[id] && data.lessons[id].done); },
    attempts(id) { return (data.lessons[id] && data.lessons[id].attempts) || 0; },
    streak: streakNow,
    doneToday() { const d = data.days[dayKey(now())]; return d ? d.lessons : 0; },

    /** @returns {{xp: number, firstTime: boolean, streak: number}} */
    completeLesson(id, { correct, total, via = 'lesson' }) {
      const prev = data.lessons[id] || { done: false, attempts: 0, best: 0 };
      const accuracy = total ? correct / total : 1;
      const firstTime = !prev.done;
      const xp = (firstTime ? 10 : 5) + (accuracy >= 0.9 ? 5 : 0);
      data.lessons[id] = { done: true, attempts: prev.attempts + 1, best: Math.max(prev.best, accuracy),
        completedAt: prev.completedAt || now().toISOString(), via: prev.via || via };
      data.xp += xp;
      touchDay(xp, 1);
      save();
      return { xp, firstTime, streak: streakNow() };
    },

    /** A started lesson that was left: counts as an attempt, so the next try is a different mix. */
    noteAttempt(id) {
      const prev = data.lessons[id] || { done: false, attempts: 0, best: 0 };
      data.lessons[id] = { ...prev, attempts: prev.attempts + 1 };
      save();
    },

    /** Passing a unit test marks every lesson of the unit as done. */
    passUnitTest(lessonIds) {
      let added = 0;
      for (const id of lessonIds) {
        if (this.isDone(id)) continue;
        data.lessons[id] = { done: true, attempts: 0, best: 0, completedAt: now().toISOString(), via: 'test' };
        added++;
      }
      const xp = added * 5;
      data.xp += xp;
      touchDay(xp, added ? 1 : 0);
      save();
      return { xp, added };
    },

    /** The review schedule (review.js works on it); call commit() after changing it. */
    get reviews() { return data.reviews; },
    commit() { return save(); },

    /** A review session finished: a point per item right at the first try; counts for the streak. */
    completeReview({ correct, total }) {
      const xp = correct;
      data.xp += xp;
      touchDay(xp, 0);
      const d = data.days[dayKey(now())];
      d.reviews = (d.reviews || 0) + total;
      save();
      return { xp, streak: streakNow() };
    },

    reviewedToday() { const d = data.days[dayKey(now())]; return (d && d.reviews) || 0; },

    /** "My answer was right": kept on the phone until exported. */
    report(entry) {
      data.reports.push({ ...entry, at: now().toISOString() });
      if (data.reports.length > 500) data.reports.splice(0, data.reports.length - 500);
      save();
    },

    setSetting(name, value) { data.settings[name] = value; save(); },

    /** Settings that are on unless she turned them off (older saves lack them). */
    sounds() { return data.settings.sounds !== false; },

    exportText() { return JSON.stringify({ app: 'tegeltjes', exportedAt: now().toISOString(), progress: data }); },

    /** She copied or downloaded a backup. */
    markBackup() { data.backup.lastAt = now().toISOString(); data.backup.snoozeUntil = null; save(); },

    /** "Más tarde" on the reminder. */
    snoozeBackup() {
      const until = new Date(now().getTime() + BACKUP_SNOOZE_DAYS * 86400000);
      data.backup.snoozeUntil = dayKey(until); save();
    },

    /** Days since the last backup, or null when there has never been one. */
    daysSinceBackup() { return data.backup.lastAt ? daysBetween(dayKey(new Date(data.backup.lastAt)), dayKey(now())) : null; },

    /** Remind her once there is something to lose and no recent copy. */
    backupDue() {
      const done = Object.values(data.lessons).filter((l) => l.done).length;
      if (done < BACKUP_AFTER_LESSONS) return false;
      const today = dayKey(now());
      if (data.backup.snoozeUntil && daysBetween(today, data.backup.snoozeUntil) > 0) return false;
      const since = this.daysSinceBackup();
      return since === null || since >= BACKUP_EVERY_DAYS;
    },

    /** Replaces everything. Returns an error message in Spanish, or null when it worked. */
    importText(text) {
      let parsed;
      try { parsed = JSON.parse(text); } catch (e) { return 'El texto no es una copia válida.'; }
      if (!parsed || parsed.app !== 'tegeltjes' || !parsed.progress) return 'El texto no es una copia de esta app.';
      if (typeof parsed.progress.schema === 'number' && parsed.progress.schema > SCHEMA) {
        return 'Esta copia es de una versión más nueva de la app. Actualiza la app y vuelve a intentarlo.';
      }
      const incoming = upgrade(parsed.progress);
      if (!incoming) return 'El texto no es una copia de esta app.';
      data = incoming;
      return save() ? null : 'No se pudo guardar en este teléfono.';
    },
  };
}
