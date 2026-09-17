/**
 * OPTIONAL inventory module (S12). Pure library: zero imports, no core
 * hooks, no host coupling — a work that never imports it pays nothing.
 *
 * - add/remove/has/count over item ids with typed change events.
 * - JSON-serializable state with schemaVersion-checked restore.
 * - Capacity and author rules are injected, never hard-coded: a rejected
 *   add/remove is a result, not an exception, and emits no event.
 */

export type InventoryErrorCode =
  | 'BAD_ARGUMENT'
  | 'CAPACITY_EXCEEDED'
  | 'RULE_REJECTED'
  | 'INSUFFICIENT_ITEMS'
  | 'BAD_SNAPSHOT'
  | 'SCHEMA_VERSION_MISMATCH';

export class InventoryError extends Error {
  readonly code: InventoryErrorCode;

  constructor(code: InventoryErrorCode, message: string) {
    super(message);
    this.name = 'InventoryError';
    this.code = code;
  }
}

/** One typed inventory change. `total` is the new count for the item; `size` total units held. */
export interface InventoryChange {
  readonly type: 'added' | 'removed';
  readonly itemId: string;
  readonly count: number;
  readonly total: number;
  readonly size: number;
}

/** Author-injected rule. Return true to allow; a string rejects with that reason. */
export interface InventoryRule {
  readonly id: string;
  canAdd?(itemId: string, count: number, current: ReadonlyMap<string, number>): true | string;
}

export type AddResult = { ok: true; change: InventoryChange } | { ok: false; reason: string };
export type RemoveResult = { ok: true; change: InventoryChange } | { ok: false; reason: string };

export interface InventorySnapshot {
  schemaVersion: number;
  items: Record<string, number>;
}

export const INVENTORY_SCHEMA_VERSION = 1;

export interface InventoryOptions {
  /** Maximum total units held; undefined = unbounded. */
  capacity?: number;
  /** Author rules consulted before capacity on every add. */
  rules?: readonly InventoryRule[];
}

export class Inventory {
  private readonly capacity: number | undefined;
  private readonly rules: readonly InventoryRule[];
  private readonly items = new Map<string, number>();
  private readonly listeners = new Set<(change: InventoryChange) => void>();

  constructor(options: InventoryOptions = {}) {
    if (options.capacity !== undefined && (!Number.isInteger(options.capacity) || options.capacity < 0)) {
      throw new InventoryError('BAD_ARGUMENT', 'capacity must be a non-negative integer');
    }
    this.capacity = options.capacity;
    this.rules = options.rules ?? [];
  }

  get size(): number {
    let total = 0;
    for (const count of this.items.values()) total += count;
    return total;
  }

  get capacityLimit(): number | undefined {
    return this.capacity;
  }

  count(itemId: string): number {
    return this.items.get(itemId) ?? 0;
  }

  has(itemId: string, count = 1): boolean {
    return this.count(itemId) >= count;
  }

  entries(): [string, number][] {
    return [...this.items.entries()];
  }

  /** Subscribe to typed changes; returns an unsubscribe function. */
  onChange(listener: (change: InventoryChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Rules first, then capacity. Rejections change nothing and emit nothing. */
  add(itemId: string, count = 1): AddResult {
    assertArgs(itemId, count);
    for (const rule of this.rules) {
      if (!rule.canAdd) continue;
      const verdict = rule.canAdd(itemId, count, this.items);
      if (verdict !== true) {
        return { ok: false, reason: `rule "${rule.id}": ${typeof verdict === 'string' ? verdict : 'rejected'}` };
      }
    }
    const nextSize = this.size + count;
    if (this.capacity !== undefined && nextSize > this.capacity) {
      return { ok: false, reason: `capacity ${this.capacity} exceeded (would hold ${nextSize})` };
    }
    const total = this.count(itemId) + count;
    this.items.set(itemId, total);
    return { ok: true, change: this.emit({ type: 'added', itemId, count, total, size: nextSize }) };
  }

  remove(itemId: string, count = 1): RemoveResult {
    assertArgs(itemId, count);
    const current = this.count(itemId);
    if (current < count) {
      return { ok: false, reason: `insufficient ${itemId}: have ${current}, need ${count}` };
    }
    const total = current - count;
    const size = this.size - count;
    if (total === 0) this.items.delete(itemId);
    else this.items.set(itemId, total);
    return { ok: true, change: this.emit({ type: 'removed', itemId, count, total, size }) };
  }

  /** Serializable excerpt; never carries listeners or rules. */
  snapshot(): InventorySnapshot {
    const items: Record<string, number> = {};
    for (const [id, count] of this.items) items[id] = count;
    return { schemaVersion: INVENTORY_SCHEMA_VERSION, items };
  }

  /** Wholesale replace from a snapshot; unknown versions reject honestly. */
  restore(snapshot: unknown): void {
    const items = readSnapshotItems(snapshot);
    this.items.clear();
    for (const [id, count] of items) this.items.set(id, count);
  }

  private emit(change: InventoryChange): InventoryChange {
    for (const listener of [...this.listeners]) listener(change);
    return change;
  }
}

function assertArgs(itemId: string, count: number): void {
  if (typeof itemId !== 'string' || itemId.length === 0) {
    throw new InventoryError('BAD_ARGUMENT', 'itemId must be a non-empty string');
  }
  if (!Number.isInteger(count) || count < 1) {
    throw new InventoryError('BAD_ARGUMENT', 'count must be a positive integer');
  }
}

function readSnapshotItems(snapshot: unknown): Map<string, number> {
  if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) {
    throw new InventoryError('BAD_SNAPSHOT', 'inventory snapshot must be an object { schemaVersion, items }');
  }
  const version = (snapshot as { schemaVersion?: unknown }).schemaVersion;
  if (version !== INVENTORY_SCHEMA_VERSION) {
    throw new InventoryError(
      'SCHEMA_VERSION_MISMATCH',
      `inventory snapshot schemaVersion ${String(version)} does not match ${INVENTORY_SCHEMA_VERSION}`,
    );
  }
  const raw = (snapshot as { items?: unknown }).items;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new InventoryError('BAD_SNAPSHOT', 'inventory snapshot items must be an object');
  }
  const items = new Map<string, number>();
  for (const [id, count] of Object.entries(raw)) {
    if (!Number.isInteger(count) || (count as number) < 0) {
      throw new InventoryError('BAD_SNAPSHOT', `inventory count for "${id}" must be a non-negative integer`);
    }
    if ((count as number) > 0) items.set(id, count as number);
  }
  return items;
}
