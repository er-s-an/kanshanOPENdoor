import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createPerception, distanceBetween, inRange, lineOfSight } from '../../src/creative/ai/perception.ts';
import type { RaycastFn } from '../../src/creative/ai/perception.ts';
import type { Vec3 } from '../../src/creative/core/spatial.ts';
import type { PhysicsWorld } from '../../src/creative/physics/world.ts';
import { createPhysicsWorld } from '../../src/creative/physics/world.ts';
import { wallWithOpening } from '../../src/creative/scene/helpers.ts';

interface FakeBlocker {
  bodyId: string;
  /** Distance from the ray origin at which this blocker sits. */
  atDistance: number;
}

/** Fake raycast: reports the nearest blocker within maxDistance, else null. */
function fakeRaycast(blockers: FakeBlocker[]): RaycastFn {
  return (origin, _dir, maxDistance = 1000) => {
    let nearest: FakeBlocker | null = null;
    for (const b of blockers) {
      if (b.atDistance <= maxDistance && (nearest === null || b.atDistance < nearest.atDistance)) nearest = b;
    }
    if (!nearest) return null;
    return {
      bodyId: nearest.bodyId,
      colliderHandle: 0,
      distance: nearest.atDistance,
      point: [origin[0], origin[1], origin[2]],
      normal: [0, 0, 1],
    };
  };
}

test('perception: clear LOS with no blockers; blocked with blocker id and distance', () => {
  const clear = lineOfSight(fakeRaycast([]), [0, 0, 0], [0, 0, -10]);
  assert.deepEqual(clear, { clear: true });

  const blocked = lineOfSight(fakeRaycast([{ bodyId: 'wall', atDistance: 4 }]), [0, 0, 0], [0, 0, -10]);
  assert.equal(blocked.clear, false);
  assert.equal(blocked.blockingBodyId, 'wall');
  assert.equal(blocked.hitDistance, 4);
});

test('perception: a blocker beyond the target does not block; hits near the target do', () => {
  // Blocker sits at distance 12 while the target is at 10: the ray (max 10) never reaches it.
  const beyond = lineOfSight(fakeRaycast([{ bodyId: 'behind', atDistance: 12 }]), [0, 0, 0], [0, 0, -10]);
  assert.equal(beyond.clear, true);

  const close = lineOfSight(fakeRaycast([{ bodyId: 'pillar', atDistance: 9.5 }]), [0, 0, 0], [0, 0, -10]);
  assert.equal(close.clear, false);
  assert.equal(close.blockingBodyId, 'pillar');
});

test('perception: maxDistance caps the ray — blockers beyond the cap are ignored', () => {
  const raycast = fakeRaycast([{ bodyId: 'far-wall', atDistance: 8 }]);
  const blocked = lineOfSight(raycast, [0, 0, 0], [0, 0, -10]);
  assert.equal(blocked.clear, false, 'within the segment: blocks');
  const capped = lineOfSight(raycast, [0, 0, 0], [0, 0, -10], { maxDistance: 5 });
  assert.equal(capped.clear, true, 'beyond the 5m cap: ignored');
});

test('perception: eyeOffset/targetOffset move the segment endpoints', () => {
  // A crate occupies low heights only (y < 3 at 2m out): ground-level rays hit
  // it, eye-level rays pass above. Height-aware fake honoring origin/dir.
  const crateRay: RaycastFn = (origin, dir, maxDistance = 1000) => {
    const yAtHit = origin[1] + dir[1] * 2;
    if (2 <= maxDistance && yAtHit < 3) {
      return { bodyId: 'crate', colliderHandle: 0, distance: 2, point: [0, yAtHit, 0], normal: [0, 0, 1] };
    }
    return null;
  };
  const low = lineOfSight(crateRay, [0, 0, 0], [0, 0, -10], { eyeOffset: [0, 0, 0] });
  assert.equal(low.clear, false);
  const high = lineOfSight(crateRay, [0, 0, 0], [0, 0, -10], { eyeOffset: [0, 5, 0] });
  assert.equal(high.clear, true);
});

test('perception: zero-length segment is trivially clear', () => {
  const result = lineOfSight(fakeRaycast([{ bodyId: 'x', atDistance: 0.5 }]), [1, 2, 3], [1, 2, 3]);
  assert.equal(result.clear, true);
});

