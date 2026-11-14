// Spike A: does Chrome's speech recognition (Web Speech API, nl-NL) work well
// enough on the target phone for speaking exercises?
(function () {
  'use strict';

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const STORE_KEY = 'spikeA.runs';
  const PASS_RATE = 0.9;        // criterion agreed in the plan, native speaker, 30 sentences
  const LISTEN_TIMEOUT_MS = 15000;
  const app = document.getElementById('app');

  const state = {
    screen: 'home',            // home | run | results
    tester: '',
    role: 'nativo',            // nativo | aprendiz
    setKey: 'frases',
    run: null,
    index: 0,
    listening: false,
    rec: null,
    runs: loadRuns(),
    storageOk: true,
    onDevice: null,
    installEvt: null,
    confirmClear: false,
    notice: ''
  };

  // ---------- storage (may be unavailable; the test still works without it) ----------
  function loadRuns() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); }
    catch (e) { return []; }
  }
  function saveRuns() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state.runs)); state.storageOk = true; }
    catch (e) { state.storageOk = false; }
  }

  // ---------- helpers ----------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pct(x) { return Math.round(x * 100) + '%'; }
  function env() {
    return {
      userAgent: navigator.userAgent,
      api: SR ? (window.SpeechRecognition ? 'SpeechRecognition' : 'webkitSpeechRecognition') : 'no disponible',
      installed: window.matchMedia('(display-mode: standalone)').matches,
      online: navigator.onLine,
      secureContext: window.isSecureContext,
      browserLanguage: navigator.language,
      onDevice: state.onDevice
    };
  }
  function summaryLine(run) {
    const s = Scoring.summarize(run.items);
    return run.tester + ' (' + run.role + '), ' + TestItems.sets[run.set].label + ': ' +
      s.firstExact + '/' + s.done + ' exactas al primer intento (' + pct(s.firstExactRate) + '), ' +
      'precisión media por palabra ' + pct(s.meanWordAccuracy) + ', ' +
      'sin resultado: ' + s.firstAttemptNoResult + ', ' +
      'errores: ' + (Object.keys(s.errors).length ? JSON.stringify(s.errors) : 'ninguno') +
      (run.env.installed ? ', app instalada' : ', en el navegador');
  }
  function exportText() {
    const lines = state.runs.map(summaryLine);
    return 'RESUMEN\n' + lines.join('\n') + '\n\nDATOS\n' + JSON.stringify(state.runs);
  }

  // ---------- recognition ----------
  function listen() {
    if (!SR || state.listening) return;
    const item = state.run.items[state.index];
    const attempt = { startedAt: Date.now(), latencyMs: null, alternatives: [], error: null, events: [] };
    let finished = false;
    let rec;

    function finish() {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      item.attempts.push(attempt);
      state.listening = false;
      state.rec = null;
      persistRun();
      render();
    }
    const timer = setTimeout(function () {
      attempt.events.push('timeout');
      if (!attempt.error && !attempt.alternatives.length) attempt.error = 'timeout';
      try { rec && rec.abort(); } catch (e) { /* ignore */ }
      finish();
    }, LISTEN_TIMEOUT_MS);

    try { rec = new SR(); }
    catch (e) { attempt.error = 'constructor: ' + e.message; finish(); return; }

    rec.lang = 'nl-NL';
    rec.continuous = false;
    rec.interimResults = false;
    rec.maxAlternatives = 5;

    // The order of these events is the diagnostic for the "microphone keeps
    // switching on and off" problem reported on Android.
    ['start', 'audiostart', 'soundstart', 'speechstart', 'speechend', 'soundend', 'audioend', 'nomatch']
      .forEach(function (name) { rec['on' + name] = function () { attempt.events.push(name); }; });

    rec.onresult = function (e) {
      attempt.events.push('result');
      const res = e.results[e.results.length - 1];
      attempt.alternatives = [];
      for (let i = 0; i < res.length; i++) {
        attempt.alternatives.push({ transcript: res[i].transcript, confidence: res[i].confidence });
      }
      attempt.latencyMs = Date.now() - attempt.startedAt;
    };
    rec.onerror = function (e) {
      attempt.events.push('error:' + e.error);
      attempt.error = e.error;
    };
    rec.onend = function () {
      attempt.events.push('end');
      if (!attempt.alternatives.length && !attempt.error) attempt.error = 'sin-resultado';
      finish();
    };

    state.listening = true;
    state.rec = rec;
    render();
    try { rec.start(); }
    catch (e) { attempt.error = 'start: ' + e.message; finish(); }
  }
  function stopListening() {
    try { state.rec && state.rec.stop(); } catch (e) { /* ignore */ }
  }

  // ---------- run lifecycle ----------
  function startRun() {
    const set = TestItems.sets[state.setKey];
    state.run = {
      id: 'run-' + Date.now(),
      tester: state.tester.trim() || (state.role === 'nativo' ? 'Nativo' : 'Aprendiz'),
      role: state.role,
      set: state.setKey,
      startedAt: new Date().toISOString(),
      env: env(),
      items: set.items.map(function (t) { return { target: t, attempts: [] }; })
    };
    state.index = 0;
    state.screen = 'run';
    state.runs.push(state.run);
    saveRuns();
    render();
  }
  function persistRun() { saveRuns(); }
  function next() {
    if (state.index < state.run.items.length - 1) { state.index++; render(); }
    else { state.run.finishedAt = new Date().toISOString(); persistRun(); state.screen = 'results'; render(); }
  }

  // ---------- views ----------
  function viewHome() {
    const e = env();
    const runsHtml = state.runs.length ? (
      '<h2>Pruebas guardadas</h2><div class="card">' +
      state.runs.map(function (r) { return '<p>' + esc(summaryLine(r)) + '</p>'; }).join('') +
      '<div class="row"><button id="toResults" class="secondary">Ver y exportar</button>' +
      '<button id="clear" class="secondary">' + (state.confirmClear ? 'Tocar otra vez para borrar' : 'Borrar todo') + '</button></div></div>'
    ) : '';
    return '<h1>Prueba de voz</h1>' +
      '<p class="muted">Comprueba si el reconocimiento de voz de Chrome entiende neerlandés en este teléfono. Lee cada frase en voz alta, una sola vez, a ritmo normal.</p>' +
      (SR ? '' : '<div class="card"><span class="badge bad">No disponible</span><p>Este navegador no ofrece reconocimiento de voz. Abre la página en Chrome para Android.</p></div>') +
      (state.storageOk ? '' : '<div class="card"><span class="badge warn">Aviso</span><p>No se pueden guardar resultados en este navegador. Exporta al terminar.</p></div>') +
      '<div class="card">' +
        '<label for="tester">Nombre de quien habla</label>' +
        '<input type="text" id="tester" autocomplete="off" value="' + esc(state.tester) + '">' +
        '<label for="role">Nivel</label>' +
        '<select id="role"><option value="nativo"' + (state.role === 'nativo' ? ' selected' : '') + '>Hablante nativo</option>' +
        '<option value="aprendiz"' + (state.role === 'aprendiz' ? ' selected' : '') + '>Aprendiz</option></select>' +
        '<label for="set">Qué leer</label>' +
        '<select id="set">' + Object.keys(TestItems.sets).map(function (k) {
          return '<option value="' + k + '"' + (state.setKey === k ? ' selected' : '') + '>' + esc(TestItems.sets[k].label) + '</option>';
        }).join('') + '</select>' +
        '<div class="row"><button id="start"' + (SR ? '' : ' disabled') + '>Empezar</button></div>' +
      '</div>' +
      (state.installEvt ? '<div class="card"><p>Para probar como app instalada:</p><div class="row"><button id="install" class="secondary">Instalar</button></div></div>' : '') +
      runsHtml +
      '<h2>Diagnóstico</h2><div class="card"><dl>' +
        '<dt>API</dt><dd>' + esc(e.api) + '</dd>' +
        '<dt>App instalada</dt><dd>' + (e.installed ? 'sí' : 'no (navegador)') + '</dd>' +
        '<dt>Conexión</dt><dd>' + (e.online ? 'en línea' : 'sin conexión') + '</dd>' +
        '<dt>Contexto seguro</dt><dd>' + (e.secureContext ? 'sí' : 'no (el micrófono requiere https)') + '</dd>' +
        '<dt>En el dispositivo</dt><dd>' + esc(e.onDevice === null ? 'no informado' : String(e.onDevice)) + '</dd>' +
        '<dt>Navegador</dt><dd>' + esc(e.userAgent) + '</dd>' +
      '</dl></div>';
  }

  function viewRun() {
    const items = state.run.items;
    const item = items[state.index];
    const last = item.attempts[item.attempts.length - 1];
    let feedback = '';
    if (last) {
      const s = Scoring.scoreAttempt(item.target, last.alternatives);
      const badge = s.exact ? '<span class="badge ok">Exacto</span>'
        : (last.alternatives.length ? '<span class="badge warn">' + pct(s.accuracy) + ' de las palabras</span>'
          : '<span class="badge bad">Sin resultado</span>');
      feedback = '<div class="card">' + badge +
        (last.alternatives.length ? '<p class="heard">' + esc(s.heard) + '</p>' : '') +
        (last.error ? '<p class="muted">Error: ' + esc(last.error) + '</p>' : '') +
        '<p class="muted">Intento ' + item.attempts.length +
        (last.latencyMs !== null ? ' · ' + (last.latencyMs / 1000).toFixed(1) + ' s' : '') + '</p></div>';
    }
    const isLast = state.index === items.length - 1;
    return '<p class="muted">' + esc(state.run.tester) + ' · ' + (state.index + 1) + ' de ' + items.length + '</p>' +
      '<div class="progress"><div style="width:' + (100 * state.index / items.length) + '%"></div></div>' +
      '<p class="target" lang="nl">' + esc(item.target) + '</p>' +
      (state.listening
        ? '<button id="stop" class="mic listening">Escuchando… tocar para parar</button>'
        : '<button id="mic" class="mic">' + (last ? 'Repetir' : 'Hablar') + '</button>') +
      feedback +
      '<div class="row">' +
        '<button id="next" class="secondary"' + (state.listening ? ' disabled' : '') + '>' +
          (isLast ? 'Terminar' : (last ? 'Siguiente' : 'Saltar')) + '</button>' +
      '</div>' +
      '<p class="muted">Cuenta el primer intento. Repetir sirve para ver si un segundo intento ayuda.</p>';
  }

  function viewResults() {
    const blocks = state.runs.map(function (run) {
      const s = Scoring.summarize(run.items);
      const judged = run.role === 'nativo' && run.set === 'frases' && s.done === s.total;
      const verdict = judged
        ? (s.firstExactRate >= PASS_RATE
          ? '<span class="badge ok">Cumple el criterio (≥ ' + pct(PASS_RATE) + ')</span>'
          : '<span class="badge bad">No cumple el criterio (≥ ' + pct(PASS_RATE) + ')</span>')
        : '<span class="badge warn">Informativo</span>';
      const rows = run.items.map(function (it, i) {
        if (!it.attempts.length) return '<tr><td>' + (i + 1) + '</td><td lang="nl">' + esc(it.target) + '</td><td colspan="3" class="muted">saltado</td></tr>';
        const first = Scoring.scoreAttempt(it.target, it.attempts[0].alternatives);
        const mark = first.exact ? '✓' : (first.anyExact ? 'alt.' : '✗');
        return '<tr><td>' + (i + 1) + '</td><td lang="nl">' + esc(it.target) + '</td><td lang="nl">' +
          esc(first.heard || ('(' + (it.attempts[0].error || 'nada') + ')')) + '</td><td>' + mark + '</td><td>' + it.attempts.length + '</td></tr>';
      }).join('');
      return '<div class="card"><p><strong>' + esc(run.tester) + '</strong> · ' + esc(run.role) + ' · ' +
        esc(TestItems.sets[run.set].label) + ' · ' + (run.env.installed ? 'app instalada' : 'navegador') + '</p>' +
        '<p class="big">' + s.firstExact + ' / ' + s.done + ' <span class="muted">exactas al primer intento</span></p>' +
        '<p>' + verdict + '</p>' +
        '<dl><dt>Precisión media por palabra</dt><dd>' + pct(s.meanWordAccuracy) + '</dd>' +
        '<dt>Exacta en alguna alternativa</dt><dd>' + s.anyAlternativeExact + '</dd>' +
        '<dt>Exacta tras repetir</dt><dd>' + s.bestOfAttemptsExact + '</dd>' +
        '<dt>Sin resultado (1.er intento)</dt><dd>' + s.firstAttemptNoResult + '</dd>' +
        '<dt>Errores</dt><dd>' + esc(Object.keys(s.errors).length ? JSON.stringify(s.errors) : 'ninguno') + '</dd></dl>' +
        '<div class="scroll"><table><thead><tr><th>#</th><th>Frase</th><th>Oído</th><th>1.º</th><th>Int.</th></tr></thead><tbody>' +
        rows + '</tbody></table></div></div>';
    }).join('');
    return '<h1>Resultados</h1>' +
      (state.notice ? '<p><span class="badge ok">' + esc(state.notice) + '</span></p>' : '') +
      '<div class="row"><button id="copy">Copiar resultados</button>' +
      '<button id="download" class="secondary">Descargar</button>' +
      (navigator.share ? '<button id="share" class="secondary">Compartir</button>' : '') + '</div>' +
      '<p class="muted">Copia los resultados y pégalos en el chat. ✓ exacto · alt. = exacto solo en una alternativa · ✗ distinto.</p>' +
      (blocks || '<p>No hay pruebas todavía.</p>') +
      '<div class="row"><button id="home" class="secondary">Otra prueba</button></div>';
  }

  // ---------- render + events ----------
  function render() {
    app.innerHTML = state.screen === 'run' ? viewRun() : (state.screen === 'results' ? viewResults() : viewHome());
    bind();
  }
  function on(id, evt, fn) { const el = document.getElementById(id); if (el) el.addEventListener(evt, fn); }
  function bind() {
    on('tester', 'input', function (e) { state.tester = e.target.value; });
    on('role', 'change', function (e) { state.role = e.target.value; });
    on('set', 'change', function (e) { state.setKey = e.target.value; });
    on('start', 'click', startRun);
    on('mic', 'click', listen);
    on('stop', 'click', stopListening);
    on('next', 'click', next);
    on('home', 'click', function () { state.screen = 'home'; state.notice = ''; render(); });
    on('toResults', 'click', function () { state.screen = 'results'; state.notice = ''; render(); });
    on('clear', 'click', function () {
      if (!state.confirmClear) { state.confirmClear = true; render(); return; }
      state.runs = []; state.confirmClear = false; saveRuns(); render();
    });
    on('install', 'click', function () {
      if (state.installEvt) { state.installEvt.prompt(); state.installEvt = null; render(); }
    });
    on('copy', 'click', function () {
      const text = exportText();
      const done = function (ok) { state.notice = ok ? 'Copiado' : 'No se pudo copiar; usa Descargar'; render(); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
      } else { done(false); }
    });
    on('download', 'click', function () {
      const blob = new Blob([exportText()], { type: 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'prueba-de-voz-' + new Date().toISOString().slice(0, 10) + '.txt';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    });
    on('share', 'click', function () {
      navigator.share({ title: 'Prueba de voz', text: exportText() }).catch(function () { /* cancelled */ });
    });
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); state.installEvt = e; if (state.screen === 'home') render();
  });
  window.addEventListener('online', function () { if (state.screen === 'home') render(); });
  window.addEventListener('offline', function () { if (state.screen === 'home') render(); });

  // Newer Chrome versions can report whether nl-NL recognition is available on
  // the device itself. Purely informational; absent on most versions.
  if (SR && typeof SR.available === 'function') {
    try {
      Promise.resolve(SR.available({ langs: ['nl-NL'], processLocally: true }))
        .then(function (v) { state.onDevice = v; if (state.screen === 'home') render(); })
        .catch(function (e) { state.onDevice = 'error: ' + e.message; });
    } catch (e) { state.onDevice = 'error: ' + e.message; }
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(function () { /* install is optional */ });
  }

  render();
})();
