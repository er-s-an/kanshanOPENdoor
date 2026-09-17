/**
 * Ordinary-TS timelines for orchestration (S07, gates G07/G07.a).
 *
 * A timeline is a plain sequence of steps built in code — sequence/parallel/
 * wait/tween/playClip/cameraCut/cameraBlend/cue — NOT a JSON DSL. Steps are
 * composable values; arbitrary callbacks stay legal by authoring a custom
 * SceneModule instead. Free-form procedural update remains a fully supported
 * first-class path; this system exists for cutscene-style orchestration.
 *
 * Contracts:
 * - Deterministic end state: every tween/clip/camera step finalizes through
 *   ONE code path, so natural completion and skip() reach the SAME semantic
 *   end state (skip fast-forwards through that same finalize).
 * - Gameplay facts: cue() commits go through ctx.commit with an idempotency
 *   key (explicit eventId or `${runId}/cue/${uid}`); natural-complete and
 *   skip dedupe to exactly one commit per run.
 * - Cancel policy is declared per timeline ('freeze' | 'finish' | 'revert');
 *   cancelled runs settle their finished promise and run no further steps;
 *   late updates after cancel/destroy are no-ops (scope guard).
 * - scrub() is an isolated preview: it evaluates the plan against CLONED
 *   targets, never touches real targets, never commits, never saves.
 * - Progress is sim-time driven (host fixed steps / explicit update(dt));
 *   pause (host or handle) freezes progress — no wall clock anywhere.
 *
 * Camera steps take a director control token for the whole run and release
 * it at the terminal state, restoring the previous rig (see camera/rigs.ts).
 */
import * as THREE from 'three';
import { CreativeError } from '../core/errors.ts';
import type { SceneContext } from '../core/context.ts';
import { asEasing, linear, type EasingFn, type EasingName } from './easing.ts';
import { resolveActionBinding } from './mixer.ts';
import type { CameraDirector, CameraRig } from '../camera/rigs.ts';

// ---------------------------------------------------------------------------
// Plan nodes (plain data, built by the factory functions below)
// ---------------------------------------------------------------------------

export interface TweenSpec {
  target: THREE.Object3D;
  /** End values keyed by path: 'rotation.y', 'position', 'material.opacity', ... */
  props: Record<string, number | THREE.Vector3>;
  /** Explicit start values (per-path). When omitted, captured on first apply. */
  from?: Record<string, number | THREE.Vector3>;
  duration: number;
  easing?: EasingFn | EasingName;
}

export type PlanNode =
  | { readonly kind: 'wait'; readonly duration: number }
  | { readonly kind: 'tween'; readonly spec: TweenSpec; readonly easing: EasingFn; readonly uid: number }
  | {
      readonly kind: 'clip';
      readonly action: THREE.AnimationAction;
      readonly duration: number;
      readonly fadeIn: number;
      readonly uid: number;
    }
  | {
      readonly kind: 'camera';
      readonly op: 'cut' | 'blend';
      readonly rig: CameraRig;
      readonly duration: number;
      readonly easing: EasingFn;
      readonly uid: number;
    }
  | { readonly kind: 'cue'; readonly name: string; readonly payload: unknown; readonly eventId?: string; readonly uid: number }
  | { readonly kind: 'sequence'; readonly children: readonly PlanNode[] }
  | { readonly kind: 'parallel'; readonly children: readonly PlanNode[] };

let nextStepUid = 0;
function nextUid(): number {
  nextStepUid += 1;
  return nextStepUid;
}

export function wait(duration: number): PlanNode {
  if (!(duration >= 0) || !Number.isFinite(duration)) {
    throw new CreativeError('BAD_TIMELINE_STEP', `wait duration must be a finite >= 0, got ${duration}`, { phase: 'create' });
  }
  return { kind: 'wait', duration };
}

