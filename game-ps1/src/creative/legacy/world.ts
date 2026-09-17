/**
 * LegacyWorldAssembler — minimal faithful subset of
 * `src/runtime/world-assembler.ts` (WorldAssembler + disposeObject).
 *
 * Why a subset instead of reusing the class directly: the runtime module
 * declares a TypeScript constructor parameter property
 * (`constructor(private readonly threeScene: THREE.Scene)`), which is
 * non-erasable syntax and cannot be loaded under Node's strip-only TS mode —
 * the mode every creative-runtime test runs in (see G17 scope brief:
 * "or a minimal faithful subset if the assembler's runtime deps don't fit").
 * The runtime file is read-only, so the faithful subset lives here.
 *
 * Fidelity contract with the original (kept node-for-node identical so the
 * legacy adapter builds the SAME world the old player builds):
 * - template floor/walls: same geometry sizes, colors, names
 *   ('template-floor', 'template-wall'), wall colliders (THREE.Box3);
 * - lights: same HemisphereLight/DirectionalLight colors, intensity, position;
 * - prefabs: same primitive composition per prefab name, group named
 *   'object:<id>', userData.storyObjectId / userData.itemId;
 * - scene root named 'story-scene:<id>' with userData.colliders;
 * - visibility rule in update(): hidden when its item is collected or its
 *   visibleWhen flag condition no longer holds;
 * - dispose(): detach root, disposeObject() over geometry/materials.
 *
 * Deliberate deviations from the original, because the host (not the old
 * player shell) owns the scene graph and the clock:
 * - the constructor takes no THREE.Scene; `load()` receives an optional
 *   parent and attaches the world root under the module root, so the host
 *   invariant "everything under instance.root" holds and scene swaps stay
 *   inside one stable root;
 * - `isReachable()` (raycast + camera facing gate) is NOT ported: the old
 *   spatial interaction gate belongs to the player shell (camera + walker);
 *   the adapter completes options through the shared reducer's guard
 *   semantics instead, and tools drive completion through the module's
 *   public path. The legacy player's reachability check stays available in
 *   the unchanged runtime entry for browser play.
 */
import * as THREE from 'three';
import type { Scene as StoryScene, StoryPackage, StoryState, Vec3 } from '@kanshan/story-contract';

export interface LegacyWorldObjectRef {
  definition: StoryScene['objects'][number];
  group: THREE.Group;
  visible: boolean;
}

export interface LegacyAssembledWorld {
  scene: StoryScene;
  root: THREE.Group;
  colliders: THREE.Box3[];
  objects: Map<string, LegacyWorldObjectRef>;
  anchors: Map<string, THREE.Vector3>;
  spawn: THREE.Vector3;
  spawnYaw: number;
}

export class LegacyWorldAssembler {
  private current: LegacyAssembledWorld | null = null;
  private disposed = false;

  get world(): LegacyAssembledWorld | null {
    return this.current;
  }

  /** True once dispose() ran (host stop / scene swap). */
  get isDisposed(): boolean {
    return this.disposed;
  }

  /** Current world root, or null after dispose. */
  get root(): THREE.Group | null {
    return this.current?.root ?? null;
  }

  load(pkg: StoryPackage, sceneId: string, state: StoryState, parent?: THREE.Object3D): LegacyAssembledWorld {
    this.dispose();
    const scene = pkg.scenes.find((candidate) => candidate.id === sceneId);
    if (!scene) throw new Error(`Scene not found: ${sceneId}`);
    const root = new THREE.Group();
    root.name = `story-scene:${scene.id}`;
    const colliders: THREE.Box3[] = [];
    this.addTemplate(root, colliders, scene.template);
    const objects = new Map<string, LegacyWorldObjectRef>();
    for (const definition of scene.objects) {
      const object = this.createPrefab(definition.prefab);
      object.name = `object:${definition.id}`;
      object.position.fromArray(definition.position as unknown as number[]);
      object.rotation.y = definition.yaw;
      object.userData.storyObjectId = definition.id;
      object.userData.itemId = definition.itemId;
      root.add(object);
      objects.set(definition.id, { definition, group: object, visible: true });
    }
    const anchors = new Map<string, THREE.Vector3>();
    for (const anchor of scene.anchors) anchors.set(anchor.id, new THREE.Vector3(...(anchor.position as unknown as number[])));
    root.userData.colliders = colliders;
    parent?.add(root);
    this.current = {
      scene,
      root,
      colliders,
      objects,
      anchors,
      spawn: new THREE.Vector3(...(scene.spawn.position as unknown as number[])),
      spawnYaw: scene.spawn.yaw,
    };
    this.disposed = false;
    this.update(state);
    return this.current;
  }

  update(state: StoryState): void {
    if (!this.current) return;
    for (const ref of this.current.objects.values()) {
      const byCollected = ref.definition.itemId ? state.collectedItems.includes(ref.definition.itemId) : false;
      const condition = ref.definition.visibleWhen;
      const byFlag = condition ? state.flags[condition.flagId] === condition.value : true;
      ref.visible = !byCollected && byFlag;
      ref.group.visible = ref.visible;
    }
  }

  getObject(objectId: string): LegacyWorldObjectRef | undefined {
    return this.current?.objects.get(objectId);
  }

  getAnchor(anchorId: string): THREE.Vector3 | undefined {
    const value = this.current?.anchors.get(anchorId);
    return value?.clone();
  }

