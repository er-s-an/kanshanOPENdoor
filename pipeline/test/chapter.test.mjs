import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { canonicalJson, compileChapter, inspectChapterReachability, validateChapter } from '../lib/compile-chapter.mjs';

// Independent authored fixture: two encounters, a revisitable investigation hub,
// gated testimony, evidence verification, and all six supported scene types.
function chapter() {
  return {
    version: '2.2.1',
    story: { id: 'reviewed-chapter', title: '一章调查', author: '已核准作者', tags: ['调查', '章节'] },
    source: {
      kind: 'zhihu-hackathon', workId: 'official-work-id', title: '原作', author: '已核准作者',
      scope: 'excerpt', adaptationNote: '仅改编已开放原文；这是人工审过的章节。', sourceUrl: 'https://example.test/source',
      reviewedSummary: { text: '原文摘要随审过的配方一起保留。', paragraphs: [1, 4] },
    },
    release: { status: 'preview', review: 'human-reviewed' },
    initialVars: { time: '2', phase: 'new', route: 'open' },
    start: 'intro',
    scenes: [
      { id: 'intro', type: 'novel', chapter: '第一幕', text: '看到了入口。', image: '', objective: '进入现场', continueLabel: '进门', onEnter: { clue_seen: 'found' }, next: 'hub' },
      {
        id: 'hub', type: 'investigate', chapter: '查验现场', text: '核对记录与证言。', objective: '形成可核验的结论',
        investigation: {
          objective: '查看记录，然后向知情人求证。', searchPlaceholder: '找记录', hints: ['先看记录', '再问证人'],
          items: [{ id: 'record', title: '记录', keywords: ['记录'], text: '记录上的时间。', clue: 'clue_record', kind: 'record', requires: { clue_seen: 'found' } }],
          checks: [{ id: 'cross-check', prompt: '哪些资料能够相互印证？', claim: '记录与证言相符。', answer: ['clue_record', 'clue_testimony'], grants: ['clue_inference'], candidates: ['clue_record', 'clue_testimony', 'clue_seen'], success: '核验通过。', failure: '证据尚不支持。' }],
        },
        choices: [{ id: 'ask', text: '询问证人', next: 'chat' }, { id: 'proceed', text: '做决定', next: 'decision', requires: { clue_inference: 'found' }, lockedHint: '先核验结论' }],
      },
      {
        id: 'chat', type: 'chat', npc: 'witness', lore: ['local-rule'], text: '证人正在这里。', goal: '核对记录', goto: 'hub',
        dialogue: {
          topics: [{ id: 'ask-time', prompt: '记录时间准确吗？', keywords: ['记录', '时间'], reply: '当时我在场。', grants: ['clue_testimony'], requires: { clue_record: 'found' } }],
          requiredClues: ['clue_testimony'], leaveLabel: '返回现场',
        },
      },
      { id: 'decision', type: 'choice', text: '决定继续。', choices: [{ id: 'continue', text: '继续查验', next: 'first-action', set: { route: 'ready' }, requires: { clue_inference: 'found' } }] },
      {
        id: 'first-action', type: 'encounter', text: '先完成第一步。', encounter: {
          objective: '处理第一项事务', resources: [{ key: 'time', label: '时间', min: 0, max: 2, unit: '格' }],
          actions: [{ id: 'step', text: '执行第一步', hint: '准备后可执行', cost: '时间 -1', once: true, requires: [{ key: 'route', op: 'eq', value: 'ready' }], effects: [{ op: 'add', key: 'time', value: -1 }, { op: 'set', key: 'phase', value: 'first-done' }], feedback: '第一步完成。' }],
          outcomes: [{ id: 'done', when: [{ key: 'phase', op: 'eq', value: 'first-done' }], next: 'second-action', text: '进入下一幕。' }],
        },
      },
      {
        id: 'second-action', type: 'encounter', text: '再完成第二步。', encounter: {
          objective: '处理第二项事务', resources: [{ key: 'time', label: '时间', min: 0, max: 2 }],
          actions: [{ id: 'step', text: '执行第二步', hint: '第一步完成后可执行', requires: [{ key: 'phase', op: 'eq', value: 'first-done' }], effects: [{ op: 'add', key: 'time', value: -1 }, { op: 'set', key: 'phase', value: 'complete' }], feedback: '第二步完成。' }],
          outcomes: [{ id: 'done', when: [{ key: 'phase', op: 'eq', value: 'complete' }], next: 'end', text: '本章完成。' }],
        },
      },
      { id: 'end', type: 'ending', text: '本次开放片段到此为止。' },
    ],
    npcs: [{ id: 'witness', name: '证人', card: { description: '只知道现场情况。', first_mes: '你想核对什么？' } }],
    lore: [{ id: 'local-rule', content: '当前场景已知事实。' }],
    endings: [{ id: 'end', title: '完成本章', tone: '片段结局' }],
    clues: [
      { id: 'clue_seen', name: '入口情况', kind: 'observation', desc: '亲眼看到的情况', sourceLabel: '入口' },
      { id: 'clue_record', name: '记录', kind: 'observation' },
      { id: 'clue_testimony', name: '证人证言', kind: 'testimony' },
      { id: 'clue_inference', name: '交叉核验结论', kind: 'inference' },
    ],
    kanshan: { intro: '开始这一章。', rescueLines: ['返回现场核对一下。'] },
    editorialExtension: { reviewId: 'review-001', preserve: [false, null, 0, ''] },
  };
}
const scene = (recipe, id) => recipe.scenes.find((entry) => entry.id === id);
const reorderObjects = (value) => Array.isArray(value) ? value.map(reorderObjects) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).reverse().map(([key, entry]) => [key, reorderObjects(entry)])) : value;

