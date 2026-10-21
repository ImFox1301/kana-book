// Скриншоты основных экранов для сверки с макетами: node tools/e2e/shots.js http://localhost:8790 [папка] [mobile|desktop] [dark]
const { chromium } = require('playwright');
const { ready } = require('./common.js');
const BASE = process.argv[2] || 'http://localhost:8790';
const OUT = process.argv[3] || '/tmp/shots';
const DESK = process.argv[4] === 'desktop';
const DARK = process.argv[5] === 'dark';
require('fs').mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const ctx = await browser.newContext({ viewport: DESK ? { width: 1440, height: 1024 } : { width: 390, height: 844 }, deviceScaleFactor: DESK ? 1 : 2, colorScheme: DARK ? 'dark' : 'light' });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('ошибка страницы: ' + e.message));
  const shot = async (name, full = !DESK) => { await page.waitForTimeout(350); await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full }); console.log('снимок', name); };
  await page.goto(BASE + '/');
  await page.waitForSelector('#screen-onboard:not([hidden])');
  await shot('welcome', false);
  await page.click('#btn-guest'); await page.waitForSelector('#screen-home:not([hidden])');
  await shot('guest-home');
  await page.click('#btn-welcome-register').catch(() => { });
  await page.evaluate(() => __kana.show('register')); await shot('register', false);
  await page.evaluate(() => __kana.show('login')); await shot('login', false);
  await page.evaluate(() => __kana.show('home'));
  await page.evaluate(() => { localStorage.clear(); }); await page.goto(BASE + '/');
  await ready(page, { account: true, name: 'Алексей' });
  // немного истории: пройденный урок и ответы
  await page.evaluate(() => {
    const L = __kana.lessonsDone; L.h1 = { intro: true, write: true, quiz: 100, done: true }; L.h2 = { intro: true };
    for (let i = 0; i < 6; i++) { __kana.startQuiz([{ kind: 'kana', kana: 'あ' }, { kind: 'kana', kana: 'ぬ' }, { kind: 'kana', kana: 'め' }], 3, { mode: 'type' }); for (let j = 0; j < 3; j++) { __kana.finish({ it: __kana.Q.deck[j], status: j === 1 && i % 2 ? 'bad' : 'ok', answer: 'x' }); __kana.Q.i++; } }
    __kana.show('home');
  });
  await shot('home', false); await shot('home-full');
  await page.click('#tab-lessons'); await shot('lessons');
  await page.click('#screen-lessons .lrow.rec'); await shot('lesson');
  await page.click('#screen-lesson .stepc:nth-child(1) .btn'); await page.waitForSelector('#lintro .icard'); await shot('lintro');
  await page.click('#btn-iquit');
  await page.click('#tab-practice'); await shot('practice');
  await page.click('#screen-practice .cta:has-text("Квиз")'); await shot('setup');
  await page.click('#sel-mode .opt:has(.t:text-is("Обратный перевод"))'); await page.click('#btn-start'); await page.waitForSelector('#card #answer');
  await shot('quiz-type', false);
  await page.fill('#answer', 'zz'); await page.click('#card .actions .btn.primary'); await page.waitForSelector('#card .verdict'); await shot('verdict', false);
  await page.click('#btn-quit'); await shot('result');
  await page.evaluate(() => { __kana.S.mode = 'listen'; __kana.show('setup'); }); await page.click('#btn-start'); await page.waitForSelector('#card .choices'); await shot('listen', false);
  await page.click('#btn-quit');
  await page.evaluate(() => { __kana.S.mode = 'draw'; __kana.show('setup'); }); await page.click('#btn-start'); await page.waitForSelector('#card .pad'); await shot('draw', false);
  await page.click('#btn-quit');
  await page.evaluate(() => __kana.startSim([{ k: ['シ', 'ツ'] }], 4)); await page.waitForSelector('#card .choices'); await shot('similar-quiz', false); await page.click('#btn-quit');
  await page.evaluate(() => __kana.show('similar')); await shot('similar');
  await page.evaluate(() => __kana.show('builder')); await shot('builder');
  await page.evaluate(() => __kana.startBuilder(null)); await page.waitForSelector('#card .bbank'); await shot('builder-card', false); await page.click('#btn-quit');
  await page.evaluate(() => __kana.show('reading')); await shot('reading');
  await page.click('#screen-reading .lrow:has-text("Еда")'); await shot('reading-topic');
  await page.evaluate(() => __kana.show('abc')); await shot('abc');
  await page.click('#abc .segm button:has-text("Выбрать")'); await page.click('#abc .abc-row >> nth=0'); await shot('abc-select', false);
  await page.click('#abc-bar .btn.primary'); await page.waitForSelector('#write .pad'); await shot('write', false); await page.click('#btn-wquit');
  await page.click('#tab-dict'); await shot('dict');
  await page.click('#wlist .fav >> nth=0'); await page.click('#dict-tabs button:has-text("Избранное")'); await shot('dict-fav', false);
  await page.click('#dict-tabs button:has-text("Темы")'); await shot('dict-topics', false);
  await page.click('#dict-tabs button:has-text("Все")'); await page.click('#add-panel summary'); await shot('dict-add', false);
  await page.click('#tab-me'); await shot('me');
  await page.click('#btn-settings'); await shot('settings');
  await page.click('#btn-settings-back'); await page.click('#me-friends'); await page.waitForTimeout(500); await shot('friends');
  await page.evaluate(() => __kana.show('progress')); await shot('progress');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
