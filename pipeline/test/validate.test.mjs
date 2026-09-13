// validate 的契约 + 图完整性测试（含故意构造的坏图）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkGameContract } from '../steps/lib/schemas.mjs';

// —— 构造一个合法的 game.json（10 场景 / 3 结局），再按用例破坏它 ——
function goodGame(over = {}) {
  const scene = (id, type, extra = {}) => ({ id, type, chapter: '', image: '', text: `场景${id}正文`, ...extra });
  const base = {
    story: { id: 't', title: '测试', author: '', tags: ['悬疑'] },
    start: 'n1',
    scenes: [
      scene('n1', 'novel', { next: 'c1' }),
      scene('c1', 'choice', {
        choices: [
          { id: 'a', text: '相信他', next: 'n2', set: { trust: '高' } },
          { id: 'b', text: '怀疑他', next: 'e_bad', set: { trust: '低' } },
        ],
      }),
      scene('n2', 'novel', { next: 'chat_x' }),
      scene('chat_x', 'chat', { npc: 'np1', goal: '问出线索', next: 'c2' }),
      scene('c2', 'choice', {
        choices: [
          { id: 'x', text: '照原路走', next: 'e_main', set: { ending: 'main' } },
          { id: 'y', text: '走另一条', next: 'e_secret', set: { ending: 'secret' } },
        ],
      }),
      scene('e_bad', 'ending'),
      scene('e_main', 'ending'),
      scene('e_secret', 'ending'),
    ],
    npcs: [{ id: 'np1', name: '阿凯', card: { description: 'd', personality: 'p', scenario: 's', first_mes: 'f', mes_example: 'm', system_prompt: 'sp' } }],
    lore: [],
    endings: [
      { id: 'e_bad', title: '退', tone: '遗憾' },
      { id: 'e_main', title: '原著', tone: '平静' },
      { id: 'e_secret', title: '隐藏', tone: '温暖' },
    ],
    kanshan: { intro: '欢迎穿越', rescueLines: ['别慌', '跟线索走', '我不剧透', '凭直觉'] },
  };
  // 深合并 + 替换
  return JSON.parse(JSON.stringify(Object.assign(base, over)));
}

function codes(game) {
  return checkGameContract(game).problems.map((p) => p.code);
}
const has = (game, code) => assert.ok(codes(game).includes(code), `应含 ${code}，实际 ${codes(game).join(',')}`);

test('合法图：零问题', () => {
  const res = checkGameContract(goodGame());
  assert.equal(res.ok, true);
  assert.equal(res.problems.length, 0);
});

test('start 指向不存在的场景', () => {
  has(goodGame({ start: 'ghost' }), 'start-missing');
});

test('next 指向不存在的场景', () => {
  const g = goodGame();
  g.scenes.find((s) => s.id === 'n1').next = 'ghost';
  has(g, 'target-missing');
});

test('choice.next 指向不存在的场景', () => {
  const g = goodGame();
  g.scenes.find((s) => s.id === 'c1').choices[1].next = 'ghost';
  has(g, 'target-missing');
});

test('存在从 start 不可达的场景', () => {
  const g = goodGame();
  g.scenes.push({ id: 'orphan', type: 'novel', chapter: '', image: '', text: '孤儿', next: 'e_main' });
  has(g, 'unreachable');
});

test('死循环：环上所有场景都无法到达结局', () => {
  const g = goodGame();
  g.scenes.find((s) => s.id === 'n2').next = 'chat_x'; // 正常
  const loop = g.scenes.find((s) => s.id === 'chat_x');
  loop.next = 'c_loop';
  loop.type = 'novel'; // 让 chat 失去 npc/goal 约束干扰
  g.scenes.push({ id: 'c_loop', type: 'choice', chapter: '', image: '', text: 'loop', choices: [{ id: 'l', text: '再来', next: 'c_loop', set: {} }] });
  // 从 c_loop 只能回到自己 → 无路到结局
  has(g, 'no-end-path');
});

test('ending 场景未登记进 endings[]（运行时用 scene.id 查结局元数据）', () => {
  const g = goodGame();
  g.endings[2].id = 'e_renamed'; // 保持 3 条，但场景 e_secret 查不到元数据
  const res = checkGameContract(g);
  assert.ok(res.problems.some((p) => p.code === 'ref-missing' && p.path.includes('e_secret')), JSON.stringify(res.problems));
});

test('endings 条目没有对应 ending 场景', () => {
  const g = goodGame();
  g.endings.push({ id: 'e_ghost', title: 'x', tone: 'y' });
  has(g, 'ref-missing');
});

test('场景 id 重复', () => {
  const g = goodGame();
  g.scenes[0].id = g.scenes[1].id; // n1 → c1 重复
  has(g, 'dup-id');
});

test('结局少于 3 个', () => {
  const g = goodGame();
  g.endings = g.endings.slice(0, 2);
  g.scenes = g.scenes.filter((s) => !s.type.endsWith('ng') || s.id === 'e_bad' || s.id === 'e_main');
  const res = checkGameContract(g);
  assert.ok(!res.ok);
  assert.ok(res.problems.some((p) => p.code === 'field' && p.path.startsWith('endings')), 'endings 数量违反契约');
});

test('chat 场景缺少 npc/goal', () => {
  const g = goodGame();
  const chat = g.scenes.find((s) => s.type === 'chat');
  delete chat.npc;
  delete chat.goal;
  has(g, 'field');
});

test('set 变量名拼写几乎一致 → 判为疑似不一致', () => {
  const g = goodGame();
  const c2 = g.scenes.find((s) => s.id === 'c2');
  c2.choices[0].set = { trust_level: 'a' };
  c2.choices[1].set = { trust_leve: 'b' }; // 编辑距离 1
  has(g, 'var-typo');
});

test('kanshan.rescueLines 少于 3 条 → 契约问题', () => {
  const g = goodGame();
  g.kanshan.rescueLines = g.kanshan.rescueLines.slice(0, 2);
  has(g, 'field');
});

test('choice 场景缺失 choices', () => {
  const g = goodGame();
  const c1 = g.scenes.find((s) => s.id === 'c1');
  delete c1.choices;
  delete c1.next;
  has(g, 'field');
});

test('条件门可满足：chat 选项授予线索，收束选项带 requires → 零问题', () => {
  const g = goodGame();
  const chat = g.scenes.find((s) => s.id === 'chat_x');
  chat.choices = [{ id: 'q1', text: '问出关键线索', next: 'c2', set: { clue_key: 'found' } }];
  delete chat.next;
  const c2 = g.scenes.find((s) => s.id === 'c2');
  c2.choices[1].requires = { clue_key: 'found' };
  c2.choices[1].lockedHint = '还缺线索';
  const res = checkGameContract(g);
  assert.equal(res.problems.length, 0, JSON.stringify(res.problems));
});

test('requires 的变量没有任何选项能设置 → gate-unsatisfiable', () => {
  const g = goodGame();
  const c2 = g.scenes.find((s) => s.id === 'c2');
  c2.choices[1].requires = { clue_ghost: 'found' };
  has(g, 'gate-unsatisfiable');
});

test('setter 与门同场景（无法先拿线索再指认）→ gate-unsatisfiable', () => {
  const g = goodGame();
  const c2 = g.scenes.find((s) => s.id === 'c2');
  c2.choices[0].set = { clue_late: 'found' };
  c2.choices[1].requires = { clue_late: 'found' };
  has(g, 'gate-unsatisfiable');
});
