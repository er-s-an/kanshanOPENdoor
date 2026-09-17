/**
 * Transport-level evidence for the G15 session daemon: every test spawns the
 * REAL CLI entry (tools/engine-cli.mjs) and drives a REAL session daemon that
 * owns a real RuntimeSessionHost running the actual clockwork-flat module.
 * No fixture JSON stands in for runtime state anywhere on this path.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = path.join(REPO_ROOT, 'tools', 'engine-cli.mjs');
const EXPERIENCE = path.join(REPO_ROOT, 'experiences', 'clockwork-flat');
const SESSIONS_DIR = path.join(REPO_ROOT, '.kanshan', `sessions-tools-session-${process.pid}`);

interface CliResult {
  code: number;
  env: any;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], timeoutMs = 90_000): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: REPO_ROOT,
      env: { ...process.env, KANSHAN_SESSIONS_ROOT: SESSIONS_DIR },
    });
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
        /* leave null; the assertion below reports stdout */
      }
      resolve({ code: code ?? -1, env, stdout, stderr });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function assertOk(result: CliResult, label: string): any {
  assert.equal(result.code, 0, `${label}: exit 0 (got ${result.code}: ${result.stdout}${result.stderr})`);
  assert.ok(result.env?.ok === true, `${label}: envelope ok (got ${result.stdout})`);
  return result.env.data;
}

function assertFail(result: CliResult, label: string): any {
  assert.notEqual(result.code, 0, `${label}: non-zero exit (got ${result.stdout})`);
  assert.equal(result.env?.ok, false, `${label}: envelope not ok`);
  return result.env.diagnostics[0];
}

// ---------------------------------------------------------------------------
// helpers over the wire data shapes
// ---------------------------------------------------------------------------

interface ObjectSnapshot {
  handle: string;
  name: string;
  type: string;
  parent: string | null;
  position: [number, number, number];
}

function nearestObject(objects: ObjectSnapshot[], to: [number, number, number]): ObjectSnapshot {
  let best: ObjectSnapshot | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const obj of objects) {
    const d = Math.hypot(
      obj.position[0] - to[0],
      obj.position[1] - to[1],
      obj.position[2] - to[2],
    );
    if (d < bestDist) {
      bestDist = d;
      best = obj;
    }
  }
  assert.ok(best, 'found an object near the target position');
  return best;
}

async function sceneObjects(sessionId: string): Promise<ObjectSnapshot[]> {
  const result = await runCli(['query', 'scene', '--session', sessionId, '--limit', '1000']);
  const data = assertOk(result, 'query scene');
  assert.equal(Array.isArray(data.data), true, 'scene query returns a bounded object list');
  return data.data as ObjectSnapshot[];
}

async function playerPosition(sessionId: string): Promise<[number, number, number]> {
  const objects = await sceneObjects(sessionId);
  // The player is the only object that ever sits at the declared spawn.
  const player = nearestObject(objects, [0, 1, -7.5]);
  return player.position;
}

// ---------------------------------------------------------------------------
// cleanup: never leave daemon processes or state files behind
// ---------------------------------------------------------------------------

