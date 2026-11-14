#!/usr/bin/env python3
"""Runs tools/build_audio.py against a local mock of the Text-to-Speech API.

Run: python3 tools/test_build_audio.py
"""
import base64
import http.server
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import threading

ROOT = pathlib.Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "tools" / "build_audio.py"
KEY = "AIza-test-key"
STATE = {"calls": [], "fail_after": None}


class Mock(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def reply(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if self.headers.get("X-Goog-Api-Key") != KEY:
            return self.reply(400, {"error": {"message": "API key not valid. Please pass a valid API key."}})
        if STATE["fail_after"] is not None and len(STATE["calls"]) >= STATE["fail_after"]:
            return self.reply(429, {"error": {"message": "Quota exceeded for quota metric"}})
        STATE["calls"].append((body["voice"]["name"], body["input"]["text"]))
        payload = f"{body['voice']['name']}|{body['input']['text']}".encode()
        self.reply(200, {"audioContent": base64.b64encode(payload).decode()})


server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Mock)
threading.Thread(target=server.serve_forever, daemon=True).start()
PORT = server.server_address[1]
n = 0


def ok(name):
    global n
    n += 1
    print("ok  " + name)


def run(work, key=KEY, extra=()):
    STATE["calls"] = []
    env = dict(os.environ, GOOGLE_TTS_API_KEY=key, TTS_API_BASE=f"http://127.0.0.1:{PORT}")
    return subprocess.run([sys.executable, str(SCRIPT), str(work / "content"), str(work / "audio"), *extra],
                          env=env, capture_output=True, text=True)


work = pathlib.Path(tempfile.mkdtemp())
shutil.copytree(ROOT / "content", work / "content")
course = json.loads((work / "content" / "course.json").read_text())
F, G = course["voices"]["F"], course["voices"]["G"]

# 1. dry run needs no key and writes nothing
p = run(work, key="", extra=("--dry-run",))
assert p.returncode == 0 and "dry run" in p.stdout, p.stderr
assert not (work / "audio").exists()
ok("dry run: no key needed, nothing written: " + p.stdout.strip().splitlines()[0])

# 2. first build
p = run(work)
assert p.returncode == 0, p.stderr
index = json.loads((work / "audio" / "index.json").read_text())
files = index["files"]
first_calls = list(STATE["calls"])
assert len(first_calls) == len(set(files.values())), "one API call per file"
for key_, fname in files.items():
    assert (work / "audio" / fname).exists(), key_
voice_of = lambda k: (work / "audio" / files[k]).read_text().split("|")[0]
text_of = lambda k: (work / "audio" / files[k]).read_text().split("|", 1)[1]
assert voice_of("de naam") == F and text_of("de naam") == "de naam", "word cards: article included, female voice"
assert voice_of("hallo") == F
assert voice_of("@Luis|Hallo, Emma. Ik heet Luis.") == G and text_of("@Luis|Hallo, Emma. Ik heet Luis.") == "Hallo, Emma. Ik heet Luis."
assert voice_of("@Emma|Doei, fijne dag!") == F
sentence_voices = {voice_of(k) for k in files if not k.startswith("@") and " " in k and k[0].isupper()}
assert sentence_voices == {F, G}, "sentences use both voices"
lex = json.loads((work / "content" / "lexicon.json").read_text())
units = [json.loads(q.read_text()) for q in sorted((work / "content" / "units").glob("u*.json"))]
for u in units:
    for lesson in u["lessons"]:
        for s in lesson["sentences"]:
            assert s["nl"] in files, s["nl"]
    for line in u["dialogue"]["lines"]:
        assert "@" + line["speaker"] + "|" + line["nl"] in files
for e in lex["entries"]:
    assert ((e["article"] + " ") if e.get("article") else "") + e["nl"] in files
ok(f"first build: {len(files)} keys, {len(set(files.values()))} files; words, sentences and dialogue lines all covered")
ok("voices: words female, dialogue by speaker, sentences alternate")

# 3. second build: nothing to do
p = run(work)
assert p.returncode == 0 and STATE["calls"] == [], STATE["calls"]
assert json.loads((work / "audio" / "index.json").read_text()) == index
ok("second build makes no API calls and leaves the index unchanged")

# 4. one sentence changes: one new recording, the old one is removed
u1 = work / "content" / "units" / "u01.json"
d = json.loads(u1.read_text())
old = d["lessons"][0]["sentences"][0]["nl"]
old_file = files[old]
d["lessons"][0]["sentences"][0]["nl"] = "Hallo daar!"
u1.write_text(json.dumps(d, ensure_ascii=False))
p = run(work)
assert p.returncode == 0, p.stderr
assert [t for _, t in STATE["calls"]] == ["Hallo daar!"], STATE["calls"]
files2 = json.loads((work / "audio" / "index.json").read_text())["files"]
assert "Hallo daar!" in files2 and old not in files2
assert not (work / "audio" / old_file).exists(), "unused file removed"
ok("changed sentence: exactly one new recording, the unused file is deleted")

# 5. failure half-way: files kept, index untouched, the next run resumes
shutil.rmtree(work / "audio")
STATE["fail_after"] = 20
p = run(work)
assert p.returncode != 0 and "Run again to continue" in p.stderr, p.stderr
assert KEY not in p.stderr and KEY not in p.stdout
assert not (work / "audio" / "index.json").exists()
kept = len(list((work / "audio").glob("*.mp3")))
assert kept == 20, kept
STATE["fail_after"] = None
p = run(work)
assert p.returncode == 0, p.stderr
assert len(STATE["calls"]) == len(set(files2.values())) - 20, "only the missing ones are requested"
ok("failure after 20 files: stops with a clear message, then resumes without redoing them")

# 6. no key
shutil.rmtree(work / "audio")
p = run(work, key="")
assert p.returncode != 0 and "GOOGLE_TTS_API_KEY is empty" in p.stderr
ok("missing secret: clear message")

server.shutdown()
print(f"\n{n} checks passed")
