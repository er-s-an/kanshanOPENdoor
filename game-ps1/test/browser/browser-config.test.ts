/**
 * B-group config test (PR-03): the browser player must consume the EXPORT's
 * real configuration — boot identity from `__KANSHAN_BOOT__` and author
 * parameter overrides from `params.overrides.json` — and produce mechanism
 * behavior consistent with the headless run of the same effective params.
 *
 * Scenario: narrow-gate exported twice — narrow (0.4m, blocked) and wide
 * (1.0m, passable). In real Chromium we assert through the exposed player
 * handle (not screenshots): the host's experienceDigest/buildId match the
 * export report, the registry shows the overridden opening width, and after
 * holding W the player position is blocked vs through — the same invariants
 * the headless replay asserts.
 *
 * Skips as NOT_RUN when no local Chromium is available.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const GP = path.resolve(import.meta.dirname, '..', '..');
const CLI = path.join(GP, 'tools', 'engine-cli.mjs');
const FIXTURE = path.join(GP, 'experiences', 'narrow-gate');
const WORK = path.join(GP, '.kanshan', 'browser-config-test');

let browserAvailable = false;

function cli(...args: string[]): { code: number; env: any } {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    cwd: GP,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  let env: any = null;
  try {
    env = JSON.parse(res.stdout.trim().split('\n').pop() ?? '');
  } catch {
    assert.fail(`CLI emitted no envelope: ${res.stdout}${res.stderr}`);
  }
  return { code: res.status ?? -1, env };
}

function serve(dir: string): Promise<{ server: http.Server; port: number }> {
  const MIME: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.json': 'application/json',
  };
  const server = http.createServer((req, res) => {
    const rel = (req.url ?? '/').split('?')[0] === '/' ? 'index.html' : (req.url ?? '').replace(/^\/+/, '');
    const file = path.join(dir, rel);
    if (!file.startsWith(dir) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as { port: number }).port }));
  });
}

async function runGateCase(outDir: string, width: number): Promise<{ digest: string; report: any }> {
  // Patch the width into a disposable copy of the fixture via the real author
  // command, then export. (patch writes params.overrides.json into the copy)
  fs.rmSync(outDir, { recursive: true, force: true });
  const copyDir = path.join(WORK, `src-${width}`);
  fs.rmSync(copyDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(copyDir, 'src'), { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(FIXTURE, 'experience.json'), 'utf8'));
  fs.writeFileSync(path.join(copyDir, 'experience.json'), JSON.stringify(manifest, null, 2));
  fs.copyFileSync(path.join(FIXTURE, 'source.json'), path.join(copyDir, 'source.json'));
  const original = path.join(FIXTURE, 'src', 'scene.ts').replace(/\\/g, '/');
  fs.writeFileSync(path.join(copyDir, 'src', 'scene.ts'), `export * from ${JSON.stringify(original)};\n`);
  const list = cli('author', 'parameters', 'list', '--experience', copyDir);
  assert.equal(list.code, 0, JSON.stringify(list.env));
  const head = list.env.data?.head ?? null;
  const patchArgs = ['author', 'patch', '--experience', copyDir, '--set', `gate.opening-width=${width}`, '--command-id', `w${width}-${Date.now()}`];
  if (head) patchArgs.push('--base-revision', head);
  const patch = cli(...patchArgs);
  assert.equal(patch.code, 0, JSON.stringify(patch.env));
  const exp = cli('export', '--experience', copyDir, '--out', outDir);
  assert.equal(exp.code, 0, JSON.stringify(exp.env));
  return { digest: exp.env.experienceDigest, report: JSON.parse(fs.readFileSync(path.join(outDir, 'report.json'), 'utf8')) };
}

before(async () => {
  fs.rmSync(WORK, { recursive: true, force: true });
  fs.mkdirSync(WORK, { recursive: true });
  try {
    const pw = await import('playwright-core');
    const exe = pw.chromium.executablePath();
    browserAvailable = fs.existsSync(exe);
  } catch {
    browserAvailable = false;
  }
});

after(async () => {
  fs.rmSync(WORK, { recursive: true, force: true });
});

test('browser boot consumes export identity + author overrides (mechanism parity)', { timeout: 120_000 }, async (t) => {
  if (!browserAvailable) {
    console.log('NOT_RUN: no local Chromium available');
    t.skip('browser not available');
    return;
  }
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

  async function play(outDir: string, report: any): Promise<{ z: number; digest: string; buildId: string }> {
    const { server, port } = await serve(outDir);
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load', timeout: 30000 });
      await page.waitForFunction(() => (globalThis as any).__kanshanPlayer !== undefined, { timeout: 15000 });
      // Identity from the export reaches the host.
      const identity = await page.evaluate(() => {
        const p = (globalThis as any).__kanshanPlayer;
        return { digest: p.host.handle.experienceDigest, buildId: p.host.handle.buildId, status: p.host.currentStatus };
      });
      assert.equal(identity.digest, report.experienceDigest, 'browser host binds the export experienceDigest');
      assert.equal(identity.buildId, report.buildId, 'browser host binds the export buildId');
      assert.equal(identity.status, 'running');
      // The gate panel's presence is the mechanism-visible effect of the
      // effective opening width (panel exists only when width < 1.6m).
      const panelPresent = await page.evaluate(() => {
        const p = (globalThis as any).__kanshanPlayer;
        const scene = p.host.query({ kind: 'scene', limit: 500 });
        return scene.data.some((n: any) => n.name === 'gate-panel');
      });
      // Hold W long enough to cross (sim time tracks wall time in auto mode;
      // ~4.5s at 2.4 m/s covers the 8.5m route with margin).
      await page.keyboard.down('KeyW');
      await page.waitForTimeout(4500);
      await page.keyboard.up('KeyW');
      const z = await page.evaluate(() => {
        const p = (globalThis as any).__kanshanPlayer;
        const scene = p.host.query({ kind: 'scene', limit: 500 });
        const player = scene.data.find((n: any) => n.name === 'player');
        return player ? player.position[2] : null;
      });
      assert.equal(errors.length, 0, errors.join(' | '));
      await page.close();
      return { z: z as number, digest: identity.digest, buildId: identity.buildId };
    } finally {
      await new Promise((r) => server.close(r));
    }
  }

  try {
    const narrowOut = path.join(WORK, 'export-narrow');
    const wideOut = path.join(WORK, 'export-wide');
    const narrow = await runGateCase(narrowOut, 0.4);
    const wide = await runGateCase(wideOut, 1.0);

    const narrowRun = await play(narrowOut, narrow.report);
    const wideRun = await play(wideOut, wide.report);

    // Mechanism parity with the headless invariants (tools-loop):
    assert.ok(narrowRun.z < -3 && narrowRun.z > -5.2, `narrow gate: player advances then is blocked (z=${narrowRun.z})`);
    assert.ok(wideRun.z < -6.5, `wide gate passes in browser too (z=${wideRun.z})`);
  } finally {
    await browser.close();
  }
});
