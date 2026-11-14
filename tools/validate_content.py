#!/usr/bin/env python3
"""Checks course content before a human reviews it.

Usage:  python3 tools/validate_content.py [content_dir] [--json report.json]

Errors block a unit; warnings are for the reviewer to look at.

Checks
  structure   required fields, unique ids, lesson ids match their unit
  gate        every Dutch word in a sentence is a form taught in that lesson or
              earlier (lexicon forms + the names list)
  load        at most MAX_NEW_WORDS new lexicon entries per lesson, and each new
              entry is used in at least MIN_USES_IN_LESSON sentences of that lesson
  length      sentence length cap per section
  articles    de/het before a noun agrees with the lexicon; noun glosses carry el/la
  spanish     opening ¿ ¡ present, no vosotros forms
  duplicates  the same Dutch sentence taught twice as "new"
  recurrence  how often each word comes back after it is introduced (report)
"""
import argparse
import collections
import json
import pathlib
import re
import sys
import unicodedata

MAX_NEW_WORDS = 6
MIN_USES_IN_LESSON = 2
LENGTH_CAP = {1: 8, 2: 9, 3: 10, 4: 11, 5: 12, 6: 12}   # words per sentence, by section
DIALOGUE_LINE_CAP = 12
MIN_RECURRENCE = 3          # warning threshold: sentences containing the word, whole course so far
VOSOTROS = re.compile(r"\b(vosotr[oa]s|vuestr[oa]s?|os|sois|estáis|habéis|\w+[áé]is)\b", re.IGNORECASE)
SPANISH_ARTICLE = re.compile(r"^(el|la|los|las|lo)\s", re.IGNORECASE)
WORD = re.compile(r"[^\W\d_]+(?:'[^\W\d_]+)?", re.UNICODE)


def nl_tokens(text):
    return [t.lower() for t in WORD.findall(text)]


def fold(text):
    """Lowercase, no accents, no punctuation: for duplicate detection."""
    t = unicodedata.normalize("NFD", text.lower())
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return " ".join(WORD.findall(t))


class Report:
    def __init__(self):
        self.errors = []      # (where, check, message)
        self.warnings = []

    def error(self, where, check, msg):
        self.errors.append((where, check, msg))

    def warn(self, where, check, msg):
        self.warnings.append((where, check, msg))


def load(content_dir):
    lexicon = json.loads((content_dir / "lexicon.json").read_text(encoding="utf-8"))
    units = [json.loads(p.read_text(encoding="utf-8")) for p in sorted((content_dir / "units").glob("u*.json"))]
    return lexicon, units


