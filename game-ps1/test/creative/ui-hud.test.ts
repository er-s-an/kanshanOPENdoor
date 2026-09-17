import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDocument, FakeElement } from '../../src/creative/ui/fakedom.ts';
import { Hud, SubtitleLine, InteractionPrompt } from '../../src/creative/ui/hud.ts';

test('subtitle show sets text/speaker and is visible; clear hides and empties', () => {
  const doc = new FakeDocument();
  const sub = new SubtitleLine(doc);

  sub.show('门开了。', { speaker: '思思' });
  assert.equal(sub.visible, true);
  assert.equal(sub.text, '门开了。');
  assert.equal(sub.speaker, '思思');

  sub.clear();
  assert.equal(sub.visible, false);
  assert.equal(sub.text, '');
});

test('subtitle holds long Chinese text verbatim (state/DOM assertions only)', () => {
  const doc = new FakeDocument();
  const sub = new SubtitleLine(doc);
  const long = '她看不清来人的五官，只觉得那轮廓比记忆里高了半头，声音像是从很远的水面下浮上来的。'.repeat(4);

  sub.show(long, { speaker: '旁白' });
  const textEl = (sub.element as FakeElement).queryByClass('ui-subtitle__text');
  assert.ok(textEl);
  assert.equal(textEl.textContent, long, 'long text survives verbatim');
  assert.equal(sub.element.hidden, false);
});

test('subtitle queue: FIFO promote on dismiss, clear drops everything', () => {
  const doc = new FakeDocument();
  const sub = new SubtitleLine(doc);

  sub.show('第一句');
  sub.queueLine('第二句');
  sub.queueLine('第三句');
  assert.equal(sub.text, '第一句');
  assert.equal(sub.queueLength, 2);

  sub.dismiss();
  assert.equal(sub.text, '第二句');
  assert.equal(sub.queueLength, 1);

  sub.dismiss();
  assert.equal(sub.text, '第三句');
  sub.dismiss();
  assert.equal(sub.visible, false);

  sub.queueLine('a');
  sub.queueLine('b');
  sub.clear();
  assert.equal(sub.visible, false);
  assert.equal(sub.queueLength, 0);
});

test('subtitle duration + tick auto-dismisses and promotes the queue', () => {
  const doc = new FakeDocument();
  const sub = new SubtitleLine(doc);

  sub.show('限时一句', { durationMs: 50 });
  sub.queueLine('后续一句');
  sub.tick(49);
  assert.equal(sub.visible, true);
  sub.tick(1);
  assert.equal(sub.text, '后续一句', 'expired line promotes the queued one');

  const manual = new SubtitleLine(doc);
  manual.show('手动句');
  manual.tick(10000);
  assert.equal(manual.visible, true, 'no durationMs => tick never auto-dismisses');
});

test('interaction prompt show/hide with label', () => {
  const doc = new FakeDocument();
  const prompt = new InteractionPrompt(doc);
  assert.equal(prompt.visible, false);

  prompt.show('按 E 拍门');
  assert.equal(prompt.visible, true);
  assert.equal(prompt.label, '按 E 拍门');

  prompt.hide();
  assert.equal(prompt.visible, false);
  assert.equal(prompt.label, '');
});

test('all author text goes through textContent — markup stays inert', () => {
  const doc = new FakeDocument();
  const sub = new SubtitleLine(doc);
  const payload = '<img src=x onerror=alert(1)>';
  sub.show(payload);

  const textEl = (sub.element as FakeElement).queryByClass('ui-subtitle__text')!;
  assert.equal(textEl.textContent, payload, 'payload stored as inert text');
  assert.equal(textEl.children.length, 0, 'no child elements ever created');
  assert.equal('innerHTML' in textEl, false, 'interface has no innerHTML');
});

test('Hud bundles subtitle + prompt + author custom mount container', () => {
  const doc = new FakeDocument();
  const hud = new Hud(doc);
  assert.equal(hud.element.classList.contains('ui-hud'), true);

  hud.subtitle.show('你好');
  hud.prompt.show('按 E 互动');
  assert.equal(hud.subtitle.visible, true);
  assert.equal(hud.prompt.visible, true);

  const mine = doc.createElement('div');
  mine.classList.add('author-widget');
  mine.textContent = '作者自定义区域';
  hud.custom.appendChild(mine);
  const custom = hud.custom as FakeElement;
  assert.equal(custom.children.length, 1);
  assert.equal(custom.queryByClass('author-widget'), mine);
});
