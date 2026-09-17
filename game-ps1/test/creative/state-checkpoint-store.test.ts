import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BackendStorageError,
  CheckpointStore,
  IdbBackend,
  MemoryBackend,
  checkpointRecordProblems,
} from '../../src/creative/state/checkpoint-store.ts';
import type { CheckpointRecord, StorageBackend } from '../../src/creative/state/checkpoint-store.ts';

const DIGEST = 'a'.repeat(64);

function makeRecord(overrides?: Partial<CheckpointRecord>): CheckpointRecord {
  return {
    experienceDigest: DIGEST,
    slot: 'default',
    engineMajor: 1,
    checkpointSchemaVersion: 1,
    revision: 1,
    lastCommittedEventId: 'evt-1',
    state: { fear: 10, inventory: ['lantern'] },
    ...overrides,
  };
}

function makeStore(opts?: {
  backend?: StorageBackend;
  slot?: string;
  engineMajor?: number;
  checkpointSchemaVersion?: number;
}): CheckpointStore {
  return new CheckpointStore({
    backend: opts?.backend ?? new MemoryBackend(),
    experienceDigest: DIGEST,
    slot: opts?.slot ?? 'default',
    engineMajor: opts?.engineMajor ?? 1,
    checkpointSchemaVersion: opts?.checkpointSchemaVersion ?? 1,
    now: () => 1234,
  });
}

/** Backend that fails every write (and optionally every read). */
class FailingWriteBackend implements StorageBackend {
  readonly kind = 'failing';
  readonly written: unknown[] = [];
  private readonly failReads: boolean;

  constructor(failReads = false) {
    this.failReads = failReads;
  }
  getStatus() {
    return Promise.resolve({ status: 'available' as const });
  }
  read(): Promise<unknown | undefined> {
    if (this.failReads) return Promise.reject(new BackendStorageError('storage offline'));
    return Promise.resolve(undefined);
  }
  write(_key: string, value: unknown): Promise<void> {
    this.written.push(value);
    return Promise.reject(new BackendStorageError('disk full'));
  }
}

// ---------------------------------------------------------------------------
// CAS semantics (G11)
// ---------------------------------------------------------------------------

test('CAS write: single winner, stale expectedRevision loses with conflict', async () => {
  const backend = new MemoryBackend();
  const store = makeStore({ backend });

  const first = await store.write(0, makeRecord({ revision: 1, lastCommittedEventId: 'evt-1' }), 'evt-1');
  assert.equal(first.ok, true);
  assert.equal(first.status, 'committed');
  assert.equal(store.persistedRevision, 1);

  // A second writer still expects revision 0: conflict, no advance.
  const stale = await store.write(0, makeRecord({ revision: 1, lastCommittedEventId: 'evt-2' }), 'evt-2');
  assert.equal(stale.ok, false);
  if (!stale.ok) assert.equal(stale.status, 'conflict');
  if (!stale.ok && stale.status === 'conflict') assert.equal(stale.currentRevision, 1);
  assert.equal(store.persistedRevision, 1);

  // The winner's next write on the correct revision succeeds.
  const next = await store.write(1, makeRecord({ revision: 2, lastCommittedEventId: 'evt-2', state: { fear: 20 } }), 'evt-2');
  assert.equal(next.ok, true);
  assert.equal(store.persistedRevision, 2);
});

test('duplicate lastCommittedEventId is an idempotent success and never advances', async () => {
  const store = makeStore();
  const a = await store.write(0, makeRecord({ revision: 1, lastCommittedEventId: 'evt-1' }), 'evt-1');
  assert.equal(a.ok, true);

  // Retry of the same commit (e.g. replay after a crash): returns the
  // stored record, revision stays 1 — no double apply.
  const b = await store.write(0, makeRecord({ revision: 1, lastCommittedEventId: 'evt-1' }), 'evt-1');
  assert.equal(b.ok, true);
  if (b.ok) {
    assert.equal(b.status, 'duplicate');
    assert.equal(b.record.revision, 1);
  }
  assert.equal(store.persistedRevision, 1);

  const loaded = await store.load();
  assert.equal(loaded.status, 'loaded');
  if (loaded.status === 'loaded') assert.equal(loaded.record.revision, 1);
});

