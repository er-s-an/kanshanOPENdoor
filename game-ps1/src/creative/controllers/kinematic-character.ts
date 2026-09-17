/**
 * KinematicCharacterCore: shared character logic for the first-person and
 * top-down controllers (roadmap S05), built on Rapier's
 * KinematicCharacterController (controller offset, autostep with
 * maxStepHeight, max slope climb angle, snap-to-ground).
 *
 * The core owns:
 * - a kinematic Rapier body + cylinder collider (the character capsule, R1:
 *   cylinder is the closest shape the neutral ColliderDesc supports)
 * - vertical velocity (gravity integration, jumps, landing)
 * - grounded state + which body is underfoot (for moving-platform carry)
 * - the character root Object3D: the controller has transform authority over
 *   this root; presentation may interpolate but never commits facts
 *
 * Movement intent arrives as a WORLD-space horizontal move vector (already
 * resolved from ActionState axes + camera yaw by the wrapper controllers),
 * a jump edge, and the fixed dt. Devices never reach this layer.
 *
 * Platform carry: while grounded on a kinematic body, the body's last actual
 * per-step displacement (PhysicsWorld.kinematicDelta) is added to the desired
 * movement, so a character standing on a moving platform moves with it.
 */
import * as THREE from 'three';
import type { KinematicCharacterController } from '@dimforge/rapier3d-compat';
import type { Vec3 } from '../core/spatial.ts';
import { CreativeError } from '../core/errors.ts';
import type { PhysicsWorld } from '../physics/world.ts';

export interface CharacterTuning {
  /** Horizontal ground speed, m/s. */
  speed: number;
  /** Capsule radius, m. */
  radius: number;
  /** Total character height, m (cylinder height, flat ends). */
  height: number;
  /** Downward acceleration, m/s^2 (positive number). */
  gravity: number;
  /** Initial upward speed on jump, m/s. */
  jumpSpeed: number;
  /** Slopes steeper than this (radians) cannot be climbed. */
  maxSlopeAngle: number;
  /** Maximum stair riser the character auto-steps onto, m. */
  maxStepHeight: number;
  /** Snap-to-ground distance while grounded, m. Default 0.2. */
  snapToGround?: number;
  /** Seconds after leaving ground during which a jump still works. Default 0. */
  coyoteTime?: number;
  /** Minimum stair tread width for autostep, m. Default 0.2. */
  autostepMinWidth?: number;
  /** Extra controller skin offset, m. Default 0.01. */
  controllerOffset?: number;
  /** Whether standing on a kinematic body carries the character. Default true. */
  carry?: boolean;
}

export interface CharacterStepInfo {
  grounded: boolean;
  position: Vec3;
  verticalVelocity: number;
  groundBodyId: string | null;
  /** Displacement of the supporting kinematic body applied this step (carry). */
  carried: Vec3;
}

let characterCounter = 0;

export class KinematicCharacterCore {
  readonly world: PhysicsWorld;
  readonly tuning: CharacterTuning;
  /** Character root; this controller owns its transform. */
  readonly object: THREE.Object3D;
  readonly bodyId: string;
  private readonly controller: KinematicCharacterController;
  private readonly colliderRef: import('@dimforge/rapier3d-compat').Collider;
  private readonly rigidBodyRef: import('@dimforge/rapier3d-compat').RigidBody;
  private readonly colliderHalfHeight: number;
  private disposed = false;
  private vy = 0;
  private groundedState = false;
  private timeSinceGrounded = Number.POSITIVE_INFINITY;
  private groundBodyId: string | null = null;

  constructor(world: PhysicsWorld, tuning: CharacterTuning, spawn: Vec3, id?: string, object?: THREE.Object3D) {
    this.world = world;
    this.tuning = tuning;
    this.object = object ?? new THREE.Object3D();
    this.object.position.set(spawn[0], spawn[1], spawn[2]);
    this.bodyId = id ?? `character-${++characterCounter}`;
    this.colliderHalfHeight = tuning.height / 2;
    const body = world.addBody(
      this.bodyId,
      {
        shape: { kind: 'cylinder', halfHeight: this.colliderHalfHeight, radius: tuning.radius },
        body: 'kinematic',
        group: 'character',
      },
      { position: spawn },
    );
    this.colliderRef = body.collider;
    this.rigidBodyRef = body.rigidBody;

    const controller = world.createCharacterController(tuning.controllerOffset ?? 0.01);
    controller.setUp({ x: 0, y: 1, z: 0 });
    controller.enableAutostep(tuning.maxStepHeight, tuning.autostepMinWidth ?? 0.2, true);
    controller.setMaxSlopeClimbAngle(tuning.maxSlopeAngle);
    controller.setMinSlopeSlideAngle(Math.min((85 * Math.PI) / 180, tuning.maxSlopeAngle + (15 * Math.PI) / 180));
    const snap = tuning.snapToGround ?? 0.2;
    if (snap > 0) controller.enableSnapToGround(snap);
    controller.setApplyImpulsesToDynamicBodies(true);
    this.controller = controller;
  }

