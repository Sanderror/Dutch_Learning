// Turns a lesson's sentences and new words into the steps she plays.
// Nothing here is authored per exercise: the content is data, and this file
// decides which exercise each sentence becomes. Pure and seeded, so the same
// lesson and attempt number always give the same steps (tested in
// app/tests/exercises.test.mjs).

import { fold, tokens } from './checker.js';

// ---------- seeded randomness ----------
export function seedRandom(text) {
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = (h ^ (h >>> 16)) >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffled(arr, rnd) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- word tiles ----------
/** Words of a sentence as tiles: no punctuation, lowercase unless a proper name. */
export function tileWords(text, proper) {
  const words = String(text).split(/\s+/)
    .map((w) => w.replace(/^[¿¡"«(]+|[?!.,;:"»)…]+$/g, ''))
    .filter(Boolean);
  return words.map((w) => (proper.has(fold(w)) ? w : w.toLowerCase()));
}

function nlDistractors(course, lessonId, targetWords, count, rnd) {
  const used = new Set(targetWords.map(fold));
  const pool = [...course.formsUpTo(lessonId)].filter((f) => !used.has(fold(f)));
  // other forms of the same words come first (kom / komt, ben / bent / is):
  // those are the mistakes worth offering
  const siblings = [];
  for (const e of course.entriesUpTo(lessonId)) {
    const forms = e.formList.filter((f) => f.lesson <= lessonId && f.toks.length === 1).map((f) => f.toks[0]);
    if (forms.some((f) => used.has(fold(f)))) for (const f of forms) if (!used.has(fold(f))) siblings.push(f);
  }
  const out = [];
  for (const w of [...shuffled(siblings, rnd), ...shuffled(pool, rnd)]) {
    if (out.length >= count) break;
    if (!out.some((o) => fold(o) === fold(w))) out.push(w);
  }
  return out.map((w) => (course.proper.has(fold(w)) ? properCase(course, w) : w));
}

function properCase(course, lower) {
  for (const e of course.entries) if (fold(e.nl) === fold(lower)) return e.nl;
  return lower;
}

function esDistractors(course, sentences, targetWords, count, rnd) {
  const used = new Set(targetWords.map(fold));
  const pool = [];
  for (const s of sentences) for (const w of tileWords(s.es, course.proper)) {
    if (!used.has(fold(w)) && !pool.some((p) => fold(p) === fold(w))) pool.push(w);
  }
  return shuffled(pool, rnd).slice(0, count);
}

function makeTiles(words, distractors, rnd) {
  return shuffled([...words, ...distractors], rnd).map((text, i) => ({ id: 't' + i, text }));
}

// ---------- step builders ----------
function reveal(s) { return { nl: s.nl, es: s.es }; }

function mcStep(course, s, pool, rnd) {
  const accepted = new Set([s.es, ...(s.alt_es || [])].map(fold));
  const n = tokens(s.es).length;
  const seen = new Set();
  const candidates = pool.filter((o) => {
    const key = fold(o.es);
    if (o.id === s.id || fold(o.nl) === fold(s.nl) || accepted.has(key) || seen.has(key)) return false;
    // a distractor must not be another accepted meaning of the same Dutch
    if ((o.alt_es || []).some((a) => accepted.has(fold(a)))) return false;
    seen.add(key);
    return true;
  });
  if (candidates.length < 2) return null;
  const ranked = shuffled(candidates, rnd).sort((a, b) => Math.abs(tokens(a.es).length - n) - Math.abs(tokens(b.es).length - n));
  const options = shuffled([s.es, ranked[0].es, ranked[1].es], rnd);
  return { type: 'mc', sid: s.id, promptNl: s.nl, audio: s.nl, options, answer: options.indexOf(s.es), reveal: reveal(s) };
}

