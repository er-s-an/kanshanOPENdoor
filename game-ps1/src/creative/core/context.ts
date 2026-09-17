/**
 * SceneModule contract: the one-level authoring surface.
 *
 * A module is ordinary TypeScript/Three.js. Helpers and engine systems are
 * optional imports; nothing here requires a global entity registry, a prefab
 * catalog or a JSON DSL. The host owns the loop, the clock, the scope and
 * the commit channel.
 */
import type * as THREE from 'three';
import type { SimulationClock } from './clock.ts';
import type { CommitLog, CommitReceipt, PayloadValidator } from './events.ts';
import type { Scope } from './scope.ts';
import type { Diagnostic, SimPhase } from './errors.ts';

export interface FrameContext {
  /** Fixed simulation step in seconds (=== clock.fixedDt during simulate). */
  dt: number;
  /** Simulation time at this step. */
  time: number;
  /** Fixed-step counter. */
  tick: number;
  /** Interpolation factor; only meaningful in render frames. */
  alpha: number;
  phase: 'simulate' | 'render';
}

/** Author-declared stable identity for an object/parameter (M6 bindings). */
export type AuthorId = string;

export interface SceneContext {
  /** Three scene owned by the host; attach instance.root here or keep it detached. */
  readonly scene: THREE.Scene;
  readonly scope: Scope;
  /** Read-only clock view. Modules never advance it. */
  readonly clock: Pick<SimulationClock, 'fixedDt' | 'time' | 'tick' | 'isPaused'>;
  /** Session identity for this instance. */
  readonly session: { sessionId: string; generation: number; experienceDigest: string; buildId: string };
  /** Commit a namespaced fact/mechanism event with an idempotency key. */
  commit(name: string, payload: unknown, eventId: string): CommitReceipt;
  /** Register a payload validator for an event name or `prefix.*`. */
  registerEventValidator(namePrefix: string, validator: PayloadValidator): void;
  /** Subscribe to committed events of this session. */
  onCommit(listener: (envelope: import('./events.ts').EventEnvelope, receipt: CommitReceipt) => void): () => void;
  /** Hook an additional fixed-step phase (intent/physics/mechanics/present). */
  onPhase(phase: SimPhase, fn: (frame: FrameContext) => void): void;
  /** Emit a diagnostic attached to this session (bounded, no secrets). */
  report(diagnostic: Diagnostic): void;
}

export interface SceneInstance {
  /** Root object the host adds to the scene. */
  readonly root: THREE.Object3D;
  /** Per fixed simulation step. Ordinary free-form code lives here. */
  update?(frame: FrameContext): void;
  /** Optional render/interpolation hook; commits are rejected inside it. */
  render?(frame: FrameContext): void;
  activate?(): void;
  deactivate?(): void;
  destroy?(): void;
}

export interface SceneModule {
  create(ctx: SceneContext): SceneInstance | Promise<SceneInstance>;
}

/** Bounded read-only snapshot of one object for inspect queries. */
export interface ObjectSnapshot {
  handle: string;
  name: string;
  type: string;
  parent: string | null;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  visible: boolean;
  authorId?: string;
  userDataKeys: string[];
}
