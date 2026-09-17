/**
 * Kinematic mechanisms (roadmap S06): sliding/rotating doors and moving
 * platforms. All of them are kinematic position-based Rapier bodies driven by
 * mechanism phase code — each update(dt) advances a small progress clock and
 * declares the next kinematic translation via world.setKinematicTarget()
 * (Rapier setNextKinematicTranslation).
 *
 * ONE source of pose: every mechanism owns a `target` THREE.Object3D that
 * carries the authoritative transform. The collider is driven from it and the
 * render `object` copies it. Nothing re-derives the pose from the mesh or
 * from physics state; presentation interpolates but never commits facts.
 *
 * Scheduling: works call update(dt) once per fixed step, typically
 *   driveMechanism(world, mech, ctx.clock.fixedDt)
 * which registers a pre-step hook (same-step carry: the platform's
 * displacement and the character's carried movement land in the same step).
 * Calling mech.update(dt) from a 'mechanics' phase hook also works; the
 * kinematic target then applies on the next physics step (one step of lag,
 * which changes nothing for doors and only eases platform carry by one step).
 */
import * as THREE from 'three';
import type { Vec3 } from '../core/spatial.ts';
import { CreativeError } from '../core/errors.ts';
import type { PhysicsWorld, Quat } from './world.ts';
import { PhysicsBody, quatFromYaw } from './world.ts';

export interface SlidingDoorTuning {
  id?: string;
  width: number;
  height: number;
  thickness?: number;
  /** Door panel center when fully closed. */
  closedPosition: Vec3;
  /** Panel translation applied when fully open (e.g. [0, height, 0] lifts up). */
  openOffset: Vec3;
  /** Seconds to move from fully closed to fully open. Default 1. */
  duration?: number;
  startOpen?: boolean;
}

export interface RotaryDoorTuning {
  id?: string;
  width: number;
  height: number;
  thickness?: number;
  /** Hinge point at floor level; the panel extends `width` along the closed yaw. */
  hinge: Vec3;
  /** Yaw of the closed panel (panel runs from hinge along local +X). */
  closedYaw: number;
  /** Yaw of the open panel. */
  openYaw: number;
  duration?: number;
  startOpen?: boolean;
}

export interface MovingPlatformTuning {
  id?: string;
  /** Full extents of the platform box. */
  size: Vec3;
  /** Center position at one end of the travel. */
  from: Vec3;
  /** Center position at the other end. */
  to: Vec3;
  /** Seconds for one one-way travel. Default 2. */
  seconds?: number;
  /** Pause at each end. Default 0. */
  dwell?: number;
  /** Initial cycle offset in [0, 1). Default 0. */
  start?: number;
}

const IDENTITY_QUAT: Quat = [0, 0, 0, 1];

abstract class KinematicMechanism {
  readonly target: THREE.Object3D;
  readonly object: THREE.Object3D;
  readonly body: PhysicsBody;
  protected readonly worldRef: PhysicsWorld;
  private disposed = false;
  private readonly cleanups: Array<() => void> = [];

  protected constructor(world: PhysicsWorld, id: string, halfExtents: Vec3, colliderOffset: Vec3, startPosition: Vec3, startQuat: Quat) {
    this.worldRef = world;
    this.target = new THREE.Object3D();
    this.target.position.set(startPosition[0], startPosition[1], startPosition[2]);
    this.target.quaternion.set(startQuat[0], startQuat[1], startQuat[2], startQuat[3]);
    this.body = world.addBody(
      id,
      {
        shape: { kind: 'box', halfExtents, offset: colliderOffset },
        body: 'kinematic',
        group: 'mechanism',
      },
      { position: startPosition, quaternion: startQuat },
    );
    this.object = new THREE.Group();
    this.object.name = id;
    this.applyPose();
  }

  /** Declare the single source of truth: collider target + render pose. */
  protected applyPose(): void {
    this.worldRef.setKinematicTarget(
      this.body.id,
      [this.target.position.x, this.target.position.y, this.target.position.z],
      [
        this.target.quaternion.x,
        this.target.quaternion.y,
        this.target.quaternion.z,
        this.target.quaternion.w,
      ],
    );
    this.object.position.copy(this.target.position);
    this.object.quaternion.copy(this.target.quaternion);
  }

