import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, dayKey } from '../js/store.js';

function memory(initial = {}) {
  const m = new Map(Object.entries(initial));
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, v); }, map: m };
}
function clock(iso) {
  const c = { t: new Date(iso) };
  c.now = () => new Date(c.t);
  c.addDays = n => { c.t = new Date(c.t.getTime() + n * 86400000); };
  return c;
}

test('completing lessons: points, first time, accuracy bonus', () => {
  const c = clock('2026-11-15T10:00:00');
  const s = createStore(memory(), c.now);
  assert.equal(s.isDone('u01l1'), false);
  assert.deepEqual(s.completeLesson('u01l1', { correct: 12, total: 12 }), { xp: 15, firstTime: true, streak: 1 });
  assert.deepEqual(s.completeLesson('u01l2', { correct: 8, total: 12 }), { xp: 10, firstTime: true, streak: 1 });
  assert.deepEqual(s.completeLesson('u01l1', { correct: 5, total: 12 }), { xp: 5, firstTime: false, streak: 1 });
  assert.equal(s.data.xp, 30);
  assert.equal(s.isDone('u01l1'), true);
  assert.equal(s.attempts('u01l1'), 2);
  assert.equal(s.data.lessons.u01l1.best, 1);          // best accuracy is kept
  assert.equal(s.doneToday(), 3);
});

test('streak: grows on consecutive days, survives until tomorrow, resets after a gap', () => {
  const c = clock('2026-11-15T22:00:00');
  const s = createStore(memory(), c.now);
  assert.equal(s.streak(), 0);
  s.completeLesson('a', { correct: 1, total: 1 });
  assert.equal(s.streak(), 1);
  c.addDays(1);
  assert.equal(s.streak(), 1, 'still alive the next day before practising');
  s.completeLesson('b', { correct: 1, total: 1 });
  assert.equal(s.streak(), 2);
  s.completeLesson('c', { correct: 1, total: 1 });
  assert.equal(s.streak(), 2, 'a second lesson the same day does not add a day');
  c.addDays(2);
  assert.equal(s.streak(), 0, 'a skipped day ends it');
  s.completeLesson('d', { correct: 1, total: 1 });
  assert.equal(s.streak(), 1);
  assert.equal(s.data.streak.best, 2);
});

test('streak uses the local calendar day, also across a month end and a clock change', () => {
  assert.equal(dayKey(new Date(2026, 0, 5, 0, 1)), '2026-01-05');
  const c = clock('2026-10-31T23:50:00');
  const s = createStore(memory(), c.now);
  s.completeLesson('a', { correct: 1, total: 1 });
  c.t = new Date('2026-11-01T00:10:00');
  s.completeLesson('b', { correct: 1, total: 1 });
  assert.equal(s.streak(), 2);
  // last Sunday of March: 23-hour day in Europe; the day count must still be 1
  const c2 = clock('2026-03-28T12:00:00');
  const s2 = createStore(memory(), c2.now);
  s2.completeLesson('a', { correct: 1, total: 1 });
  c2.t = new Date('2026-03-29T12:00:00');
  s2.completeLesson('b', { correct: 1, total: 1 });
  assert.equal(s2.streak(), 2);
});

test('progress survives a restart', () => {
  const mem = memory();
  const c = clock('2026-11-15T10:00:00');
  createStore(mem, c.now).completeLesson('u01l1', { correct: 3, total: 4 });
  const again = createStore(mem, c.now);
  assert.equal(again.isDone('u01l1'), true);
  assert.equal(again.data.xp, 10);
  assert.equal(again.streak(), 1);
});

test('unit test-out marks all lessons done once, without overwriting earned ones', () => {
  const c = clock('2026-11-15T10:00:00');
  const s = createStore(memory(), c.now);
  s.completeLesson('u01l1', { correct: 4, total: 4 });
  const r = s.passUnitTest(['u01l1', 'u01l2', 'u01l3']);
  assert.deepEqual(r, { xp: 10, added: 2 });
  assert.equal(s.data.lessons.u01l1.via, 'lesson');
  assert.equal(s.data.lessons.u01l2.via, 'test');
  assert.deepEqual(s.passUnitTest(['u01l1', 'u01l2', 'u01l3']), { xp: 0, added: 0 });
  assert.equal(s.streak(), 1);
});

test('leaving a lesson counts as an attempt but not as done', () => {
  const s = createStore(memory(), clock('2026-11-15T10:00:00').now);
  s.noteAttempt('u01l1');
  assert.equal(s.attempts('u01l1'), 1);
  assert.equal(s.isDone('u01l1'), false);
  assert.equal(s.streak(), 0);
});

test('reports are stored with a time and capped', () => {
  const s = createStore(memory(), clock('2026-11-15T10:00:00').now);
  for (let i = 0; i < 510; i++) s.report({ id: 'x' + i, given: 'a', expected: 'b' });
  assert.equal(s.data.reports.length, 500);
  assert.equal(s.data.reports[0].id, 'x10');
  assert.ok(s.data.reports[0].at.startsWith('2026-11-15'));
});

test('export and import: round trip, and rejection of anything else', () => {
  const c = clock('2026-11-15T10:00:00');
  const a = createStore(memory(), c.now);
  a.completeLesson('u01l1', { correct: 4, total: 4 });
  a.report({ id: 'u01l1s02', given: 'yo soy anna', expected: 'Soy Anna.' });
  const text = a.exportText();

  const b = createStore(memory(), c.now);
  assert.equal(b.importText(text), null);
  assert.equal(b.isDone('u01l1'), true);
  assert.equal(b.data.reports.length, 1);
  assert.equal(b.data.xp, 15);

  const before = b.exportText();
  assert.match(b.importText('not json'), /no es una copia válida/);
  assert.match(b.importText('{"app":"other","progress":{}}'), /no es una copia de esta app/);
  assert.match(b.importText(JSON.stringify({ app: 'tegeltjes', progress: { schema: 99 } })), /no es una copia/);
  assert.equal(JSON.parse(b.exportText()).progress.xp, JSON.parse(before).progress.xp, 'a failed import changes nothing');
});

test('broken or blocked storage does not crash the app', () => {
  const c = clock('2026-11-15T10:00:00');
  const mem = memory({ 'tegeltjes.progress.v1': '{oops' });
  const corrupt = createStore(mem, c.now);
  assert.equal(corrupt.data.xp, 0);
  corrupt.completeLesson('u01l1', { correct: 1, total: 1 });
  assert.equal(mem.map.get('tegeltjes.progress.v1.unreadable'), '{oops', 'unreadable data is set aside, not destroyed');
  const newer = memory({ 'tegeltjes.progress.v1': '{"schema":2,"lessons":{"x":{"done":true}}}' });
  createStore(newer, c.now).noteAttempt('u01l1');
  assert.match(newer.map.get('tegeltjes.progress.v1.unreadable'), /"schema":2/, 'data from a newer version is kept');
  const wrongSchema = createStore(memory({ 'tegeltjes.progress.v1': '{"schema":0}' }), c.now);
  assert.equal(wrongSchema.data.xp, 0);
  const blocked = createStore({ getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } }, c.now);
  blocked.completeLesson('u01l1', { correct: 1, total: 1 });
  assert.equal(blocked.isDone('u01l1'), true, 'works in memory');
  assert.equal(blocked.persisted, false, 'and says it could not save');
  const none = createStore(null, c.now);
  none.completeLesson('u01l1', { correct: 1, total: 1 });
  assert.equal(none.persisted, false);
});
