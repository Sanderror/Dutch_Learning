# Review log: units 3 to 6

## Independent checker (15 November 2026)

One fresh agent per unit, each with `tools/review_rubric.md`, the unit file and the lexicon. Flags are in `review/checker_flags_u03.json` to `u06.json`. Every agent reported reading the whole unit (all sentences, word cards, dialogue lines and the grammar note).

| Unit | a | b | c | Notes |
|---|---|---|---|---|
| 3 | 0 | 5 | 2 | je instead of jouw where nothing is contrasted; één spelling is the course's choice, not a rule; phone numbers are often read in pairs |
| 4 | 0 | 3 | 2 | dialogue: je je instead of je jouw, "is in jouw jas", "Heel goed" as a reaction |
| 5 | 8 | 4 | 4 | the 8 a-flags are one class: Spanish "por favor" does not say jij or u, so the other form must be accepted |
| 6 | 0 | 11 | 1 | stress hints in the grammar note, je/jouw, mij/jou as objects, glosses of schat and ouders |

The class behind the 8 a-flags is new and general: when the Spanish does not mark register (por favor, muchas gracias), both Dutch forms are correct answers. Generation rule from now on: every sentence with alsjeblieft/alstublieft or dank je/dank u gets the other form in `alt_nl` unless the Spanish marks the register (señor, usted).

## Applied before Sander's review

All 40 flags were applied, two in part:

- u03l6s10 "Is dit jouw nummer?" keeps jouw: asking whose number it is, jouw is natural. A new sentence with a real contrast was added ("Dit is mijn nummer. Wat is jouw nummer?"), and the other jouw sentences now use je, with jouw accepted.
- u06l6s02 "Ik mis jou, schat." keeps jou (to a partner the stress fits); "Ik mis je, schat." is accepted, and the jou word card now covers object use.

Other changes outside units 3 to 6: the notes on the jou (unit 1) and mij (unit 4) word cards now cover object use, and mij gained the form "me". `tools/make_review_batch.py` now shows every grammar-note flag, not only the first.

## Sander's review

Sheet: https://claude.ai/artifact/4igg1US1J4KBfusCKvqyFB (252 rows: all word cards, grammar notes, dialogues, the 24 checker-fixed sentences, and a seeded sample of 12 sentences per unit). Results go here once done.
