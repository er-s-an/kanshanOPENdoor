/**
 * Lightweight CPU particle emitter backed by THREE.Points.
 *
 * - Emission is `rate` particles/second accumulated from the sim dt passed to
 *   update() — simulation-driven, so pause simply stops calling update.
 * - Hard `maxParticles` cap: excess emission is dropped, never buffered.
 * - Dead particles are swap-recycled into the live pool; buffers are sized
 *   once at construction (no per-step allocation).
 * - Velocity cone + gravity, size/color lerp over life, per-particle via
 *   shader attributes.
 * - Scope-bound: disposing the scope disposes geometry/material.
 * - Reduce-motion: 'halve' (default) or 'stop' emission scaling.
 *
 * Offline note: tests exercise CPU state and buffer contents with real THREE
 * objects headless; actual rasterisation is NOT_MEASURED.
 */
import * as THREE from 'three';
import { CreativeError } from '../core/errors.ts';
import type { Scope } from '../core/scope.ts';
import type { Vec3 } from '../core/spatial.ts';

export type ColorLike = THREE.ColorRepresentation;

export type MinMax = number | { min: number; max: number };

export interface ParticleEmitterOptions {
  scope: Scope;
  /** Hard live-particle cap; also the buffer size. */
  maxParticles: number;
  /** Particles per second. Default 10. */
  rate?: number;
  /** Seconds of life. Default 1. */
  lifetime?: MinMax;
  /** Initial speed in units/second. Default 1. */
  speed?: MinMax;
  /** Emission direction cone; default is a uniform sphere. */
  cone?: { axis: Vec3; /** Half-angle in radians. */ angle: number };
  /** Constant acceleration. Default [0,0,0]. */
  gravity?: Vec3;
  /** Pixel-ish size over life. Default 1 -> 1. */
  size?: { start: number; end?: number };
  /** Color over life. Default white -> white. */
  color?: { start: ColorLike; end?: ColorLike };
  /** Reduce-motion emission scaling when reduceMotion is set. Default 'halve'. */
  reduceMotionEmission?: 'halve' | 'stop';
  reduceMotion?: boolean;
  /** Injectable RNG (deterministic tests/tools). Default Math.random. */
  random?: () => number;
}

export interface ParticleSnapshot {
  position: Vec3;
  velocity: Vec3;
  age: number;
  life: number;
  size: number;
  color: [number, number, number];
}

const VERT = `
attribute float psize;
attribute vec3 pcolor;
varying vec3 vColor;
void main() {
  vColor = pcolor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  // Inverse-depth sizing blows up for particles drifting at/behind the
  // camera; cap the sprite so near particles stay atmosphere, not walls.
  gl_PointSize = min(psize * (240.0 / max(0.35, -mv.z)), 150.0);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = `
