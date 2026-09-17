/**
 * Camera rigs and director (S05/S09, gate G09).
 *
 * Authority (ENGINE-SYSTEMS §2): the camera's transform has exactly one
 * writer — the currently active rig, mediated by the CameraDirector. Rigs
 * only READ other objects (a follow target's position, a path curve); the
 * camera never writes to player- or physics-authoritative transforms, so a
 * cutscene can never move the player.
 *
 * Control token: direct `director.cut()/blendTo()` calls are for ordinary
 * game code. A cutscene (e.g. a timeline) instead takes a `CameraControl`
 * token via `director.takeover()`; while any token is held, direct calls are
 * rejected, and `token.release()` restores exactly the rig (and any in-flight
 * blend state) that was active when the token was taken — no drift.
 *
 * Free-form camera code remains fully legal: these are optional helpers, and
 * `rig.getPose()`/plain Three math can be mixed with them at will.
 */
import * as THREE from 'three';
import { CreativeError } from '../core/errors.ts';
import type { SceneContext } from '../core/context.ts';
import { asEasing, type EasingFn, type EasingName } from '../animation/easing.ts';

export interface CameraPose {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

/** A pose source. The director is the only consumer that should write a camera. */
export interface CameraRig {
  readonly name: string;
  /** Advance rig-internal state (damping, path parameter). */
  update(dt: number): void;
  /** Write this rig's current pose into `out`. Must not mutate other objects. */
  getPose(out: CameraPose): void;
}

type Vec3Like = THREE.Vector3 | [number, number, number];

function toVec3(v: Vec3Like): THREE.Vector3 {
  return v instanceof THREE.Vector3 ? v.clone() : new THREE.Vector3(v[0], v[1], v[2]);
}

const UP = new THREE.Vector3(0, 1, 0);
const lookMatrix = new THREE.Matrix4();

function lookAtQuaternion(eye: THREE.Vector3, target: THREE.Vector3, out: THREE.Quaternion): void {
  lookMatrix.lookAt(eye, target, UP);
  out.setFromRotationMatrix(lookMatrix);
}

/** Static pose: fixed position looking at a fixed point (or raw quaternion). */
export class FixedRig implements CameraRig {
  readonly name: string;
  private readonly position: THREE.Vector3;
  private readonly quaternion: THREE.Quaternion;

  constructor(
    name: string,
    opts: { position: Vec3Like; lookAt?: Vec3Like | THREE.Object3D; quaternion?: THREE.Quaternion },
  ) {
    this.name = name;
    this.position = toVec3(opts.position);
    this.quaternion = opts.quaternion ? opts.quaternion.clone() : new THREE.Quaternion();
    if (opts.lookAt !== undefined) {
      const target =
        opts.lookAt instanceof THREE.Object3D
          ? opts.lookAt.getWorldPosition(new THREE.Vector3())
          : toVec3(opts.lookAt);
      lookAtQuaternion(this.position, target, this.quaternion);
    }
  }

  update(_dt: number): void {
    /* static */
  }

  getPose(out: CameraPose): void {
    out.position.copy(this.position);
    out.quaternion.copy(this.quaternion);
  }
}

export interface FollowRigOptions {
  /** Authoritative object to follow; the rig only READS its position. */
  target: THREE.Object3D;
  /** Camera offset from the target, in the target's parent frame. */
  offset?: Vec3Like;
  /** Exponential damping lambda (per second); default 6. Higher = snappier. */
  damping?: number;
  /** Look-at point relative to the target position; default (0,0,0). */
  lookOffset?: Vec3Like;
}

/**
 * Follow rig with exponential damping: the smoothed camera position converges
 * to `target.position + offset`. The target's own transform is never written.
 */
export class FollowRig implements CameraRig {
  readonly name: string;
  readonly target: THREE.Object3D;
  readonly offset: THREE.Vector3;
  readonly lookOffset: THREE.Vector3;
  readonly damping: number;

