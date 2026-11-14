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
  if (st.type === 'mc') {
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

// ---- 1. first start ----
await page.goto(BASE, { waitUntil: 'networkidle0' });
await page.evaluate(() => { localStorage.clear(); });
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForSelector('.wall');
assert.match(await text(), /Hola, soy…/);
assert.equal(await page.$$eval('.tile', (t) => t.length), 16);
assert.equal(await page.$$eval('.tile.is-next', (t) => t.length), 1);
assert.equal(await page.$$eval('.tile.is-done', (t) => t.length), 0);
await shot('01-home-first');
ok('home: two units of eight tiles, one marked as next');

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
let guard = 0, requeued = 0;
while ((await state()).screen === 'session') {
  assert.ok(++guard < 80, 'lesson does not end');
  const st = await state();
  const key = st.type + (st.mode ? '-' + st.mode : '');
  if (!seen.has(key)) { seen.add(key); await shot(`10-step-${key}`); }
  if (st.type === 'card') { await answer(); continue; }
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
assert.ok(requeued >= 3, 'wrong answers came back: ' + requeued);
for (const t of ['card', 'mc', 'tiles-nl2es', 'tiles-es2nl', 'tiles-listen', 'type-es2nl', 'type-listen', 'match']) assert.ok(seen.has(t), 'saw ' + t);
await new Promise((r) => setTimeout(r, 1500));     // let the tile finish being painted
await shot('20-result');
ok(`lesson 1 played to the end: all 8 step kinds seen, ${requeued} wrong answers repeated, result shown`);

await tap('#result-done');
await page.waitForSelector('.wall');
assert.equal(await page.$$eval('.tile.is-done', (t) => t.length), 1);
assert.equal(await page.$eval('.tile.is-next', (t) => t.dataset.tile), 'u01l2');
assert.match(await text(), /Hecho por hoy/);
assert.match(await text(), /1 día/);
await shot('21-home-after-one');
ok('home after the lesson: tile painted, next lesson highlighted, streak 1');

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
ok('notes render; settings: slow audio toggle, import rejects junk and accepts a real copy');

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
assert.equal(await page.$$eval('.tile.is-done', (t) => t.length), 1, 'a failed test changes nothing');
await tap('[data-tile="u01t"]'); await tap('#sheet-go');
for (let i = 0; i < 12; i++) { const st = await answer({ wrong: i < 2 }); if (i === 5) await shot(`52-test-step-${st.type}`); await tap('#continue'); }
assert.match(await text(), /Unidad superada/);
assert.match(await text(), /5 azulejos puestos de una vez/);
await shot('53-test-passed');
await tap('#result-done');
await page.waitForSelector('.wall');
assert.equal(await page.$eval('.tile.is-next', (t) => t.dataset.tile), 'u02l1');
ok('test-out: 9 of 12 fails and changes nothing; 10 of 12 passes and completes the unit');

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
while (await page.$('#start-next')) {
  await tap('#start-next');
  let g = 0;
  while ((await state()).screen === 'session') {
    assert.ok(++g < 60);
    const st = await answer();
    if (st.type !== 'card' && st.type !== 'dialogue') await tap('#continue');
  }
  assert.match(await text(), /Lección completa/);
  await tap('#result-done');
  await page.waitForSelector('.wall');
  lessons++;
}
assert.equal(lessons, 6);
assert.match(await text(), /Todo al día/);
await shot('80-home-all-done');
ok('unit 2: all six lessons play through; home says there is nothing new');

// ---- 9. offline: the installed app opens without a connection ----
await page.evaluate(() => navigator.serviceWorker.ready);
await page.reload({ waitUntil: 'networkidle0' });           // one online load under the service worker fills the cache
await page.setOfflineMode(true);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('.wall', { timeout: 10000 });
assert.equal(await page.$$eval('.tile.is-done', (t) => t.length), 15, 'everything but the unit 2 dialogue');
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
