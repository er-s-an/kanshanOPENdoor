import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AudioGraph, RecordingBackend } from '../../src/creative/audio/index.ts';

function expectThrow(fn: () => unknown): Error {
  try {
    fn();
  } catch (err) {
    return err as Error;
  }
  throw new Error('expected function to throw');
}

// All assertions here are AUDIO_SCHEDULING_ONLY: they read the recording of
// scheduled calls and graph state, not audible output (audio render is
// NOT_MEASURED in headless tests).

test('graph: root buses exist with master wired to the destination', () => {
  const backend = new RecordingBackend();
  const graph = new AudioGraph(backend);
  assert.deepEqual(graph.busNames(), ['master', 'music', 'sfx', 'voice']);

  const destId = backend.idOf(backend.destination);
  const masterId = backend.idOf(graph.bus('master').input);
  const musicId = backend.idOf(graph.bus('music').input);
  const sfxId = backend.idOf(graph.bus('sfx').input);
  const voiceId = backend.idOf(graph.bus('voice').input);

  const connects = backend.findEvents('gain.connect');
  assert.ok(connects.some((e) => e.nodeId === masterId && e.args[0] === destId));
  assert.ok(connects.some((e) => e.nodeId === musicId && e.args[0] === masterId));
  assert.ok(connects.some((e) => e.nodeId === sfxId && e.args[0] === masterId));
  assert.ok(connects.some((e) => e.nodeId === voiceId && e.args[0] === masterId));
  assert.equal(graph.bus('master').parent, null);
  assert.equal(graph.bus('music').parent, 'master');
});

test('graph: author buses chain to their parent', () => {
  const backend = new RecordingBackend();
  const graph = new AudioGraph(backend);
  const room = graph.addBus('room-a', { parent: 'music', gain: 0.5 });

  assert.equal(room.parent, 'music');
  assert.equal(room.gain, 0.5);
  assert.equal(graph.getBusGain('room-a'), 0.5);
  const connects = backend.findEvents('gain.connect');
  assert.ok(
    connects.some(
      (e) => e.nodeId === backend.idOf(room.input) && e.args[0] === backend.idOf(graph.bus('music').input),
    ),
  );
});

test('graph: duplicate bus and unknown parent/bus are rejected', () => {
  const graph = new AudioGraph(new RecordingBackend());
  graph.addBus('room-a');
  const dup = expectThrow(() => graph.addBus('room-a'));
  assert.match(dup.message, /already exists/);
  const badParent = expectThrow(() => graph.addBus('room-b', { parent: 'nope' }));
  assert.match(badParent.message, /unknown parent/);
  const badBus = expectThrow(() => graph.bus('nope'));
  assert.match(badBus.message, /unknown audio bus/);
});

test('graph: setBusGain and mute/unmute write scheduled param values', () => {
  const backend = new RecordingBackend();
  const graph = new AudioGraph(backend);
  const sfxId = backend.idOf(graph.bus('sfx').input);

  graph.setBusGain('sfx', 0.3);
  let last = backend.lastEvent('gain.setValueAtTime');
  assert.equal(last?.nodeId, sfxId);
  assert.deepEqual(last?.args, [0.3, 0]);

  graph.muteBus('sfx');
  last = backend.lastEvent('gain.setValueAtTime');
  assert.deepEqual(last?.args, [0, 0]);
  assert.equal(graph.isBusMuted('sfx'), true);

  graph.muteBus('sfx', false);
  last = backend.lastEvent('gain.setValueAtTime');
  assert.deepEqual(last?.args, [0.3, 0]);
  assert.equal(graph.isBusMuted('sfx'), false);
  assert.equal(graph.getBusGain('sfx'), 0.3);
});

test('graph: negative gain clamps to zero', () => {
  const graph = new AudioGraph(new RecordingBackend());
  graph.setBusGain('voice', -2);
  assert.equal(graph.getBusGain('voice'), 0);
});

test('graph: dispose disconnects every bus once and is idempotent', () => {
  const backend = new RecordingBackend();
  const graph = new AudioGraph(backend);
  graph.addBus('room-a');
  const busCount = graph.busNames().length;

  graph.dispose();
  assert.equal(backend.count('gain.disconnect'), busCount);
  graph.dispose();
  assert.equal(backend.count('gain.disconnect'), busCount);
  assert.equal(graph.isDisposed, true);
  assert.equal(graph.has('master'), false);
});
