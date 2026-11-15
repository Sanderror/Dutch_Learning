// Review sessions on the real course and on a real save from version 0.2.0.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildCourse } from '../js/content.js';
import { tileWords } from '../js/exercises.js';
import { check, fold } from '../js/checker.js';
import { addDays, daysBetween, retrievability } from '../js/fsrs.js';
import { lessonItems, reviewSentences, REVIEW_SENTENCES, SPEAK_PER_REVIEW, sync, gradeLesson, rate, dueKeys, buildReview, kindFor, emptyReviews, itemOf, BACKLOG_PER_DAY, SESSION_SIZE } from '../js/review.js';
import { upgrade } from '../js/store.js';

const root = new URL('../../content/', import.meta.url);
const read = (p) => JSON.parse(fs.readFileSync(new URL(p, root), 'utf8'));
const courseJson = read('course.json');
const course = buildCourse(courseJson, read('lexicon.json'), courseJson.units.map((u) => read(`units/${u}.json`)));
const saved = JSON.parse(fs.readFileSync(new URL('./fixtures/progress_schema1.json', import.meta.url), 'utf8'));
const TODAY = '2026-11-20';

test('a lesson brings four of its sentences and all its new words', () => {
  for (const id of course.lessonOrder) {
    const items = lessonItems(course, id);
    const ss = reviewSentences(course, id);
    assert.equal(ss.length, REVIEW_SENTENCES, id);
    assert.equal(items.filter((k) => k.startsWith('s:')).length, REVIEW_SENTENCES);
    assert.equal(items.filter((k) => k.startsWith('w:')).length, course.newEntries(id).length);
    for (const k of items) assert.ok(itemOf(course, k), k);
    const long = ss.filter((s) => tileWords(s.nl, course.proper).length >= 3).length;
    assert.ok(long >= Math.min(REVIEW_SENTENCES, 3), `${id}: mostly real sentences`);
  }
  // spread over the lesson, not the first four
  const all = course.lessonInfo.get('u05l3').lesson.sentences.map((s) => s.id);
  const picked = reviewSentences(course, 'u05l3').map((s) => all.indexOf(s.id));
  assert.ok(picked[picked.length - 1] - picked[0] >= all.length / 2, 'spread: ' + picked);
});

test('her save from 0.2.0: upgrade, then the finished lessons go into a backlog of at most 8 a day', () => {
  const data = upgrade(JSON.parse(JSON.stringify(saved)));
  assert.equal(data.schema, 2);
  assert.deepEqual(data.reviews, { cards: {} });
  const isDone = (id) => !!(data.lessons[id] && data.lessons[id].done);
  const added = sync(data.reviews, course, isDone, TODAY);
  const expected = course.lessonOrder.filter(isDone).flatMap((id) => lessonItems(course, id)).length;
  assert.equal(added, expected);
  const perDay = {};
  for (const c of Object.values(data.reviews.cards)) perDay[c.due] = (perDay[c.due] || 0) + 1;
  const days = Object.keys(perDay).sort();
  assert.equal(days[0], TODAY, 'starts today');
  assert.ok(Object.values(perDay).every((n) => n <= BACKLOG_PER_DAY));
  assert.equal(days.length, Math.ceil(expected / BACKLOG_PER_DAY), 'no gaps');
  assert.equal(daysBetween(days[0], days[days.length - 1]), days.length - 1, 'consecutive days');
  // unit 1 comes before unit 2
  assert.ok(data.reviews.cards[lessonItems(course, 'u01l1')[0]].due <= data.reviews.cards[lessonItems(course, 'u02l6')[0]].due);
  assert.equal(sync(data.reviews, course, isDone, TODAY), 0, 'calling it again adds nothing');
  console.log(`    backlog from her save: ${expected} items over ${days.length} days`);
});

test('finishing a lesson rates its items: right = in 4 days, wrong = tomorrow; a repeat changes nothing', () => {
  const state = emptyReviews();
  const items = lessonItems(course, 'u03l2');
  const wrong = items[2];
  gradeLesson(state, course, 'u03l2', { [wrong]: false }, TODAY);
  assert.equal(state.cards[wrong].due, addDays(TODAY, 1));
  assert.equal(state.cards[items[0]].due, addDays(TODAY, 4));
  assert.equal(Object.keys(state.cards).length, items.length);
  const before = JSON.stringify(state);
  gradeLesson(state, course, 'u03l2', {}, addDays(TODAY, 1));
  assert.equal(JSON.stringify(state), before);
});

test('due items: oldest first, rated before backlog, missing content skipped', () => {
  const state = { cards: {
    's:u01l1s01': { due: '2026-11-19' },
    's:u01l1s02': { due: '2026-11-18', s: 2, d: 5, last: '2026-11-15', n: 1, lapses: 0 },
    's:u01l1s03': { due: '2026-11-19', s: 2, d: 5, last: '2026-11-16', n: 1, lapses: 0 },
    's:u01l1s04': { due: '2026-11-21' },
    's:gone99': { due: '2026-11-01' },
  } };
  assert.deepEqual(dueKeys(state, course, TODAY), ['s:u01l1s02', 's:u01l1s03', 's:u01l1s01']);
});

