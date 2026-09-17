/**
 * Finite-state-machine tool (roadmap S10, gate G10).
 *
 * Per-instance machines built from plain state objects: states carry optional
 * enter/update/exit hooks, transitions are evented and guardable, and the
 * current-state id serializes to a JSON-safe snapshot for save/restore.
 *
 * Honest limits:
 * - No module-level mutable state: machines built from the same definitions
 *   never share state, and nothing here touches the scene graph, physics or
 *   the commit channel. A state change is a fact only when the work commits
 *   it via SceneContext.commit — this tool only answers "what state am I in".
 * - Guards are synchronous author functions; there is no async transition
 *   queue in R1. fire()/go() report whether a transition was taken; a denied
 *   guard leaves the machine unchanged and returns false.
 */
import { CreativeError } from '../core/errors.ts';

export type FsmEvent = string;

export interface FsmState {
  readonly id: string;
  /** Called when the state becomes current; previous is null on start/restore. */
  enter?(previous: string | null): void;
  /** Called once per machine update while the state is current. */
  update?(dt: number): void;
  /** Called when the state stops being current; next is the incoming id. */
  exit?(next: string): void;
}

export interface FsmTransitionDef {
  /**
   * Required source state id(s), or '*' for any state. The transition only
   * evaluates while the machine is in one of these states.
   */
  from: string | readonly string[];
  /** Triggering event; omitted = matches any event (a wildcard transition). */
  on?: FsmEvent;
  to: string;
  /** Optional guard; the transition is taken only when it returns true. */
  guard?: (event: FsmEvent | undefined) => boolean;
}

/** JSON-safe serializable form of a machine's current state. */
export interface FsmSnapshot {
  state: string;
}

export class Fsm {
  private readonly states = new Map<string, FsmState>();
  private readonly transitions: FsmTransitionDef[] = [];
  private current: FsmState | null = null;
  private initialId: string | null = null;

  addState(state: FsmState): this {
    if (!state.id) {
      throw new CreativeError('FSM_INVALID', 'Fsm.addState: state id must be a non-empty string', { phase: 'create' });
    }
    if (this.states.has(state.id)) {
      throw new CreativeError('FSM_DUPLICATE_STATE', `Fsm.addState: duplicate state id "${state.id}"`, { phase: 'create' });
    }
    this.states.set(state.id, state);
    if (this.initialId === null) this.initialId = state.id;
    return this;
  }

  addTransition(def: FsmTransitionDef): this {
    if (def.on !== undefined && def.on === '') {
      throw new CreativeError('FSM_INVALID', 'Fsm.addTransition: event name must be non-empty', { phase: 'create' });
    }
    this.transitions.push({ ...def });
    return this;
  }

  /** Enter the initial state (first added unless initialId is given). */
  start(initialId?: string): void {
    const id = initialId ?? this.initialId;
    if (id === null) {
      throw new CreativeError('FSM_EMPTY', 'Fsm.start: the machine has no states', { phase: 'mechanics' });
    }
    const state = this.requireState(id, 'start');
    this.current = state;
    state.enter?.(null);
  }

  /** Serializable current-state id (null before start()). */
  get stateId(): string | null {
    return this.current?.id ?? null;
  }

  /** Run the current state's update hook. */
  update(dt: number): void {
    this.requireCurrent('update').update?.(dt);
  }

  /**
   * Fire an event: the first declared transition whose from/on match, and
   * whose guard passes, is taken. Returns true iff a transition ran.
   */
  fire(event?: FsmEvent): boolean {
    const current = this.requireCurrent('fire');
    for (const def of this.transitions) {
      if (!this.fromMatches(def, current.id)) continue;
      if (def.on !== undefined && def.on !== event) continue;
      if (def.guard && !def.guard(event)) continue;
      this.take(def, current, event);
      return true;
    }
    return false;
  }

  /**
   * Request a transition to a specific state: like fire(), but additionally
   * requires the matched transition to end at `to`.
   */
  go(to: string, event?: FsmEvent): boolean {
    const current = this.requireCurrent('go');
    for (const def of this.transitions) {
      if (def.to !== to) continue;
      if (!this.fromMatches(def, current.id)) continue;
      if (def.on !== undefined && def.on !== event) continue;
      if (def.guard && !def.guard(event)) continue;
      this.take(def, current, event);
      return true;
    }
    return false;
  }

  /** Dry run of fire(): true iff some declared transition would be taken. */
  can(event?: FsmEvent): boolean {
    const current = this.requireCurrent('can');
    return this.transitions.some(
      (def) =>
        this.fromMatches(def, current.id) &&
        (def.on === undefined || def.on === event) &&
        (!def.guard || def.guard(event)),
    );
  }

  toSnapshot(): FsmSnapshot {
    return { state: this.requireCurrent('toSnapshot').id };
  }

  /** Restore a snapshot: re-enters the saved state via enter(null). */
  restore(snapshot: FsmSnapshot): void {
    const state = this.requireState(snapshot.state, 'restore');
    this.current = state;
    state.enter?.(null);
  }

  private take(def: FsmTransitionDef, from: FsmState, event: FsmEvent | undefined): void {
    const next = this.requireState(def.to, 'transition');
    from.exit?.(next.id);
    this.current = next;
    next.enter?.(from.id);
    void event;
  }

  private fromMatches(def: FsmTransitionDef, stateId: string): boolean {
    if (def.from === '*') return true;
    const list = Array.isArray(def.from) ? def.from : [def.from as string];
    return list.includes(stateId);
  }

  private requireState(id: string, op: string): FsmState {
    const state = this.states.get(id);
    if (!state) {
      throw new CreativeError('FSM_UNKNOWN_STATE', `Fsm.${op}: unknown state id "${id}"`, { phase: 'mechanics' });
    }
    return state;
  }

  private requireCurrent(op: string): FsmState {
    if (!this.current) {
      throw new CreativeError('FSM_NOT_STARTED', `Fsm.${op}: call start() before driving the machine`, {
        phase: 'mechanics',
      });
    }
    return this.current;
  }
}

/** Convenience factory; identical to `new Fsm()` followed by the builder calls. */
export function createFsm(def: {
  states: readonly FsmState[];
  transitions?: readonly FsmTransitionDef[];
  initial?: string;
}): Fsm {
  const fsm = new Fsm();
  for (const state of def.states) fsm.addState(state);
  for (const transition of def.transitions ?? []) fsm.addTransition(transition);
  fsm.start(def.initial);
  return fsm;
}
