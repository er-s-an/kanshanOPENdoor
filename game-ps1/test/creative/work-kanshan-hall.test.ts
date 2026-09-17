/**
 * Offline replay evidence for 看山任意门 · Kanshan Hall (experiences/kanshan-hall).
 *
 * Real headless runs of the work module: RuntimeSessionHost (controlled
 * mode) drives fixed steps; a HeadlessInputDevice feeds the same public input
 * path a player uses (keys -> ActionMapper -> FirstPersonController ->
 * PhysicsWorld with real Rapier for the floor). No teleports, no completion
 * shortcuts: the player walks to the 蓝血 door on foot, 看山 roams over and
 * opens it, and the portal.enter fact commits exactly once when the doorway
 * is crossed.
 *
 * Covered behavior (per the blue-white art direction + behavior feedback):
 *   (a) intro natural-vs-skip end-state parity (cancelPolicy 'finish');
 *   (b) the hall starts near-black and the lights ramp up after 看山 steps
 *       out (handles.lightingRamp);
 *   (c) 看山 free-roams without any player input, covers multiple waypoint
 *       areas, and never comes within 1.2m of the player;
 *   (d) the door flow: player lingers at the 蓝血 door, 看山 comes from
 *       roam, opens it, exactly one portal.enter {target:'blue-blood'};
 *   (e) head subtitles: greet line above his head + HUD fallback off-camera;
 *   (f) no mist: no particle Points under the hall group, no mist param;
 *   (g) palette sanity: light floor, blue-trimmed columns.
 *
 * Evidence limits: audio assertions are AUDIO_SCHEDULING_ONLY (RecordingBackend
 * log), rendering is NOT_MEASURED headless.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RuntimeSessionHost } from '../../src/creative/core/host.ts';
import type { EventEnvelope } from '../../src/creative/core/events.ts';
import type { SceneContext } from '../../src/creative/core/context.ts';
import { Scope } from '../../src/creative/core/scope.ts';
import type { Vec3 } from '../../src/creative/core/spatial.ts';
import { HeadlessInputDevice } from '../../src/creative/input/headless.ts';
import { RecordingBackend } from '../../src/creative/audio/backend.ts';
import { FakeDocument } from '../../src/creative/ui/fakedom.ts';
import {
  createKanshanHallModule,
  describeParameters,
  KANSHAN_MIN_DISTANCE,
  ROAM_WAYPOINTS,
} from '../../experiences/kanshan-hall/src/scene.ts';
import type { KanshanHallWorkHandles } from '../../experiences/kanshan-hall/src/scene.ts';
import { HEAD_SAY_CLASS } from '../../experiences/kanshan-hall/src/headsay.ts';
import { createKanshan } from '../../experiences/kanshan-hall/src/kanshan.ts';
import { createHall } from '../../experiences/kanshan-hall/src/hall.ts';
import { DIALOGUE } from '../../experiences/kanshan-hall/src/dialogue.ts';

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
    buildId: 'work-kanshan-hall-test',
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
// Every stepping helper samples the 看山↔player distance EACH step: the
// minimum-distance invariant (test quality bar) is checked continuously,
// not just at the end of a route.

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

function walkKeyUntil(s: WorkSession, key: string, pred: (p: Vec3) => boolean, maxSteps: number, label: string): number {
  s.device.keyDown(key);
  let steps = 0;
  try {
    while (steps < maxSteps) {
      s.host.step(1);
      steps += 1;
      assertMinDistance(s);
      if (pred(pos(s))) return steps;
    }
  } finally {
    s.device.keyUp(key);
  }
  assert.ok(pred(pos(s)), `${label}: predicate never satisfied within ${maxSteps} steps (pos ${pos(s)})`);
  return steps;
}

function walkUntil(s: WorkSession, pred: (p: Vec3) => boolean, maxSteps: number, label: string): number {
  return walkKeyUntil(s, 'KeyW', pred, maxSteps, label);
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

function commitsOf(s: WorkSession, name: string): EventEnvelope[] {
  const result = s.host.query({ kind: 'commits', limit: 500 });
  assert.ok(result.ok, 'commits query succeeds');
  return (result.data as EventEnvelope[]).filter((e) => e.name === name);
}

/** Let the intro dialogue drain so later lines are assertable in isolation.
 *  Always steps at least once: the FSM also needs a step after skipIntro. */
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

// ---------------------------------- tests -----------------------------------

