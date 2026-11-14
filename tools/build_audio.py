#!/usr/bin/env python3
"""Generates the course audio: one file per Dutch string, only for what is new.

Usage:
  GOOGLE_TTS_API_KEY=... python3 tools/build_audio.py [content_dir] [audio_dir]
  python3 tools/build_audio.py --dry-run          # what would be made; needs no key

What gets a recording
  word cards       "de naam", "hallo"          always the female voice
  sentences        every lesson sentence       female and male alternate
  dialogue lines   keyed "@Speaker|text"       the speaker's voice from course.json

A file is named after a hash of voice and text, so a text that has not changed
is never synthesised twice, and files can be cached for ever by the app.
audio/index.json maps each key to its file; it is written last, so a run that
fails half-way leaves the previous index in place and the next run resumes.
Files nothing refers to any more are deleted.
"""
import hashlib
import json
import os
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import tts_bakeoff as tts  # noqa: E402  (call, synthesize, explain, ApiError)

WORD_VOICE = "F"
EXTENSIONS = ("mp3", "ogg")


def collect(content_dir):
    """-> (voices, {key: (voice_letter, text)}) for everything the app can play."""
    content_dir = pathlib.Path(content_dir)
    course = json.loads((content_dir / "course.json").read_text(encoding="utf-8"))
    lexicon = json.loads((content_dir / "lexicon.json").read_text(encoding="utf-8"))
    letters = sorted(course["voices"])
    items = {}
    for e in lexicon["entries"]:
        text = (e["article"] + " " if e.get("article") else "") + e["nl"]
        items[text] = (WORD_VOICE, text)
    for uid in course["units"]:
        unit = json.loads((content_dir / "units" / f"{uid}.json").read_text(encoding="utf-8"))
        for lesson in unit["lessons"]:
            for s in lesson["sentences"]:
                # stable alternation: depends only on the text, not on its position
                pick = int(hashlib.sha1(s["nl"].encode("utf-8")).hexdigest(), 16) % len(letters)
                items.setdefault(s["nl"], (letters[pick], s["nl"]))
        for line in unit["dialogue"]["lines"]:
            items["@" + line["speaker"] + "|" + line["nl"]] = (course["speakers"][line["speaker"]], line["nl"])
    return course["voices"], items


def stem(voice_name, text):
    return hashlib.sha1((voice_name + "|" + text).encode("utf-8")).hexdigest()[:16]


def existing(audio_dir, name):
    for ext in EXTENSIONS:
        p = audio_dir / f"{name}.{ext}"
        if p.exists() and p.stat().st_size > 0:
            return p.name
    return None


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    dry = "--dry-run" in sys.argv
    content_dir = pathlib.Path(args[0] if args else "content")
    audio_dir = pathlib.Path(args[1] if len(args) > 1 else "audio")
    voices, items = collect(content_dir)
    if "--keys" in sys.argv:          # for the app's tests: the keys must match what the app asks for
        print(json.dumps(sorted(items), ensure_ascii=False))
        return 0

    todo, files = [], {}
    for key, (letter, text) in sorted(items.items()):
        name = stem(voices[letter], text)
        have = existing(audio_dir, name) if audio_dir.exists() else None
        if have:
            files[key] = have
        else:
            todo.append((key, letter, text, name))
    chars = sum(len(t) for _, _, t, _ in todo)
    print(f"{len(items)} recordings needed, {len(files)} already there, {len(todo)} to make ({chars} characters)")
    if dry:
        by_voice = {}
        for _, (letter, _) in items.items():
            by_voice[letter] = by_voice.get(letter, 0) + 1
        print("dry run; per voice:", by_voice, "; total characters:", sum(len(t) for _, t in items.values()))
        return 0

    key = os.environ.get("GOOGLE_TTS_API_KEY", "").strip()
    if todo and not key:
        sys.exit("GOOGLE_TTS_API_KEY is empty. Add it under Settings, Secrets and variables, Actions.")
    audio_dir.mkdir(parents=True, exist_ok=True)
    made = {}                       # two keys can share one recording (same voice, same text)
    for k, letter, text, name in todo:
        if name not in made:
            try:
                data, ext = tts.synthesize(key, voices[letter], text)
            except tts.ApiError as e:
                sys.exit(f"Failed on \"{text}\" ({voices[letter]}).\n  " + tts.explain(e) +
                         "\n  Files made so far are kept; the index is unchanged. Run again to continue.")
            made[name] = f"{name}.{ext}"
            (audio_dir / made[name]).write_bytes(data)
        files[k] = made[name]

    keep = set(files.values())
    removed = 0
    for p in audio_dir.iterdir():
        if p.suffix.lstrip(".") in EXTENSIONS and p.name not in keep:
            p.unlink()
            removed += 1
    index = {"version": 1, "voices": voices, "files": dict(sorted(files.items()))}
    (audio_dir / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    size = sum((audio_dir / f).stat().st_size for f in keep)
    print(f"made {len(made)}, removed {removed} unused, {len(keep)} files, {size / 1e6:.2f} MB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
