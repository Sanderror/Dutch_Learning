// FSRS-6 spaced repetition, the scheduler that decides when she sees a
// sentence or word again. A small re-implementation of the open-source
// algorithm (https://github.com/open-spaced-repetition/ts-fsrs, MIT), with its
// default parameters and in its "long-term" mode: no relearning steps within
// the same day, every interval a whole number of days. Days are her local
// calendar days ("2026-11-15"), so "due tomorrow" means tomorrow morning too.
//
// Tested in app/tests/fsrs.test.mjs against values worked out by hand.

/** FSRS-6 default parameters w0..w20 (ts-fsrs 5.x/6.x, FSRS-6.0). */
export const W = Object.freeze([
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796,
  1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
]);
// 85%, not the usual 90%: in a 60-day simulation of her use (one lesson a day
// plus all due reviews) 90% meant about 30 reviews a day, 85% about 28 with
// the review items per lesson capped as in review.js, and every item still
// comes back. See app/tests/review.test.mjs.
export const RETENTION = 0.85;
export const MAX_INTERVAL = 365;          // she should see everything at least once a year
const S_MIN = 0.001;
const DECAY = -W[20];
const FACTOR = Math.exp(Math.log(0.9) / DECAY) - 1;      // so that R(S, S) = 0.9
const modifier = (retention) => (Math.pow(retention, 1 / DECAY) - 1) / FACTOR;   // 1 at 90% retention

export const Rating = Object.freeze({ Again: 1, Hard: 2, Good: 3, Easy: 4 });

const clamp = (x, lo, hi) => Math.min(Math.max(x, lo), hi);

/** Probability of recall after t days for stability s. */
export function retrievability(t, s) {
  return Math.pow(1 + (FACTOR * t) / s, DECAY);
}

function initStability(g) { return Math.max(W[g - 1], 0.1); }
function initDifficultyRaw(g) { return W[4] - Math.exp((g - 1) * W[5]) + 1; }
function initDifficulty(g) { return clamp(initDifficultyRaw(g), 1, 10); }

function nextDifficulty(d, g) {
  const delta = -W[6] * (g - 3);
  const damped = d + (delta * (10 - d)) / 9;             // linear damping
  return clamp(W[7] * initDifficultyRaw(Rating.Easy) + (1 - W[7]) * damped, 1, 10);   // mean reversion
}

function recallStability(d, s, r, g) {
  const hard = g === Rating.Hard ? W[15] : 1;
  const easy = g === Rating.Easy ? W[16] : 1;
  return clamp(s * (1 + Math.exp(W[8]) * (11 - d) * Math.pow(s, -W[9]) * (Math.exp((1 - r) * W[10]) - 1) * hard * easy), S_MIN, 36500);
}

function forgetStability(d, s, r) {
  const f = clamp(W[11] * Math.pow(d, -W[12]) * (Math.pow(s + 1, W[13]) - 1) * Math.exp((1 - r) * W[14]), S_MIN, 36500);
  return Math.min(f, s);                                   // forgetting never raises stability
}

function interval(s, retention) {
  return Math.min(Math.max(1, Math.round(s * modifier(retention))), MAX_INTERVAL);
}

/** Memory state after grade g, given the old state (null when new) and t days since the last review. */
export function nextState(state, t, g) {
  if (!state) return { d: initDifficulty(g), s: initStability(g) };
  const r = retrievability(t, state.s);
  const s = g === Rating.Again ? forgetStability(state.d, state.s, r) : recallStability(state.d, state.s, r, g);
  return { d: nextDifficulty(state.d, g), s };
}

/**
 * The intervals for all four grades, kept in order (again < hard < good < easy),
 * as ts-fsrs does in long-term mode.
 */
export function intervals(state, t, retention = RETENTION) {
  const st = [1, 2, 3, 4].map((g) => nextState(state, t, g));
  let again = interval(st[0].s, retention), hard = interval(st[1].s, retention), good = interval(st[2].s, retention), easy = interval(st[3].s, retention);
  again = Math.min(again, hard);
  hard = Math.max(hard, again + 1);
  good = Math.max(good, hard + 1);
  easy = Math.max(easy, good + 1);
  // the cap comes last, so the ordering above can never push past it
  return { states: st, days: [again, hard, good, easy].map((x) => Math.min(x, MAX_INTERVAL)) };
}

// ---------- calendar days ----------
export function addDays(dayKey, n) {
  const [y, m, d] = dayKey.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

export function daysBetween(a, b) {
  const [ya, ma, da] = a.split('-').map(Number), [yb, mb, db] = b.split('-').map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86400000);
}

/**
 * Review a card on `today` with grade g. A card is a small object so that a
 * year of them fits easily in the phone's storage:
 *   { due: "2026-11-18", s: stability, d: difficulty, last: "2026-11-15", n: reviews, lapses }
 * A card that was never rated has no `s`.
 */
export function review(card, g, today, retention = RETENTION) {
  const rated = card && typeof card.s === 'number';
  const prev = rated ? { s: card.s, d: card.d } : null;
  const t = rated ? Math.max(0, daysBetween(card.last, today)) : 0;
  const { states, days } = intervals(prev, t, retention);
  const next = states[g - 1];
  return {
    due: addDays(today, days[g - 1]),
    s: Math.round(next.s * 10000) / 10000,
    d: Math.round(next.d * 10000) / 10000,
    last: today,
    n: (rated ? card.n || 0 : 0) + 1,
    lapses: (rated ? card.lapses || 0 : 0) + (rated && g === Rating.Again ? 1 : 0),
  };
}
