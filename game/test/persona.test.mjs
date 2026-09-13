import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildPersonaShareUrl, derivePersona, PERSONAS } from '../src/lib/persona.mjs';

const routes = [
  ['FIRE', 'evidence', 'push', 'public'], ['ANON', 'evidence', 'push', 'private'],
  ['CLEAN', 'evidence', 'restrain', 'public'], ['CTRL', 'evidence', 'restrain', 'private'],
  ['ECHO', 'testimony', 'push', 'public'], ['ASKR', 'testimony', 'push', 'private'],
  ['FAIR', 'testimony', 'restrain', 'public'], ['FEEL', 'testimony', 'restrain', 'private'],
];

function runFor(source, pace, voice) {
  const choices = [
    { id: 'source', text: `来源选择-${source}`, next: 'pace', set: { persona_source: source } },
    { id: 'pace', text: `推进选择-${pace}`, next: 'voice', set: { persona_pace: pace } },
    { id: 'voice', text: `发声选择-${voice}`, next: 'end', set: { persona_voice: voice } },
  ];
  const story = { story: { id: 'case', title: '无剧透测试', author: '', tags: [] }, start: 'source', scenes: [
    { id: 'source', type: 'choice', choices: [choices[0]] },
    { id: 'pace', type: 'choice', choices: [choices[1]] },
    { id: 'voice', type: 'choice', choices: [choices[2]] },
    { id: 'end', type: 'ending' },
  ] };
  const memo = choices.map((choice, index) => ({ kind: 'choice', sceneId: ['source', 'pace', 'voice'][index], text: choice.text }));
  return { story, memo };
}

test('all eight personas are reachable from three authored, replayable choice axes', () => {
  assert.equal(Object.keys(PERSONAS).length, 8);
  for (const [code, source, pace, voice] of routes) {
    const { story, memo } = runFor(source, pace, voice);
    const first = derivePersona(story, {}, memo);
    const second = derivePersona(story, {}, structuredClone(memo));
    assert.equal(first.code, code);
    assert.equal(first.confidence, 'compat');
    assert.deepEqual(first, second, `${code} changed for the same saved choices`);
    assert.equal(first.proofLines.length, 3);
    assert.ok(Object.values(first.basis).every((entries) => entries.length > 0));
    assert.ok(Object.values(first.basis).flat().every((entry) => memo.some((choice) => choice.sceneId === entry.sceneId && choice.text === entry.text)));
  }
});

test('optional exploration, screenshot-like vars and clue totals cannot change a main persona', () => {
  const { story, memo } = runFor('testimony', 'restrain', 'private');
  const baseline = derivePersona(story, {}, memo);
  const explored = derivePersona(story, {
    clue_everything: 'found', screenshot_taken: 'yes', comment_expanded: '99', dwell_seconds: '9000',
  }, [...memo,
    { kind: 'action', sceneId: 'search', actionId: 'inspect:all', text: '查看所有东西', feedback: '', changes: [] },
    { kind: 'action', sceneId: 'search', actionId: 'verify:all', text: '核对全部东西', feedback: '', changes: [] },
  ]);
  assert.equal(baseline.code, 'FEEL');
  assert.equal(explored.code, baseline.code);
  assert.deepEqual(explored.axes, baseline.axes);
});

test('old authored choice values are inferred but unknown axes are reported, not hidden', () => {
  const story = { story: { id: 'old', title: '旧故事', author: '', tags: [] }, start: 'final', scenes: [
    { id: 'final', type: 'choice', choices: [{ id: 'pause', text: '今晚先停下，把未证实的部分留下', next: 'end', set: { resolve: 'pause' } }] },
    { id: 'end', type: 'ending' },
  ] };
  const result = derivePersona(story, { resolve: 'pause' }, [{ kind: 'choice', sceneId: 'final', text: '今晚先停下，把未证实的部分留下' }]);
  assert.equal(result.axes.pace, 'restrain');
  assert.equal(result.axes.voice, 'private');
  assert.deepEqual(result.unresolved, ['source']);
  assert.equal(result.basis.source.length, 0);
  assert.equal(result.confidence, 'provisional');
});

test('the flagship story result is explained by replayable authored choices, not clue totals', () => {
  const story = JSON.parse(readFileSync(new URL('../stories/蓝血-2025684191967294692.json', import.meta.url), 'utf8'));
  const selections = [
    ['chat_zhangwei', '听见她的说法，仍把自己的想法保留'],
    ['n_post_disguise', '先抄下已见事实，再删帖；给以后留一份记录'],
    ['c_answer', '照这里的常识答题，交卷时再次询问题型差别'],
    ['invest_final', '以这个假说为线索，隐去身份继续向社区提问'],
  ];
  const memo = selections.map(([sceneId, text]) => ({ kind: 'choice', sceneId, text }));
  const result = derivePersona(story, { clue_everything: 'found', resolve: 'expose' }, memo);
  assert.equal(result.code, 'ANON');
  assert.equal(result.matchedChoices, 4);
  assert.equal(result.unresolved.length, 0);
  const referenced = new Set(Object.values(result.basis).flat().map((entry) => `${entry.sceneId}|${entry.text}`));
  assert.ok(referenced.size >= 2);
  for (const reference of referenced) assert.ok(selections.some(([sceneId, text]) => reference === `${sceneId}|${text}`));
});

test('share links discard scene deep links and carry only anonymous routing fields', () => {
  const link = new URL(buildPersonaShareUrl('蓝血-01', 'CLEAN', 'https://example.test/play?scene=secret&token=nope#ending'));
  assert.equal(link.origin, 'https://example.test');
  assert.equal(link.pathname, '/play');
  assert.equal(link.searchParams.get('story'), '蓝血-01');
  assert.equal(link.searchParams.get('from'), 'persona-card');
  assert.equal(link.searchParams.get('persona'), 'CLEAN');
  assert.equal(link.searchParams.has('scene'), false);
  assert.equal(link.searchParams.has('token'), false);
  assert.equal(link.hash, '');
});
