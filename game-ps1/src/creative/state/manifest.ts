/**
 * Experience manifest + digest (M5a).
 *
 * `experience.json` at the experience root declares the entry module,
 * runtime API version and checkpoint schema version:
 *
 *   {
 *     "format": "kanshan-experience",
 *     "formatVersion": 1,
 *     "entry": "src/main.ts",
 *     "runtimeApiVersion": "r1.0",
 *     "checkpointSchemaVersion": 1,
 *     "params": { ... },                       // optional, JSON
 *     "assets": [{ "key": "tex/wall", "path": "assets/wall.png" }],  // optional
 *     "sourceRecord": { "ref": "story/blue-blood" }                  // optional
 *   }
 *
 * `parseExperienceManifest` validates structure and returns honest errors —
 * a missing entry or wrong format is never silently accepted.
 * `digestExperience` computes the experienceDigest from real files via an
 * injectable `ExperienceFileReader`, normalizing listed paths to logical
 * relative paths before they reach identity.ts (which rejects absolute
 * paths by construction). Two clean checkouts of the same content at
 * different absolute roots therefore share one digest; any file change
 * isolates it.
 */
import { CreativeError } from '../core/errors.ts';
import { experienceDigest } from '../core/identity.ts';
import type { CodeInput, ExperienceIdentityInputs } from '../core/identity.ts';
import { sha256Hex } from '@kanshan/story-contract';
import { jsonProblems } from './checkpoint-store.ts';

export const EXPERIENCE_MANIFEST_FILENAME = 'experience.json';

export interface ManifestAssetRef {
  /** Logical asset key used by modules. */
  key: string;
  /** Logical relative path inside the experience. */
  path: string;
}

export interface SourceRecordRef {
  /** Opaque reference to the authoring source record. */
  ref: string;
}

export interface ExperienceManifest {
  format: 'kanshan-experience';
  formatVersion: 1;
  /** Logical relative path of the entry module. */
  entry: string;
  runtimeApiVersion: string;
  checkpointSchemaVersion: number;
  params?: unknown;
  assets?: ManifestAssetRef[];
  sourceRecord?: SourceRecordRef;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Structural problems of a raw manifest value; an empty array means the
 * value is a usable `ExperienceManifest`.
 */
export function manifestProblems(raw: unknown): string[] {
  const problems: string[] = [];
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    problems.push('manifest: expected an object');
    return problems;
  }
  const value = raw as Record<string, unknown>;

  if (value.format !== 'kanshan-experience') {
    problems.push(`format: expected "kanshan-experience", got ${JSON.stringify(value.format)}`);
  }
  if (value.formatVersion !== 1) {
    problems.push(`formatVersion: expected 1, got ${JSON.stringify(value.formatVersion)}`);
  }

  if (!('entry' in value) || value.entry === undefined) {
    problems.push('entry: missing field');
  } else if (typeof value.entry !== 'string' || value.entry.length === 0) {
    problems.push('entry: expected a non-empty string');
  } else {
    try {
      normalizeLogicalPath(value.entry);
    } catch (err) {
      problems.push(`entry: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (!('runtimeApiVersion' in value) || value.runtimeApiVersion === undefined) {
    problems.push('runtimeApiVersion: missing field');
  } else if (typeof value.runtimeApiVersion !== 'string' || value.runtimeApiVersion.length === 0) {
    problems.push('runtimeApiVersion: expected a non-empty string');
  }

  if (!('checkpointSchemaVersion' in value) || value.checkpointSchemaVersion === undefined) {
    problems.push('checkpointSchemaVersion: missing field');
  } else if (
    typeof value.checkpointSchemaVersion !== 'number' ||
    !Number.isInteger(value.checkpointSchemaVersion) ||
    (value.checkpointSchemaVersion as number) < 1
  ) {
    problems.push('checkpointSchemaVersion: expected an integer >= 1');
  }

  if ('params' in value && value.params !== undefined) {
    jsonProblems(value.params, 'params', problems);
  }

  if ('assets' in value && value.assets !== undefined) {
    if (!Array.isArray(value.assets)) {
      problems.push('assets: expected an array');
    } else {
      for (let i = 0; i < value.assets.length; i += 1) {
        const asset = value.assets[i] as unknown;
        const at = `assets[${i}]`;
        if (asset === null || typeof asset !== 'object' || Array.isArray(asset)) {
          problems.push(`${at}: expected an object with key/path`);
          continue;
        }
        const ref = asset as Record<string, unknown>;
        if (typeof ref.key !== 'string' || ref.key.length === 0) {
          problems.push(`${at}.key: expected a non-empty string`);
        }
        if (typeof ref.path !== 'string' || ref.path.length === 0) {
          problems.push(`${at}.path: expected a non-empty string`);
        } else {
          try {
            normalizeLogicalPath(ref.path);
          } catch (err) {
            problems.push(`${at}.path: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }
    }
  }

