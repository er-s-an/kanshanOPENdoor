import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import type { ActionState } from '../../src/creative/core/input-types.ts';
import type { PhysicsWorld } from '../../src/creative/physics/world.ts';
import { createPhysicsWorld } from '../../src/creative/physics/world.ts';
import { TopDownController } from '../../src/creative/controllers/top-down.ts';
import type { CharacterTuning } from '../../src/creative/controllers/kinematic-character.ts';

let world: PhysicsWorld;
const DT = 1 / 60;

const TUNING: CharacterTuning = {
  speed: 4,
  radius: 0.35,
  height: 1.6,
  gravity: 9.81,
  jumpSpeed: 4.5,
  maxSlopeAngle: (40 * Math.PI) / 180,
  maxStepHeight: 0.35,
};

function makeActions(partial: { axes?: Record<string, number>; pressed?: string[] }): ActionState {
  return {
    pressed: (a) => partial.pressed?.includes(a) ?? false,
    held: () => false,
    released: () => false,
    axis: (n) => partial.axes?.[n] ?? 0,
  };
}

const IDLE = makeActions({});

before(async () => {
  world = await createPhysicsWorld();
  world.addBody(
    'floor',
    { shape: { kind: 'box', halfExtents: [8, 0.5, 8] }, body: 'static' },
    { position: [0, -0.5, 0] },
  );
  world.step(DT);
});

test('top-down: movement is relative to the camera yaw', () => {
  const spawn: [number, number, number] = [0, 1.0, 0];
  const run = (yaw: number, id: string) => {
    const hero = new TopDownController(world, TUNING, { id, spawn });
    for (let i = 0; i < 60; i += 1) {
      hero.update(IDLE, yaw, DT);
      world.step(DT);
    }
    const start = [...hero.position];
    for (let i = 0; i < 60; i += 1) {
      hero.update(makeActions({ axes: { 'move.y': 1 } }), yaw, DT);
      world.step(DT);
    }
    const dx = hero.position[0] - start[0];
    const dz = hero.position[2] - start[2];
    hero.dispose();
    return [dx, dz];
  };
  let [dx, dz] = run(0, 'td-yaw-0');
  assert.ok(Math.abs(dx) < 0.15 && dz < -2, `screen-up walks -z at yaw 0, got [${dx}, ${dz}]`);
  [dx, dz] = run(Math.PI / 4, 'td-yaw-quarter');
  assert.ok(dx < -1 && dz < -1, `screen-up splits -x/-z at yaw PI/4, got [${dx}, ${dz}]`);
  [dx, dz] = run(Math.PI / 2, 'td-yaw-half');
  assert.ok(dx < -2 && Math.abs(dz) < 0.15, `screen-up walks -x at yaw PI/2, got [${dx}, ${dz}]`);
});

test('top-down: strafe axis moves screen-right', () => {
  const hero = new TopDownController(world, TUNING, { id: 'td-strafe', spawn: [0, 1.0, 0] });
  for (let i = 0; i < 60; i += 1) {
    hero.update(IDLE, 0, DT);
    world.step(DT);
  }
  const start = [...hero.position];
  for (let i = 0; i < 60; i += 1) {
    hero.update(makeActions({ axes: { 'move.x': 1 } }), 0, DT);
    world.step(DT);
  }
  assert.ok(hero.position[0] - start[0] > 2, 'move.x strafes along screen-right (+x at yaw 0)');
  hero.dispose();
});

test('top-down: faceMovement yaws the character root toward its motion', () => {
  const hero = new TopDownController(world, TUNING, { id: 'td-face', spawn: [0, 1.0, 0], faceMovement: true });
  for (let i = 0; i < 60; i += 1) {
    hero.update(IDLE, 0, DT);
    world.step(DT);
  }
  assert.equal(hero.object.rotation.y, 0, 'no movement, no facing change');
  for (let i = 0; i < 30; i += 1) {
    hero.update(makeActions({ axes: { 'move.y': 1 } }), Math.PI / 2, DT); // walks -x
    world.step(DT);
  }
  assert.ok(Math.abs(hero.object.rotation.y - Math.atan2(-1, 0)) < 1e-6, 'faces the -x motion');
  hero.dispose();
});

test('top-down: gravity, grounded and jump work like the FP controller', () => {
  const hero = new TopDownController(world, TUNING, { id: 'td-jump', spawn: [5, 1.4, 5] });
  for (let i = 0; i < 60; i += 1) {
    hero.update(IDLE, 0, DT);
    world.step(DT);
  }
  assert.ok(hero.grounded, 'settled grounded');
  const restY = hero.position[1];
  const apex = { y: restY };
  hero.update(makeActions({ pressed: ['jump'] }), 0, DT);
  world.step(DT);
  for (let i = 0; i < 120; i += 1) {
    hero.update(IDLE, 0, DT);
    world.step(DT);
    apex.y = Math.max(apex.y, hero.position[1]);
  }
  const expected = (TUNING.jumpSpeed * TUNING.jumpSpeed) / (2 * TUNING.gravity);
  assert.ok(Math.abs(apex.y - restY - expected) < 0.2, `arc apex ~${expected.toFixed(2)}, got ${(apex.y - restY).toFixed(2)}`);
  assert.ok(hero.grounded, 'landed grounded');
  hero.dispose();
});

test('top-down: debugInfo exposes grounded facts for inspect tools', () => {
  const hero = new TopDownController(world, TUNING, { id: 'td-debug', spawn: [-5, 1.0, -5] });
  for (let i = 0; i < 60; i += 1) {
    hero.update(IDLE, 0, DT);
    world.step(DT);
  }
  const info = hero.debugInfo();
  assert.equal(info.bodyId, 'td-debug');
  assert.equal(info.grounded, true);
  assert.ok(Math.abs(info.position[1] - 0.8) < 0.05, `half of the 1.6m height, got ${info.position[1]}`);
  assert.equal(info.groundBodyId, 'floor');
  hero.dispose();
});
