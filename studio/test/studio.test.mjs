import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile } from 'node:fs/promises';
import { StudioServices } from '../src/services.mjs';
import { WorkspaceStore } from '../src/store.mjs';
import { startStudioServer } from '../src/http.mjs';
import blueprint from './fixtures/blueprint.json' with { type: 'json' };

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kanshan-studio-'));
  return { root, services: new StudioServices({ store: new WorkspaceStore(root) }) };
}
const metadata = { sourceId: 'demo-source', title: '雨夜门口', author: '原创测试', extent: 'excerpt', boundary: '止于脚步声。', usage: 'private-prototype', authorizationNote: '原创测试材料，仅用于离线回归。' };
const text = '雨停了。小满回到旧书亭，桌上有一把黄铜钥匙。门外传来脚步声。';

async function waitFor(services, jobId) {
  for (let i = 0; i < 100; i += 1) {
    const job = (await services.getJob(jobId)).data;
    if (['succeeded', 'failed', 'cancelled'].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error('job timeout');
}

test('offline host-agent path: project -> import -> build -> validate -> preview -> private export', async () => {
  const { services } = await setup();
  const project = (await services.createProject({ sourceText: text, metadata })).data;
  const revision = (await services.importRevision({ projectId: project.projectId, baseRevisionId: project.revisionId, analysis: { events: ['read', 'collect', 'open'] }, blueprint })).data;
  const builtJob = (await services.createJob({ projectId: project.projectId, revisionId: revision.revisionId, operation: 'build', idempotencyKey: 'build-1' })).data;
  assert.equal((await waitFor(services, builtJob.jobId)).status, 'succeeded');
  const validateJob = (await services.createJob({ projectId: project.projectId, revisionId: revision.revisionId, operation: 'validate-static' })).data;
  assert.equal((await waitFor(services, validateJob.jobId)).result.status, 'valid');
  const preview = (await services.preview({ projectId: project.projectId, revisionId: revision.revisionId })).data;
  assert.equal(preview.revisionId, revision.revisionId);
  const exported = (await services.exportRevision({ projectId: project.projectId, revisionId: revision.revisionId, audience: 'private' })).data;
  assert.equal(JSON.parse(await readFile(path.join(exported.out, 'manifest.json'), 'utf8')).audience, 'private');
});

test('provider is explicit and mock is labelled; idempotency detects body conflicts', async () => {
  const { services } = await setup(); const project = (await services.createProject({ sourceText: text, metadata })).data;
  const revision = (await services.importRevision({ projectId: project.projectId, baseRevisionId: project.revisionId, analysis: {}, blueprint })).data;
  const providerJob = (await services.createJob({ projectId: project.projectId, revisionId: revision.revisionId, operation: 'generate', mode: 'provider', provider: 'missing', idempotencyKey: 'gen-1' })).data;
  const providerResult = await waitFor(services, providerJob.jobId); assert.equal(providerResult.status, 'failed'); assert.equal(providerResult.diagnostics[0].code, 'PROVIDER_UNAVAILABLE');
  const mock = (await services.createJob({ projectId: project.projectId, revisionId: revision.revisionId, operation: 'generate', mode: 'mock', idempotencyKey: 'gen-2' })).data;
  const mockResult = await waitFor(services, mock.jobId); assert.equal(mockResult.status, 'succeeded'); assert.equal(mockResult.result.mock, true);
  await assert.rejects(() => services.createJob({ projectId: project.projectId, revisionId: revision.revisionId, operation: 'generate', mode: 'provider', idempotencyKey: 'gen-2' }), (error) => error.code === 'IDEMPOTENCY_CONFLICT');
});

test('HTTP adapter exposes capabilities and protects local session', async () => {
  const { root, services } = await setup(); const app = await startStudioServer({ services, port: 0 });
  try {
    const appPage = await fetch(`${app.baseUrl}/`); assert.equal(appPage.status, 200); assert.match(await appPage.text(), /Story to PS1 Studio/);
    const script = await fetch(`${app.baseUrl}/app.mjs`); assert.equal(script.status, 200); assert.match(await script.text(), /x-story-studio-token/);
    const previewWithoutToken = await fetch(`${app.baseUrl}/preview/not-a-project/not-a-revision`); assert.notEqual(previewWithoutToken.status, 401);
    const denied = await fetch(`${app.baseUrl}/api/v1/capabilities`); assert.equal(denied.status, 401);
    const response = await fetch(`${app.baseUrl}/api/v1/capabilities`, { headers: { 'x-story-studio-token': app.token } }); assert.equal(response.status, 200); const payload = await response.json(); assert.equal(payload.ok, true); assert.equal(payload.data.modes['host-agent'], true);
  } finally { await new Promise((resolve) => app.server.close(resolve)); }
  assert.ok(root);
});
