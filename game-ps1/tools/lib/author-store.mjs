/**
 * author-store.mjs — per-experience AUTHOR revision store (G14) with
 * cross-process safety (G17.a).
 *
 * Layout under <storeRoot>/<experienceDigest>/ (storeRoot defaults to
 * <repo>/game-ps1/.kanshan/authoring; override with KANSHAN_AUTHORING_ROOT
 * for hermetic tests):
 *
 *   revisions/<revId>.json   one revision record per file (atomic temp+rename)
 *   head                     current head revision id, single line of text
 *   head.lock                O_EXCL mutex, held across one whole transaction
 *   commands.jsonl           append-only idempotency log (one JSON per line)
 *
 * THIS IS AUTHOR HISTORY, NOT PLAYER STATE. Player checkpoints live in a
 * completely separate store managed by the runtime host — the two histories
 * never share files or directories, so an author undo can never rewind a
 * player checkpoint and a player restore never touches author revisions.
 *
 * Crash behaviour: every file is written to a unique temp name and renamed
 * into place, so a crash mid-write leaves either the old file or the
 * complete new file, never a partial one. A crash between the revision
 * rename and the head rename leaves the old head with an orphaned revision
 * file; the orphan is unreachable from `head` and is ignored by recovery
 * (it only surfaces as a second "tip" candidate, which recovery reports as
 * ambiguous rather than guessing).
 *
 * The head file holds a bare revision id (not JSON) on purpose: a truncated
 * or garbage head simply matches no revision file and goes down the honest
 * recovery path.
 */

import { promises as fs } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOCK_TIMEOUT_MS = 10_000;
const STALE_LOCK_MS = 30_000;
const LOCK_POLL_MIN_MS = 10;
const LOCK_POLL_JITTER_MS = 30;

export class StoreError extends Error {
  /** @param {string} code machine-readable code (mapped to an exit code by envelope.mjs) */
  constructor(code, message) {
    super(message);
    this.name = 'StoreError';
    this.code = code;
  }
}

/** Default store root: <repo>/game-ps1/.kanshan/authoring. */
export function defaultStoreRoot() {
  return fileURLToPath(new URL('../../.kanshan/authoring/', import.meta.url));
}

/** @param {NodeJS.ProcessEnv} env */
export function resolveStoreRoot(env) {
  const override = env.KANSHAN_AUTHORING_ROOT;
  return override && override.length > 0 ? override : defaultStoreRoot();
}

/** @param {string} storeRoot @param {string} digest */
export function storeDirFor(storeRoot, digest) {
  if (!/^[0-9a-f]{64}$/.test(digest)) {
    throw new StoreError('INVALID_DIGEST', `experienceDigest must be a sha256 hex, got "${digest}"`);
  }
  return join(storeRoot, digest);
}