test('caller record with wrong revision or mismatched event id is invalid, not stored', async () => {
  const store = makeStore();
  const bad = await store.write(0, makeRecord({ revision: 5, lastCommittedEventId: 'evt-1' }), 'evt-1');
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.status, 'invalid');

  const mismatched = await store.write(0, makeRecord({ revision: 1, lastCommittedEventId: 'evt-1' }), 'evt-other');
  assert.equal(mismatched.ok, false);
  if (!mismatched.ok) assert.equal(mismatched.status, 'invalid');

  assert.equal(store.persistedRevision, 0);
  assert.equal((await store.load()).status, 'empty');
});

// ---------------------------------------------------------------------------
// Corruption handling (G11.a)
// ---------------------------------------------------------------------------

test('corrupted record reports a CORRUPT outcome listing problems — never throws into the caller', async () => {
  const backend = new MemoryBackend();
  const store = makeStore({ backend });
  // Legacy crash shape: clone-before-validate hit `state.inventory` of a
  // string. Here the whole envelope is garbage.
  backend.seedRaw(store.key, 'not even an object');

  const outcome = await store.load();
  assert.equal(outcome.status, 'corrupt');
  if (outcome.status === 'corrupt') {
    assert.ok(outcome.problems.some((p) => p.includes('record')));
  }
  // Quarantined for reporting.
  assert.equal(store.quarantine.length, 1);
  assert.equal(store.quarantine[0].kind, 'corrupt');
  assert.equal(store.quarantine[0].at, 1234);
});

test('corrupted record with missing fields/arrays lists every problem', async () => {
  const backend = new MemoryBackend();
  const store = makeStore({ backend });
  backend.seedRaw(store.key, {
    experienceDigest: DIGEST,
    slot: 'default',
    // engineMajor missing; revision is a string; lastCommittedEventId empty;
    // state contains a non-finite number.
    revision: 'seven',
    lastCommittedEventId: '',
    state: { hp: Number.POSITIVE_INFINITY },
  });

  const outcome = await store.load();
  assert.equal(outcome.status, 'corrupt');
  if (outcome.status !== 'corrupt') return;
  assert.ok(outcome.problems.some((p) => p.startsWith('engineMajor')));
  assert.ok(outcome.problems.some((p) => p.startsWith('revision')));
  assert.ok(outcome.problems.some((p) => p.startsWith('lastCommittedEventId')));
  assert.ok(outcome.problems.some((p) => p.includes('state.hp')));
});

test('failed read does not overwrite the original slot data', async () => {
  const backend = new MemoryBackend();
  const store = makeStore({ backend });
  backend.seedRaw(store.key, { broken: true });

  await store.load(); // corrupt outcome
  // The raw value is still exactly what was there — no fresh envelope
  // written over it by the failed read.
  const still = await backend.read(store.key);
  assert.deepEqual(still, { broken: true });

  // A subsequent load still reports the corruption honestly (no silent reset).
  assert.equal((await store.load()).status, 'corrupt');
});

test('checkpointRecordProblems validates structure without cloning (deep garbage is listed, not thrown)', () => {
  const problems = checkpointRecordProblems({
    experienceDigest: DIGEST,
    slot: 'default',
    engineMajor: 1,
    checkpointSchemaVersion: 1,
    revision: 1,
    lastCommittedEventId: 'evt-1',
    state: { nested: { list: [1, 2, { bad: () => 1 }] } },
  });
  assert.ok(problems.some((p) => p.includes('state.nested.list[2].bad')));
});

// ---------------------------------------------------------------------------
// Quarantine on identity / version mismatch
// ---------------------------------------------------------------------------

