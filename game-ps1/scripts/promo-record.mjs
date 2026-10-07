#!/usr/bin/env node
/**
 * promo-record: 逐帧录制 engine-promo 的 60s 搭建时间线。
 *
 * 用法: node scripts/promo-record.mjs [--frames 1800] [--out .kanshan/promo-frames] [--dist dist]
 *
 * 前提: `npm run build` 已产出 dist/promo.html。脚本静态服务 dist，
 * 无头 chromium 打开 promo.html?manual=1，循环调用 window.__promo.step(1)
 * 并在同一 evaluate 任务内 canvas.toDataURL 抓帧（WebGL buffer 仍有效），
 * 写成 f-%05d.png 序列。fixedDt=1/30，1800 帧 = 60s 模拟时间。
 * 之后用 scripts/promo-encode.sh 以 60fps 合成 30s 成片。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const FRAMES = Number(opt('frames', 1800));
const OUT = path.resolve(opt('out', '.kanshan/promo-frames'));
const DIST = path.resolve(opt('dist', 'dist'));

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png',
};
const server = http.createServer((req, res) => {
  const rel = (req.url ?? '/').split('?')[0].replace(/^\/+/, '') || 'promo.html';
  const f = path.join(DIST, rel);
  if (!fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] ?? 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.error('pageerror:', String(e)));
await page.goto(`http://127.0.0.1:${port}/promo.html?manual=1`);
await page.waitForFunction(() => globalThis.__promo && globalThis.__promo.ready === true, { timeout: 30000 });

const t0 = Date.now();
for (let i = 1; i <= FRAMES; i += 1) {
  const data = await page.evaluate(() => {
    globalThis.__promo.step(1);
    return document.querySelector('canvas').toDataURL('image/png');
  });
  const name = `f-${String(i).padStart(5, '0')}.png`;
  fs.writeFileSync(path.join(OUT, name), Buffer.from(data.split(',')[1], 'base64'));
  if (i % 120 === 0) {
    const dt = (Date.now() - t0) / 1000;
    console.log(`${i}/${FRAMES}  ${(dt / i).toFixed(2)}s/frame  eta ${(((FRAMES - i) * dt) / i).toFixed(0)}s`);
  }
}

await browser.close();
server.close();
console.log(`done: ${FRAMES} frames -> ${OUT}`);
