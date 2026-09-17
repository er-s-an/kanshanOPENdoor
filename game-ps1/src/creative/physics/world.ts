/**
 * PhysicsWorld: the ONLY creative-runtime module that imports Rapier
 * (@dimforge/rapier3d-compat). Works that never import creative/physics (or
 * creative/controllers, which builds on it) never pull the WASM into their
 * bundle.
 *
 * Responsibilities (roadmap S06, gates G06/G06.a):
 * - addBody/removeBody from neutral ColliderDesc (core/spatial.ts) plus an
 *   explicit transform: static | kinematic | dynamic bodies, sensors, and
 *   collision-group labels mapped lazily to 16-bit bit masks.
 * - step(dt): fixed-step advance, intended for the host 'physics' phase hook
 *   (see installPhysics). Runs optional pre-step hooks (mechanisms), drains
 *   sensor enter/exit events, and performs the declared mesh<->collider sync:
 *     * dynamic bodies write back to their Object3D root (physics authority)
 *     * kinematic bodies are driven FROM mechanism code via
 *       setNextKinematicTranslation (mechanism authority); the mesh pose is a
 *       copy of the same target transform, never a second source
 *     * static bodies never sync
 *   Hiding a mesh (visible = false) never disables collision; only
 *   removeBody() (or dispose) removes a body from the simulation.
 * - Queries: raycast / castShape / overlap with self-exclusion and group
 *   filters. A removed body no longer hits because it no longer exists in the
 *   Rapier world.
 * - Triggers: sensor enter/exit pairs, drained once per step.
 * - Bounded debug data for inspect tools: listColliders / contacts.
 *
 * Group semantics (honest, R1): every body gets exactly one group label
 * (default 'default'). Groups do NOT change physical collision — everything
 * collides with everything unless it is a sensor. Groups only filter queries:
 * a group-filtered query matches bodies whose label is in the requested set.
 */
import type * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { CreativeError } from '../core/errors.ts';
import type { ColliderDesc, ColliderShape, Vec3 } from '../core/spatial.ts';
import type { SceneContext } from '../core/context.ts';

export type Quat = [number, number, number, number];
export type BodyKind = 'static' | 'kinematic' | 'dynamic';

export interface BodyTransform {
  position: Vec3;
  quaternion?: Quat;
}

export interface AddBodyOptions {
  /**
   * Object3D root registered as the dynamic write-back target. Only dynamic
   * bodies sync (kinematic bodies are driven from mechanism code, static
   * bodies never move). Ignored for non-dynamic bodies.
   */
  object?: THREE.Object3D;
}

/** Query filtering: exclude bodies by id / collider handle, or restrict to groups. */
export interface QueryOptions {
  excludeBody?: string;
  excludeColliderHandle?: number;
  groups?: string[];
  /** Raycast only: report hits from inside a shape too (default true). */
  solid?: boolean;
}

export interface RayHit {
  bodyId: string;
  colliderHandle: number;
  distance: number;
  point: Vec3;
  normal: Vec3;
}

export interface ShapeHit {
  bodyId: string;
  colliderHandle: number;
  /** Distance travelled along the cast direction before impact. */
  distance: number;
  /** World position of the swept shape at impact. */
  point: Vec3;
  /** Outward normal on the swept shape at impact (opposes the sweep). */
  normal: Vec3;
}

export interface TriggerEndpoint {
  bodyId: string;
  colliderHandle: number;
}

export interface TriggerEvent {
  kind: 'enter' | 'exit';
  a: TriggerEndpoint;
  b: TriggerEndpoint;
}

export interface ColliderInfo {
  bodyId: string;
  colliderHandle: number;
  kind: BodyKind;
  shape: ColliderShape['kind'];
  sensor: boolean;
  group: string;
  position: Vec3;
}

export interface ContactInfo {
  a: string;
  b: string;
}

export interface PhysicsWorldOptions {
  gravity?: Vec3;
  /** Hard cap on distinct group labels (16-bit masks). Default 16. */
  maxGroups?: number;
  /** Bound for listColliders/contacts. Default 200. */
  maxDebugEntries?: number;
  /** Bound for overlap results. Default 100. */
  maxQueryHits?: number;
}

const DEFAULT_GROUP = 'default';
const MAX_GROUP_BITS = 16;

