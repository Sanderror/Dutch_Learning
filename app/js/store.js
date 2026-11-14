// Her progress: which lessons are done, streak, points, and the answers she
// reported as wrongly rejected. Kept in localStorage as one JSON document,
// with export and import so a new phone or a cleared browser is not the end
// of a year of history. Pure logic over an injected storage and clock, so it
// is tested without a browser (app/tests/store.test.mjs).

const KEY = 'tegeltjes.progress.v1';
export const SCHEMA = 1;

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
    streak: { current: 0, best: 0, lastDay: null }, reports: [], settings: { slow: false } };
}

function isValid(data) {
  return data && typeof data === 'object' && data.schema === SCHEMA &&
    data.lessons && typeof data.lessons === 'object' && data.streak && Array.isArray(data.reports);
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
        const parsed = JSON.parse(raw);
        if (isValid(parsed)) data = parsed;
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

    /** "My answer was right": kept on the phone until exported. */
    report(entry) {
      data.reports.push({ ...entry, at: now().toISOString() });
      if (data.reports.length > 500) data.reports.splice(0, data.reports.length - 500);
      save();
    },

    setSetting(name, value) { data.settings[name] = value; save(); },

    exportText() { return JSON.stringify({ app: 'tegeltjes', exportedAt: now().toISOString(), progress: data }); },

    /** Replaces everything. Returns an error message in Spanish, or null when it worked. */
    importText(text) {
      let parsed;
      try { parsed = JSON.parse(text); } catch (e) { return 'El texto no es una copia válida.'; }
      const incoming = parsed && parsed.progress;
      if (!parsed || parsed.app !== 'tegeltjes' || !isValid(incoming)) return 'El texto no es una copia de esta app.';
      data = incoming;
      if (!data.settings) data.settings = { slow: false };
      if (!data.days) data.days = {};
      return save() ? null : 'No se pudo guardar en este teléfono.';
    },
  };
}