test('packages all six scene types and multiple encounters without dropping reviewed content', () => {
  const recipe = chapter();
  const snapshot = structuredClone(recipe);
  const game = compileChapter(recipe);
  assert.deepEqual(new Set(game.scenes.map((entry) => entry.type)), new Set(['novel', 'investigate', 'chat', 'choice', 'encounter', 'ending']));
  assert.equal(game.scenes.filter((entry) => entry.type === 'encounter').length, 2);
  assert.equal(game.scenes.length, recipe.scenes.length);
  assert.deepEqual({ ...game, version: recipe.version }, recipe);
  assert.deepEqual(recipe, snapshot, 'compiling does not mutate the input');
  game.scenes[0].text = 'changed output';
  assert.equal(recipe.scenes[0].text, snapshot.scenes[0].text, 'output must not alias reviewed recipe objects');
});

test('canonical sha256 versions ignore object insertion order and are idempotent', () => {
  const recipe = chapter();
  const compiled = compileChapter(recipe);
  assert.match(compiled.version, /^2\.2\.1\+sha256\.[a-f0-9]{64}$/);
  assert.equal(compileChapter(reorderObjects(recipe)).version, compiled.version);
  assert.equal(compileChapter(compiled).version, compiled.version);
  assert.equal(canonicalJson({ b: { d: 1, c: 2 }, a: 3 }), '{"a":3,"b":{"c":2,"d":1}}');
  delete recipe.version;
  assert.match(compileChapter(recipe).version, /^2\.2\.0\+sha256\./);
  assert.match(compileChapter(recipe, { version: '2.2.7-reviewed+old.hash' }).version, /^2\.2\.7-reviewed\+sha256\./);
  assert.throws(() => compileChapter(recipe, { version: '2.0.0' }), /2\.2/);
});

test('new scene fields, source summaries and future extensions are preserved and hashed', () => {
  const baseline = compileChapter(chapter()).version;
  const changes = [
    (r) => { r.scenes[0].objective = '新目标'; },
    (r) => { r.scenes[0].continueLabel = '继续调查'; },
    (r) => { r.source.reviewedSummary.text = '更新已核准摘要'; },
    (r) => { r.editorialExtension.reviewId = 'review-002'; },
    (r) => { scene(r, 'chat').dialogue.topics[0].reply = '更新已核准证言。'; },
    (r) => { scene(r, 'hub').investigation.checks[0].candidates.reverse(); },
    (r) => { r.clues[0].sourceLabel = '门口'; },
    (r) => { r.scenes.reverse(); },
  ];
  for (const change of changes) {
    const recipe = chapter(); change(recipe);
    const result = compileChapter(recipe);
    assert.notEqual(result.version, baseline);
    assert.deepEqual({ ...result, version: recipe.version }, recipe);
  }
});