  assertUsable(): void {
    if (this.disposed) {
      throw new CreativeError('MECHANISM_DISPOSED', `mechanism on body "${this.body.id}" is disposed`, { phase: 'mechanics' });
    }
  }

  /** Removes the kinematic body from the world; the render object stays with the author. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.worldRef.removeBody(this.body.id);
    for (const cleanup of this.cleanups.splice(0)) cleanup();
  }

  /**
   * Register a cleanup (e.g. the drive hook installed by driveMechanism) so
   * disposing the mechanism unregisters it — a disposed mechanism must never
   * be invoked again by the world step.
   */
  onDispose(cleanup: () => void): void {
    if (this.disposed) cleanup();
    else this.cleanups.push(cleanup);
  }
}

/**
 * Sliding door: the panel translates between closedPosition and
 * closedPosition + openOffset. Block/pass tests drive update(dt) until
 * isOpen, then walk the character through the doorway.
 */
export class SlidingDoor extends KinematicMechanism {
  private readonly closedPosition: Vec3;
  private readonly openOffset: Vec3;
  private readonly duration: number;
  private progress: number;
  private direction: -1 | 0 | 1 = 0;

  constructor(world: PhysicsWorld, tuning: SlidingDoorTuning) {
    const thickness = tuning.thickness ?? 0.15;
    super(
      world,
      tuning.id ?? 'sliding-door',
      [tuning.width / 2, tuning.height / 2, thickness / 2],
      [0, 0, 0],
      tuning.closedPosition,
      IDENTITY_QUAT,
    );
    this.closedPosition = tuning.closedPosition;
    this.openOffset = tuning.openOffset;
    this.duration = tuning.duration ?? 1;
    this.progress = tuning.startOpen ? 1 : 0;
    this.poseFromProgress();
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(tuning.width, tuning.height, thickness),
      new THREE.MeshBasicMaterial({ color: 0x9a8f80 }),
    );
    mesh.name = 'door-panel';
    this.object.add(mesh);
  }

  open(): void {
    this.assertUsable();
    if (this.progress < 1) this.direction = 1;
  }

  close(): void {
    this.assertUsable();
    if (this.progress > 0) this.direction = -1;
  }

  get isOpen(): boolean {
    return this.progress >= 1;
  }

  get isClosed(): boolean {
    return this.progress <= 0;
  }

  get isMoving(): boolean {
    return this.direction !== 0;
  }

  update(dt: number): void {
    this.assertUsable();
    if (this.direction === 0) return;
    const next = Math.min(1, Math.max(0, this.progress + (this.direction * dt) / Math.max(this.duration, 1e-6)));
    this.progress = next;
    if (next === 0 || next === 1) this.direction = 0;
    this.poseFromProgress();
  }

  private poseFromProgress(): void {
    const p = this.progress;
    this.target.position.set(
      this.closedPosition[0] + this.openOffset[0] * p,
      this.closedPosition[1] + this.openOffset[1] * p,
      this.closedPosition[2] + this.openOffset[2] * p,
    );
    this.applyPose();
  }
}

/**
 * Rotating door on a hinge: the panel runs `width` along the closed yaw from
 * the hinge and yaws between closedYaw and openYaw.
 */
export class RotaryDoor extends KinematicMechanism {
  private readonly hinge: Vec3;
  private readonly closedYaw: number;
  private readonly openYaw: number;
  private readonly duration: number;
  private progress: number;
  private direction: -1 | 0 | 1 = 0;

