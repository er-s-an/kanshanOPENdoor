/**
 * author.mjs — engine-cli author commands: `author parameters list`,
 * `author patch`, `author undo`, `author redo` (G14 engine-side + G17.a).
 * Returns ToolEnvelopes (see envelope.mjs); the CLI entry maps them to exit
 * codes (2 content/params invalid, 3 target missing, 4 conflict, 5 failure).
 *
 * ----------------------------------------------------------------------------
 * CONTRACT (how experiences declare author parameters)
 * ----------------------------------------------------------------------------
 *
 * Code stays the source of truth; the author store never regenerates TS and
 * never parses code as text. Parameters come from two declared sources:
 *
 * 1. The entry module MAY export `describeParameters()`, a PURE declaration
 *    function returning authoring.ts `ParameterDef` shapes:
 *      { authorId, schemaVersion, value, description?, validate? }
 *    The CLI imports the module and calls it WITHOUT calling create() — no
 *    gameplay logic executes. apply() is deliberately attached only inside
 *    create() (it needs the live scene); describeParameters must therefore
 *    not require a SceneContext and must not mutate state.
 * 2. experience.json MAY carry a "params" block:
 *      { "<authorId>": { "schemaVersion"?, "value": <json>, "description"? } }
 *    or bare values: { "<authorId>": <json> } (schemaVersion defaults to 1).
 *
 * When both exist they merge per authorId and the module's
 * describeParameters() wins (code is source of truth); manifest params fill
 * authorIds the module does not declare. `list` reports which sources fed
 * the result. When neither exists the declared set is empty and every patch
 * authorId is rejected as unknown.
 *
 * ----------------------------------------------------------------------------
 * APPLY MODEL (params.overrides.json)
 * ----------------------------------------------------------------------------
 *
 * A patch never edits code. It writes <experienceDir>/params.overrides.json —
 * explicit overlay data the module (or its host harness) MAY read and push
 * into its exposeParameters registry, e.g. after create():
 *   const overrides = JSON.parse(readFileSync('params.overrides.json', 'utf8'));
 *   for (const [id, v] of Object.entries(overrides)) params.set(id, v);
 * The file holds only values that differ from the code-declared defaults at
 * write time (an overlay, not a snapshot), so currentValue resolution is
 * `overrides[authorId] ?? declaredDefault`. The file is DERIVED data and is
 * excluded from the experienceDigest walk: hashing it would churn the store
 * key on every patch. Each transaction rebuilds it from the revision state,
 * so a crash cannot leave it permanently inconsistent with `head`.
 *
 * ----------------------------------------------------------------------------
 * REVISION SEMANTICS
 * ----------------------------------------------------------------------------
 *
 * Author history is LINEAR: every command claims the current head, so two
 * writers racing on one head produce exactly one winner (the loser gets
 * REVISION_CONFLICT, exit 4). Transactions are serialized with an O_EXCL
 * lock file (author-store.mjs) and every file is written atomically
 * (temp + rename), so a crash mid-command leaves either the old head or the
 * complete new head — never a partial one — and a corrupt head is recovered
 * honestly (unique-tip rewrite) or reported, never guessed past.
 *
 * The store key is the experienceDigest, not the directory name: two
 * checkouts with identical content share one author history, and any code
 * or manifest change isolates it.
 *
 * - patch({experience, set, baseRevision, commandId}):
 *     * unknown authorId            -> INVALID_AUTHOR_PARAM (exit 2)
 *     * module validate() rejects   -> INVALID_PARAM_VALUE  (exit 2)
 *     * baseRevision != head        -> REVISION_CONFLICT    (exit 4)
 *     * same commandId + same body  -> original revision returned, no write
 *     * same commandId + new body   -> COMMAND_CONFLICT     (exit 4)
 *     baseRevision may be omitted (or "null") only while the store has no
 *     head yet — the first revision.
 * - undo/redo({experience, commandId}):
 *     Inverse patch computed from the stored before/after of the head
 *     revision. Each undo/redo is itself a new command with its own
 *     commandId, so history is append-only and auditable. If the live value
 *     no longer matches the recorded after-value (something changed the
 *     overlay outside the history), the command fails with
 *     REVISION_CONFLICT and never overwrites. undo applies to a head that is
 *     a patch/redo; redo to a head that is an undo; otherwise
 *     REVISION_NOTHING_TO_UNDO / REVISION_NOTHING_TO_REDO (exit 4).
 *
 * ----------------------------------------------------------------------------
 * AUTHOR HISTORY ≠ PLAYER CHECKPOINTS
 * ----------------------------------------------------------------------------
 *
 * Revisions live under .kanshan/authoring/<experienceDigest>/ — a different
 * directory from every player-checkpoint store. Revision commands never
 * touch player saves; player restores never touch author history.
 *
 * CLI note: the frozen entry joins only the first two positional words, so
 * the three-word `author parameters list` command must be passed quoted:
 *   node tools/engine-cli.mjs 'author parameters list' --experience <dir>
 * (`author patch` / `author undo` / `author redo` are two words and need no
 * quoting.)
 */