test('engineMajor mismatch is an explicit quarantine outcome — never a silent reset', async () => {
  const backend = new MemoryBackend();
  const store = makeStore({ backend, engineMajor: 1 });
  const written = await store.write(0, makeRecord({ revision: 1, lastCommittedEventId: 'evt-1' }), 'evt-1');
  assert.equal(written.ok, true);

  // Same digest+slot, but the runtime now reports engineMajor 2.
  const upgraded = makeStore({ backend, engineMajor: 2 });
  const outcome = await upgraded.load();
  assert.equal(outcome.status, 'quarantined');
  if (outcome.status === 'quarantined') {
    assert.equal(outcome.reason, 'engine-major-mismatch');
    assert.equal(outcome.found.engineMajor, 1);
  }
  assert.equal(upgraded.persistedRevision, 0, 'quarantined record must not advance revision');
});

test('checkpointSchemaVersion mismatch is quarantined, not silently loaded', async () => {
  const backend = new MemoryBackend();
  const store = makeStore({ backend, checkpointSchemaVersion: 1 });
  await store.write(0, makeRecord({ revision: 1, lastCommittedEventId: 'evt-1' }), 'evt-1');

  const migratedRuntime = makeStore({ backend, checkpointSchemaVersion: 2 });
  const outcome = await migratedRuntime.load();
  assert.equal(outcome.status, 'quarantined');
  if (outcome.status === 'quarantined') {
    assert.equal(outcome.reason, 'schema-version-mismatch');
  }
});

test('record bound to another experienceDigest/slot is quarantined (identity-mismatch)', async () => {
  const backend = new MemoryBackend();
  const store = makeStore({ backend });
  // A well-formed record stored under this key but bound elsewhere.
  backend.seedRaw(store.key, makeRecord({ experienceDigest: 'b'.repeat(64), revision: 1 }));

  const outcome = await store.load();
  assert.equal(outcome.status, 'quarantined');
  if (outcome.status === 'quarantined') assert.equal(outcome.reason, 'identity-mismatch');

  const wrongSlot = makeStore({ backend, slot: 'slot-a' });
  (wrongSlot.backend as MemoryBackend).seedRaw(wrongSlot.key, makeRecord({ slot: 'slot-b', revision: 1 }));
  const slotOutcome = await wrongSlot.load();
  assert.equal(slotOutcome.status, 'quarantined');
  if (slotOutcome.status === 'quarantined') assert.equal(slotOutcome.reason, 'identity-mismatch');
});

// ---------------------------------------------------------------------------
// Storage-unavailable path (D05 bug)
// ---------------------------------------------------------------------------

test('backend write failure: precise unavailable outcome, persistedRevision does not advance', async () => {
  const backend = new FailingWriteBackend();
  const store = makeStore({ backend });

  const outcome = await store.write(0, makeRecord({ revision: 1, lastCommittedEventId: 'evt-1' }), 'evt-1');
  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.equal(outcome.status, 'unavailable');
    assert.match(outcome.message, /disk full/);
  }
  // The D05 bug: memory-fallback advanced revision after an IDB write
  // failure. Here the attempt is only pending.
  assert.equal(store.persistedRevision, 0);
  assert.equal(store.pendingRevision, 1);

  // A later load from the failed backend reports unavailability honestly.
  const loaded = await store.load();
  assert.equal(loaded.status, 'empty'); // reads still work; nothing was stored
});

test('backend read failure on write is an unavailable outcome with pending revision', async () => {
  const backend = new FailingWriteBackend(true);
  const store = makeStore({ backend });
  const outcome = await store.write(0, makeRecord({ revision: 1, lastCommittedEventId: 'evt-1' }), 'evt-1');
  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.equal(outcome.status, 'unavailable');
  assert.equal(store.persistedRevision, 0);
  assert.equal(store.pendingRevision, 1);
});