after(() => {
  try {
    for (const file of fs.readdirSync(SESSIONS_DIR)) {
      if (!file.endsWith('.json')) continue;
      try {
        const state = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, file), 'utf8')) as { pid?: number };
        if (typeof state.pid === 'number') {
          try {
            process.kill(state.pid, 'SIGKILL');
          } catch {
            /* already gone */
          }
        }
      } catch {
        /* unreadable state file */
      }
    }
  } catch {
    /* sessions dir does not exist */
  }
  fs.rmSync(SESSIONS_DIR, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

test('lifecycle over the wire: start → status → inject/step → query → pause/step/resume → observe → stop → rejection', async () => {
  const started = await runCli([
    'session', 'start',
    '--experience', 'experiences/clockwork-flat',
    '--mode', 'controlled',
  ]);
  const data = assertOk(started, 'session start');
  const sessionId = data.handle.sessionId as string;
  assert.match(sessionId, /^sess-/);
  assert.equal(data.tick, 0, 'a fresh session starts at tick 0');
  assert.equal(data.mode, 'controlled');
  assert.match(data.handle.experienceDigest, /^[0-9a-f]{64}$/, 'real digest computed from experience files');
  assert.equal(typeof data.stateDir, 'string');

  // status: real in-memory state at tick 0.
  const status0 = assertOk(await runCli(['session', 'status', '--session', sessionId]), 'status at tick 0');
  assert.equal(status0.tick, 0);
  assert.equal(status0.status, 'running');
  assert.equal(status0.mode, 'controlled');

  // locate the player object at its declared spawn through the bounded query.
  const objects0 = await sceneObjects(sessionId);
  assert.ok(objects0.length >= 50, `scene query returns the real object graph (${objects0.length} objects)`);
  const player0 = nearestObject(objects0, [0, 1, -7.5]);
  assert.ok(
    Math.hypot(player0.position[0], player0.position[1] - 1, player0.position[2] + 7.5) < 0.25,
    `player object sits at the spawn (${player0.position})`,
  );

  // inject a public input event and advance exactly 400 fixed steps.
  const inject = assertOk(
    await runCli([
      'input', 'inject', '--session', sessionId,
      '--events', JSON.stringify([{ type: 'keyDown', code: 'KeyW' }]),
    ]),
    'input inject',
  );
  assert.equal(inject.applied, 1);
  assert.equal(inject.tick, 0, 'inject queues the event; the next step simulates it');

  const stepped = assertOk(await runCli(['session', 'step', '--session', sessionId, '--steps', '400']), 'step 400');
  assert.equal(stepped.advanced, 400);
  assert.equal(stepped.tick, status0.tick + 400, 'tick advanced by exactly the requested fixed steps');

  // the player actually moved through the public input path (blocked by the
  // closed door: forward from z=-7.5, but not past the doorway).
  const obj = assertOk(
    await runCli(['query', 'object', '--session', sessionId, '--handle', player0.handle]),
    'query object',
  );
  const pos = obj.data.position as [number, number, number];
  assert.ok(pos[2] > -6.4, `player walked forward (z=${pos[2]})`);
  assert.ok(pos[2] < -5.0, 'closed door still blocks the doorway');
  assert.ok(Math.abs(pos[0]) < 0.6, 'player stayed in the entry hall lane');

  // commits: bounded, versioned, real (intro facts committed by the timeline).
  const commits = assertOk(await runCli(['query', 'commits', '--session', sessionId]), 'query commits');
  assert.ok(Array.isArray(commits.data), 'commits query returns a list');
  assert.ok((commits.data as unknown[]).length >= 2, 'intro facts committed during those steps');

  // pause freezes the session; controlled stepping still works while paused.
  const paused = assertOk(await runCli(['session', 'pause', '--session', sessionId]), 'pause');
  assert.equal(paused.status, 'paused');
  const pausedStep = assertOk(await runCli(['session', 'step', '--session', sessionId, '--steps', '10']), 'step while paused');
  assert.equal(pausedStep.status, 'paused');
  assert.equal(pausedStep.tick, 410);
  const resumed = assertOk(await runCli(['session', 'resume', '--session', sessionId]), 'resume');
  assert.equal(resumed.status, 'running');
  assert.equal(resumed.tick, 410, 'pause/resume did not advance the clock');

  // observe: real counters; GPU/FPS/screenshot honestly not measured.
  const metrics = assertOk(await runCli(['observe', 'metrics', '--session', sessionId]), 'observe metrics');
  assert.equal(metrics.tick, 410);
  assert.ok(metrics.objects >= 50, 'object count from the live scene graph');
  assert.ok(metrics.commitCount >= 2, 'commit counter is real');
  assert.equal(metrics.gpu, 'NOT_MEASURED');
  assert.equal(metrics.fps, 'NOT_MEASURED');
  assert.equal(metrics.screenshot, 'NOT_MEASURED');
  const logs = assertOk(await runCli(['observe', 'logs', '--session', sessionId]), 'observe logs');
  assert.ok(Array.isArray(logs.logs), 'bounded diagnostics list');

  // stop fences the session; every later command is rejected with NO_SESSION.
  const stopped = assertOk(await runCli(['session', 'stop', '--session', sessionId]), 'stop');
  assert.equal(stopped.stopped, true);
  assert.equal(stopped.handle.generation, 1, 'stop bumped the generation (fencing)');
  for (const args of [
    ['session', 'status'],
    ['session', 'step', '--steps', '1'],
    ['query', 'scene'],
    ['observe', 'metrics'],
  ]) {
    const after = await runCli([...args, '--session', sessionId]);
    const diag = assertFail(after, `rejected after stop: ${args.join(' ')}`);
    assert.equal(after.code, 3, `${args.join(' ')} exits 3 after stop`);
    assert.equal(diag.code, 'NO_SESSION');
  }
});

test('step validates --steps before touching a session', async () => {
  const result = await runCli(['session', 'step', '--session', 'sess-nonexistent', '--steps', '0']);
  const diag = assertFail(result, 'steps=0 rejected');
  assert.equal(result.code, 2, 'invalid params exit 2');
  assert.equal(diag.code, 'INVALID_STEPS');
});

test('two live sessions are isolated from each other', async (t) => {
  const slotA = `iso-a-${process.pid}`;
  const slotB = `iso-b-${process.pid}`;
  const a = assertOk(
    await runCli(['session', 'start', '--experience', EXPERIENCE, '--mode', 'controlled', '--slot', slotA]),
    'start A',
  );
  const b = assertOk(
    await runCli(['session', 'start', '--experience', EXPERIENCE, '--mode', 'controlled', '--slot', slotB]),
    'start B',
  );
  t.after(async () => {
    await runCli(['session', 'stop', '--session', a.handle.sessionId]);
    await runCli(['session', 'stop', '--session', b.handle.sessionId]);
  });
  const idA = a.handle.sessionId as string;
  const idB = b.handle.sessionId as string;
  assert.notEqual(idA, idB);

  // reusing a live slot is a conflict, not a silent replacement.
  const conflict = await runCli(['session', 'start', '--experience', EXPERIENCE, '--slot', slotA]);
  const conflictDiag = assertFail(conflict, 'duplicate slot rejected');
  assert.equal(conflict.code, 4, 'live slot conflict exits 4');
  assert.match(conflictDiag.code, /CONFLICT/);

  // advance A with held input; B must not move.
  await runCli(['input', 'inject', '--session', idA, '--events', JSON.stringify([{ type: 'keyDown', code: 'KeyW' }])]);
  const stepA = assertOk(await runCli(['session', 'step', '--session', idA, '--steps', '400']), 'step A');
  assert.equal(stepA.tick, 400);
  const statusB = assertOk(await runCli(['session', 'status', '--session', idB]), 'status B');
  assert.equal(statusB.tick, 0, 'B did not advance when A stepped');

  const posA = await playerPosition(idA);
  const posB = await playerPosition(idB);
  assert.ok(posA[2] > -6.4, `A's player walked (z=${posA[2]})`);
  assert.ok(
    Math.hypot(posB[0], posB[1] - 1, posB[2] + 7.5) < 0.25,
    `B's player still at spawn (${posB})`,
  );

  // stopping A does not disturb B.
  await runCli(['session', 'stop', '--session', idA]);
  const afterA = await runCli(['session', 'status', '--session', idA]);
  assert.equal(assertFail(afterA, 'A stopped').code, 'NO_SESSION');
  const stillB = assertOk(await runCli(['session', 'status', '--session', idB]), 'B still live');
  assert.equal(stillB.tick, 0);
  assert.equal(stillB.status, 'running');
});

test('unknown session id → NO_SESSION exit 3', async () => {
  for (const args of [['session', 'status'], ['query', 'scene'], ['session', 'stop']]) {
    const result = await runCli([...args, '--session', 'sess-never-started']);
    const diag = assertFail(result, `unknown session: ${args.join(' ')}`);
    assert.equal(result.code, 3, `${args.join(' ')} exits 3 for an unknown session`);
    assert.equal(diag.code, 'NO_SESSION');
  }
});

test('trace record → replay round-trip reproduces ticks and player position on a fresh session', async (t) => {
  const traceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanshan-trace-'));
  const tracePath = path.join(traceDir, 'route.json');

  // Session A: record a public-input route (hold W through the intro, then release).
  const a = assertOk(
    await runCli(['session', 'start', '--experience', EXPERIENCE, '--mode', 'controlled', '--slot', `trc-a-${process.pid}`]),
    'start recorder session',
  );
  t.after(async () => {
    await runCli(['session', 'stop', '--session', a.handle.sessionId]);
    await runCli(['session', 'stop', '--session', b.handle.sessionId]);
    fs.rmSync(traceDir, { recursive: true, force: true });
  });
  const idA = a.handle.sessionId as string;

  assertOk(await runCli(['trace', 'start', '--session', idA, '--out', tracePath]), 'trace start');
  await runCli(['input', 'inject', '--session', idA, '--events', JSON.stringify([{ type: 'keyDown', code: 'KeyW' }])]);
  const part = assertOk(await runCli(['session', 'step', '--session', idA, '--steps', '359']), 'recorded steps');
  assert.equal(part.tick, 359);
  await runCli(['input', 'inject', '--session', idA, '--events', JSON.stringify([{ type: 'keyUp', code: 'KeyW' }])]);
  const recorded = assertOk(await runCli(['session', 'step', '--session', idA, '--steps', '1']), 'final recorded step');
  const stopped = assertOk(await runCli(['trace', 'stop', '--session', idA]), 'trace stop');
  assert.equal(stopped.kind, 'normal-input', 'recorded traces are marked normal-input (public path, no debug assists)');
  assert.equal(stopped.frames, 360);

  const trace = JSON.parse(fs.readFileSync(tracePath, 'utf8'));
  assert.equal(trace.format, 'kanshan-input-trace');
  assert.equal(trace.formatVersion, 1);
  assert.equal(trace.kind, 'normal-input');
  assert.equal(trace.frames.length, 360);
  assert.equal(trace.frames[0].events.length, 1, 'the keyDown rides the first frame');
  assert.equal(trace.frames[0].events[0].type, 'keyDown');
  assert.equal(trace.frames[359].events.length, 1, 'the keyUp rides the last frame');
  assert.equal(trace.frames[359].events[0].type, 'keyUp');
  assert.equal(trace.frames[0].tick, 1, 'each frame carries its own post-step tick');
  assert.equal(trace.frames[359].tick, 360);
  assert.equal(recorded.tick, 360);

  // Session B: replay the trace — a fresh session must converge to the same state.
  const b = assertOk(
    await runCli(['session', 'start', '--experience', EXPERIENCE, '--mode', 'controlled', '--slot', `trc-b-${process.pid}`]),
    'start replay session',
  );
  const idB = b.handle.sessionId as string;
  const replayed = assertOk(await runCli(['input', 'replay', '--session', idB, '--trace', tracePath]), 'replay');
  assert.equal(replayed.frames, 360);
  assert.equal(replayed.steps, 360);
  assert.equal(replayed.tick, 360, 'replay advanced exactly the recorded steps');

  const posA = await playerPosition(idA);
  const posB = await playerPosition(idB);
  assert.deepEqual(posB, posA, `replay converged to the recorded player position (${posA})`);

  // a debug-assisted trace is not player evidence and must not replay.
  const tampered = path.join(traceDir, 'debug.json');
  fs.writeFileSync(tampered, JSON.stringify({ ...trace, kind: 'debug-assisted' }));
  const rejected = await runCli(['input', 'replay', '--session', idB, '--trace', tampered]);
  const diag = assertFail(rejected, 'debug-assisted trace rejected');
  assert.equal(rejected.code, 2);
  assert.equal(diag.code, 'INVALID_TRACE');
});