export function tween(spec: TweenSpec): PlanNode {
  if (!spec.target) {
    throw new CreativeError('BAD_TIMELINE_STEP', 'tween requires a target Object3D', { phase: 'create' });
  }
  if (!(spec.duration > 0) || !Number.isFinite(spec.duration)) {
    throw new CreativeError('BAD_TIMELINE_STEP', `tween duration must be a finite > 0, got ${spec.duration}`, { phase: 'create' });
  }
  if (Object.keys(spec.props).length === 0) {
    throw new CreativeError('BAD_TIMELINE_STEP', 'tween needs at least one prop', { phase: 'create' });
  }
  return { kind: 'tween', spec, easing: asEasing(spec.easing), uid: nextUid() };
}

/**
 * Play a mixer action for the step duration (default: one full clip pass).
 * The bound mixer drives the pose during natural playback; the step ends
 * paused exactly on the final frame so natural and skip states coincide.
 * Prefer actions created through MixerHandle.play so the end-state flush
 * and scrub preview can reach the mixer.
 */
export function playClip(action: THREE.AnimationAction, opts?: { duration?: number; fadeIn?: number }): PlanNode {
  const clip = action.getClip();
  const ts = Math.abs(action.timeScale) || 1;
  const duration = opts?.duration ?? clip.duration / Math.max(ts, 1e-9);
  if (!(duration > 0) || !Number.isFinite(duration)) {
    throw new CreativeError('BAD_TIMELINE_STEP', `playClip duration must be a finite > 0, got ${duration}`, { phase: 'create' });
  }
  return { kind: 'clip', action, duration, fadeIn: opts?.fadeIn ?? 0, uid: nextUid() };
}

/** Instant camera cut (holds the run's takeover token until the run ends). */
export function cameraCut(rig: CameraRig): PlanNode {
  if (!rig) throw new CreativeError('BAD_TIMELINE_STEP', 'cameraCut requires a rig', { phase: 'create' });
  return { kind: 'camera', op: 'cut', rig, duration: 0, easing: linear, uid: nextUid() };
}

/** Blended camera handoff over `duration` seconds (director-driven). */
export function cameraBlend(rig: CameraRig, duration: number, opts?: { easing?: EasingFn | EasingName }): PlanNode {
  if (!rig) throw new CreativeError('BAD_TIMELINE_STEP', 'cameraBlend requires a rig', { phase: 'create' });
  if (!(duration > 0) || !Number.isFinite(duration)) {
    throw new CreativeError('BAD_TIMELINE_STEP', `cameraBlend duration must be a finite > 0, got ${duration}`, { phase: 'create' });
  }
  return { kind: 'camera', op: 'blend', rig, duration, easing: asEasing(opts?.easing), uid: nextUid() };
}

/**
 * Gameplay fact. Commits through ctx.commit with an idempotency key: pass an
 * explicit eventId to make the cue idempotent across replays, or accept the
 * default `${runId}/cue/${uid}` (unique per run, deduped within one run, so a
 * natural-then-skipped cue commits exactly once).
 */
export function cue(name: string, payload?: unknown, opts?: { eventId?: string }): PlanNode {
  if (!name || !name.includes('.')) {
    throw new CreativeError('BAD_TIMELINE_STEP', `cue name must be namespaced ("module.event"), got "${name}"`, { phase: 'create' });
  }
  return { kind: 'cue', name, payload, eventId: opts?.eventId, uid: nextUid() };
}

/** Run children one after another (total duration = sum). */
export function sequence(...children: PlanNode[]): PlanNode {
  return { kind: 'sequence', children };
}

/** Run children at the same time (total duration = max). */
export function parallel(...children: PlanNode[]): PlanNode {
  return { kind: 'parallel', children };
}

/** Declared duration of a plan node (0 for instantaneous steps). */
export function planDuration(node: PlanNode): number {
  switch (node.kind) {
    case 'wait':
      return node.duration;
    case 'tween':
      return node.spec.duration;
    case 'clip':
      return node.duration;
    case 'camera':
      return node.op === 'cut' ? 0 : node.duration;
    case 'cue':
      return 0;
    case 'sequence':
      return node.children.reduce((a, c) => a + planDuration(c), 0);
    case 'parallel':
      return node.children.reduce((a, c) => Math.max(a, planDuration(c)), 0);
  }
}

