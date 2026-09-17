/**
 * Offline replay evidence for 看山任意门 · Kanshan Hall (experiences/kanshan-hall).
 *
 * Real headless runs of the work module: RuntimeSessionHost (controlled
 * mode) drives fixed steps; a HeadlessInputDevice feeds the same public input
 * path a player uses (keys -> ActionMapper -> FirstPersonController ->
 * PhysicsWorld with real Rapier for the floor). No teleports, no completion
 * shortcuts: the player walks to the 蓝血 door on foot, 看山 opens it, and the
 * portal.enter fact commits exactly once when the doorway is crossed.
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
import { createKanshanHallModule, KANSHAN_MIN_DISTANCE } from '../../experiences/kanshan-hall/src/scene.ts';
import type { KanshanHallWorkHandles } from '../../experiences/kanshan-hall/src/scene.ts';
import { createKanshan } from '../../experiences/kanshan-hall/src/kanshan.ts';
import { createHall } from '../../experiences/kanshan-hall/src/hall.ts';

const DT = 1 / 60;

interface WorkSession {
  host: RuntimeSessionHost;
  device: HeadlessInputDevice;
  backend: RecordingBackend;
  doc: FakeDocument;
  handles: KanshanHallWorkHandles;
}

async function startWorkSession(): Promise<WorkSession> {
  const host = new RuntimeSessionHost({
    experienceDigest: 'kanshan-hall-v1',
    buildId: 'work-kanshan-hall-test',
    mode: 'controlled',
    fixedDt: DT,
  });
  const device = new HeadlessInputDevice();
  const backend = new RecordingBackend();
  const doc = new FakeDocument();
  const module = createKanshanHallModule({ device, audioBackend: backend, document: doc });
  await host.start(module);
  const handles = module.handles as KanshanHallWorkHandles | undefined;
  assert.ok(handles, 'module exposes its handles once create() resolves');
  return { host, device, backend, doc, handles };
}

// ------------------------------ stepping ----------------------------------
// Every stepping helper samples the 看山↔player distance EACH step: the
// minimum-distance invariant (test quality bar #4) is checked continuously,
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

function idle(s: WorkSession, n: number): void {
  for (let i = 0; i < n; i += 1) {
    s.host.step(1);
    assertMinDistance(s);
  }
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

function waitUntil(s: WorkSession, pred: () => boolean, maxSteps: number, label: string): void {
  for (let i = 0; i < maxSteps; i += 1) {
    if (pred()) return;
    s.host.step(1);
    assertMinDistance(s);
  }
  assert.ok(pred(), `${label}: condition never met within ${maxSteps} steps`);
}

function commitsOf(s: WorkSession, name: string): EventEnvelope[] {
  const result = s.host.query({ kind: 'commits', limit: 500 });
  assert.ok(result.ok, 'commits query succeeds');
  return (result.data as EventEnvelope[]).filter((e) => e.name === name);
}

// ---------------------------------- tests -----------------------------------

test('intro: natural completion and skip(finish policy) reach the same end state', async () => {
  const natural = await startWorkSession();
  const skipped = await startWorkSession();

  // Natural: run the whole intro (~12.8s), catching the greet subtitle.
  idle(natural, 420);
  waitUntil(
    natural,
    () => natural.handles.hud.subtitle.text === '来啦？欢迎。我是刘看山——这片地方的看门人，也算是向导。',
    240,
    'greet line shown during the natural intro',
  );
  idle(natural, 430);
  assert.deepEqual(VIOLATIONS, [], 'no min-distance violations during the natural intro');
  assert.equal(natural.handles.introState(), 'completed', 'intro completes naturally');
  assert.equal(natural.handles.director.activeRig?.name, 'player-head', 'camera handed back after the intro');

  // Skipped: bail out almost immediately, catching the same greet subtitle.
  idle(skipped, 3);
  skipped.handles.skipIntro();
  assert.equal(skipped.handles.introState(), 'skipped', 'skip applies the finish policy');
  waitUntil(
    skipped,
    () => skipped.handles.hud.subtitle.text === '来啦？欢迎。我是刘看山——这片地方的看门人，也算是向导。',
    120,
    'greet line shown after the skip',
  );
  idle(skipped, 727); // same total step count as the natural session
  assert.deepEqual(VIOLATIONS, [], 'no min-distance violations after the skip');
  // The behind-the-player follow target takes a few hundred steps to converge
  // from the intro end-spot; give both sessions an identical settle buffer so
  // the comparison is state-vs-state, not step-count-vs-step-count.
  idle(natural, 400);
  idle(skipped, 400);

  // Same end state.
  for (const s of [natural, skipped]) {
    assert.equal(s.handles.hall.entryDoor.state(), 'open', 'entry door open');
    assert.equal(s.handles.kanshan.state(), 'follow', 'guide FSM in follow');
    assert.equal(s.handles.fadeProgress(), 0, 'intro fade fully cleared');
    for (const name of ['kanshan.intro-begin', 'kanshan.intro-door', 'kanshan.intro-greet', 'kanshan.intro-guide']) {
      assert.equal(commitsOf(s, name).length, 1, `${name} committed exactly once`);
    }
  }
  const ka = natural.handles.kanshanRef.position;
  const kb = skipped.handles.kanshanRef.position;
  assert.ok(
    Math.hypot(ka.x - kb.x, ka.z - kb.z) < 1e-6 && Math.abs(ka.y - kb.y) < 1e-6,
    '看山 at the same spot in both runs',
  );
  assert.equal(natural.handles.kanshanRef.currentAction, skipped.handles.kanshanRef.currentAction);
  assert.deepEqual(
    natural.handles.recordedCommits.map((c) => c.name).sort(),
    skipped.handles.recordedCommits.map((c) => c.name).sort(),
    'identical commit streams',
  );

  await natural.host.stop();
  await skipped.host.stop();
});

test('guide: walking to the 蓝血 door makes 看山 open it; crossing commits portal.enter exactly once', async () => {
  const s = await startWorkSession();
  s.handles.skipIntro();
  s.handles.unlockAudio();
  idle(s, 240); // settle the skip + follow state

  // Frozen contract surface of the three doors.
  assert.deepEqual(
    s.handles.doors.map((d) => d.id).sort(),
    ['blue-blood', 'duanfei', 'myopia'],
  );
  const blueBlood = s.handles.doors.find((d) => d.id === 'blue-blood')!;
  assert.equal(blueBlood.title, '蓝血');
  assert.equal(blueBlood.state(), 'closed');
  assert.ok(s.handles.doors.every((d) => d.state() === 'closed'), 'all doors start closed');

  // portalEnter subscription: exactly one notification per committed enter,
  // and late subscribers get no replay.
  const seen: string[] = [];
  const unsubscribe = s.handles.portalEnter.onEnter((target) => seen.push(target));

  // Walk straight to the 蓝血 door (dead ahead at spawn yaw).
  walkUntil(s, (p) => p[2] < -7.4, 700, 'approach the 蓝血 door');
  waitUntil(
    s,
    () => s.handles.kanshan.state() === 'opening:blue-blood',
    300,
    '看山 transitions to opening the 蓝血 door',
  );
  waitUntil(s, () => blueBlood.state() === 'open', 420, '蓝血 door fully opens');
  assert.equal(commitsOf(s, 'kanshan.door-opening').length, 1, 'door-opening fact committed exactly once');
  assert.ok(s.backend.count('osc.start') >= 2, 'chime + creak scheduled on the recording backend');

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

test('reEnter: return line shown near the door, fade clears, no duplicate enter commit', async () => {
  const s = await startWorkSession();
  s.handles.skipIntro();
  idle(s, 240);

  walkUntil(s, (p) => p[2] < -7.4, 700, 'approach the 蓝血 door');
  waitUntil(s, () => s.handles.kanshan.state() === 'opening:blue-blood', 300, '看山 opening');
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
    () => s.handles.hud.subtitle.text === '回来啦？这次的故事怎么样。',
    700,
    'return line shown once the open/seeoff lines finish',
  );
  const k = s.handles.kanshanRef.position;
  assert.ok(
    Math.hypot(k.x - 0, k.z - -9) < 2.2,
    `看山 greets near the 蓝血 door (at ${k.x.toFixed(2)}, ${k.z.toFixed(2)})`,
  );
  idle(s, 240);
  assert.equal(commitsOf(s, 'portal.enter').length, 1, 'reEnter never duplicates the enter commit');

  await s.host.stop();
});

test('看山 geometry: ears/nose/eyes present; walk animation moves the limbs', () => {
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

    // setYawToward turns rate-limited toward the target.
    k.setPosition(0, 0, 0);
    k.setYawToward(10, 0, DT);
    assert.ok(k.object.rotation.y > 0.05 && k.object.rotation.y < 0.3, 'yaw steps toward the target');
  } finally {
    k.dispose();
  }
});

test('hall headless: plaque textures degrade gracefully (no DOM, failing loader, plain loader)', () => {
  // No loader, no DOM: geometry builds, nothing throws.
  const scopeA = new Scope();
  try {
    const hall = createHall({ scope: scopeA } as unknown as SceneContext, { random: () => 0.5 });
    assert.equal(hall.doors.length, 3);
    assert.ok(hall.object.getObjectByName('hall/door/blue-blood/plaque'), 'plaque mesh built headless');
    hall.update(DT);
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
