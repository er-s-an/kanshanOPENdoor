/**
 * Scene-building helpers: theme-free wall/floor primitives for the free-code
 * authoring surface. Each helper returns a plain object plus neutral collider
 * descriptions (core/spatial.ts); the physics adapter (M2) is the only
 * consumer that turns those descriptions into real colliders.
 *
 * Conventions:
 * - Wall local frame: origin at the center of the wall's bottom face, so a
 *   wall spans x ∈ [-length/2, length/2], y ∈ [0, height], z ∈ [-thickness/2, thickness/2].
 * - `position`/`yaw` options place the returned group in the parent frame;
 *   collider offsets stay relative to the group's origin (the wall frame).
 * - Openings are geometrically real: the mesh is decomposed into sub-boxes,
 *   so a ray through the opening rect misses the mesh and a ray into solid
 *   wall hits. Colliders describe the wall minus the opening (never one
 *   whole-wall box).
 */
import * as THREE from 'three';
import { CreativeError } from '../core/errors.ts';
import type { ColliderDesc, Vec3 } from '../core/spatial.ts';

export interface SceneBuild {
  object: THREE.Object3D;
  colliders: ColliderDesc[];
}

export interface WallSegmentOptions {
  /** Wall extent along its local X axis. */
  length: number;
  /** Wall extent along Y, measured up from the origin (bottom face). */
  height: number;
  /** Wall extent along its local Z axis. */
  thickness: number;
  material?: THREE.Material;
  /** World position of the wall origin (bottom-face center). */
  position?: Vec3 | THREE.Vector3;
  /** Rotation around Y, in radians. */
  yaw?: number;
}

export type WallOpening = {
  /** Door and window are semantic labels for tools; geometry treats them alike. */
  kind: 'door' | 'window' | 'custom';
  /** Opening width along the wall's local X axis. */
  width: number;
  /** Opening height along Y. */
  height: number;
  /** Opening bottom edge height; defaults to 0 (floor level). */
  sillHeight?: number;
  /** Opening center offset from the wall center along local X; defaults to 0. */
  offsetX?: number;
};

export interface WallWithOpeningOptions extends WallSegmentOptions {
  opening: WallOpening;
}

export interface FloorPolygonOptions {
  material?: THREE.Material;
  /** World Y of the floor plane; defaults to 0. */
  y?: number;
}

export interface WallRunOptions {
  height: number;
  thickness: number;
  material?: THREE.Material;
  /**
   * Corner join strategy (default 'butt'):
   * - 'butt': each segment spans exactly between two consecutive points; end
   *   faces meet at the vertex and a small square notch may open on the outer
   *   side of non-straight corners. No overshoot past the run endpoints.
   * - 'miter': at interior vertices both adjacent segment ends are extended
   *   by thickness/2 so the outer corner closes. Exact for 90° corners,
   *   approximate for other angles. Run endpoints stay exact.
   */
  join?: 'butt' | 'miter';
}

export interface WallRunBuild extends SceneBuild {
  /** Per-segment builds, in point order; colliders concatenated in the same order. */
  segments: SceneBuild[];
}

const EPS = 1e-9;

let defaultMaterial: THREE.Material | undefined;

/** Shared neutral material so works that pass no material pay one allocation. */
function wallMaterial(): THREE.Material {
  defaultMaterial ??= new THREE.MeshLambertMaterial({ color: 0x9b958a });
  return defaultMaterial;
}

function toVector3(p: Vec3 | THREE.Vector3 | undefined): THREE.Vector3 | undefined {
  return p === undefined ? undefined : p instanceof THREE.Vector3 ? p.clone() : new THREE.Vector3(p[0], p[1], p[2]);
}

function applyPlacement(group: THREE.Group, position?: Vec3 | THREE.Vector3, yaw?: number): void {
  const p = toVector3(position);
  if (p) group.position.copy(p);
  if (yaw !== undefined) group.rotation.y = yaw;
}

function assertPositive(label: string, values: [string, number][]): void {
  for (const [name, value] of values) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new CreativeError('SCENE_INVALID_DIMENSION', `${label}: ${name} must be a positive finite number`, { phase: 'create' });
    }
  }
}