import { promises as fs } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { join, resolve, basename } from 'node:path';
import { pathToFileURL } from 'node:url';

import { ok, fail } from './envelope.mjs';
import * as store from './author-store.mjs';
import { digestExperience } from '../../src/creative/state/manifest.ts';
import { jsonProblems } from '../../src/creative/state/checkpoint-store.ts';
import { canonicalJson, sha256Hex } from '@kanshan/story-contract';

const LIST_LIMIT = 1000;

/** Command-line `--set` uses `;` between pairs because the frozen flag
 * parser keeps only the last occurrence of a repeated flag. */
const SET_SEPARATOR = ';';

class AuthorError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AuthorError';
    this.code = code;
  }
}

function toEnvelopeError(err) {
  if (err && typeof err.code === 'string' && err.code.length > 0) {
    return fail(err.code, err.message);
  }
  return fail('TOOL_ERROR', err instanceof Error ? err.message : String(err));
}

function nullProto() {
  return Object.create(null);
}

// ---------------------------------------------------------------------------
// Experience loading + identity
// ---------------------------------------------------------------------------

/**
 * fs-backed ExperienceFileReader for digestExperience. `params.overrides.json`
 * is derived overlay data, never identity — excluding it keeps the store key
 * stable across patches (see the header contract).
 */
function fsReader() {
  return {
    async listFiles(root) {
      const out = [];
      async function walk(dir) {
        for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
          if (entry.name === 'params.overrides.json') continue;
          const p = join(dir, entry.name);
          if (entry.isDirectory()) await walk(p);
          else if (entry.isFile()) out.push(p);
        }
      }
      await walk(root);
      return out;
    },
    readFile(path) {
      return fs.readFile(path);
    },
  };
}

async function loadExperience(experienceDir) {
  if (typeof experienceDir !== 'string' || experienceDir.length === 0) {
    throw new AuthorError('INVALID_EXPERIENCE', 'an --experience <dir> argument is required');
  }
  const root = resolve(experienceDir);
  let st;
  try {
    st = await fs.stat(root);
  } catch {
    throw new AuthorError('MISSING_EXPERIENCE', `experience directory not found: ${root}`);
  }
  if (!st.isDirectory()) {
    throw new AuthorError('MISSING_EXPERIENCE', `experience path is not a directory: ${root}`);
  }
  const { manifest, digest } = await digestExperience({ root, reader: fsReader() });
  return { root, manifest, digest };
}

// ---------------------------------------------------------------------------
// Declared parameters: describeParameters() + manifest.params
// ---------------------------------------------------------------------------

function normalizeAuthorId(raw, where) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 256) {
    throw new AuthorError('INVALID_AUTHOR_DECL', `${where}: authorId must be a non-empty string (<=256 chars)`);
  }
  return raw;
}

