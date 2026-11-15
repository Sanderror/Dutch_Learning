// Tegeltjes: the interface. State lives in `ui`; every tap changes it and
// calls render(), which rebuilds the screen. The logic it leans on is in
// content.js, exercises.js, checker.js and store.js, all tested without a
// browser.

import { loadContent } from './content.js';
import { buildLesson, buildDialogue, buildUnitTest, isGraded, tileWords, UNIT_TEST_SIZE, UNIT_TEST_PASS } from './exercises.js';
import { check } from './checker.js';
import { createStore } from './store.js';
import { createAudio, loadAudioIndex } from './audio.js';
import { renderNotes } from './md.js';
import { motif, ICON } from './glyphs.js';

const VERSION = '0.2.0';
const CONTENT = '../content/';
const AUDIO = '../audio/';
const root = document.getElementById('app');

let course = null;
let store = null;
let audio = null;
const ui = { screen: 'loading', sheet: null, session: null, notes: null, result: null, error: null, notice: '', pushed: false, ignorePop: false };

// ---------- small helpers ----------
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;            // only our own SVG strings and escaped notes
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat(3)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
const icon = (name, cls) => h('span', { class: cls || null, html: ICON[name] });
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// ---------- installing on the phone ----------
// Chrome fires `beforeinstallprompt` when the app can be installed and is not
// yet. We keep the event and show our own button; Chrome's own menu entry
// («Agregar a pantalla principal») keeps working either way.
let installEvent = null;
function isInstalled() {
  try { return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } catch (e) { return false; }
}
function canInstall() { return !!installEvent && !isInstalled(); }
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvent = e;
  if (course && (ui.screen === 'home' || ui.screen === 'settings')) render();
});
window.addEventListener('appinstalled', () => {
  installEvent = null;
  if (course && (ui.screen === 'home' || ui.screen === 'settings')) render();
});
async function install() {
  const e = installEvent;
  if (!e) return;
  installEvent = null;                                  // the event can be used once
  try { e.prompt(); await e.userChoice; } catch (err) { /* she closed it: Chrome's menu still works */ }
  if (ui.screen === 'home' || ui.screen === 'settings') render();
}

// ---------- where she is in the course ----------
function nextLessonId() { return course.lessonOrder.find((id) => !store.isDone(id)) || null; }
function unitOf(lessonId) { return course.lessonInfo.get(lessonId).unit; }
function unitLessonIds(unit) { return unit.lessons.map((l) => l.id); }
function unitComplete(unit) { return unitLessonIds(unit).every((id) => store.isDone(id)); }
function lessonNumber(lessonId) { return unitOf(lessonId).lessons.findIndex((l) => l.id === lessonId) + 1; }
function unitNumber(unit) { return course.units.indexOf(unit) + 1; }

// ---------- navigation ----------
function show(screen) {
  if (screen !== 'home' && !ui.pushed) { history.pushState({ tegel: screen }, ''); ui.pushed = true; }
  ui.screen = screen;
  render();
  window.scrollTo(0, 0);
}
function goHome() {
  if (audio) audio.stop();
  ui.session = null; ui.sheet = null; ui.notes = null; ui.result = null; ui.notice = '';
  ui.screen = 'home';
  render();
  window.scrollTo(0, 0);
  if (ui.pushed) { ui.pushed = false; ui.ignorePop = true; history.back(); }
}
window.addEventListener('popstate', () => {
  if (ui.ignorePop) { ui.ignorePop = false; return; }
  // the phone's back button: leave whatever is open
  ui.pushed = false;
  if (ui.session && ui.session.kind === 'lesson') store.noteAttempt(ui.session.id);
  goHome();
});

// ---------- sessions (lesson, dialogue, unit test) ----------
function startSession(kind, id) {
  const canListen = audio.can();
  let built;
  if (kind === 'lesson') built = buildLesson(course, id, { attempt: store.attempts(id), canListen });
  else if (kind === 'dialogue') built = buildDialogue(course, id);
  else built = buildUnitTest(course, id, { attempt: store.attempts(id + 't'), canListen });
  ui.session = {
    kind, id, built, queue: built.steps.slice(), total: built.steps.filter(isGraded).length,
    done: 0, firstTry: 0, step: null, phase: 'answer', answer: null, result: null, askExit: false, reported: false,
  };
  ui.sheet = null;
  if (kind === 'test') store.noteAttempt(id + 't');
  show('session');
  advance();
}