test('intro: natural completion and skip(finish policy) reach the same end state', async () => {
  const natural = await startWorkSession();
  const skipped = await startWorkSession();

  // Natural: catch the greet bubble mid-intro, then let it complete.
  const nGreet = waitUntil(
    natural,
    () => natural.handles.headSubtitle.text() === DIALOGUE.greet,
    600,
    'greet line shown above his head during the natural intro',
  );
  assert.ok(nGreet > 60, 'the greet does not fire at the very first step');
  assert.equal(natural.handles.introState(), 'running', 'intro still running when the greet fires');
  const nComp = waitUntil(natural, () => natural.handles.introState() === 'completed', 500, 'natural intro completes');
  const kn0 = natural.handles.kanshanRef.position;
  assert.ok(
    Math.hypot(kn0.x - 0, kn0.z - 5.2) < 1e-6,
    'natural: 看山 stands at the stage the moment the intro completes',
  );
  assert.equal(natural.handles.kanshanRef.currentAction, 'idle', 'natural: the guide cue leaves him idle');
  // No step taken since completion: the FSM is still formally in 'intro';
  // it fires intro-done on the next mechanics update (roam tick 1).
  idle(natural, 1);

  // Skipped: bail out almost immediately; the finish policy fast-forwards to
  // the same semantic end state (all cues committed once, in order).
  idle(skipped, 3);
  skipped.handles.skipIntro();
  idle(skipped, 1); // roam step 1: intro-done fires on this mechanics update
  assert.equal(skipped.handles.introState(), 'skipped', 'skip applies the finish policy');
  // The peek line (said moments before) is still current; the greet is
  // queued right behind it — parity means the same lines, same order.
  assert.equal(skipped.handles.headSubtitle.text(), DIALOGUE.peek, 'peek line current right after the skip');
  const sGreet = waitUntil(
    skipped,
    () => skipped.handles.headSubtitle.text() === DIALOGUE.greet,
    300,
    'greet follows the peek after the skip',
  );

  // Same scene end state (both sessions have roamed a little by now).
  for (const s of [natural, skipped]) {
    assert.equal(s.handles.hall.entryDoor.state(), 'open', 'entry door open');
    assert.equal(s.handles.kanshan.state(), 'roam', 'guide FSM roaming');
    assert.equal(s.handles.fadeProgress(), 0, 'no black overlay (the crack had to shine through)');
    assert.equal(s.handles.lightingRamp(), 1, 'hall lights fully ramped up');
    for (const name of [
      'kanshan.intro-begin',
      'kanshan.intro-door',
      'kanshan.intro-peek',
      'kanshan.intro-stepout',
      'kanshan.intro-greet',
      'kanshan.intro-guide',
    ]) {
      assert.equal(commitsOf(s, name).length, 1, `${name} committed exactly once`);
    }
  }
  assert.deepEqual(VIOLATIONS, [], 'no min-distance violations during either intro');

  // Identical commit streams (names + payloads + eventIds, in order).
  const strip = (s: WorkSession) =>
    s.handles.recordedCommits.map((c) => `${c.eventId}:${JSON.stringify(c.payload)}`);
  assert.deepEqual(strip(natural), strip(skipped), 'identical intro commit streams');

  // Roam is deterministic: expose BOTH sessions to the same number of roam
  // steps from their shared intro end state, and they land bitwise-identical
  // (natural has roamed 1 step since completion; skipped has roamed
  // 1 + sGreet — the step after the skip plus the greet wait).
  const HORIZON = 300;
  idle(natural, HORIZON - 1);
  idle(skipped, HORIZON - 1 - sGreet);
  const ka = natural.handles.kanshanRef.position;
  const kb = skipped.handles.kanshanRef.position;
  assert.ok(
    Math.hypot(ka.x - kb.x, ka.z - kb.z) < 1e-6 && Math.abs(ka.y - kb.y) < 1e-6,
    '看山 wanders identically from the shared intro end state',
  );
  assert.equal(natural.handles.kanshan.state(), skipped.handles.kanshan.state());
  assert.equal(natural.handles.kanshanRef.currentAction, skipped.handles.kanshanRef.currentAction);
  assert.deepEqual(VIOLATIONS, [], 'no min-distance violations while roaming');

  await natural.host.stop();
  await skipped.host.stop();
});

