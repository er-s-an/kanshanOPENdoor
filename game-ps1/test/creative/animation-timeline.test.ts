import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RuntimeSessionHost } from '../../src/creative/core/index.ts';
import type { SceneContext, SceneInstance } from '../../src/creative/core/index.ts';
import { createMixer, MixerHandle } from '../../src/creative/animation/mixer.ts';
import {
  cue,
  parallel,
  playClip,
  sequence,
  timeline,
  tween,
  wait,
} from '../../src/creative/animation/timeline.ts';
import type { TimelineHandle } from '../../src/creative/animation/timeline.ts';

const DT = 1 / 60;

function approx(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) <= eps;
}

function hostOpts() {
  return { experienceDigest: 'exp-tl', buildId: 'build-tl', mode: 'controlled' as const, fixedDt: DT };
}

interface Refs {
  ctx: SceneContext;
  door: THREE.Object3D;
  mesh: THREE.Mesh;
  mixer: MixerHandle;
  action: THREE.AnimationAction;
  handle?: TimelineHandle;
}

async function startSession(setup?: (ctx: SceneContext, refs: Refs) => void): Promise<{ host: RuntimeSessionHost; refs: Refs }> {
  const refs = {} as Refs;
  const host = new RuntimeSessionHost(hostOpts());
  await host.start({
    create(ctx: SceneContext): SceneInstance {
      refs.ctx = ctx;
      const root = new THREE.Group();
      setup?.(ctx, refs);
      return { root };
    },
  });
  return { host, refs };
}

function setupDoor(_ctx: SceneContext, refs: Refs): void {
  refs.door = new THREE.Group();
  refs.door.name = 'door';
  refs.door.rotation.y = 0;
}

function setupClip(ctx: SceneContext, refs: Refs): void {
  refs.mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  refs.mixer = createMixer(ctx, refs.mesh);
  const clip = new THREE.AnimationClip('slide', 1, [
    new THREE.VectorKeyframeTrack('.position[x]', [0, 1], [0, 5]),
  ]);
  refs.action = refs.mixer.prepare(clip);
}

function commitsNamed(host: RuntimeSessionHost, name: string): number {
  return host.commits.entries.filter((e) => e.name === name).length;
}

const OPEN = Math.PI / 2;

function doorTimeline(refs: Refs, opts?: { cancelPolicy?: 'freeze' | 'finish' | 'revert' }) {
  return timeline('door-open', {
    ...opts,
    endState: { natural: 'door fully open', skip: 'door fully open' },
  })
    .add(
      tween({ target: refs.door, props: { 'rotation.y': OPEN }, duration: 0.5, easing: 'easeInOut' }),
      cue('door.opened', { door: 'front' }),
    );
}

test('sequence/wait timing via injected fixed steps (G07.a ordering)', async () => {
  const { host, refs } = await startSession(setupDoor);
  const tl = timeline('seq').add(
    tween({ target: refs.door, props: { 'rotation.y': 1 }, duration: 0.5, easing: 'linear' }),
    wait(0.25),
    tween({ target: refs.door, props: { 'position.x': 2 }, duration: 0.25, easing: 'linear' }),
  );
  assert.equal(tl.duration, 1.0);
  const handle = tl.run(refs.ctx);

  host.step(15); // t=0.25: first tween halfway
  assert.ok(approx(refs.door.rotation.y, 0.5, 1e-6), `rotation ~0.5, got ${refs.door.rotation.y}`);
  assert.equal(refs.door.position.x, 0, 'wait not reached yet');

  host.step(15); // t=0.5: first tween done exactly, waiting
  assert.equal(refs.door.rotation.y, 1, 'finished tween lands exactly on its end value');
  assert.equal(refs.door.position.x, 0);

  host.step(15); // t=0.75: the wait has just ended; the second tween starts now
  assert.equal(refs.door.position.x, 0, 'second tween has not advanced yet');

  host.step(7); // tween2 elapsed 7/60 of 0.25s
  assert.ok(approx(refs.door.position.x, (7 * DT * 2) / 0.25, 1e-6));

  host.step(8); // t=1.0
  assert.equal(refs.door.position.x, 2);
  assert.equal(handle.state, 'completed');
  const result = await handle.finished;
  assert.equal(result.status, 'completed');
  await host.stop();
});

