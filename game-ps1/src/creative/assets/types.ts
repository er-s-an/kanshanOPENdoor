/**
 * Asset system public types.
 *
 * An AssetCache is a content-keyed store owned by one scene instance: the
 * module creates it, ties it to ctx.scope, and leases resources by logical
 * key. Nothing here is global; unused loaders never load.
 */
import type { BorrowedHandle } from '../core/scope.ts';

export type AssetType = string;

/** Optional provenance carried per entry and exported via manifest() (S03 R6). */
export interface AssetAttribution {
  source?: string;
  license?: string;
  author?: string;
  title?: string;
  [extra: string]: unknown;
}

/** Where bytes come from. Exactly one of data/url is expected per request. */
export interface AssetSource {
  /** Raw bytes for headless environments and tests. */
  data?: ArrayBuffer | Uint8Array;
  /** URL fetched through the cache fetcher when `data` is absent. */
  url?: string;
}

export interface AssetRequest {
  type: AssetType;
  /** Logical key; defaults to `source.url` or a content hash of `source.data`. */
  key?: string;
  source: AssetSource;
  /** Loader params; they participate in the cache key (deep, key-sorted). */
  params?: Record<string, unknown>;
  attribution?: AssetAttribution;
}

export interface LoadedAsset<T = unknown> {
  value: T;
  byteLength?: number;
}

export interface Fetcher {
  (url: string, signal?: AbortSignal): Promise<ArrayBuffer>;
}

export interface LoaderContext {
  /** Logical key of the requesting entry. */
  key: string;
  request: AssetRequest;
  fetcher: Fetcher;
  signal?: AbortSignal;
}

export interface AssetLoader<T = unknown> {
  load(ctx: LoaderContext): Promise<LoadedAsset<T>>;
  /** Per-type disposer; replaces the default (value.dispose?.()) when present. */
  dispose?(value: T): void;
}

export interface AssetHandle<T> extends BorrowedHandle<T> {
  readonly key: string;
}

export type AssetStatus = 'loading' | 'ready' | 'missing' | 'invalid' | 'dependency';

/** Per-key diagnostic record kept on the cache (S03 G16-sub). */
export interface AssetRecord {
  key: string;
  type: AssetType;
  status: AssetStatus;
  byteLength: number;
  refs: number;
  error?: { code: string; message: string };
}

export interface PreloadResultEntry {
  key: string;
  ok: boolean;
  status: AssetStatus;
  error?: { code: string; message: string };
}

export interface PreloadResult {
  ok: boolean;
  results: PreloadResultEntry[];
}

/** manifest() row: what was used, where it came from, for export closure + NOTICE. */
export interface AssetManifestEntry {
  key: string;
  type: AssetType;
  byteLength: number;
  status: AssetStatus;
  attribution?: AssetAttribution;
}

export interface AssetCacheOptions {
  fetcher?: Fetcher;
  signal?: AbortSignal;
  maxDiagnostics?: number;
}
