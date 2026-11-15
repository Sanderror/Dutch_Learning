// End-to-end run in a real Chrome at phone size. Not part of `node --test`:
// it needs Chrome and puppeteer-core.
//
//   npm i puppeteer-core            (anywhere; set NODE_PATH or run from there)
//   python3 -m http.server 8765     (in the repository root)
//   node app/tests/e2e.browser.mjs [screenshot-dir]
//
// Plays a whole lesson (with deliberate mistakes), a dialogue and a unit
// test-out, checks progress survives a reload, and fails on any console error.
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const BASE = process.env.APP_URL || 'http://localhost:8765/app/';
const SHOTS = process.argv[2] || null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--lang=es'],
});
const page = await browser.newPage();
// count the tones the app makes, without listening to them
await page.evaluateOnNewDocument(() => {
  window.__tones = 0;
  const Ctx = window.AudioContext;
  if (Ctx) {
    const make = Ctx.prototype.createOscillator;
    Ctx.prototype.createOscillator = function () { window.__tones++; return make.call(this); };
  }
});
// a stand-in for Chrome's speech recogniser: it "hears" whatever the test sets in window.__say
// ({alternatives: [...]}, {error: 'not-allowed'}, or null for silence)
await page.evaluateOnNewDocument(() => {
  window.__say = null;
  window.__listens = 0;
  class FakeRecogniser {
    start() {
      window.__listens++;
      setTimeout(() => {
        if (this.onaudiostart) this.onaudiostart();
        setTimeout(() => {
          const say = window.__say;
          if (say && say.error) { if (this.onerror) this.onerror({ error: say.error }); }
          else if (say && say.alternatives && this.onresult) this.onresult({ results: [say.alternatives.map((t) => ({ transcript: t, confidence: 0.9 }))] });
          if (this.onend) this.onend();
        }, 60);
      }, 40);
    }
    stop() {}
    abort() {}
  }
  Object.defineProperty(window, 'webkitSpeechRecognition', { value: FakeRecogniser, configurable: true, writable: true });
  Object.defineProperty(window, 'SpeechRecognition', { value: FakeRecogniser, configurable: true, writable: true });
});
const tones = () => page.evaluate(() => window.__tones);
const feedback = () => page.waitForFunction(() => window.__tegel.ui.session && window.__tegel.ui.session.phase === 'feedback');
/** Say something into the stand-in recogniser and wait for the verdict. */
async function say(what) {
  await page.evaluate((w) => { window.__say = w; }, what);
  await tap('#speak-go');
  await feedback();
}
const todayKey = () => page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
await page.setViewport({ width: 412, height: 892, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const problems = [];
page.on('console', (m) => { if (m.type() === 'error' && !/audio\/index\.json|404/.test(m.text())) problems.push('console: ' + m.text()); });
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));

const shot = async (name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };
const tap = (sel) => page.$eval(sel, (el) => el.click());
const state = () => page.evaluate(() => {
  const s = window.__tegel.ui.session;
  return { screen: window.__tegel.ui.screen, type: s && s.step && s.step.type, mode: s && s.step && s.step.mode,
    phase: s && s.phase, done: s && s.done, total: s && s.total, queue: s && s.queue.length, retry: !!(s && s.step && s.step._retry) };
});
const text = () => page.evaluate(() => document.body.innerText);
let n = 0;
const ok = (msg) => { n++; console.log('ok  ' + msg); };

async function answer({ wrong = false } = {}) {
  const st = await state();
  const sol = await page.evaluate(() => window.__tegel.solve());
  if (st.type === 'card' || st.type === 'dialogue') { await tap('#continue'); return st; }
  if (st.type === 'speak') {
    await say({ alternatives: [wrong ? 'hello this is something else entirely' : sol.say] });
  } else if (st.type === 'mc' || st.type === 'gap') {
    await tap(`[data-option="${wrong ? (sol.option + 1) % 3 : sol.option}"]`);
    await tap('#check');
  } else if (st.type === 'tiles') {
    const ids = wrong ? sol.tiles.slice().reverse() : sol.tiles;
    for (const id of ids) await tap(`[data-tile-id="${id}"]`);
    await tap('#check');
  } else if (st.type === 'type') {
    await page.type('#answer', wrong ? 'zzz' : sol.text);
    await tap('#check');
  } else if (st.type === 'match') {
    if (wrong) { await tap(`[data-nl="${sol.pairs[0]}"]`); await tap(`[data-es="${sol.pairs[1]}"]`); }
    for (const id of sol.pairs) { await tap(`[data-nl="${id}"]`); await tap(`[data-es="${id}"]`); }
  }
  return st;
}

