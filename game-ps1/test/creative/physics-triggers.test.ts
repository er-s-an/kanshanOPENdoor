import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import type { PhysicsWorld } from '../../src/creative/physics/world.ts';
import type { TriggerEvent } from '../../src/creative/physics/world.ts';
import { createPhysicsWorld } from '../../src/creative/physics/world.ts';

let world: PhysicsWorld;
const DT = 1 / 60;

before(async () => {
  world = await createPhysicsWorld();
});

test('triggers: walk in -> enter once, stay -> no repeat, walk out -> exit once', () => {
  world.addBody(
    'zone',
    { shape: { kind: 'box', halfExtents: [0.6, 0.6, 0.6] }, body: 'static', sensor: true },
    { position: [0, 0, 0] },
  );
  world.addBody(
    'walker',
    { shape: { kind: 'box', halfExtents: [0.2, 0.2, 0.2] }, body: 'kinematic' },
    { position: [-2, 0, 0] },
  );
  world.step(DT);

  const enters: TriggerEvent[] = [];
  const exits: TriggerEvent[] = [];
  let insideStepsWithEvents = 0;
  for (let i = 0; i < 80; i += 1) {
    const x = -2 + (i + 1) * 0.05;
    world.setKinematicTarget('walker', [x, 0, 0]);
    world.step(DT);
    const events = world.drainTriggers();
    const wasInside = x > -0.7 && x < 0.7; // 0.1 margin away from the ±0.8 contact boundary
    for (const e of events) {
      if (e.kind === 'enter') enters.push(e);
      else exits.push(e);
    }
    if (wasInside && events.length > 0) insideStepsWithEvents += 1;
  }

  assert.equal(enters.length, 1, `exactly one enter, got ${enters.length}`);
  assert.equal(exits.length, 1, `exactly one exit, got ${exits.length}`);
  assert.equal(insideStepsWithEvents, 0, 'staying inside generates no further events');
  const enter = enters[0];
  const ids = [enter.a.bodyId, enter.b.bodyId].sort();
  assert.deepEqual(ids, ['walker', 'zone'], 'enter event carries both pair handles');
  assert.ok(enter.a.colliderHandle !== undefined && enter.b.colliderHandle !== undefined);
  const exit = exits[0];
  assert.deepEqual([exit.a.bodyId, exit.b.bodyId].sort(), ['walker', 'zone']);
  assert.equal(world.activeTriggerPairs().length, 0, 'no lingering active pair after walking out');
});

test('triggers: dynamic body falling through a sensor generates enter then exit', () => {
  world.addBody(
    'pad',
    { shape: { kind: 'box', halfExtents: [2, 0.05, 2] }, body: 'static', sensor: true },
    { position: [10, 1, 0] },
  );
  world.addBody(
    'ball',
    { shape: { kind: 'sphere', radius: 0.3 }, body: 'dynamic' },
    { position: [10, 4, 0] },
  );
  const kinds: string[] = [];
  for (let i = 0; i < 120; i += 1) {
    world.step(DT);
    for (const e of world.drainTriggers()) kinds.push(`${e.kind}:${e.a.bodyId}-${e.b.bodyId}`);
  }
  const enterIdx = kinds.findIndex((k) => k.startsWith('enter'));
  const exitIdx = kinds.findIndex((k) => k.startsWith('exit'));
  assert.ok(enterIdx >= 0, 'enter fired while falling through');
  assert.ok(exitIdx > enterIdx, 'exit fired after enter once the ball left the pad');
  assert.equal(kinds.filter((k) => k.startsWith('enter')).length, 1);
  assert.equal(kinds.filter((k) => k.startsWith('exit')).length, 1);
});

test('triggers: removing a sensor while overlapped emits a single exit and clears the pair', () => {
  world.addBody(
    'zone2',
    { shape: { kind: 'box', halfExtents: [1, 1, 1] }, body: 'static', sensor: true },
    { position: [20, 0, 0] },
  );
  world.addBody(
    'probe',
    { shape: { kind: 'box', halfExtents: [0.2, 0.2, 0.2] }, body: 'kinematic' },
    { position: [20, 0, 0] },
  );
  world.step(DT);
  const entered = world.drainTriggers();
  assert.equal(entered.length, 1);
  assert.equal(entered[0].kind, 'enter');
  assert.equal(world.activeTriggerPairs().length, 1);

  assert.equal(world.removeBody('zone2'), true);
  const removed = world.drainTriggers();
  assert.equal(removed.length, 1);
  assert.equal(removed[0].kind, 'exit', 'pair is closed honestly when the sensor is removed');
  assert.deepEqual([removed[0].a.bodyId, removed[0].b.bodyId].sort(), ['probe', 'zone2']);
  assert.equal(world.activeTriggerPairs().length, 0);
  world.step(DT);
  assert.deepEqual(world.drainTriggers(), []);
});

test('triggers: non-sensor contacts never appear in the trigger stream', () => {
  world.addBody(
    'solid-block',
    { shape: { kind: 'box', halfExtents: [0.5, 0.5, 0.5] }, body: 'static' },
    { position: [30, 0, 0] },
  );
  world.addBody(
    'dropper',
    { shape: { kind: 'sphere', radius: 0.2 }, body: 'dynamic' },
    { position: [30, 2, 0] },
  );
  for (let i = 0; i < 90; i += 1) world.step(DT);
  assert.deepEqual(world.drainTriggers(), [], 'solid impacts are contacts, not triggers');
  assert.ok(
    world.contacts().some((c) => c.a === 'dropper' || c.b === 'dropper'),
    'the same impact shows up in the contact debug listing instead',
  );
});
