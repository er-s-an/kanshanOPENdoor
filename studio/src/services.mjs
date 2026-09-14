import path from 'node:path';
import { cp, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ACTION_CATALOG, PREFAB_CATALOG, RUNTIME, TEMPLATE_CATALOG, buildPackage, validateWithSharedContract } from './contract.mjs';
import { WorkspaceStore } from './store.mjs';
import { MAX_JSON_BYTES, MAX_SOURCE_CODEPOINTS, assert, atomicWrite, atomicWriteJson, codepointLength, digest, ensureDir, exists, failure, id, jsonClone, now, result, safeSegment, StudioError } from './util.mjs';

const JOB_TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'interrupted']);
const OPERATIONS = new Set(['generate', 'build', 'validate-static', 'validate-browser', 'export']);
const PLAYER_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../game-ps1/dist');

function cleanString(value, name, max = 200) {
  assert(typeof value === 'string' && value.trim().length > 0 && value.length <= max, 'BAD_INPUT', `${name} is required and must be <= ${max} chars`);
  return value.trim();
}

function normalizeMetadata(sourceText, input) {
  assert(input && typeof input === 'object', 'BAD_INPUT', 'metadata is required');
  assert(typeof sourceText === 'string', 'BAD_INPUT', 'sourceText must be a string');
  const textLength = codepointLength(sourceText);
  assert(textLength > 0 && textLength <= MAX_SOURCE_CODEPOINTS, 'TOO_LARGE', `sourceText must contain 1-${MAX_SOURCE_CODEPOINTS} codepoints`);
  const sourceId = input.sourceId || input.id || 'source';
  assert(/^[a-z][a-z0-9-]{0,63}$/.test(sourceId), 'BAD_INPUT', 'sourceId must be a kebab-case id');
  const metadata = {
    sourceId,
    title: cleanString(input.title, 'title'),
    author: cleanString(input.author, 'author'),
    extent: input.extent,
    boundary: cleanString(input.boundary, 'boundary', 1000),
    usage: input.usage,
    authorizationNote: cleanString(input.authorizationNote, 'authorizationNote', 2000),
    ...(input.verifiedUrl ? { verifiedUrl: cleanString(input.verifiedUrl, 'verifiedUrl', 2048) } : {}),
    sourceDigest: digest(sourceText),
    codepointLength: textLength
  };
  assert(['excerpt', 'complete'].includes(metadata.extent), 'BAD_INPUT', 'extent must be excerpt or complete');
  assert(['private-prototype', 'authorized-public'].includes(metadata.usage), 'BAD_INPUT', 'usage must be private-prototype or authorized-public');
  if (metadata.verifiedUrl) assert(metadata.verifiedUrl.startsWith('https://'), 'BAD_INPUT', 'verifiedUrl must use https');
  return metadata;
}

function sourceFile(store, projectId) { return path.join(store.projectPath(projectId), 'source', 'story.json'); }
async function sourceText(store, projectId) { const body = JSON.parse(await readFile(sourceFile(store, projectId), 'utf8')); return body.text; }
function packageMetadata(project) { return project.metadata; }

export class StudioServices {
  constructor({ store = new WorkspaceStore(), toolVersion = '0.1.0' } = {}) {
    this.store = store;
    this.toolVersion = toolVersion;
    this.activeJobs = new Map();
  }

  capabilities() {
    const configured = process.env.STORY_PROVIDER ? [process.env.STORY_PROVIDER] : (process.env.STORY_PROVIDER_NAMES || '').split(',').map((x) => x.trim()).filter(Boolean);
    return result({
      tool: { name: 'kanshan-ps1-studio', version: this.toolVersion },
      schema: { name: 'urn:kanshan:story-package:1.0.0', version: '1.0.0' },
      runtime: RUNTIME,
      modes: { 'host-agent': true, provider: configured.length > 0, mock: true },
      providers: configured.map((name) => ({ name, configured: true, credentials: 'server-managed' })),
      templates: TEMPLATE_CATALOG.map((template) => ({ id: template, version: 1, maxScenes: 2, coordinateBounds: [-20, 20], prefabs: PREFAB_CATALOG })),
      actions: ACTION_CATALOG,
      operations: [...OPERATIONS],
      limits: { maxSourceCodepoints: MAX_SOURCE_CODEPOINTS, maxRequestBytes: MAX_JSON_BYTES, maxModelCalls: 6, maxRepairs: 2 },
      features: { filesystemStore: true, deterministicBuild: true, browserValidation: false, publicHttpMutation: true }
    });
  }

