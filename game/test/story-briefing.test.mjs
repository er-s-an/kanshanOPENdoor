import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildStoryBriefing } from '../src/lib/story-briefing.mjs';

function loadStory(filename) {
  return JSON.parse(readFileSync(new URL(`../stories/${filename}`, import.meta.url), 'utf8'));
}

function firstScene(story) {
  return story.scenes.find((scene) => scene.id === story.start);
}

test('蓝血简报明确身份、异常和第一步，且保持三行短文案', () => {
  const story = loadStory('蓝血-2025684191967294692.json');
  const briefing = buildStoryBriefing(story, firstScene(story));
  assert.match(briefing.identity, /方诺/);
  assert.match(briefing.anomaly, /血是蓝色|记忆不同/);
  assert.match(briefing.firstStep, /先听身边的人|暴露多少/);
  assert.equal(Object.keys(briefing).length, 3);
  for (const line of Object.values(briefing)) {
    assert.ok(line.length > 0 && Array.from(line).length <= 72, line);
  }
});

test('近视眼简报不臆造姓名，并把感知方式变成可执行的第一步', () => {
  const story = loadStory('近视眼勇闯恐怖游戏-1747681485547843585.json');
  const briefing = buildStoryBriefing(story, firstScene(story));
  assert.match(briefing.identity, /《近视眼勇闯恐怖游戏》里的当事人/);
  assert.match(briefing.anomaly, /陌生的大楼|七天/);
  assert.match(briefing.firstStep, /走近|听听声音|问问/);
});

test('简报只读取当前公开开场，不会泄漏后续场景、lore、线索或结局', () => {
  const story = {
    story: { id: 'safe', title: '边界测试', author: '', tags: [] },
    start: 'first',
    kanshan: { intro: '你是新来的调查员。门口的灯突然熄灭了。先问清谁最后离开。' },
    scenes: [
      { id: 'first', type: 'novel', text: '你刚刚抵达门口。' },
      { id: 'future', type: 'ending', text: 'SPOILER_FUTURE_TRUTH' },
    ],
    lore: [{ id: 'truth', content: 'SPOILER_LORE_TRUTH' }],
    clues: [{ id: 'clue', name: 'SPOILER_CLUE_TRUTH' }],
    endings: [{ id: 'future', title: 'SPOILER_ENDING_TRUTH' }],
  };
  const serialized = JSON.stringify(buildStoryBriefing(story, story.scenes[0]));
  assert.doesNotMatch(serialized, /SPOILER/);
  assert.match(serialized, /调查员/);
  assert.match(serialized, /灯突然熄灭/);
  assert.match(serialized, /先问清/);
});

test('缺少引导文案时仍提供克制、可执行的安全兜底', () => {
  const story = { story: { id: 'fallback', title: '空白故事', author: '', tags: [] }, start: 'first', scenes: [] };
  const briefing = buildStoryBriefing(story, { id: 'first', type: 'investigate' });
  assert.deepEqual(briefing, {
    identity: '你是《空白故事》里的当事人，接下来由你做决定。',
    anomaly: '眼前发生的事还没有完整答案。',
    firstStep: '先从眼前能确认的细节开始搜证。',
  });
});
