import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionStateBag } from '../../src/creative/state/cross-scene.ts';
import { CreativeError } from '../../src/creative/core/errors.ts';

test('unloading a scene instance never clears persistent module state (S13)', () => {
  const bag = new SessionStateBag();

  bag.beginSceneInstance('scene-dock');
  bag.set('persistent', 'inventory', 'items', ['lantern', 'rope']);
  bag.set('persistent', 'objectives', 'active', { id: 'find-sisi', done: false });
  bag.set('scene', 'dock-puzzle', 'leverOrder', [2, 1, 3], 'scene-dock');

  bag.unloadSceneInstance('scene-dock');

  // Disposable scene state is gone.
  assert.equal(bag.hasSceneState('scene-dock'), false);
  assert.equal(bag.activeSceneInstanceIds.includes('scene-dock'), false);

  // Persistent progress survives.
  assert.deepEqual(bag.get('persistent', 'inventory', 'items'), ['lantern', 'rope']);
  assert.deepEqual(bag.get('persistent', 'objectives', 'active'), { id: 'find-sisi', done: false });
  assert.equal(bag.hasPersistentState('inventory'), true);
});

test('scene reload: persistent inventory/objective state is intact for the new instance', () => {
  const bag = new SessionStateBag();
  bag.beginSceneInstance('scene-dock-run-1');
  bag.set('persistent', 'inventory', 'items', ['lantern']);
  bag.set('persistent', 'objectives', 'active', { id: 'find-sisi', done: true });
  bag.set('scene', 'dock-puzzle', 'step', 2, 'scene-dock-run-1');
  bag.unloadSceneInstance('scene-dock-run-1');

  // Reload the same scene fresh.
  bag.beginSceneInstance('scene-dock-run-2');
  assert.deepEqual(bag.get('persistent', 'inventory', 'items'), ['lantern']);
  assert.deepEqual(bag.get('persistent', 'objectives', 'active'), { id: 'find-sisi', done: true });
  // The new instance starts clean of the old instance's scene state.
  assert.equal(bag.get('scene', 'dock-puzzle', 'step', 'scene-dock-run-2'), undefined);

  // And the two instances are fully independent while both live.
  bag.beginSceneInstance('scene-cellar');
  bag.set('scene', 'dock-puzzle', 'step', 99, 'scene-cellar');
  assert.equal(bag.get('scene', 'dock-puzzle', 'step', 'scene-dock-run-2'), undefined);
  bag.unloadSceneInstance('scene-cellar');
  // Unloading another instance never disturbs persistent state (nor other
  // instances' scene state).
  assert.deepEqual(bag.get('persistent', 'inventory', 'items'), ['lantern']);
  assert.equal(bag.get('scene', 'dock-puzzle', 'step', 'scene-dock-run-2'), undefined);
});

test('persistent state is keyed by moduleId, not by scene instance', () => {
  const bag = new SessionStateBag();
  bag.beginSceneInstance('a');
  bag.set('persistent', 'world', 'flags', ['gate-open']);
  bag.unloadSceneInstance('a');
  bag.beginSceneInstance('b');
  // No instanceId needed for persistent reads/writes.
  bag.set('persistent', 'world', 'day', 3);
  assert.deepEqual(bag.get('persistent', 'world', 'flags'), ['gate-open']);
  assert.equal(bag.get('persistent', 'world', 'day'), 3);
});

test('scene state requires an active instance — honest error, no silent global write', () => {
  const bag = new SessionStateBag();
  let caught: unknown = null;
  try {
    bag.set('scene', 'dock-puzzle', 'step', 1, 'not-active');
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof CreativeError);
  assert.equal((caught as CreativeError).code, 'UNKNOWN_SCENE_INSTANCE');
  assert.equal(bag.hasSceneState('not-active'), false);
});

test('beginSceneInstance twice for the same id is an honest error', () => {
  const bag = new SessionStateBag();
  bag.beginSceneInstance('scene-dock');
  let caught: unknown = null;
  try {
    bag.beginSceneInstance('scene-dock');
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof CreativeError);
  assert.equal((caught as CreativeError).code, 'DUPLICATE_SCENE_INSTANCE');
});

test('values are deep-cloned on write and read — no aliasing between modules', () => {
  const bag = new SessionStateBag();
  const items = ['lantern'];
  bag.set('persistent', 'inventory', 'items', items);
  items.push('exploit');
  assert.deepEqual(bag.get('persistent', 'inventory', 'items'), ['lantern']);

  const read = bag.get('persistent', 'inventory', 'items') as string[];
  read.push('exploit-again');
  assert.deepEqual(bag.get('persistent', 'inventory', 'items'), ['lantern']);
});

test('non-JSON values are rejected on write (they must be checkpointable)', () => {
  const bag = new SessionStateBag();
  let caught: unknown = null;
  try {
    bag.set('persistent', 'mod', 'fn', () => 1);
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof CreativeError);
  assert.equal((caught as CreativeError).code, 'BAD_STATE_VALUE');
});

test('snapshotPersistent / restorePersistent round-trips the checkpointable slice only', () => {
  const bag = new SessionStateBag();
  bag.beginSceneInstance('scene-dock');
  bag.set('persistent', 'inventory', 'items', ['lantern']);
  bag.set('persistent', 'objectives', 'active', { id: 'find-sisi', done: false });
  bag.set('scene', 'dock-puzzle', 'step', 2, 'scene-dock');

  const snapshot = bag.snapshotPersistent();
  assert.deepEqual(Object.keys(snapshot).sort(), ['inventory', 'objectives']);
  assert.equal('dock-puzzle' in snapshot, false, 'scene state is not checkpointable');

  // Simulate a fresh session.
  const fresh = new SessionStateBag();
  fresh.restorePersistent(JSON.parse(JSON.stringify(snapshot)));
  assert.deepEqual(fresh.get('persistent', 'inventory', 'items'), ['lantern']);
  assert.deepEqual(fresh.get('persistent', 'objectives', 'active'), { id: 'find-sisi', done: false });
});

test('restorePersistent replaces wholesale and rejects malformed snapshots without touching state', () => {
  const bag = new SessionStateBag();
  bag.set('persistent', 'inventory', 'items', ['lantern']);

  let caught: unknown = null;
  try {
    bag.restorePersistent({ inventory: { items: () => 1 } });
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof CreativeError);
  assert.equal((caught as CreativeError).code, 'BAD_STATE_SNAPSHOT');
  // Current state untouched by the failed restore.
  assert.deepEqual(bag.get('persistent', 'inventory', 'items'), ['lantern']);

  // Wholesale replacement: stale keys vanish.
  bag.restorePersistent({ objectives: { active: { id: 'new', done: true } } });
  assert.equal(bag.get('persistent', 'inventory', 'items'), undefined);
  assert.deepEqual(bag.get('persistent', 'objectives', 'active'), { id: 'new', done: true });
});

test('unset removes entries in both dispositions', () => {
  const bag = new SessionStateBag();
  bag.beginSceneInstance('s');
  bag.set('persistent', 'm', 'k', 1);
  bag.set('scene', 'm', 'k', 2, 's');
  assert.equal(bag.unset('persistent', 'm', 'k'), true);
  assert.equal(bag.unset('persistent', 'm', 'k'), false);
  assert.equal(bag.get('persistent', 'm', 'k'), undefined);
  assert.equal(bag.unset('scene', 'm', 'k', 's'), true);
  assert.equal(bag.get('scene', 'm', 'k', 's'), undefined);
  assert.equal(bag.hasSceneState('s'), false);
});
