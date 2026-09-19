/**
 * 看山任意门 · Kanshan Hall — touch-controls behavior evidence.
 *
 * Companion to work-kanshan-hall.test.ts (keyboard/mouse line). The same
 * RuntimeSessionHost (controlled mode, fixedDt 1/60) drives the work module,
 * but EVERY player gesture enters through the touch public input path:
 * HeadlessInputDevice.touchStickMove / touchButtonDown / touchDrag resolve
 * through the same RawInputFrame -> ActionMapper -> FirstPersonController
 * pipeline as the DOM overlay's pointer events (touch-controls.ts registers
 * its elements with DomInputDevice's touchSticks/touchDragAreas/touchButtons
 * maps, so these tests exercise the identical contract). No setState, no
 * teleports: the player physically walks every route.
 *
 * Covered behavior:
 *   (a) overlay lifecycle: hidden by default, reveal() shows it, and the
 *       stick/knob/look/jump/interact/skip elements all mount under the HUD;
 *   (b) the 跳过 button mirrors introActive(): visible during the intro, a
 *       tap applies the finish policy (introState 'skipped') and it hides;
 *   (c) stick forward walks -Z from spawn; releasing the stick stops the
 *       player dead (kinematic controller, no inertia);
 *   (d) touch-drag look: dragging right turns the camera right, and stick
 *       forward afterwards walks world +X (movement basis follows yaw);
 *   (e) the 跳 button lifts the player off the ground;
 *   (f) knob presentation: full deflection offsets the knob element style,
 *       release re-centers it to translate(0.0px, 0.0px);
 *   (g) the full chat dialogue via touch: chase 看山 to 2.2m, the prompt
 *       flips to the touch wording, 聊聊 opens the box, tapping an option
 *       row commits the topic fact, tapping ✕ closes back to roam;
 *   (h) the full door flow via stick only: linger at the 蓝血 door, 看山
 *       runs over and opens it, walking through commits portal.enter
 *       {target:'blue-blood'} exactly once.
 *
 * Evidence limits: rendering is NOT_MEASURED headless; audio assertions are
 * AUDIO_SCHEDULING_ONLY on the RecordingBackend log.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RuntimeSessionHost } from '../../src/creative/core/host.ts';
import type { EventEnvelope } from '../../src/creative/core/events.ts';
import type { Vec3 } from '../../src/creative/core/spatial.ts';
import { HeadlessInputDevice } from '../../src/creative/input/headless.ts';
import { RecordingBackend } from '../../src/creative/audio/backend.ts';
import { FakeDocument } from '../../src/creative/ui/fakedom.ts';
import type { FakeElement } from '../../src/creative/ui/fakedom.ts';
import {
  createKanshanHallModule,
  KANSHAN_MIN_DISTANCE,
} from '../../experiences/kanshan-hall/src/scene.ts';
import type { KanshanHallWorkHandles } from '../../experiences/kanshan-hall/src/scene.ts';
import { CHAT_ANSWERS, CHAT_ROOT_LINE } from '../../experiences/kanshan-hall/src/dialogue.ts';
import {
  TOUCH_ROOT_CLASS,
  TOUCH_STICK_CLASS,
  TOUCH_KNOB_CLASS,
  TOUCH_LOOK_CLASS,
  TOUCH_JUMP_CLASS,
  TOUCH_INTERACT_CLASS,
  TOUCH_SKIP_CLASS,
  TOUCH_LOOK_HINT_CLASS,
} from '../../experiences/kanshan-hall/src/touch-controls.ts';

const DT = 1 / 60;

interface WorkSession {
  host: RuntimeSessionHost;
  device: HeadlessInputDevice;
  backend: RecordingBackend;
  doc: FakeDocument;
  handles: KanshanHallWorkHandles;
}

async function startWorkSession(): Promise<WorkSession> {
  VIOLATIONS.length = 0;
  const host = new RuntimeSessionHost({
    experienceDigest: 'kanshan-hall-v2',
    buildId: 'work-kanshan-hall-touch-test',
    mode: 'controlled',
    fixedDt: DT,
  });
  const device = new HeadlessInputDevice();
  const backend = new RecordingBackend();
  const doc = new FakeDocument();
  const module = createKanshanHallModule({ device, audioBackend: backend, document: doc, hudParent: doc.root });
  await host.start(module);
  const handles = module.handles as KanshanHallWorkHandles | undefined;
  assert.ok(handles, 'module exposes its handles once create() resolves');
  return { host, device, backend, doc, handles };
}

// ------------------------------ stepping ----------------------------------

const VIOLATIONS: string[] = [];

function assertMinDistance(s: WorkSession): void {
  const d = s.handles.kanshanDistanceToPlayer();
  if (d < KANSHAN_MIN_DISTANCE - 1e-9) {
    const p = s.handles.player.position;
    const k = s.handles.kanshanRef.position;
    VIOLATIONS.push(
      `d=${d.toFixed(4)} state=${s.handles.kanshan.state()} action=${s.handles.kanshanRef.currentAction} ` +
        `kanshan=(${k.x.toFixed(3)},${k.z.toFixed(3)}) player=(${p[0].toFixed(3)},${p[2].toFixed(3)})`,
    );
  }
}

function pos(s: WorkSession): Vec3 {
  return s.handles.player.position;
}

function idle(s: WorkSession, n: number): number {
  for (let i = 0; i < n; i += 1) {
    s.host.step(1);
    assertMinDistance(s);
  }
  return n;
}

function commitsOf(s: WorkSession, name: string): EventEnvelope[] {
  const result = s.host.query({ kind: 'commits', limit: 500 });
  assert.ok(result.ok, 'commits query succeeds');
  return (result.data as EventEnvelope[]).filter((e) => e.name === name);
}

/** Let 看山's queued lines drain so later assertions run in isolation. */
function settleLines(s: WorkSession, maxSteps = 1000): number {
  let steps = 0;
  for (;;) {
    s.host.step(1);
    steps += 1;
    assertMinDistance(s);
    if (s.handles.headSubtitle.text() === '') return steps;
    assert.ok(steps < maxSteps, `看山's queued lines did not settle within ${maxSteps} steps`);
  }
}

