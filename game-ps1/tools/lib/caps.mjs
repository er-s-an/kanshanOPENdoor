/**
 * caps.mjs — `engine-cli capabilities`: what the creative runtime and the
 * tool transport actually implement, with honest evidence levels.
 *
 * Evidence levels:
 * - LOCAL_ENGINEERING: the engine-side behavior is covered by this repo's
 *   node:test suites against the real code, or by the session daemon driving
 *   a real RuntimeSessionHost.
 * - BROWSER_RENDER_AUDIO: the engine-side logic is covered headless, but
 *   full-fidelity output (on-screen raster / audible device sound) only exists
 *   in a browser host. No capability is claimed from a dependency name alone;
 *   versions below are reported for identity, not as proof of function.
 *
 * Verification semantics (F07): `implemented` means "source exists and is
 * reachable"; `testDiscovery` is a STATIC count of test() occurrences (it
 * does NOT mean those tests passed); `runRecord` reports the last aggregate
 * acceptance run when its results file is present, else 'unknown'. Missing
 * run record = unknown, never pass.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { PROTOCOL_VERSION, ok } from './envelope.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..', '..');
const TEST_DIR = path.join(REPO_ROOT, 'test', 'creative');
const RUN_RECORD = path.resolve(REPO_ROOT, '..', 'evidence', 'ps1-engine', 'r1', 'results.json');

const LOCAL = 'LOCAL_ENGINEERING';
const BROWSER = 'BROWSER_RENDER_AUDIO';

// ---------------------------------------------------------------------------
// systems (static catalog; live test evidence attached below)
// ---------------------------------------------------------------------------

const SYSTEMS = [
  { id: 'core', evidence: LOCAL, detail: 'fixed-step clock, scope, commit log with idempotent receipts + fencing, session host (controlled + auto), bounded queries' },
  { id: 'input', evidence: LOCAL, detail: 'headless/DOM devices, action mapper, focus, defaults — the public input path sessions inject into' },
  { id: 'controllers', evidence: LOCAL, detail: 'first-person and top-down character controllers over the physics world' },
  { id: 'physics', evidence: LOCAL, detail: 'world, kinematic character, mechanisms (sliding door / moving platform), queries, triggers' },
  { id: 'animation', evidence: LOCAL, detail: 'timeline (declared skip policies) and animation mixer' },
  { id: 'camera', evidence: LOCAL, detail: 'rigs + camera director' },
  { id: 'audio', evidence: LOCAL, detail: 'graph, player, policy, synth voices proven offline on the RecordingBackend; audible device output requires a browser host' },
  { id: 'effects', evidence: LOCAL, detail: 'particles and screen effects' },
  { id: 'scene', evidence: LOCAL, detail: 'authoring helpers, parameter exposure with validation, example builds' },
  { id: 'gameplay', evidence: LOCAL, detail: 'state snapshots, objectives, dialogue, inventory, provenance' },
  { id: 'ui', evidence: LOCAL, detail: 'HUD and menus over the document abstraction (DOM or FakeDocument)' },
  { id: 'state', evidence: LOCAL, detail: 'experience manifest + digest, checkpoint store, cross-scene state' },
  { id: 'ai', evidence: LOCAL, detail: 'perception, navigation, behaviors, FSM' },
  { id: 'assets', evidence: LOCAL, detail: 'loader surface + cache' },
  { id: 'interaction', evidence: LOCAL, detail: 'interaction system + triggers' },
  {
    id: 'render',
    evidence: BROWSER,
    detail: 'PS1 pipeline (resolution/dither/defocus/fog contract, native-shader opt-out) and instancing are exercised headless; on-screen raster and GPU presentation require a browser/WebGL host',
  },
];

const TEST_PREFIX_TO_SYSTEM = {
  'core-': 'core',
  'input-': 'input',
  'controllers-': 'controllers',
  'physics-': 'physics',
  'animation-': 'animation',
  'camera-': 'camera',
  'audio-': 'audio',
  'effects-': 'effects',
  'scene-': 'scene',
  'gameplay-': 'gameplay',
  'ui-': 'ui',
  'state-': 'state',
  'ai-': 'ai',
  'assets-': 'assets',
  'interaction-': 'interaction',
  'render-': 'render',
  'tools-': 'tools-transport',
};

function collectTestEvidence() {
  const perSystem = {};
  let files = 0;
  let tests = 0;
  try {
    for (const name of fs.readdirSync(TEST_DIR)) {
      if (!name.endsWith('.test.ts')) continue;
      const text = fs.readFileSync(path.join(TEST_DIR, name), 'utf8');
      const count = (text.match(/\btest\(/g) ?? []).length;
      files += 1;
      tests += count;
      const prefix = Object.keys(TEST_PREFIX_TO_SYSTEM).find((p) => name.startsWith(p));
      if (prefix) {
        const sys = TEST_PREFIX_TO_SYSTEM[prefix];
        perSystem[sys] = perSystem[sys] ?? { files: 0, tests: 0 };
        perSystem[sys].files += 1;
        perSystem[sys].tests += count;
      }
    }
  } catch {
    /* test dir unreadable — evidence stays empty */
  }
  return { files, tests, perSystem };
}

