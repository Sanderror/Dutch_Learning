// Invariants of the exercise generator, checked on the real course content
// for every lesson and several attempt numbers.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildCourse } from '../js/content.js';
import { buildLesson, buildDialogue, buildUnitTest, tileWords, isGraded, seedRandom, UNIT_TEST_SIZE } from '../js/exercises.js';
import { check, fold } from '../js/checker.js';

const root = new URL('../../content/', import.meta.url);
const read = (p) => JSON.parse(fs.readFileSync(new URL(p, root), 'utf8'));
const courseJson = read('course.json');
const course = buildCourse(courseJson, read('lexicon.json'), courseJson.units.map((u) => read(`units/${u}.json`)));
const ATTEMPTS = [0, 1, 2, 3, 7];

function eachLesson(fn) {
  for (const id of course.lessonOrder) for (const attempt of ATTEMPTS) for (const canListen of [true, false]) {
    fn(buildLesson(course, id, { attempt, canListen }), id, attempt, canListen);
  }
}

test('course loads: lessons in order, new words known per lesson', () => {
  assert.equal(course.lessonOrder.length, 12);
  assert.deepEqual(course.newEntries('u01l1').map((e) => e.id), ['hallo', 'ik', 'zijn', 'ja', 'nee', 'en']);
  assert.ok(course.formsUpTo('u01l1').has('ben'));
  assert.ok(!course.formsUpTo('u01l1').has('bent'), 'bent arrives in lesson 2');
  assert.ok(course.formsUpTo('u01l2').has('bent'));
  assert.equal(course.byId.get('naam').display, 'de naam');
  assert.deepEqual(course.entriesIn('Tot ziens, meneer Jansen.', 'u01l6').map((e) => e.id).sort(), ['meneer', 'tot-ziens']);
});

test('every lesson: each sentence exactly once, every new word gets a card before its first use', () => {
  eachLesson((built, id) => {
    const { lesson } = course.lessonInfo.get(id);
    const sids = built.steps.filter((s) => s.sid).map((s) => s.sid);
    assert.deepEqual([...sids].sort(), lesson.sentences.map((s) => s.id).sort(), id);
    const fresh = course.newEntries(id).map((e) => e.id);
    const cards = built.steps.filter((s) => s.type === 'card').map((s) => s.entryId);
    assert.deepEqual([...cards].sort(), [...fresh].sort(), id + ': one card per new word');
    const shown = new Set();
    for (const step of built.steps) {
      if (step.type === 'card') { shown.add(step.entryId); continue; }
      if (!step.sid) continue;
      const s = lesson.sentences.find((x) => x.id === step.sid);
      for (const e of course.entriesIn(s.nl, id)) {
        if (e.intro === id) assert.ok(shown.has(e.id), `${step.sid} uses ${e.id} before its card`);
      }
    }
  });
});

test('every lesson is the same for the same attempt, and differs between attempts', () => {
  for (const id of course.lessonOrder) {
    const a = JSON.stringify(buildLesson(course, id, { attempt: 1 }));
    assert.equal(a, JSON.stringify(buildLesson(course, id, { attempt: 1 })));
    assert.notEqual(a, JSON.stringify(buildLesson(course, id, { attempt: 2 })));
  }
});

test('tile exercises: solvable, with distractors that cannot also be right', () => {
  let count = 0;
  eachLesson((built, id) => {
    for (const step of built.steps.filter((s) => s.type === 'tiles')) {
      count++;
      const target = step.lang === 'es' ? step.reveal.es : step.reveal.nl;
      const words = tileWords(target, course.proper);
      assert.ok(words.length >= 2, `${step.sid}: a one-word sentence is not a tile exercise`);
      // the correct answer can be built from the tiles and is accepted
      const pool = step.tiles.map((t) => t.text);
      for (const w of words) {
        const i = pool.indexOf(w);
        assert.ok(i >= 0, `${step.sid}: tile "${w}" missing`);
        pool.splice(i, 1);
      }
      assert.ok(pool.length >= 2, `${step.sid}: needs at least 2 distractors`);
      const r = check(words.join(' '), step.accepted, { lang: step.lang, knownForms: course.allForms });
      assert.ok(r.ok, `${step.sid}: correct tiles rejected (${r.kind})`);
      // no distractor repeats a word of the answer
      const targetSet = new Set(words.map(fold));
      for (const d of pool) assert.ok(!targetSet.has(fold(d)), `${step.sid}: distractor "${d}" is in the answer`);
      // Dutch distractors are words she has been taught
      if (step.lang === 'nl') {
        const known = course.formsUpTo(id);
        for (const d of pool) assert.ok(known.has(d.toLowerCase()), `${step.sid}: distractor "${d}" not taught by ${id}`);
      }
      assert.equal(new Set(step.tiles.map((t) => t.id)).size, step.tiles.length);
      // listening: no text shown, audio given
      if (step.mode === 'listen') { assert.equal(step.prompt, null); assert.equal(step.audio, step.reveal.nl); }
    }
  });
  assert.ok(count > 100);
});

