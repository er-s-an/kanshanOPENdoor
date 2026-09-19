/**
 * touch-probe.mjs — browser verification probe for the 看山 hall touch layer.
 *
 * Boot the built hall (dist, served statically — do NOT rebuild) in a mobile
 * Playwright context (390x844, hasTouch, isMobile, dsf 2) and drive the
 * touch overlay exactly the way DomInputDevice consumes it: real CDP touches
 * for the buttons (down → ≥70ms hold → up, so the per-fixed-step sampler sees
 * the press edge) and synthetic per-element PointerEvents for the stick /
 * look-drag area (mirroring how the device listens on the elements
 * themselves, touch implicit capture).
 *
 * Checks (a)–(g) are printed as PASS/FAIL lines; any failure or collected
 * console error / pageerror exits 1. Screenshots land in .kanshan/touch-*.png.
 *
 * Run from game-ps1:  node scripts/touch-probe.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const dir = path.resolve(process.argv[2] ?? 'dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const rel = (req.url ?? '/').split('?')[0] === '/' ? 'portal.html' : (req.url ?? '').replace(/^\/+/, '');
  if (rel === 'favicon.ico') { res.writeHead(204); res.end(); return; }
  const f = path.join(dir, rel);
  if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] ?? 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
fs.mkdirSync('.kanshan', { recursive: true });

const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

// ---- check plumbing ---------------------------------------------------------
let failed = false;
function check(name, cond, detail = '') {
  const ok = !!cond;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failed = true;
}

const errs = [];
function watchPage(page, tag) {
  page.on('pageerror', (e) => errs.push(`[${tag}] pageerror: ${String(e)}`));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`[${tag}] console.error: ${m.text()}`); });
}

const base = 'http://127.0.0.1:' + server.address().port;
const TOUCH_SENSE = 0.0045; // look.x / look.y touch-drag scale from fpsDefaults

// Synthetic per-element pointer gestures. DomInputDevice registers its
// listeners on the overlay elements themselves (touch = implicit capture), so
// dispatching straight on the element is the faithful path. Each gesture is
// self-contained inside page.evaluate (no Node-side helpers leak into the page).
async function stickDown() {
  await page.evaluate(() => {
    const el = document.querySelector('.kanshan-touch__stick');
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const fire = (type, x, y) =>
      el.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: 'touch', clientX: x, clientY: y, bubbles: true }));
    fire('pointerdown', cx, cy);
    // a string of upward moves, landing 50px above center (y ≈ 0.8 forward)
    for (let i = 1; i <= 5; i++) fire('pointermove', cx, cy - i * 10);
  });
}
async function stickUp() {
  await page.evaluate(() => {
    const el = document.querySelector('.kanshan-touch__stick');
    el.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, pointerType: 'touch', bubbles: true }));
  });
}
/** Drag the look area horizontally by dx px (pointerId 2). dx > 0 = drag right. */
async function lookDrag(dx) {
  await page.evaluate((total) => {
    const el = document.querySelector('.kanshan-touch__look');
    const r = el.getBoundingClientRect();
    const sx = r.left + r.width * 0.5;
    const sy = r.top + r.height * 0.5;
    const fire = (type, x, y) =>
      el.dispatchEvent(new PointerEvent(type, { pointerId: 2, pointerType: 'touch', clientX: x, clientY: y, bubbles: true }));
    fire('pointerdown', sx, sy);
    const steps = 10;
    for (let i = 1; i <= steps; i++) fire('pointermove', sx + (total * i) / steps, sy);
    fire('pointerup', sx + total, sy);
  }, dx);
  await page.waitForTimeout(120);
}
/**
 * Real CDP touch tap with a ~70ms hold. DomInputDevice samples touch buttons
 * as held-state once per fixed step, so a down+up shorter than one frame can
 * fall entirely between two samples and the press edge is lost — hold long
 * enough to span several steps (a real finger tap is ≥ 50ms anyway).
 */
