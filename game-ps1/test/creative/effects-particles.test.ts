import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Scope } from '../../src/creative/core/scope.ts';
import { ParticleEmitter } from '../../src/creative/effects/index.ts';

const HALF = () => 0.5; // deterministic RNG

function makeEmitter(opts: Partial<ConstructorParameters<typeof ParticleEmitter>[0]> = {}) {
  const scope = new Scope();
  const emitter = new ParticleEmitter({
    scope,
    maxParticles: 64,
    random: HALF,
    ...opts,
  });
  return { scope, emitter };
}

// GPU rasterisation is NOT_MEASURED here; these tests assert CPU particle
// state, buffer contents and dispose behaviour with real THREE objects.

test('emitter: spawns at rate scaled by sim dt', () => {
  const { emitter } = makeEmitter({ rate: 10, lifetime: 100 });
  for (let i = 0; i < 10; i += 1) emitter.update(0.1); // 1.0s total
  assert.equal(emitter.aliveCount, 10);
  assert.equal(emitter.totalSpawned, 10);
});

test('emitter: maxParticles cap is a hard bound; excess emission is dropped', () => {
  const { emitter } = makeEmitter({ rate: 100000, lifetime: 1000, maxParticles: 8 });
  for (let i = 0; i < 10; i += 1) emitter.update(0.1);
  assert.equal(emitter.aliveCount, 8);
  assert.equal(emitter.totalSpawned, 8);
  assert.equal(emitter.object.geometry.drawRange.count, 8);
});

test('emitter: dead particles are recycled; buffers stay bounded', () => {
  const { emitter } = makeEmitter({ rate: 100, lifetime: 0.5, maxParticles: 16 });
  emitter.update(0.1); // 10 spawned
  assert.equal(emitter.aliveCount, 10);
  emitter.setRate(0); // stop emission; the live ones expire at age 0.5
  for (let i = 0; i < 5; i += 1) emitter.update(0.1);
  assert.equal(emitter.aliveCount, 0);
  assert.equal(emitter.totalSpawned, 10); // counters keep history
  assert.equal(emitter.object.geometry.drawRange.count, 0);

  const spawned = emitter.burst(6); // pool is reusable
  assert.equal(spawned, 6);
  assert.equal(emitter.aliveCount, 6);
});

test('emitter: cone + gravity integrate per sim step (deterministic with fixed rng)', () => {
  const { emitter } = makeEmitter({
    rate: 0,
    lifetime: 10,
    speed: { min: 2, max: 4 }, // fixed rng -> 3
    cone: { axis: [0, 1, 0], angle: 0 },
    gravity: [0, -10, 0],
  });
  emitter.burst(1);
  emitter.update(0.1);
  const p = emitter.inspect(0);
  // Semi-implicit Euler: v = 3 - 10*0.1 = 2; y = v*dt = 0.2 (float32 buffers).
  assert.ok(Math.abs(p.velocity[1] - 2) < 1e-6);
  assert.ok(Math.abs(p.position[1] - 0.2) < 1e-6);
  assert.ok(Math.abs(p.position[0]) < 1e-6);
  assert.ok(Math.abs(p.position[2]) < 1e-6);
});

test('emitter: size and color lerp over life', () => {
  const { emitter } = makeEmitter({
    rate: 0,
    lifetime: 2, // fixed rng -> exactly 2
    size: { start: 1, end: 0.3 },
    color: { start: 0xffffff, end: 0x000000 },
  });
  emitter.burst(1);
  emitter.update(1); // half life
  const p = emitter.inspect(0);
  assert.ok(Math.abs(p.size - 0.65) < 1e-6);
  assert.ok(Math.abs(p.color[0] - 0.5) < 1e-4);
  assert.ok(Math.abs(p.color[1] - 0.5) < 1e-4);
});

test('emitter: reduce-motion halves or stops emission', () => {
  const full = makeEmitter({ rate: 10, lifetime: 100 });
  for (let i = 0; i < 10; i += 1) full.emitter.update(0.1);
  assert.equal(full.emitter.aliveCount, 10);

  const halved = makeEmitter({ rate: 10, lifetime: 100, reduceMotion: true });
  for (let i = 0; i < 10; i += 1) halved.emitter.update(0.1);
  assert.equal(halved.emitter.aliveCount, 5);

  const stopped = makeEmitter({ rate: 10, lifetime: 100, reduceMotion: true, reduceMotionEmission: 'stop' });
  for (let i = 0; i < 10; i += 1) stopped.emitter.update(0.1);
  assert.equal(stopped.emitter.aliveCount, 0);

  halved.emitter.setReduceMotion(false);
  for (let i = 0; i < 10; i += 1) halved.emitter.update(0.1);
  assert.equal(halved.emitter.aliveCount, 15); // 5 halved + 10 full-rate
});

test('emitter: scope dispose tears down geometry/material and freezes updates', () => {
  const { scope, emitter } = makeEmitter({ rate: 10, lifetime: 100 });
  let disposedResources = 0;
  emitter.object.geometry.addEventListener('dispose', () => {
    disposedResources += 1;
  });

  scope.dispose();
  assert.equal(emitter.isDisposed, true);
  assert.equal(disposedResources, 1);
  assert.equal(emitter.object.geometry.drawRange.count, 0);

  emitter.update(0.1); // no-op after dispose
  assert.equal(emitter.aliveCount, 0);
});

test('emitter: invalid config rejected at authoring time', () => {
  assert.throws(() => makeEmitter({ maxParticles: 0 }));
  assert.throws(() => makeEmitter({ cone: { axis: [0, 0, 0], angle: 1 } }));
  assert.throws(() => makeEmitter({ rate: 1, lifetime: 1 }).emitter.update(-1));
});

test('emitter: object is a Points with shader attributes, parentable to a scene', () => {
  const { emitter } = makeEmitter();
  assert.ok(emitter.object instanceof THREE.Points);
  assert.ok(emitter.object.material instanceof THREE.ShaderMaterial);
  const attrs = emitter.object.geometry.attributes;
  assert.ok(attrs.position instanceof THREE.BufferAttribute);
  assert.ok(attrs.pcolor instanceof THREE.BufferAttribute);
  assert.ok(attrs.psize instanceof THREE.BufferAttribute);
  assert.equal(emitter.object.frustumCulled, false);

  const scene = new THREE.Scene();
  scene.add(emitter.object);
  assert.equal(scene.children.includes(emitter.object), true);
});