function initAnswer(step) {
  switch (step.type) {
    case 'mc': return { picked: null };
    case 'tiles': return { chosen: [] };
    case 'type': return { text: '' };
    case 'match': return { nl: null, matched: [], misses: 0, miss: null };
    default: return { showEs: false };
  }
}

function advance() {
  const s = ui.session;
  s.step = s.queue.shift() || null;
  if (!s.step) return finish();
  s.phase = 'answer'; s.result = null; s.reported = false; s.askExit = false;
  s.answer = initAnswer(s.step);
  render();
  window.scrollTo(0, 0);
  const st = s.step;
  if (st.type === 'card' || (st.audio && (st.type === 'mc' || st.mode === 'nl2es' || st.mode === 'listen'))) audio.play(st.audio);
}

function hasAnswer(s) {
  const a = s.answer, st = s.step;
  if (st.type === 'mc') return a.picked !== null;
  if (st.type === 'tiles') return a.chosen.length > 0;
  if (st.type === 'type') return a.text.trim().length > 0;
  return true;
}

function record(ok, result) {
  const s = ui.session, st = s.step;
  if (!st._retry && ok) s.firstTry++;
  if (ok || s.kind === 'test') s.done++;
  else s.queue.push({ ...st, _retry: true });           // wrong: it comes back at the end
  s.result = result; s.phase = 'feedback';
  render();
  if (ok && st.lang === 'nl' && st.reveal) audio.play(st.reveal.nl);   // hear the Dutch she just produced
}

function checkAnswer() {
  const s = ui.session, st = s.step, a = s.answer;
  if (s.phase !== 'answer' || !hasAnswer(s)) return;
  if (st.type === 'mc') {
    const ok = a.picked === st.answer;
    return record(ok, { ok, kind: ok ? 'exact' : 'wrong', best: st.options[st.answer] });
  }
  const given = st.type === 'tiles'
    ? a.chosen.map((id) => st.tiles.find((t) => t.id === id).text).join(' ')
    : a.text;
  const r = check(given, st.accepted, { lang: st.lang, knownForms: course.allForms });
  record(r.ok, { ...r, given });
}

function finish() {
  const s = ui.session;
  if (s.kind === 'test') {
    const pass = s.firstTry >= s.built.pass;
    const unit = course.unitById(s.id);
    const gained = pass ? store.passUnitTest(unitLessonIds(unit)) : { xp: 0, added: 0 };
    ui.result = { kind: 'test', pass, correct: s.firstTry, total: s.total, need: s.built.pass, ...gained, streak: store.streak() };
  } else {
    // built.id is the lesson id, or unit id + "d" for a dialogue: the id its tile looks up
    const r = store.completeLesson(s.built.id, { correct: s.firstTry, total: s.total, via: s.kind });
    ui.result = { kind: s.kind, id: s.built.id, correct: s.firstTry, total: s.total, ...r };
  }
  ui.session = null;
  ui.screen = 'result';
  render();
  window.scrollTo(0, 0);
}

function leaveSession() {
  const s = ui.session;
  if (s && s.kind === 'lesson') store.noteAttempt(s.id);
  goHome();
}

