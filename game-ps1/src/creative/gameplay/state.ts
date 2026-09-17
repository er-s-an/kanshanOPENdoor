/**
 * Module-owned state helper (S12).
 *
 * An author declares everything about a piece of gameplay state:
 *   { schemaVersion, initial, serialize, restore, metadata }
 * and gets a small object that can produce/accept JSON-serializable
 * snapshots. Hard rules:
 * - `restore` is wholesale replacement. An unknown schemaVersion is an
 *   honest error (SCHEMA_VERSION_MISMATCH) — never a silent merge, never a
 *   best-effort partial apply.
 * - `recovery` ('checkpoint' | 'resumable') is declared metadata: it tells a
 *   host how this state may be used after an interruption; the helper does
 *   not implement recovery itself.
 * - The state object is module-owned: callers read `value` and replace it
 *   via set/update; the helper never mutates nested structures for you.
 */
import { CreativeError } from '../core/errors.ts';

export type RecoveryStrategy = 'checkpoint' | 'resumable';

export interface StateMetadata {
  /** How a host may recover this state after an interruption. */
  recovery: RecoveryStrategy;
  /** Author-facing name, surfaced in diagnostics. */
  name?: string;
}

/** Serializable snapshot envelope. `data` must survive a JSON round-trip. */
export interface StateSnapshot<D> {
  schemaVersion: number;
  data: D;
}

export interface StateDefinition<S, D = S> {
  /** Bumped whenever the serialized shape changes; mismatches reject. */
  schemaVersion: number;
  metadata: StateMetadata;
  initial: S;
  /** Project live state into JSON-serializable snapshot data. */
  serialize(state: S): D;
  /** Rebuild live state from snapshot data. Throw on malformed data. */
  restore(data: D): S;
}

export class GameState<S, D = S> {
  private readonly def: StateDefinition<S, D>;
  private current: S;

  constructor(def: StateDefinition<S, D>) {
    if (!Number.isInteger(def.schemaVersion) || def.schemaVersion < 1) {
      throw new CreativeError('BAD_STATE_DEF', 'schemaVersion must be a positive integer', { phase: 'create' });
    }
    if (def.metadata.recovery !== 'checkpoint' && def.metadata.recovery !== 'resumable') {
      throw new CreativeError('BAD_STATE_DEF', `recovery must be 'checkpoint' or 'resumable'`, { phase: 'create' });
    }
    this.def = def;
    this.current = def.initial;
  }

  get value(): S {
    return this.current;
  }

  get schemaVersion(): number {
    return this.def.schemaVersion;
  }

  get metadata(): StateMetadata {
    return this.def.metadata;
  }

  /** Wholesale replacement of the live state. */
  set(next: S): void {
    this.current = next;
  }

  /** Functional update: returns the next state; null/undefined keeps current. */
  update(fn: (state: S) => S): void {
    this.current = fn(this.current);
  }

  /** JSON-serializable snapshot of the current state. */
  snapshot(): StateSnapshot<D> {
    return { schemaVersion: this.def.schemaVersion, data: this.def.serialize(this.current) };
  }

  /**
   * Replace the live state from a snapshot envelope. Rejects unknown or
   * malformed envelopes with an honest error — the current state is left
   * untouched on failure.
   */
  restore(snapshot: unknown): S {
    const version = readSchemaVersion(snapshot);
    if (version !== this.def.schemaVersion) {
      throw new CreativeError(
        'SCHEMA_VERSION_MISMATCH',
        `snapshot schemaVersion ${version} does not match declared ${this.def.schemaVersion}` +
          (this.def.metadata.name ? ` (state "${this.def.metadata.name}")` : ''),
        { phase: 'command' },
      );
    }
    const data = (snapshot as { data: D }).data;
    this.current = this.def.restore(data);
    return this.current;
  }
}

export function createState<S, D = S>(def: StateDefinition<S, D>): GameState<S, D> {
  return new GameState(def);
}

function readSchemaVersion(snapshot: unknown): number | string {
  if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) {
    throw new CreativeError('BAD_SNAPSHOT', 'state snapshot must be an object { schemaVersion, data }', {
      phase: 'command',
    });
  }
  const version = (snapshot as { schemaVersion?: unknown }).schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    throw new CreativeError('BAD_SNAPSHOT', 'snapshot schemaVersion must be an integer', { phase: 'command' });
  }
  return version;
}
