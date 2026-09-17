/**
 * 看山任意门 · the portal hall environment.
 *
 * A dark, misty circular hall: glossy black floor with faint gold ring
 * inlays, slow-drifting ground mist (creative/effects ParticleEmitter),
 * floating rock shards (instanced jittered tetrahedra, slow bob), and three
 * ornate door assemblies arranged in an arc facing the spawn point —
 * 端妃 (gold), 蓝血 (blue), 近视眼 (teal) — each with a procedural arch frame,
 * a hinged door leaf, a colored emissive portal plane behind the leaf, a
 * story-art plaque above, and a colored point light. A fourth, plain entry
 * door stands behind the spawn (it opens during the intro).
 *
 * Headless safety: plaque textures load only through an injected loader (or
 * a DOM-guarded TextureLoader). Without one, or when loading errors, the
 * plaques keep their fallback materials — geometry is always built. Physics
 * colliders (floor, perimeter, frames, closed leaves) are registered only
 * when a PhysicsWorld is passed in.
 */
import * as THREE from './three.ts';
import type { SceneContext } from '../../../src/creative/core/context.ts';
import type { Vec3 } from '../../../src/creative/core/spatial.ts';
import { ParticleEmitter } from '../../../src/creative/effects/particles.ts';
import type { PhysicsWorld } from '../../../src/creative/physics/world.ts';

export type DoorState = 'closed' | 'opening' | 'open';

export interface DoorHandle {
  readonly id: string;
  readonly title: string;
  /** Doorway center at floor level (world). Proximity checks use XZ. */
  readonly position: THREE.Vector3;
  /** Unit vector out of the door, toward the hall interior. */
  readonly forward: THREE.Vector3;
  state(): DoorState;
  /** Start opening (idempotent). The leaf collider is released at once. */
  open(): void;
  /** 0..1 portal glow progress. */
  glowLevel(): number;
}

export interface Hall {
  readonly object: THREE.Group;
  readonly doors: DoorHandle[];
  readonly entryDoor: DoorHandle;
  update(dt: number): void;
  /** Live-apply author parameter: mist emission multiplier (0..2). */
  setMistDensity(multiplier: number): void;
  /** Live-apply author parameter: door glow/point-light multiplier (0..3). */
  setGlowIntensity(multiplier: number): void;
  /**
   * Intro beat: thin warm slit of light in the shut entry doorway (0..1).
   * Fades back to 0 when the entry door starts opening.
   */
  setEntryCrack(level: number): void;
}

export interface HallTextureLoader {
  load(url: string, onLoad?: (texture: unknown) => void, onProgress?: unknown, onError?: (err: unknown) => void): unknown;
}

export interface HallOptions {
  /** Injectable texture loader; defaults to a DOM-guarded THREE.TextureLoader. */
  textureLoader?: HallTextureLoader;
  /** Physics world: when given, floor/perimeter/frame/leaf colliders are added. */
  physics?: PhysicsWorld;
  /** Injectable RNG for shard jitter (deterministic tests/tools). */
  random?: () => number;
  /** Seconds for a door leaf to swing fully open. Default 1.4. */
  openSeconds?: number;
}

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

export const HALL_RADIUS = 14;
const WALL_RING_RADIUS = 13.4;
const WALL_SEGMENTS = 20;
const DOOR_ARC_RADIUS = 9;
const OPEN_SECONDS_DEFAULT = 1.4;
const LEAF_SWING = 1.85; // rad (~106°), inward, away from the approaching player

const FLOOR_COLOR = 0x12141a;
const RING_COLOR = 0x8a6f3a;
const WOOD_COLOR = 0x35271a;
const LEAF_COLOR = 0x2a1e12;
const SHARD_COLOR = 0x3a3f4c;
const MIST_START = 0x2b3648;
const MIST_END = 0x11161f;

export interface DoorSpec {
  readonly id: string;
  readonly title: string;
  readonly color: number;
  readonly plaqueAsset: string;
  /** Plaque [width, height] matching the art aspect. */
  readonly plaqueSize: readonly [number, number];
  /** Arc angle from -Z (north); doors face the hall center. */
  readonly angle: number;
}

