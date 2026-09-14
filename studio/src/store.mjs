import path from 'node:path';
import { ensureDir, readJson, atomicWriteJson, exists, resolveInside, StudioError, id, now } from './util.mjs';

/** File-backed store. Each committed revision is immutable after import. */
export class WorkspaceStore {
  constructor(root = process.env.STORY_WORKSPACES || path.resolve('.story-workspaces')) {
    this.root = path.resolve(root);
    this.projectsDir = path.join(this.root, 'projects');
    this.jobsDir = path.join(this.root, 'jobs');
  }

  async init() { await ensureDir(this.projectsDir); await ensureDir(this.jobsDir); }

  projectPath(projectId) { return resolveInside(this.projectsDir, projectId); }
  projectFile(projectId) { return path.join(this.projectPath(projectId), 'project.json'); }
  revisionPath(projectId, revisionId) { return resolveInside(path.join(this.projectPath(projectId), 'revisions'), revisionId); }
  revisionFile(projectId, revisionId) { return path.join(this.revisionPath(projectId, revisionId), 'revision.json'); }
  jobFile(jobId) { return resolveInside(this.jobsDir, `${jobId}.json`); }

  async createProject({ sourceText, metadata }) {
    await this.init();
    const projectId = id('project');
    const revisionId = id('rev');
    const projectDir = this.projectPath(projectId);
    await ensureDir(path.join(projectDir, 'source'));
    await ensureDir(path.join(projectDir, 'revisions', revisionId));
    await ensureDir(path.join(projectDir, 'reports'));
    await ensureDir(path.join(projectDir, 'reviews'));
    await ensureDir(path.join(projectDir, 'jobs'));
    await atomicWriteJson(path.join(projectDir, 'source', 'metadata.json'), metadata);
    await atomicWriteJson(path.join(projectDir, 'source', 'story.json'), { text: sourceText });
    const createdAt = now();
    const project = {
      projectId,
      createdAt,
      updatedAt: createdAt,
      metadata,
      sourceDigest: metadata.sourceDigest,
      headRevisionId: revisionId,
      revisions: [{ revisionId, baseRevisionId: null, status: 'empty', createdAt }],
      reviews: []
    };
    await atomicWriteJson(this.projectFile(projectId), project);
    await atomicWriteJson(this.revisionFile(projectId, revisionId), {
      revisionId, baseRevisionId: null, status: 'empty', createdAt,
      inputDigests: { source: metadata.sourceDigest },
      analysis: null, blueprint: null, package: null, build: null, validation: null
    });
    return project;
  }

  async getProject(projectId) {
    const file = this.projectFile(projectId);
    if (!await exists(file)) throw new StudioError('NOT_FOUND', `project not found: ${projectId}`, undefined, 404);
    return readJson(file);
  }

  async saveProject(project) { project.updatedAt = now(); await atomicWriteJson(this.projectFile(project.projectId), project); }

  async getRevision(projectId, revisionId) {
    const file = this.revisionFile(projectId, revisionId);
    if (!await exists(file)) throw new StudioError('NOT_FOUND', `revision not found: ${revisionId}`, undefined, 404);
    return readJson(file);
  }

  async saveRevision(projectId, revision) {
    await atomicWriteJson(this.revisionFile(projectId, revision.revisionId), revision);
  }

  async putJob(job) { await this.init(); await atomicWriteJson(this.jobFile(job.jobId), job); }
  async getJob(jobId) {
    const file = this.jobFile(jobId);
    if (!await exists(file)) throw new StudioError('NOT_FOUND', `job not found: ${jobId}`, undefined, 404);
    return readJson(file);
  }
  async updateJob(jobId, update) {
    const job = await this.getJob(jobId);
    Object.assign(job, update, { updatedAt: now() });
    await this.putJob(job);
    return job;
  }
}