  async createProject({ sourceText, metadata, idempotencyKey = undefined }) {
    const normalized = normalizeMetadata(sourceText, metadata);
    const requestDigest = digest({ sourceText, metadata });
    if (idempotencyKey) {
      const existing = await this.findProjectIdempotent(idempotencyKey);
      if (existing) {
        assert(existing.bodyDigest === requestDigest, 'IDEMPOTENCY_CONFLICT', 'idempotency key was already used with another project request', undefined, 409);
        return result({ projectId: existing.projectId, revisionId: existing.headRevisionId, sourceDigest: existing.sourceDigest, idempotent: true });
      }
    }
    const project = await this.store.createProject({ sourceText, metadata: normalized });
    project.idempotencyKey = idempotencyKey || null; project.bodyDigest = requestDigest; await this.store.saveProject(project);
    return result({ projectId: project.projectId, revisionId: project.headRevisionId, sourceDigest: normalized.sourceDigest });
  }

  async findProjectIdempotent(idempotencyKey) {
    const { readdir } = await import('node:fs/promises'); await this.store.init();
    for (const projectId of await readdir(this.store.projectsDir)) {
      try { const project = await this.store.getProject(projectId); if (project.idempotencyKey === idempotencyKey) return project; } catch {}
    }
    return null;
  }

  async getProject(projectId) {
    safeSegment(projectId, 'projectId');
    const project = await this.store.getProject(projectId);
    return result({ projectId: project.projectId, metadata: project.metadata, sourceDigest: project.sourceDigest, headRevisionId: project.headRevisionId, revisions: project.revisions, reviews: project.reviews });
  }

  async getRevision(projectId, revisionId) {
    safeSegment(projectId, 'projectId'); safeSegment(revisionId, 'revisionId');
    const revision = await this.store.getRevision(projectId, revisionId);
    return result({ revisionId: revision.revisionId, baseRevisionId: revision.baseRevisionId, status: revision.status, inputDigests: revision.inputDigests, authoring: { analysis: revision.analysis, blueprint: revision.blueprint }, build: revision.build, validation: revision.validation, generation: revision.generation });
  }

  async preview({ projectId, revisionId, baseUrl = null }) {
    const revision = await this.store.getRevision(projectId, revisionId);
    assert(revision.package && revision.build?.status === 'built', 'BAD_INPUT', 'preview requires a built revision');
    return result({ projectId, revisionId, packageDigest: digest(revision.package), url: baseUrl ? `${baseUrl.replace(/\/$/, '')}/preview/${encodeURIComponent(projectId)}/${encodeURIComponent(revisionId)}` : null, localPath: path.join(this.store.projectPath(projectId), 'revisions', revisionId) });
  }