function tilesStep(course, s, mode, lessonId, lessonSentences, rnd) {
  const toEs = mode === 'nl2es';
  const words = tileWords(toEs ? s.es : s.nl, course.proper);
  const extra = Math.min(4, Math.max(2, Math.ceil(words.length / 2)));
  const distractors = toEs
    ? esDistractors(course, lessonSentences, words, extra, rnd)
    : nlDistractors(course, lessonId, words, extra, rnd);
  return {
    type: 'tiles', sid: s.id, mode, lang: toEs ? 'es' : 'nl',
    prompt: mode === 'listen' ? null : (toEs ? s.nl : s.es),
    audio: toEs || mode === 'listen' ? s.nl : null,
    tiles: makeTiles(words, distractors, rnd),
    accepted: toEs ? [s.es, ...(s.alt_es || [])] : (mode === 'listen' ? [s.nl] : [s.nl, ...(s.alt_nl || [])]),
    reveal: reveal(s),
  };
}

function typeStep(s, mode) {
  return {
    type: 'type', sid: s.id, mode, lang: 'nl',
    prompt: mode === 'listen' ? null : s.es,
    audio: mode === 'listen' ? s.nl : null,
    accepted: mode === 'listen' ? [s.nl] : [s.nl, ...(s.alt_nl || [])],
    reveal: reveal(s),
  };
}

function cardStep(e) {
  const extraForms = e.formList.map((f) => f.form).filter((f) => fold(f) !== fold(e.nl));
  return { type: 'card', entryId: e.id, nl: e.display, forms: extraForms, es: e.es, note: e.note_es || null, audio: e.display };
}

function matchStep(course, lessonId, rnd) {
  const fresh = course.newEntries(lessonId);
  const older = shuffled(course.entriesUpTo(lessonId).filter((e) => e.intro !== lessonId), rnd);
  const pairs = [];
  const seenEs = new Set(), seenNl = new Set();
  for (const e of [...fresh, ...older]) {
    if (pairs.length >= 5) break;
    const es = e.es[0];
    // "no" is the gloss of nee, niet and geen: only one of them can be in a matching game
    if (seenEs.has(fold(es)) || seenNl.has(fold(e.display))) continue;
    seenEs.add(fold(es)); seenNl.add(fold(e.display));
    pairs.push({ id: e.id, nl: e.display, es, audio: e.display });
  }
  if (pairs.length < 3) return null;
  return { type: 'match', pairs, left: shuffled(pairs.map((p) => p.id), rnd), right: shuffled(pairs.map((p) => p.id), rnd) };
}

// ---------- which exercise for which sentence ----------
// Recognition first, production later in the lesson.
const PATTERN = ['mc', 'nl2es', 'es2nl', 'listen', 'mc', 'es2nl', 'type', 'listen', 'nl2es', 'type', 'es2nl', 'listen', 'type', 'es2nl'];
const LONG_FOR_TYPING = 5;      // in sections 1 and 2, longer sentences are built from tiles instead

function sentenceStep(course, s, wanted, ctx) {
  const { lessonId, section, canListen, rnd, mcPool, lessonSentences } = ctx;
  const nNl = tileWords(s.nl, course.proper).length;
  const nEs = tileWords(s.es, course.proper).length;
  let kind = wanted;
  if (kind === 'listen') kind = !canListen ? 'es2nl' : (nNl <= 3 ? 'listen-type' : 'listen-tiles');
  if (kind === 'mc') {
    const step = mcStep(course, s, mcPool, rnd);
    if (step) return step;
    kind = 'nl2es';
  }
  if (kind === 'nl2es' && nEs < 2) kind = 'es2nl';
  if (kind === 'es2nl' && nNl < 2) kind = 'type';
  if (kind === 'type' && nNl > LONG_FOR_TYPING && section <= 2) kind = 'es2nl';
  switch (kind) {
    case 'nl2es': return tilesStep(course, s, 'nl2es', lessonId, lessonSentences, rnd);
    case 'es2nl': return tilesStep(course, s, 'es2nl', lessonId, lessonSentences, rnd);
    case 'listen-tiles': return tilesStep(course, s, 'listen', lessonId, lessonSentences, rnd);
    case 'listen-type': return typeStep(s, 'listen');
    default: return typeStep(s, 'es2nl');
  }
}

