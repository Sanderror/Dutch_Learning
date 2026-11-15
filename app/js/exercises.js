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
export function shuffled(arr, rnd) {
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

// ---------- put the words in order ----------
/** The sentence's own words, shuffled, no extra tiles: only the order is the question. */
function orderStep(course, s, rnd) {
  const words = tileWords(s.nl, course.proper);
  let tiles = makeTiles(words, [], rnd);
  for (let i = 0; i < 5 && tiles.map((t) => t.text).join(' ') === words.join(' '); i++) tiles = makeTiles(words, [], rnd);
  return {
    type: 'tiles', sid: s.id, mode: 'order', lang: 'nl', prompt: s.es, audio: null, tiles,
    accepted: [s.nl, ...(s.alt_nl || [])], reveal: reveal(s),
  };
}

// ---------- fill the gap ----------
// One word is left out and she picks it from three. Only words where the
// choice is grammar are left out: a verb form (ben / bent / is), an article
// before its noun (de / het / een), deze / die / dit / dat before a noun, and
// niet / geen. The Spanish sentence is shown, so a choice that changes the
// meaning (een for het) is wrong for a visible reason; a choice that would
// give another accepted answer is never offered.
const ARTICLES = ['de', 'het', 'een'];
const DEMONSTRATIVES = { deze: ['dit', 'dat'], die: ['dat', 'dit'], dit: ['deze', 'die'], dat: ['die', 'deze'] };
const NEGATIONS = { niet: ['geen', 'nee'], geen: ['niet', 'nee'] };
// pairs that are both correct with these subjects: never offered against each other
const BOTH_RIGHT = [
  { entry: 'willen', forms: ['wil', 'wilt'], subjects: ['jij', 'je', 'u'] },
  { entry: 'hebben', forms: ['hebt', 'heeft'], subjects: ['u'] },
  { entry: 'zijn', forms: ['bent', 'is'], subjects: ['u'] },
];

function splitPiece(piece) {
  const m = piece.match(/^([¿¡"«(]*)(.*?)([?!.,;:"»)…]*)$/);
  return { lead: m[1], core: m[2], trail: m[3] };
}

export function gapStep(course, s, lessonId, rnd) {
  const pieces = s.nl.split(/\s+/).filter(Boolean);
  const toks = pieces.map((p) => { const t = tokens(p); return t.length === 1 ? t[0] : null; });
  const has = (w) => toks.includes(w);
  const accepted = new Set([s.nl, ...(s.alt_nl || [])].map(fold));
  const known = course.entriesUpTo(lessonId);
  const single = (e) => e.formList.filter((f) => f.lesson <= lessonId && f.toks.length === 1).map((f) => f.toks[0]);
  const isNoun = (tok) => tok && known.some((e) => e.article && single(e).includes(tok));
  const withWord = (i, w) => fold(pieces.map((p, k) => (k === i ? w : p)).join(' '));

  const candidates = [];
  toks.forEach((tok, i) => {
    if (!tok) return;
    let options = null, weight = 1;
    const verb = known.find((e) => e.pos === 'verb' && single(e).includes(tok));
    if (verb) {
      let siblings = single(verb).filter((f) => f !== tok);
      for (const rule of BOTH_RIGHT) {
        if (rule.entry === verb.id && rule.forms.includes(tok) && rule.subjects.some(has)) siblings = siblings.filter((f) => !rule.forms.includes(f));
      }
      options = siblings; weight = verb.id === "zijn" ? 1 : 3;     // "is" is in half the sentences: do not let it take over
    } else if (ARTICLES.includes(tok) && isNoun(toks[i + 1])) {
      options = ARTICLES.filter((a) => a !== tok); weight = 2;
    } else if (DEMONSTRATIVES[tok] && isNoun(toks[i + 1])) {
      options = DEMONSTRATIVES[tok]; weight = 2;
    } else if (NEGATIONS[tok]) {
      options = NEGATIONS[tok]; weight = 2;
    }
    if (!options) return;
    options = shuffled(options.filter((o) => !accepted.has(withWord(i, o))), rnd).slice(0, 2);
    if (options.length === 2) for (let k = 0; k < weight; k++) candidates.push({ i, tok, options });
  });
  if (!candidates.length) return null;
  const pick = candidates[Math.floor(rnd() * candidates.length)];
  const { lead, trail } = splitPiece(pieces[pick.i]);
  const options = shuffled([pick.tok, ...pick.options], rnd);
  return {
    type: 'gap', sid: s.id, lang: 'nl', audio: null,
    before: [...pieces.slice(0, pick.i), lead].join(' ').trim(),
    after: [trail, ...pieces.slice(pick.i + 1)].join(' ').replace(/^ /, ''),
    joinAfter: trail !== '',                // punctuation sticks to the gap
    hintEs: s.es, options, answer: options.indexOf(pick.tok), reveal: reveal(s),
  };
}

