/**
 * engine-cli author commands — tools/lib/author.mjs + author-store.mjs.
 *
 * Covers the G14 author revision store and G17.a cross-process safety:
 *   - author parameters list  : static extraction via the module's exported
 *                               describeParameters() (no gameplay execution),
 *                               manifest params merge, current overlays
 *   - author patch            : validated patch -> params.overrides.json +
 *                               new revision + head advance; idempotent retry;
 *                               stale base -> REVISION_CONFLICT (exit 4)
 *   - author undo/redo        : inverse patches from stored before/after,
 *                               append-only history, freshness conflict
 *   - crashes/concurrency     : atomic writes, corrupt head recovery,
 *                               stale lock breaking, two-process single winner
 *
 * All commands run through the real CLI entry (tools/engine-cli.mjs) via
 * process.execPath. The frozen entry joins only the first two positional
 * words, so the three-word `author parameters list` is passed as ONE quoted
 * argv element. Mutating tests run against disposable experiences under
 * experiences/ (import depth for ../../../src requires it) with the author
 * store redirected to a tmp dir via KANSHAN_AUTHORING_ROOT; the real
 * clockwork-flat is only ever read.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const CLI = join(REPO_ROOT, 'tools', 'engine-cli.mjs');
const EXPERIENCES_DIR = join(REPO_ROOT, 'experiences');
const CLOCKWORK = join(EXPERIENCES_DIR, 'clockwork-flat');

let counter = 0;
function uniqueName(label: string): string {
  counter += 1;
  return `.author-test-${label}-${process.pid}-${counter}-${Math.random().toString(36).slice(2, 8)}`;
}

interface CliResult {
  code: number;
  env: any;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], storeRoot: string): Promise<CliResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: { ...process.env, KANSHAN_AUTHORING_ROOT: storeRoot },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', rejectPromise);
    child.on('close', (code) => {
      let env: any = null;
      try {
        env = JSON.parse(stdout.trim());
      } catch {
        env = null;
      }
      resolvePromise({ code: code ?? -1, env, stdout, stderr });
    });
  });
}

async function makeTmpStore(): Promise<string> {
  return fs.mkdtemp(join(tmpdir(), 'kanshan-author-store-'));
}

async function makeFakeExperience(
  name: string,
  opts: { manifestParams?: unknown; withDescribe?: boolean } = {},
): Promise<string> {
  const dir = join(EXPERIENCES_DIR, name);
  await fs.mkdir(join(dir, 'src'), { recursive: true });
  const manifest: Record<string, unknown> = {
    format: 'kanshan-experience',
    formatVersion: 1,
    entry: 'src/main.ts',
    runtimeApiVersion: 'r1.0',
    checkpointSchemaVersion: 1,
  };
  if (opts.manifestParams !== undefined) manifest.params = opts.manifestParams;
  await fs.writeFile(join(dir, 'experience.json'), JSON.stringify(manifest, null, 2));
  const describe =
    opts.withDescribe === false
      ? ''
      : `
export function describeParameters() {
  return [
    {
      authorId: 'fake.brightness',
      schemaVersion: 1,
      description: '亮度 0..10',
      value: 1,
      validate(value: unknown) {
        return typeof value === 'number' && value >= 0 && value <= 10 ? true : 'brightness must be 0..10';
      },
    },
    { authorId: 'fake.title', schemaVersion: 2, description: '标题文本', value: 'hello' },
  ];
}
`;
  await fs.writeFile(
    join(dir, 'src', 'main.ts'),
    `import { exposeParameters } from '../../../src/creative/scene/authoring.ts';
${describe}
export function create() {
  return { params: exposeParameters((typeof describeParameters === 'function' ? describeParameters() : [])) };
}
`,
  );
  return dir;
}

async function copyClockworkFlat(name: string): Promise<string> {
  const dir = join(EXPERIENCES_DIR, name);
  await fs.mkdir(join(dir, 'src'), { recursive: true });
  for (const file of ['experience.json', join('src', 'scene.ts'), join('src', 'three.ts')]) {
    await fs.copyFile(join(CLOCKWORK, file), join(dir, file));
  }
  return dir;
}

async function storeDirOf(storeRoot: string, experienceDir: string): Promise<string> {
  const list = await runCli(['author parameters list', '--experience', experienceDir], storeRoot);
  assert.equal(list.code, 0, `list should succeed: ${list.stdout}`);
  return join(storeRoot, list.env.data.experienceDigest);
}

async function revisionFiles(storeDir: string): Promise<string[]> {
  const names = await fs.readdir(join(storeDir, 'revisions'));
  return names.filter((n) => n.endsWith('.json'));
}

function diag(result: CliResult): string {
  return result.env?.diagnostics?.[0] ? `${result.env.diagnostics[0].code}: ${result.env.diagnostics[0].message}` : result.stdout;
}

// ---------------------------------------------------------------------------

test('author parameters list: clockwork-flat declared params appear via describeParameters (no gameplay run)', async () => {
  const storeRoot = await makeTmpStore();
  try {
    const result = await runCli(['author parameters list', '--experience', CLOCKWORK], storeRoot);
    assert.equal(result.code, 0, diag(result));
    assert.equal(result.env.ok, true);
    assert.equal(result.env.toolVersion, 'r1.0');
    const data = result.env.data;
    assert.equal(data.kind, 'author.parameters');
    assert.equal(data.source, 'describeParameters');
    assert.equal(data.head, null, 'fresh store has no head');
    assert.match(data.experienceDigest, /^[0-9a-f]{64}$/);
    const byId = new Map<string, any>(data.params.map((p: any): [string, any] => [p.authorId, p]));
    assert.deepEqual(
      [...byId.keys()].sort(),
      ['clockwork.door-seconds', 'clockwork.door-width', 'clockwork.platform-seconds'],
    );
    assert.equal(byId.get('clockwork.door-width').schemaVersion, 1);
    assert.equal(byId.get('clockwork.door-width').currentValue, 1.4);
    assert.equal(byId.get('clockwork.door-seconds').currentValue, 1.2);
    assert.equal(byId.get('clockwork.platform-seconds').currentValue, 3);
    assert.equal(byId.get('clockwork.door-width').overridden, false);
    assert.equal(typeof byId.get('clockwork.door-width').description, 'string');
  } finally {
    await fs.rm(storeRoot, { recursive: true, force: true });
  }
});

test('author patch: happy path writes revision, advances head, writes params.overrides.json', async () => {
  const storeRoot = await makeTmpStore();
  const expDir = await makeFakeExperience(uniqueName('patch'));
  try {
    const result = await runCli(
      ['author patch', '--experience', expDir, '--set', 'fake.brightness=0.5;fake.title="world"', '--command-id', 'cmd-1'],
      storeRoot,
    );
    assert.equal(result.code, 0, diag(result));
    const data = result.env.data;
    assert.equal(data.kind, 'author.revision');
    assert.equal(data.idempotent, false);
    const rev = data.revision;
    assert.match(rev.id, /^rev-/);
    assert.equal(rev.kind, 'patch');
    assert.equal(rev.baseRevisionId, null);
    assert.equal(rev.commandId, 'cmd-1');
    assert.equal(typeof rev.createdAt, 'string');
    assert.deepEqual(rev.changes, {
      'fake.brightness': { before: 1, after: 0.5 },
      'fake.title': { before: 'hello', after: 'world' },
    });
    assert.deepEqual(data.head, rev.id);

    // Store on disk: revision file + head + command log.
    const storeDir = await storeDirOf(storeRoot, expDir);
    const onDisk = JSON.parse(await fs.readFile(join(storeDir, 'revisions', `${rev.id}.json`), 'utf8'));
    assert.equal(onDisk.id, rev.id);
    assert.equal(onDisk.experienceDigest, result.env.experienceDigest);
    assert.equal(await fs.readFile(join(storeDir, 'head'), 'utf8'), `${rev.id}\n`);
    const log = (await fs.readFile(join(storeDir, 'commands.jsonl'), 'utf8')).trim().split('\n');
    assert.equal(log.length, 1);
    assert.equal(JSON.parse(log[0]).commandId, 'cmd-1');

    // Overlay written into the experience dir.
    const overrides = JSON.parse(await fs.readFile(join(expDir, 'params.overrides.json'), 'utf8'));
    assert.deepEqual(overrides, { 'fake.brightness': 0.5, 'fake.title': 'world' });

    // list now reports the overlay as currentValue.
    const listed = await runCli(['author parameters list', '--experience', expDir], storeRoot);
    const byId = new Map<string, any>(listed.env.data.params.map((p: any): [string, any] => [p.authorId, p]));
    assert.equal(byId.get('fake.brightness').currentValue, 0.5);
    assert.equal(byId.get('fake.brightness').overridden, true);
    assert.equal(byId.get('fake.title').currentValue, 'world');
    assert.equal(listed.env.data.head, rev.id);
  } finally {
    await fs.rm(expDir, { recursive: true, force: true });
    await fs.rm(storeRoot, { recursive: true, force: true });
  }
});

test('author patch: unknown authorId and module-rejected value both exit 2', async () => {
  const storeRoot = await makeTmpStore();
  const expDir = await makeFakeExperience(uniqueName('validate'));
  try {
    const unknown = await runCli(
      ['author patch', '--experience', expDir, '--set', 'fake.nope=1', '--command-id', 'bad-id'],
      storeRoot,
    );
    assert.equal(unknown.code, 2, diag(unknown));
    assert.equal(unknown.env.diagnostics[0].code, 'INVALID_AUTHOR_PARAM');

    const badValue = await runCli(
      ['author patch', '--experience', expDir, '--set', 'fake.brightness=99', '--command-id', 'bad-value'],
      storeRoot,
    );
    assert.equal(badValue.code, 2, diag(badValue));
    assert.equal(badValue.env.diagnostics[0].code, 'INVALID_PARAM_VALUE');
    assert.match(badValue.env.diagnostics[0].message, /0\.\.10/);

    // Nothing was written for the failed commands.
    const storeDir = await storeDirOf(storeRoot, expDir);
    assert.deepEqual(await revisionFiles(storeDir), []);
    let overridesMissing = false;
    try {
      await fs.readFile(join(expDir, 'params.overrides.json'), 'utf8');
    } catch {
      overridesMissing = true;
    }
    assert.ok(overridesMissing, 'failed patches must not write params.overrides.json');
  } finally {
    await fs.rm(expDir, { recursive: true, force: true });
    await fs.rm(storeRoot, { recursive: true, force: true });
  }
});

test('author patch: idempotent retry returns the original revision without rewriting', async () => {
  const storeRoot = await makeTmpStore();
  const expDir = await makeFakeExperience(uniqueName('idem'));
  try {
    const args = ['author patch', '--experience', expDir, '--set', 'fake.brightness=0.5', '--command-id', 'cmd-1'];
    const first = await runCli(args, storeRoot);
    assert.equal(first.code, 0, diag(first));
    const storeDir = await storeDirOf(storeRoot, expDir);
    const revisionsBefore = await revisionFiles(storeDir);

    const retry = await runCli(args, storeRoot);
    assert.equal(retry.code, 0, diag(retry));
    assert.equal(retry.env.data.idempotent, true);
    assert.equal(retry.env.data.revision.id, first.env.data.revision.id);
    assert.deepEqual(await revisionFiles(storeDir), revisionsBefore, 'no new revision files');

    // Same commandId with a different body is a conflict, not a silent no-op.
    const different = await runCli(
      ['author patch', '--experience', expDir, '--set', 'fake.brightness=0.6', '--command-id', 'cmd-1'],
      storeRoot,
    );
    assert.equal(different.code, 4, diag(different));
    assert.equal(different.env.diagnostics[0].code, 'COMMAND_CONFLICT');
  } finally {
    await fs.rm(expDir, { recursive: true, force: true });
    await fs.rm(storeRoot, { recursive: true, force: true });
  }
});

test('author patch: stale baseRevision is rejected (exit 4), retry on current head succeeds', async () => {
  const storeRoot = await makeTmpStore();
  const expDir = await makeFakeExperience(uniqueName('stale'));
  try {
    const first = await runCli(
      ['author patch', '--experience', expDir, '--set', 'fake.brightness=0.5', '--command-id', 'cmd-1'],
      storeRoot,
    );
    assert.equal(first.code, 0, diag(first));

    // Someone still basing on the pre-history state must lose.
    const stale = await runCli(
      ['author patch', '--experience', expDir, '--set', 'fake.brightness=0.6', '--command-id', 'cmd-2'],
      storeRoot,
    );
    assert.equal(stale.code, 4, diag(stale));
    assert.equal(stale.env.diagnostics[0].code, 'REVISION_CONFLICT');

    // Basing on the actual head works and chains the history.
    const head = first.env.data.head;
    const chained = await runCli(
      ['author patch', '--experience', expDir, '--set', 'fake.brightness=0.7', '--base-revision', head, '--command-id', 'cmd-3'],
      storeRoot,
    );
    assert.equal(chained.code, 0, diag(chained));
    assert.equal(chained.env.data.revision.baseRevisionId, head);
    const overrides = JSON.parse(await fs.readFile(join(expDir, 'params.overrides.json'), 'utf8'));
    assert.deepEqual(overrides, { 'fake.brightness': 0.7 });
  } finally {
    await fs.rm(expDir, { recursive: true, force: true });
    await fs.rm(storeRoot, { recursive: true, force: true });
  }
});

test('author undo/redo: round-trip restores values, each step is a new command', async () => {
  const storeRoot = await makeTmpStore();
  const expDir = await makeFakeExperience(uniqueName('undo'));
  try {
    const patched = await runCli(
      ['author patch', '--experience', expDir, '--set', 'fake.brightness=0.5;fake.title="world"', '--command-id', 'cmd-1'],
      storeRoot,
    );
    assert.equal(patched.code, 0, diag(patched));
    const patchRev = patched.env.data.revision;

    const undone = await runCli(['author undo', '--experience', expDir, '--command-id', 'cmd-2'], storeRoot);
    assert.equal(undone.code, 0, diag(undone));
    const undoRev = undone.env.data.revision;
    assert.equal(undoRev.kind, 'undo');
    assert.equal(undoRev.undoOf, patchRev.id);
    assert.equal(undoRev.baseRevisionId, patchRev.id);
    assert.deepEqual(undoRev.changes, {
      'fake.brightness': { before: 0.5, after: 1 },
      'fake.title': { before: 'world', after: 'hello' },
    });
    assert.deepEqual(JSON.parse(await fs.readFile(join(expDir, 'params.overrides.json'), 'utf8')), {});

    // Undoing an undo is a conflict-family state, not a silent revert of the revert.
    const undoAgain = await runCli(['author undo', '--experience', expDir, '--command-id', 'cmd-2b'], storeRoot);
    assert.equal(undoAgain.code, 4, diag(undoAgain));
    assert.equal(undoAgain.env.diagnostics[0].code, 'REVISION_NOTHING_TO_UNDO');

    const redone = await runCli(['author redo', '--experience', expDir, '--command-id', 'cmd-3'], storeRoot);
    assert.equal(redone.code, 0, diag(redone));
    const redoRev = redone.env.data.revision;
    assert.equal(redoRev.kind, 'redo');
    assert.equal(redoRev.redoOf, patchRev.id);
    assert.equal(redoRev.baseRevisionId, undoRev.id);
    assert.deepEqual(redoRev.changes, patchRev.changes);
    assert.deepEqual(JSON.parse(await fs.readFile(join(expDir, 'params.overrides.json'), 'utf8')), {
      'fake.brightness': 0.5,
      'fake.title': 'world',
    });

    // Redoing while head is a redo: nothing to redo.
    const redoAgain = await runCli(['author redo', '--experience', expDir, '--command-id', 'cmd-3b'], storeRoot);
    assert.equal(redoAgain.code, 4, diag(redoAgain));
    assert.equal(redoAgain.env.diagnostics[0].code, 'REVISION_NOTHING_TO_REDO');

    // History is append-only: three revision files (patch, undo, redo); the
    // failed undo-again / redo-attempt commands wrote nothing. Head is the redo.
    const storeDir = await storeDirOf(storeRoot, expDir);
    assert.equal((await revisionFiles(storeDir)).length, 3);
    assert.equal(await fs.readFile(join(storeDir, 'head'), 'utf8'), `${redoRev.id}\n`);
  } finally {
    await fs.rm(expDir, { recursive: true, force: true });
    await fs.rm(storeRoot, { recursive: true, force: true });
  }
});

test('author undo: refuses to overwrite a value changed outside the history (exit 4, file untouched)', async () => {
  const storeRoot = await makeTmpStore();
  const expDir = await makeFakeExperience(uniqueName('conflict'));
  try {
    const patched = await runCli(
      ['author patch', '--experience', expDir, '--set', 'fake.brightness=0.5', '--command-id', 'cmd-1'],
      storeRoot,
    );
    assert.equal(patched.code, 0, diag(patched));

    // Another tool/process edits the overlay directly, bypassing history.
    const overridesPath = join(expDir, 'params.overrides.json');
    await fs.writeFile(overridesPath, JSON.stringify({ 'fake.brightness': 0.99 }, null, 2) + '\n');

    const undone = await runCli(['author undo', '--experience', expDir, '--command-id', 'cmd-2'], storeRoot);
    assert.equal(undone.code, 4, diag(undone));
    assert.equal(undone.env.diagnostics[0].code, 'REVISION_CONFLICT');
    assert.match(undone.env.diagnostics[0].message, /changed outside the revision log/);

    const after = await fs.readFile(overridesPath, 'utf8');
    assert.equal(after, JSON.stringify({ 'fake.brightness': 0.99 }, null, 2) + '\n', 'overlay never overwritten');
  } finally {
    await fs.rm(expDir, { recursive: true, force: true });
    await fs.rm(storeRoot, { recursive: true, force: true });
  }
});

test('cross-process race on one head: exactly one winner, the loser gets REVISION_CONFLICT', async () => {
  const storeRoot = await makeTmpStore();
  const expDir = await copyClockworkFlat(uniqueName('race'));
  try {
    const runA = runCli(
      ['author patch', '--experience', expDir, '--set', 'clockwork.door-width=1.6', '--command-id', 'race-a'],
      storeRoot,
    );
    const runB = runCli(
      ['author patch', '--experience', expDir, '--set', 'clockwork.door-seconds=2.0', '--command-id', 'race-b'],
      storeRoot,
    );
    const [a, b] = await Promise.all([runA, runB]);
    const outcomes = [a, b].map((r) => ({ code: r.code, command: r.env?.data?.revision?.commandId ?? r.env?.diagnostics?.[0]?.code }));
    const winners = outcomes.filter((o) => o.code === 0);
    const losers = outcomes.filter((o) => o.code === 4);
    assert.equal(winners.length, 1, `exactly one winner: ${JSON.stringify(outcomes)}`);
    assert.equal(losers.length, 1, `exactly one loser: ${JSON.stringify(outcomes)}`);
    assert.ok(losers[0].command === 'REVISION_CONFLICT', `loser diagnostic: ${JSON.stringify(losers[0])}`);

    // The store stayed linear: one revision, head is the winner, log has one line.
    const storeDir = await storeDirOf(storeRoot, expDir);
    const revisions = await revisionFiles(storeDir);
    assert.equal(revisions.length, 1);
    const head = (await fs.readFile(join(storeDir, 'head'), 'utf8')).trim();
    assert.equal(head, revisions[0].replace(/\.json$/, ''));
    const winnerRecord = JSON.parse(await fs.readFile(join(storeDir, 'revisions', revisions[0]), 'utf8'));
    assert.equal(winnerRecord.commandId, winners[0].command);
    const logLines = (await fs.readFile(join(storeDir, 'commands.jsonl'), 'utf8')).trim().split('\n');
    assert.equal(logLines.length, 1);

    // A follow-up command from either side of the race chains on the winner.
    const followUp = await runCli(
      ['author patch', '--experience', expDir, '--set', 'clockwork.platform-seconds=4', '--base-revision', head, '--command-id', 'race-followup'],
      storeRoot,
    );
    assert.equal(followUp.code, 0, diag(followUp));
    assert.equal(followUp.env.data.revision.baseRevisionId, head);
  } finally {
    await fs.rm(expDir, { recursive: true, force: true });
    await fs.rm(storeRoot, { recursive: true, force: true });
  }
});

test('corrupted head: unique tip recovered honestly; ambiguous store reported (exit 5), never guessed', async () => {
  const storeRoot = await makeTmpStore();
  const expDir = await makeFakeExperience(uniqueName('recover'));
  try {
    const first = await runCli(
      ['author patch', '--experience', expDir, '--set', 'fake.brightness=0.5', '--command-id', 'cmd-1'],
      storeRoot,
    );
    assert.equal(first.code, 0, diag(first));
    const rev1 = first.env.data.revision.id;
    const storeDir = await storeDirOf(storeRoot, expDir);

    // Simulate a crash mid-head-write: truncated head content.
    await fs.writeFile(join(storeDir, 'head'), rev1.slice(0, 10));
    const second = await runCli(
      ['author patch', '--experience', expDir, '--set', 'fake.brightness=0.6', '--base-revision', rev1, '--command-id', 'cmd-2'],
      storeRoot,
    );
    assert.equal(second.code, 0, diag(second));
    const recovered = second.env.diagnostics.some((d: any) => d.code === 'HEAD_RECOVERED');
    assert.ok(recovered, `expected HEAD_RECOVERED diagnostic: ${second.stdout}`);
    assert.equal(second.env.data.revision.baseRevisionId, rev1);
    const headNow = await fs.readFile(join(storeDir, 'head'), 'utf8');
    assert.equal(headNow, `${second.env.data.revision.id}\n`, 'head rewritten to the new tip');

    // Ambiguous recovery: corrupt head + a second root revision (crash orphan).
    await fs.writeFile(
      join(storeDir, 'revisions', 'rev-orphan000000-deadbeef.json'),
      JSON.stringify({
        id: 'rev-orphan000000-deadbeef',
        kind: 'patch',
        baseRevisionId: null,
        commandId: 'crash-orphan',
        createdAt: new Date().toISOString(),
        experienceDigest: first.env.experienceDigest,
        changes: {},
        params: {},
      }),
    );
    await fs.writeFile(join(storeDir, 'head'), 'garbage-not-a-revision');
    const third = await runCli(
      ['author patch', '--experience', expDir, '--set', 'fake.brightness=0.7', '--base-revision', second.env.data.revision.id, '--command-id', 'cmd-3'],
      storeRoot,
    );
    assert.equal(third.code, 5, diag(third));
    assert.equal(third.env.diagnostics[0].code, 'HEAD_CORRUPT_UNRECOVERABLE');
  } finally {
    await fs.rm(expDir, { recursive: true, force: true });
    await fs.rm(storeRoot, { recursive: true, force: true });
  }
});

test('crash leftovers: stale lock broken, partial files ignored, head intact', async () => {
  const storeRoot = await makeTmpStore();
  const expDir = await makeFakeExperience(uniqueName('crash'));
  try {
    const first = await runCli(
      ['author patch', '--experience', expDir, '--set', 'fake.brightness=0.5', '--command-id', 'cmd-1'],
      storeRoot,
    );
    assert.equal(first.code, 0, diag(first));
    const storeDir = await storeDirOf(storeRoot, expDir);

    // A crashed holder leaks head.lock — backdate it so it reads as stale.
    const lockPath = join(storeDir, 'head.lock');
    await fs.writeFile(lockPath, JSON.stringify({ pid: 999999, acquiredAt: '2026-01-01T00:00:00Z' }));
    const past = new Date(Date.now() - 120_000);
    await fs.utimes(lockPath, past, past);

    // Leftover temp files + a truncated revision file from interrupted writes.
    await fs.writeFile(join(storeDir, 'head.tmp-424242-deadbeef'), revGarbage());
    await fs.writeFile(join(storeDir, 'revisions', 'rev-partial.json'), '{"id":"rev-partial","kind":"pa');

    const second = await runCli(
      ['author patch', '--experience', expDir, '--set', 'fake.brightness=0.6', '--base-revision', first.env.data.revision.id, '--command-id', 'cmd-2'],
      storeRoot,
    );
    assert.equal(second.code, 0, diag(second));
    assert.equal(second.env.data.revision.baseRevisionId, first.env.data.revision.id);
    assert.equal(await fs.readFile(join(storeDir, 'head'), 'utf8'), `${second.env.data.revision.id}\n`);
    // The two real revisions are the history; the truncated crash leftover is
    // still on disk but was never mistaken for a revision.
    const onDisk = (await revisionFiles(storeDir)).sort();
    assert.deepEqual(onDisk, ['rev-partial.json', ...[first.env.data.revision.id, second.env.data.revision.id].map((r: string) => `${r}.json`)].sort());
    const partialIgnored = await fs.readFile(join(storeDir, 'revisions', 'rev-partial.json'), 'utf8');
    assert.match(partialIgnored, /^\{"id":"rev-partial","kind":"pa$/, 'crash artifact left exactly as written');
  } finally {
    await fs.rm(expDir, { recursive: true, force: true });
    await fs.rm(storeRoot, { recursive: true, force: true });
  }

  function revGarbage(): string {
    return '{"head":"garbage-but-atomic-writes-never-leave-this-behind"}';
  }
});

test('manifest params merge with describeParameters; manifest-only ids are patchable', async () => {
  const storeRoot = await makeTmpStore();
  const expDir = await makeFakeExperience(uniqueName('manifest'), {
    manifestParams: {
      'fake.manifest-only': { schemaVersion: 3, value: 7, description: '仅 manifest 声明' },
      'fake.brightness': 0.25, // overridden by describeParameters for the same id
    },
  });
  try {
    const listed = await runCli(['author parameters list', '--experience', expDir], storeRoot);
    assert.equal(listed.code, 0, diag(listed));
    assert.equal(listed.env.data.source, 'describeParameters+manifest');
    const byId = new Map<string, any>(listed.env.data.params.map((p: any): [string, any] => [p.authorId, p]));
    assert.deepEqual([...byId.keys()].sort(), ['fake.brightness', 'fake.manifest-only', 'fake.title']);
    assert.equal(byId.get('fake.manifest-only').schemaVersion, 3);
    assert.equal(byId.get('fake.manifest-only').currentValue, 7);
    assert.equal(byId.get('fake.brightness').declaredBy, 'describeParameters');
    assert.equal(byId.get('fake.brightness').currentValue, 1, 'module declaration wins');

    // manifest-only id has no validate fn: any JSON value is accepted.
    const patched = await runCli(
      ['author patch', '--experience', expDir, '--set', 'fake.manifest-only=8;fake.brightness=0.5', '--command-id', 'cmd-1'],
      storeRoot,
    );
    assert.equal(patched.code, 0, diag(patched));
    assert.deepEqual(JSON.parse(await fs.readFile(join(expDir, 'params.overrides.json'), 'utf8')), {
      'fake.manifest-only': 8,
      'fake.brightness': 0.5,
    });
  } finally {
    await fs.rm(expDir, { recursive: true, force: true });
    await fs.rm(storeRoot, { recursive: true, force: true });
  }
});

test('missing experience exits 3; module without describeParameters falls back to manifest params', async () => {
  const storeRoot = await makeTmpStore();
  try {
    const missing = await runCli(['author parameters list', '--experience', join(EXPERIENCES_DIR, 'does-not-exist')], storeRoot);
    assert.equal(missing.code, 3, diag(missing));
    assert.equal(missing.env.diagnostics[0].code, 'MISSING_EXPERIENCE');
  } finally {
    await fs.rm(storeRoot, { recursive: true, force: true });
  }

  const storeRoot2 = await makeTmpStore();
  const expDir = await makeFakeExperience(uniqueName('manifest-only'), {
    manifestParams: { 'fake.m1': { schemaVersion: 1, value: 'a', description: 'manifest only' } },
    withDescribe: false,
  });
  try {
    const listed = await runCli(['author parameters list', '--experience', expDir], storeRoot2);
    assert.equal(listed.code, 0, diag(listed));
    assert.equal(listed.env.data.source, 'manifest');
    assert.deepEqual(
      listed.env.data.params.map((p: any) => p.authorId),
      ['fake.m1'],
    );
    const patched = await runCli(['author patch', '--experience', expDir, '--set', 'fake.m1="b"', '--command-id', 'cmd-1'], storeRoot2);
    assert.equal(patched.code, 0, diag(patched));
  } finally {
    await fs.rm(expDir, { recursive: true, force: true });
    await fs.rm(storeRoot2, { recursive: true, force: true });
  }
});
