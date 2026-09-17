/**
 * Author-declared waypoint graph + A* pathfinding (roadmap S10, gate G10).
 *
 * The author declares nodes (ids + world positions) and directed edges with
 * optional costs and optional gate predicates. Gates are author closures over
 * mechanism state (e.g. `() => door.isOpen()`) and are re-evaluated on EVERY
 * query: when a gate closes, the same findPath() call honestly returns a
 * different route or a NO_PATH result — there is no cached plan to go stale.
 *
 * Honest limits (this is NOT navmesh generation):
 * - The graph knows nothing about geometry. Edges declare "this connection is
 *   traversable", not "this corridor is free of clutter"; agents must still
 *   respect physics, and mechanisms may close an edge's gate when its doorway
 *   physically seals.
 * - Paths are sequences of declared nodes. Positions between nodes are the
 *   controller's business (see ai/behaviors.ts), never this module's.
 * - A* runs over the declared edge list with an euclidean heuristic; R1 has
 *   no hierarchical pathfinding, no dynamic obstacle avoidance and no
 *   path smoothing.
 */
import { CreativeError } from '../core/errors.ts';
import type { Vec3 } from '../core/spatial.ts';

export interface NavNode {
  id: string;
  position: Vec3;
}

export interface NavEdge {
  from: string;
  to: string;
  /** Traversal cost; defaults to the euclidean distance between the nodes. */
  cost?: number;
  /** Also register the reverse edge with the same cost/gate. Default false. */
  twoWay?: boolean;
  /**
   * Gate predicate, re-evaluated at every query. Return false to close the
   * edge (e.g. a locked door). The closure reads mechanism state — the nav
   * layer never polls physics itself.
   */
  gate?: () => boolean;
}

export interface NavGraphDef {
  nodes: readonly NavNode[];
  edges?: readonly NavEdge[];
}

export type NoPathReason = 'origin-unknown' | 'goal-unknown' | 'unreachable' | 'blocked';

export interface NavPath {
  ok: true;
  /** Node ids from origin to goal, inclusive. */
  nodes: string[];
  /** World positions matching `nodes`. */
  positions: Vec3[];
  /** Total traversal cost. */
  cost: number;
}

export interface NavNoPath {
  ok: false;
  reason: NoPathReason;
  /** "from->to" keys of gated edges that were closed during the search. */
  blockedEdges?: string[];
}

export type NavResult = NavPath | NavNoPath;

export interface NearestNode {
  id: string;
  distance: number;
}

interface AdjEdge {
  to: string;
  cost: number;
  gate?: () => boolean;
  key: string;
}

export class NavGraph {
  private readonly nodes = new Map<string, NavNode>();
  private readonly adjacency = new Map<string, AdjEdge[]>();

  constructor(def: NavGraphDef) {
    for (const node of def.nodes) {
      if (!node.id) {
        throw new CreativeError('NAV_INVALID', 'NavGraph: node id must be a non-empty string', { phase: 'create' });
      }
      if (this.nodes.has(node.id)) {
        throw new CreativeError('NAV_DUPLICATE_NODE', `NavGraph: duplicate node id "${node.id}"`, { phase: 'create' });
      }
      for (const [axis, value] of [
        ['x', node.position[0]],
        ['y', node.position[1]],
        ['z', node.position[2]],
      ] as const) {
        if (!Number.isFinite(value)) {
          throw new CreativeError('NAV_INVALID', `NavGraph: node "${node.id}" has a non-finite ${axis} position`, {
            phase: 'create',
          });
        }
      }
      this.nodes.set(node.id, { id: node.id, position: [...node.position] as Vec3 });
    }
    for (const edge of def.edges ?? []) this.addEdge(edge);
  }

  addEdge(edge: NavEdge): this {
    const cost = edge.cost ?? this.distanceBetween(edge.from, edge.to);
    if (!Number.isFinite(cost) || cost <= 0) {
      throw new CreativeError('NAV_INVALID_EDGE', `NavGraph: edge ${edge.from}->${edge.to} has a non-positive cost`, {
        phase: 'create',
      });
    }
    this.pushDirected(edge.from, edge.to, cost, edge.gate);
    if (edge.twoWay) this.pushDirected(edge.to, edge.from, cost, edge.gate);
    return this;
  }

  get size(): number {
    return this.nodes.size;
  }

  nodeIds(): string[] {
    return [...this.nodes.keys()];
  }

  nodePosition(id: string): Vec3 | null {
    const node = this.nodes.get(id);
    return node ? ([...node.position] as Vec3) : null;
  }

