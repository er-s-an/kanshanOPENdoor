#!/usr/bin/env node
/**
 * Session daemon (G15 transport level): a tiny localhost HTTP/JSON server that
 * owns exactly ONE real RuntimeSessionHost in controlled (or auto) mode with
 * the experience's actual SceneModule loaded — never fixture state.
 *
 * Spawned detached by `engine-cli session start` (tools/lib/session.mjs):
 *
 *   node tools/lib/session-daemon.mjs
 *     --experience <absDir> --mode controlled|auto --session-id <id>
 *     --state <absStateFile> --token <bearerToken> --build-id <buildId>
 *
 * Contract with the spawner:
 * - The state file ({port, token, pid, experienceDigest, buildId, generation,
 *   createdAt, ...}) is written ONLY after the host has the module loaded and
 *   the socket is listening on 127.0.0.1 with a random port.
 * - On startup failure a sibling `<state>.failed.json` marker carries the
 *   honest engine error code (MANIFEST_*, EXPERIENCE_*, ...).
 * - `stop` stops the host, removes the state file and exits; commands that
 *   arrive while a stop is in flight get NO_SESSION.
 * - Every RPC requires `Authorization: Bearer <token>`.
 *
 * Studio web UI (M6a/M6c human side), served same-origin by this daemon:
 * - GET /studio            -> tools/web/index.html with the session token
 *                           injected into the page (placeholder replaced;
 *                           the page never reads a token from URL/localStorage)
 * - GET /studio/app.js     -> tools/web/app.js (plain JS, no build step)
 * - GET /studio/style.css  -> tools/web/style.css
 * - POST /studio/api/author/list|patch|undo|redo
 *                          -> tools/lib/author.mjs in-process, with
 *                           { experience } resolved from THIS session's
 *                           experience dir. Every response is a ToolEnvelope;
 *                           mutations (and the studio API generally) require
 *                           the session token header. The list route enriches
 *                           each param with the raw describeParameters()
 *                           `kind` metadata (transform/vector3 gizmo hint).
 * - The read-only session query/control routes (POST /rpc) stay as-is.
 *
 * Wire semantics are the real host's semantics: pause freezes the clock,
 * step() advances exactly N fixed steps, query returns bounded in-memory
 * state, inject applies public input events (keys/pointer/mouse/touch) to the
 * session's HeadlessInputDevice so a subsequent step simulates them, replay
 * runs a recorded 'normal-input' trace frame by frame.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { fail as envFail } from './envelope.mjs';
import * as authorTools from './author.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const TRACE_FRAME_CAP = 500_000;
const MIN_STEPS = 1;
const MAX_STEPS_PER_CALL = 100_000;
const TRACE_FORMAT = 'kanshan-input-trace';

// ---------------------------------------------------------------------------
// argv
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) out[key] = argv[++i];
    else out[key] = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const EXPERIENCE_DIR = args.experience;
const MODE = args.mode === 'auto' ? 'auto' : 'controlled';
const SESSION_ID = String(args['session-id'] ?? 'session');
const STATE_FILE = String(args.state ?? '');
const TOKEN = String(args.token ?? '');
const BUILD_ID = String(args['build-id'] ?? 'engine-cli/r1.0');

function daemonError(code, message) {
  return Object.assign(new Error(message), { code });
}

// ---------------------------------------------------------------------------
// daemon state
// ---------------------------------------------------------------------------

const ctx = {
  host: null,
  device: null,
  backend: null,
  doc: null,
  recorder: null, // {out, startTick, startedAt, frames: [], pending: []}
  stopping: false,
  server: null,
  autoTimer: null,
  entryModule: null, // the imported experience entry module (for describeParameters)
};

// ---------------------------------------------------------------------------
// engine loading (real TS sources via Node >=24 type-stripping)
// ---------------------------------------------------------------------------

const { RuntimeSessionHost } = await import('../../src/creative/core/host.ts');
const { digestExperience } = await import('../../src/creative/state/manifest.ts');
const { HeadlessInputDevice } = await import('../../src/creative/input/headless.ts');
const { RecordingBackend } = await import('../../src/creative/audio/backend.ts');
const { FakeDocument } = await import('../../src/creative/ui/fakedom.ts');

function fsExperienceReader() {
  return {
    async listFiles(root) {
      const out = [];
      const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (entry.isFile()) out.push(full);
        }
      };
      walk(root);
      return out;
    },
    async readFile(p) {
      return await fs.promises.readFile(p);
    },
  };
}

function moduleInjections() {
  return { device: ctx.device, audioBackend: ctx.backend, document: ctx.doc };
}

function isSceneModule(value) {
  return value !== null && typeof value === 'object' && typeof value.create === 'function';
}

/**
 * The experience entry is ordinary TS: it may export a SceneModule directly, a
 * `create*Module` factory (e.g. clockwork-flat's createClockworkFlatModule, which
 * takes the injected devices), or a default of either shape.
 */
