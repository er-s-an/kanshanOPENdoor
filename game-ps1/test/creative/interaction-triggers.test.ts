import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSensorTriggers, createAabbTriggers } from '../../src/creative/interaction/triggers.ts';
import type { TriggerOther } from '../../src/creative/interaction/triggers.ts';
import type { PhysicsWorld } from '../../src/creative/physics/world.ts';
import { createPhysicsWorld } from '../../src/creative/physics/world.ts';
import { CreativeError } from '../../src/creative/core/errors.ts';

let world: PhysicsWorld;
const DT = 1 / 60;

before(async () => {
  world = await createPhysicsWorld();
});

// ---------------------------------------------------------------------------
// Physics-bound path: volumes as real Rapier sensors
// ---------------------------------------------------------------------------

test('sensor triggers: a kinematic body walking through fires enter then exit exactly once', () => {
  const triggers = createSensorTriggers(world);
  const events: string[] = [];
  const entered: TriggerOther[] = [];
  const exited: TriggerOther[] = [];
  triggers.add({
    id: 'gate',
    shape: { kind: 'box', halfExtents: [0.6, 0.6, 0.6] },
    position: [0, 0, 0],
    onEnter: (other) => {
      entered.push(other);
      events.push('enter');
    },
    onExit: (other) => {
      exited.push(other);
      events.push('exit');
    },
  });
  assert.deepEqual(triggers.volumeIds(), ['gate']);
  assert.ok(world.hasBody('trigger:gate'), 'the volume is a real sensor body in the world');

  world.addBody(
    'walker',
    { shape: { kind: 'box', halfExtents: [0.2, 0.2, 0.2] }, body: 'kinematic' },
    { position: [-2, 0, 0] },
  );
  world.step(DT);
  triggers.update(); // drain anything from setup

  let enterFiring: { volumeId: string; other: TriggerOther } | null = null;
  for (let i = 0; i < 80; i += 1) {
    const x = -2 + (i + 1) * 0.05; // -1.95 .. +2.0
    world.setKinematicTarget('walker', [x, 0, 0]);
    world.step(DT);
    for (const firing of triggers.update()) {
      if (firing.kind === 'enter') enterFiring = firing;
    }
  }

  assert.deepEqual(events, ['enter', 'exit'], 'staying inside fires nothing; each edge fires once');
  assert.equal(entered.length, 1);
  assert.equal(entered[0].bodyId, 'walker', 'the callback receives the OTHER body in the pair');
  assert.equal(typeof entered[0].colliderHandle, 'number', 'physics path reports the collider handle');
  assert.equal(exited.length, 1);
  assert.equal(exited[0].bodyId, 'walker');
  assert.equal(enterFiring?.volumeId, 'gate');
  assert.equal(enterFiring?.other.bodyId, 'walker');

  world.removeBody('walker');
});

test('sensor triggers: a dynamic body falling through the volume forwards enter then exit', () => {
  const triggers = createSensorTriggers(world);
  const events: string[] = [];
  const entered: TriggerOther[] = [];
  triggers.add({
    id: 'pad',
    shape: { kind: 'box', halfExtents: [2, 0.05, 2] },
    position: [20, 1, 0],
    onEnter: (other) => {
      entered.push(other);
      events.push('enter');
    },
    onExit: () => events.push('exit'),
  });
  world.addBody(
    'ball',
    { shape: { kind: 'sphere', radius: 0.3 }, body: 'dynamic' },
    { position: [20, 4, 0] },
  );

  for (let i = 0; i < 120; i += 1) {
    world.step(DT);
    triggers.update();
  }
  assert.deepEqual(events, ['enter', 'exit'], 'falling through fires each edge exactly once');
  assert.equal(entered.length, 1);
  assert.equal(entered[0].bodyId, 'ball', 'the callback receives the dynamic body as the other-body');

  triggers.remove('pad');
  world.removeBody('ball');
});

