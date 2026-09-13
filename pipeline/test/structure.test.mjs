// design 产物（structure.json）的 schema/图校验测试；顺带验证 mockDesign 自带合法性。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockAnalyze, mockDesign } from '../steps/lib/mock.mjs';
import { validateStructure, deriveLoreIds } from '../steps/lib/schemas.mjs';

function baseFixture() {
  const paragraphs = [
    '我叫阿凯，在台里上夜班。今晚收到一盘没有署名的磁带。',
    '阿凯说：“有人放在快递柜里，收件人写的是你。”',
    '磁带里是一段新闻：解放路37号凌晨起火。',
    '那场火，像十年前烧掉我妹妹的那场。',
  ];
  const raw = {
    storyId: 't1', title: '零点磁带', author: '', wordCount: 100,
    fullText: paragraphs.join('\n\n'),
    paragraphs: paragraphs.map((text, i) => ({ index: i + 1, text })),
  };
  const analysis = mockAnalyze(raw);
  const structure = mockDesign(raw, analysis);
  const ctx = {
    paragraphCount: paragraphs.length,
    charIds: analysis.characters.map((c) => c.id),
    nonProtagonistIds: analysis.characters.filter((c) => c.role !== 'protagonist').map((c) => c.id),
    loreIds: deriveLoreIds(analysis),
  };
  return { raw, analysis, structure, ctx };
}

function problemsOf(fn) {
  return validateStructure(fn.structure, fn.ctx);
}

test('mockDesign 4 段小故事 → structure 本身合法', () => {
  const fx = baseFixture();
  assert.equal(problemsOf(fx).length, 0, problemsOf(fx).join('\n'));
});

test('choice.set 使用未声明变量 → 报“未声明变量”', () => {
  const fx = baseFixture();
  const mid = fx.structure.scenes.find((s) => s.id === 'choice_mid');
  mid.choices[0].set = { trust_unknown_x: '高' };
  const p = problemsOf(fx);
  assert.ok(p.some((m) => m.includes('未声明变量')), p.join('\n'));
});

test('npc 使用主角 → 报错', () => {
  const fx = baseFixture();
  const protoId = fx.analysis.characters.find((c) => c.role === 'protagonist').id;
  fx.structure.npcs[0].id = protoId;
  const p = problemsOf(fx);
  assert.ok(p.some((m) => m.includes('主角')), p.join('\n'));
});

test('chat 场景把 npc 指向非 chat 场景 → 报错', () => {
  const fx = baseFixture();
  fx.structure.npcs[0].chatScene = 'n1';
  const p = problemsOf(fx);
  assert.ok(p.some((m) => m.includes('不是 chat 类型')), p.join('\n'));
});

test('paragraphRange 越界 / 类型误用被拦截', () => {
  const fx = baseFixture();
  const novel = fx.structure.scenes.find((s) => s.type === 'novel');
  novel.paragraphRange = [1, 99];
  let p = problemsOf(fx);
  assert.ok(p.some((m) => m.includes('paragraphRange')), p.join('\n'));

  const fx2 = baseFixture();
  const chat = fx2.structure.scenes.find((s) => s.type === 'chat');
  chat.paragraphRange = [1, 1];
  p = problemsOf(fx2);
  assert.ok(p.some((m) => m.includes('不应带 paragraphRange')), p.join('\n'));
});
