import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { compilePlayable } from '../lib/compile-playable.mjs';
import { inspectReachability } from '../lib/compile-playable.mjs';

const root = path.resolve(new URL('..', import.meta.url).pathname);
async function load(name) { return JSON.parse(await fs.readFile(path.join(root, 'recipes', name), 'utf8')); }

test('both recipes compile to the playable contract', async () => {
  for (const name of ['playable-blue.json', 'playable-myopic.json']) {
    const recipe = await load(name);
    const game = compilePlayable(recipe);
    assert.match(game.version, /^2\.0-slice\.1\+[a-f0-9]{12}$/);
    assert.equal(game.release.status, 'preview');
    assert.ok(game.scenes.some((s) => s.type === 'encounter'));
    assert.ok(game.source.workId);
    assert.deepEqual(game.lore, recipe.lore);
  }
});

test('compiler rejects missing scene references', async () => {
  const recipe = await load('playable-blue.json');
  recipe.scenes[0].next = 'missing';
  assert.throws(() => compilePlayable(recipe), /missing scene/);
});

test('compiler rejects undeclared state keys and malformed provenance', async () => {
  const recipe = await load('playable-myopic.json');
  recipe.scenes[1].encounter.actions[0].requires = [{ key: 'secret', op: 'eq', value: 'yes' }];
  assert.throws(() => compilePlayable(recipe), /condition/);
  const recipe2 = await load('playable-myopic.json');
  recipe2.source.scope = 'full';
  assert.throws(() => compilePlayable(recipe2), /provenance/);
});

test('kernel-backed reachability reports shortest action path for every outcome', async () => {
  for (const name of ['playable-blue.json', 'playable-myopic.json']) {
    const recipe = await load(name);
    const scene = recipe.scenes.find((s) => s.type === 'encounter');
    const report = inspectReachability(recipe, scene, recipe.initialVars);
    assert.equal(report.error, undefined, report.error);
    for (const outcome of scene.encounter.outcomes) {
      assert.ok(Array.isArray(report.outcomes[outcome.id]), outcome.id);
      assert.ok(report.outcomes[outcome.id].length > 0, outcome.id);
    }
  }
});

test('budget-overrun actions make a reachable state fail validation', async () => {
  const recipe = await load('playable-blue.json');
  const scene = recipe.scenes.find((s) => s.type === 'encounter');
  for (const action of scene.encounter.actions) action.effects = [{ op: 'add', key: 'time', value: -99 }];
  assert.throws(() => compilePlayable(recipe), /available action|unreachable/);
});

// These fixtures are independent of authored recipes, so validation regressions
// cannot disappear when a recipe's scenes or action balance change.
function smallRecipe() {
  return {
    story: { id: 'validation-fixture', title: '编译器测试', author: '' },
    source: { kind: 'zhihu-hackathon', workId: 'fixture-work', title: '测试原作', author: '', authorStatus: 'not_provided', scope: 'excerpt' },
    start: 'intro',
    initialVars: { progress: '0', route: 'open' },
    scenes: [
      { id: 'intro', type: 'novel', text: '进入一幕。', next: 'encounter' },
      {
        id: 'encounter', type: 'encounter', text: '做出行动。',
        encounter: {
          objective: '完成一项行动。',
          resources: [{ key: 'progress', label: '进展', min: 0, max: 20 }],
          actions: [{ id: 'finish', text: '完成', effects: [{ op: 'set', key: 'route', value: 'done' }] }],
          outcomes: [{ id: 'complete', when: [{ key: 'route', op: 'eq', value: 'done' }], next: 'end' }],
        },
      },
      { id: 'end', type: 'ending', text: '这一幕结束。' },
    ],
    endings: [{ id: 'end', title: '抵达结局' }],
  };
}

const encounterOf = (recipe) => recipe.scenes.find((scene) => scene.type === 'encounter');

function longRouteRecipe(length = 12) {
  const recipe = smallRecipe();
  const encounter = encounterOf(recipe).encounter;
  encounter.resources[0].max = length;
  encounter.actions = [{ id: 'step', text: '前进一步', once: false, effects: [{ op: 'add', key: 'progress', value: 1 }] }];
  encounter.outcomes[0].when = [{ key: 'progress', op: 'gte', value: length }];
  return recipe;
}

test('compiled versions are stable for identical content and change with recipe content', () => {
  const recipe = smallRecipe();
  recipe.npcs = [{ id: 'guide', name: '向导', card: { description: '原始角色设定' } }];
  recipe.lore = [{ id: 'world-rule', content: '原始世界规则' }];
  const originalVersion = compilePlayable(recipe).version;
  assert.match(originalVersion, /^2\.0-slice\.1\+[a-f0-9]{12}$/);
  assert.equal(compilePlayable(structuredClone(recipe)).version, originalVersion);
  for (const mutate of [
    (changed) => { changed.story.title = '修改故事标题'; },
    (changed) => { changed.scenes[0].text = '修改场景文本'; },
    (changed) => { changed.npcs[0].card.description = '修改角色设定'; },
    (changed) => { changed.lore[0].content = '修改世界规则'; },
    (changed) => { changed.initialVars.progress = '1'; },
    (changed) => { changed.editorNote = '编译输出之外的原始配方内容也参与版本'; },
  ]) {
    const changed = structuredClone(recipe);
    mutate(changed);
    assert.notEqual(compilePlayable(changed).version, originalVersion);
  }
});

