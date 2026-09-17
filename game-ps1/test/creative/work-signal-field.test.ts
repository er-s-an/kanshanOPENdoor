/**
 * Offline replay evidence for 旷野信号站 · Signal Field (experiences/signal-field).
 *
 * Real headless runs of the work module: RuntimeSessionHost (controlled mode)
 * drives fixed steps; a HeadlessInputDevice feeds the same public input path a
 * player uses (keys -> ActionMapper -> TopDownController -> PhysicsWorld). No
 * setState, no teleports, no completion-event shortcuts: masts align because
 * scripted walks reach them and scripted presses rotate them; the NPC's
 * approach is observed from its committed kinematic position every step.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RuntimeSessionHost } from '../../src/creative/core/host.ts';
import type { EventEnvelope } from '../../src/creative/core/events.ts';
import type { Vec3 } from '../../src/creative/core/spatial.ts';
import { HeadlessInputDevice } from '../../src/creative/input/headless.ts';
import { RecordingBackend } from '../../src/creative/audio/backend.ts';
import { FakeDocument } from '../../src/creative/ui/fakedom.ts';
import { SessionStateBag } from '../../src/creative/state/cross-scene.ts';
import { createSignalFieldModule } from '../../experiences/signal-field/src/scene.ts';
import type { SignalCheckpoint, SignalFieldModule, SignalHandles } from '../../experiences/signal-field/src/scene.ts';

const DT = 1 / 60;

interface WorkSession {
  host: RuntimeSessionHost;
  device: HeadlessInputDevice;
  backend: RecordingBackend;
  doc: FakeDocument;
  module: SignalFieldModule;
  handles: SignalHandles;
}

interface StartOptions {
  scene?: 'field' | 'bunker';
  bag?: SessionStateBag;
  checkpoint?: unknown;
  reduceMotion?: boolean;
}

async function startSession(opts: StartOptions = {}): Promise<WorkSession> {
  const host = new RuntimeSessionHost({
    experienceDigest: 'signal-field-v1',
    buildId: 'work-signal-field-test',
    mode: 'controlled',
    fixedDt: DT,
  });
  const device = new HeadlessInputDevice();
  const backend = new RecordingBackend();
  const doc = new FakeDocument();
  const module = createSignalFieldModule({
    device,
    audioBackend: backend,
    document: doc,
    scene: opts.scene ?? 'field',
    stateBag: opts.bag,
    checkpoint: opts.checkpoint,
    reduceMotion: opts.reduceMotion ?? false,
  });
  await host.start(module);
  assert.ok(module.handles, 'module exposes its handles once create() resolves');
  return { host, device, backend, doc, module, handles: module.handles! };
}

// ------------------------------ scripted input ------------------------------

function pos(s: WorkSession): Vec3 {
  return s.handles.player.position;
}

function dist2D(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[2] - b[2]);
}

function npcDist(s: WorkSession): number {
  assert.ok(s.handles.npc, 'field session exposes the NPC');
  return dist2D(s.handles.npc.position, pos(s));
}

/** Every stepped body center must stay outside every known obstacle AABB —
 * a center crossing into a solid footprint is the honest clipping evidence
 * (capsules may legitimately graze a face/corner at contact distance). */
function assertClear(s: WorkSession): void {
  const bodies: Array<[string, Vec3]> = [['player', pos(s)]];
  if (s.handles.npc) bodies.push(['npc', s.handles.npc.position]);
  for (const [who, p] of bodies) {
    for (const o of s.handles.obstacles) {
      const inside = p[0] > o.minX && p[0] < o.maxX && p[2] > o.minZ && p[2] < o.maxZ;
      assert.ok(!inside, `${who} stays outside ${o.label} (at ${p[0].toFixed(2)},${p[2].toFixed(2)})`);
    }
  }
}

function step1(s: WorkSession): void {
  s.host.step(1);
  assertClear(s);
}

function idle(s: WorkSession, n: number): void {
  for (let i = 0; i < n; i += 1) step1(s);
}

function settle(s: WorkSession, n = 45): void {
  idle(s, n);
  assert.ok(s.handles.player.grounded, 'player settled on the ground');
}

const HELD = ['KeyW', 'KeyA', 'KeyS', 'KeyD'] as const;

