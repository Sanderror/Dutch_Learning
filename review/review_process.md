# Review process for units 3 to 60

Decided 14 November 2026, from the measured pilot (units 1 and 2). Replaces
row-by-row review of everything.

## Why it changes

Full review measured 13.4 s/row, 26 min/unit, which is ~25 hours for the
remaining 58 units. The corrections were not where the time went:

| Row type | Reviewed | Corrected | Share |
|---|---|---|---|
| Word cards | 63 | 20 | 32% |
| Sentences | 148 | 5 | 3% |
| Dialogue lines | 15 | 1 | 7% |

Zero sentences had wrong Dutch or a wrong Spanish meaning; the sentence
corrections were phrasing preference and missing accepted answers.

## Who checks what

Three checkers with different blind spots, each assigned what it is best at:

1. **The validator** (mechanical, free, every batch): vocabulary gate, de/het,
   Spanish articles on noun glosses, length caps, ¿/¡, vosotros, duplicate and
   structural errors. Proven by mutation test (21/21 injected mistakes caught).
2. **An independent checker agent** (free, every batch): a fresh Claude context
   that has not seen the generation session reviews the unit JSON against
   `tools/review_rubric.md` and writes flags. On units 1 and 2 — content that
   had already passed Sander's full review — it found 8 real issues, including
   a false rule in a grammar note ("el verbo va primero", wrong for the
   wh-questions taught in the same unit) and a sentence that contradicted the
   just-taught pronoun rule. Its limits, also measured: it self-reported
   reviewing 140 of 150 sentences, so its coverage is not trusted; and 0 of
   Sander's 26 corrections would have come from its flags — the two reviewers
   catch different classes. It proposes, never decides: two of its flags
   contradicted Sander's own corrections and were held for him, not applied.
3. **Sander** (expensive, 13.4 s/row): judgment the machines cannot give —
   Dutch naturalness, Venezuelan Spanish, his own curriculum taste.

Her in-app report button (from Phase 2) is the designated catcher for the
cheap error class: a correct answer the checker rejects. Missing accepted
answers were 14 of the 26 pilot corrections; they cost one tap in use and are
the explicit reason sentences are sampled rather than read in full.

## The batch Sander reviews per unit

Built by `tools/make_review_batch.py` (tested in `tools/test_review_batch.py`):

| Tier | Rows | Why |
|---|---|---|
| Word cards | all (~30) | 32% pilot correction rate; highest yield |
| Grammar note | all (1 text) | an error here multiplies into every later unit |
| Dialogue + questions | all (~11) | the unit's showcase; cheap |
| Sentences: checker flags | ~2-4 | judgment issues found free |
| Sentences: seeded random sample | 12 | coverage of what everything else misses, and a measurement |

The sample is drawn only from sentences whose **template** (sequence of lexicon
entries, names folded) has not been human-reviewed before: "Ik woon in
Utrecht" after "Ik woon in Amsterdam" is the same template and near-zero risk.
Zero cross-unit repeats exist in units 1-2 (expected this early); the pool
shrinks as the course grows, so review falls where risk falls. The seed is the
unit id: the same command always builds the same batch, so the selection is
auditable.

**~57 rows instead of ~117 per unit: about 13 min/unit, ~12.5 h for the
course instead of 25.**

## Propagation rule

When Sander corrects any row, every row containing the corrected entry or
phrase is re-checked at apply time and listed in the apply log; rows whose
meaning changed go back into his next batch. This is not optional polish — in
the pilot it is what caught "Fijne dag!" sentences after he corrected the
fijne-dag word card.

## Retrodiction: would this process have caught the pilot corrections?

Replayed on units 1 and 2 with the real checker flags and the default seed
(114 batch rows vs 234 full):

- All 12 of his "Change" rows: 10 in the batch by construction (9 word cards,
  1 dialogue line), 2 via the propagation rule (fijne-dag sentences).
- The 14 accepted-answer additions: 11 on word cards (by construction),
  3 on sentences — this seed happened to sample 2 of them; in general these
  are class (c) and fall to the report loop by design.
- Nothing he corrected would have been lost; 2 of 26 would have arrived one
  step later (at apply time) rather than in the sheet.

## Escalation and de-escalation (measured, not assumed)

The 12-sentence sample doubles as the unit's quality measurement:

- **Any severity-a error** (wrong Dutch, wrong meaning, false grammar claim)
  found by Sander in the sample → full sentence review of that unit, plus a
  generation rule and a rubric addition so the class of error is caught free
  next time.
- **3 or more severity-b** in one unit's sample → full sentence review of
  that unit.
- **Word cards de-escalate:** after 3 consecutive units with a word-card
  correction rate under 5%, word cards drop to a sample of 10; any a-error in
  that sample puts them back to full for 3 units. (Projected steady state:
  ~8 min/unit.)
- Units 1-2 were the easiest material; harder grammar (word order, separable
  verbs, perfect tense) from section 3 onward is exactly when escalation is
  expected to fire. The thresholds are there to make that visible, not to
  assume it away.

## Open disagreements for Sander (and her)

1. **"ten un buen día"** — Sander's correction; the checker calls it an
   English calque no Venezuelan would produce and prefers "¡Que tengas un buen
   día!" / "¡Feliz día!". Kept as Sander set it; her judgment settles it.
2. **"hoi" accepted as a farewell for doei** — Sander's addition; the checker
   says hoi is a greeting ("hoi hoi" as farewell is kept either way). Kept as
   Sander set it; he decides.
3. **"leven" removed from wonen's accepted answers** — this one was applied
   against Sander's addition, because accepting it trains "Ik leef in
   Amsterdam"; the vivir = wonen/leven split now sits in the word card's note
   instead. Revert if he disagrees.
