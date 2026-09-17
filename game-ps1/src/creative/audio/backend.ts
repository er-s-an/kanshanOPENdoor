/**
 * Injectable audio backend.
 *
 * The audio graph and player never touch AudioContext directly; they schedule
 * through the minimal `AudioBackend` interface below. Two implementations ship
 * here:
 *
 * - `RealBackend`: thin lazy wrapper over a real `AudioContext`. Construct it
 *   inside a user-gesture handler (or inject a factory that does); nothing in
 *   this file touches `AudioContext` at import time.
 * - `RecordingBackend`: headless fake that records every scheduled call
 *   (param ramps, source start/stop, connect, suspend/resume) with the
 *   backend clock's timestamp. It exists for tests and offline tools; any
 *   assertion made from its log is AUDIO_SCHEDULING_ONLY evidence — it proves
 *   scheduling and state, never audible output.
 *
 * The node-like interfaces are structural subsets of the Web Audio API, so a
 * real `GainNode`/`AudioBufferSourceNode`/`OscillatorNode` satisfies them.
 */

import { CreativeError } from '../core/errors.ts';

export interface AudioParamLike {
  value: number;
  setValueAtTime(value: number, startTime: number): void;
  linearRampToValueAtTime(value: number, endTime: number): void;
  exponentialRampToValueAtTime(value: number, endTime: number): void;
  cancelScheduledValues(cancelAfterTime: number): void;
}

export interface AudioNodeLike {
  connect(destination: AudioNodeLike): void;
  disconnect(): void;
}

export interface GainNodeLike extends AudioNodeLike {
  gain: AudioParamLike;
}

export interface AudioBufferLike {
  readonly duration: number;
  readonly length: number;
  readonly numberOfChannels: number;
  readonly sampleRate: number;
}

export interface BufferSourceNodeLike extends AudioNodeLike {
  buffer: AudioBufferLike | null;
  loop: boolean;
  playbackRate: AudioParamLike;
  start(when?: number, offset?: number, duration?: number): void;
  stop(when?: number): void;
  onended: (() => void) | null;
}

export interface OscillatorNodeLike extends AudioNodeLike {
  type: string;
  readonly frequency: AudioParamLike;
  start(when?: number): void;
  stop(when?: number): void;
}

export type BackendState = 'running' | 'suspended' | 'closed';

/**
 * Minimal backend contract. `currentTime` is the audio clock in seconds;
 * `suspend()` freezes it (as AudioContext.suspend does) and `resume()`
 * continues it. All `when` parameters everywhere in creative/audio are
 * expressed in this clock.
 */
