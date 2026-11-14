// Table-driven tests for the answer checker. Run: node --test app/tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { check, clean, fold, editDistance } from '../js/checker.js';

// Dutch forms the course knows (a slice of the lexicon is enough here)
const known = new Set(['ik', 'ben', 'bent', 'is', 'jij', 'je', 'woon', 'woont', 'kom', 'komt', 'spreek', 'spreekt',
  'man', 'maan', 'zon', 'zoon', 'de', 'het', 'een', 'naam', 'niet', 'geen', 'hier', 'daar', 'goed', 'in', 'uit',
  'venezuela', 'nederland', 'nederlands', 'vriend', 'vriendin', 'mijn', 'dit', 'dat']);
const nl = { lang: 'nl', knownForms: known };
const es = { lang: 'es' };

// [given, accepted, opts, ok, kind]
const CASES = [
  // exact, case and punctuation
  ['Ik woon in Nederland.', ['Ik woon in Nederland.'], nl, true, 'exact'],
  ['ik woon in nederland', ['Ik woon in Nederland.'], nl, true, 'exact'],
  ['  Ik   woon in Nederland!! ', ['Ik woon in Nederland.'], nl, true, 'exact'],
  ['Hoe heet je', ['Hoe heet jij?', 'Hoe heet je?'], nl, true, 'exact'],
  ['¿cómo te llamas?', ['¿Cómo te llamas?'], es, true, 'exact'],
  // accents missing or extra: accepted, but flagged
  ['como te llamas', ['¿Cómo te llamas?'], es, true, 'accent'],
  ['Si, soy Anna', ['Sí, soy Anna.'], es, true, 'accent'],
  ['Ik ben Maria', ['Ik ben María.'], nl, true, 'accent'],
  ['cómo tu te llamas', ['¿Cómo te llamas?', '¿Cómo tú te llamas?'], es, true, 'accent'],
  // spacing is not a mistake
  ['dankjewel', ['Dank je wel.'], nl, true, 'exact'],
  ['dank je wel', ['Dankjewel!'], nl, true, 'exact'],
  // typos on long words are forgiven
  ['Ik kom uit Venezuala', ['Ik kom uit Venezuela.'], nl, true, 'typo'],
  ['Ik spreek Nederlans', ['Ik spreek Nederlands.'], nl, true, 'typo'],
  ['Goedemorgne', ['Goedemorgen!'], nl, true, 'typo'],                 // swapped letters
  ['penguins', ['pinguïns'], nl, true, 'typo'],                         // reported in the A1 app
  ['Buenos dias, señroa', ['Buenos días, señora.'], es, true, 'typo'],
  // ... but not when the "typo" is another Dutch word
  ['Jij woon in Nederland', ['Jij woont in Nederland.'], nl, false, 'wrong'],
  ['Dit is mijn vriend', ['Dit is mijn vriendin.'], nl, false, 'wrong'],
  ['de man', ['de maan'], nl, false, 'wrong'],
  ['Ik spreek Nederland', ['Ik spreek Nederlands.'], nl, false, 'wrong'],
  // ... and not on short words
  ['Ik bem Anna', ['Ik ben Anna.'], nl, false, 'wrong'],
  ['Het gaat goet', ['Het gaat goed.'], nl, false, 'wrong'],
  // ... and not more slips than allowed
  ['Venezuala Nederlans', ['Venezuela Nederlands'], nl, false, 'wrong'],  // 2 slips in 2 words
  ['Ik kom uit Venezuala en spreek Nederlans', ['Ik kom uit Venezuela en spreek Nederlands.'], nl, true, 'typo'],
  // Spanish: the last two letters carry grammar, so no forgiveness there
  ['Este es mi novia', ['Este es mi novio.'], es, false, 'wrong'],
  ['Ella vivo en Caracas', ['Ella vive en Caracas.'], es, false, 'wrong'],
  ['Buenas tardes, señor', ['Buenas tardes, señora.'], es, false, 'wrong'],
  ['Hablo españal', ['Hablo español.'], es, false, 'wrong'],
  ['Hablo espanol', ['Hablo español.'], es, true, 'accent'],
  ['Hablo epsañol', ['Hablo español.'], es, true, 'typo'],
  // article mistakes are named
  ['het naam', ['de naam'], nl, false, 'article'],
  ['Dat is de huis', ['Dat is het huis.'], nl, false, 'article'],
  // right words, wrong order
  ['Jij bent Tom?', ['Ben jij Tom?'], nl, false, 'wrong'],            // bent/ben differ: not just order
  ['Jij ben Tom', ['Ben jij Tom?'], nl, false, 'order'],
  ['Ik woon nu in Nederland', ['Ik woon nu in Nederland.', 'Nu woon ik in Nederland.'], nl, true, 'exact'],
  ['Ik nu woon in Nederland', ['Ik woon nu in Nederland.', 'Nu woon ik in Nederland.'], nl, false, 'order'],
  // missing or extra words
  ['met vliegtuig', ['met het vliegtuig'], nl, false, 'wrong'],        // reported in the A1 app
  ['Ik woon in', ['Ik woon in Nederland.'], nl, false, 'wrong'],
  ['Yo soy de Venezuela', ['Soy de Venezuela.'], es, false, 'wrong'],  // must be listed to be accepted
  ['Yo soy de Venezuela', ['Soy de Venezuela.', 'Yo soy de Venezuela.'], es, true, 'exact'],
  // empty
  ['', ['Hallo!'], nl, false, 'empty'],
  ['  ?! ', ['Hallo!'], nl, false, 'empty'],
];

test('answer checker: table of cases', () => {
  for (const [given, accepted, opts, ok, kind] of CASES) {
    const r = check(given, accepted, opts);
    assert.deepEqual([r.ok, r.kind], [ok, kind], `"${given}" vs ${JSON.stringify(accepted)} -> got ${r.ok}/${r.kind}`);
  }
});

test('best answer shown is the closest accepted one', () => {
  const acc = ['Soy de los Países Bajos.', 'Soy de Holanda.', 'Vengo de Holanda.'];
  assert.equal(check('Vengo de Holand', acc, es).best, 'Vengo de Holanda.');
  assert.equal(check('Soy de Holandia', acc, es).best, 'Soy de Holanda.');
  assert.equal(check('algo', acc, es).best.length > 0, true);
  assert.equal(check('hoe heet je', ['Hoe heet jij?', 'Hoe heet je?'], nl).best, 'Hoe heet je?');
});

test('normalisation helpers', () => {
  assert.equal(clean('¡Hola,   María!'), 'hola maría');
  assert.equal(fold('¡Hola,   María!'), 'hola maria');
  assert.equal(fold('Één'), 'een');
  assert.equal(clean("m'n naam"), "m'n naam");
  assert.equal(editDistance('morgen', 'morgne'), 1);
  assert.equal(editDistance('man', 'maan'), 1);
  assert.equal(editDistance('woont', 'wont'), 1);
  assert.equal(editDistance('vriend', 'vriendin'), 2);
  assert.equal(editDistance('abc', 'abc'), 0);
});
