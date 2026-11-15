// Speaking practice: she reads a Dutch sentence aloud, Chrome's speech
// recognition writes down what it heard, and the app shows which words came
// through. The scoring is pure and tested (app/tests/speech.test.mjs); the
// listener wraps the browser's recogniser the way the speech test on her
// phone showed it has to be done:
// - the microphone opens a moment after start(): "Habla ahora" only then,
//   or the first word is lost;
// - the recogniser writes "half drie" as "2:30" and "vijf" as "5";
// - when it does not understand her, it answers with English-looking words;
// - sometimes it returns nothing at all: that is not a mistake of hers.

const UNITS = ['nul', 'een', 'twee', 'drie', 'vier', 'vijf', 'zes', 'zeven', 'acht', 'negen',
  'tien', 'elf', 'twaalf', 'dertien', 'veertien', 'vijftien', 'zestien', 'zeventien', 'achttien', 'negentien'];
const TENS = { 20: 'twintig', 30: 'dertig', 40: 'veertig', 50: 'vijftig', 60: 'zestig', 70: 'zeventig', 80: 'tachtig', 90: 'negentig' };

/** 0..100 the Dutch way (units before tens: 25 = vijfentwintig). */
export function numberToDutch(n) {
  if (n < 20) return UNITS[n];
  if (n === 100) return 'honderd';
  const tens = Math.floor(n / 10) * 10, unit = n % 10;
  return unit === 0 ? TENS[tens] : UNITS[unit] + 'en' + TENS[tens];
}

/** A clock time as it is said in Dutch; whole five-minute steps only. */
export function timeToDutch(h, m) {
  if (h > 24 || m > 59 || m % 5 !== 0) return null;
  const hour = (x) => { const v = x % 12; return numberToDutch(v === 0 ? 12 : v); };
  const next = hour(h + 1);
  switch (m) {
    case 0: return hour(h) + ' uur';
    case 5: return 'vijf over ' + hour(h);
    case 10: return 'tien over ' + hour(h);
    case 15: return 'kwart over ' + hour(h);
    case 20: return 'tien voor half ' + next;
    case 25: return 'vijf voor half ' + next;
    case 30: return 'half ' + next;
    case 35: return 'vijf over half ' + next;
    case 40: return 'tien over half ' + next;
    case 45: return 'kwart voor ' + next;
    case 50: return 'tien voor ' + next;
    default: return 'vijf voor ' + next;
  }
}

/** Lowercase words without accents or punctuation; times and digits written out. */
export function words(text) {
  const n = String(text).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(\d{1,2})[:.](\d{2})\b/g, (all, h, m) => {
      const t = timeToDutch(parseInt(h, 10), parseInt(m, 10));
      return t ? ' ' + t + ' ' : all;
    })
    .replace(/\d+/g, (m) => { const v = parseInt(m, 10); return v <= 100 ? ' ' + numberToDutch(v) + ' ' : ' ' + m + ' '; })
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return n ? n.split(' ') : [];
}

/**
 * Which words of the target were heard? Word order is not judged: this is
 * pronunciation practice, and the recogniser is the judge of each word.
 * @returns {{flags: boolean[], matched: number, total: number}}
 */
export function matchWords(target, heard) {
  const t = words(target), h = words(heard);
  const flags = t.map(() => false);
  const used = h.map(() => false);
  const take = (test) => {
    t.forEach((w, i) => {
      if (flags[i]) return;
      const j = h.findIndex((x, k) => !used[k] && test(w, x));
      if (j >= 0) { flags[i] = true; used[j] = true; }
    });
  };
  take((a, b) => a === b);
  // spaces in other places: "dank je wel" heard as "dankjewel", "telefoonnummer" as "telefoon nummer"
  for (let i = 0; i < t.length; i++) {
    for (let len = 3; len >= 2; len--) {
      if (i + len > t.length || t.slice(i, i + len).some((_, k) => flags[i + k])) continue;
      const joined = t.slice(i, i + len).join('');
      const j = h.findIndex((x, k) => !used[k] && x === joined);
      if (j >= 0) { for (let k = 0; k < len; k++) flags[i + k] = true; used[j] = true; }
    }
  }
  t.forEach((w, i) => {
    if (flags[i]) return;
    for (let len = 3; len >= 2; len--) {
      for (let j = 0; j + len <= h.length; j++) {
        if (h.slice(j, j + len).some((_, k) => used[j + k])) continue;
        if (h.slice(j, j + len).join('') === w) { flags[i] = true; for (let k = 0; k < len; k++) used[j + k] = true; return; }
      }
    }
  });
  // No "close enough" matching: the recogniser writes real words, and a word
  // that is one letter off is usually a different word (vandaag for vandaan).
  return { flags, matched: flags.filter(Boolean).length, total: t.length };
}

