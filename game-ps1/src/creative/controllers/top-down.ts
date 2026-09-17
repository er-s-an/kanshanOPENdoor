/**
 * Top-down character controller (roadmap S05, gate G05).
 *
 * Same movement core as the first-person controller: intent comes from an
 * ActionState (axes + jump action) resolved through the camera yaw, so a
 * rotated top-down camera keeps screen-relative controls. The one extra is
 * optional `faceMovement`: the character root yaws toward its motion — pure
 * presentation over the same committed transform, still owned by the
 * controller.
 *
 * Typical wiring inside a SceneModule:
 *   const hero = new TopDownController(physics, tuning, { spawn, faceMovement: true });
 *   ctx.scope.own(hero);
 *   ctx.onPhase('intent', () => hero.update(input.snapshot(), camera.yaw, frameDt));
 */
import * as THREE from 'three';
import type { ActionState } from '../core/input-types.ts';
import type { Vec3 } from '../core/spatial.ts';
import type { PhysicsWorld } from '../physics/world.ts';
import type { CharacterStepInfo, CharacterTuning } from './kinematic-character.ts';
import { KinematicCharacterCore } from './kinematic-character.ts';
import { DEFAULT_BINDINGS, type ControllerBindings } from './first-person.ts';

export interface TopDownControllerOptions {
  id?: string;
  spawn?: Vec3;
  object?: THREE.Object3D;
  bindings?: Partial<ControllerBindings>;
  /** Rotate the character root toward its movement direction. Default false. */
  faceMovement?: boolean;
  fixedDt?: number;
}

export class TopDownController {
  readonly core: KinematicCharacterCore;
  private readonly bindings: ControllerBindings;
  private readonly faceMovement: boolean;
  private readonly fixedDt: number;

  constructor(world: PhysicsWorld, tuning: CharacterTuning, opts?: TopDownControllerOptions) {
    this.core = new KinematicCharacterCore(world, tuning, opts?.spawn ?? [0, 1, 0], opts?.id, opts?.object);
    this.bindings = { ...DEFAULT_BINDINGS, ...opts?.bindings };
    this.faceMovement = opts?.faceMovement ?? false;
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

  update(actions: ActionState, cameraYaw: number, dt?: number): CharacterStepInfo {
    const b = this.bindings;
    const ax = clampAxis(actions.axis(b.moveXAxis));
    const ay = clampAxis(actions.axis(b.moveYAxis));
    const sin = Math.sin(cameraYaw);
    const cos = Math.cos(cameraYaw);
    const worldX = cos * ax - sin * ay;
    const worldZ = -sin * ax - cos * ay;
    const info = this.core.update(dt ?? this.fixedDt, worldX, worldZ, actions.pressed(b.jumpAction));
    if (this.faceMovement && (Math.abs(worldX) > 1e-4 || Math.abs(worldZ) > 1e-4)) {
      // Presentation only: the committed position stays the controller's.
      this.core.object.rotation.y = Math.atan2(worldX, worldZ);
    }
    return info;
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
