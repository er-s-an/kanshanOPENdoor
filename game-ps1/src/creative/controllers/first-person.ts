/**
 * First-person character controller (roadmap S05, gate G05).
 *
 * Intent comes from an ActionState (axes + jump action) plus a camera yaw —
 * never from raw devices. The camera yaw defines the movement basis on the
 * ground plane: screen-forward (camera looks along -Z rotated by yaw) maps to
 * the world direction (-sin yaw, 0, -cos yaw), screen-right to
 * (cos yaw, 0, -sin yaw).
 *
 * Per-work configuration is plain data (CharacterTuning): speed, radius,
 * height, gravity, jumpSpeed, slope limit, step height, snap distance,
 * coyote time, carry toggle.
 *
 * Typical wiring inside a SceneModule:
 *   const player = new FirstPersonController(physics, tuning, { spawn });
 *   ctx.scope.own(player);
 *   ctx.onPhase('intent', () => {
 *     player.update(input.snapshot(), view.yaw, frameDt);
 *   });
 */
import type * as THREE from 'three';
import type { ActionState } from '../core/input-types.ts';
import type { Vec3 } from '../core/spatial.ts';
import type { PhysicsWorld } from '../physics/world.ts';
import type { CharacterStepInfo, CharacterTuning } from './kinematic-character.ts';
import { KinematicCharacterCore } from './kinematic-character.ts';

export interface ControllerBindings {
  /** Strafe axis in [-1, 1] (right positive). Default 'move.x'. */
  moveXAxis: string;
  /** Forward axis in [-1, 1] (forward positive). Default 'move.y'. */
  moveYAxis: string;
  /** Jump action (edge). Default 'jump'. */
  jumpAction: string;
}

export const DEFAULT_BINDINGS: ControllerBindings = {
  moveXAxis: 'move.x',
  moveYAxis: 'move.y',
  jumpAction: 'jump',
};

export interface FirstPersonControllerOptions {
  id?: string;
  spawn?: Vec3;
  /** Character root (the controller owns its transform). Created when omitted. */
  object?: THREE.Object3D;
  bindings?: Partial<ControllerBindings>;
  /** Fixed dt fallback for update() when no dt argument is passed. Default 1/60. */
  fixedDt?: number;
}

export class FirstPersonController {
  readonly core: KinematicCharacterCore;
  private readonly bindings: ControllerBindings;
  private readonly fixedDt: number;

  constructor(world: PhysicsWorld, tuning: CharacterTuning, opts?: FirstPersonControllerOptions) {
    this.core = new KinematicCharacterCore(world, tuning, opts?.spawn ?? [0, 1, 0], opts?.id, opts?.object);
    this.bindings = { ...DEFAULT_BINDINGS, ...opts?.bindings };
    this.fixedDt = opts?.fixedDt ?? 1 / 60;
  }

  get object(): THREE.Object3D {
    return this.core.object;
  }

  get bodyId(): string {
    return this.core.bodyId;
  }

  get grounded(): boolean {
    return this.core.grounded;
  }

  get position(): Vec3 {
    return this.core.position;
  }

  /**
   * Advance one fixed step from action intent + camera yaw.
   * @param cameraYaw yaw of the camera around +Y (radians)
   */
  update(actions: ActionState, cameraYaw: number, dt?: number): CharacterStepInfo {
    const b = this.bindings;
    const ax = clampAxis(actions.axis(b.moveXAxis));
    const ay = clampAxis(actions.axis(b.moveYAxis));
    const sin = Math.sin(cameraYaw);
    const cos = Math.cos(cameraYaw);
    const worldX = cos * ax - sin * ay;
    const worldZ = -sin * ax - cos * ay;
    return this.core.update(dt ?? this.fixedDt, worldX, worldZ, actions.pressed(b.jumpAction));
  }

  debugInfo(): ReturnType<KinematicCharacterCore['debugInfo']> {
    return this.core.debugInfo();
  }

  dispose(): void {
    this.core.dispose();
  }
}

function clampAxis(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(-1, v));
}
