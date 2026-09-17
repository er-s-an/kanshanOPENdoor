/**
 * The real vite step of engine-cli build (G16): programmatic vite build with
 * the experience directory as vite root and the manifest entry module as the
 * rollup input. Nothing is faked — the bundle is produced from real files by
 * the same toolchain the browser host uses.
 *
 * Two details are load-bearing, both discovered against vite 6:
 *  - preserveEntrySignatures: 'strict'. Vite's app-mode build otherwise
 *    strips the entry's export statements, every engine binding becomes
 *    "unused" and rollup treeshakes the whole experience into an empty
 *    three.js-only shell that still reports success.
 *  - assetsInlineLimit: 0. Asset imports stay real files on disk so the
 *    export closure check verifies genuine files instead of data: URLs.
 *
 * The custom logger keeps vite off stdout: the CLI contract is exactly one
 * JSON ToolEnvelope on stdout, so vite info/warn output is captured into the
 * report's diagnostics instead.
 */
import { build as viteBuild, createLogger } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectBundleBytes, toPosix } from './build-files.mjs';

const ANSI = /\x1b\[[0-9;]*m/g;

/** Logger that swallows vite's console output and folds warn/error lines into
 *  the report diagnostics (deduped, ANSI-stripped). */
export function createSilentBuildLogger(diagnostics) {
  const logger = createLogger('info', { prefix: '[build]' });
  const seen = new Set();
  const push = (code, msg) => {
    const text = String(msg).replace(ANSI, '').trim();
    if (text.length === 0 || seen.has(text)) return;
    seen.add(text);
    diagnostics.push({ code, message: text });
  };
  logger.info = () => {};
  logger.warn = (m) => {
    logger.hasWarned = true;
    push('VITE_WARN', m);
  };
  logger.warnOnce = (m) => {
    logger.hasWarned = true;
    push('VITE_WARN', m);
  };
  logger.error = (m) => push('VITE_ERROR', m);
  return logger;
}

/**
 * Run the vite build. Returns { entry, files, bytesByPath } where entry is the
 * posix relative path of the entry chunk and files is the sorted
 * [{path,bytes}] list of everything emitted under outDir. Throws on failure.
 */
/**
 * Run the vite build. Returns { entry, files, bytesByPath } where entry is the
 * posix relative path of the entry chunk and files is the sorted
 * [{path,bytes}] list of everything emitted under outDir. Throws on failure.
 *
 * Safety (R01): outDir must be a directory THIS process created (or an empty
 * one). Vite's emptyOutDir semantics are never pointed at caller-chosen
 * paths; placement at a user path happens in build.mjs after success.
 */
export async function runViteBuild({ experienceDir, entryAbs, outDir, threePath, diagnostics }) {
  // The rollup input is a generated boot entry: it pulls in the browser
  // player shell (renderer + host + RAF loop) and the experience module, so
  // the exported static page is actually playable, not a bare factory.
  const gameDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const bootDir = path.join(outDir, '.boot-tmp');
  const bootEntry = path.join(bootDir, 'entry.mjs');
  await fs.mkdir(bootDir, { recursive: true });
  await fs.writeFile(
    bootEntry,
    [
      `import { bootExperience } from ${JSON.stringify(toPosix(path.join(gameDir, 'src', 'creative', 'boot', 'browser-player.ts')))};`,
      `import * as experience from ${JSON.stringify(toPosix(entryAbs))};`,
      'bootExperience(experience);',
      '',
    ].join('\n'),
    'utf8',
  );
  let result;
  try {
    result = await viteBuild({
      root: experienceDir,
      configFile: false,
      mode: 'production',
      customLogger: createSilentBuildLogger(diagnostics),
      resolve: threePath ? { alias: { three: threePath } } : {},
      build: {
        outDir,
        emptyOutDir: false,
        sourcemap: false,
        minify: true,
        target: 'es2022',
        assetsInlineLimit: 0,
        rollupOptions: {
          input: { main: bootEntry },
          preserveEntrySignatures: 'strict',
        },
      },
    });
  } finally {
    // The boot entry is generated scratch inside our own staging dir.
    await fs.rm(bootDir, { recursive: true, force: true }).catch(() => {});
  }
  const outputs = Array.isArray(result) ? result : [result];
  let entry = null;
  for (const rollupOutput of outputs) {
    for (const item of rollupOutput.output ?? []) {
      if (item.type === 'chunk' && item.isEntry) entry = toPosix(item.fileName);
    }
  }
  const { files, bytesByPath } = await collectBundleBytes(outDir);
  return { entry, files, bytesByPath };
}
