import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXPERIENCE_MANIFEST_FILENAME,
  digestExperience,
  manifestProblems,
  parseExperienceManifest,
  relativize,
} from '../../src/creative/state/manifest.ts';
import { experienceDigest } from '../../src/creative/core/identity.ts';
import { sha256Hex } from '@kanshan/story-contract';
import { CreativeError } from '../../src/creative/core/errors.ts';
import type { ExperienceFileReader } from '../../src/creative/state/manifest.ts';

const MANIFEST_JSON = JSON.stringify({
  format: 'kanshan-experience',
  formatVersion: 1,
  entry: 'src/main.ts',
  runtimeApiVersion: 'r1.0',
  checkpointSchemaVersion: 1,
  params: { doorWidth: 1.2 },
  assets: [{ key: 'tex/wall', path: 'assets/wall.png' }],
  sourceRecord: { ref: 'story/blue-blood' },
});

const CODE_FILES: Record<string, string> = {
  'experience.json': MANIFEST_JSON,
  'src/main.ts': 'export const scene = "dock";\n',
  'src/rooms/hall.ts': 'export const room = "hall";\n',
  'assets/wall.png': 'png-bytes',
};

/** Simulated checkout: absolute paths under `root`, content by relative key. */
function checkout(root: string, files: Record<string, string>): ExperienceFileReader {
  const map = new Map<string, string>();
  for (const [rel, content] of Object.entries(files)) map.set(`${root}/${rel}`, content);
  return {
    async listFiles(r: string): Promise<string[]> {
      return [...map.keys()].filter((k) => k.startsWith(`${r}/`));
    },
    async readFile(path: string): Promise<string> {
      const content = map.get(path);
      if (content === undefined) throw new Error(`ENOENT: no such file: ${path}`);
      return content;
    },
  };
}

function expectCreativeError(fn: () => unknown, code: string): void {
  let caught: unknown = null;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof CreativeError, `expected CreativeError ${code}, got ${caught}`);
  assert.equal((caught as CreativeError).code, code);
}

// ---------------------------------------------------------------------------
// Digest (G11)
// ---------------------------------------------------------------------------

test('digest is stable across two simulated clean checkouts (different roots, same files)', async () => {
  const a = await digestExperience({ root: '/tmp/checkout-a', reader: checkout('/tmp/checkout-a', CODE_FILES) });
  // Same content, different absolute root (windows-style this time) and a
  // different listing order.
  const shuffled: Record<string, string> = {};
  const keys = Object.keys(CODE_FILES).reverse();
  for (const k of keys) shuffled[k] = CODE_FILES[k];
  const b = await digestExperience({
    // Windows-style drive-letter root: exercises absolute-path detection
    // in relativize (identity itself never sees these paths).
    root: 'C:/builds/checkout-b',
    reader: checkout('C:/builds/checkout-b', shuffled),
  });

  assert.equal(a.digest, b.digest);
  // Cross-check against the core identity over the same logical inputs.
  const expected = experienceDigest({
    format: 'kanshan-experience',
    formatVersion: 1,
    runtimeApiVersion: 'r1.0',
    checkpointSchemaVersion: 1,
    code: [
      { path: 'assets/wall.png', content: 'png-bytes' },
      { path: 'src/main.ts', content: 'export const scene = "dock";\n' },
      { path: 'src/rooms/hall.ts', content: 'export const room = "hall";\n' },
    ],
    params: { doorWidth: 1.2 },
    assets: [{ key: 'tex/wall', contentDigest: sha256Hex('png-bytes') }],
    sourceRecord: { ref: 'story/blue-blood' },
  });
  assert.equal(a.digest, expected);
  assert.deepEqual(a.files, ['assets/wall.png', 'src/main.ts', 'src/rooms/hall.ts']);
});

