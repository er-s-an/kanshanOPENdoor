/**
 * Checkpoint storage (M5a, gates G11 / G11.a).
 *
 * A `CheckpointStore` binds (experienceDigest, slot) and orchestrates
 * versioned, compare-and-swap checkpoint writes over an injectable
 * `StorageBackend`:
 *
 * - Writes are CAS: `write(expectedRevision, record, lastCommittedEventId)`.
 *   A stale expectedRevision loses with an explicit `conflict` outcome —
 *   exactly one writer advances. Re-submitting the same
 *   lastCommittedEventId is an idempotent success that returns the stored
 *   record and never advances the revision (mirrors CommitLog duplicate
 *   receipts; no double rewards).
 * - Records are validated for structure BEFORE anything is cloned or used
 *   (the old save-store crashed cloning corrupted records). Structural
 *   failures produce a `corrupt` outcome that lists every problem; the raw
 *   value is quarantined (kept aside, reported) and the slot is never
 *   overwritten by a failed read or migration.
 * - engineMajor / checkpointSchemaVersion mismatches are an explicit
 *   `quarantined` outcome — never a silent reset to revision 0.
 * - Backend write failures are precise `unavailable` outcomes and never
 *   fake persistence: the store tracks `pendingRevision` (last attempted)
 *   separately from `persistedRevision` (last confirmed durable), so a
 *   failed write cannot advance state as if it had been saved.
 *
 * Backends: `MemoryBackend` is per-instance (no statics, unlike the legacy
 * shared map). `IdbBackend` is a lazy browser skeleton over an injectable
 * `IDBFactory`; when IndexedDB is unavailable it reports an explicit
 * `unavailable` status and refuses to persist — it never falls back to
 * faking durability.
 */
import { CreativeError } from '../core/errors.ts';

// ---------------------------------------------------------------------------
// Records and validation
// ---------------------------------------------------------------------------

/**
 * Versioned checkpoint record. `state` is opaque module JSON; the store owns
 * the envelope, modules own the payload.
 */
export interface CheckpointRecord {
  /** Must equal the store binding — saves are isolated per experience. */
  experienceDigest: string;
  /** Must equal the store binding. */
  slot: string;
  /** Runtime engine major version; mismatch quarantines the record. */
  engineMajor: number;
  /** Checkpoint schema version; mismatch quarantines the record. */
  checkpointSchemaVersion: number;
  /** Monotonic, CAS-fenced. */
  revision: number;
  /** Commit-log event id that produced this checkpoint (idempotency key). */
  lastCommittedEventId: string;
  /** Opaque JSON payload. */
  state: unknown;
}

/**
 * Structural problems of a raw value, listed before anything is cloned or
 * used. An empty array means the value has checkpoint-record shape.
 */
export function checkpointRecordProblems(raw: unknown): string[] {
  const problems: string[] = [];
  if (!isPlainRecord(raw)) {
    problems.push('record: expected an object');
    return problems;
  }
  expectString(raw, 'experienceDigest', problems);
  expectString(raw, 'slot', problems);
  expectInt(raw, 'engineMajor', problems, { min: 1 });
  expectInt(raw, 'checkpointSchemaVersion', problems, { min: 1 });
  expectInt(raw, 'revision', problems, { min: 0 });
  expectString(raw, 'lastCommittedEventId', problems);
  if (!('state' in raw)) {
    problems.push('state: missing field');
  } else {
    jsonProblems(raw.state, 'state', problems);
  }
  return problems;
}

/** Deep JSON-compatibility check; appends problems at dotted paths. */
export function jsonProblems(value: unknown, path: string, problems: string[]): string[] {
  if (value === null) return problems;
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return problems;
    case 'number':
      if (!Number.isFinite(value)) problems.push(`${path}: non-finite number`);
      return problems;
    case 'object':
      break;
    default:
      problems.push(`${path}: ${typeof value} is not JSON-serializable`);
      return problems;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) jsonProblems(value[i], `${path}[${i}]`, problems);
    return problems;
  }
  if (!isPlainRecord(value)) {
    problems.push(`${path}: expected a plain JSON object`);
    return problems;
  }
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) {
      problems.push(`${path}.${key}: undefined is not JSON-serializable`);
      continue;
    }
    jsonProblems(value[key], `${path}.${key}`, problems);
  }
  return problems;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function expectString(
  record: Record<string, unknown>,
  field: string,
  problems: string[],
): void {
  if (!(field in record)) {
    problems.push(`${field}: missing field`);
  } else if (typeof record[field] !== 'string' || (record[field] as string).length === 0) {
    problems.push(`${field}: expected a non-empty string`);
  }
}

