import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { AssetCache, AssetError, createAudioLoader, createTextureLoader } from '../../src/creative/assets/index.ts';
import type { AudioBytes } from '../../src/creative/assets/index.ts';
import { buildExternalBinGlb, buildGarbageBytes, buildTriangleGlb } from './fixtures/glb.ts';

type Rejection = Error & { code?: string; key?: string; chain?: readonly string[] };

async function rejectionOf(promise: Promise<unknown>): Promise<Rejection> {
  try {
    await promise;
  } catch (err) {
    return err as Rejection;
  }
  assert.fail('expected promise to reject');
}

function rgba(width: number, height: number, fill = 7): Uint8Array {
  return new Uint8Array(width * height * 4).fill(fill);
}

test('glb loader parses a real geometry-only GLB headlessly', async () => {
  const cache = new AssetCache();
  const bytes = buildTriangleGlb();
  const handle = await cache.lease<GLTF>({ type: 'glb', key: 'tri', source: { data: bytes } });

  const mesh = handle.value.scene.children[0] as THREE.Mesh;
  assert.equal(mesh.type, 'Mesh');
  assert.equal(mesh.name, 'tri');
  const position = mesh.geometry.getAttribute('position');
  assert.equal(position.count, 3);
  assert.deepEqual(Array.from(position.array.slice(0, 3)), [0, 0, 0]);

  const record = cache.records().find((r) => r.key === 'tri');
  assert.equal(record?.status, 'ready');
  assert.equal(record?.byteLength, bytes.byteLength);
  assert.equal(record?.refs, 1);

  // Releasing to zero disposes the GPU-side objects inside the glTF scene.
  let disposedGeometries = 0;
  let disposedMaterials = 0;
  mesh.geometry.addEventListener('dispose', () => (disposedGeometries += 1));
  (mesh.material as THREE.Material).addEventListener('dispose', () => (disposedMaterials += 1));
  handle.release();
  assert.equal(disposedGeometries, 1, 'geometry disposed through the glb disposer');
  assert.equal(disposedMaterials, 1, 'material disposed through the glb disposer');
});

test('glb with external bin produces an honest ASSET_DEPENDENCY diagnostic, no crash', async () => {
  const cache = new AssetCache();
  const err = await rejectionOf(
    cache.lease<GLTF>({ type: 'glb', key: 'ext', source: { data: buildExternalBinGlb('scene.bin') } }),
  );
  assert.ok(err instanceof AssetError);
  assert.equal(err.code, 'ASSET_DEPENDENCY');
  assert.equal(err.key, 'ext');
  assert.match(err.message, /scene\.bin/);

  assert.equal(cache.records().length, 0, 'failed entry is not cached');
  const diag = cache.diagnostics.find((d) => d.source === 'asset:ext');
  assert.equal(diag?.code, 'ASSET_DEPENDENCY');

  // The cache stays usable for other keys.
  const other = await cache.lease<GLTF>({ type: 'glb', key: 'tri2', source: { data: buildTriangleGlb() } });
  assert.equal(other.value.scene.children.length, 1);
  other.release();
});

test('glb loader rejects non-GLB bytes as ASSET_INVALID', async () => {
  const cache = new AssetCache();
  const err = await rejectionOf(
    cache.lease<GLTF>({ type: 'glb', key: 'junk', source: { data: buildGarbageBytes() } }),
  );
  assert.ok(err instanceof AssetError);
  assert.equal(err.code, 'ASSET_INVALID');
  assert.match(err.message, /magic/);
});

test('texture loader: raw RGBA bytes become a DataTexture', async () => {
  const cache = new AssetCache();
  const data = rgba(2, 2, 42);
  const handle = await cache.lease<THREE.DataTexture>({
    type: 'texture',
    key: 'raw',
    source: { data },
    params: { width: 2, height: 2 },
  });
  const tex = handle.value;
  assert.ok(tex instanceof THREE.DataTexture);
  assert.equal(tex.format, THREE.RGBAFormat);
  assert.equal(tex.image.width, 2);
  assert.equal(tex.image.height, 2);
  assert.equal(tex.image.data[0], 42);
  assert.ok(tex.version > 0, 'needsUpdate=true bumps texture version');
  handle.release();
});

test('texture loader: wrong byte count for declared size is ASSET_INVALID', async () => {
  const cache = new AssetCache();
  const err = await rejectionOf(
    cache.lease<THREE.DataTexture>({
      type: 'texture',
      key: 'bad-raw',
      source: { data: rgba(3, 3) },
      params: { width: 2, height: 2 },
    }),
  );
  assert.ok(err instanceof AssetError);
  assert.equal(err.code, 'ASSET_INVALID');
  assert.match(err.message, /expected 16 RGBA bytes, got 36/);
});

test('texture loader: url path is injectable, no DOM needed', async () => {
  let requested: string | null = null;
  let disposed = 0;
  const fake = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  fake.dispose = () => (disposed += 1);

  const cache = new AssetCache();
  cache.registerLoader(
    'texture',
    createTextureLoader({
      loadImage: async (url) => {
        requested = url;
        return fake;
      },
    }),
  );
  const handle = await cache.lease<THREE.Texture>({ type: 'texture', key: 'img', source: { url: 'https://x.test/a.png' } });
  assert.equal(requested, 'https://x.test/a.png');
  assert.equal(handle.value, fake);
  handle.release();
  assert.equal(disposed, 1);
});

test('texture loader: url path without DOM and without injector fails honestly', async () => {
  assert.equal(typeof document, 'undefined', 'test must run headless');
  const cache = new AssetCache();
  const err = await rejectionOf(
    cache.lease<THREE.Texture>({ type: 'texture', key: 'img', source: { url: 'https://x.test/a.png' } }),
  );
  assert.ok(err instanceof AssetError);
  assert.equal(err.code, 'ASSET_INVALID');
  assert.match(err.message, /no DOM available/);
});

test('audio loader: stores raw bytes with sniffed metadata; decode hook is injectable', async () => {
  const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]); // RIFF....WAVE

  const cache = new AssetCache();
  const handle = await cache.lease<AudioBytes>({ type: 'audio', key: 'sfx', source: { data: wav } });
  assert.equal(handle.value.bytes.byteLength, 12);
  assert.equal(handle.value.meta.format, 'wav');
  handle.release();

  const decoded = new AssetCache();
  decoded.registerLoader(
    'audio',
    createAudioLoader({
      decode: async (bytes) => ({ format: 'wav', sampleRate: 44100, channels: 2, duration: bytes.byteLength / 4 }),
    }),
  );
  const viaHook = await decoded.lease<AudioBytes>({ type: 'audio', key: 'sfx2', source: { data: wav } });
  assert.equal(viaHook.value.meta.sampleRate, 44100);
  assert.equal(viaHook.value.meta.channels, 2);
  viaHook.release();
});