export interface AudioBackend {
  readonly currentTime: number;
  readonly state: BackendState;
  readonly destination: AudioNodeLike;
  createGain(): GainNodeLike;
  createBufferSource(): BufferSourceNodeLike;
  createOscillator(): OscillatorNodeLike;
  createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBufferLike;
  resume(): Promise<void>;
  suspend(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Real backend (browser only, lazy)
// ---------------------------------------------------------------------------

export type AudioContextFactory = () => AudioContext;

function defaultContextFactory(): AudioContext {
  if (typeof AudioContext === 'undefined') {
    throw new CreativeError('AUDIO_BACKEND_UNAVAILABLE', 'AudioContext is not available in this environment', {
      phase: 'create',
      source: 'creative/audio/backend.ts',
    });
  }
  return new AudioContext();
}

/**
 * Lazy wrapper over a real AudioContext. The context is created on first use,
 * so constructing this class is cheap and safe to defer until a user gesture.
 * `unlock()` on the player calls `resume()`, which is what actually satisfies
 * the browser autoplay policy.
 */
export class RealBackend implements AudioBackend {
  private ctx: AudioContext | null = null;
  private readonly factory: AudioContextFactory;

  constructor(factory: AudioContextFactory = defaultContextFactory) {
    this.factory = factory;
  }

  private ensure(): AudioContext {
    this.ctx ??= this.factory();
    return this.ctx;
  }

  get currentTime(): number {
    return this.ensure().currentTime;
  }

  get state(): BackendState {
    const s = this.ensure().state;
    return s === 'closed' || s === 'suspended' ? s : 'running';
  }

  get destination(): AudioNodeLike {
    return this.ensure().destination as unknown as AudioNodeLike;
  }

  createGain(): GainNodeLike {
    return this.ensure().createGain() as unknown as GainNodeLike;
  }

  createBufferSource(): BufferSourceNodeLike {
    return this.ensure().createBufferSource() as unknown as BufferSourceNodeLike;
  }

  createOscillator(): OscillatorNodeLike {
    return this.ensure().createOscillator() as unknown as OscillatorNodeLike;
  }

  createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBufferLike {
    return this.ensure().createBuffer(numberOfChannels, length, sampleRate) as unknown as AudioBufferLike;
  }

  resume(): Promise<void> {
    return this.ensure().resume();
  }

  suspend(): Promise<void> {
    return this.ensure().suspend();
  }
}

// ---------------------------------------------------------------------------
// Recording backend (headless, for tests and tools)
// ---------------------------------------------------------------------------

export interface RecordedEvent {
  /** Monotonic sequence number within this backend instance. */
  seq: number;
  /** Backend clock time (currentTime) when the call was recorded. */
  time: number;
  /** Fake node id, or -1 for backend-level events (suspend/resume). */
  nodeId: number;
  /** Dotted kind, e.g. 'gain.setValueAtTime', 'source.start', 'backend.suspend'. */
  kind: string;
  args: unknown[];
}

abstract class FakeNode implements AudioNodeLike {
  protected readonly backend: RecordingBackend;
  readonly nodeId: number;
  private readonly label: string;

  constructor(backend: RecordingBackend, nodeId: number, label: string) {
    this.backend = backend;
    this.nodeId = nodeId;
    this.label = label;
  }

  connect(destination: AudioNodeLike): void {
    this.backend.record(this.nodeId, `${this.label}.connect`, [this.backend.idOf(destination)]);
  }

  disconnect(): void {
    this.backend.record(this.nodeId, `${this.label}.disconnect`, []);
  }
}

class FakeParam implements AudioParamLike {
  value: number;
  private readonly backend: RecordingBackend;
  private readonly nodeId: number;
  private readonly label: string;

  constructor(backend: RecordingBackend, nodeId: number, label: string, initial: number) {
    this.backend = backend;
    this.nodeId = nodeId;
    this.label = label;
    this.value = initial;
  }

  private rec(kind: string, args: unknown[]): void {
    this.backend.record(this.nodeId, `${this.label}.${kind}`, args);
  }

  setValueAtTime(value: number, startTime: number): void {
    this.value = value;
    this.rec('setValueAtTime', [value, startTime]);
  }

  linearRampToValueAtTime(value: number, endTime: number): void {
    this.rec('linearRampToValueAtTime', [value, endTime]);
  }

  exponentialRampToValueAtTime(value: number, endTime: number): void {
    this.rec('exponentialRampToValueAtTime', [value, endTime]);
  }

  cancelScheduledValues(cancelAfterTime: number): void {
    this.rec('cancelScheduledValues', [cancelAfterTime]);
  }
}

class FakeGain extends FakeNode implements GainNodeLike {
  readonly gain: FakeParam;

  constructor(backend: RecordingBackend, nodeId: number) {
    super(backend, nodeId, 'gain');
    this.gain = new FakeParam(backend, nodeId, 'gain', 1);
  }
}

class FakeBufferSource extends FakeNode implements BufferSourceNodeLike {
  buffer: AudioBufferLike | null = null;
  loop = false;
  readonly playbackRate: FakeParam;
  onended: (() => void) | null = null;
  /** Test convenience: whether start()/stop() were called on this node. */
  started = false;
  stopped = false;

  constructor(backend: RecordingBackend, nodeId: number) {
    super(backend, nodeId, 'source');
    this.playbackRate = new FakeParam(backend, nodeId, 'playbackRate', 1);
  }

  start(when = 0, offset?: number, duration?: number): void {
    this.started = true;
    this.backend.record(this.nodeId, 'source.start', [when, offset, duration]);
  }

  stop(when?: number): void {
    this.stopped = true;
    this.backend.record(this.nodeId, 'source.stop', [when]);
  }
}

class FakeOscillator extends FakeNode implements OscillatorNodeLike {
  type = 'sine';
  readonly frequency: FakeParam;

  constructor(backend: RecordingBackend, nodeId: number) {
    super(backend, nodeId, 'osc');
    this.frequency = new FakeParam(backend, nodeId, 'frequency', 440);
  }

  start(when = 0): void {
    this.backend.record(this.nodeId, 'osc.start', [when]);
  }

  stop(when?: number): void {
    this.backend.record(this.nodeId, 'osc.stop', [when]);
  }
}

class FakeBuffer implements AudioBufferLike {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;

  constructor(numberOfChannels: number, length: number, sampleRate: number) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
  }

  get duration(): number {
    return this.sampleRate > 0 ? this.length / this.sampleRate : 0;
  }
}

/**
 * Headless backend recording every scheduled call with a manually-advanced
 * clock. While suspended the clock freezes (matching AudioContext semantics).
 */
export class RecordingBackend implements AudioBackend {
  currentTime = 0;
  state: BackendState = 'running';
  readonly destination: GainNodeLike;
  readonly events: RecordedEvent[] = [];

