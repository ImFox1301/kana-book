#!/usr/bin/env python3
"""Собирает src/ в один файл dist/index.html (все данные и скрипты внутри)."""
from pathlib import Path

root = Path(__file__).resolve().parent
src = root / "src"
dist = root / "dist"
dist.mkdir(exist_ok=True)

page = (src / "app.html").read_text(encoding="utf-8")
page = page.replace("/*KVG*/", "const KVG = " + (src / "kvg.json").read_text(encoding="utf-8") + ";")
for key, name in [("REC", "recognizer.js"), ("KANA", "kana.js"), ("WORDS", "words.js"), ("APP", "app.js")]:
    page = page.replace(f"/*{key}*/", (src / name).read_text(encoding="utf-8"))

html = f"""<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#f5f6f2">
<style>:root{{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}}body{{margin:0}}[hidden]{{display:none!important}}</style>
{page}
"""
(dist / "index.html").write_text(html, encoding="utf-8")
print(f"dist/index.html: {len(html.encode('utf-8')) // 1024} КБ")
