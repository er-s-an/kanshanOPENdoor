import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import type { PhysicsWorld } from '../../src/creative/physics/world.ts';
import { createPhysicsWorld } from '../../src/creative/physics/world.ts';

let world: PhysicsWorld;

function colliderHandleOf(bodyId: string): number {
  return world.listColliders().find((c) => c.bodyId === bodyId)!.colliderHandle;
}

before(async () => {
  world = await createPhysicsWorld();
  world.addBody(
    'near',
    { shape: { kind: 'box', halfExtents: [0.5, 0.5, 0.5] }, body: 'static', group: 'red' },
    { position: [2, 0, 0] },
  );
  world.addBody(
    'far',
    { shape: { kind: 'box', halfExtents: [0.5, 0.5, 0.5] }, body: 'static', group: 'blue' },
    { position: [4, 0, 0] },
  );
  world.addBody(
    'wall',
    { shape: { kind: 'box', halfExtents: [0.5, 1, 2] }, body: 'static' },
    { position: [3, 0, 10] },
  );
  world.step(1 / 60);
});

test('raycast: nearest hit wins and reports distance/point/normal', () => {
  const hit = world.raycast([0, 0, 0], [1, 0, 0], 10);
  assert.ok(hit);
  assert.equal(hit.bodyId, 'near');
  assert.ok(Math.abs(hit.distance - 1.5) < 1e-4, `distance ~1.5, got ${hit.distance}`);
  assert.ok(Math.abs(hit.point[0] - 1.5) < 1e-4);
  assert.ok(hit.normal[0] < -0.99, 'normal faces the ray origin');
});

test('raycast: unnormalized direction is normalized by the adapter', () => {
  const hit = world.raycast([0, 0, 0], [10, 0, 0], 10);
  assert.equal(hit?.bodyId, 'near');
});

test('raycast: self-exclusion by body id falls through to the next hit', () => {
  const hit = world.raycast([0, 0, 0], [1, 0, 0], 10, { excludeBody: 'near' });
  assert.ok(hit);
  assert.equal(hit.bodyId, 'far');
  assert.ok(Math.abs(hit.distance - 3.5) < 1e-4);
});

test('raycast: self-exclusion by collider handle', () => {
  const nearHandle = colliderHandleOf('near');
  const farHandle = colliderHandleOf('far');
  const miss = world.raycast([0, 0, 0], [1, 0, 0], 10, { excludeColliderHandle: -1 });
  assert.equal(miss?.bodyId, 'near', 'a handle that matches nothing excludes nothing');
  const excluded = world.raycast([0, 0, 0], [1, 0, 0], 10, { excludeColliderHandle: nearHandle });
  assert.equal(excluded?.bodyId, 'far');
  const onlyFarExcluded = world.raycast([4, 0, 0], [1, 0, 0], 10, { excludeColliderHandle: farHandle });
  assert.equal(onlyFarExcluded, null, 'excluding the only hittable face yields no hit');
});

test('raycast: group filters select bodies by label', () => {
  const red = world.raycast([0, 0, 0], [1, 0, 0], 10, { groups: ['red'] });
  assert.equal(red?.bodyId, 'near');
  const blue = world.raycast([0, 0, 0], [1, 0, 0], 10, { groups: ['blue'] });
  assert.equal(blue?.bodyId, 'far');
  const green = world.raycast([0, 0, 0], [1, 0, 0], 10, { groups: ['green'] });
  assert.equal(green, null, 'no colliders carry the green label');
});

test('raycast: maxDist and empty space produce null (negative)', () => {
  assert.equal(world.raycast([0, 0, 0], [1, 0, 0], 1), null, 'nearest face at 1.5 is beyond maxDist 1');
  assert.equal(world.raycast([0, 50, 0], [1, 0, 0], 10), null);
  assert.equal(world.raycast([0, 0, 0], [0, 0, -1], 10), null, 'nothing behind the origin');
});

test('raycast: a removed body no longer hits', () => {
  assert.equal(world.removeBody('near'), true);
  const hit = world.raycast([0, 0, 0], [1, 0, 0], 10);
  assert.equal(hit?.bodyId, 'far', 'the removed collider is gone; the ray reaches the far box');
  assert.equal(world.removeBody('far'), true);
  assert.equal(world.raycast([0, 0, 0], [1, 0, 0], 10), null);
});

test('castShape: sweeping a sphere into a wall reports the impact distance', () => {
  const hit = world.castShape({ kind: 'sphere', radius: 0.25 }, [3, 0, 0], undefined, [0, 0, 3], 10);
  assert.ok(hit);
  assert.equal(hit.bodyId, 'wall');
  // wall face sits at z=8 (center 10, half depth 2); sphere radius 0.25
  assert.ok(Math.abs(hit.distance - (8 - 0.25)) < 1e-3, `distance ~7.75, got ${hit.distance}`);
  assert.ok(hit.normal[2] < -0.99, 'normal opposes the sweep direction');
});

test('castShape: sweeping away from or excluding the wall yields null (negative)', () => {
  assert.equal(world.castShape({ kind: 'sphere', radius: 0.25 }, [3, 0, 0], undefined, [0, 0, -3], 10), null);
  assert.equal(
    world.castShape({ kind: 'sphere', radius: 0.25 }, [3, 0, 0], undefined, [0, 0, 3], 10, { excludeBody: 'wall' }),
    null,
  );
});

test('castShape: box and cylinder shapes sweep too', () => {
  const boxHit = world.castShape({ kind: 'box', halfExtents: [0.2, 0.2, 0.2] }, [3, 0, 0], undefined, [0, 0, 4], 10);
  assert.equal(boxHit?.bodyId, 'wall');
  const cylHit = world.castShape(
    { kind: 'cylinder', halfHeight: 0.3, radius: 0.2 },
    [3, 0.4, 0],
    undefined,
    [0, 0, 4],
    10,
  );
  assert.equal(cylHit?.bodyId, 'wall');
});

test('overlap: sphere query returns the bodies it covers', () => {
  world.addBody('apple', { shape: { kind: 'sphere', radius: 0.3 }, body: 'static' }, { position: [0, 0.4, 20] });
  world.addBody('pear', { shape: { kind: 'sphere', radius: 0.3 }, body: 'static', group: 'fruit' }, { position: [0.5, 0.4, 20] });
  world.addBody('stone', { shape: { kind: 'sphere', radius: 0.3 }, body: 'static' }, { position: [5, 0.4, 20] });
  world.step(1 / 60);
  const ids = world.overlap({ kind: 'sphere', radius: 1 }, [0, 0.4, 20], undefined);
  assert.ok(ids.includes('apple'));
  assert.ok(ids.includes('pear'));
  assert.ok(!ids.includes('stone'), 'stone is outside the query sphere');
});

test('overlap: negative — empty space returns nothing', () => {
  assert.deepEqual(world.overlap({ kind: 'sphere', radius: 0.5 }, [50, 50, 50], undefined), []);
});

test('overlap: group filter and result bound', () => {
  const fruits = world.overlap({ kind: 'sphere', radius: 2 }, [0, 0.4, 20], undefined, { groups: ['fruit'] });
  assert.deepEqual(fruits, ['pear']);
  const capped = world.overlap({ kind: 'sphere', radius: 100 }, [0, 0, 0], undefined, undefined, 2);
  assert.ok(capped.length <= 2, 'limit is respected');
});