function expectInt(
  record: Record<string, unknown>,
  field: string,
  problems: string[],
  opts: { min: number },
): void {
  if (!(field in record)) {
    problems.push(`${field}: missing field`);
  } else if (typeof record[field] !== 'number' || !Number.isInteger(record[field] as number)) {
    problems.push(`${field}: expected an integer`);
  } else if ((record[field] as number) < opts.min) {
    problems.push(`${field}: expected an integer >= ${opts.min}`);
  }
}

// ---------------------------------------------------------------------------
// Storage backends
// ---------------------------------------------------------------------------

export type BackendStatus = { status: 'available' } | { status: 'unavailable'; reason: string };

/**
 * Plurable persistence surface. `read` resolves the raw stored value
 * (structured-cloned) or undefined when the key is absent; it rejects with
 * `BackendStorageError` when storage is unavailable. `write` persists the
 * value (already cloned by the store) or rejects with `BackendStorageError`.
 */
export interface StorageBackend {
  /** Stable identifier for diagnostics ('memory' | 'idb' | ...). */
  readonly kind: string;
  getStatus(): Promise<BackendStatus>;
  read(key: string): Promise<unknown | undefined>;
  write(key: string, value: unknown): Promise<void>;
}

/** Error thrown by backends; the store maps it to `unavailable` outcomes. */
export class BackendStorageError extends Error {
  readonly causeDetail: unknown;

  constructor(message: string, causeDetail?: unknown) {
    super(message, causeDetail !== undefined ? { cause: causeDetail } : undefined);
    this.name = 'BackendStorageError';
    this.causeDetail = causeDetail;
  }
}

/** Deep clone for JSON-compatible values. Throws on non-JSON data. */
function cloneJson<T>(value: T): T {
  if (value === undefined) {
    throw new CreativeError('CLONE_FAILED', 'cannot clone undefined as JSON', { phase: 'commit' });
  }
  return structuredClone(value);
}

/**
 * In-memory backend. Every instance owns a private map — no statics, so
 * tests and sessions can never leak records into each other (a legacy
 * save-store defect).
 */
export class MemoryBackend implements StorageBackend {
  readonly kind = 'memory';
  private readonly data = new Map<string, unknown>();

  getStatus(): Promise<BackendStatus> {
    return Promise.resolve({ status: 'available' });
  }

  read(key: string): Promise<unknown | undefined> {
    const raw = this.data.get(key);
    return Promise.resolve(raw === undefined ? undefined : cloneJson(raw));
  }

  write(key: string, value: unknown): Promise<void> {
    this.data.set(key, cloneJson(value));
    return Promise.resolve();
  }

  /** Test/introspection helper: how many keys this instance holds. */
  get size(): number {
    return this.data.size;
  }

  /** Test helper: seed a raw (possibly corrupt) value without validation. */
  seedRaw(key: string, value: unknown): void {
    this.data.set(key, value);
  }

  /** Test helper: true while the key holds a stored value. */
  has(key: string): boolean {
    return this.data.has(key);
  }
}

export interface IdbBackendOptions {
  /** Injectable factory; defaults to globalThis.indexedDB when present. */
  factory?: IDBFactory;
  dbName?: string;
  storeName?: string;
}

/**
 * IndexedDB backend skeleton for browsers. The database opens lazily on
 * first use. When no factory is available (or the open fails) the backend
 * reports `unavailable` and read/write reject with `BackendStorageError` —
 * it never pretends the save is durable.
 */