/** Directional walk through the public key input (camera yaw 0: W = -Z, D = +X). */
function walkToward(
  s: WorkSession,
  tx: number,
  tz: number,
  tol: number,
  maxSteps: number,
  label: string,
  onStep?: () => void,
): void {
  let steps = 0;
  try {
    while (steps < maxSteps) {
      const p = pos(s);
      if (Math.hypot(p[0] - tx, p[2] - tz) <= tol) return;
      const dx = tx - p[0];
      const dz = tz - p[2];
      const want = new Set<string>();
      if (dz < -0.12) want.add('KeyW');
      else if (dz > 0.12) want.add('KeyS');
      if (dx < -0.12) want.add('KeyA');
      else if (dx > 0.12) want.add('KeyD');
      for (const code of HELD) {
        if (want.has(code)) s.device.keyDown(code);
        else s.device.keyUp(code);
      }
      step1(s);
      steps += 1;
      onStep?.();
    }
  } finally {
    for (const code of HELD) s.device.keyUp(code);
  }
  const p = pos(s);
  assert.ok(Math.hypot(p[0] - tx, p[2] - tz) <= tol, `${label}: reached (${p}) within ${maxSteps} steps`);
}

/** One key press (down step + up step) through the public device. */
function pressE(s: WorkSession): void {
  s.device.keyDown('KeyE');
  step1(s);
  s.device.keyUp('KeyE');
  step1(s);
}

function waitUntil(s: WorkSession, pred: () => boolean, maxSteps: number, label: string): void {
  for (let i = 0; i < maxSteps; i += 1) {
    if (pred()) return;
    step1(s);
  }
  assert.ok(pred(), `${label}: condition never met within ${maxSteps} steps`);
}

function commitsOf(s: WorkSession, name: string): EventEnvelope[] {
  const result = s.host.query({ kind: 'commits', limit: 500 });
  assert.ok(result.ok, 'commits query succeeds');
  return (result.data as EventEnvelope[]).filter((e) => e.name === name);
}

/** Press E until the mast award commit fires (bounded by the authored presses). */
function alignMast(s: WorkSession, i: number, maxPresses = 14): void {
  const beforeCommits = commitsOf(s, 'signal.mast-aligned').length;
  const beforeProgress = s.handles.tracker.progressOf('light-the-beacon');
  const expected = s.handles.masts!.pressesNeeded(i);
  let presses = 0;
  while (commitsOf(s, 'signal.mast-aligned').length === beforeCommits && presses < maxPresses) {
    pressE(s);
    presses += 1;
  }
  assert.equal(commitsOf(s, 'signal.mast-aligned').length, beforeCommits + 1, `mast-${i} awarded exactly once`);
  assert.ok(presses <= expected + 1, `mast-${i} aligned in ${presses} presses (authored ${expected})`);
  assert.equal(s.handles.masts!.aligned(i), true, `mast-${i} flagged aligned`);
  assert.equal(s.handles.tracker.progressOf('light-the-beacon'), beforeProgress + 1, 'exactly one progress unit');
}

function assertBeaconCompleteOnce(s: WorkSession): void {
  assert.equal(s.handles.tracker.isComplete('light-the-beacon'), true, 'beacon objective complete');
  const completed = commitsOf(s, 'objectives.completed').filter(
    (e) => (e.payload as { objectiveId?: unknown }).objectiveId === 'light-the-beacon',
  );
  assert.equal(completed.length, 1, 'beacon completion committed exactly once');
  assert.equal(completed[0].eventId, 'objectives:light-the-beacon:completed');
}

// Field route legs shared by the replay/checkpoint tests (crate bypass included).
const LEGS_TO_MAST2: Array<[number, number, number, number, string]> = [
  [1.2, 4.2, 0.7, 300, 'memo slate'],
  [6, 1.5, 0.6, 300, 'mast-2 approach'],
];
const LEGS_MAST2_TO_MAST1: Array<[number, number, number, number, string]> = [
  [3.5, -4, 0.6, 340, 'crate bypass'],
  [5.2, -5, 0.6, 200, 'east mid'],
  [10, -10.1, 0.5, 340, 'mast-1 approach'],
];
const LEGS_MAST1_TO_MAST0: Array<[number, number, number, number, string]> = [
  [0.3, -8, 0.7, 460, 'center crossing'],
  [-8, -11.9, 0.5, 420, 'mast-0 approach'],
];

