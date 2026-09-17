import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HeadlessInputDevice } from '../../src/creative/input/headless.ts';
import { DomInputDevice } from '../../src/creative/input/dom.ts';
import { Scope } from '../../src/creative/core/scope.ts';

type FakeListener = (event: Record<string, unknown>) => void;

/** Fake EventTarget that counts add/remove calls for dispose verification. */
class FakeTarget {
  added = 0;
  removed = 0;
  private listeners = new Map<string, FakeListener[]>();

  addEventListener(type: string, fn: FakeListener): void {
    this.added += 1;
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, fn: FakeListener): void {
    const list = this.listeners.get(type);
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) {
      list.splice(i, 1);
      this.removed += 1;
    }
  }

  dispatch(type: string, event: Record<string, unknown> = {}): void {
    const list = [...(this.listeners.get(type) ?? [])];
    for (const fn of list) fn({ type, ...event });
  }

  listenerCount(type?: string): number {
    if (type !== undefined) return (this.listeners.get(type) ?? []).length;
    let total = 0;
    for (const list of this.listeners.values()) total += list.length;
    return total;
  }
}

test('headless device: queued keys/buttons/deltas produce frames; reset clears held state', () => {
  const device = new HeadlessInputDevice();
  device.keyDown('KeyW');
  device.keyDown('ArrowUp');
  device.mouseDown(0);
  device.pointerDelta(10, -4);

  const frame = device.nextFrame();
  assert.ok(frame.keys.has('KeyW'));
  assert.ok(frame.keys.has('ArrowUp'));
  assert.ok(frame.mouseButtons.has(0));
  assert.equal(frame.pointerDX, 10);
  assert.equal(frame.pointerDY, -4);

  const next = device.nextFrame();
  assert.equal(next.pointerDX, 0, 'deltas are consumed per frame');
  assert.equal(next.pointerDY, 0);
  assert.ok(next.keys.has('KeyW'), 'held state persists across frames');
  assert.ok(next.mouseButtons.has(0));

  device.reset();
  const cleared = device.nextFrame();
  assert.equal(cleared.keys.size, 0);
  assert.equal(cleared.mouseButtons.size, 0);
  assert.equal(cleared.touchButtons.size, 0);
  assert.equal(cleared.touchSticks.size, 0);
});

test('headless device: touch buttons report heldMs via virtual time', () => {
  const device = new HeadlessInputDevice();
  device.touchButtonDown('squint');
  device.advance(120);
  const frame = device.nextFrame();
  const track = frame.touchButtons.get('squint');
  assert.ok(track);
  assert.equal(track.down, true);
  assert.equal(track.heldMs, 120);

  device.touchButtonUp('squint');
  assert.equal(device.nextFrame().touchButtons.has('squint'), false);
});

test('headless device: sticks move, clamp, and release', () => {
  const device = new HeadlessInputDevice();
  device.touchStickMove('move', 1.5, -2);
  const frame = device.nextFrame();
  assert.deepEqual(frame.touchSticks.get('move'), { x: 1, y: -1 }, 'clamped to [-1, 1]');
  device.touchStickRelease('move');
  assert.equal(device.nextFrame().touchSticks.has('move'), false);
});

test('dom module imports and constructs headless-safe (no DOM at import/construct time)', () => {
  assert.equal(typeof window, 'undefined', 'tests run without a DOM');
  // No targets and no global window: an inert device that still frames.
  const device = new DomInputDevice();
  const frame = device.nextFrame();
  assert.equal(frame.keys.size, 0);
  device.dispose();
});

test('dom keyboard: synthetic keydown/keyup drive frames', () => {
  const keys = new FakeTarget();
  const device = new DomInputDevice({ keys, now: () => 1000 });

  keys.dispatch('keydown', { code: 'KeyW' });
  keys.dispatch('keydown', { code: 'KeyW', repeat: true }); // OS repeat is harmless
  assert.ok(device.nextFrame().keys.has('KeyW'));

  keys.dispatch('keyup', { code: 'KeyW' });
  assert.equal(device.nextFrame().keys.has('KeyW'), false);
});

