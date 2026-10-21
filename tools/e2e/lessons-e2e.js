// Сквозная проверка этапа 1: первый запуск с целью дня, навигация, урок целиком (знакомство → прописи → проверка), PDF.
// Запуск: node tools/e2e/serve.js & node tools/e2e/lessons-e2e.js http://localhost:8790
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const KVG = require(path.resolve(__dirname, '../../src/kvg.json'));
const K = require(path.resolve(__dirname, '../../src/kana.js'));
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
  const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => { console.log('ошибка страницы: ' + e.message); failed++; });

  // первый запуск: приветствие → регистрация → настройка цели
  await page.goto(BASE + '/');
  await page.waitForSelector('#screen-onboard:not([hidden])');
  check(await page.isHidden('#bnav'), 'на первом запуске нижней панели нет');
  check(await page.isVisible('#btn-guest') && await page.isVisible('#btn-welcome-register'), 'приветствие: создать аккаунт, войти или без аккаунта');
  await page.screenshot({ path: SHOTS + '/s0-welcome.png', fullPage: true });
  await page.click('#btn-welcome-register');
  await page.fill('#acc-name', 'Павел'); await page.fill('#acc-user', 'l_' + Math.random().toString(36).slice(2, 8)); await page.fill('#acc-pass', 'secret-pass-1');
  await page.click('#screen-register button[type=submit]');
  await page.waitForSelector('#screen-onboard:not([hidden]) button:has-text("45 мин")');
  await page.click('#screen-onboard button:has-text("45 мин")');
  await page.click('#screen-onboard button:has-text("100")');
  await page.screenshot({ path: SHOTS + '/s1-onboard.png', fullPage: true });
  await page.click('#screen-onboard .btn.primary');
  await page.waitForSelector('#screen-home:not([hidden])');
  const goal = await page.evaluate(() => __kana.S.goal);
  check(goal.min === 45 && goal.cards === 100, 'цель дня сохранена: 45 минут и 100 карточек');
  check((await page.textContent('#screen-home')).includes('Начать: урок 1'), 'на «Сегодня» рекомендован урок 1');
  await page.screenshot({ path: SHOTS + '/s2-home.png', fullPage: true });

  // уроки
  await page.click('#tab-lessons');
  check(await page.locator('#screen-lessons .lrow').count() >= 18, 'в списке 18 уроков хираганы');
  await page.screenshot({ path: SHOTS + '/s3-lessons.png', fullPage: true });
  await page.click('#screen-lessons .lrow.rec');
  await page.waitForSelector('#screen-lesson:not([hidden])');
  check((await page.textContent('#screen-lesson h1')).includes('Гласные'), 'открыт урок 1');
  await page.screenshot({ path: SHOTS + '/s4-lesson.png', fullPage: true });

  // знакомство
  await page.click('#screen-lesson .stepc:nth-child(1) .btn');
  await page.waitForSelector('#lintro .glyph-big');
  check((await page.textContent('#lintro .glyph-big')) === 'あ', 'знакомство начинается с あ');
  check((await page.textContent('#lintro')).includes('Как запомнить'), 'есть мнемоника');
  await page.screenshot({ path: SHOTS + '/s5-intro.png', fullPage: true });
  for (let i = 0; i < 6; i++) await page.click('#lintro .btn.primary');
  await page.waitForSelector('#screen-lesson:not([hidden])');
  check(await page.evaluate(() => !!__kana.lessonsDone.h1.intro), 'шаг «Знакомство» отмечен');

  // прописи: 5 знаков × 5, первые 3 с подложкой
  await page.click('#screen-lesson .stepc:nth-child(2) .btn');
  await page.waitForSelector('#write .pad canvas');
  const ghostOn = await page.textContent('#write .padtools');
  check(ghostOn.includes('По подложке: ещё 3'), 'в уроке первые 3 раза — по подложке');
  for (const k of ['あ', 'い', 'う', 'え', 'お']) for (let r = 0; r < 5; r++) {
    await draw(page, k); await page.click('#write .btn.primary');
    await page.waitForTimeout(650);
    if (await page.isVisible('#write .w-msg.bad')) { await page.click('#write .btn:has-text("Мой знак верный")'); await page.waitForTimeout(950); }
  }
  await page.waitForSelector('#write .w-table');
  check(await page.evaluate(() => !!__kana.lessonsDone.h1.write), 'шаг «Прописи» отмечен');

  // проверка: верные ответы
  await page.click('#write .btn:has-text("Дальше: проверка")');
  await page.waitForSelector('#answer');
  const n = await page.evaluate(() => __kana.Q.deck.length);
  for (let i = 0; i < n; i++) {
    const kana = await page.evaluate(() => __kana.Q.deck[__kana.Q.i].kana);
    await page.fill('#answer', K.displayReading(kana, 'ru').replace(/̄/g, ''));
    await page.keyboard.press('Enter');
    await page.click('#card .btn.primary');
  }
  await page.waitForSelector('#screen-result .result-banner');
  check((await page.textContent('#screen-result .result-banner')).includes('пройден'), 'проверка пройдена — урок засчитан');
  await page.screenshot({ path: SHOTS + '/s6-passed.png', fullPage: true });
  check(await page.evaluate(() => !!__kana.lessonsDone.h1.done), 'урок 1 отмечен пройденным');

  // следующий урок и «Сегодня»
  await page.click('#screen-result .btn:has-text("Следующий урок")');
  await page.waitForSelector('#screen-lesson:not([hidden])');
  check((await page.textContent('#screen-lesson h1')).includes('ка'), 'открылся урок 2');
  await page.click('#tab-home');
  const home = await page.textContent('#screen-home');
  check(home.includes('урок 2'), 'на «Сегодня» теперь рекомендован урок 2');
  const cards = await page.evaluate(() => __kana.dayTotals(__kana.todayKey()).cards);
  check(cards >= 25 + n, `карточки за день посчитаны: ${cards}`);

  // PDF
  await page.click('#tab-lessons');
  check(await page.isVisible('#screen-lesson'), 'раздел «Уроки» возвращает к открытому уроку');
  await page.click('#tab-lessons');   // повторное нажатие — к списку
  await page.click('#screen-lessons .lrow:nth-child(4)');
  await page.waitForSelector('#screen-lesson:not([hidden])');
  for (const [label, kind] of [['Конспект в PDF', 'konspekt'], ['Прописи в PDF', 'propisi']]) {
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click(`#screen-lesson button:has-text("${label}")`)]);
    const file = SHOTS + `/lesson4-${kind}.pdf`;
    await dl.saveAs(file);
    const head = fs.readFileSync(file).subarray(0, 5).toString();
    check(head === '%PDF-' && fs.statSync(file).size > 5000, `${label}: ${dl.suggestedFilename()} (${Math.round(fs.statSync(file).size / 1024)} КБ)`);
  }

  // вибрация: верно — один импульс, ошибка — два; выключается в настройках
  await page.evaluate(() => { window.__vib = []; navigator.vibrate = p => { window.__vib.push(p); return true; }; });
  await page.evaluate(() => { __kana.S.vibrate = true; __kana.buzz(true); __kana.buzz(false); __kana.S.vibrate = false; __kana.buzz(true); __kana.S.vibrate = true; });
  const vib = await page.evaluate(() => window.__vib);
  check(JSON.stringify(vib) === JSON.stringify([30, [30, 90, 30]]), 'вибрация: верно — 1 импульс, ошибка — 2, выключенная молчит');

  // раздел «Я»
  await page.click('#tab-me');
  check((await page.textContent('#settings')).includes('Вибрация'), 'в настройках есть вибрация');
  await page.screenshot({ path: SHOTS + '/s7-me.png', fullPage: true });

  // компьютер: панель слева
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.click('#tab-home');
  const nav = await page.locator('#bnav').boundingBox();
  check(nav.x === 0 && nav.height > 600, 'на широком экране панель слева');
  await page.screenshot({ path: SHOTS + '/s8-desktop.png' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.click('#tab-lessons'); await page.screenshot({ path: SHOTS + '/s9-dark.png' });

  await browser.close();
  console.log(failed ? `\nПровалено проверок: ${failed}` : '\nВсе проверки пройдены');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
