import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildKanshanMessages, fallbackKanshanLine, kanshanReplyLeaks } from '../server/dialogue.mjs';

const story = JSON.parse(readFileSync(new URL('../stories/蓝血-2025684191967294692.json', import.meta.url), 'utf8'));
const scene = story.scenes.find((candidate) => candidate.id === 'post_feed');

test('刘看山只收到当前屏幕和已发现线索，不收到后续场景或结局', () => {
  const { system } = buildKanshanMessages({ data: story, scene, history: [{ role: 'user', content: '我该做什么？' }], cluesFound: ['clue_web'] });
  assert.match(system, new RegExp(scene.post.questionTitle));
  assert.match(system, new RegExp(story.clues.find((clue) => clue.id === 'clue_web').name));
  assert.doesNotMatch(system, new RegExp(story.scenes.find((candidate) => candidate.id === 'n_test').text.slice(0, 24)));
  for (const ending of story.endings) assert.doesNotMatch(system, new RegExp(ending.title));
});

test('泄露未发现线索或直给答案的回复会被拦截', () => {
  const hidden = story.clues.find((clue) => clue.id !== 'clue_web' && [...clue.name].length >= 4);
  assert.equal(kanshanReplyLeaks(`你去找${hidden.name}就行了。`, { data: story, scene, cluesFound: ['clue_web'] }), true);
  assert.equal(kanshanReplyLeaks('正确答案是直接选第二个。', { data: story, scene, cluesFound: ['clue_web'] }), true);
  assert.equal(kanshanReplyLeaks('先看大家怎么接话，再决定追问谁。', { data: story, scene, cluesFound: ['clue_web'] }), false);
});

test('无上游时的刘看山回复仍是可执行且不泄底的', () => {
  const line = fallbackKanshanLine(story, scene);
  assert.match(line, /看|问|追问|记录/);
  assert.equal(kanshanReplyLeaks(line, { data: story, scene, cluesFound: [] }), false);
});