// ---- 0. her phone after the update: a save from version 0.2.0 ----
const SAVED_V1 = fs.readFileSync(new URL('./fixtures/progress_schema1.json', import.meta.url), 'utf8');
await page.goto(BASE, { waitUntil: 'networkidle0' });
await page.evaluate((v) => { localStorage.clear(); localStorage.setItem('tegeltjes.progress.v1', v); }, SAVED_V1);
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForSelector('.wall');
const upgraded = await page.evaluate(() => JSON.parse(localStorage.getItem('tegeltjes.progress.v1')));
assert.equal(upgraded.schema, 2);
assert.equal(upgraded.xp, JSON.parse(SAVED_V1).xp, 'points kept');
assert.equal(await page.$$eval('.tile.is-done', (t) => t.length), 15, 'unit 1: 6 lessons, dialogue, medal; unit 2: 6 lessons by test, medal');
assert.equal(await page.evaluate(() => localStorage.getItem('tegeltjes.progress.v1.unreadable')), null);
assert.match(await page.$eval('.review-card', (e) => e.textContent), /8 frases y palabras/);
await shot('00-upgraded-from-0.2.0');
ok('a save from 0.2.0 upgrades: every tile and point kept, reviews start with 8 items today');

// ---- 1. first start ----
await page.evaluate(() => { localStorage.clear(); });
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForSelector('.wall');
assert.match(await text(), /Hola, soy…/);
const UNITS = await page.evaluate(() => window.__tegel.course.units.length);
assert.ok(UNITS >= 6);
assert.equal(await page.$$eval('.tile', (t) => t.length), UNITS * 8);
assert.equal(await page.$$eval('.tile.is-next', (t) => t.length), 1);
assert.equal(await page.$$eval('.tile.is-done', (t) => t.length), 0);
await shot('01-home-first');
ok('home: eight tiles per unit, one marked as next');

// the install button appears when Chrome says the app can be installed, and goes away once used.
// Headless Chrome may fire the real event itself; the test replaces it with one it can observe.
const realEvent = !!(await page.$('#install'));
await page.evaluate(() => {
  const e = new Event('beforeinstallprompt', { cancelable: true });
  e.prompt = () => { window.__prompted = (window.__prompted || 0) + 1; return Promise.resolve(); };
  e.userChoice = Promise.resolve({ outcome: 'accepted' });
  window.dispatchEvent(e);
});
await page.waitForSelector('#install');
await shot('01b-home-install');
await tap('.icon-btn[aria-label="Ajustes"]');
assert.ok(await page.$('#install-settings'), 'settings offers the same button');
await shot('01c-settings-install');
await tap('#back');
await page.waitForSelector('#install');
await tap('#install');
await page.waitForFunction(() => !document.getElementById('install'));
assert.equal(await page.evaluate(() => window.__prompted), 1);
await tap('.icon-btn[aria-label="Ajustes"]');
assert.match(await text(), /Agregar a pantalla principal/, 'without the event, settings explains the Chrome menu');
await tap('#back');
await page.waitForSelector('.wall');
console.log(`    (Chrome fired its own install event: ${realEvent ? 'yes' : 'no'})`);
ok('install: button on home and in settings, opens the browser prompt once, then disappears');

// a locked lesson explains itself and cannot be started
await tap('[data-tile="u01l3"]');
assert.match(await text(), /Termina primero la lección anterior/);
assert.equal(await page.$('#sheet-go'), null);
await shot('02-sheet-locked');
await tap('.sheet .link');
await tap('[data-tile="u01l1"]');
assert.match(await text(), /Palabras nuevas: hallo, ik, zijn, ja, nee, en/);
await shot('03-sheet-lesson');
ok('tile sheets: locked lesson blocked, open lesson lists its new words');

