import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { actionLocked, applyAction, completedOutcome } from '../../game/src/lib/rules.mjs';

const OPS = new Set(['eq', 'ne', 'gte', 'lte']);
const EFFECTS = new Set(['set', 'add']);
const SCENE_TYPES = new Set(['novel', 'chat', 'choice', 'ending', 'encounter']);

function fail(message) { throw new Error(message); }
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;
const scalar = (value) => typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
function asNumber(value) {
  if (!scalar(value) || (typeof value === 'string' && !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function uniqueIds(entries, label) {
  if (!Array.isArray(entries)) fail(`${label} must be an array`);
  const ids = new Set();
  for (const entry of entries) {
    if (!record(entry) || !nonempty(entry.id)) fail(`invalid ${label} id`);
    if (ids.has(entry.id)) fail(`duplicate ${label} id: ${entry.id}`);
    ids.add(entry.id);
  }
  return ids;
}
function validateRecipe(recipe, options) {
  if (!record(recipe)) fail('recipe must be an object');
  for (const key of ['story', 'source', 'start', 'scenes', 'endings', 'initialVars']) if (!(key in recipe)) fail(`missing ${key}`);
  const sceneIds = uniqueIds(recipe.scenes, 'scene');
  uniqueIds(recipe.endings, 'ending');
  if (!sceneIds.has(recipe.start)) fail(`start references missing scene: ${recipe.start}`);
  const source = recipe.source;
  if (!record(source) || source.kind !== 'zhihu-hackathon' || !nonempty(source.workId) || !nonempty(source.title)
      || source.scope !== 'excerpt' || !(nonempty(source.author) || (source.author === '' && source.authorStatus === 'not_provided'))) fail('invalid source provenance');
  if (!record(recipe.initialVars)) fail('initialVars must be a string map');
  for (const [key, value] of Object.entries(recipe.initialVars)) {
    if (!nonempty(key) || key.startsWith('__')) fail(`initialVars uses reserved or invalid key: ${key}`);
    if (typeof value !== 'string') fail(`initialVars.${key} must be string`);
  }
  if (recipe.lore !== undefined) {
    uniqueIds(recipe.lore, 'lore');
    if (recipe.lore.some((entry) => !nonempty(entry.content))) fail('lore entries must have id and content');
  }
  // This slice explores one encounter from initialVars. It does not validate state
  // carried between encounters; reject that unsupported shape rather than imply it.
  if (recipe.scenes.filter((scene) => scene.type === 'encounter').length > 1) fail('multiple encounters are not supported by this slice');
  const reference = (value, label) => { if (!nonempty(value) || !sceneIds.has(value)) fail(`${label} references missing scene: ${value}`); };
  for (const scene of recipe.scenes) {
    if (!SCENE_TYPES.has(scene.type)) fail(`unknown scene type: ${scene.type}`);
    if (!nonempty(scene.text)) fail(`invalid scene: ${scene.id}`);
    if (scene.next !== undefined) reference(scene.next, `scene ${scene.id} next`);
    if (scene.goto !== undefined) reference(scene.goto, `scene ${scene.id} goto`);
    if (scene.choices !== undefined) {
      uniqueIds(scene.choices, 'choice');
      for (const choice of scene.choices) reference(choice.next, `choice ${choice.id} next`);
    }
    if (scene.type !== 'encounter') continue;
    const enc = scene.encounter;
    if (!record(enc) || !nonempty(enc.objective) || !Array.isArray(enc.resources) || !Array.isArray(enc.actions) || !Array.isArray(enc.outcomes)) fail(`invalid encounter: ${scene.id}`);
    const keys = new Set(Object.keys(recipe.initialVars));
    const resourceKeys = new Set();
    for (const resource of enc.resources) {
      if (!record(resource) || !keys.has(resource.key) || resourceKeys.has(resource.key)
          || !Number.isFinite(resource.min) || !Number.isFinite(resource.max) || resource.min > resource.max) fail(`invalid resource bounds or key in ${scene.id}`);
      resourceKeys.add(resource.key);
      const initial = asNumber(recipe.initialVars[resource.key]);
      if (initial === null || initial < resource.min || initial > resource.max) fail(`initial resource out of range: ${resource.key}`);
    }
    const conditions = (list, label) => {
      if (!Array.isArray(list)) fail(`invalid ${label} conditions`);
      for (const c of list) if (!record(c) || !keys.has(c.key) || !OPS.has(c.op) || !scalar(c.value)
          || (['gte', 'lte'].includes(c.op) && asNumber(c.value) === null)) fail(`invalid ${label} condition: ${c?.key}`);
    };
    uniqueIds(enc.actions, 'action');
    for (const action of enc.actions) {
      if (!nonempty(action.text) || !Array.isArray(action.effects) || (action.once !== undefined && typeof action.once !== 'boolean')) fail(`invalid action in ${scene.id}`);
      conditions(action.requires ?? [], `action ${action.id}`);
      for (const e of action.effects) {
        if (!record(e) || !keys.has(e.key) || !EFFECTS.has(e.op) || !scalar(e.value)) fail(`invalid effect ${action.id}.${e?.key}`);
        if (e.op === 'add' && asNumber(e.value) === null) fail(`non numeric add effect ${action.id}`);
      }
    }
    if (!enc.outcomes.length) fail(`encounter ${scene.id} needs an outcome`);
    uniqueIds(enc.outcomes, 'outcome');
    for (const outcome of enc.outcomes) {
      reference(outcome.next, `outcome ${outcome.id} next`);
      conditions(outcome.when ?? [], `outcome ${outcome.id}`);
    }
  }
  for (const ending of recipe.endings) {
    const scene = recipe.scenes.find((s) => s.id === ending.id);
    if (!scene || scene.type !== 'ending') fail(`ending ${ending.id} needs a matching ending scene`);
  }
  for (const scene of recipe.scenes.filter((entry) => entry.type === 'encounter')) {
    const reachability = inspectReachability(recipe, scene, recipe.initialVars, options);
    if (reachability.error) fail(`${scene.id}: ${reachability.error}`);
    for (const outcome of scene.encounter.outcomes) if (!Object.hasOwn(reachability.outcomes, outcome.id)) fail(`${scene.id}: outcome unreachable: ${outcome.id}`);
  }
  return recipe;
}

// Uses the same transaction, min/max, once and first-match outcome semantics as the UI kernel.
export function inspectReachability(story, scene, initialVars = story.initialVars ?? {}, { maxStates = 10_000 } = {}) {
  const outcomes = Object.create(null);
  if (!Number.isSafeInteger(maxStates) || maxStates < 1) return { status: 'invalid', error: 'maxStates budget must be a positive safe integer', outcomes };
  const repeatKeys = new Set(scene.encounter.actions.filter((action) => action.once === false).map((action) => `__encounter:${scene.id}:used:${action.id}`));
  // The kernel only uses these repeat counters as bookkeeping, never conditions.
  // Normalize their truth value and key order so equivalent histories share a node.
  const normalize = (vars) => Object.fromEntries(Object.keys(vars).sort().map((key) => [key, repeatKeys.has(key) && vars[key] ? '1' : vars[key]]));
  const initial = normalize(initialVars);
  const nodes = [{ vars: initial, parent: -1, action: null }];
  const seen = new Map([[JSON.stringify(initial), 0]]);
  const predecessors = [new Set()];
  const canFinish = new Set();
  const pathTo = (index, action) => {
    const path = action === undefined ? [] : [action];
    for (let cursor = index; nodes[cursor].parent !== -1; cursor = nodes[cursor].parent) path.push(nodes[cursor].action);
    return path.reverse();
  };
  for (let index = 0; index < nodes.length; index++) {
    const current = nodes[index];
    if (completedOutcome(scene, current.vars)) { canFinish.add(index); continue; }
    const available = scene.encounter.actions.filter((action) => !actionLocked(scene, action, current.vars));
    if (!available.length) {
      return { status: 'invalid', error: `reachable non-terminal state has no available action: ${pathTo(index).join(' -> ') || '(initial)'}`, outcomes };
    }
    for (const action of available) {
      const result = applyAction(scene, action.id, current.vars);
      if (!result) return { status: 'invalid', error: `kernel rejected available action: ${action.id}`, outcomes };
      if (result.outcome) {
        outcomes[result.outcome.id] ??= pathTo(index, action.id);
        canFinish.add(index);
        continue;
      }
      const vars = normalize(result.vars);
      const serial = JSON.stringify(vars);
      let nextIndex = seen.get(serial);
      if (nextIndex === undefined) {
        if (nodes.length >= maxStates) return { status: 'unknown', error: `reachability unknown: state budget exhausted (${maxStates}) before exploration completed`, outcomes, exploredStates: nodes.length };
        nextIndex = nodes.length;
        seen.set(serial, nextIndex);
        nodes.push({ vars, parent: index, action: action.id });
        predecessors.push(new Set());
      }
      predecessors[nextIndex].add(index);
    }
  }
  // Reachability permits a player-controlled loop with an exit, but not a branch
  // trapped in a closed non-terminal cycle even if another branch reached an end.
  const finishing = [...canFinish];
  for (let index = 0; index < finishing.length; index++) {
    for (const previous of predecessors[finishing[index]]) if (!canFinish.has(previous)) { canFinish.add(previous); finishing.push(previous); }
  }
  const trapped = nodes.findIndex((_, index) => !canFinish.has(index));
  if (trapped !== -1) return { status: 'invalid', error: `reachable non-terminal cycle has no path to an outcome: ${pathTo(trapped).join(' -> ') || '(initial)'}`, outcomes, exploredStates: nodes.length };
  return { status: 'complete', outcomes, exploredStates: nodes.length };
}

export function compilePlayable(recipe, options) {
  validateRecipe(recipe, options);
  return {
    version: `2.0-slice.1+${createHash('sha256').update(JSON.stringify(recipe)).digest('hex').slice(0, 12)}`,
    story: recipe.story,
    start: recipe.start,
    scenes: recipe.scenes,
    npcs: recipe.npcs ?? [],
    ...(recipe.lore ? { lore: recipe.lore } : {}),
    endings: recipe.endings,
    initialVars: recipe.initialVars,
    source: recipe.source,
    release: { status: 'preview' }
  };
}

async function main(argv) {
  const recipeIndex = argv.indexOf('--recipe'); const outIndex = argv.indexOf('--out');
  if (recipeIndex < 0 || outIndex < 0) fail('usage: node pipeline/lib/compile-playable.mjs --recipe <file> --out <file>');
  const input = path.resolve(argv[recipeIndex + 1]); const output = path.resolve(argv[outIndex + 1]);
  const recipe = JSON.parse(await fs.readFile(input, 'utf8'));
  const result = compilePlayable(recipe);
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`✓ ${path.relative(process.cwd(), output)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
