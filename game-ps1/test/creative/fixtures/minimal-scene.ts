import * as THREE from 'three';
import type { SceneContext, SceneInstance } from '../../../src/creative/core/index.ts';

/** Minimal free-form module: no engine systems, just plain Three. */
export function create(ctx: SceneContext): SceneInstance {
  const root = new THREE.Group();
  root.name = 'minimal-root';
  root.userData.authorId = 'minimal/root';
  const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  box.name = 'spinner';
  root.add(box);
  ctx.scope.own(box.geometry);
  ctx.scope.own(box.material as THREE.Material);
  let updates = 0;
  return {
    root,
    update(frame) {
      updates += 1;
      box.rotation.y = frame.time;
    },
    destroy() {
      (root.userData as Record<string, unknown>).destroyedAt = updates;
    },
  };
}
