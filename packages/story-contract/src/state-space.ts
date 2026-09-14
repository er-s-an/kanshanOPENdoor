import { canonicalJson, sha256Hex } from "./canonical.js";
import { createInitialState, reduceStoryState } from "./reducer.js";
import type { Condition, Diagnostic, StoryEvent, StoryPackage, StoryState, StateSpaceEdge, StateSpaceResult } from "./types.js";

function stateKey(state: StoryState): string {
  return canonicalJson({
    beatId: state.beatId,
    flags: state.flags,
    inventory: [...state.inventory].sort(),
    collectedItems: [...state.collectedItems].sort(),
    knownFacts: [...state.knownFacts].sort(),
    ended: state.ended,
  });
}

function passes(condition: Condition, state: StoryState): boolean {
  if (condition.kind === "flag") return state.flags[condition.id] === condition.value;
  if (condition.kind === "inventory") return state.inventory.includes(condition.id) === condition.present;
  return state.knownFacts.includes(condition.id) === condition.present;
}

function actionAvailable(pkg: StoryPackage, state: StoryState): boolean {
  const beat = pkg.beats.find((candidate) => candidate.id === state.beatId);
  if (!beat) return false;
  if (beat.action.kind === "collect") return !state.collectedItems.includes(beat.action.itemId);
  if (beat.action.kind === "use") return state.inventory.includes(beat.action.itemId);
  return true;
}

function diagnostic(code: string, path: string, message: string, evidence?: string): Diagnostic {
  return { code, severity: "error", path, message, evidence };
}

/**
 * Bounded exhaustive exploration of runtime state, using the same reducer as
 * the player. A result marked `truncated` is INCONCLUSIVE and never a PASS.
 */
export function exploreStateSpace(pkg: StoryPackage, options: { maxStates?: number; maxMs?: number } = {}): StateSpaceResult {
  const maxStates = options.maxStates ?? 100_000;
  const maxMs = options.maxMs ?? 30_000;
  const diagnostics: Diagnostic[] = [];
  const startedAt = Date.now();
  const start = createInitialState(pkg);
  const startKey = stateKey(start);
  const queue: StoryState[] = [start];
  const states: string[] = [startKey];
  const stateByKey = new Map<string, StoryState>([[startKey, start]]);
  const edges: StateSpaceEdge[] = [];
  const adjacency = new Map<string, Set<string>>();
  const endedKeys = new Set<string>();
  let explored = 0;
  let truncated = false;
  let deadEndStates = 0;

  while (queue.length > 0) {
    if (explored >= maxStates || Date.now() - startedAt > maxMs) {
      truncated = true;
      break;
    }
    const state = queue.shift() as StoryState;
    const from = stateKey(state);
    explored += 1;
    const beat = pkg.beats.find((candidate) => candidate.id === state.beatId);
    if (!beat) {
      deadEndStates += 1;
      diagnostics.push(diagnostic("STATE_UNKNOWN_BEAT", "/startBeat", `State reached unknown beat '${state.beatId}'.`));
      continue;
    }
    if (state.ended) {
      endedKeys.add(from);
      continue;
    }

    const candidates: StoryEvent[] = beat.action.kind === "end"
      ? [{ eventId: `bfs-end-${sha256Hex(from).slice(0, 16)}`, sessionId: "bfs", expectedGeneration: 0, expectedRevision: 0, beatId: beat.id, type: "confirm-end" }]
      : beat.options.filter((option) => option.guards.every((condition) => passes(condition, state)) && actionAvailable(pkg, state)).map((option) => ({
        eventId: `bfs-${sha256Hex(from).slice(0, 16)}-${option.id}`,
        sessionId: "bfs",
        expectedGeneration: 0,
        expectedRevision: 0,
        beatId: beat.id,
        type: "complete-option" as const,
        optionId: option.id,
      }));

    if (candidates.length === 0) {
      deadEndStates += 1;
      diagnostics.push(diagnostic("STATE_DEAD_END", `/beats/${Math.max(0, pkg.beats.indexOf(beat))}`, `Reachable state at beat '${beat.id}' has no available action.`, stateKey(state)));
      continue;
    }
    const outgoing = adjacency.get(from) ?? new Set<string>();
    adjacency.set(from, outgoing);
    for (const event of candidates) {
      const reduction = reduceStoryState(state, event, pkg);
      if (!reduction.accepted) {
        diagnostics.push(diagnostic("STATE_TRANSITION_REJECTED", `/beats/${Math.max(0, pkg.beats.indexOf(beat))}`, `Reducer rejected an apparently available ${event.type} transition.`, reduction.diagnostics.map((entry) => entry.code).join(",")));
        continue;
      }
      const to = stateKey(reduction.state);
      outgoing.add(to);
      edges.push({ from, to, eventType: event.type, ...(event.type === "complete-option" ? { optionId: event.optionId } : {}) });
      if (!stateByKey.has(to)) {
        if (states.length >= maxStates) {
          truncated = true;
          break;
        }
        stateByKey.set(to, reduction.state);
        states.push(to);
        queue.push(reduction.state);
      }
    }
    if (truncated) break;
  }

  if (truncated) {
    diagnostics.push(diagnostic("INCONCLUSIVE_STATE_SPACE", "/beats", `State exploration stopped after ${explored} states or ${maxMs}ms.`, `maxStates=${maxStates}; maxMs=${maxMs}`,));
  } else {
    // Reverse-mark every state that can reach an ended state. Any reachable
    // state not marked is a non-terminating closed component (or dead end).
    const reverse = new Map<string, Set<string>>();
    for (const [from, tos] of adjacency) {
      for (const to of tos) {
        let predecessors = reverse.get(to);
        if (!predecessors) {
          predecessors = new Set<string>();
          reverse.set(to, predecessors);
        }
        predecessors.add(from);
      }
    }
    const canEnd = new Set(endedKeys);
    const pending = [...endedKeys];
    while (pending.length) {
      const current = pending.pop() as string;
      for (const predecessor of reverse.get(current) ?? []) if (!canEnd.has(predecessor)) { canEnd.add(predecessor); pending.push(predecessor); }
    }
    if (endedKeys.size === 0) {
      diagnostics.push(diagnostic("NO_END_REACHABLE", "/beats", "No explored state reaches an end beat confirmation."));
    } else {
      for (const key of states) {
        if (!canEnd.has(key) && !endedKeys.has(key)) diagnostics.push(diagnostic("NON_TERMINATING_STATE", "/beats", "Reachable state cannot reach confirm-end.", key));
      }
    }
  }

  return {
    ok: !truncated && !diagnostics.some((entry) => entry.severity === "error"),
    diagnostics,
    explored,
    truncated,
    endedStates: endedKeys.size,
    deadEndStates,
    states,
    edges,
  };
}

export { stateKey };