  async importRevision({ projectId, baseRevisionId, analysis, blueprint, idempotencyKey = undefined }) {
    safeSegment(projectId, 'projectId');
    const project = await this.store.getProject(projectId);
    assert(typeof baseRevisionId === 'string', 'BAD_INPUT', 'baseRevisionId is required');
    assert(baseRevisionId === project.headRevisionId, 'REVISION_CONFLICT', 'baseRevisionId is not project head', { headRevisionId: project.headRevisionId }, 409);
    assert(analysis && typeof analysis === 'object' && !Array.isArray(analysis), 'BAD_INPUT', 'analysis object is required');
    assert(blueprint && typeof blueprint === 'object' && !Array.isArray(blueprint), 'BAD_INPUT', 'blueprint object is required');
    const requestDigest = digest({ projectId, baseRevisionId, analysis, blueprint });
    if (idempotencyKey) {
      const existing = project.revisions.find((item) => item.idempotencyKey === idempotencyKey);
      if (existing) {
        assert(existing.bodyDigest === requestDigest, 'IDEMPOTENCY_CONFLICT', 'idempotency key was already used with another revision request', undefined, 409);
        return result({ projectId, revisionId: existing.revisionId, baseRevisionId: existing.baseRevisionId, idempotent: true });
      }
    }
    const revisionId = id('rev'); const createdAt = now();
    const revision = { revisionId, baseRevisionId, status: 'authored', createdAt, idempotencyKey: idempotencyKey || null, bodyDigest: requestDigest, inputDigests: { source: project.sourceDigest, analysis: digest(analysis), blueprint: digest(blueprint) }, analysis: jsonClone(analysis), blueprint: jsonClone(blueprint), package: null, build: null, validation: null, generation: null };
    await ensureDir(this.store.revisionPath(projectId, revisionId)); await this.store.saveRevision(projectId, revision);
    project.headRevisionId = revisionId; project.revisions.push({ revisionId, baseRevisionId, status: revision.status, createdAt, idempotencyKey: idempotencyKey || null, bodyDigest: requestDigest }); await this.store.saveProject(project);
    return result({ projectId, revisionId, baseRevisionId, idempotencyKey: idempotencyKey || null });
  }

  async build({ projectId, revisionId }) {
    const project = await this.store.getProject(projectId); const revision = await this.store.getRevision(projectId, revisionId);
    assert(revision.status !== 'empty', 'BAD_INPUT', 'cannot build an empty revision');
    const text = await sourceText(this.store, projectId);
    const built = buildPackage({ sourceText: text, metadata: packageMetadata(project), blueprint: revision.blueprint, analysis: revision.analysis });
    const staticReport = validateWithSharedContract(built.package);
    const buildInfo = { status: 'built', builtAt: now(), packageDigest: staticReport.packageDigest, toolVersion: this.toolVersion };
    revision.package = built.package; revision.build = buildInfo; revision.status = 'built'; revision.validation = null;
    await this.store.saveRevision(projectId, revision);
    await this.updateRevisionSummary(projectId, revisionId, 'built');
    return result({ projectId, revisionId, packageDigest: staticReport.packageDigest, reachableBeats: staticReport.reachableBeats, build: buildInfo });
  }

  async generate({ projectId, revisionId, mode, provider = undefined, budget = {} }) {
    assert(mode === 'mock' || mode === 'provider', 'BAD_INPUT', 'generate requires explicit mode mock or provider');
    if (mode === 'provider') throw new StudioError('PROVIDER_UNAVAILABLE', `provider is not configured: ${provider || '(none)'}`, undefined, 503);
    assert((budget.maxCalls === undefined || budget.maxCalls >= 0), 'BUDGET_EXCEEDED', 'generation budget exhausted');
    const revision = await this.store.getRevision(projectId, revisionId); assert(revision.blueprint, 'BAD_INPUT', 'revision has no blueprint');
    revision.generation = { mode: 'mock', mock: true, status: 'succeeded', generatedAt: now(), calls: 0, note: 'deterministic fixture pass-through; not an AI generation result' }; await this.store.saveRevision(projectId, revision);
    return result({ projectId, revisionId, mode: 'mock', mock: true, generation: revision.generation }, [{ code: 'MOCK_MODE', message: 'mock generation used; not provider evidence' }]);
  }

