import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  advanceBossCase, createBossRun, presentBossEvidence, selectBossClaim,
} from '../src/lib/boss-rules.mjs';

const story = JSON.parse(readFileSync(new URL('../stories/蓝血-2025684191967294692.json', import.meta.url), 'utf8'));
const scene = story.scenes.find((entry) => entry.id === 'boss_blue');
const held = {
  clue_physical: 'found', clue_red: 'found', clue_web: 'found',
  clue_test_difference: 'found', clue_old_staff: 'found', clue_trainer_reply: 'found',
  clue_tail_pattern: 'found', clue_restaurant: 'found', clue_shop: 'found',
};

test('蓝血：公开论证从可负责的主张开始，而不要求猜测幕后主体', () => {
  assert.ok(scene?.boss);
  assert.deepEqual(scene.boss.claims.map((claim) => claim.id), ['bounded', 'overreach', 'record']);
  assert.equal(scene.boss.cases.length, 3);
  assert.match(scene.boss.claims[0].statement, /还不能证明/);
  assert.match(scene.boss.claims[1].statement, /甄别/);
});

test('蓝血：强证据推进，越界呈证不消耗记录也不阻断复核', () => {
  let run = createBossRun(scene);
  run = selectBossClaim(scene, run, 'bounded').run;

  const overreach = presentBossEvidence(scene, run, 'clue_web', held);
  assert.equal(overreach.status, 'overreach');
  assert.equal(overreach.consumed, false);
  assert.deepEqual(overreach.run.usedClues, []);

  let step = presentBossEvidence(scene, overreach.run, 'clue_physical', held);
  assert.equal(step.status, 'supported');
  assert.equal(step.result, 'supported');
  run = advanceBossCase(scene, step.run).run;

  step = presentBossEvidence(scene, run, 'clue_test_difference', held);
  assert.equal(step.status, 'supported');
  run = advanceBossCase(scene, step.run).run;

  step = presentBossEvidence(scene, run, 'clue_tail_pattern', held);
  assert.equal(step.status, 'supported');
  const completed = advanceBossCase(scene, step.run);
  assert.equal(completed.status, 'truth');
  assert.equal(completed.destination, 'e_true');
});

test('蓝血：越界主张即使逐项回应，也必须先回到草稿收窄', () => {
  let run = createBossRun(scene);
  run = selectBossClaim(scene, run, 'overreach').run;

  for (const clue of ['clue_physical', 'clue_test_difference', 'clue_tail_pattern']) {
    const step = presentBossEvidence(scene, run, clue, held);
    assert.equal(step.status, 'supported');
    const advanced = advanceBossCase(scene, step.run);
    run = advanced.run;
  }

  assert.equal(run.outcome, 'fold');
  assert.equal(run.phase, 'resolved');
});