test('the exercise gets harder as she knows the sentence better', () => {
  assert.ok(['mc', 'nl2es'].includes(kindFor({ due: TODAY }, 0)));
  assert.ok(['mc', 'nl2es'].includes(kindFor({ s: 2 }, 1)));
  const medium = new Set([0, 1, 2, 3].map((i) => kindFor({ s: 5 }, i)));
  assert.deepEqual([...medium].sort(), ['es2nl', 'gap', 'listen', 'order']);
  const strong = new Set([0, 1, 2, 3].map((i) => kindFor({ s: 30 }, i)));
  assert.deepEqual([...strong].sort(), ['gap', 'listen', 'type']);
});

function playable(st) {
  if (st.type === 'gap') return st.options.length === 3 && st.answer >= 0;
  if (st.type === 'mc') return st.options.length === 3 && st.options[st.answer] === st.reveal.es;
  if (st.type === 'match') return st.pairs.length >= 3 && new Set(st.pairs.map((p) => fold(p.es))).size === st.pairs.length;
  const answer = st.lang === 'es' ? st.reveal.es : st.reveal.nl;
  if (st.type === 'tiles') {
    const pool = st.tiles.map((t) => t.text);
    for (const w of tileWords(answer, course.proper)) { const i = pool.indexOf(w); if (i < 0) return false; pool.splice(i, 1); }
  }
  return check(answer, st.accepted, { lang: st.lang, knownForms: course.allForms }).ok;
}

test('a review session: at most 15 items, each rated once, every exercise solvable', () => {
  const data = upgrade(JSON.parse(JSON.stringify(saved)));
  const isDone = (id) => !!(data.lessons[id] && data.lessons[id].done);
  sync(data.reviews, course, isDone, TODAY);
  // make everything due to stress the builder
  for (const c of Object.values(data.reviews.cards)) c.due = TODAY;
  for (let round = 0; round < 6; round++) {
    const r = buildReview(course, data.reviews, TODAY, { round, canSpeak: true });
    assert.ok(r.keys.length > 0 && r.keys.length <= SESSION_SIZE, `round ${round}: ${r.keys.length} items`);
    const quiet = buildReview(course, data.reviews, TODAY, { round });
    assert.equal(quiet.steps.filter((x) => x.type === 'speak').length, 0);
    const speak = r.steps.filter((x) => x.type === 'speak');
    assert.ok(speak.length <= SPEAK_PER_REVIEW);
    r.steps.forEach((st, i) => {
      if (st.type !== 'speak') return;
      assert.equal(st.key, undefined, 'speaking does not rate the item');
      assert.equal(r.steps[i - 1].sid, st.sid, 'said right after its exercise');
    });
    const keysInSteps = [];
    for (const st of r.steps.filter((x) => x.type !== 'speak')) {
      assert.ok(playable(st), `round ${round}: unsolvable ${st.type} ${st.mode || ''} ${st.key || ''}`);
      if (st.key) keysInSteps.push(st.key);
      if (st.pairs) for (const p of st.pairs) if (p.key) keysInSteps.push(p.key);
    }
    assert.equal(new Set(keysInSteps).size, keysInSteps.length, 'no item twice');
    assert.deepEqual([...keysInSteps].sort(), [...r.keys].sort());
    for (const k of r.keys) rate(data.reviews, k, true, TODAY);
  }
});

test('sixty days of use: daily review load stays small', () => {
  // She has finished units 1 and 2 (her real save), then does one new lesson a
  // day and every review that is due, right 85% of the time at the first try.
  const data = upgrade(JSON.parse(JSON.stringify(saved)));
  const isDone = (id) => !!(data.lessons[id] && data.lessons[id].done);
  let day = TODAY;
  sync(data.reviews, course, isDone, day);
  let n = 0;
  const rnd = () => ((n = (n * 1103515245 + 12345) % 2147483648) / 2147483648);
  const loads = [];
  for (let i = 0; i < 60; i++) {
    const due = dueKeys(data.reviews, course, day);
    loads.push(due.length);
    for (const k of due) {
      // she remembers with the probability the scheduler predicts
      const c = data.reviews.cards[k];
      const p = typeof c.s === 'number' ? retrievability(daysBetween(c.last, day), c.s) : 0.8;
      rate(data.reviews, k, rnd() < p, day);
    }
    const next = course.lessonOrder.find((id) => !isDone(id));
    if (next) {
      const outcomes = Object.fromEntries(lessonItems(course, next).map((k) => [k, rnd() < 0.8]));
      gradeLesson(data.reviews, course, next, outcomes, day);
      data.lessons[next] = { done: true };
    }
    day = addDays(day, 1);
  }
  const avg = loads.reduce((a, b) => a + b, 0) / loads.length;
  const max = Math.max(...loads);
  // a matching game rates up to five words in one step, so steps < items

  console.log(`    due per day over 60 days: average ${avg.toFixed(1)}, max ${max}; weeks: ${[0, 1, 2, 3, 4, 5, 6, 7].map((w) => loads.slice(w * 7, w * 7 + 7).reduce((a, b) => a + b, 0)).join(', ')}`);
  assert.ok(avg <= 2 * SESSION_SIZE, 'on average two short sessions a day at most');
});