// ---- 2. a whole lesson, with one mistake per exercise type ----
await tap('#sheet-go');
const seen = new Set(), failed = new Set();
let guard = 0, requeued = 0, spoken = 0;
while ((await state()).screen === 'session') {
  assert.ok(++guard < 80, 'lesson does not end');
  const st = await state();
  const key = st.type + (st.mode ? '-' + st.mode : '');
  if (!seen.has(key)) { seen.add(key); await shot(`10-step-${key}`); }
  if (st.type === 'card') { await answer(); continue; }
  if (st.type === 'speak') {
    spoken++;
    const before = await state();
    assert.match(await text(), /Dilo en voz alta/);
    if (spoken === 1) {
      await shot('13-speak-idle');
      // not understood: a gentle message, no wrong tone, try again or continue
      const tonesBefore = await tones();
      await page.evaluate(() => { window.__say = { alternatives: ['It Come Out Venezuela'] }; });
      await tap('#speak-go');
      await page.waitForFunction(() => document.getElementById('speak-state') && /Un momento|Habla ahora/.test(document.getElementById('speak-state').textContent));
      await feedback();
      assert.match(await text(), /No te entendí en neerlandés/);
      assert.match(await text(), /Se oyó: «It Come Out Venezuela»/);
      assert.equal(await tones(), tonesBefore, 'no buzzer for pronunciation');
      assert.ok(await page.$('#retry') && await page.$('#continue'));
      await shot('14-speak-unclear');
      await tap('#retry');
      assert.equal((await state()).phase, 'answer');
      await say(null);                                   // the recogniser returns nothing
      assert.match(await text(), /No se oyó nada/);
      await tap('#retry');
      await answer();                                    // said right
      assert.match(await text(), /¡Se entendió todo!/);
      assert.equal(await page.$$eval('.word.is-heard', (w) => w.length) > 0, true);
      await shot('15-speak-ok');
    } else {
      // half understood, and she moves on: it does not come back
      const target = await page.evaluate(() => window.__tegel.solve().say);
      await say({ alternatives: [target.split(' ').slice(0, -1).join(' ') + ' blabla'] });
      assert.match(await text(), /Se entendi(ó|eron) \d de \d palabras?/);
      assert.ok(await page.$$eval('.word.is-missed', (w) => w.length) >= 1);
      await shot('16-speak-partly');
    }
    await tap('#continue');
    const after = await state();
    assert.equal(after.done, before.done, 'speaking does not count for the score');
    assert.ok(after.queue <= before.queue, 'and is never queued again');
    continue;
  }
  const makeMistake = !failed.has(st.type) && !st.retry;
  if (makeMistake) failed.add(st.type);
  if (st.retry) requeued++;
  await answer({ wrong: makeMistake });
  const after = await state();
  assert.equal(after.phase, 'feedback', key);
  const body = await text();
  if (st.type === 'match') assert.match(body, /¡Hecho!/);
  else if (makeMistake) { assert.match(body, /Respuesta correcta/); await shot(`11-wrong-${key}`); }
  else { assert.match(body, /¡Correcto!|¡Casi perfecto!/); if (!seen.has('ok-' + st.type)) { seen.add('ok-' + st.type); await shot(`12-right-${key}`); } }
  if (makeMistake && st.type === 'type') {
    await tap('#report');
    assert.match(await text(), /Anotado para revisar/);
  }
  await tap('#continue');
}
assert.equal((await state()).screen, 'result');
assert.match(await text(), /Lección completa/);
assert.match(await text(), /Aciertos a la primera: 8 de 12/);
assert.ok(await tones() >= 20, 'a sound for every answer and for the finish: ' + await tones());
assert.ok(requeued >= 3, 'wrong answers came back: ' + requeued);
assert.equal(spoken, 2, 'two sentences said aloud');
for (const t of ['card', 'mc', 'tiles-nl2es', 'tiles-es2nl', 'tiles-listen', 'type-es2nl', 'type-listen', 'match']) assert.ok(seen.has(t), 'saw ' + t);
await new Promise((r) => setTimeout(r, 1500));     // let the tile finish being painted
await shot('20-result');
ok(`lesson 1 played to the end: all 8 step kinds and 2 speaking steps seen, ${requeued} wrong answers repeated, result shown, ${await tones()} tones played`);

