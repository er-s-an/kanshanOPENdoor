import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HeadlessInputDevice } from '../../src/creative/input/headless.ts';
import { ActionMapper } from '../../src/creative/input/mapper.ts';
import { FocusManager } from '../../src/creative/input/focus.ts';
import { Scope } from '../../src/creative/core/scope.ts';
import type { ActionMap, ActionState } from '../../src/creative/core/input-types.ts';

const GAME_MAP: ActionMap = {
  actions: {
    forward: [{ kind: 'key', code: 'KeyW' }],
    fire: [{ kind: 'mouse-button', button: 0 }],
  },
  axes: {
    'move.x': [{ kind: 'key-pair', negative: 'KeyA', positive: 'KeyD' }],
    'look.x': [{ kind: 'pointer-delta', component: 'dx', scale: 1 }],
  },
};

const MODAL_MAP: ActionMap = {
  actions: { confirm: [{ kind: 'key', code: 'Enter' }] },
  axes: {},
};

const EDITOR_MAP: ActionMap = {
  actions: { place: [{ kind: 'key', code: 'KeyP' }] },
  axes: {},
};

interface Setup {
  device: HeadlessInputDevice;
  game: ActionMapper;
  modal: ActionMapper;
  editor: ActionMapper;
  focus: FocusManager;
}

function setup(): Setup {
  const device = new HeadlessInputDevice();
  const game = new ActionMapper(GAME_MAP, device);
  const modal = new ActionMapper(MODAL_MAP, device);
  const editor = new ActionMapper(EDITOR_MAP, device);
  const focus = new FocusManager(device);
  focus.bind('game', game);
  focus.bind('modal-ui', modal);
  focus.bind('editor', editor);
  return { device, game, modal, editor, focus };
}

test('game layer is active by default and receives input', () => {
  const { device, game, focus } = setup();
  assert.equal(focus.topLayer(), 'game');

  device.keyDown('KeyW');
  focus.step();
  assert.equal(game.held('forward'), true);
  assert.equal(game.pressed('forward'), true);
});

test('modal-ui suppresses the game layer completely: no held states, no axes, no edges', () => {
  const { device, game, modal, focus } = setup();

  device.keyDown('KeyW');
  device.keyDown('KeyD');
  device.pointerDelta(30, 0);
  focus.step();
  assert.equal(game.held('forward'), true);
  assert.equal(game.axis('move.x'), 1);

  focus.setActive('modal-ui', true);
  focus.step();
  assert.equal(game.held('forward'), false, 'game sees no held state while modal is up');
  assert.equal(game.pressed('forward'), false);
  assert.equal(game.axis('move.x'), 0, 'game sees no movement while modal is up');
  assert.equal(game.axis('look.x'), 0);

  device.keyDown('Enter');
  focus.step();
  assert.equal(modal.held('confirm'), true, 'modal layer receives its own input');
  assert.equal(game.held('forward'), false, 'game stays dark while modal is up');
});

test('no phantom release on layer switch: key released while suppressed never surfaces', () => {
  const { device, game, focus } = setup();

  device.keyDown('KeyW');
  focus.step();
  assert.equal(game.held('forward'), true);

  focus.setActive('modal-ui', true);
  focus.step();
  device.keyUp('KeyW'); // released while the game layer was suppressed
  focus.step();

  focus.setActive('modal-ui', false);
  focus.step(); // game layer resumes
  assert.equal(game.released('forward'), false, 'release during suppression must not surface later');
  assert.equal(game.pressed('forward'), false);
  assert.equal(game.held('forward'), false);
});

test('no phantom press: key pressed while suppressed is level-only on resume', () => {
  const { device, game, focus } = setup();

  focus.setActive('modal-ui', true);
  focus.step();
  device.keyDown('KeyW'); // pressed while the game layer was suppressed
  focus.step();

  focus.setActive('modal-ui', false);
  focus.step();
  assert.equal(game.held('forward'), true, 'level reflects physical state on resume');
  assert.equal(game.pressed('forward'), false, 'press during suppression must not surface later');

  // ...and fresh edges after the resume work normally:
  device.keyUp('KeyW');
  focus.step();
  device.keyDown('KeyW');
  focus.step();
  assert.equal(game.pressed('forward'), true, 'genuine re-press after resume edges normally');
});

