// Test material for spike A. Plain A1 Dutch, chosen to cover the sounds that
// are hard for Spanish speakers (ui, eu, ij, sch, g, long/short vowels).
// The 30 sentences are the pass criterion; the 10 single words are
// informational (can word-level speaking exercises work at all?).
(function (root) {
  'use strict';
  const SENTENCES = [
    'Hallo, hoe gaat het?',
    'Ik heet Tom.',
    'Goedemorgen, mevrouw.',
    'Waar kom je vandaan?',
    'Ik kom uit Venezuela.',
    'Ik woon in Amsterdam.',
    'Ik spreek een beetje Nederlands.',
    'Dank je wel.',
    'Tot morgen!',
    'Dit is mijn vriendin.',
    'Ik heb twee broers.',
    'Hoe laat is het?',
    'Het is half drie.',
    'Ik drink graag koffie.',
    'Wij eten vanavond thuis.',
    'De trein is te laat.',
    'Mag ik een kopje thee?',
    'Ik ga morgen naar school.',
    'Het huis is groot.',
    'De deur is dicht.',
    'Mijn zus woont in Utrecht.',
    'Wat kost dit brood?',
    'Ik heb geen fiets.',
    'Kun je dat herhalen?',
    'Ik begrijp het niet.',
    'Het regent vandaag.',
    'Zij werkt in een ziekenhuis.',
    'Ik ben vijfentwintig jaar.',
    'Waar is het station?',
    'Fijn weekend!'
  ];
  const WORDS = ['goed', 'huis', 'deur', 'man', 'maan', 'zon', 'zoon', 'ui', 'schip', 'vriend'];
  const api = {
    sets: {
      frases: { label: '30 frases', items: SENTENCES },
      palabras: { label: '10 palabras sueltas', items: WORDS }
    }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TestItems = api;
})(typeof self !== 'undefined' ? self : this);
