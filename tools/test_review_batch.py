#!/usr/bin/env python3
"""Does the batch tool select what the process says it should?

Run: python3 tools/test_review_batch.py
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import validate_content as vc  # noqa: E402
import make_review_batch as mb  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent / "content"
LEX, UNITS = vc.load(ROOT)
n = 0


def ok(name):
    global n
    n += 1
    print("ok  " + name)


def ids(rows, kind):
    return [r[11] for r in rows if r[10] == kind]


template = mb.build_matcher(LEX)

# templates: names fold, same pattern matches, different pattern does not
assert template("Ik ben Anna.") == template("Ik ben Emma.")
assert template("Ik ben Anna.") != template("Jij bent Anna.")
assert template("Tot morgen!") != template("Tot morgen, Tom!")  # the extra NAME differs
# multi-word forms collapse to one entry id
assert "tot-ziens" in template("Tot ziens, meneer Jansen.")
ok("templates fold names and multi-word forms")

# all word cards and all dialogue rows are always selected
rows, stats = mb.select(LEX, UNITS, "u02", set(), [], sample_n=12)
intro_u02 = {e["id"] for e in LEX["entries"] if min(e["forms"].values()).startswith("u02")}
assert set(ids(rows, "word")) == intro_u02, set(ids(rows, "word")) ^ intro_u02
assert len(ids(rows, "dialogue")) == 8 and len(ids(rows, "question")) == 3
assert ids(rows, "grammar") == ["u02:grammar"]
ok("word cards, grammar note and dialogue always in the batch")

# flags are always included, and marked
flags = [{"id": "u02l5s13", "severity": "a", "reason": "test reason", "suggestion": ""}]
rows, stats = mb.select(LEX, UNITS, "u02", set(), flags, sample_n=0)
assert ids(rows, "sentence") == ["u02l5s13"]
why = next(r[0] for r in rows if r[11] == "u02l5s13")
assert "FLAG" in why and "test reason" in why
ok("flagged sentence included even with sample 0, reason visible")

# sample: deterministic under the same seed, bounded by sample_n
r1, s1 = mb.select(LEX, UNITS, "u02", set(), [], sample_n=12, seed="x")
r2, s2 = mb.select(LEX, UNITS, "u02", set(), [], sample_n=12, seed="x")
r3, s3 = mb.select(LEX, UNITS, "u02", set(), [], sample_n=12, seed="y")
assert ids(r1, "sentence") == ids(r2, "sentence")
assert s1["sample"] == 12
assert ids(r1, "sentence") != ids(r3, "sentence")
ok("sample is seeded and reproducible")

# template exclusion: a unit reviewed against itself leaves an empty pool
rows, stats = mb.select(LEX, UNITS, "u02", {"u01", "u02"}, [], sample_n=12)
assert stats["sample"] == 0
assert stats["template_repeat"] == stats["total_sentences"]
ok("sentences whose template was already reviewed leave the sample pool")

# accounting: every sentence is flagged, sampled, pool-unsampled or a repeat
rows, stats = mb.select(LEX, UNITS, "u02", {"u01"}, flags, sample_n=5)
assert stats["flagged"] == 1
assert stats["flagged"] + stats["sample"] <= stats["total_sentences"]
assert stats["rows"] == stats["word"] + 1 + stats["dialogue"] + stats["question"] + stats["flagged"] + stats["sample"]
ok("row accounting adds up")

print(f"\n{n} checks passed")
