/**
 * RuntimeSessionHost: loads one SceneModule into a live session and owns the
 * single simulation clock, scope, commit channel and phase pipeline.
 *
 * Hard rules implemented here:
 * - Fixed-step phases run in PHASE_ORDER; module.update runs at `mechanics`
 *   by default... (see runSimStep) — presentation/interpolation never commits.
 * - Exception isolation (G02.a): create/update/destroy failures put this
 *   session into `error`, registered cleanups still run, other sessions are
 *   untouched, and the diagnostic carries phase + source location.
 * - Controlled stepping: `step(n)` works only in controlled mode or while
 *   paused; an auto-running session never gets a second stepping path (G15.a).
 * - stop() invalidates every handle: later query/step/command reject.
 */
import * as THREE from 'three';
import { SimulationClock } from './clock.ts';
import { Scope } from './scope.ts';
import { CommitLog } from './events.ts';
import { CreativeError, PHASE_ORDER, asDiagnostic } from './errors.ts';
import type { Diagnostic, Phase, SimPhase } from './errors.ts';
import type {
  FrameContext,
  ObjectSnapshot,
  SceneContext,
  SceneInstance,
  SceneModule,
} from './context.ts';

export type SessionStatus = 'loading' | 'running' | 'paused' | 'stopped' | 'error';
export type SessionMode = 'auto' | 'controlled';

export interface SessionHandle {
  sessionId: string;
  generation: number;
  experienceDigest: string;
  buildId: string;
}

export interface HostOptions {
  experienceDigest: string;
  buildId: string;
  mode?: SessionMode;
  fixedDt?: number;
  scene?: THREE.Scene;
  sessionId?: string;
  maxDiagnostics?: number;
}

export interface QueryRequest {
  kind: 'session' | 'scene' | 'object' | 'commits';
  /** For kind 'object'. */
  handle?: string;
  /** Bound for list results; default 200, hard cap 1000. */
  limit?: number;
}

export interface QueryResult {
  ok: boolean;
  handle: SessionHandle;
  status: SessionStatus;
  tick: number;
  data?: unknown;
  truncated?: boolean;
  error?: Diagnostic;
}

type PhaseHook = (frame: FrameContext) => void;

let sessionCounter = 0;

export class RuntimeSessionHost {
  readonly sessionId: string;
  readonly mode: SessionMode;
  readonly scene: THREE.Scene;
  readonly clock: SimulationClock;
  readonly commits: CommitLog;

  private generation = 0;
  private status: SessionStatus = 'loading';
  private scope = new Scope();
  private instance: SceneInstance | null = null;
  private moduleRootAdded = false;
  private readonly hooks = new Map<SimPhase, PhaseHook[]>();
  private readonly diagnostics: Diagnostic[] = [];
  private readonly maxDiagnostics: number;
  private readonly experienceDigest: string;
  private readonly buildId: string;
  private readonly handles = new Map<string, THREE.Object3D>();
  private nextHandleId = 0;
  private destroyError: Diagnostic | null = null;

  constructor(opts: HostOptions) {
    this.sessionId = opts.sessionId ?? `session-${Date.now().toString(36)}-${++sessionCounter}`;
    this.mode = opts.mode ?? 'controlled';
    this.scene = opts.scene ?? new THREE.Scene();
    this.clock = new SimulationClock({ fixedDt: opts.fixedDt });
    this.commits = new CommitLog({ sessionId: this.sessionId, generation: this.generation });
    this.experienceDigest = opts.experienceDigest;
    this.buildId = opts.buildId;
    this.maxDiagnostics = opts.maxDiagnostics ?? 200;
  }

  get currentStatus(): SessionStatus {
    return this.status;
  }

  get currentGeneration(): number {
    return this.generation;
  }

  get handle(): SessionHandle {
    return {
      sessionId: this.sessionId,
      generation: this.generation,
      experienceDigest: this.experienceDigest,
      buildId: this.buildId,
    };
  }

  get diagnosticsLog(): readonly Diagnostic[] {
    return this.diagnostics;
  }

  async start(module: SceneModule): Promise<SessionHandle> {
    this.assertNotStopped('command');
    this.status = 'loading';
    const ctx = this.makeContext();
    try {
      const instance = await module.create(ctx);
      if (!instance || !instance.root) {
        throw new CreativeError('BAD_INSTANCE', 'SceneModule.create must return an instance with a root Object3D', {
          phase: 'create',
        });
      }
      this.instance = instance;
      this.scene.add(instance.root);
      this.moduleRootAdded = true;
      instance.activate?.();
      this.status = 'running';
      return this.handle;
    } catch (err) {
      const diag = asDiagnostic(err, 'create', this.clock.tick, this.sessionId);
      this.fail(diag);
      throw err instanceof CreativeError ? err : new CreativeError(diag.code, diag.message, { phase: 'create', source: diag.source });
    }
  }