test('intro: the hall starts dark and the lights ramp up after 看山 steps out', async () => {
  const s = await startWorkSession();

  // The first ~1.5s are essentially black except the door crack: no fade
  // overlay at all, and the hall light ramp sits at its near-zero start.
  idle(s, 10);
  assert.equal(s.handles.fadeProgress(), 0, 'no ScreenFade overlay hiding the crack');
  assert.ok(s.handles.lightingRamp() < 0.1, `lights down at t≈0.2s (ramp ${s.handles.lightingRamp()})`);
  idle(s, 80); // t≈1.5s
  assert.ok(s.handles.lightingRamp() < 0.1, `lights still down at t≈1.5s (ramp ${s.handles.lightingRamp()})`);
  idle(s, 60); // t≈2.5s: the doorway is opening, the hall itself stays dark
  assert.ok(s.handles.lightingRamp() < 0.1, `hall still dark while the doorway opens (ramp ${s.handles.lightingRamp()})`);
  const crack = s.handles.hall.object.getObjectByName('hall/door/entry/crack') as THREE.Mesh;
  assert.ok(crack && (crack.material as THREE.MeshBasicMaterial).opacity > 0.05, 'the crack of light is showing');

  // After he steps out and greets, the lighting ramps up around him.
  waitUntil(s, () => s.handles.headSubtitle.text() === DIALOGUE.greet, 600, 'greet fires');
  idle(s, 30); // 0.5s into the ~2.4s light ramp
  const midRamp = s.handles.lightingRamp();
  assert.ok(midRamp > 0.15 && midRamp < 1, `ramp climbing during the greet (ramp ${midRamp})`);
  waitUntil(s, () => s.handles.introState() === 'completed', 500, 'intro completes');
  assert.equal(s.handles.lightingRamp(), 1, 'hall lights fully up after the intro');
  assert.deepEqual(VIOLATIONS, [], 'no min-distance violations during the dark open');

  await s.host.stop();
});

test('roam: 看山 wanders on his own, covers the hall, and never invades the player', async () => {
  const s = await startWorkSession();
  s.handles.skipIntro();
  idle(s, 5);

  assert.equal(s.handles.kanshan.state(), 'roam', 'roaming without any player input');
  const visited = new Set<number>();
  let moved = 0;
  let prev = { x: s.handles.kanshanRef.position.x, z: s.handles.kanshanRef.position.z };
  for (let i = 0; i < 900; i += 1) {
    s.host.step(1);
    assertMinDistance(s);
    const k = s.handles.kanshanRef.position;
    moved += Math.hypot(k.x - prev.x, k.z - prev.z);
    prev = { x: k.x, z: k.z };
    ROAM_WAYPOINTS.forEach((w, wi) => {
      if (Math.hypot(k.x - w[0], k.z - w[2]) < 1.2) visited.add(wi);
    });
    if (i % 100 === 0) assert.equal(s.handles.kanshan.state(), 'roam', 'still roaming mid-wander');
  }

  assert.ok(moved >= 6, `看山 covered real ground on his own (${moved.toFixed(1)}m)`);
  assert.ok(visited.size >= 2, `看山 reached ${visited.size} distinct waypoint areas`);
  assert.deepEqual(VIOLATIONS, [], 'never came within 1.2m of the stationary player');

  await s.host.stop();
});

