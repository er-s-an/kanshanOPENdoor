import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AssetCache, AssetError, cacheKeyOf } from '../../src/creative/assets/index.ts';
import type { AssetLoader, AssetRequest } from '../../src/creative/assets/index.ts';
import { CreativeError } from '../../src/creative/core/errors.ts';
import { Scope } from '../../src/creative/core/scope.ts';

type Rejection = Error & { code?: string; key?: string; chain?: readonly string[] };

async function rejectionOf(promise: Promise<unknown>): Promise<Rejection> {
  try {
    await promise;
  } catch (err) {
    return err as Rejection;
  }
  assert.fail('expected promise to reject');
}

interface Box {
  dispose(): void;
}

function boxLoader(calls: { loads: number; disposes: number }): AssetLoader<Box> {
  return {
    async load() {
      calls.loads += 1;
      return { value: { dispose: () => (calls.disposes += 1) }, byteLength: 4 };
    },
    dispose(value) {
      value.dispose();
    },
  };
}

function req(key: string, extra: Partial<AssetRequest> = {}): AssetRequest {
  return { type: 'box', key, source: { data: new Uint8Array([1, 2, 3, 4]) }, ...extra };
}

test('lease/release: final release disposes through the per-type disposer', async () => {
  const calls = { loads: 0, disposes: 0 };
  const cache = new AssetCache();
  cache.registerLoader('box', boxLoader(calls));

  const handle = await cache.lease<Box>(req('box-a'));
  assert.equal(calls.loads, 1);
  assert.equal(typeof handle.value.dispose, 'function');
  assert.equal(calls.disposes, 0);

  handle.release();
  assert.equal(calls.disposes, 1, 'disposed exactly once at refs 0');
  handle.release();
  assert.equal(calls.disposes, 1, 'double release is a no-op');
  assert.deepEqual(cache.records(), []);
});

test('a resource shared by two lessees survives one release', async () => {
  const calls = { loads: 0, disposes: 0 };
  const cache = new AssetCache();
  cache.registerLoader('box', boxLoader(calls));

  const first = await cache.lease<Box>(req('shared'));
  const second = await cache.lease<Box>(req('shared'));
  assert.equal(calls.loads, 1, 'one load serves both lessees');
  assert.equal(first.value, second.value, 'both handles share the same resource');
  assert.equal(cache.records()[0].refs, 2);

  first.release();
  assert.equal(calls.disposes, 0, 'still leased by second');
  assert.equal(typeof second.value.dispose, 'function', 'value stays usable');

  second.release();
  assert.equal(calls.disposes, 1, 'disposed only after the final release');
});

test('concurrent leases of the same key share one in-flight load', async () => {
  const calls = { loads: 0, disposes: 0 };
  const cache = new AssetCache();
  cache.registerLoader('box', boxLoader(calls));

  const [a, b] = await Promise.all([cache.lease<Box>(req('inflight')), cache.lease<Box>(req('inflight'))]);
  assert.equal(calls.loads, 1);
  assert.equal(a.value, b.value);
  a.release();
  assert.equal(calls.disposes, 0);
  b.release();
  assert.equal(calls.disposes, 1);
});

test('custom loader registration and default dispose fallback', async () => {
  const cache = new AssetCache();
  let disposed = 0;
  cache.registerLoader('native', {
    async load() {
      return { value: { dispose: () => (disposed += 1), kind: 'native' } };
    },
    // no dispose() override: loader disposer replaces default only when present
  });
  const handle = await cache.lease(req('n1', { type: 'native', source: {} }));
  assert.equal((handle.value as { kind: string }).kind, 'native');
  handle.release();
  assert.equal(disposed, 1, 'default dispose (value.dispose) used when loader has no disposer');
});

test('unregistered asset type throws AssetError carrying the logical key', async () => {
  const cache = new AssetCache();
  const err = await rejectionOf(cache.lease(req('ghost', { type: 'nope', source: {} })));
  assert.ok(err instanceof AssetError);
  assert.ok(err instanceof CreativeError);
  assert.equal(err.code, 'ASSET_INVALID');
  assert.equal(err.key, 'ghost');
  assert.match(err.message, /no loader registered/);
});

