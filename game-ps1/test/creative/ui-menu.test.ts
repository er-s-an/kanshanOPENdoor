import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDocument, FakeElement } from '../../src/creative/ui/fakedom.ts';
import { SettingsMenu, TEXT_SCALE_ORDER } from '../../src/creative/ui/menu.ts';
import { FocusManager } from '../../src/creative/input/focus.ts';
import { HeadlessInputDevice } from '../../src/creative/input/headless.ts';
import type { FocusLayer } from '../../src/creative/core/input-types.ts';

function fakeFocus() {
  const active = new Set<FocusLayer>(['game']);
  return {
    control: {
      setActive(layer: FocusLayer, on: boolean) {
        if (on) active.add(layer);
        else active.delete(layer);
      },
      isActive(layer: FocusLayer) {
        return active.has(layer);
      },
      top(): FocusLayer | null {
        for (const layer of ['modal-ui', 'editor', 'game'] as const) if (active.has(layer)) return layer;
        return null;
      },
    },
    active,
  };
}

test('open/close toggles visibility and the modal-ui focus layer', () => {
  const doc = new FakeDocument();
  const focus = fakeFocus();
  const menu = new SettingsMenu(doc, { focus: focus.control });
  assert.equal(menu.isOpen, false);
  assert.equal(menu.element.hidden, true);
  assert.equal(focus.control.top(), 'game');

  menu.open();
  assert.equal(menu.isOpen, true);
  assert.equal(menu.element.hidden, false);
  assert.equal(focus.control.top(), 'modal-ui');

  menu.close();
  assert.equal(menu.isOpen, false);
  assert.equal(menu.element.hidden, true);
  assert.equal(focus.control.top(), 'game', 'closing returns input focus to the game layer');
});

test('integrates with the real FocusManager (structural match)', () => {
  const device = new HeadlessInputDevice();
  const manager = new FocusManager(device);
  const doc = new FakeDocument();
  const menu = new SettingsMenu(doc, { focus: manager });

  menu.open();
  assert.equal(manager.topLayer(), 'modal-ui');
  menu.close();
  assert.equal(manager.topLayer(), 'game');
  manager.dispose();
  device.dispose();
});

test('text-scale setting applies mutually exclusive classes', () => {
  const doc = new FakeDocument();
  const menu = new SettingsMenu(doc, { focus: fakeFocus().control });
  assert.equal(menu.textScale, 'normal');
  assert.equal(menu.element.classList.contains('ui-text-scale--normal'), true);

  menu.setTextScale('large');
  assert.equal(menu.element.classList.contains('ui-text-scale--large'), true);
  assert.equal(menu.element.classList.contains('ui-text-scale--normal'), false);

  menu.setTextScale('small');
  assert.equal(menu.element.classList.contains('ui-text-scale--small'), true);
  assert.equal(menu.element.classList.contains('ui-text-scale--large'), false);
  assert.equal(menu.settings.textScale, 'small');
});

test('cycleTextScale walks small -> normal -> large -> small', () => {
  const doc = new FakeDocument();
  const menu = new SettingsMenu(doc, { focus: fakeFocus().control, initial: { textScale: 'small' } });
  const seen = [menu.cycleTextScale(), menu.cycleTextScale(), menu.cycleTextScale()];
  assert.deepEqual(seen, ['normal', 'large', 'small']);
});

test('reduce-motion is an observable flag others can read', () => {
  const doc = new FakeDocument();
  const menu = new SettingsMenu(doc, { focus: fakeFocus().control });
  assert.equal(menu.reduceMotion, false);

  const observed: boolean[] = [];
  menu.onReduceMotionChange((on) => observed.push(on));
  const settingsSeen: boolean[] = [];
  menu.onChange((s) => settingsSeen.push(s.reduceMotion));

  menu.setReduceMotion(true);
  assert.equal(menu.reduceMotion, true, 'getter reflects the flag');
  assert.equal(menu.element.classList.contains('ui-reduce-motion'), true);

  menu.setReduceMotion(false);
  assert.equal(menu.reduceMotion, false);
  assert.equal(menu.element.classList.contains('ui-reduce-motion'), false);
  assert.deepEqual(observed, [true, false]);
  assert.deepEqual(settingsSeen, [true, false]);
});

test('menu buttons drive settings and close; labels are textContent', () => {
  const doc = new FakeDocument();
  const focus = fakeFocus();
  const menu = new SettingsMenu(doc, { focus: focus.control });
  menu.open();

  const scaleButton = menu.scaleButton as { click(): void; textContent: string };
  const motionButton = menu.motionButton as { click(): void; textContent: string };
  const closeButton = menu.closeButton as { click(): void; textContent: string };

  assert.equal(closeButton.textContent, '关闭');
  assert.match(scaleButton.textContent, /文字大小：标准/);
  assert.match(motionButton.textContent, /减少动态效果：关/);

  scaleButton.click();
  assert.equal(menu.textScale, 'large', 'scale button cycles the setting');
  assert.match(scaleButton.textContent, /文字大小：大/);

  motionButton.click();
  assert.equal(menu.reduceMotion, true);

  closeButton.click();
  assert.equal(menu.isOpen, false);
  assert.equal(focus.control.top(), 'game', 'close button releases modal focus');
});

test('toggle flips open state idempotently', () => {
  const doc = new FakeDocument();
  const menu = new SettingsMenu(doc, { focus: fakeFocus().control });
  menu.toggle();
  assert.equal(menu.isOpen, true);
  menu.toggle();
  assert.equal(menu.isOpen, false);
  menu.open();
  menu.open(); // idempotent
  assert.equal(menu.isOpen, true);
});

test('authors can mount custom elements into the provided container', () => {
  const doc = new FakeDocument();
  const menu = new SettingsMenu(doc, { focus: fakeFocus().control });
  const mine = doc.createElement('label');
  mine.textContent = '自定义选项';
  menu.custom.appendChild(mine);
  const custom = menu.custom as FakeElement;
  assert.equal(custom.children.length, 1);
  assert.equal(custom.queryByTag('label'), mine);
  assert.equal(mine.parent, menu.custom);
});

test('initial settings respected; TEXT_SCALE_ORDER exported', () => {
  const doc = new FakeDocument();
  const menu = new SettingsMenu(doc, {
    focus: fakeFocus().control,
    initial: { textScale: 'large', reduceMotion: true },
  });
  assert.equal(menu.textScale, 'large');
  assert.equal(menu.reduceMotion, true);
  assert.equal(menu.element.classList.contains('ui-text-scale--large'), true);
  assert.equal(menu.element.classList.contains('ui-reduce-motion'), true);
  assert.deepEqual([...TEXT_SCALE_ORDER], ['small', 'normal', 'large']);
});