test('door flow: from roam 看山 opens the 蓝血 door; crossing commits portal.enter exactly once', async () => {
  const s = await startWorkSession();
  s.handles.skipIntro();
  s.handles.unlockAudio();
  settleLines(s);

  // Frozen contract surface of the three doors.
  assert.deepEqual(
    s.handles.doors.map((d) => d.id).sort(),
    ['blue-blood', 'duanfei', 'myopia'],
  );
  const blueBlood = s.handles.doors.find((d) => d.id === 'blue-blood')!;
  assert.equal(blueBlood.title, '蓝血');
  assert.equal(blueBlood.state(), 'closed');
  assert.ok(s.handles.doors.every((d) => d.state() === 'closed'), 'all doors start closed');
  for (const d of s.handles.doors) {
    assert.equal(typeof d.title, 'string');
    assert.ok(['closed', 'opening', 'open'].includes(d.state()), 'door state() contract');
  }

  // portalEnter subscription: exactly one notification per committed enter,
  // and late subscribers get no replay.
  const seen: string[] = [];
  const unsubscribe = s.handles.portalEnter.onEnter((target) => seen.push(target));

  // Walk straight to the 蓝血 door (dead ahead at spawn yaw); 看山 is roaming.
  assert.equal(s.handles.kanshan.state(), 'roam', '看山 starts from roam');
  walkUntil(s, (p) => p[2] < -7.4, 700, 'approach the 蓝血 door');
  assert.equal(s.handles.kanshan.state(), 'roam', '看山 still roaming while the player walks up');
  waitUntil(
    s,
    () => s.handles.kanshan.state() === 'to-door:blue-blood',
    300,
    '看山 runs to the 蓝血 door from roam',
  );
  waitUntil(s, () => s.handles.kanshan.state() === 'opening:blue-blood', 300, '看山 starts opening');
  idle(s, 3); // the open line is said on the first opening-state update
  assert.equal(
    s.handles.headSubtitle.text(),
    DIALOGUE['open.blue-blood'],
    'the open line plays above his head',
  );
  waitUntil(s, () => blueBlood.state() === 'open', 420, '蓝血 door fully opens');
  assert.equal(commitsOf(s, 'kanshan.door-opening').length, 1, 'door-opening fact committed exactly once');
  assert.ok(s.backend.count('osc.start') >= 2, 'chime + creak scheduled on the recording backend');
  waitUntil(s, () => s.handles.kanshan.state() === 'seeoff', 200, 'seeoff beat');
  waitUntil(s, () => s.handles.kanshan.state() === 'roam', 200, 'back to roaming');

  // Keep walking through the doorway.
  walkUntil(s, (p) => p[2] < -9.6, 300, 'walk through the 蓝血 doorway');
  const enters = commitsOf(s, 'portal.enter');
  assert.equal(enters.length, 1, 'exactly one portal.enter commit');
  assert.equal((enters[0].payload as { target: string }).target, 'blue-blood');
  assert.equal(enters[0].eventId, 'portal:enter:blue-blood');
  assert.deepEqual(seen, ['blue-blood'], 'portalEnter notified exactly once');
  idle(s, 40); // the white fade takes 0.6s (36 steps) to cover
  assert.ok(s.handles.fadeProgress() > 0.9, 'white fade covering the screen after enter');
  assert.deepEqual(VIOLATIONS, [], '看山 never overlapped the player on the way');

  // Walking back out (S = backward) and re-entering must not re-commit
  // (per-door session set).
  walkKeyUntil(s, 'KeyS', (p) => p[2] > -8.4, 300, 'step back out of the doorway');
  walkUntil(s, (p) => p[2] < -9.6, 300, 'step through again');
  assert.equal(commitsOf(s, 'portal.enter').length, 1, 'no duplicate portal.enter');
  assert.deepEqual(seen, ['blue-blood']);

  // Late subscription replays nothing.
  const late: string[] = [];
  s.handles.portalEnter.onEnter((target) => late.push(target));
  idle(s, 30);
  assert.deepEqual(late, [], 'late portalEnter subscribers get no replay');
  unsubscribe();

  await s.host.stop();
});

test('head subtitles: greet above his head; HUD fallback when he is off-camera or far away', async () => {
  const s = await startWorkSession();

  // (e) During the greet, the line is the head subtitle...
  waitUntil(s, () => s.handles.headSubtitle.text() === DIALOGUE.greet, 600, 'greet fires');
  assert.equal(s.handles.headSubtitle.bubbleVisible(), true, 'bubble on screen while the stage camera is on him');
  const bubble = s.doc.root.queryByClass(HEAD_SAY_CLASS);
  assert.ok(bubble, 'kanshan-say element exists in the injected document');
  assert.equal(bubble!.textContent, DIALOGUE.greet, 'bubble carries the greet line (textContent only)');
  assert.equal(s.handles.hud.subtitle.text, '', 'HUD stays clear while the bubble is visible');
  assert.ok((bubble!.getAttribute('style') ?? '').includes('left:'), 'bubble position projected to CSS pixels');
  waitUntil(s, () => s.handles.introState() === 'completed', 500, 'intro completes');
  // The intro/guide lines were queued mid-timeline and outlive it by design.
  waitUntil(s, () => s.handles.headSubtitle.text() === '', 500, 'intro lines expire');

  // Fallback: 看山 behind the player (off-camera) — the line moves to the HUD.
  s.handles.kanshanRef.setPosition(0, 0, 12);
  s.handles.reEnter();
  idle(s, 2);
  assert.equal(s.handles.headSubtitle.text(), DIALOGUE.return, 'accessor reports the return line regardless of channel');
  assert.equal(s.handles.headSubtitle.bubbleVisible(), false, 'bubble hidden while he is off-camera');
  assert.equal(s.handles.hud.subtitle.text, DIALOGUE.return, 'HUD fallback carries the line');

  // Fallback by distance: far in front (>9m) the bubble also gives way.
  s.handles.hud.subtitle.clear();
  s.handles.kanshanRef.setPosition(0, 0, -11.5); // ≈18.5m ahead of the player
  s.handles.reEnter();
  idle(s, 2);
  assert.equal(s.handles.headSubtitle.text(), DIALOGUE.return);
  assert.equal(s.handles.headSubtitle.bubbleVisible(), false, 'bubble hidden beyond 9m even on-camera');
  assert.equal(s.handles.hud.subtitle.text, DIALOGUE.return, 'HUD fallback covers the far line');
  assert.deepEqual(VIOLATIONS, [], 'teleporting him around never overlapped the player');

  await s.host.stop();
});

