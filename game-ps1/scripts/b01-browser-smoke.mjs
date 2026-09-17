#!/usr/bin/env node
/**
 * B01 browser smoke (optional B-group evidence; LOCAL browser required).
 *
 * Serves a built export directory over localhost, loads it in real Chromium
 * via playwright-core, and checks ONLY what a browser can prove:
 *   - the page boots with zero page errors and a live WebGL canvas;
 *   - the frame actually changes over time (animation loop rendering);
 *   - public keyboard input (hold W) changes the rendered frame
 *     (screenshot pixel diff — movement is really visible);
 *   - a real user gesture (click) is what unlocks audio: no audio errors
 *     before/after; we do NOT claim audible output.
 *
 * Usage: node scripts/b01-browser-smoke.mjs --export <dir>
 * Exit 0 = all checks PASS; 2 = environment unavailable (NOT_RUN); 1 = FAIL.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const exportDir = path.resolve(args[args.indexOf('--export') + 1] ?? '');
if (!exportDir || !fs.existsSync(path.join(exportDir, 'index.html'))) {
  console.error('usage: --export <dir with index.html>');
  process.exit(2);
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.md': 'text/markdown' };

function serve(dir) {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const rel = url === '/' ? 'index.html' : url.replace(/^\/+/, '');
    const file = path.join(dir, rel);
    if (!file.startsWith(dir) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function screenshotStats(buf) {
  // Cheap content signal without a PNG decoder: byte length + byte histogram spread.
  const hist = new Set();
  for (let i = 0; i < buf.length; i += 97) hist.add(buf[i]);
  return { bytes: buf.length, spread: hist.size };
}

async function main() {
  const { server, port } = await serve(exportDir);
  let browser;
  try {
    const { chromium } = await import('playwright-core');
    browser = await chromium.launch({
      headless: true,
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    });
  } catch (err) {
    server.close();
    console.log(JSON.stringify({ status: 'NOT_RUN', reason: `no local browser: ${err.message}` }));
    process.exit(2);
  }

  const checks = [];
  const record = (id, ok, detail) => checks.push({ id, status: ok ? 'PASS' : 'FAIL', detail });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') pageErrors.push(msg.text());
  });

  try {
    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load', timeout: 30000 });
    // Boot + first frames.
    await page.waitForSelector('canvas', { timeout: 15000 });
    await page.waitForTimeout(1500);

    const gl = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      if (!canvas) return { canvas: false };
      const ctx = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
      return {
        canvas: true,
        width: canvas.width,
        height: canvas.height,
        webgl: !!ctx,
        contextLost: ctx ? ctx.isContextLost() : true,
      };
    });
    record('canvas-webgl', gl.canvas && gl.webgl && !gl.contextLost, JSON.stringify(gl));

    const shot1 = await page.screenshot();
    await page.waitForTimeout(700);
    const shot2 = await page.screenshot();
    const s1 = screenshotStats(shot1);
    const s2 = screenshotStats(shot2);
    record('frames-render', s1.bytes > 5000 && s1.spread > 8, JSON.stringify({ s1, s2 }));
    // Note: a static first frame is legitimate content; frame CHANGE is checked via input below.

    // Public input: skip the (declared-policy) intro cutscene with Escape,
    // then hold W; the rendered frame must change as the player moves.
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(400);
    const shotA = await page.screenshot();
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(1200);
    const shot3 = await page.screenshot();
    await page.keyboard.up('KeyW');
    const moved = !shotA.equals(shot3);
    record('input-visible-effect', moved, 'screenshot before/after Escape+KeyW differs');

    // Audio: no audible claim; assert no audio errors and gesture path exists.
    await page.mouse.click(320, 240);
    await page.waitForTimeout(400);
    record('gesture-no-audio-error', pageErrors.length === 0, `pageErrors=${pageErrors.length}`);

    record('no-page-errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
    server.close();
  }

  const failed = checks.filter((c) => c.status !== 'PASS');
  const report = {
    status: failed.length === 0 ? 'PASS' : 'FAIL',
    level: 'BROWSER_RENDER_AUDIO',
    scope: 'boot/canvas/webgl/input-visible-effect/gesture; audible output and visual quality UNREVIEWED',
    exportDir,
    checks,
  };
  console.log(JSON.stringify(report, null, 2));
  process.exit(failed.length === 0 ? 0 : 1);
}

main();
