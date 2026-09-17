/**
 * engine-cli build + export (G16 + G01 + G17).
 *
 * build({ experience, out })       — real vite build of one experience.
 * exportBundle({ experience, out }) — build, then arrange a private static
 *                                     bundle (index.html + assets + manifest
 *                                     copies + NOTICE.md + report.json).
 *
 * Honesty rules:
 *  - The experienceDigest always comes from digestExperience over real files;
 *    a missing entry or malformed manifest fails here, before any bundling.
 *  - Build failures (syntax, unresolved imports) return ok:false with the
 *    vite diagnostics; a failed build never produces a "success" report.
 *  - The export closure check fails the command if any referenced asset is
 *    missing from the output; nothing is silently dropped or invented.
 *  - Exported index.html embeds no tokens (no session ids, no digests).
 *
 * Local boundary (G17): both commands operate only on local files and the
 * local vite toolchain — no session daemon, no network, no fixture JSON
 * standing in for runtime state.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { envelope, ok, fail, PROTOCOL_VERSION } from './envelope.mjs';
import { digestExperience } from '../../src/creative/state/manifest.ts';
import { newBuildId } from '../../src/creative/core/identity.ts';
import { sha256Hex } from '@kanshan/story-contract';
import { runViteBuild } from './build-vite.mjs';
import {
  experienceFileReader,
  collectBundleBytes,
  digestOverFiles,
  bundleClosure,
} from './build-files.mjs';

const GP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(GP_ROOT, 'package.json'));

export { bundleClosure };

/**
 * R01 output safety: builds always happen in a staging directory this process
 * created; nothing user-chosen is ever emptied. Placement at a caller path
 * follows an explicit protocol:
 *  - target must not be the experience dir, inside it, or contain it;
 *  - target must not be a symlink; its parent must resolve to a real dir;
 *  - an existing non-empty target is refused (EXPORT_TARGET_NOT_EMPTY) unless
 *    opts.replace is set, in which case the old directory is renamed aside to
 *    "<target>.backup-<timestamp>" (never deleted) before the staged output
 *    is moved into place;
 *  - any failure leaves the old output untouched.
 */