// ---------- views: home ----------
function viewHome() {
  const next = nextLessonId();
  const streak = store.streak();
  const today = store.doneToday();

  const top = h('header', { class: 'topbar' },
    h('span', { class: 'brand' }, 'Tegeltjes'),
    h('div', { class: 'topbar-right' },
      h('span', { class: 'streak' + (streak ? '' : ' is-cold'), title: 'Racha' },
        icon('sun'), plural(streak, 'día', 'días')),
      h('button', { class: 'icon-btn', 'aria-label': 'Ajustes', onclick: () => show('settings') }, icon('settings'))));

  let todayCard;
  if (!next) {
    todayCard = h('section', { class: 'today is-done' },
      h('h1', {}, 'Todo al día'),
      h('p', {}, 'No hay lecciones nuevas todavía. Puedes repetir cualquier azulejo.'));
  } else {
    const title = course.lessonInfo.get(next).lesson.title_es;
    todayCard = today === 0
      ? h('section', { class: 'today' },
        h('h1', {}, title),
        h('p', { class: 'muted' }, `Tu lección de hoy: unidad ${unitNumber(unitOf(next))}, lección ${lessonNumber(next)}.`),
        h('button', { class: 'btn btn-primary', id: 'start-next', onclick: () => startSession('lesson', next) }, 'Empezar'))
      : h('section', { class: 'today is-done' },
        h('h1', {}, 'Hecho por hoy'),
        h('p', { class: 'muted' }, `Si quieres más, la siguiente es «${title}».`),
        h('button', { class: 'btn btn-quiet', id: 'start-next', onclick: () => startSession('lesson', next) }, 'Seguir'));
  }

  const walls = [];
  let lastSection = null;
  course.units.forEach((unit, ui_) => {
    if (unit.section !== lastSection) {
      lastSection = unit.section;
      const sec = course.course.sections.find((x) => x.id === unit.section);
      if (sec) walls.push(h('p', { class: 'section-title' }, `${sec.title_es} (${sec.level})`));
    }
    walls.push(viewUnit(unit, ui_, next));
  });

  return [top, !store.persisted && h('p', { class: 'notice' }, 'Este navegador no deja guardar tu progreso. Abre la app instalada o revisa los ajustes de Chrome.'),
    canInstall() && h('section', { class: 'install' },
      h('p', {}, 'Pon Tegeltjes en tu pantalla de inicio para abrirla como cualquier otra app.'),
      h('button', { class: 'btn btn-quiet', id: 'install', onclick: install }, 'Instalar la app')),
    todayCard, walls, h('p', { class: 'soon' }, 'Hay más unidades en camino.')];
}

function viewUnit(unit, index, next) {
  const ids = unitLessonIds(unit);
  const complete = unitComplete(unit);
  const isCurrent = next && ids.includes(next);
  const tiles = unit.lessons.map((lesson, i) => {
    const done = store.isDone(lesson.id);
    const state = done ? 'is-done' : (lesson.id === next ? 'is-next' : '');
    return h('button', {
      class: 'tile ' + state, 'data-tile': lesson.id,
      'aria-label': `Lección ${i + 1}: ${lesson.title_es}${done ? ' (hecha)' : ''}`,
      html: done ? motif(lesson.id) : null,
      onclick: () => { ui.sheet = { kind: 'lesson', id: lesson.id }; render(); },
    }, done ? null : String(i + 1));
  });
  const dId = unit.id + 'd';
  const dDone = store.isDone(dId);
  tiles.push(h('button', {
    class: 'tile ' + (dDone ? 'is-done' : (complete ? 'is-open' : '')), 'data-tile': dId,
    'aria-label': `Diálogo: ${unit.dialogue.title_es}${dDone ? ' (hecho)' : ''}`, html: ICON.dialogue,
    onclick: () => { ui.sheet = { kind: 'dialogue', id: unit.id }; render(); },
  }));
  tiles.push(complete
    ? h('div', { class: 'tile is-done', 'aria-hidden': 'true', html: ICON.sun })
    : h('button', {
      class: 'tile ' + (isCurrent ? 'is-test' : ''), 'data-tile': unit.id + 't',
      'aria-label': 'Saltar la unidad con una prueba',
      html: isCurrent ? ICON.skip + '<span class="tile-label">Saltar</span>' : ICON.lock,
      onclick: () => { ui.sheet = { kind: 'test', id: unit.id }; render(); },
    }));
  return h('section', { class: 'unit' },
    h('div', { class: 'unit-head' },
      h('h2', {}, h('span', { class: 'unit-num' }, `Unidad ${index + 1}`), unit.title_es),
      h('button', { class: 'link', 'data-notes': unit.id, onclick: () => { ui.notes = unit.id; show('notes'); } }, 'Notas')),
    h('div', { class: 'wall' }, tiles));
}

