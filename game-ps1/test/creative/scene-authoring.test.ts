import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exposeParameters, type ParameterBinding } from '../../src/creative/scene/authoring.ts';

function makeRegistry() {
  const applied: number[] = [];
  const registry = exposeParameters([
    {
      authorId: 'lamp.brightness',
      schemaVersion: 1,
      description: 'Floor lamp emissive intensity',
      value: 0.5,
      validate: (v: number) => (Number.isFinite(v) && v >= 0 && v <= 1 ? true : `brightness must be within 0..1, got ${v}`),
      apply: (v: number) => applied.push(v),
    },
    {
      authorId: 'door.state',
      schemaVersion: 2,
      value: 'closed',
    },
  ]);
  return { registry, applied };
}

test('exposeParameters: get/list expose bindings with declared metadata', () => {
  const { registry } = makeRegistry();
  const lamp = registry.get('lamp.brightness');
  assert.ok(lamp);
  assert.equal(lamp.authorId, 'lamp.brightness');
  assert.equal(lamp.schemaVersion, 1);
  assert.equal(lamp.description, 'Floor lamp emissive intensity');
  assert.equal(lamp.value, 0.5);
  assert.equal(registry.get('missing'), undefined);
  assert.deepEqual(registry.list().map((b) => b.authorId), ['lamp.brightness', 'door.state']);
});

test('set: valid value commits, runs apply, updates get', () => {
  const { registry, applied } = makeRegistry();
  const result = registry.set('lamp.brightness', 0.8);
  assert.deepEqual(result, { ok: true });
  assert.equal(registry.get('lamp.brightness')!.value, 0.8);
  assert.deepEqual(applied, [0.8], 'apply receives the accepted value');
});

test('set: invalid value is rejected with a reason and the old value is kept', () => {
  const { registry, applied } = makeRegistry();
  const result = registry.set('lamp.brightness', 1.5);
  assert.equal(result.ok, false);
  assert.match(result.reason!, /within 0\.\.1/);
  assert.equal(registry.get('lamp.brightness')!.value, 0.5, 'old value kept');
  assert.deepEqual(applied, [], 'apply not called on rejection');
});

test('set: unknown authorId is rejected with a reason', () => {
  const { registry } = makeRegistry();
  const result = registry.set('nope', 1);
  assert.equal(result.ok, false);
  assert.match(result.reason!, /unknown authorId/);
});

test('onChange: fires on accepted values only, unsubscribe works', () => {
  const { registry } = makeRegistry();
  const seen: number[] = [];
  const unsubscribe = registry.onChange('lamp.brightness', (v) => seen.push(v as number));
  registry.set('lamp.brightness', 0.7);
  registry.set('lamp.brightness', 2); // rejected: no listener call
  assert.deepEqual(seen, [0.7]);
  unsubscribe();
  registry.set('lamp.brightness', 0.2);
  assert.deepEqual(seen, [0.7], 'no calls after unsubscribe');
});

test('binding.onChange: per-binding listener with unsubscribe', () => {
  const { registry } = makeRegistry();
  const binding = registry.get('lamp.brightness')! as ParameterBinding<number>;
  const seen: number[] = [];
  const off = binding.onChange((v) => seen.push(v));
  binding.set(0.9);
  assert.deepEqual(seen, [0.9]);
  off();
  binding.set(0.1);
  assert.deepEqual(seen, [0.9]);
});

test('snapshot: serializable map with per-parameter schemaVersion, no functions', () => {
  const { registry } = makeRegistry();
  registry.set('door.state', 'open');
  const snap = registry.snapshot();
  assert.deepEqual(snap, {
    'lamp.brightness': { authorId: 'lamp.brightness', schemaVersion: 1, value: 0.5 },
    'door.state': { authorId: 'door.state', schemaVersion: 2, value: 'open' },
  });
  // schemaVersion mismatch between parameters is visible in the snapshot.
  assert.equal(snap['lamp.brightness'].schemaVersion, 1);
  assert.equal(snap['door.state'].schemaVersion, 2);
  // Functions never serialize: a JSON round trip loses nothing.
  const roundTripped = JSON.parse(JSON.stringify(snap));
  assert.deepEqual(roundTripped, snap);
  // Snapshot is a copy: later sets do not mutate it.
  registry.set('lamp.brightness', 0.3);
  assert.equal(snap['lamp.brightness'].value, 0.5);
});

test('registries are independent per-session objects', () => {
  const a = exposeParameters([{ authorId: 'x', schemaVersion: 1, value: 1 }]);
  const b = exposeParameters([{ authorId: 'x', schemaVersion: 1, value: 2 }]);
  a.set('x', 10);
  assert.equal(b.get('x')!.value, 2);
});

test('duplicate authorId throws at declaration time', () => {
  assert.throws(
    () => exposeParameters([
      { authorId: 'x', schemaVersion: 1, value: 1 },
      { authorId: 'x', schemaVersion: 2, value: 2 },
    ]),
    /duplicate authorId/,
  );
});

test('invalid declarations throw at declaration time', () => {
  assert.throws(() => exposeParameters([{ authorId: '', schemaVersion: 1, value: 1 }]), /non-empty/);
  assert.throws(() => exposeParameters([{ authorId: 'x', schemaVersion: Number.NaN, value: 1 }]), /schemaVersion/);
});