/** Normalize the experience.json "params" block into declarations. */
function normalizeManifestParams(params) {
  const decls = nullProto();
  if (params === undefined || params === null) return decls;
  if (typeof params !== 'object' || Array.isArray(params)) {
    throw new AuthorError('INVALID_AUTHOR_DECL', 'manifest params: expected an object mapping authorId -> declaration');
  }
  for (const [rawId, rawDecl] of Object.entries(params)) {
    const authorId = normalizeAuthorId(rawId, 'manifest params');
    let schemaVersion = 1;
    let value = rawDecl;
    let description;
    if (rawDecl !== null && typeof rawDecl === 'object' && !Array.isArray(rawDecl) && ('value' in rawDecl || 'schemaVersion' in rawDecl || 'description' in rawDecl)) {
      const d = rawDecl;
      if (d.schemaVersion !== undefined) {
        if (typeof d.schemaVersion !== 'number' || !Number.isFinite(d.schemaVersion)) {
          throw new AuthorError('INVALID_AUTHOR_DECL', `manifest params ${authorId}: schemaVersion must be a finite number`);
        }
        schemaVersion = d.schemaVersion;
      }
      if (d.description !== undefined) {
        if (typeof d.description !== 'string') {
          throw new AuthorError('INVALID_AUTHOR_DECL', `manifest params ${authorId}: description must be a string`);
        }
        description = d.description;
      }
      value = 'value' in d ? d.value : undefined;
    }
    const problems = jsonProblems(value, `manifest params ${authorId}.value`, []);
    if (problems.length > 0) {
      throw new AuthorError('INVALID_AUTHOR_DECL', problems.join('; '));
    }
    decls[authorId] = { authorId, schemaVersion, value, description, validate: undefined, declaredBy: 'manifest' };
  }
  return decls;
}

/** Normalize a describeParameters() result; validate fns are kept by reference. */
function normalizeDescribeParams(declared) {
  const decls = nullProto();
  if (declared === undefined || declared === null) return decls;
  if (!Array.isArray(declared)) {
    throw new AuthorError('INVALID_AUTHOR_DECL', 'describeParameters() must return an array of ParameterDef');
  }
  for (const raw of declared) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new AuthorError('INVALID_AUTHOR_DECL', 'describeParameters(): every entry must be an object');
    }
    const authorId = normalizeAuthorId(raw.authorId, 'describeParameters()');
    if (typeof raw.schemaVersion !== 'number' || !Number.isFinite(raw.schemaVersion)) {
      throw new AuthorError('INVALID_AUTHOR_DECL', `describeParameters() ${authorId}: schemaVersion must be a finite number`);
    }
    if (raw.description !== undefined && typeof raw.description !== 'string') {
      throw new AuthorError('INVALID_AUTHOR_DECL', `describeParameters() ${authorId}: description must be a string`);
    }
    if (raw.validate !== undefined && typeof raw.validate !== 'function') {
      throw new AuthorError('INVALID_AUTHOR_DECL', `describeParameters() ${authorId}: validate must be a function`);
    }
    const problems = jsonProblems(raw.value, `describeParameters() ${authorId}.value`, []);
    if (problems.length > 0) {
      throw new AuthorError('INVALID_AUTHOR_DECL', problems.join('; '));
    }
    decls[authorId] = {
      authorId,
      schemaVersion: raw.schemaVersion,
      value: raw.value,
      description: raw.description,
      validate: raw.validate,
      declaredBy: 'describeParameters',
    };
  }
  return decls;
}

/**
 * Load declarations from both sources. Module (describeParameters) wins per
 * authorId; manifest fills gaps. Module import/declaration failures are
 * reported as a diagnostic and degrade to manifest-only declarations — code
 * being temporarily unimportable must not brick a manifest-declared patch.
 */
async function loadDeclaredParams(root, manifest) {
  const fromManifest = normalizeManifestParams(manifest.params);
  let fromModule = nullProto();
  let moduleError;
  const entry = join(root, manifest.entry);
  try {
    const mod = await import(pathToFileURL(entry).href);
    if (mod !== null && typeof mod.describeParameters === 'function') {
      fromModule = normalizeDescribeParams(mod.describeParameters());
    }
  } catch (err) {
    moduleError = err;
  }
  const merged = nullProto();
  for (const [id, decl] of Object.entries(fromManifest)) merged[id] = decl;
  for (const [id, decl] of Object.entries(fromModule)) merged[id] = decl;
  const diagnostics = [];
  if (moduleError) {
    diagnostics.push({
      code: 'MODULE_IMPORT_FAILED',
      message: `entry module "${manifest.entry}" failed to load (${moduleError instanceof Error ? moduleError.message : String(moduleError)}); fell back to manifest declarations`,
      phase: 'declare',
    });
  }
  return { merged, fromManifest, fromModule, diagnostics };
}

// ---------------------------------------------------------------------------
// Overrides overlay
// ---------------------------------------------------------------------------

