import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scope } from '../../src/creative/core/scope.ts';
import { AudioGraph, AudioPlayer, RecordingBackend } from '../../src/creative/audio/index.ts';
import type { AudioBufferLike } from '../../src/creative/audio/index.ts';

function makePlayer(opts: {
  clips?: Record<string, { kind: 'buffer'; buffer: AudioBufferLike | Promise<AudioBufferLike> } | { kind: 'synth'; render: (out: unknown, when: number, backend: RecordingBackend) => { stop(when: number): void } | void }>;
  policy?: 'drop' | 'queue';
}) {
  const backend = new RecordingBackend();
  const graph = new AudioGraph(backend);
  const scope = new Scope();
  const player = new AudioPlayer({
    backend,
    graph,
    scope,
    clips: opts.clips as never,
    lockedPolicy: opts.policy,
  });
  return { backend, graph, scope, player };
}

function beep(duration = 0.5): AudioBufferLike {
  // Headless stand-in for a decoded AudioBuffer; duration drives stop scheduling.
  return { duration, length: Math.floor(duration * 48000), numberOfChannels: 1, sampleRate: 48000 };
}

// AUDIO_SCHEDULING_ONLY: every assertion below reads RecordingBackend's log
// of scheduled calls plus player/voice state. Audible output is NOT_MEASURED.

test('player: locked by default; play schedules nothing until unlock()', () => {
  const { backend, player } = makePlayer({ clips: { beep: { kind: 'buffer', buffer: beep() } } });
  assert.equal(player.state, 'locked');

  const h = player.play('beep');
  assert.equal(h.state, 'stopped');
  assert.equal(backend.count('source.start'), 0);

  player.unlock();
  assert.equal(player.state, 'unlocked');
  const h2 = player.play('beep');
  assert.equal(h2.state, 'playing');
  assert.equal(backend.count('source.start'), 1);
});

test('player: unknown clip throws AUDIO_UNKNOWN_CLIP', () => {
  const { player } = makePlayer({});
  player.unlock();
  let err: Error | undefined;
  try {
    player.play('nope');
  } catch (e) {
    err = e as Error;
  }
  assert.ok(err);
  assert.match(err.message, /unknown audio clip/);
});

test('player: one-shot schedules start and a bounded stop; loop does not self-stop', () => {
  const { backend, player } = makePlayer({ clips: { beep: { kind: 'buffer', buffer: beep(0.5) } } });
  player.unlock();

  const oneShot = player.play('beep');
  assert.equal(oneShot.state, 'playing');
  const starts = backend.findEvents('source.start');
  assert.equal(starts.length, 1);
  assert.equal(starts[0].args[0], 0); // scheduled at currentTime
  const stops = backend.findEvents('source.stop');
  assert.equal(stops.length, 1);
  assert.ok(Math.abs((stops[0].args[0] as number) - 0.55) < 1e-9); // when + duration + 0.05

  const loop = player.play('beep', { loop: true });
  assert.equal(loop.state, 'playing');
  assert.equal(backend.count('source.start'), 2);
  assert.equal(backend.count('source.stop'), 1); // loops have no self-stop
  loop.stop();
  assert.equal(loop.state, 'stopped');
  assert.equal(backend.count('source.stop'), 2);
});

test('player: voice routes into the requested bus', () => {
  const { backend, graph, player } = makePlayer({ clips: { beep: { kind: 'buffer', buffer: beep() } } });
  player.unlock();
  const h = player.play('beep', { bus: 'music' });
  assert.equal(typeof h.nodeId, 'number');
  const connects = backend.findEvents('gain.connect');
  assert.ok(
    connects.some(
      (e) => e.nodeId === h.nodeId && e.args[0] === backend.idOf(graph.bus('music').input),
    ),
  );
});

test('player: fadeIn ramps gain from silence; stop(fade) ramps to zero and schedules stop', () => {
  const { backend, player } = makePlayer({ clips: { beep: { kind: 'buffer', buffer: beep() } } });
  player.unlock();

  const h = player.play('beep', { volume: 0.8, fadeIn: 0.5 });
  const nodeId = h.nodeId!;
  const t0 = backend.findEvents('source.start')[0].args[0] as number;

  const set0 = backend.findEvents('gain.setValueAtTime').find((e) => e.nodeId === nodeId && e.args[0] === 0);
  assert.ok(set0);
  assert.equal(set0!.args[1], t0);
  const ramp = backend.findEvents('gain.linearRampToValueAtTime').find((e) => e.nodeId === nodeId);
  assert.deepEqual(ramp?.args, [0.8, t0 + 0.5]);

  backend.advance(1); // now = 1
  h.stop(0.25);
  const cancel = backend.findEvents('gain.cancelScheduledValues').find((e) => e.nodeId === nodeId);
  assert.ok(cancel);
  const rampDown = backend
    .findEvents('gain.linearRampToValueAtTime')
    .filter((e) => e.nodeId === nodeId)
    .at(-1);
  assert.deepEqual(rampDown?.args, [0, 1 + 0.25]);
  const stopEvt = backend.findEvents('source.stop').at(-1);
  assert.ok(Math.abs((stopEvt?.args[0] as number) - (1 + 0.25 + 0.02)) < 1e-9);
  assert.equal(h.state, 'stopped');
});

