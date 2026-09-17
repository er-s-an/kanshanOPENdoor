import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const dir = path.resolve(process.argv[2] ?? 'dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const rel = (req.url ?? '/').split('?')[0] === '/' ? 'portal.html' : (req.url ?? '').replace(/^\/+/, '');
  const f = path.join(dir, rel);
  if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] ?? 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto('http://127.0.0.1:' + port + '/portal.html');
await page.waitForFunction(() => globalThis.__kanshanPlayer !== undefined, { timeout: 20000 });

// Sample at SIMULATION-time milestones (clock.time), not wall time.
const milestones = [1.0, 2.6, 4.2, 7.5, 11.0];
let last = 0;
for (const t of milestones) {
  await page.waitForFunction((tt) => globalThis.__kanshanPlayer.host.clock.time >= tt, t, { timeout: 60000 });
  const st = await page.evaluate(() => {
    const p = globalThis.__kanshanPlayer;
    const ramp = p.host ? undefined : undefined;
    return {
      simTime: p.host.clock.time.toFixed(2),
      ramp,
      say: document.querySelector('.kanshan-say')?.textContent ?? null,
      hud: document.querySelector('.ui-subtitle__text')?.textContent ?? null,
    };
  });
  await page.screenshot({ path: `.kanshan/intro-t${t}.png` });
  console.log(`t=${st.simTime} ramp=n/a say=${JSON.stringify(st.say)} hud=${JSON.stringify(st.hud)}`);
}
console.log('errors:', errs.length, errs.slice(0, 2));
await browser.close();
server.close();