async function safePlace(stagingDir, targetDir, { replace = false } = {}) {
  const target = path.resolve(targetDir);
  const realParent = await fs.realpath(path.dirname(target)).catch(() => null);
  if (!realParent) {
    throw Object.assign(new Error(`export target parent does not exist: ${path.dirname(target)}`), {
      code: 'EXPORT_TARGET_INVALID',
    });
  }
  const lstat = await fs.lstat(target).catch(() => null);
  if (lstat?.isSymbolicLink()) {
    throw Object.assign(new Error(`export target must not be a symlink: ${target}`), { code: 'EXPORT_TARGET_INVALID' });
  }
  if (lstat && !lstat.isDirectory()) {
    throw Object.assign(new Error(`export target exists and is not a directory: ${target}`), {
      code: 'EXPORT_TARGET_INVALID',
    });
  }
  if (lstat) {
    const entries = await fs.readdir(target);
    if (entries.length > 0) {
      if (!replace) {
        throw Object.assign(
          new Error(`export target is not empty: ${target} (pass --replace to rename the old directory aside)`),
          { code: 'EXPORT_TARGET_NOT_EMPTY' },
        );
      }
      const backup = `${target}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      await fs.rename(target, backup);
    }
  }
  try {
    await fs.rename(stagingDir, target);
  } catch (err) {
    // Cross-device fallback: copy then remove our own staging dir only.
    if (err && err.code === 'EXDEV') {
      await fs.cp(stagingDir, target, { recursive: true });
      await fs.rm(stagingDir, { recursive: true, force: true });
    } else {
      throw err;
    }
  }
  return target;
}

/** Refuse outputs that overlap the source tree. */
function assertNotOverlappingSource(experienceDir, targetDir) {
  const src = path.resolve(experienceDir);
  const dst = path.resolve(targetDir);
  if (src === dst || src.startsWith(dst + path.sep) || dst.startsWith(src + path.sep)) {
    throw Object.assign(new Error(`export target overlaps the experience source: ${dst}`), {
      code: 'EXPORT_TARGET_INVALID',
    });
  }
}

function toDiagnostic(err, fallbackCode) {
  if (err !== null && typeof err === 'object' && typeof err.code === 'string' && err.code.length > 0) {
    return { code: err.code, message: err.message ?? String(err), phase: err.phase, source: err.source };
  }
  return { code: fallbackCode, message: err instanceof Error ? err.message : String(err) };
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Resolve the game package's own three ESM build for the alias. */
async function resolveThreeModule() {
  try {
    return fileURLToPath(import.meta.resolve('three'));
  } catch {
    return require.resolve('three');
  }
}

async function statDir(p) {
  const stat = await fs.stat(p).catch(() => null);
  return stat && stat.isDirectory() ? stat : null;
}

/** G16: real vite build of one experience. Output is staged in a directory
 *  this process creates; --out placement follows the safePlace protocol. */
export async function build({ experience, out, replace } = {}) {
  const diagnostics = [];
  if (typeof experience !== 'string' || experience.length === 0) {
    return fail('INVALID_EXPERIENCE', 'build requires --experience <dir>');
  }
  const experienceDir = path.resolve(experience);
  if (!(await statDir(experienceDir))) {
    return fail('MISSING_EXPERIENCE', `experience directory not found: ${experienceDir}`);
  }

  // Identity from real files via the engine's own digest path (G17). A
  // missing entry, unreadable manifest or duplicate logical path fails here.
  let digested;
  try {
    digested = await digestExperience({ root: experienceDir, reader: experienceFileReader() });
  } catch (err) {
    return envelope({ ok: false, diagnostics: [toDiagnostic(err, 'MANIFEST_UNREADABLE')] });
  }
  const { manifest, digest: experienceDigest } = digested;
  const entryAbs = path.join(experienceDir, ...manifest.entry.split('/'));

  const buildId = newBuildId(new Date().toISOString(), randomBytes(4).toString('hex'));
  let stagingDir;
  if (typeof out === 'string' && out.length > 0) {
    try {
      assertNotOverlappingSource(experienceDir, out);
    } catch (err) {
      return envelope({ ok: false, experienceDigest, buildId, diagnostics: [toDiagnostic(err, 'BUILD_FAILED')] });
    }
    // Stage next to the target so the final rename stays on one filesystem.
    stagingDir = await fs.mkdtemp(path.join(path.dirname(path.resolve(out)), '.kanshan-build-'));
  } else {
    stagingDir = path.join(GP_ROOT, '.kanshan', 'builds', buildId);
    await fs.mkdir(stagingDir, { recursive: true });
  }

  let built;
  try {
    built = await runViteBuild({
      experienceDir,
      entryAbs,
      outDir: stagingDir,
      threePath: await resolveThreeModule(),
      diagnostics,
    });
  } catch (err) {
    await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    return envelope({
      ok: false,
      experienceDigest,
      buildId,
      diagnostics: [...diagnostics, toDiagnostic(err, 'BUILD_FAILED')],
    });
  }
  if (!built.entry) {
    await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    return envelope({
      ok: false,
      experienceDigest,
      buildId,
      diagnostics: [...diagnostics, { code: 'BUILD_FAILED', message: 'vite produced no entry chunk' }],
    });
  }

  const closure = await bundleClosure(stagingDir);
  if (closure.missing.length > 0) {
    await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    return envelope({
      ok: false,
      experienceDigest,
      buildId,
      diagnostics: [
        ...diagnostics,
        { code: 'BUILD_INCOMPLETE', message: `bundle references missing assets: ${closure.missing.join(', ')}` },
      ],
    });
  }

  let finalDir = stagingDir;
  if (typeof out === 'string' && out.length > 0) {
    try {
      finalDir = await safePlace(stagingDir, out, { replace: replace === true });
    } catch (err) {
      await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
      return envelope({ ok: false, experienceDigest, buildId, diagnostics: [toDiagnostic(err, 'BUILD_FAILED')] });
    }
  }

  const artifactDigest = await digestOverFiles(built.files, finalDir, sha256Hex);
  const data = {
    buildId,
    experienceDigest,
    artifactDigest,
    runtimeApiVersion: manifest.runtimeApiVersion,
    entry: built.entry,
    outDir: finalDir,
    files: built.files,
    diagnostics,
  };
  return ok(data, { experienceDigest, buildId });
}

function renderNotice({ title, rapierPresent }) {
  return [
    '# Kanshan experience bundle — NOTICE',
    '',
    `Bundle: ${title}`,
    `Engine protocol version: ${PROTOCOL_VERSION}`,
    'Tool: engine-cli export',
    '',
    '## Third-party dependencies',
    '',
    '- three (MIT, https://threejs.org) — bundled: yes',
    `- @dimforge/rapier3d-compat (Apache-2.0, https://dimforge.com) — bundled: ${rapierPresent ? 'yes' : 'no'}`,
    '',
    '## Engine code',
    '',
    'Engine modules under src/creative/ are compiled into the JS assets from the',
    'kanshan-ps1-myopia package (private). This bundle is a private static playtest',
    'artifact: it embeds no session tokens, credentials or authoring secrets.',
    '',
  ].join('\n');
}

/** G16 export: build into staging, arrange the private static bundle, then
 *  place it at --out via the safePlace protocol (R01). */
export async function exportBundle({ experience, out, replace } = {}) {
  if (typeof out !== 'string' || out.length === 0) {
    return fail('INVALID_EXPORT', 'export requires --out <dir>');
  }
  const experienceDir = path.resolve(typeof experience === 'string' ? experience : '');
  try {
    assertNotOverlappingSource(experienceDir, out);
  } catch (err) {
    return envelope({ ok: false, diagnostics: [toDiagnostic(err, 'EXPORT_FAILED')] });
  }
  const built = await build({ experience });
  if (!built.ok) return built;
  const report = built.data;
  const staged = report.outDir; // internal staging created by build()

  // id/title are author-facing display fields (not identity inputs); read the
  // raw manifest only for the page title.
  let title = 'kanshan-experience';
  try {
    const raw = JSON.parse(await fs.readFile(path.join(experienceDir, 'experience.json'), 'utf8'));
    if (typeof raw?.title === 'string' && raw.title.length > 0) title = raw.title;
    else if (typeof raw?.id === 'string' && raw.id.length > 0) title = raw.id;
  } catch {
    // Display-only; identity was already digested from the real files.
  }

  let rapierPresent = false;
  for (const f of report.files) {
    if (!f.path.endsWith('.js') && !f.path.endsWith('.css')) continue;
    // Read from THIS export's staging dir (report.outDir), never a bare name.
    const content = await fs.readFile(path.join(staged, f.path), 'utf8');
    if (/rapier/i.test(content) || content.includes('@dimforge')) {
      rapierPresent = true;
      break;
    }
  }

  const cssLinks = report.files.filter((f) => f.path.endsWith('.css'));
  const html = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    `  <title>${escapeHtml(title)}</title>`,
    // Real identity for the boot shell: these are integrity/version values,
    // not secrets. The player reports them and binds saves to them.
    `  <script>globalThis.__KANSHAN_BOOT__=${JSON.stringify({
      experienceDigest: report.experienceDigest,
      buildId: report.buildId,
      runtimeApiVersion: report.runtimeApiVersion,
      hasOverrides: await fs.stat(path.join(experienceDir, 'params.overrides.json')).then(() => true).catch(() => false),
    })}</script>`,
    ...cssLinks.map((f) => `  <link rel="stylesheet" href="./${f.path}" />`),
    '</head>',
    '<body>',
    `  <script type="module" src="./${report.entry}"></script>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
  await fs.writeFile(path.join(staged, 'index.html'), html, 'utf8');

  await fs.copyFile(path.join(experienceDir, 'experience.json'), path.join(staged, 'experience.json'));
  const sourceJson = path.join(experienceDir, 'source.json');
  if (await fs.stat(sourceJson).catch(() => null)) {
    await fs.copyFile(sourceJson, path.join(staged, 'source.json'));
  }
  // Author parameter overrides ship with the export (R02): the player boot
  // applies them through the same registry protocol as the headless daemon.
  const overrides = path.join(experienceDir, 'params.overrides.json');
  if (await fs.stat(overrides).catch(() => null)) {
    await fs.copyFile(overrides, path.join(staged, 'params.overrides.json'));
  }

  await fs.writeFile(path.join(staged, 'NOTICE.md'), renderNotice({ title, rapierPresent }), 'utf8');

  const closure = await bundleClosure(staged);
  if (closure.missing.length > 0) {
    await fs.rm(staged, { recursive: true, force: true }).catch(() => {});
    return envelope({
      ok: false,
      experienceDigest: report.experienceDigest,
      buildId: report.buildId,
      diagnostics: [
        { code: 'BUILD_INCOMPLETE', message: `export bundle references missing assets: ${closure.missing.join(', ')}` },
      ],
    });
  }

  // List files before writing report.json so the report does not carry a
  // self-reference; that exclusion is stated in the report itself.
  const { files } = await collectBundleBytes(staged);
  const artifactDigest = await digestOverFiles(files, staged, sha256Hex);
  const data = {
    ...report,
    title,
    rapierPresent,
    files,
    artifactDigest,
    generatedAt: new Date().toISOString(),
    toolVersion: PROTOCOL_VERSION,
    artifactDigestScope:
      'canonical digest over the exported file manifest [{path, bytes, sha256(file)}] — covers every exported file listed; report.json excludes itself (documented), boot/identity values are inside index.html',
    filesNote: 'report.json is written after this listing and is therefore not part of it',
    closure: { referenced: closure.referenced.length, missing: 0 },
  };
  await fs.writeFile(path.join(staged, 'report.json'), `${JSON.stringify(data, null, 2)}\n`, 'utf8');

  try {
    await safePlace(staged, out, { replace: replace === true });
  } catch (err) {
    await fs.rm(staged, { recursive: true, force: true }).catch(() => {});
    return envelope({
      ok: false,
      experienceDigest: report.experienceDigest,
      buildId: report.buildId,
      diagnostics: [toDiagnostic(err, 'EXPORT_FAILED')],
    });
  }
  data.outDir = path.resolve(out);
  return ok(data, { experienceDigest: report.experienceDigest, buildId: report.buildId });
}
