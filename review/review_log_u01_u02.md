# Review of units 1 and 2: what changed and what it tells us

Reviewer: Sander, 14 November 2026. 232 rows, 52 minutes (13.4 seconds per row).

## Where the corrections were

Rows touched: 12 marked "Change", plus 14 more where alternatives were added in the "Also accepted" columns. 26 of 232 rows (11%).

| Row type | Rows | Touched | Share |
|---|---|---|---|
| Word cards | 63 | 20 | 32% |
| Sentences | 148 | 5 | 3% |
| Dialogue lines | 15 | 1 | 7% |
| Dialogue questions | 6 | 0 | 0% |

| Kind of correction | Rows | Fixed for the future by |
|---|---|---|
| Wrong or unnatural Dutch | 0 | |
| Spanish that means something else | 0 | |
| Noun gloss without Spanish article (el nombre) | 5 | Validator rule, now an error |
| Verb missing a singular present form (gaan: ga) | 1 | Generation rule: list ik / jij / hij forms |
| Word card incomplete (dit/deze, dat/die) | 2 | Generation rule: give the paired form |
| Spanish phrasing preference (ten un buen día) | 4 rows, 1 phrase | Style note |
| Missing accepted answers | 14 | Her in-app reports, from Phase 2 |

Nothing in the 148 sentences was wrong. All 26 changes are in word cards, accepted answers or one phrase. These are the two simplest units, though, and sentence errors will likely appear once word order, separable verbs and the perfect tense come in.

## Changes applied

- **Spanish articles on nouns:** naam, meneer, mevrouw, vriend, vriendin. The same rule was also applied to Spaans, Nederlands and Engels (el español, el neerlandés, el inglés), which were not marked. The validator now rejects a noun gloss without el/la/los/las.
- **gaan:** forms are now ga, gaat.
- **fijne dag:** "ten un buen día" is the main translation in the word card, two sentences and the unit 1 dialogue; "que tengas un buen día" and "feliz día" are accepted. "¡Ten un buen dia!" was entered in the Dutch column without the accent; it was moved to the Spanish and given the accent.
- **dit/deze, dat/die:** added as forms, with a note on when to use which. dat gained aquel, aquella, aquello.
- **Accepted answers on word cards:** new fields `accept_es` and `accept_nl` in the lexicon, filled from the review: hallo (buenas, hoi), jij/je, doei, tot ziens, tot later, wonen (leven), spreken (praten), een beetje (un poquito, un poquitito, een klein beetje), leuk (qué bien).
- **Accepted answers on sentences:** ¡Buenas! / Hoi! for Hallo!; ¿Cómo tú te llamas? for Hoe heet jij/je?

## Decided without asking; please confirm

1. **mijn: "mij" not added.** "mij" is the object pronoun (me, mí). The spoken short form of mijn is written "m'n". If you meant "m'n", say so and I'll add it.
2. **"un pocquito" spelled "un poquito"**, and likewise "un poquitito".
3. **"¿Cómo tu te llamas?" stored as "¿Cómo tú te llamas?"** The checker ignores accents, so she is not marked wrong for leaving the accent off.
4. **Two new sentences in lesson u02l4** so that deze and die appear in a sentence, not only on the word card. Not reviewed yet:
   - Deze meneer heet Daan. / Este señor se llama Daan.
   - Die mevrouw woont in Utrecht. / Esa señora vive en Utrecht. (also accepted: Aquella señora…)
5. **leven and praten accepted only on the word card.** For "vivir" and "hablar" alone they are correct, but "Ik leef in Amsterdam" is not what a Dutch speaker says, so they are not accepted in sentences.

## Validator

- New: noun glosses must carry a Spanish article; accepted answers on word cards get the same Spanish checks as sentences and may not repeat a main form.
- Removed: the warning for accepted Dutch answers containing untaught words. Accepting a correct word she wasn't taught (hoi) is not teaching it.
- Mutation test: 21 of 21 injected mistakes caught (was 18; 3 new cases for the new rules).