  private seq = 0;
  private nextNodeId = 1;
  private readonly ids = new WeakMap<object, number>();

  constructor() {
    this.destination = new FakeGain(this, 0);
    this.ids.set(this.destination, 0);
  }

  /** Node id for any node created by this backend (-1 if unknown). */
  idOf(node: unknown): number {
    if (typeof node === 'object' && node !== null) {
      const id = this.ids.get(node as object);
      if (id !== undefined) return id;
    }
    return -1;
  }

  record(nodeId: number, kind: string, args: unknown[]): void {
    this.events.push({ seq: ++this.seq, time: this.currentTime, nodeId, kind, args });
  }

  /** Advance the audio clock (no-op while suspended, like a real context). */
  advance(dtSeconds: number): void {
    if (this.state === 'running') this.currentTime += dtSeconds;
  }

  setTime(t: number): void {
    this.currentTime = t;
  }

  async resume(): Promise<void> {
    this.record(-1, 'backend.resume', []);
    if (this.state === 'suspended') this.state = 'running';
  }

  async suspend(): Promise<void> {
    this.record(-1, 'backend.suspend', []);
    if (this.state === 'running') this.state = 'suspended';
  }

  createGain(): GainNodeLike {
    const node = new FakeGain(this, this.nextNodeId);
    this.ids.set(node, this.nextNodeId);
    this.nextNodeId += 1;
    return node;
  }

  createBufferSource(): BufferSourceNodeLike {
    const node = new FakeBufferSource(this, this.nextNodeId);
    this.ids.set(node, this.nextNodeId);
    this.nextNodeId += 1;
    return node;
  }

  createOscillator(): OscillatorNodeLike {
    const node = new FakeOscillator(this, this.nextNodeId);
    this.ids.set(node, this.nextNodeId);
    this.nextNodeId += 1;
    return node;
  }

  createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBufferLike {
    return new FakeBuffer(numberOfChannels, length, sampleRate);
  }

  findEvents(kind: string): RecordedEvent[] {
    return this.events.filter((e) => e.kind === kind);
  }

  count(kind: string): number {
    return this.findEvents(kind).length;
  }

  lastEvent(kind: string): RecordedEvent | undefined {
    const found = this.findEvents(kind);
    return found.length > 0 ? found[found.length - 1] : undefined;
  }

  clear(): void {
    this.events.length = 0;
  }
}