  /** Nearest declared node by straight-line distance (ties: insertion order). */
  nearestNode(position: Vec3, maxDistance = Number.POSITIVE_INFINITY): NearestNode | null {
    let best: NearestNode | null = null;
    for (const node of this.nodes.values()) {
      const d = dist(position, node.position);
      if (d <= maxDistance && (best === null || d < best.distance)) best = { id: node.id, distance: d };
    }
    return best;
  }

  /**
   * A* from origin to goal. Gates are evaluated fresh here, so results track
   * current mechanism state. NO_PATH results carry a reason: the goal may be
   * unknown, unreachable even ignoring gates, or reachable only through
   * currently-closed (blocked) edges.
   */
  findPath(originId: string, goalId: string): NavResult {
    const origin = this.nodes.get(originId);
    if (!origin) return { ok: false, reason: 'origin-unknown' };
    const goal = this.nodes.get(goalId);
    if (!goal) return { ok: false, reason: 'goal-unknown' };
    if (originId === goalId) {
      return { ok: true, nodes: [originId], positions: [[...origin.position] as Vec3], cost: 0 };
    }

    const goalPos = goal.position;
    const gScore = new Map<string, number>([[originId, 0]]);
    const cameFrom = new Map<string, string>();
    const settled = new Set<string>();
    const blockedEdges: string[] = [];
    // Binary-heap-free open set: small graphs in R1; ties broken by insertion
    // counter so results are deterministic.
    const open: { id: string; f: number; order: number }[] = [
      { id: originId, f: dist(origin.position, goalPos), order: 0 },
    ];
    let counter = 1;

    while (open.length > 0) {
      let bestIdx = 0;
      for (let i = 1; i < open.length; i += 1) {
        if (open[i].f < open[bestIdx].f || (open[i].f === open[bestIdx].f && open[i].order < open[bestIdx].order)) {
          bestIdx = i;
        }
      }
      const current = open.splice(bestIdx, 1)[0];
      if (settled.has(current.id)) continue;
      settled.add(current.id);
      if (current.id === goalId) return this.reconstruct(cameFrom, originId, goalId, gScore.get(goalId)!);

      for (const edge of this.adjacency.get(current.id) ?? []) {
        if (edge.gate && !edge.gate()) {
          if (!blockedEdges.includes(edge.key)) blockedEdges.push(edge.key);
          continue;
        }
        const tentative = gScore.get(current.id)! + edge.cost;
        if (tentative < (gScore.get(edge.to) ?? Number.POSITIVE_INFINITY)) {
          gScore.set(edge.to, tentative);
          cameFrom.set(edge.to, current.id);
          open.push({ id: edge.to, f: tentative + dist(this.nodes.get(edge.to)!.position, goalPos), order: counter++ });
        }
      }
    }

    // No gated path. Is the goal reachable at all when gates are ignored?
    if (!this.reachableIgnoringGates(originId, goalId)) {
      return { ok: false, reason: 'unreachable' };
    }
    return { ok: false, reason: 'blocked', blockedEdges };
  }

  private reconstruct(cameFrom: Map<string, string>, originId: string, goalId: string, cost: number): NavPath {
    const nodes: string[] = [goalId];
    let cursor = goalId;
    while (cursor !== originId) {
      cursor = cameFrom.get(cursor)!;
      nodes.push(cursor);
    }
    nodes.reverse();
    return {
      ok: true,
      nodes,
      positions: nodes.map((id) => [...this.nodes.get(id)!.position] as Vec3),
      cost,
    };
  }

  private reachableIgnoringGates(originId: string, goalId: string): boolean {
    const seen = new Set<string>([originId]);
    const queue = [originId];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (id === goalId) return true;
      for (const edge of this.adjacency.get(id) ?? []) {
        if (!seen.has(edge.to)) {
          seen.add(edge.to);
          queue.push(edge.to);
        }
      }
    }
    return false;
  }

  private distanceBetween(fromId: string, toId: string): number {
    const from = this.nodes.get(fromId);
    const to = this.nodes.get(toId);
    if (!from || !to) {
      throw new CreativeError(
        'NAV_UNKNOWN_NODE',
        `NavGraph: edge references unknown node (${from ? toId : fromId})`,
        { phase: 'create' },
      );
    }
    return dist(from.position, to.position);
  }

  private pushDirected(from: string, to: string, cost: number, gate?: () => boolean): void {
    if (!this.nodes.has(from) || !this.nodes.has(to)) this.distanceBetween(from, to); // throws with detail
    const list = this.adjacency.get(from) ?? [];
    list.push({ to, cost, gate, key: `${from}->${to}` });
    this.adjacency.set(from, list);
  }
}

export function createNavGraph(def: NavGraphDef): NavGraph {
  return new NavGraph(def);
}

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
