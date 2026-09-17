/**
 * G17 legacy StoryPackage adapter evidence (src/creative/legacy/).
 *
 * A real headless run of the legacy format inside the new creative runtime:
 * the REAL bookstall-opening.json fixture loads through the adapter into a
 * controlled RuntimeSessionHost, the host fixed clock steps it, option
 * completion happens only through the module's public path (the shared pure
 * reducer + namespaced commits — no setState, no teleports), and destroy
 * tears the world down through the disposeObject path. Validation gate,
 * explicit mixed-format rejection and save-identity quarantine are covered
 * against the real shared validator and the real checkpoint store.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RuntimeSessionHost, CreativeError, experienceDigest } from '../../src/creative/core/index.ts';
import type { ObjectSnapshot } from '../../src/creative/core/index.ts';
import { CheckpointStore, MemoryBackend } from '../../src/creative/state/checkpoint-store.ts';
import { EXAMPLE_STORY_PACKAGE } from '@kanshan/story-contract';
import {
  createStoryPackageModule,
  LegacyManifestError,
  LEGACY_COMPLETE_OPTION_EVENT,
  LEGACY_CONFIRM_END_EVENT,
  LEGACY_PROVENANCE_BACKFILL_CODE,
} from '../../src/creative/legacy/story-package-module.ts';
import type { LegacyStoryHandles, StoryPackageModuleOptions } from '../../src/creative/legacy/story-package-module.ts';
import {
  createLegacySaveEnvelope,
  legacyPackageDigest,
  legacySaveSlotKey,
} from '../../src/creative/legacy/save-identity.ts';

const FIXTURE_URL = new URL('../../public/story-packages/bookstall-opening.json', import.meta.url);

/** The real legacy package fixture (old studio export, StoryPackage 1.0). */
type BookstallFixture = Record<string, unknown> & { source: { digest: string } };

function loadBookstall(): BookstallFixture {
  return JSON.parse(readFileSync(FIXTURE_URL, 'utf8')) as BookstallFixture;
}

function makeHost(): RuntimeSessionHost {
  return new RuntimeSessionHost({
    experienceDigest: 'legacy-adapter-test',
    buildId: 'legacy-adapter-test-build',
    mode: 'controlled',
    fixedDt: 1 / 60,
  });
}

async function startLegacy(
  pkg: unknown,
  opts?: StoryPackageModuleOptions,
): Promise<{ host: RuntimeSessionHost; handles: LegacyStoryHandles }> {
  const host = makeHost();
  const module = createStoryPackageModule(structuredClone(pkg), opts);
  await host.start(module);
  assert.ok(module.handles, 'handles exposed once create() resolves');
  return { host, handles: module.handles };
}

/** assert.rejects is unreliable here (project convention): capture instead. */
async function captureStartError(pkg: unknown, opts?: StoryPackageModuleOptions): Promise<unknown> {
  const host = makeHost();
  let error: unknown = null;
  try {
    await host.start(createStoryPackageModule(structuredClone(pkg), opts));
  } catch (err) {
    error = err;
  }
  assert.ok(error instanceof Error, 'host.start must reject');
  return error;
}

function sceneSnapshot(host: RuntimeSessionHost): ObjectSnapshot[] {
  const result = host.query({ kind: 'scene', limit: 500 });
  assert.equal(result.ok, true);
  return result.data as ObjectSnapshot[];
}

function byName(nodes: ObjectSnapshot[], name: string): ObjectSnapshot[] {
  return nodes.filter((node) => node.name === name);
}

// ---------------------------------------------------------------------------
// 1. Real fixture loads; host fixed clock steps it; template + prefab world
// ---------------------------------------------------------------------------

