/**
 * AssetCache: content-keyed cache with reference-counted leases.
 *
 * Semantics (S03 G04):
 * - Cache key = logical key + deep-sorted loader params, so the same logical
 *   asset requested with different params is a different resource.
 * - lease() returns a BorrowedHandle; release() decrements refs. A resource
 *   shared by N lessees survives N-1 releases; the final release disposes it
 *   through the loader's per-type disposer.
 * - preload() warms entries without a lease: warm entries (refs 0) persist
 *   until unload()/dispose(), while a leased entry whose refs hit 0 is
 *   disposed and dropped.
 * - Failures throw AssetError (a CreativeError) with the logical key and the
 *   source chain; the cache records per-key status/bytes/refs plus a bounded
 *   diagnostic log. One key failing never poisons the others.
 */
import { CreativeError } from '../core/errors.ts';
import type { Diagnostic } from '../core/errors.ts';
import type { Scope } from '../core/scope.ts';
import { byteLengthOf, fnv1aHex, toUint8 } from './bytes.ts';
import { AssetError } from './errors.ts';
import { createAudioLoader, createGlbLoader, createTextureLoader } from './loaders.ts';
import type {
  AssetCacheOptions,
  AssetHandle,
  AssetLoader,
  AssetManifestEntry,
  AssetRecord,
  AssetRequest,
  AssetStatus,
  Fetcher,
  LoaderContext,
  PreloadResult,
  PreloadResultEntry,
} from './types.ts';

export function logicalKeyOf(req: AssetRequest): string {
  if (req.key) return req.key;
  if (req.source.url) return req.source.url;
  if (req.source.data) return `data:${byteLengthOf(req.source.data)}:${fnv1aHex(toUint8(req.source.data))}`;
  return 'unknown';
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const rec = value as Record<string, unknown>;
  const keys = Object.keys(rec).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(rec[k])}`).join(',')}}`;
}

/** Full cache key: type + logical key + canonical loader params. */
export function cacheKeyOf(req: AssetRequest): string {
  const logical = logicalKeyOf(req);
  return req.params ? `${req.type}:${logical}#${stableStringify(req.params)}` : `${req.type}:${logical}`;
}

function statusForCode(code: string): AssetStatus {
  if (code === 'ASSET_MISSING') return 'missing';
  if (code === 'ASSET_DEPENDENCY') return 'dependency';
  return 'invalid';
}

function defaultDispose(value: unknown): void {
  if (value && typeof (value as { dispose?: unknown }).dispose === 'function') {
    (value as { dispose: () => void }).dispose();
  }
}

async function defaultFetch(url: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  const impl = (globalThis as { fetch?: (input: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; arrayBuffer: () => Promise<ArrayBuffer> }> }).fetch;
  if (!impl) throw new Error('no fetch implementation available in this environment');
  const res = await impl(url, signal ? { signal } : undefined);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.arrayBuffer();
}

interface InternalEntry {
  cacheKey: string;
  logicalKey: string;
  request: AssetRequest;
  loader: AssetLoader;
  record: AssetRecord;
  value?: unknown;
  warm: boolean;
  inFlight?: Promise<unknown>;
}

export class AssetCache {
  private readonly loaders = new Map<string, AssetLoader>();
  private readonly entries = new Map<string, InternalEntry>();
  private readonly diags: Diagnostic[] = [];
  private readonly fetcher: Fetcher;
  private readonly signal?: AbortSignal;
  private readonly maxDiagnostics: number;
  private disposed = false;

  constructor(opts: AssetCacheOptions = {}) {
    this.fetcher = opts.fetcher ?? ((url, signal) => defaultFetch(url, signal));
    this.signal = opts.signal;
    this.maxDiagnostics = opts.maxDiagnostics ?? 200;
    this.registerLoader('glb', createGlbLoader());
    this.registerLoader('texture', createTextureLoader());
    this.registerLoader('audio', createAudioLoader());
  }

  registerLoader(type: string, loader: AssetLoader): void {
    this.loaders.set(type, loader);
  }

  /** Tie the cache lifetime to a scope: everything is disposed at scope dispose. */
  bind(scope: Scope): this {
    scope.defer(() => this.dispose());
    return this;
  }

  get diagnostics(): readonly Diagnostic[] {
    return this.diags;
  }

  /** Per-key status/bytes/refs for live and warm entries. */
  records(): AssetRecord[] {
    return [...this.entries.values()].map((e) => ({ ...e.record, refs: e.record.refs }));
  }

  /** What this session used, with attribution, for export closure + NOTICE. */
  manifest(): AssetManifestEntry[] {
    return [...this.entries.values()].map((e) => ({
      key: e.logicalKey,
      type: e.request.type,
      byteLength: e.record.byteLength,
      status: e.record.status,
      ...(e.request.attribution ? { attribution: { ...e.request.attribution } } : {}),
    }));
  }

