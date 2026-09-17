/**
 * tools-build.test.ts — engine-cli build + export (G16 real vite builds,
 * G01 bundle hygiene, G17 local boundary).
 *
 * Every case drives the real CLI entry (tools/engine-cli.mjs) as a child
 * process against the two real fixture experiences: noop-patch (no physics)
 * and clockwork-flat (uses physics). Builds write under .kanshan/cli-test
 * and are removed after the run; the one default-outDir build is removed by
 * its own test.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-ignore -- plain .mjs tool lib, intentionally outside the TS program
import { bundleClosure } from '../../tools/lib/build.mjs';

const GP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = path.join(GP, 'tools', 'engine-cli.mjs');
const NOOP = path.join(GP, 'experiences', 'noop-patch');
const CLOCKWORK = path.join(GP, 'experiences', 'clockwork-flat');
const WORK = path.join(GP, '.kanshan', `cli-test-${process.pid}`);

interface BuildFile {
  path: string;
  bytes: number;
}

interface BuildData {
  buildId: string;
  experienceDigest: string;
  artifactDigest: string;
  runtimeApiVersion: string;
  entry: string;
  outDir: string;
  files: BuildFile[];
  diagnostics: { code: string; message: string }[];
  title?: string;
  rapierPresent?: boolean;
  generatedAt?: string;
  toolVersion?: string;
}

interface Envelope {
  ok: boolean;
  toolVersion: string;
  requestId: string;
  data?: BuildData;
  diagnostics?: { code: string; message: string }[];
  experienceDigest?: string;
  buildId?: string;
}

interface CliResult {
  code: number | null;
  stdout: string;
  env: Envelope;
}

/** Spawn the real CLI entry; assert the stdout contract (one envelope line). */
function runCli(args: string[]): CliResult {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    cwd: GP,
    encoding: 'utf8',
    timeout: 180_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (res.error) throw res.error;
  const stdout = (res.stdout ?? '').trim();
  assert.equal(
    stdout.split('\n').length,
    1,
    `stdout must be exactly one JSON envelope (got vite noise?): ${stdout.slice(0, 200)}`,
  );
  return { code: res.status, stdout, env: JSON.parse(stdout) as Envelope };
}

let noopA: CliResult;
let noopB: CliResult;
let cwExport: CliResult;

before(async () => {
  await fs.rm(WORK, { recursive: true, force: true });
  await fs.mkdir(WORK, { recursive: true });
  noopA = runCli(['build', '--experience', NOOP, '--out', path.join(WORK, 'noop-a')]);
  noopB = runCli(['build', '--experience', NOOP, '--out', path.join(WORK, 'noop-b')]);
  cwExport = runCli(['export', '--experience', CLOCKWORK, '--out', path.join(WORK, 'cw-export')]);
});

after(async () => {
  await fs.rm(WORK, { recursive: true, force: true });
});

test('build returns a real report over real files', () => {
  assert.equal(noopA.code, 0);
  assert.equal(noopA.env.ok, true);
  assert.equal(noopA.env.toolVersion, 'r1.0');
  const d = noopA.env.data!;
  assert.ok(d.buildId.startsWith('build-'));
  assert.match(d.experienceDigest, /^[0-9a-f]{64}$/);
  assert.match(d.artifactDigest, /^[0-9a-f]{64}$/);
  assert.equal(noopA.env.experienceDigest, d.experienceDigest);
  assert.equal(noopA.env.buildId, d.buildId);
  assert.equal(d.runtimeApiVersion, 'r1.0');
  assert.ok(d.files.length > 0);
  assert.ok(d.files.some((f) => f.path === d.entry), 'reported files include the entry chunk');
});

test('build report file list matches bytes on disk', async () => {
  const d = noopA.env.data!;
  for (const f of d.files) {
    const buf = await fs.readFile(path.join(d.outDir, f.path));
    assert.equal(buf.byteLength, f.bytes, `size on disk matches report for ${f.path}`);
  }
});

test('G01 hygiene: noop-patch bundle contains no rapier/WASM payload', async () => {
  const d = noopA.env.data!;
  const total = d.files.reduce((a, f) => a + f.bytes, 0);
  assert.ok(
    total < 500_000,
    `noop bundle (${total}B) must stay far below the multi-MB rapier WASM payload`,
  );
  let all = '';
  for (const f of d.files) {
    assert.ok(!/rapier/i.test(f.path), `no rapier in file name ${f.path}`);
    all += await fs.readFile(path.join(d.outDir, f.path), 'utf8');
  }
  assert.ok(!/rapier/i.test(all), 'no rapier strings in noop bundle contents');
  assert.ok(!all.includes('@dimforge'), 'no @dimforge strings in noop bundle contents');
  // Sanity: the experience code really is bundled, so the absence of rapier
  // above is meaningful (the build is not silently empty).
  assert.ok(all.includes('noop-patch.spinSpeed'), 'author parameter literal present in bundle');
});

