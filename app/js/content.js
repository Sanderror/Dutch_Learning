// Loads the course files and builds the lookups the rest of the app uses.
// The content format is described in the repository README; the lexicon is
// the single source of "what has been taught by lesson X".

import { fold, tokens } from './checker.js';

export async function loadContent(base, fetchFn) {
  const get = async (path) => {
    const res = await fetchFn(base + path, { cache: 'no-cache' });
    if (!res.ok) throw new Error(path + ': ' + res.status);
    return res.json();
  };
  const [course, lexicon] = await Promise.all([get('course.json'), get('lexicon.json')]);
  const units = await Promise.all(course.units.map((id) => get(`units/${id}.json`)));
  return buildCourse(course, lexicon, units);
}

/** Lesson ids sort as text: u01l1 < u01l6 < u02l1 (two-digit units, one-digit lessons). */
export function buildCourse(course, lexicon, units) {
  const names = new Set((lexicon.names || []).map((n) => fold(n)));
  const entries = lexicon.entries.map((e) => {
    const forms = Object.entries(e.forms).map(([form, lesson]) => ({ form, lesson, toks: tokens(form) }));
    const intro = forms.map((f) => f.lesson).sort()[0];
    return { ...e, formList: forms, intro, display: (e.article ? e.article + ' ' : '') + e.nl };
  });
  const byId = new Map(entries.map((e) => [e.id, e]));

  const lessonOrder = [];
  const lessonInfo = new Map();
  for (const unit of units) {
    for (const lesson of unit.lessons) {
      lessonOrder.push(lesson.id);
      lessonInfo.set(lesson.id, { lesson, unit });
    }
  }

  // every single Dutch word the course knows, for the typo rule
  const allForms = new Set();
  for (const e of entries) for (const f of e.formList) for (const t of f.toks) allForms.add(fold(t));

  // words written with a capital wherever they stand (tiles keep the capital)
  const proper = new Set(names);
  for (const e of entries) {
    if (/^[A-ZÀ-Ý]/.test(e.nl)) for (const t of tokens(e.nl)) proper.add(fold(t));
    for (const g of e.es) for (const w of g.split(/\s+/)) if (/^[A-ZÀ-Ý]/.test(w)) proper.add(fold(w));
  }

  return {
    course, lexicon, units, entries, byId, names, proper, allForms, lessonOrder, lessonInfo,

    unitById(id) { return units.find((u) => u.id === id); },

    /** Entries first taught in this lesson, in lexicon order. */
    newEntries(lessonId) { return entries.filter((e) => e.intro === lessonId); },

    /** Entries taught in this lesson or earlier. */
    entriesUpTo(lessonId) { return entries.filter((e) => e.intro <= lessonId); },

    /** Single Dutch words (lowercase) usable up to and including this lesson. */
    formsUpTo(lessonId) {
      const out = new Set();
      for (const e of entries) for (const f of e.formList) if (f.lesson <= lessonId) for (const t of f.toks) out.add(t);
      return out;
    },

    /** Which entries (with forms taught by `lessonId`) occur in this Dutch text? */
    entriesIn(nl, lessonId) {
      const toks = tokens(nl);
      const found = [];
      for (const e of entries) {
        const hit = e.formList.some((f) => f.lesson <= lessonId && containsSeq(toks, f.toks));
        if (hit) found.push(e);
      }
      return found;
    },

    /** Sentences of all lessons before this one, newest last. */
    sentencesBefore(lessonId) {
      const out = [];
      for (const id of lessonOrder) {
        if (id >= lessonId) break;
        out.push(...lessonInfo.get(id).lesson.sentences);
      }
      return out;
    },
  };
}

function containsSeq(haystack, needle) {
  const n = needle.length;
  if (!n) return false;
  for (let i = 0; i + n <= haystack.length; i++) {
    let ok = true;
    for (let j = 0; j < n; j++) if (haystack[i + j] !== needle[j]) { ok = false; break; }
    if (ok) return true;
  }
  return false;
}
