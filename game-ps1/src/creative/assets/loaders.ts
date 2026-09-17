/**
 * Built-in loaders: 'glb', 'texture', 'audio'. Factories stay injectable so
 * headless tests never touch fetch/DOM; the browser paths activate lazily.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { toArrayBuffer, toUint8 } from './bytes.ts';
import { AssetError } from './errors.ts';
import type { AssetLoader, LoadedAsset, LoaderContext } from './types.ts';

function chainOf(ctx: LoaderContext, extra?: string): string[] {
  const chain: string[] = [`${ctx.request.type}:${ctx.key}`];
  const src = ctx.request.source;
  if (src.url) chain.push(`url:${src.url}`);
  if (src.data) chain.push(`data:${src.data.byteLength}B`);
  if (extra) chain.push(extra);
  return chain;
}

async function sourceBytes(ctx: LoaderContext): Promise<Uint8Array> {
  const src = ctx.request.source;
  if (src.data) return toUint8(src.data);
  if (src.url) {
    try {
      const buf = await ctx.fetcher(src.url, ctx.signal);
      return new Uint8Array(buf);
    } catch (err) {
      throw new AssetError(
        'ASSET_MISSING',
        ctx.key,
        `failed to fetch asset bytes: ${err instanceof Error ? err.message : String(err)}`,
        chainOf(ctx, `fetch:${src.url}`),
        err,
      );
    }
  }
  throw new AssetError('ASSET_MISSING', ctx.key, 'asset request has neither source.data nor source.url', chainOf(ctx));
}

// ---------------------------------------------------------------------------
// glb

interface GlbJson {
  buffers?: { uri?: string }[];
  images?: { uri?: string }[];
}

/**
 * Read the JSON chunk of a GLB container. Throws ASSET_INVALID for anything
 * that is not a well-formed GLB v2.
 */
export function readGlbJson(bytes: Uint8Array, key: string, chain: readonly string[]): GlbJson {
  if (bytes.byteLength < 20) {
    throw new AssetError('ASSET_INVALID', key, `not a GLB: only ${bytes.byteLength} bytes`, chain);
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) {
    throw new AssetError('ASSET_INVALID', key, 'not a GLB: bad magic', chain);
  }
  if (dv.getUint32(4, true) !== 2) {
    throw new AssetError('ASSET_INVALID', key, `unsupported glTF container version ${dv.getUint32(4, true)}`, chain);
  }
  if (dv.getUint32(8, true) > bytes.byteLength) {
    throw new AssetError('ASSET_INVALID', key, 'truncated GLB: declared length exceeds buffer', chain);
  }
  const chunkLen = dv.getUint32(12, true);
  if (dv.getUint32(16, true) !== 0x4e4f534a || 20 + chunkLen > bytes.byteLength) {
    throw new AssetError('ASSET_INVALID', key, 'malformed GLB: first chunk is not JSON', chain);
  }
  let json: GlbJson;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + chunkLen))) as GlbJson;
  } catch (err) {
    throw new AssetError('ASSET_INVALID', key, 'malformed GLB: JSON chunk does not parse', chain, err);
  }
  return json;
}

/** External (non data:) buffer/image URIs a GLB references but does not embed. */
export function glbExternalRefs(json: GlbJson): string[] {
  const external: string[] = [];
  for (const list of [json.buffers, json.images]) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (item && typeof item.uri === 'string' && !item.uri.startsWith('data:')) external.push(item.uri);
    }
  }
  return external;
}

function parseGlb(bytes: Uint8Array, key: string, chain: readonly string[]): Promise<GLTF> {
  const loader = new GLTFLoader();
  const buffer = toArrayBuffer(bytes);
  return new Promise((resolve, reject) => {
    loader.parse(
      buffer,
      '',
      (gltf) => resolve(gltf),
      (event) => {
        const raw = event instanceof Error ? event : event && typeof event === 'object' && 'message' in event ? new Error(String((event as { message: unknown }).message)) : new Error(String(event));
        reject(new AssetError('ASSET_INVALID', key, `GLTFLoader failed: ${raw.message}`, chain, raw));
      },
    );
  });
}

export function disposeGltf(gltf: GLTF): void {
  gltf.scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry && typeof mesh.geometry.dispose === 'function') mesh.geometry.dispose();
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) {
      for (const m of material) m?.dispose();
    } else {
      material?.dispose();
    }
  });
}

