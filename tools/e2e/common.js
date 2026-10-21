// Общие шаги для сквозных проверок
const rnd = () => Math.random().toString(36).slice(2, 8);

// Дождаться запуска. Первый запуск без аккаунта — экран приветствия: по умолчанию «Продолжить без аккаунта»,
// с { account: true } — регистрация (уроки, прогресс и цель доступны только с аккаунтом).
async function ready(page, opts = {}) {
  await page.waitForSelector('#screen-onboard:not([hidden]), #screen-home:not([hidden])');
  if (await page.isVisible('#btn-guest')) {
    if (opts.account) return signup(page, opts);
    await page.click('#btn-guest');
  } else if (await page.isVisible('#screen-onboard')) await page.click('#screen-onboard .btn.primary');
  await page.waitForSelector('#screen-home:not([hidden])');
}

// Регистрация по логину и паролю. goal(page) — выбрать цель на экране настройки; иначе цель по умолчанию.
async function signup(page, { name = 'Тест', user = 'u_' + rnd(), pass = 'secret-pass-1', goal = null, stayOnboard = false } = {}) {
  await page.evaluate(() => __kana.show('register'));
  await page.fill('#acc-name', name); await page.fill('#acc-user', user); await page.fill('#acc-pass', pass);
  await page.click('#screen-register button[type=submit]');
  try { await page.waitForSelector('#screen-onboard:not([hidden]) .btn.primary', { timeout: 20000 }); }
  catch (e) {
    // что на экране — для разбора провала в CI
    const st = await page.evaluate(() => ({ screens: [...document.querySelectorAll('section:not([hidden])')].map(s => s.id), err: (document.querySelector('#screen-register .err') || {}).textContent, btn: (document.querySelector('#screen-register button[type=submit]') || {}).textContent, vals: [...document.querySelectorAll('#screen-register input')].map(i => i.id + '=' + i.value.length + (i.validity.valid ? '' : '!')), acct: localStorage.getItem('kana-tetrad:account') }));
    console.log('FAIL регистрация не завершилась: ' + JSON.stringify(st).replace(/\n/g, ' '));
    throw e;
  }
  if (stayOnboard) return { user, pass };
  if (goal) await goal(page);
  await page.click('#screen-onboard .btn.primary');
  await page.waitForSelector('#screen-home:not([hidden])');
  return { user, pass };
}

async function practiceHub(page) { await page.click('#tab-practice'); if (!(await page.isVisible('#screen-practice'))) await page.click('#tab-practice'); }
async function openQuizSetup(page) { await practiceHub(page); await page.click('#screen-practice .cta:has-text("Квиз")'); await page.waitForSelector('#btn-start'); }
async function openAbc(page) { await practiceHub(page); await page.click('#screen-practice .cta:has-text("Азбука")'); await page.waitForSelector('#abc .abc-cell'); }
module.exports = { ready, signup, practiceHub, openQuizSetup, openAbc };
