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
    .venv/bin/python tools/make_audio.py .voicevox            # всё заново
    .venv/bin/python tools/make_audio.py .voicevox --missing  # только новые слова

Результат: assets/audio/<голос>/<хирагана>.mp3 (катакана использует те же файлы — звучание одинаковое)
и assets/audio/words/<голос>/<слово>.mp3 для стартового словаря.
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

vv = Path(next((a for a in sys.argv[1:] if not a.startswith("--")), ".voicevox"))
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

# Слова из стартового словаря. Синтез идёт по записи с иероглифами: так Open JTalk ставит верное
# японское ударение (はし «палочки» = 箸, а не 橋 «мост»). Чтение сверяется с записью каной.
WORD_TEXT = {
    "おねがいします": "お願いします", "だいじょうぶ": "大丈夫", "わかりません": "分かりません", "えいご": "英語",
    "にほん": "日本", "ごはん": "ご飯", "みず": "水", "おちゃ": "お茶", "さかな": "魚", "にく": "肉", "とりにく": "鶏肉",
    "たまご": "卵", "やさい": "野菜", "くだもの": "果物", "すし": "寿司", "そば": "蕎麦", "てんぷら": "天ぷら",
    "おいしい": "美味しい", "からい": "辛い", "あまい": "甘い", "おかいけい": "お会計", "ひとり": "一人", "ふたり": "二人",
    "はし": "箸", "よやく": "予約", "おすすめ": "お勧め", "えき": "駅", "でんしゃ": "電車", "ちかてつ": "地下鉄",
    "くうこう": "空港", "きっぷ": "切符", "でぐち": "出口", "いりぐち": "入口", "みぎ": "右", "ひだり": "左", "ちず": "地図",
    "しんかんせん": "新幹線", "おかね": "お金", "えん": "円", "げんきん": "現金", "ふくろ": "袋", "やすい": "安い",
    "たかい": "高い", "おおきい": "大きい", "ちいさい": "小さい", "おみやげ": "お土産", "くすり": "薬", "へや": "部屋",
    "かぎ": "鍵", "あさごはん": "朝ご飯", "おふろ": "お風呂", "なまえ": "名前", "にもつ": "荷物", "きょう": "今日",
    "あした": "明日", "きのう": "昨日", "いま": "今", "あさ": "朝", "よる": "夜",
}
words_js = (root / "src" / "words.js").read_text(encoding="utf-8")
words = re.findall(r"\['([^']+)',", words_js)
# слова уроков: [кана, перевод, иероглифы, …]
import json as _json
lesson_words = _json.loads(subprocess.run(["node", "-e", """
const K = require('./src/kana.js'); global.ROWS = K.ROWS; global.toKata = K.toKata;
const { LESSONS } = require('./src/lessons.js');
console.log(JSON.stringify(LESSONS.flatMap(l => l.words)));
"""], cwd=root, capture_output=True, text=True, check=True).stdout)
for w in lesson_words:
    if w[0] not in words: words.append(w[0])
    if len(w) > 2 and w[2] and w[0] not in WORD_TEXT: WORD_TEXT[w[0]] = w[2]
ONLY_MISSING = "--missing" in sys.argv

def moras(aq):
    # «えい» на письме произносится как долгое «ээ»: エイゴ и エエゴ — одно и то же слово
    t = "".join(m.text for ap in aq.accent_phrases for m in ap.moras)
    return re.sub(r"([エケセテネヘメレゲゼデベペ])イ", r"\1エ", t)

def word_query(kana, style):
    plain = syn.create_audio_query(kana, style)
    text = WORD_TEXT.get(kana)
    if text:
        aq = syn.create_audio_query(text, style)
        if moras(aq) == moras(plain):
            return aq
        print(f"  {text}: чтение {moras(aq)} ≠ {moras(plain)} — беру запись каной", file=sys.stderr)
    return plain

def encode(x, sr, path):
    with tempfile.NamedTemporaryFile(suffix=".wav") as tmp:
        sf.write(tmp.name, x.astype(np.float32), sr, subtype="PCM_16")
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", tmp.name, "-ac", "1", "-ar", "24000",
                        "-codec:a", "libmp3lame", "-b:a", "64k", str(path)], check=True)

for key, (vvm, style) in VOICES.items():
    with VoiceModelFile.open(str(vv / "vvms" / vvm)) as m:
        syn.load_voice_model(m)
    wout = root / "assets" / "audio" / "words" / key
    wout.mkdir(parents=True, exist_ok=True)
    for kana in words:
        if ONLY_MISSING and (wout / f"{kana}.mp3").exists(): continue
        aq = word_query(kana, style)
        aq.speed_scale = 0.9                      # чуть медленнее обычной речи
        aq.pre_phoneme_length, aq.post_phoneme_length = 0.06, 0.20
        x, sr = sf.read(io.BytesIO(syn.synthesis(aq, style)), dtype="float64")
        encode(finish(x, sr), sr, wout / f"{kana}.mp3")
    print(f"{key}: {len(words)} слов, {sum(p.stat().st_size for p in wout.glob('*.mp3')) // 1024} КБ")
    out = root / "assets" / "audio" / key
    out.mkdir(parents=True, exist_ok=True)
    for hira in sounds:
        if ONLY_MISSING and (out / f"{hira}.mp3").exists(): continue
        k = to_kata(hira); k = SAME.get(k, k)
        aq = syn.create_audio_query_from_kana(k + "'", style)   # один слог с ударением — ровный, отчётливый
        mora = aq.accent_phrases[0].moras[0]
        mora.vowel_length = max(mora.vowel_length, 0.32 if mora.vowel == "N" else 0.30)   # гласная дольше, чем в беглой речи
        aq.pre_phoneme_length, aq.post_phoneme_length = 0.06, 0.20
        x, sr = sf.read(io.BytesIO(syn.synthesis(aq, style)), dtype="float64")
        encode(finish(x, sr), sr, out / f"{hira}.mp3")
    size = sum(p.stat().st_size for p in out.glob("*.mp3"))
    print(f"{key}: {len(sounds)} файлов, {size // 1024} КБ")
