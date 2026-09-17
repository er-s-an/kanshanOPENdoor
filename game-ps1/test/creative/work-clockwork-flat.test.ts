/**
 * Offline replay evidence for 钟鸣陋室 · Clockwork Flat (experiences/clockwork-flat).
 *
 * A real headless run of the work module: RuntimeSessionHost (controlled mode)
 * drives fixed steps; a HeadlessInputDevice feeds the same public input path a
 * player uses (keys + pointer deltas -> ActionMapper -> FirstPersonController
 * -> PhysicsWorld). No setState, no teleports, no completion-event shortcuts:
 * progress happens only because scripted inputs moved the character through
 * the world, and checkpoints restore through the module's own save/load.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RuntimeSessionHost } from '../../src/creative/core/host.ts';
import type { EventEnvelope } from '../../src/creative/core/events.ts';
import type { Vec3 } from '../../src/creative/core/spatial.ts';
import { HeadlessInputDevice } from '../../src/creative/input/headless.ts';
import { RecordingBackend } from '../../src/creative/audio/backend.ts';
import { FakeDocument } from '../../src/creative/ui/fakedom.ts';
import { createClockworkFlatModule } from '../../experiences/clockwork-flat/src/scene.ts';
import type { ClockworkCheckpoint, ClockworkFlatModule, ClockworkHandles } from '../../experiences/clockwork-flat/src/scene.ts';

const DT = 1 / 60;

interface WorkSession {
  host: RuntimeSessionHost;
  device: HeadlessInputDevice;
  backend: RecordingBackend;
  doc: FakeDocument;
  module: ClockworkFlatModule;
  handles: ClockworkHandles;
}

async function startWorkSession(checkpoint?: unknown): Promise<WorkSession> {
  const host = new RuntimeSessionHost({
    experienceDigest: 'clockwork-flat-v1',
    buildId: 'work-clockwork-flat-test',
    mode: 'controlled',
    fixedDt: DT,
  });
  const device = new HeadlessInputDevice();
  const backend = new RecordingBackend();
  const doc = new FakeDocument();
  const module = createClockworkFlatModule({ device, audioBackend: backend, document: doc, checkpoint });
  await host.start(module);
  assert.ok(module.handles, 'module exposes its handles once create() resolves');
  return { host, device, backend, doc, module, handles: module.handles! };
}

// ------------------------------ scripted input ------------------------------

function pos(s: WorkSession): Vec3 {
  return s.handles.player.position;
}

function idle(s: WorkSession, n: number): void {
  s.host.step(n);
}

function settle(s: WorkSession, n = 45): void {
  idle(s, n);
  assert.ok(s.handles.player.grounded, 'player settled on the floor');
}

/** Hold W and step until the position predicate holds (public input only). */
function walkUntil(s: WorkSession, pred: (p: Vec3) => boolean, maxSteps: number, label: string): number {
  s.device.keyDown('KeyW');
  let steps = 0;
  try {
    while (steps < maxSteps) {
      s.host.step(1);
      steps += 1;
      if (pred(pos(s))) return steps;
    }
  } finally {
    s.device.keyUp('KeyW');
  }
  assert.ok(pred(pos(s)), `${label}: predicate never satisfied within ${maxSteps} steps (pos ${pos(s)})`);
  return steps;
}

/**
 * Turn the view by `radians` (>0 = left) through pointer deltas, spread over
 * several frames so each frame stays inside the [-1, 1] axis clamp.
 */
function turnBy(s: WorkSession, radians: number, frames = 10): void {
  const perFrame = radians / frames;
  assert.ok(Math.abs(perFrame) <= 1, 'turn fits within the per-frame axis clamp');
  const dx = -perFrame / 0.0025; // look.x = dx * 0.0025; viewYaw -= look.x
  for (let i = 0; i < frames; i += 1) {
    s.device.pointerDelta(dx, 0);
    s.host.step(1);
  }
}

/** One key press (down step + up step) through the public device. */
function pressKey(s: WorkSession, code: string): void {
  s.device.keyDown(code);
  s.host.step(1);
  s.device.keyUp(code);
  s.host.step(1);
}

function waitUntil(s: WorkSession, pred: () => boolean, maxSteps: number, label: string): void {
  for (let i = 0; i < maxSteps; i += 1) {
    if (pred()) return;
    s.host.step(1);
  }
  assert.ok(pred(), `${label}: condition never met within ${maxSteps} steps`);
}

function commitsOf(s: WorkSession, name: string): EventEnvelope[] {
  const result = s.host.query({ kind: 'commits', limit: 500 });
  assert.ok(result.ok, 'commits query succeeds');
  return (result.data as EventEnvelope[]).filter((e) => e.name === name);
}

// ------------------------------ shared route --------------------------------
// spawn → pedestal → door → lift lane → board → ride → loft → bronze bell

