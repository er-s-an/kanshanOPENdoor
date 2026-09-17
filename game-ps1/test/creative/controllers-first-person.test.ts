import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import type { ActionState } from '../../src/creative/core/input-types.ts';
import type { PhysicsWorld } from '../../src/creative/physics/world.ts';
import { createPhysicsWorld } from '../../src/creative/physics/world.ts';
import { FirstPersonController } from '../../src/creative/controllers/first-person.ts';
import type { CharacterTuning } from '../../src/creative/controllers/kinematic-character.ts';

let world: PhysicsWorld;
const DT = 1 / 60;

const TUNING: CharacterTuning = {
  speed: 3,
  radius: 0.3,
  height: 1.8,
  gravity: 9.81,
  jumpSpeed: 5,
  maxSlopeAngle: (45 * Math.PI) / 180,
  maxStepHeight: 0.4,
};

function makeActions(partial: {
  axes?: Record<string, number>;
  pressed?: string[];
  held?: string[];
}): ActionState {
  return {
    pressed: (a) => partial.pressed?.includes(a) ?? false,
    held: (a) => partial.held?.includes(a) ?? false,
    released: () => false,
    axis: (n) => partial.axes?.[n] ?? 0,
  };
}

const IDLE = makeActions({});

before(async () => {
  world = await createPhysicsWorld();
  // One large ground slab: x -180..220, z -30..30 (the coyote ledge lives at z=100, off this slab).
  world.addBody(
    'floor',
    { shape: { kind: 'box', halfExtents: [200, 0.5, 30] }, body: 'static' },
    { position: [20, -0.5, 0] },
  );
  world.step(DT);
});

test('gravity: the character settles grounded on the floor', () => {
  const player = new FirstPersonController(world, TUNING, { id: 'g1', spawn: [0, 1.2, 0] });
  let groundedAt = -1;
  for (let i = 0; i < 60; i += 1) {
    const info = player.update(IDLE, 0, DT);
    world.step(DT);
    if (info.grounded) groundedAt = i;
  }
  assert.ok(groundedAt >= 0, 'became grounded');
  assert.ok(Math.abs(player.position[1] - 0.9) < 0.05, `rest height is capsule half height, y=${player.position[1]}`);
  assert.ok(player.grounded, 'still grounded while idle');
  player.dispose();
  assert.equal(world.hasBody('g1'), false);
});

test('gravity + jump: full arc rises to ~v^2/2g and lands back grounded', () => {
  const player = new FirstPersonController(world, TUNING, { id: 'j1', spawn: [10, 1.2, 0] });
  for (let i = 0; i < 60; i += 1) {
    player.update(IDLE, 0, DT);
    world.step(DT);
  }
  const restY = player.position[1];
  assert.ok(player.grounded);

  let apex = restY;
  let sawAirborne = false;
  const jump = makeActions({ pressed: ['jump'], held: ['jump'] });
  player.update(jump, 0, DT);
  world.step(DT);
  for (let i = 0; i < 120; i += 1) {
    const info = player.update(IDLE, 0, DT);
    world.step(DT);
    apex = Math.max(apex, player.position[1]);
    if (!info.grounded) sawAirborne = true;
  }
  const expectedApex = (TUNING.jumpSpeed * TUNING.jumpSpeed) / (2 * TUNING.gravity);
  assert.ok(sawAirborne, 'was airborne during the arc');
  assert.ok(
    Math.abs(apex - restY - expectedApex) < 0.2,
    `apex rise ~${expectedApex.toFixed(2)}, got ${(apex - restY).toFixed(2)}`,
  );
  assert.ok(player.grounded, 'landed');
  assert.ok(Math.abs(player.position[1] - restY) < 0.08, `back to rest height, y=${player.position[1]}`);
  player.dispose();
});

test('jump requires the pressed edge (held alone does nothing)', () => {
  const player = new FirstPersonController(world, TUNING, { id: 'j2', spawn: [20, 1.2, 0] });
  for (let i = 0; i < 60; i += 1) {
    player.update(IDLE, 0, DT);
    world.step(DT);
  }
  const restY = player.position[1];
  const heldOnly = makeActions({ held: ['jump'] });
  for (let i = 0; i < 30; i += 1) {
    player.update(heldOnly, 0, DT);
    world.step(DT);
  }
  assert.ok(Math.abs(player.position[1] - restY) < 0.05, 'no edge, no jump');
  player.dispose();
});

test('custom action bindings are honored', () => {
  const player = new FirstPersonController(world, TUNING, {
    id: 'j3',
    spawn: [30, 1.2, 0],
    bindings: { jumpAction: 'leap', moveYAxis: 'push' },
  });
  for (let i = 0; i < 60; i += 1) {
    player.update(IDLE, 0, DT);
    world.step(DT);
  }
  const z0 = player.position[2];
  for (let i = 0; i < 30; i += 1) {
    player.update(makeActions({ axes: { push: 1 } }), 0, DT);
    world.step(DT);
  }
  assert.ok(player.position[2] < z0 - 0.5, 'moved along the custom axis');
  player.dispose();
});