def validate(lexicon, units):
    rep = Report()
    names = {n.lower() for n in lexicon.get("names", [])}

    lesson_order = [les["id"] for u in units for les in u["lessons"]]
    lesson_index = {lid: i for i, lid in enumerate(lesson_order)}
    if len(lesson_index) != len(lesson_order):
        rep.error("course", "structure", "duplicate lesson ids")

    # --- lexicon: which forms and which entries become available in which lesson
    forms_by_lesson = collections.defaultdict(set)     # lesson id -> single-word tokens
    entry_intro = {}                                   # entry id -> lesson id
    noun_article = {}                                  # token -> (article, is_plural)
    entry_patterns = {}                                # entry id -> list of token tuples
    seen_ids = set()
    for e in lexicon["entries"]:
        where = "lexicon:" + e.get("id", "?")
        for field in ("id", "nl", "pos", "es", "forms"):
            if not e.get(field):
                rep.error(where, "structure", f"missing {field}")
        if e["id"] in seen_ids:
            rep.error(where, "structure", "duplicate entry id")
        seen_ids.add(e["id"])
        intros = []
        patterns = []
        for form, lid in e["forms"].items():
            if lid not in lesson_index:
                rep.error(where, "structure", f"form '{form}' points to unknown lesson {lid}")
                continue
            toks = nl_tokens(form)
            patterns.append(tuple(toks))
            for t in toks:
                forms_by_lesson[lid].add(t)
            intros.append(lesson_index[lid])
        if intros:
            entry_intro[e["id"]] = lesson_order[min(intros)]
        entry_patterns[e["id"]] = patterns
        if e.get("pos") == "noun":
            if e.get("article") not in ("de", "het"):
                rep.error(where, "articles", "noun without article de/het")
            else:
                plurals = {p.lower() for p in e.get("plural_forms", [])}
                for form in e["forms"]:
                    toks = nl_tokens(form)
                    if len(toks) == 1:
                        is_plural = toks[0] in plurals
                        noun_article[toks[0]] = ("de" if is_plural else e["article"], is_plural)

    new_entries = collections.defaultdict(list)
    for eid, lid in entry_intro.items():
        new_entries[lid].append(eid)

    def contains(tokens, pattern):
        n = len(pattern)
        return any(tuple(tokens[i:i + n]) == pattern for i in range(len(tokens) - n + 1))

    def entries_in(tokens):
        return {eid for eid, pats in entry_patterns.items() if any(contains(tokens, p) for p in pats)}

    def check_spanish(where, text):
        if not text or not text.strip():
            rep.error(where, "spanish", "empty Spanish text")
            return
        if "?" in text and "¿" not in text:
            rep.error(where, "spanish", "question without opening ¿")
        if "!" in text and "¡" not in text:
            rep.error(where, "spanish", "exclamation without opening ¡")
        m = VOSOTROS.search(text)
        if m:
            rep.error(where, "spanish", f"vosotros form '{m.group(0)}'")

    # Word cards: Spanish glosses and accepted answers.
    # Review of units 1-2: a noun shown with de/het needs its Spanish article too.
    for e in lexicon["entries"]:
        where = "lexicon:" + e.get("id", "?")
        for g in e.get("es", []) + e.get("accept_es", []):
            check_spanish(where, g)
        if e.get("pos") == "noun":
            bare = [g for g in e.get("es", []) if not SPANISH_ARTICLE.match(g)]
            if bare:
                rep.error(where, "articles", f"Spanish gloss without article: {', '.join(bare)}")
        for field, main in (("accept_es", e.get("es", [])), ("accept_nl", [e.get("nl", "")] + list(e.get("forms", {})))):
            dup = [a for a in e.get(field, []) if fold(a) in {fold(m) for m in main}]
            if dup:
                rep.error(where, "structure", f"{field} repeats a main form: {', '.join(dup)}")

    def check_articles(where, tokens):
        for i, tok in enumerate(tokens[:-1]):
            if tok in ("de", "het") and tokens[i + 1] in noun_article:
                want, _ = noun_article[tokens[i + 1]]
                if tok != want:
                    rep.error(where, "articles", f"'{tok} {tokens[i + 1]}' should be '{want} {tokens[i + 1]}'")

    known = set()                                  # tokens taught so far
    seen_sentences = {}                            # folded nl -> sentence id
    seen_sentence_ids = set()
    occurrences = collections.Counter()            # entry id -> sentences containing it
    per_sentence = []                              # (id, list of error checks) for the pass rate
    stats = {"units": len(units), "lessons": 0, "sentences": 0, "dialogue_lines": 0,
             "new_words_per_lesson": {}}

    for unit in units:
        uid = unit.get("id", "?")
        for field in ("id", "section", "title_es", "goals_es", "grammar_note_es", "lessons", "dialogue"):
            if not unit.get(field):
                rep.error(uid, "structure", f"missing {field}")
        cap = LENGTH_CAP.get(unit.get("section"), 12)
        check_spanish(uid + ":title", unit.get("title_es", ""))
        for g in unit.get("goals_es", []):
            check_spanish(uid + ":goals", g)
        # Grammar notes quote Dutch examples ("Ben jij Tom?"), so the ¿ ¡ check does not apply.
        m = VOSOTROS.search(unit.get("grammar_note_es", ""))
        if m:
            rep.error(uid + ":grammar", "spanish", f"vosotros form '{m.group(0)}'")

        for lesson in unit["lessons"]:
            lid = lesson["id"]
            stats["lessons"] += 1
            if not lid.startswith(uid):
                rep.error(lid, "structure", "lesson id does not start with unit id")
            check_spanish(lid + ":title", lesson.get("title_es", ""))
            known |= forms_by_lesson[lid]
            fresh = sorted(new_entries[lid])
            stats["new_words_per_lesson"][lid] = len(fresh)
            if len(fresh) > MAX_NEW_WORDS:
                rep.error(lid, "load", f"{len(fresh)} new words (max {MAX_NEW_WORDS}): {', '.join(fresh)}")
            if not fresh:
                rep.warn(lid, "load", "lesson introduces no new words")

            uses = collections.Counter()
            for s in lesson["sentences"]:
                sid = s.get("id", "?")
                before = len(rep.errors)
                stats["sentences"] += 1
                for field in ("id", "nl", "es"):
                    if not s.get(field):
                        rep.error(sid, "structure", f"missing {field}")
                if sid in seen_sentence_ids:
                    rep.error(sid, "structure", "duplicate sentence id")
                seen_sentence_ids.add(sid)
                if not sid.startswith(lid):
                    rep.error(sid, "structure", "sentence id does not start with lesson id")
                toks = nl_tokens(s.get("nl", ""))
                unknown = [t for t in toks if t not in known and t not in names]
                if unknown:
                    rep.error(sid, "gate", f"not taught yet: {', '.join(sorted(set(unknown)))}  [{s['nl']}]")
                if len(toks) > cap:
                    rep.error(sid, "length", f"{len(toks)} words (cap {cap})  [{s['nl']}]")
                if s.get("nl") and s["nl"].strip()[-1] not in ".!?":
                    rep.error(sid, "structure", "Dutch sentence without final punctuation")
                check_articles(sid, toks)
                check_spanish(sid, s.get("es", ""))
                for alt in s.get("alt_es", []):
                    check_spanish(sid + ":alt_es", alt)
                    if fold(alt) == fold(s.get("es", "")):
                        rep.error(sid, "structure", f"alt_es repeats the main translation: {alt}")
                for alt in s.get("alt_nl", []):
                    if fold(alt) == fold(s.get("nl", "")):
                        rep.error(sid, "structure", f"alt_nl repeats the main sentence: {alt}")
                    # No gate on accepted answers: accepting a correct word she was
                    # not taught (hoi for hallo) is not teaching it.
                key = fold(s.get("nl", ""))
                if key in seen_sentences:
                    rep.error(sid, "duplicates", f"same Dutch sentence as {seen_sentences[key]}  [{s['nl']}]")
                else:
                    seen_sentences[key] = sid
                found = entries_in(toks)
                for eid in found:
                    occurrences[eid] += 1
                    uses[eid] += 1
                per_sentence.append((sid, [c for _, c, _ in rep.errors[before:]]))

            for eid in fresh:
                if uses[eid] == 0:
                    rep.error(lid, "load", f"new word '{eid}' is not used in its own lesson")
                elif uses[eid] < MIN_USES_IN_LESSON:
                    rep.warn(lid, "load", f"new word '{eid}' appears in only {uses[eid]} sentence of its lesson")

        dlg = unit.get("dialogue") or {}
        check_spanish(uid + ":dialogue:title", dlg.get("title_es", ""))
        for i, line in enumerate(dlg.get("lines", []), 1):
            where = f"{uid}:dialogue:{i}"
            stats["dialogue_lines"] += 1
            toks = nl_tokens(line.get("nl", ""))
            unknown = [t for t in toks if t not in known and t not in names]
            if unknown:
                rep.error(where, "gate", f"not taught yet: {', '.join(sorted(set(unknown)))}  [{line.get('nl')}]")
            if len(toks) > DIALOGUE_LINE_CAP:
                rep.error(where, "length", f"{len(toks)} words (cap {DIALOGUE_LINE_CAP})")
            if line.get("speaker", "").lower() not in names:
                rep.error(where, "structure", f"speaker '{line.get('speaker')}' is not in the names list")
            check_articles(where, toks)
            check_spanish(where, line.get("es", ""))
            for eid in entries_in(toks):
                occurrences[eid] += 1
        for i, q in enumerate(dlg.get("questions", []), 1):
            where = f"{uid}:dialogue:q{i}"
            check_spanish(where, q.get("q_es", ""))
            opts = q.get("options_es", [])
            if len(opts) < 2 or not isinstance(q.get("answer"), int) or not 0 <= q["answer"] < len(opts):
                rep.error(where, "structure", "answer index outside the options")
            if len(set(opts)) != len(opts):
                rep.error(where, "structure", "duplicate options")

    # --- recurrence: informative until the following units exist
    for eid in sorted(entry_intro, key=lambda e: (lesson_index[entry_intro[e]], e)):
        if occurrences[eid] < MIN_RECURRENCE:
            rep.warn("lexicon:" + eid, "recurrence",
                     f"appears in {occurrences[eid]} sentence(s) so far (introduced {entry_intro[eid]})")

    clean = sum(1 for _, errs in per_sentence if not errs)
    stats["sentences_clean"] = clean
    stats["sentence_pass_rate"] = clean / len(per_sentence) if per_sentence else 0.0
    stats["lexicon_entries"] = len(entry_intro)
    stats["occurrences"] = dict(occurrences)
    return rep, stats


