# Dutch-from-Spanish learning app: Phase 0

Three tests that settle the open questions in the build plan before the app itself is built.

**Results (14 November 2026):** speech recognition passes for sentences (28 of 30); voices nl-NL-Wavenet-F and -G chosen;
units 1 and 2 reviewed, with corrections applied (see `review/review_log_u01_u02.md`).

| Folder | What it is |
|---|---|
| `spike-a-speech/` | Installable test page: does Chrome's speech recognition understand Dutch on the Pixel? |
| `content/` | Units 1 and 2 as data: `lexicon.json` and `units/u01.json`, `units/u02.json` |
| `tools/` | Content validator, its tests, the review-table export, and the scoring tests |
| `review/` | The review table as CSV (same rows as the review sheet) and the two grammar notes |

## Spike A: speech recognition on the phone

The page must be served over https, because the microphone is blocked otherwise. GitHub Pages does that.

1. Create a public repository on GitHub and upload the contents of this folder.
2. In the repository: Settings, Pages, "Deploy from a branch", branch `main`, folder `/ (root)`.
3. On the Pixel, open `https://<your-user>.github.io/<repo>/spike-a-speech/` in Chrome.
4. Run the test once in the browser. Then install it (Chrome menu, "Add to Home screen" or "Install app") and run it again from the home-screen icon, because the installed app is what she will use.

Who reads what:

| Run | Speaker | Set | Counts for |
|---|---|---|---|
| 1 | Sander, "Hablante nativo" | 30 frases | The pass criterion: at least 27 of 30 exact on the first attempt |
| 2 | Sander | 10 palabras sueltas | Informative: can single words be checked at all? |
| 3 | Her, "Aprendiz" | 30 frases | Informative: how strict is it on a learner? |

Read each sentence once, at a normal pace. "Repetir" records a second attempt, which is reported separately and does not count towards the criterion. At the end, "Copiar resultados" puts everything on the clipboard to paste back into the chat.

What the page records per attempt: the transcript and alternatives with confidence, the time to a result, any error code, and the order of recogniser events (the diagnostic for the microphone switching on and off).

## Spike B: voice comparison

`bakeoff/strings.json` lists 20 test items (8 single words, 12 sentences) and 4 voices.
The workflow `.github/workflows/tts-bakeoff.yml` synthesises every item in every voice with
the `GOOGLE_TTS_API_KEY` repository secret, commits the audio and asks Pages to rebuild.

1. Actions tab, "Voice comparison", "Run workflow". Takes about a minute.
2. Open `https://sanderror.github.io/Dutch_Learning/bakeoff/` on the phone.
3. Rate, then "Copy results" and paste into the chat.

The voices are labelled A to D in a random order; `bakeoff/key.json` says which is which. Don't open it before rating.

## Spike C: content pilot

```
python3 tools/validate_content.py content      # checks; exit code 1 if there are errors
python3 tools/test_validator.py                # injects 18 known mistakes, expects each to be caught
python3 tools/export_review.py content review/review_u01_u02.csv
node tools/test_scoring.mjs                    # scoring logic, incl. rescoring the real Pixel runs
python3 tools/test_tts_bakeoff.py              # voice script against a mock API
```

No packages to install; Python 3.9+ and Node 18+.

### How content is stored

- `lexicon.json` lists every Dutch form the course teaches and the lesson in which it first appears (`"forms": {"ben": "u01l1", "bent": "u01l2"}`). It is the single source for "what has she been taught so far".
- A unit file holds its lessons; a lesson holds sentences with the Dutch (`nl`), the Spanish (`es`) and other answers the app should accept (`alt_nl`, `alt_es`). New words per lesson are not repeated there: they follow from the lexicon.
- `names` in the lexicon are people and places that may appear without being taught.

### What the validator enforces

| Check | Rule |
|---|---|
| gate | every Dutch word in a sentence is a form taught in that lesson or earlier |
| load | at most 6 new words per lesson; each is used in at least 2 sentences of that lesson |
| length | at most 8 words per sentence in section 1, rising to 12 by section 5 |
| articles | de/het before a noun matches the lexicon |
| spanish | opening ¿ and ¡ present; no vosotros forms |
| duplicates | no Dutch sentence is taught twice as new |
| recurrence | warning when a word has appeared in fewer than 3 sentences so far |

Known limit: the vosotros check catches the pronouns and the -áis/-éis endings, not -ís (vivís), because that ending also occurs in ordinary words such as país.