function routeToSwitchAndOpen(s: WorkSession): void {
  settle(s);
  walkUntil(s, (p) => p[2] > -5.95, 320, 'approach the closed door');
  pressKey(s, 'KeyE');
}

function routeThroughDoor(s: WorkSession): void {
  idle(s, 90); // panel lift duration 1.2s + margin
  assert.ok(s.handles.door.isOpen, 'door fully open before crossing');
  walkUntil(s, (p) => p[2] > -4.6, 260, 'walk through the doorway');
}

function routeLiftAndGoal(s: WorkSession): void {
  walkUntil(s, (p) => p[2] > -0.45, 340, 'walk up to the lift lane');
  turnBy(s, Math.PI / 2); // now facing +X
  walkUntil(s, (p) => p[0] > 1.65, 180, 'approach the shaft mouth');
  waitUntil(s, () => s.handles.platform.position[1] < -0.05, 720, 'lift docks at the bottom');
  walkUntil(s, (p) => p[0] > 3.05, 150, 'step onto the deck');
  idle(s, 30); // settle onto the deck while it dwells
  waitUntil(s, () => s.handles.platform.position[1] > 2.25, 540, 'lift rises to the loft');
  walkUntil(s, (p) => p[0] > 4.55, 130, 'step off onto the loft floor');
  const p = pos(s);
  assert.ok(p[1] > 3.1, `player is up in the loft (y=${p[1]})`);
  assert.ok(s.handles.player.grounded, 'player stands on the loft floor');
  walkUntil(s, (p2) => p2[0] > 6.8, 200, 'reach the bronze bell');
}

function assertGoalReached(s: WorkSession): void {
  assert.equal(s.handles.tracker.isComplete('reach-bell'), true, 'objective tracker shows completion');
  const completed = commitsOf(s, 'objectives.completed').filter(
    (e) => (e.payload as { objectiveId?: unknown }).objectiveId === 'reach-bell',
  );
  assert.equal(completed.length, 1, 'goal completion committed exactly once');
  assert.equal(completed[0].eventId, 'objectives:reach-bell:completed');
  assert.ok(s.backend.count('osc.start') >= 2, 'bell chime scheduled on the recording backend');
  assert.equal(s.handles.hud.subtitle.text, '你合上了齿轮——钟，重新走了。');
}

// ---------------------------------- tests -----------------------------------

test('intro: establishing cut holds input; skip applies the declared finish policy once', async () => {
  const s = await startWorkSession();

  // While the intro runs the player input is frozen: holding W moves nothing.
  s.device.keyDown('KeyW');
  idle(s, 60);
  s.device.keyUp('KeyW');
  const held = pos(s);
  assert.ok(Math.hypot(held[0], held[2] + 7.5) < 0.05, `player held at spawn during intro (${held})`);
  assert.equal(s.handles.director.activeRig?.name, 'intro-establishing', 'cutscene rig owns the camera');
  assert.equal(commitsOf(s, 'clockwork.intro-begin').length, 1, 'first cue committed');
  assert.equal(s.handles.hud.subtitle.text, '滴答……滴答……');

  // Skip: finish policy → identical end state; cues stay single-committed.
  s.handles.skipIntro();
  idle(s, 5);
  assert.equal(s.handles.introState(), 'skipped');
  assert.match(s.handles.introSkipPolicy, /finish/);
  assert.equal(commitsOf(s, 'clockwork.intro-begin').length, 1, 'begin cue deduped by eventId');
  assert.equal(commitsOf(s, 'clockwork.intro-door').length, 1, 'skip fires the remaining cue exactly once');
  assert.equal(s.handles.director.activeRig?.name, 'player-head', 'camera handed back to the head rig');
  assert.ok(Math.abs(s.handles.camera.position.x - held[0]) < 0.6, 'camera back at the player');
  assert.ok(Math.abs(s.handles.camera.position.z - held[2]) < 0.6, 'camera back at the player');

  await s.host.stop();
});

test('door: closed panel physically blocks; interaction opens it; passage, HUD and audio work', async () => {
  const s = await startWorkSession();
  s.handles.skipIntro();
  s.handles.unlockAudio();
  settle(s);

  walkUntil(s, (p) => p[2] > -5.95, 320, 'approach the closed door');
  s.device.keyDown('KeyW');
  idle(s, 90); // keep pushing into the closed panel
  s.device.keyUp('KeyW');
  const pushed = pos(s);
  assert.ok(pushed[2] < -5.4, `closed door blocks before the threshold (z=${pushed[2]})`);
  assert.ok(pushed[2] > -5.9, 'player stays on the hall floor');
  assert.ok(s.handles.door.isClosed, 'door still closed');

  // The pedestal is in reach and the HUD prompt says so.
  assert.equal(s.handles.hud.prompt.visible, true);
  assert.equal(s.handles.hud.prompt.label, '按 E 启动机关');

  const oscBefore = s.backend.count('osc.start');
  pressKey(s, 'KeyE');
  assert.equal(s.handles.tracker.isComplete('start-mechanism'), true, 'mechanism objective completed');
  assert.equal(commitsOf(s, 'clockwork.door-opened').length, 1, 'door-opened fact committed');
  // The line is queued behind the intro narration and surfaces via the FIFO queue.
  waitUntil(s, () => s.handles.hud.subtitle.text === '机关咬合，铁门升起来了。', 420, 'door subtitle');
  assert.ok(s.backend.count('osc.start') > oscBefore, 'clunk + groan scheduled through the audio player');

  idle(s, 90);
  assert.ok(s.handles.door.isOpen, 'panel fully lifted');
  walkUntil(s, (p) => p[2] > -4.6, 260, 'walk through the opened doorway');
  assert.ok(pos(s)[2] > -4.6, 'passage works after opening');

  await s.host.stop();
});

