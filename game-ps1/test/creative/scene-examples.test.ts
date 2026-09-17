import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeShelf } from '../../src/creative/scene/examples/makeShelf.ts';
import { placeOnFloorY } from '../../src/creative/scene/helpers.ts';
import type { BoxColliderDesc } from '../../src/creative/core/spatial.ts';

test('makeShelf: returns { object, colliders } with authorId on root userData', () => {
  const shelf = makeShelf();
  assert.equal(shelf.object.type, 'Group');
  assert.equal(shelf.object.userData.authorId, 'shelf');
  assert.ok(shelf.colliders.length > 0);
  for (const collider of shelf.colliders) {
    assert.equal(collider.body, 'static');
    assert.equal(collider.shape.kind, 'box');
  }
});

test('makeShelf: nests parts under frame/board groups', () => {
  const shelf = makeShelf({ shelfCount: 3 });
  const root = shelf.object;
  const frame = root.children.find((c) => c.name === 'frame');
  const boards = root.children.find((c) => c.name === 'boards');
  assert.ok(frame && boards, 'nesting groups exist');
  assert.equal(frame.children.length, 4, 'two sides + back + top');
  assert.equal(boards.children.length, 3, 'one mesh per shelf board');
  // Two levels of nesting below the root.
  assert.ok(root.children.every((c) => c.type === 'Group'));
});

test('makeShelf: collider descs cover every solid part and stay in bounds', () => {
  const width = 2;
  const height = 2.2;
  const depth = 0.4;
  const shelfCount = 5;
  const shelf = makeShelf({ width, height, depth, shelfCount });
  // 4 frame parts + shelfCount boards.
  assert.equal(shelf.colliders.length, 4 + shelfCount);
  for (const collider of shelf.colliders) {
    const shape = collider.shape as BoxColliderDesc;
    const [ox, oy, oz] = shape.offset ?? [0, 0, 0];
    const [hx, hy, hz] = shape.halfExtents;
    assert.ok(Math.abs(ox) + hx <= width / 2 + 1e-9);
    assert.ok(oy - hy >= -1e-9 && oy + hy <= height + 1e-9);
    assert.ok(Math.abs(oz) + hz <= depth / 2 + 1e-9);
  }
});

test('makeShelf: custom authorId and validation', () => {
  const shelf = makeShelf({ authorId: 'prop.kitchen.shelf' });
  assert.equal(shelf.object.userData.authorId, 'prop.kitchen.shelf');
  assert.equal(shelf.object.name, 'prop.kitchen.shelf');
  assert.throws(() => makeShelf({ width: 0 }), /positive/);
  assert.throws(() => makeShelf({ shelfCount: 0 }), /shelfCount/);
});

test('makeShelf: composes with helpers (origin at base)', () => {
  const shelf = makeShelf();
  placeOnFloorY(shelf.object, 0.12);
  assert.equal(shelf.object.position.y, 0.12);
});
