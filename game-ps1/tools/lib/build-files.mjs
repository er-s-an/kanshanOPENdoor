/**
 * Filesystem helpers for engine-cli build/export: the real-file reader that
 * feeds digestExperience, bundle byte collection + artifact digests, and the
 * bundle closure check (every referenced asset must exist on disk). Pure fs
 * functions shared by build.mjs — no envelopes, no vite, no sessions (G17:
 * build/export run entirely against local files).
 */
import { promises as fs } from 'node:fs';
import fsSync from 'node:fs';
import path from 'node:path';

/** Recursive walk; absolute paths of every file under root, sorted. */
export async function walkFiles(root) {
  const out = [];
  async function visit(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) await visit(abs);
      else if (entry.isFile()) out.push(abs);
    }
  }
  await visit(root);
  return out.sort();
}

export function toPosix(p) {
  return p.split(path.sep).join('/');
}

/** Reader over real files for digestExperience: absolute listed paths,
 *  raw bytes as content. */
export function experienceFileReader() {
  return {
    async listFiles(root) {
      return walkFiles(root);
    },
    async readFile(p) {
      return fs.readFile(p);
    },
  };
}

/** Read every file under outDir. Returns sorted [{path,bytes}] (posix, relative)
 *  plus the raw bytes keyed by path for digesting. */
export async function collectBundleBytes(outDir) {
  const absFiles = await walkFiles(outDir);
  const files = [];
  const bytesByPath = new Map();
  for (const abs of absFiles) {
    const buf = await fs.readFile(abs);
    const rel = toPosix(path.relative(outDir, abs));
    files.push({ path: rel, bytes: buf.byteLength });
    bytesByPath.set(rel, buf);
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { files, bytesByPath };
}

/**
 * artifactDigest: SHA-256 over the canonical manifest of the exported files —
 * for each file (sorted by path): its path, byte length, and SHA-256 of its
 * bytes, then the file bytes themselves. Renames, byte changes and chunk
 * boundary changes all change the digest. `dir` is the directory the files
 * live in (files carry relative paths).
 */
export async function digestOverFiles(files, dir, hash) {
  const manifest = files.map((f) => {
    const bytes = fsSync.readFileSync(path.join(dir, f.path));
    return { path: f.path, bytes: bytes.length, sha256: hash(bytes) };
  });
  const parts = [];
  for (const entry of manifest) {
    parts.push(Buffer.from(`${entry.path}:${entry.bytes}:${entry.sha256}\n`, 'utf8'));
    parts.push(fsSync.readFileSync(path.join(dir, entry.path)));
  }
  return hash(Buffer.concat(parts));
}

const EXTERNAL_REF = /^(?:https?:|data:|blob:|mailto:|tel:|#)/i;

function addRelativeRef(set, fromRel, ref) {
  if (typeof ref !== 'string' || ref.length === 0) return;
  if (EXTERNAL_REF.test(ref) || ref.startsWith('//')) return;
  if (!ref.startsWith('./') && !ref.startsWith('../') && !ref.startsWith('/')) return;
  const base = ref.startsWith('/') ? '' : path.posix.dirname(fromRel);
  set.add(path.posix.normalize(path.posix.join(base, ref)));
}

const HTML_REF = /\b(?:src|href)\s*=\s*"([^"]+)"/g;
const JS_STATIC_IMPORT = /\bfrom\s*["']([^"']+)["']/g;
const JS_SIDE_EFFECT_IMPORT = /\bimport\s*["']([^"']+)["']/g;
const JS_DYNAMIC_IMPORT = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
const JS_NEW_URL = /\bnew\s+URL\(\s*["']([^"']+)["']/g;
const CSS_URL = /url\(\s*["']?([^)"'\s]+)["']?\s*\)/g;

/**
 * Closure check over an emitted bundle directory: parse every html/js/css for
 * relative references (script/link src/href, static/dynamic/side-effect js
 * imports, `new URL(..., import.meta.url)`, css url()) and verify each target
 * exists inside outDir. Returns { files, referenced, missing } as sorted posix
 * relative paths; missing.length > 0 means the bundle is not self-contained.
 */
export async function bundleClosure(outDir) {
  const absFiles = await walkFiles(outDir);
  const relSet = new Set(absFiles.map((a) => toPosix(path.relative(outDir, a))));
  const referenced = new Set();
  for (const abs of absFiles) {
    const rel = toPosix(path.relative(outDir, abs));
    const content = await fs.readFile(abs, 'utf8');
    if (rel.endsWith('.html')) {
      for (const m of content.matchAll(HTML_REF)) addRelativeRef(referenced, rel, m[1]);
    } else if (rel.endsWith('.js')) {
      for (const m of content.matchAll(JS_DYNAMIC_IMPORT)) addRelativeRef(referenced, rel, m[1]);
      for (const m of content.matchAll(JS_STATIC_IMPORT)) addRelativeRef(referenced, rel, m[1]);
      for (const m of content.matchAll(JS_SIDE_EFFECT_IMPORT)) addRelativeRef(referenced, rel, m[1]);
      for (const m of content.matchAll(JS_NEW_URL)) addRelativeRef(referenced, rel, m[1]);
    } else if (rel.endsWith('.css')) {
      for (const m of content.matchAll(CSS_URL)) addRelativeRef(referenced, rel, m[1]);
    }
  }
  const missing = [...referenced].filter((r) => !relSet.has(r)).sort();
  return { files: [...relSet].sort(), referenced: [...referenced].sort(), missing };
}
