#!/usr/bin/env python3
"""Runs tools/tts_bakeoff.py against a local mock of the Text-to-Speech API.

Checks the happy path and the first-run failures the workflow is most likely to
hit, without spending anything. Run: python3 tools/test_tts_bakeoff.py
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
SCRIPT = ROOT / "tools" / "tts_bakeoff.py"
GOOD_KEY = "AIza-test-key"
VOICES = ["nl-NL-Chirp3-HD-Aoede", "nl-NL-Chirp3-HD-Charon", "nl-NL-Wavenet-F", "nl-NL-Wavenet-G"]
STATE = {"mode": "ok", "requests": []}


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

    def auth_ok(self):
        STATE["requests"].append({"path": self.path, "key_in_header": self.headers.get("X-Goog-Api-Key")})
        if self.headers.get("X-Goog-Api-Key") != GOOD_KEY:
            self.reply(400, {"error": {"message": "API key not valid. Please pass a valid API key."}})
            return False
        if STATE["mode"] == "blocked":
            self.reply(403, {"error": {"message": "Requests to this API texttospeech method are blocked."}})
            return False
        return True

    def do_GET(self):
        if not self.auth_ok():
            return
        names = VOICES if STATE["mode"] != "missing" else VOICES[:3]
        self.reply(200, {"voices": [{"name": n, "languageCodes": ["nl-NL"]} for n in names]})

    def do_POST(self):
        if not self.auth_ok():
            return
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        enc = body["audioConfig"]["audioEncoding"]
        if STATE["mode"] == "no-mp3" and "Chirp3" in body["voice"]["name"] and enc == "MP3":
            self.reply(400, {"error": {"message": "Unsupported audio encoding MP3 for this voice."}})
            return
        assert body["voice"]["languageCode"] == "nl-NL", body
        payload = f"{enc}|{body['voice']['name']}|{body['input']['text']}".encode()
        self.reply(200, {"audioContent": base64.b64encode(payload).decode()})


def run(mode, key=GOOD_KEY):
    STATE["mode"], STATE["requests"] = mode, []
    work = pathlib.Path(tempfile.mkdtemp())
    shutil.copy(ROOT / "bakeoff" / "strings.json", work / "strings.json")
    env = dict(os.environ, GOOGLE_TTS_API_KEY=key, TTS_API_BASE=f"http://127.0.0.1:{PORT}")
    p = subprocess.run([sys.executable, str(SCRIPT), str(work)], env=env, capture_output=True, text=True)
    return p, work


server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Mock)
PORT = server.server_address[1]
threading.Thread(target=server.serve_forever, daemon=True).start()
n = 0


def ok(name):
    global n
    n += 1
    print("ok  " + name)


# 1. Happy path
p, work = run("ok")
assert p.returncode == 0, p.stderr
man = json.loads((work / "manifest.json").read_text())
key = json.loads((work / "key.json").read_text())["letters"]
assert man["letters"] == ["A", "B", "C", "D"]
assert len(man["items"]) == 20 and all(len(it["files"]) == 4 for it in man["items"])
assert sorted(key.values()) == sorted(VOICES)
assert "Chirp3" not in (work / "manifest.json").read_text(), "manifest must not reveal voices"
for it in man["items"]:
    for letter, f in it["files"].items():
        content = (work / f).read_bytes().decode()
        assert content == f"MP3|{key[letter]}|{it['text']}", content
assert len(list((work / "audio").iterdir())) == 80
assert all(r["key_in_header"] == GOOD_KEY and GOOD_KEY not in r["path"] for r in STATE["requests"])
assert "characters billed" in p.stdout
ok("20 items x 4 voices written; each file is the right voice and text; manifest hides voice names")
ok("key sent only in the header, never in a URL")

# 2. Letters are shuffled between runs (not a fixed order an observer could learn)
orders = {tuple(json.loads((run("ok")[1] / "key.json").read_text())["letters"].values()) for _ in range(8)}
assert len(orders) > 1
ok(f"letter order is random ({len(orders)} different orders in 8 runs)")

# 3. A voice that refuses MP3 falls back to OGG_OPUS
p, work = run("no-mp3")
assert p.returncode == 0, p.stderr
man = json.loads((work / "manifest.json").read_text())
exts = {f.rsplit(".", 1)[1] for it in man["items"] for f in it["files"].values()}
assert exts == {"mp3", "ogg"}, exts
ok("voice refusing MP3 falls back to OGG_OPUS")

# 4. First-run failures give a plain next step and exit non-zero
cases = [
    ("ok", "wrong-key", "not hold a valid key"),
    ("blocked", GOOD_KEY, "API restriction does not include"),
    ("missing", GOOD_KEY, "Not available: nl-NL-Wavenet-G"),
]
for mode, k, expect in cases:
    p, _ = run(mode, k)
    assert p.returncode != 0 and expect in p.stderr, (mode, p.stderr)
    assert k not in p.stderr and k not in p.stdout, "key leaked into output"
    ok(f"{mode if k == GOOD_KEY else 'bad key'} -> clear message, no key in output")

p, _ = run("ok", "")
assert p.returncode != 0 and "GOOGLE_TTS_API_KEY is empty" in p.stderr
ok("missing secret -> clear message")

server.shutdown()
print(f"\n{n} checks passed")
