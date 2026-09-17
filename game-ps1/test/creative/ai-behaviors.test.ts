import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNavGraph } from '../../src/creative/ai/nav.ts';
import type { NavGraph } from '../../src/creative/ai/nav.ts';
import { createPatrol, createFollow, isStuck } from '../../src/creative/ai/behaviors.ts';
import type { BehaviorOutput, MoveIntent, PatrolOptions, StuckDiagnostic } from '../../src/creative/ai/behaviors.ts';
import type { Vec3 } from '../../src/creative/core/spatial.ts';

/**
 * a--b--c--d corridor (1 unit apart) with an e bypass, mirroring
 * ai-nav.test.ts so behavior tests sit on a known graph.
 */
function corridorGraph(): NavGraph {
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

/** Two rooms joined by a single gated door. */
function roomGraph(door: { open: boolean }): NavGraph {
  return createNavGraph({
    nodes: [
      { id: 'outside', position: [0, 0, 0] },
      { id: 'inside', position: [5, 0, 0] },
    ],
    edges: [{ from: 'outside', to: 'inside', twoWay: true, gate: () => door.open }],
  });
}

function asMove(out: BehaviorOutput): MoveIntent {
  if (out.kind !== 'move') assert.fail(`expected a move intent, got ${JSON.stringify(out)}`);
  return out;
}

function asStuck(out: BehaviorOutput): StuckDiagnostic {
  if (!isStuck(out)) assert.fail(`expected a stuck diagnostic, got ${JSON.stringify(out)}`);
  return out;
}

function patrolOpts(overrides: Partial<PatrolOptions> = {}): PatrolOptions {
  return { graph: corridorGraph(), from: 'a', to: 'd', speed: 2, arriveRadius: 0.25, ...overrides };
}

// ---------------------------------------------------------------------------
// Patrol
// ---------------------------------------------------------------------------

test('patrol: emits desired velocity at full speed toward the next waypoint (intent only)', () => {
  const patrol = createPatrol(patrolOpts());
  const position: Vec3 = [0, 0, 0];
  const out = asMove(patrol.update(1 / 60, position));
  assert.deepEqual(out.velocity, [2, 0, 0], 'full configured speed toward node b');
  assert.deepEqual(out.target, [1, 0, 0], 'the intent names the node it heads toward');
  assert.equal(out.arrived, false);
  assert.deepEqual(position, [0, 0, 0], 'update never writes the position it is given');
  assert.equal(patrol.arrived, false);
  assert.equal(patrol.stuck, null);
});

test('patrol: consumes waypoints within arriveRadius and arrives with zero velocity', () => {
  const patrol = createPatrol(patrolOpts());
  const atB = asMove(patrol.update(1 / 60, [1, 0, 0]));
  assert.deepEqual(atB.target, [2, 0, 0], 'b is consumed; the intent advances to c');

  const atGoal = asMove(patrol.update(1 / 60, [2.9, 0, 0]));
  assert.equal(atGoal.arrived, true, 'goal d is within arriveRadius of the position');
  assert.deepEqual(atGoal.velocity, [0, 0, 0]);
  assert.deepEqual(atGoal.target, [3, 0, 0]);
  assert.equal(patrol.arrived, true);
});

test('patrol: standing at the goal after arrival never reads as stuck', () => {
  const patrol = createPatrol(patrolOpts({ stuckSeconds: 0.5 }));
  patrol.update(1 / 60, [2.9, 0, 0]);
  assert.equal(patrol.arrived, true);
  for (let i = 0; i < 240; i += 1) {
    const out = asMove(patrol.update(1 / 60, [2.9, 0, 0]));
    assert.equal(out.arrived, true, 'only arrival intents, no stuck diagnostic');
    assert.deepEqual(out.velocity, [0, 0, 0]);
  }
  assert.equal(patrol.stuck, null, '4s of legitimate stillness is not a stall');
});

test('patrol: loop=true reverses at the endpoint and never reports arrived', () => {
  const patrol = createPatrol(patrolOpts({ loop: true }));
  const back = asMove(patrol.update(1 / 60, [3, 0, 0]));
  assert.equal(back.arrived, false);
  assert.equal(patrol.arrived, false, 'a looping patrol never arrives');
  assert.deepEqual(back.target, [2, 0, 0], 'heading back toward c');
  assert.ok(back.velocity[0] < 0, 'velocity reversed along -x');

  const again = asMove(patrol.update(1 / 60, [0, 0, 0]));
  assert.deepEqual(again.target, [1, 0, 0], 'second leg heads toward b again');
  assert.ok(again.velocity[0] > 0);
});

test('patrol: no positional progress emits one stalled diagnostic, holds zero velocity, resumes on progress', () => {
  const patrol = createPatrol(patrolOpts({ stuckSeconds: 1, progressEpsilon: 1e-3 }));
  const pos: Vec3 = [0, 0, 0];
  asMove(patrol.update(0.5, pos)); // tracker reference set
  asMove(patrol.update(0.4, pos)); // timer 0.4 < 1: still steering
  const stuck = asStuck(patrol.update(0.6, pos)); // timer 1.0 >= 1
  assert.equal(stuck.code, 'BEHAVIOR_STUCK');
  assert.equal(stuck.reason, 'stalled');
  assert.equal(stuck.sinceSeconds, 1);
  assert.deepEqual(stuck.at, [0, 0, 0]);
  assert.equal(stuck.debug, true, 'agent-internal diagnostic, not player evidence');
  assert.match(stuck.detail, /patrol: no positional progress for 1s \(stuckSeconds=1\)/);
  assert.equal(patrol.stuck, 'stalled');

  const held = asMove(patrol.update(0.6, pos));
  assert.deepEqual(held.velocity, [0, 0, 0], 'zero-velocity intents until the condition clears');
  assert.equal(patrol.stuck, 'stalled');

  const drift = asMove(patrol.update(0.6, [0.0005, 0, 0]));
  assert.deepEqual(drift.velocity, [0, 0, 0], 'drift under progressEpsilon keeps the stall');
  assert.equal(patrol.stuck, 'stalled');

  const resumed = asMove(patrol.update(0.6, [0.5, 0, 0]));
  assert.deepEqual(resumed.velocity, [2, 0, 0], 'real progress clears the episode and resumes steering');
  assert.equal(patrol.stuck, null);
});

test('patrol: a closed door with no alternative propagates NO_PATH as "blocked", once, then holds; replan() recovers', () => {
  const door = { open: false };
  const patrol = createPatrol({
    graph: roomGraph(door),
    from: 'outside',
    to: 'inside',
    speed: 1,
    arriveRadius: 0.2,
  });

  const first = asStuck(patrol.update(1 / 60, [0, 0, 0]));
  assert.equal(first.reason, 'blocked', 'nav reason "blocked" propagates verbatim');
  assert.match(first.detail, /no path from "outside" to "inside"/);
  assert.match(first.detail, /nav reason: blocked/);
  assert.match(first.detail, /closed gates: outside->inside/);
  assert.equal(patrol.stuck, 'blocked');

  const held = asMove(patrol.update(1 / 60, [0, 0, 0]));
  assert.deepEqual(held.velocity, [0, 0, 0], 'diagnostic is emitted once; then zero velocity');
  assert.equal(patrol.stuck, 'blocked');

  door.open = true;
  const result = patrol.replan([0, 0, 0]);
  assert.equal(result.ok, true, 'replan re-queries the graph against live gate state');
  const resumed = asMove(patrol.update(1 / 60, [0, 0, 0]));
  assert.deepEqual(resumed.velocity, [1, 0, 0], 'steering toward the now-open room');
  assert.equal(patrol.stuck, null, 'the stuck state clears on recovery');
});

test('patrol: an unreachable goal propagates NO_PATH as "no-path"', () => {
  const graph = createNavGraph({
    nodes: [
      { id: 'out', position: [0, 0, 0] },
      { id: 'island', position: [5, 0, 0] }, // no edges at all
    ],
  });
  const patrol = createPatrol({ graph, from: 'out', to: 'island', speed: 1, arriveRadius: 0.2 });
  const stuck = asStuck(patrol.update(1 / 60, [0, 0, 0]));
  assert.equal(stuck.reason, 'no-path', 'nav reason "unreachable" maps to "no-path"');
  assert.match(stuck.detail, /nav reason: unreachable/);
  assert.doesNotMatch(stuck.detail, /closed gates/, 'no gated edges were involved');
  assert.equal(patrol.stuck, 'no-path');
});

test('patrol: while NO_PATH persists, a positional stall never overwrites the nav reason', () => {
  const graph = createNavGraph({
    nodes: [
      { id: 'out', position: [0, 0, 0] },
      { id: 'island', position: [5, 0, 0] },
    ],
  });
  const patrol = createPatrol({
    graph,
    from: 'out',
    to: 'island',
    speed: 1,
    arriveRadius: 0.2,
    stuckSeconds: 0.5,
  });
  asStuck(patrol.update(1 / 60, [0, 0, 0]));
  for (let i = 0; i < 240; i += 1) {
    const out = patrol.update(1 / 60, [0, 0, 0]); // 4s of motionless failure
    assert.ok(out.kind === 'stuck' || (out.kind === 'move' && out.velocity[0] === 0 && out.velocity[1] === 0 && out.velocity[2] === 0));
  }
  assert.equal(patrol.stuck, 'no-path', 'the root cause survives the stall symptom');
});

test('patrol: repathInterval re-queries the graph so a closing door reroutes a live patrol', () => {
  const door = { open: true };
  // Corridor as usual, but the b<->c segment IS the door.
  const graph = createNavGraph({
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
  let queries = 0;
  const original = graph.findPath.bind(graph);
  graph.findPath = (from: string, to: string) => {
    queries += 1;
    return original(from, to);
  };
  const patrol = createPatrol(patrolOpts({ graph, repathInterval: 0.5 }));
  assert.equal(queries, 1, 'constructor queries the initial route');
  assert.deepEqual(asMove(patrol.update(0.2, [0, 0, 0])).target, [1, 0, 0], 'door open: heading for b');

  door.open = false;
  const rerouted = asMove(patrol.update(0.3, [0, 0, 0])); // timer hits 0.5
  assert.equal(queries, 2, 'the interval forces a fresh A* query');
  assert.deepEqual(rerouted.target, [1.5, 0, 2], 'live patrol re-routes through the e bypass');
});

// ---------------------------------------------------------------------------
// Follow
// ---------------------------------------------------------------------------

test('follow: steers toward the live target position (intent only)', () => {
  const target: Vec3 = [3, 0, 0];
  let samples = 0;
  const follow = createFollow({
    graph: corridorGraph(),
    getTargetPosition: () => {
      samples += 1;
      return target;
    },
    speed: 2,
    arriveRadius: 0.25,
    repathInterval: 10,
  });
  const position: Vec3 = [0, 0, 0];
  const out = asMove(follow.update(1 / 60, position));
  assert.ok(Math.abs(out.velocity[0] - 2) < 1e-9, 'full speed toward the first waypoint');
  assert.ok(Math.abs(out.velocity[1]) < 1e-9 && Math.abs(out.velocity[2]) < 1e-9);
  assert.deepEqual(out.target, [1, 0, 0], 'the intent heads toward the next path node, not straight at the target');
  assert.equal(out.arrived, false);
  assert.deepEqual(position, [0, 0, 0], 'update never writes the position it is given');
  assert.equal(samples, 1, 'the target position function is sampled once per update');
});

test('follow: the final leg tracks a moving target between replans', () => {
  const target: Vec3 = [3, 0, 0];
  const follow = createFollow({
    graph: corridorGraph(),
    getTargetPosition: () => target,
    speed: 2,
    arriveRadius: 0.1,
    repathInterval: 10,
  });
  const first = asMove(follow.update(1 / 60, [2.8, 0, 0]));
  assert.deepEqual(first.target, [3, 0, 0]);
  assert.ok(first.velocity[0] > 0);

  target[0] = 2.6; // drifts, same nearest node: no replan, but the goal refreshes
  const second = asMove(follow.update(1 / 60, [2.8, 0, 0]));
  assert.deepEqual(second.target, [2.6, 0, 0], 'the goal follows the live target');
  assert.ok(second.velocity[0] < 0, 'now steering the other way');
});

test('follow: within arriveRadius it stands still and never reports stuck', () => {
  const target: Vec3 = [3, 0, 0];
  const follow = createFollow({
    graph: corridorGraph(),
    getTargetPosition: () => target,
    speed: 2,
    arriveRadius: 0.5,
    stuckSeconds: 0.5,
  });
  const out = asMove(follow.update(1 / 60, [2.9, 0, 0]));
  assert.equal(out.arrived, true);
  assert.deepEqual(out.velocity, [0, 0, 0]);
  assert.deepEqual(out.target, [3, 0, 0]);
  assert.equal(follow.arrived, true);
  for (let i = 0; i < 240; i += 1) asMove(follow.update(1 / 60, [2.9, 0, 0]));
  assert.equal(follow.stuck, null, '2s+ of legitimate stillness at the target is not a stall');
});

test('follow: no progress emits one stalled diagnostic, then zero velocity until progress resumes', () => {
  const target: Vec3 = [3, 0, 0];
  const follow = createFollow({
    graph: corridorGraph(),
    getTargetPosition: () => target,
    speed: 2,
    arriveRadius: 0.25,
    stuckSeconds: 1,
    repathInterval: 10,
  });
  const pos: Vec3 = [0, 0, 0];
  asMove(follow.update(0.5, pos));
  asMove(follow.update(0.6, pos));
  const stuck = asStuck(follow.update(0.6, pos)); // timer 1.2 >= 1
  assert.equal(stuck.reason, 'stalled');
  assert.match(stuck.detail, /follow: no positional progress for 1\.2s/);
  assert.equal(follow.stuck, 'stalled');

  const held = asMove(follow.update(0.6, pos));
  assert.deepEqual(held.velocity, [0, 0, 0], 'zero-velocity intents until the condition clears');

  const resumed = asMove(follow.update(0.6, [0.4, 0, 0]));
  assert.ok(resumed.velocity[0] > 0, 'progress clears the episode and resumes steering');
  assert.equal(follow.stuck, null);
});

test('follow: an unreachable target reports "no-path" once, then holds zero velocity', () => {
  const graph = createNavGraph({
    nodes: [
      { id: 'out', position: [0, 0, 0] },
      { id: 'island', position: [5, 0, 0] },
    ],
  });
  const follow = createFollow({
    graph,
    getTargetPosition: () => [5, 0, 0],
    speed: 1,
    arriveRadius: 0.2,
    repathInterval: 10,
  });
  const first = asStuck(follow.update(1 / 60, [0, 0, 0]));
  assert.equal(first.reason, 'no-path');
  assert.match(first.detail, /follow: no path from "\(nearest-to-agent\)" to "\(nearest-to-target\)"/);
  assert.equal(follow.stuck, 'no-path');
  const held = asMove(follow.update(1 / 60, [0, 0, 0]));
  assert.deepEqual(held.velocity, [0, 0, 0], 'diagnostic once, then zero velocity');
});

test('follow: a gated target reports "blocked" and recovers the very step the gate opens', () => {
  const door = { open: false };
  const follow = createFollow({
    graph: roomGraph(door),
    getTargetPosition: () => [5, 0, 0],
    speed: 1,
    arriveRadius: 0.2,
    repathInterval: 10,
  });
  const stuck = asStuck(follow.update(1 / 60, [0, 0, 0]));
  assert.equal(stuck.reason, 'blocked');
  assert.equal(follow.stuck, 'blocked');

  door.open = true;
  const resumed = asMove(follow.update(1 / 60, [0, 0, 0]));
  assert.deepEqual(resumed.velocity, [1, 0, 0], 'the pending NO_PATH forces an immediate requery');
  assert.equal(follow.stuck, null, 'recovery needs no replan() call');
});

test('follow: while NO_PATH persists, a positional stall never overwrites the nav reason', () => {
  const graph = createNavGraph({
    nodes: [
      { id: 'out', position: [0, 0, 0] },
      { id: 'island', position: [5, 0, 0] },
    ],
  });
  const follow = createFollow({
    graph,
    getTargetPosition: () => [5, 0, 0],
    speed: 1,
    arriveRadius: 0.2,
    stuckSeconds: 0.5,
    repathInterval: 10,
  });
  asStuck(follow.update(1 / 60, [0, 0, 0]));
  for (let i = 0; i < 240; i += 1) {
    const out = follow.update(1 / 60, [0, 0, 0]); // 4s of motionless failure
    assert.ok(out.kind === 'stuck' || (out.kind === 'move' && out.velocity[0] === 0 && out.velocity[1] === 0 && out.velocity[2] === 0));
  }
  assert.equal(follow.stuck, 'no-path', 'the root cause survives the stall symptom');
});