test('sensor triggers: removing an overlapped volume emits no spurious callbacks (documented drop)', () => {
  const triggers = createSensorTriggers(world);
  let enters = 0;
  let exits = 0;
  triggers.add({
    id: 'lift',
    shape: { kind: 'box', halfExtents: [1, 1, 1] },
    position: [10, 0, 0],
    onEnter: () => {
      enters += 1;
    },
    onExit: () => {
      exits += 1;
    },
  });
  world.addBody(
    'rider',
    { shape: { kind: 'box', halfExtents: [0.2, 0.2, 0.2] }, body: 'kinematic' },
    { position: [10, 0, 0] },
  );
  world.step(DT);
  assert.equal(triggers.update().length, 1);
  assert.equal(enters, 1);

  assert.equal(triggers.remove('lift'), true);
  assert.equal(triggers.update().length, 0, 'the removal-driven exit dispatches to nothing');
  assert.equal(exits, 0, 'no exit callback fires for a removed volume');
  assert.equal(triggers.remove('lift'), false, 'already removed');
  assert.equal(world.activeTriggerPairs().length, 0);
  world.removeBody('rider');
});

test('sensor triggers: validation, group label and the unregister return', () => {
  const triggers = createSensorTriggers(world);
  assert.throws(
    () => triggers.add({ id: '', shape: { kind: 'box', halfExtents: [1, 1, 1] }, position: [40, 0, 0] }),
    (err: unknown) => err instanceof CreativeError && err.code === 'TRIGGER_INVALID',
  );

  const unregister = triggers.add({ id: 'v', shape: { kind: 'box', halfExtents: [1, 1, 1] }, position: [40, 0, 0] });
  assert.throws(
    () => triggers.add({ id: 'v', shape: { kind: 'box', halfExtents: [1, 1, 1] }, position: [41, 0, 0] }),
    (err: unknown) => err instanceof CreativeError && err.code === 'TRIGGER_DUPLICATE',
  );

  const collider = world.listColliders().find((c) => c.bodyId === 'trigger:v');
  assert.ok(collider?.sensor, 'the volume collider is a sensor');
  assert.equal(collider?.group, 'trigger', 'default group label');

  unregister();
  assert.deepEqual(triggers.volumeIds(), []);
  assert.ok(!world.hasBody('trigger:v'), 'unregister removes the sensor body');
});

// ---------------------------------------------------------------------------
// Physics-free path: pure AABB volumes (no Rapier)
// ---------------------------------------------------------------------------

test('triggers module: the AABB path ships zero Rapier imports', () => {
  const source = readFileSync(new URL('../../src/creative/interaction/triggers.ts', import.meta.url), 'utf8');
  assert.ok(!source.includes('@dimforge'), 'triggers.ts must not import Rapier');
  assert.ok(!source.includes('rapier'), 'triggers.ts must not mention rapier at all');
});

test('aabb triggers: enter once, stay silent, exit once; firings carry volumeId and other-body', () => {
  const triggers = createAabbTriggers();
  const log: string[] = [];
  triggers.addVolume({
    id: 'zone',
    center: [0, 0, 0],
    halfExtents: [1, 1, 1],
    onEnter: (other) => log.push(`enter:${other.bodyId}`),
    onExit: (other) => log.push(`exit:${other.bodyId}`),
  });
  triggers.trackBody('hero', { position: [5, 0, 0], halfExtents: [0.5, 0.5, 0.5] });
  assert.deepEqual(triggers.update(), [], 'apart: nothing fires');

  triggers.updateBody('hero', { position: [1.4, 0, 0], halfExtents: [0.5, 0.5, 0.5] });
  const entered = triggers.update();
  assert.deepEqual(entered.map((f) => f.kind), ['enter']);
  assert.deepEqual(entered[0], { volumeId: 'zone', kind: 'enter', other: { bodyId: 'hero' } });
  assert.deepEqual(log, ['enter:hero']);
  assert.deepEqual(triggers.activePairs(), ['zone::hero']);

  assert.deepEqual(triggers.update(), [], 'staying inside fires nothing');
  assert.deepEqual(triggers.update(), [], 'and again');

  triggers.updateBody('hero', { position: [3, 0, 0], halfExtents: [0.5, 0.5, 0.5] });
  const exited = triggers.update();
  assert.deepEqual(exited.map((f) => f.kind), ['exit']);
  assert.deepEqual(exited[0], { volumeId: 'zone', kind: 'exit', other: { bodyId: 'hero' } });
  assert.deepEqual(log, ['enter:hero', 'exit:hero']);
  assert.deepEqual(triggers.activePairs(), []);
});

