import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyChoice } from '../src/lib/rules.mjs';

const story = JSON.parse(readFileSync(new URL('../stories/蓝血-2025684191967294692.json', import.meta.url), 'utf8'));
const sceneOf = (id) => story.scenes.find((scene) => scene.id === id);
const feed = sceneOf('post_feed');
const registeredClues = new Set(story.clues.map((clue) => clue.id));

test('蓝血社区：互动账号和氛围楼层分开，所有身份与知情边界明确', () => {
  assert.equal(feed?.type, 'post');
  assert.equal(feed.post?.view, 'feed');
  assert.ok(feed.post.entries.length >= 12 && feed.post.entries.length <= 18);
  const interactive = feed.post.entries.filter((entry) => entry.actionChoiceId);
  const ambient = feed.post.entries.filter((entry) => !entry.actionChoiceId);
  assert.ok(interactive.length >= 3 && interactive.length <= 5);
  assert.ok(ambient.length >= 8, '社区不能看起来只有几个剧情按钮');
  assert.match(feed.post.fictionNotice, /虚构角色/);
  assert.match(feed.post.fictionNotice, /不是.*真实知乎关注/);
  for (const entry of feed.post.entries) {
    assert.equal(entry.identity, 'story-fictional');
    assert.ok(entry.knowledge.trim(), `${entry.id} 缺少知情边界`);
    if (entry.actionChoiceId) assert.ok(feed.choices.some((choice) => choice.id === entry.actionChoiceId));
  }
  assert.equal(feed.post.entries.filter((entry) => entry.channel === 'dm').length, 1);
});

test('蓝血社区：玩家至少核对一人后才能离开，选错仍可返回并追查有效来源', () => {
  const startVars = { clue_web: 'found', clue_river: 'found', clue_mismatch: 'found' };
  const entered = applyChoice(story, 'invest_desktop', 'desktop_on', startVars);
  assert.equal(entered?.sceneId, 'post_feed');
  assert.equal(applyChoice(story, 'post_feed', 'leave_post_feed', entered.vars), null);

  const uncertain = applyChoice(story, 'post_feed', 'open_unknown', entered.vars);
  assert.equal(uncertain?.sceneId, 'post_unknown_thread');
  assert.equal(uncertain.vars.clue_reply, 'found');
  assert.notEqual(uncertain.vars.clue_similar_post, 'found');
  assert.notEqual(uncertain.vars.clue_post_exposure, 'found');

  const back = applyChoice(story, 'post_unknown_thread', 'unknown_back', uncertain.vars);
  assert.equal(back?.sceneId, 'post_feed');
  const useful = applyChoice(story, 'post_feed', 'open_archive', back.vars);
  assert.equal(useful?.sceneId, 'post_archive_thread');
  assert.equal(useful.vars.clue_similar_post, 'found');
  const returned = applyChoice(story, 'post_archive_thread', 'archive_back', useful.vars);
  assert.equal(returned?.sceneId, 'post_feed');
  assert.equal(applyChoice(story, 'post_feed', 'leave_post_feed', returned.vars)?.sceneId, 'n_post_disguise');
});

test('蓝血社区：所有授证都来自写定选择和入场变量，不存在自由文本授证', () => {
  const postScenes = story.scenes.filter((scene) => scene.type === 'post');
  assert.equal(postScenes.length, 5);
  for (const scene of postScenes) {
    assert.equal(scene.dialogue, undefined, `${scene.id} 不应接入自由对话授证`);
    assert.ok(scene.choices?.length, `${scene.id} 必须有确定性互动出口`);
    for (const id of Object.keys(scene.onEnter || {})) {
      assert.ok(registeredClues.has(id), `${scene.id} 授予了未登记线索 ${id}`);
      assert.equal(scene.onEnter[id], 'found');
    }
    for (const choice of scene.choices) assert.ok(sceneOf(choice.next), `${choice.id} 指向不存在的场景`);
  }
  for (const id of ['post_archive_thread', 'post_safety_thread', 'post_skeptic_thread', 'post_unknown_thread']) {
    const scene = sceneOf(id);
    assert.ok(scene.choices.some((choice) => choice.next === 'post_feed'), `${id} 选错后无法返回`);
    assert.ok(scene.choices.some((choice) => choice.next === 'n_post_disguise'), `${id} 无法继续主线`);
  }
});