test('reEnter: return line shown beside the door, fade clears, no duplicate enter commit', async () => {
  const s = await startWorkSession();
  s.handles.skipIntro();
  settleLines(s);

  walkUntil(s, (p) => p[2] < -7.4, 700, 'approach the 蓝血 door');
  waitUntil(s, () => s.handles.kanshan.state() === 'opening:blue-blood', 400, '看山 opening');
  waitUntil(s, () => s.handles.doors.find((d) => d.id === 'blue-blood')!.state() === 'open', 420, 'door open');
  walkUntil(s, (p) => p[2] < -9.6, 300, 'cross the doorway');
  assert.equal(commitsOf(s, 'portal.enter').length, 1);
  idle(s, 40);
  assert.ok(s.handles.fadeProgress() > 0.9, 'fade covered after entering');
  assert.deepEqual(VIOLATIONS, [], '看山 never overlapped the player on the way');

  // The host drops its world overlay and returns the player to the hall.
  s.handles.reEnter();
  idle(s, 120); // 2s: fade (1.2s) clears
  assert.equal(s.handles.fadeProgress(), 0, 'fade cleared after reEnter');
  waitUntil(
    s,
    () => s.handles.headSubtitle.text() === DIALOGUE.return,
    500,
    'return line shown once the earlier lines (seeoff) finish',
  );
  const k = s.handles.kanshanRef.position;
  assert.ok(
    Math.hypot(k.x - 0, k.z - -9) < 2.2,
    `看山 greets beside the 蓝血 door (at ${k.x.toFixed(2)}, ${k.z.toFixed(2)})`,
  );
  idle(s, 240);
  assert.equal(commitsOf(s, 'portal.enter').length, 1, 'reEnter never duplicates the enter commit');

  await s.host.stop();
});

test('no mist: the hall group has no particle Points and the mist parameter is gone', async () => {
  // Static declaration: only door-glow remains.
  assert.deepEqual(
    describeParameters().map((d) => d.authorId),
    ['kanshan-hall.door-glow'],
    'mist-density removed from describeParameters',
  );

  const s = await startWorkSession();
  s.handles.skipIntro();
  idle(s, 30);
  assert.deepEqual(
    s.handles.params.list().map((b) => b.authorId),
    ['kanshan-hall.door-glow'],
    'live registry exposes only door-glow',
  );

  // Scene-graph sweep: no THREE.Points anywhere under the hall group.
  let pointsCount = 0;
  s.handles.hall.object.traverse((o) => {
    if ((o as THREE.Points).isPoints === true) pointsCount += 1;
  });
  assert.equal(pointsCount, 0, 'no particle emitters under the hall group');
  assert.equal(s.handles.hall.object.getObjectByName('hall/crystals') !== null, true, 'crystals replaced the decor');
  assert.equal(s.handles.hall.object.getObjectByName('hall/center-pulse') !== null, true, 'pulse ring present');

  await s.host.stop();
});

