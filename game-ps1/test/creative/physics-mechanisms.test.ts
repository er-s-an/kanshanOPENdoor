import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { ActionState } from '../../src/creative/core/input-types.ts';
import type { PhysicsWorld } from '../../src/creative/physics/world.ts';
import { createPhysicsWorld } from '../../src/creative/physics/world.ts';
import { MovingPlatform, RotaryDoor, SlidingDoor, driveMechanism } from '../../src/creative/physics/mechanisms.ts';
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

function idle(): ActionState {
  return {
    pressed: () => false,
    held: () => false,
    released: () => false,
    axis: () => 0,
  };
}

function walkForward(): ActionState {
  return {
    pressed: () => false,
    held: (a) => a === 'jump',
    released: () => false,
    axis: (n) => (n === 'move.y' ? 1 : 0),
  };
}

function addFloor(id: string, center: [number, number, number], half: [number, number, number]): void {
  world.addBody(
    id,
    { shape: { kind: 'box', halfExtents: half }, body: 'static' },
    { position: center },
  );
}

before(async () => {
  world = await createPhysicsWorld();
});

test('sliding door: closed blocks the character, open lets them through', () => {
  addFloor('floor-a', [0, -0.5, 0], [6, 0.5, 6]);
  const door = new SlidingDoor(world, {
    id: 'door-a',
    width: 1.4,
    height: 2.2,
    closedPosition: [0, 1.1, 0],
    openOffset: [0, 2.4, 0],
    duration: 0.5,
  });
  assert.equal(door.isClosed, true);
  assert.ok(door.object.children[0] instanceof THREE.Mesh, 'render panel exists');
  driveMechanism(world, door, DT);

  const player = new FirstPersonController(world, TUNING, { id: 'player-a', spawn: [0, 1.0, -2.5] });
  // settle, then push into the closed door for 2 seconds (yaw PI = walk +z)
  for (let i = 0; i < 30; i += 1) {
    player.update(idle(), 0, DT);
    world.step(DT);
  }
  assert.ok(player.grounded, 'player settled on the floor');
  for (let i = 0; i < 120; i += 1) {
    player.update(walkForward(), Math.PI, DT);
    world.step(DT);
  }
  assert.ok(player.position[2] < -0.2, `closed door blocks before the doorway, got z=${player.position[2]}`);

  // open the door fully, then walk through
  door.open();
  for (let i = 0; i < 45; i += 1) world.step(DT);
  assert.equal(door.isOpen, true);
  assert.ok(Math.abs(door.object.position.y - (1.1 + 2.4)) < 1e-6, 'render pose follows the same target as the collider');
  for (let i = 0; i < 120; i += 1) {
    player.update(walkForward(), Math.PI, DT);
    world.step(DT);
  }
  assert.ok(player.position[2] > 0.6, `open door lets the character through, z=${player.position[2]}`);

  // close it again; the kinematic target returns to the doorway pose
  door.close();
  for (let i = 0; i < 45; i += 1) world.step(DT);
  assert.equal(door.isClosed, true);
  const closedHit = world.raycast([0, 1.1, -3], [0, 0, 1], 6);
  assert.equal(closedHit?.bodyId, 'door-a', 'closed door blocks rays through the doorway again');
  player.dispose();
  door.dispose();
  assert.equal(world.hasBody('door-a'), false, 'dispose removes the kinematic body');
});

test('rotary door: closed blocks, rotated open clears the doorway', () => {
  addFloor('floor-b', [20, -0.5, 0], [6, 0.5, 6]);
  const door = new RotaryDoor(world, {
    id: 'door-b',
    width: 1.2,
    height: 2.2,
    hinge: [19.4, 0, 0],
    closedYaw: 0,
    openYaw: Math.PI / 2,
    duration: 0.5,
  });
  driveMechanism(world, door, DT);
  const player = new FirstPersonController(world, TUNING, { id: 'player-b', spawn: [20, 1.0, -2.5] });
  for (let i = 0; i < 30; i += 1) {
    player.update(idle(), 0, DT);
    world.step(DT);
  }
  for (let i = 0; i < 120; i += 1) {
    player.update(walkForward(), Math.PI, DT); // +z, through the doorway at x≈20
    world.step(DT);
  }
  assert.ok(player.position[2] < -0.2, `closed rotary door blocks before the doorway, z=${player.position[2]}`);

  door.open();
  for (let i = 0; i < 45; i += 1) world.step(DT);
  assert.equal(door.isOpen, true);
  for (let i = 0; i < 120; i += 1) {
    player.update(walkForward(), Math.PI, DT);
    world.step(DT);
  }
  assert.ok(player.position[2] > 0.6, `open rotary door clears the way, z=${player.position[2]}`);
  player.dispose();
  door.dispose();
});

