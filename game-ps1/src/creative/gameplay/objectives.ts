/**
 * OPTIONAL objectives module (S12). Ids + progress committed through a
 * CommitLog-backed channel, completion queries, and double-award protection
 * at two layers:
 * - the channel dedupes by eventId (replay an interaction -> 'duplicate');
 * - the tracker short-circuits once an objective is complete, so even fresh
 *   eventIds cannot re-trigger the completion award.
 */
import type { CommitChannel, CommitReceiptLike } from './commit.ts';

export type ObjectiveErrorCode = 'UNKNOWN_OBJECTIVE' | 'BAD_ARGUMENT' | 'BAD_SNAPSHOT' | 'SCHEMA_VERSION_MISMATCH';

export class ObjectiveError extends Error {
  readonly code: ObjectiveErrorCode;

  constructor(code: ObjectiveErrorCode, message: string) {
    super(message);
    this.name = 'ObjectiveError';
    this.code = code;
  }
}

export interface ObjectiveDefinition {
  id: string;
  /** Progress units required; default 1. */
  target?: number;
  title?: string;
}

/** Payload committed for every accepted progress unit. */
export interface ObjectiveProgressPayload {
  objectiveId: string;
  amount: number;
  total: number;
  completed: boolean;
}

export type ProgressResult =
  | { applied: true; total: number; completed: boolean }
  | { applied: false; status: 'duplicate' | 'already-complete' };

export interface ObjectiveSnapshot {
  schemaVersion: number;
  progress: Record<string, number>;
}

export const OBJECTIVES_SCHEMA_VERSION = 1;

export interface ObjectiveTrackerOptions {
  objectives: readonly ObjectiveDefinition[];
  commit: CommitChannel;
  /** Event namespace; default 'objectives'. */
  eventNamespace?: string;
}

interface ObjectiveState {
  target: number;
  title: string | undefined;
  total: number;
  completionCommitted: boolean;
}

export class ObjectiveTracker {
  private readonly states = new Map<string, ObjectiveState>();
  private readonly commit: CommitChannel;
  private readonly namespace: string;

  constructor(options: ObjectiveTrackerOptions) {
    this.commit = options.commit;
    this.namespace = options.eventNamespace ?? 'objectives';
    for (const def of options.objectives) {
      if (this.states.has(def.id)) {
        throw new ObjectiveError('BAD_ARGUMENT', `duplicate objective id "${def.id}"`);
      }
      const target = def.target ?? 1;
      if (!Number.isInteger(target) || target < 1) {
        throw new ObjectiveError('BAD_ARGUMENT', `objective "${def.id}" target must be a positive integer`);
      }
      this.states.set(def.id, { target, title: def.title, total: 0, completionCommitted: false });
    }
  }

  isComplete(id: string): boolean {
    const state = this.mustGet(id);
    return state.total >= state.target;
  }

  progressOf(id: string): number {
    return this.mustGet(id).total;
  }

  targetOf(id: string): number {
    return this.mustGet(id).target;
  }

  completed(): string[] {
    return [...this.states.entries()].filter(([, s]) => s.total >= s.target).map(([id]) => id);
  }

  /**
   * Apply one progress step. `eventId` identifies the whole application:
   * replaying the same interaction yields the same eventId, the channel
   * reports 'duplicate', and local totals are NOT bumped again.
   * Once complete, further progress is an honest 'already-complete' no-op.
   */
  progress(id: string, amount = 1, eventId?: string): ProgressResult {
    const state = this.mustGet(id);
    if (!Number.isInteger(amount) || amount < 1) {
      throw new ObjectiveError('BAD_ARGUMENT', 'amount must be a positive integer');
    }
    if (state.total >= state.target) {
      return { applied: false, status: 'already-complete' };
    }
    const key = eventId ?? `${this.namespace}:${id}:${state.total + amount}`;
    const receipt: CommitReceiptLike = this.commit.commit(
      `${this.namespace}.progress`,
      { objectiveId: id, amount } satisfies Record<string, unknown>,
      key,
    );
    if (receipt.status === 'duplicate') {
      return { applied: false, status: 'duplicate' };
    }
    state.total = Math.min(state.total + amount, state.target);
    const completed = state.total >= state.target;
    if (completed) this.commitCompletion(id, state);
    return { applied: true, total: state.total, completed };
  }

  /** Serializable progress excerpt (completed is derived from targets). */
  snapshot(): ObjectiveSnapshot {
    const progress: Record<string, number> = {};
    for (const [id, state] of this.states) progress[id] = state.total;
    return { schemaVersion: OBJECTIVES_SCHEMA_VERSION, progress };
  }

  /** Restore progress; completed state is re-derived, never re-committed. */
  restore(snapshot: unknown): void {
    const progress = readSnapshotProgress(snapshot);
    for (const [id, total] of progress) {
      this.mustGet(id).total = Math.min(total, this.mustGet(id).target);
    }
  }

  private commitCompletion(id: string, state: ObjectiveState): void {
    // Idempotent completion key: even if this exact commit is replayed, the
    // channel dedupes it — no double award.
    const key = `${this.namespace}:${id}:completed`;
    const receipt = this.commit.commit(`${this.namespace}.completed`, { objectiveId: id }, key);
    if (receipt.status === 'committed') state.completionCommitted = true;
  }

  private mustGet(id: string): ObjectiveState {
    const state = this.states.get(id);
    if (!state) throw new ObjectiveError('UNKNOWN_OBJECTIVE', `unknown objective "${id}"`);
    return state;
  }
}

function readSnapshotProgress(snapshot: unknown): Map<string, number> {
  if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) {
    throw new ObjectiveError('BAD_SNAPSHOT', 'objectives snapshot must be an object { schemaVersion, progress }');
  }
  const version = (snapshot as { schemaVersion?: unknown }).schemaVersion;
  if (version !== OBJECTIVES_SCHEMA_VERSION) {
    throw new ObjectiveError(
      'SCHEMA_VERSION_MISMATCH',
      `objectives snapshot schemaVersion ${String(version)} does not match ${OBJECTIVES_SCHEMA_VERSION}`,
    );
  }
  const raw = (snapshot as { progress?: unknown }).progress;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ObjectiveError('BAD_SNAPSHOT', 'objectives snapshot progress must be an object');
  }
  const progress = new Map<string, number>();
  for (const [id, total] of Object.entries(raw)) {
    if (!Number.isInteger(total) || (total as number) < 0) {
      throw new ObjectiveError('BAD_SNAPSHOT', `progress for "${id}" must be a non-negative integer`);
    }
    progress.set(id, total as number);
  }
  return progress;
}
