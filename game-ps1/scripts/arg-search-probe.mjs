import { chromium } from 'playwright-core';

const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERR: ' + String(e)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
const base = process.argv[2] ?? 'http://localhost:8817';
const url = `${base}/arg/?scene=invest_desktop&story=${encodeURIComponent('蓝血-2025684191967294692')}`;
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(1500);
const input = await page.$('.investigation__search input');
console.log('search input found:', !!input);
if (input) {
  await input.fill('人的血为什么会变色');
  await input.press('Enter');
  await page.waitForTimeout(800);
  const feedback = await page.evaluate(() => document.querySelector('.investigation__search-feedback, [class*=feedback]')?.textContent ?? null);
  console.log('after Enter — feedback:', JSON.stringify(feedback));
  const btn = await page.$('button:has-text("搜索")');
  if (btn) { await btn.click(); await page.waitForTimeout(800); }
  const feedback2 = await page.evaluate(() => document.querySelector('.investigation__search-feedback, [class*=feedback]')?.textContent ?? null);
  console.log('after click — feedback:', JSON.stringify(feedback2));
  const bodyHas = await page.evaluate(() => document.body.textContent.includes('血液为什么会改变颜色'));
  console.log('result doc visible:', bodyHas);
}
console.log('errors:', errs.length, errs.slice(0, 5));
await browser.close();
