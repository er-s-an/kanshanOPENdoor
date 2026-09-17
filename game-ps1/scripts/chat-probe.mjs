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
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto('http://127.0.0.1:' + server.address().port + '/portal.html');
await page.waitForFunction(() => globalThis.__kanshanPlayer !== undefined, { timeout: 20000 });

// Skip the intro, wait for roam.
await page.evaluate(() => { /* no direct skip handle on player; press Escape */ });
await page.keyboard.press('Escape');
await page.waitForFunction(() => globalThis.__kanshanPlayer.host.clock.time >= 16, { timeout: 60000 });
// pointer lock: the hall requires lock for look. This headless Chromium
// build refuses real requestPointerLock (WrongDocumentError even on a blank
// page), so stub the browser-native call and verify OUR wiring: click ->
// lock request -> deltas accumulate.
const yawProbe = () => page.evaluate(() => globalThis.__kanshanPlayer.camera.rotation.y);
const yawBefore = await yawProbe();
await page.mouse.move(640, 360);
await page.mouse.move(900, 360, { steps: 4 });
await page.waitForTimeout(300);
const yawUnlocked = await yawProbe();
await page.evaluate(() => {
  const canvas = document.querySelector('canvas');
  Object.defineProperty(document, 'pointerLockElement', { get: () => canvas, configurable: true });
  canvas.requestPointerLock = () => {
    document.dispatchEvent(new Event('pointerlockchange'));
    return Promise.resolve();
  };
});
await page.mouse.click(640, 360);
await page.waitForTimeout(300);
await page.mouse.move(900, 360, { steps: 4 });
await page.mouse.move(640, 360, { steps: 4 });
await page.waitForTimeout(300);
const yawLocked = await yawProbe();
console.log('look gated when unlocked:', yawUnlocked === yawBefore, '| look works when locked:', yawLocked !== yawUnlocked);

const sense = 0.0025; // look.x scale from fpsDefaults
async function locate() {
  return page.evaluate(() => {
    const p = globalThis.__kanshanPlayer;
    const s = p.host.query({ kind: 'scene', limit: 500 });
    const pl = s.data.find((n) => n.name === 'player');
    const k = s.data.find((n) => n.name === 'kanshan-root' || n.name === 'kanshan');
    return { player: pl.position, kanshan: k ? k.position : null };
  });
}

// Turn toward 看山 and walk until within 2m, then face him.
for (let i = 0; i < 14; i++) {
  const { player, kanshan } = await locate();
  if (!kanshan) break;
  const dx = kanshan[0] - player[0];
  const dz = kanshan[2] - player[2];
  const dist = Math.hypot(dx, dz);
  if (dist < 2.1) break;
  // face him: needed yaw such that forward (-sin yaw, -cos yaw) points at (dx,dz)
  const wantYaw = Math.atan2(-dx, -dz);
  // current yaw unknown to us; nudge by rotating in the direction that reduces error:
  // probe both small rotations is overkill — use scene camera yaw via camera quaternion
  const yawNow = await page.evaluate(() => {
    const cam = globalThis.__kanshanPlayer.camera;
    const e = cam.rotation;
    return e.y; // three.js YXZ? fallback: use euler y
  });
  let err = wantYaw - yawNow;
  while (err > Math.PI) err -= 2 * Math.PI;
  while (err < -Math.PI) err += 2 * Math.PI;
  // pointer dx positive turns view right (viewYaw -= dx*sense) → to increase yaw, move mouse left
  const px = -err / sense;
  await page.mouse.move(640, 360);
  await page.mouse.move(640 + Math.max(-200, Math.min(200, px)), 360, { steps: 4 });
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(Math.min(1400, 420 * dist));
  await page.keyboard.up('KeyW');
}
// Face him for the chat + nose screenshot.
const { player, kanshan } = await locate();
const dx = kanshan[0] - player[0];
const dz = kanshan[2] - player[2];
const wantYaw = Math.atan2(-dx, -dz);
const yawNow = await page.evaluate(() => globalThis.__kanshanPlayer.camera.rotation.y);
let err = wantYaw - yawNow;
while (err > Math.PI) err -= 2 * Math.PI;
while (err < -Math.PI) err += 2 * Math.PI;
await page.mouse.move(640, 360);
await page.mouse.move(640 + Math.max(-250, Math.min(250, -err / sense)), 360, { steps: 4 });
await page.waitForTimeout(400);
await page.screenshot({ path: '.kanshan/chat-approach.png' });

// Open chat with E, choose topic 1, screenshot, then bye.
await page.keyboard.press('KeyE');
await page.waitForTimeout(600);
await page.screenshot({ path: '.kanshan/chat-open.png' });
await page.keyboard.press('Digit1');
await page.waitForTimeout(600);
await page.screenshot({ path: '.kanshan/chat-answer.png' });
const st = await page.evaluate(() => {
  const box = document.querySelector('.kanshan-chat');
  return { boxText: box?.textContent ?? null, boxVisible: box ? !box.hidden : false };
});
console.log('chatbox:', JSON.stringify(st));
await page.keyboard.press('Digit4');
await page.waitForTimeout(400);
console.log('errors:', errs.length, errs.slice(0, 2));
await browser.close();
server.close();
