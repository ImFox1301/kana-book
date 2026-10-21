// Общие шаги для сквозных проверок
async function ready(page) {
  await page.waitForSelector('#screen-onboard:not([hidden]), #screen-home:not([hidden])');
  if (await page.isVisible('#screen-onboard')) await page.click('#screen-onboard .btn.primary');
  await page.waitForSelector('#screen-home:not([hidden])');
}
async function practiceHub(page) { await page.click('#tab-practice'); if (!(await page.isVisible('#screen-practice'))) await page.click('#tab-practice'); }
async function openQuizSetup(page) { await practiceHub(page); await page.click('#screen-practice .cta:has-text("Квиз")'); await page.waitForSelector('#btn-start'); }
async function openAbc(page) { await practiceHub(page); await page.click('#screen-practice .cta:has-text("Азбука")'); await page.waitForSelector('#abc .abc-cell'); }
module.exports = { ready, practiceHub, openQuizSetup, openAbc };