test('camera yaw maps ActionState axes to world directions', () => {
  const spawn: [number, number, number] = [40, 1.2, 0];
  const forward = makeActions({ axes: { 'move.y': 1 } });
  const run = (yaw: number, id: string) => {
    const player = new FirstPersonController(world, TUNING, { id, spawn });
    for (let i = 0; i < 60; i += 1) {
      player.update(IDLE, yaw, DT);
      world.step(DT);
    }
    const start = [...player.position];
    for (let i = 0; i < 60; i += 1) {
      player.update(forward, yaw, DT);
      world.step(DT);
    }
    const dx = player.position[0] - start[0];
    const dz = player.position[2] - start[2];
    player.dispose();
    return [dx, dz];
  };
  let [dx, dz] = run(0, 'yaw-0');
  assert.ok(Math.abs(dx) < 0.15 && dz < -1.5, `yaw 0 walks -z, got [${dx}, ${dz}]`);
  [dx, dz] = run(Math.PI, 'yaw-pi');
  assert.ok(Math.abs(dx) < 0.15 && dz > 1.5, `yaw PI walks +z, got [${dx}, ${dz}]`);
  [dx, dz] = run(Math.PI / 2, 'yaw-half-pi');
  assert.ok(dx < -1.5 && Math.abs(dz) < 0.15, `yaw PI/2 walks -x, got [${dx}, ${dz}]`);
  [dx, dz] = run(-Math.PI / 2, 'yaw-neg-half-pi');
  assert.ok(dx > 1.5 && Math.abs(dz) < 0.15, `yaw -PI/2 walks +x, got [${dx}, ${dz}]`);
});

test('slope limit: a 30-degree ramp climbs, a 55-degree ramp rejects', () => {
  // 30-degree ramp along +x
  const angle30 = (30 * Math.PI) / 180;
  const L30 = 4;
  world.addBody(
    'ramp-30',
    {
      shape: { kind: 'box', halfExtents: [L30 / 2, 0.05, 1.5] },
      body: 'static',
    },
    {
      position: [(L30 / 2) * Math.cos(angle30) + 1, (L30 / 2) * Math.sin(angle30), 0],
      quaternion: [0, 0, Math.sin(angle30 / 2), Math.cos(angle30 / 2)],
    },
  );
  // 55-degree ramp along +x, further out
  const angle55 = (55 * Math.PI) / 180;
  const L55 = 4;
  world.addBody(
    'ramp-55',
    {
      shape: { kind: 'box', halfExtents: [L55 / 2, 0.05, 1.5] },
      body: 'static',
    },
    {
      position: [(L55 / 2) * Math.cos(angle55) + 60, (L55 / 2) * Math.sin(angle55), 0],
      quaternion: [0, 0, Math.sin(angle55 / 2), Math.cos(angle55 / 2)],
    },
  );
  world.step(DT);

  const climber = new FirstPersonController(world, TUNING, { id: 's1', spawn: [0.2, 1.2, 0] });
  for (let i = 0; i < 60; i += 1) {
    climber.update(IDLE, 0, DT);
    world.step(DT);
  }
  const startX = climber.position[0];
  for (let i = 0; i < 60; i += 1) {
    climber.update(makeActions({ axes: { 'move.y': 1 } }), -Math.PI / 2, DT); // +x
    world.step(DT);
  }
  assert.ok(climber.position[0] - startX > 1.8, `climbed the 30-degree ramp (dx=${climber.position[0] - startX})`);
  assert.ok(climber.position[1] > 1.5, `gained height (y=${climber.position[1]})`);
  climber.dispose();

  const blocked = new FirstPersonController(world, TUNING, { id: 's2', spawn: [59, 1.2, 0] });
  for (let i = 0; i < 60; i += 1) {
    blocked.update(IDLE, 0, DT);
    world.step(DT);
  }
  const startX2 = blocked.position[0];
  for (let i = 0; i < 120; i += 1) {
    blocked.update(makeActions({ axes: { 'move.y': 1 } }), -Math.PI / 2, DT);
    world.step(DT);
  }
  assert.ok(
    blocked.position[0] - startX2 < 1.0,
    `55-degree ramp is unclimbable at a 45-degree limit (dx=${blocked.position[0] - startX2})`,
  );
  assert.ok(blocked.position[1] < 1.6, `did not gain the ramp (y=${blocked.position[1]})`);
  blocked.dispose();
});

