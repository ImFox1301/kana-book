// Сквозная проверка синхронизации: два «устройства» (два независимых профиля браузера) и один аккаунт.
// Запуск: node tools/e2e/serve.js & node tools/e2e/sync-e2e.js http://localhost:8790
const { chromium } = require('playwright');
const { ready, openQuizSetup } = require('./common.js');
const BASE = process.argv[2] || 'http://localhost:8790';
const user = 'e2e_' + Math.random().toString(36).slice(2, 8), pass = 'kana-pass-123';
let failed = 0;
const check = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) failed++; };

async function device(browser, name) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => { console.log(`[${name}] ошибка страницы: ${e.message}`); failed++; });
  await page.goto(BASE + '/');
  await ready(page);
  return { ctx, page };
}
const words = page => page.evaluate(() => KanaApp.items().filter(i => i.c === 'words').map(i => i.data.kana));
const answers = page => page.evaluate(() => KanaApp.items().filter(i => i.c === 'answers').length);
async function synced(page) {
  await page.evaluate(() => KanaSync.syncNow());
  await page.waitForFunction(() => !document.querySelector('#account-box')?.textContent.includes('Синхронизация…'), null, { timeout: 15000 });
}
async function addWord(page, kana, mean) {
  await page.click('#tab-dict');
  await page.click('#add-panel summary');
  await page.fill('#add-kana', kana); await page.fill('#add-mean', mean); await page.fill('#add-topic', 'Тест');
  await page.click('#add-form button[type=submit]');
}
async function answerCards(page, n) {
  await openQuizSetup(page);
  await page.click('#btn-start');
  for (let i = 0; i < n; i++) { await page.click('text=Пропустить'); await page.click('#card .btn.primary'); }
  await page.click('#btn-quit');
}

(async () => {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});

  // Устройство A: без аккаунта добавляет слово (словарь доступен и гостю), ответы гостя не сохраняются;
  // после регистрации слово уходит в аккаунт
  const A = await device(browser, 'A');
  check(await A.page.evaluate(() => KanaSync.account === null), 'A: без входа приложение работает, аккаунта нет');
  await answerCards(A.page, 2);
  check(await answers(A.page) === 0 && await A.page.evaluate(() => !localStorage.getItem('kana-tetrad:answers') || localStorage.getItem('kana-tetrad:answers') === '[]'), 'A: ответы гостя не хранятся');
  await A.page.click('#tab-me');
  check(await A.page.isHidden('#stats'), 'A: у гостя нет раздела прогресса');
  check(await A.page.isVisible('#me-login #acc-user') && await A.page.isVisible('#btn-to-register'), 'A: в профиле — форма входа и «Создать»');
  await A.page.click('#btn-to-register');
  check(await A.page.isVisible('#screen-register') && await A.page.isVisible('#acc-name'), 'A: регистрация — отдельный экран с полем «Как к вам обращаться»');
  await A.page.screenshot({ path: (process.env.SHOTS || '/tmp') + '/register.png', fullPage: true });
  await A.page.fill('#acc-user', user); await A.page.fill('#acc-pass', pass);
  await A.page.evaluate(() => { document.querySelector('#acc-name').required = false; });
  await A.page.click('#screen-register button[type=submit]');
  await A.page.waitForSelector('#screen-register .err');
  check((await A.page.textContent('#screen-register .err')).includes('как к вам обращаться'), 'A: без имени не регистрирует');
  check(await A.page.inputValue('#acc-user') === user, 'A: введённое не теряется после ошибки');
  await A.page.fill('#acc-name', 'Павел');
  await A.page.click('#screen-register button[type=submit]');
  await A.page.waitForSelector('#screen-onboard:not([hidden]) .btn.primary');
  check(true, 'A: после регистрации — настройка цели');
  await A.page.click('#screen-onboard .btn.primary');
  await addWord(A.page, 'ねこ', 'кошка');
  await answerCards(A.page, 3);
  await A.page.click('#tab-me');
  await A.page.waitForSelector('#account-box .who');
  check((await A.page.textContent('#account-box .who')) === 'Павел' && (await A.page.textContent('#account-box')).includes('@' + user), 'A: показано имя и логин');
  await synced(A.page);
  check((await A.page.textContent('#account-box')).includes('Синхронизировано'), 'A: зарегистрирован и синхронизирован');
  await A.page.click('#btn-edit-name'); await A.page.fill('#acc-name-edit', 'Паша'); await A.page.click('#account-box form button[type=submit]');
  await A.page.waitForFunction(() => document.querySelector('#account-box .who')?.textContent === 'Паша');
  check(true, 'A: имя можно изменить');

  // Устройство B: входит в тот же аккаунт и получает всё
  const B = await device(browser, 'B');
  check((await words(B.page)).length === 0, 'B: до входа своих слов нет');
  await B.page.click('#tab-me');
  check(await B.page.isVisible('#me-login') && !(await B.page.isVisible('#acc-name')), 'B: в профиле форма входа, без поля имени');
  await B.page.fill('#acc-user', user); await B.page.fill('#acc-pass', pass);
  await B.page.click('#me-login button[type=submit]');
  await B.page.waitForSelector('#account-box .who');
  check((await B.page.textContent('#account-box .who')) === 'Паша', 'B: имя пришло с аккаунтом');
  await synced(B.page);
  check((await words(B.page)).includes('ねこ'), 'B: слово с устройства A пришло');
  check(await answers(B.page) === 3, 'B: история ответов пришла (3)');

  // Изменения в обе стороны
  await addWord(B.page, 'いぬ', 'собака');
  await synced(B.page);
  await synced(A.page);
  check((await words(A.page)).includes('いぬ'), 'A: слово с устройства B пришло');
  await A.page.click('#tab-dict');
  await A.page.click('button[aria-label="Удалить ねこ"]');
  await synced(A.page);
  await synced(B.page);
  check(!(await words(B.page)).includes('ねこ'), 'B: удаление с устройства A применилось');

  // Перезагрузка: сессия и данные сохраняются
  await B.page.reload(); await ready(B.page);
  await B.page.click('#tab-me'); await B.page.waitForSelector('#account-box .who');
  check(true, 'B: после перезагрузки остаётся в аккаунте');

  // Выход: данные остаются в аккаунте, устройство очищается
  await A.page.click('#tab-me');
  await A.page.click('#account-box >> text=Выйти');
  await A.page.click('dialog.dlg .btn:has-text("Выйти")');
  await A.page.waitForSelector('#me-login');
  check((await words(A.page)).length === 0 && await answers(A.page) === 0, 'A: после выхода устройство очищено');
  await synced(B.page);
  check((await words(B.page)).includes('いぬ') && await answers(B.page) === 3, 'B: в аккаунте всё на месте');

  // Неверный пароль
  await A.page.fill('#acc-user', user); await A.page.fill('#acc-pass', 'wrong-pass-1');
  await A.page.click('#me-login button[type=submit]');
  await A.page.waitForSelector('#me-login .err:not([hidden])');
  check((await A.page.textContent('#me-login .err')).includes('Неверный'), 'A: неверный пароль — понятная ошибка');
  await A.page.screenshot({ path: (process.env.SHOTS || '/tmp') + '/login-error.png', fullPage: true });

  await B.page.screenshot({ path: process.env.SHOT || '/tmp/kana-e2e.png', fullPage: true });
  await browser.close();
  console.log(failed ? `\nПровалено проверок: ${failed}` : '\nВсе проверки пройдены');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