function waitUntil(s: WorkSession, pred: () => boolean, maxSteps: number, label: string): number {
  for (let i = 0; i < maxSteps; i += 1) {
    if (pred()) return i;
    s.host.step(1);
    assertMinDistance(s);
  }
  assert.ok(pred(), `${label}: condition never met within ${maxSteps} steps`);
  return maxSteps;
}

// --------------------------- touch gesture helpers -------------------------

/** The touch path for skipping the intro: tap 跳过 (finish policy). */
function skipIntroViaTouch(s: WorkSession): void {
  s.device.touchButtonDown('skip');
  s.host.step(1);
  s.device.touchButtonUp('skip');
  assert.equal(s.handles.introState(), 'skipped', 'the 跳过 tap applies the finish policy');
}

/**
 * Hold the virtual stick toward a (possibly moving) world target until pred
 * holds. With spawn yaw 0 the controller maps stick (x, y) to world
 * (x, -y), so the per-step components are the normalized target direction
 * with the z sign flipped. The stick is always released afterwards.
 */
function walkStickToTarget(
  s: WorkSession,
  target: () => { x: number; z: number },
  pred: (p: Vec3) => boolean,
  maxSteps: number,
  label: string,
): number {
  let steps = 0;
  try {
    while (steps < maxSteps) {
      const p = pos(s);
      const t = target();
      const dx = t.x - p[0];
      const dz = t.z - p[2];
      const d = Math.hypot(dx, dz);
      if (d > 1e-6) s.device.touchStickMove('move', dx / d, -dz / d);
      s.host.step(1);
      steps += 1;
      assertMinDistance(s);
      if (pred(pos(s))) return steps;
    }
  } finally {
    s.device.touchStickRelease('move');
  }
  assert.ok(pred(pos(s)), `${label}: predicate never satisfied within ${maxSteps} steps (pos ${pos(s)})`);
  return steps;
}

/** DFS class search (queryByClass only returns the first match). */
function collectByClass(el: FakeElement, token: string, out: FakeElement[] = []): FakeElement[] {
  if (el.classList.contains(token)) out.push(el);
  for (const child of el.children) collectByClass(child, token, out);
  return out;
}

// ---------------------------------- tests -----------------------------------