export class IdbBackend implements StorageBackend {
  readonly kind = 'idb';
  private readonly factory: IDBFactory | undefined;
  private readonly dbName: string;
  private readonly storeName: string;
  private openPromise: Promise<IDBDatabase> | null = null;

  constructor(opts: IdbBackendOptions = {}) {
    this.factory = opts.factory ?? (typeof globalThis !== 'undefined'
      ? (globalThis as { indexedDB?: IDBFactory }).indexedDB
      : undefined);
    this.dbName = opts.dbName ?? 'kanshan.creative.checkpoints';
    this.storeName = opts.storeName ?? 'checkpoints';
  }

  async getStatus(): Promise<BackendStatus> {
    if (!this.factory) return { status: 'unavailable', reason: 'indexedDB is not available in this environment' };
    try {
      await this.open();
      return { status: 'available' };
    } catch (err) {
      return {
        status: 'unavailable',
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async read(key: string): Promise<unknown | undefined> {
    const db = await this.requireDb();
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        fn();
      };
      try {
        const tx = db.transaction(this.storeName, 'readonly');
        const request = tx.objectStore(this.storeName).get(key);
        request.onsuccess = () => finish(() => resolve(request.result as unknown as unknown));
        request.onerror = () =>
          finish(() => reject(new BackendStorageError(`idb read failed for "${key}"`)));
      } catch (err) {
        finish(() => reject(new BackendStorageError(`idb read failed for "${key}"`, err)));
      }
    });
  }