  async lease<T = unknown>(request: AssetRequest): Promise<AssetHandle<T>> {
    if (this.disposed) {
      throw new CreativeError('ASSET_CACHE_DISPOSED', `asset cache is disposed; cannot lease "${logicalKeyOf(request)}"`);
    }
    const cacheKey = cacheKeyOf(request);
    const logicalKey = logicalKeyOf(request);
    let entry = this.entries.get(cacheKey);
    if (!entry) {
      const loader = this.loaders.get(request.type);
      if (!loader) {
        throw new AssetError(
          'ASSET_INVALID',
          logicalKey,
          `no loader registered for asset type "${request.type}"`,
          [cacheKey],
        );
      }
      entry = {
        cacheKey,
        logicalKey,
        request,
        loader,
        warm: false,
        record: { key: logicalKey, type: request.type, status: 'loading', byteLength: 0, refs: 0 },
      };
      this.entries.set(cacheKey, entry);
      entry.inFlight = this.loadEntry(entry);
    }
    entry.warm = false;
    try {
      await entry.inFlight;
    } catch (err) {
      throw err instanceof AssetError ? err : new AssetError('ASSET_INVALID', logicalKey, 'load failed', [cacheKey], err);
    }
    entry.record.refs += 1;
    let released = false;
    return {
      key: logicalKey,
      get value(): T {
        return entry.value as T;
      },
      release: () => {
        if (released) return;
        released = true;
        if (entry.record.refs > 0) entry.record.refs -= 1;
        if (entry.record.refs === 0 && !entry.warm && !this.disposed && this.entries.get(cacheKey) === entry) {
          this.evict(entry);
        }
      },
    };
  }

  /** Lease and bind the handle to a scope in one step; returns the value. */
  async acquire<T = unknown>(scope: Scope, request: AssetRequest): Promise<T> {
    const handle = await this.lease<T>(request);
    return scope.borrow(handle);
  }

  /** Warm a declared manifest; partial failure never poisons the loaded keys. */
  async preload(manifest: AssetRequest[]): Promise<PreloadResult> {
    const results = await Promise.all(
      manifest.map(async (request): Promise<PreloadResultEntry> => {
        const key = logicalKeyOf(request);
        const cacheKey = cacheKeyOf(request);
        let entry = this.entries.get(cacheKey);
        if (!entry) {
          try {
            const handle = await this.lease(request);
            entry = this.entries.get(cacheKey);
            if (entry) entry.warm = true;
            handle.release();
          } catch (err) {
            const ae = err instanceof AssetError ? err : new AssetError('ASSET_INVALID', key, 'preload failed', [cacheKey], err);
            return { key, ok: false, status: statusForCode(ae.code), error: { code: ae.code, message: ae.message } };
          }
          return { key, ok: true, status: 'ready' };
        }
        if (entry.record.status === 'ready') {
          entry.warm = true;
          return { key, ok: true, status: 'ready' };
        }
        return { key, ok: false, status: entry.record.status, error: entry.record.error };
      }),
    );
    return { ok: results.every((r) => r.ok), results };
  }

  /**
   * Dispose an unreferenced entry now. Returns false when the entry is still
   * leased (refs > 0) or unknown.
   */
  unload(request: AssetRequest): boolean {
    const entry = this.entries.get(cacheKeyOf(request));
    if (!entry || entry.record.refs > 0) return false;
    this.evict(entry);
    return true;
  }

  /** Dispose every entry (warm and leased) and reject later leases. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of [...this.entries.values()]) this.evict(entry);
    this.entries.clear();
  }

  private async loadEntry(entry: InternalEntry): Promise<unknown> {
    const ctx: LoaderContext = { key: entry.logicalKey, request: entry.request, fetcher: this.fetcher, signal: this.signal };
    try {
      const loaded = await entry.loader.load(ctx);
      if (this.disposed) {
        this.disposeValue(entry.loader, loaded.value);
        throw new AssetError('ASSET_CACHE_DISPOSED', entry.logicalKey, 'cache disposed while loading', [entry.cacheKey]);
      }
      entry.value = loaded.value;
      entry.record.byteLength = loaded.byteLength ?? guessByteLength(loaded.value);
      entry.record.status = 'ready';
      return loaded.value;
    } catch (err) {
      const ae =
        err instanceof AssetError
          ? err
          : new AssetError('ASSET_INVALID', entry.logicalKey, err instanceof Error ? err.message : String(err), [entry.cacheKey], err);
      this.entries.delete(entry.cacheKey);
      this.pushDiag(ae);
      throw ae;
    }
  }

  private evict(entry: InternalEntry): void {
    this.entries.delete(entry.cacheKey);
    if (entry.value === undefined) return;
    try {
      this.disposeValue(entry.loader, entry.value);
    } catch (err) {
      this.pushDiag(
        new AssetError(
          'ASSET_DISPOSE_FAILED',
          entry.logicalKey,
          err instanceof Error ? err.message : String(err),
          [entry.cacheKey],
          err,
        ),
      );
    }
  }

  private disposeValue(loader: AssetLoader, value: unknown): void {
    if (loader.dispose) loader.dispose(value);
    else defaultDispose(value);
  }

  private pushDiag(err: AssetError): void {
    if (this.diags.length >= this.maxDiagnostics) return;
    this.diags.push({ code: err.code, message: err.message, source: `asset:${err.key}` });
  }
}

function guessByteLength(value: unknown): number {
  if (!value || typeof value !== 'object') return 0;
  const rec = value as { byteLength?: unknown; bytes?: { byteLength?: unknown } };
  if (typeof rec.byteLength === 'number') return rec.byteLength;
  if (rec.bytes && typeof rec.bytes.byteLength === 'number') return rec.bytes.byteLength;
  return 0;
}