test('multiple choice: three different options, exactly one acceptable', () => {
  let count = 0;
  eachLesson((built) => {
    for (const step of built.steps.filter((s) => s.type === 'mc')) {
      count++;
      assert.equal(step.options.length, 3);
      assert.equal(new Set(step.options.map(fold)).size, 3, step.sid);
      const s = course.lessonInfo.get(step.sid.slice(0, 5)).lesson.sentences.find((x) => x.id === step.sid);
      const accepted = new Set([s.es, ...(s.alt_es || [])].map(fold));
      const right = step.options.filter((o) => accepted.has(fold(o)));
      assert.deepEqual(right, [s.es], `${step.sid}: options ${JSON.stringify(step.options)}`);
      assert.equal(step.options[step.answer], s.es);
    }
  });
  assert.ok(count > 50);
});

test('typing exercises: the main answer and the alternatives are accepted; long ones are not typed in section 1', () => {
  eachLesson((built) => {
    for (const step of built.steps.filter((s) => s.type === 'type')) {
      for (const a of step.accepted) assert.ok(check(a, step.accepted, { lang: 'nl', knownForms: course.allForms }).ok);
      assert.ok(tileWords(step.reveal.nl, course.proper).length <= 5, `${step.sid}: too long to type`);
      if (step.mode === 'listen') {
        assert.deepEqual(step.accepted, [step.reveal.nl], 'dictation accepts only what was said');
        assert.equal(step.prompt, null);
      }
    }
  });
});

test('matching game: 3 to 5 pairs, no ambiguous Spanish, comes after all word cards', () => {
  eachLesson((built, id) => {
    const i = built.steps.findIndex((s) => s.type === 'match');
    assert.ok(i >= 0, id + ': has a matching game');
    const m = built.steps[i];
    assert.ok(m.pairs.length >= 3 && m.pairs.length <= 5);
    assert.equal(new Set(m.pairs.map((p) => fold(p.es))).size, m.pairs.length, id + ': two pairs share a Spanish word');
    assert.equal(new Set(m.pairs.map((p) => fold(p.nl))).size, m.pairs.length);
    assert.deepEqual([...m.left].sort(), m.pairs.map((p) => p.id).sort());
    assert.deepEqual([...m.right].sort(), m.pairs.map((p) => p.id).sort());
    const lastCard = built.steps.map((s) => s.type).lastIndexOf('card');
    assert.ok(i > lastCard, id + ': matching before the last word card');
  });
  // nee, niet and geen all mean "no": never two of them in one game
  const m = buildLesson(course, 'u02l5').steps.find((s) => s.type === 'match');
  assert.ok(m.pairs.filter((p) => fold(p.es) === 'no').length <= 1);
});

test('without audio there are no listening exercises; with audio there are', () => {
  let withAudio = 0;
  eachLesson((built, id, attempt, canListen) => {
    const listening = built.steps.filter((s) => s.mode === 'listen').length;
    if (!canListen) assert.equal(listening, 0, id);
    else withAudio += listening;
  });
  assert.ok(withAudio > 50);
});

test('a first attempt mixes recognition and production', () => {
  for (const id of course.lessonOrder) {
    const types = new Set(buildLesson(course, id).steps.filter(isGraded).map((s) => s.type + ':' + (s.mode || '')));
    assert.ok(types.size >= 4, `${id}: only ${[...types].join(', ')}`);
  }
});

