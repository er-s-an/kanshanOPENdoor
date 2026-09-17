/**
 * Screen-space presentation effects: fade, flash, camera shake.
 *
 * All three are presentation-only: they never commit gameplay facts and never
 * write player-authoritative transforms. Fades/flashes render as a camera-
 * child quad (so they need no separate render pass); camera shake applies a
 * camera-LOCAL offset that the owner must apply after the camera pose is set
 * each frame and restore afterwards (see CameraShake.apply/restore).
 *
 * Pause-awareness: every effect advances by the sim dt the caller passes to
 * update() — paused simulations simply stop stepping, so effects freeze.
 * Reduce-motion: fades become instant on/off, flashes are suppressed, and
 * shake produces zero offset.
 *
 * Offline note: tests assert overlay material state, opacity progress and
 * offset math with real THREE objects headless; actual pixels are
 * NOT_MEASURED.
 */
import * as THREE from 'three';
import type { Scope } from '../core/scope.ts';

const EPS = 1e-4;

interface OverlayOptions {
  scope: Scope;
  reduceMotion?: boolean;
}

/**
 * Full-screen quad parented to the camera. renderOrder + depthTest:false put
 * it on top of the scene; resizeFor() keeps it covering the frustum at z=-1.
 */
class OverlayQuad {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.MeshBasicMaterial;

  constructor(camera: THREE.Camera, name = 'screen-overlay') {
    this.material = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
    this.mesh.position.z = -1;
    this.mesh.renderOrder = 1000;
    this.mesh.visible = false;
    this.mesh.name = name;
    camera.add(this.mesh);
    this.resizeFor(camera);
  }

  set(color: THREE.Color, opacity: number): void {
    this.material.color.copy(color);
    this.material.opacity = opacity;
    this.mesh.visible = opacity > EPS;
  }