/** Appends one sub-box mesh + matching box collider to `build`. */
function addSubBox(build: SceneBuild, width: number, height: number, thickness: number, cx: number, cyBottom: number, material: THREE.Material): void {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, thickness), material);
  mesh.position.set(cx, cyBottom + height / 2, 0);
  build.object.add(mesh);
  build.colliders.push({
    shape: {
      kind: 'box',
      halfExtents: [width / 2, height / 2, thickness / 2],
      offset: [cx, cyBottom + height / 2, 0],
    },
    body: 'static',
  });
}

/**
 * A single solid wall segment: one box mesh + one box collider.
 */
export function wallSegment(opts: WallSegmentOptions): SceneBuild {
  const { length, height, thickness } = opts;
  assertPositive('wallSegment', [['length', length], ['height', height], ['thickness', thickness]]);
  const group = new THREE.Group();
  group.name = 'wall';
  const build: SceneBuild = { object: group, colliders: [] };
  addSubBox(build, length, height, thickness, 0, 0, opts.material ?? wallMaterial());
  applyPlacement(group, opts.position, opts.yaw);
  return build;
}

/**
 * A wall with a real opening (door/window/custom rect), decomposed into
 * side boxes + a lintel above the opening + a threshold below it when the
 * opening has a sill. Every returned collider describes solid wall only.
 */
export function wallWithOpening(opts: WallWithOpeningOptions): SceneBuild {
  const { length, height, thickness, opening } = opts;
  assertPositive('wallWithOpening', [['length', length], ['height', height], ['thickness', thickness]]);
  assertPositive('wallWithOpening opening', [['width', opening.width], ['height', opening.height]]);
  const sill = opening.sillHeight ?? 0;
  const offsetX = opening.offsetX ?? 0;
  if (!Number.isFinite(sill) || sill < 0) {
    throw new CreativeError('SCENE_OPENING_INVALID', 'wallWithOpening: sillHeight must be a non-negative finite number', { phase: 'create' });
  }
  const oLeft = offsetX - opening.width / 2;
  const oRight = offsetX + opening.width / 2;
  const oTop = sill + opening.height;
  if (oLeft < -length / 2 - EPS || oRight > length / 2 + EPS) {
    throw new CreativeError('SCENE_OPENING_INVALID', 'wallWithOpening: opening exceeds the wall horizontally', { phase: 'create' });
  }
  if (oTop > height + EPS) {
    throw new CreativeError('SCENE_OPENING_INVALID', 'wallWithOpening: opening exceeds the wall vertically', { phase: 'create' });
  }

  const group = new THREE.Group();
  group.name = 'wall-opening';
  group.userData.opening = {
    kind: opening.kind,
    width: opening.width,
    height: opening.height,
    sillHeight: sill,
    offsetX,
  };
  const build: SceneBuild = { object: group, colliders: [] };
  const material = opts.material ?? wallMaterial();
  const leftEdge = -length / 2;
  const rightEdge = length / 2;

  if (oLeft - leftEdge > EPS) {
    addSubBox(build, oLeft - leftEdge, height, thickness, (leftEdge + oLeft) / 2, 0, material);
  }
  if (rightEdge - oRight > EPS) {
    addSubBox(build, rightEdge - oRight, height, thickness, (oRight + rightEdge) / 2, 0, material);
  }
  if (height - oTop > EPS) {
    addSubBox(build, oRight - oLeft, height - oTop, thickness, offsetX, oTop, material);
  }
  if (sill > EPS) {
    addSubBox(build, oRight - oLeft, sill, thickness, offsetX, 0, material);
  }

  applyPlacement(group, opts.position, opts.yaw);
  return build;
}

/**
 * A flat floor mesh from a 2D polygon (points as [x, z] world pairs) plus a
 * static trimesh collider taken from the same triangulation, so the visible
 * surface and the collision surface always agree.
 */