export const DOOR_SPECS: readonly DoorSpec[] = [
  {
    id: 'duanfei',
    title: '端妃',
    color: 0xd4a24e,
    plaqueAsset: 'door-card-closed.jpg',
    plaqueSize: [0.62, 0.92],
    angle: (-42 * Math.PI) / 180,
  },
  {
    id: 'blue-blood',
    title: '蓝血',
    color: 0x5a8fd4,
    plaqueAsset: 'blue-cover.jpg',
    plaqueSize: [0.98, 0.65],
    angle: 0,
  },
  {
    id: 'myopia',
    title: '近视眼',
    color: 0x58c9c0,
    plaqueAsset: 'door-card-open.jpg',
    plaqueSize: [0.62, 0.92],
    angle: (42 * Math.PI) / 180,
  },
];

export const ENTRY_DOOR_POSITION: Vec3 = [0, 0, 10.8];
export const ENTRY_DOOR_FORWARD: Vec3 = [0, 0, -1];

function assetUrl(file: string): string {
  return new URL(`../assets/${file}`, import.meta.url).href;
}

function smooth01(x: number): number {
  const k = Math.min(1, Math.max(0, x));
  return k * k * (3 - 2 * k);
}

// ---------------------------------------------------------------------------
// Door assembly
// ---------------------------------------------------------------------------

interface DoorRig {
  handle: DoorHandle;
  group: THREE.Group;
  hinge: THREE.Group;
  glowMaterial: THREE.MeshBasicMaterial;
  light: THREE.PointLight;
  leafBodyId: string | null;
  state: DoorState;
  progress: number; // leaf swing 0..1
  glow: number; // glow level 0..1
}

function quatYaw(y: number): [number, number, number, number] {
  return [0, Math.sin(y / 2), 0, Math.cos(y / 2)];
}