interface BodyRecord {
  id: string;
  kind: BodyKind;
  sensor: boolean;
  group: string;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  object?: THREE.Object3D;
  /** Kinematic translation captured before the last world.step (carry math). */
  preStepPos: { x: number; y: number; z: number } | null;
  /** Actual per-step displacement of a kinematic body from the last step. */
  lastDelta: Vec3;
}

export interface TriggerPair {
  key: string;
  a: TriggerEndpoint;
  b: TriggerEndpoint;
}

let rapierReady: Promise<void> | null = null;

/** Idempotent Rapier WASM init (the compat build embeds the WASM). */
export function readyRapier(): Promise<void> {
  rapierReady ??= RAPIER.init();
  return rapierReady;
}

/**
 * Create an initialized world (awaits RAPIER.init). For host integration use
 * installPhysics(ctx, opts) instead, which also wires the 'physics' phase
 * hook and scope disposal.
 */
export async function createPhysicsWorld(opts?: PhysicsWorldOptions): Promise<PhysicsWorld> {
  await readyRapier();
  return new PhysicsWorld(opts);
}

/**
 * Host integration: creates the world, registers step() on the 'physics'
 * phase and disposal on the instance scope. Call from an async create():
 *   const physics = await installPhysics(ctx);
 */
export async function installPhysics(ctx: SceneContext, opts?: PhysicsWorldOptions): Promise<PhysicsWorld> {
  const world = await createPhysicsWorld(opts);
  ctx.scope.own(world);
  ctx.onPhase('physics', (frame) => world.step(frame.dt));
  return world;
}

export class PhysicsBody {
  readonly id: string;
  readonly kind: BodyKind;
  readonly sensor: boolean;
  readonly group: string;
  /** Dynamic write-back target (physics owns this root's transform). */
  readonly object: THREE.Object3D | undefined;
  /** Escape hatch for in-package mechanisms/advanced use; prefer the adapter API. */
  readonly rigidBody: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;

  constructor(record: BodyRecord) {
    this.id = record.id;
    this.kind = record.kind;
    this.sensor = record.sensor;
    this.group = record.group;
    this.object = record.object;
    this.rigidBody = record.body;
    this.collider = record.collider;
  }
}

export class PhysicsWorld {
  private readonly world: RAPIER.World;
  private readonly eventQueue: RAPIER.EventQueue;
  private readonly byId = new Map<string, BodyRecord>();
  private readonly byColliderHandle = new Map<number, BodyRecord>();
  private readonly groupBits = new Map<string, number>();
  private readonly activeTriggers = new Map<string, TriggerPair>();
  private readonly pendingTriggers: TriggerEvent[] = [];
  private readonly preStepHooks: Array<(dt: number) => void> = [];
  private readonly controllers = new Set<RAPIER.KinematicCharacterController>();
  private readonly gravity: Vec3;
  private readonly maxDebugEntries: number;
  private readonly maxQueryHits: number;
  private readonly maxGroups: number;
  private disposed = false;

  constructor(opts?: PhysicsWorldOptions) {
    this.gravity = opts?.gravity ?? [0, -9.81, 0];
    this.maxDebugEntries = opts?.maxDebugEntries ?? 200;
    this.maxQueryHits = opts?.maxQueryHits ?? 100;
    this.maxGroups = Math.min(opts?.maxGroups ?? MAX_GROUP_BITS, MAX_GROUP_BITS);
    this.world = new RAPIER.World({ x: this.gravity[0], y: this.gravity[1], z: this.gravity[2] });
    this.eventQueue = new RAPIER.EventQueue(true);
  }

  get disposedWorld(): boolean {
    return this.disposed;
  }

  /** Escape hatch to the raw Rapier world (in-package use; prefer the adapter API). */
  get rawWorld(): RAPIER.World {
    this.assertLive();
    return this.world;
  }

  /** Bit mask (16-bit) assigned to a group label; lazily allocated. */
  groupBit(label: string): number {
    const existing = this.groupBits.get(label);
    if (existing !== undefined) return existing;
    if (this.groupBits.size >= this.maxGroups) {
      throw new CreativeError(
        'GROUP_LIMIT',
        `physics collision groups are capped at ${this.maxGroups}; got a new label "${label}"`,
        { phase: 'create' },
      );
    }
    const bit = 1 << this.groupBits.size;
    this.groupBits.set(label, bit);
    return bit;
  }

