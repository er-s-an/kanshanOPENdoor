/**
 * session.mjs — client side of the G15 session transport (see
 * session-daemon.mjs for the server side).
 *
 * `session start` spawns a detached daemon process that owns a real
 * RuntimeSessionHost with the experience's actual SceneModule; every other
 * session command is an authenticated RPC over the daemon's localhost socket.
 * State files live under <repo>/.kanshan/sessions/<id>.json. A stopped or
 * unknown session yields NO_SESSION (exit 3); a session whose state file
 * exists but whose process is gone yields SESSION_STOPPED.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ok, fail } from './envelope.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..', '..');
const STATE_DIR = process.env.KANSHAN_SESSIONS_ROOT ? path.resolve(process.env.KANSHAN_SESSIONS_ROOT) : path.join(REPO_ROOT, '.kanshan', 'sessions');
const DAEMON_PATH = path.join(MODULE_DIR, 'session-daemon.mjs');
const BUILD_ID = 'engine-cli/r1.0';

const RPC_TIMEOUT_MS = 15_000;
const START_TIMEOUT_MS = 60_000;
const START_STEPS_MAX = 100_000;

const SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function statePath(id) {
  return path.join(STATE_DIR, `${id}.json`);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function readState(id) {
  const state = readJson(statePath(id));
  if (!state || typeof state.port !== 'number' || typeof state.token !== 'string') return null;
  return state;
}

function cleanupFiles(id) {
  for (const suffix of ['', '.failed.json', '.tmp', '.log']) {
    try {
      fs.rmSync(statePath(id) + suffix, { force: true });
    } catch {
      /* best effort */
    }
  }
}

function isAlive(pid) {
  if (typeof pid !== 'number' || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extras(data) {
  const handle = data?.handle ?? {};
  const out = {};
  if (handle.sessionId) out.sessionId = handle.sessionId;
  if (typeof handle.generation === 'number') out.generation = handle.generation;
  if (handle.experienceDigest) out.experienceDigest = handle.experienceDigest;
  if (handle.buildId) out.buildId = handle.buildId;
  if (typeof data?.tick === 'number') out.tick = data.tick;
  return out;
}

async function rpc(state, op, params = {}) {
  let res;
  try {
    res = await fetch(`http://127.0.0.1:${state.port}/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${state.token}` },
      body: JSON.stringify({ op, params }),
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    });
  } catch (err) {
    return fail('SESSION_STOPPED', `session process is not reachable: ${err instanceof Error ? err.message : String(err)}`);
  }
  let payload;
  try {
    payload = await res.json();
  } catch {
    return fail('SESSION_STOPPED', 'session process returned a non-JSON response');
  }
  if (!payload.ok) return fail(payload.error?.code ?? 'SESSION_ERROR', payload.error?.message ?? 'session error');
  return ok(payload.data, extras(payload.data));
}

/** Resolve a --session id to a live state file, or a failed envelope. */
function withSession(sessionId, op, params = {}) {
  if (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId)) {
    return Promise.resolve(fail('NO_SESSION', `unknown session "${String(sessionId)}"`));
  }
  const state = readState(sessionId);
  if (!state) return Promise.resolve(fail('NO_SESSION', `no live session "${sessionId}"`));
  return rpc(state, op, params).then((env) => {
    if (!env.ok && env.diagnostics?.[0]?.code === 'SESSION_STOPPED') {
      // Stale state file for a dead process — drop it so later calls say NO_SESSION.
      cleanupFiles(sessionId);
    }
    return env;
  });
}

// ---------------------------------------------------------------------------
// commands (wired in tools/commands.mjs)
// ---------------------------------------------------------------------------

