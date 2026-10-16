#!/usr/bin/env python3
"""Озвучка каны для вкладки «Азбука»: VOICEVOX CORE, офлайн.

Голоса (выбраны по разборчивости: распознавание речи ReazonSpeech на каждом отдельном слоге):
  m — VOICEVOX:青山龍星 (Аояма Рюсэй), мужской
  f — VOICEVOX:波音リツ (Намонэ Рицу), женский
По условиям VOICEVOX в приложении указана кредитная строка «VOICEVOX:…».

Подготовка (Linux x64, нужен ffmpeg; всё скачивается с GitHub):
    V=0.16.4; D=.voicevox; mkdir -p $D/vvms && cd $D
    curl -LO https://github.com/VOICEVOX/voicevox_core/releases/download/$V/voicevox_core-$V-cp310-abi3-manylinux_2_34_x86_64.whl
    curl -L https://github.com/VOICEVOX/onnxruntime-builder/releases/download/voicevox_onnxruntime-1.17.3/voicevox_onnxruntime-linux-x64-1.17.3.tgz | tar xz
    curl -L https://github.com/r9y9/open_jtalk/releases/download/v1.11.1/open_jtalk_dic_utf_8-1.11.tar.gz | tar xz
    curl -L -o vvms/15.vvm https://github.com/VOICEVOX/voicevox_vvm/releases/download/$V/15.vvm
    curl -L -o vvms/3.vvm https://github.com/VOICEVOX/voicevox_vvm/releases/download/$V/3.vvm
    cd .. && python3 -m venv .venv && .venv/bin/pip install $D/voicevox_core-*.whl numpy soundfile
Запуск:
    .venv/bin/python tools/make_audio.py .voicevox

Результат: assets/audio/<голос>/<хирагана>.mp3. Катакана использует те же файлы — звучание одинаковое.
"""
import io
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf
from voicevox_core.blocking import Onnxruntime, OpenJtalk, Synthesizer, VoiceModelFile

vv = Path(sys.argv[1] if len(sys.argv) > 1 else ".voicevox")
root = Path(__file__).resolve().parent.parent
VOICES = {"m": ("15.vvm", 13), "f": ("3.vvm", 9)}   # файл модели, id стиля «ノーマル»

kana_js = (root / "src" / "kana.js").read_text(encoding="utf-8").split("const GROUPS")[0]
sounds = [k for m in re.finditer(r"h: '([^']+)'", kana_js) for k in m.group(1).split(" ")]
to_kata = lambda s: "".join(chr(ord(c) + 0x60) if "ぁ" <= c <= "ゖ" else c for c in s)
SAME = {"ヲ": "オ", "ヂ": "ジ", "ヅ": "ズ"}            # звучат одинаково; VOICEVOX их отдельно не принимает

ort = Onnxruntime.load_once(filename=str(next(vv.glob("voicevox_onnxruntime-*/lib/libvoicevox_onnxruntime.so.*"))))
syn = Synthesizer(ort, OpenJtalk(str(next(vv.glob("open_jtalk_dic_utf_8-*")))))

def finish(x, sr):
    """Выравнивание громкости и плавные края."""
    x = np.asarray(x, dtype=np.float64)
    rms = np.sqrt(np.mean(x[np.abs(x) > np.abs(x).max() * 0.05] ** 2))
    x = x * (0.12 / rms)
    peak = np.abs(x).max()
    if peak > 0.95: x *= 0.95 / peak
    fi, fo = int(sr * 0.005), int(sr * 0.04)
    x[:fi] *= np.linspace(0, 1, fi); x[-fo:] *= np.linspace(1, 0, fo) ** 2
    return x

for key, (vvm, style) in VOICES.items():
    with VoiceModelFile.open(str(vv / "vvms" / vvm)) as m:
        syn.load_voice_model(m)
    out = root / "assets" / "audio" / key
    out.mkdir(parents=True, exist_ok=True)
    for hira in sounds:
        k = to_kata(hira); k = SAME.get(k, k)
        aq = syn.create_audio_query_from_kana(k + "'", style)   # один слог с ударением — ровный, отчётливый
        mora = aq.accent_phrases[0].moras[0]
        mora.vowel_length = max(mora.vowel_length, 0.32 if mora.vowel == "N" else 0.30)   # гласная дольше, чем в беглой речи
        aq.pre_phoneme_length, aq.post_phoneme_length = 0.06, 0.20
        x, sr = sf.read(io.BytesIO(syn.synthesis(aq, style)), dtype="float64")
        x = finish(x, sr)
        with tempfile.NamedTemporaryFile(suffix=".wav") as tmp:
            sf.write(tmp.name, x.astype(np.float32), sr, subtype="PCM_16")
            subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", tmp.name, "-ac", "1", "-ar", "24000",
                            "-codec:a", "libmp3lame", "-b:a", "64k", str(out / f"{hira}.mp3")], check=True)
    size = sum(p.stat().st_size for p in out.glob("*.mp3"))
    print(f"{key}: {len(sounds)} файлов, {size // 1024} КБ")
