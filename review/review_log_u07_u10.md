# Review log: units 7 to 10

## Independent checker (15 November 2026)

One fresh agent per unit, each with `tools/review_rubric.md`, the unit file and the lexicon. Flags are in `review/checker_flags_u07.json` to `u10.json`. Every agent reported reading the whole unit.

| Unit | a | b | c | Main findings |
|---|---|---|---|---|
| 7 | 1 | 7 | 4 | "Dank je" without "Dank u" (the register rule again); Venezuelan "un cuarto para las cinco" should be the main form, not "las cinco menos cuarto"; "Hoe laat" and "Om hoe laat" both mean "¿a qué hora?". Every clock time checked and correct |
| 8 | 2 | 11 | 2 | The note claimed Dutch "almost never" uses is for location, which half the unit contradicts; "cuarto" is both kamer and slaapkamer; the staan/liggen/zitten rule of thumb did not match the unit's own sentences; "de huur is duur" (rent is hoog, the flat is duur) |
| 9 | 5 | 6 | 6 | The w pronunciation hint described the Belgian sound and contradicted unit 2; correct literal answers rejected ("Het regent gelukkig niet", "het is heel warm"); "gorra" is a baseball cap, not a muts |
| 10 | 1 | 6 | 3 | "kom" given as an example of the long-vowel spelling rule (it is the exception); "Wij spreken Nederlands" rejected; luisteren does not always need naar |

New generation rules from this round:

- When Spanish allows two Dutch nouns (cuarto = kamer or slaapkamer), both are accepted.
- A literal Dutch answer that the learner can build from taught words is accepted, even when the main sentence uses another word (heel warm / heet; regent niet / droog).
- Venezuelan forms are the main Spanish where they differ (un cuarto para las cinco).
- A rule in a grammar note is checked against every sentence of its own unit before it ships.

## Applied before Sander's review

All 54 flags were applied. Older word cards changed as a result: kijken (gains "ver", kijkt, kijken), welke (gains welk), boek (gains boeken). These are at the bottom of the review sheet.

## Sander's review

Sheet: https://claude.ai/artifact/7GLRyeiynriWKT9RTh6sFv (253 rows: all word cards, grammar notes, dialogues, the 28 checker-fixed sentences, a seeded sample of 12 sentences per unit, and the 3 changed older cards). Results go here once done.
