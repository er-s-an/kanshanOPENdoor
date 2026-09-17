/**
 * Declarative trigger volumes (interaction half of roadmap S12, gate G12
 * trigger): enter/exit notifications for volumes and moving bodies.
 *
 * Two bindings of the same idea:
 *
 * 1. createSensorTriggers(world) — volumes are real Rapier SENSOR bodies in a
 *    PhysicsWorld (the ONLY runtime physics dependency, and it arrives as an
 *    argument: this file imports no Rapier symbols itself). Events come from
 *    PhysicsWorld.drainTriggers(), so enter/exit pair exactly with the
 *    physics simulation (including removal-driven exits). Author callbacks
 *    receive the OTHER body (id + collider handle) in the pair.
 *
 * 2. createAabbTriggers() — a pure-AABB fallback for works WITHOUT physics:
 *    plain overlap math, zero Rapier, zero three.js. Volumes and tracked
 *    bodies are axis-aligned boxes the author moves via updateBody(); each
 *    update() diffs overlaps and fires edge callbacks. It is the author's job
 *    to call update() once per fixed step and to keep body AABBs honest.
 *
 * Both paths are edge-triggered: entering fires once, staying fires nothing,
 * leaving fires once.
 */
import { CreativeError } from '../core/errors.ts';
import type { Vec3, ColliderShape } from '../core/spatial.ts';
import type { PhysicsWorld } from '../physics/world.ts';

/** The other participant in an enter/exit pair (the body that isn't the volume). */
export interface TriggerOther {
  bodyId: string;
  /** Rapier collider handle; undefined on the pure-AABB path. */
  colliderHandle?: number;
}

export interface TriggerCallbacks {
  onEnter?(other: TriggerOther): void;
  onExit?(other: TriggerOther): void;
}

export interface TriggerFiring {
  volumeId: string;
  kind: 'enter' | 'exit';
  other: TriggerOther;
}

// ---------------------------------------------------------------------------
// Physics-bound: volumes as PhysicsWorld sensors
// ---------------------------------------------------------------------------

export interface SensorVolumeDef extends TriggerCallbacks {
  id: string;
  shape: ColliderShape;
  position: Vec3;
  /** Collision group label for the sensor body (query filtering). */
  group?: string;
}

export interface SensorTriggerSystem {
  add(def: SensorVolumeDef): () => void;
  remove(volumeId: string): boolean;
  /**
   * Drain the world's pending sensor events once and dispatch to volumes.
   * Call exactly once per fixed step (e.g. from the mechanics phase).
   */
  update(): TriggerFiring[];
  /** Registered volume ids (debug/inspect). */
  volumeIds(): string[];
}

export function createSensorTriggers(world: PhysicsWorld): SensorTriggerSystem {
  const volumes = new Map<string, { def: SensorVolumeDef; bodyId: string }>();
  const bodyIdToVolumeId = new Map<string, string>();

  const add = (def: SensorVolumeDef): (() => void) => {
    if (!def.id) {
      throw new CreativeError('TRIGGER_INVALID', 'sensor trigger: volume id must be non-empty', { phase: 'create' });
    }
    if (volumes.has(def.id)) {
      throw new CreativeError('TRIGGER_DUPLICATE', `sensor trigger: duplicate volume id "${def.id}"`, { phase: 'create' });
    }
    const bodyId = `trigger:${def.id}`;
    world.addBody(
      bodyId,
      { shape: def.shape, body: 'static', sensor: true, group: def.group ?? 'trigger' },
      { position: def.position },
    );
    volumes.set(def.id, { def, bodyId });
    bodyIdToVolumeId.set(bodyId, def.id);
    return () => {
      remove(def.id);
    };
  };

  const remove = (volumeId: string): boolean => {
    const entry = volumes.get(volumeId);
    if (!entry) return false;
    volumes.delete(volumeId);
    bodyIdToVolumeId.delete(entry.bodyId);
    // PhysicsWorld emits an exit for pairs that were active at removal; the
    // volume is gone, so those events dispatch to nothing (documented).
    return world.removeBody(entry.bodyId);
  };

  const update = (): TriggerFiring[] => {
    const fired: TriggerFiring[] = [];
    for (const event of world.drainTriggers()) {
      const aVolumeId = bodyIdToVolumeId.get(event.a.bodyId);
      const bVolumeId = bodyIdToVolumeId.get(event.b.bodyId);
      if (aVolumeId) {
        const volume = volumes.get(aVolumeId)!;
        const other: TriggerOther = { bodyId: event.b.bodyId, colliderHandle: event.b.colliderHandle };
        if (event.kind === 'enter') volume.def.onEnter?.(other);
        else volume.def.onExit?.(other);
        fired.push({ volumeId: aVolumeId, kind: event.kind, other });
      }
      if (bVolumeId) {
        const volume = volumes.get(bVolumeId)!;
        const other: TriggerOther = { bodyId: event.a.bodyId, colliderHandle: event.a.colliderHandle };
        if (event.kind === 'enter') volume.def.onEnter?.(other);
        else volume.def.onExit?.(other);
        fired.push({ volumeId: bVolumeId, kind: event.kind, other });
      }
    }
    return fired;
  };

  return {
    add,
    remove,
    update,
    volumeIds: () => [...volumes.keys()],
  };
}

// ---------------------------------------------------------------------------
// Physics-free: pure AABB volumes
// ---------------------------------------------------------------------------

export interface AabbBox {
  /** Box center. */
  position: Vec3;
  /** Box half extents (must be non-negative). */
  halfExtents: Vec3;
}

