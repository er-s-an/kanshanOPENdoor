import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const story = JSON.parse(readFileSync(new URL('../stories/蓝血-2025684191967294692.json', import.meta.url), 'utf8'));
const feed = story.scenes.find((scene) => scene.id === 'post_feed');

test('蓝血社区以世界内常识为多数声音，只留少数异常细缝', () => {
  const normal = feed.post.entries.filter((entry) => entry.stance === 'world-normal');
  const anomaly = feed.post.entries.filter((entry) => entry.stance === 'anomaly');
  assert.ok(normal.length >= 8, `expected at least 8 world-normal voices, received ${normal.length}`);
  assert.ok(anomaly.length <= 2, `expected at most 2 anomaly voices, received ${anomaly.length}`);
  assert.match(feed.post.questionTitle, /压力|记反/);
  assert.doesNotMatch(feed.post.questionBody, /应该先相信哪一边/);
});

test('主帖有楼中楼生活感，但楼中楼不开新的授证路径', () => {
  const nested = feed.post.entries.flatMap((entry) => entry.replies || []);
  assert.ok(nested.length >= 4);
  assert.equal(new Set(nested.map((reply) => reply.id)).size, nested.length);
  assert.ok(nested.every((reply) => reply.name.trim() && reply.text.trim()));
  assert.ok(nested.every((reply) => !('actionChoiceId' in reply) && !('set' in reply)));
});

test('可追问账号与线索路由保持稳定', () => {
  assert.deepEqual(
    feed.post.entries.filter((entry) => entry.actionChoiceId).map((entry) => [entry.id, entry.actionChoiceId]),
    [
      ['archive', 'open_archive'],
      ['safety', 'open_safety'],
      ['skeptic', 'open_skeptic'],
      ['unknown', 'open_unknown'],
    ],
  );
});
