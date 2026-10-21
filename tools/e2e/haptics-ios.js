// Проверка iPhone-отклика в эмуляции: нет Vibration API, есть <input switch> (iOS 18+).
const { chromium } = require('playwright');
const { ready } = require('./common.js');
(async () => {
  const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const ctx = await b.newContext({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'vibrate', { value: undefined, configurable: true });
    Object.defineProperty(HTMLInputElement.prototype, 'switch', { get() { return this.hasAttribute('switch'); }, configurable: true });
    window.__clicks = 0;
    const orig = HTMLElement.prototype.click;
    HTMLElement.prototype.click = function () { if (this.tagName === 'LABEL' && this.querySelector('input[switch]')) window.__clicks++; return orig.call(this); };
  });
  const p = await ctx.newPage();
  await p.goto(process.argv[2] || 'http://localhost:8790/'); await ready(p);
  await p.evaluate(() => __kana.buzz(true)); const one = await p.evaluate(() => __clicks);
  await p.evaluate(() => __kana.buzz(false)); await p.waitForTimeout(300); const three = await p.evaluate(() => __clicks);
  await p.click('#btn-settings'); const txt = await p.textContent('#settings'); const enabled = await p.isEnabled('#set-vibrate');
  const ok = one === 1 && three === 3 && txt.includes('Тактильный отклик') && enabled;
  console.log((ok ? 'ok   ' : 'FAIL ') + `iPhone: верно — ${one} щелчок, ошибка — ${three - one}; переключатель ${enabled ? 'доступен' : 'недоступен'}`);
  await b.close(); process.exit(ok ? 0 : 1);
})();
