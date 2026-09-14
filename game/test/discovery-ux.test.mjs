import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { searchInvestigation } from '../src/lib/rules.mjs';

const story = JSON.parse(readFileSync(new URL('../stories/蓝血-2025684191967294692.json', import.meta.url), 'utf8'));
const scene = story.scenes.find((candidate) => candidate.id === 'invest_desktop');

test('故事浏览器的每个可见入口都打开一条唯一且有用的记录', () => {
  assert.ok(scene?.investigation?.browser);
  const shortcuts = scene.investigation.browser.shortcuts;
  assert.equal(shortcuts.length, 4);
  assert.equal(new Set(shortcuts.map((shortcut) => shortcut.id)).size, shortcuts.length);

  for (const shortcut of shortcuts) {
    const result = searchInvestigation(story, scene.id, shortcut.query, {});
    assert.equal(result.status, 'found', `${shortcut.label} 应该能直接打开资料，而不是要求玩家再猜一次关键词`);
    assert.ok(result.item);
  }
});

test('玩家用常见说法搜索网页、建筑、地图和记忆都不会白输', () => {
  const cases = [
    ['身体的血是什么颜色', 'web'],
    ['我想看看城市里的著名建筑', 'tower'],
    ['有没有江边地图', 'river'],
    ['我原来记得是在上海', 'memory'],
  ];
  for (const [query, expectedId] of cases) {
    const result = searchInvestigation(story, scene.id, query, {});
    assert.equal(result.status, 'found', query);
    assert.equal(result.item.id, expectedId, query);
  }

  const broad = searchInvestigation(story, scene.id, '城市', {});
  assert.deepEqual(broad, { status: 'ambiguous', item: null });
  assert.deepEqual(searchInvestigation(story, scene.id, '月亮', {}), { status: 'miss', item: null });
});
