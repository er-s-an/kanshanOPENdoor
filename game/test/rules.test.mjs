import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, applyChoice, actionLocked, completedOutcome, matches } from '../src/lib/rules.mjs';

const scene = {
  id: 'room', type: 'encounter', encounter: {
    objective: 'Take a risk or leave', resources: [{ key: 'time', label: '时间', min: 0, max: 3 }, { key: 'risk', label: '关注', min: 0, max: 3 }],
    actions: [
      { id: 'look', text: '观察', hint: '需要时间', effects: [{ op: 'add', key: 'time', value: -1 }, { op: 'set', key: 'seen', value: 'yes' }], feedback: '留下观察' },
      { id: 'claim', text: '质疑', hint: '先观察', requires: [{ key: 'seen', op: 'eq', value: 'yes' }], effects: [{ op: 'add', key: 'time', value: -2 }, { op: 'add', key: 'risk', value: 4 }], feedback: '引起注意' },
      { id: 'leave', text: '离开', hint: '', effects: [{ op: 'set', key: 'left', value: 'yes' }], feedback: '先保住自己' },
    ], outcomes: [
      { id: 'exposed', when: [{ key: 'risk', op: 'gte', value: 3 }], next: 'bad', text: '你被留意了' },
      { id: 'safe', when: [{ key: 'left', op: 'eq', value: 'yes' }], next: 'safe', text: '你离开了' },
      { id: 'timeout', when: [{ key: 'time', op: 'lte', value: 0 }], next: 'late', text: '时间结束' },
    ],
  },
};
const initial = { time: '3', risk: '0', seen: 'no', left: 'no' };

test('failed prerequisites and unknown actions leave state unchanged', () => {
  const before = JSON.stringify(initial);
  assert.equal(applyAction(scene, 'claim', initial), null);
  assert.equal(applyAction(scene, 'invented', initial), null);
  assert.equal(JSON.stringify(initial), before);
  assert.equal(matches([{ key: 'missing', op: 'ne', value: 0 }], initial), false);
  assert.equal(matches([{ key: 'risk', op: 'gte', value: 'nonsense' }], initial), false);
});
test('costs, capped risk, outcome priority and double action rejection are deterministic', () => {
  const first = applyAction(scene, 'look', initial);
  assert.equal(first.vars.time, '2');
  assert.equal(first.outcome, null);
  assert.equal(applyAction(scene, 'look', first.vars), null);
  const result = applyAction(scene, 'claim', first.vars);
  assert.equal(result.vars.time, '0');
  assert.equal(result.vars.risk, '3');
  assert.equal(result.outcome.id, 'exposed');
  assert.equal(applyAction(scene, 'leave', result.vars), null);
  assert.equal(completedOutcome(scene, JSON.parse(JSON.stringify(result.vars))).id, 'exposed');
});
test('insufficient resources reject the entire transaction', () => {
  const vars = { ...initial, time: '1', seen: 'yes' };
  assert.equal(actionLocked(scene, scene.encounter.actions[1], vars), '时间不足');
  assert.equal(applyAction(scene, 'claim', vars), null);
  assert.deepEqual(vars, { ...initial, time: '1', seen: 'yes' });
});
test('different actions lead to different consequences; replay survives JSON save roundtrip', () => {
  const safe = applyAction(scene, 'leave', initial);
  assert.equal(safe.outcome.id, 'safe');
  const run = () => ['look', 'claim'].reduce((vars, id) => applyAction(scene, id, vars).vars, { ...initial });
  assert.deepEqual(run(), run());
  const restored = JSON.parse(JSON.stringify(applyAction(scene, 'look', initial).vars));
  assert.deepEqual(applyAction(scene, 'claim', restored).vars, run());
});
test('legacy choice gates and scene membership apply at the transaction boundary', () => {
  const game = { scenes: [{ id: 'a', choices: [{ id: 'gate', text: '开门', next: 'b', requires: { key: 'yes' }, set: { visited: 'yes' } }] }, { id: 'b' }] };
  assert.equal(applyChoice(game, 'a', 'gate', {}), null);
  assert.equal(applyChoice(game, 'b', 'gate', { key: 'yes' }), null);
  assert.equal(applyChoice(game, 'a', 'forged', { key: 'yes' }), null);
  assert.deepEqual(applyChoice(game, 'a', 'gate', { key: 'yes' }).vars, { key: 'yes', visited: 'yes' });
  game.scenes[0].choices[0].next = 'missing';
  assert.equal(applyChoice(game, 'a', 'gate', { key: 'yes' }), null);
});