test('full public-input replay: spawn → switch → door → lift → bronze bell', async () => {
  const s = await startWorkSession();
  s.handles.skipIntro();
  s.handles.unlockAudio();

  routeToSwitchAndOpen(s);
  routeThroughDoor(s);
  routeLiftAndGoal(s);
  assertGoalReached(s);

  assert.equal(s.host.diagnosticsLog.length, 0, 'session ran clean');
  await s.host.stop();
});

test('checkpoint mid-route: destroy the session, restore into a fresh one, reach the same goal', async () => {
  // An unknown checkpoint schema version is an honest error, not a merge.
  {
    const host = new RuntimeSessionHost({
      experienceDigest: 'clockwork-flat-v1',
      buildId: 'work-clockwork-flat-test',
      mode: 'controlled',
      fixedDt: DT,
    });
    const module = createClockworkFlatModule({
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

  // Session 1: play the public route to the mid-route point and save.
  const a = await startWorkSession();
  a.handles.skipIntro();
  routeToSwitchAndOpen(a);
  routeThroughDoor(a);
  const cp = JSON.parse(JSON.stringify(a.handles.saveCheckpoint())) as ClockworkCheckpoint;
  assert.equal(cp.checkpointSchemaVersion, 1);
  assert.equal(cp.state.data.doorOpened, true, 'checkpoint carries progress state');
  assert.equal(cp.objectives.progress['start-mechanism'], 1, 'checkpoint carries objective progress');
  assert.ok(cp.commits.some((f) => f.eventId === 'clockwork:door-opened'), 'checkpoint carries the commit log');
  await a.host.stop();

  // Session 2: fresh host + module, restore the checkpoint, replay the rest.
  const b = await startWorkSession(cp);
  b.handles.unlockAudio(); // the host's unlock gesture, like session 1 had
  assert.equal(b.handles.introState(), 'none', 'restored session does not replay the intro');
  assert.equal(b.handles.tracker.progressOf('start-mechanism'), 1, 'objective progress restored');
  assert.equal(commitsOf(b, 'clockwork.door-opened').length, 1, 'carried fact rebuilt in the fresh log');
  assert.ok(b.handles.door.isOpen, 'door restored open');
  const p = pos(b);
  assert.ok(Math.hypot(p[0] - cp.player[0], p[2] - cp.player[2]) < 1e-6, 'player pose restored exactly');
  const dup = b.host.commits.commit('clockwork.door-opened', { door: 'clockwork-door' }, 'clockwork:door-opened', {
    generation: b.host.currentGeneration,
    tick: 0,
  });
  assert.equal(dup.status, 'duplicate', 'restored commit log still dedupes the same eventId');

  routeLiftAndGoal(b);
  assertGoalReached(b);

  await b.host.stop();
});

test('parameters: validation rejects bad values; live apply rebuilds the mechanisms', async () => {
  const s = await startWorkSession();
  s.handles.skipIntro();
  settle(s);

  const snapshot = s.handles.params.snapshot();
  assert.deepEqual(
    Object.keys(snapshot).sort(),
    ['clockwork.door-seconds', 'clockwork.door-width', 'clockwork.platform-seconds'],
    'author parameters are exposed',
  );
  assert.equal(snapshot['clockwork.door-width'].value, 1.4);

  const rejected = s.handles.params.set('clockwork.door-width', 5);
  assert.equal(rejected.ok, false);
  assert.match(rejected.reason ?? '', /0\.9\.\.2\.0/);
  assert.equal(s.handles.params.get('clockwork.door-width')!.value, 1.4, 'rejected value keeps the old one');

  const applied = s.handles.params.set('clockwork.door-width', 1.8);
  assert.equal(applied.ok, true);
  const panel = s.handles.door.object.children[0] as unknown as { geometry: { parameters: { width: number } } };
  assert.equal(panel.geometry.parameters.width, 1.8, 'door panel rebuilt at the new width');

  assert.equal(s.handles.params.set('clockwork.platform-seconds', 2).ok, true);
  idle(s, 30);
  assert.equal(s.host.currentStatus, 'running', 'session stays healthy after live param applies');

  await s.host.stop();
});
