// Проверка уроков: слова урока составлены только из пройденных знаков, у заметок есть знаки,
// у каждого знака урока есть озвучка и порядок штрихов (для прописей). Запуск: node tools/check_lessons.js
const fs = require('fs'), path = require('path');
const K = require('../src/kana.js'); Object.assign(global, K);
const { LESSONS, lessonKana, lessonWritable } = require('../src/lessons.js');
const KVG = require('../src/kvg.json');
const root = path.resolve(__dirname, '..');
let bad = 0;
const fail = m => { console.log('FAIL ' + m); bad++; };

const learned = { h: new Set(), k: new Set() };
for (const l of LESSONS) {
  const set = learned[l.script];
  const kana = lessonKana(l);
  for (const k of kana) for (const c of k) set.add(c);
  for (const c of l.extra || []) set.add(c);
  for (const k of Object.keys(l.notes)) if (!kana.includes(k)) fail(`${l.id}: заметка к знаку не из урока: ${k}`);
  for (const [w] of l.words) {
    const miss = [...w.replace(/ /g, '')].filter(c => !set.has(c));
    if (miss.length) fail(`${l.id}: в слове ${w} не пройдены: ${[...new Set(miss)].join(' ')}`);
    const t = transcribe(w);
    if (/[぀-ヿ]/.test(t.lat + t.ru)) fail(`${l.id}: не транскрибируется ${w}: ${t.lat}`);
  }
  for (const k of kana) {
    const t = transcribe(k);
    if (/[぀-ヿ]/.test(t.lat)) fail(`${l.id}: не транскрибируется знак ${k}`);
    if (!fs.existsSync(path.join(root, 'assets/audio/m', toHira(k) + '.mp3'))) fail(`${l.id}: нет озвучки ${k}`);
  }
  for (const k of lessonWritable(l)) if (!KVG[k]) fail(`${l.id}: нет штрихов KanjiVG для ${k}`);
  if (!kana.length && !(l.points || []).length) fail(`${l.id}: урок без знаков и без пояснений`);
}
// фразы конструктора: только кана, всё транскрибируется, лишние блоки — не из фразы
const { BUILDER } = require('../src/sentences.js');
for (const lv of BUILDER) for (const [ru, parts, kanji, alts] of lv.items) {
  const p = parts.split('|');
  for (const t of p) { if (!/^[\u3041-\u30ff]+$/.test(t)) fail(`${lv.id}: блок не каной: ${t}`); if (/[\u3040-\u30ff]/.test(transcribe(t).lat)) fail(`${lv.id}: не транскрибируется ${t}`); }
  for (const a of (alts || '').split('/').filter(Boolean)) if (a.split('|').sort().join() !== p.slice().sort().join()) fail(`${lv.id}: другой порядок из других блоков: ${a}`);
  if (!kanji) fail(`${lv.id}: нет записи для озвучки: ${ru}`);
}
const ids = LESSONS.map(l => l.id);
if (new Set(ids).size !== ids.length) fail('повторяются id уроков');
console.log(bad ? `\nОшибок: ${bad}` : `Уроки в порядке: ${LESSONS.length}`);
process.exit(bad ? 1 : 0);