/**
 * A lesson: a word card just before the first sentence that uses each new
 * word, one exercise per sentence, and one matching game once all the new
 * words have been met.
 */
export function buildLesson(course, lessonId, { attempt = 0, canListen = true } = {}) {
  const { lesson, unit } = course.lessonInfo.get(lessonId);
  const rnd = seedRandom(lessonId + ':' + attempt);
  const fresh = course.newEntries(lessonId);
  const shown = new Set();
  const earlier = course.sentencesBefore(lessonId);
  const ctx = {
    lessonId, section: unit.section, canListen, rnd,
    lessonSentences: [...lesson.sentences, ...earlier.slice(-30)],
    mcPool: [...lesson.sentences, ...earlier.slice(-60)],
  };
  // a different mix on a repeat: the pattern starts somewhere else
  const offset = attempt === 0 ? 0 : 1 + Math.floor(rnd() * (PATTERN.length - 1));
  const steps = [];
  let matchAt = -1;
  lesson.sentences.forEach((s, i) => {
    for (const e of course.entriesIn(s.nl, lessonId)) {
      if (e.intro === lessonId && !shown.has(e.id)) { shown.add(e.id); steps.push(cardStep(e)); }
    }
    steps.push(sentenceStep(course, s, PATTERN[(i + offset) % PATTERN.length], ctx));
    if (matchAt < 0 && shown.size === fresh.length) matchAt = steps.length;
  });
  const match = matchStep(course, lessonId, rnd);
  if (match) steps.splice(matchAt < 0 ? steps.length : matchAt, 0, match);
  return { id: lessonId, kind: 'lesson', title: lesson.title_es, steps };
}

/** The unit's dialogue: read and listen, then the comprehension questions. */
export function buildDialogue(course, unitId) {
  const unit = course.unitById(unitId);
  const d = unit.dialogue;
  const steps = [{
    type: 'dialogue', title: d.title_es,
    lines: d.lines.map((l) => ({ speaker: l.speaker, nl: l.nl, es: l.es, audio: '@' + l.speaker + '|' + l.nl })),
  }];
  for (const q of d.questions) {
    steps.push({ type: 'mc', sid: null, promptEs: q.q_es, audio: null, options: q.options_es.slice(), answer: q.answer, reveal: null });
  }
  return { id: unitId + 'd', kind: 'dialogue', title: d.title_es, steps };
}

export const UNIT_TEST_SIZE = 12;
export const UNIT_TEST_PASS = 10;

/**
 * Test-out for a unit: 12 production exercises, two per lesson, no word cards
 * and no second chances. 10 right marks the whole unit as done.
 */
export function buildUnitTest(course, unitId, { attempt = 0, canListen = true } = {}) {
  const unit = course.unitById(unitId);
  const rnd = seedRandom(unitId + ':test:' + attempt);
  const last = unit.lessons[unit.lessons.length - 1].id;
  const perLesson = Math.ceil(UNIT_TEST_SIZE / unit.lessons.length);
  const chosen = [];
  for (const lesson of unit.lessons) {
    // prefer real sentences over one-word items
    const ranked = shuffled(lesson.sentences, rnd).sort((a, b) => (tokens(b.nl).length >= 3) - (tokens(a.nl).length >= 3));
    chosen.push(...ranked.slice(0, perLesson).map((s) => ({ s, lessonId: lesson.id })));
  }
  const all = unit.lessons.flatMap((l) => l.sentences);
  const steps = shuffled(chosen, rnd).slice(0, UNIT_TEST_SIZE).map(({ s }, i) => {
    const ctx = { lessonId: last, section: unit.section, canListen, rnd, mcPool: all, lessonSentences: all };
    return sentenceStep(course, s, i % 3 === 2 ? 'listen' : (i % 3 === 1 ? 'type' : 'es2nl'), ctx);
  });
  return { id: unitId + 't', kind: 'test', title: unit.title_es, steps, pass: UNIT_TEST_PASS };
}

export function isGraded(step) { return step.type !== 'card' && step.type !== 'dialogue'; }
