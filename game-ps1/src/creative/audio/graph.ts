/**
 * Audio bus graph: master/music/sfx/voice roots plus author-added buses.
 *
 * Every bus is one gain node; voices connect into `bus.input`, and each bus
 * chains into its parent bus (roots other than master chain into master,
 * master chains into the backend destination). Gain and mute are per bus;
 * muting remembers the gain so unmute restores it.
 *
 * The graph owns no sources — disposing it disconnects the buses but leaves
 * the backend (and any still-running source nodes) alone.
 */
import { CreativeError } from '../core/errors.ts';
import type { DisposableLike } from '../core/scope.ts';
import type { AudioBackend, GainNodeLike } from './backend.ts';

export type { AudioBackend, AudioBufferLike, AudioNodeLike, AudioParamLike, BufferSourceNodeLike, GainNodeLike, OscillatorNodeLike } from './backend.ts';

export const ROOT_BUSES = ['master', 'music', 'sfx', 'voice'] as const;
export type RootBusName = (typeof ROOT_BUSES)[number];

export interface BusOptions {
  /** Parent bus name; defaults to 'master'. Ignored for the root buses. */
  parent?: string;
  /** Initial linear gain; defaults to 1. */
  gain?: number;
}

export interface BusView {
  readonly name: string;
  /** Connect voice output gains here. */
  readonly input: GainNodeLike;
  readonly parent: string | null;
  readonly gain: number;
  readonly muted: boolean;
}

interface BusState {
  input: GainNodeLike;
  parent: string | null;
  gain: number;
  muted: boolean;
}

export class AudioGraph implements DisposableLike {
  readonly backend: AudioBackend;
  private readonly buses = new Map<string, BusState>();
  private disposed = false;

  constructor(backend: AudioBackend) {
    this.backend = backend;
    for (const name of ROOT_BUSES) {
      this.buses.set(name, this.makeBus(name, name === 'master' ? null : 'master', 1));
    }
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  busNames(): string[] {
    return [...this.buses.keys()];
  }

  has(name: string): boolean {
    return this.buses.has(name);
  }

  /** Read-only view of a bus; throws AUDIO_UNKNOWN_BUS for missing names. */
  bus(name: string): BusView {
    const b = this.buses.get(name);
    if (!b) {
      throw new CreativeError('AUDIO_UNKNOWN_BUS', `unknown audio bus "${name}"`, {
        phase: 'mechanics',
        source: 'creative/audio/graph.ts',
      });
    }
    return { name, input: b.input, parent: b.parent, gain: b.gain, muted: b.muted };
  }

  /**
   * Add an author bus (e.g. a room, a puzzle layer). Duplicate names and
   * unknown parents are rejected so wiring mistakes fail at authoring time.
   */
  addBus(name: string, opts: BusOptions = {}): BusView {
    if (this.buses.has(name)) {
      throw new CreativeError('AUDIO_BUS_EXISTS', `audio bus "${name}" already exists`, {
        phase: 'mechanics',
        source: 'creative/audio/graph.ts',
      });
    }
    const parent = opts.parent ?? 'master';
    if (!this.buses.has(parent)) {
      throw new CreativeError('AUDIO_UNKNOWN_BUS', `unknown parent audio bus "${parent}"`, {
        phase: 'mechanics',
        source: 'creative/audio/graph.ts',
      });
    }
    const gain = Math.max(0, opts.gain ?? 1);
    const bus = this.makeBus(name, parent, gain);
    this.buses.set(name, bus);
    return this.bus(name);
  }

  setBusGain(name: string, gain: number): void {
    const b = this.busState(name);
    b.gain = Math.max(0, gain);
    this.applyGain(b);
  }

  getBusGain(name: string): number {
    return this.busState(name).gain;
  }

  muteBus(name: string, muted = true): void {
    const b = this.busState(name);
    b.muted = muted;
    this.applyGain(b);
  }

  isBusMuted(name: string): boolean {
    return this.busState(name).muted;
  }

  /** Disconnect all buses; idempotent. Sources feeding them become silent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const b of this.buses.values()) {
      try {
        b.input.disconnect();
      } catch {
        /* disconnect on a torn-down backend is not fatal */
      }
    }
    this.buses.clear();
  }

  private makeBus(name: string, parent: string | null, gain: number): BusState {
    const input = this.backend.createGain();
    input.gain.value = gain;
    const sink = parent === null ? this.backend.destination : this.busState(parent).input;
    input.connect(sink);
    return { input, parent, gain, muted: false };
  }

  private busState(name: string): BusState {
    const b = this.buses.get(name);
    if (!b) {
      throw new CreativeError('AUDIO_UNKNOWN_BUS', `unknown audio bus "${name}"`, {
        phase: 'mechanics',
        source: 'creative/audio/graph.ts',
      });
    }
    return b;
  }

  private applyGain(b: BusState): void {
    b.input.gain.setValueAtTime(b.muted ? 0 : b.gain, this.backend.currentTime);
  }
}
