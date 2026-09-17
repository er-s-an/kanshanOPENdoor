/**
 * Author parameter bindings for the later Studio/Agent tools (M6 gizmo and
 * parameter commands). Code stays the source of truth: an author declares
 * parameters next to the objects they drive, and exposeParameters captures
 * live values + validation. The registry is a per-session plain object —
 * no globals, no serialization of functions (snapshot() carries only
 * { authorId, schemaVersion, value }).
 */
import { CreativeError } from '../core/errors.ts';

/** `true` accepts the value; a string rejects it and is surfaced as the reason. */
export type ValidateFn<T> = (value: T) => true | string;
/** Pushes an accepted value into the scene (gizmo drag, param command, ...). */
export type ApplyFn<T> = (value: T) => void;

export interface ParameterDef<T = unknown> {
  /** Author-declared stable identity (M6 binding target). Must be unique per registry. */
  authorId: string;
  /** Schema version of this parameter's value shape; surfaced by snapshot(). */
  schemaVersion: number;
  description?: string;
  value: T;
  /** Method syntax keeps parameter checks bivariant so mixed-type defs infer cleanly. */
  validate?(value: T): true | string;
  apply?(value: T): void;
}

export interface SetResult {
  ok: boolean;
  /** Human-readable rejection reason when ok is false. */
  reason?: string;
}

export interface ParameterSnapshot {
  authorId: string;
  schemaVersion: number;
  value: unknown;
}

export interface ParameterBinding<T = unknown> {
  readonly authorId: string;
  readonly schemaVersion: number;
  readonly description: string | undefined;
  /** Current value. */
  readonly value: T;
  get(): T;
  /**
   * Validates then commits. Invalid values are rejected with a reason and
   * the old value is kept. On acceptance: value stored, apply (if declared)
   * invoked with the new value, then listeners notified. An exception thrown
   * by apply propagates to the caller; the value remains stored.
   */
  set(value: T): SetResult;
  /** Subscribe to accepted changes; returns an unsubscribe function. */
  onChange(listener: (value: T) => void): () => void;
  /** Serializable excerpt; never contains apply/validate functions. */
  snapshot(): ParameterSnapshot;
}

export interface ParameterRegistry {
  get(authorId: string): ParameterBinding | undefined;
  set(authorId: string, value: unknown): SetResult;
  list(): ParameterBinding[];
  /** Subscribe to accepted changes of one parameter. */
  onChange(authorId: string, listener: (value: unknown) => void): () => void;
  /** Serializable map authorId -> { authorId, schemaVersion, value }. */
  snapshot(): Record<string, ParameterSnapshot>;
}

class Binding<T> implements ParameterBinding<T> {
  private readonly def: ParameterDef<T>;
  private readonly notify: (binding: ParameterBinding<T>) => void;
  private current: T;
  private readonly listeners = new Set<(value: T) => void>();

  constructor(def: ParameterDef<T>, notify: (binding: ParameterBinding<T>) => void) {
    this.def = def;
    this.notify = notify;
    this.current = def.value;
  }

  get authorId(): string {
    return this.def.authorId;
  }

  get schemaVersion(): number {
    return this.def.schemaVersion;
  }

  get description(): string | undefined {
    return this.def.description;
  }

  get value(): T {
    return this.current;
  }

  get(): T {
    return this.current;
  }

  set(value: T): SetResult {
    if (this.def.validate) {
      const verdict = this.def.validate(value);
      if (verdict !== true) {
        return { ok: false, reason: typeof verdict === 'string' ? verdict : 'validation failed' };
      }
    }
    this.current = value;
    this.def.apply?.(value);
    for (const listener of [...this.listeners]) listener(value);
    this.notify(this);
    return { ok: true };
  }

  onChange(listener: (value: T) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(): ParameterSnapshot {
    return {
      authorId: this.def.authorId,
      schemaVersion: this.def.schemaVersion,
      value: this.current,
    };
  }
}

/**
 * Creates a per-session binding registry from author parameter definitions.
 * Duplicate authorIds are an author error and throw immediately.
 */
export function exposeParameters(defs: ParameterDef[]): ParameterRegistry {
  const bindings = new Map<string, Binding<unknown>>();
  const registryListeners = new Map<string, Set<(value: unknown) => void>>();

  function registryNotify(binding: ParameterBinding<unknown>): void {
    const listeners = registryListeners.get(binding.authorId);
    if (!listeners) return;
    for (const listener of [...listeners]) listener(binding.value);
  }

  for (const def of defs) {
    if (typeof def.authorId !== 'string' || def.authorId.length === 0) {
      throw new CreativeError('AUTHOR_PARAM_INVALID', 'exposeParameters: authorId must be a non-empty string', { phase: 'create' });
    }
    if (!Number.isFinite(def.schemaVersion)) {
      throw new CreativeError('AUTHOR_PARAM_INVALID', `exposeParameters: ${def.authorId} schemaVersion must be a finite number`, { phase: 'create' });
    }
    if (bindings.has(def.authorId)) {
      throw new CreativeError('AUTHOR_PARAM_DUPLICATE', `exposeParameters: duplicate authorId "${def.authorId}"`, { phase: 'create' });
    }
    bindings.set(def.authorId, new Binding(def as ParameterDef<unknown>, registryNotify));
  }

  return {
    get(authorId: string): ParameterBinding | undefined {
      return bindings.get(authorId);
    },

    set(authorId: string, value: unknown): SetResult {
      const binding = bindings.get(authorId);
      if (!binding) return { ok: false, reason: `unknown authorId "${authorId}"` };
      return binding.set(value);
    },

    list(): ParameterBinding[] {
      return [...bindings.values()];
    },

    onChange(authorId: string, listener: (value: unknown) => void): () => void {
      let listeners = registryListeners.get(authorId);
      if (!listeners) {
        listeners = new Set();
        registryListeners.set(authorId, listeners);
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    snapshot(): Record<string, ParameterSnapshot> {
      const out: Record<string, ParameterSnapshot> = {};
      for (const binding of bindings.values()) {
        out[binding.authorId] = binding.snapshot();
      }
      return out;
    },
  };
}
