/**
 * Instancing helper (creative layer): collapse a list of same-geometry meshes
 * into one THREE.InstancedMesh. Geometry and materials stay caller-owned; the
 * returned dispose() only frees the instanced attribute buffers.
 */
import * as THREE from 'three';

export interface InstancingOptions {
  /** Material override; defaults to the first source mesh's material. */
  material?: THREE.Material;
}

export interface InstancedGroup {
  readonly mesh: THREE.InstancedMesh;
  readonly count: number;
  /**
   * Frees the instance buffers (mesh.dispose()). Shared geometry and source
   * materials are not touched and stay usable by the source meshes.
   */
  dispose(): void;
}

const WHITE = new THREE.Color(0xffffff);

/**
 * Convert same-geometry meshes into an InstancedMesh. Per-instance transforms
 * are baked from each mesh's local TRS — unparent the meshes first if you need
 * world transforms. When any source material carries a `color`, per-instance
 * colors are baked too (sources without a color default to white).
 */
export function toInstancedMesh(meshes: THREE.Mesh[], options: InstancingOptions = {}): InstancedGroup {
  if (meshes.length === 0) throw new Error('toInstancedMesh: received an empty mesh list');
  const geometry = meshes[0].geometry;
  for (const mesh of meshes) {
    if (mesh.geometry !== geometry) {
      throw new Error('toInstancedMesh: all meshes must share the same geometry instance');
    }
  }
  const firstMaterial = meshes[0].material;
  const material = options.material ?? (Array.isArray(firstMaterial) ? firstMaterial[0] : firstMaterial);
  const instanced = new THREE.InstancedMesh(geometry, material, meshes.length);

  const sourceColors = meshes.map((mesh) => {
    const color = (mesh.material as THREE.Material & { color?: THREE.Color }).color;
    return color instanceof THREE.Color ? color : null;
  });
  const withColors = sourceColors.some((color) => color !== null);

  const matrix = new THREE.Matrix4();
  meshes.forEach((mesh, i) => {
    matrix.compose(mesh.position, mesh.quaternion, mesh.scale);
    instanced.setMatrixAt(i, matrix);
    if (withColors) instanced.setColorAt(i, sourceColors[i] ?? WHITE);
  });
  instanced.instanceMatrix.needsUpdate = true;
  if (withColors && instanced.instanceColor) instanced.instanceColor.needsUpdate = true;
  instanced.computeBoundingSphere();

  let disposed = false;
  return {
    mesh: instanced,
    count: meshes.length,
    dispose() {
      if (disposed) return;
      disposed = true;
      instanced.dispose();
    },
  };
}