// ---------- say it aloud ----------
const SPEAK_MIN_WORDS = 2;      // single words are recognised badly
const SPEAK_MAX_WORDS = 8;

export function canBeSpoken(course, s) {
  const n = tileWords(s.nl, course.proper).length;
  return n >= SPEAK_MIN_WORDS && n <= SPEAK_MAX_WORDS;
}

/** Practice, never a gate: the app marks it soft, so "Continuar" is always there. */
export function speakStep(s) {
  return { type: 'speak', sid: s.id, lang: 'nl', nl: s.nl, es: s.es, audio: s.nl, soft: true, reveal: reveal(s) };
}

function cardStep(e) {
  const extraForms = e.formList.map((f) => f.form).filter((f) => fold(f) !== fold(e.nl));
  return { type: 'card', entryId: e.id, nl: e.display, forms: extraForms, es: e.es, note: e.note_es || null, audio: e.display };
}

/**
 * Matching game for review: the given entries (graded), topped up with other
 * known words to at least three pairs (not graded).
 */
export function wordsMatchStep(entries, fillers, rnd) {
  const pairs = [];
  const seenEs = new Set(), seenNl = new Set();
  const add = (e, graded) => {
    const es = e.es[0];
    if (seenEs.has(fold(es)) || seenNl.has(fold(e.display))) return false;
    seenEs.add(fold(es)); seenNl.add(fold(e.display));
    pairs.push({ id: e.id, nl: e.display, es, audio: e.display, key: graded ? 'w:' + e.id : null });
    return true;
  };
  const left = [];
  for (const e of entries) if (!add(e, true)) left.push(e);
  for (const e of shuffled(fillers, rnd)) { if (pairs.length >= 3) break; add(e, false); }
  if (pairs.length < 3) return { step: null, left: entries };
  return { step: { type: 'match', pairs, left: shuffled(pairs.map((p) => p.id), rnd), right: shuffled(pairs.map((p) => p.id), rnd) }, left };
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
    // the lesson's own new words are graded for the review schedule; older ones are just practice
    pairs.push({ id: e.id, nl: e.display, es, audio: e.display, key: e.intro === lessonId ? 'w:' + e.id : null });
  }
  if (pairs.length < 3) return null;
  return { type: 'match', pairs, left: shuffled(pairs.map((p) => p.id), rnd), right: shuffled(pairs.map((p) => p.id), rnd) };
}

// ---------- which exercise for which sentence ----------
// Recognition first, production later in the lesson.
const PATTERN = ['mc', 'nl2es', 'es2nl', 'listen', 'mc', 'gap', 'type', 'listen', 'nl2es', 'order', 'es2nl', 'listen', 'gap', 'type'];
const LONG_FOR_TYPING = 5;      // in sections 1 and 2, longer sentences are built from tiles instead

export function sentenceStep(course, s, wanted, ctx) {
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
  if (kind === 'gap') {
    const step = gapStep(course, s, lessonId, rnd);
    if (step) return step;
    kind = 'es2nl';
  }
  if (kind === 'order') {
    if (nNl >= 4) return orderStep(course, s, rnd);
    kind = 'es2nl';
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
export function buildLesson(course, lessonId, { attempt = 0, canListen = true, canSpeak = false } = {}) {
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
  // two sentences are also said aloud, right after their exercise: one around
  // the middle of the lesson and one at the end
  const speakAt = new Set();
  if (canSpeak) {
    const eligible = lesson.sentences.map((s, i) => (canBeSpoken(course, s) ? i : -1)).filter((i) => i >= 0);
    if (eligible.length) {
      const mid = Math.floor(lesson.sentences.length / 2);
      speakAt.add(eligible.reduce((best, i) => (Math.abs(i - mid) < Math.abs(best - mid) ? i : best)));
      speakAt.add(eligible[eligible.length - 1]);
    }
  }
  lesson.sentences.forEach((s, i) => {
    for (const e of course.entriesIn(s.nl, lessonId)) {
      if (e.intro === lessonId && !shown.has(e.id)) { shown.add(e.id); steps.push(cardStep(e)); }
    }
    steps.push(sentenceStep(course, s, PATTERN[(i + offset) % PATTERN.length], ctx));
    if (speakAt.has(i)) steps.push(speakStep(s));
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

/** Steps that count for the score. Speaking is practice and does not. */
export function isGraded(step) { return step.type !== 'card' && step.type !== 'dialogue' && step.type !== 'speak'; }
