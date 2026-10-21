// Сквозная проверка этапа 4: конструктор предложений и напоминания.
// Запуск: node tools/e2e/serve.js & node tools/e2e/stage4-e2e.js http://localhost:8790
const { chromium } = require('playwright');
const { ready, practiceHub } = require('./common.js');
const BASE = process.argv[2] || 'http://localhost:8790';
const SHOTS = process.env.SHOTS || '/tmp';
let failed = 0;
const check = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) failed++; };

// собрать текущую фразу: верно или переставив первые два блока
async function build(page, wrong) {
  const parts = await page.evaluate(() => __kana.Q.deck[__kana.Q.i].parts);
  const order = wrong ? [parts[1], parts[0], ...parts.slice(2)] : parts;
  for (const t of order) await page.locator(`#card .bbank .btok[data-t="${t}"]:not([disabled])`).first().click();
  await page.click('#card .actions .btn.primary');
  await page.waitForSelector('#card .verdict');
  return parts;
}

(async () => {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const ctx = await browser.newContext({ viewport: { width: 400, height: 860 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => { console.log('ошибка страницы: ' + e.message); failed++; });
  const audio = [];
  page.on('response', r => { if (r.url().includes('/audio/')) audio.push([decodeURIComponent(r.url().split('/audio/')[1]), r.status()]); });
  await page.goto(BASE + '/'); await ready(page, { account: true });

  // --- конструктор предложений ---
  await practiceHub(page);
  await page.click('#screen-practice .cta:has-text("Конструктор")');
  await page.waitForSelector('#screen-builder .blevel');
  check(await page.locator('#screen-builder .blevel').count() === 6, '6 уровней');
  await page.click('#screen-builder .blevel:nth-child(2) .lrow');
  check((await page.textContent('#screen-builder .blevel:nth-child(2) .blevel-intro')).includes('ですか'), 'у уровня «Вопросы» есть объяснение конструкции');
  await page.screenshot({ path: SHOTS + '/builder.png', fullPage: true });
  await page.click('#screen-builder .blevel:nth-child(2) .blevel-intro .btn');
  await page.waitForSelector('#card .bbank');
  const info = await page.evaluate(() => { const it = __kana.Q.deck[0]; return { n: __kana.Q.deck.length, parts: it.parts, bank: [...document.querySelectorAll('#card .bbank .btok')].map(b => b.dataset.t) }; });
  check(info.n === 8, '8 фраз в уровне');
  check(info.bank.length === info.parts.length + 2 && info.parts.every(p => info.bank.includes(p)), 'в банке все блоки фразы и 2 лишних');
  await page.click('#card .actions .btn.primary');
  check((await page.textContent('#card .msg')).includes('Соберите'), 'пустую фразу проверить нельзя');
  // убрать блок из собранного
  await page.locator('#card .bbank .btok').first().click();
  check(await page.locator('#card .btray .btok').count() === 1, 'блок переходит в строку');
  await page.locator('#card .btray .btok').first().click();
  check(await page.locator('#card .btray .btok').count() === 0, 'нажатие возвращает блок');
  await page.screenshot({ path: SHOTS + '/builder-card.png', fullPage: true });
  await build(page, true);
  check((await page.textContent('#card .vtitle')) === 'Неверно', 'неправильный порядок — неверно');
  check(await page.locator('#card .bline.mine .btok.bad').count() >= 1, 'неверные блоки подсвечены');
  const rd = await page.textContent('#card .correct-reading');
  check(/ ва /.test(rd), 'частица は читается «ва»: ' + rd);
  await page.click('#card .say'); await page.waitForTimeout(400);
  check(audio.some(([f, s]) => f.startsWith('words/m/') && s === 200), 'фраза озвучена');
  await page.screenshot({ path: SHOTS + '/builder-wrong.png', fullPage: true });
  await page.click('#card .verdict .btn.primary');
  for (let i = 1; i < 8; i++) { await build(page); await page.click('#card .verdict .btn.primary'); }
  await page.waitForSelector('#screen-result:not([hidden])');
  check((await page.textContent('#screen-result')).includes('Вопросы: 88%'), 'итог уровня 88%');
  const hist = await page.evaluate(() => KanaApp.items().filter(i => i.c === 'answers' && i.data.m === 'build').map(i => i.data.w));
  check(hist.length === 8 && hist.every(w => w === 1), 'ответы записаны как фразы');
  // ошибочная фраза — в повторении, тоже конструктором
  const rev = await page.evaluate(() => { __kana.startReview(); return __kana.Q.deck.map(i => i.mode); });
  check(rev.includes('build'), 'ошибка — в повторении, в режиме конструктора');
  await page.click('#btn-quit');
  await page.click('#tab-practice'); await page.click('#tab-practice');
  await page.click('#screen-practice .cta:has-text("Конструктор")');
  check((await page.textContent('#screen-builder')).includes('88%'), 'лучший результат уровня в списке');
  // другой верный порядок принимается
  await page.click('#screen-builder .blevel:nth-child(6) .lrow');
  await page.click('#screen-builder .blevel:nth-child(6) .blevel-intro .btn');
  await page.waitForSelector('#card .bbank');
  const alt = await page.evaluate(() => __kana.Q.deck[0].alts[0]);
  for (const t of alt) await page.locator(`#card .bbank .btok[data-t="${t}"]:not([disabled])`).first().click();
  await page.click('#card .actions .btn.primary');
  check((await page.textContent('#card .vtitle')) === 'Верно', 'другой порядок (где и что поменяны местами) засчитан');
  await page.click('#btn-quit');

  // --- напоминания ---
  // У headless-браузера нет push-сервиса: подписку подменяем, ключ — настоящая точка P-256 (её проверяет сервер)
  const crypto = require('crypto');
  const ec = crypto.createECDH('prime256v1'); ec.generateKeys();
  const fake = { p256dh: ec.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url'), endpoint: 'https://fcm.googleapis.com/fcm/send/e2e-' + crypto.randomBytes(6).toString('hex') };
  const pctx = await browser.newContext({ viewport: { width: 400, height: 860 } });
  await pctx.addInitScript(f => {
    let sub = null;
    const make = () => ({ endpoint: f.endpoint, toJSON: () => ({ endpoint: f.endpoint, keys: { p256dh: f.p256dh, auth: f.auth } }), unsubscribe: async () => { sub = null; return true; } });
    Object.defineProperty(Notification, 'permission', { get: () => 'granted' });
    Notification.requestPermission = async () => 'granted';
    PushManager.prototype.subscribe = async function (o) { window.__pushKey = o && o.applicationServerKey && o.applicationServerKey.length; sub = make(); return sub; };
    PushManager.prototype.getSubscription = async function () { return sub; };
  }, fake);
  const pp = await pctx.newPage();
  pp.on('pageerror', e => { console.log('ошибка страницы: ' + e.message); failed++; });
  const calls = [], logs = [];
  pp.on('request', r => { if (r.url().includes('/api/push/')) calls.push(r.url().split('/api/push/')[1]); });
  pp.on('console', m => { if (m.type() === 'warning' || m.type() === 'error') logs.push(m.text().slice(0, 200)); });
  const subRes = [];
  pp.on('response', async r => { if (r.url().includes('/api/push/subscribe')) subRes.push(r.status() + ' ' + (await r.text().catch(() => '')).slice(0, 200) + ' req=' + (r.request().postData() || '').slice(0, 300)); });
  await pp.goto(BASE + '/'); await ready(pp);
  await pp.click('#tab-me'); await pp.click('#btn-settings');
  check(await pp.locator('#set-notify').count() === 0, 'без входа пункта «Напоминания о занятиях» нет');
  await pp.click('#tab-me');
  await pp.click('#btn-to-register');
  await pp.fill('#acc-name', 'Тест'); await pp.fill('#acc-user', 'push_' + crypto.randomBytes(3).toString('hex')); await pp.fill('#acc-pass', 'secret-pass-1');
  await pp.click('#screen-register button[type=submit]');
  await pp.waitForSelector('#screen-onboard:not([hidden]) .btn.primary');
  // разрешение на уведомления спрашивается сразу после входа — ради заявок в друзья; напоминания при этом выключены
  await pp.waitForFunction(() => window.__pushKey === 65, null, { timeout: 10000 });
  const t0 = Date.now();
  await pp.waitForFunction(() => fetch('/api/push/prefs').then(r => r.json()).then(p => p.devices === 1), null, { timeout: 40000, polling: 500 }).catch(() => { });
  const waited = Date.now() - t0;
  let pr = await pp.evaluate(() => fetch('/api/push/prefs').then(r => r.json()));
  check(pr.devices === 1 && pr.enabled === false, 'после регистрации устройство подписано на уведомления, напоминания выключены: ' + JSON.stringify(pr) + ' ответы: ' + JSON.stringify(subRes) + ' запросы: ' + JSON.stringify(calls) + ' консоль: ' + JSON.stringify(logs) + ` (ждали ${waited} мс)`);
  await pp.click('#screen-onboard .btn.primary');
  await pp.click('#tab-me'); await pp.click('#btn-settings');
  await pp.waitForFunction(() => document.querySelector('#set-notify') && !document.querySelector('#set-notify').disabled);
  check(!(await pp.isChecked('#set-notify')), 'переключатель напоминаний выключен');
  await pp.click('#settings .tgl:has(#set-notify)');
  await pp.waitForSelector('#remind-time');
  check((await pp.textContent('#push-msg')).includes('напомним в 19:00'), 'напоминания включены на 19:00');
  check(await pp.evaluate(() => window.__pushKey) === 65, 'подписка с открытым ключом сервера (65 байт)');
  pr = await pp.evaluate(() => fetch('/api/push/prefs').then(r => r.json()));
  check(pr.enabled === true && pr.devices === 1 && pr.time === '19:00' && !!pr.tz, 'сервер: подписка есть, время и часовой пояс сохранены: ' + JSON.stringify(pr));
  await pp.fill('#remind-time', '08:30'); await pp.dispatchEvent('#remind-time', 'change');
  await pp.waitForFunction(() => document.querySelector('#push-msg').textContent.includes('08:30'));
  pr = await pp.evaluate(() => fetch('/api/push/prefs').then(r => r.json()));
  check(pr.time === '08:30', 'время изменено на 08:30');
  await pp.click('#btn-push-test');
  await pp.waitForFunction(() => !document.querySelector('#push-msg').textContent.includes('Отправляю'));
  check(calls.includes('test'), 'проверочное напоминание запрошено: ' + (await pp.textContent('#push-msg')));
  await pp.screenshot({ path: SHOTS + '/push-settings.png', fullPage: true });
  await pp.click('#settings .tgl:has(#set-notify)');
  await pp.waitForFunction(() => document.querySelector('#push-msg').textContent.includes('выключены'));
  pr = await pp.evaluate(() => fetch('/api/push/prefs').then(r => r.json()));
  // (с настоящим сервером «проверка» уходит в настоящий FCM, тот отвечает «нет такой подписки» и сервер её удаляет — поэтому число устройств не проверяем)
  check(pr.enabled === false && !calls.includes('unsubscribe'), 'напоминания выключены, а подписка для уведомлений о друзьях не снята');
  // выход из аккаунта снимает подписку этого устройства
  calls.length = 0;
  await pp.click('#tab-me');
  await pp.click('#account-box >> text=Выйти'); await pp.click('#account-box .btn.primary:has-text("Выйти")');
  await pp.waitForSelector('#btn-to-login');
  check(calls.includes('unsubscribe'), 'при выходе подписка снята');
  await pp.click('#tab-me'); await pp.click('#btn-settings');
  check(await pp.locator('#set-notify').count() === 0, 'после выхода пункта напоминаний нет');

  await browser.close();
  console.log(failed ? `\nПровалено проверок: ${failed}` : '\nВсе проверки пройдены');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