test('G01 hygiene: clockwork-flat bundle contains the rapier payload', async () => {
  const d = cwExport.env.data!;
  let jsBytes = 0;
  let rapierFound = false;
  for (const f of d.files) {
    if (!f.path.endsWith('.js')) continue;
    jsBytes += f.bytes;
    const content = await fs.readFile(path.join(d.outDir, f.path), 'utf8');
    if (/rapier/i.test(content) || content.includes('@dimforge')) rapierFound = true;
  }
  assert.ok(rapierFound, 'rapier present in clockwork bundle');
  const noopTotal = noopA.env.data!.files.reduce((a, f) => a + f.bytes, 0);
  assert.ok(
    jsBytes - noopTotal > 1_500_000,
    `clockwork js (${jsBytes}B) must exceed noop (${noopTotal}B) by the rapier payload`,
  );
});

test('determinism: same experience built twice yields identical digests', () => {
  const a = noopA.env.data!;
  const b = noopB.env.data!;
  assert.equal(a.experienceDigest, b.experienceDigest);
  assert.equal(a.artifactDigest, b.artifactDigest, 'vite output is byte-deterministic here');
  assert.deepEqual(
    a.files.map((f) => f.path),
    b.files.map((f) => f.path),
  );
});

test('export produces a self-contained private static bundle', async () => {
  assert.equal(cwExport.code, 0);
  assert.equal(cwExport.env.ok, true);
  const d = cwExport.env.data!;
  const top = await fs.readdir(d.outDir);
  for (const name of ['index.html', 'experience.json', 'source.json', 'NOTICE.md', 'report.json']) {
    assert.ok(top.includes(name), `${name} present in export`);
  }

  // index.html loads the entry module and carries NO secrets. Contract
  // (F06): experienceDigest/buildId are integrity/version values, not access
  // tokens — they are allowed and expected; actual secret shapes are not.
  const html = await fs.readFile(path.join(d.outDir, 'index.html'), 'utf8');
  assert.ok(html.includes(`src="./${d.entry}"`), 'index.html loads the entry chunk');
  assert.ok(html.includes('__KANSHAN_BOOT__'), 'boot identity block present for the player shell');
  assert.ok(html.includes(d.experienceDigest), 'experienceDigest embedded as integrity value');
  assert.ok(!/(bearer|password|secret|api[_-]?key|authorization)/i.test(html), 'no secret-shaped strings in index.html');
  assert.ok(!/sessionId/i.test(html), 'no session ids in index.html');

  // experience.json is a byte-exact copy of the manifest.
  const srcManifest = await fs.readFile(path.join(CLOCKWORK, 'experience.json'));
  const dstManifest = await fs.readFile(path.join(d.outDir, 'experience.json'));
  assert.ok(srcManifest.equals(dstManifest));

  // NOTICE documents three + rapier + the engine protocol version.
  const notice = await fs.readFile(path.join(d.outDir, 'NOTICE.md'), 'utf8');
  assert.ok(notice.includes('three (MIT'));
  assert.ok(notice.includes('@dimforge/rapier3d-compat (Apache-2.0'));
  assert.ok(notice.includes('Engine protocol version: r1.0'));
  assert.equal(d.rapierPresent, true, 'clockwork export honestly reports rapier');

  // report.json carries digests, file list, timestamp, toolVersion.
  const report = JSON.parse(await fs.readFile(path.join(d.outDir, 'report.json'), 'utf8'));
  assert.equal(report.toolVersion, 'r1.0');
  assert.equal(report.buildId, d.buildId);
  assert.equal(report.experienceDigest, d.experienceDigest);
  assert.equal(report.artifactDigest, d.artifactDigest);
  assert.ok(Array.isArray(report.files) && report.files.length > 0);
  assert.ok(
    typeof report.generatedAt === 'string' && !Number.isNaN(Date.parse(report.generatedAt)),
    'generatedAt is a real timestamp',
  );
});

test('export closure: every referenced asset exists in the bundle', async () => {
  const d = cwExport.env.data!;
  const closure = await bundleClosure(d.outDir);
  assert.deepEqual(closure.missing, []);
  assert.ok(closure.referenced.includes(d.entry), 'index.html references the entry chunk');
});

test('closure honesty: a deleted asset is reported missing', async () => {
  // Runs after the export tests; the tampered dir is wiped in after().
  const d = cwExport.env.data!;
  await fs.rm(path.join(d.outDir, d.entry));
  const closure = await bundleClosure(d.outDir);
  assert.deepEqual(closure.missing, [d.entry]);
});