test('palette: bright blue-white hall (light floor, blue-trimmed columns, bright hemisphere)', async () => {
  const s = await startWorkSession();

  // Light glossy floor: every channel well above 0.7.
  const floor = s.handles.hall.object.getObjectByName('hall/floor') as THREE.Mesh;
  assert.ok(floor, 'floor mesh present');
  const floorColor = (floor.material as THREE.MeshPhongMaterial).color;
  assert.ok(
    floorColor.r > 0.7 && floorColor.g > 0.7 && floorColor.b > 0.7,
    `floor is near-white (rgb ${floorColor.r.toFixed(2)},${floorColor.g.toFixed(2)},${floorColor.b.toFixed(2)})`,
  );

  // At least one blue-trimmed column: white shaft + blue capital band.
  const column = s.handles.hall.object.getObjectByName('hall/column-0');
  assert.ok(column, 'column ring present');
  const capital = s.handles.hall.object.getObjectByName('hall/column-0/capital') as THREE.Mesh;
  const shaft = s.handles.hall.object.getObjectByName('hall/column-0/shaft') as THREE.Mesh;
  assert.ok(capital && shaft, 'capital band + shaft present');
  const capitalColor = (capital.material as THREE.MeshLambertMaterial).color;
  const shaftColor = (shaft.material as THREE.MeshLambertMaterial).color;
  assert.ok(capitalColor.b > 0.4 && capitalColor.b > capitalColor.r, 'capital trim is blue');
  assert.ok(shaftColor.r > 0.7 && shaftColor.g > 0.7 && shaftColor.b > 0.7, 'column shaft is white');

  // Bright blue hemisphere light (the daylight the ramp modulates).
  const hemi = s.handles.hall.object.getObjectByName('hall/ambient') as THREE.HemisphereLight;
  assert.ok(hemi, 'hemisphere light present');
  assert.ok(hemi.intensity >= 2.5, `bright hemisphere (intensity ${hemi.intensity})`);
  assert.ok(hemi.color.b > hemi.color.r && hemi.color.b >= hemi.color.g, 'sky tint is blue (#dfeaff)');
  assert.equal(hemi.groundColor.getHex(), 0xb8c8e8, 'ground tint #b8c8e8');

  // Translucent blue crystals + blue ring inlays + soft door wayfinding glow.
  const crystals = s.handles.hall.object.getObjectByName('hall/crystals') as THREE.InstancedMesh;
  assert.ok(crystals, 'crystals present');
  assert.equal((crystals.material as THREE.MeshLambertMaterial).transparent, true, 'crystals are translucent');
  const crystalColor = (crystals.material as THREE.MeshLambertMaterial).color;
  assert.ok(crystalColor.b > crystalColor.r, 'crystals are blue');
  const ring = s.handles.hall.object.getObjectByName('hall/ring-0') as THREE.Mesh;
  assert.equal((ring.material as THREE.MeshBasicMaterial).color.getHex(), 0x0066ff, 'blue ring inlay (#0066ff)');
  const blueGlow = s.handles.hall.object.getObjectByName('hall/door/blue-blood/glow') as THREE.Mesh;
  assert.equal((blueGlow.material as THREE.MeshBasicMaterial).color.getHex(), 0x5a8fd4, '蓝血 glow accent kept');

  // No scene fog and no scene background (host pipeline owns the backdrop).
  assert.equal(s.handles.hall.object.parent !== null, true);
  await s.host.stop();
});

test('看山 geometry: ears/nose/eyes present; walk animation moves the limbs; peek perks the ears', () => {
  const k = createKanshan();
  try {
    let meshCount = 0;
    k.object.traverse((o) => {
      if ((o as THREE.Mesh).isMesh === true) meshCount += 1;
    });
    assert.ok(meshCount >= 15, `procedural mascot has real geometry (${meshCount} meshes)`);
    for (const name of [
      'kanshan/torso',
      'kanshan/ear-l',
      'kanshan/ear-r',
      'kanshan/nose',
      'kanshan/eye-l',
      'kanshan/eye-r',
      'kanshan/arm-l',
      'kanshan/arm-r',
      'kanshan/leg-l',
      'kanshan/leg-r',
      'kanshan/tail',
    ]) {
      assert.ok(k.object.getObjectByName(name), `${name} present`);
    }

    // Walk: the waddle swings legs and arms over time.
    k.play('walk');
    const leg = k.object.getObjectByName('kanshan/leg-l')!;
    const arm = k.object.getObjectByName('kanshan/arm-r')!;
    const legSamples: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      k.update(DT);
      legSamples.push(leg.rotation.x);
    }
    const spread = Math.max(...legSamples) - Math.min(...legSamples);
    assert.ok(spread > 0.3, `walk swings the leg (rotation spread ${spread.toFixed(3)})`);
    assert.ok(
      Math.abs(arm.rotation.x) > 0.05,
      'walk swings the arms counter to the legs',
    );

    // Wave raises the right arm; idle returns it.
    k.play('wave');
    for (let i = 0; i < 60; i += 1) k.update(DT);
    assert.ok(arm.rotation.z < -1.5, `wave raises the right arm (rotation.z ${arm.rotation.z.toFixed(2)})`);

    // Peek: ears perk (outward tilt collapses) while he leans out.
    k.play('peek');
    for (let i = 0; i < 60; i += 1) k.update(DT);
    const earR = k.object.getObjectByName('kanshan/ear-r')!;
    const body = k.object.getObjectByName('kanshan/body')!;
    assert.ok(Math.abs(earR.rotation.z) < 0.15, `peek perks the ears (rotation.z ${earR.rotation.z.toFixed(2)})`);
    assert.ok(body.rotation.x > 0.2, `peek leans out (body tilt ${body.rotation.x.toFixed(2)})`);

    // setYawToward turns rate-limited toward the target.
    k.setPosition(0, 0, 0);
    k.setYawToward(10, 0, DT);
    assert.ok(k.object.rotation.y > 0.05 && k.object.rotation.y < 0.3, 'yaw steps toward the target');
  } finally {
    k.dispose();
  }
});