varying vec3 vColor;
void main() {
  vec2 c = gl_PointCoord - vec2(0.5);
  if (dot(c, c) > 0.25) discard;
  gl_FragColor = vec4(vColor, 1.0);
}
`;

function mid(v: MinMax | undefined, dflt: number): { min: number; max: number } {
  if (v === undefined) return { min: dflt, max: dflt };
  if (typeof v === 'number') return { min: v, max: v };
  return { min: v.min, max: v.max };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

const _dir = new THREE.Vector3();
const _t = new THREE.Vector3();
const _u = new THREE.Vector3();
const _v = new THREE.Vector3();
const _col = new THREE.Color();

export class ParticleEmitter {
  readonly object: THREE.Points;
  readonly maxParticles: number;

  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly sizes: Float32Array;
  private readonly velocities: Float32Array;
  private readonly ages: Float32Array;
  private readonly lives: Float32Array;

  private alive = 0;
  private spawned = 0;
  private emissionAcc = 0;
  private rate: number;
  private lifetime: { min: number; max: number };
  private speed: { min: number; max: number };
  private readonly axis: THREE.Vector3 | null;
  private readonly coneAngle: number;
  private readonly gravity: THREE.Vector3;
  private readonly sizeStart: number;
  private readonly sizeEnd: number;
  private readonly colStart: THREE.Color;
  private readonly colEnd: THREE.Color;
  private readonly rmMode: 'halve' | 'stop';
  private readonly rand: () => number;
  private reduceMotion: boolean;
  private disposed = false;

  constructor(opts: ParticleEmitterOptions) {
    if (!Number.isInteger(opts.maxParticles) || opts.maxParticles <= 0) {
      throw new CreativeError('EFFECTS_BAD_EMITTER', 'maxParticles must be a positive integer', {
        phase: 'create',
        source: 'creative/effects/particles.ts',
      });
    }
    this.maxParticles = opts.maxParticles;
    this.rate = Math.max(0, opts.rate ?? 10);
    this.lifetime = mid(opts.lifetime, 1);
    this.speed = mid(opts.speed, 1);
    this.gravity = opts.gravity ? new THREE.Vector3(...opts.gravity) : new THREE.Vector3();
    if (opts.cone) {
      this.axis = new THREE.Vector3(...opts.cone.axis);
      if (this.axis.lengthSq() < 1e-12) {
        throw new CreativeError('EFFECTS_BAD_EMITTER', 'cone axis must be non-zero', {
          phase: 'create',
          source: 'creative/effects/particles.ts',
        });
      }
      this.axis.normalize();
      this.coneAngle = Math.max(0, opts.cone.angle);
    } else {
      this.axis = null;
      this.coneAngle = 0;
    }
    this.sizeStart = opts.size?.start ?? 1;
    this.sizeEnd = opts.size?.end ?? this.sizeStart;
    this.colStart = new THREE.Color(opts.color?.start ?? 0xffffff);
    this.colEnd = new THREE.Color(opts.color?.end ?? opts.color?.start ?? 0xffffff);
    this.rmMode = opts.reduceMotionEmission ?? 'halve';
    this.reduceMotion = opts.reduceMotion ?? false;
    this.rand = opts.random ?? Math.random;

    const max = this.maxParticles;
    this.positions = new Float32Array(max * 3);
    this.colors = new Float32Array(max * 3);
    this.sizes = new Float32Array(max);
    this.velocities = new Float32Array(max * 3);
    this.ages = new Float32Array(max);
    this.lives = new Float32Array(max);

    this.geometry = new THREE.BufferGeometry();
    const usage = THREE.DynamicDrawUsage;
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(usage));
    this.geometry.setAttribute('pcolor', new THREE.BufferAttribute(this.colors, 3).setUsage(usage));
    this.geometry.setAttribute('psize', new THREE.BufferAttribute(this.sizes, 1).setUsage(usage));
    this.geometry.setDrawRange(0, 0);

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
    });

    this.object = new THREE.Points(this.geometry, this.material);
    this.object.name = 'particles';
    this.object.frustumCulled = false;

    opts.scope.own(this);
  }

  get aliveCount(): number {
    return this.alive;
  }

  get totalSpawned(): number {
    return this.spawned;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  setRate(rate: number): void {
    this.rate = Math.max(0, rate);
  }

  setReduceMotion(reduceMotion: boolean): void {
    this.reduceMotion = reduceMotion;
  }

  /** Emit n particles immediately (author-triggered burst). Returns how many spawned. */
  burst(n: number): number {
    if (this.disposed) return 0;
    const scale = this.reduceMotion ? (this.rmMode === 'stop' ? 0 : 0.5) : 1;
    return this.spawn(Math.floor(n * scale));
  }

  /** Advance by one fixed simulation step. */
  update(dt: number): void {
    if (this.disposed) return;
    if (!(dt >= 0)) {
      throw new CreativeError('EFFECTS_BAD_EMITTER', 'dt must be >= 0', {
        phase: 'mechanics',
        source: 'creative/effects/particles.ts',
      });
    }

    const scale = this.reduceMotion ? (this.rmMode === 'stop' ? 0 : 0.5) : 1;
    this.emissionAcc += this.rate * scale * dt;
    let n = Math.floor(this.emissionAcc);
    this.emissionAcc -= n;
    if (n > 0) this.spawn(n);

    const g = this.gravity;
    const px = this.positions;
    const vx = this.velocities;
    const gx = g.x * dt;
    const gy = g.y * dt;
    const gz = g.z * dt;

    for (let i = 0; i < this.alive; i += 1) {
      const age = this.ages[i] + dt;
      if (age >= this.lives[i]) {
        this.kill(i);
        i -= 1;
        continue;
      }
      this.ages[i] = age;
      const i3 = i * 3;
      vx[i3] += gx;
      vx[i3 + 1] += gy;
      vx[i3 + 2] += gz;
      px[i3] += vx[i3] * dt;
      px[i3 + 1] += vx[i3 + 1] * dt;
      px[i3 + 2] += vx[i3 + 2] * dt;

      const t = age / this.lives[i];
      this.sizes[i] = lerp(this.sizeStart, this.sizeEnd, t);
      _col.copy(this.colStart).lerp(this.colEnd, t);
      this.colors[i3] = _col.r;
      this.colors[i3 + 1] = _col.g;
      this.colors[i3 + 2] = _col.b;
    }

    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.pcolor.needsUpdate = true;
    this.geometry.attributes.psize.needsUpdate = true;
    this.geometry.setDrawRange(0, this.alive);
  }

  /** Read-only snapshot of one live particle (diagnostics/tests). */
  inspect(index: number): ParticleSnapshot {
    if (index < 0 || index >= this.alive) {
      throw new CreativeError('EFFECTS_BAD_EMITTER', `particle index ${index} out of range (alive=${this.alive})`, {
        phase: 'query',
        source: 'creative/effects/particles.ts',
      });
    }
    const i3 = index * 3;
    return {
      position: [this.positions[i3], this.positions[i3 + 1], this.positions[i3 + 2]],
      velocity: [this.velocities[i3], this.velocities[i3 + 1], this.velocities[i3 + 2]],
      age: this.ages[index],
      life: this.lives[index],
      size: this.sizes[index],
      color: [this.colors[i3], this.colors[i3 + 1], this.colors[i3 + 2]],
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.alive = 0;
    this.geometry.setDrawRange(0, 0);
    this.geometry.dispose();
    this.material.dispose();
  }

  private spawn(n: number): number {
    let spawnedNow = 0;
    for (let k = 0; k < n && this.alive < this.maxParticles; k += 1) {
      const i = this.alive;
      const i3 = i * 3;
      this.sampleDirection(_dir);
      const speed = this.range(this.speed.min, this.speed.max);
      this.positions[i3] = 0;
      this.positions[i3 + 1] = 0;
      this.positions[i3 + 2] = 0;
      this.velocities[i3] = _dir.x * speed;
      this.velocities[i3 + 1] = _dir.y * speed;
      this.velocities[i3 + 2] = _dir.z * speed;
      this.ages[i] = 0;
      this.lives[i] = Math.max(1e-3, this.range(this.lifetime.min, this.lifetime.max));
      this.sizes[i] = this.sizeStart;
      this.colors[i3] = this.colStart.r;
      this.colors[i3 + 1] = this.colStart.g;
      this.colors[i3 + 2] = this.colStart.b;
      this.alive += 1;
      this.spawned += 1;
      spawnedNow += 1;
    }
    return spawnedNow;
  }

  private kill(i: number): void {
    const last = this.alive - 1;
    if (i !== last) {
      const i3 = i * 3;
      const l3 = last * 3;
      for (let c = 0; c < 3; c += 1) {
        this.positions[i3 + c] = this.positions[l3 + c];
        this.velocities[i3 + c] = this.velocities[l3 + c];
        this.colors[i3 + c] = this.colors[l3 + c];
      }
      this.ages[i] = this.ages[last];
      this.lives[i] = this.lives[last];
      this.sizes[i] = this.sizes[last];
    }
    this.alive = last;
  }

  private range(min: number, max: number): number {
    return min + this.rand() * (max - min);
  }

  private sampleDirection(out: THREE.Vector3): THREE.Vector3 {
    if (this.axis === null) {
      // Uniform on the sphere.
      const z = this.rand() * 2 - 1;
      const phi = this.rand() * Math.PI * 2;
      const r = Math.sqrt(Math.max(0, 1 - z * z));
      return out.set(r * Math.cos(phi), r * Math.sin(phi), z);
    }
    if (this.coneAngle <= 0) return out.copy(this.axis);
    // Orthonormal basis around the axis; jitter within the cone half-angle.
    _t.set(Math.abs(this.axis.y) < 0.9 ? 0 : 1, Math.abs(this.axis.y) < 0.9 ? 1 : 0, 0);
    _u.crossVectors(this.axis, _t).normalize();
    _v.crossVectors(this.axis, _u);
    const a = this.coneAngle * this.rand();
    const phi = this.rand() * Math.PI * 2;
    return out
      .copy(this.axis)
      .multiplyScalar(Math.cos(a))
      .addScaledVector(_u, Math.sin(a) * Math.cos(phi))
      .addScaledVector(_v, Math.sin(a) * Math.sin(phi))
      .normalize();
  }
}