export function createGlbLoader(): AssetLoader<GLTF> {
  return {
    async load(ctx): Promise<LoadedAsset<GLTF>> {
      const chain = chainOf(ctx);
      const bytes = await sourceBytes(ctx);
      const external = glbExternalRefs(readGlbJson(bytes, ctx.key, chain));
      if (external.length > 0) {
        throw new AssetError(
          'ASSET_DEPENDENCY',
          ctx.key,
          `GLB references external resources that are not embedded: ${external.join(', ')}`,
          chain,
        );
      }
      const gltf = await parseGlb(bytes, ctx.key, chain);
      return { value: gltf, byteLength: bytes.byteLength };
    },
    dispose: disposeGltf,
  };
}

// ---------------------------------------------------------------------------
// texture

export interface TextureLoaderOptions {
  /** Browser image path, injectable so headless tests never need a DOM. */
  loadImage?: (url: string, signal?: AbortSignal) => Promise<THREE.Texture>;
}

function defaultLoadImage(url: string): Promise<THREE.Texture> {
  if (typeof document === 'undefined') {
    return Promise.reject(
      new Error('no DOM available for TextureLoader; pass loadImage to createTextureLoader()'),
    );
  }
  const loader = new THREE.TextureLoader();
  return new Promise((resolve, reject) => {
    loader.load(url, resolve, undefined, (event) => reject(event instanceof Error ? event : new Error(String(event))));
  });
}

export function createTextureLoader(opts: TextureLoaderOptions = {}): AssetLoader<THREE.Texture> {
  const loadImage = opts.loadImage ?? defaultLoadImage;
  return {
    async load(ctx): Promise<LoadedAsset<THREE.Texture>> {
      const src = ctx.request.source;
      if (src.data) {
        const chain = chainOf(ctx);
        const { width, height } = (ctx.request.params ?? {}) as { width?: unknown; height?: unknown };
        if (typeof width !== 'number' || typeof height !== 'number' || width <= 0 || height <= 0) {
          throw new AssetError('ASSET_INVALID', ctx.key, 'raw texture bytes require params.width and params.height (RGBA8 assumed)', chain);
        }
        const bytes = toUint8(src.data);
        if (bytes.byteLength !== width * height * 4) {
          throw new AssetError('ASSET_INVALID', ctx.key, `expected ${width * height * 4} RGBA bytes, got ${bytes.byteLength}`, chain);
        }
        const texture = new THREE.DataTexture(bytes, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
        texture.needsUpdate = true;
        return { value: texture, byteLength: bytes.byteLength };
      }
      if (src.url) {
        try {
          const texture = await loadImage(src.url, ctx.signal);
          return { value: texture };
        } catch (err) {
          if (err instanceof AssetError) throw err;
          throw new AssetError('ASSET_INVALID', ctx.key, `texture load failed: ${err instanceof Error ? err.message : String(err)}`, chainOf(ctx, `url:${src.url}`), err);
        }
      }
      throw new AssetError('ASSET_MISSING', ctx.key, 'texture request has neither source.data nor source.url', chainOf(ctx));
    },
    dispose(texture) {
      texture.dispose();
    },
  };
}

// ---------------------------------------------------------------------------
// audio

export interface AudioSampleMeta {
  format?: string;
  sampleRate?: number;
  channels?: number;
  duration?: number;
  [extra: string]: unknown;
}

export interface AudioBytes {
  bytes: Uint8Array;
  meta: AudioSampleMeta;
}

export interface AudioLoaderOptions {
  /** Decode hook for the later audio system; supplies real sample metadata. */
  decode?: (bytes: Uint8Array) => AudioSampleMeta | Promise<AudioSampleMeta>;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) out += String.fromCharCode(bytes[offset + i]);
  return out;
}

export function sniffAudioFormat(bytes: Uint8Array): string | undefined {
  if (bytes.byteLength >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE') return 'wav';
  if (bytes.byteLength >= 4 && ascii(bytes, 0, 4) === 'OggS') return 'ogg';
  if (bytes.byteLength >= 4 && ascii(bytes, 0, 4) === 'fLaC') return 'flac';
  if (bytes.byteLength >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return 'mp3';
  if (bytes.byteLength >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return 'mp3';
  return undefined;
}

export function createAudioLoader(opts: AudioLoaderOptions = {}): AssetLoader<AudioBytes> {
  return {
    async load(ctx): Promise<LoadedAsset<AudioBytes>> {
      const bytes = await sourceBytes(ctx);
      const meta = opts.decode ? await opts.decode(bytes) : { format: sniffAudioFormat(bytes) };
      return { value: { bytes, meta }, byteLength: bytes.byteLength };
    },
  };
}
