/**
 * AnimationMixer manager (S07): a thin, scope-bound wrapper over THREE's
 * AnimationMixer. One handle owns one mixer root; actions are created,
 * crossfaded and disposed through the handle so the session scope can clean
 * everything up at stop/destroy.
 *
 * Authority note (ENGINE-SYSTEMS §2): a mixer only ever writes to the object
 * subtree it was bound to. Clips affect visual nodes; they never write player
 * or physics-authoritative roots unless the author deliberately binds the
 * mixer to such a root.
 *
 * Procedural update remains a first-class alternative: a plain `update(frame)`
 * on the SceneInstance can drive the exact same properties; nothing here is
 * required for animation, and nothing forces authors off free-form code.
 *
 * Headless use: construct `new MixerHandle(root)` and call `update(dt)`
 * manually; or use `createMixer(ctx, root)` to have the host clock drive the
 * mixer from the `present` phase and the scope dispose it.
 */
import * as THREE from 'three';
import type { SceneContext, FrameContext } from '../core/context.ts';

export interface PlayClipOptions {
  /** Bind the action to a subtree other than the mixer root. */
  target?: THREE.Object3D;
  /** false plays once (LoopOnce); default true (LoopRepeat). */
  loop?: boolean;
  repetitions?: number;
  timeScale?: number;
  /**
   * Seconds. When > 0 the new action fades in while every other running
   * action fades out over the same window (weights stay complementary).
   */
  fadeIn?: number;
  startAt?: number;
  /** Default true; keeps the final frame when a LoopOnce action finishes. */
  clampWhenFinished?: boolean;
}

export interface CrossFadeOptions {
  loop?: boolean;
  timeScale?: number;
  /** Passed to THREE crossFadeTo (syncs the fade envelopes). */
  warp?: boolean;
  clampWhenFinished?: boolean;
}

/** Where an action lives, so timelines can reach its mixer for end-state work. */
export interface ActionBinding {
  mixer: THREE.AnimationMixer;
  root: THREE.Object3D;
}

const bindings = new WeakMap<THREE.AnimationAction, ActionBinding>();

/** Binding recorded by MixerHandle (undefined for actions built elsewhere). */
export function resolveActionBinding(action: THREE.AnimationAction): ActionBinding | undefined {
  return bindings.get(action);
}

export class MixerHandle {
  readonly mixer: THREE.AnimationMixer;

  private readonly actions = new Set<THREE.AnimationAction>();
  private readonly clips = new Set<THREE.AnimationClip>();
  private disposed = false;

  constructor(root: THREE.Object3D) {
    this.mixer = new THREE.AnimationMixer(root);
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  /** Mixer clock in seconds (only advances via update). */
  get time(): number {
    return this.mixer.time;
  }

  /**
   * Play a clip. With fadeIn > 0 this is a crossfade: the new action fades
   * in while all other running actions fade out over the same duration.
   */
  play(clip: THREE.AnimationClip, opts?: PlayClipOptions): THREE.AnimationAction {
    this.assertAlive();
    const action = this.mixer.clipAction(clip, opts?.target);
    action.reset();
    action.enabled = true;
    const loop = opts?.loop !== false;
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, opts?.repetitions ?? Infinity);
    action.clampWhenFinished = opts?.clampWhenFinished ?? true;
    action.timeScale = opts?.timeScale ?? 1;
    if (opts?.startAt !== undefined) action.time = opts.startAt;
    const fadeIn = opts?.fadeIn ?? 0;
    if (fadeIn > 0) {
      for (const other of this.actions) {
        if (other !== action && other.isRunning()) other.fadeOut(fadeIn);
      }
      action.fadeIn(fadeIn);
    }
    action.play();
    this.actions.add(action);
    this.clips.add(clip);
    bindings.set(action, { mixer: this.mixer, root: opts?.target ?? (this.mixer.getRoot() as THREE.Object3D) });
    return action;
  }

  /**
   * Create (or reuse) a bound action without starting it. This is the natural
   * way to obtain actions for timeline playClip steps: the timeline starts,
   * loops and finalizes the action itself, and the recorded binding lets it
   * flush the deterministic end pose and support scrub previews.
   */
  prepare(clip: THREE.AnimationClip, opts?: Pick<PlayClipOptions, 'target'>): THREE.AnimationAction {
    this.assertAlive();
    const action = this.mixer.clipAction(clip, opts?.target);
    this.actions.add(action);
    this.clips.add(clip);
    bindings.set(action, { mixer: this.mixer, root: opts?.target ?? (this.mixer.getRoot() as THREE.Object3D) });
    return action;
  }

  /**
   * Crossfade from a running action to another clip or action over
   * `duration` seconds. Complementary weights (getEffectiveWeight sums to 1).
   */
  crossFade(
    from: THREE.AnimationAction,
    to: THREE.AnimationClip | THREE.AnimationAction,
    duration: number,
    opts?: CrossFadeOptions,
  ): THREE.AnimationAction {
    this.assertAlive();
    if (!(duration > 0)) {
      throw new Error('crossFade duration must be positive');
    }
    const toAction =
      to instanceof THREE.AnimationClip
        ? this.play(to, {
            loop: opts?.loop,
            timeScale: opts?.timeScale,
            clampWhenFinished: opts?.clampWhenFinished,
          })
        : to;
    if (!toAction.isRunning()) toAction.reset().play();
    from.crossFadeTo(toAction, duration, opts?.warp ?? false);
    this.actions.add(toAction);
    if (to instanceof THREE.AnimationClip) this.clips.add(to);
    return toAction;
  }

  /** Advance the mixer clock. Called automatically from the present hook. */
  update(dt: number): void {
    if (this.disposed) return;
    this.mixer.update(dt);
  }

  /** Stop every action (poses fall back to whatever else drives the nodes). */
  stopAll(): void {
    for (const action of this.actions) action.stop();
  }

  /**
   * Unbind everything: all actions stopped, all clips uncached so their
   * property bindings release. Idempotent; safe as a scope-owned resource.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const action of this.actions) action.stop();
    this.actions.clear();
    for (const clip of this.clips) this.mixer.uncacheClip(clip);
    this.clips.clear();
  }

  private assertAlive(): void {
    if (this.disposed) {
      throw new Error('MixerHandle is disposed');
    }
  }
}

export interface CreateMixerOptions {
  /**
   * Default true: register a `present` phase hook so the host clock drives
   * mixer.update with the fixed step. Set false for fully manual update(dt).
   */
  autoUpdate?: boolean;
}

/**
 * Bind a mixer to the session: scope-owned (disposed at stop/destroy) and, by
 * default, advanced from the host clock's `present` phase.
 */
export function createMixer(
  ctx: SceneContext,
  root: THREE.Object3D,
  opts?: CreateMixerOptions,
): MixerHandle {
  const handle = new MixerHandle(root);
  if (opts?.autoUpdate !== false) {
    const hook = (frame: FrameContext) => handle.update(frame.dt);
    ctx.onPhase('present', hook);
  }
  ctx.scope.own(handle);
  return handle;
}
