// The scheduler, checked against values worked out by hand from the FSRS-6
// formulas and default parameters (see the comments for the arithmetic).
import test from 'node:test';
import assert from 'node:assert/strict';
import { W, Rating, retrievability, nextState, intervals, review, addDays, daysBetween, MAX_INTERVAL } from '../js/fsrs.js';

const near = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('retrievability is 90% after exactly one stability, falls with time', () => {
  for (const s of [0.5, 2.3, 10, 100]) near(retrievability(s, s), 0.9, 1e-9);
  assert.equal(retrievability(0, 5), 1);
  assert.ok(retrievability(10, 5) < 0.9 && retrievability(10, 5) > retrievability(20, 5));
});

test('a new item: stability w0..w3, difficulty w4 - e^((g-1)w5) + 1', () => {
  near(nextState(null, 0, Rating.Again).s, 0.212);
  near(nextState(null, 0, Rating.Good).s, 2.3065);
  near(nextState(null, 0, Rating.Again).d, W[4]);                           // e^0 = 1
  near(nextState(null, 0, Rating.Good).d, 6.4133 - Math.exp(2 * 0.8334) + 1); // 2.1180
});

test('first intervals in days at 90%: again 1, hard 2, good 3, easy 8', () => {
  // raw: round(0.212)=0 -> 1, round(1.2931)=1, round(2.3065)=2, round(8.2956)=8;
  // kept in order: again=min(1,1)=1, hard=max(1,2)=2, good=max(2,3)=3, easy=max(8,4)=8
  assert.deepEqual(intervals(null, 0, 0.9).days, [1, 2, 3, 8]);
});

test('at 85%, the target the app uses, intervals are 1.906 times longer', () => {
  // modifier = (0.85^(1/-0.1542) - 1) / FACTOR = (2.86899 - 1) / 0.98042 = 1.9063
  // raw: round(0.404)=0 -> 1, round(2.465)=2, round(4.397)=4, round(15.81)=16
  assert.deepEqual(intervals(null, 0).days, [1, 2, 4, 16]);
});

test('remembering grows the interval; forgetting shrinks stability', () => {
  let card = review(null, Rating.Good, '2026-11-15', 0.9);
  assert.equal(card.due, '2026-11-18');
  const gaps = [];
  for (let i = 0; i < 4; i++) {                       // 3, 14, 57, 196 days: still under the one-year cap
    const before = card;
    card = review(card, Rating.Good, card.due, 0.9);
    gaps.push(daysBetween(before.due, card.due));
    assert.ok(card.s > before.s, 'stability grows on each success');
  }
  for (let i = 1; i < gaps.length; i++) assert.ok(gaps[i] > gaps[i - 1], 'intervals grow: ' + gaps);
  const lapsed = review(card, Rating.Again, card.due);
  assert.ok(lapsed.s < card.s, 'a lapse lowers stability');
  assert.ok(lapsed.d > card.d, 'and raises difficulty');
  assert.equal(lapsed.lapses, 1);
  assert.ok(daysBetween(lapsed.last, lapsed.due) < daysBetween(card.last, card.due));
});

test('a recall right on time: S grows by the FSRS-6 recall formula', () => {
  // s = 10, d = 5, reviewed after exactly 10 days: R = 0.9
  // S' = 10 * (1 + e^1.8722 * (11-5) * 10^-0.1666 * (e^(0.1*0.796) - 1))
  //    = 10 * (1 + 6.5025 * 6 * 0.68140 * 0.082854) = 10 * 3.20267 = 32.027
  const next = nextState({ s: 10, d: 5 }, 10, Rating.Good);
  near(next.s, 32.027, 0.01);
  // D' = 0.001 * D0(4) + 0.999 * (5 + 0) ; D0(4) = 6.4133 - e^(3*0.8334) + 1 = -4.7716
  near(next.d, 0.001 * (6.4133 - Math.exp(3 * 0.8334) + 1) + 0.999 * 5, 1e-6);
});

test('calendar days and the one-year cap', () => {
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
  assert.equal(daysBetween('2026-11-15', '2027-03-01'), 106);
  assert.equal(daysBetween('2027-03-27', '2027-03-29'), 2, 'across the summer-time change');
  let card = review(null, Rating.Easy, '2026-01-01');
  for (let i = 0; i < 15; i++) {
    card = review(card, Rating.Easy, card.due);
    assert.ok(daysBetween(card.last, card.due) <= MAX_INTERVAL, 'never more than a year');
  }
  for (const g of [1, 2, 3, 4]) {
    const c = review(card, g, card.due);
    assert.ok(daysBetween(c.last, c.due) <= MAX_INTERVAL, 'cap holds for every grade');
  }
});
