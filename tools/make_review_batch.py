#!/usr/bin/env python3
"""Builds the human review batch for a unit: the rows Sander actually looks at.

Usage:
  python3 tools/make_review_batch.py content u03 \
      --flags review/checker_flags_u03.json \
      --reviewed u01 u02 \
      --sample 12 --out review/batch_u03.csv

Selection, per the review process (review/review_process.md):
  word cards      all                      (32% correction rate in the pilot)
  grammar note    all (reviewed as text, listed here as one row)
  dialogue        all lines and questions  (showcase of the unit; cheap)
  sentences       checker flags + a seeded random sample
                  drawn from the NEW-TEMPLATE pool only

A sentence's template is its sequence of lexicon entry ids (names folded to
NAME). A sentence whose template already occurred in a reviewed unit is
excluded from the sample pool: "Ik woon in Utrecht" after "Ik woon in
Amsterdam" is the same template and near-zero risk. Early units have mostly
new templates; the pool shrinks as the course grows, and the sample with it.

The sample is seeded with the unit id, so the same command always picks the
same rows: the batch is reproducible and auditable. The sample doubles as a
quality measurement: errors found in it estimate the unit's true error rate,
which drives the escalation rule.
"""
import argparse
import collections
import json
import pathlib
import random
import sys
import csv

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import validate_content as vc  # noqa: E402  (nl_tokens, load)

HEADER = ["Why", "Lesson", "Dutch", "Spanish", "OK?", "Corrected Dutch", "Corrected Spanish",
          "Comment", "Also accepted (Spanish)", "Also accepted (Dutch)", "Type", "ID"]


def build_matcher(lexicon):
    """token-sequence -> lexicon entry ids, longest match first; names -> NAME."""
    names = {n.lower() for n in lexicon.get("names", [])}
    patterns = []
    for e in lexicon["entries"]:
        for form in e["forms"]:
            toks = tuple(vc.nl_tokens(form))
            if toks:
                patterns.append((toks, e["id"]))
    patterns.sort(key=lambda p: -len(p[0]))

    def template(nl):
        toks = vc.nl_tokens(nl)
        out, i = [], 0
        while i < len(toks):
            if toks[i] in names:
                out.append("NAME"); i += 1; continue
            for pat, eid in patterns:
                if tuple(toks[i:i + len(pat)]) == pat:
                    out.append(eid); i += len(pat); break
            else:
                out.append(toks[i]); i += 1
        return " ".join(out)
    return template


def unit_sentences(unit):
    for lesson in unit["lessons"]:
        for s in lesson["sentences"]:
            yield lesson["id"], s


