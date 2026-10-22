#!/usr/bin/env python3
"""Собирает src/ и assets/ в dist/: одна страница index.html, service worker, manifest, шрифты, иконки."""
import hashlib
import json
import shutil
from pathlib import Path

root = Path(__file__).resolve().parent
src, assets, dist = root / "src", root / "assets", root / "dist"
if dist.exists():
    shutil.rmtree(dist)
dist.mkdir()
shutil.copytree(assets / "fonts", dist / "fonts")
shutil.copytree(assets / "icons", dist / "icons")
shutil.copytree(assets / "img", dist / "img")         # иллюстрации: Фудзи, пагода, тории, Токио
shutil.copytree(assets / "audio", dist / "audio")
shutil.copytree(assets / "pdf", dist / "pdf")         # шрифты для PDF (TTF)
shutil.copytree(assets / "vendor", dist / "vendor")   # pdf-lib, fontkit — загружаются при первом PDF   # озвучка каны (tools/make_audio.py)

FONTS = """<style>
@font-face { font-family: "Noto Sans"; font-weight: 400; font-display: swap; src: url("fonts/noto-sans-regular.woff2") format("woff2") }
@font-face { font-family: "Noto Sans"; font-weight: 600 800; font-display: swap; src: url("fonts/noto-sans-bold.woff2") format("woff2") }
@font-face { font-family: "Noto Sans JP"; font-weight: 400; font-display: swap; src: url("fonts/noto-sans-jp.woff2") format("woff2") }
</style>"""

page = (src / "app.html").read_text(encoding="utf-8")
# в собранной версии шрифты свои, без обращения к Google
page = "\n".join(l for l in page.splitlines() if "fonts.googleapis.com" not in l)
page = page.replace("/*CSS*/", (src / "style.css").read_text(encoding="utf-8"), 1)
for key, name in [("REC", "recognizer.js"), ("KANA", "kana.js"), ("LESSONS", "lessons.js"), ("WORDS", "words.js"), ("READING", "reading.js"), ("SENTENCES", "sentences.js"), ("PDF", "pdf.js"), ("APP", "app.js")]:
    page = page.replace(f"/*{key}*/", (src / name).read_text(encoding="utf-8"))
# флаг включает установку, офлайн и аккаунт; sync.js и pwa.js подключаются только в собранной версии
word_audio = sorted({p.stem for p in (assets / "audio" / "words" / "m").glob("*.mp3")})
page = page.replace("<script>/*KVG*/</script>", "<script>window.KANA_PWA = true; window.WORD_AUDIO = " + json.dumps(word_audio, ensure_ascii=False) + ";</script>\n<script>/*KVG*/</script>", 1)
page = page.replace("/*KVG*/", "const KVG = " + (src / "kvg.json").read_text(encoding="utf-8") + ";")
page += "\n<script>" + (src / "sync.js").read_text(encoding="utf-8") + "</script>\n<script>" + (src / "pwa.js").read_text(encoding="utf-8") + "</script>\n"

html = f"""<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#F8F5F0" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0B1724" media="(prefers-color-scheme: dark)">
<meta name="description" content="Тренажёр хираганы, катаканы и слов: рисуйте знаки пальцем или пишите их звучание">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" type="image/svg+xml" href="icons/kana-app.svg">
<link rel="icon" type="image/png" href="icons/kana-favicon-48.png">
<link rel="apple-touch-icon" href="icons/kana-apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="KANA">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<link rel="preload" href="img/fuji-s.webp" as="image" media="(max-width: 959px)">
<link rel="preload" href="fonts/noto-sans-regular.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="fonts/noto-sans-bold.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="fonts/noto-sans-jp.woff2" as="font" type="font/woff2" crossorigin>
{FONTS}
<script>try{{var t=(JSON.parse(localStorage.getItem('kana-tetrad:settings')||'{{}}')||{{}}).theme;if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}}catch(e){{}}</script>
<style>:root{{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}}body{{margin:0}}[hidden]{{display:none!important}}</style>
{page}
"""
(dist / "index.html").write_text(html, encoding="utf-8")

manifest = {
    "name": "KANA",
    "short_name": "KANA",
    "description": "Тренажёр хираганы, катаканы и слов",
    "lang": "ru",
    "start_url": "./",
    "scope": "./",
    "id": "./",
    "display": "standalone",
    "orientation": "portrait",
    "background_color": "#F8F5F0",
    "theme_color": "#0B2D49",
    "icons": [
        {"src": "icons/kana-icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
        {"src": "icons/kana-icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
        {"src": "icons/kana-icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
    ],
}
(dist / "manifest.webmanifest").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

# список файлов для офлайна и версия = хеш их содержимого
# в офлайн-кэш при установке: страница, шрифты, иконки, озвучка каны и vendor-скрипты;
# озвучка слов (≈3 МБ) кэшируется по мере прослушивания (см. sw.js)
files = ["index.html", "manifest.webmanifest"] + sorted(
    str(p.relative_to(dist)) for p in dist.rglob("*")
    if p.is_file() and p.suffix in {".woff2", ".png", ".webp", ".svg", ".mp3", ".js", ".ttf"} and "audio/words" not in str(p.relative_to(dist)) and p.name != "sw.js")
h = hashlib.sha256()
for f in files:
    h.update(f.encode()); h.update((dist / f).read_bytes())
version = h.hexdigest()[:12]
sw = (src / "sw.js").read_text(encoding="utf-8")
sw = sw.replace("'__VERSION__'", json.dumps(version)).replace("__ASSETS__", json.dumps(["./" + f for f in files]))
(dist / "sw.js").write_text(sw, encoding="utf-8")

total = sum(p.stat().st_size for p in dist.rglob("*") if p.is_file())
print(f"dist/: версия {version}, {len(files)} файлов в офлайн-кэше, всего {total // 1024} КБ")
