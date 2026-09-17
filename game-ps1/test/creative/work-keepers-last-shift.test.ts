/**
 * Offline replay evidence for 灯塔最后一班 · The Keeper's Last Shift
 * (experiences/keepers-last-shift).
 *
 * Real headless runs of the work module: RuntimeSessionHost (controlled mode)
 * drives fixed steps; a HeadlessInputDevice feeds the same public input path a
 * player uses (keys + pointer deltas -> ActionMapper -> FirstPersonController
 * -> PhysicsWorld; interact press edges -> InteractionSystem; E/1/2 edges ->
 * DialogueRunner advance/choose; Escape edge -> the outro's declared skip
 * policy). No setState, no teleports, no completion-event shortcuts: pages
 * land in the inventory because scripted walks reach them and scripted presses
 * collect them; the lamp objective completes because the outro cue commits.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RuntimeSessionHost } from '../../src/creative/core/host.ts';
import type { EventEnvelope } from '../../src/creative/core/events.ts';
import type { Vec3 } from '../../src/creative/core/spatial.ts';
import { HeadlessInputDevice } from '../../src/creative/input/headless.ts';
import { RecordingBackend } from '../../src/creative/audio/backend.ts';
import { FakeDocument } from '../../src/creative/ui/fakedom.ts';
import type { DialogueView } from '../../src/creative/gameplay/dialogue.ts';
import { DIALOGUE_NODES, createKeepersLastShiftModule } from '../../experiences/keepers-last-shift/src/scene.ts';
import type { KeeperCheckpoint, KeeperHandles, KeeperModule } from '../../experiences/keepers-last-shift/src/scene.ts';

const DT = 1 / 60;

interface WorkSession {
  host: RuntimeSessionHost;
  device: HeadlessInputDevice;
  backend: RecordingBackend;
  doc: FakeDocument;
  module: KeeperModule;
  handles: KeeperHandles;
}

async function startSession(checkpoint?: unknown, reduceMotion = false): Promise<WorkSession> {
  const host = new RuntimeSessionHost({
    experienceDigest: 'keepers-last-shift-v1',
    buildId: 'work-keepers-last-shift-test',
    mode: 'controlled',
    fixedDt: DT,
  });
  const device = new HeadlessInputDevice();
  const backend = new RecordingBackend();
  const doc = new FakeDocument();
  const module = createKeepersLastShiftModule({ device, audioBackend: backend, document: doc, checkpoint, reduceMotion });
  await host.start(module);
  assert.ok(module.handles, 'module exposes its handles once create() resolves');
  return { host, device, backend, doc, module, handles: module.handles! };
}

// ------------------------------ scripted input ------------------------------

function pos(s: WorkSession): Vec3 {
  return s.handles.player.position;
}

const HELD = ['KeyW', 'KeyA', 'KeyS', 'KeyD'] as const;

/**
 * Walk toward a world XZ target through the public key input. The
 * FirstPersonController moves camera-relative, so each step converts the
 * desired world direction into W/A/S/D edges for the CURRENT view yaw —
 * navigation needs no teleports and works with any facing.
 */
function walkTo(s: WorkSession, tx: number, tz: number, tol: number, maxSteps: number, label: string): void {
  let steps = 0;
  try {
    while (steps < maxSteps) {
      const p = pos(s);
      if (Math.hypot(p[0] - tx, p[2] - tz) <= tol) return;
      const dx = tx - p[0];
      const dz = tz - p[2];
      const len = Math.hypot(dx, dz) || 1;
      const wx = dx / len;
      const wz = dz / len;
      const yaw = s.handles.viewYaw;
      const fwdX = -Math.sin(yaw);
      const fwdZ = -Math.cos(yaw);
      const rightX = Math.cos(yaw);
      const rightZ = -Math.sin(yaw);
      const f = wx * fwdX + wz * fwdZ;
      const r = wx * rightX + wz * rightZ;
      const want = new Set<string>();
      if (f > 0.35) want.add('KeyW');
      else if (f < -0.35) want.add('KeyS');
      if (r > 0.35) want.add('KeyD');
      else if (r < -0.35) want.add('KeyA');
      for (const code of HELD) {
        if (want.has(code)) s.device.keyDown(code);
        else s.device.keyUp(code);
      }
      s.host.step(1);
      steps += 1;
    }
  } finally {
    for (const code of HELD) s.device.keyUp(code);
  }
  const p = pos(s);
  assert.ok(Math.hypot(p[0] - tx, p[2] - tz) <= tol, `${label}: reached (${p}) within ${maxSteps} steps`);
}