await tap('#result-done');
await page.waitForSelector('.wall');
assert.equal(await page.$$eval('.tile.is-done', (t) => t.length), 1);
assert.equal(await page.$eval('.tile.is-next', (t) => t.dataset.tile), 'u01l2');
assert.match(await text(), /Hecho por hoy/);
assert.match(await text(), /1 día/);
await shot('21-home-after-one');
// the lesson put its review items on the schedule, none of them due today
const sched = await page.evaluate(() => window.__tegel.store.reviews.cards);
const keys = Object.keys(sched);
assert.equal(keys.filter((k) => k.startsWith('s:u01l1')).length, 4, 'four sentences of the lesson');
assert.ok(keys.some((k) => k.startsWith('w:')), 'and its new words');
const t0 = await todayKey();
assert.ok(Object.values(sched).every((c) => typeof c.s === 'number' && c.due > t0), 'rated, due later');
assert.equal(await page.$('#start-review'), null, 'nothing to review yet');
ok('home after the lesson: tile painted, next lesson highlighted, streak 1; its items scheduled for later');

// ---- 3. progress survives a reload ----
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForSelector('.wall');
assert.equal(await page.$$eval('.tile.is-done', (t) => t.length), 1);
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('tegeltjes.progress.v1')));
assert.equal(saved.lessons.u01l1.done, true);
assert.equal(saved.reports.length, 1);
assert.equal(saved.reports[0].given, 'zzz');
ok('reload: progress and the reported answer are stored');

// ---- 4. leaving a lesson half-way stores nothing but the attempt ----
await tap('#start-next');
await answer(); await answer();
await tap('#exit');
assert.match(await text(), /¿Salir de la lección\?/);
await shot('30-exit-ask');
await tap('#exit-yes');
await page.waitForSelector('.wall');
assert.equal(await page.$$eval('.tile.is-done', (t) => t.length), 1);
ok('leaving a lesson: asks first, then returns home without marking it done');

// the phone's back button does the same
await tap('#start-next');
await answer();
await page.goBack();
await page.waitForSelector('.wall');
assert.equal((await state()).screen, 'home');
ok('back button inside a lesson returns to the tiles');

// ---- 5. notes and settings ----
await tap('[data-notes="u01"]');
assert.match(await text(), /El pronombre no se puede omitir/);
assert.match(await text(), /Con una palabra interrogativa/);
await shot('40-notes');
await tap('#back');
await page.waitForSelector('.wall');
await tap('.icon-btn[aria-label="Ajustes"]');
assert.match(await text(), /Copia de seguridad/);
await tap('#slow');
assert.equal(await page.$eval('#slow', (b) => b.getAttribute('aria-pressed')), 'true');
await shot('41-settings');
await tap('#slow');
// sounds can be switched off, and then nothing plays
assert.equal(await page.$eval('#sounds', (b) => b.getAttribute('aria-pressed')), 'true');
await tap('#sounds');
assert.equal(await page.$eval('#sounds', (b) => b.getAttribute('aria-pressed')), 'false');
assert.equal(await page.evaluate(() => window.__tegel.store.sounds()), false);
// restore from a copy made by the app itself
const copy = await page.evaluate(() => window.__tegel.store.exportText());
await page.type('#import-text', 'esto no es una copia');
await tap('#import-go');
assert.match(await text(), /no es una copia válida/);
await page.$eval('#import-text', (el, v) => { el.value = v; }, copy);
await tap('#import-go');
assert.match(await text(), /Copia restaurada/);
await tap('#back');
await page.waitForSelector('.wall');
ok('notes render; settings: slow audio and sound toggles, import rejects junk and accepts a real copy');

// with sounds off, answering makes no tone
await tap('#start-next');
while ((await state()).type === 'card') await answer();
const silentBefore = await tones();
await answer({ wrong: true });
assert.equal(await tones(), silentBefore, 'sounds off: no tone');
await tap('#exit'); await tap('#exit-yes');
await page.waitForSelector('.wall');
await tap('.icon-btn[aria-label="Ajustes"]');
await tap('#sounds');
assert.equal(await page.evaluate(() => window.__tegel.store.sounds()), true);
await tap('#back');
await page.waitForSelector('.wall');
ok('sounds off: answering is silent; switched back on');