function viewSheet() {
  const sh = ui.sheet;
  const close = () => { ui.sheet = null; render(); };
  const next = nextLessonId();
  let body;
  if (sh.kind === 'lesson') {
    const { lesson } = course.lessonInfo.get(sh.id);
    const done = store.isDone(sh.id);
    const open = done || sh.id === next;
    const words = course.newEntries(sh.id).map((e) => e.nl).join(', ');
    body = [
      h('h2', {}, lesson.title_es),
      h('p', {}, 'Palabras nuevas: ', h('span', { class: 'words', lang: 'nl' }, words)),
      open
        ? h('button', { class: 'btn btn-primary', id: 'sheet-go', onclick: () => startSession('lesson', sh.id) }, done ? 'Repetir' : 'Empezar')
        : h('p', { class: 'muted' }, 'Termina primero la lección anterior, o salta la unidad con la prueba.'),
    ];
  } else if (sh.kind === 'dialogue') {
    const unit = course.unitById(sh.id);
    const open = unitComplete(unit);
    body = [
      h('h2', {}, `Diálogo: ${unit.dialogue.title_es}`),
      open
        ? [h('p', {}, 'Lee y escucha una conversación con todo lo de la unidad, y responde tres preguntas.'),
          h('button', { class: 'btn btn-primary', id: 'sheet-go', onclick: () => startSession('dialogue', sh.id) }, 'Leer y escuchar')]
        : h('p', { class: 'muted' }, 'Se abre cuando termines las seis lecciones de la unidad.'),
    ];
  } else {
    const unit = course.unitById(sh.id);
    const isCurrent = next && unitLessonIds(unit).includes(next);
    body = [
      h('h2', {}, '¿Ya sabes esto?'),
      isCurrent
        ? [h('p', {}, `Haz la prueba de la unidad: ${UNIT_TEST_SIZE} preguntas sin segundas oportunidades. Con ${UNIT_TEST_PASS} aciertos, toda la unidad queda hecha.`),
          h('button', { class: 'btn btn-primary', id: 'sheet-go', onclick: () => startSession('test', sh.id) }, 'Hacer la prueba')]
        : h('p', { class: 'muted' }, 'Primero termina o salta la unidad anterior.'),
    ];
  }
  return h('div', { class: 'scrim', onclick: (e) => { if (e.target.classList.contains('scrim')) close(); } },
    h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' }, body,
      h('button', { class: 'link', onclick: close }, 'Cerrar')));
}

// ---------- views: session ----------
function speakBtn(key, big) {
  return h('button', { class: 'speak' + (big ? ' is-big' : ''), 'aria-label': 'Escuchar', html: ICON.speaker, onclick: () => audio.play(key) });
}

const TASK = {
  card: 'Palabra nueva',
  dialogue: 'Lee y escucha',
  mc: '¿Qué significa?',
  'mc:es': 'Según el diálogo',
  'tiles:nl2es': 'Forma la traducción',
  'tiles:es2nl': 'Dilo en neerlandés',
  'tiles:listen': 'Escucha y forma la frase',
  'type:es2nl': 'Escríbelo en neerlandés',
  'type:listen': 'Escribe lo que oyes',
  match: 'Une las parejas',
};