  private readonly smoothedPos = new THREE.Vector3();
  private readonly smoothedLook = new THREE.Vector3();
  private initialized = false;

  constructor(name: string, opts: FollowRigOptions) {
    this.name = name;
    this.target = opts.target;
    this.offset = opts.offset !== undefined ? toVec3(opts.offset) : new THREE.Vector3(0, 2, 6);
    this.lookOffset = opts.lookOffset !== undefined ? toVec3(opts.lookOffset) : new THREE.Vector3();
    this.damping = opts.damping ?? 6;
  }

  update(dt: number): void {
    const desired = new THREE.Vector3().copy(this.target.position).add(this.offset);
    const desiredLook = new THREE.Vector3().copy(this.target.position).add(this.lookOffset);
    if (!this.initialized) {
      this.smoothedPos.copy(desired);
      this.smoothedLook.copy(desiredLook);
      this.initialized = true;
      return;
    }
    const l = this.damping;
    this.smoothedPos.set(
      THREE.MathUtils.damp(this.smoothedPos.x, desired.x, l, dt),
      THREE.MathUtils.damp(this.smoothedPos.y, desired.y, l, dt),
      THREE.MathUtils.damp(this.smoothedPos.z, desired.z, l, dt),
    );
    this.smoothedLook.set(
      THREE.MathUtils.damp(this.smoothedLook.x, desiredLook.x, l, dt),
      THREE.MathUtils.damp(this.smoothedLook.y, desiredLook.y, l, dt),
      THREE.MathUtils.damp(this.smoothedLook.z, desiredLook.z, l, dt),
    );
  }

  /** Snap smoothing to the current desired pose (e.g. after a teleport). */
  snap(): void {
    this.smoothedPos.copy(this.target.position).add(this.offset);
    this.smoothedLook.copy(this.target.position).add(this.lookOffset);
    this.initialized = true;
  }

  getPose(out: CameraPose): void {
    if (!this.initialized) this.snap();
    out.position.copy(this.smoothedPos);
    lookAtQuaternion(this.smoothedPos, this.smoothedLook, out.quaternion);
  }
}

export interface PathRigOptions {
  /** Waypoints (a Catmull-Rom curve is built from them) or a ready curve. */
  points: Vec3Like[] | THREE.CatmullRomCurve3;
  /** Seconds for one full traverse; default 10. */
  duration?: number;
  /** Wrap progress at the end (default false: hold the last point). */
  loop?: boolean;
  /** 'forward' looks along the tangent; an Object3D/Vector3 is looked at. */
  lookAt?: 'forward' | Vec3Like | THREE.Object3D;
  easing?: EasingFn | EasingName;
}

const tangentTmp = new THREE.Vector3();
const targetTmp = new THREE.Vector3();

/** Path rig: camera travels a Catmull-Rom curve, looking forward or at a target. */
export class PathRig implements CameraRig {
  readonly name: string;
  readonly curve: THREE.CatmullRomCurve3;
  readonly duration: number;
  readonly loop: boolean;
  readonly lookAt: PathRigOptions['lookAt'];
  private readonly easing: EasingFn;

  private t = 0;

  constructor(name: string, opts: PathRigOptions) {
    this.name = name;
    this.curve =
      opts.points instanceof THREE.CatmullRomCurve3
        ? opts.points
        : new THREE.CatmullRomCurve3(opts.points.map(toVec3));
    this.duration = opts.duration ?? 10;
    if (!(this.duration > 0)) throw new Error('PathRig duration must be positive');
    this.loop = opts.loop ?? false;
    this.lookAt = opts.lookAt ?? 'forward';
    this.easing = asEasing(opts.easing);
  }

  /** Normalized progress along the curve, in [0,1]. */
  get progress(): number {
    return this.sampleT(this.t);
  }

  update(dt: number): void {
    this.t += dt / this.duration;
    if (this.loop) {
      this.t %= 1;
    } else if (this.t > 1) {
      this.t = 1;
    }
  }

