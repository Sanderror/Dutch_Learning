#!/usr/bin/env python3
"""Does the validator actually catch mistakes?

Takes the real content, breaks it in one specific way at a time, and checks
that the matching error is reported. A validator that passes everything proves
nothing, so this is the evidence that a clean run means something.

Run: python3 tools/test_validator.py
"""
import copy
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import validate_content as vc  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent / "content"
LEXICON, UNITS = vc.load(ROOT)


def run(mutate):
    lex, units = copy.deepcopy(LEXICON), copy.deepcopy(UNITS)
    mutate(lex, units)
    rep, _ = vc.validate(lex, units)
    return rep


def sentence(units, sid):
    for u in units:
        for les in u["lessons"]:
            for s in les["sentences"]:
                if s["id"] == sid:
                    return s
    raise KeyError(sid)


def lesson(units, lid):
    return next(les for u in units for les in u["lessons"] if les["id"] == lid)


CASES = []


def case(name, check, where_part):
    def deco(fn):
        CASES.append((name, check, where_part, fn))
        return fn
    return deco


@case("word used before it is taught", "gate", "u01l1s02")
def _(lex, units):
    sentence(units, "u01l1s02")["nl"] = "Ik heet Anna."          # heet arrives in lesson 3


@case("word that is in no lesson at all", "gate", "u02l3s01")
def _(lex, units):
    sentence(units, "u02l3s01")["nl"] = "Ik spreek vloeiend Spaans."


@case("form of a known verb that is not taught yet", "gate", "u01l1s06")
def _(lex, units):
    sentence(units, "u01l1s06")["nl"] = "Jij bent Emma."          # jij/bent arrive in lesson 2


@case("untaught word inside a dialogue", "gate", "u01:dialogue:1")
def _(lex, units):
    units[0]["dialogue"]["lines"][0]["nl"] = "Hallo! Ik kom uit Venezuela."


@case("sentence longer than the section cap", "length", "u02l5s11")
def _(lex, units):
    sentence(units, "u02l5s11")["nl"] = "Ik kom uit Venezuela, maar ik woon nu ook in Nederland."


@case("wrong article before a noun", "articles", "u02l6s01")
def _(lex, units):
    sentence(units, "u02l6s01")["nl"] = "Dit is het vriend."


@case("vosotros verb form", "spanish", "u01l2s03")
def _(lex, units):
    sentence(units, "u01l2s03")["es"] = "¿Quiénes sois?"


@case("vosotros pronoun in an accepted answer", "spanish", "u02l2s02")
def _(lex, units):
    sentence(units, "u02l2s02")["alt_es"].append("¿Dónde vivís vosotros?")


@case("Spanish question without opening mark", "spanish", "u01l3s01")
def _(lex, units):
    sentence(units, "u01l3s01")["es"] = "Cómo te llamas?"


@case("empty Spanish translation", "spanish", "u01l4s02")
def _(lex, units):
    sentence(units, "u01l4s02")["es"] = " "


@case("same Dutch sentence taught twice", "duplicates", "u01l3s03")
def _(lex, units):
    sentence(units, "u01l3s03")["nl"] = "Ik ben Anna."            # already u01l1s02


@case("too many new words in one lesson", "load", "u01l1")
def _(lex, units):
    for e in lex["entries"]:
        if e["id"] in ("jij", "wie"):
            e["forms"] = {k: "u01l1" for k in e["forms"]}


@case("new word never used in its lesson", "load", "u02l4")
def _(lex, units):
    lex["entries"].append({"id": "wij", "nl": "wij", "pos": "pron", "es": ["nosotros"], "forms": {"wij": "u02l4"}})


@case("noun without an article in the lexicon", "articles", "lexicon:naam")
def _(lex, units):
    next(e for e in lex["entries"] if e["id"] == "naam").pop("article")


@case("lexicon form pointing to a lesson that does not exist", "structure", "lexicon:hallo")
def _(lex, units):
    next(e for e in lex["entries"] if e["id"] == "hallo")["forms"]["hallo"] = "u09l9"


@case("accepted answer that only repeats the main one", "structure", "u01l1s02")
def _(lex, units):
    sentence(units, "u01l1s02")["alt_es"].append("soy anna")


@case("dialogue answer index out of range", "structure", "u02:dialogue:q1")
def _(lex, units):
    units[1]["dialogue"]["questions"][0]["answer"] = 3


@case("duplicate sentence id", "structure", "u01l1s01")
def _(lex, units):
    lesson(units, "u01l1")["sentences"][1]["id"] = "u01l1s01"


def main():
    base, _ = vc.validate(copy.deepcopy(LEXICON), copy.deepcopy(UNITS))
    assert not base.errors, f"unmodified content should be clean, got {base.errors[:3]}"
    print("ok    unmodified content has no errors")
    failed = 0
    for name, check, where_part, fn in CASES:
        rep = run(fn)
        hit = [e for e in rep.errors if e[1] == check and where_part in e[0]]
        if hit:
            print(f"ok    {name}  ->  {hit[0][1]}: {hit[0][2][:70]}")
        else:
            failed += 1
            print(f"FAIL  {name}: expected a '{check}' error at {where_part}; got {rep.errors[:3]}")
    print(f"\n{len(CASES) - failed}/{len(CASES)} injected mistakes caught")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
