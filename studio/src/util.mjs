import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, stat, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

export const MAX_SOURCE_CODEPOINTS = 20_000;
export const MAX_JSON_BYTES = 2 * 1024 * 1024;
export const ID_RE = /^[a-z][a-z0-9-]{0,63}$/;

export function digest(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return createHash('sha256').update(text).digest('hex');
}

export function id(prefix) {
  return `${prefix}-${randomUUID().replaceAll('-', '').slice(0, 20)}`;
}

export function sessionToken() {
  return randomBytes(24).toString('base64url');
}

export function now() { return new Date().toISOString(); }

export function jsonClone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function codepointLength(text) { return Array.from(text).length; }

export async function ensureDir(dir) { await mkdir(dir, { recursive: true }); }

export async function readJson(file) {
  const raw = await readFile(file, 'utf8');
  return JSON.parse(raw);
}

export async function atomicWriteJson(file, value) {
  await ensureDir(path.dirname(file));
  const temp = `${file}.tmp-${process.pid}-${randomBytes(5).toString('hex')}`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temp, file);
}

export async function atomicWrite(file, value) {
  await ensureDir(path.dirname(file));
  const temp = `${file}.tmp-${process.pid}-${randomBytes(5).toString('hex')}`;
  await writeFile(temp, value);
  await rename(temp, file);
}

export async function exists(file) {
  try { await stat(file); return true; } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

export async function isEmptyDirectory(dir) {
  try { return (await readdir(dir)).length === 0; } catch (error) {
    if (error?.code === 'ENOENT') return true;
    throw error;
  }
}

export function safeSegment(value, label = 'id') {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value) || value.includes('..')) {
    throw new StudioError('BAD_INPUT', `invalid ${label}`);
  }
  return value;
}

export function resolveInside(root, ...segments) {
  const rootResolved = path.resolve(root);
  const candidate = path.resolve(rootResolved, ...segments.map((segment) => safeSegment(segment)));
  if (candidate !== rootResolved && !candidate.startsWith(`${rootResolved}${path.sep}`)) {
    throw new StudioError('BAD_INPUT', 'path escapes workspace');
  }
  return candidate;
}

export class StudioError extends Error {
  constructor(code, message, details = undefined, status = undefined) {
    super(message);
    this.name = 'StudioError';
    this.code = code;
    this.details = details;
    this.status = status;
  }
}

export function result(data, diagnostics = []) {
  return { ok: true, requestId: id('req'), data, diagnostics };
}

export function failure(error, requestId = id('req')) {
  const known = error instanceof StudioError;
  return {
    ok: false,
    requestId,
    data: null,
    diagnostics: [{
      code: known ? error.code : 'INTERNAL_ERROR',
      message: known ? error.message : 'internal error',
      ...(known && error.details !== undefined ? { details: error.details } : {})
    }]
  };
}

export function assert(condition, code, message, details = undefined, status = undefined) {
  if (!condition) throw new StudioError(code, message, details, status);
}

export async function removeIfExists(target) {
  await rm(target, { recursive: true, force: true });
}