  /** All registered group labels, in bit-allocation order. */
  groupLabels(): string[] {
    return [...this.groupBits.keys()];
  }

  /**
   * Create a body (+ its collider) from a neutral description and an explicit
   * transform. Queries (raycast/shape cast/overlap) reflect the new body from
   * the next step() onwards — Rapier updates the query pipeline during step.
   */
  addBody(id: string, desc: ColliderDesc, transform: BodyTransform, opts?: AddBodyOptions): PhysicsBody {
    this.assertLive();
    if (this.byId.has(id)) {
      throw new CreativeError('DUPLICATE_BODY', `a physics body with id "${id}" already exists`, { phase: 'create' });
    }
    if (desc.shape.kind === 'trimesh' && desc.body === 'dynamic') {
      throw new CreativeError(
        'OUT_OF_SCOPE',
        'dynamic concave/trimesh collision is not part of R1: use a convex hull for dynamic bodies, ' +
          'or mark the trimesh static. The request was rejected instead of silently approximated.',
        { phase: 'create' },
      );
    }
    const colliderDesc = colliderDescFrom(desc.shape);
    if (desc.sensor) {
      colliderDesc.setSensor(true);
      colliderDesc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
      // Trigger zones must fire for characters and platforms (kinematic) too:
      // Rapier's default only enables dynamic-vs-anything collision detection.
      colliderDesc.setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.ALL);
    }
    const group = desc.group ?? DEFAULT_GROUP;
    const bit = this.groupBit(group);
    // membership = this label's bit, filter = everything: groups filter
    // queries only; physical collision stays all-vs-all (sensors aside).
    colliderDesc.setCollisionGroups(((bit << 16) | 0xffff) >>> 0);

    const bodyDesc =
      desc.body === 'static'
        ? RAPIER.RigidBodyDesc.fixed()
        : desc.body === 'kinematic'
          ? RAPIER.RigidBodyDesc.kinematicPositionBased()
          : RAPIER.RigidBodyDesc.dynamic();
    bodyDesc.setTranslation(transform.position[0], transform.position[1], transform.position[2]);
    if (transform.quaternion) {
      bodyDesc.setRotation({
        x: transform.quaternion[0],
        y: transform.quaternion[1],
        z: transform.quaternion[2],
        w: transform.quaternion[3],
      });
    }