function viewSession() {
  const s = ui.session, st = s.step;
  if (!st) return [];
  const answered = s.phase === 'feedback';
  const taskKey = st.type === 'mc' ? (st.promptEs ? 'mc:es' : 'mc') : (st.mode ? `${st.type}:${st.mode}` : st.type);

  const top = h('div', { class: 'player-top' },
    h('button', { class: 'icon-btn', 'aria-label': 'Salir de la lección', id: 'exit', onclick: () => { s.askExit = true; render(); } }, icon('close')),
    h('div', { class: 'bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': s.total, 'aria-valuenow': s.done },
      h('i', { style: `width:${s.total ? (100 * s.done) / s.total : 0}%` })));

  const exitAsk = s.askExit && h('div', { class: 'exit-ask' },
    h('strong', {}, s.kind === 'test' ? '¿Salir de la prueba?' : '¿Salir de la lección?'), ' Lo que llevas no se guarda.',
    h('div', { class: 'row' },
      h('button', { class: 'btn btn-quiet', id: 'exit-yes', onclick: leaveSession }, 'Salir'),
      h('button', { class: 'btn btn-primary', onclick: () => { s.askExit = false; render(); } }, 'Seguir aquí')));

  let work, foot;
  if (st.type === 'card') {
    work = h('div', { class: 'card' },
      h('div', { class: 'card-word' }, speakBtn(st.audio), h('span', { class: 'prompt-text', lang: 'nl' }, st.nl)),
      st.forms.length ? h('p', { class: 'card-forms', lang: 'nl' }, st.forms.join(', ')) : null,
      h('p', { class: 'card-es' }, st.es.join(', ')),
      st.note ? h('p', { class: 'card-note' }, st.note) : null);
    foot = h('button', { class: 'btn btn-primary', id: 'continue', onclick: advance }, 'Continuar');
  } else if (st.type === 'dialogue') {
    const a = s.answer;
    work = [
      h('div', { class: 'lines' }, st.lines.map((l) => h('button', { class: 'line', onclick: () => audio.play(l.audio) },
        h('span', { class: 'line-who' }, l.speaker),
        h('span', { class: 'line-nl', lang: 'nl' }, l.nl),
        a.showEs ? h('span', { class: 'line-es' }, l.es) : null))),
      h('button', { class: 'link', id: 'toggle-es', onclick: () => { a.showEs = !a.showEs; render(); } }, a.showEs ? 'Ocultar la traducción' : 'Ver la traducción'),
      h('p', { class: 'muted small' }, 'Toca una línea para escucharla.'),
    ];
    foot = h('button', { class: 'btn btn-primary', id: 'continue', onclick: advance }, 'Ir a las preguntas');
  } else {
    work = [viewPrompt(st), viewAnswerArea(s, answered)];
    foot = answered
      ? [viewFeedback(s), h('button', { class: 'btn ' + (s.result.ok ? 'btn-ok' : 'btn-bad'), id: 'continue', onclick: advance }, 'Continuar')]
      : (st.type === 'match' ? null : h('button', { class: 'btn btn-primary', id: 'check', disabled: !hasAnswer(s), onclick: checkAnswer }, 'Comprobar'));
  }
  return h('div', { class: 'player' }, top, exitAsk, h('p', { class: 'task' }, TASK[taskKey]), h('div', { class: 'work' }, work), h('div', { class: 'foot' }, foot));
}

function viewPrompt(st) {
  if (st.type === 'match') return null;
  if (st.mode === 'listen') {
    return h('div', { class: 'listen-row' }, speakBtn(st.audio, true),
      h('button', { class: 'speak-slow', onclick: () => audio.play(st.audio, { slow: true }) }, 'Más lento'));
  }
  if (st.type === 'mc' && st.promptEs) return h('div', { class: 'prompt' }, h('span', { class: 'prompt-text is-es' }, st.promptEs));
  const dutch = st.type === 'mc' || st.mode === 'nl2es';
  return h('div', { class: 'prompt' },
    dutch && st.audio ? speakBtn(st.audio) : null,
    h('span', { class: 'prompt-text' + (dutch ? '' : ' is-es'), lang: dutch ? 'nl' : 'es' }, dutch ? (st.promptNl || st.prompt) : st.prompt));
}

function viewAnswerArea(s, answered) {
  const st = s.step, a = s.answer;
  if (st.type === 'mc') {
    return h('div', { class: 'options' }, st.options.map((text, i) => {
      let cls = 'option';
      if (answered) cls += i === st.answer ? ' is-right' : (i === a.picked ? ' is-wrong' : '');
      else if (i === a.picked) cls += ' is-picked';
      return h('button', { class: cls, 'data-option': i, disabled: answered, onclick: () => { a.picked = i; render(); } }, text);
    }));
  }
  if (st.type === 'tiles') {
    const byId = new Map(st.tiles.map((t) => [t.id, t]));
    return [
      h('div', { class: 'answer-line', lang: st.lang }, a.chosen.map((id) => h('button', {
        class: 'chip', 'data-chosen': id, disabled: answered,
        onclick: () => { a.chosen = a.chosen.filter((x) => x !== id); render(); },
      }, byId.get(id).text))),
      h('div', { class: 'bank', lang: st.lang }, st.tiles.map((t) => h('button', {
        class: 'chip' + (a.chosen.includes(t.id) ? ' is-used' : ''), 'data-tile-id': t.id, disabled: answered || a.chosen.includes(t.id),
        onclick: () => { a.chosen.push(t.id); render(); },
      }, t.text))),
    ];
  }
  if (st.type === 'type') {
    return h('textarea', {
      class: 'field', id: 'answer', rows: 2, lang: 'nl', placeholder: 'Escribe en neerlandés', disabled: answered,
      autocomplete: 'off', autocorrect: 'off', autocapitalize: 'none', spellcheck: 'false', enterkeyhint: 'done',
      oninput: (e) => {
        a.text = e.target.value;                         // no re-render while typing: it would steal the focus
        const btn = document.getElementById('check');
        if (btn) btn.disabled = !hasAnswer(s);
      },
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); checkAnswer(); } },
    }, a.text);
  }
  // matching: Dutch on the left, Spanish on the right
  const pair = (id) => st.pairs.find((p) => p.id === id);
  const cell = (id, side) => {
    const matched = a.matched.includes(id);
    let cls = 'option';
    if (matched) cls += ' is-matched';
    else if (side === 'nl' && a.nl === id) cls += ' is-picked';
    if (a.miss && a.miss[side] === id) cls += ' is-miss';
    return h('button', { class: cls, [`data-${side}`]: id, lang: side, disabled: matched || answered, onclick: () => tapMatch(side, id) }, pair(id)[side]);
  };
  const rows = st.left.map((id, i) => [cell(id, 'nl'), cell(st.right[i], 'es')]);
  return h('div', { class: 'match' }, rows);
}

