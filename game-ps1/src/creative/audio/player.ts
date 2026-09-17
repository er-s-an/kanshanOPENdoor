/**
 * Clip player: keyed one-shot/loop playback over an AudioGraph with an
 * injectable backend.
 *
 * Hard rules implemented here:
 * - Unlock is gesture-gated and observable. Before `unlock()` the player is
 *   'locked' and schedules nothing on the backend. One-shots during lock
 *   follow the declared policy: 'drop' (default) or 'queue' (keeps at most the
 *   last request and replays it exactly once on unlock — never a burst).
 *   Nothing else unlocks: no play(), no timer, no backend state observation.
 * - Pause suspends scheduling: while paused, play()/playAt() schedule nothing
 *   (already-running sources simply keep their scheduled events; with a real
 *   backend the audio clock is frozen by suspend()).
 * - Sim-time mapping is explicit: `audioTimeFor(simTime)` linearises between
 *   (simAnchor, audioAnchor) re-based on every update() and resume(). Paused
 *   wall time never leaks into the mapping because anchors are re-based on
 *   resume rather than accumulated.
 * - Scope-bound stop-scene semantics: disposing the scope stops every source
 *   the player started (scheduled stop calls) and drops pending async buffer
 *   resolutions, so a late fulfilment can never start sound on a dead scene.
 *
 * Offline note: with RecordingBackend every assertion is AUDIO_SCHEDULING_ONLY
 * — evidence of scheduling order/timing and player state, never of audible
 * output. GPU/audio-render quality is NOT_MEASURED.
 */
import { CreativeError } from '../core/errors.ts';
import type { Scope } from '../core/scope.ts';
import type {
  AudioBackend,
  AudioBufferLike,
  AudioNodeLike,
  BufferSourceNodeLike,
  GainNodeLike,
} from './backend.ts';
import type { AudioGraph } from './graph.ts';

export type Vec3 = [number, number, number];

/** Handle returned from a synth render call so stop(fade) can end it. */
export interface SynthVoice {
  stop(when: number): void;
}

/**
 * A named sound source. 'buffer' plays an AudioBuffer (or a promise of one —
 * playback starts when it resolves; if the scope dies first, it never does).
 * 'synth' is any author function rendering into the given output gain (wrap a
 * synth engine as ONE sound source type via this hook).
 */
export type SoundSource =
  | { kind: 'buffer'; buffer: AudioBufferLike | Promise<AudioBufferLike> }
  | {
      kind: 'synth';
      render: (out: AudioNodeLike, when: number, backend: AudioBackend) => SynthVoice | void;
    };

export type LockedPolicy = 'drop' | 'queue';

export interface AudioPlayerOptions {
  backend: AudioBackend;
  graph: AudioGraph;
  scope: Scope;
  clips?: Record<string, SoundSource>;
  /** What play() does while locked. Default 'drop'. */
  lockedPolicy?: LockedPolicy;
  /** Initial listener position for distance attenuation. Default [0,0,0]. */
  listener?: Vec3;
}

export interface PlayOptions {
  /** Target bus; default 'sfx'. */
  bus?: string;
  /** Linear volume multiplier; default 1. */
  volume?: number;
  /** Loop until stopped; default false (one-shot). */
  loop?: boolean;
  /** Seconds of scheduled gain ramp-in from silence. */
  fadeIn?: number;
  /** Default fade used by stop() when no explicit fade is given. */
  fadeOut?: number;
  /** Buffer playback rate; default 1. */
  rate?: number;
  /** World position for distance-attenuated voices. */
  position?: Vec3;
  /** Distance at which attenuation begins; default 3. */
  refDistance?: number;
  /** Attenuation slope past refDistance; default 1. */
  rolloff?: number;
}

export type VoiceState = 'pending' | 'playing' | 'stopped';

export interface VoiceHandle {
  readonly key: string;
  readonly state: VoiceState;
  /** Backend node id of the voice's output gain when the backend assigns one (RecordingBackend does); undefined otherwise. */
  readonly nodeId?: number;
  /** Schedule a stop with an optional fade; a no-op once stopped. */
  stop(fadeOut?: number): void;
  setVolume(volume: number): void;
  setPosition(position: Vec3): void;
}

