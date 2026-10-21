// Сквозная проверка этапа 3: уроки катаканы и «Чтение в поездке».
// Запуск: node tools/e2e/serve.js & node tools/e2e/kata-e2e.js http://localhost:8790
const { chromium } = require('playwright');
const { ready, practiceHub } = require('./common.js');
const BASE = process.argv[2] || 'http://localhost:8790';
const SHOTS = process.env.SHOTS || '/tmp';
let failed = 0;
const check = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) failed++; };

async function answer(page, wrong) {
  const it = await page.evaluate(() => { const it = __kana.Q.deck[__kana.Q.i]; return { kana: it.kana, mode: it.mode || __kana.Q.mode, read: displayReading(it.kana, 'ru', it.w && it.w.read) }; });
  if (it.mode === 'type') { await page.fill('#answer', wrong ? 'ыыы' : it.read); await page.click('#card .btn.primary'); }
  else await page.locator(wrong ? `#card .choice:not([data-k="${it.kana}"])` : `#card .choice[data-k="${it.kana}"]`).first().click();
  await page.waitForSelector('#card .verdict');
  await page.click('#card .verdict .btn.primary');
  return it;
}
async function finishQuiz(page, wrongKanji) {
  const n = await page.evaluate(() => __kana.Q.deck.length);
  let missed = false;
  for (let i = 0; i < n; i++) {
    const kj = wrongKanji && !missed && await page.evaluate(k => __kana.Q.deck[__kana.Q.i].kana === k, wrongKanji);
    if (kj) missed = true;
    await answer(page, kj);
  }
  await page.waitForSelector('#screen-result:not([hidden])');
}

