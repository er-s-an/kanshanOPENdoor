/**
 * Behaviors: patrol and follow, emitting MOVEMENT INTENT ONLY (roadmap S10,
 * gate G10).
 *
 * A behavior is a pure function of (dt, currentPosition) -> output. It never
 * writes the position it is given, never touches Object3D transforms and
 * never teleports: a controller + physics (e.g. controllers/ over
 * KinematicCharacterCore) consume the emitted desired velocity and own the
 * root transform. If the controller cannot make progress (wall, closed
 * door), the behavior notices the stall and reports a stuck diagnostic with
 * the reason instead of ever clipping through geometry.
 *
 * The nav layer binds to mechanism state only through the gate predicates on
 * nav edges (see ai/nav.ts): a door closing flips its flag, the next
 * findPath()/replan() sees it, and the behavior reroutes or reports stuck.
 *
 * Honest limits:
 * - No dynamic obstacle avoidance: behaviors follow declared waypoint paths.
 * - Stuck detection is positional (no progress for N seconds), not a physics
 *   query; it detects symptoms, and the diagnostic carries the nav reason
 *   (no-path/blocked) when pathfinding already failed.
 */
import type { Vec3 } from '../core/spatial.ts';
import type { NavGraph, NavNoPath, NavPath, NavResult } from './nav.ts';

/** Desired movement for one fixed step. Apply via a controller, never here. */
export interface MoveIntent {
  kind: 'move';
  /** World-space desired velocity (m/s); [0,0,0] while arrived or stuck. */
  velocity: Vec3;
  /** World position the intent currently heads toward (node or live target). */
  target: Vec3 | null;
  /** True once the final goal is within arriveRadius. */
  arrived: boolean;
}

export type StuckReason = 'no-path' | 'blocked' | 'stalled';

/**
 * Diagnostic emitted ONCE per stuck episode (then zero-velocity intents until
 * the condition clears). `debug: true` marks it agent-internal rather than
 * player evidence; works decide whether to forward it to ctx.report.
 */
export interface StuckDiagnostic {
  kind: 'stuck';
  code: 'BEHAVIOR_STUCK';
  reason: StuckReason;
  detail: string;
  at: Vec3;
  sinceSeconds: number;
  debug: true;
}

export type BehaviorOutput = MoveIntent | StuckDiagnostic;

interface BehaviorCommon {
  /** Seconds without positional progress before 'stalled'. Default 2. */
  stuckSeconds?: number;
  /** Displacement that counts as progress, m. Default 1e-3. */
  progressEpsilon?: number;
}

export interface PatrolOptions extends BehaviorCommon {
  graph: NavGraph;
  /** Route endpoints: the patrol walks the A* path from -> to. */
  from: string;
  to: string;
  /** Desired ground speed, m/s. */
  speed: number;
  /** Advance-to-next-node / arrive radius, m. */
  arriveRadius: number;
  /** On reaching `to`, walk back to `from` and repeat. Default false. */
  loop?: boolean;
  /**
   * Re-query the path every N seconds so gate changes reroute live patrols.
   * Default Infinity: replan via replan() only (e.g. wired to a door event).
   */
  repathInterval?: number;
}

export interface FollowOptions extends BehaviorCommon {
  graph: NavGraph;
  /** Live target position (e.g. () => playerObject.position.toArray() as Vec3). */
  getTargetPosition(): Vec3;
  speed: number;
  /** Stop this far from the target, m. */
  arriveRadius: number;
  /**
   * Re-query A* this often (the target moves and gates flip). Default 0.5.
   * Pass Infinity to replan via replan() only.
   */
  repathInterval?: number;
}

export interface Behavior {
  update(dt: number, position: Vec3): BehaviorOutput;
  /** Force a fresh path query now (position selects the nearest start node). */
  replan(position: Vec3): NavResult;
  /** Current stuck state, or null when progressing. */
  readonly stuck: StuckReason | null;
  /** True when the goal is reached (non-loop patrol / follow). */
  readonly arrived: boolean;
}

const ZERO: Vec3 = [0, 0, 0];

/**
 * Positional stall detector: no displacement > epsilon within `seconds`
 * means the consumer is stuck against something. While a behavior is
 * legitimately stationary (arrived at its goal), updates pass
 * allowStall=false so standing still never reads as stuck.
 */
