// Сквозная проверка этапа 2: интервальное повторение на «Сегодня», квиз на слух, похожие знаки.
// Запуск: node tools/e2e/serve.js & node tools/e2e/srs-e2e.js http://localhost:8790
const { chromium } = require('playwright');
const { ready, openQuizSetup, practiceHub } = require('./common.js');
const BASE = process.argv[2] || 'http://localhost:8790';
const SHOTS = process.env.SHOTS || '/tmp';
let failed = 0;
const check = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) failed++; };

// история ответов: か и き пора повторить, あ — завтра, ぬ и め путаются между собой
const D = 864e5, now = Date.now();
let n = 0;
const A = (k, r, ago, extra) => Object.assign({ id: 'seed' + (n++), ts: now - ago, k, w: 0, m: 'type', r }, extra);
const SEED = [
  A('き', 'ok', 10 * D), A('き', 'ok', 8 * D),
  A('か', 'ok', 3 * D),
  A('ぬ', 'bad', 2 * D, { m: 'draw', x: 'め' }), A('め', 'bad', 2 * D, { m: 'draw', x: 'ぬ' }), A('ぬ', 'bad', D, { m: 'draw', x: 'め' }),
  A('あ', 'ok', 60000),
];

async function answerCard(page, wrong) {
  const it = await page.evaluate(() => { const it = __kana.Q.deck[__kana.Q.i]; return { kana: it.kana, mode: it.mode || __kana.Q.mode, read: displayReading(it.kana, 'ru', it.w && it.w.read) }; });
  if (it.mode === 'type') { await page.fill('#answer', wrong ? 'ыыы' : it.read); await page.click('#card .btn.primary'); }
  else {
    const sel = wrong ? `#card .choice:not([data-k="${it.kana}"])` : `#card .choice[data-k="${it.kana}"]`;
    await page.locator(sel).first().click();
  }
  await page.waitForSelector('#card .verdict');
  return it;
}

