import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const dir = path.resolve(process.argv[2] ?? 'dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const rel = (req.url ?? '/').split('?')[0] === '/' ? 'portal.html' : (req.url ?? '').replace(/^\/+/, '');
  const f = path.join(dir, rel);
  if (!fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] ?? 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto('http://127.0.0.1:' + port + '/portal.html');
await page.waitForFunction(() => globalThis.__kanshanPlayer !== undefined, { timeout: 20000 });
await page.waitForTimeout(4500);
const state = await page.evaluate(() => {
  const p = globalThis.__kanshanPlayer;
  return { status: p.host.currentStatus, tick: p.host.clock.tick };
});
console.log('state:', JSON.stringify(state), 'errors:', errs.length, errs.slice(0, 2));
await page.screenshot({ path: '.kanshan/portal-1.png' });
await page.keyboard.press('Escape');
await page.keyboard.down('KeyW');
await page.waitForTimeout(2500);
await page.keyboard.up('KeyW');
await page.waitForTimeout(1200);
await page.screenshot({ path: '.kanshan/portal-2.png' });
const info = await page.evaluate(() => {
  const p = globalThis.__kanshanPlayer;
  const scene = p.host.query({ kind: 'scene', limit: 500 });
  const names = scene.data.map((n) => n.name).filter(Boolean);
  const commits = p.host.query({ kind: 'commits' });
  return { names: names.slice(0, 24), commits: commits.data.map((c) => c.name) };
});
console.log('nodes:', info.names.join(', '));
console.log('commits:', info.commits.join(', '));
console.log('errors:', errs.length, errs.slice(0, 3));
await browser.close();
server.close();