test('pointer deltas during suppression never burst into the resumed layer', () => {
  const { device, game, focus } = setup();

  focus.setActive('modal-ui', true);
  focus.step();
  device.pointerDelta(500, 0); // mouse moved while modal was up
  focus.step();

  focus.setActive('modal-ui', false);
  focus.step();
  assert.equal(game.axis('look.x'), 0, 'stale deltas are gone, not delivered in a burst');
});

test('priority: editor above game, modal-ui above editor', () => {
  const { device, game, modal, editor, focus } = setup();

  focus.setActive('editor', true);
  assert.equal(focus.topLayer(), 'editor');
  device.keyDown('KeyP');
  device.keyDown('KeyW');
  focus.step();
  assert.equal(editor.held('place'), true, 'editor receives input');
  assert.equal(game.held('forward'), false, 'game is suppressed under the editor');

  focus.setActive('modal-ui', true);
  assert.equal(focus.topLayer(), 'modal-ui');
  device.keyDown('Enter');
  focus.step();
  assert.equal(modal.held('confirm'), true, 'modal receives input');
  assert.equal(editor.held('place'), false, 'editor is suppressed under the modal');
  assert.equal(game.held('forward'), false);

  focus.setActive('modal-ui', false);
  focus.setActive('editor', false);
  assert.equal(focus.topLayer(), 'game');
  focus.step();
  assert.equal(game.held('forward'), true, 'game resumes as top active layer');
  assert.equal(game.pressed('forward'), false, 'no phantom press for the key held through the switch');
});

test('top active layer with no bound mapper swallows input', () => {
  const { device, game, focus } = setup();
  focus.unbind('modal-ui');
  focus.setActive('modal-ui', true);

  device.keyDown('KeyW');
  device.keyDown('Enter');
  const routed = focus.step();
  assert.equal(routed, null, 'nothing received the frame');
  assert.equal(game.held('forward'), false, 'input is swallowed, not leaked to lower layers');
});

test('deactivating every layer swallows all input', () => {
  const { device, game, focus } = setup();
  focus.setActive('game', false);
  assert.equal(focus.topLayer(), null);

  device.keyDown('KeyW');
  const routed = focus.step();
  assert.equal(routed, null);
  assert.equal(game.held('forward'), false);
});

test('blur() resets the device and every mapper: no phantom release afterwards', () => {
  const { device, game, modal, focus } = setup();

  device.keyDown('KeyW');
  focus.step();
  assert.equal(game.held('forward'), true);

  focus.blur();
  assert.equal(game.held('forward'), false, 'held states drop at blur');
  assert.equal(game.axis('move.x'), 0);
  assert.equal(focus.snapshot().held('forward'), false);

  device.keyDown('KeyQ'); // unrelated post-blur input
  focus.step();
  assert.equal(game.released('forward'), false, 'no phantom release edge after blur');
  assert.equal(game.pressed('forward'), false);
  assert.equal(game.held('forward'), false);
  assert.equal(modal.held('confirm'), false);

  // Genuine input after blur edges normally.
  device.keyDown('KeyW');
  focus.step();
  assert.equal(game.pressed('forward'), true, 'fresh press after blur edges normally');
});

test('FocusManager satisfies InputFrameSource: snapshot tracks the top layer', () => {
  const { device, focus } = setup();
  focus.setActive('modal-ui', true);
  device.keyDown('Enter');
  focus.step();
  const snapshot: ActionState = focus.snapshot();
  assert.equal(snapshot.held('confirm'), true, 'snapshot reflects the modal mapper');
  assert.equal(snapshot.held('forward'), false, 'game verbs are not visible through the modal layer');

  focus.setActive('modal-ui', false);
  focus.step();
  assert.equal(focus.snapshot().held('confirm'), false);
});

test('scope dispose disables the focus manager', () => {
  const { device, focus } = setup();
  const scope = new Scope();
  const managed = new FocusManager(device, { scope });
  managed.bind('game', new ActionMapper(GAME_MAP, device));
  scope.dispose();
  assert.throws(() => managed.step(), /disposed/);
});