(async () => {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const ctx = await browser.newContext({ viewport: { width: 400, height: 860 } });
  await ctx.addInitScript(seed => {
    if (localStorage.getItem('kana-tetrad:answers')) return;
    localStorage.setItem('kana-tetrad:answers', JSON.stringify(seed));
    localStorage.setItem('kana-tetrad:settings', JSON.stringify({ sys: 'ru' }));
  }, SEED);
  const page = await ctx.newPage();
  page.on('pageerror', e => { console.log('ошибка страницы: ' + e.message); failed++; });
  const audio = [];
  page.on('request', r => { if (r.url().includes('/audio/')) audio.push(decodeURIComponent(r.url().split('/audio/')[1])); });

  await page.goto(BASE + '/'); await ready(page, { account: true });   // история уходит в новый аккаунт

  // --- интервальное повторение ---
  const due = await page.evaluate(() => __kana.srsDue().map(s => s.k).sort().join(''));
  check(due === [...'かきぬめ'].sort().join(''), 'пора повторить か, き, ぬ, め (а あ — завтра): ' + due);
  const st = await page.evaluate(() => Object.fromEntries([...__kana.srsState().values()].map(s => [s.k, s.box])));
  check(st['き'] === 2 && st['か'] === 1 && st['ぬ'] === 0, 'коробки: き — 2, か — 1, ぬ — 0');
  const home = await page.textContent('#screen-home');
  check(home.includes('4 знака на сегодня'), 'на «Сегодня» — «Повторение: 4 знака на сегодня»');
  await page.screenshot({ path: SHOTS + '/srs-home.png', fullPage: true });
  await page.click('#screen-home .cta.review');
  await page.waitForSelector('#screen-quiz:not([hidden])');
  check((await page.textContent('#ctr')) === '1 / 4', 'в повторении 4 карточки');
  for (let i = 0; i < 4; i++) {
    const miss = (await page.evaluate(() => __kana.Q.deck[__kana.Q.i].kana)) === 'か';
    const it = await answerCard(page, miss);
    if (miss) {
      check((await page.textContent('#card .vtitle')) === 'Неверно', 'ответ на か — нарочно неверный: ' + it.kana);
      await page.screenshot({ path: SHOTS + '/srs-wrong.png', fullPage: true });
    }
    await page.click('#card .verdict .btn.primary');
  }
  await page.waitForSelector('#screen-result:not([hidden])');
  check((await page.textContent('#screen-result')).includes('ещё 1 знак'), 'после ошибки знак остаётся в повторении на сегодня');
  await page.click('#screen-result .btn.primary:has-text("Продолжить повторение")');
  await answerCard(page); await page.click('#card .verdict .btn.primary');
  await page.waitForSelector('#screen-result:not([hidden])');
  check((await page.textContent('#screen-result')).includes('Повторение на сегодня выполнено'), 'повторение на сегодня выполнено');
  await page.click('#screen-result .btn:has-text("На главный экран")');
  const home2 = await page.textContent('#screen-home');
  check(home2.includes('Повторение на сегодня выполнено') && /завтра \d/.test(home2), 'на «Сегодня»: повторение выполнено, прогноз на завтра');
  const st2 = await page.evaluate(() => Object.fromEntries([...__kana.srsState().values()].map(s => [s.k, [s.box, Math.round((s.due - Date.now()) / 864e5)]])));
  check(st2['き'][0] === 3 && st2['き'][1] >= 3, 'き перешёл в коробку 3 (через 4 дня)');
  await page.screenshot({ path: SHOTS + '/srs-done.png', fullPage: true });

  // --- квиз на слух: знаки ---
  await openQuizSetup(page);
  await page.click('#sel-script .opt:has(.t:text-is("Хирагана"))');
  await page.click('#sel-mode .opt:has(.t:text-is("На слух"))');
  check(await page.isHidden('#lenient-wrap'), 'для квиза на слух настройка строгости рисунка скрыта');
  await page.click('#btn-start');
  await page.waitForSelector('#card .choices');
  await page.waitForTimeout(400);
  const c0 = await page.evaluate(() => ({ kana: __kana.Q.deck[0].kana, opts: [...document.querySelectorAll('#card .choice')].map(b => b.dataset.k) }));
  check(c0.opts.length === 4 && c0.opts.includes(c0.kana), '4 варианта, среди них верный: ' + c0.opts.join(' '));
  const sounds = await page.evaluate(o => o.map(k => displayReading(k, 'lat')), c0.opts);
  check(new Set(sounds).size === 4, 'все варианты звучат по-разному: ' + sounds.join(' '));
  check(audio.includes('m/' + c0.kana + '.mp3'), 'знак прозвучал сам: ' + c0.kana);
  check(await page.locator('#card .prompt span.big, #card .prompt span.kana').count() === 0, 'знак и чтение до ответа не показаны');
  await page.screenshot({ path: SHOTS + '/listen-card.png', fullPage: true });
  await answerCard(page, true);
  check((await page.textContent('#card .verdict')).includes('Вы выбрали'), 'при ошибке показано, что выбрано');
  const last = await page.evaluate(() => KanaApp.items().filter(i => i.c === 'answers').map(i => i.data).sort((a, b) => a.ts - b.ts).pop());
  check(last.m === 'listen' && last.r === 'bad' && !!last.x && last.x !== last.k, 'в историю записан ответ на слух и с чем перепутан');
  await page.screenshot({ path: SHOTS + '/listen-wrong.png', fullPage: true });
  await page.click('#card .verdict .btn.primary');
  // выбор с клавиатуры
  const k1 = await page.evaluate(() => document.querySelector('#card .choice').dataset.k);
  await page.keyboard.press('1');
  await page.waitForSelector('#card .verdict');
  const res1 = await page.evaluate(() => __kana.Q.results[1]);
  check(res1 && res1.chosen === k1, 'клавиша 1 выбирает первый вариант');
  await page.click('#btn-quit');

  // --- квиз на слух: слова ---
  await page.click('#tab-practice'); await page.click('#tab-practice');
  await page.click('#screen-practice .cta:has-text("Аудирование")');
  await page.click('#sel-script .opt:has(.t:text-is("Слова"))');
  await page.click('#btn-start');
  await page.waitForSelector('#card .choices.word');
  await page.waitForTimeout(400);
  const w0 = await page.evaluate(() => __kana.Q.deck[0].kana);
  check(audio.includes('words/m/' + w0 + '.mp3'), 'слово прозвучало: ' + w0);
  check(await page.locator('#card .choice').count() === 4, 'у слова 4 варианта');
  await answerCard(page);
  check((await page.textContent('#card .vtitle')) === 'Верно', 'слово узнано на слух');
  await page.screenshot({ path: SHOTS + '/listen-word.png', fullPage: true });
  await page.click('#btn-quit');

  // --- похожие знаки ---
  await practiceHub(page);
  await page.click('#screen-practice .cta:has-text("Похожие знаки")');
  await page.waitForSelector('#screen-similar .simg');
  check((await page.textContent('#screen-similar .simconf')).includes('ぬ · め'), 'в «Чаще всего путаете» — пара ぬ · め');
  await page.screenshot({ path: SHOTS + '/similar.png', fullPage: true });
  await page.click('#screen-similar .segm button:has-text("Катакана")');
  await page.click('#screen-similar .ghead .link');           // снять все
  check(await page.isDisabled('#btn-sim-start'), 'без групп начать нельзя');
  await page.click('#screen-similar .simg:has-text("シ ツ ソ ン")');
  await page.click('#screen-similar .segm[aria-label="Карточек"] button:text-is("10")');
  await page.click('#btn-sim-start');
  await page.waitForSelector('#card .choices');
  check((await page.textContent('#ctr')) === '1 / 10', '10 карточек');
  const deck = await page.evaluate(() => [...new Set(__kana.Q.deck.map(i => i.kana))].sort().join(''));
  check(deck === [...'シツソン'].sort().join(''), 'в колоде все знаки группы シツソン');
  for (let i = 0; i < 10; i++) {
    const opts = await page.evaluate(() => [...document.querySelectorAll('#card .choice')].map(b => b.dataset.k).sort().join(''));
    if (i === 0) check(opts === deck, 'варианты — вся группа');
    await answerCard(page, i === 1);
    if (i === 1) {
      check((await page.textContent('#card .verdict')).includes('Как различать'), 'после ошибки — подсказка, как различать');
      await page.screenshot({ path: SHOTS + '/similar-wrong.png', fullPage: true });
    }
    await page.click('#card .verdict .btn.primary');
  }
  await page.waitForSelector('#screen-result:not([hidden])');
  check((await page.textContent('#screen-result')).includes('9 из 10'), 'итог 9 из 10');
  check(await page.locator('#screen-result .btn:has-text("Ещё раз")').count() === 1, 'есть «Ещё раз»');
  await page.click('#screen-result .btn:has-text("К выбору групп")');
  check(await page.isVisible('#screen-similar'), 'возврат к выбору групп');
  // пары из «Чаще всего путаете»
  await page.click('#screen-similar .segm button:has-text("Хирагана")');
  await page.click('#screen-similar .simconf .btn');
  await page.waitForSelector('#card .choices');
  const pair = await page.evaluate(() => __kana.Q.deck[0].group.slice().sort().join(''));
  check(pair === [...'ぬめ'].sort().join(''), 'тренировка путаницы ぬ/め');
  await page.screenshot({ path: SHOTS + '/similar-card.png', fullPage: true });

  // тёмная тема
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: SHOTS + '/similar-dark.png', fullPage: true });
  await browser.close();
  console.log(failed ? `\nПровалено проверок: ${failed}` : '\nВсе проверки пройдены');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
