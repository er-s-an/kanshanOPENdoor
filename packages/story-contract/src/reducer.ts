import type {
  Condition,
  Diagnostic,
  EventReceipt,
  FencingContext,
  ReduceOptions,
  ReduceResult,
  RunEnvelope,
  StoryEvent,
  StoryPackage,
  StoryState,
} from "./types.js";

function cloneState(state: StoryState): StoryState {
  return {
    beatId: state.beatId,
    flags: { ...state.flags },
    inventory: [...state.inventory],
    collectedItems: [...state.collectedItems],
    knownFacts: [...state.knownFacts],
    ended: state.ended,
  };
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function diagnostic(code: string, path: string, message: string, evidence?: string): Diagnostic {
  return { code, severity: "error", path, message, evidence };
}

function receipt(event: StoryEvent, accepted: boolean, revision: number, state: StoryState, diagnostics: Diagnostic[]): EventReceipt {
  return {
    eventId: event.eventId,
    accepted,
    revision,
    state: cloneState(state),
    diagnostics: diagnostics.map((entry) => ({ ...entry })),
  };
}

function result(event: StoryEvent, accepted: boolean, revision: number, state: StoryState, diagnostics: Diagnostic[]): ReduceResult {
  return { accepted, state: cloneState(state), revision, diagnostics, receipt: receipt(event, accepted, revision, state, diagnostics) };
}

function has(value: readonly string[], id: string): boolean {
  return value.includes(id);
}

function guardPasses(condition: Condition, state: StoryState): boolean {
  if (condition.kind === "flag") return state.flags[condition.id] === condition.value;
  if (condition.kind === "inventory") return has(state.inventory, condition.id) === condition.present;
  return has(state.knownFacts, condition.id) === condition.present;
}

/** Evaluate one guard using the same semantics as the pure reducer. */
export function conditionPasses(condition: Condition, state: StoryState): boolean {
  return guardPasses(condition, state);
}

function applyEffect(state: StoryState, effect: Condition): void {
  if (effect.kind === "flag") {
    state.flags[effect.id] = effect.value;
    return;
  }
  if (effect.kind === "inventory") {
    if (effect.present) state.inventory = sortedUnique([...state.inventory, effect.id]);
    else state.inventory = state.inventory.filter((id) => id !== effect.id);
    return;
  }
  if (effect.present) state.knownFacts = sortedUnique([...state.knownFacts, effect.id]);
  else state.knownFacts = state.knownFacts.filter((id) => id !== effect.id);
}

function reject(event: StoryEvent, state: StoryState, revision: number, issue: Diagnostic): ReduceResult {
  return result(event, false, revision, state, [issue]);
}

function checkFence(event: StoryEvent, context: FencingContext | undefined, state: StoryState, revision: number): ReduceResult | null {
  if (!event.eventId || !event.sessionId) return reject(event, state, revision, diagnostic("INVALID_EVENT_IDENTITY", "/eventId", "eventId and sessionId are required."));
  if (!Number.isInteger(event.expectedGeneration) || event.expectedGeneration < 0) return reject(event, state, revision, diagnostic("INVALID_GENERATION", "/expectedGeneration", "expectedGeneration must be a non-negative integer."));
  if (!Number.isInteger(event.expectedRevision) || event.expectedRevision < 0) return reject(event, state, revision, diagnostic("INVALID_REVISION", "/expectedRevision", "expectedRevision must be a non-negative integer."));
  if (context && event.sessionId !== context.sessionId) return reject(event, state, revision, diagnostic("STALE_SESSION", "/sessionId", "Event belongs to a different player session."));
  if (context && event.expectedGeneration !== context.generation) return reject(event, state, revision, diagnostic("STALE_GENERATION", "/expectedGeneration", "Event was produced by an older asynchronous generation."));
  if (context && event.expectedRevision !== context.revision) return reject(event, state, revision, diagnostic("STALE_REVISION", "/expectedRevision", "Event revision is no longer current; reload or retry from the latest checkpoint."));
  return null;
}

/** Build the empty canonical state for a new save slot. */
export function createInitialState(pkg: StoryPackage): StoryState {
  const flags: Record<string, boolean> = {};
  for (const flag of pkg.flags) flags[flag.id] = flag.initial;
  return { beatId: pkg.startBeat, flags, inventory: [], collectedItems: [], knownFacts: [], ended: false };
}

export function createRunEnvelope(
  pkg: StoryPackage,
  packageDigest: string,
  saveSlotId: string,
  sessionId: string,
  generation = 0,
  revision = 0,
): RunEnvelope {
  if (!packageDigest || !saveSlotId || !sessionId) throw new Error("packageDigest, saveSlotId, and sessionId are required");
  return { packageDigest, saveSlotId, engineMajor: pkg.runtime.engineMajor, sessionId, generation, revision, state: createInitialState(pkg) };
}

/**
 * Apply one complete-option or confirm-end event without side effects.
 *
 * `fencing` is supplied by the player adapter when committing to a save.  A
 * reducer call without it is useful for deterministic previews and BFS; the
 * event still carries the same envelope, but no external session/revision is
 * assumed.  `priorEvents` makes retries idempotent when an adapter has stored
 * receipts from its persistence transaction.
 */
export function reduceStoryState(state: StoryState, event: StoryEvent, pkg: StoryPackage, options: ReduceOptions = {}): ReduceResult {
  const current = cloneState(state);
  const currentRevision = options.fencing?.revision ?? 0;
  const previous = options.priorEvents?.[event.eventId];
  if (previous) {
    return {
      accepted: previous.accepted,
      state: cloneState(previous.state),
      revision: previous.revision,
      diagnostics: previous.diagnostics.map((entry) => ({ ...entry })),
      receipt: {
        eventId: previous.eventId,
        accepted: previous.accepted,
        revision: previous.revision,
        state: cloneState(previous.state),
        diagnostics: previous.diagnostics.map((entry) => ({ ...entry })),
      },
    };
  }
  const fenced = checkFence(event, options.fencing, current, currentRevision);
  if (fenced) return fenced;
  if (event.beatId !== current.beatId) return reject(event, current, currentRevision, diagnostic("STALE_BEAT", "/beatId", "Event beat does not match the current state."));
  if (current.ended) return reject(event, current, currentRevision, diagnostic("STATE_ENDED", "/ended", "An ended story cannot accept further events."));

  const beat = pkg.beats.find((candidate) => candidate.id === current.beatId);
  if (!beat) return reject(event, current, currentRevision, diagnostic("UNKNOWN_BEAT", "/beatId", `Beat '${current.beatId}' is not declared.`));

  if (event.type === "confirm-end") {
    if ("optionId" in event) return reject(event, current, currentRevision, diagnostic("INVALID_END_CONFIRMATION", "/optionId", "confirm-end cannot carry an optionId."));
    if (beat.action.kind !== "end") return reject(event, current, currentRevision, diagnostic("INVALID_END_CONFIRMATION", "/type", "confirm-end is accepted only by an end beat."));
    const next = cloneState(current);
    next.ended = true;
    return result(event, true, currentRevision + 1, next, []);
  }
  if (event.type !== "complete-option") return reject(event, current, currentRevision, diagnostic("UNKNOWN_EVENT_TYPE", "/type", "Only complete-option and confirm-end are supported."));
  if (typeof event.optionId !== "string" || event.optionId.length === 0) return reject(event, current, currentRevision, diagnostic("INVALID_OPTION_ID", "/optionId", "complete-option requires a non-empty optionId."));

  const option = beat.options.find((candidate) => candidate.id === event.optionId);
  if (!option) return reject(event, current, currentRevision, diagnostic("UNKNOWN_OPTION", "/optionId", `Option '${event.optionId}' is not declared in beat '${beat.id}'.`));
  const failedGuard = option.guards.find((condition) => !guardPasses(condition, current));
  if (failedGuard) return reject(event, current, currentRevision, diagnostic("GUARD_NOT_MET", "/optionId", `Option '${option.id}' is not currently available.`, `${failedGuard.kind}:${failedGuard.id}`));

  if (beat.action.kind === "collect" && has(current.collectedItems, beat.action.itemId)) {
    return reject(event, current, currentRevision, diagnostic("ITEM_ALREADY_COLLECTED", "/action/itemId", `Item '${beat.action.itemId}' has already been collected in this save.`));
  }
  if (beat.action.kind === "use" && !has(current.inventory, beat.action.itemId)) {
    return reject(event, current, currentRevision, diagnostic("ITEM_NOT_IN_INVENTORY", "/action/itemId", `Item '${beat.action.itemId}' is not in inventory.`));
  }

  const next = cloneState(current);
  for (const effect of option.effects) applyEffect(next, effect);
  if (beat.action.kind === "collect") {
    next.collectedItems = sortedUnique([...next.collectedItems, beat.action.itemId]);
    // The built-in collect effect is additive and cannot be undone by an
    // accidental duplicate effect in an unvalidated package.
    next.inventory = sortedUnique([...next.inventory, beat.action.itemId]);
  }
  next.beatId = option.next;
  if (!pkg.beats.some((candidate) => candidate.id === next.beatId)) {
    return reject(event, current, currentRevision, diagnostic("UNKNOWN_NEXT_BEAT", "/next", `Next beat '${next.beatId}' is not declared.`));
  }
  return result(event, true, currentRevision + 1, next, []);
}

export { cloneState };