test('reachability explores a repeatable path beyond the old action-count depth limit', () => {
  const recipe = longRouteRecipe();
  const report = inspectReachability(recipe, encounterOf(recipe), recipe.initialVars);
  assert.equal(report.error, undefined, report.error);
  assert.equal(report.status, 'complete');
  assert.deepEqual(report.outcomes.complete, Array(12).fill('step'));
  assert.doesNotThrow(() => compilePlayable(recipe));
});

test('state budgets fail explicitly instead of silently accepting incomplete exploration', () => {
  const recipe = longRouteRecipe();
  const scene = encounterOf(recipe);
  const incomplete = inspectReachability(recipe, scene, recipe.initialVars, { maxStates: 11 });
  assert.match(incomplete.error, /budget|unknown/i);
  assert.equal(incomplete.status, 'unknown');
  assert.throws(() => compilePlayable(recipe, { maxStates: 11 }), /budget|unknown/i);
  const complete = inspectReachability(recipe, scene, recipe.initialVars, { maxStates: 12 });
  assert.equal(complete.error, undefined, complete.error);
  assert.equal(complete.status, 'complete');
  assert.doesNotThrow(() => compilePlayable(recipe, { maxStates: 12 }));
});

test('the default reachability budget is 10000 non-terminal states', () => {
  const recipe = longRouteRecipe(10001);
  const report = inspectReachability(recipe, encounterOf(recipe), recipe.initialVars);
  assert.equal(report.status, 'unknown');
  assert.match(report.error, /budget|unknown/i);
  assert.match(report.error, /10000|10,000/);
});

test('repeatable no-op actions collapse equivalent internal usage counts', () => {
  const recipe = smallRecipe();
  const scene = encounterOf(recipe);
  scene.encounter.actions.unshift(
    { id: 'wait-a', text: '等一会', once: false, effects: [] },
    { id: 'wait-b', text: '再等一会', once: false, effects: [] },
  );
  // At most four boolean usage combinations exist; raw counters would never stop.
  const report = inspectReachability(recipe, scene, recipe.initialVars, { maxStates: 4 });
  assert.equal(report.error, undefined, report.error);
  assert.equal(report.status, 'complete');
  assert.deepEqual(report.outcomes.complete, ['finish']);
  assert.doesNotThrow(() => compilePlayable(recipe, { maxStates: 4 }));
});

test('state identity ignores object insertion order for independent once-only actions', () => {
  const recipe = smallRecipe();
  const scene = encounterOf(recipe);
  scene.encounter.actions.unshift(...['a', 'b', 'c'].map((id) => ({ id, text: `观察 ${id}`, effects: [] })));
  // Three independent once-only actions produce eight subsets, not sixteen ordered paths.
  const report = inspectReachability(recipe, scene, recipe.initialVars, { maxStates: 8 });
  assert.equal(report.error, undefined, report.error);
  assert.equal(report.status, 'complete');
  assert.deepEqual(report.outcomes.complete, ['finish']);
});

test('a reachable closed cycle is rejected even when another branch reaches an ending', () => {
  const recipe = smallRecipe();
  const scene = encounterOf(recipe);
  scene.encounter.actions[0].requires = [{ key: 'route', op: 'eq', value: 'open' }];
  scene.encounter.actions.push(
    { id: 'enter-trap', text: '走入封闭处', requires: [{ key: 'route', op: 'eq', value: 'open' }], effects: [{ op: 'set', key: 'route', value: 'trap' }] },
    { id: 'loop', text: '原地徘徊', once: false, requires: [{ key: 'route', op: 'eq', value: 'trap' }], effects: [] },
  );
  const report = inspectReachability(recipe, scene, recipe.initialVars, { maxStates: 10 });
  assert.deepEqual(report.outcomes.complete, ['finish'], 'A discovered ending does not prove every reachable state can exit');
  assert.match(report.error, /non-terminal.*cycle|closed.*cycle|cannot reach.*outcome/i);
  assert.doesNotMatch(report.error, /budget|unknown/i, 'The finite closed cycle should be conclusively rejected');
  assert.throws(() => compilePlayable(recipe), /non-terminal.*cycle|closed.*cycle|cannot reach.*outcome/i);
});

test('finding an early ending does not hide a later exhausted exploration budget', () => {
  const recipe = longRouteRecipe(12);
  const scene = encounterOf(recipe);
  scene.encounter.actions.unshift({ id: 'shortcut', text: '直接抵达', effects: [{ op: 'set', key: 'progress', value: 12 }] });
  const report = inspectReachability(recipe, scene, recipe.initialVars, { maxStates: 3 });
  assert.deepEqual(report.outcomes.complete, ['shortcut']);
  assert.match(report.error, /budget|unknown/i);
  assert.equal(report.status, 'unknown');
  assert.throws(() => compilePlayable(recipe, { maxStates: 3 }), /budget|unknown/i);
});

