// Unit tests for spike-a-speech/scoring.js. Run: node tools/test_scoring.mjs
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const S = require('../spike-a-speech/scoring.js');
const Items = require('../spike-a-speech/items.js');

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok  ' + name); }

t('numbers are written the Dutch way', () => {
  assert.equal(S.numberToDutch(0), 'nul');
  assert.equal(S.numberToDutch(3), 'drie');
  assert.equal(S.numberToDutch(17), 'zeventien');
  assert.equal(S.numberToDutch(20), 'twintig');
  assert.equal(S.numberToDutch(25), 'vijfentwintig');
  assert.equal(S.numberToDutch(80), 'tachtig');
  assert.equal(S.numberToDutch(99), 'negenennegentig');
  assert.equal(S.numberToDutch(100), 'honderd');
});

t('normalisation strips case, punctuation and accents', () => {
  assert.equal(S.normalize('Hallo, hoe gaat het?'), 'hallo hoe gaat het');
  assert.equal(S.normalize('Één  kopje  thee!'), 'een kopje thee');
  assert.equal(S.normalize("'s Morgens"), 's morgens');
});

t('digits from the recogniser match number words', () => {
  assert.ok(S.compare('Ik ben vijfentwintig jaar.', 'ik ben 25 jaar').exact);
  assert.ok(S.compare('Het is half drie.', 'Het is half 3').exact);
  assert.ok(S.compare('Ik heb twee broers.', 'ik heb 2 broers').exact);
  // 22 is spelled tweeëntwintig; the diaeresis must not break the match
  assert.ok(S.compare('Ik ben tweeëntwintig.', 'ik ben 22').exact);
});

t('different spacing of the same letters is exact', () => {
  assert.ok(S.compare('Dank je wel.', 'dankjewel').exact);
  assert.ok(S.compare('Ik ben vijfentwintig jaar.', 'ik ben vijf en twintig jaar').exact);
});

t('a different word is not exact, even if it is close', () => {
  assert.equal(S.compare('man', 'maan').exact, false);
  assert.equal(S.compare('zon', 'zoon').exact, false);
  assert.equal(S.compare('Waar kom je vandaan?', 'waar kom jij vandaan').exact, false);
});

t('word accuracy is 1 minus word error rate', () => {
  assert.equal(S.compare('Ik woon in Amsterdam.', 'ik woon in amsterdam').accuracy, 1);
  assert.equal(S.compare('Ik woon in Amsterdam.', 'ik woon in rotterdam').accuracy, 0.75);
  assert.equal(S.compare('Ik woon in Amsterdam.', '').accuracy, 0);
  // many inserted words cannot push accuracy below zero
  assert.equal(S.compare('goed', 'dat is heel erg goed hoor').accuracy, 0);
});

t('an attempt is judged on the top alternative; others are reported separately', () => {
  const alts = [{ transcript: 'de deur is licht', confidence: 0.6 }, { transcript: 'de deur is dicht', confidence: 0.3 }];
  const s = S.scoreAttempt('De deur is dicht.', alts);
  assert.equal(s.exact, false);
  assert.equal(s.anyExact, true);
  assert.equal(s.accuracy, 0.75);
  const none = S.scoreAttempt('De deur is dicht.', []);
  assert.deepEqual([none.exact, none.anyExact, none.accuracy], [false, false, 0]);
});

t('summary counts first attempts only for the pass rate', () => {
  const ok = [{ transcript: 'tot morgen', confidence: 0.9 }];
  const wrong = [{ transcript: 'tot morgens', confidence: 0.9 }];
  const items = [
    { target: 'Tot morgen!', attempts: [{ alternatives: ok, error: null }] },
    { target: 'Tot morgen!', attempts: [{ alternatives: wrong, error: null }, { alternatives: ok, error: null }] },
    { target: 'Tot morgen!', attempts: [{ alternatives: [], error: 'no-speech' }] },
    { target: 'Tot morgen!', attempts: [] }
  ];
  const s = S.summarize(items);
  assert.equal(s.total, 4);
  assert.equal(s.done, 3);
  assert.equal(s.firstExact, 1);
  assert.equal(s.bestOfAttemptsExact, 2);
  assert.equal(s.firstAttemptNoResult, 1);
  assert.deepEqual(s.errors, { 'no-speech': 1 });
  assert.ok(Math.abs(s.firstExactRate - 1 / 3) < 1e-9);
});

t('test material: 30 sentences, 10 words, every target matches itself', () => {
  assert.equal(Items.sets.frases.items.length, 30);
  assert.equal(Items.sets.palabras.items.length, 10);
  for (const key of Object.keys(Items.sets)) {
    for (const it of Items.sets[key].items) assert.ok(S.compare(it, it).exact, it);
  }
  assert.equal(new Set(Items.sets.frases.items).size, 30);
});


t('clock times from the recogniser match how they are said', () => {
  assert.ok(S.compare('Het is half drie.', 'het is 2:30').exact);
  assert.ok(S.compare('Het is half drie.', 'het is 14:30').exact);
  assert.ok(S.compare('Het is half drie.', 'Het is 14.30').exact);
  assert.ok(S.compare('Het is kwart over vier.', 'het is 4:15').exact);
  assert.ok(S.compare('Het is kwart voor negen.', 'het is 8:45').exact);
  assert.ok(S.compare('Het is tien voor half acht.', 'het is 7:20').exact);
  assert.ok(S.compare('Het is vijf over half twaalf.', 'het is 11:35').exact);
  assert.ok(S.compare('Het is drie uur.', 'het is 3:00').exact);
  assert.ok(S.compare('Het is half een.', 'het is 12:30').exact);
  assert.ok(S.compare('Het is twaalf uur.', 'het is 0:00').exact);
  // a different time stays wrong
  assert.equal(S.compare('Het is half drie.', 'het is 3:30').exact, false);
  assert.equal(S.compare('Het is half drie.', 'het is 2:00').exact, false);
  // odd minutes are left as digits, not guessed
  assert.equal(S.timeToDutch(2, 31), null);
});

t('rescoring the real Pixel runs of 14 November', () => {
  const runs = JSON.parse(fs.readFileSync(new URL('./fixtures/spike_a_runs_2026-11-14.json', import.meta.url)));
  const [run1, run2] = runs.map(r => S.summarize(r.items));
  // before this change: 17/30 and 27/30; "half drie" heard as "2:30" now counts
  assert.equal(run1.firstExact, 18);
  assert.equal(run2.firstExact, 28);
  const wrong = runs[1].items.filter(it => !S.scoreAttempt(it.target, it.attempts[0].alternatives).exact).map(it => it.target);
  assert.deepEqual(wrong, ['Ik spreek een beetje Nederlands.', 'Wat kost dit brood?']);
});

console.log(`\n${n} tests passed`);