function tapMatch(side, id) {
  const s = ui.session, st = s.step, a = s.answer;
  a.miss = null;
  if (side === 'nl') {
    a.nl = id;
    audio.play(st.pairs.find((p) => p.id === id).audio);
    return render();
  }
  if (!a.nl) return;
  if (a.nl === id) {
    a.matched.push(id); a.nl = null;
    if (a.matched.length === st.pairs.length) {
      // a matching game is never repeated; a miss only costs the "first try" credit
      if (!st._retry && a.misses === 0) s.firstTry++;
      s.done++;
      s.result = { ok: true, kind: 'match', best: '' };
      s.phase = 'feedback';
    }
  } else {
    a.misses++; a.miss = { nl: a.nl, es: id }; a.nl = null;
  }
  render();
}

function viewFeedback(s) {
  const st = s.step, r = s.result;
  if (r.kind === 'match') return h('div', { class: 'feedback is-ok' }, h('h3', {}, '¡Hecho!'));
  if (r.ok) {
    const title = r.kind === 'typo' ? '¡Casi perfecto!' : '¡Correcto!';
    const fix = r.kind === 'typo' ? ['Se escribe así: ', h('span', { class: 'answer' }, r.best)]
      : (r.kind === 'accent' ? ['Ojo con los acentos: ', h('span', { class: 'answer' }, r.best)] : null);
    // she heard Dutch and wrote it: now show what it means
    const gloss = st.mode === 'listen' && st.reveal ? st.reveal.es : null;
    return h('div', { class: 'feedback is-ok' }, h('h3', {}, title), fix ? h('p', {}, fix) : null,
      gloss ? h('p', { class: 'gloss' }, gloss) : null);
  }
  const hint = r.kind === 'article' ? 'Fíjate en el artículo: de o het.'
    : (r.kind === 'order' ? 'Las palabras están bien; cambia el orden.' : null);
  const canReport = st.type !== 'mc' && s.kind !== 'dialogue';
  return h('div', { class: 'feedback is-bad' },
    h('h3', {}, 'Respuesta correcta'),
    h('p', { class: 'answer', lang: st.lang || 'es' }, r.best),
    hint ? h('p', { class: 'gloss' }, hint) : null,
    st.reveal && st.mode === 'listen' ? h('p', { class: 'gloss' }, st.reveal.es) : null,
    canReport ? h('button', {
      class: 'link', id: 'report', disabled: s.reported,
      onclick: () => {
        store.report({ sid: st.sid, type: st.type, mode: st.mode, given: r.given, expected: r.best });
        s.reported = true; render();
      },
    }, s.reported ? 'Anotado para revisar' : 'Mi respuesta también era correcta') : null);
}

