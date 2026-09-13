// graphProblems 底层图检查（作为导出纯函数单独覆盖）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { graphProblems } from '../steps/lib/schemas.mjs';

const sc = (id, type, extra = {}) => ({ id, type, ...extra });

test('可达性 + 结局可达 + 目标存在：好图零问题', () => {
  const scenes = [
    sc('a', 'novel', { next: 'b' }),
    sc('b', 'choice', { choices: [{ id: '1', next: 'e1' }, { id: '2', next: 'e2' }] }),
    sc('e1', 'ending'),
    sc('e2', 'ending'),
  ];
  assert.deepEqual(graphProblems(scenes, { startId: 'a' }), []);
});

test('无出口的 novel 场景（既非 ending 也没有 next）', () => {
  const scenes = [sc('a', 'novel'), sc('e1', 'ending')];
  const p = graphProblems(scenes, { startId: 'a' });
  assert.ok(p.some((x) => x.code === 'no-outgoing'));
});

test('ending 场景带 next → ending-has-out', () => {
  const scenes = [sc('a', 'novel', { next: 'e' }), sc('e', 'ending', { next: 'a' })];
  const p = graphProblems(scenes, { startId: 'a' });
  assert.ok(p.some((x) => x.code === 'ending-has-out'));
});

test('target-missing（goto 指空）', () => {
  const scenes = [sc('a', 'novel', { goto: 'gone' })];
  const p = graphProblems(scenes, { startId: 'a' });
  assert.ok(p.some((x) => x.code === 'target-missing'));
});