function walkLegs(s: WorkSession, legs: Array<[number, number, number, number, string]>): void {
  for (const [tx, tz, tol, max, label] of legs) walkToward(s, tx, tz, tol, max, label);
}

function collectFieldMemo(s: WorkSession): void {
  walkToward(s, 1.2, 4.2, 0.7, 300, 'memo slate');
  assert.equal(s.handles.hud.prompt.visible, true, 'prompt shows at the slate');
  assert.equal(s.handles.hud.prompt.label, '按 E 记录手记');
  pressE(s);
  assert.deepEqual(s.handles.progress.value.memos, ['field'], 'field memo recorded');
  assert.equal(s.handles.tracker.progressOf('recover-logs'), 1);
  assert.equal(commitsOf(s, 'signal.memo-collected').length, 1, 'memo fact committed once');
}

// ---------------------------------- tests -----------------------------------

test('top-down control: screen-relative movement on a fixed camera yaw', async () => {
  const s = await startSession();
  s.handles.unlockAudio();
  settle(s);
  const start = pos(s);
  s.device.keyDown('KeyW');
  idle(s, 40);
  s.device.keyUp('KeyW');
  const north = pos(s);
  assert.ok(north[2] < start[2] - 1.5 && Math.abs(north[0] - start[0]) < 0.4, `W walks screen-up (-Z), got ${north}`);

  s.device.keyDown('KeyD');
  idle(s, 40);
  s.device.keyUp('KeyD');
  const east = pos(s);
  assert.ok(east[0] > north[0] + 1.5 && Math.abs(east[2] - north[2]) < 0.4, `D walks screen-right (+X), got ${east}`);
  assert.ok(Math.abs(s.handles.player.object.rotation.y - Math.atan2(1, 0)) < 1e-6, 'faceMovement yaws the root toward +X motion');
  await s.host.stop();
});

test('full public-input replay: memos -> three masts -> beacon timeline (skipped) fires exactly once', async () => {
  const s = await startSession();
  s.handles.unlockAudio();
  assert.equal(s.handles.fade.progress, 1, 'session starts covered (fade-in begins)');
  settle(s);
  assert.ok(s.handles.fade.progress < 0.05, 'fade reveals the field');
  assert.ok(s.backend.count('osc.start') >= 2, 'positional beacon hum scheduled after unlock');

  const npcSpawn = s.handles.npc!.position;
  let npcMoved = false;

  collectFieldMemo(s);
  walkLegs(s, LEGS_TO_MAST2.slice(1));
  alignMast(s, 2);
  assert.equal(s.handles.beacon!.fired(), false, 'two masts still pending');

  walkLegs(s, LEGS_MAST2_TO_MAST1);
  alignMast(s, 1);
  walkLegs(s, LEGS_MAST1_TO_MAST0);
  alignMast(s, 0);

  if (dist2D(s.handles.npc!.position, npcSpawn) > 0.5) npcMoved = true;
  assert.ok(npcMoved, 'the guide NPC patrolled while the player routed');

  // The third award triggers the beacon reveal: blended camera to the tower.
  assert.equal(s.handles.beacon!.state(), 'running', 'beacon timeline started');
  waitUntil(s, () => commitsOf(s, 'signal.beacon-lit').length === 1, 140, 'beacon cue committed after the blend');
  assert.equal(s.handles.director.activeRig?.name, 'beacon-reveal', 'cutscene rig owns the camera mid-run');
  assert.equal(s.handles.beacon!.fired(), true, 'beacon-lit fact applied');

  // Skip applies the declared finish policy: same end state, single cue.
  s.handles.beacon!.skip();
  idle(s, 5);
  assert.equal(s.handles.beacon!.state(), 'skipped');
  assert.match(s.handles.beacon!.skipPolicy, /finish/);
  assert.equal(commitsOf(s, 'signal.beacon-lit').length, 1, 'cue deduped by eventId');
  assert.equal(s.handles.director.activeRig?.name, 'player-follow', 'camera handed back to the top-down rig');

  assertBeaconCompleteOnce(s);
  assert.ok(s.backend.count('osc.start') >= 6, 'hum + clicks + chimes + pulse all scheduled');
  // Earlier subtitle lines may still be draining through the FIFO queue.
  waitUntil(s, () => s.handles.hud.subtitle.text === '信标塔亮了——三束信号在暮色里汇合。', 500, 'beacon subtitle surfaces');
  assert.equal(s.host.diagnosticsLog.length, 0, 'session ran clean');
  await s.host.stop();
});