/**
 * Judge one attempt from the recogniser's alternatives (best first).
 * verdict:
 *   'ok'       every word heard (one may be missing in a sentence of five or more)
 *   'partly'   at least a third of the words heard
 *   'unclear'  it heard something, but hardly any of it was this sentence
 *   'silence'  nothing came back: not her mistake
 * @param {string} target
 * @param {string[]} alternatives
 */
export function judge(target, alternatives) {
  const shown = words(target);
  const list = (alternatives || []).filter((a) => a && a.trim());
  if (!list.length) return { verdict: 'silence', flags: shown.map(() => false), heard: '', matched: 0, total: shown.length };
  let best = null;
  for (const alt of list) {
    const m = matchWords(target, alt);
    if (!best || m.matched > best.matched) best = { ...m, heard: alt };
  }
  const misses = best.total - best.matched;
  const ok = misses === 0 || (best.total >= 5 && misses === 1);
  const verdict = ok ? 'ok' : (best.matched / best.total >= 1 / 3 ? 'partly' : 'unclear');
  return { verdict, flags: best.flags, heard: best.heard, matched: best.matched, total: best.total };
}

/** The sentence as she sees it, split into the words that get a colour (same count as judge().flags). */
export function displayWords(target) {
  const out = [];
  for (const piece of String(target).split(/\s+/).filter(Boolean)) {
    const n = words(piece).length;
    if (n === 0) { if (out.length) out[out.length - 1].text += ' ' + piece; continue; }
    out.push({ text: piece, count: n });           // "2:30" would count as two words; course text has none
  }
  return out;
}

// ---------- the browser's recogniser ----------
const LISTEN_TIMEOUT_MS = 12000;

export function canRecognise(win) { return !!(win && (win.SpeechRecognition || win.webkitSpeechRecognition)); }

/**
 * Listen once. Callbacks:
 *   onReady()            the microphone is open: now she can speak
 *   onDone({alternatives, error})   error is null, 'blocked' (no permission),
 *                        'offline' (recognition needs a connection) or 'failed'
 * Returns a function that stops listening.
 */
export function listen(win, { onReady, onDone }) {
  const SR = win.SpeechRecognition || win.webkitSpeechRecognition;
  let rec = null, finished = false, alternatives = [], error = null;
  const finish = () => {
    if (finished) return;
    finished = true;
    win.clearTimeout(timer);
    onDone({ alternatives, error });
  };
  const timer = win.setTimeout(() => { try { if (rec) rec.abort(); } catch (e) { /* ignore */ } finish(); }, LISTEN_TIMEOUT_MS);
  try {
    rec = new SR();
    rec.lang = 'nl-NL';
    rec.continuous = false;
    rec.interimResults = false;
    rec.maxAlternatives = 5;
    rec.onaudiostart = () => { if (!finished) onReady(); };
    rec.onresult = (e) => {
      const res = e.results[e.results.length - 1];
      alternatives = [];
      for (let i = 0; i < res.length; i++) alternatives.push(res[i].transcript);
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') error = 'blocked';
      else if (e.error === 'network') error = 'offline';
      else if (e.error !== 'no-speech' && e.error !== 'aborted') error = 'failed';
    };
    rec.onend = finish;
    rec.start();
  } catch (e) { error = 'failed'; finish(); }
  return () => { try { if (rec) rec.stop(); } catch (e) { /* ignore */ } };
}
