import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scope } from '../../src/creative/core/scope.ts';

test('own resources dispose in reverse order; borrowed are released not disposed', () => {
  const scope = new Scope();
  const calls: string[] = [];
  scope.own({ dispose: () => calls.push('own-a') });
  scope.own({ dispose: () => calls.push('own-b') });
  scope.borrow({ value: 42, release: () => calls.push('release-c') });
  scope.dispose();
  assert.deepEqual(calls, ['release-c', 'own-b', 'own-a']);
});

test('late callbacks guarded by scope become no-ops after dispose (G02)', async () => {
  const scope = new Scope();
  let mounted = 0;
  const guarded = scope.guard(() => {
    mounted += 1;
  });
  guarded();
  scope.dispose();
  guarded();
  assert.equal(mounted, 1);

  const scope2 = new Scope();
  let settled: string | null = null;
  let late: string | null = null;
  let resolveLate: (v: string) => void = () => {};
  const p = new Promise<string>((res) => {
    resolveLate = res;
  });
  scope2.settle(p, (v) => (settled = v), (v) => (late = v));
  scope2.dispose();
  resolveLate('asset');
  await Promise.resolve();
  assert.equal(settled, null);
  assert.equal(late, 'asset', 'late value routed to onLate for release');
});

test('dispose is idempotent; cleanup errors are collected, not thrown (G02.a)', () => {
  const scope = new Scope();
  const calls: string[] = [];
  scope.defer(() => {
    calls.push('first');
    throw new Error('boom');
  });
  scope.defer(() => calls.push('second'));
  scope.dispose();
  scope.dispose();
  assert.deepEqual(calls, ['second', 'first']);
  assert.equal(scope.disposeErrors.length, 1);
});

test('registering after dispose runs the cleanup immediately (no leak)', () => {
  const scope = new Scope();
  scope.dispose();
  let ran = 0;
  scope.own({ dispose: () => (ran += 1) });
  assert.equal(ran, 1);
});