  async write(key: string, value: unknown): Promise<void> {
    const db = await this.requireDb();
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        fn();
      };
      try {
        const tx = db.transaction(this.storeName, 'readwrite');
        tx.objectStore(this.storeName).put(value, key);
        tx.oncomplete = () => finish(() => resolve());
        tx.onerror = () =>
          finish(() => reject(new BackendStorageError(`idb write failed for "${key}"`)));
        tx.onabort = () =>
          finish(() => reject(new BackendStorageError(`idb write aborted for "${key}"`)));
      } catch (err) {
        finish(() => reject(new BackendStorageError(`idb write failed for "${key}"`, err)));
      }
    });
  }

  private requireDb(): Promise<IDBDatabase> {
    if (!this.factory) {
      return Promise.reject(
        new BackendStorageError('indexedDB is not available in this environment'),
      );
    }
    return this.open();
  }

  private open(): Promise<IDBDatabase> {
    if (this.openPromise) return this.openPromise;
    const factory = this.factory;
    if (!factory) {
      this.openPromise = Promise.reject(
        new BackendStorageError('indexedDB is not available in this environment'),
      );
      return this.openPromise;
    }
    this.openPromise = new Promise<IDBDatabase>((resolve, reject) => {
      try {
        const request = factory.open(this.dbName, 1);
        request.onupgradeneeded = () => {
          try {
            request.result.createObjectStore(this.storeName);
          } catch (err) {
            reject(new BackendStorageError(`idb upgrade failed: ${describeError(err)}`, err));
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () =>
          reject(
            new BackendStorageError(
              `idb open failed: ${request.error ? request.error.message : 'unknown error'}`,
              request.error ?? undefined,
            ),
          );
      } catch (err) {
        reject(new BackendStorageError(`idb open failed: ${describeError(err)}`, err));
      }
    });
    return this.openPromise;
  }
}

// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------

export type LoadOutcome =
  | { status: 'empty' }
  | { status: 'loaded'; record: CheckpointRecord }
  | { status: 'unavailable'; message: string }
  | { status: 'corrupt'; problems: string[] }
  | {
      status: 'quarantined';
      reason: 'identity-mismatch' | 'engine-major-mismatch' | 'schema-version-mismatch';
      found: RecordIdentity;
    };

export type WriteOutcome =
  | { ok: true; status: 'committed'; record: CheckpointRecord }
  | { ok: true; status: 'duplicate'; record: CheckpointRecord }
  | { ok: false; status: 'conflict'; currentRevision: number }
  | { ok: false; status: 'invalid'; problems: string[] }
  | { ok: false; status: 'corrupt'; problems: string[] }
  | { ok: false; status: 'quarantined'; reason: string }
  | { ok: false; status: 'unavailable'; message: string };

export interface RecordIdentity {
  experienceDigest: string;
  slot: string;
  engineMajor: number;
  checkpointSchemaVersion: number;
}

/** A raw value kept aside after a failed read/write; the slot is untouched. */
export interface QuarantineEntry {
  key: string;
  kind: 'corrupt' | 'quarantined';
  reason?: string;
  problems?: string[];
  at: number;
}

// ---------------------------------------------------------------------------
// CheckpointStore
// ---------------------------------------------------------------------------

export interface CheckpointStoreOptions {
  backend: StorageBackend;
  experienceDigest: string;
  slot?: string;
  engineMajor: number;
  checkpointSchemaVersion: number;
  /** Clock for quarantine timestamps; injectable for tests. */
  now?: () => number;
}

/**
 * Versioned checkpoint store bound to one (experienceDigest, slot) pair.
 * All expected failure modes are reported as outcomes — the store never
 * throws at the API surface.
 */
export class CheckpointStore {
  readonly backend: StorageBackend;
  readonly experienceDigest: string;
  readonly slot: string;
  readonly engineMajor: number;
  readonly checkpointSchemaVersion: number;
  private readonly now: () => number;
  private readonly quarantineLog: QuarantineEntry[] = [];
  private persisted = 0;
  private pending: number | null = null;

  constructor(opts: CheckpointStoreOptions) {
    if (!opts.experienceDigest || typeof opts.experienceDigest !== 'string') {
      throw new CreativeError('BAD_STORE_BINDING', 'experienceDigest must be a non-empty string', {
        phase: 'create',
      });
    }
    if (!Number.isInteger(opts.engineMajor) || opts.engineMajor < 1) {
      throw new CreativeError('BAD_STORE_BINDING', 'engineMajor must be a positive integer', {
        phase: 'create',
      });
    }
    if (!Number.isInteger(opts.checkpointSchemaVersion) || opts.checkpointSchemaVersion < 1) {
      throw new CreativeError(
        'BAD_STORE_BINDING',
        'checkpointSchemaVersion must be a positive integer',
        { phase: 'create' },
      );
    }
    this.backend = opts.backend;
    this.experienceDigest = opts.experienceDigest;
    this.slot = opts.slot ?? 'default';
    this.engineMajor = opts.engineMajor;
    this.checkpointSchemaVersion = opts.checkpointSchemaVersion;
    this.now = opts.now ?? Date.now;
  }

  /** Backend key for this binding. */
  get key(): string {
    return `${this.experienceDigest}:${this.slot}`;
  }

  /** Last revision confirmed durable by the backend. 0 when empty. */
  get persistedRevision(): number {
    return this.persisted;
  }

  /**
   * Last revision handed to `write` that has not been confirmed durable.
   * null when nothing is pending. A failed write leaves this set while
   * persistedRevision stays behind — the runtime must not treat the
   * attempt as saved.
   */
  get pendingRevision(): number | null {
    return this.pending;
  }

  /** Quarantined raw values, oldest first (defensive copies). */
  get quarantine(): readonly QuarantineEntry[] {
    return this.quarantineLog.map((entry) => ({ ...entry }));
  }

  /** Load the committed record for this binding, or an honest outcome. */
  async load(): Promise<LoadOutcome> {
    let raw: unknown;
    try {
      raw = await this.backend.read(this.key);
    } catch (err) {
      return { status: 'unavailable', message: describeError(err) };
    }
    if (raw === undefined || raw === null) return { status: 'empty' };

    // G11.a: validate structure BEFORE any clone/use; corrupt data must
    // never crash the reader (the old save-store cloned first and threw).
    const problems = checkpointRecordProblems(raw);
    if (problems.length > 0) {
      this.recordQuarantine('corrupt', undefined, problems);
      return { status: 'corrupt', problems: [...problems] };
    }
    const record = cloneJson(raw) as CheckpointRecord;

    const identity = identityOf(record);
    const mismatch = this.identityMismatch(identity);
    if (mismatch) {
      this.recordQuarantine('quarantined', mismatch, undefined);
      return { status: 'quarantined', reason: mismatch, found: identity };
    }
    this.persisted = record.revision;
    if (this.pending !== null && this.pending <= record.revision) this.pending = null;
    return { status: 'loaded', record };
  }

  /**
   * CAS write. `record.revision` must be expectedRevision + 1 and
   * `record.lastCommittedEventId` must equal the eventId argument.
   */
  async write(
    expectedRevision: number,
    record: CheckpointRecord,
    lastCommittedEventId: string,
  ): Promise<WriteOutcome> {
    return this.writeInternal(expectedRevision, record, lastCommittedEventId, false);
  }

  private async writeInternal(
    expectedRevision: number,
    record: CheckpointRecord,
    lastCommittedEventId: string,
    allowCurrentSchemaDrift: boolean,
  ): Promise<WriteOutcome> {
    // Validate the caller's record before touching storage.
    const problems = checkpointRecordProblems(record);
    if (problems.length > 0) return { ok: false, status: 'invalid', problems };
    const identity = identityOf(record);
    const mismatch = this.identityMismatch(identity);
    if (mismatch) return { ok: false, status: 'quarantined', reason: mismatch };
    if (record.revision !== expectedRevision + 1) {
      return {
        ok: false,
        status: 'invalid',
        problems: [`revision: expected ${expectedRevision + 1} (expectedRevision + 1), got ${record.revision}`],
      };
    }
    if (record.lastCommittedEventId !== lastCommittedEventId) {
      return {
        ok: false,
        status: 'invalid',
        problems: ['lastCommittedEventId: argument must match the record field'],
      };
    }
    const payload = cloneJson(record);

    let raw: unknown;
    try {
      raw = await this.backend.read(this.key);
    } catch (err) {
      this.pending = record.revision;
      return { ok: false, status: 'unavailable', message: describeError(err) };
    }

    if (raw !== undefined && raw !== null) {
      const currentProblems = checkpointRecordProblems(raw);
      if (currentProblems.length > 0) {
        this.recordQuarantine('corrupt', undefined, currentProblems);
        return { ok: false, status: 'corrupt', problems: [...currentProblems] };
      }
      const current = cloneJson(raw) as CheckpointRecord;
      const currentIdentity = identityOf(current);
      const currentMismatch = allowCurrentSchemaDrift
        ? this.identityMismatchIgnoringSchema(currentIdentity)
        : this.identityMismatch(currentIdentity);
      if (currentMismatch) {
        this.recordQuarantine('quarantined', currentMismatch, undefined);
        return { ok: false, status: 'quarantined', reason: currentMismatch };
      }
      if (current.lastCommittedEventId === lastCommittedEventId) {
        // Idempotent replay: the same commit is never applied twice.
        this.persisted = current.revision;
        if (this.pending !== null && this.pending <= current.revision) this.pending = null;
        return { ok: true, status: 'duplicate', record: current };
      }
      if (current.revision !== expectedRevision) {
        return { ok: false, status: 'conflict', currentRevision: current.revision };
      }
    } else if (expectedRevision !== 0) {
      return { ok: false, status: 'conflict', currentRevision: 0 };
    }

    try {
      await this.backend.write(this.key, payload);
    } catch (err) {
      // Backend failed: report precisely and record the attempt as pending
      // — persistedRevision must NOT advance as if the save happened.
      this.pending = record.revision;
      return { ok: false, status: 'unavailable', message: describeError(err) };
    }
    this.persisted = record.revision;
    this.pending = null;
    return { ok: true, status: 'committed', record: payload };
  }

  /**
   * Copy the committed record into another store (typically another slot).
   * The target keeps its own revision lineage. Any failure — corrupt
   * source, unavailable target — leaves the source slot untouched.
   */
  async copySlot(target: CheckpointStore): Promise<WriteOutcome> {
    const source = await this.load();
    if (source.status === 'empty') {
      return { ok: false, status: 'invalid', problems: ['source slot is empty'] };
    }
    if (source.status !== 'loaded') return sourceFailureOutcome(source);
    const next: CheckpointRecord = {
      ...source.record,
      slot: target.slot,
      revision: target.persistedRevision + 1,
    };
    return target.write(target.persistedRevision, next, source.record.lastCommittedEventId);
  }

  /**
   * Migrate the committed record to a new checkpointSchemaVersion via
   * `migrator` and persist it as the next revision. A throwing migrator or
   * an invalid result is an explicit failure and the source record is left
   * intact. `eventId` keys the new revision (never reuse the old one, or
   * idempotency would swallow the migration).
   */
  async migrate(
    migrator: (record: CheckpointRecord) => Pick<CheckpointRecord, 'checkpointSchemaVersion' | 'state'>,
    eventId: string,
  ): Promise<WriteOutcome> {
    const source = await this.load();
    if (source.status === 'empty') {
      return { ok: false, status: 'invalid', problems: ['nothing to migrate'] };
    }
    if (source.status !== 'loaded') return sourceFailureOutcome(source);
    let migrated: Pick<CheckpointRecord, 'checkpointSchemaVersion' | 'state'>;
    try {
      migrated = migrator(source.record);
    } catch (err) {
      return {
        ok: false,
        status: 'invalid',
        problems: [`migrator threw: ${describeError(err)}`],
      };
    }
    const next: CheckpointRecord = {
      ...source.record,
      checkpointSchemaVersion: migrated.checkpointSchemaVersion,
      state: migrated.state,
      revision: source.record.revision + 1,
      lastCommittedEventId: eventId,
    };
    // The migrated record is bound at the NEW schema version: write it
    // through a same-slot store bound there, allowing the stored record to
    // be the pre-migration schema (the source was validated against this
    // store's binding above). A store still bound at the old version will
    // (correctly) quarantine the migrated record on load — migrate is the
    // sanctioned transition, not a bypass of the check.
    const upgraded = new CheckpointStore({
      backend: this.backend,
      experienceDigest: this.experienceDigest,
      slot: this.slot,
      engineMajor: this.engineMajor,
      checkpointSchemaVersion: migrated.checkpointSchemaVersion,
      now: this.now,
    });
    return upgraded.writeInternal(source.record.revision, next, eventId, true);
  }

  private identityMismatch(
    identity: RecordIdentity,
  ): 'identity-mismatch' | 'engine-major-mismatch' | 'schema-version-mismatch' | null {
    const base = this.identityMismatchIgnoringSchema(identity);
    if (base) return base;
    if (identity.checkpointSchemaVersion !== this.checkpointSchemaVersion) {
      return 'schema-version-mismatch';
    }
    return null;
  }

  /** Identity/engine checks only; used while migrating schema versions. */
  private identityMismatchIgnoringSchema(
    identity: RecordIdentity,
  ): 'identity-mismatch' | 'engine-major-mismatch' | null {
    if (identity.experienceDigest !== this.experienceDigest || identity.slot !== this.slot) {
      return 'identity-mismatch';
    }
    if (identity.engineMajor !== this.engineMajor) return 'engine-major-mismatch';
    return null;
  }

  private recordQuarantine(kind: 'corrupt' | 'quarantined', reason: string | undefined, problems: string[] | undefined): void {
    this.quarantineLog.push({
      key: this.key,
      kind,
      reason,
      problems: problems ? [...problems] : undefined,
      at: this.now(),
    });
  }
}

function sourceFailureOutcome(source: LoadOutcome): WriteOutcome {
  switch (source.status) {
    case 'unavailable':
      return { ok: false, status: 'unavailable', message: source.message };
    case 'corrupt':
      return { ok: false, status: 'corrupt', problems: [...source.problems] };
    case 'quarantined':
      return { ok: false, status: 'quarantined', reason: source.reason };
    default:
      return {
        ok: false,
        status: 'invalid',
        problems: [`unexpected source status: ${(source as { status: string }).status}`],
      };
  }
}

function identityOf(record: CheckpointRecord): RecordIdentity {
  return {
    experienceDigest: record.experienceDigest,
    slot: record.slot,
    engineMajor: record.engineMajor,
    checkpointSchemaVersion: record.checkpointSchemaVersion,
  };
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