// ---------------------------------------------------------------------------
// versions (identity, not capability claims)
// ---------------------------------------------------------------------------

function installedVersion(name) {
  try {
    const req = createRequire(path.join(REPO_ROOT, 'package.json'));
    return req(`${name}/package.json`).version ?? null;
  } catch {
    /* fall through to a direct read */
  }
  try {
    return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'node_modules', name, 'package.json'), 'utf8')).version ?? null;
  } catch {
    return null;
  }
}

function libImplemented(module) {
  try {
    return fs.existsSync(path.join(MODULE_DIR, module));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// capabilities()
// ---------------------------------------------------------------------------

export function capabilities() {
  const evidence = collectTestEvidence();
  // The aggregate acceptance run record, when present. Absent = unknown.
  let runRecord;
  try {
    const raw = JSON.parse(fs.readFileSync(RUN_RECORD, 'utf8'));
    runRecord = {
      status: raw?.summary?.status ?? 'unknown',
      generatedAt: raw?.generatedAt ?? null,
      head: raw?.head ?? null,
      pass: raw?.summary?.pass ?? null,
      fail: raw?.summary?.fail ?? null,
      source: path.relative(REPO_ROOT, RUN_RECORD),
    };
  } catch {
    runRecord = { status: 'unknown', note: 'no aggregate run record found; run scripts/verify-ps1-engine.mjs' };
  }
  const systems = SYSTEMS.map((sys) => ({
    ...sys,
    implemented: true,
    testDiscovery: evidence.perSystem[sys.id] ?? { files: 0, tests: 0 },
    runRecord,
  }));
  systems.push({
    id: 'tools-transport',
    evidence: LOCAL,
    implemented: true,
    detail: 'session daemon owning a real RuntimeSessionHost; tools-session/tools-caps suites drive the real CLI entry',
    testDiscovery: evidence.perSystem['tools-transport'] ?? { files: 0, tests: 0 },
    runRecord,
  });

  const operations = {
    capabilities: { implemented: true, evidence: LOCAL, transport: 'in-process' },
    session: {
      commands: ['session start', 'session status', 'session pause', 'session resume', 'session step', 'session stop'],
      implemented: true,
      evidence: LOCAL,
      transport: 'detached daemon process; 127.0.0.1 HTTP/JSON; random port; per-session bearer token; state under .kanshan/sessions/',
    },
    query: {
      commands: ['query scene', 'query object', 'query commits'],
      implemented: true,
      evidence: LOCAL,
      transport: 'bounded read-only views of the live in-memory session',
    },
    input: {
      commands: ['input inject', 'input replay'],
      implemented: true,
      evidence: LOCAL,
      transport: 'public input events only (keys/pointer/mouse/touch); no setState/teleport shortcuts, so inject+step counts as player evidence',
    },
    trace: {
      commands: ['trace start', 'trace stop'],
      implemented: true,
      evidence: LOCAL,
      transport: "records per-step frames of public input events; written traces are kind 'normal-input'",
    },
    observe: {
      commands: ['observe metrics', 'observe logs'],
      implemented: true,
      evidence: LOCAL,
      transport: 'real counters (tick/time/discardedTime/commits/diagnostics/object counts); gpu/fps/screenshot NOT_MEASURED',
    },
    author: {
      commands: ['author parameters list', 'author patch', 'author undo', 'author redo'],
      implemented: libImplemented('author.mjs'),
      evidence: LOCAL,
    },
    build: {
      commands: ['build', 'export'],
      implemented: libImplemented('build.mjs'),
      evidence: LOCAL,
    },
  };

  return ok({
    protocol: PROTOCOL_VERSION,
    versions: {
      protocol: PROTOCOL_VERSION,
      three: installedVersion('three'),
      rapier: installedVersion('@dimforge/rapier3d-compat'),
      node: process.version,
    },
    evidenceLevels: {
      [LOCAL]: 'proven by this repo\'s node:test suites against the real engine code or a real session host',
      [BROWSER]: 'engine-side logic covered headless; full-fidelity output requires a browser host',
    },
    systems,
    operations,
    limits: {
      query: { defaultLimit: 200, maxLimit: 1000 },
      diagnostics: { maxPerSession: 200 },
      clock: { fixedDtDefault: 1 / 60, maxCatchUpSteps: 5, maxFrameTimeSeconds: 0.25 },
      trace: { maxFramesPerTrace: 500_000, replayableKinds: ['normal-input'] },
      stepsPerCallMax: 100_000,
      daemon: {
        bind: '127.0.0.1',
        port: 'random per session',
        auth: 'bearer token, random per session',
        maxBodyBytes: 2 * 1024 * 1024,
      },
    },
    notMeasured: [
      { metric: 'gpu', status: 'NOT_MEASURED', reason: 'headless host owns no WebGL/GPU context' },
      { metric: 'fps', status: 'NOT_MEASURED', reason: 'no real-time render loop in the headless host' },
      { metric: 'screenshot', status: 'NOT_MEASURED', reason: 'frame presentation happens in the browser host' },
    ],
    testEvidence: {
      suite: 'node --test test/creative/*.test.ts',
      files: evidence.files,
      testCases: evidence.tests,
    },
  });
}