  private sampleT(t: number): number {
    const k = this.easing(Math.min(1, Math.max(0, t)));
    return this.loop ? k % 1 : Math.min(1, Math.max(0, k));
  }

  getPose(out: CameraPose): void {
    const tt = this.sampleT(this.t);
    this.curve.getPoint(tt, out.position);
    let target: THREE.Vector3;
    if (this.lookAt === 'forward' || this.lookAt === undefined) {
      this.curve.getTangent(tt, tangentTmp);
      target = targetTmp.copy(out.position).add(tangentTmp);
    } else if (this.lookAt instanceof THREE.Object3D) {
      target = this.lookAt.getWorldPosition(targetTmp);
    } else if (Array.isArray(this.lookAt)) {
      target = targetTmp.set(this.lookAt[0], this.lookAt[1], this.lookAt[2]);
    } else {
      target = targetTmp.copy(this.lookAt);
    }
    lookAtQuaternion(out.position, target, out.quaternion);
  }
}

interface BlendState {
  from: CameraRig;
  to: CameraRig;
  duration: number;
  elapsed: number;
  easing: EasingFn;
}

interface DirectorSnapshot {
  rig: CameraRig | null;
  blend: BlendState | null;
}

const poseA: CameraPose = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
const poseB: CameraPose = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };

/**
 * Owns THE active camera rig: advances it, blends between rigs and writes the
 * camera pose. Cutscenes take a control token (LIFO); on release the previous
 * rig resumes exactly where it was.
 */
export class CameraDirector {
  private active: CameraRig | null = null;
  private blend: BlendState | null = null;
  private readonly stack: CameraControl[] = [];
  private disposed = false;
  private readonly camera: THREE.PerspectiveCamera;

  constructor(camera: THREE.PerspectiveCamera, initialRig?: CameraRig) {
    this.camera = camera;
    this.active = initialRig ?? null;
  }

  /** Effective rig: during a blend this is the incoming rig. */
  get activeRig(): CameraRig | null {
    return this.blend ? this.blend.to : this.active;
  }

  get blending(): boolean {
    return this.blend !== null;
  }

  /** Blend weight of the incoming rig, 0..1 (1 when not blending). */
  get blendWeight(): number {
    if (!this.blend) return 1;
    return this.blend.easing(Math.min(1, this.blend.elapsed / this.blend.duration));
  }

  get takeoverHeld(): boolean {
    return this.stack.length > 0;
  }

  /** Ordinary game-code cut. Rejected while a takeover token is held. */
  cut(rig: CameraRig): void {
    this.assertNoTakeover('cut');
    this.active = rig;
    this.blend = null;
  }

  /** Ordinary game-code blend over `duration` seconds. */
  blendTo(rig: CameraRig, duration: number, opts?: { easing?: EasingFn | EasingName }): void {
    this.assertNoTakeover('blendTo');
    this.startBlend(rig, duration, opts);
  }

  /**
   * Take temporary control (cutscene). While any token is held, direct
   * cut/blendTo calls throw; tokens operate LIFO. release() restores the
   * exact rig/blend state from takeover time.
   */
  takeover(): CameraControl {
    const saved: DirectorSnapshot = { rig: this.active, blend: this.blend };
    const control = new CameraControl(this, saved);
    this.stack.push(control);
    return control;
  }

  update(dt: number): void {
    this.active?.update(dt);
    if (this.blend) {
      this.blend.from.update(dt);
      this.blend.elapsed += dt;
      if (this.blend.elapsed >= this.blend.duration - 1e-9) {
        this.active = this.blend.to;
        this.blend = null;
      }
    }
  }

