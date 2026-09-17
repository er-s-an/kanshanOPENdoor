/**
 * G15/G18 tool-loop closure, through the real engine-cli only:
 *   narrow gate (failing replay) -> inspect physics colliders + player size
 *   -> author parameter patch -> new session (rebuild) -> replay the SAME
 *   recorded input trace -> goal reached.
 *
 * The failing case is the synthetic fixture experiences/narrow-gate (default
 * opening 0.4m vs player radius 0.25m) — a constructed defect, not a claim
 * about any user project. Runs against a disposable copy under .kanshan.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const GAME_DIR = path.resolve(import.meta.dirname, '..', '..');
const CLI = path.join(GAME_DIR, 'tools', 'engine-cli.mjs');
const SRC_FIXTURE = path.join(GAME_DIR, 'experiences', 'narrow-gate');

let workRoot = '';
let workDir = '';
let tracePath = '';
let sessionCount = 0;
const sessionIds: string[] = [];

function cli(...args: string[]): { code: number; env: any } {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    cwd: GAME_DIR,
    encoding: 'utf8',
    env: {
      ...process.env,
      KANSHAN_AUTHORING_ROOT: path.join(workRoot, 'authoring'),
      KANSHAN_SESSIONS_ROOT: path.join(workRoot, 'sessions'),
    },
    maxBuffer: 16 * 1024 * 1024,
  });
  let env: any = null;
  try {
    env = JSON.parse(res.stdout.trim().split('\n').pop() ?? '');
  } catch {
    assert.fail(`CLI did not emit a JSON envelope: ${res.stdout}\n${res.stderr}`);
  }
  return { code: res.status ?? -1, env };
}

async function stopAllSessions(): Promise<void> {
  for (const id of sessionIds) cli('session', 'stop', '--session', id);
}

before(() => {
  // Disposable experience dir under game-ps1/.kanshan. Its scene.ts is a
  // re-export of the real fixture so engine-relative imports keep resolving;
  // author patches (params.overrides.json) land in the disposable copy only.
  fs.mkdirSync(path.join(GAME_DIR, '.kanshan'), { recursive: true });
  workRoot = fs.mkdtempSync(path.join(GAME_DIR, '.kanshan', 'loop-test-'));
  workDir = path.join(workRoot, 'narrow-gate');
  fs.mkdirSync(path.join(workDir, 'src'), { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(SRC_FIXTURE, 'experience.json'), 'utf8'));
  manifest.id = 'narrow-gate-loop';
  fs.writeFileSync(path.join(workDir, 'experience.json'), JSON.stringify(manifest, null, 2));
  fs.copyFileSync(path.join(SRC_FIXTURE, 'source.json'), path.join(workDir, 'source.json'));
  const original = path.join(SRC_FIXTURE, 'src', 'scene.ts').replace(/\\/g, '/');
  fs.writeFileSync(path.join(workDir, 'src', 'scene.ts'), `export * from ${JSON.stringify(original)};\n`);
  tracePath = path.join(workRoot, 'walk-through.trace.json');
});

after(async () => {
  await stopAllSessions();
  fs.rmSync(workRoot, { recursive: true, force: true });
});

function startSession(): string {
  const r = cli('session', 'start', '--experience', workDir);
  assert.equal(r.code, 0, JSON.stringify(r.env));
  const id = r.env.data?.handle?.sessionId ?? r.env.sessionId;
  assert.ok(id, JSON.stringify(r.env));
  sessionIds.push(id);
  return id;
}

function walkTrace(session: string, steps: number): void {
  assert.equal(cli('trace', 'start', '--session', session, '--out', tracePath).code, 0);
  const inject = cli('input', 'inject', '--session', session, '--events', JSON.stringify([{ type: 'keyDown', code: 'KeyW' }]));
  assert.equal(inject.code, 0);
  const step = cli('session', 'step', '--session', session, '--steps', String(steps));
  assert.equal(step.code, 0);
  assert.equal(cli('trace', 'stop', '--session', session).code, 0);
}

function playerZ(session: string): number {
  const q = cli('query', 'scene', '--session', session, '--limit', '500');
  assert.equal(q.code, 0);
  const nodes = q.env.data.data as Array<{ name: string; position: [number, number, number] }>;
  const player = nodes.find((n) => n.name === 'player');
  assert.ok(player, 'player object present in scene query');
  return player.position[2];
}

function commits(session: string): Array<{ name: string }> {
  const q = cli('query', 'commits', '--session', session);
  assert.equal(q.code, 0);
  return q.env.data.data as Array<{ name: string }>;
}

test('G15/G18 tool loop: narrow-gate fail -> inspect -> patch -> rebuild -> replay passes', async () => {
  // 1. Author parameters are discoverable.
  const list = cli('author', 'parameters', 'list', '--experience', workDir);
  assert.equal(list.code, 0);
  const param = (list.env.data.params as Array<{ authorId: string; currentValue: number }>).find(
    (p) => p.authorId === 'gate.opening-width',
  );
  assert.ok(param, 'gate.opening-width declared');
  assert.equal(param.currentValue, 0.4, 'fixture default is the narrow gate');

  // 2. First session: the narrow gate blocks the recorded walk.
  const s1 = startSession();
  walkTrace(s1, 600);
  const z1 = playerZ(s1);
  assert.ok(z1 > -5.2, `narrow gate must stop the player before/inside the wall, got z=${z1}`);
  assert.ok(
    !commits(s1).some((c) => c.name === 'gate.passed'),
    'no completion while blocked',
  );

  // 3. Inspect: physics query shows the gate panel covering the opening, and
  //    the player capsule radius is visible — the opening (0.4m) is narrower
  //    than the player diameter (0.5m).
  const phys = cli('query', 'physics', '--session', s1);
  assert.equal(phys.code, 0);
  const colliders = phys.env.data.data.colliders as Array<{ bodyId?: string; shape?: string }>;
  const panel = colliders.find((c) => String(c.bodyId ?? '').includes('gate-panel'));
  assert.ok(panel, 'gate-panel collider visible via inspect.physics');
  const playerCollider = colliders.find((c) => String(c.bodyId ?? '').includes('player'));
  assert.ok(playerCollider, 'player collider visible');
  await cli('session', 'stop', '--session', s1);

  // 4. Author patch widens the gate (versioned command, idempotent).
  const patch = cli('author', 'patch', '--experience', workDir, '--set', 'gate.opening-width=1.0', '--command-id', 'loop-widen-1');
  assert.equal(patch.code, 0, JSON.stringify(patch.env));
  const retry = cli('author', 'patch', '--experience', workDir, '--set', 'gate.opening-width=1.0', '--command-id', 'loop-widen-1');
  assert.equal(retry.code, 0, 'idempotent retry returns the original revision');
  assert.equal(
    retry.env.data?.revisionId ?? retry.env.data?.revision?.id,
    patch.env.data?.revisionId ?? patch.env.data?.revision?.id,
    'same revision, no new write',
  );

  // 5. Rebuild = a fresh session on the patched experience; replay the SAME
  //    recorded input trace — the player now passes and the goal commits.
  const s2 = startSession();
  const replay = cli('input', 'replay', '--session', s2, '--trace', tracePath);
  assert.equal(replay.code, 0, JSON.stringify(replay.env));
  const z2 = playerZ(s2);
  assert.ok(z2 < -6.5, `widened gate lets the same input trace through, got z=${z2}`);
  assert.ok(
    commits(s2).some((c) => c.name === 'gate.passed'),
    'goal committed after replay',
  );
  await cli('session', 'stop', '--session', s2);
});