test('dom mouse: buttons and movement deltas via synthetic events', () => {
  const keys = new FakeTarget();
  const pointer = new FakeTarget();
  const device = new DomInputDevice({ keys, pointer, now: () => 1000 });

  pointer.dispatch('mousedown', { button: 0 });
  pointer.dispatch('mousemove', { movementX: 12, movementY: 3 });
  const frame = device.nextFrame();
  assert.ok(frame.mouseButtons.has(0));
  assert.equal(frame.pointerDX, 12);
  assert.equal(frame.pointerDY, 3);

  // Released outside the canvas: the keys/window target catches mouseup.
  keys.dispatch('mouseup', { button: 0 });
  assert.equal(device.nextFrame().mouseButtons.has(0), false);
});

test('dom pointer lock: deltas gated while unlocked, flow after lock', () => {
  const doc = new FakeTarget() as FakeTarget & { pointerLockElement?: unknown };
  const canvas = { tag: 'canvas' };
  const keys = new FakeTarget();
  const pointer = new FakeTarget();
  const device = new DomInputDevice({
    keys,
    pointer,
    document: doc,
    pointerLockElement: canvas,
    requirePointerLock: true,
    now: () => 1000,
  });

  pointer.dispatch('mousemove', { movementX: 50 });
  assert.equal(device.nextFrame().pointerDX, 0, 'unlocked: deltas ignored');

  doc.pointerLockElement = canvas;
  doc.dispatch('pointerlockchange');
  pointer.dispatch('mousemove', { movementX: 50, movementY: -10 });
  const locked = device.nextFrame();
  assert.equal(locked.pointerDX, 50, 'locked: deltas accumulate');
  assert.equal(locked.pointerDY, -10);

  doc.pointerLockElement = null;
  doc.dispatch('pointerlockchange');
  pointer.dispatch('mousemove', { movementX: 50 });
  assert.equal(device.nextFrame().pointerDX, 0, 'unlocked again: deltas ignored');
});

test('dom touch button: synthetic pointer events with heldMs from the clock', () => {
  const button = new FakeTarget();
  let clock = 5000;
  const device = new DomInputDevice({
    keys: new FakeTarget(),
    touchButtons: new Map([['jump', button as never]]),
    now: () => clock,
  });

  button.dispatch('pointerdown', { pointerId: 11 });
  clock += 250;
  const frame = device.nextFrame();
  const track = frame.touchButtons.get('jump');
  assert.ok(track, 'touch button reports down');
  assert.equal(track.heldMs, 250);

  button.dispatch('pointerup', { pointerId: 11 });
  assert.equal(device.nextFrame().touchButtons.has('jump'), false);

  // A stray pointerup for another pointer must not resurrect state.
  button.dispatch('pointerdown', { pointerId: 12 });
  button.dispatch('pointerup', { pointerId: 99 });
  assert.ok(device.nextFrame().touchButtons.has('jump'), 'only the owning pointer releases the button');
  button.dispatch('pointercancel', { pointerId: 12 });
  assert.equal(device.nextFrame().touchButtons.has('jump'), false);
});

