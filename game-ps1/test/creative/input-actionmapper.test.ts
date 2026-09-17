import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ActionMapper, EMPTY_ACTION_STATE, mergeActionMaps, validateActionMap } from '../../src/creative/input/mapper.ts';
import { HeadlessInputDevice } from '../../src/creative/input/headless.ts';
import { Scope } from '../../src/creative/core/scope.ts';
import { CreativeError } from '../../src/creative/core/errors.ts';
import type { ActionMap } from '../../src/creative/core/input-types.ts';

const FIRE_MAP: ActionMap = {
  actions: { fire: [{ kind: 'key', code: 'KeyF' }] },
  axes: {},
};

test('resolves actions from synthetic device state; edges do not bleed across steps', () => {
  const device = new HeadlessInputDevice();
  const mapper = new ActionMapper(FIRE_MAP, device);

  device.keyDown('KeyF');
  const s1 = mapper.step();
  assert.equal(s1.pressed('fire'), true, 'press edges on first observed step');
  assert.equal(s1.held('fire'), true);
  assert.equal(s1.released('fire'), false);

  const s2 = mapper.step();
  assert.equal(s2.pressed('fire'), false, 'a press in step N must not stay pressed in N+1');
  assert.equal(s2.held('fire'), true, 'held persists across steps');

  device.keyUp('KeyF');
  const s3 = mapper.step();
  assert.equal(s3.released('fire'), true);
  assert.equal(s3.held('fire'), false);

  const s4 = mapper.step();
  assert.equal(s4.released('fire'), false, 'a release must not bleed into the next step');
  assert.equal(s4.pressed('fire'), false);
});

test('multiple bindings resolve with OR semantics; unknown actions are inert', () => {
  const device = new HeadlessInputDevice();
  const map: ActionMap = {
    actions: {
      forward: [
        { kind: 'key', code: 'KeyW' },
        { kind: 'key', code: 'ArrowUp' },
      ],
    },
    axes: {},
  };
  const mapper = new ActionMapper(map, device);

  device.keyDown('ArrowUp');
  const s1 = mapper.step();
  assert.equal(s1.pressed('forward'), true, 'either binding triggers the action');

  // Swapping bindings between the same two steps keeps the action held:
  // OR semantics mean it never went up at a step boundary.
  device.keyUp('ArrowUp');
  device.keyDown('KeyW');
  const s2 = mapper.step();
  assert.equal(s2.held('forward'), true, 'action stays held across a binding swap');
  assert.equal(s2.pressed('forward'), false, 'no edge: the action never released');
  assert.equal(s2.released('forward'), false);

  // A genuine release (no binding held for a step) then re-press edges fresh.
  device.keyUp('KeyW');
  const s3 = mapper.step();
  assert.equal(s3.released('forward'), true);
  device.keyDown('KeyW');
  const s4 = mapper.step();
  assert.equal(s4.pressed('forward'), true, 're-press after a full release is a fresh edge');

  assert.equal(s4.pressed('nonexistent'), false);
  assert.equal(s4.held('nonexistent'), false);
  assert.equal(s4.released('nonexistent'), false);
});

test('mouse-button bindings resolve', () => {
  const device = new HeadlessInputDevice();
  const map: ActionMap = {
    actions: { primary: [{ kind: 'mouse-button', button: 0 }] },
    axes: {},
  };
  const mapper = new ActionMapper(map, device);

  device.mouseDown(0);
  const s1 = mapper.step();
  assert.equal(s1.pressed('primary'), true);
  device.mouseUp(0);
  const s2 = mapper.step();
  assert.equal(s2.released('primary'), true);
});

test('touch-button bindings resolve', () => {
  const device = new HeadlessInputDevice();
  const map: ActionMap = {
    actions: { jump: [{ kind: 'touch-button', id: 'jump' }] },
    axes: {},
  };
  const mapper = new ActionMapper(map, device);

  device.touchButtonDown('jump');
  const s1 = mapper.step();
  assert.equal(s1.pressed('jump'), true);
  assert.equal(s1.held('jump'), true);
  device.touchButtonUp('jump');
  const s2 = mapper.step();
  assert.equal(s2.released('jump'), true);
  assert.equal(s2.held('jump'), false);
});

test('touch-hold bindings fire only after minMs (threshold crossing edges)', () => {
  const device = new HeadlessInputDevice();
  const map: ActionMap = {
    actions: { sprint: [{ kind: 'touch-hold', id: 'sprint', minMs: 300 }] },
    axes: {},
  };
  const mapper = new ActionMapper(map, device);

  device.touchButtonDown('sprint');
  const early = mapper.step();
  assert.equal(early.held('sprint'), false, 'below threshold: not held');
  assert.equal(early.pressed('sprint'), false);

  device.advance(150);
  const mid = mapper.step();
  assert.equal(mid.held('sprint'), false, 'still below threshold');

  device.advance(200); // total 350ms
  const crossed = mapper.step();
  assert.equal(crossed.pressed('sprint'), true, 'pressed edges exactly when threshold crosses');
  assert.equal(crossed.held('sprint'), true);

  device.advance(100);
  const heldOn = mapper.step();
  assert.equal(heldOn.pressed('sprint'), false, 'no re-press while held past threshold');
  assert.equal(heldOn.held('sprint'), true);

  device.touchButtonUp('sprint');
  const up = mapper.step();
  assert.equal(up.released('sprint'), true);
});

