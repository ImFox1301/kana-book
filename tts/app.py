"""Озвучка слов через VOICEVOX CORE для своих слов в словаре.

GET /api/tts?v=m|f&t=<кана>[&k=<запись иероглифами>]  → audio/mpeg
GET /api/tts/health                                    → ok

- t — слово каной (хирагана, катакана, ー), до 30 знаков; k — необязательная запись с иероглифами для верного
  ударения: используется, только если её чтение совпадает с t (иначе синтез идёт по кане).
- Готовые файлы кэшируются на диске (CACHE_DIR) и в браузере (адрес однозначно определяет звук).
- Новые синтезы ограничены по частоте с одного адреса (RATE_PER_MIN); из кэша отдаётся без ограничений.
"""
import hashlib
import io
import json
import os
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import lameenc
import numpy as np
import soundfile as sf
from voicevox_core.blocking import Onnxruntime, OpenJtalk, Synthesizer, VoiceModelFile

VV = Path(os.environ.get("VOICEVOX_DIR", "/opt/voicevox"))
CACHE = Path(os.environ.get("CACHE_DIR", "/cache"))
RATE_PER_MIN = int(os.environ.get("RATE_PER_MIN", "30"))
VOICES = {"m": ("15.vvm", 13), "f": ("3.vvm", 9)}     # VOICEVOX:青山龍星, VOICEVOX:波音リツ
VERSION = "2"                                         # меняется при смене голоса или настроек — новый кэш

KANA = re.compile(r"^[ぁ-ゖァ-ヺーー]{1,30}$")
KANJI_TEXT = re.compile(r"^[ぁ-ゖァ-ヺー々一-鿿]{1,30}$")

ort = Onnxruntime.load_once(filename=str(next(VV.glob("voicevox_onnxruntime-*/lib/libvoicevox_onnxruntime.so.*"))))
syn = Synthesizer(ort, OpenJtalk(str(next(VV.glob("open_jtalk_dic_utf_8-*")))), cpu_num_threads=2)
for vvm, _ in VOICES.values():
    with VoiceModelFile.open(str(VV / "vvms" / vvm)) as m:
        syn.load_voice_model(m)
lock = threading.Lock()


def moras(aq):
    t = "".join(m.text for ap in aq.accent_phrases for m in ap.moras)
    return re.sub(r"([エケセテネヘメレゲゼデベペ])イ", r"\1エ", t)   # «えい» = долгое «ээ»


def natural_vowels(aq):
    """Голос 青山龍星 растягивает подряд идущие гласные (いいえ звучало как «и… и… э»): ограничиваем
    длительность слогов без согласного естественной величиной — как у женского голоса."""
    ms = [m for ap in aq.accent_phrases for m in ap.moras]
    for i, m in enumerate(ms):
        if m.consonant is None and m.vowel in "aiueo":
            m.vowel_length = min(m.vowel_length, 0.24 if i == len(ms) - 1 else 0.13)
    return aq


def synth(kana, kanji, style):
    with lock:
        aq = plain = syn.create_audio_query(kana, style)
        if kanji:
            alt = syn.create_audio_query(kanji, style)
            if moras(alt) == moras(plain):
                aq = alt
        natural_vowels(aq)
        aq.speed_scale = 0.9
        aq.pre_phoneme_length, aq.post_phoneme_length = 0.06, 0.20
        wav = syn.synthesis(aq, style)
    x, sr = sf.read(io.BytesIO(wav), dtype="float64")
    rms = np.sqrt(np.mean(x[np.abs(x) > np.abs(x).max() * 0.05] ** 2))
    x = x * (0.12 / rms)
    if np.abs(x).max() > 0.95: x *= 0.95 / np.abs(x).max()
    fo = int(sr * 0.04); x[-fo:] *= np.linspace(1, 0, fo) ** 2
    enc = lameenc.Encoder()
    enc.set_bit_rate(64); enc.set_in_sample_rate(sr); enc.set_channels(1); enc.set_quality(2)
    return enc.encode((x * 32767).astype("<i2").tobytes()) + enc.flush()


hits = {}
def allowed(ip):
    now = time.time()
    start, n = hits.get(ip, (now, 0))
    if now - start > 60: start, n = now, 0
    if n >= RATE_PER_MIN: return False
    hits[ip] = (start, n + 1)
    if len(hits) > 10000:
        for k in [k for k, (s, _) in hits.items() if now - s > 60]: hits.pop(k, None)
    return True


class Handler(BaseHTTPRequestHandler):
    server_version = "kana-tts"

    def send(self, code, body, ctype="application/json; charset=utf-8", cache=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        if cache: self.send_header("Cache-Control", cache)
        self.end_headers()
        if self.command != "HEAD": self.wfile.write(body)

    def error(self, code, msg):
        self.send(code, json.dumps({"error": msg}, ensure_ascii=False).encode())

    def do_HEAD(self): self.do_GET()

    def do_GET(self):
        u = urlparse(self.path)
        if u.path == "/api/tts/health":
            return self.send(200, b'{"status":"ok"}')
        if u.path != "/api/tts":
            return self.error(404, "Нет такого адреса")
        q = parse_qs(u.query)
        voice = (q.get("v") or ["m"])[0]
        kana = (q.get("t") or [""])[0].strip()
        kanji = (q.get("k") or [""])[0].strip()
        if voice not in VOICES: return self.error(400, "Голос: m или f")
        if not KANA.match(kana): return self.error(400, "Слово должно быть записано каной, до 30 знаков")
        if kanji and not KANJI_TEXT.match(kanji): kanji = ""
        key = hashlib.sha256(f"{VERSION}|{voice}|{kana}|{kanji}".encode()).hexdigest()
        path = CACHE / voice / key[:2] / f"{key}.mp3"
        if not path.exists():
            ip = self.headers.get("X-Forwarded-For", self.client_address[0]).split(",")[0].strip()
            if not allowed(ip): return self.error(429, "Слишком много новых слов подряд, попробуйте через минуту")
            try:
                mp3 = synth(kana, kanji, VOICES[voice][1])
            except Exception as e:
                return self.error(500, "Не получилось озвучить слово")
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(".tmp"); tmp.write_bytes(mp3); tmp.replace(path)
        self.send(200, path.read_bytes(), "audio/mpeg", "public, max-age=31536000, immutable")

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    CACHE.mkdir(parents=True, exist_ok=True)
    port = int(os.environ.get("PORT", "8081"))
    print(f"kana-tts: порт {port}, голоса {', '.join(VOICES)}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
