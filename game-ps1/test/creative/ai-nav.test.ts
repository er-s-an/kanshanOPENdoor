import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNavGraph } from '../../src/creative/ai/nav.ts';
import type { NavResult } from '../../src/creative/ai/nav.ts';
import { CreativeError } from '../../src/creative/core/errors.ts';

/**
 * Linear corridor a--b--c--d (1 unit apart) plus a bypass around the middle:
 *
 *   a -- b -- c -- d
 *   |              |
 *   +---- e ------ +
 */
function corridorGraph() {
  return createNavGraph({
    nodes: [
      { id: 'a', position: [0, 0, 0] },
      { id: 'b', position: [1, 0, 0] },
      { id: 'c', position: [2, 0, 0] },
      { id: 'd', position: [3, 0, 0] },
      { id: 'e', position: [1.5, 0, 2] },
    ],
    edges: [
      { from: 'a', to: 'b', twoWay: true },
      { from: 'b', to: 'c', twoWay: true },
      { from: 'c', to: 'd', twoWay: true },
      { from: 'a', to: 'e', twoWay: true },
      { from: 'e', to: 'd', twoWay: true },
    ],
  });
}

test('nav: A* returns the shortest path with nodes, positions and cost', () => {
  const graph = corridorGraph();
  const result = graph.findPath('a', 'd');
  assert.ok(result.ok);
  assert.deepEqual(result.nodes, ['a', 'b', 'c', 'd'], 'the direct corridor is shortest');
  assert.deepEqual(result.positions[0], [0, 0, 0]);
  assert.deepEqual(result.positions[3], [3, 0, 0]);
  assert.ok(Math.abs(result.cost - 3) < 1e-9, 'cost is the sum of edge lengths');
});

test('nav: custom edge cost beats distance when cheaper', () => {
  const graph = createNavGraph({
    nodes: [
      { id: 'a', position: [0, 0, 0] },
      { id: 'b', position: [1, 0, 0] },
      { id: 'c', position: [2, 0, 0] },
    ],
    edges: [
      { from: 'a', to: 'b', twoWay: true },
      { from: 'b', to: 'c', twoWay: true },
      { from: 'a', to: 'c', twoWay: true, cost: 100 }, // direct but "expensive"
    ],
  });
  const result = graph.findPath('a', 'c');
  assert.ok(result.ok);
  assert.deepEqual(result.nodes, ['a', 'b', 'c'], 'A* prefers the cheap two-hop route');
  assert.ok(result.cost < 100);
});

test('nav: unreachable goal reports NO_PATH reason "unreachable"', () => {
  const graph = createNavGraph({
    nodes: [
      { id: 'a', position: [0, 0, 0] },
      { id: 'island', position: [10, 0, 0] },
    ],
    edges: [],
  });
  const result = graph.findPath('a', 'island');
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'unreachable');
});

test('nav: unknown endpoints report origin-unknown / goal-unknown', () => {
  const graph = corridorGraph();
  const from = graph.findPath('ghost', 'd');
  assert.equal(from.ok, false);
  if (!from.ok) assert.equal(from.reason, 'origin-unknown');
  const to = graph.findPath('a', 'ghost');
  assert.equal(to.ok, false);
  if (!to.ok) assert.equal(to.reason, 'goal-unknown');
});

test('nav: same-origin goal is a trivial one-node path', () => {
  const graph = corridorGraph();
  const result = graph.findPath('b', 'b');
  assert.ok(result.ok);
  assert.deepEqual(result.nodes, ['b']);
  assert.equal(result.cost, 0);
});

test('nav: nearestNode finds the closest declared node', () => {
  const graph = corridorGraph();
  const near = graph.nearestNode([0.1, 0, 0.2]);
  assert.equal(near?.id, 'a');
  assert.ok(Math.abs(near!.distance - Math.hypot(0.1, 0, 0.2)) < 1e-9);
  const far = graph.nearestNode([100, 0, 0], 5);
  assert.equal(far, null, 'maxDistance bounds the search');
});