test('dom touch stick: drag relative to element center, y-up, pointer-filtered', () => {
  const stickEl = new FakeTarget() as FakeTarget & {
    getBoundingClientRect(): { left: number; top: number; width: number; height: number };
  };
  stickEl.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 });
  const device = new DomInputDevice({
    keys: new FakeTarget(),
    touchSticks: new Map([['move', stickEl as never]]),
    now: () => 1000,
  });

  stickEl.dispatch('pointerdown', { pointerId: 7, clientX: 50, clientY: 50 });
  assert.deepEqual(device.nextFrame().touchSticks.get('move'), { x: 0, y: 0 });

  stickEl.dispatch('pointermove', { pointerId: 7, clientX: 100, clientY: 50 });
  assert.deepEqual(device.nextFrame().touchSticks.get('move'), { x: 1, y: 0 }, 'full right drag clamps to +1');

  stickEl.dispatch('pointermove', { pointerId: 7, clientX: 50, clientY: 0 });
  assert.deepEqual(device.nextFrame().touchSticks.get('move'), { x: 0, y: 1 }, 'up drag is +y (joystick convention)');

  stickEl.dispatch('pointermove', { pointerId: 42, clientX: 0, clientY: 0 });
  assert.deepEqual(device.nextFrame().touchSticks.get('move'), { x: 0, y: 1 }, 'other pointers are ignored');

  stickEl.dispatch('pointerup', { pointerId: 7 });
  assert.equal(device.nextFrame().touchSticks.has('move'), false, 'stick released');
});

test('dom blur resets held state and notifies onReset', () => {
  const keys = new FakeTarget();
  let resets = 0;
  const device = new DomInputDevice({ keys, onReset: () => { resets += 1; }, now: () => 1000 });

  keys.dispatch('keydown', { code: 'KeyW' });
  keys.dispatch('mousedown', { button: 0 });
  assert.ok(device.nextFrame().keys.has('KeyW'));

  keys.dispatch('blur');
  assert.equal(resets, 1, 'onReset fired on blur');
  const after = device.nextFrame();
  assert.equal(after.keys.size, 0, 'held keys dropped at blur');
  assert.equal(after.mouseButtons.size, 0);
  assert.equal(after.pointerDX, 0);
});

test('dom visibilitychange to hidden resets state', () => {
  const doc = new FakeTarget() as FakeTarget & { hidden?: boolean };
  doc.hidden = false;
  const keys = new FakeTarget();
  const device = new DomInputDevice({ keys, document: doc, now: () => 1000 });

  keys.dispatch('keydown', { code: 'KeyW' });
  assert.ok(device.nextFrame().keys.has('KeyW'));

  doc.hidden = true;
  doc.dispatch('visibilitychange');
  assert.equal(device.nextFrame().keys.size, 0, 'hidden tab clears held state');
});

test('dom dispose removes every added listener; idempotent; device inert afterwards', () => {
  const keys = new FakeTarget();
  const pointer = new FakeTarget();
  const button = new FakeTarget();
  const stickEl = new FakeTarget() as FakeTarget & {
    getBoundingClientRect(): { left: number; top: number; width: number; height: number };
  };
  stickEl.getBoundingClientRect = () => ({ left: 0, top: 0, width: 80, height: 80 });
  const targets = [keys, pointer, button, stickEl];

  const device = new DomInputDevice({
    keys,
    pointer,
    touchButtons: new Map([['jump', button as never]]),
    touchSticks: new Map([['move', stickEl as never]]),
    now: () => 1000,
  });
  const added = targets.reduce((n, t) => n + t.added, 0);
  assert.ok(added > 0, 'listeners were registered');

  device.dispose();
  device.dispose(); // idempotent

  for (const t of targets) {
    assert.equal(t.listenerCount(), 0, 'no listeners remain after dispose');
  }
  const removed = targets.reduce((n, t) => n + t.removed, 0);
  assert.equal(removed, added, 'every addEventListener was paired with removeEventListener');

  keys.dispatch('keydown', { code: 'KeyW' });
  assert.throws(() => device.nextFrame(), /disposed/);
});

test('dom device ties to a Scope: scope dispose removes listeners', () => {
  const keys = new FakeTarget();
  const scope = new Scope();
  new DomInputDevice({ keys, scope, now: () => 1000 });
  assert.ok(keys.listenerCount() > 0);
  scope.dispose();
  assert.equal(keys.listenerCount(), 0, 'scope dispose removed all listeners');
});

test('headless device ties to a Scope and rejects stepping after dispose', () => {
  const scope = new Scope();
  const device = new HeadlessInputDevice({ scope });
  scope.dispose();
  assert.throws(() => device.nextFrame(), /disposed/);
});
