import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RuntimeSessionHost } from '../../src/creative/core/host.ts';
import type { SceneContext, SceneInstance } from '../../src/creative/core/context.ts';
import type { PhysicsWorld } from '../../src/creative/physics/world.ts';
import { installPhysics } from '../../src/creative/physics/world.ts';

function makeModule(captured: { world: PhysicsWorld | null }, boxRoot: THREE.Object3D) {
  return {
    async create(ctx: SceneContext): Promise<SceneInstance> {
      const world = await installPhysics(ctx);
      captured.world = world;
      world.addBody(
        'crate',
        { shape: { kind: 'box', halfExtents: [0.3, 0.3, 0.3] }, body: 'dynamic' },
        { position: [0, 5, 0] },
        { object: boxRoot },
      );
      world.addBody(
        'ground',
        { shape: { kind: 'box', halfExtents: [5, 0.5, 5] }, body: 'static' },
        { position: [0, -0.5, 0] },
      );
      return { root: new THREE.Object3D() };
    },
  };
}

test('installPhysics: the host physics phase steps the world; stop() disposes it via scope', async () => {
  const captured: { world: PhysicsWorld | null } = { world: null };
  const boxRoot = new THREE.Object3D();
  const host = new RuntimeSessionHost({
    experienceDigest: 'test-digest',
    buildId: 'test-build',
    mode: 'controlled',
    fixedDt: 1 / 60,
  });
  await host.start(makeModule(captured, boxRoot));
  assert.ok(captured.world, 'module create installed the physics world');

  // Physics only advances through host.step() — the physics phase hook.
  assert.equal(boxRoot.position.y, 0, 'no step yet, no write-back');
  host.step(30);
  assert.ok(boxRoot.position.y < 4.9, `crate fell during host steps (y=${boxRoot.position.y})`);
  assert.equal(host.currentStatus, 'running');
  assert.equal(host.diagnosticsLog.length, 0);

  const session = host.query({ kind: 'session' });
  assert.equal(session.ok, true);

  await host.stop();
  assert.equal(captured.world!.disposedWorld, true, 'scope.dispose freed the Rapier world');
  assert.throws(() => captured.world!.step(1 / 60));
});

test('installPhysics: physics errors surface as session diagnostics with phase', async () => {
  const host = new RuntimeSessionHost({
    experienceDigest: 'test-digest',
    buildId: 'test-build',
    mode: 'controlled',
    fixedDt: 1 / 60,
  });
  await host.start({
    async create(ctx: SceneContext): Promise<SceneInstance> {
      const world = await installPhysics(ctx);
      world.addBody('falling-crate', { shape: { kind: 'box', halfExtents: [1, 1, 1] }, body: 'dynamic' }, { position: [0, 10, 0] });
      ctx.onPhase('physics', () => {
        throw new Error('boom in physics hook');
      });
      return { root: new THREE.Object3D() };
    },
  });
  host.step(1);
  assert.equal(host.currentStatus, 'error');
  const diag = host.diagnosticsLog.find((d) => d.message.includes('boom in physics hook'));
  assert.ok(diag, 'physics-phase failure is captured');
  assert.equal(diag!.phase, 'physics');
  await host.stop();
});