test('any file change isolates the digest (change isolation)', async () => {
  const base = await digestExperience({ root: '/r', reader: checkout('/r', CODE_FILES) });

  const codeChange = { ...CODE_FILES, 'src/rooms/hall.ts': 'export const room = "cellar";\n' };
  assert.notEqual(
    (await digestExperience({ root: '/r', reader: checkout('/r', codeChange) })).digest,
    base.digest,
  );

  const paramsChange = {
    ...CODE_FILES,
    'experience.json': MANIFEST_JSON.replace('1.2', '1.3'),
  };
  assert.notEqual(
    (await digestExperience({ root: '/r', reader: checkout('/r', paramsChange) })).digest,
    base.digest,
  );

  const extraFile = { ...CODE_FILES, 'src/new.ts': 'export const z = 26;\n' };
  assert.notEqual(
    (await digestExperience({ root: '/r', reader: checkout('/r', extraFile) })).digest,
    base.digest,
  );
});

test('relativize maps host paths to logical relative paths and rejects escapes', () => {
  assert.equal(relativize('/tmp/checkout-a', '/tmp/checkout-a/src/main.ts'), 'src/main.ts');
  assert.equal(relativize('/r', 'src/rooms/./hall.ts'), 'src/rooms/hall.ts');
  expectCreativeError(
    () => relativize('/tmp/checkout-a', '/somewhere-else/src/main.ts'),
    'EXPERIENCE_PATH_OUTSIDE_ROOT',
  );
  // Relative escaping paths fail normalization with a plain Error.
  assert.throws(() => relativize('/r', '../outside.ts'), /escapes root/);
});

test('manifest file outside the root cannot be relativized by digestExperience', async () => {
  const reader = checkout('/r', CODE_FILES);
  // Poison listFiles with a path outside root.
  const poisoned: ExperienceFileReader = {
    listFiles: async () => [...(await reader.listFiles('/r')), '/evil/elsewhere.ts'],
    readFile: (p) => reader.readFile(p),
  };
  let caught: unknown = null;
  try {
    await digestExperience({ root: '/r', reader: poisoned });
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof CreativeError);
  assert.equal((caught as CreativeError).code, 'EXPERIENCE_PATH_OUTSIDE_ROOT');
});

// ---------------------------------------------------------------------------
// Manifest validation
// ---------------------------------------------------------------------------

test('parseExperienceManifest returns a typed manifest with normalized fields', () => {
  const manifest = parseExperienceManifest(JSON.parse(MANIFEST_JSON));
  assert.equal(manifest.format, 'kanshan-experience');
  assert.equal(manifest.formatVersion, 1);
  assert.equal(manifest.entry, 'src/main.ts');
  assert.equal(manifest.runtimeApiVersion, 'r1.0');
  assert.equal(manifest.checkpointSchemaVersion, 1);
  assert.deepEqual(manifest.params, { doorWidth: 1.2 });
  assert.deepEqual(manifest.assets, [{ key: 'tex/wall', path: 'assets/wall.png' }]);
  assert.deepEqual(manifest.sourceRecord, { ref: 'story/blue-blood' });
});

test('manifestProblems lists everything wrong without throwing', () => {
  const problems = manifestProblems({
    format: 'other-format',
    formatVersion: 2,
    entry: '/absolute/main.ts',
    runtimeApiVersion: '',
    checkpointSchemaVersion: 0,
    params: { fn: () => 1 },
    assets: [{ key: '', path: '../escape.png' }],
    sourceRecord: {},
  });
  assert.ok(problems.some((p) => p.startsWith('format:')));
  assert.ok(problems.some((p) => p.startsWith('formatVersion:')));
  assert.ok(problems.some((p) => p.startsWith('entry:')));
  assert.ok(problems.some((p) => p.startsWith('runtimeApiVersion:')));
  assert.ok(problems.some((p) => p.startsWith('checkpointSchemaVersion:')));
  assert.ok(problems.some((p) => p.includes('params.fn')));
  assert.ok(problems.some((p) => p.startsWith('assets[0].key')));
  assert.ok(problems.some((p) => p.startsWith('assets[0].path')));
  assert.ok(problems.some((p) => p.startsWith('sourceRecord.ref')));
});