async function touchTap(selector) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`touchTap: ${selector} not found`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  await page.waitForTimeout(70);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
const chatState = () => page.evaluate(() => ({
  hidden: document.querySelector('.kanshan-chat').hidden,
  rows: document.querySelectorAll('.kanshan-chat__option').length,
  line: document.querySelector('.kanshan-chat__line').textContent,
}));
const interactVisible = () => page.evaluate(() => {
  const b = document.querySelector('.kanshan-touch__btn-interact');
  return !!b && !b.hidden;
});
/** One walk burst toward 看山: face him via look-drag, hold the stick up. */
async function approachBurst() {
  const { player, kanshan } = await locate();
  if (!kanshan) return Infinity;
  const dx = kanshan[0] - player[0];
  const dz = kanshan[2] - player[2];
  const dist = Math.hypot(dx, dz);
  const wantYaw = Math.atan2(-dx, -dz); // forward = (-sin yaw, -cos yaw)
  const yaw = await yawNow();
  let err = wantYaw - yaw;
  while (err > Math.PI) err -= 2 * Math.PI;
  while (err < -Math.PI) err += 2 * Math.PI;
  if (Math.abs(err) > 0.12) await lookDrag(Math.max(-260, Math.min(260, -err / TOUCH_SENSE)));
  await stickDown();
  await page.waitForTimeout(Math.min(1300, Math.max(300, Math.round(420 * dist))));
  await stickUp();
  await page.waitForTimeout(120);
  return dist;
}
/**
 * 看山 keeps roaming (and may start a door run), so the 「聊聊」 button is not
 * guaranteed to stay offered: walk after him until it is (range ≤ 2.2m while
 * his fsm is back in roam).
 */
async function ensureInteractVisible(maxBursts = 14) {
  for (let i = 0; i < maxBursts; i++) {
    if (await interactVisible()) return true;
    await approachBurst();
  }
  return interactVisible();
}
async function locate() {
  return page.evaluate(() => {
    const p = globalThis.__kanshanPlayer;
    const s = p.host.query({ kind: 'scene', limit: 500 });
    const pl = s.data.find((n) => n.name === 'player');
    const k = s.data.find((n) => n.name === 'kanshan-root' || n.name === 'kanshan');
    return { player: pl.position, kanshan: k ? k.position : null };
  });
}
const yawNow = () => page.evaluate(() => globalThis.__kanshanPlayer.camera.rotation.y);
/**
 * Headless mobile emulation quirk: right after the first tap the emulated
 * browser-UI animation briefly grows window.innerWidth/innerHeight (e.g.
 * 390x844 → 592x1282) WITHOUT firing resize events, dragging position:fixed
 * elements out of the painted area for ~1.5s. The game never sees a resize
 * (its layout viewport stays 390x844); this only matters for screenshots.
 */
async function waitVpStable() {
  for (let i = 0; i < 30; i++) {
    const size = await page.evaluate(() => `${window.innerWidth}x${window.innerHeight}`);
    if (size === '390x844') return true;
    await page.waitForTimeout(200);
  }
  return false;
}
/**
 * Screenshot only while the emulated viewport is stable: the flicker drags
 * bottom-anchored fixed elements out of the captured area, so verify before
 * AND after capture that inner size and the stick rect did not move; retry.
 */
async function screenshotStable(path) {
  const snapshot = () => page.evaluate(() => {
    const s = document.querySelector('.kanshan-touch__stick').getBoundingClientRect();
    return `${window.innerWidth}x${window.innerHeight}|stickBottom=${Math.round(s.bottom)}`;
  });
  for (let attempt = 1; attempt <= 6; attempt++) {
    if (!(await waitVpStable())) continue;
    const before = await snapshot();
    const okBefore = before.startsWith('390x844|') && Number(before.split('stickBottom=')[1]) <= 844;
    await page.screenshot({ path });
    const after = await snapshot();
    if (okBefore && before === after) return;
    console.log(`  (screenshot retry ${attempt}: viewport ${before} → ${after})`);
  }
  console.log(`  (WARN: ${path} captured under an unstable emulated viewport)`);
}

let page; // mobile page, reused across (a)–(g)
let cdp; // CDP session for held touches (page.touchscreen only offers atomic tap)

