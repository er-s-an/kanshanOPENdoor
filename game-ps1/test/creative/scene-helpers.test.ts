import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  faceToward,
  floorPolygon,
  placeOnFloorY,
  wallRun,
  wallSegment,
  wallWithOpening,
  type SceneBuild,
} from '../../src/creative/scene/helpers.ts';
import type { BoxColliderDesc, ColliderDesc } from '../../src/creative/core/spatial.ts';

function boxColliders(colliders: ColliderDesc[]): BoxColliderDesc[] {
  return colliders.filter((c) => c.shape.kind === 'box').map((c) => c.shape as BoxColliderDesc);
}

function castRay(build: SceneBuild, origin: [number, number, number], dir: [number, number, number]): THREE.Intersection[] {
  // The host render loop normally keeps matrices current; a fresh build in a
  // test does not, and Raycaster reads matrixWorld without updating it.
  build.object.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(new THREE.Vector3(...origin), new THREE.Vector3(...dir).normalize());
  return ray.intersectObject(build.object, true);
}

test('wallSegment: one box mesh + one matching box collider', () => {
  const wall = wallSegment({ length: 4, height: 3, thickness: 0.2 });
  assert.equal(wall.object.name, 'wall');
  assert.equal(wall.object.children.length, 1);
  const [collider] = wall.colliders;
  assert.equal(collider.body, 'static');
  assert.deepEqual(collider.shape, {
    kind: 'box',
    halfExtents: [2, 1.5, 0.1],
    offset: [0, 1.5, 0],
  });
});

test('wallSegment: position and yaw place the group', () => {
  const wall = wallSegment({ length: 2, height: 2, thickness: 0.1, position: [5, 0, -3], yaw: Math.PI / 4 });
  assert.deepEqual(wall.object.position.toArray(), [5, 0, -3]);
  assert.equal(wall.object.rotation.y, Math.PI / 4);
});

test('wallWithOpening (door): side boxes + lintel, never a whole-wall box', () => {
  const wall = wallWithOpening({
    length: 4, height: 3, thickness: 0.2,
    opening: { kind: 'door', width: 1, height: 2.1, offsetX: 0.5 },
  });
  // Wall minus opening: left (x -2..0), right (x 1..2), lintel (y 2.1..3). No threshold (sill 0).
  assert.equal(wall.colliders.length, 3);
  const boxes = boxColliders(wall.colliders);
  assert.equal(boxes.length, 3);
  for (const box of boxes) {
    const [hx, hy] = box.halfExtents;
    assert.ok(hx < 2 || hy < 1.5, 'no collider may span the whole wall face');
    assert.equal(box.halfExtents[2], 0.1);
  }
  // Solid volume + opening volume == whole wall volume.
  const solid = boxes.reduce((sum, b) => sum + 8 * b.halfExtents[0] * b.halfExtents[1] * b.halfExtents[2], 0);
  assert.ok(Math.abs(solid + 1 * 2.1 * 0.2 - 4 * 3 * 0.2) < 1e-9);
  // userData records the opening for Studio tools.
  assert.equal(wall.object.userData.opening.kind, 'door');
});

test('wallWithOpening (door): horizontal ray through the opening misses, rays into solid wall hit', () => {
  const wall = wallWithOpening({
    length: 4, height: 3, thickness: 0.2,
    opening: { kind: 'door', width: 1, height: 2.1, offsetX: 0.5 },
  });
  // Through the opening rect (x in 0..1, y in 0..2.1): must miss.
  assert.equal(castRay(wall, [0.5, 1.05, 5], [0, 0, -1]).length, 0);
  // Into the left side box: must hit.
  assert.equal(castRay(wall, [-1.5, 1.5, 5], [0, 0, -1]).length, 1);
  // Into the right side box: must hit.
  assert.equal(castRay(wall, [1.5, 1.05, 5], [0, 0, -1]).length, 1);
  // Through the opening's x range but into the lintel above: must hit.
  assert.equal(castRay(wall, [0.5, 2.6, 5], [0, 0, -1]).length, 1);
});

