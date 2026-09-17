/**
 * Identity: experienceDigest / artifactDigest / buildId.
 *
 * - experienceDigest is the canonical save identity: a digest over the
 *   substantive inputs (module code + direct deps, params, assets, source
 *   record, runtime version/config). It excludes build time, machine or
 *   temporary absolute paths, logs/reports and any digest self-reference, so
 *   the same content rebuilt in two clean directories yields the same
 *   identity and can resume old saves; any change to code/params/assets
 *   isolates saves.
 * - artifactDigest covers the emitted bytes (export integrity).
 * - buildId only tracks one build task; never a save key.
 */
import { canonicalJson, sha256Hex } from '@kanshan/story-contract';

export interface CodeInput {
  /** Logical path relative to the experience root (posix style, no machine prefix). */
  path: string;
  content: string | Uint8Array;
}

export interface AssetInput {
  /** Logical asset key declared by the experience. */
  key: string;
  contentDigest: string;
}

export interface ExperienceIdentityInputs {
  format: 'kanshan-experience';
  formatVersion: number;
  runtimeApiVersion: string;
  checkpointSchemaVersion: number;
  code: CodeInput[];
  params?: unknown;
  assets?: AssetInput[];
  sourceRecord?: unknown;
}

const IDENTITY_FORMAT = 'kanshan-experience-identity';

export function experienceDigest(inputs: ExperienceIdentityInputs): string {
  const code = [...inputs.code]
    .map((f) => ({
      path: normalizeLogicalPath(f.path),
      contentDigest: sha256Hex(typeof f.content === 'string' ? f.content : f.content),
    }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const assets = [...(inputs.assets ?? [])]
    .map((a) => ({ key: a.key, contentDigest: a.contentDigest }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return sha256Hex(
    canonicalJson({
      format: IDENTITY_FORMAT,
      experienceFormat: inputs.format,
      formatVersion: inputs.formatVersion,
      runtimeApiVersion: inputs.runtimeApiVersion,
      checkpointSchemaVersion: inputs.checkpointSchemaVersion,
      code,
      params: inputs.params ?? null,
      assets,
      sourceRecord: inputs.sourceRecord ?? null,
    }),
  );
}

export function artifactDigest(bytes: Uint8Array | string): string {
  return sha256Hex(bytes);
}

export function newBuildId(now: string, random: string): string {
  return `build-${now}-${random}`;
}

function normalizeLogicalPath(path: string): string {
  const p = path.replace(/\\/g, '/');
  // Identity is directory-independent by construction: absolute/machine paths
  // are rejected, never hashed, so the same content rebuilt in two clean
  // directories yields the same digest.
  if (p.startsWith('/') || /^[A-Za-z]:\//.test(p)) {
    throw new Error(`identity path must be relative to the experience root: ${path}`);
  }
  const parts: string[] = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') throw new Error(`identity path escapes root: ${path}`);
    parts.push(seg);
  }
  return parts.join('/');
}