  constructor(world: PhysicsWorld, tuning: RotaryDoorTuning) {
    const thickness = tuning.thickness ?? 0.15;
    super(
      world,
      tuning.id ?? 'rotary-door',
      [tuning.width / 2, tuning.height / 2, thickness / 2],
      [tuning.width / 2, tuning.height / 2, 0],
      tuning.hinge,
      quatFromYaw(tuning.closedYaw),
    );
    this.hinge = tuning.hinge;
    this.closedYaw = tuning.closedYaw;
    this.openYaw = tuning.openYaw;
    this.duration = tuning.duration ?? 1;
    this.progress = tuning.startOpen ? 1 : 0;
    this.poseFromProgress();
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(tuning.width, tuning.height, thickness),
      new THREE.MeshBasicMaterial({ color: 0x8a94a8 }),
    );
    mesh.name = 'door-panel';
    mesh.position.set(tuning.width / 2, tuning.height / 2, 0);
    this.object.add(mesh);
  }

  open(): void {
    this.assertUsable();
    if (this.progress < 1) this.direction = 1;
  }

  close(): void {
    this.assertUsable();
    if (this.progress > 0) this.direction = -1;
  }

  get isOpen(): boolean {
    return this.progress >= 1;
  }

  get isClosed(): boolean {
    return this.progress <= 0;
  }

  update(dt: number): void {
    this.assertUsable();
    if (this.direction === 0) return;
    const next = Math.min(1, Math.max(0, this.progress + (this.direction * dt) / Math.max(this.duration, 1e-6)));
    this.progress = next;
    if (next === 0 || next === 1) this.direction = 0;
    this.poseFromProgress();
  }

  private poseFromProgress(): void {
    const yaw = this.closedYaw + (this.openYaw - this.closedYaw) * this.progress;
    this.target.position.set(this.hinge[0], this.hinge[1], this.hinge[2]);
    this.target.quaternion.set(...quatFromYaw(yaw));
    this.applyPose();
  }
}

/**
 * Moving platform: ping-pong between `from` and `to` with an optional dwell
 * at each end, driven kinematically. A character standing on it is carried
 * (controllers add kinematicDelta of their support body each step).
 */
export class MovingPlatform extends KinematicMechanism {
  private readonly from: Vec3;
  private readonly to: Vec3;
  private readonly seconds: number;
  private readonly dwell: number;
  private clock: number;

  constructor(world: PhysicsWorld, tuning: MovingPlatformTuning) {
    super(
      world,
      tuning.id ?? 'moving-platform',
      [tuning.size[0] / 2, tuning.size[1] / 2, tuning.size[2] / 2],
      [0, 0, 0],
      tuning.from,
      IDENTITY_QUAT,
    );
    this.from = tuning.from;
    this.to = tuning.to;
    this.seconds = tuning.seconds ?? 2;
    this.dwell = tuning.dwell ?? 0;
    this.clock = (tuning.start ?? 0) * this.cycle();
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(tuning.size[0], tuning.size[1], tuning.size[2]),
      new THREE.MeshBasicMaterial({ color: 0x7a8a6a }),
    );
    mesh.name = 'platform-deck';
    this.object.add(mesh);
    this.poseFromClock();
  }

  /** Center position at the current clock. */
  get position(): Vec3 {
    const u = this.pathT();
    return [
      this.from[0] + (this.to[0] - this.from[0]) * u,
      this.from[1] + (this.to[1] - this.from[1]) * u,
      this.from[2] + (this.to[2] - this.from[2]) * u,
    ];
  }

  update(dt: number): void {
    this.assertUsable();
    this.clock += dt;
    this.poseFromClock();
  }

  private cycle(): number {
    return 2 * (this.seconds + this.dwell);
  }

  /** Position parameter along the path: 0 at `from`, 1 at `to`, ping-pong. */
  private pathT(): number {
    const cyc = this.cycle();
    const t = ((this.clock % cyc) + cyc) % cyc;
    if (t < this.dwell) return 0;
    if (t < this.dwell + this.seconds) return (t - this.dwell) / this.seconds;
    if (t < this.dwell * 2 + this.seconds) return 1;
    return 1 - (t - this.dwell * 2 - this.seconds) / this.seconds;
  }

  private poseFromClock(): void {
    const [x, y, z] = this.position;
    this.target.position.set(x, y, z);
    this.applyPose();
  }
}

/**
 * Register a mechanism so world.step() advances it before the Rapier step
 * (same-step kinematic targets and exact platform carry). The drive hook is
 * automatically unregistered when the mechanism is disposed. Returns an
 * explicit unregister function for manual teardown.
 */
export function driveMechanism(
  world: PhysicsWorld,
  mechanism: { update(dt: number): void; onDispose?(cleanup: () => void): void },
  fixedDt: number,
): () => void {
  const unregister = world.beforeStep(() => mechanism.update(fixedDt));
  mechanism.onDispose?.(unregister);
  return unregister;
}