test('key-pair axes resolve per step', () => {
  const device = new HeadlessInputDevice();
  const map: ActionMap = {
    actions: {},
    axes: { 'move.x': [{ kind: 'key-pair', negative: 'KeyA', positive: 'KeyD' }] },
  };
  const mapper = new ActionMapper(map, device);

  assert.equal(mapper.step().axis('move.x'), 0, 'unbound axis is 0');

  device.keyDown('KeyD');
  assert.equal(mapper.step().axis('move.x'), 1);
  device.keyUp('KeyD');

  device.keyDown('KeyA');
  assert.equal(mapper.step().axis('move.x'), -1);
  device.keyDown('KeyD');
  assert.equal(mapper.step().axis('move.x'), 0, 'opposing keys cancel');
});

test('pointer-delta axes apply scale and are consumed per step', () => {
  const device = new HeadlessInputDevice();
  const map: ActionMap = {
    actions: {},
    axes: {
      'look.x': [{ kind: 'pointer-delta', component: 'dx', scale: 0.0025 }],
      'look.y': [{ kind: 'pointer-delta', component: 'dy', scale: 0.0025 }],
    },
  };
  const mapper = new ActionMapper(map, device);

  device.pointerDelta(100, -40);
  const s1 = mapper.step();
  assert.ok(Math.abs(s1.axis('look.x') - 0.25) < 1e-12);
  assert.ok(Math.abs(s1.axis('look.y') - -0.1) < 1e-12);

  const s2 = mapper.step();
  assert.equal(s2.axis('look.x'), 0, 'deltas do not accumulate across steps');
  assert.equal(s2.axis('look.y'), 0);
});

test('multiple axis bindings sum and clamp to [-1, 1]', () => {
  const device = new HeadlessInputDevice();
  const map: ActionMap = {
    actions: {},
    axes: {
      'move.x': [
        { kind: 'key-pair', negative: 'KeyA', positive: 'KeyD' },
        { kind: 'touch-stick', id: 'move', component: 'x' },
      ],
    },
  };
  const mapper = new ActionMapper(map, device);

  device.keyDown('KeyD'); // +1
  device.touchStickMove('move', 0.8, 0); // +0.8
  assert.equal(mapper.step().axis('move.x'), 1, 'clamped at +1');

  device.keyUp('KeyD');
  device.touchStickMove('move', -0.6, 0);
  assert.ok(Math.abs(mapper.step().axis('move.x') - -0.6) < 1e-12, 'stick alone below clamp');

  device.keyDown('KeyA'); // -1 + -0.6
  assert.equal(mapper.step().axis('move.x'), -1, 'clamped at -1');

  device.touchStickRelease('move');
  device.keyUp('KeyA');
  assert.equal(mapper.step().axis('move.x'), 0);
});

test('touch-stick axes resolve and clamp', () => {
  const device = new HeadlessInputDevice();
  const map: ActionMap = {
    actions: {},
    axes: { 'stick.y': [{ kind: 'touch-stick', id: 'move', component: 'y' }] },
  };
  const mapper = new ActionMapper(map, device);

  assert.equal(mapper.step().axis('stick.y'), 0);
  device.touchStickMove('move', 0, 2); // clamped to 1 by the device
  assert.equal(mapper.step().axis('stick.y'), 1);
  device.touchStickMove('move', 0, -0.5);
  assert.equal(mapper.step().axis('stick.y'), -0.5);
  device.touchStickRelease('move');
  assert.equal(mapper.step().axis('stick.y'), 0);
});

test('snapshot is empty before the first step', () => {
  const device = new HeadlessInputDevice();
  const mapper = new ActionMapper(FIRE_MAP, device);
  assert.equal(mapper.snapshot(), EMPTY_ACTION_STATE);
  assert.equal(mapper.held('fire'), false);
  assert.equal(mapper.axis('move.x'), 0);
});

test('syncBaseline(frame) re-arms edge memory without phantom edges', () => {
  const device = new HeadlessInputDevice();
  const mapper = new ActionMapper(FIRE_MAP, device);

  device.keyDown('KeyF');
  const frame = device.nextFrame();
  const s1 = mapper.applyFrame(frame);
  assert.equal(s1.pressed('fire'), true);

  mapper.syncBaseline(frame);
  const s2 = mapper.applyFrame(frame); // still down, same baseline
  assert.equal(s2.pressed('fire'), false, 'no phantom press against synced baseline');
  assert.equal(s2.released('fire'), false, 'no phantom release against synced baseline');
  assert.equal(s2.held('fire'), true);
});

test('syncBaseline() with empty frame: later release produces no phantom release', () => {
  const device = new HeadlessInputDevice();
  const mapper = new ActionMapper(FIRE_MAP, device);

  device.keyDown('KeyF');
  mapper.step();
  mapper.syncBaseline(); // baseline := empty
  device.keyUp('KeyF');
  const s = mapper.step();
  assert.equal(s.released('fire'), false, 'key up after an empty baseline is not a release edge');
  assert.equal(s.pressed('fire'), false);
});

