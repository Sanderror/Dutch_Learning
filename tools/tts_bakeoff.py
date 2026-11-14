#!/usr/bin/env python3
"""Spike B: synthesise every test string in every voice for a blind comparison.

Usage:  GOOGLE_TTS_API_KEY=... python3 tools/tts_bakeoff.py [bakeoff_dir]

Reads   bakeoff/strings.json  (voices + items)
Writes  bakeoff/audio/<item>-<letter>.<ext>
        bakeoff/manifest.json  what the listening page loads: items and letters, no voice names
        bakeoff/key.json       which letter is which voice (the page never loads it)

The key goes in the X-Goog-Api-Key header, so it never appears in a URL or a log.
Only the standard library is used, so the workflow needs no installs.
TTS_API_BASE overrides the endpoint; the tests point it at a local mock server.
"""
import base64
import json
import os
import pathlib
import random
import sys
import urllib.error
import urllib.request

API_BASE = os.environ.get("TTS_API_BASE", "https://texttospeech.googleapis.com/v1")
LETTERS = "ABCDEFGH"
# MP3 first; OGG_OPUS (plays in Chrome on Android) if a voice refuses MP3.
ENCODINGS = [("MP3", "mp3"), ("OGG_OPUS", "ogg")]


class ApiError(Exception):
    pass


def call(method, path, key, body=None):
    req = urllib.request.Request(
        API_BASE + path,
        data=None if body is None else json.dumps(body).encode(),
        method=method,
        headers={"X-Goog-Api-Key": key, "Content-Type": "application/json; charset=utf-8"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            return json.loads(res.read())
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            msg = json.loads(raw)["error"]["message"]
        except Exception:
            msg = raw[:300]
        raise ApiError(f"HTTP {e.code}: {msg}") from None


def explain(err):
    """Turn the common first-run failures into a plain next step."""
    text = str(err)
    hints = [
        ("API key not valid", "The secret does not hold a valid key. Copy it again from the Credentials page."),
        ("are blocked", "The key's API restriction does not include Cloud Text-to-Speech API."),
        ("has not been used in project", "The Text-to-Speech API is not enabled in the project the key belongs to."),
        ("disabled", "The Text-to-Speech API is not enabled in the project the key belongs to."),
        ("billing", "Billing is not enabled on the project."),
        ("API keys are not supported", "This API refuses API keys here; switch to a service-account key."),
        ("HTTP 401", "This API refuses API keys here; switch to a service-account key."),
    ]
    for needle, hint in hints:
        if needle.lower() in text.lower():
            return f"{text}\n  -> {hint}"
    return text


def synthesize(key, voice, text):
    lang = "-".join(voice.split("-")[:2])
    last = None
    for encoding, ext in ENCODINGS:
        try:
            res = call("POST", "/text:synthesize", key, {
                "input": {"text": text},
                "voice": {"languageCode": lang, "name": voice},
                "audioConfig": {"audioEncoding": encoding},
            })
            return base64.b64decode(res["audioContent"]), ext
        except ApiError as e:
            last = e
            if "encoding" not in str(e).lower():
                raise
    raise last


def main():
    out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "bakeoff")
    key = os.environ.get("GOOGLE_TTS_API_KEY", "").strip()
    if not key:
        sys.exit("GOOGLE_TTS_API_KEY is empty. Add it under Settings, Secrets and variables, Actions.")
    spec = json.loads((out / "strings.json").read_text(encoding="utf-8"))
    voices, items = spec["voices"], spec["items"]

    # 1. Do the voices exist? One cheap call that also proves the key works.
    try:
        listed = call("GET", "/voices?languageCode=nl-NL", key).get("voices", [])
    except ApiError as e:
        sys.exit("Could not reach Text-to-Speech.\n  " + explain(e))
    available = sorted(v["name"] for v in listed)
    print(f"key works; {len(available)} nl-NL voices available")
    missing = [v for v in voices if v not in available]
    if missing:
        sys.exit(f"Not available: {', '.join(missing)}\nAvailable nl-NL voices:\n  " + "\n  ".join(available))

    # 2. Blind letters: a random order, so the letter says nothing about the voice.
    order = voices[:]
    random.SystemRandom().shuffle(order)
    letters = {LETTERS[i]: v for i, v in enumerate(order)}

    audio_dir = out / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)
    for old in audio_dir.iterdir():
        old.unlink()

    chars = 0
    manifest_items = []
    for item in items:
        files = {}
        for letter, voice in letters.items():
            try:
                data, ext = synthesize(key, voice, item["text"])
            except ApiError as e:
                sys.exit(f"Failed on {item['id']} with voice {letter}.\n  " + explain(e))
            name = f"{item['id']}-{letter}.{ext}"
            (audio_dir / name).write_bytes(data)
            files[letter] = "audio/" + name
            chars += len(item["text"])
        manifest_items.append({"id": item["id"], "text": item["text"], "files": files})
        print(f"  {item['id']}  {item['text']}")

    (out / "manifest.json").write_text(json.dumps(
        {"letters": sorted(letters), "items": manifest_items}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (out / "key.json").write_text(json.dumps(
        {"note": "Which letter is which voice. Do not open before rating.", "letters": letters},
        indent=2) + "\n", encoding="utf-8")
    size = sum(p.stat().st_size for p in audio_dir.iterdir())
    print(f"done: {len(items)} items x {len(letters)} voices = {len(items) * len(letters)} files, "
          f"{size / 1e6:.1f} MB, {chars} characters billed")


if __name__ == "__main__":
    main()