  /** Auto-mode frame: run all due fixed steps against real time (seconds). */
  advance(realNow: number): number {
    this.assertUsable('command');
    if (this.mode === 'controlled') {
      throw new CreativeError(
        'ADVANCE_IN_CONTROLLED',
        'controlled sessions advance only via step(); no second stepping path',
        { phase: 'command' },
      );
    }
    if (this.status === 'paused' || this.status === 'error') return 0;
    const due = this.clock.beginFrame(realNow);
    let ran = 0;
    while (this.status === 'running' && this.clock.step()) {
      this.runSimStep();
      ran += 1;
    }
    return ran;
  }

  /** Controlled manual stepping: never while auto-running (G15.a). */
  step(n = 1): void {
    this.assertUsable('command');
    if (this.mode === 'auto' && this.status === 'running') {
      throw new CreativeError('STEP_WHILE_RUNNING', 'manual step is rejected while the session is auto-running', {
        phase: 'command',
      });
    }
    if (this.status === 'error') {
      throw new CreativeError('SESSION_ERROR', 'session is in error state; inspect diagnostics or stop', {
        phase: 'command',
      });
    }
    for (let i = 0; i < n; i += 1) {
      if (this.status !== 'running' && this.status !== 'paused') break;
      this.clock.stepOnce();
      this.runSimStep();
    }
  }

  pause(): void {
    this.assertUsable('command');
    if (this.status === 'running') {
      this.status = 'paused';
      this.clock.pause();
    }
  }

  resume(realNow: number): void {
    this.assertUsable('command');
    if (this.status === 'paused') {
      this.clock.resume(realNow);
      this.status = 'running';
    }
  }

  /** Render/interpolation frame; commits are rejected inside render hooks. */
  renderFrame(): void {
    this.assertUsable('render');
    if (!this.instance?.render) return;
    const frame: FrameContext = {
      dt: this.clock.fixedDt,
      time: this.clock.time,
      tick: this.clock.tick,
      alpha: this.clock.alpha(),
      phase: 'render',
    };
    this.commits.setCommitsAllowed(false);
    try {
      this.instance.render(frame);
    } catch (err) {
      this.fail(asDiagnostic(err, 'render', this.clock.tick, this.sessionId));
    } finally {
      this.commits.setCommitsAllowed(true);
    }
  }

  query(req: QueryRequest): QueryResult {
    const base = { handle: this.handle, status: this.status, tick: this.clock.tick };
    if (this.status === 'stopped') {
      return { ...base, ok: false, error: { code: 'SESSION_STOPPED', message: 'session handle is invalid after stop', phase: 'query' as Phase } };
    }
    const limit = Math.min(Math.max(1, req.limit ?? 200), 1000);
    switch (req.kind) {
      case 'session':
        return {
          ...base,
          ok: true,
          data: {
            mode: this.mode,
            time: this.clock.time,
            tick: this.clock.tick,
            discardedTime: this.clock.discardedTime,
            diagnostics: [...this.diagnostics],
            commitCount: this.commits.entries.length,
          },
        };
      case 'commits': {
        const entries = this.commits.entries.slice(-limit);
        return {
          ...base,
          ok: true,
          data: entries,
          truncated: this.commits.entries.length > entries.length,
        };
      }
      case 'scene': {
        const out: ObjectSnapshot[] = [];
        let truncated = false;
        const walk = (obj: THREE.Object3D, parent: string | null) => {
          if (out.length >= limit) {
            truncated = true;
            return;
          }
          const handle = this.handleFor(obj);
          out.push(snapshot(obj, handle, parent));
          for (const child of obj.children) walk(child, handle);
        };
        walk(this.scene, null);
        return { ...base, ok: true, data: out, truncated };
      }
      case 'object': {
        const obj = req.handle ? this.handles.get(req.handle) : undefined;
        if (!obj) {
          return { ...base, ok: false, error: { code: 'BAD_HANDLE', message: `unknown object handle "${req.handle}"`, phase: 'query' as Phase } };
        }
        return { ...base, ok: true, data: snapshot(obj, req.handle!, obj.parent ? this.handleFor(obj.parent) : null) };
      }
      default:
        return { ...base, ok: false, error: { code: 'BAD_QUERY', message: `unknown query kind`, phase: 'query' as Phase } };
    }
  }

