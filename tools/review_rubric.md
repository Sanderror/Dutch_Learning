# Checker rubric: Dutch-from-Spanish course content

You are reviewing machine-generated course content before a human reviewer sees
it. The course teaches Dutch (Netherlands) to a Venezuelan Spanish speaker,
starting from zero. You have not seen how the content was written and must not
assume it is correct. Your job is to flag rows a human must look at; the human
review budget is small, so a flood of weak flags makes the process useless.
Flag what you can defend, skip what you cannot.

## Input

- `content/lexicon.json`: every taught Dutch form, with Spanish glosses
  (`es`), accepted alternatives (`accept_es`, `accept_nl`) and the lesson where
  each form first appears.
- `content/units/uNN.json`: lessons with sentences (`nl`, `es`, accepted
  alternatives `alt_nl`, `alt_es`), a grammar note in Spanish
  (`grammar_note_es`), and a dialogue with comprehension questions.

Mechanical rules (vocabulary gate, de/het consistency, sentence length,
¿/¡, vosotros forms) are already checked by a validator. Do not re-check
those. Your value is judgment.

## What to check, per sentence and dialogue line

1. **Dutch naturalness.** Is this what a Dutch speaker would actually say,
   not merely grammatical? ("Ik leef in Amsterdam" is grammatical and wrong.)
2. **Meaning equivalence.** Does the Spanish mean what the Dutch means, in
   both directions? Watch false friends and scope ("algo" vs "un poco").
3. **Register match.** Informal Dutch (je/jij) must pair with tú forms;
   u with usted forms.
4. **Venezuelan Spanish.** Latin American, Venezuelan where it differs:
   tú + ustedes, chao, chévere; no vosotros, no distinción, no Spain-only
   idioms. Flag Spain-flavoured phrasing even when understandable.
5. **Accepted answers.** Would a reasonable correct answer from the learner
   be rejected? Think of: Spanish word-order variants (¿Tú cómo te llamas?),
   synonyms (allá/allí/ahí), optional subject pronouns, both meanings of an
   ambiguous Dutch word. Flag only likely answers, not exhaustive lists.
6. **Pedagogy.** Does the sentence quietly use a construction the learner
   has not been taught and cannot parse from the gloss? Is a gloss misleading
   for how the word is used in this very sentence?

## Grammar notes

7. Is every claim in the grammar note true of standard Netherlands Dutch?
   Are the examples consistent with the rule stated? Is the Spanish of the
   explanation itself correct and Latin American? An error here multiplies:
   it teaches a wrong rule once and corrupts every later exercise.

## Dialogues

8. Natural turn-taking, consistent speakers, answers to the comprehension
   questions unambiguous and actually in the text.

## Severity

- **a**: wrong Dutch, wrong meaning, wrong grammar claim, or an exercise that
  marks a correct learner answer wrong while teaching. Must be fixed before
  the learner sees it.
- **b**: unnatural or Spain-flavoured phrasing, misleading gloss, weak
  example. Should be fixed, not urgent.
- **c**: missing accepted answer. Cheap to fix later through the in-app
  report loop; flag only clear cases.

## Output

Write JSON to the path you are given:

```json
{
  "checker": "model or session identifier",
  "flags": [
    {"id": "u02l3s04", "severity": "a", "reason": "…", "suggestion": "…"}
  ]
}
```

`id` is the sentence id, dialogue line id (unit + line number, e.g. "u01:dialogue:3"),
question id ("u01:dialogue:q2"), lexicon entry id ("lexicon:doei"), or
"uNN:grammar" for a grammar note. One flag per issue. An empty `flags` list is
a valid and useful result: it means you checked and found nothing, not that
you skipped the work.