  if ('sourceRecord' in value && value.sourceRecord !== undefined) {
    const ref = value.sourceRecord;
    if (ref === null || typeof ref !== 'object' || Array.isArray(ref)) {
      problems.push('sourceRecord: expected an object with a ref');
    } else if (typeof (ref as Record<string, unknown>).ref !== 'string' || (ref as Record<string, unknown>).ref === '') {
      problems.push('sourceRecord.ref: expected a non-empty string');
    }
  }

  return problems;
}

/** Validate and return a typed manifest; throws CreativeError MANIFEST_INVALID. */
export function parseExperienceManifest(raw: unknown): ExperienceManifest {
  const problems = manifestProblems(raw);
  if (problems.length > 0) {
    throw new CreativeError('MANIFEST_INVALID', `invalid experience manifest: ${problems.join('; ')}`, {
      phase: 'create',
    });
  }
  const value = raw as Record<string, unknown>;
  const manifest: ExperienceManifest = {
    format: 'kanshan-experience',
    formatVersion: 1,
    entry: normalizeLogicalPath(value.entry as string),
    runtimeApiVersion: value.runtimeApiVersion as string,
    checkpointSchemaVersion: value.checkpointSchemaVersion as number,
  };
  if (value.params !== undefined) manifest.params = value.params;
  if (value.assets !== undefined) {
    manifest.assets = (value.assets as Record<string, unknown>[]).map((a) => ({
      key: a.key as string,
      path: normalizeLogicalPath(a.path as string),
    }));
  }
  if (value.sourceRecord !== undefined) {
    manifest.sourceRecord = { ref: (value.sourceRecord as Record<string, unknown>).ref as string };
  }
  return manifest;
}

// ---------------------------------------------------------------------------
// File reader + digest
// ---------------------------------------------------------------------------

/**
 * Injectable file surface. `listFiles` returns paths as they exist on the
 * host — absolute checkout paths are fine; `digestExperience` normalizes
 * them to logical relative paths against `root`.
 */
export interface ExperienceFileReader {
  listFiles(root: string): Promise<string[]>;
  readFile(path: string): Promise<string | Uint8Array>;
}

export interface DigestExperienceOptions {
  /** Absolute (or relative) checkout root, used only to relativize paths. */
  root: string;
  reader: ExperienceFileReader;
  /** Manifest file path relative to root; defaults to experience.json. */
  manifestPath?: string;
}

export interface DigestedExperience {
  manifest: ExperienceManifest;
  digest: string;
  /** Logical relative paths of every file that fed the digest, sorted. */
  files: string[];
}

/**
 * Load the manifest from real files and compute the experienceDigest over
 * the declared code files (every listed file except the manifest itself,
 * whose content is represented by the parsed fields). Honest errors:
 * unreadable/malformed manifest, missing entry file, unreadable code file.
 */