test('moving platform: carries the character horizontally', () => {
  addFloor('floor-c', [40, -0.6, 0], [8, 0.1, 8]);
  const platform = new MovingPlatform(world, {
    id: 'platform-h',
    size: [2, 0.2, 2],
    from: [40, 0.1, 0],
    to: [44, 0.1, 0],
    seconds: 2,
    dwell: 0.3,
  });
  driveMechanism(world, platform, DT);
  const player = new FirstPersonController(world, TUNING, { id: 'player-c', spawn: [40, 1.11, 0] });
  for (let i = 0; i < 30; i += 1) {
    player.update(idle(), 0, DT);
    world.step(DT);
  }
  assert.ok(player.grounded, 'character stands on the platform');
  const px0 = platform.position[0];
  // ride for 2 seconds of travel: the platform reaches the far end and dwells
  for (let i = 0; i < 120; i += 1) {
    player.update(idle(), 0, DT);
    world.step(DT);
  }
  const px1 = platform.position[0];
  assert.ok(px1 - px0 > 2.5, `platform travelled (from ${px0} to ${px1})`);
  assert.ok(
    Math.abs(player.position[0] - px1) < 0.15,
    `character was carried with the platform (player x=${player.position[0]}, platform x=${px1})`,
  );
  assert.ok(Math.abs(player.position[1] - 1.11) < 0.12, `character stayed on deck (y=${player.position[1]})`);
  assert.ok(player.grounded, 'still grounded after the ride');
  player.dispose();
  platform.dispose();
});

test('moving platform: carries the character vertically upward', () => {
  addFloor('floor-d', [60, -0.6, 0], [8, 0.1, 8]);
  const platform = new MovingPlatform(world, {
    id: 'platform-v',
    size: [2, 0.2, 2],
    from: [60, 0.1, 0],
    to: [60, 2.1, 0],
    seconds: 3,
    dwell: 0.5,
  });
  driveMechanism(world, platform, DT);
  const player = new FirstPersonController(world, TUNING, { id: 'player-d', spawn: [60, 1.11, 0] });
  // ride upward for 3.6s (past arrival + dwell start)
  let groundedSamples = 0;
  for (let i = 0; i < 216; i += 1) {
    player.update(idle(), 0, DT);
    world.step(DT);
    if (player.grounded) groundedSamples += 1;
  }
  const top = platform.position[1] + 0.1;
  assert.ok(platform.position[1] > 1.9, `platform rose (y=${platform.position[1]})`);
  assert.ok(
    Math.abs(player.position[1] - (top + 0.9)) < 0.12,
    `character rose with the platform (player y=${player.position[1]}, expected ~${top + 0.9})`,
  );
  assert.ok(groundedSamples > 150, `character stayed grounded most of the ride (${groundedSamples}/216)`);
  player.dispose();
  platform.dispose();
});

test('mechanism render pose and collider pose come from the one target transform', () => {
  const platform = new MovingPlatform(world, {
    id: 'platform-sync',
    size: [1, 0.2, 1],
    from: [80, 0, 0],
    to: [81, 0, 0],
    seconds: 1,
  });
  for (let i = 0; i < 30; i += 1) {
    platform.update(DT);
    world.step(DT);
  }
  const colliderX = world.listColliders().find((c) => c.bodyId === 'platform-sync')!.position[0];
  // Rapier stores translations as f32: compare at f32 precision
  assert.ok(Math.abs(colliderX - platform.object.position.x) < 1e-4, 'collider and render pose agree exactly');
  assert.ok(Math.abs(colliderX - platform.target.position.x) < 1e-4, 'both come from the single target transform');
  platform.dispose();
});

test('mechanisms without driveMechanism stay put until update is called', () => {
  const door = new SlidingDoor(world, {
    id: 'door-manual',
    width: 1,
    height: 2,
    closedPosition: [90, 1, 0],
    openOffset: [0, 2.2, 0],
    duration: 0.25,
  });
  door.open();
  for (let i = 0; i < 30; i += 1) world.step(DT);
  assert.equal(door.isMoving, true, 'still waiting for mechanism code');
  assert.equal(door.isOpen, false);
  door.update(0.25);
  assert.ok(door.isOpen, 'update(dt) advances the mechanism clock');
  door.dispose();
});