def validate_course(course, units, rep):
    """The course index must list exactly the unit files, in order, and give
    every dialogue speaker a voice. The app and the audio build trust it."""
    listed = course.get("units", [])
    present = [u["id"] for u in units]
    if listed != present:
        rep.error("course", "structure", f"course.json lists {listed} but the unit files are {present}")
    sections = {s.get("id") for s in course.get("sections", [])}
    voices = course.get("voices", {})
    speakers = course.get("speakers", {})
    for name, v in speakers.items():
        if v not in voices:
            rep.error("course", "structure", f"speaker {name} uses unknown voice '{v}'")
    for u in units:
        if u.get("section") not in sections:
            rep.error(u["id"], "structure", f"section {u.get('section')} is not in course.json")
        for i, line in enumerate(u.get("dialogue", {}).get("lines", []), 1):
            if line.get("speaker") not in speakers:
                rep.error(f"{u['id']}:dialogue:{i}", "structure",
                          f"speaker '{line.get('speaker')}' has no voice in course.json")


def load_course(content_dir):
    return json.loads((pathlib.Path(content_dir) / "course.json").read_text(encoding="utf-8"))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("content_dir", nargs="?", default="content")
    ap.add_argument("--json", help="write the full report to this file")
    args = ap.parse_args()

    lexicon, units = load(pathlib.Path(args.content_dir))
    rep, stats = validate(lexicon, units)
    validate_course(load_course(args.content_dir), units, rep)

    for label, rows in (("ERROR", rep.errors), ("warn ", rep.warnings)):
        for where, check, msg in rows:
            print(f"{label}  {check:<10} {where:<22} {msg}")
    per_lesson = stats["new_words_per_lesson"]
    print()
    print(f"units {stats['units']}, lessons {stats['lessons']}, sentences {stats['sentences']}, "
          f"dialogue lines {stats['dialogue_lines']}, lexicon entries {stats['lexicon_entries']}")
    if per_lesson:
        print(f"new words per lesson: min {min(per_lesson.values())}, max {max(per_lesson.values())}, "
              f"mean {sum(per_lesson.values()) / len(per_lesson):.1f}")
    print(f"sentences without errors: {stats['sentences_clean']}/{stats['sentences']} "
          f"({stats['sentence_pass_rate']:.0%})")
    print(f"errors {len(rep.errors)}, warnings {len(rep.warnings)}")

    if args.json:
        pathlib.Path(args.json).write_text(json.dumps({
            "stats": stats,
            "errors": [dict(where=w, check=c, message=m) for w, c, m in rep.errors],
            "warnings": [dict(where=w, check=c, message=m) for w, c, m in rep.warnings],
        }, ensure_ascii=False, indent=2), encoding="utf-8")
    return 1 if rep.errors else 0


if __name__ == "__main__":
    sys.exit(main())