test('suppress exposes nothing and absorbs changes into the baseline', () => {
  const device = new HeadlessInputDevice();
  const map: ActionMap = {
    actions: { fire: [{ kind: 'key', code: 'KeyF' }] },
    axes: { 'move.x': [{ kind: 'key-pair', negative: 'KeyA', positive: 'KeyD' }] },
  };
  const mapper = new ActionMapper(map, device);

  device.keyDown('KeyF');
  device.keyDown('KeyD');
  const frame = device.nextFrame();
  mapper.applyFrame(frame);
  assert.equal(mapper.held('fire'), true);

  mapper.suppress(frame);
  assert.equal(mapper.held('fire'), false, 'suppressed mapper exposes no held state');
  assert.equal(mapper.pressed('fire'), false);
  assert.equal(mapper.axis('move.x'), 0, 'suppressed mapper exposes no axes');

  const again = mapper.applyFrame(frame);
  assert.equal(again.pressed('fire'), false, 'no phantom press for input held while suppressed');
  assert.equal(again.held('fire'), true, 'level tracking resumes against the absorbed baseline');
  assert.equal(again.axis('move.x'), 1);
});

test('step() without a device throws INPUT_NO_DEVICE', () => {
  const mapper = new ActionMapper(FIRE_MAP);
  try {
    mapper.step();
    assert.fail('expected step() to throw');
  } catch (err) {
    assert.ok(err instanceof CreativeError);
    assert.equal(err.code, 'INPUT_NO_DEVICE');
    assert.equal(err.phase, 'input');
  }
});

test('invalid action maps throw CreativeError with phase input', () => {
  const cases: unknown[] = [
    null,
    {},
    { actions: { a: [{ kind: 'nope' }] }, axes: {} },
    { actions: { a: [{ kind: 'key', code: '' }] }, axes: {} },
    { actions: { a: [{ kind: 'key' }] }, axes: {} },
    { actions: { a: [{ kind: 'mouse-button', button: '0' }] }, axes: {} },
    { actions: { a: [{ kind: 'touch-button', id: '' }] }, axes: {} },
    { actions: { a: [{ kind: 'touch-hold', id: 'x', minMs: -1 }] }, axes: {} },
    { actions: {}, axes: { x: [{ kind: 'key-pair', negative: 'KeyA', positive: '' }] } },
    { actions: {}, axes: { x: [{ kind: 'pointer-delta', component: 'dz' }] } },
    { actions: {}, axes: { x: [{ kind: 'touch-stick', id: 's', component: 'z' }] } },
    { actions: { a: 'nope' }, axes: {} },
  ];
  for (const bad of cases) {
    try {
      validateActionMap(bad as never);
      assert.fail(`expected validation to reject ${JSON.stringify(bad)}`);
    } catch (err) {
      assert.ok(err instanceof CreativeError, `CreativeError expected, got ${err}`);
      assert.equal(err.code, 'INPUT_INVALID_ACTION_MAP');
      assert.equal(err.phase, 'input');
    }
  }
});

test('mergeActionMaps appends shared names, keeps uniques, does not mutate inputs', () => {
  const base: ActionMap = {
    actions: { fire: [{ kind: 'key', code: 'KeyF' }] },
    axes: { 'move.x': [{ kind: 'key-pair', negative: 'KeyA', positive: 'KeyD' }] },
  };
  const extra: ActionMap = {
    actions: {
      fire: [{ kind: 'mouse-button', button: 0 }],
      fly: [{ kind: 'key', code: 'KeyG' }],
    },
    axes: {},
  };
  const merged = mergeActionMaps(base, extra);

  assert.equal(merged.actions.fire.length, 2, 'shared action gets both binding sets');
  assert.equal(merged.actions.fly.length, 1);
  assert.equal(merged.axes['move.x'].length, 1);
  assert.equal(base.actions.fire.length, 1, 'base not mutated');
  assert.equal(extra.actions.fire.length, 1, 'extra not mutated');
  assert.ok(!Object.hasOwn(base.actions, 'fly'));

  // merged map resolves both sources
  const device = new HeadlessInputDevice();
  const mapper = new ActionMapper(merged, device);
  device.mouseDown(0);
  device.keyDown('KeyG');
  const s = mapper.step();
  assert.equal(s.held('fire'), true);
  assert.equal(s.held('fly'), true);
});

test('mapper ties to a Scope: scope dispose disables stepping', () => {
  const device = new HeadlessInputDevice();
  const scope = new Scope();
  const mapper = new ActionMapper(FIRE_MAP, device, { scope });
  device.keyDown('KeyF');
  assert.equal(mapper.step().held('fire'), true);
  scope.dispose();
  try {
    mapper.step();
    assert.fail('expected disposed mapper to throw');
  } catch (err) {
    assert.ok(err instanceof CreativeError);
    assert.equal(err.code, 'INPUT_DISPOSED');
  }
});