export async function start(opts = {}) {
  const experience = opts.experience;
  if (typeof experience !== 'string' || experience.length === 0) {
    return fail('INVALID_EXPERIENCE', 'session start needs --experience <dir>');
  }
  const experienceDir = path.resolve(process.cwd(), experience);
  if (!fs.existsSync(path.join(experienceDir, 'experience.json'))) {
    return fail('MISSING_EXPERIENCE', `no experience.json under "${experienceDir}"`);
  }
  const mode = opts.mode ?? 'controlled';
  if (mode !== 'controlled' && mode !== 'auto') {
    return fail('INVALID_MODE', `--mode must be controlled|auto, got "${String(mode)}"`);
  }
  const id =
    opts.slot !== undefined && opts.slot !== true && opts.slot !== ''
      ? String(opts.slot)
      : `sess-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  if (!SESSION_ID_RE.test(id)) {
    return fail('INVALID_SESSION_ID', `--slot must match ${SESSION_ID_RE}, got "${id}"`);
  }

  fs.mkdirSync(STATE_DIR, { recursive: true });
  const existing = readState(id);
  if (existing && isAlive(existing.pid)) {
    return fail('SESSION_CONFLICT', `session "${id}" is already running (pid ${existing.pid})`);
  }
  cleanupFiles(id);

  const token = crypto.randomBytes(18).toString('base64url');
  const sPath = statePath(id);
  const logPath = `${sPath}.log`;
  let logFd;
  try {
    logFd = fs.openSync(logPath, 'a');
  } catch {
    return fail('INVALID_SESSION_ID', `cannot open session log at "${logPath}"`);
  }
  let child;
  try {
    child = spawn(
      process.execPath,
      [
        DAEMON_PATH,
        '--experience', experienceDir,
        '--mode', mode,
        '--session-id', id,
        '--state', sPath,
        '--token', token,
        '--build-id', BUILD_ID,
      ],
      { detached: true, stdio: ['ignore', logFd, logFd] },
    );
  } catch (err) {
    fs.closeSync(logFd);
    return fail('DAEMON_SPAWN_FAILED', err instanceof Error ? err.message : String(err));
  }
  fs.closeSync(logFd);
  child.unref();

  const deadline = Date.now() + START_TIMEOUT_MS;
  for (;;) {
    const failed = readJson(`${sPath}.failed.json`);
    if (failed) {
      cleanupFiles(id);
      return fail(failed.code ?? 'DAEMON_START_FAILED', failed.message ?? 'session daemon failed to start');
    }
    if (readState(id)) break;
    if (Date.now() > deadline) {
      let tail = '';
      try {
        tail = fs.readFileSync(logPath, 'utf8').trim().split('\n').slice(-3).join(' | ');
      } catch {
        /* no log */
      }
      try {
        process.kill(child.pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
      cleanupFiles(id);
      return fail(
        'SESSION_NOT_READY',
        `session daemon did not become ready within ${START_TIMEOUT_MS}ms${tail ? `: ${tail}` : ''}`,
      );
    }
    await sleep(60);
  }

  const state = readState(id);
  const env = await rpc(state, 'status');
  if (!env.ok) return env;
  return ok(
    {
      handle: env.data.handle,
      tick: env.data.tick,
      mode: env.data.mode,
      stateDir: STATE_DIR,
    },
    extras(env.data),
  );
}

export function status(opts = {}) {
  return withSession(opts.session, 'status');
}

export function pause(opts = {}) {
  return withSession(opts.session, 'pause');
}

export function resume(opts = {}) {
  return withSession(opts.session, 'resume');
}

export function step(opts = {}) {
  const n = Number(opts.steps ?? 1);
  if (!Number.isInteger(n) || n < 1 || n > START_STEPS_MAX) {
    return Promise.resolve(
      fail('INVALID_STEPS', `--steps must be an integer 1..${START_STEPS_MAX}, got "${String(opts.steps)}"`),
    );
  }
  return withSession(opts.session, 'step', { steps: n });
}

export function query(opts = {}) {
  const limit = opts.limit === undefined || opts.limit === true ? undefined : Number(opts.limit);
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    return Promise.resolve(fail('INVALID_LIMIT', `--limit must be a positive integer, got "${String(opts.limit)}"`));
  }
  return withSession(opts.session, 'query', { kind: opts.kind, handle: opts.handle, limit });
}

export function inject(opts = {}) {
  let events = opts.events;
  if (typeof events === 'string') {
    try {
      events = JSON.parse(events);
    } catch {
      return Promise.resolve(fail('INVALID_EVENTS', '--events must be a JSON array of input events'));
    }
  }
  if (!Array.isArray(events) || events.length === 0) {
    return Promise.resolve(fail('INVALID_EVENTS', '--events must be a non-empty JSON array of input events'));
  }
  return withSession(opts.session, 'inject', { events });
}

export function replay(opts = {}) {
  const tracePath = opts.trace;
  if (typeof tracePath !== 'string' || tracePath.length === 0) {
    return Promise.resolve(fail('INVALID_TRACE', 'input replay needs --trace <file>'));
  }
  const abs = path.resolve(process.cwd(), tracePath);
  let trace;
  try {
    trace = JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (err) {
    if (err && err.code === 'ENOENT') return fail('MISSING_TRACE', `no trace file at "${abs}"`);
    return fail('INVALID_TRACE', `cannot parse trace file: ${err instanceof Error ? err.message : String(err)}`);
  }
  return withSession(opts.session, 'replay', { trace });
}

export function traceStart(opts = {}) {
  const out = opts.out;
  if (typeof out !== 'string' || out.length === 0) {
    return Promise.resolve(fail('INVALID_TRACE', 'trace start needs --out <file>'));
  }
  return withSession(opts.session, 'trace-start', { out: path.resolve(process.cwd(), out) });
}

export function traceStop(opts = {}) {
  return withSession(opts.session, 'trace-stop');
}

export function observe(opts = {}) {
  const limit = opts.limit === undefined || opts.limit === true ? undefined : Number(opts.limit);
  return withSession(opts.session, 'observe', { kind: opts.kind, limit });
}

export async function stop(opts = {}) {
  const sessionId = opts.session;
  if (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId)) {
    return fail('NO_SESSION', `unknown session "${String(sessionId)}"`);
  }
  const state = readState(sessionId);
  if (!state) return fail('NO_SESSION', `no live session "${sessionId}"`);
  const env = await rpc(state, 'stop');
  const pid = state.pid;
  cleanupFiles(sessionId);
  if (isAlive(pid)) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* already exiting */
    }
    await sleep(250);
    if (isAlive(pid)) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* gone */
      }
    }
  }
  if (!env.ok) return env;
  return ok(
    { stopped: true, sessionId, handle: env.data?.handle },
    { sessionId, generation: env.data?.handle?.generation },
  );
}