test('legacy bookstall package hosts in a controlled session: template walls, prefabs, reducer state (G17)', async () => {
  const fixture = loadBookstall();
  const { host, handles } = await startLegacy(fixture);

  assert.equal(host.currentStatus, 'running');
  assert.equal(handles.packageId, 'bookstall-opening');
  assert.equal(handles.packageDigest, (fixture.source as { digest: string }).digest);

  // The host's fixed clock drives the session; the module loads clean (the
  // legacy turn-based story commits nothing on its own — commits only ever
  // come from the public completion path).
  host.step(5);
  assert.equal(host.clock.tick, 5);
  const session = host.query({ kind: 'session' });
  assert.equal((session.data as { commitCount: number }).commitCount, 0);

  // Template + prefab construction (faithful to the old WorldAssembler):
  // wrapper -> story-scene root -> floor, 4 walls, 2 lights, 4 prefab groups.
  const nodes = sceneSnapshot(host);
  assert.equal(byName(nodes, 'legacy-story:bookstall-opening').length, 1);
  assert.equal(byName(nodes, 'story-scene:bookstall').length, 1);
  assert.equal(byName(nodes, 'template-floor').length, 1);
  assert.equal(byName(nodes, 'template-wall').length, 4);
  assert.equal(byName(nodes, 'object:counter').length, 1);
  assert.equal(byName(nodes, 'object:key').length, 1);
  assert.equal(byName(nodes, 'object:note').length, 1);
  assert.equal(byName(nodes, 'object:side-door').length, 1);
  // Prefab fidelity: table-v1 = top + 4 legs, key-v1 = bow + shaft,
  // door-v1 = slab + 2 jambs + lintel, note-v1 = paper + 2 ink lines.
  const childCount = (name: string): number =>
    nodes.filter((node) => node.parent === byName(nodes, name)[0]?.handle).length;
  assert.equal(childCount('object:counter'), 5);
  assert.equal(childCount('object:key'), 2);
  assert.equal(childCount('object:side-door'), 4);
  assert.equal(childCount('object:note'), 3);
  assert.equal(nodes.filter((node) => node.type === 'HemisphereLight' || node.type === 'DirectionalLight').length, 2);

  // Old reducer state via the query accessor; visibility rule applied
  // (side-door visible while flag door-open === false).
  assert.deepEqual(handles.state(), {
    beatId: 'read-note',
    flags: { 'door-open': false },
    inventory: [],
    collectedItems: [],
    knownFacts: [],
    ended: false,
  });
  assert.equal(handles.beat().id, 'read-note');
  assert.equal(handles.revision(), 0);
  assert.deepEqual(handles.availableOptionIds(), ['read']);
  assert.equal(byName(nodes, 'object:side-door')[0]?.visible, true);

  await host.stop();
});

test('legacy pipeline provenance gap is a DECLARED normalization, reported to the session', async () => {
  const { host, handles } = await startLegacy(loadBookstall());
  // The real old-pipeline fixture carries cues without provenance; the
  // adapter backfills them as invented and re-validates clean — visibly.
  assert.equal(handles.normalized, true);
  assert.ok(handles.validationDiagnostics.length > 0);
  assert.ok(
    handles.validationDiagnostics.every(
      (d) => d.severity === 'error' && /\/(entry|options\/\d+\/cues)\/\d+\/provenance$/.test(d.path),
    ),
    'first-pass diagnostics are exclusively missing cue provenance',
  );
  const session = host.query({ kind: 'session' });
  const diagnostics = (session.data as { diagnostics: Array<{ code: string }> }).diagnostics;
  assert.ok(diagnostics.some((d) => d.code === LEGACY_PROVENANCE_BACKFILL_CODE));
  await host.stop();
});

// ---------------------------------------------------------------------------
// 2. Option completion through the public path -> reducer + namespaced commit
// ---------------------------------------------------------------------------

test('option completion drives the shared reducer and commits legacy.complete-option with receipts', async () => {
  const { host, handles } = await startLegacy(loadBookstall());
  host.step(2); // completion happens between fixed steps, on the live session

  const receipt = handles.completeOption('read');
  assert.equal(receipt.status, 'committed');
  assert.equal(receipt.name, LEGACY_COMPLETE_OPTION_EVENT);
  assert.equal(typeof receipt.eventId, 'string');
  assert.equal(receipt.tick, host.clock.tick);

  // Reducer state moved read-note -> take-key; world still consistent.
  assert.equal(handles.state().beatId, 'take-key');
  assert.equal(handles.revision(), 1);
  assert.deepEqual(handles.availableOptionIds(), ['take']);
  const afterRead = byName(sceneSnapshot(host), 'object:note')[0];
  assert.equal(afterRead?.visible, true, 'inspecting the note does not collect anything');

  // Commit envelope: namespaced fact with the module-owned payload.
  const commits = host.query({ kind: 'commits' });
  const entries = commits.data as Array<{ name: string; payload: Record<string, unknown>; eventId: string }>;
  assert.equal(entries.length, 1);
  assert.equal(entries[0].name, LEGACY_COMPLETE_OPTION_EVENT);
  assert.deepEqual(entries[0].payload, {
    packageId: 'bookstall-opening',
    beatId: 'read-note',
    optionId: 'read',
    nextBeatId: 'take-key',
    revision: 1,
  });

  // Collect: reducer adds the item, world hides the collected prefab.
  const take = handles.completeOption('take');
  assert.equal(take.status, 'committed');
  assert.deepEqual(handles.state().inventory, ['brass-key']);
  assert.deepEqual(handles.state().collectedItems, ['brass-key']);
  assert.equal(byName(sceneSnapshot(host), 'object:key')[0]?.visible, false, 'collected item hidden by the world update');

  // Unknown option on the current beat rejects without committing.
  const before = (host.query({ kind: 'session' }).data as { commitCount: number }).commitCount;
  let unknownErr: unknown = null;
  try {
    handles.completeOption('read');
  } catch (err) {
    unknownErr = err;
  }
  assert.ok(unknownErr instanceof CreativeError);
  assert.equal((unknownErr as CreativeError).code, 'UNKNOWN_OPTION');
  assert.equal(
    (host.query({ kind: 'session' }).data as { commitCount: number }).commitCount,
    before,
    'rejected completion never commits',
  );

  // Use the key: flag effect flips side-door visibility via visibleWhen.
  handles.completeOption('unlock');
  assert.equal(handles.state().beatId, 'excerpt-end');
  assert.equal(handles.state().flags['door-open'], true);
  assert.equal(handles.state().knownFacts.includes('footsteps'), true);
  assert.equal(byName(sceneSnapshot(host), 'object:side-door')[0]?.visible, false);

  // End beat: confirm-end is a first-class public path too.
  const end = handles.confirmEnd();
  assert.equal(end.status, 'committed');
  assert.equal(end.name, LEGACY_CONFIRM_END_EVENT);
  assert.equal(handles.state().ended, true);
  assert.equal(handles.revision(), 4);

  // Reducer rejections surface with the reducer's own code (ended state).
  let endedErr: unknown = null;
  try {
    handles.confirmEnd();
  } catch (err) {
    endedErr = err;
  }
  assert.ok(endedErr instanceof CreativeError);
  assert.equal((endedErr as CreativeError).code, 'STATE_ENDED');

  await host.stop();
});

