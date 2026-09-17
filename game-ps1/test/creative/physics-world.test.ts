import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Scope } from '../../src/creative/core/scope.ts';
import { CreativeError } from '../../src/creative/core/errors.ts';
import type { PhysicsWorld } from '../../src/creative/physics/world.ts';
import { createPhysicsWorld } from '../../src/creative/physics/world.ts';

let world: PhysicsWorld;

before(async () => {
  world = await createPhysicsWorld();
});

const DT = 1 / 60;

test('addBody: static, kinematic, dynamic and sensor bodies from ColliderDesc + explicit transform', () => {
  const staticBody = world.addBody(
    'ground',
    { shape: { kind: 'box', halfExtents: [5, 0.5, 5] }, body: 'static' },
    { position: [0, -0.5, 0], quaternion: [0, 0, 0, 1] },
  );
  assert.equal(staticBody.kind, 'static');
  assert.equal(staticBody.group, 'default');

  const kinematicBody = world.addBody(
    'lift',
    { shape: { kind: 'cylinder', halfHeight: 0.1, radius: 1 }, body: 'kinematic' },
    { position: [0, 0.1, 0] },
  );
  assert.equal(kinematicBody.kind, 'kinematic');

  const dynamicBody = world.addBody(
    'crate',
    { shape: { kind: 'sphere', radius: 0.3 }, body: 'dynamic' },
    { position: [0, 3, 0] },
  );
  assert.equal(dynamicBody.kind, 'dynamic');

  const zone = world.addBody(
    'zone',
    { shape: { kind: 'box', halfExtents: [1, 1, 1] }, body: 'static', sensor: true },
    { position: [10, 0, 0] },
  );
  assert.equal(zone.sensor, true);

  assert.ok(world.listColliders().length >= 4);
});

test('addBody: collider offset and convex hull shapes are supported', () => {
  const offset = world.addBody(
    'offset-box',
    { shape: { kind: 'box', halfExtents: [0.5, 0.5, 0.5], offset: [0, 2, 0] }, body: 'static' },
    { position: [20, 0, 0] },
  );
  assert.equal(offset.kind, 'static');
  world.step(DT); // the query pipeline updates during step
  const hit = world.raycast([20, 5, 0], [0, -1, 0], 10);
  assert.equal(hit?.bodyId, 'offset-box');
  assert.ok(Math.abs(hit!.point[1] - 2.5) < 1e-3, 'hit accounts for the collider offset');

  const hull = world.addBody(
    'hull',
    {
      shape: {
        kind: 'convex',
        points: [
          [0, 0, 0],
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 1],
        ],
      },
      body: 'dynamic',
    },
    { position: [30, 3, 0] },
  );
  assert.equal(hull.kind, 'dynamic');
});

test('addBody: duplicate id rejects with DUPLICATE_BODY', () => {
  assert.throws(
    () => world.addBody('crate', { shape: { kind: 'sphere', radius: 0.1 }, body: 'dynamic' }, { position: [0, 0, 0] }),
    (err: unknown) => err instanceof CreativeError && err.code === 'DUPLICATE_BODY',
  );
});

test('addBody: dynamic trimesh rejects with an honest OUT_OF_SCOPE diagnostic', () => {
  assert.throws(
    () =>
      world.addBody(
        'concave-dyn',
        {
          shape: {
            kind: 'trimesh',
            vertices: [
              [0, 0, 0],
              [1, 0, 0],
              [0, 1, 0],
            ],
            indices: [[0, 1, 2]],
          },
          body: 'dynamic',
        },
        { position: [0, 0, 0] },
      ),
    (err: unknown) => err instanceof CreativeError && err.code === 'OUT_OF_SCOPE',
  );
});

test('addBody: degenerate convex hull rejects with INVALID_COLLIDER', () => {
  assert.throws(
    () =>
      world.addBody(
        'bad-hull',
        { shape: { kind: 'convex', points: [[0, 0, 0], [1, 0, 0]] }, body: 'dynamic' },
        { position: [0, 0, 0] },
      ),
    (err: unknown) => err instanceof CreativeError && err.code === 'INVALID_COLLIDER',
  );
});

