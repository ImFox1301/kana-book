#!/usr/bin/env python3
"""Озвучка каны для вкладки «Азбука»: нейросетевой синтез Kokoro-82M (Apache-2.0), офлайн.

Голоса: m — jm_kumo (мужской), f — jf_alpha (женский).

Подготовка (нужен ffmpeg):
    python3 -m venv .venv && .venv/bin/pip install kokoro-onnx "misaki[ja]" soundfile numpy
    mkdir -p .models && cd .models
    curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
    curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
Запуск:
    .venv/bin/python tools/make_audio.py .models

Результат: assets/audio/<голос>/<хирагана>.mp3. Катакана использует те же файлы — звучание одинаковое.
Каждый файл проверяется: нет обрыва в начале и в конце, нет провала громкости внутри слога.
Если проверка не прошла, синтез повторяется с немного другой скоростью.
"""
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro
from misaki import ja

models = Path(sys.argv[1] if len(sys.argv) > 1 else ".models")
root = Path(__file__).resolve().parent.parent
VOICES = {"m": ("jm_kumo", 0.80), "f": ("jf_alpha", 0.85)}

kana_js = (root / "src" / "kana.js").read_text(encoding="utf-8").split("const GROUPS")[0]
sounds = [k for m in re.finditer(r"h: '([^']+)'", kana_js) for k in m.group(1).split(" ")]
to_kata = lambda s: "".join(chr(ord(c) + 0x60) if "ぁ" <= c <= "ゖ" else c for c in s)

g2p = ja.JAG2P()
def phonemes(hira):
    # сочетания собираем сами: misaki читает みょ/りょ/ぎょ как «ми-ё»
    if len(hira) == 2 and hira[1] in "ゃゅょ":
        base = phonemes(hira[0])
        return base[:-1] + {"ゃ": "a", "ゅ": "ɨ", "ょ": "o"}[hira[1]]
    r = g2p(to_kata(hira))
    return r[0] if isinstance(r, (tuple, list)) else r

def finish(x, sr):
    """Обрезка тишины с запасом, выравнивание громкости, плавные края."""
    x = np.asarray(x, dtype=np.float64)
    f = int(sr * 0.01)
    env = np.array([np.sqrt(np.mean(x[i:i + f] ** 2)) for i in range(0, len(x) - f, f)])
    voiced = np.where(env > env.max() * 0.02)[0]
    a = max(0, voiced[0] * f - int(sr * 0.05))
    b = min(len(x), (voiced[-1] + 1) * f + int(sr * 0.15))
    x = x[a:b]
    rms = np.sqrt(np.mean(x[np.abs(x) > np.abs(x).max() * 0.05] ** 2))
    x = x * (0.12 / rms)                       # одинаковая громкость у всех слогов
    peak = np.abs(x).max()
    if peak > 0.95: x *= 0.95 / peak
    fi, fo = int(sr * 0.01), int(sr * 0.04)
    x[:fi] *= np.linspace(0, 1, fi); x[-fo:] *= np.linspace(1, 0, fo) ** 2
    return x

def problems(x, sr):
    f = int(sr * 0.01)
    e = np.array([np.sqrt(np.mean(x[i:i + f] ** 2)) for i in range(0, len(x) - f, f)]); e /= e.max()
    v = np.where(e > 0.08)[0]
    gap = run = 0
    for val in e[v[0]:v[-1] + 1]:
        run = run + 1 if val < 0.03 else 0; gap = max(gap, run)
    out = []
    if gap * 10 > 90: out.append(f"провал {gap * 10} мс")
    if e[-3:].mean() > 0.1: out.append("обрыв в конце")
    if e[0] > 0.2: out.append("обрыв в начале")
    if not 0.25 <= len(x) / sr <= 1.3: out.append(f"длительность {len(x) / sr:.2f} с")
    return out

kok = Kokoro(str(models / "kokoro-v1.0.onnx"), str(models / "voices-v1.0.bin"))
for key, (voice, speed) in VOICES.items():
    out = root / "assets" / "audio" / key
    out.mkdir(parents=True, exist_ok=True)
    for hira in sounds:
        ph = phonemes(hira) + "."            # точка — естественная интонация отдельного слога
        for sp in (speed, speed - 0.04, speed + 0.04, speed - 0.08):
            raw, sr = kok.create(ph, voice=voice, speed=sp, lang="ja", is_phonemes=True)
            x = finish(raw, sr)
            bad = problems(x, sr)
            if not bad: break
        if bad: print(f"{key} {hira} [{ph}]: {', '.join(bad)}", file=sys.stderr)
        with tempfile.NamedTemporaryFile(suffix=".wav") as tmp:
            sf.write(tmp.name, x.astype(np.float32), sr, subtype="PCM_16")
            subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", tmp.name, "-ac", "1", "-ar", "24000",
                            "-codec:a", "libmp3lame", "-b:a", "56k", str(out / f"{hira}.mp3")], check=True)
    size = sum(p.stat().st_size for p in out.glob("*.mp3"))
    print(f"{key} ({voice}): {len(sounds)} файлов, {size // 1024} КБ")
