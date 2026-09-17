import { test } from 'node:test';
import assert from 'node:assert/strict';
import { experienceDigest } from '../../src/creative/core/identity.ts';
import type { ExperienceIdentityInputs } from '../../src/creative/core/identity.ts';

function inputs(overrides?: Partial<ExperienceIdentityInputs>): ExperienceIdentityInputs {
  return {
    format: 'kanshan-experience',
    formatVersion: 1,
    runtimeApiVersion: 'r1.0',
    checkpointSchemaVersion: 1,
    code: [
      { path: 'src/scene.ts', content: 'export const x = 1' },
      { path: 'src/rooms/hall.ts', content: 'export const y = 2' },
    ],
    params: { doorWidth: 1.2 },
    assets: [{ key: 'tex/wall', contentDigest: 'a'.repeat(64) }],
    ...overrides,
  };
}

test('same content in two clean directories yields the same experienceDigest (G11)', () => {
  const a = experienceDigest(inputs());
  // Same logical content, rebuilt elsewhere: paths are relative by contract,
  // so the checkout location never enters the digest. File order is normalized.
  const b = experienceDigest(
    inputs({
      code: [
        { path: 'src/rooms/hall.ts', content: 'export const y = 2' },
        { path: 'src/scene.ts', content: 'export const x = 1' },
      ],
    }),
  );
  assert.equal(a, b);
});

test('absolute or escaping paths are rejected, never hashed', () => {
  assert.throws(() =>
    experienceDigest(inputs({ code: [{ path: '/Users/x/scene.ts', content: 'x' }] })),
  );
  assert.throws(() => experienceDigest(inputs({ code: [{ path: '../outside.ts', content: 'x' }] })));
});

test('code, param or asset changes isolate the identity (G11)', () => {
  const base = experienceDigest(inputs());
  assert.notEqual(experienceDigest(inputs({ params: { doorWidth: 1.3 } })), base);
  assert.notEqual(
    experienceDigest(inputs({ code: [{ path: 'src/scene.ts', content: 'export const x = 2' }] })),
    base,
  );
  assert.notEqual(
    experienceDigest(inputs({ assets: [{ key: 'tex/wall', contentDigest: 'b'.repeat(64) }] })),
    base,
  );
});

test('build-time-only fields are not part of identity inputs by construction', () => {
  // The input type has no build timestamp/path fields; adding unknown data to
  // params is the caller's choice, but the digest itself is deterministic.
  const a = experienceDigest(inputs());
  const b = experienceDigest(inputs());
  assert.equal(a, b);
});
