// Scoring of speaking practice, checked on what the recogniser really
// returned for her and for Sander in the speech test (14 November 2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import { words, matchWords, judge, displayWords, numberToDutch, timeToDutch } from '../js/speech.js';

test('numbers and times are written out the way they are said', () => {
  assert.equal(numberToDutch(25), 'vijfentwintig');
  assert.equal(numberToDutch(18), 'achttien');
  assert.equal(timeToDutch(2, 30), 'half drie');
  assert.equal(timeToDutch(14, 30), 'half drie');
  assert.equal(timeToDutch(4, 45), 'kwart voor vijf');
  assert.equal(timeToDutch(4, 20), 'tien voor half vijf');
  assert.deepEqual(words('Het is 2:30.'), ['het', 'is', 'half', 'drie']);
  assert.deepEqual(words('Ik ben 19 jaar'), ['ik', 'ben', 'negentien', 'jaar']);
  assert.deepEqual(words('Één, twee!'), ['een', 'twee']);
});

test('spaces in other places still match', () => {
  assert.equal(matchWords('Dank je wel.', 'dankjewel').matched, 3);
  assert.equal(matchWords('Wat is je telefoonnummer?', 'wat is je telefoon nummer').matched, 4);
  assert.equal(matchWords('Fijn weekend!', 'fijn week end').matched, 2);
});

test('a word one letter off is a different word', () => {
  const m = matchWords('Waar kom je vandaan?', 'waar kom je vandaag');
  assert.deepEqual(m.flags, [true, true, true, false]);
});

// [sentence, what the recogniser wrote for her, expected verdict, words heard]
const HER_RUN = [
  ['Hallo, hoe gaat het?', '', 'silence', 0],
  ['Ik heet Tom.', 'Ik heb dan', 'partly', 1],
  ['Goedemorgen, mevrouw.', 'Goedemorgen mevrouw', 'ok', 2],
  ['Waar kom je vandaan?', 'Workum jij vandaag', 'unclear', 0],
  ['Ik kom uit Venezuela.', 'It Come Out Venezuela', 'unclear', 1],
  ['Ik woon in Amsterdam.', 'ik Barn in Amsterdam', 'partly', 3],
  ['Dank je wel.', 'dankjewel', 'ok', 3],
  ['Tot morgen!', 'tot morgen', 'ok', 2],
  ['Dit is mijn vriendin.', 'Dit is mijn vriendin', 'ok', 4],
  ['Hoe laat is het?', 'Hoe laat is het', 'ok', 4],
  ['Het is half drie.', 'het is 1:30', 'partly', 3],
  ['Ik drink graag koffie.', 'ik drinken graag coffees', 'partly', 2],
  ['Wij eten vanavond thuis.', 'weer eten vanavond thuis', 'partly', 3],
  ['De trein is te laat.', 'The Train Is te laat', 'partly', 3],
  ['Mag ik een kopje thee?', 'maak ik een grapje', 'partly', 2],
  ['Ik ga morgen naar school.', 'Ik ga het morgen naar school', 'ok', 5],
  ['Het huis is groot.', 'geit House is groot', 'partly', 2],
  ['Ik ben vijfentwintig jaar.', 'ik ben 520 car', 'partly', 2],
  ['Kun je dat herhalen?', 'kun je dat', 'partly', 3],
  ['Ik begrijp het niet.', 'Ik begrijp het niet', 'ok', 4],
  ['Zij werkt in een ziekenhuis.', 'saiguard in and', 'unclear', 1],
  ['Waar is het station?', 'Waar is het tijd station', 'ok', 4],
  ['Fijn weekend!', 'Fine weekend', 'partly', 1],
];

test('her own speech test: the verdicts are fair', () => {
  const count = { ok: 0, partly: 0, unclear: 0, silence: 0 };
  for (const [target, heard, verdict, matched] of HER_RUN) {
    const j = judge(target, heard ? [heard] : []);
    assert.equal(j.verdict, verdict, `${target} / ${heard}`);
    assert.equal(j.matched, matched, `${target} / ${heard}`);
    count[j.verdict]++;
  }
  console.log(`    her run (${HER_RUN.length} sentences): ${JSON.stringify(count)}`);
  assert.ok(count.ok + count.partly > count.unclear + count.silence, 'mostly she gets words back');
});

test('the best alternative counts; one miss is allowed in a long sentence', () => {
  assert.equal(judge('Het is half drie.', ['het is 3:30', 'het is 2:30']).verdict, 'ok');
  assert.equal(judge('Ik ga met de fiets naar het werk.', ['ik ga met de fiets naar werk']).verdict, 'ok');
  assert.equal(judge('Ik woon hier.', ['ik hier']).verdict, 'partly', 'not in a short one');
  assert.equal(judge('Ik woon hier.', ['', '  ']).verdict, 'silence');
});

test('the sentence is shown word by word with the same count as the flags', () => {
  const target = 'Nee, dank je. Ik wil water.';
  const pieces = displayWords(target);
  assert.deepEqual(pieces.map((p) => p.text), ['Nee,', 'dank', 'je.', 'Ik', 'wil', 'water.']);
  assert.equal(pieces.reduce((n, p) => n + p.count, 0), judge(target, ['x']).flags.length);
});