test('missing asset throws ASSET_MISSING with key and source chain', async () => {
  const cache = new AssetCache({
    fetcher: async () => {
      throw new Error('HTTP 404');
    },
  });
  const err = await rejectionOf(
    cache.lease({ type: 'audio', key: 'hero-theme', source: { url: 'https://assets.test/theme.ogg' } }),
  );
  assert.ok(err instanceof AssetError);
  assert.equal(err.code, 'ASSET_MISSING');
  assert.equal(err.key, 'hero-theme');
  assert.deepEqual(err.chain, ['audio:hero-theme', 'url:https://assets.test/theme.ogg', 'fetch:https://assets.test/theme.ogg']);
  assert.match(err.message, /hero-theme/);
  assert.match(err.message, /assets\.test\/theme\.ogg/);
});

test('request with neither data nor url throws ASSET_MISSING', async () => {
  const cache = new AssetCache();
  const err = await rejectionOf(cache.lease({ type: 'audio', key: 'silent', source: {} }));
  assert.ok(err instanceof AssetError);
  assert.equal(err.code, 'ASSET_MISSING');
  assert.equal(err.key, 'silent');
});

test('invalid bytes throw ASSET_INVALID and land in the cache diagnostic list', async () => {
  const cache = new AssetCache();
  const err = await rejectionOf(
    cache.lease({ type: 'glb', key: 'corrupt', source: { data: new Uint8Array([9, 9, 9, 9]) } }),
  );
  assert.ok(err instanceof AssetError);
  assert.equal(err.code, 'ASSET_INVALID');
  assert.equal(err.key, 'corrupt');
  const diags = cache.diagnostics;
  assert.equal(diags.length, 1);
  assert.equal(diags[0].code, 'ASSET_INVALID');
  assert.equal(diags[0].source, 'asset:corrupt');
});

test('cache key separates loader params; order of params is irrelevant', async () => {
  const cache = new AssetCache();
  const rgba2 = new Uint8Array(2 * 2 * 4).fill(1);
  const rgba4 = new Uint8Array(4 * 4 * 4).fill(2);

  const small = await cache.lease<THREE.DataTexture>({
    type: 'texture',
    key: 'noise',
    source: { data: rgba2 },
    params: { width: 2, height: 2 },
  });
  const large = await cache.lease<THREE.DataTexture>({
    type: 'texture',
    key: 'noise',
    source: { data: rgba4 },
    params: { height: 4, width: 4 },
  });
  assert.notEqual(small.value, large.value, 'different params => different resources');
  assert.equal(small.value.image.width, 2);
  assert.equal(large.value.image.width, 4);
  assert.equal(cache.records().length, 2);
  assert.equal(cache.records().filter((r) => r.key === 'noise').length, 2);

  const again = await cache.lease<THREE.DataTexture>({
    type: 'texture',
    key: 'noise',
    source: { data: rgba2 },
    params: { width: 2, height: 2 },
  });
  assert.equal(again.value, small.value, 'same params => shared resource');
  assert.equal(cache.records().length, 2, 'no third entry created');

  assert.equal(
    cacheKeyOf({ type: 'texture', key: 'n', source: {}, params: { a: 1, b: { c: [2], d: null } } }),
    cacheKeyOf({ type: 'texture', key: 'n', source: {}, params: { b: { d: null, c: [2] }, a: 1 } }),
  );

  small.release();
  large.release();
  again.release();
  assert.equal(cache.records().length, 0);
});

