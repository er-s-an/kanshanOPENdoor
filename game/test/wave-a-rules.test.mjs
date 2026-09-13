import test from 'node:test';
import assert from 'node:assert/strict';
import { searchInvestigation } from '../src/lib/rules.mjs';
import {
  advanceBossCase, createBossRun, presentBossEvidence, restoreBossRun,
  selectBossClaim, selectBossSuspect,
} from '../src/lib/boss-rules.mjs';

const investigationStory = {
  clues: [{ id: 'clue_paper' }, { id: 'clue_blood' }, { id: 'clue_locked' }],
  scenes: [{
    id: 'room', type: 'investigate', investigation: { objective: '搜证', hints: [], checks: [], items: [
      { id: 'paper', title: '病历纸', keywords: ['检查单'], text: '内容', clue: 'clue_paper', discover: { aliases: [' 体 检／报告 '], modes: ['compare'] } },
      { id: 'blood', title: '血迹', keywords: ['红色痕迹'], text: '内容', clue: 'clue_blood', discover: { aliases: ['血色'] } },
      { id: 'blood-locked', title: '血袋', keywords: ['血色'], text: '隐藏内容', clue: 'clue_locked', requires: { access: 'yes' } },
    ] },
  }],
};

test('investigation search normalizes aliases and grants only one eligible match', () => {
  const vars = {};
  assert.deepEqual(searchInvestigation(investigationStory, 'room', '　体检/报告　', vars, 'look'), { status: 'miss', item: null });
  const result = searchInvestigation(investigationStory, 'room', '　体检/报告　', vars, 'compare');
  assert.equal(result.status, 'found');
  assert.equal(result.item.id, 'paper');
  assert.deepEqual(result.vars, { clue_paper: 'found' });
  assert.deepEqual(vars, {});
});

test('empty, irrelevant, and ambiguous search never return hidden item metadata or grant evidence', () => {
  assert.deepEqual(searchInvestigation(investigationStory, 'room', '　', {}), { status: 'empty', item: null });
  assert.deepEqual(searchInvestigation(investigationStory, 'room', '窗帘', {}), { status: 'miss', item: null });
  const ambiguous = searchInvestigation(investigationStory, 'room', '血色', { access: 'yes' });
  assert.deepEqual(ambiguous, { status: 'ambiguous', item: null });
  assert.equal('vars' in ambiguous, false);
});

const bossScene = {
  id: 'boss', type: 'boss', boss: {
    question: '这项指控成立吗？', intro: '开场', answer: '回答', foldWrong: '折叠', suspects: [], rounds: [],
    claims: [{ id: 'bounded', statement: '记录可以证明时间线矛盾', certainty: 'fact', credibility: 2 }],
    cases: [
      { id: 'timeline', claim: '时间线没有问题', counters: [
        { clue: 'clue_over', present: '过度指控', rebuttal: '越界', result: 'overreach', exposure: 3, explanation: '它只能证明接触，不能证明动机。' },
        { clue: 'clue_a', present: '呈上记录', rebuttal: '沉默', result: 'supported', credibility: 5, explanation: '时间戳直接冲突。' },
      ] },
      { id: 'identity', claim: '身份完全一致', counters: [
        { clue: 'clue_b', present: '呈上签名', rebuttal: '部分成立', result: 'partial', credibility: 1, explanation: '签名支持代签，但不能单独锁定操作者。' },
      ] },
    ],
    credibility: { initial: 10, min: 0, max: 20 },
    exposure: { initial: 0, min: 0, max: 10, miss: 2 },
    endings: { truth: 'truth', fold: 'fold' },
  },
};
const held = { clue_a: 'found', clue_b: 'found', clue_over: 'found', clue_other: 'found' };

test('claim-first boss flow returns evidence boundaries and never consumes a miss or overreach', () => {
  let run = createBossRun(bossScene);
  assert.equal(run.phase, 'claim');
  assert.equal(selectBossSuspect(bossScene, run, 'invented').status, 'inactive');
  const selected = selectBossClaim(bossScene, run, 'bounded');
  assert.equal(selected.status, 'claim-selected');
  run = selected.run;
  assert.equal(run.credibility, 12);

  const futureEvidence = presentBossEvidence(bossScene, run, 'clue_b', held);
  assert.equal(futureEvidence.status, 'miss');
  assert.equal(futureEvidence.consumed, false);
  assert.deepEqual(futureEvidence.run.usedClues, []);
  assert.equal(futureEvidence.run.exposure, 2);
  run = futureEvidence.run;

  const overreach = presentBossEvidence(bossScene, run, 'clue_over', held);
  assert.equal(overreach.status, 'overreach');
  assert.equal(overreach.explanation, '它只能证明接触，不能证明动机。');
  assert.equal(overreach.consumed, false);
  assert.deepEqual(overreach.run.usedClues, []);
  run = overreach.run;

  const supported = presentBossEvidence(bossScene, run, 'clue_a', held);
  assert.equal(supported.status, 'supported');
  assert.equal(supported.consumed, true);
  run = advanceBossCase(bossScene, supported.run).run;

  const partial = presentBossEvidence(bossScene, run, 'clue_b', held);
  assert.equal(partial.status, 'partial');
  assert.equal(partial.consumed, true);
  const truth = advanceBossCase(bossScene, partial.run);
  assert.equal(truth.status, 'truth');
  assert.equal(truth.destination, 'truth');
});

test('boss progress survives a JSON save roundtrip and old suspect stories retain fallback behavior', () => {
  const selected = selectBossClaim(bossScene, createBossRun(bossScene), 'bounded');
  const restored = restoreBossRun(bossScene, JSON.parse(JSON.stringify(selected.run)));
  assert.deepEqual(restored, selected.run);

  const legacy = {
    id: 'legacy', type: 'boss', boss: {
      question: '谁？', intro: '开场', answer: '回答', foldWrong: '错了', claims: undefined,
      suspects: [{ id: 'right', name: '甲', desc: '', correct: true }, { id: 'wrong', name: '乙', desc: '', correct: false }],
      rounds: [{ id: 'one', cue: '反驳', accept: ['clue_a'], slots: [{ clue: 'clue_a', present: '证据', rebuttal: '沉默' }] }],
      endings: { truth: 'truth', fold: 'fold' },
    },
  };
  const run = createBossRun(legacy);
  assert.equal(selectBossSuspect(legacy, run, 'right').status, 'suspect-selected');
  const wrong = selectBossSuspect(legacy, run, 'wrong');
  assert.equal(wrong.status, 'wrong-suspect');
  assert.equal(wrong.destination, 'fold');
});