export function floorPolygon(points: readonly (readonly [number, number])[], opts: FloorPolygonOptions = {}): SceneBuild {
  if (points.length < 3) {
    throw new CreativeError('SCENE_FLOOR_INVALID', 'floorPolygon: needs at least 3 points', { phase: 'create' });
  }
  let area2 = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [x0, z0] = points[i];
    const [x1, z1] = points[(i + 1) % points.length];
    area2 += x0 * z1 - x1 * z0;
  }
  if (Math.abs(area2) < EPS) {
    throw new CreativeError('SCENE_FLOOR_INVALID', 'floorPolygon: polygon area is degenerate', { phase: 'create' });
  }

  // Shape XY maps to world XZ via (x, y) -> (x, -z); rotateX(-PI/2) lays the
  // shape flat with its front face pointing +Y (up).
  const shape = new THREE.Shape();
  points.forEach(([x, z], i) => {
    if (i === 0) shape.moveTo(x, -z);
    else shape.lineTo(x, -z);
  });
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);

  const mesh = new THREE.Mesh(geometry, opts.material ?? wallMaterial());
  const group = new THREE.Group();
  group.name = 'floor';
  group.add(mesh);
  if (opts.y !== undefined) group.position.y = opts.y;

  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  if (!index) {
    throw new CreativeError('SCENE_FLOOR_INVALID', 'floorPolygon: ShapeGeometry produced no index', { phase: 'create' });
  }
  const vertices: Vec3[] = [];
  for (let i = 0; i < position.count; i += 1) {
    vertices.push([position.getX(i), position.getY(i), position.getZ(i)]);
  }
  const indices: [number, number, number][] = [];
  for (let i = 0; i < index.count; i += 3) {
    indices.push([index.getX(i), index.getX(i + 1), index.getX(i + 2)]);
  }

  return {
    object: group,
    colliders: [{
      shape: { kind: 'trimesh', vertices, indices },
      body: 'static',
    }],
  };
}

/**
 * A multi-segment wall run along a polyline of [x, z] points. Each interior
 * point becomes a corner; segment origins sit on the polyline at the segment
 * midpoints. Colliders are in the run group's local frame (identity
 * transform), concatenated in segment order.
 */
export function wallRun(points: readonly (readonly [number, number])[], opts: WallRunOptions): WallRunBuild {
  if (points.length < 2) {
    throw new CreativeError('SCENE_WALLRUN_INVALID', 'wallRun: needs at least 2 points', { phase: 'create' });
  }
  assertPositive('wallRun', [['height', opts.height], ['thickness', opts.thickness]]);
  const join = opts.join ?? 'butt';
  const extension = join === 'miter' ? opts.thickness / 2 : 0;
  const material = opts.material ?? wallMaterial();

  const group = new THREE.Group();
  group.name = 'wall-run';
  group.userData.join = join;
  const segments: SceneBuild[] = [];
  const colliders: ColliderDesc[] = [];

  for (let i = 0; i < points.length - 1; i += 1) {
    const [x0, z0] = points[i];
    const [x1, z1] = points[i + 1];
    const dx = x1 - x0;
    const dz = z1 - z0;
    const dist = Math.hypot(dx, dz);
    if (dist < EPS) {
      throw new CreativeError('SCENE_WALLRUN_INVALID', `wallRun: zero-length segment at point ${i}`, { phase: 'create' });
    }
    const ux = dx / dist;
    const uz = dz / dist;
    // Miter: interior joint ends extend so the outer corner closes; run
    // endpoints stay exact.
    const startExt = i > 0 ? extension : 0;
    const endExt = i < points.length - 2 ? extension : 0;
    const ax = x0 - ux * startExt;
    const az = z0 - uz * startExt;
    const bx = x1 + ux * endExt;
    const bz = z1 + uz * endExt;
    const segLength = dist + startExt + endExt;
    const seg = wallSegment({
      length: segLength,
      height: opts.height,
      thickness: opts.thickness,
      material,
      position: [(ax + bx) / 2, 0, (az + bz) / 2],
      yaw: Math.atan2(-(bz - az), bx - ax),
    });
    segments.push(seg);
    colliders.push(...seg.colliders);
    group.add(seg.object);
  }

  return { object: group, colliders, segments };
}

/**
 * Sets an object's origin to floor height. Assumes the object was built with
 * its origin at its base (the convention used by all helpers here and by
 * world/kit.ts). Returns the object for chaining.
 */
export function placeOnFloorY<T extends THREE.Object3D>(object: T, floorY: number): T {
  object.position.y = floorY;
  return object;
}

/**
 * Rotates an object around Y so its local +Z axis points at `target`
 * (world space), keeping +Y up. Degenerate targets (same XZ as the object)
 * leave the orientation untouched. Returns the object for chaining.
 */
export function faceToward<T extends THREE.Object3D>(object: T, target: Vec3 | THREE.Vector3): T {
  const t = toVector3(target);
  if (!t) return object;
  const dx = t.x - object.position.x;
  const dz = t.z - object.position.z;
  if (Math.hypot(dx, dz) < EPS) return object;
  object.lookAt(t);
  return object;
}