// ---------- views: result ----------
function viewResult() {
  const r = ui.result;
  const done = h('button', { class: 'btn btn-primary', id: 'result-done', onclick: goHome }, 'Volver a los azulejos');
  if (r.kind === 'test' && !r.pass) {
    return h('div', { class: 'result' },
      h('h1', {}, 'Todavía no'),
      h('div', { class: 'facts' },
        h('span', {}, `Acertaste ${r.correct} de ${r.total}; hacen falta ${r.need}.`),
        h('span', { class: 'muted' }, 'Haz las lecciones de la unidad, o inténtalo otra vez cuando quieras.')),
      done);
  }
  const tile = h('div', { class: 'result-tile' }, h('div', { class: 'tile is-done', html: r.kind === 'test' ? ICON.sun : (r.kind === 'dialogue' ? ICON.dialogue : motif(r.id)) }));
  const title = r.kind === 'test' ? 'Unidad superada' : (r.kind === 'dialogue' ? 'Diálogo completo' : 'Lección completa');
  return h('div', { class: 'result' }, tile,
    h('h1', {}, title),
    h('div', { class: 'facts' },
      h('span', {}, `Aciertos a la primera: ${r.correct} de ${r.total}`),
      r.kind === 'test' && r.added ? h('span', {}, `${plural(r.added, 'azulejo puesto', 'azulejos puestos')} de una vez`) : null,
      h('span', {}, `+${r.xp} puntos`),
      h('span', {}, `Racha: ${plural(r.streak, 'día', 'días')}`)),
    done);
}

// ---------- views: notes and settings ----------
function pageTop(title) {
  return h('div', { class: 'page-top' },
    h('button', { class: 'icon-btn', 'aria-label': 'Volver', id: 'back', onclick: goHome }, icon('back')),
    h('h1', {}, title));
}

function viewNotes() {
  const unit = course.unitById(ui.notes);
  return [pageTop(unit.title_es),
    h('div', { class: 'notes' },
      h('h2', {}, 'En esta unidad aprendes a'),
      h('ul', {}, unit.goals_es.map((g) => h('li', {}, g))),
      h('div', { html: renderNotes(unit.grammar_note_es) }))];
}

function copyText(text, okMessage) {
  const done = (ok) => { ui.notice = ok ? okMessage : 'No se pudo copiar. Usa «Descargar archivo».'; render(); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => done(true), () => done(false));
  else done(false);
}

function viewSettings() {
  const d = store.data;
  const doneCount = course.lessonOrder.filter((id) => store.isDone(id)).length;
  const sources = { file: 'grabaciones', voice: 'la voz del teléfono', none: 'no disponible' };
  return [pageTop('Ajustes'),
    ui.notice ? h('p', { class: 'notice', id: 'notice' }, ui.notice) : null,
    h('section', { class: 'panel' },
      h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('b', {}, String(doneCount)), doneCount === 1 ? 'azulejo puesto' : 'azulejos puestos'),
        h('div', { class: 'stat' }, h('b', {}, String(d.xp)), d.xp === 1 ? 'punto' : 'puntos'),
        h('div', { class: 'stat' }, h('b', {}, String(store.streak())), store.streak() === 1 ? 'día de racha' : 'días de racha'),
        h('div', { class: 'stat' }, h('b', {}, String(d.streak.best)), 'mejor racha, en días'))),
    h('section', { class: 'panel' },
      h('h2', {}, 'Instalar'),
      isInstalled()
        ? h('p', { class: 'muted small', id: 'install-state' }, 'Estás usando la app instalada.')
        : canInstall()
          ? [h('p', { class: 'muted small' }, 'Pon Tegeltjes en tu pantalla de inicio para abrirla como cualquier otra app.'),
            h('button', { class: 'btn btn-quiet', id: 'install-settings', onclick: install }, 'Instalar la app')]
          : h('p', { class: 'muted small', id: 'install-state' }, 'En Chrome, toca el menú ⋮ (arriba a la derecha) y elige «Agregar a pantalla principal» o «Instalar app».')),
    h('section', { class: 'panel' },
      h('h2', {}, 'Audio'),
      h('button', { class: 'toggle', id: 'slow', 'aria-pressed': String(!!d.settings.slow), onclick: () => { store.setSetting('slow', !d.settings.slow); render(); } },
        'Reproducir siempre más lento', h('i', {})),
      h('p', { class: 'muted small' }, `Fuente del audio: ${sources[audio.source('hallo')]}.`)),
    h('section', { class: 'panel' },
      h('h2', {}, 'Copia de seguridad'),
      h('p', { class: 'muted small' }, 'Tu progreso vive solo en este teléfono. Guarda una copia de vez en cuando; sirve para pasarlo a otro teléfono.'),
      h('button', { class: 'btn btn-quiet', id: 'export-copy', onclick: () => copyText(store.exportText(), 'Copia copiada. Pégala en un mensaje para ti.') }, 'Copiar la copia'),
      h('button', { class: 'btn btn-quiet', id: 'export-file', onclick: () => {
        const a = h('a', { href: URL.createObjectURL(new Blob([store.exportText()], { type: 'application/json' })), download: `tegeltjes-${new Date().toISOString().slice(0, 10)}.json` });
        document.body.append(a); a.click(); a.remove();
      } }, 'Descargar archivo'),
      h('textarea', { class: 'field', id: 'import-text', rows: 2, placeholder: 'Pega aquí una copia para restaurarla', autocomplete: 'off', spellcheck: 'false' }),
      h('button', { class: 'btn btn-quiet', id: 'import-go', style: 'margin-top:0.6rem', onclick: () => {
        const text = document.getElementById('import-text').value.trim();
        if (!text) { ui.notice = 'Pega primero la copia en el recuadro.'; return render(); }
        const err = store.importText(text);
        ui.notice = err || 'Copia restaurada.';
        render();
      } }, 'Restaurar')),
    h('section', { class: 'panel' },
      h('h2', {}, 'Respuestas para revisar'),
      h('p', { class: 'muted small' }, `Respuestas tuyas que marcaste como correctas: ${d.reports.length}. Envíalas para que se añadan al curso.`),
      h('button', { class: 'btn btn-quiet', id: 'reports-copy', disabled: d.reports.length === 0,
        onclick: () => copyText(JSON.stringify({ app: 'tegeltjes', reports: d.reports }, null, 1), 'Respuestas copiadas.') }, 'Copiar las respuestas')),
    h('p', { class: 'muted small' }, `Tegeltjes ${VERSION}`)];
}