(async () => {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => { console.log('ошибка страницы: ' + e.message); failed++; });
  const audio = [];
  page.on('response', r => { if (r.url().includes('/audio/')) audio.push([decodeURIComponent(r.url().split('/audio/')[1]), r.status()]); });
  await page.goto(BASE + '/'); await ready(page, { account: true });

  // --- уроки катаканы ---
  await page.click('#tab-lessons');
  const txt = await page.textContent('#screen-lessons');
  check(txt.includes('Хирагана · пройдено 0 из 18') && txt.includes('Катакана · пройдено 0 из 18'), 'в «Уроках» две азбуки по 18 уроков');
  check(txt.includes('Чтение в поездке'), 'в «Уроках» есть раздел «Чтение в поездке»');
  await page.screenshot({ path: SHOTS + '/kata-lessons.png', fullPage: true });
  await page.locator('#screen-lessons .lessons').nth(1).locator('.lrow').first().click();
  check((await page.textContent('#screen-lesson')).includes('Урок 1 · катакана'), 'урок 1 катаканы');
  await page.screenshot({ path: SHOTS + '/kata-lesson.png', fullPage: true });
  await page.click('#screen-lesson .stepc:has-text("Знакомство") .btn');
  await page.waitForSelector('#lintro .icard');
  check((await page.textContent('#lintro')).includes('Зачем катакана'), 'знакомство начинается с пояснения «Зачем катакана»');
  await page.click('#lintro .btn.primary'); await page.click('#lintro .btn.primary');
  check((await page.textContent('#lintro .glyph-big')) === 'ア', 'затем знак ア');
  await page.waitForTimeout(500);
  check(audio.some(([f, s]) => f === 'm/あ.mp3' && s === 200), 'ア звучит');
  await page.screenshot({ path: SHOTS + '/kata-intro.png', fullPage: true });
  await page.click('#btn-iquit');
  await page.click('#screen-lesson .stepc:has-text("Проверка") .btn');
  await page.waitForSelector('#card #answer');
  check(await page.evaluate(() => __kana.Q.deck.every(i => /[ァ-ヴ]/.test(i.kana))), 'в проверке урока только катакана');
  await finishQuiz(page);
  check((await page.textContent('#screen-result')).includes('Катакана, урок 1 пройден: 100%'), 'урок 1 катаканы пройден');
  await page.click('#screen-result .btn:has-text("Следующий урок")');
  check((await page.textContent('#screen-lesson')).includes('Урок 2 · катакана'), 'переход к уроку 2 катаканы');

  // урок звуков заимствований
  await page.click('#tab-lessons');
  await page.click('#screen-lessons .lrow:has-text("Звуки заимствований")');
  await page.click('#screen-lesson .stepc:has-text("Знакомство") .btn');
  await page.waitForSelector('#lintro .glyph-big');
  check((await page.textContent('#lintro .glyph-big')) === 'ティ', 'знакомство с ティ');
  await page.waitForTimeout(600);
  check(audio.some(([f, s]) => f === 'm/てぃ.mp3' && s === 200), 'ティ озвучено отдельным файлом');
  await page.click('#btn-iquit');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#screen-lesson .btn:has-text("Конспект в PDF")')]);
  check(!!dl, 'конспект скачивается');
  const pdf = await page.evaluate(() => window.__lastPdf);
  check(pdf && pdf.name === 'Катакана, урок 18 — конспект.pdf', 'имя файла: ' + (pdf && pdf.name));
  check(pdf && pdf.size > 20000, 'PDF собран: ' + (pdf && pdf.size));

  // --- чтение в поездке ---
  await practiceHub(page);
  await page.click('#screen-practice .cta:has-text("Чтение в поездке")');
  await page.waitForSelector('#screen-reading .lrow');
  check(await page.locator('#screen-reading .lrow').count() === 5, '5 тем');
  await page.screenshot({ path: SHOTS + '/reading.png', fullPage: true });
  await page.click('#screen-reading .lrow:has-text("Транспорт")');
  check(await page.locator('#screen-reading .ritem').count() === 18, 'в теме «Транспорт» 18 надписей');
  await page.click('#screen-reading button[aria-label="Прослушать でぐち"]'); await page.waitForTimeout(400);
  check(audio.some(([f, s]) => f === 'words/m/でぐち.mp3' && s === 200), 'надпись 出口 озвучена');
  await page.screenshot({ path: SHOTS + '/reading-topic.png', fullPage: true });
  await page.click('#screen-reading .btn:has-text("Что означает?")');
  await page.waitForSelector('#card .choices.mean');
  const c = await page.evaluate(() => ({ sign: document.querySelector('#card .signplate').textContent, opts: [...document.querySelectorAll('#card .choice')].map(b => b.textContent.slice(1)) }));
  check(c.opts.length === 4 && new Set(c.opts).size === 4, 'табличка ' + c.sign + ' и 4 разных значения');
  await page.screenshot({ path: SHOTS + '/reading-card.png', fullPage: true });
  await finishQuiz(page, 'えき');   // одна ошибка — на 駅 (это слово есть и в уроке хираганы)
  check((await page.textContent('#screen-result')).includes('Транспорт: 94%'), 'итог темы: 17 из 18 — 94%');
  await page.click('#screen-result .btn:has-text("Готово")');
  check((await page.textContent('#screen-reading')).includes('94%'), 'лучший результат темы показан в списке');
  // ошибка попала в повторение, надпись с иероглифами повторяется как «что означает»
  const rev = await page.evaluate(() => {
    const due = __kana.srsDue().filter(s => s.w).map(s => s.k);
    __kana.startReview();
    const it = __kana.Q.deck.find(i => i.kind === 'word' && i.w.kanji);
    return { due, mode: it && it.mode, deck: __kana.Q.deck.map(i => i.kana + ':' + i.mode).join(' ') };
  });
  check(rev.due.length >= 1 && rev.mode === 'mean', 'ошибка в теме — в повторении, надпись иероглифами — «что означает»');
  await page.click('#btn-quit');
  // прочитать надписи каной
  await practiceHub(page);
  await page.click('#screen-practice .cta:has-text("Чтение в поездке")');
  await page.click('#screen-reading .lrow:has-text("Еда")');
  await page.click('#screen-reading .btn:has-text("Прочитать")');
  await page.waitForSelector('#card #answer');
  check(await page.evaluate(() => __kana.Q.deck.every(i => !hasKanji(i.w.sign))), '«Прочитать» — только надписи каной');
  await answer(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.click('#btn-quit');
  await page.click('#screen-result .btn:has-text("Готово")');
  await page.screenshot({ path: SHOTS + '/reading-dark.png', fullPage: true });
  await browser.close();
  console.log(failed ? `\nПровалено проверок: ${failed}` : '\nВсе проверки пройдены');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