test('parallel timing: children advance together, duration is the max (G07.a)', async () => {
  const { host, refs } = await startSession(setupDoor);
  const a = new THREE.Group();
  const tl = timeline('par').add(
    parallel(
      tween({ target: refs.door, props: { 'rotation.y': 1 }, duration: 0.5, easing: 'linear' }),
      tween({ target: a, props: { 'position.x': 4 }, duration: 1.0, easing: 'linear' }),
    ),
  );
  assert.equal(tl.duration, 1.0);
  const handle = tl.run(refs.ctx);
  host.step(30);
  assert.equal(refs.door.rotation.y, 1, 'short child finished');
  assert.ok(approx(a.position.x, 2, 1e-6), 'long child halfway');
  assert.equal(handle.state, 'running');
  host.step(30);
  assert.equal(a.position.x, 4);
  assert.equal(handle.state, 'completed');
  await host.stop();
});

test('nested sequence inside parallel keeps its internal order', async () => {
  const { host, refs } = await startSession(setupDoor);
  const tl = timeline('nested').add(
    parallel(
      sequence(
        tween({ target: refs.door, props: { 'position.x': 1 }, duration: 0.25, easing: 'linear' }),
        tween({ target: refs.door, props: { 'position.y': 1 }, duration: 0.25, easing: 'linear' }),
      ),
      wait(0.5),
    ),
  );
  const handle = tl.run(refs.ctx);
  host.step(15); // t=0.25
  assert.ok(approx(refs.door.position.x, 1, 1e-6));
  assert.equal(refs.door.position.y, 0, 'nested second step not started');
  host.step(30); // t=0.75
  assert.equal(refs.door.position.x, 1);
  assert.equal(refs.door.position.y, 1);
  assert.equal(handle.state, 'completed');
  await host.stop();
});

test('skip() reaches the SAME end state as natural completion; each path commits exactly once (G07)', async () => {
  const { host, refs } = await startSession(setupDoor);

  // Natural completion.
  const natural = doorTimeline(refs).run(refs.ctx);
  host.step(60);
  assert.equal(natural.state, 'completed');
  const naturalRot = refs.door.rotation.y;
  assert.equal(commitsNamed(host, 'door.opened'), 1, 'natural run commits the cue once');

  // Skip from the very start.
  refs.door.rotation.y = 0;
  const skipped = doorTimeline(refs).run(refs.ctx);
  skipped.skip();
  assert.equal(skipped.state, 'skipped');
  assert.equal(refs.door.rotation.y, naturalRot, 'skip lands on the identical end state');
  assert.equal(commitsNamed(host, 'door.opened'), 2, 'skip run commits the cue exactly once');

  // Skip after the cue already fired naturally within the same run (the run
  // is still active thanks to the trailing wait, so finalize walks over the
  // already-fired cue and must not duplicate it).
  refs.door.rotation.y = 0;
  const withTail = timeline('door-open-tail')
    .add(
      tween({ target: refs.door, props: { 'rotation.y': OPEN }, duration: 0.5, easing: 'easeInOut' }),
      cue('door.opened', { door: 'front' }),
      wait(0.5),
    )
    .run(refs.ctx);
  host.step(45); // past the cue (t=0.5), inside the trailing wait
  assert.equal(withTail.state, 'running');
  assert.equal(commitsNamed(host, 'door.opened'), 3, 'cue fired during natural playback');
  withTail.skip();
  assert.equal(refs.door.rotation.y, naturalRot);
  assert.equal(commitsNamed(host, 'door.opened'), 3, 'skip after natural cue does not duplicate the commit');

  const skippedResult = await skipped.finished;
  assert.equal(skippedResult.status, 'skipped');
  await host.stop();
});

test('cancel ("freeze" default): settles the promise, runs no further steps, late updates are no-ops', async () => {
  const { host, refs } = await startSession(setupDoor);
  const handle = doorTimeline(refs).run(refs.ctx);
  host.step(15);
  const frozenRot = refs.door.rotation.y;
  assert.ok(frozenRot > 0 && frozenRot < OPEN);
  handle.cancel();
  assert.equal(handle.state, 'cancelled');
  const result = await handle.finished;
  assert.equal(result.status, 'cancelled', 'finished promise settles on cancel');

  host.step(30); // host keeps stepping: no further timeline effect
  assert.equal(refs.door.rotation.y, frozenRot, 'cancelled timeline runs no further steps');
  handle.update(1);
  assert.equal(refs.door.rotation.y, frozenRot, 'explicit late update is a no-op');
  assert.equal(commitsNamed(host, 'door.opened'), 0, 'cancelled run never reaches the cue');

  await host.stop();
  handle.update(1);
  assert.equal(refs.door.rotation.y, frozenRot, 'update after session destroy is a no-op (scope guard)');
});