test('wallWithOpening (window): sill adds a threshold box below the opening', () => {
  const wall = wallWithOpening({
    length: 4, height: 3, thickness: 0.2,
    opening: { kind: 'window', width: 1.2, height: 1, sillHeight: 0.9 },
  });
  assert.equal(wall.colliders.length, 4, 'left + right + lintel + threshold');
  // Ray through the window rect (y 0.9..1.9): miss.
  assert.equal(castRay(wall, [0, 1.4, 5], [0, 0, -1]).length, 0);
  // Same x, but into the threshold (y 0..0.9): hit. (Aim off the face-center
  // diagonal so the two front-face triangles are not both edge-hit.)
  assert.equal(castRay(wall, [0, 0.6, 5], [0, 0, -1]).length, 1);
  // Volume conservation with the sill.
  const boxes = boxColliders(wall.colliders);
  const solid = boxes.reduce((sum, b) => sum + 8 * b.halfExtents[0] * b.halfExtents[1] * b.halfExtents[2], 0);
  assert.ok(Math.abs(solid + 1.2 * 1 * 0.2 - 4 * 3 * 0.2) < 1e-9);
});

test('wallWithOpening: offset opening moves the hole geometrically', () => {
  const wall = wallWithOpening({
    length: 6, height: 2.5, thickness: 0.2,
    opening: { kind: 'custom', width: 1, height: 2, offsetX: 2 },
  });
  // Opening x in 1.5..2.5; left box spans -3..1.5, right 2.5..3.
  assert.equal(castRay(wall, [2, 1, 5], [0, 0, -1]).length, 0);
  assert.equal(castRay(wall, [0, 1, 5], [0, 0, -1]).length, 1);
  assert.equal(castRay(wall, [2, 2.3, 5], [0, 0, -1]).length, 1, 'lintel above offset opening');
});

test('wallWithOpening: rejects openings that exceed the wall', () => {
  assert.throws(
    () => wallWithOpening({ length: 4, height: 3, thickness: 0.2, opening: { kind: 'door', width: 5, height: 2 } }),
    /exceeds the wall horizontally/,
  );
  assert.throws(
    () => wallWithOpening({ length: 4, height: 3, thickness: 0.2, opening: { kind: 'door', width: 1, height: 2, sillHeight: 2.5 } }),
    /exceeds the wall vertically/,
  );
});

test('floorPolygon: mesh area matches the shoelace area, normal faces up', () => {
  // L-shape: 4x2 block + 2x2 block = 12.
  const points: [number, number][] = [[0, 0], [4, 0], [4, 2], [2, 2], [2, 4], [0, 4]];
  const floor = floorPolygon(points, { y: 0.1 });
  assert.equal(floor.object.name, 'floor');
  assert.equal(floor.object.position.y, 0.1);

  const mesh = floor.object.children[0] as THREE.Mesh;
  const geometry = mesh.geometry as THREE.BufferGeometry;
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex()!;
  let area = 0;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < index.count; i += 3) {
    a.fromBufferAttribute(position, index.getX(i));
    b.fromBufferAttribute(position, index.getX(i + 1));
    c.fromBufferAttribute(position, index.getX(i + 2));
    const cross = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    area += cross.length() / 2;
    assert.ok(cross.y > 0, 'all triangles wind so the face points up');
  }
  assert.ok(Math.abs(area - 12) < 1e-9, `triangulated area ${area}`);

  // Collider trimesh comes from the same triangulation.
  const [collider] = floor.colliders;
  assert.equal(collider.body, 'static');
  assert.equal(collider.shape.kind, 'trimesh');
  if (collider.shape.kind === 'trimesh') {
    assert.equal(collider.shape.vertices.length, position.count);
    assert.equal(collider.shape.indices.length * 3, index.count);
  }
});

test('floorPolygon: rays hit inside the polygon and miss outside', () => {
  const points: [number, number][] = [[0, 0], [4, 0], [4, 2], [2, 2], [2, 4], [0, 4]];
  const floor = floorPolygon(points);
  assert.ok(castRay(floor, [1, 5, 1], [0, -1, 0]).length > 0, 'inside the L');
  assert.equal(castRay(floor, [3, 5, 3], [0, -1, 0]).length, 0, 'outside the L notch');
});

test('floorPolygon: rejects degenerate input', () => {
  assert.throws(() => floorPolygon([[0, 0], [1, 1]]), /at least 3 points/);
  assert.throws(() => floorPolygon([[0, 0], [1, 1], [2, 2]]), /degenerate/);
});