function isPromiseLike<T>(v: unknown): v is PromiseLike<T> {
  return typeof v === 'object' && v !== null && typeof (v as { then?: unknown }).then === 'function';
}

function attForDistance(distance: number, refDistance: number, rolloff: number): number {
  const d = Math.max(0, distance);
  if (d <= refDistance) return 1;
  return Math.min(1, refDistance / (refDistance + rolloff * (d - refDistance)));
}

/** Dropped/never-started handle: zero backend interaction. */
function inertHandle(key: string): VoiceHandle {
  return {
    key,
    state: 'stopped',
    stop() {},
    setVolume() {},
    setPosition() {},
  };
}

class Voice implements VoiceHandle {
  state: VoiceState = 'playing';
  readonly key: string;
  readonly nodeId?: number;
  private readonly player: AudioPlayer;

  private readonly gain: GainNodeLike;
  private src: BufferSourceNodeLike | null = null;
  private synthVoice: SynthVoice | null = null;
  private readonly loop: boolean;
  private readonly fadeIn: number;
  private readonly fadeOutDefault: number;
  private readonly rate?: number;
  private volume: number;
  private position: Vec3 | null;
  private readonly refDistance: number;
  private readonly rolloff: number;

  constructor(player: AudioPlayer, key: string, opts: PlayOptions) {
    this.player = player;
    this.key = key;
    const bus = player.graph.bus(opts.bus ?? 'sfx');
    this.volume = opts.volume ?? 1;
    this.loop = opts.loop ?? false;
    this.fadeIn = Math.max(0, opts.fadeIn ?? 0);
    this.fadeOutDefault = Math.max(0, opts.fadeOut ?? 0);
    this.rate = opts.rate;
    this.position = opts.position ? ([...opts.position] as Vec3) : null;
    this.refDistance = Math.max(0, opts.refDistance ?? 3);
    this.rolloff = Math.max(0, opts.rolloff ?? 1);
    this.gain = player.backend.createGain();
    this.nodeId = player.backendIdOf?.(this.gain);
    this.gain.connect(bus.input);
  }

  startBuffer(buffer: AudioBufferLike, when: number): void {
    if (this.state !== 'pending' && this.state !== 'playing') return;
    const backend = this.player.backend;
    const src = backend.createBufferSource();
    src.buffer = buffer;
    src.loop = this.loop;
    if (this.rate !== undefined) src.playbackRate.setValueAtTime(this.rate, when);
    src.connect(this.gain);
    this.applyEnvelope(when);
    if (!this.loop) {
      src.onended = () => this.finishNaturally();
      src.start(when);
      src.stop(when + buffer.duration + 0.05);
    } else {
      src.start(when);
    }
    this.src = src;
    this.state = 'playing';
  }

  startSynth(render: Extract<SoundSource, { kind: 'synth' }>['render'], when: number): void {
    if (this.state !== 'pending' && this.state !== 'playing') return;
    this.synthVoice = render(this.gain, when, this.player.backend) ?? null;
    this.applyEnvelope(when);
    this.state = 'playing';
  }

