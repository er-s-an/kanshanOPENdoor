import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { toInstancedMesh } from '../../src/creative/render/instancing.ts';

function makeMesh(
  geometry: THREE.BufferGeometry,
  x: number,
  material?: THREE.Material,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material ?? new THREE.MeshBasicMaterial());
  mesh.position.set(x, x + 1, x + 2);
  mesh.rotation.y = x;
  mesh.scale.setScalar(1 + x);
  return mesh;
}

test('toInstancedMesh: count, shared geometry/material, baked matrices (G04)', () => {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshBasicMaterial({ color: 0xff0000 });
  const meshes = [makeMesh(geometry, 0, material), makeMesh(geometry, 2, material), makeMesh(geometry, 4, material)];

  const group = toInstancedMesh(meshes);
  assert.equal(group.count, 3);
  assert.equal(group.mesh.count, 3);
  assert.equal(group.mesh.geometry, geometry, 'shares the source geometry instance');
  assert.equal(group.mesh.material, material, 'reuses the first material by default');

  const expected = new THREE.Matrix4();
  const got = new THREE.Matrix4();
  meshes.forEach((mesh, i) => {
    expected.compose(mesh.position, mesh.quaternion, mesh.scale);
    group.mesh.getMatrixAt(i, got);
    const a = got.toArray();
    const b = expected.toArray();
    for (let j = 0; j < 16; j += 1) {
      assert.ok(Math.abs((a[j] as number) - (b[j] as number)) < 1e-6, `instance ${i} matrix[${j}] matches`);
    }
    assert.equal(mesh.position.x, i === 0 ? 0 : i * 2, 'source meshes are left untouched');
  });
});

test('toInstancedMesh: per-instance colors from material colors, white fill (G04)', () => {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const colored = new THREE.MeshBasicMaterial({ color: 0xff0000 });
  const shader = new THREE.ShaderMaterial(); // no .color
  const meshes = [makeMesh(geometry, 0, colored), makeMesh(geometry, 2, shader), makeMesh(geometry, 4, colored)];

  const group = toInstancedMesh(meshes);
  const colors = group.mesh.instanceColor;
  assert.ok(colors, 'instanceColor buffer allocated when any source has a color');
  assert.equal(colors!.getX(0), 1);
  assert.equal(colors!.getY(0), 0);
  assert.equal(colors!.getZ(0), 0, 'pure red survives colorspace roundtrip');
  assert.equal(colors!.getX(1), 1, 'colorless source defaults to white');
  assert.equal(colors!.getY(1), 1);
  assert.equal(colors!.getZ(1), 1);
  assert.equal(colors!.getX(2), 1);
  assert.equal(colors!.getY(2), 0);
});

test('toInstancedMesh: no source colors -> no instanceColor buffer (G04)', () => {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const meshes = [
    makeMesh(geometry, 0, new THREE.ShaderMaterial()),
    makeMesh(geometry, 2, new THREE.ShaderMaterial()),
  ];
  const group = toInstancedMesh(meshes);
  assert.equal(group.mesh.instanceColor, null);
});

test('toInstancedMesh: material override is used (G04)', () => {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const override = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
  const group = toInstancedMesh([makeMesh(geometry, 0), makeMesh(geometry, 2)], { material: override });
  assert.equal(group.mesh.material, override);
});

test('toInstancedMesh: rejects empty lists and mixed geometry (G04)', () => {
  assert.throws(() => toInstancedMesh([]), /empty/);
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const other = new THREE.BoxGeometry(2, 2, 2);
  assert.throws(
    () => toInstancedMesh([makeMesh(geometry, 0), makeMesh(other, 2)]),
    /same geometry/,
  );
});

test('toInstancedMesh: dispose frees instance buffers only and is idempotent (G04)', () => {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshBasicMaterial({ color: 0xff0000 });
  const group = toInstancedMesh([makeMesh(geometry, 0, material), makeMesh(geometry, 2, material)]);

  let meshDispose = 0;
  let geometryDispose = 0;
  let materialDispose = 0;
  group.mesh.addEventListener('dispose', () => {
    meshDispose += 1;
  });
  geometry.addEventListener('dispose', () => {
    geometryDispose += 1;
  });
  material.addEventListener('dispose', () => {
    materialDispose += 1;
  });

  group.dispose();
  assert.equal(meshDispose, 1, 'instanced buffers freed');
  assert.equal(geometryDispose, 0, 'shared geometry stays caller-owned');
  assert.equal(materialDispose, 0, 'source material stays caller-owned');

  group.dispose();
  assert.equal(meshDispose, 1, 'idempotent');
  assert.equal(group.count, 2, 'group remains inspectable after dispose');
});