  get grounded(): boolean {
    return this.groundedState;
  }

  get position(): Vec3 {
    const p = this.object.position;
    return [p.x, p.y, p.z];
  }

  get verticalVelocity(): number {
    return this.vy;
  }

  debugInfo(): CharacterStepInfo & { bodyId: string } {
    return {
      bodyId: this.bodyId,
      grounded: this.groundedState,
      position: this.position,
      verticalVelocity: this.vy,
      groundBodyId: this.groundBodyId,
      carried: [0, 0, 0],
    };
  }

  /**
   * Advance one fixed step.
   * @param worldMoveX/worldMoveZ world-space horizontal intent, magnitude <= 1
   * @param jumpPressed edge: jump action went down this step
   */
  update(dt: number, worldMoveX: number, worldMoveZ: number, jumpPressed: boolean): CharacterStepInfo {
    if (this.disposed) {
      throw new CreativeError('CONTROLLER_DISPOSED', `character controller "${this.bodyId}" is disposed`, { phase: 'intent' });
    }
    if (!(dt > 0) || !Number.isFinite(dt)) {
      throw new CreativeError('BAD_TIMESTEP', `controller update dt must be > 0, got ${dt}`, { phase: 'intent' });
    }
    const t = this.tuning;
    let hx = 0;
    let hz = 0;
    const mag = Math.hypot(worldMoveX, worldMoveZ);
    if (mag > 1e-6) {
      const s = Math.min(mag, 1) / mag;
      hx = worldMoveX * s;
      hz = worldMoveZ * s;
    }

    const coyote = t.coyoteTime ?? 0;
    if (jumpPressed && (this.groundedState || this.timeSinceGrounded <= coyote)) {
      this.vy = t.jumpSpeed;
      this.groundedState = false;
      this.timeSinceGrounded = Number.POSITIVE_INFINITY;
    }
    if (this.groundedState && this.vy <= 0) {
      // Resting: no downward intent. A downward bias here would make Rapier
      // treat the ground contact as an obstacle and block horizontal sliding.
      this.vy = 0;
    } else {
      this.vy -= t.gravity * dt;
    }

    let dx = hx * t.speed * dt;
    let dy = this.vy * dt;
    let dz = hz * t.speed * dt;
    const carried: Vec3 = [0, 0, 0];
    if ((t.carry ?? true) && this.groundedState && this.groundBodyId) {
      const d = this.world.kinematicDelta(this.groundBodyId);
      carried[0] = d[0];
      carried[1] = d[1];
      carried[2] = d[2];
      dx += d[0];
      dy += d[1];
      dz += d[2];
    }

    this.controller.computeColliderMovement(this.colliderRef, { x: dx, y: dy, z: dz });
    const mv = this.controller.computedMovement();
    const pos = this.rigidBodyRef.translation();
    let nx = pos.x + mv.x;
    let ny = pos.y + mv.y;
    let nz = pos.z + mv.z;

    // Support probe: a short downward shape cast from slightly above the
    // character (starting exactly at touching distance sporadically reports
    // no hit). It identifies the supporting body and, while resting, snaps
    // the pose onto it — a small float makes the controller's
    // offset-inflated shape overlap the floor face, which sporadically
    // blocks horizontal sliding.
    let groundBodyId: string | null = null;
    let supportPointY: number | null = null;
    let supportNormalY = 0;
    if (this.vy <= 0.01) {
      const probe = this.world.castShape(
        { kind: 'cylinder', halfHeight: this.colliderHalfHeight, radius: t.radius },
        [nx, ny + 0.02, nz],
        undefined,
        [0, -1, 0],
        (t.snapToGround ?? 0.2) + 0.15,
        { excludeBody: this.bodyId },
      );
      if (probe) {
        groundBodyId = probe.bodyId;
        supportPointY = probe.point[1];
        supportNormalY = probe.normal[1];
      }
    }
    // A support counts as ground when its surface is not steeper than the
    // configured slope limit. This also covers moving-platform carry: an
    // upward carried movement would otherwise read as "left the ground".
    const minSupportNormalY = Math.cos(t.maxSlopeAngle + (5 * Math.PI) / 180);
    const onSupport = supportPointY !== null && supportNormalY >= minSupportNormalY;
    const grounded = this.controller.computedGrounded() || (this.vy <= 0.01 && onSupport);
    if (grounded) {
      this.groundedState = true;
      if (onSupport && this.vy <= 0) ny = supportPointY!;
    } else {
      this.groundedState = false;
    }
    this.rigidBodyRef.setTranslation({ x: nx, y: ny, z: nz }, true);
    this.object.position.set(nx, ny, nz);
    this.groundBodyId = grounded ? groundBodyId : null;
    this.timeSinceGrounded = grounded ? 0 : this.timeSinceGrounded + dt;
    if (grounded && this.vy < 0) this.vy = 0;

    return {
      grounded,
      position: [nx, ny, nz],
      verticalVelocity: this.vy,
      groundBodyId: this.groundBodyId,
      carried,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.world.releaseCharacterController(this.controller);
    this.world.removeBody(this.bodyId);
  }
}