// ---------------------------------------------------------------------------
// Property paths
// ---------------------------------------------------------------------------

function readPath(root: unknown, path: string): unknown {
  const keys = path.split('.');
  let cur: unknown = root;
  for (const key of keys) {
    if (cur === null || typeof cur !== 'object') break;
    cur = (cur as Record<string, unknown>)[key];
  }
  if (cur === undefined || cur === null) {
    throw new CreativeError('BAD_TWEEN_PATH', `tween path "${path}" does not resolve`, { phase: 'present' });
  }
  return cur;
}

function writePath(root: unknown, path: string, value: unknown): void {
  const keys = path.split('.');
  let cur: unknown = root;
  for (let i = 0; i < keys.length - 1; i += 1) {
    if (cur === null || typeof cur !== 'object') {
      throw new CreativeError('BAD_TWEEN_PATH', `tween path "${path}" does not resolve`, { phase: 'present' });
    }
    cur = (cur as Record<string, unknown>)[keys[i]];
  }
  if (cur === null || typeof cur !== 'object') {
    throw new CreativeError('BAD_TWEEN_PATH', `tween path "${path}" does not resolve`, { phase: 'present' });
  }
  (cur as Record<string, unknown>)[keys[keys.length - 1]] = value;
}

// ---------------------------------------------------------------------------
// Run context
// ---------------------------------------------------------------------------

/** Structural view of a camera control token (camera/rigs CameraControl fits). */
export interface CameraControlLike {
  cut(rig: CameraRig): void;
  blend(rig: CameraRig, duration: number, opts?: { easing?: EasingFn | EasingName }): void;
  completeBlend(): void;
  release(): void;
}

interface RunCtx {
  readonly preview: boolean;
  readonly runId: string;
  resolveTarget(obj: THREE.Object3D): THREE.Object3D;
  commitCue(uid: number, name: string, payload: unknown, eventId: string): void;
  cameraControl(): CameraControlLike | null;
  logCamera(uid: number, op: 'cut' | 'blend', rigName: string): void;
  mapPreviewRoot?(source: THREE.Object3D, clone: THREE.Object3D): void;
}

// ---------------------------------------------------------------------------
// Runtime steps
// ---------------------------------------------------------------------------

const TIME_EPS = 1e-9;

abstract class RStep {
  elapsed = 0;
  started = false;
  done = false;
  readonly node: PlanNode;
  readonly rc: RunCtx;

  constructor(node: PlanNode, rc: RunCtx) {
    this.node = node;
    this.rc = rc;
  }

  abstract get duration(): number;

  start(): void {
    this.started = true;
  }

  update(dt: number): void {
    if (this.done) return;
    if (!this.started) this.start();
    this.elapsed += dt;
    this.applyLocal(this.localT(this.elapsed));
    if (this.elapsed >= this.duration - TIME_EPS) this.finish('natural');
  }

  protected localT(elapsed: number): number {
    return this.duration > 0 ? Math.min(1, elapsed / this.duration) : 1;
  }

  protected applyLocal(_t: number): void {
    /* noop by default */
  }

  /** Deterministic terminal state — identical path for natural and skip. */
  finish(kind: 'natural' | 'skip'): void {
    if (this.done) return;
    if (!this.started) this.start();
    this.applyLocal(1);
    this.finishImpl(kind);
    this.done = true;
  }

  protected finishImpl(_kind: 'natural' | 'skip'): void {
    /* noop by default */
  }

  revert(): void {
    /* noop by default */
  }

  /** Absolute-time evaluation used by scrub previews. */
  applyAt(T: number): void {
    if (this.done || T <= 0) return;
    if (!this.started) this.start();
    this.applyLocal(this.localT(T));
    if (T >= this.duration - TIME_EPS) this.finish('skip');
  }

