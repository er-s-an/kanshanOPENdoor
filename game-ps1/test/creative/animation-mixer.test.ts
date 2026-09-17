import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RuntimeSessionHost } from '../../src/creative/core/index.ts';
import type { SceneContext, SceneInstance } from '../../src/creative/core/index.ts';
import { MixerHandle, createMixer } from '../../src/creative/animation/mixer.ts';

const DT = 1 / 60;

function approx(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) <= eps;
}

function hostOpts() {
  return { experienceDigest: 'exp-anim', buildId: 'build-anim', mode: 'controlled' as const, fixedDt: DT };
}

function positionClip(name: string, duration: number, fromX: number, toX: number): THREE.AnimationClip {
  return new THREE.AnimationClip(name, duration, [
    new THREE.VectorKeyframeTrack('.position[x]', [0, duration], [fromX, toX]),
  ]);
}

test('play() binds a running action and the host present phase advances the mixer clock', async () => {
  let mixer: MixerHandle | null = null;
  let mesh: THREE.Mesh | null = null;
  const host = new RuntimeSessionHost(hostOpts());
  await host.start({
    create(ctx: SceneContext): SceneInstance {
      const root = new THREE.Group();
      mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
      root.add(mesh);
      mixer = createMixer(ctx, mesh);
      mixer.play(positionClip('slide', 1, 0, 10), { loop: false });
      return { root };
    },
  });
  host.step(30); // 0.5s
  assert.ok(approx(mixer!.time, 0.5, 1e-9));
  assert.ok(approx(mesh!.position.x, 5, 1e-6), 'clip interpolates at t=0.5');
  host.step(60); // 1.5s total: clamped on final frame
  assert.ok(approx(mesh!.position.x, 10, 1e-6), 'LoopOnce clamps on the last frame');
  await host.stop();
});

test('crossFade: action weights are complementary and swap over time', () => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  const handle = new MixerHandle(mesh);
  const clipA = positionClip('a', 1, 0, 0);
  const clipB = positionClip('b', 1, 0, 4);
  const a = handle.play(clipA);
  handle.update(0.25);
  assert.equal(a.getEffectiveWeight(), 1);

  const b = handle.crossFade(a, clipB, 1);
  // Note: getEffectiveWeight() refreshes during mixer.update; assert after stepping.

  handle.update(0.25);
  const wa = a.getEffectiveWeight();
  const wb = b.getEffectiveWeight();
  assert.ok(approx(wa, 0.75, 1e-6), `fading-out weight ~0.75, got ${wa}`);
  assert.ok(approx(wb, 0.25, 1e-6), `fading-in weight ~0.25, got ${wb}`);
  assert.ok(approx(wa + wb, 1, 1e-6), 'weights sum to 1 during the crossfade');

  handle.update(0.75);
  assert.ok(a.getEffectiveWeight() < 1e-3, 'old action fully faded out');
  assert.ok(approx(b.getEffectiveWeight(), 1, 1e-6), 'new action fully faded in');
  handle.dispose();
});

test('play() with fadeIn crossfades from other running actions', () => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  const handle = new MixerHandle(mesh);
  const a = handle.play(positionClip('a', 1, 0, 0));
  handle.update(0.5);
  const b = handle.play(positionClip('b', 1, 0, 2), { fadeIn: 0.5 });
  handle.update(0.25);
  assert.ok(approx(a.getEffectiveWeight() + b.getEffectiveWeight(), 1, 1e-6));
  assert.ok(b.getEffectiveWeight() > 0.4 && b.getEffectiveWeight() < 0.6);
  handle.update(0.25);
  assert.ok(approx(b.getEffectiveWeight(), 1, 1e-6));
  handle.dispose();
});

test('loop defaults to repeat; loop:false plays once and clamps', () => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  const handle = new MixerHandle(mesh);
  const repeating = handle.play(positionClip('rep', 0.5, 0, 1));
  handle.update(1.25); // 2.5 passes
  assert.ok(repeating.isRunning(), 'LoopRepeat keeps running');
  assert.ok(approx(repeating.time, 0.25, 1e-9), 'time wraps modulo duration');

  const once = handle.play(positionClip('once', 0.5, 0, 1), { loop: false });
  handle.update(1.0);
  assert.ok(!once.isRunning(), 'LoopOnce stops running at the end');
  assert.equal(once.paused, true);
  assert.ok(approx(once.time, 0.5, 1e-9), 'clamped exactly on the final frame');
  const xAfterFinish = mesh.position.x;
  handle.update(10);
  assert.ok(approx(mesh.position.x, xAfterFinish, 1e-9), 'clamped pose does not drift');
  handle.dispose();
});

test('dispose() unbinds every action and stops the clock; update becomes a no-op', () => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  const handle = new MixerHandle(mesh);
  const clip = positionClip('d', 1, 0, 1);
  const a = handle.play(clip);
  const b = handle.play(positionClip('e', 1, 0, 2), { fadeIn: 0.5 });
  handle.update(0.25);
  const t = handle.time;
  handle.dispose();
  assert.equal(a.isRunning(), false, 'action a unbound');
  assert.equal(b.isRunning(), false, 'action b unbound');
  handle.update(1);
  assert.ok(approx(handle.time, t, 1e-12), 'disposed mixer does not advance');
  handle.dispose(); // idempotent
});

test('createMixer is scope-bound: host stop disposes the mixer and unbinds actions', async () => {
  let action: THREE.AnimationAction | null = null;
  let mixer: MixerHandle | null = null;
  const host = new RuntimeSessionHost(hostOpts());
  await host.start({
    create(ctx: SceneContext): SceneInstance {
      const root = new THREE.Group();
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
      root.add(mesh);
      mixer = createMixer(ctx, mesh);
      action = mixer.play(positionClip('s', 1, 0, 1), { loop: false });
      return { root };
    },
  });
  host.step(2);
  assert.equal(action!.isRunning(), true);
  await host.stop();
  assert.equal(mixer!.isDisposed, true, 'scope dispose released the mixer');
  assert.equal(action!.isRunning(), false, 'action unbound after stop');
});

test('headless: explicit update(dt) drives the mixer without any host', () => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  const handle = new MixerHandle(mesh);
  handle.play(positionClip('h', 1, 0, 2), { loop: false });
  for (let i = 0; i < 30; i += 1) handle.update(DT);
  assert.ok(approx(mesh.position.x, 1, 1e-6));
  handle.dispose();
});
