// Answer checking without any AI: normalise, compare with the accepted
// answers, forgive small slips, and say what kind of mistake it was.
// Pure functions, tested in app/tests/checker.test.mjs.

/** Lowercase, drop punctuation, collapse spaces. Keeps accents. */
export function clean(text) {
  return String(text)
    .toLowerCase()
    .replace(/[’`´]/g, "'")
    .replace(/[¿?¡!.,;:"«»()…]/g, ' ')
    .replace(/\s+-\s+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** clean() plus accents removed: á -> a, ë -> e, ñ -> n. */
export function fold(text) {
  return clean(text).normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function tokens(text) {
  const c = clean(text);
  return c ? c.split(' ') : [];
}

/** Damerau-Levenshtein distance, capped: returns 2 for "2 or more". */
export function editDistance(a, b) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 1) return 2;
  const m = a.length, n = b.length;
  let prev2 = null, prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v);
    }
    prev2 = prev; prev = cur;
  }
  return Math.min(prev[n], 2);
}

/** Where two strings first differ, counted from the end of the expected one. */
function distanceFromEnd(expected, given) {
  let i = 0;
  while (i < expected.length && i < given.length && expected[i] === given[i]) i++;
  return expected.length - i;
}

const ARTICLES = new Set(['de', 'het']);
const MIN_TYPO_LENGTH = 5;

/**
 * Is `given` an acceptable slip of the pen for `expected`?
 * - only on words of 5+ letters, one edit away;
 * - Dutch: not if what she typed is itself a Dutch word the course knows
 *   (woon for woont, man for maan are real mistakes, not typos);
 * - Spanish: not if the edit touches the last two letters, because that is
 *   where Spanish keeps its grammar (novio/novia, vivo/vive, señor/señora).
 */
function isTypo(expected, given, lang, knownForms) {
  if (expected.length < MIN_TYPO_LENGTH) return false;
  if (editDistance(expected, given) !== 1) return false;
  if (lang === 'nl') return !(knownForms && knownForms.has(given));
  return distanceFromEnd(expected, given) > 2;
}

function tokenDistance(a, b) {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur.push(Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)));
    prev = cur;
  }
  return prev[n];
}

/**
 * @param {string} given      what she answered
 * @param {string[]} accepted correct answers, the main one first
 * @param {{lang: 'nl'|'es', knownForms?: Set<string>}} opts
 * @returns {{ok: boolean, kind: string, best: string}}
 *   kind: exact | accent | typo        (ok)
 *         empty | article | order | wrong   (not ok)
 *   best: the accepted answer closest to what she wrote, to show back.
 */
export function check(given, accepted, opts) {
  const lang = opts.lang;
  const g = clean(given);
  if (!g) return { ok: false, kind: 'empty', best: accepted[0] };
  const gFold = fold(given);
  const gTok = gFold.split(' ');

  // 1. exact, with or without accents; spacing differences are not mistakes
  //    (dankjewel / dank je wel)
  let accentOnly = null;
  for (const a of accepted) {
    if (clean(a) === g) return { ok: true, kind: 'exact', best: a };
    const aFold = fold(a);
    if (aFold === gFold || aFold.replace(/ /g, '') === gFold.replace(/ /g, '')) accentOnly = accentOnly || a;
  }
  if (accentOnly) {
    const spacingOnly = clean(accentOnly).replace(/ /g, '') === g.replace(/ /g, '');
    return { ok: true, kind: spacingOnly ? 'exact' : 'accent', best: accentOnly };
  }

  // 2. closest accepted answer, for feedback and for the checks below
  let best = accepted[0], bestD = Infinity;
  for (const a of accepted) {
    const d = tokenDistance(fold(a).split(' '), gTok);
    if (d < bestD) { bestD = d; best = a; }
  }

  // 3. typos: same number of words, every difference a forgivable slip
  for (const a of accepted) {
    const aTok = fold(a).split(' ');
    if (aTok.length !== gTok.length) continue;
    let slips = 0, bad = false;
    for (let i = 0; i < aTok.length; i++) {
      if (aTok[i] === gTok[i]) continue;
      if (isTypo(aTok[i], gTok[i], lang, opts.knownForms)) slips++;
      else { bad = true; break; }
    }
    const allowed = aTok.length <= 3 ? 1 : 2;
    if (!bad && slips > 0 && slips <= allowed) return { ok: true, kind: 'typo', best: a };
  }

  // 4. what kind of mistake?
  const bTok = fold(best).split(' ');
  if (lang === 'nl' && bTok.length === gTok.length) {
    const diff = bTok.map((t, i) => [t, gTok[i]]).filter(([x, y]) => x !== y);
    if (diff.length && diff.every(([x, y]) => ARTICLES.has(x) && ARTICLES.has(y))) {
      return { ok: false, kind: 'article', best };
    }
  }
  for (const a of accepted) {
    const aTok = fold(a).split(' ');
    if (aTok.length === gTok.length && [...aTok].sort().join(' ') === [...gTok].sort().join(' ')) {
      return { ok: false, kind: 'order', best: a };
    }
  }
  return { ok: false, kind: 'wrong', best };
}
