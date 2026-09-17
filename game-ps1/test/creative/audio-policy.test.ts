import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scope } from '../../src/creative/core/scope.ts';
import { AudioGraph, AudioPlayer, RecordingBackend } from '../../src/creative/audio/index.ts';
import type { AudioBufferLike } from '../../src/creative/audio/index.ts';

function beep(duration = 0.25): AudioBufferLike {
  return { duration, length: Math.floor(duration * 48000), numberOfChannels: 1, sampleRate: 48000 };
}

function makePlayer(policy?: 'drop' | 'queue') {
  const backend = new RecordingBackend();
  const graph = new AudioGraph(backend);
  const scope = new Scope();
  const player = new AudioPlayer({
    backend,
    graph,
    scope,
    clips: { beep: { kind: 'buffer', buffer: beep() } },
    lockedPolicy: policy,
  });
  return { backend, graph, scope, player };
}

// AUDIO_SCHEDULING_ONLY: unlock gating and sim-time mapping are proven from
// scheduled-call records and player state; audible output is NOT_MEASURED.

test('policy drop (default): one-shots during lock are discarded, not deferred', () => {
  const { backend, player } = makePlayer();
  assert.equal(player.state, 'locked');

  player.play('beep');
  player.play('beep');
  assert.equal(backend.count('source.start'), 0);
  assert.equal(backend.count('backend.resume'), 0); // nothing pokes the backend

  player.unlock();
  assert.equal(player.state, 'unlocked');
  assert.equal(backend.count('backend.resume'), 1);
  // No burst: the two dropped one-shots are gone forever.
  assert.equal(backend.count('source.start'), 0);
  player.play('beep');
  assert.equal(backend.count('source.start'), 1);
});

test('policy queue: keeps at most the last one-shot, replays exactly once on unlock', () => {
  const { backend, player } = makePlayer('queue');
  assert.equal(player.policy, 'queue');

  player.play('beep');
  player.play('beep');
  player.play('beep');
  assert.equal(backend.count('source.start'), 0);
  assert.equal(player.queuedCount, 1); // only the last request is kept

  player.unlock();
  assert.equal(backend.count('source.start'), 1); // replayed exactly once, no burst
  assert.equal(player.queuedCount, 0);

  player.play('beep');
  assert.equal(backend.count('source.start'), 2); // normal playback after unlock
});

test('unlock comes only from unlock(): backend state changes alone never unlock', () => {
  const { backend, player } = makePlayer('queue');
  player.play('beep');
  // Simulate a backend that comes alive by itself (e.g. a browser resume the
  // player never asked for): the player must stay locked and schedule nothing.
  void backend.resume();
  backend.advance(1);
  assert.equal(player.state, 'locked');
  assert.equal(backend.count('source.start'), 0);
});

test('queued request dies with the scope: no source starts after dispose + unlock', async () => {
  let resolveBuffer!: (b: AudioBufferLike) => void;
  const pending = new Promise<AudioBufferLike>((res) => {
    resolveBuffer = res;
  });
  const backend = new RecordingBackend();
  const graph = new AudioGraph(backend);
  const scope = new Scope();
  const player = new AudioPlayer({
    backend,
    graph,
    scope,
    clips: { late: { kind: 'buffer', buffer: pending } },
    lockedPolicy: 'queue',
  });
  player.play('late'); // queued while locked
  scope.dispose();
  player.unlock(); // too late: disposing the scope is the end of the scene
  resolveBuffer(beep());
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(backend.count('source.start'), 0);
});

test('sim-time mapping: audioTimeFor linearises between anchors', () => {
  const { backend, player } = makePlayer();
  player.unlock();

  backend.advance(1.5); // audio clock at 1.5
  player.update(10); // anchors: sim 10 <-> audio 1.5
  assert.equal(player.audioTimeFor(10), 1.5);
  assert.equal(player.audioTimeFor(12), 3.5);
  assert.equal(player.audioTimeFor(8), 1.5); // past sim times clamp to the anchor

  const h = player.playAt('beep', 12);
  assert.equal(h.state, 'playing');
  assert.equal(backend.findEvents('source.start')[0].args[0], 3.5);

  // Past sim time degrades to "now" on the audio clock, never to the past.
  backend.advance(0.5); // audio 2.0
  player.update(11); // re-base: sim 11 <-> audio 2.0
  player.playAt('beep', 10);
  const starts = backend.findEvents('source.start');
  assert.equal(starts[1].args[0], 2.0);
});

test('pause suspends scheduling and freezes the audio clock; resume re-bases the mapping', () => {
  const { backend, player } = makePlayer();
  player.unlock();
  player.update(0);

  backend.advance(1);
  player.pause();
  assert.equal(player.isPaused, true);
  assert.equal(backend.count('backend.suspend'), 1);

  backend.advance(5); // frozen while suspended, like a real AudioContext
  assert.equal(backend.currentTime, 1);

  const dropped = player.play('beep');
  assert.equal(dropped.state, 'stopped');
  const droppedAt = player.playAt('beep', 100);
  assert.equal(droppedAt.state, 'stopped');
  assert.equal(backend.count('source.start'), 0); // scheduling suspended

  player.resume(20); // re-base: sim 20 <-> audio 1 (paused wall time excluded)
  assert.equal(player.isPaused, false);
  assert.equal(backend.count('backend.resume'), 2); // unlock + resume
  assert.equal(player.audioTimeFor(20), 1);
  assert.equal(player.audioTimeFor(21), 2);

  const h = player.playAt('beep', 22);
  assert.equal(h.state, 'playing');
  assert.equal(backend.findEvents('source.start')[0].args[0], 3);
});

test('already-scheduled events survive a pause (audio clock simply freezes)', () => {
  const { backend, player } = makePlayer();
  player.unlock();
  player.update(0);
  const h = player.playAt('beep', 1); // scheduled at audio time 1
  assert.equal(backend.findEvents('source.start')[0].args[0], 1);

  player.pause();
  h.stop(); // stop still schedules against the frozen clock (currentTime 0 here)
  const stopEvents = backend.findEvents('source.stop');
  assert.equal(stopEvents.length, 2); // self-stop at start + manual stop
  assert.ok(Math.abs((stopEvents[1].args[0] as number) - 0.02) < 1e-9); // now + fade 0 + guard
});
