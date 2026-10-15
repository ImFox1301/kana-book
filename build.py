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

FONTS = """<style>
@font-face { font-family: "Klee One"; font-weight: 400; font-display: swap; src: url("fonts/klee-one-Regular.woff2") format("woff2") }
@font-face { font-family: "Klee One"; font-weight: 600; font-display: swap; src: url("fonts/klee-one-SemiBold.woff2") format("woff2") }
@font-face { font-family: "Onest"; font-weight: 100 900; font-display: swap; src: url("fonts/onest.woff2") format("woff2") }
</style>"""

page = (src / "app.html").read_text(encoding="utf-8")
# в собранной версии шрифты свои, без обращения к Google
page = "\n".join(l for l in page.splitlines() if "fonts.googleapis.com" not in l)
page = page.replace("/*KVG*/", "const KVG = " + (src / "kvg.json").read_text(encoding="utf-8") + ";")
for key, name in [("REC", "recognizer.js"), ("KANA", "kana.js"), ("WORDS", "words.js"), ("APP", "app.js")]:
    page = page.replace(f"/*{key}*/", (src / name).read_text(encoding="utf-8"))
page += "\n<script>window.KANA_PWA = true;</script>\n<script>" + (src / "pwa.js").read_text(encoding="utf-8") + "</script>\n"

html = f"""<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#2f4f86">
<meta name="description" content="Тренажёр хираганы, катаканы и слов: рисуйте знаки пальцем или пишите их звучание">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" type="image/png" href="icons/favicon-48.png">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Кана-тетрадь">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<link rel="preload" href="fonts/onest.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="fonts/klee-one-SemiBold.woff2" as="font" type="font/woff2" crossorigin>
{FONTS}
<style>:root{{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}}body{{margin:0}}[hidden]{{display:none!important}}</style>
{page}
"""
(dist / "index.html").write_text(html, encoding="utf-8")

manifest = {
    "name": "Кана-тетрадь",
    "short_name": "Кана",
    "description": "Тренажёр хираганы, катаканы и слов",
    "lang": "ru",
    "start_url": "./",
    "scope": "./",
    "id": "./",
    "display": "standalone",
    "orientation": "portrait",
    "background_color": "#f5f6f2",
    "theme_color": "#2f4f86",
    "icons": [
        {"src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
        {"src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
        {"src": "icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
    ],
}
(dist / "manifest.webmanifest").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

# список файлов для офлайна и версия = хеш их содержимого
files = ["index.html", "manifest.webmanifest"] + sorted(
    str(p.relative_to(dist)) for p in dist.rglob("*") if p.is_file() and p.suffix in {".woff2", ".png"})
h = hashlib.sha256()
for f in files:
    h.update(f.encode()); h.update((dist / f).read_bytes())
version = h.hexdigest()[:12]
sw = (src / "sw.js").read_text(encoding="utf-8")
sw = sw.replace("'__VERSION__'", json.dumps(version)).replace("__ASSETS__", json.dumps(["./" + f for f in files]))
(dist / "sw.js").write_text(sw, encoding="utf-8")

total = sum(p.stat().st_size for p in dist.rglob("*") if p.is_file())
print(f"dist/: версия {version}, {len(files)} файлов в офлайн-кэше, всего {total // 1024} КБ")