test('NPC guide: perception-gated follow — blocked LOS never follows, open ground closes in, loss resumes patrol', async () => {
  const s = await startSession();
  s.handles.unlockAudio();
  settle(s);

  // Phase A: sneak to a spot north of the hut staying >8m from the whole
  // patrol polyline — the NPC never perceives the player on the way in. From
  // the hiding spot, every within-range patrol position has its ray to the
  // player blocked by solid hut wall (the doorway is on the far side).
  walkToward(s, -2, 9, 0.7, 420, 'south verge');
  walkToward(s, -18, 4, 0.7, 560, 'west verge');
  walkToward(s, -20, -4, 0.7, 420, 'far west');
  walkToward(s, -18.5, -9.6, 0.7, 420, 'hut north-west');
  walkToward(s, -14, -9.5, 0.5, 320, 'behind the hut');
  assert.equal(s.handles.npc!.state, 'patrol', 'player arrival never entered the bubble');
  for (let i = 0; i < 420; i += 1) {
    assert.equal(s.handles.npc!.state, 'patrol', 'LOS blocked by the hut wall: NPC keeps patrolling');
    assert.ok(npcDist(s) > 4.5, `NPC never closes in while occluded (d=${npcDist(s).toFixed(2)})`);
    step1(s);
  }

  // Phase B: open ground NE of the hut — perception engages, distance shrinks.
  walkToward(s, -9.5, -9.5, 0.7, 380, 'open ground');
  waitUntil(s, () => s.handles.npc!.state === 'follow', 2200, 'NPC perceives the player and follows');
  const before = npcDist(s);
  // The declared nav graph may route the long way around (a leg can briefly
  // leave the 8m bubble and honestly drop follow); the arrival evidence is
  // the committed distance shrinking to the follow stop radius.
  let closed = before;
  for (let i = 0; i < 900 && closed > 2.5; i += 1) {
    step1(s);
    closed = npcDist(s);
  }
  assert.ok(closed <= 2.5, `NPC arrived within its follow stop radius (d=${closed.toFixed(2)})`);
  assert.ok(closed < before - 2, `NPC approached: ${before.toFixed(2)} -> ${closed.toFixed(2)}`);
  waitUntil(s, () => s.handles.npc!.state === 'follow', 90, 'perceived again at arrival');

  // Phase C: outrun the bubble — keep sprinting east across the open field;
  // the committed gap must cross the perception range and follow must drop.
  // (Latched during the run: a player who stands still in the open would be
  // re-acquired, so the drop is only observable mid-escape.)
  let sawDrop = false;
  walkToward(
    s,
    18,
    -2,
    1.2,
    1400,
    'sprint east',
    () => {
      if (s.handles.npc!.state === 'patrol' && npcDist(s) > 8.5) sawDrop = true;
    },
  );
  assert.ok(sawDrop, 'follow dropped once the player outran the perception range');

  assert.equal(s.host.diagnosticsLog.length, 0, 'no stuck diagnostics: the NPC never fought geometry');
  await s.host.stop();
});