  async validate({ projectId, revisionId, level = 'static' }) {
    assert(['static', 'browser'].includes(level), 'BAD_INPUT', 'level must be static or browser');
    const revision = await this.store.getRevision(projectId, revisionId); const text = await sourceText(this.store, projectId);
    assert(revision.package, 'BAD_INPUT', 'revision must be built before validation');
    if (level === 'browser') {
      const report = { level, status: 'inconclusive', checks: [{ id: 'browser', status: 'not-run', reason: 'browser validation is not installed in this offline package' }], generatedAt: now(), packageDigest: digest(revision.package) };
      revision.validation = { ...(revision.validation || {}), browser: report }; await this.store.saveRevision(projectId, revision); return result(report, [{ code: 'NOT_RUN', message: 'browser validation not run' }]);
    }
    let report;
    try {
      const checked = validateWithSharedContract(revision.package);
      report = { level, status: 'valid', checks: [{ id: 'schema', status: 'pass' }, { id: 'semantics', status: 'pass', reachableBeats: checked.reachableBeats }, { id: 'spatial', status: 'pass' }], generatedAt: now(), packageDigest: checked.packageDigest };
    } catch (error) {
      if (!(error instanceof StudioError)) throw error;
      report = { level, status: 'invalid', checks: [{ id: 'static', status: 'fail', code: error.code, message: error.message, details: error.details }], generatedAt: now(), packageDigest: digest(revision.package) };
    }
    revision.validation = { ...(revision.validation || {}), static: report }; await this.store.saveRevision(projectId, revision);
    return result(report, report.status === 'valid' ? [] : [{ code: 'CONTENT_INVALID', message: 'static validation failed', details: report.checks }]);
  }

  async recordReview({ projectId, revisionId, scope, decision, note, idempotencyKey = undefined }) {
    assert(['source', 'experience', 'public-use'].includes(scope), 'BAD_INPUT', 'invalid review scope'); assert(['approve', 'reject'].includes(decision), 'BAD_INPUT', 'invalid review decision'); const cleanNote = cleanString(note, 'note', 4000);
    const project = await this.store.getProject(projectId); const revision = await this.store.getRevision(projectId, revisionId);
    const requestDigest = digest({ projectId, revisionId, scope, decision, note });
    if (idempotencyKey) {
      const existing = project.reviews.find((item) => item.idempotencyKey === idempotencyKey);
      if (existing) { assert(existing.bodyDigest === requestDigest, 'IDEMPOTENCY_CONFLICT', 'idempotency key was already used with another review request', undefined, 409); return result({ ...existing, idempotent: true }); }
    }
    const review = { reviewId: id('review'), projectId, revisionId, scope, decision, note: cleanNote, idempotencyKey: idempotencyKey || null, bodyDigest: requestDigest, inputDigests: { ...revision.inputDigests, package: revision.package ? digest(revision.package) : null }, createdAt: now() };
    await atomicWriteJson(path.join(this.store.projectPath(projectId), 'reviews', `${review.reviewId}.json`), review); project.reviews.push(review); await this.store.saveProject(project);
    return result(review);
  }