function resolveSceneModule(mod) {
  if (isSceneModule(mod)) return mod;
  if (mod && typeof mod === 'object') {
    for (const key of Object.keys(mod)) {
      const value = mod[key];
      if (typeof value === 'function' && /^create[A-Za-z0-9]*Module$/.test(key)) {
        const created = value(moduleInjections());
        if (isSceneModule(created)) return created;
        throw daemonError(
          'ENTRY_FACTORY_REJECTED',
          `factory export "${key}" did not return a SceneModule (missing create(ctx))`,
        );
      }
    }
    if (isSceneModule(mod.default)) return mod.default;
    if (typeof mod.default === 'function') {
      const created = mod.default(moduleInjections());
      if (isSceneModule(created)) return created;
    }
  }
  throw daemonError(
    'ENTRY_NOT_A_MODULE',
    'experience entry exports no SceneModule and no create*Module factory',
  );
}

// ---------------------------------------------------------------------------
// input events (public path only: keys/pointer/mouse/touch — no setState)
// ---------------------------------------------------------------------------

function applyEvents(events) {
  if (!Array.isArray(events)) throw daemonError('INVALID_EVENTS', 'frame events must be an array');
  let applied = 0;
  for (const event of events) {
    if (event === null || typeof event !== 'object') {
      throw daemonError('INVALID_EVENT', 'input event must be an object');
    }
    const { type } = event;
    switch (type) {
      case 'keyDown':
      case 'keyUp': {
        if (typeof event.code !== 'string' || event.code.length === 0) {
          throw daemonError('INVALID_EVENT', `${type} needs a string "code"`);
        }
        ctx.device[type](event.code);
        break;
      }
      case 'pointerDelta': {
        const dx = Number(event.dx);
        const dy = Number(event.dy);
        if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
          throw daemonError('INVALID_EVENT', 'pointerDelta needs numeric dx/dy');
        }
        ctx.device.pointerDelta(dx, dy);
        break;
      }
      case 'mouseDown':
      case 'mouseUp': {
        const button = Number(event.button ?? 0);
        if (!Number.isInteger(button) || button < 0) {
          throw daemonError('INVALID_EVENT', `${type} needs an integer "button"`);
        }
        ctx.device[type](button);
        break;
      }
      case 'touchButtonDown':
      case 'touchButtonUp': {
        if (typeof event.id !== 'string' || event.id.length === 0) {
          throw daemonError('INVALID_EVENT', `${type} needs a string "id"`);
        }
        ctx.device[type](event.id);
        break;
      }
      case 'touchStickMove': {
        if (typeof event.id !== 'string' || event.id.length === 0) {
          throw daemonError('INVALID_EVENT', 'touchStickMove needs a string "id"');
        }
        ctx.device.touchStickMove(event.id, Number(event.x ?? 0), Number(event.y ?? 0));
        break;
      }
      default:
        throw daemonError('INVALID_EVENT', `unknown input event type "${String(type)}"`);
    }
    applied += 1;
  }
  return applied;
}