test('checkpoint mid-route: destroy the session, restore into a fresh one, reach the same beacon', async () => {
  // An unknown checkpoint schema version is an honest error, not a merge.
  {
    const host = new RuntimeSessionHost({
      experienceDigest: 'signal-field-v1',
      buildId: 'work-signal-field-test',
      mode: 'controlled',
      fixedDt: DT,
    });
    const module = createSignalFieldModule({
      device: new HeadlessInputDevice(),
      audioBackend: new RecordingBackend(),
      document: new FakeDocument(),
      checkpoint: { checkpointSchemaVersion: 99 },
    });
    let failure: unknown = null;
    try {
      await host.start(module);
    } catch (err) {
      failure = err;
    }
    assert.ok(failure instanceof Error, 'restore rejects');
    assert.match((failure as Error).message, /schemaVersion/);
    await host.stop();
  }

  // Session 1: memo + mast-2, then save mid-route.
  const a = await startSession();
  a.handles.unlockAudio();
  settle(a);
  collectFieldMemo(a);
  walkLegs(a, LEGS_TO_MAST2.slice(1));
  alignMast(a, 2);
  const cp = JSON.parse(JSON.stringify(a.handles.saveCheckpoint())) as SignalCheckpoint;
  assert.equal(cp.checkpointSchemaVersion, 1);
  assert.equal(cp.scene, 'field');
  assert.equal(cp.state.data.mastAwarded[2], true, 'checkpoint carries mast awards');
  assert.deepEqual(cp.state.data.memos, ['field']);
  assert.equal(cp.objectives.progress['light-the-beacon'], 1);
  assert.ok(cp.commits.some((f) => f.eventId === 'signal:mast-2:aligned'), 'checkpoint carries the commit log');
  await a.host.stop();

  // Session 2: fresh host + module, restore, replay the rest.
  const b = await startSession({ checkpoint: cp });
  b.handles.unlockAudio();
  assert.equal(b.handles.tracker.progressOf('light-the-beacon'), 1, 'objective progress restored');
  assert.equal(b.handles.tracker.progressOf('recover-logs'), 1);
  assert.equal(b.handles.masts!.aligned(2), true, 'mast-2 stays awarded');
  assert.equal(commitsOf(b, 'signal.mast-aligned').length, 1, 'carried fact rebuilt in the fresh log');
  const bp = pos(b);
  assert.ok(dist2D(bp, cp.player) < 0.02, 'player pose restored at the checkpoint');

  // The awarded mast is inert: pressing it changes nothing.
  const yawBefore = b.handles.masts!.yaw(2);
  pressE(b);
  assert.equal(b.handles.masts!.yaw(2), yawBefore, 'awarded mast no longer rotates');
  assert.equal(commitsOf(b, 'signal.mast-aligned').length, 1, 'no re-award');

  walkLegs(b, LEGS_MAST2_TO_MAST1);
  alignMast(b, 1);
  walkLegs(b, LEGS_MAST1_TO_MAST0);
  alignMast(b, 0);

  // Natural completion this time: blend, cue, hold, hand back.
  assert.equal(b.handles.beacon!.state(), 'running');
  waitUntil(b, () => b.handles.beacon!.state() === 'completed', 260, 'beacon timeline completes naturally');
  assert.equal(commitsOf(b, 'signal.beacon-lit').length, 1);
  assert.equal(b.handles.director.activeRig?.name, 'player-follow');
  assertBeaconCompleteOnce(b);
  assert.equal(b.host.diagnosticsLog.length, 0, 'restored session ran clean');
  await b.host.stop();
});