// ---------------------------------------------------------------------------
// 3. Destroy: disposeObject path, scope dispose observed, handles fenced
// ---------------------------------------------------------------------------

test('destroy tears the world down through the dispose path and disposes the scope', async () => {
  const { host, handles } = await startLegacy(loadBookstall());
  host.step(1);
  assert.equal(handles.worldDisposed, false);
  assert.equal(handles.scopeDisposed, false);

  await host.stop();
  assert.equal(host.currentStatus, 'stopped');
  assert.equal(handles.worldDisposed, true, 'world disposed via the disposeObject path');
  assert.equal(handles.scopeDisposed, true, 'host scope dispose ran (deferred cleanups executed)');

  // The host fenced everything: queries reject, the instance rejects use.
  const query = host.query({ kind: 'scene' });
  assert.equal(query.ok, false);
  assert.equal(query.error?.code, 'SESSION_STOPPED');
  let afterStop: unknown = null;
  try {
    handles.completeOption('read');
  } catch (err) {
    afterStop = err;
  }
  assert.ok(afterStop instanceof CreativeError);
  assert.equal((afterStop as CreativeError).code, 'INSTANCE_DESTROYED');
});

// ---------------------------------------------------------------------------
// 4. Validation gate: real shared validator diagnostics, strict mode
// ---------------------------------------------------------------------------

test('invalid packages reject with the shared validator\'s own diagnostics (MANIFEST_INVALID)', async () => {
  const fixture = loadBookstall();

  // Semantic corruption: unknown start beat.
  const badStart = { ...fixture, startBeat: 'no-such-beat' };
  const semanticError = await captureStartError(badStart);
  assert.ok(semanticError instanceof LegacyManifestError);
  assert.equal(semanticError.code, 'MANIFEST_INVALID');
  assert.ok(
    semanticError.diagnostics.some((d) => d.code === 'SEMANTIC_UNKNOWN_START_BEAT'),
    'validator diagnostics are exposed verbatim',
  );

  // Structural corruption: scenes emptied (bounds violation).
  const badScenes = { ...fixture, scenes: [] };
  const structuralError = await captureStartError(badScenes);
  assert.ok(structuralError instanceof LegacyManifestError);
  assert.ok(structuralError.diagnostics.some((d) => d.code === 'STRUCTURE_LENGTH'));

  // The corrupted session is in error state, not silently running.
  const host = makeHost();
  let status = '';
  try {
    await host.start(createStoryPackageModule(structuredClone(badStart)));
  } catch {
    status = host.currentStatus;
  }
  assert.equal(status, 'error');
  await host.stop();
});

test('strict mode disables even the declared normalization: the unmodified fixture rejects', async () => {
  // Pins the reality that the old-pipeline fixture is not validator-clean as
  // authored — the declared backfill (default mode) is what keeps it loadable.
  const error = await captureStartError(loadBookstall(), { strict: true });
  assert.ok(error instanceof LegacyManifestError);
  assert.equal(error.code, 'MANIFEST_INVALID');
  assert.ok(error.diagnostics.some((d) => d.code === 'STRUCTURE_REQUIRED' && d.path.endsWith('/provenance')));
});

