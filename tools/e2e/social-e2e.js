// Сквозная проверка: гость без прогресса, вход и привязка телефона через Telegram-бота, друзья.
// Локально — с заглушкой API (serve.js); в CI — с настоящим kana-api и поддельным Telegram (fake-telegram.js):
//   TG_CTRL=http://127.0.0.1:8792 node tools/e2e/social-e2e.js http://localhost:8790
const { chromium } = require('playwright');
const { ready, signup } = require('./common.js');
const BASE = process.argv[2] || 'http://localhost:8790';
const TG = process.env.TG_CTRL || BASE;
const SHOTS = process.env.SHOTS || '/tmp';
let failed = 0;
const check = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) failed++; };
const sfx = Math.random().toString(36).slice(2, 7);
const tgIds = { ivan: 5_100_000_000 + Math.floor(Math.random() * 1e6), maria: 5_200_000_000 + Math.floor(Math.random() * 1e6), oleg: 5_300_000_000 + Math.floor(Math.random() * 1e6) };

// «написать боту»
async function bot(update) {
  const r = await fetch(TG + '/__tg/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(update) });
  if (!r.ok) throw new Error('бот: ' + r.status);
}
const from = (id, first, username) => ({ id, is_bot: false, first_name: first, username });
const msg = (id, extra) => ({ message: Object.assign({ message_id: 1, date: 0, chat: { id, type: 'private' }, from: from(id, extra.first || 'Иван', extra.username) }, extra.body) });
const start = (id, nonce, first, username) => bot(msg(id, { first, username, body: { text: '/start ' + nonce } }));
const contact = (id, owner, first, username) => bot(msg(id, { first, username, body: { contact: { phone_number: '+79001112233', first_name: first || 'Иван', user_id: owner } } }));
const press = (id, data) => bot({ callback_query: { id: 'q' + Date.now(), from: from(id, 'Иван'), data, message: { message_id: 5, chat: { id, type: 'private' } } } });

async function device(browser, name) {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 860 } });
  await ctx.route('https://t.me/**', r => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>Telegram</p>' }));   // ссылку на бота «открываем» без сети
  const page = await ctx.newPage();
  page.on('pageerror', e => { console.log(`[${name}] ошибка страницы: ${e.message}`); failed++; });
  return { ctx, page };
}
// нажать «через Telegram» и вернуть nonce из ссылки
async function openBot(page, sel) {
  await page.waitForSelector(sel + '[href*="start="]');
  const href = await page.getAttribute(sel, 'href');
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.click(sel)]);
  await popup.close();
  return new URL(href).searchParams.get('start');
}