  async exportRevision({ projectId, revisionId, audience = 'private', out = undefined }) {
    assert(['private', 'public'].includes(audience), 'BAD_INPUT', 'audience must be private or public'); const project = await this.store.getProject(projectId); const revision = await this.store.getRevision(projectId, revisionId);
    assert(revision.package && revision.build?.status === 'built', 'BAD_INPUT', 'only a built revision can be exported');
    const staticReport = revision.validation?.static; assert(staticReport?.status === 'valid', 'CONTENT_INVALID', 'static validation must pass before export');
    if (audience === 'public') {
      assert(project.metadata.usage === 'authorized-public', 'NEEDS_REVIEW', 'public export requires authorized-public usage');
      assert(revision.validation?.browser?.status === 'valid', 'NEEDS_REVIEW', 'browser validation must pass before public export');
      for (const scope of ['source', 'experience', 'public-use']) assert(project.reviews.some((r) => r.revisionId === revisionId && r.scope === scope && r.decision === 'approve' && r.inputDigests.package === digest(revision.package)), 'NEEDS_REVIEW', `review approval required: ${scope}`);
    }
    const exportDir = out ? path.resolve(out) : path.join(this.store.projectPath(projectId), 'exports', revisionId, audience);
    if (await exists(exportDir)) {
      const entries = await (await import('node:fs/promises')).readdir(exportDir); assert(entries.length === 0, 'BAD_INPUT', 'export destination must be new or empty');
    }
    await ensureDir(exportDir); const dataDir = path.join(exportDir, 'data'); await ensureDir(dataDir);
    await atomicWriteJson(path.join(dataDir, 'story-package.json'), revision.package);
    const playerReady = await exists(path.join(PLAYER_DIST, 'player.html')) && await exists(path.join(PLAYER_DIST, 'assets'));
    if (playerReady) {
      await cp(path.join(PLAYER_DIST, 'assets'), path.join(exportDir, 'assets'), { recursive: true });
      await cp(path.join(PLAYER_DIST, 'player.html'), path.join(exportDir, 'player.html'));
      await atomicWriteJson(path.join(exportDir, 'story-packages', 'bookstall-opening.json'), revision.package);
    }
    const manifest = { format: 'kanshan-ps1-static', formatVersion: 1, projectId, revisionId, audience, packageDigest: digest(revision.package), engine: RUNTIME, toolVersion: this.toolVersion, playerReady, source: { title: project.metadata.title, author: project.metadata.author, extent: project.metadata.extent, usage: project.metadata.usage, sourceDigest: project.sourceDigest }, generatedAt: now(), notice: audience === 'private' ? '私人原型／未审阅' : '公开用途已通过工作流审阅' };
    await atomicWriteJson(path.join(exportDir, 'manifest.json'), manifest);
    const index = playerReady
      ? `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=player.html"><title>${escapeHtml(revision.package.title)}</title><a href="player.html">打开 PS1 Player</a>`
      : `<!doctype html><meta charset="utf-8"><title>${escapeHtml(revision.package.title)}</title><main><h1>${escapeHtml(revision.package.title)}</h1><p data-revision="${revisionId}">StoryPackage 已构建；当前环境没有 game-ps1 Player bundle。</p><script type="application/json" id="manifest">${JSON.stringify(manifest)}</script><script type="application/json" id="story-package">${JSON.stringify(revision.package)}</script></main>`;
    await atomicWrite(path.join(exportDir, 'index.html'), index);
    return result({ projectId, revisionId, audience, out: exportDir, manifest });
  }

  async createJob({ projectId = null, revisionId = null, operation, mode = undefined, provider = undefined, budget = {}, audience = undefined, out = undefined, idempotencyKey = undefined, body = {} }) {
    assert(OPERATIONS.has(operation), 'BAD_INPUT', `unsupported operation: ${operation}`); if (projectId) safeSegment(projectId, 'projectId'); if (revisionId) safeSegment(revisionId, 'revisionId');
    const requestBody = { projectId, revisionId, operation, mode, provider, budget, audience, out, ...body }; const bodyDigest = digest(requestBody);
    if (idempotencyKey) { const previous = await this.findIdempotent(projectId, operation, idempotencyKey); if (previous) { if (previous.bodyDigest !== bodyDigest) throw new StudioError('IDEMPOTENCY_CONFLICT', 'idempotency key was already used with another request', undefined, 409); return result({ jobId: previous.jobId, status: previous.status, idempotent: true }); } }
    const jobBudget = { maxCalls: Number.isInteger(budget.maxCalls) ? budget.maxCalls : 6, maxRepairs: Number.isInteger(budget.maxRepairs) ? budget.maxRepairs : 2 };
    const job = { jobId: id('job'), projectId, revisionId, operation, mode: mode || null, provider: provider || null, audience: audience || null, out: out || null, budget: jobBudget, status: 'queued', phase: operation === 'generate' ? 'analyze' : operation === 'build' ? 'build' : operation === 'export' ? 'export' : 'validate', attempts: 0, usage: { calls: 0, cost: 'unknown' }, diagnostics: [], bodyDigest, idempotencyKey: idempotencyKey || null, createdAt: now(), updatedAt: now() };
    assert(job.budget.maxCalls >= 0 && job.budget.maxCalls <= 6, 'BUDGET_EXCEEDED', 'maxCalls must be between 0 and 6'); assert(job.budget.maxRepairs >= 0 && job.budget.maxRepairs <= 2, 'BUDGET_EXCEEDED', 'maxRepairs must be between 0 and 2');
    await this.store.putJob(job); this.activeJobs.set(job.jobId, true); queueMicrotask(() => this.runJob(job.jobId).catch(() => {}));
    return result({ jobId: job.jobId, statusUrl: `/api/v1/jobs/${job.jobId}`, status: job.status });
  }

