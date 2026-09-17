/**
 * 窄门 · Narrow Gate — synthetic acceptance fixture (not a shipped work).
 *
 * One room, one wall at z=WALL_Z with a real 1.6m opening; a gate panel
 * covers the opening from the right, leaving a free gap of
 * `gate.opening-width` meters from the opening's LEFT edge. The player
 * (radius 0.25) walks straight along x=-0.6. With the default 0.4m gap the
 * panel blocks the route; widening the exposed parameter lets them pass.
 *
 * Wired entirely through public engine systems: wallWithOpening/floorPolygon,
 * PhysicsWorld, FirstPersonController over ActionMapper + injected device.
 * The tool-loop test patches only the exposed parameter — no code edits.
 */
import * as THREE from './three.ts';
import type { SceneContext, SceneInstance, SceneModule } from '../../../src/creative/core/context.ts';
import type { Vec3 } from '../../../src/creative/core/spatial.ts';
import type { ActionState } from '../../../src/creative/core/input-types.ts';
import type { ParameterDef, ParameterRegistry } from '../../../src/creative/scene/authoring.ts';
import { exposeParameters } from '../../../src/creative/scene/authoring.ts';
import { wallWithOpening, floorPolygon } from '../../../src/creative/scene/helpers.ts';
import type { PhysicsWorld, PhysicsBody } from '../../../src/creative/physics/world.ts';
import { installPhysics } from '../../../src/creative/physics/world.ts';
import { FirstPersonController } from '../../../src/creative/controllers/first-person.ts';
import type { CharacterTuning } from '../../../src/creative/controllers/kinematic-character.ts';
import { ActionMapper } from '../../../src/creative/input/mapper.ts';
import { fpsDefaults } from '../../../src/creative/input/defaults.ts';
import { HeadlessInputDevice } from '../../../src/creative/input/headless.ts';
import { DomInputDevice } from '../../../src/creative/input/dom.ts';
import type { InputDevice } from '../../../src/creative/input/types.ts';

export const WALL_Z = -5;
export const WALL_THICKNESS = 0.3;
export const OPENING_WIDTH_FULL = 1.6;
export const OPENING_LEFT_X = -1.1; // opening spans [-1.1, 0.5]
export const GATE_HEIGHT = 2.2;
export const SPAWN: Vec3 = [-0.6, 0.05, 2];
export const GOAL_Z = -6.5;
export const PLAYER_RADIUS = 0.25;

const TUNING: CharacterTuning = {
  speed: 2.4,
  radius: PLAYER_RADIUS,
  height: 1.7,
  gravity: 9.81,
  jumpSpeed: 5,
  maxSlopeAngle: (45 * Math.PI) / 180,
  maxStepHeight: 0.4,
};

export function describeParameters(): ParameterDef[] {
  return [
    {
      authorId: 'gate.opening-width',
      schemaVersion: 1,
      description: 'Free gap width (m) left of the gate panel',
      value: 0.4,
      validate: (v) =>
        typeof v === 'number' && Number.isFinite(v) && v >= 0.3 && v <= OPENING_WIDTH_FULL
          ? true
          : `opening width must be in [0.3, ${OPENING_WIDTH_FULL}]`,
    },
  ];
}

export interface NarrowGateOptions {
  device?: InputDevice;
}

export interface NarrowGateHandles {
  readonly physics: PhysicsWorld;
  readonly player: FirstPersonController;
  readonly params: ParameterRegistry;
  readonly device: InputDevice;
  goalReached(): boolean;
}

