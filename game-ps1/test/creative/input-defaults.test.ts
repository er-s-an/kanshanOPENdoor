import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ActionMapper, mergeActionMaps, validateActionMap } from '../../src/creative/input/mapper.ts';
import { HeadlessInputDevice } from '../../src/creative/input/headless.ts';
import { fpsDefaults, topdownDefaults } from '../../src/creative/input/defaults.ts';
import type { ActionMap } from '../../src/creative/core/input-types.ts';

test('fpsDefaults and topdownDefaults are valid action maps', () => {
  assert.doesNotThrow(() => validateActionMap(fpsDefaults));
  assert.doesNotThrow(() => validateActionMap(topdownDefaults));
  // And they drive a mapper end-to-end with a synthetic device.
  const device = new HeadlessInputDevice();
  const mapper = new ActionMapper(fpsDefaults, device);
  device.keyDown('KeyW');
  assert.equal(mapper.step().held('forward'), true);
});

test('fpsDefaults resolve movement from synthetic keyboard state', () => {
  const device = new HeadlessInputDevice();
  const mapper = new ActionMapper(fpsDefaults, device);

  device.keyDown('KeyW');
  device.keyDown('ArrowRight');
  const s1 = mapper.step();
  assert.equal(s1.held('forward'), true);
  assert.equal(s1.axis('move.z'), 1, 'W pushes move.z positive');
  assert.equal(s1.axis('move.x'), 1, 'ArrowRight pushes move.x positive');
  assert.ok(Math.abs(s1.axis('look.x')) < 1e-12, 'no look without pointer deltas');

  device.keyUp('KeyW');
  device.keyDown('KeyS');
  const s2 = mapper.step();
  assert.equal(s2.axis('move.z'), -1);

  device.keyDown('Space');
  assert.equal(mapper.step().held('jump'), true);
  device.mouseDown(0);
  assert.equal(mapper.step().held('primary'), true);
});

test('fpsDefaults look axes resolve pointer deltas', () => {
  const device = new HeadlessInputDevice();
  const mapper = new ActionMapper(fpsDefaults, device);
  device.pointerDelta(200, 100);
  const s = mapper.step();
  assert.ok(Math.abs(s.axis('look.x') - 0.5) < 1e-12, '200px * 0.0025');
  assert.ok(Math.abs(s.axis('look.y') - 0.25) < 1e-12);
});

test('topdownDefaults resolve movement and verbs from synthetic state', () => {
  const device = new HeadlessInputDevice();
  const mapper = new ActionMapper(topdownDefaults, device);

  device.keyDown('KeyD');
  device.keyDown('KeyW');
  const s1 = mapper.step();
  assert.equal(s1.axis('move.x'), 1);
  assert.equal(s1.axis('move.y'), 1, 'W pushes move.y positive (up-positive convention)');

  device.keyUp('KeyW');
  device.keyDown('KeyS');
  assert.equal(mapper.step().axis('move.y'), -1);

  device.keyDown('ShiftLeft');
  assert.equal(mapper.step().held('dash'), true);
  device.keyDown('Escape');
  assert.equal(mapper.step().held('cancel'), true);
});

test('default touch bindings resolve via a synthetic touch overlay', () => {
  const device = new HeadlessInputDevice();
  const fps = new ActionMapper(fpsDefaults, device);
  const top = new ActionMapper(topdownDefaults, device);

  device.touchButtonDown('jump');
  device.touchButtonDown('dash');
  device.touchStickMove('move', 1, 1);
  const sf = fps.step();
  assert.equal(sf.held('jump'), true);
  assert.equal(sf.axis('move.x'), 1);
  assert.equal(sf.axis('move.z'), 1, 'stick y-up maps to forward-positive move.z');

  const st = top.step();
  assert.equal(st.held('dash'), true);
  assert.equal(st.axis('move.y'), 1);
});

test('authors extend defaults without mutating them', () => {
  const extra: ActionMap = {
    actions: {
      fly: [{ kind: 'key', code: 'KeyG' }],
      jump: [{ kind: 'key', code: 'KeyJ' }], // second binding for an existing verb
    },
    axes: {
      'move.x': [{ kind: 'key-pair', negative: 'KeyH', positive: 'KeyL' }],
    },
  };
  const before = JSON.parse(JSON.stringify(fpsDefaults)) as ActionMap;
  const merged = mergeActionMaps(fpsDefaults, extra);

  assert.equal(merged.actions.jump.length, before.actions.jump.length + 1, 'shared verb gains a binding');
  assert.equal(merged.actions.fly.length, 1);
  assert.equal(merged.axes['move.x'].length, before.axes['move.x'].length + 1);
  assert.deepEqual(fpsDefaults, before, 'fpsDefaults is untouched by merging');

  const device = new HeadlessInputDevice();
  const mapper = new ActionMapper(merged, device);
  device.keyDown('KeyG');
  device.keyDown('KeyJ');
  device.keyDown('KeyL');
  const s = mapper.step();
  assert.equal(s.held('fly'), true);
  assert.equal(s.held('jump'), true, 'original jump bindings still work');
  assert.equal(s.axis('move.x'), 1);
});

test('authors replace maps entirely: arbitrary verbs, no hard-coded vocabulary', () => {
  const bespoke: ActionMap = {
    actions: { flibbertigibbet: [{ kind: 'touch-button', id: 'rune-7' }] },
    axes: { 'levitation.depth': [{ kind: 'touch-stick', id: 'levitate', component: 'y' }] },
  };
  const device = new HeadlessInputDevice();
  const mapper = new ActionMapper(bespoke, device);

  device.touchButtonDown('rune-7');
  device.touchStickMove('levitate', 0, -0.25);
  const s = mapper.step();
  assert.equal(s.pressed('flibbertigibbet'), true);
  assert.equal(s.axis('levitation.depth'), -0.25);
  assert.equal(s.held('forward'), false, 'default verbs do not exist in a replaced map');
});

test('fpsDefaults look axes bind a touch-drag area (id look, scale 0.0045) after pointer-delta', () => {
  assert.doesNotThrow(() => validateActionMap(fpsDefaults));

  for (const axis of ['look.x', 'look.y'] as const) {
    const bindings = fpsDefaults.axes[axis];
    const kinds = bindings.map((b) => b.kind);
    assert.deepEqual(kinds, ['pointer-delta', 'touch-drag'], `${axis}: pointer-delta stays in front`);
    const drag = bindings[1];
    assert.equal(drag.kind, 'touch-drag');
    if (drag.kind === 'touch-drag') {
      assert.equal(drag.id, 'look');
      assert.equal(drag.component, axis === 'look.x' ? 'dx' : 'dy');
      assert.ok(drag.scale !== undefined && Math.abs(drag.scale - 0.0045) < 1e-12, 'scale is 0.0045');
    }
  }

  // The drag binding drives the same axes end-to-end with the headless device.
  const device = new HeadlessInputDevice();
  const mapper = new ActionMapper(fpsDefaults, device);
  device.touchDrag('look', 200, 100);
  const s = mapper.step();
  assert.ok(Math.abs(s.axis('look.x') - 0.9) < 1e-12, '200px * 0.0045');
  assert.ok(Math.abs(s.axis('look.y') - 0.45) < 1e-12, '100px * 0.0045');
  assert.equal(mapper.step().axis('look.x'), 0, 'drag deltas consumed per step');
});