  async findIdempotent(projectId, operation, idempotencyKey) {
    await this.store.init(); const { readdir } = await import('node:fs/promises'); const files = await readdir(this.store.jobsDir);
    for (const file of files.filter((x) => x.endsWith('.json'))) { try { const job = await this.store.getJob(file.slice(0, -5)); if (job.projectId === projectId && job.operation === operation && job.idempotencyKey === idempotencyKey) return job; } catch {} }
    return null;
  }

  async runJob(jobId) {
    let job = await this.store.getJob(jobId); if (job.status !== 'queued') return job;
    if (job.cancelRequested) { await this.store.updateJob(jobId, { status: 'cancelled', phase: 'cancelled', finishedAt: now() }); this.activeJobs.delete(jobId); return; }
    job = await this.store.updateJob(jobId, { status: 'running', startedAt: now(), attempts: 1 });
    try {
      if (job.operation === 'generate') {
        const generated = await this.generate({ projectId: job.projectId, revisionId: job.revisionId, mode: job.mode, provider: job.provider, budget: job.budget });
        job = await this.store.updateJob(jobId, { phase: 'design', status: 'succeeded', finishedAt: now(), result: generated.data, usage: { calls: 0, cost: 'unknown' }, diagnostics: generated.diagnostics });
      } else if (job.operation === 'build') {
        const built = await this.build({ projectId: job.projectId, revisionId: job.revisionId }); job = await this.store.updateJob(jobId, { status: 'succeeded', finishedAt: now(), result: built.data });
      } else if (job.operation === 'validate-static') {
        const checked = await this.validate({ projectId: job.projectId, revisionId: job.revisionId, level: 'static' }); job = await this.store.updateJob(jobId, { status: 'succeeded', finishedAt: now(), result: checked.data, diagnostics: checked.diagnostics });
      } else if (job.operation === 'validate-browser') {
        const checked = await this.validate({ projectId: job.projectId, revisionId: job.revisionId, level: 'browser' }); job = await this.store.updateJob(jobId, { status: 'succeeded', finishedAt: now(), result: checked.data, diagnostics: checked.diagnostics });
      } else if (job.operation === 'export') {
        const exported = await this.exportRevision({ projectId: job.projectId, revisionId: job.revisionId, audience: job.audience || 'private', out: job.out || undefined }); job = await this.store.updateJob(jobId, { status: 'succeeded', finishedAt: now(), result: exported.data });
      }
    } catch (error) {
      const diagnostic = error instanceof StudioError ? { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } : { code: 'INTERNAL_ERROR', message: 'internal error' };
      job = await this.store.updateJob(jobId, { status: job.cancelRequested ? 'cancelled' : 'failed', phase: job.cancelRequested ? 'cancelled' : job.phase, finishedAt: now(), diagnostics: [diagnostic] });
    } finally { this.activeJobs.delete(jobId); }
    return job;
  }

  async getJob(jobId) { return result(await this.store.getJob(jobId)); }

  async cancelJob(jobId) {
    const job = await this.store.getJob(jobId); if (JOB_TERMINAL.has(job.status)) return result({ jobId, status: job.status, outcome: 'already_terminal' });
    if (job.status === 'queued') { const updated = await this.store.updateJob(jobId, { status: 'cancelled', phase: 'cancelled', finishedAt: now() }); return result({ jobId, status: updated.status, outcome: 'cancelled' }); }
    const updated = await this.store.updateJob(jobId, { cancelRequested: true }); return result({ jobId, status: 'cancel_requested', outcome: 'cancel_requested' });
  }

  async updateRevisionSummary(projectId, revisionId, status) {
    const project = await this.store.getProject(projectId); const item = project.revisions.find((x) => x.revisionId === revisionId); if (item) item.status = status; await this.store.saveProject(project);
  }
}

function escapeHtml(value) { return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'); }

export async function safeCall(fn) { try { return await fn(); } catch (error) { return failure(error); } }