/** @param {string} dir */
export async function ensureStore(dir) {
  await fs.mkdir(join(dir, 'revisions'), { recursive: true });
  return dir;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function lockPath(dir) {
  return join(dir, 'head.lock');
}

/**
 * Serialize a whole read-modify-write transaction across CLI processes:
 * the lock file is created with O_EXCL (`wx`); a contender polls with
 * jittered backoff until the holder finishes, then re-reads the head and
 * either proceeds (its baseRevision still matches) or loses with
 * REVISION_CONFLICT — one winner, no torn histories. A lock left behind by
 * a crashed holder is broken after STALE_LOCK_MS.
 *
 * @template T
 * @param {string} dir
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withLock(dir, fn) {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      const fh = await fs.open(lockPath(dir), 'wx');
      try {
        await fh.writeFile(JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }));
      } finally {
        await fh.close();
      }
      break;
    } catch (err) {
      if (err && err.code === 'EEXIST') {
        let stale = false;
        try {
          const st = await fs.stat(lockPath(dir));
          stale = Date.now() - st.mtimeMs > STALE_LOCK_MS;
        } catch {
          // Lock released between readdir and stat — retry immediately.
          continue;
        }
        if (stale) {
          await fs.rm(lockPath(dir), { force: true }).catch(() => {});
          continue;
        }
        if (Date.now() >= deadline) {
          throw new StoreError('LOCK_TIMEOUT', `author store at ${dir} is locked beyond ${LOCK_TIMEOUT_MS}ms`);
        }
        await sleep(LOCK_POLL_MIN_MS + Math.floor(Math.random() * LOCK_POLL_JITTER_MS));
        continue;
      }
      throw err;
    }
  }
  try {
    return await fn();
  } finally {
    await fs.rm(lockPath(dir), { force: true }).catch(() => {});
  }
}

/** Write via unique temp + atomic rename; fsync before rename. */
export async function writeFileAtomic(target, content) {
  const tmp = `${target}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  const fh = await fs.open(tmp, 'w');
  try {
    await fh.writeFile(content);
    await fh.sync();
  } finally {
    await fh.close();
  }
  await fs.rename(tmp, target);
}

/** Append one JSON line in a single write (O_APPEND ⇒ atomic per write). */
export async function appendJsonLine(path, record) {
  const fh = await fs.open(path, 'a');
  try {
    await fh.writeFile(JSON.stringify(record) + '\n');
  } finally {
    await fh.close();
  }
}

/**
 * Parse the idempotency log. A crash mid-append can leave a partial last
 * line; every complete line before it is still honoured, parsing stops at
 * the first broken line.
 *
 * @returns {Promise<Array<{commandId: string, revisionId: string, bodyDigest: string, kind: string}>>}
 */
export async function loadCommandLog(dir) {
  let text;
  try {
    text = await fs.readFile(join(dir, 'commands.jsonl'), 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return [];
    throw err;
  }
  const out = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      break;
    }
  }
  return out;
}

/** Load one revision record; missing or malformed files yield null (orphans are skipped, never guessed at). */
export async function loadRevision(dir, id) {
  let text;
  try {
    text = await fs.readFile(join(dir, 'revisions', `${id}.json`), 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    return null;
  }
  try {
    const rec = JSON.parse(text);
    if (rec === null || typeof rec !== 'object' || typeof rec.id !== 'string' || typeof rec.kind !== 'string') return null;
    return rec;
  } catch {
    return null;
  }
}

/**
 * Find the unique revision id that no other revision uses as its
 * baseRevisionId (the tip of a linear history). Returns undefined when
 * ambiguous (multiple tips) — recovery refuses to guess.
 *
 * @returns {Promise<string | undefined>}
 */
async function findUniqueTip(dir) {
  let names;
  try {
    names = await fs.readdir(join(dir, 'revisions'));
  } catch (err) {
    if (err && err.code === 'ENOENT') return undefined;
    throw err;
  }
  const ids = new Set();
  const usedAsBase = new Set();
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const rec = await loadRevision(dir, name.slice(0, -'.json'.length));
    if (!rec) continue;
    ids.add(rec.id);
    if (typeof rec.baseRevisionId === 'string') usedAsBase.add(rec.baseRevisionId);
  }
  const tips = [...ids].filter((id) => !usedAsBase.has(id));
  return tips.length === 1 ? tips[0] : undefined;
}

/**
 * Read the head revision id. Honest corruption handling: a head that does
 * not resolve to an existing revision file is recovered by scanning for a
 * unique tip and atomically rewriting `head`; an empty store recovers to
 * "no head" (head file removed); an ambiguous store throws
 * HEAD_CORRUPT_UNRECOVERABLE instead of picking a branch.
 *
 * @returns {Promise<{ id: string | null, recovered: boolean }>}
 */
export async function readHead(dir) {
  let raw;
  try {
    raw = await fs.readFile(join(dir, 'head'), 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return { id: null, recovered: false };
    throw err;
  }
  const id = raw.trim();
  if (id !== '' && (await loadRevision(dir, id)) !== null) {
    return { id, recovered: false };
  }
  const tip = await findUniqueTip(dir);
  if (tip !== undefined) {
    await writeFileAtomic(join(dir, 'head'), `${tip}\n`);
    return { id: tip, recovered: true };
  }
  let revisionCount = 0;
  try {
    revisionCount = (await fs.readdir(join(dir, 'revisions'))).filter((n) => n.endsWith('.json')).length;
  } catch {
    // keep 0
  }
  if (revisionCount === 0) {
    await fs.rm(join(dir, 'head'), { force: true }).catch(() => {});
    return { id: null, recovered: true };
  }
  throw new StoreError(
    'HEAD_CORRUPT_UNRECOVERABLE',
    `head file at ${join(dir, 'head')} is corrupt and the revision chain has no unique tip (orphaned revisions from a crash?), refusing to guess`,
  );
}

/** @returns {string} fresh revision id */
export function newRevisionId() {
  return `rev-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
}