function assertSteps(value, fallback = 1) {
  const n = value === undefined || value === null ? fallback : Number(value);
  if (!Number.isInteger(n) || n < MIN_STEPS || n > MAX_STEPS_PER_CALL) {
    throw daemonError(
      'INVALID_STEPS',
      `steps must be an integer ${MIN_STEPS}..${MAX_STEPS_PER_CALL}, got ${JSON.stringify(value)}`,
    );
  }
  return n;
}

/** Record one trace frame for the step that just executed (if tracing). */
function recordFrame(events = []) {
  const rec = ctx.recorder;
  if (!rec) return;
  if (rec.frames.length >= TRACE_FRAME_CAP) {
    throw daemonError('INVALID_STATE', `trace frame cap ${TRACE_FRAME_CAP} exceeded`);
  }
  rec.frames.push({
    seq: rec.frames.length,
    tick: ctx.host.clock.tick,
    events,
  });
}

/**
 * Advance exactly n fixed steps, one at a time, recording a trace frame per
 * step. Single-stepping matches host.step(n) (same stepOnce/runSimStep loop)
 * and gives each recorded frame its real post-step tick.
 */
function runSteps(n, firstFrameEvents = []) {
  for (let i = 0; i < n; i += 1) {
    ctx.host.step(1);
    recordFrame(i === 0 ? firstFrameEvents : []);
  }
}

function base() {
  const q = ctx.host.query({ kind: 'session' });
  if (!q.ok) throw daemonError(q.error?.code ?? 'SESSION_ERROR', q.error?.message ?? 'session query failed');
  return {
    handle: q.handle,
    status: q.status,
    tick: q.tick,
    time: q.data.time,
    mode: q.data.mode,
  };
}

function requireQuery(result) {
  if (!result.ok) throw daemonError(result.error?.code ?? 'QUERY_FAILED', result.error?.message ?? 'query failed');
  return result;
}

/**
 * inspect.physics: bounded collider/contact data from the module's REAL
 * PhysicsWorld (exposed by convention as `handles.physics` on the module).
 * Never synthesized — a module without physics gets an honest error.
 */
function queryPhysics(params) {
  const physics = ctx.sceneModule?.handles?.physics;
  if (!physics || typeof physics.listColliders !== 'function') {
    throw daemonError(
      'PHYSICS_UNAVAILABLE',
      'this module exposes no physics handle (handles.physics); it may not use the physics system',
    );
  }
  const limitRaw = params.limit === undefined ? 200 : Number(params.limit);
  const limit = Math.min(Math.max(1, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 200), 1000);
  const colliders = physics.listColliders(limit);
  const contacts = physics.contacts(limit);
  return {
    ...base(),
    data: {
      colliders,
      contacts,
      colliderCount: colliders.length,
      contactCount: contacts.length,
      truncated: colliders.length >= limit || contacts.length >= limit,
    },
  };
}

// ---------------------------------------------------------------------------
// RPC operations
// ---------------------------------------------------------------------------