async function readOverrides(root) {
  const path = join(root, 'params.overrides.json');
  let raw;
  try {
    raw = await fs.readFile(path, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return nullProto();
    throw new AuthorError('OVERRIDE_CORRUPT', `cannot read params.overrides.json: ${err.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new AuthorError('OVERRIDE_CORRUPT', `params.overrides.json is not valid JSON: ${err.message}`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AuthorError('OVERRIDE_CORRUPT', 'params.overrides.json must contain a JSON object');
  }
  return parsed;
}

/** Rebuild the overlay from the effective params: keep undeclared keys, store
 * only declared values that differ from the code-declared default. */
function computeOverrides(previous, appliedParams, decls) {
  const next = { ...previous };
  for (const [authorId, value] of Object.entries(appliedParams)) {
    const decl = decls.merged[authorId];
    if (!decl) continue;
    if (isDeepStrictEqual(value, decl.value)) delete next[authorId];
    else next[authorId] = value;
  }
  return next;
}

// ---------------------------------------------------------------------------
// --set parsing + command bodies
// ---------------------------------------------------------------------------

function parseSet(raw) {
  if (raw === undefined || raw === null || raw === true || raw === '') {
    throw new AuthorError('INVALID_SET', `patch requires --set "<authorId>=<jsonValue>[${SET_SEPARATOR}<authorId>=<jsonValue>...]" or --set '<json object>'`);
  }
  const set = nullProto();
  if (typeof raw === 'object') {
    for (const [id, value] of Object.entries(raw)) set[id] = value;
  } else {
    const text = String(raw).trim();
    if (text.startsWith('{')) {
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        throw new AuthorError('INVALID_SET', `--set is not a valid JSON object: ${err.message}`);
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new AuthorError('INVALID_SET', '--set JSON form must be an object');
      }
      for (const [id, value] of Object.entries(parsed)) set[id] = value;
    } else {
      for (const part of text.split(SET_SEPARATOR)) {
        if (part.trim() === '') continue;
        const eq = part.indexOf('=');
        if (eq <= 0) {
          throw new AuthorError('INVALID_SET', `--set entry "${part}" is not "<authorId>=<jsonValue>"`);
        }
        const authorId = part.slice(0, eq).trim();
        const rawValue = part.slice(eq + 1).trim();
        let value = rawValue;
        if (rawValue !== '') {
          try {
            value = JSON.parse(rawValue);
          } catch {
            // Not JSON — treat as a plain string value.
          }
        }
        set[authorId] = value;
      }
    }
  }
  if (Object.keys(set).length === 0) {
    throw new AuthorError('INVALID_SET', 'patch requires at least one authorId in --set');
  }
  return set;
}

function normalizeBaseRevision(flag) {
  if (flag === undefined || flag === null || flag === '' || flag === 'null') return null;
  return String(flag);
}

function commandIdOf(flags) {
  const commandId = flags.commandId ?? flags['command-id'];
  if (typeof commandId !== 'string' || commandId.length === 0 || commandId.length > 256) {
    throw new AuthorError('INVALID_COMMAND_ID', 'a non-empty --command-id <id> is required (idempotency + audit key)');
  }
  return commandId;
}

function bodyDigest(payload) {
  return sha256Hex(canonicalJson(payload));
}

function sortSetForDigest(set) {
  const out = nullProto();
  for (const id of Object.keys(set).sort()) out[id] = set[id];
  return out;
}

function defaultsOf(decls) {
  const defaults = nullProto();
  for (const [id, decl] of Object.entries(decls.merged)) defaults[id] = decl.value;
  return defaults;
}

/** Effective live value: overlay wins, else the code-declared default. */
function effectiveValue(overrides, decls, authorId) {
  if (Object.prototype.hasOwnProperty.call(overrides, authorId)) return overrides[authorId];
  return decls.merged[authorId] ? decls.merged[authorId].value : undefined;
}

// ---------------------------------------------------------------------------
// Shared command plumbing
// ---------------------------------------------------------------------------

async function openStoreFor(experienceDir) {
  const exp = await loadExperience(experienceDir);
  const storeRoot = store.resolveStoreRoot(process.env);
  const dir = store.storeDirFor(storeRoot, exp.digest);
  await store.ensureStore(dir);
  return { exp, dir };
}

async function idempotentReplay(dir, commandId, digest, diagnostics) {
  const log = await store.loadCommandLog(dir);
  const existing = log.find((c) => c.commandId === commandId);
  if (!existing) return null;
  if (existing.bodyDigest !== digest) {
    throw new AuthorError(
      'COMMAND_CONFLICT',
      `commandId "${commandId}" already ran with a different command body; refusing to conflate two commands`,
    );
  }
  const revision = await store.loadRevision(dir, existing.revisionId);
  if (!revision) {
    throw new AuthorError('REVISION_MISSING', `idempotency log points at revision ${existing.revisionId}, which is missing`);
  }
  return ok(
    {
      kind: 'author.revision',
      version: 1,
      idempotent: true,
      head: revision.id,
      revision,
      overrides: undefined,
      note: 'idempotent replay: original revision returned, no new write',
    },
    { diagnostics },
  );
}

function revisionEnvelope(revision, overrides, diagnostics, experienceDigest) {
  return ok(
    {
      kind: 'author.revision',
      version: 1,
      idempotent: false,
      head: revision.id,
      revision,
      overrides,
    },
    { diagnostics, experienceDigest },
  );
}

// ---------------------------------------------------------------------------
// author parameters list
// ---------------------------------------------------------------------------

/**
 * Static extraction of the experience's declared author parameters — no
 * gameplay logic runs (describeParameters is a pure declaration; when the
 * module does not export it we fall back to the manifest params block).
 */
export async function list(flags) {
  try {
    const { exp, dir } = await openStoreFor(flags.experience);
    const decls = await loadDeclaredParams(exp.root, exp.manifest);
    const overrides = await readOverrides(exp.root);

    let head = null;
    const diagnostics = [...decls.diagnostics];
    try {
      const headState = await store.readHead(dir);
      head = headState.id;
      if (headState.recovered) {
        diagnostics.push({ code: 'HEAD_RECOVERED', message: `head file was corrupt; recovered to revision ${head ?? '(empty history)'}`, phase: 'read' });
      }
    } catch (err) {
      diagnostics.push({
        code: err && err.code ? err.code : 'HEAD_UNREADABLE',
        message: `author history unreadable: ${err instanceof Error ? err.message : String(err)}`,
        phase: 'read',
      });
    }

    const params = [];
    let truncated = false;
    for (const authorId of Object.keys(decls.merged).sort()) {
      if (params.length >= LIST_LIMIT) {
        truncated = true;
        break;
      }
      const decl = decls.merged[authorId];
      const overridden = Object.prototype.hasOwnProperty.call(overrides, authorId);
      params.push({
        authorId,
        schemaVersion: decl.schemaVersion,
        currentValue: overridden ? overrides[authorId] : decl.value,
        description: decl.description ?? null,
        declaredBy: decl.declaredBy,
        overridden,
      });
    }

    const moduleCount = Object.keys(decls.fromModule).length;
    const manifestCount = Object.keys(decls.fromManifest).length;
    const source =
      moduleCount > 0 && manifestCount > 0
        ? 'describeParameters+manifest'
        : moduleCount > 0
          ? 'describeParameters'
          : manifestCount > 0
            ? 'manifest'
            : 'none';

    const data = {
      kind: 'author.parameters',
      version: 1,
      experience: basename(exp.root),
      experienceDigest: exp.digest,
      source,
      head,
      params,
      overridesApplied: Object.keys(overrides).length,
      truncated,
    };
    return ok(data, { experienceDigest: exp.digest, diagnostics });
  } catch (err) {
    return toEnvelopeError(err);
  }
}

// ---------------------------------------------------------------------------
// author patch
// ---------------------------------------------------------------------------

export async function patch(flags) {
  try {
    const commandId = commandIdOf(flags);
    const set = parseSet(flags.set);
    const baseRevision = normalizeBaseRevision(flags.baseRevision ?? flags['base-revision']);
    const { exp, dir } = await openStoreFor(flags.experience);
    const decls = await loadDeclaredParams(exp.root, exp.manifest);
    const diagnostics = [...decls.diagnostics];

    // Fail fast on declaration-level problems before touching history.
    const declaredIds = Object.keys(decls.merged);
    for (const [authorId, value] of Object.entries(set)) {
      const decl = decls.merged[authorId];
      if (!decl) {
        throw new AuthorError(
          'INVALID_AUTHOR_PARAM',
          `unknown authorId "${authorId}"; declared params: ${declaredIds.length > 0 ? declaredIds.join(', ') : '(none)'}`,
        );
      }
      const problems = jsonProblems(value, `set[${authorId}]`, []);
      if (problems.length > 0) {
        throw new AuthorError('INVALID_PARAM_VALUE', problems.join('; '));
      }
      if (decl.validate) {
        const verdict = decl.validate(value);
        if (verdict !== true) {
          throw new AuthorError('INVALID_PARAM_VALUE', `${authorId}: ${typeof verdict === 'string' ? verdict : 'validation failed'}`);
        }
      }
    }

    const digest = bodyDigest({ kind: 'patch', experienceDigest: exp.digest, set: sortSetForDigest(set), baseRevision });
    return await store.withLock(dir, async () => {
      const replay = await idempotentReplay(dir, commandId, digest, diagnostics);
      if (replay) return { ...replay, experienceDigest: exp.digest };

      const headState = await store.readHead(dir);
      if (headState.recovered) {
        diagnostics.push({ code: 'HEAD_RECOVERED', message: `head file was corrupt; recovered to revision ${headState.id ?? '(empty history)'}`, phase: 'write' });
      }
      if (headState.id !== baseRevision) {
        throw new AuthorError(
          'REVISION_CONFLICT',
          `baseRevision ${baseRevision ?? '(none)'} does not match current head ${headState.id ?? '(none)'} — read the head, then retry`,
        );
      }

      const overrides = await readOverrides(exp.root);
      const changes = nullProto();
      for (const [authorId, after] of Object.entries(set)) {
        changes[authorId] = { before: effectiveValue(overrides, decls, authorId), after };
      }

      const defaults = defaultsOf(decls);
      let baseParams = defaults;
      if (headState.id !== null) {
        const headRevision = await store.loadRevision(dir, headState.id);
        if (!headRevision) {
          throw new AuthorError('REVISION_MISSING', `head revision ${headState.id} is missing from the store`);
        }
        baseParams = { ...defaults, ...(headRevision.params ?? {}) };
      }
      const appliedParams = { ...baseParams };
      for (const [authorId, change] of Object.entries(changes)) appliedParams[authorId] = change.after;

      const revision = {
        id: store.newRevisionId(),
        kind: 'patch',
        baseRevisionId: headState.id,
        commandId,
        createdAt: new Date().toISOString(),
        experienceDigest: exp.digest,
        changes,
        params: appliedParams,
      };
      await store.writeFileAtomic(join(dir, 'revisions', `${revision.id}.json`), JSON.stringify(revision, null, 2));
      const nextOverrides = computeOverrides(overrides, appliedParams, decls);
      await store.writeFileAtomic(join(exp.root, 'params.overrides.json'), JSON.stringify(nextOverrides, null, 2) + '\n');
      await store.writeFileAtomic(join(dir, 'head'), `${revision.id}\n`);
      await store.appendJsonLine(join(dir, 'commands.jsonl'), {
        commandId,
        revisionId: revision.id,
        bodyDigest: digest,
        kind: 'patch',
        createdAt: revision.createdAt,
      });
      return revisionEnvelope(revision, nextOverrides, diagnostics, exp.digest);
    });
  } catch (err) {
    return toEnvelopeError(err);
  }
}

// ---------------------------------------------------------------------------
// author undo / redo
// ---------------------------------------------------------------------------

function invertChanges(changes) {
  const inverted = nullProto();
  for (const [authorId, change] of Object.entries(changes)) {
    inverted[authorId] = { before: change.after, after: change.before };
  }
  return inverted;
}

async function undoRedo(flags, kind) {
  try {
    const commandId = commandIdOf(flags);
    const { exp, dir } = await openStoreFor(flags.experience);
    const decls = await loadDeclaredParams(exp.root, exp.manifest);
    const diagnostics = [...decls.diagnostics];
    const digest = bodyDigest({ kind, experienceDigest: exp.digest });

    return await store.withLock(dir, async () => {
      const replay = await idempotentReplay(dir, commandId, digest, diagnostics);
      if (replay) return { ...replay, experienceDigest: exp.digest };

      const headState = await store.readHead(dir);
      if (headState.recovered) {
        diagnostics.push({ code: 'HEAD_RECOVERED', message: `head file was corrupt; recovered to revision ${headState.id ?? '(empty history)'}`, phase: 'write' });
      }
      if (headState.id === null) {
        throw new AuthorError(`REVISION_NOTHING_TO_${kind.toUpperCase()}`, `no revisions yet — nothing to ${kind}`);
      }
      const headRevision = await store.loadRevision(dir, headState.id);
      if (!headRevision) {
        throw new AuthorError('REVISION_MISSING', `head revision ${headState.id} is missing from the store`);
      }

      const overrides = await readOverrides(exp.root);
      const defaults = defaultsOf(decls);

      let targetRevision;
      let appliedParams;
      let changes;
      let extra;
      if (kind === 'undo') {
        if (headRevision.kind === 'undo') {
          throw new AuthorError('REVISION_NOTHING_TO_UNDO', `head ${headRevision.id} is already an undo; nothing to undo`);
        }
        targetRevision = headRevision;
        changes = invertChanges(targetRevision.changes ?? {});
        const baseRevision = targetRevision.baseRevisionId ? await store.loadRevision(dir, targetRevision.baseRevisionId) : null;
        if (targetRevision.baseRevisionId && !baseRevision) {
          throw new AuthorError('REVISION_MISSING', `base revision ${targetRevision.baseRevisionId} of ${targetRevision.id} is missing`);
        }
        appliedParams = { ...defaults, ...((baseRevision && baseRevision.params) || {}) };
        extra = { undoOf: targetRevision.id };
      } else {
        if (headRevision.kind !== 'undo') {
          throw new AuthorError('REVISION_NOTHING_TO_REDO', `head ${headRevision.id} is not an undo; nothing to redo`);
        }
        targetRevision = headRevision.undoOf ? await store.loadRevision(dir, headRevision.undoOf) : null;
        if (!targetRevision) {
          throw new AuthorError('REVISION_MISSING', `undo ${headRevision.id} does not name a retrievable revision to redo`);
        }
        if (targetRevision.kind === 'undo') {
          throw new AuthorError('REVISION_CONFLICT', `cannot redo ${targetRevision.id}: an undo cannot be redone directly`);
        }
        changes = targetRevision.changes ?? {};
        appliedParams = { ...defaults, ...(targetRevision.params || {}) };
        extra = { redoOf: targetRevision.id };
      }

      // Freshness: the live overlay must match what the target believes is
      // current, otherwise someone changed values outside the history and
      // we must never overwrite their work.
      for (const [authorId, change] of Object.entries(changes)) {
        const current = effectiveValue(overrides, decls, authorId);
        if (!isDeepStrictEqual(current, change.before)) {
          throw new AuthorError(
            'REVISION_CONFLICT',
            `cannot ${kind} ${targetRevision.id}: live value of ${authorId} does not match the recorded value for this point in history (changed outside the revision log) — refusing to overwrite`,
          );
        }
      }

      const revision = {
        id: store.newRevisionId(),
        kind,
        baseRevisionId: headState.id,
        commandId,
        createdAt: new Date().toISOString(),
        experienceDigest: exp.digest,
        changes,
        params: appliedParams,
        ...extra,
      };
      await store.writeFileAtomic(join(dir, 'revisions', `${revision.id}.json`), JSON.stringify(revision, null, 2));
      const nextOverrides = computeOverrides(overrides, appliedParams, decls);
      await store.writeFileAtomic(join(exp.root, 'params.overrides.json'), JSON.stringify(nextOverrides, null, 2) + '\n');
      await store.writeFileAtomic(join(dir, 'head'), `${revision.id}\n`);
      await store.appendJsonLine(join(dir, 'commands.jsonl'), {
        commandId,
        revisionId: revision.id,
        bodyDigest: digest,
        kind,
        createdAt: revision.createdAt,
      });
      return revisionEnvelope(revision, nextOverrides, diagnostics, exp.digest);
    });
  } catch (err) {
    return toEnvelopeError(err);
  }
}

/** author undo --experience <dir> --command-id <id> */
export async function undo(flags) {
  return undoRedo(flags, 'undo');
}

/** author redo --experience <dir> --command-id <id> */
export async function redo(flags) {
  return undoRedo(flags, 'redo');
}
