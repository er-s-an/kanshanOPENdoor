/**
 * check — per-experience TYPE checking (F08). Vite only transpiles TS; this
 * command runs the real tsc over the experience's entry plus the engine
 * sources it imports, with a generated tsconfig, so type errors in a new
 * work fail here even when the bundle build would "succeed".
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ok, fail } from './envelope.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const GAME_DIR = path.resolve(MODULE_DIR, '..', '..');

export async function check({ experience } = {}) {
  if (typeof experience !== 'string' || experience.length === 0) {
    return fail('INVALID_EXPERIENCE', 'check needs --experience <dir>');
  }
  const experienceDir = path.resolve(process.cwd(), experience);
  const manifestPath = path.join(experienceDir, 'experience.json');
  if (!fs.existsSync(manifestPath)) {
    return fail('MISSING_EXPERIENCE', `no experience.json under "${experienceDir}"`);
  }
  let entry;
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    entry = manifest.entry;
  } catch (err) {
    return fail('MANIFEST_INVALID', `experience.json unreadable: ${err.message}`);
  }
  if (typeof entry !== 'string' || !fs.existsSync(path.join(experienceDir, entry))) {
    return fail('MANIFEST_ENTRY_MISSING', `entry "${entry}" not found under ${experienceDir}`);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanshan-check-'));
  const tsconfigPath = path.join(tmpDir, 'tsconfig.json');
  const baseConfig = JSON.parse(fs.readFileSync(path.join(GAME_DIR, 'tsconfig.json'), 'utf8'));
  const config = {
    ...baseConfig,
    compilerOptions: {
      ...baseConfig.compilerOptions,
      // Experience sources are plain project files; keep the same strictness.
      noEmit: true,
      allowImportingTsExtensions: true,
    },
    include: [
      path.join(experienceDir, '**', '*'),
      path.join(GAME_DIR, 'src', '**', '*'),
    ],
  };
  try {
    fs.writeFileSync(tsconfigPath, JSON.stringify(config, null, 2));
    const tsc = spawnSync(
      process.execPath,
      [path.join(GAME_DIR, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', tsconfigPath, '--noEmit'],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 180_000 },
    );
    const output = `${tsc.stdout ?? ''}${tsc.stderr ?? ''}`.trim();
    if (tsc.status === 0) {
      return ok({ experience: path.basename(experienceDir), entry, checked: true, diagnostics: [] });
    }
    const diagnostics = output
      .split('\n')
      .filter((line) => line.includes('error TS'))
      .slice(0, 50)
      .map((line) => ({ code: 'TYPE_ERROR', message: line }));
    return fail('TYPE_CHECK_FAILED', `tsc reported ${diagnostics.length} type error(s) in ${experienceDir}`, {
      data: { experience: path.basename(experienceDir), entry, checked: false, diagnostics },
    });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