// ---- 5b. a practice ("soft") step: try again or continue, never repeated ----
await tap('#start-next');
while ((await state()).type === 'card') await answer();
await page.evaluate(() => { window.__tegel.ui.session.step.soft = true; });
const before = await state();
await answer({ wrong: true });
assert.ok(await page.$('#retry'), 'Intentar otra vez is offered');
assert.ok(await page.$('#continue'), 'Continuar is offered');
assert.equal((await state()).queue, before.queue, 'a wrong practice step is not queued again');
await shot('45-soft-wrong');
await tap('#retry');
assert.equal((await state()).phase, 'answer', 'trying again opens the same step');
assert.equal((await state()).type, before.type);
await answer({ wrong: true });
await tap('#continue');
const afterSoft = await state();
assert.equal(afterSoft.done, before.done + 1, 'continuing counts the step as done');
assert.equal(afterSoft.queue, before.queue - 1, 'the next step comes up; the practice step is gone');
await tap('#exit'); await tap('#exit-yes');
await page.waitForSelector('.wall');
ok('practice step: wrong answer offers try again and continue; continue moves on without repeating it');

// ---- 5c. speaking: "No puedo hablar ahora", a blocked microphone, and the switch in Ajustes ----
const speakCount = () => page.evaluate(() => { const q = window.__tegel.ui.session; return [q.step, ...q.queue].filter((x) => x && x.type === 'speak').length; });
await tap('#start-next');
assert.equal(await speakCount(), 2);
while ((await state()).type !== 'speak') { await answer(); if (!['card'].includes((await state()).type) && (await state()).phase === 'feedback') await tap('#continue'); }
const listensBefore = await page.evaluate(() => window.__listens);
await tap('#speak-skip');
assert.notEqual((await state()).type, 'speak');
let sawSpeak = false, g5 = 0;
while ((await state()).screen === 'session') {
  assert.ok(++g5 < 60);
  const st = await answer();
  if (st.type === 'speak') sawSpeak = true;
  if (st.type !== 'card') await tap('#continue');
}
assert.equal(sawSpeak, false, 'no more speaking in that session');
assert.equal(await page.evaluate(() => window.__listens), listensBefore, 'the microphone was not used');
assert.match(await text(), /Lección completa/);
await tap('#result-done');
await page.waitForSelector('.wall');
// a blocked microphone: explained once, then the session goes on without speaking
await tap('#start-next');
while ((await state()).type !== 'speak') { await answer(); if ((await state()).phase === 'feedback') await tap('#continue'); }
await say({ error: 'not-allowed' });
assert.match(await text(), /El micrófono está bloqueado/);
assert.equal(await page.$('#retry'), null);
await shot('46-speak-blocked');
await tap('#continue');
assert.equal(await speakCount(), 1, 'the other speaking step is still queued…');
let g6 = 0;
while ((await state()).screen === 'session' && (await state()).type !== 'speak') { assert.ok(++g6 < 60); const st = await answer(); if (st.type !== 'card') await tap('#continue'); }
assert.equal((await state()).screen, 'result', '…but it is skipped');
await tap('#result-done');
await page.waitForSelector('.wall');
// switched off in Ajustes: lessons have no speaking steps
await tap('.icon-btn[aria-label="Ajustes"]');
await tap('#speaking');
assert.equal(await page.$eval('#speaking', (b) => b.getAttribute('aria-pressed')), 'false');
await tap('#back');
await page.waitForSelector('.wall');
await tap('#start-next');
assert.equal(await speakCount(), 0);
await tap('#exit'); await tap('#exit-yes');
await page.waitForSelector('.wall');
await tap('.icon-btn[aria-label="Ajustes"]');
await tap('#speaking');
await tap('#back');
await page.waitForSelector('.wall');
ok('speaking: "No puedo hablar ahora" and a blocked microphone end speaking for the session; the switch in Ajustes removes it');