test('source authors must already be reviewed; the packager never invents an author', () => {
  const recipe = chapter();
  recipe.source.author = ''; recipe.source.authorStatus = 'not_provided'; recipe.story.author = '';
  assert.equal(compileChapter(recipe).source.author, '');
  delete recipe.source.authorStatus;
  assert.throws(() => compileChapter(recipe), /source provenance/);
  const mismatch = chapter(); mismatch.story.author = '模型猜的名字';
  assert.throws(() => compileChapter(mismatch), /source.author/);
});

test('duplicate IDs are rejected in every runtime namespace; IDs scoped to different scenes remain legal', () => {
  for (const getList of [
    (r) => r.scenes, (r) => r.npcs, (r) => r.lore, (r) => r.clues, (r) => r.endings,
    (r) => scene(r, 'hub').choices, (r) => scene(r, 'hub').investigation.items,
    (r) => scene(r, 'hub').investigation.checks, (r) => scene(r, 'chat').dialogue.topics,
    (r) => scene(r, 'first-action').encounter.actions, (r) => scene(r, 'first-action').encounter.outcomes,
  ]) {
    const recipe = chapter(); const list = getList(recipe); list.push(structuredClone(list[0]));
    assert.throws(() => compileChapter(recipe), /duplicate/);
  }
  assert.doesNotThrow(() => compileChapter(chapter()), 'two encounters may each have an action named step');
});

test('chat scenes require an existing character and lore references must exist', () => {
  for (const badNpc of [undefined, 'missing']) {
    const recipe = chapter(); if (badNpc === undefined) delete scene(recipe, 'chat').npc; else scene(recipe, 'chat').npc = badNpc;
    assert.throws(() => compileChapter(recipe), /npc/);
  }
  const recipe = chapter(); scene(recipe, 'chat').lore = ['missing'];
  assert.throws(() => compileChapter(recipe), /lore.*missing/);
});

test('all clue-bearing fields are checked against the declared whitelist', () => {
  for (const change of [
    (r) => { r.initialVars.clue_missing = 'found'; },
    (r) => { r.scenes[0].onEnter = { clue_missing: 'found' }; },
    (r) => { scene(r, 'hub').investigation.items[0].clue = 'clue_missing'; },
    (r) => { scene(r, 'hub').investigation.items[0].requires = { clue_missing: 'found' }; },
    (r) => { scene(r, 'hub').investigation.checks[0].answer = ['clue_missing']; },
    (r) => { scene(r, 'hub').investigation.checks[0].grants = ['clue_missing']; },
    (r) => { scene(r, 'hub').investigation.checks[0].candidates.push('clue_missing'); },
    (r) => { scene(r, 'chat').dialogue.topics[0].grants = ['clue_missing']; },
    (r) => { scene(r, 'chat').dialogue.topics[0].requires = { clue_missing: 'found' }; },
    (r) => { scene(r, 'chat').dialogue.requiredClues = ['clue_missing']; },
    (r) => { scene(r, 'hub').choices[1].requires = { clue_missing: 'found' }; },
    (r) => { scene(r, 'hub').choices[0].set = { clue_missing: 'found' }; },
    (r) => { scene(r, 'first-action').encounter.actions[0].effects.push({ op: 'set', key: 'clue_missing', value: 'found' }); },
    (r) => { scene(r, 'first-action').encounter.outcomes[0].when.push({ key: 'clue_missing', op: 'eq', value: 'found' }); },
    (r) => { scene(r, 'chat').clueDrops = [{ id: 'clue_missing', when: '追问时' }]; },
  ]) {
    const recipe = chapter(); change(recipe);
    assert.throws(() => compileChapter(recipe), /unregistered clue/);
  }
});

test('clue-only grants and requirements reject ignored or invalid values', () => {
  for (const change of [
    (r) => { r.scenes[0].onEnter = { route: 'ready' }; },
    (r) => { r.scenes[0].onEnter.clue_seen = 'yes'; },
    (r) => { scene(r, 'chat').dialogue.topics[0].requires = { route: 'ready' }; },
    (r) => { scene(r, 'chat').dialogue.topics[0].requires.clue_record = 'missing'; },
    (r) => { scene(r, 'hub').investigation.checks[0].candidates = ['clue_record']; },
    (r) => { scene(r, 'hub').investigation.checks[0].answer.push('clue_record'); },
  ]) {
    const recipe = chapter(); change(recipe);
    assert.throws(() => compileChapter(recipe), /clue|found|candidates|duplicate/);
  }
});