test('wallRun (butt): one segment per span, corners shared, runs are continuous', () => {
  const run = wallRun([[0, 0], [4, 0], [4, 3]], { height: 2.6, thickness: 0.22 });
  assert.equal(run.segments.length, 2);
  assert.equal(run.colliders.length, 2);
  assert.equal(run.object.children.length, 2);

  const [s1, s2] = run.segments;
  assert.ok(Math.abs(s1.object.position.x - 2) < 1e-12 && Math.abs(s1.object.position.z) < 1e-12);
  assert.ok(Math.abs(s1.object.rotation.y) < 1e-12);
  assert.ok(Math.abs(s2.object.position.x - 4) < 1e-12 && Math.abs(s2.object.position.z - 1.5) < 1e-12);
  assert.ok(Math.abs(s2.object.rotation.y - (-Math.PI / 2)) < 1e-12);

  // Segment world ends meet exactly at the corner (butt join, no overshoot).
  const end1 = new THREE.Vector3(2, 0, 0).add(new THREE.Vector3(2, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), s1.object.rotation.y));
  const start2 = new THREE.Vector3(4, 0, 1.5).add(new THREE.Vector3(-1.5, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), s2.object.rotation.y));
  assert.ok(end1.distanceTo(start2) < 1e-12, 'corner is shared between consecutive segments');
  assert.ok(end1.distanceTo(new THREE.Vector3(4, 0, 0)) < 1e-12);

  // Butt join: no extension along segment directions (only wall thickness sticks out).
  assert.equal(boxColliders(s1.colliders)[0].halfExtents[0], 2);
  assert.equal(boxColliders(s2.colliders)[0].halfExtents[0], 1.5);
  const bbox = new THREE.Box3().setFromObject(run.object);
  assert.ok(Math.abs(bbox.min.x) < 1e-6 && Math.abs(bbox.max.z - 3) < 1e-6);
  assert.ok(Math.abs(bbox.max.x - (4 + 0.11)) < 1e-6 && Math.abs(bbox.min.z - -0.11) < 1e-6, 'only thickness sticks out');
});

test('wallRun (miter): interior joint ends extend to close the outer corner', () => {
  const opts = { height: 2.6, thickness: 0.22, join: 'miter' as const };
  const run = wallRun([[0, 0], [4, 0], [4, 3]], opts);
  // Interior joint: both adjacent ends extend by thickness/2 = 0.11.
  const [s1, s2] = run.segments;
  assert.ok(Math.abs(boxColliders(s1.colliders)[0].halfExtents[0] - (4 + 0.11) / 2) < 1e-12);
  assert.ok(Math.abs(boxColliders(s2.colliders)[0].halfExtents[0] - (3 + 0.11) / 2) < 1e-12);
  // Run endpoints stay exact; only the interior joint spills (seg1 past +x, seg2 back along -z).
  const bbox = new THREE.Box3().setFromObject(run.object);
  assert.ok(Math.abs(bbox.min.x) < 1e-6, 'run start stays exact');
  assert.ok(Math.abs(bbox.min.z - -0.11) < 1e-6, 'interior joint spills back along the second span');
  assert.ok(bbox.max.x > 4, 'miter closes the outer corner beyond the vertex');
  assert.ok(Math.abs(bbox.max.x - (4 + 0.11)) < 1e-6);
  assert.ok(Math.abs(bbox.max.z - 3) < 1e-6, 'run end stays exact');
});

test('wallRun: rejects too few points and zero-length segments', () => {
  assert.throws(() => wallRun([[0, 0]], { height: 2, thickness: 0.2 }), /at least 2 points/);
  assert.throws(() => wallRun([[0, 0], [0, 0], [1, 0]], { height: 2, thickness: 0.2 }), /zero-length/);
});

test('placeOnFloorY: sets the base origin onto the floor, chainable', () => {
  const object = new THREE.Group();
  const returned = placeOnFloorY(object, 0.35);
  assert.equal(returned, object);
  assert.equal(object.position.y, 0.35);
  assert.equal(object.position.x, 0);
});

test('faceToward: +Z axis points at the target, +Y stays up', () => {
  const object = new THREE.Object3D();
  object.position.set(1, 0, 1);
  faceToward(object, [4, 0, 5]);
  object.updateMatrixWorld(true);
  const forward = object.getWorldDirection(new THREE.Vector3());
  assert.ok(Math.abs(forward.x - 0.6) < 1e-9, `forward.x ${forward.x}`);
  assert.ok(Math.abs(forward.z - 0.8) < 1e-9, `forward.z ${forward.z}`);
  assert.ok(Math.abs(forward.y) < 1e-9);
  // Chainable + degenerate target leaves orientation untouched.
  const before = object.rotation.y;
  assert.equal(faceToward(object, [1, 0, 1]), object);
  assert.equal(object.rotation.y, before);
});