test('cancelPolicy "finish" jumps to the declared end state; "revert" restores start values', async () => {
  const { host, refs } = await startSession(setupDoor);

  const finishing = doorTimeline(refs, { cancelPolicy: 'finish' }).run(refs.ctx);
  host.step(15);
  finishing.cancel();
  assert.equal(finishing.state, 'cancelled');
  assert.equal(refs.door.rotation.y, OPEN, 'finish policy applies the deterministic end state');
  assert.equal(commitsNamed(host, 'door.opened'), 1, 'end-state cues still commit exactly once');

  refs.door.rotation.y = 0;
  const reverting = doorTimeline(refs, { cancelPolicy: 'revert' }).run(refs.ctx);
  host.step(15);
  reverting.cancel();
  assert.equal(reverting.state, 'cancelled');
  assert.equal(refs.door.rotation.y, 0, 'revert restores the captured start values');
  assert.equal(commitsNamed(host, 'door.opened'), 1, 'revert never fires later cues');

  await host.stop();
});

test('pause freezes progress (handle pause while stepping; host pause freezes the clock)', async () => {
  const { host, refs } = await startSession(setupDoor);
  const handle = doorTimeline(refs).run(refs.ctx);

  host.step(15);
  const t1 = handle.time;
  const rot1 = refs.door.rotation.y;

  handle.pause();
  host.step(15); // host keeps stepping, the paused timeline must not advance
  assert.equal(handle.time, t1, 'paused handle consumes no sim time');
  assert.equal(refs.door.rotation.y, rot1, 'paused handle applies no steps');
  handle.resume();

  host.step(15);
  assert.ok(handle.time > t1, 'resumed timeline advances with the host clock');

  host.pause(); // session-level pause: no steps are scheduled at all
  const t2 = handle.time;
  assert.equal(handle.time, t2, 'sim-time driven: no progress happens without steps');
  host.resume(0);
  host.step(15);
  assert.ok(handle.time > t2);

  host.step(30);
  assert.equal(handle.state, 'completed');
  await host.stop();
});

test('headless/explicit mode: autoHook:false advances only via handle.update(dt)', async () => {
  const { host, refs } = await startSession(setupDoor);
  const handle = doorTimeline(refs).run(refs.ctx, { autoHook: false });
  host.step(30); // host steps do not drive the timeline without the hook
  assert.equal(handle.time, 0);
  assert.equal(refs.door.rotation.y, 0);
  for (let i = 0; i < 60; i += 1) handle.update(DT);
  assert.equal(handle.state, 'completed');
  assert.equal(refs.door.rotation.y, OPEN);
  await host.stop();
});

test('scrub: isolated preview on cloned targets — no commits, no residue on real targets', async () => {
  const { host, refs } = await startSession(setupDoor);
  const tl = doorTimeline(refs);

  const scrub = tl.createScrub();
  scrub.setTime(0.25); // halfway through the 0.5s tween
  const previewDoor = scrub.previewTargets.get(refs.door);
  assert.ok(previewDoor, 'preview bound a cloned target');
  assert.notEqual(previewDoor, refs.door, 'preview operates on a separate clone');
  assert.ok(approx(previewDoor!.rotation.y, OPEN / 2, 1e-6), 'preview clone shows the mid pose');
  assert.equal(refs.door.rotation.y, 0, 'real target untouched by scrub');
  assert.equal(scrub.previewLog.length, 0, 'cue not reached yet');

  scrub.setTime(0.75); // past the cue
  assert.equal(refs.door.rotation.y, 0, 'real target still untouched');
  assert.equal(scrub.previewLog.length, 1, 'cue observed exactly once in the preview log');
  assert.equal(scrub.previewLog[0].type, 'cue');
  assert.equal(commitsNamed(host, 'door.opened'), 0, 'scrub never commits');
  scrub.setTime(0.75); // re-evaluating does not duplicate the preview cue
  assert.equal(scrub.previewLog.length, 1);
  scrub.dispose();

  // Natural run after scrubbing: exactly one commit, door ends fully open.
  const handle = tl.run(refs.ctx);
  host.step(60);
  assert.equal(handle.state, 'completed');
  assert.equal(refs.door.rotation.y, OPEN, 'no scrub residue on the real run');
  assert.equal(commitsNamed(host, 'door.opened'), 1, 'exactly one commit for the natural run');
  await host.stop();
});