test('perception: range checks and canPerceive combine range + LOS', () => {
  assert.equal(inRange([0, 0, 0], [3, 4, 0], 5), true);
  assert.equal(inRange([0, 0, 0], [3, 4, 0], 4.99), false);
  assert.equal(distanceBetween([0, 0, 0], [3, 4, 0]), 5);

  const perception = createPerception(fakeRaycast([{ bodyId: 'wall', atDistance: 2 }]), { eyeOffset: [0, 1.6, 0] });
  const far = perception.canPerceive([0, 0, 0], [0, 0, -10], 5);
  assert.equal(far.perceived, false);
  assert.equal(far.inRange, false, 'beyond range');
  assert.equal(far.lineOfSight, false, 'blocked by the wall');

  const near = perception.canPerceive([0, 0, 0], [0, 0, -4], 5);
  assert.equal(near.perceived, false, 'in range but occluded');
  assert.equal(near.inRange, true);
  assert.equal(near.blockingBodyId, 'wall');

  const clear = createPerception(fakeRaycast([])).canPerceive([0, 0, 0], [0, 0, -4], 5);
  assert.equal(clear.perceived, true);
  assert.equal(clear.distance, 4);
});

test('perception: the injected raycast receives origin, normalized dir and segment length', () => {
  const calls: { origin: Vec3; dir: Vec3; max: number }[] = [];
  const spy: RaycastFn = (origin, dir, maxDistance) => {
    calls.push({ origin: [...origin] as Vec3, dir: [...dir] as Vec3, max: maxDistance ?? -1 });
    return null;
  };
  lineOfSight(spy, [0, 0, 0], [0, 0, -6]);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].origin, [0, 0, 0]);
  assert.ok(Math.abs(calls[0].dir[2] + 1) < 1e-9, 'direction normalized toward the target');
  assert.equal(calls[0].max, 6, 'maxDistance is the segment length');
});

// ---------------------------------------------------------------------------
// Integration: REAL PhysicsWorld raycast against wallWithOpening colliders
// ---------------------------------------------------------------------------

let world: PhysicsWorld;

function addWall(build: ReturnType<typeof wallWithOpening>, prefix: string): void {
  const p = build.object.position;
  build.colliders.forEach((desc, i) => {
    world.addBody(`${prefix}:${i}`, desc, {
      position: [p.x, p.y, p.z],
      quaternion: [0, Math.sin(build.object.rotation.y / 2), 0, Math.cos(build.object.rotation.y / 2)],
    });
  });
}

before(async () => {
  world = await createPhysicsWorld();
  // Wall along X at z=0 with a door opening: x in 0..1, y in 0..2.1.
  addWall(
    wallWithOpening({
      length: 4,
      height: 3,
      thickness: 0.2,
      opening: { kind: 'door', width: 1, height: 2.1, offsetX: 0.5 },
    }),
    'wall',
  );
  world.step(1 / 60); // Rapier updates the query pipeline during step()
});

test('perception (real physics): LOS blocked by solid wall, clear through the opening', () => {
  const raycast: RaycastFn = (o, d, m, q) => world.raycast(o, d, m, q);

  // Through the door rect: from z=+5 to z=-5 at x=0.5, y=1.05 -> clear.
  const throughDoor = lineOfSight(raycast, [0.5, 1.05, 5], [0.5, 1.05, -5]);
  assert.equal(throughDoor.clear, true, 'the ray passes through the opening');

  // Into the solid left part of the same wall: blocked, and the blocker is a wall body.
  const blocked = lineOfSight(raycast, [-1.5, 1.5, 5], [-1.5, 1.5, -5]);
  assert.equal(blocked.clear, false);
  assert.ok(blocked.blockingBodyId?.startsWith('wall:'), `blocker should be a wall body, got ${blocked.blockingBodyId}`);
  assert.ok(blocked.hitDistance !== undefined && blocked.hitDistance < 5, 'hit lands in front of the wall face z=0.1');

  // Into the lintel above the opening: blocked.
  const lintel = lineOfSight(raycast, [0.5, 2.6, 5], [0.5, 2.6, -5]);
  assert.equal(lintel.clear, false);
});

test('perception (real physics): canPerceive through the door; blocked target is not perceived', () => {
  const perception = createPerception((o, d, m, q) => world.raycast(o, d, m, q));
  const seen = perception.canPerceive([0.5, 1.05, 3], [0.5, 1.05, -3], 20);
  assert.equal(seen.perceived, true);
  assert.equal(seen.lineOfSight, true);

  const hidden = perception.canPerceive([-1.5, 1.5, 3], [-1.5, 1.5, -3], 20);
  assert.equal(hidden.perceived, false);
  assert.equal(hidden.inRange, true, 'range is fine; occlusion is the failure');
  assert.equal(hidden.lineOfSight, false);
});
