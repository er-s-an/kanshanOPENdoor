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
    { id: `source-${source}`, text: `来源选择-${source}`, next: 'pace', personaSignals: { [source]: 1 } },
    { id: `pace-${pace}`, text: `推进选择-${pace}`, next: 'voice', personaSignals: { [pace]: 1 } },
    { id: `voice-${voice}`, text: `发声选择-${voice}`, next: 'end', personaSignals: { [voice]: 1 } },
  ];
  const story = { story: { id: 'case', title: '无剧透测试', author: '', tags: [] }, start: 'source', scenes: [
    { id: 'source', type: 'choice', choices: [choices[0]] },
    { id: 'pace', type: 'choice', choices: [choices[1]] },
    { id: 'voice', type: 'choice', choices: [choices[2]] },
    { id: 'end', type: 'ending' },
  ] };
  const memo = choices.map((choice, index) => ({ kind: 'choice', sceneId: ['source', 'pace', 'voice'][index], choiceId: choice.id, text: choice.text }));
  return { story, memo };
}

test('all eight personas are reachable from three authored, replayable choice axes', () => {
  assert.equal(Object.keys(PERSONAS).length, 8);
  for (const [code, source, pace, voice] of routes) {
    const { story, memo } = runFor(source, pace, voice);
    const first = derivePersona(story, {}, memo);
    const second = derivePersona(story, {}, structuredClone(memo));
    assert.equal(first.code, code);
    assert.equal(first.confidence, 'explicit');
    assert.deepEqual(first, second, `${code} changed for the same saved choices`);
    assert.equal(first.proofLines.length, 3);
    assert.ok(Object.values(first.basis).every((entries) => entries.length > 0));
    assert.ok(Object.values(first.basis).flat().every((entry) => memo.some((choice) => choice.sceneId === entry.sceneId && choice.choiceId === entry.choiceId && choice.text === entry.text)));
  }
});

test('stable choice ids survive copy edits while old text-only saves remain compatible', () => {
  const { story, memo } = runFor('evidence', 'push', 'public');
  const renamed = memo.map((entry) => ({ ...entry, text: `旧版文案-${entry.choiceId}` }));
  const byId = derivePersona(story, {}, renamed);
  assert.equal(byId.code, 'FIRE');
  assert.equal(byId.confidence, 'explicit');
  assert.deepEqual(Object.values(byId.basis).flat().map((entry) => entry.choiceId), memo.map((entry) => entry.choiceId));

  const legacyMemo = memo.map(({ choiceId: _choiceId, ...entry }) => entry);
  const byText = derivePersona(story, {}, legacyMemo);
  assert.equal(byText.code, 'FIRE');
  assert.equal(byText.confidence, 'explicit');
});

test('explicit signals own their axis even when legacy text and vars point elsewhere', () => {
  const { story, memo } = runFor('evidence', 'restrain', 'private');
  story.scenes[0].choices[0].text = '接受当事人证词并公开追问';
  const result = derivePersona(story, { persona_source: 'testimony', persona_pace: 'push', persona_voice: 'public' }, memo);
  assert.equal(result.code, 'CTRL');
  assert.deepEqual(result.axes, { source: 'evidence', pace: 'restrain', voice: 'private' });
  assert.equal(result.confidence, 'explicit');
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

test('the flagship story exposes three natural binary axes and all eight types are reachable', () => {
  const story = JSON.parse(readFileSync(new URL('../stories/蓝血-2025684191967294692.json', import.meta.url), 'utf8'));
  const axisScenes = {
    source: story.scenes.find((scene) => scene.id === 'chat_zhangwei'),
    pace: story.scenes.find((scene) => scene.id === 'c_answer'),
    voice: story.scenes.find((scene) => scene.id === 'n_post_disguise'),
  };
  const sides = {
    source: ['evidence', 'testimony'],
    pace: ['push', 'restrain'],
    voice: ['public', 'private'],
  };
  for (const axis of Object.keys(axisScenes)) {
    assert.equal(axisScenes[axis].choices.length, 2, `${axis} must remain a real binary decision`);
    for (const side of sides[axis]) {
      assert.ok(axisScenes[axis].choices.some((choice) => choice.personaSignals?.[side] > 0), `${axis} is missing ${side}`);
    }
  }

  const convergesAt = (choice, target) => {
    let sceneId = choice.next;
    for (let hop = 0; hop < 4; hop += 1) {
      if (sceneId === target) return true;
      const scene = story.scenes.find((candidate) => candidate.id === sceneId);
      if (!scene?.next) return false;
      sceneId = scene.next;
    }
    return false;
  };
  for (const choice of axisScenes.source.choices) assert.ok(convergesAt(choice, 'n_restroom'));
  for (const choice of axisScenes.pace.choices) assert.ok(convergesAt(choice, 'n_tail'));
  for (const choice of axisScenes.voice.choices) assert.ok(convergesAt(choice, 'n_test'));

  for (const [code, source, pace, voice] of routes) {
    const picked = [
      ['source', source], ['pace', pace], ['voice', voice],
    ].map(([axis, side]) => {
      const scene = axisScenes[axis];
      const choice = scene.choices.find((candidate) => candidate.personaSignals?.[side] > 0);
      return { kind: 'choice', sceneId: scene.id, choiceId: choice.id, text: choice.text };
    });
    const result = derivePersona(story, {
      clue_everything: 'found', resolve: code === 'FIRE' ? 'pause' : 'expose', screenshot_taken: 'yes', dwell_seconds: '9000',
    }, picked);
    assert.equal(result.code, code);
    assert.equal(result.confidence, 'explicit');
    assert.equal(result.matchedChoices, 3);
    assert.deepEqual(result.unresolved, []);
    assert.equal(result.proofLines.length, 3);
    for (const [axisIndex, [axis, entries]] of Object.entries(result.basis).entries()) {
      assert.equal(entries.length, 1, `${code}.${axis} needs one authored proof choice`);
      const proof = entries[0];
      const memoEntry = picked.find((entry) => entry.sceneId === proof.sceneId && entry.choiceId === proof.choiceId && entry.text === proof.text);
      assert.ok(memoEntry, `${code}.${axis} basis did not come from this run`);
      const authored = story.scenes.find((scene) => scene.id === proof.sceneId)?.choices?.find((choice) => choice.id === proof.choiceId);
      assert.equal(authored?.text, proof.text, `${code}.${axis} basis is not an authored choice`);
      assert.ok(result.proofLines[axisIndex].includes(proof.text.slice(0, 13)), `${code}.${axis} proof copy must quote this run's choice`);
    }
  }
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