test('preload warms the cache and reports per-key results with partial failure', async () => {
  const cache = new AssetCache({
    fetcher: async (url) => {
      if (url.endsWith('missing.glb')) throw new Error('HTTP 404');
      return new Uint8Array(16).buffer as ArrayBuffer;
    },
  });
  const rgba = new Uint8Array(2 * 2 * 4);
  const result = await cache.preload([
    { type: 'texture', key: 'ok-tex', source: { data: rgba }, params: { width: 2, height: 2 } },
    { type: 'glb', key: 'bad-glb', source: { url: 'https://assets.test/missing.glb' } },
  ]);

  assert.equal(result.ok, false);
  const okEntry = result.results.find((r) => r.key === 'ok-tex');
  const badEntry = result.results.find((r) => r.key === 'bad-glb');
  assert.equal(okEntry?.ok, true);
  assert.equal(badEntry?.ok, false);
  assert.equal(badEntry?.status, 'missing');
  assert.equal(badEntry?.error?.code, 'ASSET_MISSING');

  // Failure did not poison the successful key...
  const handle = await cache.lease<THREE.DataTexture>({
    type: 'texture',
    key: 'ok-tex',
    source: { data: rgba },
    params: { width: 2, height: 2 },
  });
  assert.equal(handle.value.image.width, 2);
  handle.release();

  // ...and preload did warm it: re-preload hits the ready entry.
  const again = await cache.preload([
    { type: 'texture', key: 'ok-tex', source: { data: rgba }, params: { width: 2, height: 2 } },
  ]);
  assert.equal(again.ok, true);
});

test('preload failure is recorded on the cache; warm entries unload via unload()/dispose()', async () => {
  const cache = new AssetCache({
    fetcher: async () => {
      throw new Error('HTTP 500');
    },
  });
  await cache.preload([{ type: 'glb', key: 'broken', source: { url: 'https://x.test/a.glb' } }]);
  assert.equal(cache.diagnostics.some((d) => d.code === 'ASSET_MISSING' && d.source === 'asset:broken'), true);

  const rgba = new Uint8Array(4);
  await cache.preload([{ type: 'texture', key: 'warm', source: { data: rgba }, params: { width: 1, height: 1 } }]);
  assert.equal(cache.records().length, 1);
  assert.equal(cache.unload({ type: 'texture', key: 'warm', source: { data: rgba }, params: { width: 1, height: 1 } }), true);
  assert.equal(cache.records().length, 0);
  assert.equal(
    cache.unload({ type: 'texture', key: 'warm', source: { data: rgba }, params: { width: 1, height: 1 } }),
    false,
    'unknown entry cannot be unloaded',
  );

  cache.dispose();
  cache.dispose();
  const disposedErr = await rejectionOf(cache.lease(req('anything')));
  assert.equal(disposedErr.code, 'ASSET_CACHE_DISPOSED');
});

test('cache binds to a scope: scope dispose disposes leased and warm entries', async () => {
  const calls = { loads: 0, disposes: 0 };
  const scope = new Scope();
  const cache = new AssetCache().bind(scope);
  cache.registerLoader('box', boxLoader(calls));

  await cache.acquire<Box>(scope, req('scoped'));
  await cache.preload([req('warm-scoped')]);
  assert.equal(calls.loads, 2);
  assert.equal(calls.disposes, 0);

  scope.dispose();
  assert.equal(calls.disposes, 2, 'leased + warm entries disposed with the scope');
  assert.deepEqual(scope.disposeErrors, []);
});

test('attribution survives into manifest()', async () => {
  const cache = new AssetCache();
  const rgba = new Uint8Array(2 * 2 * 4);
  await cache.preload([
    {
      type: 'texture',
      key: 'brick',
      source: { data: rgba },
      params: { width: 2, height: 2 },
      attribution: { source: 'https://opengameart.org/brick', license: 'CC0-1.0', author: 'tester' },
    },
  ]);
  const manifest = cache.manifest();
  assert.equal(manifest.length, 1);
  assert.equal(manifest[0].key, 'brick');
  assert.equal(manifest[0].type, 'texture');
  assert.equal(manifest[0].byteLength, 16);
  assert.equal(manifest[0].status, 'ready');
  assert.equal(manifest[0].attribution?.license, 'CC0-1.0');
  assert.equal(manifest[0].attribution?.source, 'https://opengameart.org/brick');
});