  disposeDeep(): void {
    /* noop by default */
  }
}

class WaitRStep extends RStep {
  get duration(): number {
    return (this.node as Extract<PlanNode, { kind: 'wait' }>).duration;
  }
}

class CueRStep extends RStep {
  private fired = false;

  get duration(): number {
    return 0;
  }

  start(): void {
    if (this.fired) return;
    super.start();
    this.fired = true;
    const node = this.node as Extract<PlanNode, { kind: 'cue' }>;
    const eventId = node.eventId ?? `${this.rc.runId}/cue/${node.uid}`;
    this.rc.commitCue(node.uid, node.name, node.payload, eventId);
  }
}

class TweenRStep extends RStep {
  private from: Record<string, number | THREE.Vector3> | null = null;

  get duration(): number {
    return (this.node as Extract<PlanNode, { kind: 'tween' }>).spec.duration;
  }

  start(): void {
    super.start();
    const node = this.node as Extract<PlanNode, { kind: 'tween' }>;
    const target = this.rc.resolveTarget(node.spec.target);
    const from: Record<string, number | THREE.Vector3> = {};
    for (const path of Object.keys(node.spec.props)) {
      const explicit = node.spec.from?.[path];
      if (explicit !== undefined) {
        from[path] = explicit instanceof THREE.Vector3 ? explicit.clone() : explicit;
        continue;
      }
      const current = readPath(target, path);
      if (!(typeof current === 'number' || current instanceof THREE.Vector3)) {
        throw new CreativeError('BAD_TWEEN_PATH', `tween path "${path}" is not numeric/Vector3`, { phase: 'present' });
      }
      from[path] = current instanceof THREE.Vector3 ? current.clone() : current;
    }
    this.from = from;
  }

  protected applyLocal(t: number): void {
    if (!this.from) return;
    const node = this.node as Extract<PlanNode, { kind: 'tween' }>;
    const target = this.rc.resolveTarget(node.spec.target);
    const k = node.easing(t);
    for (const [path, to] of Object.entries(node.spec.props)) {
      const from = this.from[path];
      if (to instanceof THREE.Vector3) {
        const slot = readPath(target, path);
        if (!(from instanceof THREE.Vector3) || !(slot instanceof THREE.Vector3)) {
          throw new CreativeError('BAD_TWEEN_PATH', `tween path "${path}" is not a Vector3`, { phase: 'present' });
        }
        slot.copy(from).lerp(to, k);
      } else {
        const slot = readPath(target, path);
        if (typeof from !== 'number' || typeof slot !== 'number') {
          throw new CreativeError('BAD_TWEEN_PATH', `tween path "${path}" is not a number`, { phase: 'present' });
        }
        writePath(target, path, from + (to - from) * k);
      }
    }
  }

  revert(): void {
    if (!this.from) return;
    const node = this.node as Extract<PlanNode, { kind: 'tween' }>;
    const target = this.rc.resolveTarget(node.spec.target);
    for (const [path, from] of Object.entries(this.from)) {
      writePath(target, path, from instanceof THREE.Vector3 ? from.clone() : from);
    }
  }
}

class ClipRStep extends RStep {
  private previewMixer: THREE.AnimationMixer | null = null;
  private previewAction: THREE.AnimationAction | null = null;

  get duration(): number {
    return (this.node as Extract<PlanNode, { kind: 'clip' }>).duration;
  }

  start(): void {
    super.start();
    const node = this.node as Extract<PlanNode, { kind: 'clip' }>;
    if (this.rc.preview) {
      const binding = resolveActionBinding(node.action);
      if (binding) {
        const rootClone = binding.root.clone(true);
        this.previewMixer = new THREE.AnimationMixer(rootClone);
        this.previewAction = this.previewMixer.clipAction(node.action.getClip());
        this.previewAction.play();
        this.previewMixer.update(0);
        this.rc.mapPreviewRoot?.(binding.root, rootClone);
      }
      return;
    }
    const action = node.action;
    action.reset();
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    if (node.fadeIn > 0) action.fadeIn(node.fadeIn);
  }