test('missing destinations and UI-ignored or ambiguous exits fail instead of being trimmed', () => {
  for (const change of [
    (r) => { r.start = 'missing'; },
    (r) => { r.scenes[0].next = 'missing'; },
    (r) => { scene(r, 'chat').goto = 'missing'; },
    (r) => { scene(r, 'hub').choices[0].next = 'missing'; },
    (r) => { scene(r, 'first-action').encounter.outcomes[0].next = 'missing'; },
    (r) => { r.scenes[0].goto = 'end'; },
    (r) => { scene(r, 'first-action').next = 'end'; },
    (r) => { delete r.scenes[0].next; },
    (r) => { scene(r, 'decision').choices = []; scene(r, 'decision').next = 'end'; },
    (r) => { scene(r, 'end').next = 'intro'; },
  ]) {
    const recipe = chapter(); change(recipe);
    assert.throws(() => compileChapter(recipe), /missing|exits|outgoing|choice needs|not rendered/);
  }
});

test('every scene must be reachable and every non-ending scene must have a path out of cycles', () => {
  const orphan = chapter(); orphan.scenes.push({ id: 'orphan', type: 'novel', next: 'end' });
  assert.throws(() => compileChapter(orphan), /orphan.*unreachable/);
  const trapped = chapter();
  scene(trapped, 'hub').choices.push({ id: 'trap', text: '进入封闭房间', next: 'loop-a' });
  trapped.scenes.push({ id: 'loop-a', type: 'novel', next: 'loop-b' }, { id: 'loop-b', type: 'novel', next: 'loop-a' });
  assert.throws(() => compileChapter(trapped), /cannot escape.*closed non-terminal cycle/);
  const noEnding = chapter(); scene(noEnding, 'end').type = 'novel'; scene(noEnding, 'end').next = 'intro'; noEnding.endings = [];
  assert.throws(() => compileChapter(noEnding), /at least one ending/);
});

test('fixed point unlocks an evidence check after returning from testimony to the hub', () => {
  const report = validateChapter(chapter());
  assert.equal(report.status, 'potentially-reachable');
  assert.equal(report.method, 'scene-dataflow-fixed-point');
  assert.equal(report.dynamicStateReachability, 'not_checked');
  assert.deepEqual(report.issues, []);
  assert.equal(report.reachableSceneIds.length, chapter().scenes.length);
  assert.ok(report.possibleCluesByScene.hub.includes('clue_inference'));
  assert.ok(report.passes > 1);
});

test('registered evidence without a reachable supplier cannot unlock a check or gate', () => {
  const recipe = chapter(); scene(recipe, 'chat').dialogue.topics[0].grants = [];
  const report = inspectChapterReachability(recipe);
  assert.equal(report.status, 'invalid');
  assert.ok(report.issues.some((issue) => /check cross-check.*no reachable supply/.test(issue)));
  assert.ok(report.issues.some((issue) => /decision is unreachable/.test(issue)));
  assert.throws(() => compileChapter(recipe), /no reachable supply/);
});

test('a clue behind its own lock is not incorrectly treated as available', () => {
  const recipe = chapter();
  scene(recipe, 'hub').investigation.items[0].requires = { clue_inference: 'found' };
  assert.throws(() => compileChapter(recipe), /no reachable supply|unreachable/);
  const selfCheck = chapter();
  scene(selfCheck, 'hub').investigation.checks[0].answer = ['clue_inference'];
  scene(selfCheck, 'hub').investigation.checks[0].candidates = ['clue_inference'];
  assert.throws(() => compileChapter(selfCheck), /check cross-check.*no reachable supply/);
});

test('unavailable optional gates are reported even if an alternate path reaches their destination', () => {
  const recipe = chapter();
  recipe.clues.push({ id: 'clue_never', name: '没有供给的线索' });
  scene(recipe, 'hub').choices.push({ id: 'bad-shortcut', text: '无证捷径', next: 'decision', requires: { clue_never: 'found' } });
  assert.throws(() => compileChapter(recipe), /choice bad-shortcut.*no reachable supply/);
});