  async stop(): Promise<void> {
    if (this.status === 'stopped') return;
    const instance = this.instance;
    this.instance = null;
    try {
      instance?.deactivate?.();
      instance?.destroy?.();
    } catch (err) {
      this.destroyError = asDiagnostic(err, 'destroy', this.clock.tick, this.sessionId);
      this.diagnostics.push(this.destroyError);
    }
    if (this.moduleRootAdded && instance) {
      this.scene.remove(instance.root);
      this.moduleRootAdded = false;
    }
    this.scope.dispose();
    for (const err of this.scope.disposeErrors) {
      this.diagnostics.push(asDiagnostic(err, 'destroy', this.clock.tick, this.sessionId));
    }
    this.status = 'stopped';
    // Fence everything: old generation commits/handles are now invalid.
    this.generation += 1;
    this.commits.fence(this.generation);
    this.handles.clear();
  }

  private runSimStep(): void {
    if (!this.instance) return;
    const frame: FrameContext = {
      dt: this.clock.fixedDt,
      time: this.clock.time,
      tick: this.clock.tick,
      alpha: 0,
      phase: 'simulate',
    };
    for (const phase of PHASE_ORDER) {
      try {
        for (const hook of this.hooks.get(phase) ?? []) hook(frame);
        // The module's own update hook runs as part of the mechanics phase:
        // intents (controllers/timelines) and physics hooks have already run.
        if (phase === 'mechanics') this.instance.update?.(frame);
      } catch (err) {
        this.fail(asDiagnostic(err, phase, this.clock.tick, this.sessionId));
        return;
      }
    }
  }

  private makeContext(): SceneContext {
    const host = this;
    const scope = this.scope;
    return {
      scene: this.scene,
      scope,
      clock: {
        fixedDt: this.clock.fixedDt,
        get time() {
          return host.clock.time;
        },
        get tick() {
          return host.clock.tick;
        },
        get isPaused() {
          return host.clock.isPaused;
        },
      },
      session: {
        sessionId: this.sessionId,
        get generation() {
          return host.generation;
        },
        experienceDigest: this.experienceDigest,
        buildId: this.buildId,
      },
      commit: (name, payload, eventId) =>
        this.commits.commit(name, payload, eventId, { generation: this.generation, tick: this.clock.tick }),
      registerEventValidator: (namePrefix, validator) => this.commits.registerValidator(namePrefix, validator),
      onCommit: (listener) => this.commits.onCommit(listener),
      onPhase: (phase, fn) => {
        const list = this.hooks.get(phase) ?? [];
        list.push(fn);
        this.hooks.set(phase, list);
        scope.defer(() => {
          const idx = list.indexOf(fn);
          if (idx >= 0) list.splice(idx, 1);
        });
      },
      report: (diagnostic) => {
        if (this.diagnostics.length >= this.maxDiagnostics) return;
        this.diagnostics.push({ ...diagnostic, sessionId: this.sessionId, tick: diagnostic.tick ?? this.clock.tick });
      },
    };
  }

  private handleFor(obj: THREE.Object3D): string {
    for (const [h, o] of this.handles) if (o === obj) return h;
    const handle = `obj-${++this.nextHandleId}`;
    this.handles.set(handle, obj);
    return handle;
  }

  private fail(diag: Diagnostic): void {
    if (this.diagnostics.length < this.maxDiagnostics) this.diagnostics.push(diag);
    this.status = 'error';
    // Registered resources keep cleaning up even on failure.
    this.scope.dispose();
    for (const err of this.scope.disposeErrors) {
      if (this.diagnostics.length < this.maxDiagnostics) {
        this.diagnostics.push(asDiagnostic(err, 'destroy', this.clock.tick, this.sessionId));
      }
    }
  }

  private assertNotStopped(phase: Phase): void {
    if (this.status === 'stopped') {
      throw new CreativeError('SESSION_STOPPED', 'session handle is invalid after stop', { phase });
    }
  }

  private assertUsable(phase: Phase): void {
    this.assertNotStopped(phase);
    if (this.status === 'loading') {
      throw new CreativeError('SESSION_NOT_READY', 'session is still loading', { phase });
    }
  }
}

function snapshot(obj: THREE.Object3D, handle: string, parent: string | null): ObjectSnapshot {
  const authorId = (obj.userData?.authorId as string | undefined) ?? undefined;
  return {
    handle,
    name: obj.name ?? '',
    type: obj.type,
    parent,
    position: [obj.position.x, obj.position.y, obj.position.z],
    rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z],
    scale: [obj.scale.x, obj.scale.y, obj.scale.z],
    visible: obj.visible,
    authorId,
    userDataKeys: obj.userData ? Object.keys(obj.userData).filter((k) => k !== 'authorId') : [],
  };
}
