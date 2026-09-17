/**
 * Scope: per-instance ownership of resources, subscriptions, tasks and
 * late-callback isolation.
 *
 * Rules (ENGINE-SYSTEMS §1):
 * - Own resources are disposed at scope dispose; borrowed (leased) resources
 *   are released back to their cache, never disposed.
 * - After dispose, any late async callback guarded by the scope is a no-op:
 *   it must not re-mount or mutate a destroyed instance.
 * - Dispose is idempotent; cleanup errors are collected, not thrown through,
 *   so one failing cleanup never blocks the rest (G02.a).
 */
export interface DisposableLike {
  dispose(): void;
}

export interface BorrowedHandle<T> {
  readonly value: T;
  release(): void;
}

export type Cleanup = () => void;

interface Entry {
  kind: 'own' | 'release' | 'cleanup';
  run: Cleanup;
}

export class Scope {
  private entries: Entry[] = [];
  private disposed = false;
  private readonly abort = new AbortController();
  /** Errors thrown by cleanups during dispose, in registration order. */
  readonly disposeErrors: unknown[] = [];

  get signal(): AbortSignal {
    return this.abort.signal;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  /** Register an owned disposable (or cleanup) for scope dispose. */
  own<T extends DisposableLike>(resource: T): T {
    this.push({ kind: 'own', run: () => resource.dispose() });
    return resource;
  }

  /** Register a borrowed/leased handle: released at scope dispose, never disposed. */
  borrow<T>(handle: BorrowedHandle<T>): T {
    this.push({ kind: 'release', run: () => handle.release() });
    return handle.value;
  }

  /** Register an arbitrary cleanup (unsubscribe, cancel, DOM removal, ...). */
  defer(cleanup: Cleanup): Cleanup {
    this.push({ kind: 'cleanup', run: cleanup });
    return cleanup;
  }

  /**
   * Wrap a callback so it becomes a no-op once the scope is disposed.
   * Use for every async continuation that touches the instance.
   */
  guard<A extends unknown[]>(fn: (...args: A) => void): (...args: A) => void {
    return (...args: A) => {
      if (this.disposed) return;
      fn(...args);
    };
  }

  /**
   * Resolve a promise into a guarded callback. If the scope is gone when the
   * promise settles, the callback never runs; optional onLate receives the
   * settled value so the caller can release the late resource instead.
   */
  settle<T>(promise: Promise<T>, onValue: (value: T) => void, onLate?: (value: T) => void): void {
    promise.then(
      (value) => {
        if (this.disposed) onLate?.(value);
        else onValue(value);
      },
      () => {
        /* rejections are the producer's responsibility */
      },
    );
  }

  private push(entry: Entry): void {
    if (this.disposed) {
      // Registering after dispose: run immediately so nothing leaks.
      try {
        entry.run();
      } catch (err) {
        this.disposeErrors.push(err);
      }
      return;
    }
    this.entries.push(entry);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abort.abort();
    // Reverse registration order: dependents release before their bases.
    for (let i = this.entries.length - 1; i >= 0; i -= 1) {
      try {
        this.entries[i].run();
      } catch (err) {
        this.disposeErrors.push(err);
      }
    }
    this.entries = [];
  }
}