  protected applyLocal(t: number): void {
    if (!this.rc.preview || !this.previewMixer || !this.previewAction) return;
    const clip = (this.node as Extract<PlanNode, { kind: 'clip' }>).action.getClip();
    this.previewAction.time = Math.min(t * this.duration, clip.duration);
    this.previewMixer.update(0);
  }

  protected finishImpl(_kind: 'natural' | 'skip'): void {
    if (this.rc.preview) return; // base applyLocal(1) already posed the preview clone
    const node = this.node as Extract<PlanNode, { kind: 'clip' }>;
    const action = node.action;
    const clip = action.getClip();
    const end = Math.min(this.duration, clip.duration);
    // Deterministic terminal pose on the final frame, fade-independent.
    action.stopFading();
    action.setEffectiveWeight(1);
    action.time = end;
    action.paused = true;
    const binding = resolveActionBinding(action);
    if (binding) binding.mixer.update(0);
  }

  revert(): void {
    if (this.rc.preview) return;
    (this.node as Extract<PlanNode, { kind: 'clip' }>).action.stop();
  }

  disposeDeep(): void {
    if (!this.previewMixer) return;
    const clip = (this.node as Extract<PlanNode, { kind: 'clip' }>).action.getClip();
    this.previewMixer.stopAllAction();
    this.previewMixer.uncacheClip(clip);
    this.previewMixer = null;
    this.previewAction = null;
  }
}

class CameraRStep extends RStep {
  private ctl: CameraControlLike | null = null;

  get duration(): number {
    const node = this.node as Extract<PlanNode, { kind: 'camera' }>;
    return node.op === 'cut' ? 0 : node.duration;
  }

  start(): void {
    super.start();
    const node = this.node as Extract<PlanNode, { kind: 'camera' }>;
    if (this.rc.preview) {
      this.rc.logCamera(node.uid, node.op, node.rig.name);
      return;
    }
    const ctl = this.rc.cameraControl();
    if (!ctl) {
      throw new CreativeError(
        'CAMERA_DIRECTOR_MISSING',
        'timeline declares camera steps; run(ctx, { camera: director }) is required',
        { phase: 'present' },
      );
    }
    this.ctl = ctl;
    if (node.op === 'cut') ctl.cut(node.rig);
    else ctl.blend(node.rig, node.duration, { easing: node.easing });
  }

  protected finishImpl(_kind: 'natural' | 'skip'): void {
    const node = this.node as Extract<PlanNode, { kind: 'camera' }>;
    if (!this.rc.preview && this.ctl && node.op === 'blend') this.ctl.completeBlend();
  }
}

class SequenceRStep extends RStep {
  private readonly children: RStep[];
  private cursor = 0;

  constructor(node: PlanNode, rc: RunCtx, children: RStep[]) {
    super(node, rc);
    this.children = children;
  }

  get duration(): number {
    return this.children.reduce((a, c) => a + c.duration, 0);
  }

  update(dt: number): void {
    if (this.done) return;
    if (!this.started) this.start();
    let remaining = dt;
    while (remaining > 1e-12 && this.cursor < this.children.length) {
      const head = this.children[this.cursor];
      const before = head.elapsed;
      head.update(remaining);
      if (head.done) {
        this.cursor += 1;
        remaining -= Math.max(head.duration - before, 0);
      } else {
        break;
      }
    }
    if (this.cursor >= this.children.length) this.finish('natural');
  }

  protected finishImpl(kind: 'natural' | 'skip'): void {
    for (let i = this.cursor; i < this.children.length; i += 1) {
      this.children[i].finish(kind);
    }
  }

  revert(): void {
    for (const child of this.children) child.revert();
  }

  applyAt(T: number): void {
    if (this.done || T <= 0) return;
    if (!this.started) this.start();
    let acc = 0;
    for (const child of this.children) {
      const cd = child.duration;
      if (T >= acc + cd - TIME_EPS) {
        child.finish('skip');
        acc += cd;
      } else {
        if (T > acc) child.applyAt(T - acc);
        break;
      }
    }
  }