  resizeFor(camera: THREE.Camera): void {
    if (camera instanceof THREE.OrthographicCamera) {
      this.mesh.scale.set(camera.right - camera.left, camera.top - camera.bottom, 1);
    } else if (camera instanceof THREE.PerspectiveCamera) {
      const height = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * Math.abs(this.mesh.position.z);
      this.mesh.scale.set(height * camera.aspect, height, 1);
    }
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

// ---------------------------------------------------------------------------
// Screen fade
// ---------------------------------------------------------------------------

export class ScreenFade {
  private readonly overlay: OverlayQuad;
  private coverage = 0;
  private target = 0;
  private duration = 0;
  private revealing = false;
  private readonly startColor = new THREE.Color(0, 0, 0);
  private readonly targetColor = new THREE.Color(0, 0, 0);
  private readonly displayedColor = new THREE.Color(0, 0, 0);
  private readonly reduceMotion: boolean;
  private readonly camera: THREE.Camera;
  private disposed = false;

  constructor(camera: THREE.Camera, opts: OverlayOptions) {
    this.camera = camera;
    this.reduceMotion = opts.reduceMotion ?? false;
    this.overlay = new OverlayQuad(camera, 'screen-fade');
    opts.scope.own(this);
  }

  /** Current coverage 0 (clear) .. 1 (fully covered). */
  get progress(): number {
    return this.coverage;
  }

  get currentColor(): THREE.Color {
    return this.displayedColor.clone();
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  /** Fade to a color (coverage 0 -> 1). */
  fadeTo(color: THREE.ColorRepresentation, duration: number): void {
    this.startColor.copy(this.displayedColor);
    this.targetColor.set(color);
    this.revealing = false;
    this.target = 1;
    this.duration = this.reduceMotion ? 0 : Math.max(0, duration);
    if (this.duration === 0) this.coverage = 1;
  }

  /** Cover the screen (optionally switching color). */
  fadeOut(duration: number, color?: THREE.ColorRepresentation): void {
    if (color !== undefined) {
      this.startColor.copy(this.displayedColor);
      this.targetColor.set(color);
    }
    this.revealing = false;
    this.target = 1;
    this.duration = this.reduceMotion ? 0 : Math.max(0, duration);
    if (this.duration === 0) this.coverage = 1;
  }

  /** Reveal the world (coverage 1 -> 0); overlay keeps its current color. */
  fadeIn(duration: number): void {
    this.revealing = true;
    this.target = 0;
    this.duration = this.reduceMotion ? 0 : Math.max(0, duration);
    if (this.duration === 0) this.coverage = 0;
  }

  /** Advance by one sim step. */
  update(dt: number): void {
    if (this.disposed) return;
    if (this.coverage !== this.target) {
      const dir = this.target > this.coverage ? 1 : -1;
      const step = this.duration > 0 ? dt / this.duration : 1;
      this.coverage = THREE.MathUtils.clamp(this.coverage + dir * step, 0, 1);
      if (Math.abs(this.coverage - this.target) < 1e-6) this.coverage = this.target;
    }
    if (this.revealing) {
      this.displayedColor.copy(this.targetColor);
    } else {
      this.displayedColor.copy(this.startColor).lerp(this.targetColor, this.coverage);
    }
    this.overlay.resizeFor(this.camera);
    this.overlay.set(this.displayedColor, this.coverage);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.overlay.dispose();
  }
}

// ---------------------------------------------------------------------------
// Screen flash
// ---------------------------------------------------------------------------

export class ScreenFlash {
  private readonly overlay: OverlayQuad;
  private readonly color = new THREE.Color(1, 1, 1);
  private peak = 1;
  private duration = 1;
  private remaining = 0;
  private readonly reduceMotion: boolean;
  private readonly camera: THREE.Camera;
  private disposed = false;

  constructor(camera: THREE.Camera, opts: OverlayOptions) {
    this.camera = camera;
    this.reduceMotion = opts.reduceMotion ?? false;
    this.overlay = new OverlayQuad(camera, 'screen-flash');
    opts.scope.own(this);
  }

  get active(): boolean {
    return this.remaining > 0;
  }

  /** Brief full-screen color: instant on, linear decay over duration. */
  flash(color: THREE.ColorRepresentation, duration: number, peak = 1): void {
    if (this.disposed || this.reduceMotion) return;
    this.color.set(color);
    this.peak = THREE.MathUtils.clamp(peak, 0, 1);
    this.duration = Math.max(1e-4, duration);
    this.remaining = this.duration;
    this.overlay.resizeFor(this.camera);
    this.overlay.set(this.color, this.peak);
  }

  update(dt: number): void {
    if (this.disposed || this.remaining <= 0) return;
    this.remaining = Math.max(0, this.remaining - dt);
    this.overlay.resizeFor(this.camera);
    this.overlay.set(this.color, this.peak * (this.remaining / this.duration));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.remaining = 0;
    this.overlay.dispose();
  }
}

// ---------------------------------------------------------------------------
// Camera shake
// ---------------------------------------------------------------------------

export interface CameraShakeOptions {
  scope: Scope;
  /** Max positional offset in world units. Default 0.25. */
  amplitude?: number;
  /** Exponential trauma decay per second. Default 2.5. */
  decay?: number;
  /** Wobble frequency. Default 28. */
  frequency?: number;
  /** Max roll in radians. Default 0.06. */
  roll?: number;
  reduceMotion?: boolean;
}

/** Smooth-ish pseudo-noise in [-1, 1]. */
function noise1(x: number): number {
  return Math.sin(x) * 0.55 + Math.sin(x * 2.17 + 1.3) * 0.3 + Math.sin(x * 0.53 + 2.1) * 0.15;
}

/**
 * Trauma-based shake. update(dt) recomputes `offset`/`roll`; apply(camera)
 * subtracts the previous offset, captures the camera pose as base and adds
 * the new one; restore() returns the camera to that base. Contract: the
 * camera owner rewrites the pose every frame BEFORE apply() is called (the
 * standard loop is owner.updateCamera(); shake.update(dt); shake.apply(cam)).
 * Shake never writes anything else and never commits gameplay facts.
 */
export class CameraShake {
  private trauma = 0;
  private time = 0;
  private readonly offset = new THREE.Vector3();
  private rollAngle = 0;

  private readonly amplitude: number;
  private readonly decay: number;
  private readonly frequency: number;
  private readonly maxRoll: number;
  private readonly reduceMotion: boolean;

  private lastCamera: THREE.Camera | null = null;
  private readonly lastOffset = new THREE.Vector3();
  private lastRoll = 0;
  private applied = false;
  private disposed = false;

  constructor(opts: CameraShakeOptions) {
    this.amplitude = Math.max(0, opts.amplitude ?? 0.25);
    this.decay = Math.max(0, opts.decay ?? 2.5);
    this.frequency = Math.max(0, opts.frequency ?? 28);
    this.maxRoll = Math.max(0, opts.roll ?? 0.06);
    this.reduceMotion = opts.reduceMotion ?? false;
    opts.scope.own(this);
  }

  /** Add trauma (clamped to 1). No-op under reduce-motion. */
  shake(strength = 1): void {
    if (this.disposed || this.reduceMotion) return;
    this.trauma = Math.min(1, this.trauma + Math.max(0, strength));
  }

  get traumaLevel(): number {
    return this.trauma;
  }

  get isShaking(): boolean {
    return this.trauma > EPS;
  }

  get currentOffset(): THREE.Vector3 {
    return this.offset.clone();
  }

  get currentRoll(): number {
    return this.rollAngle;
  }

  /** Recompute offsets; trauma decays exponentially with sim dt. */
  update(dt: number): void {
    if (this.disposed) return;
    const step = Math.max(0, dt);
    if (this.reduceMotion) {
      this.trauma = 0;
    } else {
      this.trauma *= Math.exp(-this.decay * step);
      if (this.trauma < 1e-4) this.trauma = 0;
    }
    this.time += step;
    const a = this.amplitude * this.trauma * this.trauma;
    const f = this.time * this.frequency;
    this.offset
      .set(noise1(f), noise1(f + 37.2), noise1(f + 11.9))
      .multiplyScalar(a);
    this.rollAngle = this.maxRoll * this.trauma * this.trauma * noise1(f * 0.83 + 5.5);
  }

  /** Apply the current offset to the camera (subtracting any previous one). */
  apply(camera: THREE.Camera): void {
    this.unapply();
    if (this.disposed) return;
    if (this.offset.lengthSq() === 0 && this.rollAngle === 0) {
      this.lastCamera = null;
      return;
    }
    camera.position.add(this.offset);
    camera.rotation.z += this.rollAngle;
    this.lastOffset.copy(this.offset);
    this.lastRoll = this.rollAngle;
    this.lastCamera = camera;
    this.applied = true;
  }

  /** Remove the last applied offset/roll (idempotent). */
  restore(): void {
    this.unapply();
    this.lastCamera = null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.trauma = 0;
    this.offset.set(0, 0, 0);
    this.rollAngle = 0;
    this.restore();
  }

  private unapply(): void {
    if (!this.applied || !this.lastCamera) return;
    this.lastCamera.position.sub(this.lastOffset);
    this.lastCamera.rotation.z -= this.lastRoll;
    this.applied = false;
  }
}
