/**
 * Example author factory. Factories are plain functions returning
 * { object, colliders? } (or a bare THREE.Object3D) — authors compose them
 * like ordinary Three.js code; there is no registry, catalog or DSL.
 *
 * makeShelf demonstrates the conventions:
 * - origin at the object's base, so placeOnFloorY() drops it onto a floor;
 * - nested groups (root -> frame/boards) for per-part transforms;
 * - neutral collider descs (core/spatial.ts), one per solid part;
 * - an authorId on the root's userData for later Studio/Agent bindings.
 */
import * as THREE from 'three';
import type { ColliderDesc } from '../../core/spatial.ts';
import type { SceneBuild } from '../helpers.ts';

export interface ShelfOptions {
  /** Outer width along local X. */
  width?: number;
  /** Total height along Y (origin at base). */
  height?: number;
  /** Outer depth along local Z. */
  depth?: number;
  /** Number of horizontal boards, including the bottom one. */
  shelfCount?: number;
  material?: THREE.Material;
  /** Written to root.userData.authorId; defaults to 'shelf'. */
  authorId?: string;
}

let defaultShelfMaterial: THREE.Material | undefined;

function shelfMaterial(): THREE.Material {
  defaultShelfMaterial ??= new THREE.MeshLambertMaterial({ color: 0x8a7f6d });
  return defaultShelfMaterial;
}

export function makeShelf(opts: ShelfOptions = {}): SceneBuild {
  const width = opts.width ?? 1.2;
  const height = opts.height ?? 1.8;
  const depth = opts.depth ?? 0.35;
  const shelfCount = opts.shelfCount ?? 4;
  const authorId = opts.authorId ?? 'shelf';
  for (const [name, value] of [['width', width], ['height', height], ['depth', depth]] as const) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`makeShelf: ${name} must be a positive finite number`);
    }
  }
  if (!Number.isInteger(shelfCount) || shelfCount < 1) {
    throw new Error('makeShelf: shelfCount must be an integer >= 1');
  }

  const panel = 0.03;
  const material = opts.material ?? shelfMaterial();

  const root = new THREE.Group();
  root.name = authorId;
  root.userData.authorId = authorId;

  const frame = new THREE.Group();
  frame.name = 'frame';
  root.add(frame);
  const boards = new THREE.Group();
  boards.name = 'boards';
  root.add(boards);

  const colliders: ColliderDesc[] = [];
  const addPart = (parent: THREE.Group, w: number, h: number, d: number, cx: number, cyBottom: number, cz: number): void => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(cx, cyBottom + h / 2, cz);
    parent.add(mesh);
    colliders.push({
      shape: { kind: 'box', halfExtents: [w / 2, h / 2, d / 2], offset: [cx, cyBottom + h / 2, cz] },
      body: 'static',
    });
  };

  // Side panels + back panel + top board make the frame.
  const innerWidth = width - 2 * panel;
  const sideX = width / 2 - panel / 2;
  addPart(frame, panel, height, depth, -sideX, 0, 0);
  addPart(frame, panel, height, depth, sideX, 0, 0);
  addPart(frame, innerWidth, height, panel, 0, 0, -depth / 2 + panel / 2);
  addPart(frame, innerWidth, panel, depth, 0, height - panel, 0);

  // Boards divide the inner height evenly; the bottom one sits on the floor.
  const boardThickness = 0.025;
  const span = height - panel - boardThickness;
  for (let i = 0; i < shelfCount; i += 1) {
    const y = i === 0 ? 0 : (i / (shelfCount - 1 || 1)) * span;
    addPart(boards, innerWidth, boardThickness, depth - panel, 0, y, panel / 2);
  }

  return { object: root, colliders };
}