export interface AabbVolumeDef extends TriggerCallbacks {
  id: string;
  center: Vec3;
  halfExtents: Vec3;
}

export interface AabbTriggerSystem {
  addVolume(def: AabbVolumeDef): () => void;
  /** Removing a volume silently drops its active pairs (no exit callbacks). */
  removeVolume(volumeId: string): boolean;
  /** Start tracking a moving body (e.g. a character capsule's bounding box). */
  trackBody(bodyId: string, box: AabbBox): void;
  /** Move a tracked body; call once per step before update(). */
  updateBody(bodyId: string, box: AabbBox): void;
  /** Untracking closes any active pairs with a single exit callback. */
  untrackBody(bodyId: string): boolean;
  /** Diff all volume/body overlaps and fire enter/exit edge callbacks. */
  update(): TriggerFiring[];
  /** Currently overlapping pairs, as "volumeId::bodyId" keys (debug/inspect). */
  activePairs(): string[];
}

function assertBox(label: string, box: AabbBox): void {
  for (const [axis, value] of [
    ['x', box.position[0]],
    ['y', box.position[1]],
    ['z', box.position[2]],
  ] as const) {
    if (!Number.isFinite(value)) {
      throw new CreativeError('TRIGGER_INVALID', `${label}: ${axis} must be finite`, { phase: 'create' });
    }
  }
  for (const [axis, value] of [
    ['hx', box.halfExtents[0]],
    ['hy', box.halfExtents[1]],
    ['hz', box.halfExtents[2]],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) {
      throw new CreativeError('TRIGGER_INVALID', `${label}: ${axis} must be a non-negative finite number`, {
        phase: 'create',
      });
    }
  }
}

function overlaps(a: AabbBox, b: AabbBox): boolean {
  return (
    Math.abs(a.position[0] - b.position[0]) <= a.halfExtents[0] + b.halfExtents[0] &&
    Math.abs(a.position[1] - b.position[1]) <= a.halfExtents[1] + b.halfExtents[1] &&
    Math.abs(a.position[2] - b.position[2]) <= a.halfExtents[2] + b.halfExtents[2]
  );
}

export function createAabbTriggers(): AabbTriggerSystem {
  const volumes = new Map<string, AabbVolumeDef>();
  const bodies = new Map<string, AabbBox>();
  /** volumeId -> set of bodyIds currently overlapping. */
  const active = new Map<string, Set<string>>();

  const addVolume = (def: AabbVolumeDef): (() => void) => {
    if (!def.id) {
      throw new CreativeError('TRIGGER_INVALID', 'aabb trigger: volume id must be non-empty', { phase: 'create' });
    }
    if (volumes.has(def.id)) {
      throw new CreativeError('TRIGGER_DUPLICATE', `aabb trigger: duplicate volume id "${def.id}"`, { phase: 'create' });
    }
    assertBox(`aabb trigger "${def.id}"`, { position: def.center, halfExtents: def.halfExtents });
    volumes.set(def.id, { ...def, center: [...def.center] as Vec3, halfExtents: [...def.halfExtents] as Vec3 });
    return () => {
      removeVolume(def.id);
    };
  };

  const removeVolume = (volumeId: string): boolean => {
    if (!volumes.delete(volumeId)) return false;
    active.delete(volumeId);
    return true;
  };

  const trackBody = (bodyId: string, box: AabbBox): void => {
    if (!bodyId) {
      throw new CreativeError('TRIGGER_INVALID', 'aabb trigger: body id must be non-empty', { phase: 'create' });
    }
    assertBox(`aabb trigger body "${bodyId}"`, box);
    bodies.set(bodyId, { position: [...box.position] as Vec3, halfExtents: [...box.halfExtents] as Vec3 });
  };

  const updateBody = (bodyId: string, box: AabbBox): void => {
    assertBox(`aabb trigger body "${bodyId}"`, box);
    bodies.set(bodyId, { position: [...box.position] as Vec3, halfExtents: [...box.halfExtents] as Vec3 });
  };

  const untrackBody = (bodyId: string): boolean => {
    if (!bodies.delete(bodyId)) return false;
    for (const [volumeId, inside] of active) {
      if (inside.delete(bodyId)) {
        const other: TriggerOther = { bodyId };
        volumes.get(volumeId)?.onExit?.(other);
      }
    }
    return true;
  };

  const update = (): TriggerFiring[] => {
    const fired: TriggerFiring[] = [];
    for (const [volumeId, volume] of volumes) {
      let inside = active.get(volumeId);
      if (!inside) {
        inside = new Set();
        active.set(volumeId, inside);
      }
      const volumeBox: AabbBox = { position: volume.center, halfExtents: volume.halfExtents };
      for (const [bodyId, bodyBox] of bodies) {
        const now = overlaps(volumeBox, bodyBox);
        const was = inside.has(bodyId);
        if (now && !was) {
          inside.add(bodyId);
          const other: TriggerOther = { bodyId };
          volume.onEnter?.(other);
          fired.push({ volumeId, kind: 'enter', other });
        } else if (!now && was) {
          inside.delete(bodyId);
          const other: TriggerOther = { bodyId };
          volume.onExit?.(other);
          fired.push({ volumeId, kind: 'exit', other });
        }
      }
    }
    return fired;
  };

  const activePairs = (): string[] => {
    const out: string[] = [];
    for (const [volumeId, set] of active) {
      for (const bodyId of set) out.push(`${volumeId}::${bodyId}`);
    }
    return out.sort();
  };

  return { addVolume, removeVolume, trackBody, updateBody, untrackBody, update, activePairs };
}