  stop(fadeOut: number = this.fadeOutDefault): void {
    if (this.state === 'stopped') return;
    this.state = 'stopped';
    const backend = this.player.backend;
    const now = backend.currentTime;
    const fade = Math.max(0, fadeOut);
    const g = this.gain.gain;
    const current = g.value;
    g.cancelScheduledValues(now);
    g.setValueAtTime(current, now);
    if (fade > 0) {
      g.linearRampToValueAtTime(0, now + fade);
    } else {
      g.setValueAtTime(0, now);
    }
    const when = now + fade + 0.02;
    if (this.src) {
      try {
        this.src.stop(when);
      } catch {
        /* double-stop on a finished source is harmless */
      }
    }
    if (this.synthVoice) {
      try {
        this.synthVoice.stop(when);
      } catch {
        /* synth stop hooks are author code; ignore teardown races */
      }
    }
    this.player.untrack(this);
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, volume);
    if (this.state === 'playing') {
      this.gain.gain.setValueAtTime(this.effectiveVolume(), this.player.backend.currentTime);
    }
  }

  setPosition(position: Vec3): void {
    this.position = [...position] as Vec3;
    this.updateSpatial();
  }

  effectiveVolume(): number {
    const spatial = this.position
      ? attForDistance(
          distance(this.position, this.player.listenerPosition),
          this.refDistance,
          this.rolloff,
        )
      : 1;
    return this.volume * spatial;
  }

  updateSpatial(): void {
    if (this.state === 'playing' && this.position) {
      this.gain.gain.setValueAtTime(this.effectiveVolume(), this.player.backend.currentTime);
    }
  }

  private applyEnvelope(when: number): void {
    const g = this.gain.gain;
    const v = this.effectiveVolume();
    if (this.fadeIn > 0) {
      g.setValueAtTime(0, when);
      g.linearRampToValueAtTime(v, when + this.fadeIn);
    } else {
      g.setValueAtTime(v, when);
    }
  }

  private finishNaturally(): void {
    if (this.state !== 'playing') return;
    this.state = 'stopped';
    this.player.untrack(this);
  }
}