  /** Compose the active pose (lerp/slerp during blends) into the camera. */
  apply(camera?: THREE.PerspectiveCamera): void {
    const cam = camera ?? this.camera;
    if (!this.active) return;
    if (!this.blend) {
      this.active.getPose(poseA);
      cam.position.copy(poseA.position);
      cam.quaternion.copy(poseA.quaternion);
      return;
    }
    const w = this.blendWeight;
    this.blend.from.getPose(poseA);
    this.blend.to.getPose(poseB);
    cam.position.lerpVectors(poseA.position, poseB.position, w);
    cam.quaternion.slerpQuaternions(poseA.quaternion, poseB.quaternion, w);
  }

  /** Wire update+apply to the host present phase; scope-owned dispose. */
  attach(ctx: SceneContext): this {
    ctx.onPhase('present', (frame) => {
      this.update(frame.dt);
      this.apply();
    });
    ctx.scope.own(this);
    return this;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.blend = null;
    this.stack.length = 0;
    this.active = null;
  }

  /** @internal token op — validated against release/LIFO. */
  startBlend(rig: CameraRig, duration: number, opts?: { easing?: EasingFn | EasingName }): void {
    if (!(duration > 0)) throw new Error('blend duration must be positive');
    this.blend = { from: this.active ?? rig, to: rig, duration, elapsed: 0, easing: asEasing(opts?.easing) };
  }

  /** @internal token op — instant cut. */
  setActiveRig(rig: CameraRig): void {
    this.active = rig;
    this.blend = null;
  }

  /** @internal token op — snap an in-flight blend to its target rig. */
  completeBlend(): void {
    if (this.blend) {
      this.active = this.blend.to;
      this.blend = null;
    }
  }

  /** @internal token op — restore snapshot taken at takeover. */
  restoreSnapshot(control: CameraControl, saved: DirectorSnapshot): void {
    const top = this.stack[this.stack.length - 1];
    if (top !== control) {
      throw new CreativeError(
        'CAMERA_TOKEN_ORDER',
        'camera control tokens must be released in reverse takeover order (LIFO)',
        { phase: 'present' },
      );
    }
    this.stack.pop();
    this.active = saved.rig;
    this.blend = saved.blend;
  }

  /** @internal token op guard. */
  assertOperable(control: CameraControl): void {
    if (control.released) {
      throw new CreativeError('CAMERA_TOKEN_RELEASED', 'camera control token already released', { phase: 'present' });
    }
    if (this.stack[this.stack.length - 1] !== control) {
      throw new CreativeError(
        'CAMERA_TOKEN_ORDER',
        'only the most recent camera control token may operate (LIFO)',
        { phase: 'present' },
      );
    }
  }

  private assertNoTakeover(op: string): void {
    if (this.stack.length > 0) {
      throw new CreativeError(
        'CAMERA_TAKEOVER_HELD',
        `director.${op} is rejected while a camera takeover token is held`,
        { phase: 'present' },
      );
    }
  }
}

/**
 * Control token for a temporary camera takeover (timeline cutscene). All ops
 * throw after release; release is idempotent and restores the pre-takeover rig.
 */
export class CameraControl {
  private releasedState = false;
  private readonly director: CameraDirector;
  private readonly saved: DirectorSnapshot;

  constructor(director: CameraDirector, saved: DirectorSnapshot) {
    this.director = director;
    this.saved = saved;
  }

  get released(): boolean {
    return this.releasedState;
  }

  get active(): boolean {
    return !this.releasedState;
  }

  cut(rig: CameraRig): void {
    this.director.assertOperable(this);
    this.director.setActiveRig(rig);
  }

  blend(rig: CameraRig, duration: number, opts?: { easing?: EasingFn | EasingName }): void {
    this.director.assertOperable(this);
    this.director.startBlend(rig, duration, opts);
  }

  /** Snap any in-flight blend to its target rig (deterministic end state). */
  completeBlend(): void {
    this.director.assertOperable(this);
    this.director.completeBlend();
  }

  /** Return control to the rig (and blend state) active at takeover time. */
  release(): void {
    if (this.releasedState) return;
    this.director.assertOperable(this);
    this.releasedState = true;
    this.director.restoreSnapshot(this, this.saved);
  }
}