export async function digestExperience(opts: DigestExperienceOptions): Promise<DigestedExperience> {
  const manifestPath = normalizeLogicalPath(opts.manifestPath ?? EXPERIENCE_MANIFEST_FILENAME);
  let rawManifest: unknown;
  try {
    const text = await opts.reader.readFile(joinPath(opts.root, manifestPath));
    rawManifest = JSON.parse(typeof text === 'string' ? text : new TextDecoder().decode(text));
  } catch (err) {
    throw new CreativeError(
      'MANIFEST_UNREADABLE',
      `cannot read manifest at "${manifestPath}": ${err instanceof Error ? err.message : String(err)}`,
      { phase: 'create', cause: err },
    );
  }
  const manifest = parseExperienceManifest(rawManifest);

  const listed = await opts.reader.listFiles(opts.root);
  const logical = new Map<string, string>();
  for (const path of listed) {
    const rel = relativize(opts.root, path);
    if (rel === manifestPath) continue;
    if (logical.has(rel)) {
      throw new CreativeError(
        'MANIFEST_DUPLICATE_PATH',
        `experience lists the same logical path twice: "${rel}"`,
        { phase: 'create' },
      );
    }
    logical.set(rel, path);
  }
  if (!logical.has(manifest.entry)) {
    throw new CreativeError(
      'MANIFEST_ENTRY_MISSING',
      `manifest entry "${manifest.entry}" is not present in the experience files`,
      { phase: 'create' },
    );
  }

  const code: CodeInput[] = [];
  for (const rel of [...logical.keys()].sort()) {
    let content: string | Uint8Array;
    try {
      content = await opts.reader.readFile(logical.get(rel)!);
    } catch (err) {
      throw new CreativeError(
        'EXPERIENCE_FILE_UNREADABLE',
        `cannot read experience file "${rel}": ${err instanceof Error ? err.message : String(err)}`,
        { phase: 'create', cause: err },
      );
    }
    code.push({ path: rel, content });
  }

  // Declared assets are hashed from their real bytes, so an asset change
  // isolates the identity exactly like a code change.
  let assets: { key: string; contentDigest: string }[] | undefined;
  if (manifest.assets) {
    assets = [];
    for (const asset of manifest.assets) {
      const hostPath = logical.get(asset.path);
      if (!hostPath) {
        throw new CreativeError(
          'MANIFEST_ASSET_MISSING',
          `manifest asset "${asset.key}" points at "${asset.path}", which is not present in the experience files`,
          { phase: 'create' },
        );
      }
      let content: string | Uint8Array;
      try {
        content = await opts.reader.readFile(hostPath);
      } catch (err) {
        throw new CreativeError(
          'EXPERIENCE_FILE_UNREADABLE',
          `cannot read manifest asset "${asset.key}" at "${asset.path}": ${err instanceof Error ? err.message : String(err)}`,
          { phase: 'create', cause: err },
        );
      }
      assets.push({ key: asset.key, contentDigest: sha256Hex(content) });
    }
  }

  const inputs: ExperienceIdentityInputs = {
    format: manifest.format,
    formatVersion: manifest.formatVersion,
    runtimeApiVersion: manifest.runtimeApiVersion,
    checkpointSchemaVersion: manifest.checkpointSchemaVersion,
    code,
    params: manifest.params ?? null,
    assets,
    sourceRecord: manifest.sourceRecord ?? null,
  };
  return {
    manifest,
    digest: experienceDigest(inputs),
    files: code.map((c) => c.path),
  };
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/** Same logical-path rules as identity.ts: relative, normalized, no escapes. */
function normalizeLogicalPath(path: string): string {
  const p = path.replace(/\\/g, '/');
  if (p.startsWith('/') || /^[A-Za-z]:\//.test(p)) {
    throw new Error(`path must be relative to the experience root: ${path}`);
  }
  const parts: string[] = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') throw new Error(`path escapes root: ${path}`);
    parts.push(seg);
  }
  if (parts.length === 0) throw new Error(`path is empty: ${path}`);
  return parts.join('/');
}

/** Join for display/fs purposes only; the result is normalized later. */
function joinPath(root: string, rel: string): string {
  if (root.endsWith('/')) return root + rel;
  return `${root}/${rel}`;
}

/**
 * Reduce a listed path to a logical relative path. Absolute paths are
 * relativized against the checkout root (two different roots therefore
 * yield the same logical paths); already-relative paths are validated.
 */
export function relativize(root: string, path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const normalizedRoot = root.replace(/\\/g, '/').replace(/\/+$/, '');
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
    const prefix = `${normalizedRoot}/`;
    if (!normalized.startsWith(prefix)) {
      throw new CreativeError(
        'EXPERIENCE_PATH_OUTSIDE_ROOT',
        `file "${path}" is outside experience root "${root}"`,
        { phase: 'create' },
      );
    }
    return normalizeLogicalPath(normalized.slice(prefix.length));
  }
  return normalizeLogicalPath(normalized);
}