def select(lexicon, units, unit_id, reviewed_ids, flags, sample_n, seed=None):
    template = build_matcher(lexicon)
    unit = next(u for u in units if u["id"] == unit_id)
    seen = {template(s["nl"]) for u in units if u["id"] in reviewed_ids for _, s in unit_sentences(u)}

    flag_by_id = collections.defaultdict(list)
    for f in flags:
        flag_by_id[f["id"]].append(f)

    intro = {}
    for e in lexicon["entries"]:
        first = min(e["forms"].values())
        intro.setdefault(first, []).append(e)

    rows, stats = [], collections.Counter()

    def row(why, lesson, kind, ident, nl, es, alt_es="", alt_nl=""):
        rows.append([why, lesson, nl, es, "", "", "", "", alt_es, alt_nl, kind, ident])

    # word cards: all
    for lesson in unit["lessons"]:
        for e in intro.get(lesson["id"], []):
            dutch = (e["article"] + " " if e.get("article") else "") + e["nl"]
            forms = ", ".join(e["forms"])
            if forms.lower() != e["nl"].lower():
                dutch += f"  ({forms})"
            spanish = ", ".join(e["es"]) + (f"  [{e['note_es']}]" if e.get("note_es") else "")
            why = "word card" + ("; " + flag_by_id["lexicon:" + e["id"]][0]["reason"] if flag_by_id.get("lexicon:" + e["id"]) else "")
            row(why, lesson["id"], "word", e["id"], dutch, spanish,
                " | ".join(e.get("accept_es", [])), " | ".join(e.get("accept_nl", [])))
            stats["word"] += 1

    # grammar note: one row pointing at the text
    gflags = flag_by_id.get(f"{unit_id}:grammar", [])
    row("grammar note" + ("; FLAG: " + gflags[0]["reason"] if gflags else ""),
        unit_id, "grammar", f"{unit_id}:grammar",
        "(lee la nota completa en el archivo de notas)", unit.get("title_es", ""))
    stats["grammar"] += 1

    # sentences: flags + seeded sample from the new-template pool
    pool, flagged = [], []
    for lid, s in unit_sentences(unit):
        fl = flag_by_id.get(s["id"], [])
        if fl:
            flagged.append((lid, s, fl))
        elif template(s["nl"]) not in seen:
            pool.append((lid, s))
        else:
            stats["template_repeat"] += 1
    rng = random.Random(seed if seed is not None else unit_id)
    sample = rng.sample(pool, min(sample_n, len(pool)))
    sample_ids = {s["id"] for _, s in sample}
    for lid, s in unit_sentences(unit):
        fl = flag_by_id.get(s["id"], [])
        if fl:
            why = "FLAG " + "; ".join(f"[{f['severity']}] {f['reason']}" for f in fl)
            stats["flagged"] += 1
        elif s["id"] in sample_ids:
            why = "sample"
            stats["sample"] += 1
        else:
            continue
        row(why, lid, "sentence", s["id"], s["nl"], s["es"],
            " | ".join(s.get("alt_es", [])), " | ".join(s.get("alt_nl", [])))

    # dialogue: all
    dlg = unit["dialogue"]
    for i, line in enumerate(dlg["lines"], 1):
        fl = flag_by_id.get(f"{unit_id}:dialogue:{i}", [])
        why = "dialogue" + ("; FLAG: " + fl[0]["reason"] if fl else "")
        row(why, unit_id + " dialogue", "dialogue", f"{unit_id}d{i:02d}",
            f"{line['speaker']}: {line['nl']}", line["es"])
        stats["dialogue"] += 1
    for i, q in enumerate(dlg["questions"], 1):
        fl = flag_by_id.get(f"{unit_id}:dialogue:q{i}", [])
        opts = " / ".join(("✔ " if j == q["answer"] else "") + o for j, o in enumerate(q["options_es"]))
        row("question" + ("; FLAG: " + fl[0]["reason"] if fl else ""),
            unit_id + " dialogue", "question", f"{unit_id}q{i:02d}", "", q["q_es"], opts)
        stats["question"] += 1

    stats["total_sentences"] = sum(1 for _ in unit_sentences(unit))
    stats["rows"] = len(rows)
    return rows, stats


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("content_dir")
    ap.add_argument("unit")
    ap.add_argument("--flags", help="checker flags JSON")
    ap.add_argument("--reviewed", nargs="*", default=[], help="unit ids already human-reviewed")
    ap.add_argument("--sample", type=int, default=12)
    ap.add_argument("--seed", default=None, help="sample seed (default: the unit id)")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    lexicon, units = vc.load(pathlib.Path(args.content_dir))
    flags = []
    if args.flags:
        flags = json.loads(pathlib.Path(args.flags).read_text(encoding="utf-8"))["flags"]
    rows, stats = select(lexicon, units, args.unit, set(args.reviewed), flags, args.sample, args.seed)

    out = pathlib.Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(HEADER)
        w.writerows(rows)
    sent_h = stats["flagged"] + stats["sample"]
    print(f"{stats['rows']} rows -> {out}")
    print(f"  words {stats['word']}, grammar 1, dialogue {stats['dialogue']}, questions {stats['question']}, "
          f"sentences {sent_h} of {stats['total_sentences']} "
          f"(flagged {stats['flagged']}, sample {stats['sample']}, template repeats excluded {stats['template_repeat']})")


if __name__ == "__main__":
    main()