function idle(s: WorkSession, n: number): void {
  s.host.step(n);
}

function settle(s: WorkSession, n = 45): void {
  idle(s, n);
  assert.ok(s.handles.player.grounded, 'player settled on the floor');
}

/** Turn the view by `radians` through pointer deltas, spread over frames. */
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

function pressE(s: WorkSession): void {
  pressKey(s, 'KeyE');
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

function objectiveCompleted(s: WorkSession, id: string): EventEnvelope[] {
  return commitsOf(s, 'objectives.completed').filter((e) => (e.payload as { objectiveId?: unknown }).objectiveId === id);
}

// ------------------------------ shared route --------------------------------
// spawn (lamp room) → 陈师傅 by the door → doorway → desk (quarters) →
// back through the doorway → lamp console → side table (lamp room).

function routeToNpc(s: WorkSession): void {
  walkTo(s, 1.9, 3.0, 0.3, 220, 'lamp-room east side');
  walkTo(s, 1.7, 2.3, 0.35, 180, 'npc approach');
}

function routeThroughDoor(s: WorkSession): void {
  // East waypoint first: a straight line from spawn deadlocks head-on against
  // the round lamp pedestal; rounding the east side keeps every leg sliding.
  walkTo(s, 1.9, 3.0, 0.3, 260, 'lamp-room east side');
  walkTo(s, 0.4, 0.6, 0.3, 220, 'doorway south side');
  walkTo(s, 0, -0.35, 0.3, 180, 'through the doorway');
}

function routeToDeskFront(s: WorkSession): void {
  walkTo(s, -1.5, -2.8, 0.35, 300, 'quarters desk approach');
  walkTo(s, -1.55, -2.85, 0.3, 140, 'desk front');
}

function routeBackToDoor(s: WorkSession): void {
  walkTo(s, -1.5, -2.8, 0.35, 160, 'desk approach');
  walkTo(s, 0, -0.35, 0.3, 240, 'back through the doorway');
  walkTo(s, 0.4, 0.6, 0.3, 160, 'doorway north side');
}

function routeToConsole(s: WorkSession): void {
  walkTo(s, 1.9, 2.4, 0.3, 220, 'console east approach');
  walkTo(s, 0, 2.0, 0.3, 180, 'lamp console');
}

function routeToShelf(s: WorkSession): void {
  walkTo(s, 2.45, 5.05, 0.3, 260, 'side table');
}

/** Drive the whole dialogue tree through E (advance) and 1/2 (choose). */
function playTalk(s: WorkSession, choices: number[]): void {
  pressE(s); // talk to 陈师傅 — enters 'arrive'; the start edge must not advance
  assert.equal(s.handles.dialogue.running, true, 'dialogue running after the talk press');
  pressE(s); // arrive -> q1
  assert.equal(s.handles.dialogue.current?.nodeId, 'q1');
  for (const choice of choices) {
    const view: DialogueView | null = s.handles.dialogue.current;
    const nodeId: string = view?.nodeId ?? '(done)';
    assert.ok(view && view.options.length > 0, `node ${nodeId} presents options`);
    pressKey(s, choice === 0 ? 'Digit1' : 'Digit2');
    // Non-terminal nodes continue with E after the choice.
    if (s.handles.dialogue.running) pressE(s);
  }
  pressE(s); // terminal advance completes the tree
  assert.equal(s.handles.dialogue.done, true, 'dialogue completed');
}

/** Talk + three pages + console press: leaves the outro running. */
function playUpToIgnition(s: WorkSession, choices: number[]): void {
  s.handles.unlockAudio();
  settle(s);
  routeToNpc(s);
  assert.equal(s.handles.hud.prompt.visible, true);
  assert.equal(s.handles.hud.prompt.label, '按 E 与陈师傅交谈');
  playTalk(s, choices);
  assert.equal(s.handles.progress.value.talkDone, true, 'handover done');

  // The console chain is honest: with pages still missing the console is not
  // even a candidate, and pressing E there does nothing.
  routeThroughDoor(s);
  routeBackToDoor(s);
  routeToConsole(s);
  assert.equal(s.handles.hud.prompt.visible, false, 'console gated before the pages are gathered');
  pressE(s);
  assert.equal(commitsOf(s, 'keeper.lamp-lit').length, 0, 'gated console ignores the press');
  assert.equal(s.handles.lamp.lit(), false);

  // Stuck drawer: first pull jams, second opens; the page inside is blocked
  // until the drawer is open.
  walkTo(s, 0.4, 0.6, 0.3, 200, 'doorway');
  walkTo(s, 0, -0.35, 0.3, 160, 'through the doorway');
  routeToDeskFront(s);
  assert.equal(s.handles.hud.prompt.label, '按 E 拉开抽屉');
  pressE(s); // jam
  assert.equal(s.handles.drawer.opened(), false, 'first pull only jams the stuck drawer');
  assert.equal(s.handles.drawer.tugs(), 1);
  assert.equal(s.handles.inventory.count('logbook-page'), 0, 'closed drawer blocks the page');
  assert.equal(commitsOf(s, 'keeper.drawer-opened').length, 0);
  pressE(s); // open
  assert.equal(s.handles.drawer.opened(), true);
  assert.equal(commitsOf(s, 'keeper.drawer-opened').length, 1, 'drawer-opened fact committed once');
  waitUntil(s, () => s.handles.drawer.z() > -3.3, 150, 'drawer slides out');
  pressE(s); // page inside the drawer
  assert.deepEqual(s.handles.progress.value.pages, ['drawer'], 'drawer page collected');
  assert.equal(s.handles.inventory.count('logbook-page'), 1);
  pressE(s); // page on the desk top
  assert.equal(s.handles.inventory.count('logbook-page'), 2);

  routeBackToDoor(s);
  routeToConsole(s);
  routeToShelf(s);
  assert.equal(s.handles.hud.prompt.label, '按 E 拾起日志页');
  pressE(s);
  assert.equal(s.handles.inventory.count('logbook-page'), 3, 'three pages held');
  assert.equal(s.handles.tracker.isComplete('gather-pages'), true);

  routeToConsole(s);
  assert.equal(s.handles.hud.prompt.label, '按 E 点亮灯器');
  const oscBefore = s.backend.count('osc.start');
  pressE(s); // light the lamp
  assert.equal(s.handles.lamp.lit(), true);
  assert.equal(commitsOf(s, 'keeper.lamp-lit').length, 1, 'lamp-lit fact committed once');
  assert.ok(s.backend.count('osc.start') >= oscBefore + 4, 'ignite + foghorn voices scheduled through the AudioPlayer');
  assert.equal(s.handles.outro.state(), 'running', 'outro timeline started');
  assert.equal(s.handles.director.activeRig?.name, 'outro-lamp', 'cutscene rig owns the camera');
}

function assertShiftCompleteOnce(s: WorkSession): void {
  assert.equal(s.handles.tracker.isComplete('light-the-lamp'), true, 'lamp objective complete');
  const completed = objectiveCompleted(s, 'light-the-lamp');
  assert.equal(completed.length, 1, 'lamp completion committed exactly once');
  assert.equal(completed[0].eventId, 'objectives:light-the-lamp:completed');
  assert.equal(commitsOf(s, 'keeper.outro-done').length, 1, 'outro cue committed exactly once');
}

// ---------------------------------- tests -----------------------------------

test('dialogue tree: three branch points, input-edge driven, effects and talk objective commit exactly once', async () => {
  // Static shape: exactly three branch points (q1, q2, q3), two options each.
  const branchNodes = DIALOGUE_NODES.filter((n) => (n.options?.length ?? 0) > 0);
  assert.deepEqual(branchNodes.map((n) => n.id).sort(), ['q1', 'q2', 'q3'], 'three branch points');
  assert.ok(branchNodes.every((n) => n.options!.length >= 2), 'each branch point offers a real choice');

  const s = await startSession();
  s.handles.unlockAudio();
  settle(s);

  // Public look path: pointer deltas turn the first-person view.
  const yawBefore = s.handles.viewYaw;
  turnBy(s, 0.8);
  assert.ok(Math.abs(s.handles.viewYaw - (yawBefore + 0.8)) < 1e-6, 'pointer deltas steer the view');

  routeToNpc(s);
  assert.equal(s.handles.hud.prompt.label, '按 E 与陈师傅交谈');

  const oscBefore = s.backend.count('osc.start');
  pressE(s); // start
  assert.equal(s.handles.dialogue.current?.nodeId, 'arrive');
  assert.equal(s.handles.hud.subtitle.text, '三十年了，这间屋子一点没变。');
  assert.equal(s.handles.hud.subtitle.speaker, '陈师傅');

  // While the dialogue runs the walker is frozen.
  const held = pos(s);
  s.device.keyDown('KeyW');
  idle(s, 15);
  s.device.keyUp('KeyW');
  assert.deepEqual(pos(s), held, 'player held in place during the conversation');

  pressE(s); // -> q1 (branch point 1)
  const q1 = s.handles.dialogue.current;
  assert.equal(q1?.nodeId, 'q1');
  assert.equal(q1?.options.length, 2);
  assert.match(s.handles.dialogueElement.textContent, /1 · 灯灭了以后，船怎么办？/);

  pressE(s); // advance() is a no-op on an options node
  assert.equal(s.handles.dialogue.current?.nodeId, 'q1', 'E does not skip a branch point');

  pressKey(s, 'Digit2'); // -> tonight
  assert.equal(s.handles.dialogue.current?.nodeId, 'tonight');
  pressE(s); // -> q2 (branch point 2)
  pressKey(s, 'Digit1'); // -> linger
  assert.equal(s.handles.dialogue.current?.nodeId, 'linger');
  pressE(s); // -> q3 (branch point 3)
  const q3 = s.handles.dialogue.current;
  assert.equal(q3?.nodeId, 'q3');
  assert.equal(q3?.options.length, 2);
  pressKey(s, 'Digit2'); // -> end-b, effect commits before the move
  assert.equal(commitsOf(s, 'keeper.ending-warm').length, 1, 'chosen ending fact committed once');
  assert.equal(commitsOf(s, 'keeper.ending-accepts').length, 0);
  const effect = commitsOf(s, 'keeper.ending-warm')[0];
  assert.equal(effect.eventId, 'keeper:q3:1', 'deterministic idempotent effect key');
  assert.equal(s.handles.dialogue.current?.nodeId, 'end-b');
  pressE(s); // terminal
  assert.equal(s.handles.dialogue.done, true);
  assert.equal(commitsOf(s, 'keeper.talk-done').length, 1, 'talk fact committed exactly once');
  assert.equal(objectiveCompleted(s, 'finish-handover').length, 1, 'handover objective completed exactly once');
  assert.equal(s.handles.tracker.progressOf('finish-handover'), 1);
  assert.equal(s.handles.dialogueElement.textContent, '', 'choice list cleared');
  assert.match(s.handles.objectivesElement.textContent, /交接 ✓/);
  assert.ok(s.backend.count('osc.start') > oscBefore, 'dialogue blips scheduled');
  await s.host.stop();

  // A different route through the tree commits the other ending, still once.
  const b = await startSession();
  b.handles.unlockAudio();
  settle(b);
  routeToNpc(b);
  playTalk(b, [0, 0, 0]); // ships -> linger -> end-a
  assert.equal(commitsOf(b, 'keeper.ending-accepts').length, 1, 'alternate ending committed once');
  assert.equal(commitsOf(b, 'keeper.ending-warm').length, 0);
  assert.equal(commitsOf(b, 'keeper.talk-done').length, 1);
  assert.equal(objectiveCompleted(b, 'finish-handover').length, 1);
  assert.equal(b.handles.progress.value.ending, 'accepts');
  await b.host.stop();
});

test('inventory: the stuck drawer blocks its page until opened; three pages complete the gather objective once', async () => {
  const s = await startSession();
  s.handles.unlockAudio();
  settle(s);
  routeThroughDoor(s);
  routeToDeskFront(s);

  // Closed drawer: only the drawer itself is a candidate.
  assert.equal(s.handles.hud.prompt.label, '按 E 拉开抽屉');
  pressE(s);
  assert.equal(s.handles.drawer.opened(), false, 'stuck: first pull jams');
  assert.equal(s.handles.inventory.count('logbook-page'), 0, 'page unreachable while the drawer is closed');
  assert.equal(commitsOf(s, 'keeper.page-collected').length, 0);
  assert.equal(s.handles.hud.subtitle.text, '抽屉卡住了，纹丝不动。');

  pressE(s);
  assert.equal(s.handles.drawer.opened(), true);
  assert.equal(s.handles.hud.subtitle.text, '再一使劲——抽屉开了。');
  waitUntil(s, () => s.handles.drawer.z() > -3.3, 150, 'drawer slides out');
  assert.equal(s.handles.hud.prompt.label, '按 E 取出日志页');

  pressE(s);
  assert.equal(s.handles.inventory.count('logbook-page'), 1);
  assert.deepEqual(s.handles.inventory.entries(), [['logbook-page', 1]]);
  assert.equal(commitsOf(s, 'keeper.page-collected').length, 1);
  assert.equal(s.handles.tracker.progressOf('gather-pages'), 1);

  // The desk-top page is the next nearest candidate at the desk front.
  assert.equal(s.handles.hud.prompt.label, '按 E 拾起日志页');
  pressE(s);
  assert.equal(s.handles.inventory.count('logbook-page'), 2);
  assert.equal(s.handles.tracker.progressOf('gather-pages'), 2);

  // The shelf page in the lamp room completes the set.
  routeBackToDoor(s);
  routeToConsole(s);
  routeToShelf(s);
  pressE(s);
  assert.equal(s.handles.inventory.count('logbook-page'), 3);
  assert.equal(s.handles.tracker.isComplete('gather-pages'), true);
  assert.equal(objectiveCompleted(s, 'gather-pages').length, 1, 'gather objective completed exactly once');
  const pages = commitsOf(s, 'keeper.page-collected').map((e) => (e.payload as { page: string }).page).sort();
  assert.deepEqual(pages, ['desk', 'drawer', 'shelf'], 'each page committed its own fact');
  assert.equal(s.handles.inventory.size, 3, 'inventory capacity exactly filled by the three pages');
  assert.match(s.handles.objectivesElement.textContent, /日志页 3\/3/);
  await s.host.stop();
});

test('full public-input replay: talk → three pages → light the lamp → outro (skipped) completes the shift exactly once', async () => {
  const s = await startSession();
  playUpToIgnition(s, [0, 1, 0]); // ships -> pages -> end-a

  // The lamp is turning and the room is lit.
  const angle0 = s.handles.lamp.rotorAngle();
  idle(s, 30);
  assert.ok(s.handles.lamp.rotorAngle() > angle0, 'rotor sweeps after ignition');
  idle(s, 3);
  assert.equal(s.handles.flash.active, true, 'ignite flash fired (normal motion)');

  // Input frozen while the outro rig owns the camera.
  const held = pos(s);
  s.device.keyDown('KeyW');
  idle(s, 12);
  s.device.keyUp('KeyW');
  assert.deepEqual(pos(s), held, 'player frozen during the outro');

  // Public skip path: the Escape edge applies the declared finish policy.
  pressKey(s, 'Escape');
  idle(s, 5);
  assert.equal(s.handles.outro.state(), 'skipped');
  assert.match(s.handles.outro.skipPolicy, /finish/);
  assertShiftCompleteOnce(s);
  assert.equal(objectiveCompleted(s, 'gather-pages').length, 1);
  assert.equal(objectiveCompleted(s, 'finish-handover').length, 1);
  assert.equal(s.handles.director.activeRig?.name, 'player-head', 'camera handed back to the head rig');
  assert.equal(s.handles.hud.subtitle.text, '雨还在下，但海上有了光。');
  assert.match(s.handles.objectivesElement.textContent, /点灯 ✓/);

  // The world stays playable afterwards.
  const before = pos(s);
  s.device.keyDown('KeyW');
  idle(s, 10);
  s.device.keyUp('KeyW');
  assert.notDeepEqual(pos(s), before, 'walker free after the outro');

  assert.equal(s.host.diagnosticsLog.length, 0, 'session ran clean');
  await s.host.stop();
});

test('outro: natural completion and input-driven skip reach the same semantic end state', async () => {
  const runToEnd = async (skip: boolean): Promise<WorkSession> => {
    const s = await startSession();
    playUpToIgnition(s, [1, 0, 1]); // tonight -> linger -> end-b
    if (skip) {
      idle(s, 40);
      pressKey(s, 'Escape');
      idle(s, 5);
      assert.equal(s.handles.outro.state(), 'skipped');
    } else {
      waitUntil(s, () => s.handles.outro.state() === 'completed', 420, 'outro completes naturally');
    }
    assertShiftCompleteOnce(s);
    assert.equal(s.handles.director.activeRig?.name, 'player-head');
    assert.equal(s.handles.hud.subtitle.text, '雨还在下，但海上有了光。');
    assert.ok(s.handles.lamp.rotorAngle() > 0.2, 'rotor swept in both runs');
    assert.equal(s.host.diagnosticsLog.length, 0);
    return s;
  };

  const natural = await runToEnd(false);
  const skipped = await runToEnd(true);

  // Same semantic end: objective snapshot, gameplay fact sequence and HUD line.
  assert.deepEqual(skipped.handles.tracker.snapshot(), natural.handles.tracker.snapshot(), 'objective snapshots match');
  const namesOf = (s: WorkSession): string[] => s.handles.recordedCommits.map((c) => c.eventId);
  assert.deepEqual(namesOf(skipped), namesOf(natural), 'identical committed fact sequence');
  await natural.host.stop();
  await skipped.host.stop();
});

test('checkpoint mid-route: destroy the session, restore into a fresh one, finish the same goal', async () => {
  // An unknown checkpoint schema version is an honest error, not a merge.
  {
    const host = new RuntimeSessionHost({
      experienceDigest: 'keepers-last-shift-v1',
      buildId: 'work-keepers-last-shift-test',
      mode: 'controlled',
      fixedDt: DT,
    });
    const module = createKeepersLastShiftModule({
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

  // A checkpoint cannot be taken mid-dialogue (declared limitation).
  {
    const s = await startSession();
    s.handles.unlockAudio();
    settle(s);
    routeToNpc(s);
    pressE(s);
    assert.equal(s.handles.dialogue.running, true);
    let failure: unknown = null;
    try {
      s.handles.saveCheckpoint();
    } catch (err) {
      failure = err;
    }
    assert.ok(failure instanceof Error, 'mid-dialogue save rejects');
    assert.match((failure as Error).message, /dialogue/);
    await s.host.stop();
  }

  // Session 1: talk + two pages, save mid-route.
  const a = await startSession();
  a.handles.unlockAudio();
  settle(a);
  routeToNpc(a);
  playTalk(a, [0, 1, 0]);
  walkTo(a, 0.4, 0.6, 0.3, 220, 'doorway');
  walkTo(a, 0, -0.35, 0.3, 160, 'through the doorway');
  routeToDeskFront(a);
  pressE(a); // jam
  pressE(a); // open
  waitUntil(a, () => a.handles.drawer.z() > -3.3, 150, 'drawer slides out');
  pressE(a); // drawer page
  routeBackToDoor(a);
  routeToConsole(a);
  routeToShelf(a);
  pressE(a); // shelf page — two of three held, standing by the side table
  assert.equal(a.handles.inventory.count('logbook-page'), 2);
  const cp = JSON.parse(JSON.stringify(a.handles.saveCheckpoint())) as KeeperCheckpoint;
  assert.equal(cp.checkpointSchemaVersion, 1);
  assert.equal(cp.state.data.talkDone, true, 'checkpoint carries progress state');
  assert.deepEqual([...cp.state.data.pages].sort(), ['drawer', 'shelf']);
  assert.deepEqual(cp.inventory.items, { 'logbook-page': 2 }, 'checkpoint carries the inventory');
  assert.equal(cp.objectives.progress['gather-pages'], 2, 'checkpoint carries objective progress');
  assert.ok(cp.commits.some((f) => f.eventId === 'keeper:talk-done'), 'checkpoint carries the commit log');
  await a.host.stop();

  // Session 2: fresh host + module, restore, replay the rest.
  const b = await startSession(cp);
  b.handles.unlockAudio();
  const p = pos(b);
  assert.ok(Math.hypot(p[0] - cp.player[0], p[2] - cp.player[2]) < 1e-6, 'player pose restored exactly');
  assert.equal(b.handles.viewYaw, cp.viewYaw, 'view yaw restored');
  assert.equal(b.handles.tracker.progressOf('finish-handover'), 1, 'handover progress restored');
  assert.equal(b.handles.tracker.progressOf('gather-pages'), 2);
  assert.equal(b.handles.inventory.count('logbook-page'), 2, 'inventory restored');
  assert.equal(commitsOf(b, 'keeper.talk-done').length, 1, 'carried fact rebuilt in the fresh log');
  assert.equal(commitsOf(b, 'keeper.page-collected').length, 2);
  assert.equal(b.handles.progress.value.drawerOpened, true, 'drawer stays open across the restore');
  assert.equal(b.handles.drawer.tugs(), 2);

  // Already-collected pages are inert: pressing at the shelf changes nothing.
  pressE(b);
  assert.equal(commitsOf(b, 'keeper.page-collected').length, 2, 'no re-collection after restore');

  // The carried fact log still dedupes the same eventIds.
  const dup = b.host.commits.commit('keeper.talk-done', {}, 'keeper:talk-done', {
    generation: b.host.currentGeneration,
    tick: 0,
  });
  assert.equal(dup.status, 'duplicate', 'restored commit log still dedupes');

  // Finish the shift: desk page -> console -> ignite -> skip outro.
  routeToConsole(b);
  walkTo(b, 0.4, 0.6, 0.3, 200, 'doorway');
  walkTo(b, 0, -0.35, 0.3, 160, 'through the doorway');
  routeToDeskFront(b);
  assert.equal(b.handles.hud.prompt.label, '按 E 拾起日志页');
  pressE(b);
  assert.equal(b.handles.inventory.count('logbook-page'), 3);
  assert.equal(objectiveCompleted(b, 'gather-pages').length, 1, 'gather completes exactly once in the restored session');
  routeBackToDoor(b);
  routeToConsole(b);
  assert.equal(b.handles.hud.prompt.label, '按 E 点亮灯器');
  pressE(b);
  assert.equal(b.handles.lamp.lit(), true);
  idle(b, 10);
  pressKey(b, 'Escape');
  idle(b, 5);
  assertShiftCompleteOnce(b);
  assert.equal(b.handles.progress.value.pages.length, 3);
  assert.equal(b.host.diagnosticsLog.length, 0, 'restored session ran clean');
  await b.host.stop();
});

test('rain outside the window honors reduce-motion; fades resolve instantly, flashes suppressed', async () => {
  const normal = await startSession();
  settle(normal, 30);
  idle(normal, 60);
  const normalSpawned = normal.handles.rain.totalSpawned;
  assert.ok(normalSpawned >= 55, `rain falls at the default rate (${normalSpawned})`);
  assert.ok(normal.handles.rain.aliveCount > 10, 'rain lives outside the window');
  assert.ok(normal.handles.rain.object.position.x < -3.7, 'emitter sits outside the west wall');
  normal.handles.flash.flash(0xffffff, 1.0);
  idle(normal, 2);
  assert.equal(normal.handles.flash.active, true, 'flash fires with normal motion');
  await normal.host.stop();

  const calm = await startSession(undefined, true);
  settle(calm, 30);
  idle(calm, 60);
  const calmSpawned = calm.handles.rain.totalSpawned;
  assert.ok(calmSpawned >= 20, 'rain still falls under reduce-motion');
  assert.ok(normalSpawned >= calmSpawned * 1.5, `reduce-motion halves emission (${normalSpawned} vs ${calmSpawned})`);
  assert.equal(calm.handles.fade.progress, 0, 'entry reveal is instant under reduce-motion');
  calm.handles.flash.flash(0xffffff, 1.0);
  idle(calm, 2);
  assert.equal(calm.handles.flash.active, false, 'flashes suppressed under reduce-motion');
  await calm.host.stop();
});

test('parameters: validation rejects bad values; live apply retunes rain, the lamp and the stuck drawer', async () => {
  const s = await startSession();
  s.handles.unlockAudio();
  settle(s);

  const snapshot = s.handles.params.snapshot();
  assert.deepEqual(
    Object.keys(snapshot).sort(),
    ['keeper.drawer-tugs', 'keeper.lamp-speed', 'keeper.rain-rate'],
    'author parameters are exposed',
  );
  assert.equal(snapshot['keeper.rain-rate'].value, 70);

  const rejected = s.handles.params.set('keeper.rain-rate', 5);
  assert.equal(rejected.ok, false);
  assert.match(rejected.reason ?? '', /10\.\.140/);
  assert.equal(s.handles.params.get('keeper.rain-rate')!.value, 70, 'rejected value keeps the old one');
  assert.equal(s.handles.params.set('keeper.drawer-tugs', 9).ok, false);
  assert.match(s.handles.params.set('keeper.drawer-tugs', 9).reason ?? '', /1\.\.3/);
  assert.equal(s.handles.params.set('keeper.lamp-speed', 9).ok, false);
  assert.match(s.handles.params.set('keeper.lamp-speed', 9).reason ?? '', /0\.2\.\.2\.5/);

  // Live rain retune is observable on the emitter (totalSpawned is cumulative,
  // so measure only the window after the apply).
  assert.equal(s.handles.params.set('keeper.rain-rate', 25).ok, true);
  const spawnedBefore = s.handles.rain.totalSpawned;
  idle(s, 60);
  const spawned = s.handles.rain.totalSpawned - spawnedBefore;
  assert.ok(spawned >= 15 && spawned <= 32, `emitter runs at the new rate (${spawned} in 1s)`);

  // Live drawer retune: three pulls required now.
  assert.equal(s.handles.params.set('keeper.drawer-tugs', 3).ok, true);
  assert.equal(s.handles.params.set('keeper.lamp-speed', 2.0).ok, true);
  assert.equal(s.handles.lamp.speed(), 2.0, 'lamp speed retuned');

  routeThroughDoor(s);
  routeToDeskFront(s);
  pressE(s);
  pressE(s);
  assert.equal(s.handles.drawer.opened(), false, 'two pulls no longer open the drawer');
  assert.equal(s.handles.drawer.tugs(), 2);
  pressE(s);
  assert.equal(s.handles.drawer.opened(), true, 'third pull opens it');

  idle(s, 30);
  assert.equal(s.host.currentStatus, 'running', 'session stays healthy after live param applies');
  assert.equal(s.host.diagnosticsLog.length, 0);
  await s.host.stop();
});