test('touch overlay: hidden by default; reveal() shows it; every control mounts under the HUD', async () => {
  const s = await startWorkSession();

  // Creation state, before any update tick: the overlay starts hidden and
  // the two context buttons (聊聊 / 跳过) are hidden until their conditions.
  assert.equal(s.handles.touch.revealed(), false, 'overlay starts unrevealed');
  assert.equal(s.handles.touch.root.hidden, true, 'overlay root starts hidden');
  assert.equal(s.handles.touch.interactButton.hidden, true, '聊聊 starts hidden');
  assert.equal(s.handles.touch.skipButton.hidden, true, '跳过 starts hidden');

  // The whole overlay tree hangs below the HUD section of the injected doc.
  const hudSection = s.doc.root.queryByClass('ui-hud');
  assert.ok(hudSection, 'HUD section mounted in the injected document');
  for (const cls of [
    TOUCH_ROOT_CLASS,
    TOUCH_STICK_CLASS,
    TOUCH_KNOB_CLASS,
    TOUCH_LOOK_CLASS,
    TOUCH_JUMP_CLASS,
    TOUCH_INTERACT_CLASS,
    TOUCH_SKIP_CLASS,
    TOUCH_LOOK_HINT_CLASS,
  ]) {
    assert.ok(hudSection!.queryByClass(cls), `${cls} mounted under the HUD tree`);
  }

  s.handles.touch.reveal();
  assert.equal(s.handles.touch.revealed(), true, 'reveal() flips the revealed flag');
  assert.equal(s.handles.touch.root.hidden, false, 'reveal() unhides the root');

  await s.host.stop();
});

test('touch skip: 跳过 is visible during the intro; tapping it skips and the button hides', async () => {
  const s = await startWorkSession();

  idle(s, 2); // the update loop mirrors introActive() onto the button
  assert.equal(s.handles.touch.skipButton.hidden, false, '跳过 visible while the intro plays');

  s.device.touchButtonDown('skip');
  s.host.step(1);
  s.device.touchButtonUp('skip');
  assert.equal(s.handles.introState(), 'skipped', 'the 跳过 tap applies the finish policy');

  idle(s, 2); // the button state re-mirrors on the next updates
  assert.equal(s.handles.touch.skipButton.hidden, true, '跳过 hidden once the intro is over');
  assert.deepEqual(VIOLATIONS, [], 'no min-distance violations around the skip');

  await s.host.stop();
});

test('touch stick: pushing up walks -Z from spawn; releasing the stick stops the player', async () => {
  const s = await startWorkSession();
  skipIntroViaTouch(s);
  idle(s, 2);
  const z0 = pos(s)[2];
  assert.ok(Math.abs(z0 - 7) < 1e-6, `player still at spawn z=7 after the skip (z ${z0})`);

  s.device.touchStickMove('move', 0, 1); // full forward at spawn yaw 0
  idle(s, 30); // 0.5s at 3 m/s -> ~1.5m of travel
  assert.ok(pos(s)[2] < z0 - 1.0, `stick forward walks -Z (z ${pos(s)[2]} from ${z0})`);
  const stopped = pos(s);
  s.device.touchStickRelease('move');
  s.host.step(1);
  idle(s, 10);
  assert.ok(
    Math.abs(pos(s)[2] - stopped[2]) < 1e-6 && Math.abs(pos(s)[0] - stopped[0]) < 1e-6,
    `no drift after release (pos ${pos(s)})`,
  );
  assert.deepEqual(VIOLATIONS, [], 'no min-distance violations while walking');

  await s.host.stop();
});

test('touch look: dragging right turns the camera right; stick forward then walks world +X', async () => {
  const s = await startWorkSession();
  skipIntroViaTouch(s);
  idle(s, 90); // cameraBlend(headRig, 1.2s) fully hands the camera to the player head
  assert.ok(Math.abs(s.handles.camera.rotation.y) < 1e-9, 'camera yaw is the spawn yaw (0)');

  s.device.touchDrag('look', 100, 0); // dx 100px * 0.0045 = +0.45 rad of look.x
  s.host.step(1);
  assert.ok(
    Math.abs(s.handles.camera.rotation.y - -0.45) < 1e-6,
    `drag-right rotated the camera to yaw ${s.handles.camera.rotation.y}`,
  );

  // With the view turned right, screen-forward maps to world (+sin|yaw|>0, -cos).
  const x0 = pos(s)[0];
  const z0 = pos(s)[2];
  s.device.touchStickMove('move', 0, 1);
  idle(s, 30);
  s.device.touchStickRelease('move');
  assert.ok(pos(s)[0] - x0 > 0.3, `stick forward gained world +X after turning (dx ${pos(s)[0] - x0})`);
  assert.ok(pos(s)[2] < z0 - 0.5, `and still advances forward in -Z (dz ${pos(s)[2] - z0})`);
  assert.deepEqual(VIOLATIONS, [], 'no min-distance violations while turning/walking');

  await s.host.stop();
});

