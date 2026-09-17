import { chromium } from 'playwright-core';

const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 140)); });
page.on('pageerror', (e) => errs.push('PAGEERR: ' + String(e).slice(0, 160)));
await page.goto('http://localhost:8817/sandbox-test.html');
const frame = page.frames().find((f) => f !== page.mainFrame());
await frame.waitForSelector('.investigation__search input', { timeout: 20000 });
await page.waitForTimeout(500);
// discover the two scene-02 clues through the search (same as the player)
const search = async (q) => {
  const input = await frame.$('.investigation__search input');
  await input.fill(q);
  await input.press('Enter');
  await page.waitForTimeout(700);
};
await search('指尖');
await search('镜子');
const toVerify = await frame.$('button:has-text("带着记录去核对")');
console.log('to-verify btn:', !!toVerify);
if (toVerify) { await toVerify.click(); await page.waitForTimeout(600); }
// tick the two correct checkboxes by their label text
const boxes = await frame.$$('.investigation__evidence label');
console.log('candidate rows:', boxes.length);
for (const row of boxes) {
  const text = await row.textContent();
  if (text.includes('你自己的红血') || text.includes('同事牙龈的蓝血')) {
    const cb = await row.$('input[type=checkbox]');
    await cb.click();
    await page.waitForTimeout(250);
  }
}
const sel = await frame.$eval('.investigation__verify-action span', (e) => e.textContent).catch(() => null);
console.log('selected label:', sel);
await frame.evaluate(() => {
  window.__submitted = null;
  document.addEventListener('submit', (e) => { window.__submitted = e.target.outerHTML.slice(0, 120); }, { capture: true });
  window.__clicks = [];
  document.addEventListener('click', (e) => { window.__clicks.push((e.target.textContent || e.target.tagName).slice(0, 40)); }, { capture: true });
});
const btn = await frame.$('button:has-text("用这些线索核对")');
const disabled = await btn.evaluate((b) => b.disabled).catch(() => null);
const btnInfo = await btn.evaluate((b) => ({ type: b.type, inForm: !!b.closest('form'), formClass: b.closest('form')?.className ?? null, rect: [b.getBoundingClientRect().x, b.getBoundingClientRect().y, b.getBoundingClientRect().width] }));
console.log('confirm disabled:', disabled, JSON.stringify(btnInfo));
if (btn && disabled === false) { await btn.click(); await page.waitForTimeout(1200); }
const submitted = await frame.evaluate(() => window.__submitted);
const clicks = await frame.evaluate(() => window.__clicks.slice(-4));
console.log('submit event:', JSON.stringify(submitted));
console.log('recent clicks:', JSON.stringify(clicks));
const ok = await frame.evaluate(() => document.body.textContent.includes('发生在同一间洗手间'));
const fail = await frame.evaluate(() => document.body.textContent.includes('再想一想'));
const verifiedView = await frame.evaluate(() => !!document.querySelector('.investigation__verified'));
console.log('verify success text:', ok, '| failed feedback:', fail, '| verified view:', verifiedView);
const count2 = await frame.evaluate(() => document.body.textContent.match(/记录\s*(\d+)/)?.[1]);
console.log('records after:', count2);
console.log('errors:', errs.length, errs.slice(0, 4));
await browser.close();