test('dialogue: lines with speaker audio keys, then the questions', () => {
  const d = buildDialogue(course, 'u02');
  assert.equal(d.steps[0].type, 'dialogue');
  assert.equal(d.steps[0].lines.length, 8);
  assert.equal(d.steps[0].lines[0].audio, '@Daan|Goedenavond! Ik ben Daan. Wie ben jij?');
  const qs = d.steps.slice(1);
  assert.equal(qs.length, 3);
  for (const q of qs) { assert.equal(q.type, 'mc'); assert.ok(q.promptEs); assert.ok(q.options[q.answer]); }
  assert.equal(qs[0].options[qs[0].answer], 'De Venezuela');
});

test('unit test-out: 12 production exercises from all lessons, no cards, no multiple choice', () => {
  for (const unit of course.units) for (const attempt of ATTEMPTS) {
    const t = buildUnitTest(course, unit.id, { attempt });
    assert.equal(t.steps.length, UNIT_TEST_SIZE);
    assert.equal(t.pass, 10);
    assert.ok(t.steps.every((s) => s.type === 'tiles' || s.type === 'type'));
    assert.ok(t.steps.every((s) => s.lang === 'nl'), 'she has to produce or recognise Dutch');
    const lessons = new Set(t.steps.map((s) => s.sid.slice(0, 5)));
    assert.equal(lessons.size, unit.lessons.length, 'every lesson is sampled');
    assert.equal(new Set(t.steps.map((s) => s.sid)).size, UNIT_TEST_SIZE, 'no sentence twice');
    for (const s of t.steps) {
      const words = tileWords(s.reveal.nl, course.proper);
      assert.ok(check(words.join(' '), s.accepted, { lang: 'nl', knownForms: course.allForms }).ok);
    }
  }
  const noAudio = buildUnitTest(course, 'u01', { canListen: false });
  assert.ok(noAudio.steps.every((s) => s.mode !== 'listen'));
});

test('tile words: punctuation stripped, capitals only on proper names', () => {
  assert.deepEqual(tileWords('Hallo, ik ben Tom.', course.proper), ['hallo', 'ik', 'ben', 'Tom']);
  assert.deepEqual(tileWords('¿Y tú?', course.proper), ['y', 'tú']);
  assert.deepEqual(tileWords('Nederland, Venezuela of Spanje?', course.proper), ['Nederland', 'Venezuela', 'of', 'Spanje']);
  assert.deepEqual(tileWords('María habla español.', course.proper), ['María', 'habla', 'español']);
  assert.deepEqual(tileWords('Soy de los Países Bajos.', course.proper), ['soy', 'de', 'los', 'Países', 'Bajos']);
  assert.deepEqual(tileWords('¿Vives en Ámsterdam?', course.proper), ['vives', 'en', 'Ámsterdam']);
});

test('seeded random is stable', () => {
  const a = seedRandom('u01l1:0'), b = seedRandom('u01l1:0'), c = seedRandom('u01l1:1');
  const xs = [a(), a(), a()], ys = [b(), b(), b()], zs = [c(), c(), c()];
  assert.deepEqual(xs, ys);
  assert.notDeepEqual(xs, zs);
  assert.ok(xs.every((x) => x >= 0 && x < 1));
});

test('every sound the app can ask for is one the audio build makes', () => {
  const repo = fileURLToPath(new URL('../../', import.meta.url));
  const out = spawnSync('python3', ['tools/build_audio.py', 'content', 'audio', '--keys'], { cwd: repo, encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  const built = new Set(JSON.parse(out.stdout));
  const asked = new Set();
  for (const id of course.lessonOrder) for (const attempt of ATTEMPTS) {
    for (const step of buildLesson(course, id, { attempt }).steps) {
      if (step.audio) asked.add(step.audio);
      if (step.reveal) asked.add(step.reveal.nl);            // played after a correct Dutch answer
      if (step.type === 'match') for (const p of step.pairs) asked.add(p.audio);
    }
  }
  for (const unit of course.units) {
    for (const line of buildDialogue(course, unit.id).steps[0].lines) asked.add(line.audio);
    for (const step of buildUnitTest(course, unit.id).steps) if (step.audio) asked.add(step.audio);
  }
  const missing = [...asked].filter((k) => !built.has(k));
  assert.deepEqual(missing, [], 'the app asks for audio the build does not make');
  assert.ok(asked.size > 200);
});