    const body = this.world.createRigidBody(bodyDesc);
    let collider: RAPIER.Collider;
    try {
      collider = this.world.createCollider(colliderDesc, body);
    } catch (err) {
      // Shape construction is lazy in Rapier: hull/trimesh failures surface here.
      this.world.removeRigidBody(body);
      const message = err instanceof Error ? err.message : String(err);
      throw new CreativeError(
        'INVALID_COLLIDER',
        `failed to build ${desc.shape.kind} collider for body "${id}": ${message}`,
        { phase: 'create', cause: err },
      );
    }
    const record: BodyRecord = {
      id,
      kind: desc.body,
      sensor: desc.sensor ?? false,
      group,
      body,
      collider,
      object: desc.body === 'dynamic' ? opts?.object : undefined,
      preStepPos: null,
      lastDelta: [0, 0, 0],
    };
    this.byId.set(id, record);
    this.byColliderHandle.set(collider.handle, record);
    return new PhysicsBody(record);
  }

  hasBody(id: string): boolean {
    return this.byId.has(id);
  }

  bodyIdOfCollider(colliderHandle: number): string | null {
    return this.byColliderHandle.get(colliderHandle)?.id ?? null;
  }

  /** Remove a body and its colliders from the simulation. Collision stops immediately:
   *  hiding the mesh never does this — removal is the explicit off switch. */
  removeBody(id: string): boolean {
    this.assertLive();
    const record = this.byId.get(id);
    if (!record) return false;
    this.byId.delete(id);
    this.byColliderHandle.delete(record.collider.handle);
    for (const [key, pair] of this.activeTriggers) {
      if (pair.a.bodyId === id || pair.b.bodyId === id) {
        this.activeTriggers.delete(key);
        this.pendingTriggers.push({ kind: 'exit', a: pair.a, b: pair.b });
      }
    }
    this.world.removeRigidBody(record.body);
    return true;
  }

  /**
   * Mechanism authority for kinematic bodies: declare where the body will be
   * after the next step. Mechanism code calls this once per step (the
   * mechanism classes in mechanisms.ts do it from update(dt)); the render
   * mesh must be posed from the SAME target transform, not re-derived.
   */
  setKinematicTarget(id: string, position: Vec3, quaternion?: Quat): void {
    this.assertLive();
    const record = this.requireBody(id);
    record.body.setNextKinematicTranslation({ x: position[0], y: position[1], z: position[2] });
    if (quaternion) {
      record.body.setNextKinematicRotation({ x: quaternion[0], y: quaternion[1], z: quaternion[2], w: quaternion[3] });
    }
  }

  /**
   * Actual displacement a kinematic body experienced during the last step().
   * Character controllers add this to their desired movement so a character
   * standing on a moving platform is carried (platform carry).
   */
  kinematicDelta(id: string): Vec3 {
    this.assertLive();
    const record = this.requireBody(id);
    return [...record.lastDelta] as Vec3;
  }

  /** Register a hook that runs at the start of every step(), before world.step.
   *  Mechanisms that need same-step carry semantics drive their targets here. */
  beforeStep(fn: (dt: number) => void): () => void {
    this.assertLive();
    this.preStepHooks.push(fn);
    return () => {
      const idx = this.preStepHooks.indexOf(fn);
      if (idx >= 0) this.preStepHooks.splice(idx, 1);
    };
  }

  /** Advance the simulation by dt seconds (fixed-step; pass clock.fixedDt). */
  step(dt: number): void {
    this.assertLive();
    if (!(dt > 0) || !Number.isFinite(dt)) {
      throw new CreativeError('BAD_TIMESTEP', `step dt must be a positive finite number, got ${dt}`, { phase: 'physics' });
    }
    for (const hook of this.preStepHooks) hook(dt);
    this.world.timestep = dt;
    for (const record of this.byId.values()) {
      if (record.kind === 'kinematic') record.preStepPos = record.body.translation();
    }
    this.world.step(this.eventQueue);
    this.eventQueue.drainCollisionEvents((h1, h2, started) => this.onCollisionEvent(h1, h2, started));
    for (const record of this.byId.values()) {
      if (record.kind !== 'kinematic' || !record.preStepPos) continue;
      const now = record.body.translation();
      const before = record.preStepPos;
      record.lastDelta = [now.x - before.x, now.y - before.y, now.z - before.z];
    }
    // ONE declared sync authority: dynamic bodies write back to their root;
    // kinematic bodies are driven from mechanism code; static never syncs.
    for (const record of this.byId.values()) {
      if (record.kind !== 'dynamic' || !record.object) continue;
      const t = record.body.translation();
      const r = record.body.rotation();
      record.object.position.set(t.x, t.y, t.z);
      record.object.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  /** Sensor enter/exit events accumulated since the previous drain. */
  drainTriggers(): TriggerEvent[] {
    this.assertLive();
    const out = this.pendingTriggers.splice(0, this.pendingTriggers.length);
    return out;
  }

  /** Currently active (overlapping) sensor pairs. */
  activeTriggerPairs(): TriggerPair[] {
    this.assertLive();
    return [...this.activeTriggers.values()].map((pair) => ({ ...pair, a: { ...pair.a }, b: { ...pair.b } }));
  }

  /** Nearest hit along a ray, or null. Direction is normalized here. */
  raycast(origin: Vec3, direction: Vec3, maxDistance = 1000, opts?: QueryOptions): RayHit | null {
    this.assertLive();
    const len = Math.hypot(direction[0], direction[1], direction[2]);
    if (len < 1e-9) {
      throw new CreativeError('BAD_RAY', 'raycast direction must be non-zero', { phase: 'query' });
    }
    const dir: Vec3 = [direction[0] / len, direction[1] / len, direction[2] / len];
    const ray = new RAPIER.Ray({ x: origin[0], y: origin[1], z: origin[2] }, { x: dir[0], y: dir[1], z: dir[2] });
    const filters = this.makeFilters(opts);
    const hit = this.world.castRayAndGetNormal(
      ray,
      maxDistance,
      opts?.solid ?? true,
      undefined,
      filters.groups,
      filters.excludeCollider,
      filters.excludeRigidBody,
      filters.predicate,
    );
    if (!hit) return null;
    const record = this.byColliderHandle.get(hit.collider.handle);
    return {
      bodyId: record?.id ?? '',
      colliderHandle: hit.collider.handle,
      distance: hit.timeOfImpact,
      point: [
        origin[0] + dir[0] * hit.timeOfImpact,
        origin[1] + dir[1] * hit.timeOfImpact,
        origin[2] + dir[2] * hit.timeOfImpact,
      ],
      normal: [hit.normal.x, hit.normal.y, hit.normal.z],
    };
  }

  /** Sweep a shape along a constant velocity; returns the first hit, or null. */
  castShape(
    shape: ColliderShape,
    position: Vec3,
    rotation: Quat | undefined,
    velocity: Vec3,
    maxDistance: number,
    opts?: QueryOptions,
  ): ShapeHit | null {
    this.assertLive();
    const speed = Math.hypot(velocity[0], velocity[1], velocity[2]);
    if (speed < 1e-9) {
      throw new CreativeError('BAD_CAST', 'castShape velocity must be non-zero', { phase: 'query' });
    }
    const native = makeNativeShape(shape);
    const rot = rotation ? { x: rotation[0], y: rotation[1], z: rotation[2], w: rotation[3] } : { x: 0, y: 0, z: 0, w: 1 };
    const filters = this.makeFilters(opts);
    const hit = this.world.castShape(
      { x: position[0], y: position[1], z: position[2] },
      rot,
      { x: velocity[0], y: velocity[1], z: velocity[2] },
      native,
      0,
      maxDistance / speed,
      true,
      undefined,
      filters.groups,
      filters.excludeCollider,
      filters.excludeRigidBody,
      filters.predicate,
    );
    if (!hit) return null;
    const record = this.byColliderHandle.get(hit.collider.handle);
    const toi = hit.time_of_impact;
    return {
      bodyId: record?.id ?? '',
      colliderHandle: hit.collider.handle,
      distance: toi * speed,
      point: [
        position[0] + velocity[0] * toi,
        position[1] + velocity[1] * toi,
        position[2] + velocity[2] * toi,
      ],
      normal: [hit.normal1.x, hit.normal1.y, hit.normal1.z],
    };
  }

  /** Bodies whose colliders overlap the given shape (bounded). */
  overlap(shape: ColliderShape, position: Vec3, rotation: Quat | undefined, opts?: QueryOptions, limit?: number): string[] {
    this.assertLive();
    const cap = Math.min(limit ?? this.maxQueryHits, this.maxQueryHits);
    const native = makeNativeShape(shape);
    const rot = rotation ? { x: rotation[0], y: rotation[1], z: rotation[2], w: rotation[3] } : { x: 0, y: 0, z: 0, w: 1 };
    const filters = this.makeFilters(opts);
    const ids: string[] = [];
    this.world.intersectionsWithShape(
      { x: position[0], y: position[1], z: position[2] },
      rot,
      native,
      (collider) => {
        const record = this.byColliderHandle.get(collider.handle);
        if (record && !ids.includes(record.id)) ids.push(record.id);
        return ids.length < cap;
      },
      undefined,
      filters.groups,
      filters.excludeCollider,
      filters.excludeRigidBody,
      filters.predicate,
    );
    return ids;
  }

  /** Bounded debug listing of every collider (inspect tools). */
  listColliders(limit?: number): ColliderInfo[] {
    this.assertLive();
    const cap = Math.min(limit ?? this.maxDebugEntries, this.maxDebugEntries);
    const out: ColliderInfo[] = [];
    this.world.colliders.forEach((collider) => {
      if (out.length >= cap) return;
      const record = this.byColliderHandle.get(collider.handle);
      if (!record) return;
      const t = collider.translation();
      out.push({
        bodyId: record.id,
        colliderHandle: collider.handle,
        kind: record.kind,
        shape: shapeKind(collider.shapeType()),
        sensor: collider.isSensor(),
        group: record.group,
        position: [t.x, t.y, t.z],
      });
    });
    return out;
  }

  /** Bounded debug listing of current contact pairs (inspect tools). */
  contacts(limit?: number): ContactInfo[] {
    this.assertLive();
    const cap = Math.min(limit ?? this.maxDebugEntries, this.maxDebugEntries);
    const out: ContactInfo[] = [];
    this.world.colliders.forEach((collider) => {
      if (out.length >= cap) return;
      this.world.contactPairsWith(collider, (other) => {
        if (out.length >= cap) return;
        if (collider.handle >= other.handle) return; // dedupe unordered pairs
        const a = this.byColliderHandle.get(collider.handle);
        const b = this.byColliderHandle.get(other.handle);
        if (a && b) out.push({ a: a.id, b: b.id });
      });
    });
    return out;
  }

  /** Character controller factory (tracked; freed at dispose). */
  createCharacterController(offset: number): RAPIER.KinematicCharacterController {
    this.assertLive();
    const controller = this.world.createCharacterController(offset);
    this.controllers.add(controller);
    return controller;
  }

  releaseCharacterController(controller: RAPIER.KinematicCharacterController): boolean {
    if (!this.controllers.delete(controller)) return false;
    if (!this.disposed) this.world.removeCharacterController(controller);
    return true;
  }

  /** Frees the Rapier world, event queue and every character controller. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.preStepHooks.length = 0;
    for (const controller of this.controllers) {
      try {
        this.world.removeCharacterController(controller);
      } catch {
        /* freeing must never throw */
      }
    }
    this.controllers.clear();
    try {
      this.eventQueue.free();
    } catch {
      /* ignore */
    }
    try {
      this.world.free();
    } catch {
      /* ignore */
    }
    this.byId.clear();
    this.byColliderHandle.clear();
    this.activeTriggers.clear();
    this.pendingTriggers.length = 0;
  }

  private requireBody(id: string): BodyRecord {
    const record = this.byId.get(id);
    if (!record) {
      throw new CreativeError('UNKNOWN_BODY', `no physics body with id "${id}"`, { phase: 'physics' });
    }
    return record;
  }

  private assertLive(): void {
    if (this.disposed) {
      throw new CreativeError('PHYSICS_DISPOSED', 'PhysicsWorld is disposed; create a new one per session', {
        phase: 'physics',
      });
    }
  }

  private makeFilters(opts?: QueryOptions): {
    groups?: number;
    excludeCollider?: RAPIER.Collider;
    excludeRigidBody?: RAPIER.RigidBody;
    predicate?: (collider: RAPIER.Collider) => boolean;
  } {
    const groups = opts?.groups ? this.groupUnionMask(opts.groups) : undefined;
    const excludeRecord =
      opts?.excludeColliderHandle !== undefined ? this.byColliderHandle.get(opts.excludeColliderHandle) : undefined;
    const needsPredicate = Boolean(opts?.excludeBody) || Boolean(excludeRecord);
    const predicate = needsPredicate
      ? (collider: RAPIER.Collider): boolean => {
          if (opts?.excludeColliderHandle !== undefined && collider.handle === opts.excludeColliderHandle) return false;
          const record = this.byColliderHandle.get(collider.handle);
          if (record && opts?.excludeBody && record.id === opts.excludeBody) return false;
          return true;
        }
      : undefined;
    return {
      groups,
      excludeCollider: excludeRecord?.collider,
      excludeRigidBody: undefined,
      predicate,
    };
  }

  /** Query interaction groups: match bodies whose label bit is in the union. */
  private groupUnionMask(labels: string[]): number {
    let union = 0;
    for (const label of labels) union |= this.groupBit(label);
    if (union === 0) return 0;
    return (((union << 16) | union) >>> 0);
  }

  private onCollisionEvent(h1: number, h2: number, started: boolean): void {
    const r1 = this.byColliderHandle.get(h1);
    const r2 = this.byColliderHandle.get(h2);
    if (!r1 || !r2) return;
    if (!r1.sensor && !r2.sensor) return;
    const key = h1 < h2 ? `${h1}:${h2}` : `${h2}:${h1}`;
    const active = this.activeTriggers.get(key);
    if (started && !active) {
      const pair: TriggerPair = {
        key,
        a: { bodyId: r1.id, colliderHandle: h1 },
        b: { bodyId: r2.id, colliderHandle: h2 },
      };
      this.activeTriggers.set(key, pair);
      this.pendingTriggers.push({ kind: 'enter', a: { ...pair.a }, b: { ...pair.b } });
    } else if (!started && active) {
      this.activeTriggers.delete(key);
      this.pendingTriggers.push({ kind: 'exit', a: { ...active.a }, b: { ...active.b } });
    }
  }
}