class StuckTracker {
  private reference: Vec3 | null = null;
  private timer = 0;
  active: StuckReason | null = null;
  private readonly seconds: number;
  private readonly epsilon: number;

  constructor(seconds: number, epsilon: number) {
    this.seconds = seconds;
    this.epsilon = epsilon;
  }

  /** Feed the observed position; returns a fresh 'stalled' diagnostic once. */
  observe(dt: number, position: Vec3, label: string, allowStall = true): StuckDiagnostic | null {
    if (this.reference === null || distance(this.reference, position) > this.epsilon) {
      this.reference = [position[0], position[1], position[2]];
      this.timer = 0;
      this.active = null;
      return null;
    }
    if (!allowStall) {
      this.timer = 0;
      return null;
    }
    this.timer += dt;
    if (this.timer >= this.seconds && this.active === null) {
      this.active = 'stalled';
      return {
        kind: 'stuck',
        code: 'BEHAVIOR_STUCK',
        reason: 'stalled',
        detail: `${label}: no positional progress for ${round2(this.timer)}s (stuckSeconds=${this.seconds})`,
        at: [position[0], position[1], position[2]],
        sinceSeconds: round2(this.timer),
        debug: true,
      };
    }
    return null;
  }
}

interface PathFollowState {
  /** Node positions remaining after the current one. */
  nodePositions: Vec3[];
  /** Final goal position (may differ from the last node, e.g. follow). */
  goal: Vec3;
  nodeIndex: number;
}

function steerAlongPath(state: PathFollowState, position: Vec3, speed: number, arriveRadius: number): MoveIntent {
  // Advance past any node already within the arrive radius.
  while (
    state.nodeIndex < state.nodePositions.length &&
    distance(position, state.nodePositions[state.nodeIndex]) < arriveRadius
  ) {
    state.nodeIndex += 1;
  }
  if (distance(position, state.goal) < arriveRadius) {
    return { kind: 'move', velocity: [0, 0, 0], target: [...state.goal] as Vec3, arrived: true };
  }
  const target = state.nodeIndex < state.nodePositions.length ? state.nodePositions[state.nodeIndex] : state.goal;
  const d = distance(position, target);
  if (d < 1e-9) return { kind: 'move', velocity: [0, 0, 0], target: [...target] as Vec3, arrived: false };
  const s = speed / d;
  return {
    kind: 'move',
    velocity: [(target[0] - position[0]) * s, (target[1] - position[1]) * s, (target[2] - position[2]) * s],
    target: [...target] as Vec3,
    arrived: false,
  };
}

function navReasonToStuck(reason: NavNoPath['reason']): StuckReason {
  return reason === 'blocked' ? 'blocked' : 'no-path';
}

function describeNoPath(label: string, result: NavNoPath, fromId: string, toId: string): string {
  const blocked = result.blockedEdges?.length ? `, closed gates: ${result.blockedEdges.join(', ')}` : '';
  return `${label}: no path from "${fromId}" to "${toId}" (nav reason: ${result.reason}${blocked})`;
}

class PatrolBehavior implements Behavior {
  private readonly graph: NavGraph;
  private readonly speed: number;
  private readonly arriveRadius: number;
  private readonly loop: boolean;
  private readonly repathInterval: number;
  private readonly tracker: StuckTracker;
  private endpoints: { from: string; to: string };
  private follow: PathFollowState | null = null;
  private noPath: NavNoPath | null = null;
  private lastResult: NavResult;
  private repathTimer = 0;
  private stuckState: StuckReason | null = null;
  private arrivedState = false;

  constructor(opts: PatrolOptions) {
    this.graph = opts.graph;
    this.speed = opts.speed;
    this.arriveRadius = opts.arriveRadius;
    this.loop = opts.loop ?? false;
    this.repathInterval = opts.repathInterval ?? Number.POSITIVE_INFINITY;
    this.tracker = new StuckTracker(opts.stuckSeconds ?? 2, opts.progressEpsilon ?? 1e-3);
    this.endpoints = { from: opts.from, to: opts.to };
    this.lastResult = this.queryPath();
  }

  get stuck(): StuckReason | null {
    return this.stuckState;
  }

  get arrived(): boolean {
    return this.arrivedState;
  }

  replan(_position: Vec3): NavResult {
    this.lastResult = this.queryPath();
    return this.lastResult;
  }

