import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CommitLog } from '../../src/creative/core/events.ts';
import { ObjectiveTracker, ObjectiveError } from '../../src/creative/gameplay/objectives.ts';

const ctx = { generation: 0, tick: 1 };

/** Adapt the bare CommitLog (which needs an explicit commit ctx) to the channel shape. */
function channelOf(log: CommitLog) {
  return { commit: (name: string, payload: unknown, eventId: string) => log.commit(name, payload, eventId, ctx) };
}

function makeTracker(log: CommitLog): ObjectiveTracker {
  return new ObjectiveTracker({
    objectives: [
      { id: 'mop-floor', target: 3, title: '拖完客厅' },
      { id: 'enter-home', target: 1 },
    ],
    commit: channelOf(log),
  });
}

test('progress commits namespaced events and reaches completion', () => {
  const log = new CommitLog({ sessionId: 's1', generation: 0 });
  const tracker = makeTracker(log);

  const r1 = tracker.progress('mop-floor', 1, 'mop:1');
  assert.deepEqual(r1, { applied: true, total: 1, completed: false });
  assert.equal(tracker.isComplete('mop-floor'), false);

  tracker.progress('mop-floor', 1, 'mop:2');
  const r3 = tracker.progress('mop-floor', 1, 'mop:3');
  assert.deepEqual(r3, { applied: true, total: 3, completed: true });
  assert.equal(tracker.isComplete('mop-floor'), true);

  const progressEvents = log.entries.filter((e) => e.name === 'objectives.progress');
  assert.equal(progressEvents.length, 3);
  const completion = log.entries.find((e) => e.name === 'objectives.completed');
  assert.ok(completion, 'completion event committed');
  assert.equal(completion.eventId, 'objectives:mop-floor:completed');
});

test('duplicate eventId dedupes: replayed interaction does not double-apply', () => {
  const log = new CommitLog({ sessionId: 's1', generation: 0 });
  const tracker = makeTracker(log);

  assert.equal(tracker.progress('mop-floor', 1, 'mop:1').applied, true);
  const replay = tracker.progress('mop-floor', 1, 'mop:1');
  assert.deepEqual(replay, { applied: false, status: 'duplicate' });
  assert.equal(tracker.progressOf('mop-floor'), 1, 'duplicate must not bump the total');
});

test('already-complete objectives short-circuit: no double award, no extra commits', () => {
  const log = new CommitLog({ sessionId: 's1', generation: 0 });
  const tracker = makeTracker(log);

  tracker.progress('enter-home', 1, 'door:1');
  assert.equal(tracker.isComplete('enter-home'), true);
  assert.equal(log.entries.filter((e) => e.name === 'objectives.completed').length, 1);

  const again = tracker.progress('enter-home', 1, 'door:2');
  assert.deepEqual(again, { applied: false, status: 'already-complete' });
  assert.equal(log.entries.filter((e) => e.name === 'objectives.completed').length, 1, 'no second award');
  assert.equal(log.entries.filter((e) => e.name === 'objectives.progress').length, 1);
});

test('completion query helpers', () => {
  const log = new CommitLog({ sessionId: 's1', generation: 0 });
  const tracker = makeTracker(log);
  assert.deepEqual(tracker.completed(), []);
  tracker.progress('enter-home', 1, 'door:1');
  assert.deepEqual(tracker.completed(), ['enter-home']);
  assert.equal(tracker.targetOf('mop-floor'), 3);
});

test('unknown objective id is an honest error', () => {
  const log = new CommitLog({ sessionId: 's1', generation: 0 });
  const tracker = makeTracker(log);
  let caught: unknown = null;
  try {
    tracker.progress('nope', 1, 'x:1');
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof ObjectiveError);
  assert.equal(caught.code, 'UNKNOWN_OBJECTIVE');
});

test('snapshot/restore preserves progress; completed derived from targets', () => {
  const log = new CommitLog({ sessionId: 's1', generation: 0 });
  const tracker = makeTracker(log);
  tracker.progress('mop-floor', 2, 'mop:1');
  tracker.progress('mop-floor', 1, 'mop:2');
  const wire = JSON.parse(JSON.stringify(tracker.snapshot()));

  const restored = makeTracker(new CommitLog({ sessionId: 's2', generation: 0 }));
  restored.restore(wire);
  assert.equal(restored.progressOf('mop-floor'), 3);
  assert.equal(restored.isComplete('mop-floor'), true);
  assert.deepEqual(restored.completed(), ['mop-floor']);
});

test('unknown schemaVersion restore is an honest error', () => {
  const log = new CommitLog({ sessionId: 's1', generation: 0 });
  const tracker = makeTracker(log);
  let caught: unknown = null;
  try {
    tracker.restore({ schemaVersion: 7, progress: {} });
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof ObjectiveError);
  assert.equal(caught.code, 'SCHEMA_VERSION_MISMATCH');
});
