/**
 * Events and commits.
 *
 * - Facts/mechanism changes are submitted as namespaced events with a
 *   module-owned payload validator (e.g. `harbor.signal-aligned`).
 * - Every commit carries an idempotency key; replays return a `duplicate`
 *   receipt and never apply twice (no double rewards).
 * - Commits are fenced by sessionId + generation: a stale generation
 *   (post-rebuild/stop) cannot write.
 * - Commits during the render phase are rejected: interpolation must not
 *   create gameplay facts (ENGINE-SYSTEMS §2).
 */
import { CreativeError } from './errors.ts';

export interface EventEnvelope {
  sessionId: string;
  generation: number;
  tick: number;
  name: string;
  payload: unknown;
  eventId: string;
}

export interface CommitReceipt {
  eventId: string;
  name: string;
  status: 'committed' | 'duplicate';
  tick: number;
}

/** Returns true when valid, or a string reason when invalid. */
export type PayloadValidator = (payload: unknown) => true | string;

export type CommitListener = (envelope: EventEnvelope, receipt: CommitReceipt) => void;

export class CommitLog {
  private readonly sessionId: string;
  private generation: number;
  private readonly seen = new Set<string>();
  private readonly validators = new Map<string, PayloadValidator>();
  private readonly listeners = new Set<CommitListener>();
  private readonly log: EventEnvelope[] = [];
  private allowCommits = true;

  constructor(opts: { sessionId: string; generation: number }) {
    this.sessionId = opts.sessionId;
    this.generation = opts.generation;
  }

  registerValidator(namePrefix: string, validator: PayloadValidator): void {
    this.validators.set(namePrefix, validator);
  }

  onCommit(listener: CommitListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Re-fence after rebuild/stop: old generation commits are rejected. */
  fence(generation: number): void {
    this.generation = generation;
  }

  /** Host sets this around the render/interpolation phase. */
  setCommitsAllowed(allowed: boolean): void {
    this.allowCommits = allowed;
  }

  get entries(): readonly EventEnvelope[] {
    return this.log;
  }

  has(eventId: string): boolean {
    return this.seen.has(eventId);
  }

  commit(
    name: string,
    payload: unknown,
    eventId: string,
    ctx: { generation: number; tick: number },
  ): CommitReceipt {
    if (!this.allowCommits) {
      throw new CreativeError('COMMIT_IN_RENDER', `commit "${name}" is not allowed during render/interpolation`, {
        phase: 'commit',
      });
    }
    if (ctx.generation !== this.generation) {
      throw new CreativeError(
        'STALE_GENERATION',
        `commit "${name}" from generation ${ctx.generation} rejected; current generation is ${this.generation}`,
        { phase: 'commit' },
      );
    }
    if (!name || !name.includes('.')) {
      throw new CreativeError('BAD_EVENT_NAME', `event name must be namespaced ("module.event"), got "${name}"`, {
        phase: 'commit',
      });
    }
    const validator = this.validators.get(name) ?? this.validators.get(name.split('.')[0] + '.*');
    if (validator) {
      const verdict = validator(payload);
      if (verdict !== true) {
        throw new CreativeError(
          'BAD_EVENT_PAYLOAD',
          `invalid payload for "${name}": ${typeof verdict === 'string' ? verdict : 'rejected'}`,
          { phase: 'commit' },
        );
      }
    }
    if (this.seen.has(eventId)) {
      return { eventId, name, status: 'duplicate', tick: ctx.tick };
    }
    const envelope: EventEnvelope = {
      sessionId: this.sessionId,
      generation: ctx.generation,
      tick: ctx.tick,
      name,
      payload,
      eventId,
    };
    this.seen.add(eventId);
    this.log.push(envelope);
    const receipt: CommitReceipt = { eventId, name, status: 'committed', tick: ctx.tick };
    for (const listener of [...this.listeners]) listener(envelope, receipt);
    return receipt;
  }
}