function shapeKind(shapeType: RAPIER.ShapeType): ColliderShape['kind'] {
  switch (shapeType) {
    case RAPIER.ShapeType.Ball:
      return 'sphere';
    case RAPIER.ShapeType.Cuboid:
      return 'box';
    case RAPIER.ShapeType.Cylinder:
      return 'cylinder';
    case RAPIER.ShapeType.TriMesh:
      return 'trimesh';
    default:
      return 'convex';
  }
}

function colliderDescFrom(shape: ColliderShape): RAPIER.ColliderDesc {
  let desc: RAPIER.ColliderDesc;
  switch (shape.kind) {
    case 'box':
      desc = RAPIER.ColliderDesc.cuboid(shape.halfExtents[0], shape.halfExtents[1], shape.halfExtents[2]);
      break;
    case 'cylinder':
      desc = RAPIER.ColliderDesc.cylinder(shape.halfHeight, shape.radius);
      break;
    case 'sphere':
      desc = RAPIER.ColliderDesc.ball(shape.radius);
      break;
    case 'convex': {
      const points = new Float32Array(shape.points.length * 3);
      shape.points.forEach((p, i) => {
        points[i * 3] = p[0];
        points[i * 3 + 1] = p[1];
        points[i * 3 + 2] = p[2];
      });
      let convex: RAPIER.ColliderDesc | null = null;
      try {
        convex = RAPIER.ColliderDesc.convexHull(points);
      } catch {
        convex = null;
      }
      if (!convex) {
        throw new CreativeError(
          'INVALID_COLLIDER',
          'convex hull could not be computed from the given points (need a non-degenerate point cloud)',
          { phase: 'create' },
        );
      }
      desc = convex;
      break;
    }
    case 'trimesh': {
      const vertices = new Float32Array(shape.vertices.length * 3);
      shape.vertices.forEach((v, i) => {
        vertices[i * 3] = v[0];
        vertices[i * 3 + 1] = v[1];
        vertices[i * 3 + 2] = v[2];
      });
      const indices = new Uint32Array(shape.indices.length * 3);
      shape.indices.forEach((tri, i) => {
        indices[i * 3] = tri[0];
        indices[i * 3 + 1] = tri[1];
        indices[i * 3 + 2] = tri[2];
      });
      desc = RAPIER.ColliderDesc.trimesh(vertices, indices);
      break;
    }
  }
  if (shape.offset) {
    desc.setTranslation(shape.offset[0], shape.offset[1], shape.offset[2]);
  }
  return desc;
}