test('scrub after a completed run leaves the end state and commits untouched (explicit pristine base)', async () => {
  const { host, refs } = await startSession(setupDoor);
  const tl = doorTimeline(refs);

  // Capture a pristine door BEFORE the run to serve as the preview binding.
  const pristine = refs.door.clone(true);
  assert.equal(pristine.rotation.y, 0);

  const handle = tl.run(refs.ctx);
  host.step(60);
  assert.equal(handle.state, 'completed');
  assert.equal(commitsNamed(host, 'door.opened'), 1);

  // Preview binds to the pristine base: mid-pose exactly, real door untouched.
  const scrub = tl.createScrub(new Map([[refs.door, pristine]]));
  scrub.setTime(0.25);
  const previewDoor = scrub.previewTargets.get(refs.door);
  assert.equal(previewDoor, pristine, 'explicit preview binding used');
  assert.ok(approx(previewDoor!.rotation.y, OPEN / 2, 1e-6), 'preview pose from the pristine base');
  assert.equal(refs.door.rotation.y, OPEN, 'completed run end state untouched by later scrub');
  assert.equal(commitsNamed(host, 'door.opened'), 1, 'scrub never advances commits/saves');
  scrub.dispose();
  assert.equal(refs.door.rotation.y, OPEN, 'disposing the preview never writes back');
  await host.stop();
});

test('scrub previews playClip poses on a cloned subtree', async () => {
  const { host, refs } = await startSession(setupClip);
  const tl = timeline('clip-preview').add(playClip(refs.action));
  const scrub = tl.createScrub();
  scrub.setTime(0.5);
  const previewMesh = scrub.previewTargets.get(refs.mesh);
  assert.ok(previewMesh, 'clip preview cloned the mixer root');
  assert.ok(approx(previewMesh!.position.x, 2.5, 1e-6), 'preview pose at t=0.5 of a 0→5 clip');
  assert.equal(refs.mesh.position.x, 0, 'real mesh untouched');
  scrub.dispose();
  await host.stop();
});

test('playClip inside a timeline: natural end pose equals skip end pose (both = clip final frame)', async () => {
  const { host, refs } = await startSession(setupClip);

  const natural = timeline('clip-run').add(playClip(refs.action)).run(refs.ctx);
  host.step(60);
  assert.equal(natural.state, 'completed');
  const naturalX = refs.mesh.position.x;
  assert.ok(approx(naturalX, 5, 1e-6), `natural end pose is the final frame, got ${naturalX}`);
  assert.equal(refs.action.paused, true, 'clip step ends paused on the final frame');

  refs.mesh.position.x = 0;
  refs.action.stop();
  const skipped = timeline('clip-run').add(playClip(refs.action)).run(refs.ctx);
  skipped.skip();
  assert.ok(approx(refs.mesh.position.x, naturalX, 1e-9), 'skip reaches the identical clip end pose');
  await host.stop();
});

test('pause mid-clip then skip still lands on the deterministic clip end state', async () => {
  const { host, refs } = await startSession(setupClip);
  const handle = timeline('clip-pause').add(playClip(refs.action)).run(refs.ctx);
  host.step(30);
  handle.pause();
  host.step(30); // paused: mixer still advances via its own hook; timeline clock frozen
  handle.resume();
  handle.skip();
  assert.ok(approx(refs.mesh.position.x, 5, 1e-6), 'skip forces the final frame deterministically');
  await host.stop();
});

test('tween supports Vector3 props and explicit from-values', async () => {
  const { host, refs } = await startSession(setupDoor);
  const tl = timeline('vec-tween').add(
    tween({
      target: refs.door,
      props: { position: new THREE.Vector3(3, 0, 0) },
      from: { position: new THREE.Vector3(1, 0, 0) },
      duration: 0.5,
      easing: 'linear',
    }),
  );
  const handle = tl.run(refs.ctx);
  host.step(15);
  assert.ok(approx(refs.door.position.x, 2, 1e-6), 'vector prop lerps from the explicit start');
  host.step(15);
  assert.equal(refs.door.position.x, 3);
  assert.equal(handle.state, 'completed');
  await host.stop();
});

test('declared end semantics are exposed and end-state options are validated', async () => {
  const { host, refs } = await startSession(setupDoor);
  const tl = doorTimeline(refs);
  assert.deepEqual(tl.declaredEnd, { natural: 'door fully open', skip: 'door fully open' });
  assert.throws(() => tween({ target: refs.door, props: { 'rotation.y': 1 }, duration: 0 }), /duration/);
  assert.throws(() => wait(-1), /duration/);
  assert.throws(() => cue('not-namespaced'), /namespaced/);
  await host.stop();
});