test('failed write does not poison the CAS lineage: retry from persisted revision succeeds', async () => {
  const durable = new MemoryBackend();
  const failing = new FailingWriteBackend();
  const store = makeStore({ backend: failing });
  const seed = await store.write(0, makeRecord({ revision: 1, lastCommittedEventId: 'evt-1' }), 'evt-1');
  assert.equal(seed.ok, false);
  assert.equal(store.persistedRevision, 0, 'nothing durable yet');
  assert.equal(store.pendingRevision, 1);

  // Storage recovers; a store re-anchored on the durable backend loads the
  // last confirmed revision and the pending attempt is forgotten.
  await durable.write(store.key, makeRecord({ revision: 1, lastCommittedEventId: 'evt-1' }));
  const recovered = makeStore({ backend: durable });
  const loaded = await recovered.load();
  assert.equal(loaded.status, 'loaded');
  assert.equal(recovered.persistedRevision, 1);
  assert.equal(recovered.pendingRevision, null);

  // The retry still expects revision 1 and wins the CAS.
  const retried = await recovered.write(1, makeRecord({ revision: 2, lastCommittedEventId: 'evt-2' }), 'evt-2');
  assert.equal(retried.ok, true);
  assert.equal(recovered.persistedRevision, 2);
  assert.equal(recovered.pendingRevision, null);
});

test('unavailable backend never fakes persistence (IdbBackend without IndexedDB)', async () => {
  // Node has no indexedDB: the skeleton must report unavailability and
  // refuse to read/write instead of pretending.
  const backend = new IdbBackend({ factory: undefined });
  const status = await backend.getStatus();
  assert.equal(status.status, 'unavailable');

  let readErr: unknown = null;
  try {
    await backend.read('k');
  } catch (err) {
    readErr = err;
  }
  assert.ok(readErr instanceof BackendStorageError);

  let writeErr: unknown = null;
  try {
    await backend.write('k', { x: 1 });
  } catch (err) {
    writeErr = err;
  }
  assert.ok(writeErr instanceof BackendStorageError);

  // And the store surfaces it as a precise failure, not a fake save.
  const store = new CheckpointStore({
    backend: new IdbBackend({ factory: undefined }),
    experienceDigest: DIGEST,
    engineMajor: 1,
    checkpointSchemaVersion: 1,
  });
  const outcome = await store.write(0, makeRecord({ revision: 1, lastCommittedEventId: 'evt-1' }), 'evt-1');
  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.equal(outcome.status, 'unavailable');
  assert.equal(store.persistedRevision, 0);
});

test('IdbBackend surfaces an injected factory whose open fails', async () => {
  const failingFactory = {
    open(): IDBOpenDBRequest {
      throw new Error('factory exploded');
    },
  } as unknown as IDBFactory;
  const backend = new IdbBackend({ factory: failingFactory });
  const status = await backend.getStatus();
  assert.equal(status.status, 'unavailable');
  if (status.status === 'unavailable') assert.match(status.reason, /factory exploded/);
});

// ---------------------------------------------------------------------------
// copySlot / migrate leave the source intact
// ---------------------------------------------------------------------------

test('copySlot copies to another slot; failed copy leaves the source intact', async () => {
  const backend = new MemoryBackend();
  const source = makeStore({ backend, slot: 'autosave' });
  await source.write(0, makeRecord({ slot: 'autosave', revision: 1, lastCommittedEventId: 'evt-1' }), 'evt-1');

  const target = makeStore({ backend, slot: 'backup' });
  const copied = await source.copySlot(target);
  assert.equal(copied.ok, true);
  if (copied.ok) assert.equal(copied.record.slot, 'backup');
  assert.equal(target.persistedRevision, 1);

  // Source still holds its own record.
  const sourceLoad = await source.load();
  assert.equal(sourceLoad.status, 'loaded');
  if (sourceLoad.status === 'loaded') assert.equal(sourceLoad.record.slot, 'autosave');

  // Failed copy (unavailable target): source untouched.
  const failingTarget = makeStore({ backend: new FailingWriteBackend(), slot: 'elsewhere' });
  const failed = await source.copySlot(failingTarget);
  assert.equal(failed.ok, false);
  if (!failed.ok) assert.equal(failed.status, 'unavailable');
  const after = await source.load();
  assert.equal(after.status, 'loaded');
  if (after.status === 'loaded') assert.equal(after.record.revision, 1);
});