test('player: positional voice attenuates by distance and follows the listener', () => {
  const { backend, player } = makePlayer({ clips: { beep: { kind: 'buffer', buffer: beep() } } });
  player.unlock();

  // distance 10, refDistance 2, rolloff 1 -> att = 2 / (2 + 8) = 0.2
  const h = player.play('beep', { position: [0, 0, 10], refDistance: 2, rolloff: 1, loop: true });
  const nodeId = h.nodeId!;
  const init = backend
    .findEvents('gain.setValueAtTime')
    .filter((e) => e.nodeId === nodeId)
    .at(-1);
  assert.ok(Math.abs((init?.args[0] as number) - 0.2) < 1e-9);

  // Move the listener to [0,0,6]: distance to the voice is 4, att = 2 / (2 + 2) = 0.5
  player.setListenerPosition([0, 0, 6]);
  player.update(1 / 60);
  const after = backend
    .findEvents('gain.setValueAtTime')
    .filter((e) => e.nodeId === nodeId)
    .at(-1);
  assert.ok(Math.abs((after?.args[0] as number) - 0.5) < 1e-9);

  // Back inside refDistance (distance 2): full volume.
  h.setPosition([0, 0, 8]);
  const near = backend
    .findEvents('gain.setValueAtTime')
    .filter((e) => e.nodeId === nodeId)
    .at(-1);
  assert.ok(Math.abs((near?.args[0] as number) - 1) < 1e-9);
});

test('player: synth clips render through the backend into the voice gain', () => {
  const { backend, player } = makePlayer({
    clips: {
      blip: {
        kind: 'synth',
        render: (out, when, b) => {
          const osc = (b as RecordingBackend).createOscillator();
          osc.type = 'square';
          osc.frequency.setValueAtTime(880, when);
          const g = (b as RecordingBackend).createGain();
          g.gain.setValueAtTime(0.2, when);
          osc.connect(g);
          g.connect(out as never);
          osc.start(when);
          osc.stop(when + 0.1);
          return { stop: (t: number) => osc.stop(t) };
        },
      },
    },
  });
  player.unlock();
  const h = player.play('blip');
  assert.equal(h.state, 'playing');
  assert.equal(backend.count('osc.start'), 1);
  h.stop();
  // synth voice stop hook invoked (initial osc.stop + stop-hook call)
  assert.ok(backend.count('osc.stop') >= 2);
});

test('player: stopAll and dispose are idempotent and stop tracked voices', () => {
  const { backend, player } = makePlayer({ clips: { beep: { kind: 'buffer', buffer: beep() } } });
  player.unlock();
  player.play('beep', { loop: true });
  player.play('beep', { loop: true });
  assert.equal(player.activeVoiceCount(), 2);

  player.stopAll();
  assert.equal(player.activeVoiceCount(), 0);
  assert.equal(backend.count('source.stop'), 2);

  player.play('beep', { loop: true });
  player.dispose();
  player.dispose();
  assert.equal(player.isDisposed, true);
  assert.ok(backend.count('source.stop') >= 3);
});

test('player: scope dispose stops every started source', () => {
  const { backend, scope, player } = makePlayer({ clips: { beep: { kind: 'buffer', buffer: beep() } } });
  player.unlock();
  player.play('beep', { loop: true });
  player.play('beep'); // one-shot
  assert.equal(backend.count('source.start'), 2);

  scope.dispose();
  assert.equal(player.isDisposed, true);
  // One stop per voice teardown. The one-shot also had its self-stop
  // scheduled at start, so: 1 (self) + 2 (teardown of loop + one-shot) = 3.
  assert.equal(backend.count('source.stop'), 3);
  assert.equal(player.activeVoiceCount(), 0);
});

test('player: a pending buffer never starts after scope dispose', async () => {
  let resolveBuffer!: (b: AudioBufferLike) => void;
  const pending = new Promise<AudioBufferLike>((res) => {
    resolveBuffer = res;
  });
  const { backend, scope, player } = makePlayer({ clips: { late: { kind: 'buffer', buffer: pending } } });
  player.unlock();

  const h = player.play('late');
  assert.equal(h.state, 'pending');
  assert.equal(backend.count('source.start'), 0);

  scope.dispose();
  resolveBuffer(beep());
  await Promise.resolve(); // flush microtasks
  await Promise.resolve();
  assert.equal(backend.count('source.start'), 0);
  assert.equal(backend.count('source.stop'), 0);
});
