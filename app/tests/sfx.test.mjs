import test from 'node:test';
import assert from 'node:assert/strict';
import { createSfx, PATTERNS, AFTER_MS } from '../js/sfx.js';

function fakeWindow() {
  const log = { contexts: 0, oscillators: [], vibrations: [] };
  const param = () => ({ setValueAtTime() {}, exponentialRampToValueAtTime() {} });
  class FakeContext {
    constructor() { log.contexts++; this.currentTime = 0; this.state = 'running'; this.destination = {}; }
    createOscillator() {
      const o = { type: '', frequency: param(), connect() {}, start(t) { o.at = t; }, stop() {} };
      log.oscillators.push(o);
      return o;
    }
    createGain() { return { gain: param(), connect() {} }; }
  }
  return { log, win: { AudioContext: FakeContext, navigator: { vibrate: (ms) => log.vibrations.push(ms) } } };
}

test('each sound plays its notes; wrong also vibrates', () => {
  const { log, win } = fakeWindow();
  const sfx = createSfx({ win, enabled: () => true });
  assert.equal(sfx.correct(), true);
  assert.equal(log.oscillators.length, PATTERNS.correct.notes.length);
  sfx.wrong();
  assert.equal(log.oscillators.length, PATTERNS.correct.notes.length + PATTERNS.wrong.notes.length);
  assert.deepEqual(log.vibrations, [60]);
  sfx.finish();
  assert.equal(log.contexts, 1, 'one audio context, made on the first sound');
  assert.equal(sfx.gap(), AFTER_MS);
});

test('switched off: no sound, no vibration, no delay for the Dutch audio', () => {
  const { log, win } = fakeWindow();
  const sfx = createSfx({ win, enabled: () => false });
  assert.equal(sfx.correct(), false);
  assert.equal(sfx.wrong(), false);
  assert.equal(log.oscillators.length, 0);
  assert.deepEqual(log.vibrations, []);
  assert.equal(sfx.gap(), 0);
});

test('a phone without Web Audio: no crash, no delay', () => {
  const sfx = createSfx({ win: {}, enabled: () => true });
  assert.equal(sfx.correct(), false);
  assert.equal(sfx.gap(), 0);
});

test('the right answer sounds higher than the wrong one', () => {
  const top = (p) => Math.max(...PATTERNS[p].notes.map((n) => n[0]));
  assert.ok(top('correct') > 2 * top('wrong'));
  assert.ok(PATTERNS.correct.notes.every((n) => n[2] < 0.3), 'short enough not to slow her down');
});