// ---------- render ----------
function render() {
  let view;
  switch (ui.screen) {
    case 'home': view = viewHome(); break;
    case 'session': view = viewSession(); break;
    case 'result': view = viewResult(); break;
    case 'notes': view = viewNotes(); break;
    case 'settings': view = viewSettings(); break;
    case 'error': view = h('div', { class: 'result' }, h('h1', {}, 'No se pudo cargar el curso'),
      h('div', { class: 'facts' }, h('span', {}, 'Revisa la conexión y vuelve a intentarlo.'), h('span', { class: 'muted small' }, ui.error)),
      h('button', { class: 'btn btn-primary', onclick: () => location.reload() }, 'Reintentar')); break;
    default: view = h('p', { class: 'boot' }, 'Cargando…');
  }
  root.replaceChildren(...[view].flat(3).filter(Boolean), ...(ui.sheet && ui.screen === 'home' ? [viewSheet()] : []));
  const field = document.getElementById('answer');
  if (field && !field.disabled) field.focus({ preventScroll: true });
}

// ---------- start ----------
async function boot() {
  let storage = null;
  try { storage = window.localStorage; } catch (e) { /* blocked: the store works in memory and says so */ }
  store = createStore(storage);
  const fetchFn = window.fetch.bind(window);
  let index;
  try {
    [course, index] = await Promise.all([loadContent(CONTENT, fetchFn), loadAudioIndex(AUDIO, fetchFn)]);
  } catch (e) {
    ui.screen = 'error'; ui.error = String((e && e.message) || e);
    return render();
  }
  audio = createAudio({ base: AUDIO, index, win: window, isSlow: () => !!store.data.settings.slow });
  ui.screen = 'home';
  render();
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) { /* optional */ }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

// For the automated tests: read the state and get the right answer to the
// current step. This is her own practice app, so there is nothing to protect.
window.__tegel = {
  ui, get course() { return course; }, get store() { return store; },
  solve() {
    const st = ui.session && ui.session.step;
    if (!st) return null;
    if (st.type === 'mc') return { option: st.answer };
    if (st.type === 'type') return { text: st.accepted[0] };
    if (st.type === 'match') return { pairs: st.pairs.map((p) => p.id) };
    if (st.type === 'tiles') {
      const pool = st.tiles.slice();
      const words = tileWords(st.lang === 'es' ? st.reveal.es : st.reveal.nl, course.proper);
      return { tiles: words.map((w) => pool.splice(pool.findIndex((t) => t.text === w), 1)[0].id) };
    }
    return {};
  },
};

boot();
