#!/usr/bin/env python3
"""Озвучка каны для вкладки «Азбука»: Open JTalk + голос Mei (CC BY 3.0, Nagoya Institute of Technology).

Запуск (нужен ffmpeg):
    python3 -m venv .venv && .venv/bin/pip install pyopenjtalk-plus numpy
    .venv/bin/python tools/make_audio.py

Файлы: assets/audio/<хирагана>.mp3; катакана использует те же файлы (звучание одинаковое).
"""
import re
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

import numpy as np
import pyopenjtalk

root = Path(__file__).resolve().parent.parent
out = root / "assets" / "audio"
out.mkdir(parents=True, exist_ok=True)

# все звуки из таблицы рядов в src/kana.js
kana_js = (root / "src" / "kana.js").read_text(encoding="utf-8")
sounds = []
for m in re.finditer(r"h: '([^']+)'", kana_js.split("const GROUPS")[0]):
    sounds += m.group(1).split(" ")

to_kata = lambda s: "".join(chr(ord(c) + 0x60) if "ぁ" <= c <= "ゖ" else c for c in s)
SR = 48000

for hira in sounds:
    text = to_kata(hira)                 # катакана читается как звук, без грамматических прочтений (へ → he, а не e)
    phon = pyopenjtalk.g2p(text)
    x, sr = pyopenjtalk.tts(text, speed=0.7)
    x = x.astype(np.float64)
    # обрезать тишину по краям, оставить небольшие поля
    env = np.abs(x) > np.abs(x).max() * 0.02
    idx = np.where(env)[0]
    a, b = max(0, idx[0] - int(sr * 0.03)), min(len(x), idx[-1] + int(sr * 0.08))
    x = x[a:b]
    x = x / np.abs(x).max() * 0.89 * 32767
    fade = int(sr * 0.01)
    x[:fade] *= np.linspace(0, 1, fade); x[-fade:] *= np.linspace(1, 0, fade)
    with tempfile.NamedTemporaryFile(suffix=".wav") as tmp:
        with wave.open(tmp.name, "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
            w.writeframes(x.astype("<i2").tobytes())
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", tmp.name, "-ac", "1", "-ar", "24000",
                        "-codec:a", "libmp3lame", "-b:a", "40k", str(out / f"{hira}.mp3")], check=True)
    print(f"{hira}\t{phon}\t{len(x) / sr:.2f}s", file=sys.stderr)

total = sum(p.stat().st_size for p in out.glob("*.mp3"))
print(f"{len(sounds)} файлов, {total // 1024} КБ")
