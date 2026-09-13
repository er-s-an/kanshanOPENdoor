import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildEvidenceGraph } from '../src/lib/evidence-map.mjs';
import { buildCounterfactual } from '../src/lib/counterfactual.mjs';

const fixture = {
  clues: [
    { id: 'clue_seen', name: '现场照片', kind: 'observation' },
    { id: 'clue_said', name: '目击者说法', kind: 'testimony' },
    { id: 'clue_claim', name: '可核对的时间线', kind: 'inference' },
    { id: 'clue_loose', name: '尚未归类的票据', kind: 'observation' },
  ],
  scenes: [
    {
      id: 'verify', chapter: '02 · 核对',
      investigation: { checks: [{ id: 'timeline', prompt: '核对时间', claim: '两条记录指向同一时段', answer: ['clue_seen', 'clue_said'], grants: ['clue_claim'], success: '只能确认时间重合，不能确认动机。' }] },
    },
    {
      id: 'choice', chapter: '03 · 发声', choices: [
        { id: 'public', text: '公开可核对事实', next: 'boss', personaSignals: { public: 1 } },
        { id: 'private', text: '先私下保存记录', next: 'boss', personaSignals: { private: 1 } },
      ],
    },
    {
      id: 'boss', boss: { question: '应该公开什么？', claims: [{ id: 'bounded', statement: '只公开已核对的时间线。' }] },
    },
  ],
};

test('关系板只连接已经解锁的核对结果，不泄露未知材料', () => {
  const hidden = buildEvidenceGraph(fixture, { clue_seen: 'found' }, []);
  assert.deepEqual(hidden.verified, []);
  assert.deepEqual(hidden.loose.map((item) => item.id), ['clue_seen']);
  assert.doesNotMatch(JSON.stringify(hidden), /目击者说法|可核对的时间线/);

  const vars = { clue_seen: 'found', clue_said: 'found', clue_claim: 'found', clue_loose: 'found' };
  const memo = [
    { kind: 'boss', sceneId: 'boss', event: 'claim-selected', claimId: 'bounded', accepted: true, consumed: false, credibility: 50, exposure: 10 },
    { kind: 'boss', sceneId: 'boss', event: 'supported', claimId: 'bounded', caseId: 'case-1', clue: 'clue_seen', result: 'supported', accepted: true, consumed: true, credibility: 70, exposure: 10, outcome: 'truth' },
  ];
  const graph = buildEvidenceGraph(fixture, vars, memo);
  assert.equal(graph.verified.length, 1);
  assert.deepEqual(graph.verified[0].evidence.map((item) => item.id), ['clue_seen', 'clue_said']);
  assert.deepEqual(graph.verified[0].conclusions.map((item) => item.id), ['clue_claim']);
  assert.equal(graph.arguments[0].claim, '只公开已核对的时间线。');
  assert.deepEqual(graph.arguments[0].evidence.map((item) => item.id), ['clue_seen']);
  assert.deepEqual(graph.loose.map((item) => item.id), ['clue_loose']);
});

test('反事实复盘来自玩家真实选择与同一已写分支', () => {
  const result = buildCounterfactual(fixture, [{ kind: 'choice', sceneId: 'choice', choiceId: 'public', text: '公开可核对事实' }]);
  assert.ok(result);
  assert.equal(result.selected, '公开可核对事实');
  assert.equal(result.alternative, '先私下保存记录');
  assert.equal(result.axisFrom, '公开发声');
  assert.equal(result.axisTo, '隐蔽留存');
  assert.match(result.note, /没有发生的结果不会被替你编出来/);
  assert.equal(buildCounterfactual(fixture, []), null);
});

test('公开论证主张是更晚的真实分歧时，优先复盘它造成的证据边界', () => {
  const story = structuredClone(fixture);
  story.scenes.find((scene) => scene.id === 'boss').boss.claims.push({
    id: 'overreach', statement: '目击者一定受幕后组织控制。', certainty: 'hypothesis', resolution: 'fold',
  });
  story.scenes.find((scene) => scene.id === 'boss').boss.claims[0].certainty = 'fact';
  const memo = [
    { kind: 'choice', sceneId: 'choice', choiceId: 'public', text: '公开可核对事实' },
    { kind: 'boss', sceneId: 'boss', event: 'claim-selected', claimId: 'overreach', accepted: true, consumed: false, credibility: 20, exposure: 50 },
  ];
  const result = buildCounterfactual(story, memo);
  assert.equal(result.sceneId, 'boss');
  assert.equal(result.axisFrom, '越界指认');
  assert.equal(result.axisTo, '事实陈述');
  assert.match(result.note, /直接改变公开论证/);
});

test('蓝血的真实关键选择能生成有出处的反事实复盘', () => {
  const story = JSON.parse(readFileSync(new URL('../stories/蓝血-2025684191967294692.json', import.meta.url), 'utf8'));
  const memo = [
    { kind: 'choice', sceneId: 'c_zhangwei', choiceId: 'zw_reserve', text: '记下她的说法，先等身体和记录互相印证' },
    { kind: 'choice', sceneId: 'n_post_disguise', choiceId: 'post_delete', text: '删掉公开帖，只把事实与疑问留在自己的记录里' },
    { kind: 'choice', sceneId: 'c_answer', choiceId: 'answer_question', text: '照这里的常识答题，交卷时再次询问题型差别' },
  ];
  const result = buildCounterfactual(story, memo);
  assert.equal(result.sceneId, 'c_answer');
  assert.equal(result.axisFrom, '继续追击');
  assert.equal(result.axisTo, '保持克制');
  assert.match(result.alternative, /暂时按这里的常识过关/);
});

test('没有新版人格标注的旧故事也能从兼容判型生成真实分支复盘', () => {
  const story = JSON.parse(readFileSync(new URL('../stories/西游之众佛腐烂-1617220591035113472.json', import.meta.url), 'utf8'));
  const selected = story.scenes.find((scene) => scene.id === 'c3').choices[2];
  const result = buildCounterfactual(story, [{ kind: 'choice', sceneId: 'c3', choiceId: selected.id, text: selected.text }]);
  assert.ok(result);
  assert.equal(result.sceneId, 'c3');
  assert.equal(result.selected, selected.text);
  assert.notEqual(result.alternative, selected.text);
  assert.match(result.note, /没有发生的结果不会被替你编出来/);
});

test('关键体验布局保留可读对话、完整证据卡与可见纸张素材', () => {
  const chatCss = readFileSync(new URL('../src/chat-ux.css', import.meta.url), 'utf8');
  const bossCss = readFileSync(new URL('../src/boss-ux.css', import.meta.url), 'utf8');
  const documentCss = readFileSync(new URL('../src/evidence-document.css', import.meta.url), 'utf8');

  assert.match(
    chatCss,
    /grid-template-rows:\s*minmax\(190px,\s*42%\)\s+minmax\(160px,\s*1fr\)\s+auto/,
    '桌面对话必须保留独立可滚动行，不能被场景图和输入框挤成零高度',
  );
  assert.match(
    bossCss,
    /\.boss__clue\s*\{[^}]*min-height:\s*312px/s,
    'Boss 证据卡必须容纳纸张缩略图、证据名称和适用边界',
  );
  assert.match(
    documentCss,
    /\.evidence-document\s*>\s*img\s*\{[^}]*z-index:\s*0/s,
    '纸张底图不能落到隔离堆叠上下文之后',
  );
  assert.match(
    documentCss,
    /\.evidence-document__content\s*\{[^}]*position:\s*relative[^}]*z-index:\s*1/s,
    '证据文字必须稳定显示在纸张底图之上',
  );
});