// ---- 6. unit test-out ----
await tap('[data-tile="u01t"]');
assert.match(await text(), /12 preguntas sin segundas oportunidades/);
await shot('50-sheet-test');
await tap('#sheet-go');
// fail it first: 3 wrong answers leave 9, one short of the pass mark
for (let i = 0; i < 12; i++) { await answer({ wrong: i < 3 }); await tap('#continue'); }
assert.match(await text(), /Todavía no/);
assert.match(await text(), /Acertaste 9 de 12; hacen falta 10/);
await shot('51-test-failed');
await tap('#result-done');
await page.waitForSelector('.wall');
assert.equal(await page.$$eval('.tile.is-done', (t) => t.length), 3, 'a failed test changes nothing (lessons 1 to 3 were done above)');
await tap('[data-tile="u01t"]'); await tap('#sheet-go');
for (let i = 0; i < 12; i++) { const st = await answer({ wrong: i < 2 }); if (i === 5) await shot(`52-test-step-${st.type}`); await tap('#continue'); }
assert.match(await text(), /Unidad superada/);
assert.match(await text(), /3 azulejos puestos de una vez/);
await shot('53-test-passed');
await tap('#result-done');
await page.waitForSelector('.wall');
assert.equal(await page.$eval('.tile.is-next', (t) => t.dataset.tile), 'u02l1');
// the lessons passed by the test join the review schedule as a backlog: some are due today,
// and then reviewing comes first on the home screen
const backlog = await page.evaluate(() => Object.values(window.__tegel.store.reviews.cards).filter((c) => typeof c.s !== 'number').length);
assert.ok(backlog > 0, 'backlog from the passed unit');
assert.ok(await page.$('#start-review'), 'review card shown');
assert.match(await page.$eval('#start-review', (b) => b.className), /btn-primary/);
assert.match(await page.$eval('#start-next', (b) => b.className), /btn-quiet/, 'the new lesson is the second choice');
await shot('62-home-review-and-lesson');
ok(`test-out: 9 of 12 fails and changes nothing; 10 of 12 passes and completes the unit; ${backlog} items join the reviews`);

// ---- 7. dialogue ----
await tap('[data-tile="u01d"]');
await tap('#sheet-go');
assert.equal((await state()).type, 'dialogue');
await tap('#toggle-es');
assert.match(await text(), /Me llamo Luis/);
await shot('60-dialogue');
await tap('#continue');
await shot('61-dialogue-question');
for (let i = 0; i < 3; i++) { await answer(); await tap('#continue'); }
assert.match(await text(), /Diálogo completo/);
await tap('#result-done');
await page.waitForSelector('.wall');
assert.match(await page.$eval('[data-tile="u01d"]', (t) => t.className), /is-done/, 'the dialogue tile is painted');
assert.equal(await page.$$eval('.tile.is-done', (t) => t.length), 8, 'unit 1: six lessons, dialogue, medal');
await shot('70-home-unit-done');
ok('dialogue: translation toggle, three questions, completion');

// ---- 8. every remaining lesson can be played to the end ----
let lessons = 0;
const newKinds = new Set();
while (await page.$('#start-next')) {
  await tap('#start-next');
  let g = 0;
  while ((await state()).screen === 'session') {
    assert.ok(++g < 60);
    const now = await state();
    const kind = now.type + (now.mode ? '-' + now.mode : '');
    if (['gap', 'tiles-order'].includes(kind) && !newKinds.has(kind)) {
      newKinds.add(kind);
      await shot(`70-step-${kind}`);
      if (kind === 'gap') {
        // a wrong choice shows the whole sentence and comes back; the right one fills the blank
        await answer({ wrong: true });
        assert.match(await text(), /Respuesta correcta/);
        await shot('71-gap-wrong');
        await tap('#continue');
        continue;
      }
    }
    const st = await answer();
    if (kind === 'gap' && !newKinds.has('gap-right')) {
      newKinds.add('gap-right');
      assert.equal(await page.$eval('#gap-blank', (b) => b.className.includes('is-filled')), true);
      await shot('72-gap-right');
    }
    if (st.type !== 'card' && st.type !== 'dialogue') await tap('#continue');
  }
  assert.match(await text(), /Lección completa/);
  await tap('#result-done');
  await page.waitForSelector('.wall');
  lessons++;
}
assert.equal(lessons, (UNITS - 1) * 6);
for (const k of ['gap', 'tiles-order', 'gap-right']) assert.ok(newKinds.has(k), 'saw ' + k);
assert.match(await text(), /Todo al día/);
await shot('80-home-all-done');
ok(`units 2 to ${UNITS}: every lesson plays through, with gap, word-order and speaking steps; home says there is nothing new`);

// ---- 8b. backup reminder once there is something to lose ----
assert.ok(await page.$('#backup-reminder'), 'reminder shows: many lessons, no copy yet');
assert.equal(await page.evaluate(() => {
  const card = document.getElementById('backup-reminder');
  const walls = [...document.querySelectorAll('.wall')];
  return walls.every((w) => w.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING) && !card.nextElementSibling;
}), true, 'the reminder is the last thing on the home screen');
await shot('81-backup-reminder');
await tap('#backup-later');
assert.equal(await page.$('#backup-reminder'), null);
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForSelector('.wall');
assert.equal(await page.$('#backup-reminder'), null, 'the snooze is stored');
await tap('.icon-btn[aria-label="Ajustes"]');
assert.match(await page.$eval('#backup-age', (e) => e.textContent), /Todavía no/);
await tap('#export-file');
assert.match(await page.$eval('#backup-age', (e) => e.textContent), /hoy/);
await tap('#back');
await page.waitForSelector('.wall');
ok('backup reminder: shown with progress and no copy, snooze survives a reload, a download counts as a copy');