test('duplicate scene, action and outcome IDs are invalid', () => {
  const duplicateScene = smallRecipe();
  duplicateScene.scenes.push({ ...duplicateScene.scenes.at(-1) });
  assert.throws(() => compilePlayable(duplicateScene), /duplicate.*scene|scene.*duplicate/i);
  const duplicateAction = smallRecipe();
  const actions = encounterOf(duplicateAction).encounter.actions;
  actions.push(structuredClone(actions[0]));
  assert.throws(() => compilePlayable(duplicateAction), /duplicate.*action|action.*duplicate|invalid action/i);
  const duplicateOutcome = smallRecipe();
  const outcomes = encounterOf(duplicateOutcome).encounter.outcomes;
  outcomes.push(structuredClone(outcomes[0]));
  assert.throws(() => compilePlayable(duplicateOutcome), /duplicate.*outcome|outcome.*duplicate/i);
});

test('next, goto and choice destinations must reference actual scenes', () => {
  for (const kind of ['next', 'goto', 'choice']) {
    const recipe = smallRecipe();
    const intro = recipe.scenes[0];
    if (kind === 'choice') {
      intro.type = 'choice';
      delete intro.next;
      intro.choices = [{ id: 'missing-choice-target', text: '选择不存在的场景', next: 'missing-scene' }];
    } else intro[kind] = 'missing-scene';
    assert.throws(() => compilePlayable(recipe), /missing|reference|destination/i, kind);
  }
  const metadataOnly = smallRecipe();
  metadataOnly.endings.push({ id: 'metadata-without-scene', title: '只有元数据' });
  metadataOnly.scenes[0].next = 'metadata-without-scene';
  assert.throws(() => compilePlayable(metadataOnly), /missing|matching ending scene/i);
});

test('every ending requires a corresponding ending scene', () => {
  const missing = smallRecipe();
  missing.endings.push({ id: 'orphan-ending', title: '未定义场景' });
  assert.throws(() => compilePlayable(missing), /ending.*matching|matching ending scene|ending.*scene/i);
  const wrongType = smallRecipe();
  wrongType.scenes.at(-1).type = 'novel';
  assert.throws(() => compilePlayable(wrongType), /ending.*matching|matching ending scene|ending.*scene/i);
});

test('unknown scene types, reserved initial state and multiple encounters are rejected', () => {
  const unknownType = smallRecipe();
  unknownType.scenes[0].type = 'unknown-widget';
  assert.throws(() => compilePlayable(unknownType), /scene.*type|unknown.*scene|invalid scene/i);
  const reserved = smallRecipe();
  reserved.initialVars['__encounter:encounter:outcome'] = 'complete';
  assert.throws(() => compilePlayable(reserved), /reserved|initialVars|__/i);
  const multiple = smallRecipe();
  multiple.scenes.push({ ...structuredClone(encounterOf(multiple)), id: 'second-encounter' });
  assert.throws(() => compilePlayable(multiple), /multiple.*encounter|one encounter|single encounter|encounter.*unsupported/i);
});

test('resource bounds must be finite numbers in a valid order', () => {
  for (const [label, bounds] of [
    ['NaN minimum', { min: NaN, max: 20 }],
    ['infinite maximum', { min: 0, max: Infinity }],
    ['negative infinite minimum', { min: -Infinity, max: 20 }],
    ['string minimum', { min: '0', max: 20 }],
    ['reversed bounds', { min: 20, max: 0 }],
  ]) {
    const recipe = smallRecipe();
    Object.assign(encounterOf(recipe).encounter.resources[0], bounds);
    assert.throws(() => compilePlayable(recipe), /resource|bound/i, label);
  }
});

test('real author credits are accepted and missing credits require an explicit empty-author status', () => {
  const credited = smallRecipe();
  credited.source.author = '真实测试作者';
  delete credited.source.authorStatus;
  assert.equal(compilePlayable(credited).source.author, '真实测试作者');
  const explicitMissing = smallRecipe();
  assert.equal(compilePlayable(explicitMissing).source.author, '');
  assert.equal(compilePlayable(explicitMissing).source.authorStatus, 'not_provided');
  for (const sourceOverride of [
    { author: '', authorStatus: undefined },
    { author: undefined, authorStatus: 'not_provided' },
    { author: null, authorStatus: 'not_provided' },
    { author: ' ', authorStatus: 'not_provided' },
  ]) {
    const recipe = smallRecipe();
    Object.assign(recipe.source, sourceOverride);
    assert.throws(() => compilePlayable(recipe), /provenance|author/i);
  }
});

test('lore uses the runtime content field and rejects the incompatible text field', () => {
  const valid = smallRecipe();
  valid.lore = [{ id: 'world-rule', content: '这是角色所知的世界规则。' }];
  assert.deepEqual(compilePlayable(valid).lore, valid.lore);
  const wrongField = smallRecipe();
  wrongField.lore = [{ id: 'world-rule', text: '旧字段不会被网关读取。' }];
  assert.throws(() => compilePlayable(wrongField), /lore.*content|lore/i);
});