test('touch jump: the 跳 button lifts the player off the floor', async () => {
  const s = await startWorkSession();
  skipIntroViaTouch(s);
  idle(s, 30); // settle onto the ground
  const baseY = pos(s)[1];

  s.device.touchButtonDown('jump');
  s.host.step(1);
  s.device.touchButtonUp('jump');
  let apex = baseY;
  for (let i = 0; i < 60; i += 1) {
    s.host.step(1);
    assertMinDistance(s);
    apex = Math.max(apex, pos(s)[1]);
  }
  assert.ok(apex > baseY + 0.2, `jump rose at least 0.2m (apex ${apex} from ${baseY})`);
  assert.deepEqual(VIOLATIONS, [], 'no min-distance violations around the jump');

  await s.host.stop();
});

test('touch knob: full stick deflection offsets the knob style; release re-centers it', async () => {
  const s = await startWorkSession();
  skipIntroViaTouch(s);
  idle(s, 2);
  const knob = (): FakeElement => {
    const el = s.doc.root.queryByClass(TOUCH_KNOB_CLASS);
    assert.ok(el, 'knob element exists');
    return el!;
  };

  s.device.touchStickMove('move', 1, 0); // full right
  idle(s, 1);
  const stylePushed = knob().getAttribute('style') ?? '';
  assert.ok(stylePushed.includes('translate(36.0px'), `knob offset by full deflection (${stylePushed})`);

  s.device.touchStickRelease('move');
  idle(s, 1);
  const styleCentered = knob().getAttribute('style') ?? '';
  assert.ok(
    styleCentered.includes('translate(0.0px, 0.0px)'),
    `knob re-centered on release (${styleCentered})`,
  );

  await s.host.stop();
});

test('touch chat: chase 看山, 聊聊 opens the dialogue, option tap commits the topic, ✕ closes to roam', async () => {
  const s = await startWorkSession();
  skipIntroViaTouch(s);
  s.handles.touch.reveal(); // touch wording + the 聊聊 button govern this run
  settleLines(s);
  assert.equal(s.handles.kanshan.state(), 'roam', '看山 roams while the player approaches');

  // Walk to him live (yaw still 0): steer the stick at his position each step
  // until inside the 2.2m chat radius.
  walkStickToTarget(
    s,
    () => ({ x: s.handles.kanshanRef.position.x, z: s.handles.kanshanRef.position.z }),
    () => s.handles.kanshanDistanceToPlayer() <= 2.05,
    1500,
    'close the distance to 看山',
  );
  idle(s, 2); // the prompt eligibility mirrors on the next update
  assert.ok(s.handles.kanshanDistanceToPlayer() <= 2.2, 'within chat range');
  assert.equal(s.handles.hud.prompt.visible, true, 'prompt offered near 看山');
  assert.equal(s.handles.hud.prompt.label, '点「聊聊」和刘看山说话', 'touch wording once the overlay is revealed');
  assert.equal(s.handles.touch.interactButton.hidden, false, '聊聊 button mirrors the prompt');

  // The 聊聊 tap opens the modal dialogue (same intent edge as KeyE).
  s.device.touchButtonDown('interact');
  s.host.step(1);
  s.device.touchButtonUp('interact');
  assert.equal(s.handles.kanshan.state(), 'chat', 'FSM in chat');
  assert.equal(s.handles.hud.prompt.visible, false, 'prompt hidden while chatting');
  assert.ok(s.handles.chatBox.visible, 'dialogue box visible');
  assert.equal(s.handles.chatBox.lineText(), CHAT_ROOT_LINE, 'box shows the root line');
  const chatOpens = commitsOf(s, 'kanshan.chat-open');
  assert.equal(chatOpens.length, 1, 'chat-open committed exactly once');

  // Tap the first option row (「1 这是哪儿？」) — the click queues the choice,
  // consumed at the top of the next intent phase like a key edge.
  const chatEl = s.handles.chatBox.element as unknown as FakeElement;
  const rows = collectByClass(chatEl, 'kanshan-chat__option');
  assert.equal(rows.length, 4, 'four option rows rendered');
  rows[0].click();
  s.host.step(1);
  assert.equal(s.handles.chatBox.lineText(), CHAT_ANSWERS.place, 'box shows the place answer');
  const topics = commitsOf(s, 'kanshan.chat-topic');
  assert.equal(topics.length, 1, 'one topic commit so far');
  assert.equal((topics[0].payload as { topic: string }).topic, 'place');
  assert.equal(topics[0].eventId, 'kanshan:chat:place');

  // Tap ✕ to close: box hides, the FSM hands the hall back to roaming.
  const close = chatEl.queryByClass('kanshan-chat__close');
  assert.ok(close, '✕ close affordance present');
  close!.click();
  s.host.step(1);
  assert.ok(!s.handles.chatBox.visible, 'box hidden after ✕');
  assert.equal(s.handles.kanshan.state(), 'roam', 'back to roaming after the close tap');
  assert.deepEqual(VIOLATIONS, [], 'the 1.2m invariant held throughout the chat');

  await s.host.stop();
});