test('a validator-clean package loads un-normalized and plays through (strict mode)', async () => {
  const { host, handles } = await startLegacy(EXAMPLE_STORY_PACKAGE, { strict: true });
  assert.equal(handles.normalized, false);
  assert.equal(handles.validationDiagnostics.length, 0);
  assert.equal(handles.state().beatId, 'notice-note');

  const nodes = sceneSnapshot(host);
  assert.equal(byName(nodes, 'story-scene:quiet-room').length, 1);
  assert.equal(byName(nodes, 'template-wall').length, 4);
  assert.equal(byName(nodes, 'object:note-object').length, 1);
  assert.equal(byName(nodes, 'object:door-object').length, 1);

  handles.completeOption('read-note');
  handles.completeOption('take-key');
  assert.deepEqual(handles.availableOptionIds().sort(), ['keep-key', 'open-door'], 'choose beat: guard-filtered options');
  handles.completeOption('open-door');
  const end = handles.confirmEnd();
  assert.equal(end.status, 'committed');
  assert.equal(handles.state().ended, true);

  await host.stop();
});

// ---------------------------------------------------------------------------
// 5. Format gate: mixed / unknown formats rejected explicitly
// ---------------------------------------------------------------------------

test('mixed format rejected explicitly: kanshan-experience is not a StoryPackage 1.0', async () => {
  const mixed = { ...loadBookstall(), format: 'kanshan-experience', formatVersion: 1 };
  const error = await captureStartError(mixed);
  assert.ok(error instanceof CreativeError);
  assert.equal((error as CreativeError).code, 'MANIFEST_FORMAT');
  assert.match((error as Error).message, /kanshan-experience/);
  assert.match((error as Error).message, /experience loader/);
});

test('unknown format rejected explicitly', async () => {
  const unknown = { ...loadBookstall(), format: 'mystery-format' };
  const error = await captureStartError(unknown);
  assert.ok(error instanceof CreativeError);
  assert.equal((error as CreativeError).code, 'MANIFEST_FORMAT');
});

// ---------------------------------------------------------------------------
// 6. Save identity: legacy packageDigest slots quarantined from checkpoints
// ---------------------------------------------------------------------------

test('legacy saves keep their own identity rule and never share a slot key with experienceDigest checkpoints', async () => {
  const fixture = loadBookstall();
  const sourceDigest = (fixture.source as { digest: string }).digest;
  assert.match(sourceDigest, /^[a-f0-9]{64}$/);

  // Identity rule: packageDigest ?? source.digest, slot key digest:slot
  // (mirrors the legacy StoryDirector + SaveStore, which stay untouched in
  // src/runtime for the browser entry).
  assert.equal(legacyPackageDigest(fixture), sourceDigest, 'fixture has no build-manifest packageDigest');
  assert.equal(legacySaveSlotKey(fixture), `${sourceDigest}:default`);
  assert.equal(legacySaveSlotKey(fixture, 'slot-b'), `${sourceDigest}:slot-b`);

  // New checkpoints bind experienceDigest:slot — a different canonicalization
  // of different inputs; for the same content the keys never coincide.
  const digest = experienceDigest({
    format: 'kanshan-experience',
    formatVersion: 1,
    runtimeApiVersion: 'creative-1',
    checkpointSchemaVersion: 1,
    code: [{ path: 'src/scene.ts', content: JSON.stringify(fixture) }],
    sourceRecord: { id: 'bookstall-source' },
  });
  const checkpointKey = `${digest}:default`;
  assert.notEqual(legacySaveSlotKey(fixture), checkpointKey);
  assert.notEqual(digest, sourceDigest);

  // Quarantine, for real: a legacy save envelope written at the same key
  // string can never hydrate a CheckpointStore — it is reported corrupt and
  // quarantined, never silently loaded or reset.
  const backend = new MemoryBackend();
  const legacyStoreKey = legacySaveSlotKey(fixture);
  backend.seedRaw(legacyStoreKey, createLegacySaveEnvelope(fixture as never, {
    beatId: 'open-door',
    flags: { 'door-open': false },
    inventory: ['brass-key'],
    collectedItems: [],
    knownFacts: [],
    ended: false,
  }, 3, 'legacy-event-3'));
  const checkpointStore = new CheckpointStore({
    backend,
    experienceDigest: sourceDigest, // deliberately the same digest string
    slot: 'default',
    engineMajor: 1,
    checkpointSchemaVersion: 1,
  });
  assert.equal(checkpointStore.key, legacyStoreKey, 'same address…');
  const outcome = await checkpointStore.load();
  assert.equal(outcome.status, 'corrupt', '…but a legacy envelope never loads as a checkpoint');
  if (outcome.status === 'corrupt') {
    assert.ok(outcome.problems.length > 0);
  }
  assert.equal(checkpointStore.quarantine.length, 1, 'quarantined for reporting, never applied');
  assert.equal(checkpointStore.persistedRevision, 0);
});
