// Сквозная проверка вкладки «Азбука»: озвучка, выбор ряда, прописи с подложкой и проверкой.
// Запуск: node tools/e2e/serve.js & node tools/e2e/abc-e2e.js http://localhost:8790
const { chromium } = require('playwright');
const path = require('path');
const KVG = require(path.resolve(__dirname, '../../src/kvg.json'));
const BASE = process.argv[2] || 'http://localhost:8790';
const SHOTS = process.env.SHOTS || '/tmp';
let failed = 0;
const check = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) failed++; };

async function draw(page, ch) {
  const box = await page.locator('#write .pad canvas').boundingBox();
  for (const s of KVG[ch]) {
    const pts = []; for (let i = 0; i < s.length; i += 2) pts.push([box.x + box.width * s[i] / 1090, box.y + box.height * s[i + 1] / 1090]);
    await page.mouse.move(...pts[0]); await page.mouse.down();
    for (const p of pts.slice(1)) await page.mouse.move(...p);
    await page.mouse.up();
  }
}

(async () => {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const ctx = await browser.newContext({ viewport: { width: 400, height: 860 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => { console.log('ошибка страницы: ' + e.message); failed++; });
  const audio = [];
  page.on('response', r => { if (r.url().includes('/audio/')) audio.push([decodeURIComponent(r.url().split('/audio/')[1]), r.status()]); });

  await page.goto(BASE + '/'); await page.waitForSelector('#btn-start');
  await page.click('#tab-abc');
  check(await page.locator('#abc .abc-cell:not(.empty)').count() === 104, 'таблица хираганы: 104 знака и сочетания');
  await page.click('#abc .abc-cell[aria-label^="Прослушать か"]');
  await page.waitForTimeout(400);
  check(audio.some(([f, s]) => f === 'か.mp3' && s === 200), 'нажатие на か загружает его озвучку');
  await page.screenshot({ path: SHOTS + '/abc-listen.png', fullPage: true });

  await page.click('#abc .segm button:has-text("Катакана")');
  await page.click('#abc .abc-cell[aria-label^="Прослушать カ"]');
  await page.waitForTimeout(300);
  check(audio.filter(([f]) => f === 'か.mp3').length >= 1, 'катакана カ звучит тем же файлом');
  await page.click('#abc .segm button:has-text("Хирагана")');

  // выбор: ряд ка целиком + отдельный знак あ
  await page.click('#abc .segm button:has-text("Выбрать")');
  await page.click('#abc .abc-row:has-text("ка")');
  await page.click('#abc .abc-cell[aria-label^="あ"]');
  check(!(await page.isHidden('#abc-bar')), 'появилась панель запуска прописей');
  check((await page.textContent('#abc-bar')).includes('Выбрано: 6'), 'выбрано 6 знаков (ряд ка и あ)');
  await page.click('#abc-bar button[aria-label="Меньше"]');
  check(await page.inputValue('#reps') === '5', 'повторений не меньше 5');
  await page.screenshot({ path: SHOTS + '/abc-select.png', fullPage: true });
  await page.click('#abc-bar .btn.primary');

  // прописи: あ ×5 с подложкой
  await page.waitForSelector('#write .pad canvas');
  check((await page.textContent('#write .w-kana')) === 'あ', 'прописи начинаются с あ');
  check((await page.textContent('#w-ctr')) === '1 / 30', 'всего 30 повторений');
  for (let i = 0; i < 2; i++) { await draw(page, 'あ'); await page.click('#write .btn.primary'); await page.waitForTimeout(700); }
  check((await page.locator('#write .dots i.on').count()) === 2, 'две верные попытки отмечены точками');
  await page.screenshot({ path: SHOTS + '/abc-write.png', fullPage: true });

  // неверный знак
  await draw(page, 'お'); await page.click('#write .btn.primary');
  await page.waitForSelector('#write .w-msg.bad');
  check((await page.textContent('#write .w-msg')).includes('Не похоже'), 'неверный знак не засчитан');
  await page.screenshot({ path: SHOTS + '/abc-wrong.png', fullPage: true });
  await page.click('#write .btn:has-text("Ещё раз")');
  for (let i = 0; i < 3; i++) { await draw(page, 'あ'); await page.click('#write .btn.primary'); await page.waitForTimeout(700); }
  check((await page.textContent('#write .w-kana')) === 'か', 'после 5 верных — следующий знак か');

  // без подложки попытки идут в историю ответов
  await page.click('#write .check');   // выключить подложку
  await draw(page, 'か'); await page.click('#write .btn.primary'); await page.waitForTimeout(700);
  const hist = await page.evaluate(() => KanaApp.items().filter(i => i.c === 'answers' && i.data.m === 'write').map(i => i.data.k + i.data.r));
  check(hist.length === 1 && hist[0] === 'かok', 'попытка без подложки записана в историю (с подложкой — нет)');

  // досрочное завершение — итоги
  await page.click('#btn-wquit');
  await page.waitForSelector('#write .w-table');
  check((await page.textContent('#write')).includes('Прописи завершены'), 'итоги прописей');
  check((await page.locator('#write .w-row.hard').count()) >= 1, 'あ отмечен как трудный (была ошибка)');
  await page.screenshot({ path: SHOTS + '/abc-result.png', fullPage: true });

  await browser.close();
  console.log(failed ? `\nПровалено проверок: ${failed}` : '\nВсе проверки пройдены');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
