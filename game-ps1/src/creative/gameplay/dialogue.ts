/**
 * OPTIONAL dialogue runner (S12). Plain-TS node graph; the host module owns
 * when to call advance/choose (input edge in its update hook) — the runner
 * itself never touches the input system, and presentation never commits.
 *
 * - Effects commit through a CommitLog-backed channel with deterministic,
 *   idempotent eventIds (`<namespace>:<nodeId>:<optionIndex>`): replaying a
 *   dialogue cannot double-apply a choice.
 * - cancel() settles every pending waiter with a 'cancelled' outcome. The
 *   old HUD bug — a cancelled cue leaving its promise dangling forever —
 *   must not recur: after cancel(), awaiting start() always resolves.
 */

export type DialogueErrorCode =
  | 'UNKNOWN_NODE'
  | 'ALREADY_RUNNING'
  | 'NOT_RUNNING'
  | 'BAD_OPTION'
  | 'OPTIONS_REQUIRE_CHOICE'
  | 'EFFECT_COMMIT_FAILED';

export class DialogueError extends Error {
  readonly code: DialogueErrorCode;

  constructor(code: DialogueErrorCode, message: string) {
    super(message);
    this.name = 'DialogueError';
    this.code = code;
  }
}

/** A namespaced fact committed when the option is chosen. */
export interface DialogueEffect {
  /** Namespaced event name, e.g. 'story.trust-raised'. */
  name: string;
  payload?: unknown;
}

export interface DialogueOption {
  label: string;
  /** Next node id; undefined ends the dialogue after this option. */
  next?: string;
  effect?: DialogueEffect;
}

export interface DialogueNode {
  id: string;
  speaker: string;
  text: string;
  /** Mutually exclusive choices; when present, `next` is ignored. */
  options?: DialogueOption[];
  /** Plain continuation used when the node has no options. */
  next?: string;
}

/** Read-only view of the node the runner is currently presenting. */
export interface DialogueView {
  readonly nodeId: string;
  readonly speaker: string;
  readonly text: string;
  readonly options: readonly { index: number; label: string }[];
  /** True when the node has no options and no continuation. */
  readonly terminal: boolean;
}

export type DialogueOutcome =
  | { status: 'completed' }
  | { status: 'cancelled' };

import type { CommitChannel, CommitReceiptLike } from './commit.ts';

export interface DialogueRunnerOptions {
  nodes: readonly DialogueNode[];
  /** Channel for option effects; omitting it disables effect commits. */
  commit?: CommitChannel;
  /** Event-id namespace; default 'dialogue'. */
  eventNamespace?: string;
}

export class DialogueRunner {
  private readonly nodes = new Map<string, DialogueNode>();
  private readonly commit: CommitChannel | undefined;
  private readonly namespace: string;
  private node: DialogueNode | null = null;
  private waiter: { resolve: (outcome: DialogueOutcome) => void } | null = null;
  private readonly listeners = new Set<(view: DialogueView | null) => void>();

  constructor(options: DialogueRunnerOptions) {
    for (const node of options.nodes) {
      if (this.nodes.has(node.id)) {
        throw new DialogueError('UNKNOWN_NODE', `duplicate dialogue node id "${node.id}"`);
      }
      this.nodes.set(node.id, node);
    }
    this.commit = options.commit;
    this.namespace = options.eventNamespace ?? 'dialogue';
  }

  get current(): DialogueView | null {
    return this.node ? viewOf(this.node) : null;
  }

  get running(): boolean {
    return this.waiter !== null;
  }

  get done(): boolean {
    return this.waiter === null && this.node === null;
  }

  /** Subscribe to view changes (node entered, dialogue finished/cancelled). */
  onChange(listener: (view: DialogueView | null) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Present the entry node and return a promise for the run's outcome.
   * The promise always settles: terminal advance -> 'completed',
   * cancel() -> 'cancelled'. Starting while running throws.
   */
  start(entryId: string): Promise<DialogueOutcome> {
    if (this.waiter) throw new DialogueError('ALREADY_RUNNING', 'dialogue is already running; cancel() it first');
    const node = this.nodes.get(entryId);
    if (!node) throw new DialogueError('UNKNOWN_NODE', `unknown dialogue node "${entryId}"`);
    const promise = new Promise<DialogueOutcome>((resolve) => {
      this.waiter = { resolve };
    });
    this.enter(node);
    return promise;
  }

  /**
   * Input-edge advance: follow node.next. No-op on option nodes (a choice is
   * required) and on terminal nodes this completes the dialogue.
   */
  advance(): void {
    const node = this.node;
    if (!node) return;
    if (node.options && node.options.length > 0) return;
    if (node.next === undefined) {
      this.finish({ status: 'completed' });
      return;
    }
    this.jump(node.next);
  }

  /** Choose an option: commit its effect idempotently, then move on. */
  choose(index: number): void {
    const node = this.node;
    if (!node) return;
    const options = node.options ?? [];
    const option = options[index];
    if (!option) {
      throw new DialogueError('BAD_OPTION', `node "${node.id}" has no option at index ${index}`);
    }
    if (option.effect && this.commit) {
      const eventId = `${this.namespace}:${node.id}:${index}`;
      let receipt: CommitReceiptLike;
      try {
        receipt = this.commit.commit(option.effect.name, option.effect.payload ?? {}, eventId);
      } catch (err) {
        throw new DialogueError(
          'EFFECT_COMMIT_FAILED',
          `effect "${option.effect.name}" was rejected: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      // A duplicate receipt means this exact choice was already applied
      // (idempotent replay): keep running, apply nothing again.
      void receipt;
    }
    if (option.next === undefined) this.finish({ status: 'completed' });
    else this.jump(option.next);
  }

  /** Programmatic jump (trigger/script driven). Unknown ids throw. */
  next(nodeId: string): void {
    if (!this.node && !this.waiter) throw new DialogueError('NOT_RUNNING', 'no dialogue is running');
    this.jump(nodeId);
  }

  /**
   * Settle every pending waiter with 'cancelled' and clear the view.
   * Safe to call when idle; idempotent.
   */
  cancel(): void {
    this.finish({ status: 'cancelled' });
  }

  private jump(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (!node) throw new DialogueError('UNKNOWN_NODE', `unknown dialogue node "${nodeId}"`);
    this.enter(node);
  }

  private enter(node: DialogueNode): void {
    this.node = node;
    this.notify();
  }

  private finish(outcome: DialogueOutcome): void {
    const waiter = this.waiter;
    this.waiter = null;
    this.node = null;
    this.notify();
    waiter?.resolve(outcome);
  }

  private notify(): void {
    const view = this.current;
    for (const listener of [...this.listeners]) listener(view);
  }
}

function viewOf(node: DialogueNode): DialogueView {
  const options = node.options ?? [];
  return {
    nodeId: node.id,
    speaker: node.speaker,
    text: node.text,
    options: options.map((option, index) => ({ index, label: option.label })),
    terminal: options.length === 0 && node.next === undefined,
  };
}
