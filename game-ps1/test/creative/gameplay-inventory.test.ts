import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Inventory, InventoryError, type InventoryChange } from '../../src/creative/gameplay/inventory.ts';

test('add/has/count/remove basics', () => {
  const inv = new Inventory();
  const added = inv.add('white-dress');
  assert.equal(added.ok, true);
  assert.equal(inv.has('white-dress'), true);
  assert.equal(inv.count('white-dress'), 1);

  inv.add('white-dress', 2);
  assert.equal(inv.count('white-dress'), 3);
  assert.equal(inv.size, 3);

  const removed = inv.remove('white-dress', 2);
  assert.equal(removed.ok, true);
  assert.equal(inv.count('white-dress'), 1);
});

test('removing more than held is a result, not a mutation', () => {
  const inv = new Inventory();
  inv.add('key');
  const result = inv.remove('key', 5);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /insufficient/);
  assert.equal(inv.count('key'), 1, 'failed remove changes nothing');
});

test('removing the last unit deletes the entry', () => {
  const inv = new Inventory();
  inv.add('mop');
  inv.remove('mop');
  assert.equal(inv.has('mop'), false);
  assert.deepEqual(inv.snapshot().items, {});
});

test('capacity rejects overflow without event or mutation', () => {
  const inv = new Inventory({ capacity: 2 });
  const changes: InventoryChange[] = [];
  inv.onChange((c) => changes.push(c));

  assert.equal(inv.add('a').ok, true);
  assert.equal(inv.add('b').ok, true);
  const overflow = inv.add('c');
  assert.equal(overflow.ok, false);
  if (!overflow.ok) assert.match(overflow.reason, /capacity/);
  assert.equal(inv.size, 2);
  assert.equal(changes.length, 2, 'rejected add emits no event');
});

test('author rules are injectable and reject with their reason', () => {
  const inv = new Inventory({
    rules: [{ id: 'no-weapons', canAdd: (itemId) => (itemId === 'knife' ? 'weapons not allowed here' : true) }],
  });
  const denied = inv.add('knife');
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.match(denied.reason, /no-weapons.*weapons not allowed here/);
  assert.equal(inv.has('knife'), false);

  assert.equal(inv.add('towel').ok, true);
});

test('typed change events fire for add and remove with totals', () => {
  const inv = new Inventory();
  const changes: InventoryChange[] = [];
  inv.onChange((c) => changes.push(c));
  const off = inv.onChange(() => assert.fail('unsubscribed listener must not fire'));
  off();

  inv.add('rag', 2);
  inv.remove('rag');
  assert.deepEqual(changes, [
    { type: 'added', itemId: 'rag', count: 2, total: 2, size: 2 },
    { type: 'removed', itemId: 'rag', count: 1, total: 1, size: 1 },
  ]);
});

test('snapshot survives JSON round-trip and restores into a fresh inventory', () => {
  const inv = new Inventory({ capacity: 10 });
  inv.add('towel');
  inv.add('key', 2);
  const wire = JSON.parse(JSON.stringify(inv.snapshot()));

  const restored = new Inventory({ capacity: 10 });
  restored.restore(wire);
  assert.equal(restored.count('towel'), 1);
  assert.equal(restored.count('key'), 2);
  assert.equal(restored.size, 3);
});

test('unknown schemaVersion restore is an honest error', () => {
  const inv = new Inventory();
  let caught: unknown = null;
  try {
    inv.restore({ schemaVersion: 99, items: { key: 1 } });
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof InventoryError);
  assert.equal(caught.code, 'SCHEMA_VERSION_MISMATCH');
});

test('bad arguments throw InventoryError with code', () => {
  const inv = new Inventory();
  let caught: unknown = null;
  try {
    inv.add('', 1);
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof InventoryError);
  assert.equal(caught.code, 'BAD_ARGUMENT');
});

test('module is a pure library: zero core imports (structural check)', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const path = fileURLToPath(import.meta.resolve('../../src/creative/gameplay/inventory.ts'));
  const source = readFileSync(path, 'utf8');
  assert.equal(source.includes('core/'), false, 'inventory must not import the core');
});