const OPS = {
  status: () => {
    const q = requireQuery(ctx.host.query({ kind: 'session' }));
    return {
      handle: q.handle,
      status: q.status,
      tick: q.tick,
      time: q.data.time,
      mode: q.data.mode,
      discardedTime: q.data.discardedTime,
      commitCount: q.data.commitCount,
      diagnostics: q.data.diagnostics.length,
    };
  },

  pause: () => {
    ctx.host.pause();
    return base();
  },

  resume: () => {
    ctx.host.resume(Date.now() / 1000);
    return base();
  },

  step: (params) => {
    const steps = assertSteps(params.steps);
    const pending = ctx.recorder ? ctx.recorder.pending.splice(0) : [];
    runSteps(steps, pending);
    return { ...base(), advanced: steps };
  },

  query: (params) => {
    if (params.kind === 'physics') return queryPhysics(params);
    const result = requireQuery(
      ctx.host.query({ kind: params.kind, handle: params.handle, limit: params.limit }),
    );
    return {
      handle: result.handle,
      status: result.status,
      tick: result.tick,
      data: result.data,
      truncated: result.truncated === true,
    };
  },

  inject: (params) => {
    const events = params.events;
    if (!Array.isArray(events) || events.length === 0) {
      throw daemonError('INVALID_EVENTS', 'events must be a non-empty JSON array');
    }
    const applied = applyEvents(events);
    if (ctx.recorder) ctx.recorder.pending.push(...events);
    return { applied, tick: ctx.host.clock.tick };
  },

  replay: (params) => {
    const trace = params.trace;
    if (trace === null || typeof trace !== 'object') {
      throw daemonError('INVALID_TRACE', 'trace must be a parsed JSON object');
    }
    if (trace.format !== TRACE_FORMAT || trace.formatVersion !== 1) {
      throw daemonError('INVALID_TRACE', `unrecognized trace format ${JSON.stringify(trace.format)}/${JSON.stringify(trace.formatVersion)}`);
    }
    if (trace.kind !== 'normal-input') {
      throw daemonError(
        'INVALID_TRACE',
        `trace kind "${String(trace.kind)}" is not replayable as player evidence; only "normal-input" traces are`,
      );
    }
    if (!Array.isArray(trace.frames)) {
      throw daemonError('INVALID_TRACE', 'trace.frames must be an array');
    }
    let steps = 0;
    for (const frame of trace.frames) {
      if (frame === null || typeof frame !== 'object') {
        throw daemonError('INVALID_TRACE', 'trace frame must be an object');
      }
      const events = Array.isArray(frame.events) ? frame.events : [];
      applyEvents(events);
      const n = assertSteps(frame.steps, 1);
      runSteps(n, events);
      steps += n;
    }
    return { ...base(), frames: trace.frames.length, steps };
  },

  'trace-start': (params) => {
    if (ctx.recorder) throw daemonError('INVALID_STATE', 'a trace is already recording for this session');
    const out = params.out;
    if (typeof out !== 'string' || out.length === 0) {
      throw daemonError('INVALID_TRACE', 'trace start needs an absolute --out path');
    }
    ctx.recorder = {
      out,
      startTick: ctx.host.clock.tick,
      startedAt: new Date().toISOString(),
      frames: [],
      pending: [],
    };
    return { recording: true, out };
  },

  'trace-stop': () => {
    const rec = ctx.recorder;
    if (!rec) throw daemonError('INVALID_STATE', 'no trace is recording for this session');
    ctx.recorder = null;
    const trace = {
      format: TRACE_FORMAT,
      formatVersion: 1,
      kind: 'normal-input',
      experienceDigest: ctx.host.handle.experienceDigest,
      buildId: ctx.host.handle.buildId,
      sessionId: ctx.host.sessionId,
      createdAt: rec.startedAt,
      fixedDt: ctx.host.clock.fixedDt,
      startTick: rec.startTick,
      frames: rec.frames,
    };
    fs.mkdirSync(path.dirname(rec.out), { recursive: true });
    fs.writeFileSync(rec.out, JSON.stringify(trace, null, 2));
    return { path: rec.out, frames: rec.frames.length, kind: 'normal-input' };
  },

  observe: (params) => {
    if (params.kind === 'metrics') {
      const session = requireQuery(ctx.host.query({ kind: 'session' }));
      const scene = requireQuery(ctx.host.query({ kind: 'scene', limit: 1000 }));
      return {
        handle: session.handle,
        status: session.status,
        tick: session.tick,
        time: session.data.time,
        discardedTime: session.data.discardedTime,
        commitCount: session.data.commitCount,
        diagnostics: session.data.diagnostics.length,
        objects: Array.isArray(scene.data) ? scene.data.length : 0,
        // No GPU/WebGL context and no real-time render loop in the headless
        // host: these are honestly not measured here.
        gpu: 'NOT_MEASURED',
        fps: 'NOT_MEASURED',
        screenshot: 'NOT_MEASURED',
      };
    }
    if (params.kind === 'logs') {
      const limitRaw = params.limit === undefined ? 200 : Number(params.limit);
      const limit = Math.min(Math.max(1, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 200), 1000);
      const all = ctx.host.diagnosticsLog;
      const logs = all.slice(-limit);
      return {
        ...base(),
        logs,
        truncated: all.length > logs.length,
      };
    }
    throw daemonError('BAD_QUERY', `unknown observe kind "${String(params.kind)}"`);
  },

  stop: async () => {
    ctx.stopping = true;
    await ctx.host.stop();
    const handle = ctx.host.handle; // generation fenced by stop()
    setImmediate(() => cleanupAndExit(0));
    return { stopped: true, handle };
  },
};

