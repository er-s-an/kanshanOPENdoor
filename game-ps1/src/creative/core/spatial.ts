/**
 * Neutral spatial descriptions shared between scene helpers (M1) and the
 * physics adapter (M2). Helpers return these plain descriptions; the physics
 * system is the only consumer that turns them into real colliders. A work
 * that never imports physics pays nothing for them.
 */
export type Vec3 = [number, number, number];

export interface BoxColliderDesc {
  kind: 'box';
  halfExtents: Vec3;
  /** Center offset relative to the owning object's origin. */
  offset?: Vec3;
}

export interface CylinderColliderDesc {
  kind: 'cylinder';
  halfHeight: number;
  radius: number;
  offset?: Vec3;
}

export interface SphereColliderDesc {
  kind: 'sphere';
  radius: number;
  offset?: Vec3;
}

/** Convex hull from a point cloud (for irregular but convex geometry). */
export interface ConvexColliderDesc {
  kind: 'convex';
  points: Vec3[];
  offset?: Vec3;
}

/**
 * Static trimesh from explicit triangles. Intended for static environment
 * only; dynamic concave collision is out of R1 scope and must be diagnosed.
 */
export interface TrimeshColliderDesc {
  kind: 'trimesh';
  vertices: Vec3[];
  indices: [number, number, number][];
  offset?: Vec3;
}

export type ColliderShape =
  | BoxColliderDesc
  | CylinderColliderDesc
  | SphereColliderDesc
  | ConvexColliderDesc
  | TrimeshColliderDesc;

export interface ColliderDesc {
  shape: ColliderShape;
  /** static environment | kinematic mechanism | dynamic body */
  body: 'static' | 'kinematic' | 'dynamic';
  /** Sensor/trigger volumes generate events, no contact response. */
  sensor?: boolean;
  /** Collision group label; the physics adapter maps labels to bit masks. */
  group?: string;
}
