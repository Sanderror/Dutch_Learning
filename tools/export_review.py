#!/usr/bin/env python3
"""Turns the content files into one flat review table (CSV).

Usage:  python3 tools/export_review.py [content_dir] [out.csv]

One row per thing a reviewer has to judge: each new word, each sentence, each
dialogue line and question. The last four columns are for the reviewer.
"""
import csv
import json
import pathlib
import sys

# Reviewer columns sit right after the two texts, so they are in view without scrolling.
HEADER = ["Lesson", "Dutch", "Spanish", "OK?", "Corrected Dutch", "Corrected Spanish", "Comment",
          "Also accepted (Spanish)", "Also accepted (Dutch)", "Type", "ID"]


def row(lesson, kind, ident, dutch, spanish, alt_es="", alt_nl=""):
    return [lesson, dutch, spanish, "", "", "", "", alt_es, alt_nl, kind, ident]


def rows(content_dir):
    content_dir = pathlib.Path(content_dir)
    lexicon = json.loads((content_dir / "lexicon.json").read_text(encoding="utf-8"))
    intro = {}
    for e in lexicon["entries"]:
        first = min(e["forms"].values())
        intro.setdefault(first, []).append(e)
    out = []
    for path in sorted((content_dir / "units").glob("u*.json")):
        unit = json.loads(path.read_text(encoding="utf-8"))
        for lesson in unit["lessons"]:
            for e in intro.get(lesson["id"], []):
                dutch = (e["article"] + " " if e.get("article") else "") + e["nl"]
                forms = ", ".join(e["forms"])
                if forms.lower() != e["nl"].lower():
                    dutch += f"  ({forms})"
                spanish = ", ".join(e["es"]) + (f"  [{e['note_es']}]" if e.get("note_es") else "")
                out.append(row(lesson["id"], "word", e["id"], dutch, spanish))
            for s in lesson["sentences"]:
                out.append(row(lesson["id"], "sentence", s["id"], s["nl"], s["es"],
                               " | ".join(s.get("alt_es", [])), " | ".join(s.get("alt_nl", []))))
        dlg = unit["dialogue"]
        for i, line in enumerate(dlg["lines"], 1):
            out.append(row(unit["id"] + " dialogue", "dialogue", f"{unit['id']}d{i:02d}",
                           f"{line['speaker']}: {line['nl']}", line["es"]))
        for i, q in enumerate(dlg["questions"], 1):
            opts = " / ".join(("✔ " if j == q["answer"] else "") + o for j, o in enumerate(q["options_es"]))
            out.append(row(unit["id"] + " dialogue", "question", f"{unit['id']}q{i:02d}", "", q["q_es"], opts))
    return out


def main():
    content_dir = sys.argv[1] if len(sys.argv) > 1 else "content"
    out_path = sys.argv[2] if len(sys.argv) > 2 else "review/review_u01_u02.csv"
    data = rows(content_dir)
    path = pathlib.Path(out_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(HEADER)
        w.writerows(data)
    kinds = {}
    for r in data:
        kinds[r[9]] = kinds.get(r[9], 0) + 1
    print(f"{len(data)} rows -> {path}  {kinds}")


if __name__ == "__main__":
    main()
