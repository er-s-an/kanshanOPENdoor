/**
 * Capabilities evidence: `engine-cli capabilities` reports the real
 * implemented systems/operations with honest evidence levels, real installed
 * versions, limits, and NOT_MEASURED markers for what the headless host
 * cannot measure. Spawned through the REAL CLI entry.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = path.join(REPO_ROOT, 'tools', 'engine-cli.mjs');

interface CliResult {
  code: number;
  env: any;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], timeoutMs = 30_000): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd: REPO_ROOT });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += String(d);
    });
    child.stderr.on('data', (d) => {
      stderr += String(d);
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`engine-cli timed out: ${args.join(' ')}`));
    }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      let env: any = null;
      try {
        env = JSON.parse(stdout);
      } catch {
        /* reported below */
      }
      resolve({ code: code ?? -1, env, stdout, stderr });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

test('capabilities: real systems, evidence levels, versions, limits, NOT_MEASURED markers', async () => {
  const result = await runCli(['capabilities']);
  assert.equal(result.code, 0, `exit 0 (got: ${result.stdout}${result.stderr})`);
  assert.equal(result.env.ok, true);
  assert.equal(result.env.toolVersion, 'r1.0');
  const data = result.env.data;

  // versions: identity, from the actually-installed packages.
  assert.equal(data.protocol, 'r1.0');
  assert.equal(data.versions.protocol, 'r1.0');
  assert.equal(data.versions.three, '0.180.0');
  assert.equal(data.versions.rapier, '0.20.0');
  assert.match(data.versions.node, /^v\d+/);

  // evidence levels are exactly the two declared values.
  const levels = Object.keys(data.evidenceLevels);
  assert.deepEqual(levels.sort(), ['BROWSER_RENDER_AUDIO', 'LOCAL_ENGINEERING']);

  // systems: real implemented set, every one carrying a declared evidence level.
  const systems = data.systems as Array<{ id: string; evidence: string; implemented: boolean; testEvidence: { files: number; tests: number } }>;
  assert.ok(systems.length >= 15, `reports the implemented systems (${systems.length})`);
  const ids = systems.map((s) => s.id);
  for (const required of ['core', 'input', 'controllers', 'physics', 'animation', 'camera', 'audio', 'ui', 'state', 'gameplay', 'scene', 'ai', 'render', 'tools-transport']) {
    assert.ok(ids.includes(required), `systems include ${required}`);
  }
  for (const sys of systems) {
    assert.equal(sys.implemented, true, `${sys.id} implemented`);
    assert.ok(levels.includes(sys.evidence), `${sys.id} carries a declared evidence level`);
    assert.ok(typeof sys.testEvidence.files === 'number' && typeof sys.testEvidence.tests === 'number');
  }
  // on-screen raster presentation is the one thing that genuinely needs a browser.
  const render = systems.find((s) => s.id === 'render')!;
  assert.equal(render.evidence, 'BROWSER_RENDER_AUDIO');
  assert.equal(systems.find((s) => s.id === 'core')!.evidence, 'LOCAL_ENGINEERING');

  // operations: the session transport commands are implemented; unknown
  // lib modules (other waves) report implemented:false rather than lying.
  const operations = data.operations;
  for (const op of ['capabilities', 'session', 'query', 'input', 'trace', 'observe']) {
    assert.equal(operations[op].implemented, true, `${op} implemented`);
    assert.ok(levels.includes(operations[op].evidence));
  }
  assert.match(operations.session.transport, /127\.0\.0\.1/);
  assert.equal(typeof operations.author.implemented, 'boolean');
  assert.equal(typeof operations.build.implemented, 'boolean');

  // limits match the real engine bounds.
  assert.equal(data.limits.query.defaultLimit, 200);
  assert.equal(data.limits.query.maxLimit, 1000);
  assert.equal(data.limits.diagnostics.maxPerSession, 200);
  assert.equal(data.limits.clock.fixedDtDefault, 1 / 60);
  assert.equal(data.limits.clock.maxCatchUpSteps, 5);
  assert.equal(data.limits.trace.replayableKinds[0], 'normal-input');

  // GPU/FPS/screenshot are honestly NOT_MEASURED.
  const notMeasured = data.notMeasured as Array<{ metric: string; status: string }>;
  const byMetric = Object.fromEntries(notMeasured.map((m) => [m.metric, m.status]));
  assert.equal(byMetric.gpu, 'NOT_MEASURED');
  assert.equal(byMetric.fps, 'NOT_MEASURED');
  assert.equal(byMetric.screenshot, 'NOT_MEASURED');

  // live test evidence is counted from the real suite on disk.
  assert.ok(data.testEvidence.files >= 50, `test files counted (${data.testEvidence.files})`);
  assert.ok(data.testEvidence.testCases > 0);
});