test('step height: climbs a 0.3m step, blocked by a 0.6m wall', () => {
  world.addBody(
    'step-03',
    { shape: { kind: 'box', halfExtents: [0.4, 0.15, 1.5] }, body: 'static' },
    { position: [101.2, 0.075, 0] },
  );
  world.addBody(
    'wall-06',
    { shape: { kind: 'box', halfExtents: [0.4, 0.3, 1.5] }, body: 'static' },
    { position: [201.2, 0.3, 0] },
  );
  world.step(DT);

  const stepper = new FirstPersonController(world, TUNING, { id: 'st1', spawn: [100, 1.2, 0] });
  for (let i = 0; i < 60; i += 1) {
    stepper.update(IDLE, 0, DT);
    world.step(DT);
  }
  let maxStepTopY = 0;
  for (let i = 0; i < 90; i += 1) {
    stepper.update(makeActions({ axes: { 'move.y': 1 } }), -Math.PI / 2, DT);
    world.step(DT);
    const x = stepper.position[0];
    if (x > 100.9 && x < 101.7) maxStepTopY = Math.max(maxStepTopY, stepper.position[1]);
  }
  assert.ok(stepper.position[0] > 101.7, `climbed the 0.3m step (x=${stepper.position[0]})`);
  assert.ok(
    Math.abs(maxStepTopY - (0.3 + 0.9)) < 0.1,
    `stood on the step while crossing it (sampled y=${maxStepTopY})`,
  );
  stepper.dispose();

  const blockedByWall = new FirstPersonController(world, TUNING, { id: 'st2', spawn: [200, 1.2, 0] });
  for (let i = 0; i < 60; i += 1) {
    blockedByWall.update(IDLE, 0, DT);
    world.step(DT);
  }
  for (let i = 0; i < 120; i += 1) {
    blockedByWall.update(makeActions({ axes: { 'move.y': 1 } }), -Math.PI / 2, DT);
    world.step(DT);
  }
  assert.ok(blockedByWall.position[0] < 200.7, `0.6m wall blocks (x=${blockedByWall.position[0]})`);
  assert.ok(Math.abs(blockedByWall.position[1] - 0.9) < 0.08, `stayed at floor level (y=${blockedByWall.position[1]})`);
  blockedByWall.dispose();
});

test('coyote time: parameterized grace window lets the jump happen just after leaving ground', () => {
  // platform ends at x = 0; character walks +x off the edge
  world.addBody(
    'ledge',
    { shape: { kind: 'box', halfExtents: [2.5, 0.5, 3] }, body: 'static' },
    { position: [-2.5, -0.5, 100] },
  );
  world.step(DT);
  const withCoyote = new FirstPersonController(
    world,
    { ...TUNING, coyoteTime: 0.15 },
    { id: 'c1', spawn: [-1.5, 0.9, 100] },
  );
  for (let i = 0; i < 60; i += 1) {
    withCoyote.update(IDLE, 0, DT);
    world.step(DT);
  }
  // walk off the edge, jump 6 frames (0.1s) after becoming airborne — inside the 0.15s window
  let stepsAfterAirborne = 0;
  let jumped = false;
  let peakY = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < 200 && withCoyote.position[1] > -1; i += 1) {
    const shouldJump = !jumped && stepsAfterAirborne === 6;
    const actions = shouldJump ? makeActions({ pressed: ['jump'] }) : makeActions({ axes: { 'move.y': 1 } });
    const info = withCoyote.update(actions, -Math.PI / 2, DT);
    world.step(DT);
    peakY = Math.max(peakY, withCoyote.position[1]);
    if (shouldJump) jumped = true;
    if (!info.grounded) stepsAfterAirborne += 1;
  }
  assert.ok(jumped, 'jump fired within the coyote window');
  assert.ok(peakY > 1.5, `coyote jump produced a full arc after leaving the ledge (peak y=${peakY})`);
  withCoyote.dispose();

  const noCoyote = new FirstPersonController(world, TUNING, { id: 'c2', spawn: [-1.5, 0.9, 100] });
  for (let i = 0; i < 60; i += 1) {
    noCoyote.update(IDLE, 0, DT);
    world.step(DT);
  }
  let fellSteps = 0;
  let lateJumpUsed = false;
  let noCoyotePeak = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < 200 && noCoyote.position[1] > -1; i += 1) {
    const shouldJump = !lateJumpUsed && fellSteps === 6;
    const actions = shouldJump ? makeActions({ pressed: ['jump'] }) : makeActions({ axes: { 'move.y': 1 } });
    const info = noCoyote.update(actions, -Math.PI / 2, DT);
    world.step(DT);
    noCoyotePeak = Math.max(noCoyotePeak, noCoyote.position[1]);
    if (shouldJump) lateJumpUsed = true;
    if (!info.grounded) fellSteps += 1;
  }
  assert.ok(lateJumpUsed, 'the late jump input was attempted');
  assert.ok(
    noCoyotePeak < 1.05,
    `without coyote time the late jump is rejected (peak y=${noCoyotePeak}, a real jump would peak ~2.2)`,
  );
  assert.ok(noCoyote.position[1] < -0.5, `character fell below the ledge (y=${noCoyote.position[1]})`);
  noCoyote.dispose();
});

test('controller dispose releases the character controller and body', () => {
  const player = new FirstPersonController(world, TUNING, { id: 'd1', spawn: [50, 1.2, 50] });
  for (let i = 0; i < 10; i += 1) {
    player.update(IDLE, 0, DT);
    world.step(DT);
  }
  player.dispose();
  assert.equal(world.hasBody('d1'), false);
  assert.throws(() => player.update(IDLE, 0, DT), /disposed/i);
});