// ---------------------------------------------------------------------------
// HTTP transport
// ---------------------------------------------------------------------------

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(daemonError('INVALID_REQUEST', `request body exceeds ${MAX_BODY_BYTES} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function handleRpc(req, res) {
  (async () => {
    const body = await readBody(req);
    let msg;
    try {
      msg = JSON.parse(body);
    } catch {
      return send(res, 200, { ok: false, error: { code: 'INVALID_REQUEST', message: 'request body must be JSON' } });
    }
    if (ctx.stopping) {
      return send(res, 200, { ok: false, error: { code: 'NO_SESSION', message: 'session has been stopped' } });
    }
    const handler = OPS[msg === null || typeof msg !== 'object' ? '' : msg.op];
    if (!handler) {
      return send(res, 200, {
        ok: false,
        error: { code: 'BAD_OP', message: `unknown session op "${String(msg?.op)}"` },
      });
    }
    try {
      const data = await handler(msg.params ?? {});
      return send(res, 200, { ok: true, data });
    } catch (err) {
      return send(res, 200, {
        ok: false,
        error: { code: err?.code ?? 'INTERNAL', message: err instanceof Error ? err.message : String(err) },
      });
    }
  })().catch((err) => {
    send(res, 200, { ok: false, error: { code: 'INTERNAL', message: err instanceof Error ? err.message : String(err) } });
  });
}

// ---------------------------------------------------------------------------
// Studio web UI (M6a/M6c): static page + in-process author tool routes
// ---------------------------------------------------------------------------

const STUDIO_WEB_DIR = path.join(MODULE_DIR, '..', 'web');
/** Placeholder the daemon replaces with the real session token when serving
 *  index.html. The page reads the token only from the injected markup. */
const STUDIO_TOKEN_PLACEHOLDER = '%KANSHAN_STUDIO_TOKEN%';
const STUDIO_ASSETS = {
  'index.html': { contentType: 'text/html; charset=utf-8', injectToken: true },
  'app.js': { contentType: 'text/javascript; charset=utf-8', injectToken: false },
  'style.css': { contentType: 'text/css; charset=utf-8', injectToken: false },
};

async function serveStudioAsset(res, name) {
  const asset = STUDIO_ASSETS[name];
  if (!asset) {
    return send(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: `unknown studio asset "${name}"` } });
  }
  let text;
  try {
    text = await fs.promises.readFile(path.join(STUDIO_WEB_DIR, name), 'utf8');
  } catch {
    return send(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: `studio asset "${name}" is missing` } });
  }
  if (asset.injectToken) {
    text = text.split(STUDIO_TOKEN_PLACEHOLDER).join(TOKEN);
  }
  res.writeHead(200, { 'content-type': asset.contentType, 'cache-control': 'no-store' });
  res.end(text);
}

/**
 * Raw describeParameters() kinds (authorId -> kind string) for gizmo hints.
 * author.mjs intentionally normalizes declarations down to the portable core;
 * the studio transform editor needs the author's extra `kind` metadata
 * ('transform' | 'vector3'), read straight from the live module — the same
 * source author.mjs reads. Declaration failures are already reported as
 * diagnostics inside the list envelope, so they are ignored here.
 */
function describeParamKinds() {
  const kinds = new Map();
  try {
    const mod = ctx.entryModule;
    if (mod && typeof mod.describeParameters === 'function') {
      const declared = mod.describeParameters();
      if (Array.isArray(declared)) {
        for (const def of declared) {
          if (
            def !== null &&
            typeof def === 'object' &&
            typeof def.authorId === 'string' &&
            typeof def.kind === 'string'
          ) {
            kinds.set(def.authorId, def.kind);
          }
        }
      }
    }
  } catch {
    /* declaration problems surface in the list envelope diagnostics */
  }
  return kinds;
}

async function authorList() {
  const env = await authorTools.list({ experience: EXPERIENCE_DIR });
  if (env && env.ok === true && env.data && Array.isArray(env.data.params)) {
    const kinds = describeParamKinds();
    for (const param of env.data.params) {
      param.kind = kinds.has(param.authorId) ? kinds.get(param.authorId) : null;
    }
  }
  return env;
}

/**
 * POST /studio/api/author/<name>: run the real author tool in-process against
 * THIS session's experience dir. Every response is a ToolEnvelope; the token
 * gate answers 401 with an envelope too.
 */
const STUDIO_AUTHOR_OPS = {
  list: () => authorList(),
  patch: (params) =>
    authorTools.patch({
      experience: EXPERIENCE_DIR,
      set: params.set,
      baseRevision: params.baseRevision,
      commandId: params.commandId,
    }),
  undo: (params) => authorTools.undo({ experience: EXPERIENCE_DIR, commandId: params.commandId }),
  redo: (params) => authorTools.redo({ experience: EXPERIENCE_DIR, commandId: params.commandId }),
};

function handleStudioAuthor(req, res, name) {
  const op = STUDIO_AUTHOR_OPS[name];
  if (!op) {
    return send(res, 404, envFail('NOT_FOUND', `unknown studio author route "${name}"`));
  }
  const auth = req.headers.authorization ?? '';
  if (auth !== `Bearer ${TOKEN}`) {
    return send(res, 401, envFail('UNAUTHORIZED', 'missing or wrong studio token'));
  }
  if (ctx.stopping) {
    return send(res, 200, envFail('NO_SESSION', 'session has been stopped'));
  }
  (async () => {
    const body = await readBody(req);
    let msg = {};
    if (body.trim() !== '') {
      try {
        msg = JSON.parse(body);
      } catch {
        return send(res, 200, envFail('INVALID_REQUEST', 'request body must be a JSON object'));
      }
    }
    if (msg === null || typeof msg !== 'object' || Array.isArray(msg)) {
      return send(res, 200, envFail('INVALID_REQUEST', 'request body must be a JSON object'));
    }
    return send(res, 200, await op(msg));
  })().catch((err) => {
    send(
      res,
      200,
      envFail(
        err && typeof err.code === 'string' ? err.code : 'INTERNAL',
        err instanceof Error ? err.message : String(err),
      ),
    );
  });
}

// ---------------------------------------------------------------------------
// lifecycle
// ---------------------------------------------------------------------------

function cleanupAndExit(code) {
  try {
    fs.rmSync(STATE_FILE, { force: true });
  } catch {
    /* best effort */
  }
  try {
    ctx.server?.closeAllConnections?.();
    ctx.server?.close(() => process.exit(code));
  } catch {
    process.exit(code);
  }
  setTimeout(() => process.exit(code), 300).unref();
}

async function main() {
  if (!EXPERIENCE_DIR || !STATE_FILE || !TOKEN) {
    throw daemonError('BAD_DAEMON_ARGS', 'daemon needs --experience, --state and --token');
  }

  // Real experience identity from real files.
  const digested = await digestExperience({ root: EXPERIENCE_DIR, reader: fsExperienceReader() });

  // Real module, headless injections — the same wiring the offline replay
  // harness uses (HeadlessInputDevice / RecordingBackend / FakeDocument).
  ctx.device = new HeadlessInputDevice();
  ctx.backend = new RecordingBackend();
  ctx.doc = new FakeDocument();
  const entryUrl = pathToFileURL(path.join(EXPERIENCE_DIR, digested.manifest.entry));
  const mod = await import(entryUrl.href);
  ctx.entryModule = mod;
  const sceneModule = resolveSceneModule(mod);

  ctx.sceneModule = sceneModule;
  ctx.host = new RuntimeSessionHost({
    experienceDigest: digested.digest,
    buildId: BUILD_ID,
    mode: MODE,
    sessionId: SESSION_ID,
    fixedDt: 1 / 60,
  });
  await ctx.host.start(sceneModule);

  // Apply author parameter overrides (the output of `author patch`) to the
  // live module. Code defaults remain the source of truth; the overlay file
  // is explicit author data. Overrides apply through the module's exposed
  // ParameterRegistry (handles.params) with validation, never by editing TS.
  try {
    const overlayPath = path.join(EXPERIENCE_DIR, 'params.overrides.json');
    const registry = ctx.sceneModule?.handles?.params;
    if (fs.existsSync(overlayPath) && registry && typeof registry.set === 'function') {
      const overlay = JSON.parse(fs.readFileSync(overlayPath, 'utf8'));
      for (const [authorId, value] of Object.entries(overlay)) {
        const result = registry.set(authorId, value);
        if (result && result.ok === false) {
          ctx.host.report({ code: 'PARAM_OVERRIDE_REJECTED', message: `${authorId}: ${result.reason ?? 'rejected'}` });
        }
      }
    }
  } catch (err) {
    ctx.host.report({
      code: 'PARAM_OVERRIDE_FAILED',
      message: err instanceof Error ? err.message : String(err),
    });
  }

  if (MODE === 'auto') {
    // The single stepping path: real time drives the fixed-step accumulator.
    ctx.autoTimer = setInterval(() => {
      try {
        ctx.host.advance(Date.now() / 1000);
      } catch {
        /* a stopped/errored session simply stops advancing */
      }
    }, 8);
    ctx.autoTimer.unref();
  }

  ctx.server = http.createServer((req, res) => {
    const url = req.url ?? '';
    if (req.method === 'GET' && (url === '/studio' || url === '/studio/')) {
      serveStudioAsset(res, 'index.html').catch((err) => {
        send(res, 500, { ok: false, error: { code: 'INTERNAL', message: err instanceof Error ? err.message : String(err) } });
      });
      return;
    }
    if (req.method === 'GET' && url.startsWith('/studio/')) {
      // Only the whitelist in STUDIO_ASSETS is servable — no path traversal.
      serveStudioAsset(res, path.basename(url)).catch((err) => {
        send(res, 500, { ok: false, error: { code: 'INTERNAL', message: err instanceof Error ? err.message : String(err) } });
      });
      return;
    }
    if (req.method === 'POST' && url.startsWith('/studio/api/author/')) {
      const name = url.slice('/studio/api/author/'.length).replace(/\/+$/, '');
      return handleStudioAuthor(req, res, name);
    }
    if (req.method !== 'POST' || url !== '/rpc') {
      return send(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'unknown route' } });
    }
    const auth = req.headers.authorization ?? '';
    if (auth !== `Bearer ${TOKEN}`) {
      return send(res, 401, { ok: false, error: { code: 'UNAUTHORIZED', message: 'missing or wrong session token' } });
    }
    return handleRpc(req, res);
  });

  await new Promise((resolve, reject) => {
    ctx.server.once('error', reject);
    ctx.server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = ctx.server.address();

  const state = {
    sessionId: SESSION_ID,
    port,
    token: TOKEN,
    pid: process.pid,
    experienceDir: EXPERIENCE_DIR,
    experienceDigest: digested.digest,
    buildId: BUILD_ID,
    generation: ctx.host.currentGeneration,
    mode: MODE,
    createdAt: new Date().toISOString(),
  };
  const tmp = `${STATE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STATE_FILE);

  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => {
      void (async () => {
        try {
          ctx.stopping = true;
          await ctx.host.stop();
        } catch {
          /* already stopped */
        }
        cleanupAndExit(0);
      })();
    });
  }
}

main().catch((err) => {
  try {
    fs.writeFileSync(
      `${STATE_FILE}.failed.json`,
      JSON.stringify({ code: err?.code ?? 'DAEMON_START_FAILED', message: err instanceof Error ? err.message : String(err) }),
    );
  } catch {
    /* nowhere to report */
  }
  process.exit(1);
});