  update(dt: number, position: Vec3): BehaviorOutput {
    const stationary = this.arrivedState && !this.loop;
    const stalled = this.tracker.observe(dt, position, 'patrol', !stationary);
    if (stalled) {
      // Pathfinding already failed: the positional stall is a symptom, so the
      // diagnostic keeps the nav reason instead of overwriting it (see header).
      if (this.noPath) return this.emitNoPathOnce('patrol', position);
      this.stuckState = 'stalled';
      return stalled;
    }
    if (this.tracker.active === null && this.stuckState === 'stalled') this.stuckState = null;
    // Stuck episodes hold zero velocity until progress resumes (MoveIntent
    // contract: "[0,0,0] while arrived or stuck").
    if (this.stuckState === 'stalled') {
      return { kind: 'move', velocity: ZERO, target: this.follow ? ([...this.follow.goal] as Vec3) : null, arrived: false };
    }
    if (stationary) {
      return { kind: 'move', velocity: ZERO, target: this.follow ? ([...this.follow.goal] as Vec3) : null, arrived: true };
    }

    if (this.noPath) return this.emitNoPathOnce('patrol', position);

    this.repathTimer += dt;
    if (this.repathTimer >= this.repathInterval) {
      this.lastResult = this.queryPath();
      if (this.noPath) return this.emitNoPathOnce('patrol', position);
    }

    if (!this.follow) return { kind: 'move', velocity: ZERO, target: null, arrived: false };
    const intent = steerAlongPath(this.follow, position, this.speed, this.arriveRadius);
    if (intent.arrived) {
      if (!this.loop) {
        this.arrivedState = true;
        return intent;
      }
      // Loop: swap endpoints and walk back.
      this.endpoints = { from: this.endpoints.to, to: this.endpoints.from };
      this.lastResult = this.queryPath();
      if (this.noPath) return this.emitNoPathOnce('patrol', position);
      return this.follow ? steerAlongPath(this.follow, position, this.speed, this.arriveRadius) : intent;
    }
    return intent;
  }

  private emitNoPathOnce(label: string, position: Vec3): MoveIntent | StuckDiagnostic {
    const noPath = this.noPath!;
    if (this.stuckState === null) {
      const reason = navReasonToStuck(noPath.reason);
      this.stuckState = reason;
      return {
        kind: 'stuck',
        code: 'BEHAVIOR_STUCK',
        reason,
        detail: describeNoPath(label, noPath, this.endpoints.from, this.endpoints.to),
        at: [position[0], position[1], position[2]],
        sinceSeconds: 0,
        debug: true,
      };
    }
    return { kind: 'move', velocity: ZERO, target: null, arrived: false };
  }

  private queryPath(): NavResult {
    const result = this.graph.findPath(this.endpoints.from, this.endpoints.to);
    this.repathTimer = 0;
    if (!result.ok) {
      this.follow = null;
      this.noPath = result;
      return result;
    }
    this.noPath = null;
    if (this.stuckState === 'no-path' || this.stuckState === 'blocked') this.stuckState = null;
    // Skip the origin node: steering starts toward the next node, and
    // steerAlongPath advances past any node already within arriveRadius.
    const positions = result.positions.slice(1).map((p) => [...p] as Vec3);
    const goal = [...result.positions[result.positions.length - 1]] as Vec3;
    this.follow = { nodePositions: positions, goal, nodeIndex: 0 };
    return result;
  }
}

class FollowBehavior implements Behavior {
  private readonly graph: NavGraph;
  private readonly getTargetPosition: () => Vec3;
  private readonly speed: number;
  private readonly arriveRadius: number;
  private readonly repathInterval: number;
  private readonly tracker: StuckTracker;
  private follow: PathFollowState | null = null;
  private noPath: NavNoPath | null = null;
  private lastResult: NavResult | null = null;
  private lastTargetNodeId: string | null = null;
  private repathTimer = 0;
  private stuckState: StuckReason | null = null;
  private arrivedState = false;

  constructor(opts: FollowOptions) {
    this.graph = opts.graph;
    this.getTargetPosition = opts.getTargetPosition;
    this.speed = opts.speed;
    this.arriveRadius = opts.arriveRadius;
    this.repathInterval = opts.repathInterval ?? 0.5;
    this.tracker = new StuckTracker(opts.stuckSeconds ?? 2, opts.progressEpsilon ?? 1e-3);
  }

