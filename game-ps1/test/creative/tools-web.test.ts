/**
 * Studio web UI (M6a/M6c) — transport-level evidence for the daemon-served
 * studio skeleton in tools/web/**.
 *
 * Every test spawns the REAL session daemon (tools/lib/session-daemon.mjs),
 * which owns a real RuntimeSessionHost running the actual experience module.
 * The daemon serves GET /studio (token injected into the page) and proxies
 * POST /studio/api/author/{list,patch,undo,redo} to tools/lib/author.mjs
 * in-process — HTTP + envelope behaviour is asserted for real here.
 *
 * G14 browser-level assertions (rendering, clicking, dragging) are B-group
 * and NOT_RUN in R1; the page itself is plain JS served same-origin with the
 * token injected by the daemon (the page never reads URL/localStorage).
 *
 * The author revision store is redirected to a tmp dir
 * (KANSHAN_AUTHORING_ROOT). Author patches write the derived
 * experiences/noop-patch/params.overrides.json overlay; after() removes it to
 * restore the fixture.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DAEMON = path.join(REPO_ROOT, 'tools', 'lib', 'session-daemon.mjs');
const NOOP_EXPERIENCE = path.join(REPO_ROOT, 'experiences', 'noop-patch');
const NOOP_OVERRIDES = path.join(NOOP_EXPERIENCE, 'params.overrides.json');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'kanshan-web-test-'));
const AUTHORING_ROOT = path.join(TMP, 'authoring');
// Disposable second experience (declares describeParameters() with a
// transform-kind param) lives under the tool scratch dir, NOT experiences/.
const KIND_EXPERIENCE = path.join(REPO_ROOT, '.kanshan', `web-kind-fixture-${process.pid}`);

interface DaemonHandle {
  proc: ChildProcess;
  port: number;
  token: string;
  stateFile: string;
}

const spawned: DaemonHandle[] = [];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function spawnDaemon(experience: string, id: string): Promise<DaemonHandle> {
  const token = `web-test-token-${id}-${process.pid}`;
  const stateFile = path.join(TMP, `session-${id}.json`);
  const proc = spawn(
    process.execPath,
    [
      DAEMON,
      '--experience', experience,
      '--mode', 'controlled',
      '--session-id', id,
      '--state', stateFile,
      '--token', token,
      '--build-id', 'web-test/r1',
    ],
    {
      cwd: REPO_ROOT,
      env: { ...process.env, KANSHAN_AUTHORING_ROOT: AUTHORING_ROOT },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let stderr = '';
  proc.stderr?.on('data', (d) => {
    stderr += String(d);
  });
  const deadline = Date.now() + 30_000;
  for (;;) {
    const failedPath = `${stateFile}.failed.json`;
    if (fs.existsSync(failedPath)) {
      proc.kill('SIGKILL');
      const failed = JSON.parse(fs.readFileSync(failedPath, 'utf8'));
      throw new Error(`daemon for ${id} failed to start: ${failed.code} ${failed.message}\n${stderr}`);
    }
    if (fs.existsSync(stateFile)) {
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      const handle: DaemonHandle = { proc, port: state.port, token, stateFile };
      spawned.push(handle);
      return handle;
    }
    if (Date.now() > deadline) {
      proc.kill('SIGKILL');
      throw new Error(`daemon for ${id} did not write its state file in time\n${stderr}`);
    }
    await sleep(50);
  }
}

async function get(port: number, route: string): Promise<{ status: number; type: string; text: string }> {
  const res = await fetch(`http://127.0.0.1:${port}${route}`);
  return { status: res.status, type: res.headers.get('content-type') ?? '', text: await res.text() };
}

async function post(
  port: number,
  route: string,
  body: unknown,
  token?: string,
): Promise<{ status: number; env: any }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`http://127.0.0.1:${port}${route}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body ?? {}),
  });
  return { status: res.status, env: await res.json() };
}

// ---------------------------------------------------------------------------
// fixture: daemon on experiences/noop-patch (+ a describeParameters fixture)
// ---------------------------------------------------------------------------

let noop: DaemonHandle;
let kindXp: DaemonHandle;

before(async () => {
  fs.rmSync(NOOP_OVERRIDES, { force: true });
  fs.mkdirSync(path.join(KIND_EXPERIENCE, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(KIND_EXPERIENCE, 'experience.json'),
    JSON.stringify({
      format: 'kanshan-experience',
      formatVersion: 1,
      id: 'web-kind-fixture',
      title: '工作室 kind 元数据夹具',
      entry: 'src/main.ts',
      runtimeApiVersion: 'r1.0',
      checkpointSchemaVersion: 1,
    }, null, 2),
  );
  fs.writeFileSync(
    path.join(KIND_EXPERIENCE, 'src', 'main.ts'),
    `import * as THREE from 'three';
import type { SceneContext, SceneInstance, SceneModule } from '../../../src/creative/core/context.ts';
import { exposeParameters } from '../../../src/creative/scene/authoring.ts';

export function describeParameters() {
  return [
    {
      authorId: 'fixture.pos',
      schemaVersion: 1,
      kind: 'transform',
      description: '标记位置（变换编辑器用）',
      value: { x: 0, y: 0, z: 0 },
    },
    { authorId: 'fixture.speed', schemaVersion: 1, description: '普通数字参数', value: 1 },
  ];
}

export const module: SceneModule = {
  create(ctx: SceneContext): SceneInstance {
    const parameters = exposeParameters(describeParameters());
    const marker = new THREE.Group();
    marker.name = 'fixture.marker';
    marker.userData.authorId = 'fixture.pos';
    ctx.scene.add(marker);
    return {
      root: marker,
      handles: { parameters },
      update() {},
      destroy() {
        ctx.scene.remove(marker);
      },
    };
  },
};

export default module;
`,
  );
  noop = await spawnDaemon(NOOP_EXPERIENCE, 'noop');
  kindXp = await spawnDaemon(KIND_EXPERIENCE, 'kind');
});

after(() => {
  for (const handle of spawned) {
    try {
      handle.proc.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }
  fs.rmSync(NOOP_OVERRIDES, { force: true });
  fs.rmSync(KIND_EXPERIENCE, { recursive: true, force: true });
  fs.rmSync(TMP, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// studio page + assets
// ---------------------------------------------------------------------------

test('GET /studio 服务页面并把会话令牌注入页面', async () => {
  const res = await get(noop.port, '/studio');
  assert.equal(res.status, 200, 'studio page 200');
  assert.match(res.type, /text\/html/, 'studio page is html');
  assert.ok(res.text.includes(`content="${noop.token}"`), 'served page carries the injected session token');
  assert.ok(!res.text.includes('%KANSHAN_STUDIO_TOKEN%'), 'no token placeholder left in the served page');
  assert.ok(res.text.includes('scene-tree'), 'page carries the scene tree pane');
  assert.ok(res.text.includes('作者参数'), 'page carries the author params pane');
  assert.ok(res.text.includes('/studio/app.js'), 'page references the same-origin app.js');
});

test('GET /studio 静态资源同源服务，且令牌只出现在注入后的页面里', async () => {
  const js = await get(noop.port, '/studio/app.js');
  assert.equal(js.status, 200, 'app.js 200');
  assert.match(js.type, /text\/javascript/, 'app.js content type');
  assert.ok(js.text.includes('只读（未绑定到作者工程）'), 'served app.js is the real UI module');
  assert.ok(!js.text.includes(noop.token), 'token never appears in the JS asset');
  assert.ok(!js.text.includes('localStorage.'), 'app never touches localStorage');
  assert.ok(!js.text.includes('location.search'), 'app never reads the URL for the token');

  const css = await get(noop.port, '/studio/style.css');
  assert.equal(css.status, 200, 'style.css 200');
  assert.match(css.type, /text\/css/, 'style.css content type');

  const missing = await get(noop.port, '/studio/nope.js');
  assert.equal(missing.status, 404, 'unknown studio asset 404');
});

// ---------------------------------------------------------------------------
// author API: auth gate + envelopes
// ---------------------------------------------------------------------------

test('作者接口未带令牌返回 401 信封；错误方法/路由 404', async () => {
  const noAuth = await post(noop.port, '/studio/api/author/patch', {
    set: { spinSpeed: 9 },
    commandId: 'web-auth-1',
  });
  assert.equal(noAuth.status, 401, 'missing token -> HTTP 401');
  assert.equal(noAuth.env.ok, false, '401 body is a failing ToolEnvelope');
  assert.equal(noAuth.env.toolVersion, 'r1.0', 'envelope carries the protocol version');
  assert.equal(noAuth.env.diagnostics[0].code, 'UNAUTHORIZED');

  const wrongAuth = await post(noop.port, '/studio/api/author/patch', {
    set: { spinSpeed: 9 },
    commandId: 'web-auth-2',
  }, 'not-the-token');
  assert.equal(wrongAuth.status, 401, 'wrong token -> HTTP 401');
  assert.equal(wrongAuth.env.ok, false);

  const wrongMethod = await get(noop.port, '/studio/api/author/list');
  assert.equal(wrongMethod.status, 404, 'GET on the author API is not a route');

  const unknown = await post(noop.port, '/studio/api/author/nope', {}, noop.token);
  assert.equal(unknown.status, 404, 'unknown author op 404 envelope');
  assert.equal(unknown.env.ok, false);
  assert.equal(unknown.env.diagnostics[0].code, 'NOT_FOUND');
});

test('list 返回声明参数（noop-patch 的清单参数，kind 元数据为 null）', async () => {
  const res = await post(noop.port, '/studio/api/author/list', {}, noop.token);
  assert.equal(res.status, 200);
  assert.equal(res.env.ok, true, 'list envelope ok');
  const data = res.env.data;
  assert.equal(data.kind, 'author.parameters');
  assert.equal(data.experienceDigest.length, 64, 'list is keyed by the experience digest');
  const spin = data.params.find((p: any) => p.authorId === 'spinSpeed');
  assert.ok(spin, 'manifest-declared spinSpeed param visible');
  assert.equal(spin.currentValue, 0.5, 'default value from the manifest');
  assert.equal(spin.declaredBy, 'manifest');
  assert.equal(spin.kind, null, 'no describeParameters kinds on noop-patch');
});

test('describeParameters 的 kind 元数据进入 list 响应（变换编辑器依据）', async () => {
  const res = await post(kindXp.port, '/studio/api/author/list', {}, kindXp.token);
  assert.equal(res.env.ok, true, 'kind fixture list ok');
  const pos = res.env.data.params.find((p: any) => p.authorId === 'fixture.pos');
  assert.ok(pos, 'fixture.pos declared');
  assert.equal(pos.kind, 'transform', 'kind metadata surfaced for the gizmo');
  assert.deepEqual(pos.currentValue, { x: 0, y: 0, z: 0 });
  const speed = res.env.data.params.find((p: any) => p.authorId === 'fixture.speed');
  assert.equal(speed.kind, null, 'params without kind extras stay null');
});

// ---------------------------------------------------------------------------
// author patch → conflict → undo → redo over HTTP
// ---------------------------------------------------------------------------

test('补丁 → 过期 baseRevision 冲突 → 撤销 → 重做（全程走 HTTP 信封）', async () => {
  // First patch on an empty store may omit baseRevision.
  const p1 = await post(noop.port, '/studio/api/author/patch', {
    set: { spinSpeed: 1.25 },
    commandId: 'web-patch-1',
  }, noop.token);
  assert.equal(p1.env.ok, true, 'first patch ok');
  const revA = p1.env.data.head;
  assert.equal(p1.env.data.revision.kind, 'patch');
  assert.equal(typeof revA, 'string', 'head revision id returned');

  const l1 = await post(noop.port, '/studio/api/author/list', {}, noop.token);
  assert.equal(l1.env.data.head, revA, 'list reports the new head');
  const after1 = l1.env.data.params.find((p: any) => p.authorId === 'spinSpeed');
  assert.equal(after1.currentValue, 1.25, 'patched value visible through list');
  assert.equal(after1.overridden, true, 'overlay applied');

  // Stale base -> conflict envelope, no write.
  const stale = await post(noop.port, '/studio/api/author/patch', {
    set: { spinSpeed: 2 },
    baseRevision: 'rev-no-such',
    commandId: 'web-patch-2',
  }, noop.token);
  assert.equal(stale.env.ok, false, 'stale base rejected');
  assert.equal(stale.env.diagnostics[0].code, 'REVISION_CONFLICT');

  // Advance the head, then replay the stale base.
  const p2 = await post(noop.port, '/studio/api/author/patch', {
    set: { spinSpeed: 2.5 },
    baseRevision: revA,
    commandId: 'web-patch-2',
  }, noop.token);
  assert.equal(p2.env.ok, true, 'patch on current head ok');
  const revB = p2.env.data.head;
  assert.notEqual(revB, revA);

  const staleAgain = await post(noop.port, '/studio/api/author/patch', {
    set: { spinSpeed: 3 },
    baseRevision: revA,
    commandId: 'web-patch-3',
  }, noop.token);
  assert.equal(staleAgain.env.ok, false);
  assert.equal(staleAgain.env.diagnostics[0].code, 'REVISION_CONFLICT', 'old head is stale now');

  // Undo round-trip: live value returns to the pre-revB value...
  const undo = await post(noop.port, '/studio/api/author/undo', { commandId: 'web-undo-1' }, noop.token);
  assert.equal(undo.env.ok, true, 'undo ok');
  assert.equal(undo.env.data.revision.kind, 'undo');
  const l2 = await post(noop.port, '/studio/api/author/list', {}, noop.token);
  assert.equal(l2.env.data.params.find((p: any) => p.authorId === 'spinSpeed').currentValue, 1.25, 'undo restored 1.25');

  // ...and redo re-applies it.
  const redo = await post(noop.port, '/studio/api/author/redo', { commandId: 'web-redo-1' }, noop.token);
  assert.equal(redo.env.ok, true, 'redo ok');
  assert.equal(redo.env.data.revision.kind, 'redo');
  const l3 = await post(noop.port, '/studio/api/author/list', {}, noop.token);
  assert.equal(l3.env.data.params.find((p: any) => p.authorId === 'spinSpeed').currentValue, 2.5, 'redo re-applied 2.5');

  // The in-process author call really wrote the derived overlay in the
  // experience dir (authoring history itself lives under AUTHORING_ROOT).
  const overrides = JSON.parse(fs.readFileSync(NOOP_OVERRIDES, 'utf8'));
  assert.equal(overrides.spinSpeed, 2.5, 'params.overrides.json reflects the redo');
});

// ---------------------------------------------------------------------------
// scene query used by the page + session lifecycle
// ---------------------------------------------------------------------------

test('页面使用的场景树查询返回有界对象数据', async () => {
  const res = await post(noop.port, '/rpc', { op: 'query', params: { kind: 'scene', limit: 200 } }, noop.token);
  assert.equal(res.status, 200);
  assert.equal(res.env.ok, true, 'scene query ok');
  const objects = res.env.data.data;
  assert.equal(Array.isArray(objects), true, 'scene query returns a bounded object list');
  assert.ok(objects.length > 0 && objects.length <= 200, 'list bounded by the limit');
  const marker = objects.find((o: any) => o.name === 'noop-patch.marker');
  assert.ok(marker, 'marker object present');
  assert.equal(marker.type, 'Mesh');
  assert.equal(marker.authorId, 'noop-patch.marker');
  assert.ok(Array.isArray(marker.position) && marker.position.length === 3, 'snapshot carries position');
  assert.ok(Array.isArray(marker.rotation) && Array.isArray(marker.scale), 'snapshot carries rotation/scale');
  assert.equal(typeof marker.visible, 'boolean');
  assert.ok(Array.isArray(marker.userDataKeys), 'snapshot carries userData keys');
});

test('会话停止后守护进程退出，端口不再服务', async () => {
  const status = await post(kindXp.port, '/rpc', { op: 'status' }, kindXp.token);
  assert.equal(status.env.ok, true, 'kind fixture session running');
  const stop = await post(kindXp.port, '/rpc', { op: 'stop' }, kindXp.token);
  assert.equal(stop.env.ok, true, 'stop op ok');

  const proc = kindXp.proc;
  const exited = await new Promise<boolean>((resolve) => {
    if (proc.exitCode !== null || proc.signalCode !== null) {
      resolve(true);
      return;
    }
    const timer = setTimeout(() => resolve(false), 10_000);
    proc.once('exit', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
  assert.equal(exited, true, 'daemon process exits after stop');

  let refused = false;
  try {
    await post(kindXp.port, '/studio/api/author/list', {}, kindXp.token);
  } catch {
    refused = true;
  }
  assert.equal(refused, true, 'author API unreachable after the daemon exited');
});