function makeNativeShape(shape: ColliderShape): RAPIER.Shape {
  switch (shape.kind) {
    case 'box':
      return new RAPIER.Cuboid(shape.halfExtents[0], shape.halfExtents[1], shape.halfExtents[2]);
    case 'cylinder':
      return new RAPIER.Cylinder(shape.halfHeight, shape.radius);
    case 'sphere':
      return new RAPIER.Ball(shape.radius);
    case 'convex': {
      const points = new Float32Array(shape.points.length * 3);
      shape.points.forEach((p, i) => {
        points[i * 3] = p[0];
        points[i * 3 + 1] = p[1];
        points[i * 3 + 2] = p[2];
      });
      return new RAPIER.ConvexPolyhedron(points);
    }
    case 'trimesh': {
      const vertices = new Float32Array(shape.vertices.length * 3);
      shape.vertices.forEach((v, i) => {
        vertices[i * 3] = v[0];
        vertices[i * 3 + 1] = v[1];
        vertices[i * 3 + 2] = v[2];
      });
      const indices = new Uint32Array(shape.indices.length * 3);
      shape.indices.forEach((tri, i) => {
        indices[i * 3] = tri[0];
        indices[i * 3 + 1] = tri[1];
        indices[i * 3 + 2] = tri[2];
      });
      return new RAPIER.TriMesh(vertices, indices);
    }
  }
}

/** Quaternion for a yaw rotation around +Y. */
export function quatFromYaw(yaw: number): Quat {
  return [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
}

export function yawFromQuat(q: Quat): number {
  return Math.atan2(2 * (q[3] * q[1] + q[0] * q[2]), 1 - 2 * (q[1] * q[1] + q[0] * q[0]));
}
