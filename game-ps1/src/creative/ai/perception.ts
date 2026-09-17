/**
 * Perception: line-of-sight and range checks (roadmap S10, gate G10).
 *
 * The raycast used for line-of-sight is INJECTED and matches the
 * PhysicsWorld.raycast signature, so tests can pass a fake and works that
 * never import physics can pass any other implementation. At runtime the
 * natural wiring is:
 *
 *   const perception = createPerception({
 *     raycast: (origin, dir, maxDist, query) => world.raycast(origin, dir, maxDist, query),
 *   });
 *
 * The module has no runtime dependency on Rapier or on creative/physics; the
 * QueryOptions/RayHit types below are type-only imports and are erased.
 *
 * Honest limits:
 * - LOS is a single ray between two points (plus optional eye/target offsets).
 *   It is not a vision cone (facing checks live in interaction/system.ts) and
 *   it does not account for partial cover: anything intersecting the ray
 *   segment before the target blocks.
 * - `range` checks are straight-line distances; works needing navigation
 *   distance use ai/nav.ts.
 */
import type { Vec3 } from '../core/spatial.ts';
import type { QueryOptions, RayHit } from '../physics/world.ts';

/** Injectable raycast matching PhysicsWorld.raycast (world.ts). */
export type RaycastFn = (
  origin: Vec3,
  direction: Vec3,
  maxDistance?: number,
  opts?: QueryOptions,
) => RayHit | null;

export interface LineOfSightResult {
  /** True when nothing intersects the segment from -> to. */
  clear: boolean;
  /** Body id of the nearest blocker, when not clear. */
  blockingBodyId?: string;
  /** Distance from `from` to the blocker, when not clear. */
  hitDistance?: number;
}

export interface PerceptionOptions {
  /** Hard range cap for line-of-sight rays (default: unlimited). */
  maxDistance?: number;
  /** Added to observer positions (e.g. eye height). Default [0,0,0]. */
  eyeOffset?: Vec3;
  /** Added to target positions. Default [0,0,0]. */
  targetOffset?: Vec3;
  /** Extra query options handed to the raycast (groups, self-exclusion...). */
  query?: QueryOptions;
  /**
   * A blocker counts only when its hit lands at least this far before the
   * target (guards against a face coplanar with the target). Default 1e-3.
   */
  epsilon?: number;
}

export function distanceBetween(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Straight-line range check. */
export function inRange(from: Vec3, to: Vec3, maxDistance: number): boolean {
  return distanceBetween(from, to) <= maxDistance;
}

/**
 * Single-segment occlusion test. A hit strictly before the target blocks; a
 * hit at/after the target distance (or no hit) means clear. Zero-length
 * segments are trivially clear.
 */
export function lineOfSight(raycast: RaycastFn, from: Vec3, to: Vec3, opts?: PerceptionOptions): LineOfSightResult {
  const a = add(from, opts?.eyeOffset);
  const b = add(to, opts?.targetOffset);
  const segment = distanceBetween(a, b);
  const epsilon = opts?.epsilon ?? 1e-3;
  if (segment < epsilon) return { clear: true };
  // The ray travels at most the segment length; maxDistance caps it shorter
  // (blockers beyond the cap are ignored).
  const rayMax = Math.min(segment, opts?.maxDistance ?? segment);
  const dir: Vec3 = [(b[0] - a[0]) / segment, (b[1] - a[1]) / segment, (b[2] - a[2]) / segment];
  const hit = raycast(a, dir, rayMax, opts?.query);
  if (hit && hit.distance < segment - epsilon) {
    return { clear: false, blockingBodyId: hit.bodyId || undefined, hitDistance: hit.distance };
  }
  return { clear: true };
}

export interface PerceptionVerdict {
  perceived: boolean;
  inRange: boolean;
  lineOfSight: boolean;
  blockingBodyId?: string;
  distance: number;
}

export interface Perception {
  lineOfSight(from: Vec3, to: Vec3, opts?: PerceptionOptions): LineOfSightResult;
  inRange(from: Vec3, to: Vec3, maxDistance: number): boolean;
  canPerceive(from: Vec3, to: Vec3, range: number, opts?: PerceptionOptions): PerceptionVerdict;
}

/** Convenience wrapper binding a raycast plus default options. */
export function createPerception(raycast: RaycastFn, defaults?: PerceptionOptions): Perception {
  const merged = (extra?: PerceptionOptions): PerceptionOptions => ({
    maxDistance: extra?.maxDistance ?? defaults?.maxDistance,
    eyeOffset: extra?.eyeOffset ?? defaults?.eyeOffset,
    targetOffset: extra?.targetOffset ?? defaults?.targetOffset,
    query: extra?.query ?? defaults?.query,
    epsilon: extra?.epsilon ?? defaults?.epsilon,
  });
  return {
    lineOfSight: (from, to, opts) => lineOfSight(raycast, from, to, merged(opts)),
    inRange: (from, to, maxDistance) => inRange(from, to, maxDistance),
    canPerceive: (from, to, range, opts) => {
      const options = merged(opts);
      const d = distanceBetween(add(from, options.eyeOffset), add(to, options.targetOffset));
      const rangeOk = d <= range && (options.maxDistance === undefined || d <= options.maxDistance);
      const los = lineOfSight(raycast, from, to, options);
      return {
        perceived: rangeOk && los.clear,
        inRange: rangeOk,
        lineOfSight: los.clear,
        blockingBodyId: los.blockingBodyId,
        distance: d,
      };
    },
  };
}

function add(a: Vec3, b?: Vec3): Vec3 {
  return b ? [a[0] + b[0], a[1] + b[1], a[2] + b[2]] : [a[0], a[1], a[2]];
}
