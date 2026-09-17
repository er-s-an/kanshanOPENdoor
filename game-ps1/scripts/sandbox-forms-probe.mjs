import { chromium } from 'playwright-core';

const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1800, height: 900 } });
const msgs = [];
page.on('console', (m) => { if (/Blocked form submission/.test(m.text())) msgs.push(m.text().slice(0, 90)); });
await page.goto('http://localhost:8817/sandbox-test.html');
const frames = page.frames().filter((f) => f !== page.mainFrame());
console.log('iframes:', frames.length);
const labels = ['old sandbox (no allow-forms):', 'new sandbox (allow-forms):'];
for (let i = 0; i < frames.length; i += 1) {
  const f = frames[i];
  await f.waitForSelector('.investigation__search input', { timeout: 20000 });
  const input = await f.$('.investigation__search input');
  await input.fill('东方明珠');
  await input.press('Enter');
  await page.waitForTimeout(700);
  const fb = await f.evaluate(() => document.querySelector('[class*=feedback]')?.textContent ?? null);
  console.log(labels[i] ?? `iframe ${i}:`, JSON.stringify(fb));
}
console.log('blocked-submission console messages:', msgs.length);
await browser.close();