test('copySlot from a corrupt source fails honestly and touches nothing', async () => {
  const backend = new MemoryBackend();
  const source = makeStore({ backend });
  backend.seedRaw(source.key, { garbage: true });
  const target = makeStore({ backend, slot: 'target' });

  const outcome = await source.copySlot(target);
  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.equal(outcome.status, 'corrupt');
  assert.equal((await target.load()).status, 'empty');
  // Source raw bytes remain as they were.
  assert.deepEqual(await backend.read(source.key), { garbage: true });
});

test('migrate bumps checkpointSchemaVersion and persists; throwing migrator leaves source intact', async () => {
  const backend = new MemoryBackend();
  const store = makeStore({ backend, checkpointSchemaVersion: 1 });
  await store.write(0, makeRecord({ revision: 1, lastCommittedEventId: 'evt-1' }), 'evt-1');

  const ok = await store.migrate(
    (record) => ({
      checkpointSchemaVersion: 2,
      state: { ...(record.state as object), migrated: true },
    }),
    'migrate-1',
  );
  assert.equal(ok.ok, true);

  // The migrated record lives under the same slot, bound at v2. A store
  // still bound at v1 quarantines it; a v2 store loads it.
  assert.equal(store.persistedRevision, 1, 'v1-bound store never persisted a v2 record');
  assert.equal((await store.load()).status, 'quarantined');
  const upgraded = makeStore({ backend, checkpointSchemaVersion: 2 });
  const loaded = await upgraded.load();
  assert.equal(loaded.status, 'loaded');
  if (loaded.status === 'loaded') {
    assert.equal(loaded.record.revision, 2);
    assert.equal(loaded.record.checkpointSchemaVersion, 2);
    assert.deepEqual(loaded.record.state, { fear: 10, inventory: ['lantern'], migrated: true });
  }

  // Throwing migrator: explicit failure, source revision unchanged.
  const failed = await upgraded.migrate(() => {
    throw new Error('no migration path');
  }, 'migrate-2');
  assert.equal(failed.ok, false);
  if (!failed.ok) {
    assert.equal(failed.status, 'invalid');
    assert.ok(failed.problems.some((p) => p.includes('no migration path')));
  }
  assert.equal(upgraded.persistedRevision, 2);
  const after = await backend.read(store.key);
  assert.ok(after !== null && typeof after === 'object');
  assert.equal((after as CheckpointRecord).revision, 2, 'source slot data untouched');
});

// ---------------------------------------------------------------------------
// MemoryBackend hygiene
// ---------------------------------------------------------------------------

test('MemoryBackend is per-instance: two backends never share records', async () => {
  const a = new MemoryBackend();
  const b = new MemoryBackend();
  const storeA = makeStore({ backend: a });
  await storeA.write(0, makeRecord({ revision: 1, lastCommittedEventId: 'evt-1' }), 'evt-1');

  const storeB = makeStore({ backend: b });
  assert.equal((await storeB.load()).status, 'empty');
  assert.equal(a.size, 1);
  assert.equal(b.size, 0);
});

test('records are cloned across the boundary: mutating a loaded record does not corrupt storage', async () => {
  const backend = new MemoryBackend();
  const store = makeStore({ backend });
  await store.write(0, makeRecord({ revision: 1, lastCommittedEventId: 'evt-1' }), 'evt-1');

  const loaded = await store.load();
  assert.equal(loaded.status, 'loaded');
  if (loaded.status !== 'loaded') return;
  (loaded.record.state as { inventory: string[] }).inventory.push('exploit');

  const again = await store.load();
  assert.equal(again.status, 'loaded');
  if (again.status === 'loaded') {
    assert.deepEqual(again.record.state, { fear: 10, inventory: ['lantern'] });
  }
});