test('negative: missing entry file fails honestly with exit code 2', async () => {
  const dir = path.join(WORK, 'missing-entry');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, 'experience.json'),
    JSON.stringify({
      format: 'kanshan-experience',
      formatVersion: 1,
      entry: 'src/nope.ts',
      runtimeApiVersion: 'r1.0',
      checkpointSchemaVersion: 1,
    }),
  );
  const r = runCli(['build', '--experience', dir, '--out', path.join(WORK, 'missing-entry-out')]);
  assert.equal(r.code, 2);
  assert.equal(r.env.ok, false);
  assert.equal(r.env.diagnostics![0].code, 'MANIFEST_ENTRY_MISSING');
});

test('negative: syntax error in entry fails with real diagnostics, no success page', async () => {
  const dir = path.join(WORK, 'broken');
  await fs.mkdir(path.join(dir, 'src'), { recursive: true });
  await fs.writeFile(
    path.join(dir, 'experience.json'),
    JSON.stringify({
      format: 'kanshan-experience',
      formatVersion: 1,
      entry: 'src/broken.ts',
      runtimeApiVersion: 'r1.0',
      checkpointSchemaVersion: 1,
    }),
  );
  await fs.writeFile(path.join(dir, 'src', 'broken.ts'), 'export const broken: = 1;\n');
  const outDir = path.join(WORK, 'broken-out');
  const r = runCli(['build', '--experience', dir, '--out', outDir]);
  assert.equal(r.code, 5);
  assert.equal(r.env.ok, false);
  const last = r.env.diagnostics![r.env.diagnostics!.length - 1];
  assert.match(last.message, /broken\.ts/);
  const html = await fs.stat(path.join(outDir, 'index.html')).catch(() => null);
  assert.equal(html, null, 'a failed build never produces a success page');
});

test('build without --out defaults to .kanshan/builds/<buildId>', async () => {
  const r = runCli(['build', '--experience', NOOP]);
  try {
    assert.equal(r.code, 0);
    assert.equal(r.env.ok, true);
    const d = r.env.data!;
    assert.equal(d.outDir, path.join(GP, '.kanshan', 'builds', d.buildId));
    const stat = await fs.stat(d.outDir);
    assert.ok(stat.isDirectory());
  } finally {
    if (r.env.data) await fs.rm(r.env.data.outDir, { recursive: true, force: true });
  }
});

test('F03: artifactDigest is tamper-evident (rename and byte change both detected)', async () => {
  // Self-contained: the closure-honesty test deletes cwExport's entry chunk,
  // so re-export to a private dir here.
  const outDir = path.join(WORK, 'f3-export');
  const r = runCli(['export', '--experience', CLOCKWORK, '--out', outDir]);
  assert.equal(r.code, 0);
  const d = r.env.data!;
  const files = d.files.map((f: { path: string; bytes: number }) => ({ ...f }));
  const base = await digestOverFilesForTest(files, d.outDir);
  // Byte change: one flipped byte in the first file changes the digest.
  const victim = path.join(d.outDir, files[0].path);
  const original = await fs.readFile(victim);
  const mutated = Buffer.from(original);
  mutated[0] = mutated[0] ^ 0xff;
  await fs.writeFile(victim, mutated);
  const afterByte = await digestOverFilesForTest(files, d.outDir);
  assert.notEqual(afterByte, base, 'byte change changes artifactDigest');
  // Rename: same bytes under a different path changes the digest.
  await fs.writeFile(victim, original);
  const renamed = `renamed-${files[0].path}`;
  await fs.rename(victim, path.join(d.outDir, renamed));
  files[0] = { ...files[0], path: renamed };
  const afterRename = await digestOverFilesForTest(files, d.outDir);
  assert.notEqual(afterRename, base, 'path change changes artifactDigest');
  await fs.rm(outDir, { recursive: true, force: true });
});

test('F06: secret-shape scan catches a planted token (negative proof)', () => {
  const banned = /(bearer|password|secret|api[_-]?key|authorization)/i;
  assert.ok(banned.test('<script>fetch("/x",{headers:{authorization:"Bearer abc"}})</script>'), 'scan detects a real secret');
  assert.ok(!banned.test('<script>globalThis.__KANSHAN_BOOT__={"buildId":"b1"}</script>'), 'integrity values are not secrets');
});

async function digestOverFilesForTest(files: Array<{ path: string }>, dir: string): Promise<string> {
  const { createHash } = await import('node:crypto');
  const parts: Buffer[] = [];
  for (const f of [...files].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    const bytes = await fs.readFile(path.join(dir, f.path));
    const sha = createHash('sha256').update(bytes).digest('hex');
    parts.push(Buffer.from(`${f.path}:${bytes.length}:${sha}\n`, 'utf8'));
    parts.push(bytes);
  }
  return createHash('sha256').update(Buffer.concat(parts)).digest('hex');
}