test('nav: gated replan — a closed door re-routes the SAME query to a longer path', () => {
  // Gate only the middle segment b<->c (the "door").
  const door = { open: true };
  const gated = createNavGraph({
    nodes: [
      { id: 'a', position: [0, 0, 0] },
      { id: 'b', position: [1, 0, 0] },
      { id: 'c', position: [2, 0, 0] },
      { id: 'd', position: [3, 0, 0] },
      { id: 'e', position: [1.5, 0, 2] },
    ],
    edges: [
      { from: 'a', to: 'b', twoWay: true },
      { from: 'b', to: 'c', twoWay: true, gate: () => door.open },
      { from: 'c', to: 'd', twoWay: true },
      { from: 'a', to: 'e', twoWay: true },
      { from: 'e', to: 'd', twoWay: true },
    ],
  });

  const before: NavResult = gated.findPath('a', 'd');
  assert.ok(before.ok);
  assert.deepEqual(before.ok ? before.nodes : [], ['a', 'b', 'c', 'd'], 'door open: direct route');

  door.open = false; // the mechanism closes the door — no other API call needed
  const after: NavResult = gated.findPath('a', 'd');
  assert.ok(after.ok);
  assert.deepEqual(after.ok ? after.nodes : [], ['a', 'e', 'd'], 'same query now re-routes around');
  assert.ok(!after.ok || after.cost > before.cost, 'the detour costs more');
});

test('nav: gated replan — no alternative yields NO_PATH reason "blocked" with the closed edge', () => {
  const door = { open: true };
  const graph = createNavGraph({
    nodes: [
      { id: 'outside', position: [0, 0, 0] },
      { id: 'inside', position: [5, 0, 0] },
    ],
    edges: [{ from: 'outside', to: 'inside', twoWay: true, gate: () => door.open }],
  });
  assert.equal(graph.findPath('outside', 'inside').ok, true, 'open door: path exists');

  door.open = false;
  const closed = graph.findPath('outside', 'inside');
  assert.equal(closed.ok, false);
  if (!closed.ok) {
    assert.equal(closed.reason, 'blocked', 'goal reachable only through the closed gate');
    // Traversal-direction key only: the search met 'outside->inside' closed.
    // The reverse key of a twoWay edge is implied by the declaration.
    assert.deepEqual(closed.blockedEdges, ['outside->inside']);
  }
});

test('nav: an open gate elsewhere never appears in blockedEdges', () => {
  let open = false;
  const graph = createNavGraph({
    nodes: [
      { id: 'a', position: [0, 0, 0] },
      { id: 'b', position: [1, 0, 0] },
      { id: 'c', position: [2, 0, 0] },
    ],
    edges: [
      { from: 'a', to: 'b', twoWay: true },
      { from: 'b', to: 'c', twoWay: true, gate: () => open },
    ],
  });
  const blocked = graph.findPath('a', 'c');
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.deepEqual(blocked.blockedEdges, ['b->c']);
});

test('nav: validation — duplicates, unknown edge nodes, bad costs, bad positions', () => {
  assert.throws(
    () => createNavGraph({ nodes: [{ id: 'a', position: [0, 0, 0] }, { id: 'a', position: [1, 0, 0] }] }),
    (err: unknown) => err instanceof CreativeError && err.code === 'NAV_DUPLICATE_NODE',
  );
  assert.throws(
    () => createNavGraph({ nodes: [{ id: 'a', position: [0, 0, 0] }], edges: [{ from: 'a', to: 'ghost' }] }),
    (err: unknown) => err instanceof CreativeError && err.code === 'NAV_UNKNOWN_NODE',
  );
  assert.throws(
    () =>
      createNavGraph({
        nodes: [
          { id: 'a', position: [0, 0, 0] },
          { id: 'b', position: [1, 0, 0] },
        ],
        edges: [{ from: 'a', to: 'b', cost: -1 }],
      }),
    (err: unknown) => err instanceof CreativeError && err.code === 'NAV_INVALID_EDGE',
  );
  assert.throws(
    () => createNavGraph({ nodes: [{ id: 'a', position: [Number.NaN, 0, 0] }] }),
    (err: unknown) => err instanceof CreativeError && err.code === 'NAV_INVALID',
  );
});