test('hall headless: plaque textures degrade gracefully; decor and light ramp run without a DOM', () => {
  // No loader, no DOM: geometry builds, nothing throws.
  const scopeA = new Scope();
  try {
    const hall = createHall({ scope: scopeA } as unknown as SceneContext, { random: () => 0.5 });
    assert.equal(hall.doors.length, 3);
    assert.ok(hall.object.getObjectByName('hall/door/blue-blood/plaque'), 'plaque mesh built headless');
    assert.ok(hall.object.getObjectByName('hall/column-5'), 'columns built headless');
    assert.equal(hall.lightRamp(), 1, 'standalone hall starts fully lit');
    hall.setLightRamp(0.2);
    assert.equal(hall.lightRamp(), 0.2, 'light ramp applies');
    hall.setLightRamp(1);
    const pulse = hall.object.getObjectByName('hall/center-pulse') as THREE.Mesh;
    hall.update(DT);
    const pulseA = (pulse.material as THREE.MeshBasicMaterial).opacity;
    for (let i = 0; i < 60; i += 1) hall.update(DT);
    const pulseB = (pulse.material as THREE.MeshBasicMaterial).opacity;
    assert.notEqual(pulseA, pulseB, 'center pulse ring animates');
    let pointsCount = 0;
    hall.object.traverse((o) => {
      if ((o as THREE.Points).isPoints === true) pointsCount += 1;
    });
    assert.equal(pointsCount, 0, 'no particles in the standalone hall either');
    assert.equal(hall.entryDoor.state(), 'closed');
  } finally {
    scopeA.dispose();
  }

  // Failing loader: plaques keep their fallback material, doors still work.
  const scopeB = new Scope();
  try {
    const failingLoader = {
      load(_url: string, _onLoad?: (t: unknown) => void, _onProgress?: unknown, onError?: (err: unknown) => void) {
        onError?.(new Error('no images in node'));
      },
    };
    const hall = createHall({ scope: scopeB } as unknown as SceneContext, {
      textureLoader: failingLoader,
      random: () => 0.5,
    });
    hall.update(DT);
    assert.ok(hall.object.getObjectByName('hall/door/duanfei/plaque'), 'plaque survives loader failure');
    const myopia = hall.doors.find((d) => d.id === 'myopia')!;
    myopia.open();
    for (let i = 0; i < 120; i += 1) hall.update(DT);
    assert.equal(myopia.state(), 'open', 'door opens after a failed texture load');
    assert.ok(myopia.glowLevel() > 0.9, 'glow ramps to full');
  } finally {
    scopeB.dispose();
  }

  // Plain loader that delivers a texture-like object synchronously.
  const scopeC = new Scope();
  try {
    const plainLoader = {
      load(_url: string, onLoad?: (t: unknown) => void) {
        onLoad?.({ colorSpace: '' });
      },
    };
    const hall = createHall({ scope: scopeC } as unknown as SceneContext, {
      textureLoader: plainLoader,
      random: () => 0.5,
    });
    for (let i = 0; i < 30; i += 1) hall.update(DT);
    assert.ok(hall.doors.every((d) => d.state() === 'closed'));
  } finally {
    scopeC.dispose();
  }
});
