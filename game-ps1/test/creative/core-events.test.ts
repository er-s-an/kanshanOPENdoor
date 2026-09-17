import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CommitLog } from '../../src/creative/core/events.ts';
import { CreativeError } from '../../src/creative/core/errors.ts';

const ctx = { generation: 0, tick: 7 };

test('namespaced commit returns a receipt; duplicate eventId does not apply twice (G11)', () => {
  const log = new CommitLog({ sessionId: 's1', generation: 0 });
  let awarded = 0;
  log.onCommit(() => (awarded += 1));
  const r1 = log.commit('harbor.signal-aligned', { ok: true }, 'evt-1', ctx);
  const r2 = log.commit('harbor.signal-aligned', { ok: true }, 'evt-1', ctx);
  assert.equal(r1.status, 'committed');
  assert.equal(r2.status, 'duplicate');
  assert.equal(awarded, 1, 'duplicate commit must not double-award');
  assert.equal(log.entries.length, 1);
});

test('payload validator rejects bad events without state change (G12 core)', () => {
  const log = new CommitLog({ sessionId: 's1', generation: 0 });
  log.registerValidator('door.*', (p) =>
    typeof p === 'object' && p !== null && 'stage' in (p as Record<string, unknown>) ? true : 'needs stage',
  );
  assert.throws(() => log.commit('door.opened', { wrong: 1 }, 'evt-2', ctx), CreativeError);
  assert.equal(log.entries.length, 0, 'invalid payload never reaches the log');
  const ok = log.commit('door.opened', { stage: 2 }, 'evt-3', ctx);
  assert.equal(ok.status, 'committed');
});

test('stale generation commits are fenced (G11)', () => {
  const log = new CommitLog({ sessionId: 's1', generation: 0 });
  log.fence(1);
  assert.throws(() => log.commit('a.b', {}, 'evt-4', { generation: 0, tick: 1 }), (e) => (e as CreativeError).code === 'STALE_GENERATION');
  assert.equal(log.commit('a.b', {}, 'evt-5', { generation: 1, tick: 1 }).status, 'committed');
});

test('commits during render phase are rejected (G02: interpolation must not commit facts)', () => {
  const log = new CommitLog({ sessionId: 's1', generation: 0 });
  log.setCommitsAllowed(false);
  assert.throws(() => log.commit('a.b', {}, 'evt-6', ctx), (e) => (e as CreativeError).code === 'COMMIT_IN_RENDER');
  log.setCommitsAllowed(true);
  assert.equal(log.commit('a.b', {}, 'evt-6', ctx).status, 'committed');
});
