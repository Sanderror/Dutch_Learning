// Pure scoring functions for the speech test. No DOM access, so they can be
// unit-tested with Node (see tools/test_scoring.mjs).
(function (root) {
  'use strict';

  const UNITS = ['nul', 'een', 'twee', 'drie', 'vier', 'vijf', 'zes', 'zeven', 'acht', 'negen',
    'tien', 'elf', 'twaalf', 'dertien', 'veertien', 'vijftien', 'zestien', 'zeventien',
    'achttien', 'negentien'];
  const TENS = { 20: 'twintig', 30: 'dertig', 40: 'veertig', 50: 'vijftig', 60: 'zestig',
    70: 'zeventig', 80: 'tachtig', 90: 'negentig' };

  // 0..100 written the Dutch way (units before tens: 25 = vijfentwintig).
  function numberToDutch(n) {
    if (n < 20) return UNITS[n];
    if (n === 100) return 'honderd';
    const tens = Math.floor(n / 10) * 10;
    const unit = n % 10;
    if (unit === 0) return TENS[tens];
    return UNITS[unit] + 'en' + TENS[tens];
  }

  // A clock time the way it is said in Dutch. Recognisers write "half drie"
  // as "2:30" (or "14:30"), so the heard text is turned back into words.
  // Only whole five-minute steps; anything else returns null.
  function timeToDutch(h, m) {
    if (h > 24 || m > 59 || m % 5 !== 0) return null;
    const hour = function (x) { const v = x % 12; return numberToDutch(v === 0 ? 12 : v); };
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
      case 55: return 'vijf voor ' + next;
    }
    return null;
  }

  // Lowercase, strip accents and punctuation, write times and digits as words.
  // Recognisers return "25" where the learner said "vijfentwintig".
  function normalize(text) {
    return String(text)
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\b(\d{1,2})[:.](\d{2})\b/g, function (all, h, m) {
        const t = timeToDutch(parseInt(h, 10), parseInt(m, 10));
        return t ? ' ' + t + ' ' : all;
      })
      .replace(/\d+/g, function (m) {
        const n = parseInt(m, 10);
        return n <= 100 ? ' ' + numberToDutch(n) + ' ' : ' ' + m + ' ';
      })
      .replace(/['’`]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function tokens(text) {
    const n = normalize(text);
    return n ? n.split(' ') : [];
  }

  // Levenshtein distance over word tokens.
  function editDistance(a, b) {
    const prev = [];
    for (let j = 0; j <= b.length; j++) prev[j] = j;
    for (let i = 1; i <= a.length; i++) {
      let diag = prev[0];
      prev[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const tmp = prev[j];
        prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
        diag = tmp;
      }
    }
    return prev[b.length];
  }

  // exact: same words after normalisation. Strings that differ only in where
  // the spaces fall also count ("dank je wel" vs "dankjewel").
  // accuracy: 1 - word error rate, floored at 0.
  function compare(target, heard) {
    const t = tokens(target);
    const h = tokens(heard);
    const exact = t.join(' ') === h.join(' ') || t.join('') === h.join('');
    const dist = exact ? 0 : editDistance(t, h);
    const accuracy = t.length ? Math.max(0, 1 - dist / t.length) : 0;
    return { exact: exact, accuracy: accuracy, target: t.join(' '), heard: h.join(' ') };
  }

  // alternatives: [{transcript, confidence}], best first as the recogniser returned them.
  function scoreAttempt(target, alternatives) {
    if (!alternatives || !alternatives.length) {
      return { exact: false, anyExact: false, accuracy: 0, heard: '' };
    }
    const top = compare(target, alternatives[0].transcript);
    const anyExact = alternatives.some(function (a) { return compare(target, a.transcript).exact; });
    return { exact: top.exact, anyExact: anyExact, accuracy: top.accuracy, heard: alternatives[0].transcript };
  }

  // items: [{target, attempts: [{alternatives, error}]}]
  // The pass criterion uses the FIRST attempt and the TOP alternative only.
  function summarize(items) {
    const done = items.filter(function (it) { return it.attempts && it.attempts.length; });
    let firstExact = 0, bestExact = 0, anyAltExact = 0, accSum = 0, noResult = 0;
    const errors = {};
    done.forEach(function (it) {
      const scores = it.attempts.map(function (a) { return scoreAttempt(it.target, a.alternatives); });
      if (scores[0].exact) firstExact++;
      if (scores[0].anyExact) anyAltExact++;
      if (scores.some(function (s) { return s.exact; })) bestExact++;
      accSum += scores[0].accuracy;
      it.attempts.forEach(function (a) {
        if (a.error) errors[a.error] = (errors[a.error] || 0) + 1;
      });
      if (!it.attempts[0].alternatives || !it.attempts[0].alternatives.length) noResult++;
    });
    const n = done.length;
    return {
      total: items.length,
      done: n,
      firstExact: firstExact,
      firstExactRate: n ? firstExact / n : 0,
      anyAlternativeExact: anyAltExact,
      bestOfAttemptsExact: bestExact,
      meanWordAccuracy: n ? accSum / n : 0,
      firstAttemptNoResult: noResult,
      errors: errors
    };
  }

  const api = { numberToDutch: numberToDutch, timeToDutch: timeToDutch, normalize: normalize, tokens: tokens,
    editDistance: editDistance, compare: compare, scoreAttempt: scoreAttempt, summarize: summarize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Scoring = api;
})(typeof self !== 'undefined' ? self : this);