test('group labels map to distinct lazily-allocated bit masks', () => {
  const before = world.groupLabels();
  world.addBody('red-1', { shape: { kind: 'box', halfExtents: [0.5, 0.5, 0.5] }, body: 'static', group: 'red' }, { position: [40, 0, 0] });
  world.addBody('blue-1', { shape: { kind: 'box', halfExtents: [0.5, 0.5, 0.5] }, body: 'static', group: 'blue' }, { position: [42, 0, 0] });
  const labels = world.groupLabels();
  assert.equal(labels.length, before.length + 2);
  assert.notEqual(labels.indexOf('red'), labels.indexOf('blue'));
  // querying with an unseen label auto-allocates instead of crashing
  world.step(DT); // the query pipeline updates during step
  const hit = world.raycast([40, 5, 0], [0, -1, 0], 10, { groups: ['red'] });
  assert.equal(hit?.bodyId, 'red-1');
});

test('step: dynamic body falls under gravity and writes back to its Object3D root (physics authority)', () => {
  const root = new THREE.Object3D();
  world.addBody(
    'falling',
    { shape: { kind: 'box', halfExtents: [0.3, 0.3, 0.3] }, body: 'dynamic' },
    { position: [0, 6, 0] },
    { object: root },
  );
  for (let i = 0; i < 30; i += 1) world.step(DT);
  assert.ok(root.position.y < 5.5, `dynamic root should have fallen, got y=${root.position.y}`);
  const recordY = world.listColliders().find((c) => c.bodyId === 'falling')!.position[1];
  assert.ok(Math.abs(recordY - root.position.y) < 1e-6, 'mesh write-back matches the rigid body exactly');
});

test('step: kinematic body is driven from mechanism code, never writes back to a mesh', () => {
  const root = new THREE.Object3D();
  world.addBody(
    'kin-mesh',
    { shape: { kind: 'box', halfExtents: [0.5, 0.5, 0.5] }, body: 'kinematic' },
    { position: [50, 0, 0] },
    { object: root },
  );
  world.setKinematicTarget('kin-mesh', [51, 0, 0]);
  world.step(DT);
  const info = world.listColliders().find((c) => c.bodyId === 'kin-mesh')!;
  assert.ok(Math.abs(info.position[0] - 51) < 1e-6, 'kinematic body moved to the mechanism target');
  assert.equal(root.position.x, 0, 'kinematic bodies never sync to meshes: the mechanism owns the render pose');
});

test('step: static bodies never sync', () => {
  const root = new THREE.Object3D();
  world.addBody(
    'static-mesh',
    { shape: { kind: 'box', halfExtents: [0.5, 0.5, 0.5] }, body: 'static' },
    { position: [60, 0, 0] },
    { object: root },
  );
  for (let i = 0; i < 5; i += 1) world.step(DT);
  assert.deepEqual(root.position.toArray(), [0, 0, 0]);
});

test('hide semantics: visible=false never disables collision; only removeBody does', () => {
  const root = new THREE.Object3D();
  world.addBody(
    'hidden-but-solid',
    { shape: { kind: 'box', halfExtents: [0.5, 0.5, 0.5] }, body: 'static' },
    { position: [70, 0, 0] },
    { object: root },
  );
  root.visible = false;
  world.step(DT);
  const stillHits = world.raycast([70, 5, 0], [0, -1, 0], 10);
  assert.equal(stillHits?.bodyId, 'hidden-but-solid', 'invisible mesh still collides');
  assert.equal(world.removeBody('hidden-but-solid'), true);
  const afterRemove = world.raycast([70, 5, 0], [0, -1, 0], 10);
  assert.equal(afterRemove, null, 'removed body no longer collides');
  assert.equal(world.removeBody('hidden-but-solid'), false, 'removing twice is a no-op');
});

test('kinematicDelta reports the actual per-step displacement (platform carry input)', () => {
  world.addBody(
    'mover',
    { shape: { kind: 'box', halfExtents: [0.5, 0.1, 0.5] }, body: 'kinematic' },
    { position: [80, 0, 0] },
  );
  assert.deepEqual(world.kinematicDelta('mover'), [0, 0, 0]);
  world.setKinematicTarget('mover', [80.5, 0, 0]);
  world.step(DT);
  const d = world.kinematicDelta('mover');
  assert.ok(Math.abs(d[0] - 0.5) < 1e-6, `expected 0.5 x-displacement, got ${d[0]}`);
  assert.throws(() => world.kinematicDelta('nope'), (err: unknown) => err instanceof CreativeError && err.code === 'UNKNOWN_BODY');
});

