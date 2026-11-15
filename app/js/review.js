// Review sessions: what she has learned comes back just before she would
// forget it. Every sentence and every word card is an item with a card in the
// FSRS scheduler (fsrs.js). Pure logic over the course and a plain state
// object { cards: { key: card } } that the store saves; tested in
// app/tests/review.test.mjs.
//
// Keys: "s:<sentence id>" for a sentence, "w:<lexicon entry id>" for a word.
// Both kinds of id are permanent (content/published_ids.json for sentences).
//
// Which items: every new word of a lesson, and REVIEW_SENTENCES of its
// sentences (real sentences of three words or more, spread over the lesson).
// Reviewing all 13 sentences of every lesson would mean about 60 reviews a
// day; with four it is about 28, some five minutes (simulation in the tests).
//
// How items enter the schedule:
// - Finishing a lesson for the first time rates its sentences and new words:
//   right at the first try = Good, wrong = Again.
// - Lessons that were finished before reviews existed, or passed with the
//   unit test, go into a backlog: at most BACKLOG_PER_DAY of their items
//   become due each day, so the first review day is not a wall of work.

import { review, Rating } from './fsrs.js';
import { seedRandom, shuffled, sentenceStep, wordsMatchStep, tileWords, speakStep, canBeSpoken } from './exercises.js';

export const BACKLOG_PER_DAY = 8;
export const REVIEW_SENTENCES = 4;
export const SESSION_SIZE = 15;
const MATCH_SIZE = 5;

export function emptyReviews() { return { cards: {} }; }

/** The sentences of a lesson that go into reviews: longer ones first choice, spread over the lesson. */
export function reviewSentences(course, lessonId) {
  const { lesson } = course.lessonInfo.get(lessonId);
  const all = lesson.sentences;
  const real = all.filter((s) => tileWords(s.nl, course.proper).length >= 3);
  const pool = real.length >= REVIEW_SENTENCES ? real : all;
  const n = Math.min(REVIEW_SENTENCES, pool.length);
  const picked = Array.from({ length: n }, (_, i) => pool[Math.floor(((i + 0.5) * pool.length) / n)]);
  return all.filter((s) => picked.includes(s));      // keep lesson order
}

/** The items a lesson introduces: its review sentences, then its new words. */
export function lessonItems(course, lessonId) {
  return [...reviewSentences(course, lessonId).map((s) => 's:' + s.id), ...course.newEntries(lessonId).map((e) => 'w:' + e.id)];
}

/** Find what a key points at in the current course; null if it is not there (retired). */
export function itemOf(course, key) {
  if (!course._sentenceIndex) {
    const idx = new Map();
    for (const id of course.lessonOrder) {
      const info = course.lessonInfo.get(id);
      for (const s of info.lesson.sentences) idx.set(s.id, { s, lessonId: id, unit: info.unit });
    }
    Object.defineProperty(course, '_sentenceIndex', { value: idx, enumerable: false });
  }
  if (key.startsWith('s:')) {
    const hit = course._sentenceIndex.get(key.slice(2));
    return hit ? { kind: 'sentence', ...hit } : null;
  }
  if (key.startsWith('w:')) {
    const e = course.byId.get(key.slice(2));
    return e ? { kind: 'word', entry: e, lessonId: e.intro } : null;
  }
  return null;
}

/**
 * Put every item of every finished lesson into the schedule. Items without a
 * card join the backlog, spread over the coming days. Safe to call any time;
 * returns how many items were added.
 */
export function sync(state, course, isDone, today) {
  const perDay = new Map();
  for (const c of Object.values(state.cards)) {
    if (typeof c.s !== 'number') perDay.set(c.due, (perDay.get(c.due) || 0) + 1);
  }
  let day = today, added = 0;
  for (const lessonId of course.lessonOrder) {
    if (!isDone(lessonId)) continue;
    for (const key of lessonItems(course, lessonId)) {
      if (state.cards[key]) continue;
      while ((perDay.get(day) || 0) >= BACKLOG_PER_DAY || day < today) day = nextDay(day);
      state.cards[key] = { due: day };
      perDay.set(day, (perDay.get(day) || 0) + 1);
      added++;
    }
  }
  return added;
}

function nextDay(day) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/**
 * First completion of a lesson: rate its items from how she did.
 * `outcomes` maps a key to true (right at the first try) or false.
 * Items that already have a rated card (a repeated lesson) are left alone.
 */
export function gradeLesson(state, course, lessonId, outcomes, today) {
  let rated = 0;
  for (const key of lessonItems(course, lessonId)) {
    const card = state.cards[key];
    if (card && typeof card.s === 'number') continue;
    const g = outcomes[key] === false ? Rating.Again : Rating.Good;
    state.cards[key] = review(null, g, today);
    rated++;
  }
  return rated;
}