  get stuck(): StuckReason | null {
    return this.stuckState;
  }

  get arrived(): boolean {
    return this.arrivedState;
  }

  replan(position: Vec3): NavResult {
    this.lastResult = this.queryPath(position, this.getTargetPosition());
    return this.lastResult;
  }

  update(dt: number, position: Vec3): BehaviorOutput {
    const target = this.getTargetPosition();
    if (distance(position, target) <= this.arriveRadius) {
      // At the target: stand still (legitimately stationary, never stalls).
      this.arrivedState = true;
      this.stuckState = null;
      return { kind: 'move', velocity: ZERO, target: [target[0], target[1], target[2]], arrived: true };
    }
    this.arrivedState = false;

    const stalled = this.tracker.observe(dt, position, 'follow');
    if (stalled) {
      if (this.noPath) return this.emitNoPathOnce(position);
      this.stuckState = 'stalled';
      return stalled;
    }
    if (this.tracker.active === null && this.stuckState === 'stalled') this.stuckState = null;
    if (this.stuckState === 'stalled') {
      return { kind: 'move', velocity: ZERO, target: this.follow ? ([...this.follow.goal] as Vec3) : null, arrived: false };
    }

    // Re-query when the interval elapsed, the target changed graph nodes, or
    // the previous query failed (so recovery is immediate once a gate opens).
    this.repathTimer += dt;
    const targetNode = this.graph.nearestNode(target);
    if (this.repathTimer >= this.repathInterval || (targetNode?.id ?? null) !== this.lastTargetNodeId || this.noPath) {
      this.lastResult = this.queryPath(position, target);
    }
    if (this.noPath) return this.emitNoPathOnce(position);
    if (!this.follow) return { kind: 'move', velocity: ZERO, target: null, arrived: false };

    // Refresh the final leg every step: the target moves independently of nodes.
    this.follow.goal = [target[0], target[1], target[2]];
    return steerAlongPath(this.follow, position, this.speed, this.arriveRadius);
  }

  private emitNoPathOnce(position: Vec3): MoveIntent | StuckDiagnostic {
    const noPath = this.noPath!;
    if (this.stuckState === null) {
      const reason = navReasonToStuck(noPath.reason);
      this.stuckState = reason;
      return {
        kind: 'stuck',
        code: 'BEHAVIOR_STUCK',
        reason,
        detail: describeNoPath('follow', noPath, '(nearest-to-agent)', '(nearest-to-target)'),
        at: [position[0], position[1], position[2]],
        sinceSeconds: 0,
        debug: true,
      };
    }
    return { kind: 'move', velocity: ZERO, target: null, arrived: false };
  }

  private queryPath(position: Vec3, target: Vec3): NavResult {
    this.repathTimer = 0;
    const originNode = this.graph.nearestNode(position);
    const targetNode = this.graph.nearestNode(target);
    this.lastTargetNodeId = targetNode?.id ?? null;
    if (!originNode || !targetNode) {
      const result: NavNoPath = { ok: false, reason: !originNode ? 'origin-unknown' : 'goal-unknown' };
      this.noPath = result;
      this.follow = null;
      return result;
    }
    const result: NavResult = this.graph.findPath(originNode.id, targetNode.id);
    if (!result.ok) {
      this.noPath = result;
      this.follow = null;
      return result;
    }
    this.noPath = null;
    if (this.stuckState === 'no-path' || this.stuckState === 'blocked') this.stuckState = null;
    const positions = result.positions.slice(1).map((p) => [...p] as Vec3);
    this.follow = { nodePositions: positions, goal: [target[0], target[1], target[2]], nodeIndex: 0 };
    return result;
  }
}

export function createPatrol(opts: PatrolOptions): Behavior {
  return new PatrolBehavior(opts);
}

export function createFollow(opts: FollowOptions): Behavior {
  return new FollowBehavior(opts);
}

/** Type helper for tests/tools narrowing a BehaviorOutput. */
export function isStuck(output: BehaviorOutput): output is StuckDiagnostic {
  return output.kind === 'stuck';
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

// NavPath is re-exported through the Behavior API; keep the import live for
// tools that resolve types via the implementation file.
export type { NavPath };