function buildDoor(
  spec: DoorSpec,
  position: Vec3,
  forward: Vec3,
  opts: {
    physics?: PhysicsWorld;
    textureLoader?: HallTextureLoader;
    openSeconds: number;
    plaque: boolean;
    leafCollider: boolean;
  },
): DoorRig {
  const group = new THREE.Group();
  group.name = `hall/door/${spec.id}`;
  group.position.set(position[0], position[1], position[2]);
  const yaw = Math.atan2(forward[0], forward[2]);
  group.rotation.y = yaw;

  const wood = new THREE.MeshLambertMaterial({ color: WOOD_COLOR });
  const woodDark = new THREE.MeshLambertMaterial({ color: LEAF_COLOR });

  // Arch frame: pillars + lintel + two stepped trim courses (procedural boxes).
  const pillarGeo = new THREE.BoxGeometry(0.22, 2.6, 0.3);
  for (const side of [-1, 1] as const) {
    const pillar = new THREE.Mesh(pillarGeo, wood);
    pillar.position.set(side * 0.85, 1.3, 0);
    pillar.name = `hall/door/${spec.id}/pillar-${side < 0 ? 'l' : 'r'}`;
    group.add(pillar);
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.18, 0.42), wood);
    plinth.position.set(side * 0.85, 0.09, 0);
    group.add(plinth);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.28, 0.34), wood);
  lintel.position.set(0, 2.72, 0);
  group.add(lintel);
  const trimA = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.18, 0.36), wood);
  trimA.position.set(0, 2.95, 0);
  group.add(trimA);
  const trimB = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.14, 0.38), wood);
  trimB.position.set(0, 3.11, 0);
  group.add(trimB);

  // Portal glow plane behind the leaf (emissive-like basic material).
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: spec.color,
    transparent: true,
    opacity: 0,
    toneMapped: false,
    depthWrite: false,
  });
  const glowPlane = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 2.15), glowMaterial);
  glowPlane.name = `hall/door/${spec.id}/glow`;
  glowPlane.position.set(0, 1.1, -0.1);
  group.add(glowPlane);

  // Door leaf on a hinge pivot at the left edge; opens inward (away from the
  // approaching player): +Y rotation swings the free edge toward -Z.
  const hinge = new THREE.Group();
  hinge.name = `hall/door/${spec.id}/hinge`;
  hinge.position.set(-0.6, 0, 0);
  const leaf = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.15, 0.07), woodDark);
  leaf.name = `hall/door/${spec.id}/leaf`;
  leaf.position.set(0.6, 1.1, 0);
  hinge.add(leaf);
  group.add(hinge);

  // Plaque with the story art above the arch (fallback material, texture via
  // injected loader; failures keep the fallback and never throw).
  if (opts.plaque) {
    const fallback = new THREE.MeshLambertMaterial({ color: 0x241c12 });
    const plaque = new THREE.Mesh(new THREE.PlaneGeometry(spec.plaqueSize[0], spec.plaqueSize[1]), fallback);
    plaque.name = `hall/door/${spec.id}/plaque`;
    plaque.position.set(0, 3.2 + spec.plaqueSize[1] / 2, 0.1);
    group.add(plaque);
    const loader = opts.textureLoader;
    if (loader) {
      try {
        loader.load(
          assetUrl(spec.plaqueAsset),
          (tex) => {
            const t = tex as THREE.Texture;
            t.colorSpace = THREE.SRGBColorSpace;
            const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, map: t });
            plaque.material = mat;
          },
          undefined,
          () => {
            /* keep the fallback material */
          },
        );
      } catch {
        /* keep the fallback material */
      }
    }
  }

  // Colored point light in front of the doorway; intensity follows the glow.
  const light = new THREE.PointLight(spec.color, 3.2, 13, 1.4);
  light.position.set(0, 1.6, 0.8);
  group.add(light);

  // Physics: pillar colliders always; the leaf collider blocks the closed
  // doorway and is removed the moment the door starts opening.
  let leafBodyId: string | null = null;
  const physics = opts.physics;
  if (physics) {
    for (const side of [-1, 1] as const) {
      const local: Vec3 = [side * 0.85, 1.3, 0];
      const cos = Math.cos(yaw);
      const sin = Math.sin(yaw);
      const world: Vec3 = [
        position[0] + local[0] * cos + local[2] * sin,
        position[1] + local[1],
        position[2] - local[0] * sin + local[2] * cos,
      ];
      physics.addBody(
        `hall/door/${spec.id}/pillar-${side < 0 ? 'l' : 'r'}`,
        { shape: { kind: 'box', halfExtents: [0.11, 1.3, 0.15] }, body: 'static' },
        { position: world, quaternion: quatYaw(yaw) },
      );
    }
    if (opts.leafCollider) {
      leafBodyId = `hall/door/${spec.id}/leaf`;
      physics.addBody(
        leafBodyId,
        { shape: { kind: 'box', halfExtents: [0.6, 1.075, 0.045] }, body: 'static' },
        { position: [position[0], position[1] + 1.1, position[2]], quaternion: quatYaw(yaw) },
      );
    }
  }

  const rig: DoorRig = {
    handle: null as unknown as DoorHandle,
    group,
    hinge,
    glowMaterial,
    light,
    leafBodyId,
    state: 'closed',
    progress: 0,
    glow: 0,
  };

  rig.handle = {
    id: spec.id,
    title: spec.title,
    position: new THREE.Vector3(position[0], position[1], position[2]),
    forward: new THREE.Vector3(forward[0], 0, forward[2]).normalize(),
    state: () => rig.state,
    open: () => {
      if (rig.state !== 'closed') return;
      rig.state = 'opening';
      if (leafBodyId && physics) {
        physics.removeBody(leafBodyId);
        leafBodyId = null;
      }
    },
    glowLevel: () => rig.glow,
  };
  return rig;
}

// ---------------------------------------------------------------------------
// Hall
// ---------------------------------------------------------------------------