  /** Detach + disposeObject the current world; safe to call repeatedly. */
  dispose(): void {
    if (!this.current) return;
    this.current.root.parent?.remove(this.current.root);
    disposeObject(this.current.root);
    this.current = null;
    this.disposed = true;
  }

  private addTemplate(root: THREE.Group, colliders: THREE.Box3[], template: StoryScene['template']): void {
    const extent = template === 'room-v1' ? { x: 5, z: 4, color: 0x343d3b } : { x: 6, z: 6, color: 0x4c5948 };
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(extent.x * 2, extent.z * 2),
      new THREE.MeshLambertMaterial({ color: template === 'room-v1' ? 0x69534d : 0x766443 }),
    );
    floor.name = 'template-floor';
    floor.rotation.x = -Math.PI / 2;
    root.add(floor);
    const wallMaterial = new THREE.MeshLambertMaterial({ color: extent.color });
    const wallHeight = 3.2;
    const wallThickness = 0.25;
    const walls = [
      { size: [extent.x * 2, wallHeight, wallThickness], pos: [0, wallHeight / 2, -extent.z] },
      { size: [extent.x * 2, wallHeight, wallThickness], pos: [0, wallHeight / 2, extent.z] },
      { size: [wallThickness, wallHeight, extent.z * 2], pos: [-extent.x, wallHeight / 2, 0] },
      { size: [wallThickness, wallHeight, extent.z * 2], pos: [extent.x, wallHeight / 2, 0] },
    ] as const;
    for (const wall of walls) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(wall.size[0], wall.size[1], wall.size[2]), wallMaterial);
      mesh.position.set(wall.pos[0], wall.pos[1], wall.pos[2]);
      mesh.name = 'template-wall';
      root.add(mesh);
      colliders.push(new THREE.Box3().setFromObject(mesh));
    }
    const light = new THREE.HemisphereLight(0xadb4a2, 0x201b1f, template === 'room-v1' ? 1.4 : 1.1);
    root.add(light);
    const sun = new THREE.DirectionalLight(template === 'room-v1' ? 0xb2c1bc : 0xd8c793, 1.1);
    sun.position.set(-4, 7, 3);
    root.add(sun);
  }

  private createPrefab(prefab: StoryScene['objects'][number]['prefab']): THREE.Group {
    const group = new THREE.Group();
    const mat = (color: number) => new THREE.MeshLambertMaterial({ color, flatShading: true });
    const add = (geometry: THREE.BufferGeometry, material: THREE.Material, position?: Vec3): THREE.Mesh => {
      const mesh = new THREE.Mesh(geometry, material);
      if (position) mesh.position.set(position[0], position[1], position[2]);
      group.add(mesh);
      return mesh;
    };
    switch (prefab) {
      case 'table-v1': {
        add(new THREE.BoxGeometry(1.7, 0.16, 0.9), mat(0x76553e), [0, 1.05, 0]);
        for (const x of [-0.68, 0.68]) for (const z of [-0.32, 0.32]) add(new THREE.BoxGeometry(0.12, 1.05, 0.12), mat(0x4b382d), [x, 0.52, z]);
        break;
      }
      case 'key-v1':
        add(new THREE.TorusGeometry(0.13, 0.04, 5, 8), mat(0xd0a746), [0, 0.1, 0]).rotation.x = Math.PI / 2;
        add(new THREE.BoxGeometry(0.34, 0.06, 0.06), mat(0xd0a746), [0.18, 0.1, 0]);
        break;
      case 'door-v1': {
        add(new THREE.BoxGeometry(0.16, 2.5, 1.2), mat(0x403e48), [0, 1.25, 0]);
        add(new THREE.BoxGeometry(0.2, 2.8, 0.12), mat(0x7e6c57), [-0.66, 1.4, 0]);
        add(new THREE.BoxGeometry(0.2, 2.8, 0.12), mat(0x7e6c57), [0.66, 1.4, 0]);
        add(new THREE.BoxGeometry(0.2, 0.12, 1.45), mat(0x7e6c57), [0, 2.74, 0]);
        break;
      }
      case 'note-v1':
        add(new THREE.BoxGeometry(0.7, 0.03, 0.5), mat(0xd8cca0), [0, 0.02, 0]);
        add(new THREE.BoxGeometry(0.48, 0.012, 0.025), mat(0x66564a), [-0.06, 0.04, -0.1]);
        add(new THREE.BoxGeometry(0.4, 0.012, 0.025), mat(0x66564a), [-0.1, 0.04, 0]);
        break;
      case 'person-v1':
        add(new THREE.CylinderGeometry(0.3, 0.38, 1.15, 6), mat(0x7b5662), [0, 0.72, 0]);
        add(new THREE.SphereGeometry(0.28, 6, 4), mat(0xb38f77), [0, 1.48, 0]);
        break;
      case 'plant-v1':
        add(new THREE.CylinderGeometry(0.28, 0.38, 0.35, 6), mat(0x8d6445), [0, 0.18, 0]);
        for (const [x, y, z] of [[-0.18, 0.62, 0], [0.2, 0.73, 0.05], [0, 0.9, -0.05]] as Vec3[]) add(new THREE.SphereGeometry(0.25, 5, 4), mat(0x55714d), [x, y, z]);
        break;
    }
    return group;
  }
}

/**
 * Dispose every geometry/material under root — identical traversal to
 * `disposeObject` in src/runtime/world-assembler.ts (kept in sync by hand;
 * both dispose leaf resources bottom-up via traverse).
 */
export function disposeObject(root: THREE.Object3D): void {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const materials = mesh.material ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : [];
    for (const material of materials) material.dispose();
  });
}