test('missing entry or invalid format is an honest MANIFEST_INVALID error', () => {
  expectCreativeError(
    () => parseExperienceManifest({ format: 'kanshan-experience', formatVersion: 1, runtimeApiVersion: 'r1.0', checkpointSchemaVersion: 1 }),
    'MANIFEST_INVALID',
  );
  expectCreativeError(
    () => parseExperienceManifest({ format: 'nope', formatVersion: 1, entry: 'src/main.ts', runtimeApiVersion: 'r1.0', checkpointSchemaVersion: 1 }),
    'MANIFEST_INVALID',
  );
  expectCreativeError(
    () => parseExperienceManifest({ format: 'kanshan-experience', formatVersion: 1, entry: '../x.ts', runtimeApiVersion: 'r1.0', checkpointSchemaVersion: 1 }),
    'MANIFEST_INVALID',
  );
  expectCreativeError(() => parseExperienceManifest(null), 'MANIFEST_INVALID');
  expectCreativeError(() => parseExperienceManifest('x'), 'MANIFEST_INVALID');
});

test('manifest defaults: no optional sections required', () => {
  const manifest = parseExperienceManifest({
    format: 'kanshan-experience',
    formatVersion: 1,
    entry: 'src/main.ts',
    runtimeApiVersion: 'r1.0',
    checkpointSchemaVersion: 1,
  });
  assert.equal(manifest.params, undefined);
  assert.equal(manifest.assets, undefined);
  assert.equal(manifest.sourceRecord, undefined);
});

test('missing entry file on disk is an honest MANIFEST_ENTRY_MISSING error', async () => {
  const files = { ...CODE_FILES };
  delete files['src/main.ts'];
  let caught: unknown = null;
  try {
    await digestExperience({ root: '/r', reader: checkout('/r', files) });
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof CreativeError);
  assert.equal((caught as CreativeError).code, 'MANIFEST_ENTRY_MISSING');
});

test('manifest asset pointing at a missing file is an honest MANIFEST_ASSET_MISSING error', async () => {
  const files = { ...CODE_FILES };
  delete files['assets/wall.png'];
  let caught: unknown = null;
  try {
    await digestExperience({ root: '/r', reader: checkout('/r', files) });
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof CreativeError);
  assert.equal((caught as CreativeError).code, 'MANIFEST_ASSET_MISSING');
});

test('changing only an asset file isolates the digest', async () => {
  const base = await digestExperience({ root: '/r', reader: checkout('/r', CODE_FILES) });
  const assetChange = { ...CODE_FILES, 'assets/wall.png': 'different-png-bytes' };
  assert.notEqual(
    (await digestExperience({ root: '/r', reader: checkout('/r', assetChange) })).digest,
    base.digest,
  );
});

test('unreadable or malformed manifest is an honest MANIFEST_UNREADABLE error', async () => {
  let caught: unknown = null;
  try {
    await digestExperience({ root: '/r', reader: checkout('/r', { ...CODE_FILES, 'experience.json': '{not json' }) });
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof CreativeError);
  assert.equal((caught as CreativeError).code, 'MANIFEST_UNREADABLE');

  caught = null;
  try {
    await digestExperience({ root: '/r', reader: { listFiles: async () => [], readFile: async () => { throw new Error('gone'); } } });
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof CreativeError);
  assert.equal((caught as CreativeError).code, 'MANIFEST_UNREADABLE');
});

test('duplicate logical paths are rejected instead of hashed ambiguously', async () => {
  const reader = checkout('/r', CODE_FILES);
  // A host path that normalizes to an already-listed logical path.
  const dup: ExperienceFileReader = {
    listFiles: async () => [...(await reader.listFiles('/r')), '/r/src//main.ts'],
    readFile: (p) => reader.readFile(p),
  };
  let caught: unknown = null;
  try {
    await digestExperience({ root: '/r', reader: dup });
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof CreativeError);
  assert.equal((caught as CreativeError).code, 'MANIFEST_DUPLICATE_PATH');
});

test('manifest filename is configurable', async () => {
  const files: Record<string, string> = { ...CODE_FILES, 'custom.json': MANIFEST_JSON };
  delete files[EXPERIENCE_MANIFEST_FILENAME];
  const result = await digestExperience({
    root: '/r',
    reader: checkout('/r', files),
    manifestPath: 'custom.json',
  });
  assert.equal(result.manifest.entry, 'src/main.ts');
  assert.equal(result.files.includes('custom.json'), false);
});