// ---- 8b2. a review session ----
const t = await todayKey();
const forced = await page.evaluate((day) => {
  const cards = window.__tegel.store.reviews.cards;
  const rated = Object.keys(cards).filter((k) => typeof cards[k].s === 'number').slice(0, 20);
  for (const k of rated) cards[k].due = day;
  window.__tegel.store.commit();
  return rated.length;
}, t);
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForSelector('#start-review');
assert.match(await text(), /para repasar hoy/);
await shot('84-home-review');
const xpBefore = await page.evaluate(() => window.__tegel.store.data.xp);
await tap('#start-review');
let firstKey = null, rounds = 0, reviewSteps = 0;
for (;;) {
  let g = 0;
  while ((await state()).screen === 'session') {
    assert.ok(++g < 60, 'review ends');
    const st = await state();
    const key = await page.evaluate(() => window.__tegel.ui.session.step.key || null);
    const wrong = firstKey === null && key && st.type !== 'match';
    if (wrong) firstKey = key;
    if (reviewSteps === 0) await shot('85-review-step');
    await answer({ wrong });
    reviewSteps++;
    await tap('#continue');
  }
  rounds++;
  assert.match(await text(), /Repaso hecho/);
  if (rounds === 1) await shot('86-review-result');
  if (!(await page.$('#review-again'))) break;
  assert.ok(rounds < 6, 'rounds end');
  await tap('#review-again');
}
await tap('#result-done');
await page.waitForSelector('.wall');
assert.equal(await page.$('#start-review'), null, 'nothing left to review today');
const after = await page.evaluate(() => window.__tegel.store.reviews.cards);
const tomorrow = await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
assert.ok(firstKey, 'a sentence was answered wrong on purpose');
assert.equal(after[firstKey].due, tomorrow, 'the wrong one comes back tomorrow');
assert.ok(Object.values(after).every((c) => c.due > t), 'everything reviewed is due later');
assert.ok(await page.evaluate(() => window.__tegel.store.data.xp) > xpBefore, 'points for the review');
ok(`review: ${forced} items due, ${rounds} round(s), ${reviewSteps} steps; a wrong answer comes back tomorrow, the rest later`);

// ---- 8c. an update keeps her progress: same storage, new service worker ----
const progressBefore = await page.evaluate(() => localStorage.getItem('tegeltjes.progress.v1'));
await page.evaluate(async () => { for (const k of await caches.keys()) await caches.delete(k); });
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForSelector('.wall');
assert.equal(await page.evaluate(() => localStorage.getItem('tegeltjes.progress.v1')), progressBefore, 'progress untouched by a cache wipe');
assert.equal(await page.$$eval('.tile.is-done', (t) => t.length), 8 + (UNITS - 1) * 7);
ok('update: wiping every cached app file leaves progress as it was');

// ---- 9. offline: the installed app opens without a connection ----
await page.evaluate(() => navigator.serviceWorker.ready);
await page.reload({ waitUntil: 'networkidle0' });           // one online load under the service worker fills the cache
await page.setOfflineMode(true);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('.wall', { timeout: 10000 });
assert.equal(await page.$$eval('.tile.is-done', (t) => t.length), 8 + (UNITS - 1) * 7, 'everything but the later dialogues');
await tap('[data-tile="u02l3"]'); await tap('#sheet-go');
assert.equal((await state()).screen, 'session');
await page.goBack();
await page.setOfflineMode(false);
problems.splice(0, problems.length, ...problems.filter((p) => !/ERR_INTERNET_DISCONNECTED|Failed to fetch|net::/.test(p)));
ok('offline: the app, the course and progress load from the cache, and a lesson starts');

assert.deepEqual(problems, [], 'console problems');
ok('no console errors or page errors during the whole run');
console.log(`\n${n} browser checks passed`);
await browser.close();
