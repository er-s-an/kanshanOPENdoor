/**
 * Single simulation clock: fixed-step accumulator with pause semantics.
 *
 * Rules (ENGINE-SYSTEMS §2):
 * - One host owns the only simulation clock; render/UI real time is separate.
 * - Fixed step defaults to 1/60s and is configurable per session.
 * - Pause freezes simulation time; resuming never adds paused wall time to dt.
 * - Catch-up is capped; discarded time is recorded, never silently lost.
 */
export interface ClockOptions {
  fixedDt?: number;
  maxCatchUpSteps?: number;
  /** Upper bound for one real frame's elapsed seconds (spiral-of-death guard). */
  maxFrameTime?: number;
}

export class SimulationClock {
  readonly fixedDt: number;
  readonly maxCatchUpSteps: number;
  readonly maxFrameTime: number;

  /** Simulation time in seconds. Monotonic, advances only in fixed steps. */
  time = 0;
  /** Number of fixed steps executed since start. */
  tick = 0;
  /** Seconds of accumulated real time dropped because of the catch-up cap. */
  discardedTime = 0;

  private accumulator = 0;
  private pendingSteps = 0;
  private lastReal: number | null = null;
  private paused = false;

  constructor(opts?: ClockOptions) {
    this.fixedDt = opts?.fixedDt ?? 1 / 60;
    if (!(this.fixedDt > 0)) throw new Error('fixedDt must be positive');
    this.maxCatchUpSteps = opts?.maxCatchUpSteps ?? 5;
    this.maxFrameTime = opts?.maxFrameTime ?? 0.25;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  pause(): void {
    this.paused = true;
  }

  /** Resume without inheriting the paused wall duration. */
  resume(realNow: number): void {
    this.paused = false;
    this.lastReal = realNow;
    this.accumulator = 0;
    this.pendingSteps = 0;
  }

  /**
   * Advance against real time (seconds). Returns how many fixed steps are due.
   * While paused, always 0 and no accumulation.
   */
  beginFrame(realNow: number): number {
    if (this.paused) {
      this.lastReal = realNow;
      return 0;
    }
    const elapsed = this.lastReal === null ? 0 : Math.max(0, realNow - this.lastReal);
    this.lastReal = realNow;
    this.accumulator += Math.min(elapsed, this.maxFrameTime);
    let steps = Math.floor(this.accumulator / this.fixedDt);
    if (steps > this.maxCatchUpSteps) {
      const kept = this.maxCatchUpSteps * this.fixedDt;
      this.discardedTime += this.accumulator - kept;
      this.accumulator = 0;
      steps = this.maxCatchUpSteps;
    } else {
      this.accumulator -= steps * this.fixedDt;
    }
    this.pendingSteps = steps;
    return steps;
  }

  /** Consume one pending fixed step. Returns false when none remain. */
  step(): boolean {
    if (this.pendingSteps <= 0) return false;
    this.pendingSteps -= 1;
    this.tick += 1;
    this.time += this.fixedDt;
    return true;
  }

  /**
   * Manual step for controlled (tool-driven) sessions. Independent of the
   * accumulator: exactly one fixed step, even while paused.
   */
  stepOnce(): void {
    this.tick += 1;
    this.time += this.fixedDt;
  }

  /** Interpolation factor [0,1) between the last and next fixed step. */
  alpha(): number {
    return Math.min(1, Math.max(0, this.accumulator / this.fixedDt));
  }
}
