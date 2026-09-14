import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { buildStoryBriefing } from '../src/lib/story-briefing.mjs';
import {
  openInvestigationBrowserDocument,
  queryInvestigationBrowser,
} from '../src/lib/rules.mjs';

const story = JSON.parse(readFileSync(new URL('../stories/蓝血-2025684191967294692.json', import.meta.url), 'utf8'));
const sceneOf = (id) => story.scenes.find((scene) => scene.id === id);

test('搜索结果只暴露世界内页面，不暴露线索分类或判定逻辑', () => {
  const vars = {};
  const result = queryInvestigationBrowser(story, 'invest_desktop', '东方明珠', vars);

  assert.equal(result.status, 'results');
  assert.ok(result.results.length >= 2);
  for (const page of result.results) {
    assert.deepEqual(Object.keys(page).sort(), ['id', 'snippet', 'source', 'title', 'url']);
    assert.equal('itemId' in page || 'clue' in page || 'feedback' in page || 'vars' in page, false);
  }

  const relevant = openInvestigationBrowserDocument(story, 'invest_desktop', 'doc_tower_reference', vars);
  const unrelated = openInvestigationBrowserDocument(story, 'invest_desktop', 'doc_tower_noise', vars);
  assert.ok(relevant.page.body.length > 40);
  assert.ok(unrelated.page.body.length > 40);
  assert.deepEqual(Object.keys(relevant.page).sort(), Object.keys(unrelated.page).sort());
  assert.equal('feedback' in relevant || 'feedback' in unrelated, false);
});

test('门外交接由刘看山完成，进门后只用主角视角', () => {
  const briefing = buildStoryBriefing(story, sceneOf(story.start));
  assert.equal(briefing.identity, '你是方诺。');
  assert.match(briefing.anomaly, /血是蓝色|记忆不同/);
  assert.match(briefing.firstStep, /先听身边的人/);

  const opening = sceneOf(story.start).text;
  assert.doesNotMatch(opening, /玩家|角色痕迹|本幕身份|互动改编|作者心思/);
});

test('社区和浏览器界面不显示教程型文案', () => {
  const postView = readFileSync(new URL('../src/components/PostView.tsx', import.meta.url), 'utf8');
  const investigationView = readFileSync(new URL('../src/components/InvestigationView.tsx', import.meta.url), 'utf8');
  const visibleTutorialCopy = /本幕身份说明|虚构角色|调查摘录\s*0|判断来源|混有无关/;

  assert.doesNotMatch(postView, visibleTutorialCopy);
  assert.doesNotMatch(investigationView, visibleTutorialCopy);
  assert.deepEqual(sceneOf('invest_desktop').investigation.hints, []);
});