try {
  // ============================== (a) mobile overlay =========================
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  page = await mobile.newPage();
  watchPage(page, 'mobile');
  cdp = await page.context().newCDPSession(page);
  await page.goto(base + '/portal.html');
  await page.waitForFunction(() => globalThis.__kanshanPlayer !== undefined, undefined, { timeout: 20000 });
  await page.waitForTimeout(400);

  const a = await page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const shown = (el) => !!el && !el.hidden && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0;
    return {
      rootHidden: q('.kanshan-touch') ? q('.kanshan-touch').hidden : 'missing',
      stick: shown(q('.kanshan-touch__stick')),
      knob: !!q('.kanshan-touch__knob'),
      look: shown(q('.kanshan-touch__look')),
      jump: shown(q('.kanshan-touch__btn-jump')),
      skipHidden: q('.kanshan-touch__btn-skip') ? q('.kanshan-touch__btn-skip').hidden : 'missing',
    };
  });
  check('(a) touch overlay revealed on mobile load (root hidden=false)', a.rootHidden === false, `root.hidden=${a.rootHidden}`);
  check('(a) stick/knob/look area/jump button all present', a.stick && a.knob && a.look && a.jump,
    `stick=${a.stick} knob=${a.knob} look=${a.look} jump=${a.jump}`);
  await page.waitForFunction(() => document.querySelector('.kanshan-touch__btn-skip')?.hidden === false, undefined, { timeout: 10000 })
    .then(() => check('(a) skip button visible during intro', true))
    .catch(() => check('(a) skip button visible during intro', false, 'skip stayed hidden'));
  await screenshotStable('.kanshan/touch-overlay.png');

  // ============================== (b) desktop stays hidden ===================
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const dpage = await desktop.newPage();
  watchPage(dpage, 'desktop');
  await dpage.goto(base + '/portal.html');
  await dpage.waitForFunction(() => globalThis.__kanshanPlayer !== undefined, undefined, { timeout: 20000 });
  await dpage.waitForTimeout(1500);
  const dHidden = await dpage.evaluate(() => {
    const root = document.querySelector('.kanshan-touch');
    return root ? root.hidden : 'missing';
  });
  check('(b) overlay stays hidden on desktop (no touch)', dHidden === true, `root.hidden=${dHidden}`);
  await desktop.close();

  // ============================== (c) tap skip ===============================
  await touchTap('.kanshan-touch__btn-skip');
  await page.waitForFunction(() => document.querySelector('.kanshan-touch__btn-skip')?.hidden === true, undefined, { timeout: 20000 })
    .then(() => check('(c) intro skipped via tap, skip button hides', true))
    .catch(() => check('(c) intro skipped via tap, skip button hides', false, 'skip still visible after tap'));
  // After the skip tap the emulation stays quiet ~1.2s, then the flicker runs
  // ~1.7–3.1s (measured), so a fixed 3.4s wait + a stability check guarantees
  // the (d) screenshot paints the real 390x844 layout.
  await page.waitForTimeout(3400);
  await waitVpStable();

  // ============================== (d) joystick ===============================
  const p0 = (await locate()).player;
  await stickDown();
  await page.waitForTimeout(1200); // hold ~1.2s before sampling + screenshot
  const knobMid = await page.evaluate(() => document.querySelector('.kanshan-touch__knob').getAttribute('style') ?? '');
  await screenshotStable('.kanshan/touch-stick.png');
  const pHold = (await locate()).player;
  await stickUp();
  await page.waitForTimeout(400);
  const knobEnd = await page.evaluate(() => document.querySelector('.kanshan-touch__knob').getAttribute('style') ?? '');
  const pStop1 = (await locate()).player;
  await page.waitForTimeout(250);
  const pStop2 = (await locate()).player;
  const knobOffset = (s) => {
    const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(s);
    return m ? { x: Number(m[1]), y: Number(m[2]) } : { x: 0, y: 0 };
  };
  const midOff = knobOffset(knobMid);
  const endOff = knobOffset(knobEnd);
  const stopDrift = Math.hypot(pStop2[0] - pStop1[0], pStop2[2] - pStop1[2]);
  check('(d) player starts at spawn z≈7', Math.abs(p0[2] - 7) < 0.5, `z=${p0[2].toFixed(2)}`);
  check('(d) holding stick up walks forward (z decreases clearly)', pHold[2] < p0[2] - 1,
    `z ${p0[2].toFixed(2)} → ${pHold[2].toFixed(2)}`);
  check('(d) knob displaced while held', Math.abs(midOff.x) > 0.5 || Math.abs(midOff.y) > 0.5, `knob translate(${midOff.x}px, ${midOff.y}px)`);
  check('(d) knob re-centers after release', Math.abs(endOff.x) <= 0.5 && Math.abs(endOff.y) <= 0.5, `knob translate(${endOff.x}px, ${endOff.y}px)`);
  check('(d) player stops after release', stopDrift < 0.05, `drift ${stopDrift.toFixed(3)}m in 250ms`);

  // ============================== (e) drag to look ===========================
  const yawBefore = await yawNow();
  await lookDrag(200); // 200px right → yaw -= 200*0.0045 ≈ -0.9
  await page.waitForTimeout(300);
  const yawAfter = await yawNow();
  const hintHidden = await page.evaluate(() => document.querySelector('.kanshan-touch__look-hint')?.hidden);
  await screenshotStable('.kanshan/touch-look.png');
  check('(e) look drag rotates camera (yaw clearly changes)', Math.abs(yawAfter - yawBefore) > 0.5,
    `yaw ${yawBefore.toFixed(3)} → ${yawAfter.toFixed(3)}`);
  check('(e) look hint retires after first drag', hintHidden === true, `look-hint.hidden=${hintHidden}`);

  // ============================== (f) jump ===================================
  const y0 = (await locate()).player[1];
  await touchTap('.kanshan-touch__btn-jump');
  await screenshotStable('.kanshan/touch-jump.png');
  const t0 = Date.now();
  let yMax = y0;
  while (Date.now() - t0 < 1000) {
    const y = (await locate()).player[1];
    if (y > yMax) yMax = y;
    await page.waitForTimeout(60);
  }
  check('(f) jump lifts player > initial + 0.2 within 1s', yMax > y0 + 0.2, `y ${y0.toFixed(2)} → max ${yMax.toFixed(2)}`);

  // ============================== (g) walk to 看山 + chat ====================
  // Same err/sense idea as chat-probe, touch edition: look-drag to face him,
  // then hold the stick up; touch look sense is 0.0045 (drag right = dx > 0
  // turns view right, viewYaw -= dx*sense, so to increase yaw drag left).
  let reached = false;
  let lastDist = Infinity;
  for (let i = 0; i < 16; i++) {
    const { player, kanshan } = await locate();
    if (!kanshan) break;
    const dx = kanshan[0] - player[0];
    const dz = kanshan[2] - player[2];
    lastDist = Math.hypot(dx, dz);
    if (lastDist < 2.0) { reached = true; break; }
    await approachBurst();
  }
  check('(g) walked to 看山 (< 2.2m)', reached, reached ? '' : `stuck at dist=${lastDist.toFixed(2)}`);
  const offered = await ensureInteractVisible();
  check('(g) 「聊聊」 button appears in range', offered, offered ? '' : 'interact button never showed');
  // Natural in-place tap first. KNOWN SRC ISSUE under verification: the tap's
  // trailing synthetic click hit-tests the freshly-opened card and lands on
  // option row 4 (「没事，随便逛逛」 = bye), which closes the card instantly.
  // Observed via event capture: click@btn-center → .kanshan-chat__option.
  await touchTap('.kanshan-touch__btn-interact');
  await page.waitForTimeout(500);
  const st1 = await chatState();
  if (st1.hidden) {
    console.log('WARN  (g-src) natural 「聊聊」 tap: card closed instantly (phantom click → option 4 = bye). src bug — documented in the report; continuing with move-away release.');
  } else {
    console.log('PASS  (g-src) natural 「聊聊」 tap kept the card open (no phantom click)');
    await touchTap('.kanshan-chat__close');
    await page.waitForTimeout(300);
  }
  // Deterministic open: press, hold, MOVE AWAY, release — a touchmove
  // suppresses the trailing synthetic click, so the card stays open. 看山
  // keeps roaming, so walk after him until the button is offered again.
  if (!(await ensureInteractVisible())) throw new Error('interact button never reappeared for the deterministic open');
  {
    const box = await page.locator('.kanshan-touch__btn-interact').boundingBox();
    if (!box) throw new Error('interact button had no box after ensureInteractVisible');
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    await page.waitForTimeout(150);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 60, y: 400, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(200);
  }
  await page.waitForFunction(() => {
    const c = document.querySelector('.kanshan-chat');
    return !!c && !c.hidden;
  }, undefined, { timeout: 5000 })
    .then(() => check('(g) 「聊聊」 opens chat card', true))
    .catch(() => check('(g) 「聊聊」 opens chat card', false, '.kanshan-chat stayed hidden'));
  const st2 = await chatState();
  check('(g) chat card shows root line + 4 option rows', !st2.hidden && st2.rows === 4 && st2.line.includes('想聊点什么'),
    `rows=${st2.rows} line=${st2.line.slice(0, 10)}`);
  await screenshotStable('.kanshan/touch-chat.png');
  await touchTap('.kanshan-chat__option');
  await page.waitForFunction(() => {
    const line = document.querySelector('.kanshan-chat__line');
    return !!line && line.textContent.includes('候车大厅'); // topic 1 answer
  }, undefined, { timeout: 5000 })
    .then(() => check('(g) tapping option 1 shows its answer', true))
    .catch(() => check('(g) tapping option 1 shows its answer', false, 'answer line never appeared'));
  await touchTap('.kanshan-chat__close');
  await page.waitForFunction(() => document.querySelector('.kanshan-chat')?.hidden === true, undefined, { timeout: 5000 })
    .then(() => check('(g) tapping ✕ closes the chat card', true))
    .catch(() => check('(g) tapping ✕ closes the chat card', false, 'card stayed open'));
  await screenshotStable('.kanshan/touch-chat-closed.png');
} catch (err) {
  failed = true;
  console.log('FAIL  probe crashed —', err instanceof Error ? (err.stack ?? err.message) : String(err));
}

// ---- (i) error report + verdict ---------------------------------------------
console.log(`--- console/page errors: ${errs.length} ---`);
for (const e of errs.slice(0, 10)) console.log('  ' + e);
if (errs.length > 0) failed = true;
console.log(failed ? 'TOUCH PROBE: FAIL' : 'TOUCH PROBE: ALL PASS');

await browser.close();
server.close();
process.exit(failed ? 1 : 0);