test('touch door flow: stick to the 蓝血 door, 看山 opens it, crossing commits portal.enter exactly once', async () => {
  const s = await startWorkSession();
  skipIntroViaTouch(s);
  s.handles.unlockAudio();
  settleLines(s);

  const door = s.handles.hall.doors.find((d) => d.id === 'blue-blood')!;
  assert.equal(door.state(), 'closed');
  const doorPos = { x: door.position.x, z: door.position.z }; // (0, 0, -9): dead ahead at spawn yaw

  const seen: string[] = [];
  const unsubscribe = s.handles.portalEnter.onEnter((target) => seen.push(target));

  // Stick-walk to the door and linger inside the 1.6m trigger radius.
  walkStickToTarget(
    s,
    () => doorPos,
    (p) => Math.hypot(p[0] - doorPos.x, p[2] - doorPos.z) <= 1.5,
    700,
    'approach the 蓝血 door',
  );
  assert.equal(s.handles.kanshan.state(), 'roam', '看山 still roaming while the player walks up');
  waitUntil(s, () => s.handles.kanshan.state() === 'to-door:blue-blood', 300, '看山 runs to the door');
  waitUntil(s, () => s.handles.kanshan.state() === 'opening:blue-blood', 300, '看山 starts opening');
  waitUntil(s, () => door.state() === 'open', 420, '蓝血 door fully opens');
  assert.equal(commitsOf(s, 'kanshan.door-opening').length, 1, 'door-opening committed exactly once');
  assert.ok(s.backend.count('osc.start') >= 2, 'chime + creak scheduled on the recording backend');
  waitUntil(s, () => s.handles.kanshan.state() === 'seeoff', 200, 'seeoff beat');
  waitUntil(s, () => s.handles.kanshan.state() === 'roam', 200, 'back to roaming');

  // Push the stick through the doorway: aim at a point 2m PAST the plane (the
  // door center would flip the steering once the plane is crossed), the leaf
  // collider is gone, and the plane crossing commits portal.enter once.
  const through = { x: doorPos.x - door.forward.x * 2, z: doorPos.z - door.forward.z * 2 };
  walkStickToTarget(
    s,
    () => through,
    (p) => p[2] < doorPos.z - 0.6, // ~0.6m behind the plane (door z = -9)
    300,
    'walk through the 蓝血 doorway',
  );
  const enters = commitsOf(s, 'portal.enter');
  assert.equal(enters.length, 1, 'exactly one portal.enter commit');
  assert.equal((enters[0].payload as { target: string }).target, 'blue-blood');
  assert.equal(enters[0].eventId, 'portal:enter:blue-blood');
  assert.deepEqual(seen, ['blue-blood'], 'portalEnter notified exactly once');
  idle(s, 40); // the white fade takes 0.6s (36 steps) to cover
  assert.ok(s.handles.fadeProgress() > 0.9, 'white fade covering after enter');
  assert.deepEqual(VIOLATIONS, [], '看山 never overlapped the player on the way');
  unsubscribe();

  await s.host.stop();
});