test('beforeStep hooks run before each world step and are unregisterable', () => {
  world.addBody(
    'hook-body',
    { shape: { kind: 'box', halfExtents: [0.2, 0.2, 0.2] }, body: 'kinematic' },
    { position: [90, 0, 0] },
  );
  let calls = 0;
  const unregister = world.beforeStep((dt) => {
    calls += 1;
    world.setKinematicTarget('hook-body', [90 + calls * 0.1, 0, 0]);
    assert.equal(dt, DT);
  });
  world.step(DT);
  world.step(DT);
  assert.equal(calls, 2);
  unregister();
  world.step(DT);
  assert.equal(calls, 2);
  const info = world.listColliders().find((c) => c.bodyId === 'hook-body')!;
  assert.ok(Math.abs(info.position[0] - 90.2) < 1e-4, `hook-body rests at the last target, got ${info.position[0]}`);
});

test('step rejects non-positive dt', () => {
  assert.throws(() => world.step(0), (err: unknown) => err instanceof CreativeError && err.code === 'BAD_TIMESTEP');
});

test('debug listings are bounded', () => {
  const all = world.listColliders();
  const capped = world.listColliders(3);
  assert.equal(capped.length, 3);
  assert.ok(all.length > 3);
});

test('contacts lists touching pairs (bounded)', async () => {
  // Self-contained: other tests in this file leave falling bodies that would
  // land on the crate and disturb the resting contact.
  const w = await createPhysicsWorld();
  w.addBody('ground', { shape: { kind: 'box', halfExtents: [5, 0.5, 5] }, body: 'static' }, { position: [0, -0.5, 0] });
  w.addBody('crate', { shape: { kind: 'sphere', radius: 0.3 }, body: 'dynamic' }, { position: [0, 2, 0] });
  for (let i = 0; i < 120; i += 1) w.step(DT);
  const contacts = w.contacts();
  assert.ok(
    contacts.some((c) => (c.a === 'crate' && c.b === 'ground') || (c.a === 'ground' && c.b === 'crate')),
    'resting dynamic body reports a contact with the ground',
  );
  w.dispose();
});

test('dispose frees the Rapier world; every op rejects afterwards; dispose is idempotent', async () => {
  const w = await createPhysicsWorld();
  w.addBody('d1', { shape: { kind: 'box', halfExtents: [0.5, 0.5, 0.5] }, body: 'static' }, { position: [0, 0, 0] });
  w.step(DT);
  w.dispose();
  assert.equal(w.disposedWorld, true);
  const rejects = (fn: () => unknown, code: string) => {
    try {
      fn();
    } catch (err) {
      assert.ok(err instanceof CreativeError, `expected CreativeError, got ${err}`);
      assert.equal((err as CreativeError).code, code);
      return;
    }
    assert.fail(`expected ${code}`);
  };
  rejects(() => w.step(DT), 'PHYSICS_DISPOSED');
  rejects(() => w.addBody('d2', { shape: { kind: 'box', halfExtents: [1, 1, 1] }, body: 'static' }, { position: [0, 0, 0] }), 'PHYSICS_DISPOSED');
  rejects(() => w.raycast([0, 5, 0], [0, -1, 0]), 'PHYSICS_DISPOSED');
  rejects(() => w.createCharacterController(0.01), 'PHYSICS_DISPOSED');
  rejects(() => w.listColliders(), 'PHYSICS_DISPOSED');
  w.dispose(); // idempotent, no throw
});

test('scope integration: ctx.scope.own disposes the world with the scope', async () => {
  const scoped = await createPhysicsWorld();
  const scope = new Scope();
  scope.own(scoped);
  assert.equal(scoped.disposedWorld, false);
  scope.dispose();
  assert.equal(scoped.disposedWorld, true);
  assert.throws(() => scoped.step(DT), (err: unknown) => err instanceof CreativeError && err.code === 'PHYSICS_DISPOSED');
  scope.dispose(); // idempotent
});