export function createHall(ctx: SceneContext, opts: HallOptions = {}): Hall {
  const random = opts.random ?? Math.random;
  const openSeconds = Math.max(0.2, opts.openSeconds ?? OPEN_SECONDS_DEFAULT);
  const physics = opts.physics;
  const hasDom = typeof globalThis.document !== 'undefined' && typeof globalThis.window !== 'undefined';
  const textureLoader = opts.textureLoader ?? (hasDom ? new THREE.TextureLoader() : undefined);

  const object = new THREE.Group();
  object.name = 'kanshan-hall';

  // ---- base illumination: dim cool ambient so silhouettes read ------------
  // (the hall is dark by design, but pitch-black reads as a rendering bug;
  // doors add their colored accents on top of this)
  const hemi = new THREE.HemisphereLight(0x3a4460, 0x0b0d14, 2.4);
  hemi.name = 'hall/ambient';
  object.add(hemi);

  // ---- floor: dark glossy disc + faint gold ring inlays -------------------
  const floor = new THREE.Mesh(
    new THREE.CylinderGeometry(HALL_RADIUS, HALL_RADIUS, 0.5, 48),
    new THREE.MeshLambertMaterial({ color: FLOOR_COLOR }),
  );
  floor.name = 'hall/floor';
  floor.position.y = -0.25;
  object.add(floor);
  for (const [i, r] of [4, 7, 10].entries()) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(r - 0.035, r + 0.035, 64),
      new THREE.MeshBasicMaterial({ color: RING_COLOR, transparent: true, opacity: 0.32, side: THREE.DoubleSide }),
    );
    ring.name = `hall/ring-${i}`;
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.005;
    object.add(ring);
  }

  // ---- physics floor + perimeter ring wall --------------------------------
  if (physics) {
    physics.addBody(
      'hall/floor',
      { shape: { kind: 'cylinder', halfHeight: 0.25, radius: HALL_RADIUS }, body: 'static' },
      { position: [0, -0.25, 0] },
    );
    const segLength = (2 * Math.PI * WALL_RING_RADIUS) / WALL_SEGMENTS + 0.4;
    for (let i = 0; i < WALL_SEGMENTS; i += 1) {
      const a = (i / WALL_SEGMENTS) * Math.PI * 2;
      const x = WALL_RING_RADIUS * Math.sin(a);
      const z = -WALL_RING_RADIUS * Math.cos(a);
      physics.addBody(
        `hall/wall-${i}`,
        { shape: { kind: 'box', halfExtents: [segLength / 2, 1.6, 0.25] }, body: 'static' },
        { position: [x, 1.6, z], quaternion: quatYaw(-a) },
      );
    }
  }

  // ---- the three portal doors in an arc facing the spawn -------------------
  const doors: DoorRig[] = [];
  for (const spec of DOOR_SPECS) {
    const a = spec.angle;
    const pos: Vec3 = [DOOR_ARC_RADIUS * Math.sin(a), 0, -DOOR_ARC_RADIUS * Math.cos(a)];
    const fwd: Vec3 = [-Math.sin(a), 0, Math.cos(a)];
    const rig = buildDoor(spec, pos, fwd, { physics, textureLoader, openSeconds, plaque: true, leafCollider: true });
    doors.push(rig);
    object.add(rig.group);
  }

  // ---- entry door behind the spawn (intro only; never passable) ------------
  const entryRig = buildDoor(
    {
      id: 'entry',
      title: '入口',
      color: 0xffe9c4,
      plaqueAsset: 'door-card-closed.jpg',
      plaqueSize: [0.62, 0.92],
      angle: 0,
    },
    ENTRY_DOOR_POSITION,
    ENTRY_DOOR_FORWARD,
    { physics, textureLoader, openSeconds, plaque: false, leafCollider: false },
  );
  // The entry leaf is always shut to the player: a permanent static collider
  // sits in its doorway (the intro swings only the visual leaf).
  if (physics) {
    physics.addBody(
      'hall/door/entry/block',
      { shape: { kind: 'box', halfExtents: [0.6, 1.075, 0.045] }, body: 'static' },
      { position: [ENTRY_DOOR_POSITION[0], 1.1, ENTRY_DOOR_POSITION[2]], quaternion: quatYaw(Math.PI) },
    );
  }
  // Crack-of-light slit: a hair of warm light along the shut entry leaf's
  // free edge, revealed during the intro before the door swings open.
  const crackMaterial = new THREE.MeshBasicMaterial({
    color: 0xffe9c4,
    transparent: true,
    opacity: 0,
    toneMapped: false,
    depthWrite: false,
  });
  const crack = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 2.05), crackMaterial);
  crack.name = 'hall/door/entry/crack';
  crack.position.set(0.52, 1.08, 0.05);
  entryRig.group.add(crack);
  object.add(entryRig.group);

  // ---- ground mist: low rate, big particles, dark blue-grey ----------------
  const mistEmitters: ParticleEmitter[] = [];
  const mistRates: number[] = [];
  for (let i = 0; i < 3; i += 1) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
    const emitter = new ParticleEmitter({
      scope: ctx.scope,
      maxParticles: 110,
      rate: 5,
      lifetime: { min: 7, max: 11 },
      speed: { min: 0.12, max: 0.3 },
      cone: { axis: [0, 1, 0], angle: 0.55 },
      size: { start: 22, end: 44 },
      color: { start: MIST_START, end: MIST_END },
      random,
    });
    emitter.object.name = `hall/mist-${i}`;
    emitter.object.position.set(4.5 * Math.sin(a), 0.25, -4.5 * Math.cos(a));
    mistEmitters.push(emitter);
    mistRates.push(5);
    object.add(emitter.object);
  }

  // ---- floating rock shards: instanced jittered tetrahedra, slow bob -------
  const SHARD_COUNT = 26;
  const shardGeo = new THREE.TetrahedronGeometry(0.5);
  {
    const posAttr = shardGeo.attributes.position;
    for (let v = 0; v < posAttr.count; v += 1) {
      posAttr.setXYZ(
        v,
        posAttr.getX(v) * (0.7 + random() * 0.6),
        posAttr.getY(v) * (0.7 + random() * 0.6),
        posAttr.getZ(v) * (0.7 + random() * 0.6),
      );
    }
    shardGeo.computeVertexNormals();
  }
  const shards = new THREE.InstancedMesh(shardGeo, new THREE.MeshLambertMaterial({ color: SHARD_COLOR }), SHARD_COUNT);
  shards.name = 'hall/shards';
  const shardBase: THREE.Vector3[] = [];
  const shardPhase: number[] = [];
  const shardSpin: number[] = [];
  const shardScale: number[] = [];
  for (let i = 0; i < SHARD_COUNT; i += 1) {
    // Scatter on a ring outside the stage; keep the sightline to the doors.
    const a = random() * Math.PI * 2;
    const r = 5.5 + random() * 6.5;
    shardBase.push(new THREE.Vector3(r * Math.sin(a), 2.2 + random() * 3.3, -r * Math.cos(a)));
    shardPhase.push(random() * Math.PI * 2);
    shardSpin.push(0.05 + random() * 0.12);
    shardScale.push(0.5 + random() * 1.1);
  }
  object.add(shards);

  let mistDensity = 1;
  let glowIntensity = 1;
  let shardTime = 0;
  const shardMatrix = new THREE.Matrix4();
  const shardQuat = new THREE.Quaternion();
  const shardEuler = new THREE.Euler();
  const shardPos = new THREE.Vector3();
  const shardScaleV = new THREE.Vector3();

  const updateDoor = (rig: DoorRig, dt: number): void => {
    if (rig.state === 'opening') {
      rig.progress = Math.min(1, rig.progress + dt / openSeconds);
      if (rig.progress >= 1) rig.state = 'open';
    }
    const targetGlow = rig.state === 'closed' ? 0 : 1;
    const rate = dt / 1.1;
    rig.glow = Math.min(1, Math.max(0, rig.glow + (targetGlow > rig.glow ? rate : -rate)));
    rig.hinge.rotation.y = LEAF_SWING * smooth01(rig.progress);
    rig.glowMaterial.opacity = rig.glow * 0.85 * glowIntensity;
    rig.light.intensity = (3.2 + rig.glow * 9.0) * glowIntensity;
  };

  return {
    object,
    doors: doors.map((d) => d.handle),
    entryDoor: entryRig.handle,
    update(dt: number): void {
      if (!(dt >= 0) || !Number.isFinite(dt)) return;
      for (const rig of doors) updateDoor(rig, dt);
      updateDoor(entryRig, dt);
      for (const emitter of mistEmitters) emitter.update(dt);
      shardTime += dt;
      for (let i = 0; i < SHARD_COUNT; i += 1) {
        const base = shardBase[i];
        shardPos.set(
          base.x + Math.sin(shardTime * 0.11 + shardPhase[i]) * 0.35,
          base.y + Math.sin(shardTime * 0.35 + shardPhase[i] * 1.7) * 0.28,
          base.z + Math.cos(shardTime * 0.09 + shardPhase[i]) * 0.35,
        );
        shardEuler.set(shardTime * shardSpin[i], shardPhase[i] + shardTime * shardSpin[i] * 0.7, 0);
        shardQuat.setFromEuler(shardEuler);
        const s = shardScale[i];
        shardScaleV.set(s, s, s);
        shardMatrix.compose(shardPos, shardQuat, shardScaleV);
        shards.setMatrixAt(i, shardMatrix);
      }
      shards.instanceMatrix.needsUpdate = true;
    },
    setMistDensity(multiplier: number): void {
      mistDensity = Math.min(2, Math.max(0, multiplier));
      for (let i = 0; i < mistEmitters.length; i += 1) mistEmitters[i].setRate(mistRates[i] * mistDensity);
    },
    setGlowIntensity(multiplier: number): void {
      glowIntensity = Math.min(3, Math.max(0, multiplier));
    },
    setEntryCrack(level: number): void {
      crackMaterial.opacity = Math.min(1, Math.max(0, level)) * 0.9;
    },
  };
}