test('forward flow does not borrow evidence from a different one-way branch', () => {
  const recipe = chapter();
  recipe.clues.push({ id: 'clue_separate', name: '另一条路上的线索' });
  recipe.scenes[0].choices = [
    { id: 'ordinary', text: '调查路线', next: 'hub' },
    { id: 'separate', text: '独立路线', next: 'separate' },
  ];
  delete recipe.scenes[0].next;
  recipe.scenes.push({ id: 'separate', type: 'novel', onEnter: { clue_separate: 'found' }, next: 'end' });
  scene(recipe, 'hub').choices[1].requires.clue_separate = 'found';
  assert.throws(() => compileChapter(recipe), /choice proceed.*no reachable supply/);
});

test('finite abstraction stays small for huge numeric ranges and does not claim dynamic proof', () => {
  const recipe = chapter();
  const enc = scene(recipe, 'first-action').encounter;
  enc.resources[0].max = 1_000_000_000;
  enc.actions.unshift({ id: 'repeat', text: '增加时间', hint: '可重复', once: false, effects: [{ op: 'add', key: 'time', value: 1 }], feedback: '时间增加。' });
  const report = validateChapter(recipe);
  assert.ok(report.passes < 20);
  assert.equal(report.dynamicStateReachability, 'not_checked');
  // Deliberately impossible cost: the packager reports its static limits instead
  // of laundering a passing finite analysis into a resource-state guarantee.
  enc.actions[1].effects[0].value = -2_000_000_000;
  const bounded = inspectChapterReachability(recipe);
  assert.equal(bounded.dynamicStateReachability, 'not_checked');
  assert.ok(bounded.limitations.some((line) => /Resource costs/.test(line)));
});

test('non-JSON values are rejected rather than silently erased during hashing', () => {
  for (const value of [undefined, NaN, Infinity, () => {}, new Date()]) {
    const recipe = chapter(); recipe.editorialExtension.bad = value;
    assert.throws(() => compileChapter(recipe), /JSON/);
  }
  const circular = chapter(); circular.editorialExtension.self = circular;
  assert.throws(() => compileChapter(circular), /circular/);
});

test('official blue and myopic chapter packages compile intact with their original story IDs', async () => {
  for (const [file, expectedId] of [
    ['蓝血-2025684191967294692.json', '蓝血-2025684191967294692'],
    ['近视眼勇闯恐怖游戏-1747681485547843585.json', '近视眼勇闯恐怖游戏-1747681485547843585'],
  ]) {
    const recipe = JSON.parse(await fs.readFile(new URL(`../../game/stories/${file}`, import.meta.url), 'utf8'));
    const packed = compileChapter(recipe);
    assert.equal(packed.story.id, expectedId);
    assert.ok(packed.scenes.length > 20, `${file} must retain its full reviewed chapter`);
    assert.deepEqual(packed.scenes, recipe.scenes);
    assert.deepEqual(packed.source, recipe.source);
    assert.deepEqual(packed.clues, recipe.clues);
    assert.deepEqual(packed.npcs, recipe.npcs);
    assert.equal(validateChapter(packed).reachableSceneIds.length, recipe.scenes.length);
  }
});

test('CLI packages a reviewed JSON file and leaves output untouched on validation failure', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kanshan-chapter-test-'));
  const cli = fileURLToPath(new URL('../steps/compile-chapter.mjs', import.meta.url));
  const input = path.join(dir, 'reviewed.json'); const output = path.join(dir, 'out', 'game.json');
  try {
    await fs.writeFile(input, JSON.stringify(chapter()));
    const result = spawnSync(process.execPath, [cli, input, output], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /7 reviewed scenes/);
    assert.match(result.stdout, /dynamic resource-state reachability not checked/);
    const packed = await fs.readFile(output, 'utf8');
    assert.deepEqual(JSON.parse(packed), compileChapter(chapter()));
    const invalid = chapter(); delete scene(invalid, 'chat').npc;
    await fs.writeFile(input, JSON.stringify(invalid));
    const failed = spawnSync(process.execPath, [cli, input, output], { encoding: 'utf8' });
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /chat requires a registered npc/);
    assert.equal(await fs.readFile(output, 'utf8'), packed);
    const missingArgs = spawnSync(process.execPath, [cli], { encoding: 'utf8' });
    assert.equal(missingArgs.status, 1);
    assert.match(missingArgs.stderr, /Usage/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