/** Rate one item after a review. */
export function rate(state, key, ok, today) {
  state.cards[key] = review(state.cards[key], ok ? Rating.Good : Rating.Again, today);
}

/** Keys due today or earlier that still exist in the course: oldest first, rated items before new ones. */
export function dueKeys(state, course, today) {
  return Object.entries(state.cards)
    .filter(([key, c]) => c.due <= today && itemOf(course, key))
    .sort(([ka, a], [kb, b]) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0)
      || ((typeof a.s === 'number' ? 0 : 1) - (typeof b.s === 'number' ? 0 : 1))
      || (ka < kb ? -1 : 1))
    .map(([key]) => key);
}

/**
 * Which exercise a sentence gets, by how well she knows it:
 * new or weak (stability under 3 days): recognise the meaning;
 * medium (under 10 days): build the Dutch, fill the gap, listen, or order the words;
 * strong: type the Dutch, write what she hears, or fill the gap.
 */
const MEDIUM = ['es2nl', 'gap', 'listen', 'order'];
const STRONG = ['type', 'listen', 'type', 'gap'];
export function kindFor(card, i) {
  const s = card && typeof card.s === 'number' ? card.s : 0;
  if (s < 3) return i % 2 === 0 ? 'mc' : 'nl2es';
  if (s < 10) return MEDIUM[i % MEDIUM.length];
  return STRONG[i % STRONG.length];
}

export const SPEAK_PER_REVIEW = 3;

/**
 * A review session: up to SESSION_SIZE due items. Each sentence becomes one
 * exercise; due words are played in matching games of up to five.
 * Every graded step carries the key(s) it rates.
 */
export function buildReview(course, state, today, { canListen = true, canSpeak = false, round = 0 } = {}) {
  const keys = dueKeys(state, course, today).slice(0, SESSION_SIZE);
  const rnd = seedRandom('review:' + today + ':' + round);
  const sentenceSteps = [];
  const words = [];
  let nSentences = 0, spoken = 0;
  shuffled(keys, rnd).forEach((key) => {
    const item = itemOf(course, key);
    if (item.kind === 'word') { words.push(item.entry); return; }
    const { s, lessonId, unit } = item;
    const earlier = course.sentencesBefore(lessonId);
    const sentences = course.lessonInfo.get(lessonId).lesson.sentences;
    const ctx = {
      lessonId, section: unit.section, canListen, rnd,
      lessonSentences: [...sentences, ...earlier.slice(-30)],
      mcPool: [...sentences, ...earlier.slice(-60)],
    };
    const step = sentenceStep(course, s, kindFor(state.cards[key], nSentences), ctx);
    sentenceSteps.push({ ...step, key });
    nSentences++;
    // a few sentences are also said aloud, right after their exercise (practice: no key, not rated)
    if (canSpeak && spoken < SPEAK_PER_REVIEW && canBeSpoken(course, s)) { sentenceSteps.push(speakStep(s)); spoken++; }
  });

  // words: matching games, topped up with other words she knows
  const known = new Set(Object.keys(state.cards).filter((k) => k.startsWith('w:')).map((k) => k.slice(2)));
  const fillers = course.entries.filter((e) => known.has(e.id) && !words.includes(e));
  const wordSteps = [];
  let queue = words.slice();
  while (queue.length) {
    const group = queue.slice(0, MATCH_SIZE);
    const { step, left } = wordsMatchStep(group, fillers, rnd);
    if (!step) break;                       // too few words known to make a game: they wait
    wordSteps.push(step);
    const placed = new Set(step.pairs.map((p) => p.id));
    queue = [...left.filter((e) => !placed.has(e.id)), ...queue.slice(MATCH_SIZE)];
    if (left.length === group.length) break;
  }

  // spread the matching games through the session
  const steps = sentenceSteps.slice();
  wordSteps.forEach((w, i) => {
    let at = Math.round(((i + 1) * steps.length) / (wordSteps.length + 1));
    if (steps[at] && steps[at].type === 'speak') at++;      // not between a sentence and saying it
    steps.splice(at, 0, w);
  });
  const graded = new Set();
  for (const st of steps) {
    if (st.key) graded.add(st.key);
    if (st.pairs) for (const p of st.pairs) if (p.key) graded.add(p.key);
  }
  return { id: 'review', kind: 'review', title: 'Repaso', steps, keys: [...graded] };
}

/** How many items are due today. */
export function dueCount(state, course, today) { return dueKeys(state, course, today).length; }

/** For the tests and the settings screen. */
export function summary(state) {
  const cards = Object.values(state.cards);
  return { total: cards.length, rated: cards.filter((c) => typeof c.s === 'number').length };
}