function distance(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export class AudioPlayer {
  readonly backend: AudioBackend;
  readonly graph: AudioGraph;
  readonly scope: Scope;
  readonly policy: LockedPolicy;

  private readonly clips = new Map<string, SoundSource>();
  private readonly voices = new Set<Voice>();
  private queued: { key: string; opts: PlayOptions } | null = null;
  private unlocked = false;
  private paused = false;
  private disposed = false;
  private listenerPos: Vec3;
  private simAnchor = 0;
  private audioAnchor: number;

  constructor(opts: AudioPlayerOptions) {
    this.backend = opts.backend;
    this.graph = opts.graph;
    this.scope = opts.scope;
    this.policy = opts.lockedPolicy ?? 'drop';
    this.listenerPos = opts.listener ? ([...opts.listener] as Vec3) : [0, 0, 0];
    this.audioAnchor = opts.backend.currentTime;
    for (const [key, source] of Object.entries(opts.clips ?? {})) {
      this.registerClip(key, source);
    }
    // Stop-scene semantics: scope dispose stops every source we started and
    // kills queued/unlocked state; late async buffer resolutions stay inert.
    opts.scope.defer(() => this.dispose());
  }

  /** 'locked' until unlock() is called by the host from a real gesture. */
  get state(): 'locked' | 'unlocked' {
    return this.unlocked ? 'unlocked' : 'locked';
  }

  get isPaused(): boolean {
    return this.paused;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  get listenerPosition(): Vec3 {
    return this.listenerPos;
  }

  get queuedCount(): number {
    return this.queued ? 1 : 0;
  }

  /** Best-effort node id from the backend (RecordingBackend); undefined if unsupported. */
  backendIdOf(node: unknown): number | undefined {
    const b = this.backend as { idOf?: (n: unknown) => number };
    if (typeof b.idOf === 'function') {
      const id = b.idOf(node);
      return id >= 0 ? id : undefined;
    }
    return undefined;
  }

  registerClip(key: string, source: SoundSource): void {
    if (this.clips.has(key)) {
      throw new CreativeError('AUDIO_CLIP_EXISTS', `audio clip "${key}" already registered`, {
        phase: 'mechanics',
        source: 'creative/audio/player.ts',
      });
    }
    this.clips.set(key, source);
  }

  /**
   * The ONLY unlock path. Wire this to a real user gesture in the host.
   * Resumes the backend and, under the 'queue' policy, replays the single
   * queued one-shot exactly once.
   */
  unlock(): void {
    if (this.disposed) return;
    this.unlocked = true;
    void this.backend.resume().catch(() => {
      /* a backend that cannot resume stays silent; state remains unlocked */
    });
    const queued = this.queued;
    this.queued = null;
    if (queued) this.playInternal(queued.key, queued.opts);
  }

  /** Suspend scheduling and freeze the audio clock (simulation paused). */
  pause(): void {
    if (this.disposed || this.paused) return;
    this.paused = true;
    void this.backend.suspend().catch(() => {});
  }

  /** Resume scheduling; re-bases the sim↔audio mapping so paused wall time is excluded. */
  resume(simTime: number): void {
    if (this.disposed || !this.paused) return;
    this.paused = false;
    void this.backend.resume().catch(() => {});
    this.rebase(simTime);
  }

  /**
   * Explicit sim→audio mapping:
   *   audioTimeFor(simTime) = audioAnchor + max(0, simTime - simAnchor)
   * Anchors re-base here (per step) and on resume(). While paused, sim time
   * does not advance, so the mapping holds steady across the pause.
   */
  audioTimeFor(simTime: number): number {
    return this.audioAnchor + Math.max(0, simTime - this.simAnchor);
  }

  /** Per-step hook: re-base the mapping and refresh positional attenuation. */
  update(simTime: number): void {
    if (this.disposed) return;
    this.rebase(simTime);
    for (const v of this.voices) v.updateSpatial();
  }

  setListenerPosition(position: Vec3): void {
    this.listenerPos = [...position] as Vec3;
  }

  /**
   * Play a clip now (audio clock time). While locked: 'drop' policy returns an
   * inert stopped handle, 'queue' keeps at most this last request for unlock.
   * While paused: scheduling is suspended, so the request is dropped.
   */
  play(key: string, opts: PlayOptions = {}): VoiceHandle {
    if (this.disposed) return inertHandle(key);
    if (!this.unlocked) {
      if (this.policy === 'queue') this.queued = { key, opts: { ...opts } };
      return inertHandle(key);
    }
    if (this.paused) return inertHandle(key);
    return this.playInternal(key, opts);
  }

  /**
   * Schedule a clip for a future simulation time. The sim time is mapped
   * through audioTimeFor(); a past time degrades to "now" on the audio clock.
   */
  playAt(key: string, simTime: number, opts: PlayOptions = {}): VoiceHandle {
    if (this.disposed) return inertHandle(key);
    if (!this.unlocked) {
      if (this.policy === 'queue') this.queued = { key, opts: { ...opts } };
      return inertHandle(key);
    }
    if (this.paused) return inertHandle(key);
    const when = Math.max(this.audioTimeFor(simTime), this.backend.currentTime);
    return this.playInternal(key, opts, when);
  }

  stopAll(fadeOut = 0.05): void {
    for (const v of [...this.voices]) v.stop(fadeOut);
  }

  /** Untracked live voices (pending + playing), for diagnostics/tests. */
  activeVoiceCount(): number {
    return this.voices.size;
  }

  /** Idempotent; also invoked by scope dispose. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.queued = null;
    for (const v of [...this.voices]) v.stop(0);
    this.voices.clear();
  }

  private rebase(simTime: number): void {
    this.audioAnchor = this.backend.currentTime;
    this.simAnchor = simTime;
  }

  private playInternal(key: string, opts: PlayOptions, when?: number): VoiceHandle {
    const source = this.clips.get(key);
    if (!source) {
      throw new CreativeError('AUDIO_UNKNOWN_CLIP', `unknown audio clip "${key}"`, {
        phase: 'mechanics',
        source: 'creative/audio/player.ts',
      });
    }
    const startAt = when ?? this.backend.currentTime;
    const voice = new Voice(this, key, opts);
    this.voices.add(voice);
    if (source.kind === 'buffer') {
      if (isPromiseLike<AudioBufferLike>(source.buffer)) {
        voice.state = 'pending';
        this.scope.settle(
          Promise.resolve(source.buffer),
          (buffer) => {
            // Pending buffer resolved in time: start unless stopped/disposed.
            voice.startBuffer(buffer, Math.max(startAt, this.backend.currentTime));
          },
          () => {
            /* scope disposed first: the voice never starts (stop-scene) */
          },
        );
      } else {
        voice.startBuffer(source.buffer, startAt);
      }
    } else {
      voice.startSynth(source.render, startAt);
    }
    return voice;
  }

  untrack(voice: Voice): void {
    this.voices.delete(voice);
  }
}