export function createNarrowGateModule(opts?: NarrowGateOptions): SceneModule & { handles?: NarrowGateHandles } {
  const module: SceneModule & { handles?: NarrowGateHandles } = {
    async create(ctx: SceneContext): Promise<SceneInstance> {
      const root = new THREE.Group();
      root.name = 'narrow-gate';
      root.userData.authorId = 'narrow-gate/root';

      const physics = await installPhysics(ctx, {});
      const device =
        opts?.device ??
        (typeof globalThis.window !== 'undefined'
          ? new DomInputDevice({ scope: ctx.scope })
          : new HeadlessInputDevice());
      const mapper = new ActionMapper(fpsDefaults, device, { scope: ctx.scope });
      let viewYaw = 0;

      const floor = floorPolygon([
        [-3, 3],
        [3, 3],
        [3, -8],
        [-3, -8],
      ]);
      root.add(floor.object);
      floor.colliders.forEach((c, i) => physics.addBody(`floor-${i}`, c, { position: [0, 0, 0] }));

      const wall = wallWithOpening({
        length: 6,
        height: GATE_HEIGHT + 0.6,
        thickness: WALL_THICKNESS,
        opening: {
          kind: 'door',
          width: OPENING_WIDTH_FULL,
          height: GATE_HEIGHT,
          offsetX: OPENING_LEFT_X + OPENING_WIDTH_FULL / 2,
        },
      });
      wall.object.position.set(0, 0, WALL_Z);
      root.add(wall.object);
      wall.colliders.forEach((c, i) => physics.addBody(`wall-${i}`, c, { position: [0, 0, WALL_Z] }));

      // Gate panel: covers the opening from its right edge leftward, leaving
      // `openingWidth` free measured from OPENING_LEFT_X.
      let openingWidth = Number(describeParameters()[0].value);
      let panelBody: PhysicsBody | null = null;
      let panelMesh: THREE.Mesh | null = null;

      const buildPanel = (width: number): void => {
        if (panelBody) physics.removeBody('gate-panel');
        if (panelMesh) {
          root.remove(panelMesh);
          panelMesh.geometry.dispose();
          (panelMesh.material as THREE.Material).dispose();
        }
        panelBody = null;
        panelMesh = null;
        const cover = OPENING_WIDTH_FULL - width;
        if (cover <= 0.001) return; // fully open: no panel at all
        const centerX = OPENING_LEFT_X + OPENING_WIDTH_FULL - cover / 2;
        panelMesh = new THREE.Mesh(
          new THREE.BoxGeometry(cover, GATE_HEIGHT, WALL_THICKNESS),
          new THREE.MeshLambertMaterial({ color: 0x8a6a3a }),
        );
        panelMesh.name = 'gate-panel';
        panelMesh.userData.authorId = 'narrow-gate/gate-panel';
        panelMesh.position.set(centerX, GATE_HEIGHT / 2, WALL_Z);
        root.add(panelMesh);
        panelBody = physics.addBody(
          'gate-panel',
          { shape: { kind: 'box', halfExtents: [cover / 2, GATE_HEIGHT / 2, WALL_THICKNESS / 2] }, body: 'static' },
          { position: [centerX, GATE_HEIGHT / 2, WALL_Z] },
        );
      };
      buildPanel(openingWidth);

      const player = new FirstPersonController(physics, TUNING, {
        id: 'player',
        spawn: SPAWN,
        bindings: { moveYAxis: 'move.z' },
      });
      player.object.name = 'player';
      player.object.userData.authorId = 'narrow-gate/player';
      ctx.scope.own(player);
      root.add(player.object);

      let goalReached = false;
      const params = exposeParameters(
        describeParameters().map((def) => ({
          ...def,
          apply: (value: unknown) => {
            openingWidth = Number(value);
            buildPanel(openingWidth);
          },
        })),
      );

      ctx.onPhase('input', () => mapper.step());
      ctx.onPhase('intent', (frame) => {
        const snap: ActionState = mapper.snapshot();
        viewYaw -= snap.axis('look.x');
        player.update(snap, viewYaw, frame.dt);
      });

      const instance: SceneInstance = {
        root,
        update() {
          if (!goalReached && player.position[2] < GOAL_Z) {
            goalReached = true;
            ctx.commit('gate.passed', { z: player.position[2] }, 'gate:passed:1');
          }
        },
      };
      module.handles = { physics, player, params, device, goalReached: () => goalReached };
      return instance;
    },
  };
  return module;
}