(async () => {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});

  // --- гость: тренировки есть, прогресса нет ---
  const G = await device(browser, 'гость');
  await G.page.goto(BASE + '/');
  await G.page.waitForSelector('#btn-guest');
  await G.page.screenshot({ path: SHOTS + '/welcome.png', fullPage: true });
  await G.page.click('#btn-guest');
  const home = await G.page.textContent('#screen-home');
  check(home.includes('Создать аккаунт') && !home.includes('Занятия'), 'гость: на «Сегодня» — приглашение войти, без цели дня');
  check(await G.page.locator('#screen-home .cta').count() >= 5, 'гость: тренировки доступны');
  await G.page.click('#tab-lessons');
  check((await G.page.textContent('#screen-lessons')).includes('доступны с аккаунтом') && await G.page.locator('#screen-lessons .lrow').count() === 5, 'гость: уроки закрыты, чтение в поездке открыто');
  await G.page.click('#tab-me'); await G.page.click('#btn-settings');
  check(!(await G.page.textContent('#settings')).includes('Цель') && !(await G.page.textContent('#settings')).includes('Напоминания'), 'гость: в настройках нет цели и напоминаний');
  await G.page.click('#tab-dict');
  check(await G.page.isVisible('#dict-guest') && await G.page.isHidden('#add-panel') && await G.page.isHidden('#import-panel') && await G.page.isHidden('#backup-panel'), 'гость: добавление, импорт и копия слов — только с аккаунтом');
  check(await G.page.locator('#wlist .del').count() === 0, 'гость: удалять слова нельзя');
  await G.page.click('#tab-me');
  check(await G.page.isHidden('#stats'), 'гость: в «Я» нет прогресса');
  check(!/null|undefined/.test(await G.page.textContent('#screen-me')), 'гость: в «Я» нет «null» и «undefined»');
  check(await G.page.evaluate(() => document.querySelector('#tab-friends').hidden), 'гость: вкладки «Друзья» нет');
  check(await G.page.isHidden('#streak'), 'гость: серии дней нет');
  await G.page.screenshot({ path: SHOTS + '/guest-me.png', fullPage: true });

  // --- Иван: регистрация через Telegram ---
  const A = await device(browser, 'Иван');
  await A.page.goto(BASE + '/');
  await A.page.click('#btn-welcome-register');
  await A.page.waitForSelector('#screen-register .tgunder:not([hidden]) #btn-tg-login');
  await A.page.screenshot({ path: SHOTS + '/register-tg.png', fullPage: true });
  let nonce = await openBot(A.page, '#btn-tg-login');
  await A.page.waitForSelector('#tg-status');
  check((await A.page.textContent('#tg-status')).includes('Ждём'), 'Иван: ждём ответа бота');
  await start(tgIds.ivan, nonce, 'Иван', 'ivan_' + sfx);
  await A.page.waitForFunction(() => (document.querySelector('#tg-status') || {}).textContent?.includes('Поделиться номером'));
  check(true, 'Иван: бот просит номер — приложение подсказывает');
  await contact(tgIds.ivan, 42, 'Иван', 'ivan_' + sfx);   // чужой контакт — не принимается
  await A.page.waitForTimeout(2500);
  check(await A.page.isVisible('#screen-register'), 'Иван: чужой номер не принят');
  await contact(tgIds.ivan, tgIds.ivan, 'Иван', 'ivan_' + sfx);
  await A.page.waitForSelector('#screen-onboard:not([hidden]) .btn.primary', { timeout: 15000 });
  check(true, 'Иван: вход выполнен — настройка цели');
  await A.page.click('#screen-onboard .btn.primary');
  await A.page.waitForSelector('#screen-home:not([hidden])');
  check((await A.page.textContent('#screen-home')).includes('Урок 1.'), 'Иван: уроки и цель открыты');
  check(await A.page.evaluate(() => !document.querySelector('#tab-friends').hidden), 'Иван: телефон привязан — вкладка «Друзья» есть');
  await A.page.click('#tab-me');
  check((await A.page.textContent('#account-box .who')) === 'Иван' && (await A.page.textContent('#account-box')).includes('Телефон привязан'), 'Иван: имя из Telegram, телефон привязан');

  // --- Мария: логин и пароль, потом привязка телефона ---
  const B = await device(browser, 'Мария');
  await B.page.goto(BASE + '/');
  await B.page.waitForSelector('#btn-guest');
  const maria = await signup(B.page, { name: 'Мария', user: 'maria_' + sfx });
  check(await B.page.evaluate(() => !document.querySelector('#tab-friends').hidden), 'Мария: «Друзья» доступны и без привязки телефона');
  await B.page.click('#tab-me');
  await B.page.click('#btn-link-start');
  nonce = await openBot(B.page, '#btn-tg-link');
  await start(tgIds.maria, nonce, 'Маша');
  await contact(tgIds.maria, tgIds.maria, 'Маша');
  await B.page.waitForFunction(() => document.querySelector('#account-box').textContent.includes('Телефон привязан'), null, { timeout: 15000 });
  check(true, 'Мария: телефон привязан');
  check((await B.page.textContent('#account-box .who')) === 'Мария', 'Мария: имя осталось своё');

  // --- приглашение ссылкой: Иван → Мария ---
  await A.page.click('#tab-me'); await A.page.click('#me-friends');
  await A.page.waitForSelector('#screen-friends .btn:has-text("Пригласить по ссылке")');
  check((await A.page.textContent('#screen-friends')).includes('Пока никого'), 'Иван: друзей пока нет');
  await A.page.evaluate(() => { navigator.share = undefined; navigator.clipboard.writeText = async () => { }; });
  await A.page.click('#screen-friends .btn:has-text("Пригласить по ссылке")');
  await A.page.waitForSelector('#invite-url');
  const inviteUrl = await A.page.textContent('#invite-url');
  check(/#invite=[\w-]+$/.test(inviteUrl), 'Иван: ссылка-приглашение создана');
  await A.page.screenshot({ path: SHOTS + '/friends-empty.png', fullPage: true });
  await B.page.goto(inviteUrl.replace(/^https?:\/\/[^/]+/, BASE));
  await B.page.waitForSelector('#invite-card');
  check((await B.page.textContent('#invite-card')).includes('Иван'), 'Мария: видит приглашение от Ивана');
  await B.page.screenshot({ path: SHOTS + '/invite.png', fullPage: true });
  await B.page.click('#btn-invite-accept');
  await B.page.waitForSelector('#screen-friends .fcard');
  check((await B.page.textContent('#screen-friends .fcard')).includes('Иван'), 'Мария: Иван в друзьях');
  await A.page.click('#tab-home'); await A.page.click('#tab-me'); await A.page.click('#me-friends');
  await A.page.waitForSelector('#screen-friends .fcard');
  check((await A.page.textContent('#screen-friends .fcard')).includes('Мария'), 'Иван: Мария в друзьях');

  // --- поиск по логину и заявка: Олег → Иван ---
  const C = await device(browser, 'Олег');
  await C.page.goto(BASE + '/'); await C.page.waitForSelector('#btn-guest');
  await signup(C.page, { name: 'Олег', user: 'oleg_' + sfx });
  // фото профиля с устройства
  await C.page.click('#tab-me');
  const png = require('path').resolve(__dirname, '../../assets/icons/kana-icon-192.png');
  await C.page.setInputFiles('#avatar-file', png);
  await C.page.waitForSelector('#btn-avatar img');
  check(await C.page.isVisible('#btn-avatar-del'), 'Олег: фото профиля загружено');
  await C.page.screenshot({ path: SHOTS + '/me-avatar.png', fullPage: true });
  await C.page.click('#tab-me'); await C.page.click('#me-friends');
  await C.page.fill('#friend-q', 'ivan_' + sfx.slice(0, 2));
  await C.page.click('#btn-friend-search');
  await C.page.waitForSelector('#screen-friends .err');
  check(true, 'Олег: по части логина не находит');
  await C.page.fill('#friend-q', '@ivan_' + sfx);
  await C.page.click('#btn-friend-search');
  await C.page.waitForSelector('#found');
  check((await C.page.textContent('#found')).includes('Иван'), 'Олег: нашёл Ивана по логину');
  await C.page.click('#found .btn');
  await C.page.waitForSelector('#friends-msg');
  check((await C.page.textContent('#screen-friends')).includes('Ждут ответа'), 'Олег: заявка отправлена');
  await A.page.reload(); await A.page.waitForSelector('#me-dot:not([hidden])', { timeout: 10000 });
  check(true, 'Иван: на вкладке «Друзья» отметка о заявке');
  // нажатие на уведомление при открытом приложении: service worker присылает { type: 'open', url }
  await A.page.click('#tab-home');
  await A.page.evaluate(() => navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'open', url: location.origin + '/#friends' } })));
  await A.page.waitForSelector('#screen-friends:not([hidden]) #incoming');
  check(true, 'Иван: уведомление открывает экран с заявкой');
  await A.page.click('#incoming .btn:has-text("Принять")');
  await A.page.waitForFunction(() => document.querySelectorAll('#screen-friends .fcard').length === 2);
  check(await A.page.isHidden('#me-dot'), 'Иван: заявка принята, двое друзей');
  await A.page.waitForFunction(() => [...document.querySelectorAll('#screen-friends .fcard')].some(c => c.textContent.includes('Олег') && c.querySelector('.ava img') && c.querySelector('.ava img').naturalWidth > 0));
  check(true, 'Иван: у Олега в карточке его фото');
  await A.page.screenshot({ path: SHOTS + '/friends.png', fullPage: true });

  // --- повторный вход через Telegram: без номера, кнопкой «Войти» ---
  await A.page.click('#tab-me');
  await A.page.click('#account-box >> text=Выйти'); await A.page.click('#account-box .btn.primary:has-text("Выйти")');
  await A.page.waitForSelector('#btn-to-login');
  await A.page.click('#btn-to-login');
  nonce = await openBot(A.page, '#btn-tg-login');
  await start(tgIds.ivan, nonce, 'Иван', 'ivan_' + sfx);
  await A.page.waitForFunction(() => (document.querySelector('#tg-status') || {}).textContent?.includes('Подтвердите'));
  check(true, 'Иван: бот просит подтвердить вход');
  await start(tgIds.ivan, nonce, 'Иван', 'ivan_' + sfx);   // ссылку открыли ещё раз
  const sent = await (await fetch(TG + '/__tg/sent')).json();
  const last = (sent.result || sent).filter(m => m.chat_id === tgIds.ivan).pop();
  check(last && /Войти/.test(last.text) && !/устарела/.test(last.text), 'Иван: повторный /start — бот снова спрашивает, а не «ссылка устарела»: ' + (last && last.text));
  // приложение перезапустилось, пока человек в Telegram, — вход продолжается сам
  await A.page.reload();
  await A.page.waitForSelector('#screen-login:not([hidden]) #tg-status');
  check(true, 'Иван: после перезагрузки приложение ждёт подтверждения');
  await press(tgIds.ivan, 'ok:' + nonce);
  await A.page.waitForSelector('#account-box .who', { timeout: 15000 });
  check((await A.page.textContent('#account-box .who')) === 'Иван', 'Иван: снова вошёл в свой аккаунт');

  // гость с приглашением — сначала регистрация
  const D = await device(browser, 'гость 2');
  await D.page.goto(inviteUrl.replace(/^https?:\/\/[^/]+/, BASE));
  await D.page.waitForSelector('#screen-register:not([hidden])');
  check(true, 'гость по приглашению попадает на регистрацию');

  await browser.close();
  console.log(failed ? `\nПровалено проверок: ${failed}` : '\nВсе проверки пройдены');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