  disposeDeep(): void {
    for (const child of this.children) child.disposeDeep();
  }
}

class ParallelRStep extends RStep {
  private readonly children: RStep[];

  constructor(node: PlanNode, rc: RunCtx, children: RStep[]) {
    super(node, rc);
    this.children = children;
  }

  get duration(): number {
    return this.children.reduce((a, c) => Math.max(a, c.duration), 0);
  }

  update(dt: number): void {
    if (this.done) return;
    if (!this.started) this.start();
    let allDone = true;
    for (const child of this.children) {
      child.update(dt);
      if (!child.done) allDone = false;
    }
    if (allDone) this.finish('natural');
  }

  protected finishImpl(kind: 'natural' | 'skip'): void {
    for (const child of this.children) child.finish(kind);
  }

  revert(): void {
    for (const child of this.children) child.revert();
  }

  applyAt(T: number): void {
    if (this.done || T <= 0) return;
    if (!this.started) this.start();
    for (const child of this.children) {
      if (T >= child.duration - TIME_EPS) child.finish('skip');
      else child.applyAt(T);
    }
  }

  disposeDeep(): void {
    for (const child of this.children) child.disposeDeep();
  }
}

function instantiate(node: PlanNode, rc: RunCtx): RStep {
  switch (node.kind) {
    case 'wait':
      return new WaitRStep(node, rc);
    case 'tween':
      return new TweenRStep(node, rc);
    case 'clip':
      return new ClipRStep(node, rc);
    case 'camera':
      return new CameraRStep(node, rc);
    case 'cue':
      return new CueRStep(node, rc);
    case 'sequence':
      return new SequenceRStep(node, rc, node.children.map((c) => instantiate(c, rc)));
    case 'parallel':
      return new ParallelRStep(node, rc, node.children.map((c) => instantiate(c, rc)));
  }
}

// ---------------------------------------------------------------------------
// Public handle types
// ---------------------------------------------------------------------------

export type CancelPolicy = 'freeze' | 'finish' | 'revert';
export type TimelineState = 'running' | 'paused' | 'completed' | 'skipped' | 'cancelled';

export interface TimelineResult {
  status: 'completed' | 'skipped' | 'cancelled';
  time: number;
}

export interface TimelineHandle {
  readonly state: TimelineState;
  /** Sim seconds consumed by this run (pauses excluded). */
  readonly time: number;
  /** Declared total duration of the plan. */
  readonly duration: number;
  pause(): void;
  resume(): void;
  /** Fast-forward to the same semantic end state as natural completion. */
  skip(): void;
  /** Stop per the timeline's declared cancelPolicy; settles finished. */
  cancel(): void;
  /** Advance manually (headless). With autoHook, the host calls this. */
  update(dt: number): void;
  readonly finished: Promise<TimelineResult>;
}

export interface RunOptions {
  /** Default true: drive update(dt) from the host's present phase. */
  autoHook?: boolean;
  /** Required when the plan has camera steps. */
  camera?: CameraDirector;
}

export type PreviewEvent =
  | { type: 'cue'; name: string; payload: unknown; eventId: string }
  | { type: 'camera'; op: 'cut' | 'blend'; rig: string };

export interface ScrubHandle {
  readonly time: number;
  /** Cues/camera ops the preview has passed (deduped; never committed). */
  readonly previewLog: ReadonlyArray<PreviewEvent>;
  /** Source -> preview object (session-owned clones or author-supplied base). */
  readonly previewTargets: ReadonlyMap<THREE.Object3D, THREE.Object3D>;
  /** Evaluate the plan at absolute time t against the preview targets. */
  setTime(t: number): void;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Timeline builder
// ---------------------------------------------------------------------------

export interface TimelineOptions {
  /** 'freeze' (default): targets stay; 'finish': jump to end state; 'revert': restore start values. */
  cancelPolicy?: CancelPolicy;
  /** Global multiplier on incoming dt. */
  timeScale?: number;
  /** Declared naturalEnd / skipEnd semantics (enforced by construction: both
   *  paths run the identical finalize, so they cannot diverge). */
  endState?: { natural: string; skip: string };
}

export class Timeline {
  readonly name: string;
  readonly cancelPolicy: CancelPolicy;
  readonly timeScale: number;
  readonly declaredEnd: { natural: string; skip: string };
  private readonly steps: PlanNode[] = [];