test('aabb triggers: touching faces count as overlap (inclusive boundary)', () => {
  const triggers = createAabbTriggers();
  triggers.addVolume({ id: 'vol', center: [0, 0, 0], halfExtents: [1, 1, 1] });
  triggers.trackBody('cube', { position: [2, 0, 0], halfExtents: [1, 1, 1] }); // |dx| == 1+1
  assert.deepEqual(triggers.update().map((f) => f.kind), ['enter'], 'exact contact is an overlap');

  triggers.updateBody('cube', { position: [2.001, 0, 0], halfExtents: [1, 1, 1] });
  assert.deepEqual(triggers.update().map((f) => f.kind), ['exit'], 'a hair beyond the boundary leaves');
});

test('aabb triggers: untracking a body inside closes its pairs with a single exit', () => {
  const triggers = createAabbTriggers();
  const log: string[] = [];
  triggers.addVolume({
    id: 'room',
    center: [0, 0, 0],
    halfExtents: [2, 2, 2],
    onExit: (other) => log.push(`exit:${other.bodyId}`),
  });
  triggers.trackBody('guest', { position: [0, 0, 0], halfExtents: [0.5, 0.5, 0.5] });
  triggers.update();
  assert.deepEqual(triggers.activePairs(), ['room::guest']);

  assert.equal(triggers.untrackBody('guest'), true);
  assert.deepEqual(log, ['exit:guest'], 'exactly one exit per active pair');
  assert.deepEqual(triggers.activePairs(), []);
  assert.equal(triggers.untrackBody('guest'), false, 'already untracked');
  assert.equal(triggers.untrackBody('nobody'), false);
});

test('aabb triggers: removing a volume silently drops its active pairs', () => {
  const triggers = createAabbTriggers();
  let exits = 0;
  triggers.addVolume({
    id: 'pad',
    center: [0, 0, 0],
    halfExtents: [1, 1, 1],
    onExit: () => {
      exits += 1;
    },
  });
  triggers.trackBody('ball', { position: [0, 0, 0], halfExtents: [0.5, 0.5, 0.5] });
  triggers.update();
  assert.deepEqual(triggers.activePairs(), ['pad::ball']);

  assert.equal(triggers.removeVolume('pad'), true);
  assert.equal(exits, 0, 'documented: no exit callbacks on volume removal');
  assert.deepEqual(triggers.activePairs(), []);
  assert.deepEqual(triggers.update(), [], 'the removed volume is gone from the diff');
  assert.equal(triggers.removeVolume('pad'), false);
});

test('aabb triggers: validation for volume and body boxes', () => {
  const triggers = createAabbTriggers();
  assert.throws(
    () => triggers.addVolume({ id: '', center: [0, 0, 0], halfExtents: [1, 1, 1] }),
    (err: unknown) => err instanceof CreativeError && err.code === 'TRIGGER_INVALID',
  );
  triggers.addVolume({ id: 'vol', center: [0, 0, 0], halfExtents: [1, 1, 1] });
  assert.throws(
    () => triggers.addVolume({ id: 'vol', center: [1, 0, 0], halfExtents: [1, 1, 1] }),
    (err: unknown) => err instanceof CreativeError && err.code === 'TRIGGER_DUPLICATE',
  );
  assert.throws(
    () => triggers.addVolume({ id: 'neg', center: [0, 0, 0], halfExtents: [-1, 1, 1] }),
    (err: unknown) => err instanceof CreativeError && err.code === 'TRIGGER_INVALID',
  );
  assert.throws(
    () => triggers.addVolume({ id: 'nan', center: [Number.NaN, 0, 0], halfExtents: [1, 1, 1] }),
    (err: unknown) => err instanceof CreativeError && err.code === 'TRIGGER_INVALID',
  );

  assert.throws(
    () => triggers.trackBody('', { position: [0, 0, 0], halfExtents: [1, 1, 1] }),
    (err: unknown) => err instanceof CreativeError && err.code === 'TRIGGER_INVALID',
  );
  assert.throws(
    () => triggers.trackBody('bad', { position: [0, 0, 0], halfExtents: [1, Number.NaN, 1] }),
    (err: unknown) => err instanceof CreativeError && err.code === 'TRIGGER_INVALID',
  );
  assert.throws(
    () => triggers.updateBody('bad', { position: [0, 0, 0], halfExtents: [1, -0.5, 1] }),
    (err: unknown) => err instanceof CreativeError && err.code === 'TRIGGER_INVALID',
  );
});
