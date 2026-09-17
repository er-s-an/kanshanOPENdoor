import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../../src/creative/gameplay/state.ts';
import { CreativeError } from '../../src/creative/core/errors.ts';

interface SaveData {
  fear: number;
  flags: string[];
}

const def = {
  schemaVersion: 3,
  metadata: { recovery: 'checkpoint' as const, name: 'save' },
  initial: { fear: 0, flags: [] as string[] },
  serialize: (s: SaveData): SaveData => ({ fear: s.fear, flags: [...s.flags] }),
  restore: (d: SaveData): SaveData => {
    if (typeof d !== 'object' || d === null || typeof d.fear !== 'number' || !Array.isArray(d.flags)) {
      throw new Error('malformed save data');
    }
    return { fear: d.fear, flags: [...d.flags] };
  },
};

test('snapshot/restore round-trips through JSON (S12)', () => {
  const state = createState({ ...def });
  state.update((s) => ({ fear: s.fear + 20, flags: [...s.flags, 'met-sisi'] }));

  const wire = JSON.parse(JSON.stringify(state.snapshot()));
  const restored = createState({ ...def });
  const value = restored.restore(wire);

  assert.deepEqual(value, { fear: 20, flags: ['met-sisi'] });
  assert.equal(restored.value.fear, 20);
  assert.equal(restored.snapshot().schemaVersion, 3);
});

test('restore replaces wholesale — no silent merge of stale keys', () => {
  const state = createState({ ...def });
  state.update((s) => ({ fear: 99, flags: ['stale-flag-that-must-vanish'] }));
  const snapshot = createState({ ...def, initial: { fear: 5, flags: ['fresh'] } }).snapshot();

  state.restore(snapshot);
  assert.deepEqual(state.value, { fear: 5, flags: ['fresh'] });
  assert.equal('stale-flag-that-must-vanish' in state.value, false);
});

test('unknown schemaVersion restore is an honest error and leaves state untouched', () => {
  const state = createState({ ...def });
  state.update((s) => ({ ...s, fear: 42 }));
  let caught: unknown = null;
  try {
    state.restore({ schemaVersion: 2, data: { fear: 1, flags: [] } });
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof CreativeError, 'expected a CreativeError');
  assert.equal((caught as CreativeError).code, 'SCHEMA_VERSION_MISMATCH');
  assert.equal(state.value.fear, 42, 'failed restore must not touch current state');
});

test('malformed snapshot (non-object / missing version) is an honest error', () => {
  const state = createState({ ...def });
  let caught: unknown = null;
  try {
    state.restore({ data: { fear: 1, flags: [] } });
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof CreativeError);
  assert.equal((caught as CreativeError).code, 'BAD_SNAPSHOT');
});

test('recovery strategy is declared metadata, both variants accepted', () => {
  const checkpoint = createState({ ...def, metadata: { recovery: 'checkpoint' } });
  assert.equal(checkpoint.metadata.recovery, 'checkpoint');
  const resumable = createState({ ...def, metadata: { recovery: 'resumable' } });
  assert.equal(resumable.metadata.recovery, 'resumable');
});

test('bad definition rejected at construction', () => {
  let caught: unknown = null;
  try {
    createState({ ...def, metadata: { recovery: 'whatever' as never } });
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof CreativeError);
  assert.equal((caught as CreativeError).code, 'BAD_STATE_DEF');
});