  constructor(name: string, opts?: TimelineOptions) {
    if (!name) throw new Error('timeline needs a name');
    this.name = name;
    this.cancelPolicy = opts?.cancelPolicy ?? 'freeze';
    this.timeScale = opts?.timeScale ?? 1;
    this.declaredEnd = opts?.endState ?? { natural: 'as scripted', skip: 'same end state as natural completion' };
  }

  /** Append steps sequentially. */
  add(...steps: PlanNode[]): this {
    for (const step of steps) this.steps.push(step);
    return this;
  }

  /** Append steps as one parallel group. */
  addParallel(...steps: PlanNode[]): this {
    return this.add(parallel(...steps));
  }

  get stepCount(): number {
    return this.steps.length;
  }

  /** Read-only view of the plan for runners/previews. */
  get planSteps(): readonly PlanNode[] {
    return this.steps;
  }

  /** Declared duration (sequence semantics over the top-level steps). */
  get duration(): number {
    return this.steps.reduce((a, s) => a + planDuration(s), 0);
  }

  run(ctx: SceneContext, opts?: RunOptions): TimelineHandle {
    return new TimelineRun(this, ctx, opts);
  }

  /**
   * Isolated preview: cloned targets (or an explicit author-supplied base
   * binding), no commits, no persistence. Without `base`, each tween target
   * is cloned lazily from its CURRENT state — for a pristine preview of a
   * timeline that already ran, pass a base map of source -> pristine object
   * (or declare explicit `from` values in the tweens).
   */
  createScrub(base?: ReadonlyMap<THREE.Object3D, THREE.Object3D>): ScrubHandle {
    return new ScrubSession(this, base);
  }
}

export function timeline(name: string, opts?: TimelineOptions): Timeline {
  return new Timeline(name, opts);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

let runCounter = 0;
function makeRunId(name: string): string {
  runCounter += 1;
  return `${name}#${runCounter}`;
}

class TimelineRun implements TimelineHandle {
  state: TimelineState = 'running';
  readonly duration: number;
  readonly finished: Promise<TimelineResult>;

  private readonly tl: Timeline;
  private readonly ctx: SceneContext;
  private readonly camera?: CameraDirector;
  private root: RStep;
  private clock = 0;
  private cameraToken: CameraControlLike | null = null;
  private readonly resolveFinished: (r: TimelineResult) => void;

  constructor(tl: Timeline, ctx: SceneContext, opts?: RunOptions) {
    this.tl = tl;
    this.ctx = ctx;
    this.camera = opts?.camera;
    this.duration = tl.duration;
    let resolveFn!: (r: TimelineResult) => void;
    this.finished = new Promise<TimelineResult>((resolve) => {
      resolveFn = resolve;
    });
    this.resolveFinished = resolveFn;
    this.root = instantiate({ kind: 'sequence', children: tl.planSteps }, this.makeRunCtx());
    if (opts?.autoHook !== false) {
      ctx.onPhase('present', (frame) => this.update(frame.dt));
    }
    // Scope guard: dispose/destroy cancels the run; late updates are no-ops.
    ctx.scope.defer(() => {
      this.cancel();
    });
  }

  get time(): number {
    return this.clock;
  }

  update(dt: number): void {
    if (this.state !== 'running') return;
    const scaled = dt * this.tl.timeScale;
    this.root.update(scaled);
    this.clock += scaled;
    if (this.root.done) {
      this.root.finish('natural');
      this.terminate('completed');
    }
  }

  pause(): void {
    if (this.state === 'running') this.state = 'paused';
  }

  resume(): void {
    if (this.state === 'paused') this.state = 'running';
  }

  skip(): void {
    if (this.isTerminal()) return;
    this.root.finish('skip');
    this.terminate('skipped');
  }

  cancel(): void {
    if (this.isTerminal()) return;
    if (this.tl.cancelPolicy === 'finish') {
      this.root.finish('skip');
    } else if (this.tl.cancelPolicy === 'revert') {
      this.root.revert();
    }
    // 'freeze' (default): leave targets exactly where they are.
    this.terminate('cancelled');
  }

  private isTerminal(): boolean {
    return this.state === 'completed' || this.state === 'skipped' || this.state === 'cancelled';
  }

  private terminate(status: TimelineState): void {
    if (this.isTerminal()) return;
    if (this.cameraToken) {
      this.cameraToken.release();
      this.cameraToken = null;
    }
    this.state = status;
    this.resolveFinished({ status: status as TimelineResult['status'], time: this.clock });
  }

  private makeRunCtx(): RunCtx {
    return {
      preview: false,
      runId: makeRunId(this.tl.name),
      resolveTarget: (obj) => obj,
      commitCue: (_uid, name, payload, eventId) => {
        this.ctx.commit(name, payload, eventId);
      },
      cameraControl: () => {
        if (!this.camera) {
          throw new CreativeError(
            'CAMERA_DIRECTOR_MISSING',
            'timeline has camera steps; run(ctx, { camera: director }) is required',
            { phase: 'present' },
          );
        }
        if (!this.cameraToken) this.cameraToken = this.camera.takeover();
        return this.cameraToken;
      },
      logCamera: () => {
        /* real runs do not log */
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Scrub (isolated preview)
// ---------------------------------------------------------------------------

class ScrubSession implements ScrubHandle {
  time = 0;
  readonly previewLog: PreviewEvent[] = [];
  readonly previewTargets = new Map<THREE.Object3D, THREE.Object3D>();

  private readonly plan: PlanNode;
  private readonly base?: ReadonlyMap<THREE.Object3D, THREE.Object3D>;
  private readonly ownedClones = new Set<THREE.Object3D>();
  private readonly rc: RunCtx;
  private readonly fired = new Set<number>();
  private root: RStep | null = null;
  private disposed = false;

  constructor(tl: Timeline, base?: ReadonlyMap<THREE.Object3D, THREE.Object3D>) {
    this.plan = { kind: 'sequence', children: tl.planSteps };
    this.base = base;
    this.rc = {
      preview: true,
      runId: `preview:${tl.name}`,
      resolveTarget: (obj) => {
        const bound = this.base?.get(obj);
        if (bound) {
          this.previewTargets.set(obj, bound);
          return bound;
        }
        let clone = this.previewTargets.get(obj);
        if (!clone || !this.ownedClones.has(clone)) {
          clone = obj.clone(true);
          this.ownedClones.add(clone);
          this.previewTargets.set(obj, clone);
        }
        return clone;
      },
      commitCue: (uid, name, payload, eventId) => {
        if (this.fired.has(uid)) return;
        this.fired.add(uid);
        this.previewLog.push({ type: 'cue', name, payload, eventId });
      },
      cameraControl: () => null,
      logCamera: (uid, op, rigName) => {
        if (this.fired.has(uid)) return;
        this.fired.add(uid);
        this.previewLog.push({ type: 'camera', op, rig: rigName });
      },
      mapPreviewRoot: (source, clone) => {
        this.previewTargets.set(source, clone);
      },
    };
  }

  setTime(t: number): void {
    if (this.disposed) return;
    this.time = Math.max(0, t);
    this.root?.disposeDeep();
    this.root = instantiate(this.plan, this.rc);
    this.root.applyAt(this.time);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root?.disposeDeep();
    this.root = null;
    this.ownedClones.clear();
    this.previewTargets.clear();
  }
}