test('cross-scene persistence: field -> bunker -> field keeps notebook, objectives and mast progress', async () => {
  const bag = new SessionStateBag();

  // Field session 1: collect the field memo, align mast-2, then enter the bunker.
  const f1 = await startSession({ bag });
  f1.handles.unlockAudio();
  settle(f1);
  collectFieldMemo(f1);
  walkLegs(f1, LEGS_TO_MAST2.slice(1));
  alignMast(f1, 2);
  walkToward(f1, -10.4, -6, 0.8, 800, 'bunker door');
  assert.equal(f1.handles.hud.prompt.label, '按 E 推门');
  pressE(f1);
  assert.equal(commitsOf(f1, 'signal.scene-exit').length, 1, 'exit fact committed');
  idle(f1, 40);
  assert.equal(f1.handles.fade.progress, 1, 'field fades out on the transition');
  await f1.host.stop();

  // Bunker session (same bag): progress from the field is already here.
  const bk = await startSession({ scene: 'bunker', bag });
  bk.handles.unlockAudio();
  assert.deepEqual(bk.handles.progress.value.memos, ['field'], 'notebook survives the scene swap');
  assert.equal(bk.handles.tracker.progressOf('recover-logs'), 1, 'objective progress survives');
  assert.equal(bk.handles.fade.progress, 1, 'bunker starts covered');
  idle(bk, 60);
  assert.ok(bk.handles.fade.progress < 0.05, 'bunker reveals');
  walkToward(bk, 1.5, -0.9, 0.5, 240, 'console');
  pressE(bk);
  assert.deepEqual(bk.handles.progress.value.memos, ['field', 'bunker'], 'bunker memo appended');
  assert.equal(bk.handles.tracker.isComplete('recover-logs'), true);
  const recovered = commitsOf(bk, 'objectives.completed').filter(
    (e) => (e.payload as { objectiveId?: unknown }).objectiveId === 'recover-logs',
  );
  assert.equal(recovered.length, 1, 'recover-logs completes exactly once');
  assert.equal(recovered[0].eventId, 'objectives:recover-logs:completed');
  walkToward(bk, 0, 1.4, 0.5, 200, 'exit door');
  pressE(bk);
  idle(bk, 40);
  assert.equal(bk.handles.fade.progress, 1);
  await bk.host.stop();

  // Field session 2: nothing was reset; finishing the array lights the beacon.
  const f2 = await startSession({ bag });
  f2.handles.unlockAudio();
  assert.deepEqual(f2.handles.progress.value.memos, ['field', 'bunker'], 'both memos still recorded');
  assert.equal(f2.handles.tracker.isComplete('recover-logs'), true, 'objective stays complete');
  assert.equal(
    commitsOf(f2, 'objectives.completed').filter((e) => (e.payload as { objectiveId?: unknown }).objectiveId === 'recover-logs').length,
    0,
    'restored completion is not re-committed',
  );
  assert.equal(f2.handles.masts!.aligned(2), true, 'mast-2 alignment survived the round trip');
  settle(f2, 30);
  walkLegs(f2, LEGS_MAST2_TO_MAST1);
  alignMast(f2, 1);
  walkLegs(f2, LEGS_MAST1_TO_MAST0);
  alignMast(f2, 0);
  assert.equal(f2.handles.beacon!.state(), 'running');
  f2.handles.beacon!.skip();
  idle(f2, 5);
  assertBeaconCompleteOnce(f2);
  await f2.host.stop();
});

test('parameters: validation rejects bad values; live apply re-tunes masts and the NPC', async () => {
  const s = await startSession();
  s.handles.unlockAudio();
  settle(s);

  const snapshot = s.handles.params.snapshot();
  assert.deepEqual(Object.keys(snapshot).sort(), ['signal.mast-step', 'signal.npc-speed']);
  assert.equal(snapshot['signal.mast-step'].value, 45);

  const rejected = s.handles.params.set('signal.mast-step', 10);
  assert.equal(rejected.ok, false);
  assert.match(rejected.reason ?? '', /15\.\.90/);
  assert.equal(s.handles.params.get('signal.mast-step')!.value, 45, 'rejected value keeps the old one');
  assert.equal(s.handles.params.set('signal.npc-speed', 5).ok, false);

  assert.equal(s.handles.params.set('signal.npc-speed', 2.4).ok, true);
  assert.equal(s.handles.params.set('signal.mast-step', 60).ok, true);

  // The new 60° step re-derives press counts; the puzzle stays solvable live.
  walkLegs(s, LEGS_TO_MAST2.slice(1));
  alignMast(s, 2, 8);
  idle(s, 30);
  assert.equal(s.host.currentStatus, 'running', 'session healthy after live param applies');
  assert.equal(s.host.diagnosticsLog.length, 0);
  await s.host.stop();
});

test('reduce motion: fades resolve instantly, flashes suppressed', async () => {
  const s = await startSession({ reduceMotion: true });
  s.handles.unlockAudio();
  assert.equal(s.handles.fade.progress, 1, 'entry cover is instant');
  s.host.step(1);
  assert.equal(s.handles.fade.progress, 0, 'entry reveal is instant under reduce-motion');
  settle(s);
  walkToward(s, -10.4, -6, 0.8, 900, 'bunker door');
  pressE(s);
  s.host.step(1);
  assert.equal(s.handles.fade.progress, 1, 'exit fade is instant under reduce-motion');
  await s.host.stop();
});
