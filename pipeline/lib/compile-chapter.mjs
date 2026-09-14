import { createHash } from 'node:crypto';

// Packages an already human-reviewed GameJson chapter. It does not plan a story,
// fetch source material, infer its author, or remove scenes to make validation pass.
const SCENE_TYPES = new Set(['novel', 'chat', 'choice', 'investigate', 'post', 'boss', 'encounter', 'ending']);
const OPS = new Set(['eq', 'ne', 'gte', 'lte']);
const CLUE_ID = /^clue_[A-Za-z0-9_]+$/;
const VERSION = /^2\.(?:2|3)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const UNKNOWN_NUMBER = Symbol('unexplored numeric state');
const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonempty = (v) => typeof v === 'string' && v.trim().length > 0;
const scalar = (v) => typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v));
const numeric = (v) => scalar(v) && String(v).trim() !== '' && Number.isFinite(Number(v));
const fail = (message) => { throw new Error(`chapter: ${message}`); };
const requireText = (v, label) => { if (!nonempty(v)) fail(`${label} must be nonempty text`); };
const optionalText = (v, label) => { if (v !== undefined && typeof v !== 'string') fail(`${label} must be text`); };

/** Canonical JSON: recursive object-key ordering; authored array order is significant. */
export function canonicalJson(value) {
  const ancestors = new Set();
  function encode(v, at) {
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return JSON.stringify(v);
    if (typeof v === 'number' && Number.isFinite(v)) return JSON.stringify(v);
    if (typeof v !== 'object' || v === null) fail(`${at} is not a JSON value`);
    if (ancestors.has(v)) fail(`${at} contains a circular reference`);
    if (!Array.isArray(v) && ![Object.prototype, null].includes(Object.getPrototypeOf(v))) fail(`${at} must be a plain JSON object`);
    ancestors.add(v);
    let result;
    if (Array.isArray(v)) {
      result = `[${Array.from({ length: v.length }, (_, i) => encode(v[i], `${at}[${i}]`)).join(',')}]`;
    } else {
      result = `{${Object.keys(v).sort().map((key) => `${JSON.stringify(key)}:${encode(v[key], `${at}.${key}`)}`).join(',')}}`;
    }
    ancestors.delete(v);
    return result;
  }
  return encode(value, 'recipe');
}

function uniqueIds(entries, label) {
  if (!Array.isArray(entries)) fail(`${label} must be an array`);
  const ids = new Set();
  for (const entry of entries) {
    if (!record(entry) || !nonempty(entry.id) || entry.id !== entry.id.trim()) fail(`invalid ${label} id`);
    if (ids.has(entry.id)) fail(`duplicate ${label} id: ${entry.id}`);
    ids.add(entry.id);
  }
  return ids;
}

function strings(entries, label, { allowEmpty = true } = {}) {
  if (!Array.isArray(entries) || (!allowEmpty && !entries.length) || entries.some((v) => !nonempty(v))) fail(`${label} must be an array of nonempty strings`);
  if (new Set(entries).size !== entries.length) fail(`duplicate reference in ${label}`);
}

function validateShape(recipe) {
  if (!record(recipe)) fail('recipe must be a GameJson object');
  canonicalJson(recipe); // Do not silently drop undefined, non-JSON values or extension fields.
  if (recipe.version !== undefined && !VERSION.test(recipe.version)) fail('version must be a 2.2.* or 2.3.* semantic version');
  if (!record(recipe.story)) fail('story is required');
  for (const key of ['id', 'title']) requireText(recipe.story[key], `story.${key}`);
  if (typeof recipe.story.author !== 'string') fail('story.author must be text');
  strings(recipe.story.tags, 'story.tags');
  const source = recipe.source;
  if (!record(source)) fail('source provenance is required; supply the reviewed source, not an API credential');
  for (const key of ['kind', 'workId', 'title', 'adaptationNote']) requireText(source[key], `source.${key}`);
  if (source.scope !== 'excerpt' || !(nonempty(source.author) || (source.author === '' && source.authorStatus === 'not_provided'))) fail('invalid source provenance: excerpt scope and reviewed author are required');
  if (source.authorStatus !== undefined && source.authorStatus !== 'not_provided') fail('invalid source.authorStatus');
  if (source.authorStatus === 'not_provided' && source.author !== '') fail('source.authorStatus contradicts source.author');
  if (recipe.story.author !== source.author) fail('story.author must match the reviewed source.author');
  optionalText(source.sourceUrl, 'source.sourceUrl');
  if (recipe.release !== undefined) {
    if (!record(recipe.release)) fail('release must be an object');
    requireText(recipe.release.status, 'release.status');
  }
  if (recipe.kanshan !== undefined) {
    if (!record(recipe.kanshan)) fail('kanshan must be an object');
    optionalText(recipe.kanshan.intro, 'kanshan.intro');
    if (recipe.kanshan.rescueLines !== undefined) strings(recipe.kanshan.rescueLines, 'kanshan.rescueLines');
  }

  const sceneIds = uniqueIds(recipe.scenes, 'scene');
  const npcIds = uniqueIds(recipe.npcs ?? [], 'npc');
  const loreIds = uniqueIds(recipe.lore ?? [], 'lore');
  const clueIds = uniqueIds(recipe.clues ?? [], 'clue');
  uniqueIds(recipe.endings ?? [], 'ending');
  if (!sceneIds.has(recipe.start)) fail(`start references missing scene: ${recipe.start}`);
  const reference = (id, ids, label) => { if (!ids.has(id)) fail(`${label} references missing ID: ${id}`); };
  const clue = (id, label) => {
    if (!CLUE_ID.test(id) || !clueIds.has(id)) fail(`${label} references an unregistered clue: ${id}`);
  };
  const clues = (list, label, allowEmpty = true) => {
    strings(list, label, { allowEmpty });
    for (const id of list) clue(id, label);
  };
  const stateKey = (key, label) => {
    if (!nonempty(key) || key.startsWith('__') || ['constructor', 'prototype'].includes(key)) fail(`${label} uses reserved or invalid state key: ${key}`);
    if (key.startsWith('clue_')) clue(key, label);
  };
  const vars = (map, label, clueOnly = false) => {
    if (!record(map)) fail(`${label} must be a string map`);
    for (const [key, value] of Object.entries(map)) {
      stateKey(key, label);
      if (typeof value !== 'string') fail(`${label}.${key} must be a string`);
      if (clueOnly || key.startsWith('clue_')) {
        clue(key, label);
        if (value !== 'found') fail(`${label}.${key} must be found`);
      }
    }
  };
  vars(recipe.initialVars ?? {}, 'initialVars');
  const stateKeys = new Set(Object.keys(recipe.initialVars ?? {}));
  for (const scene of recipe.scenes) {
    for (const choice of Array.isArray(scene.choices) ? scene.choices : []) if (record(choice.set)) for (const key of Object.keys(choice.set)) stateKeys.add(key);
    for (const action of Array.isArray(scene.encounter?.actions) ? scene.encounter.actions : []) {
      for (const effect of Array.isArray(action.effects) ? action.effects : []) if (record(effect)) stateKeys.add(effect.key);
    }
  }
  for (const id of clueIds) stateKeys.add(id);
  const requirements = (map, label, clueOnly = false) => {
    vars(map, label, clueOnly);
    for (const key of Object.keys(map)) if (!stateKeys.has(key)) fail(`${label} references undeclared state key: ${key}`);
  };
  const conditions = (list, label) => {
    if (!Array.isArray(list)) fail(`${label} must be a conditions array`);
    for (const condition of list) {
      if (!record(condition)) fail(`invalid ${label} condition`);
      stateKey(condition.key, label);
      if (!stateKeys.has(condition.key) || !OPS.has(condition.op) || !scalar(condition.value)
        || (['gte', 'lte'].includes(condition.op) && !numeric(condition.value))) fail(`invalid ${label} condition: ${condition.key}`);
      if (condition.key.startsWith('clue_') && (condition.op !== 'eq' || condition.value !== 'found')) fail(`${label} clue conditions must be eq found`);
    }
  };

  for (const npc of recipe.npcs ?? []) {
    requireText(npc.name, `npc ${npc.id}.name`);
    if (!record(npc.card)) fail(`npc ${npc.id}.card must be an object`);
    for (const key of ['description', 'personality', 'scenario', 'first_mes', 'mes_example', 'system_prompt']) optionalText(npc.card[key], `npc ${npc.id}.card.${key}`);
  }
  for (const entry of recipe.lore ?? []) requireText(entry.content, `lore ${entry.id}.content`);
  for (const entry of recipe.clues ?? []) {
    clue(entry.id, 'clues');
    requireText(entry.name, `clue ${entry.id}.name`);
    for (const key of ['desc', 'sourceLabel']) optionalText(entry[key], `clue ${entry.id}.${key}`);
    if (entry.kind !== undefined && !['observation', 'testimony', 'inference'].includes(entry.kind)) fail(`invalid clue ${entry.id}.kind`);
  }

  for (const scene of recipe.scenes) {
    const at = `scene ${scene.id}`;
    if (!SCENE_TYPES.has(scene.type)) fail(`${at} has unknown scene type: ${scene.type}`);
    for (const key of ['chapter', 'image', 'text', 'objective', 'continueLabel', 'goal']) optionalText(scene[key], `${at}.${key}`);
    if (scene.npc !== undefined) reference(scene.npc, npcIds, `${at}.npc`);
    if (scene.type === 'chat' && !npcIds.has(scene.npc)) fail(`${at}: chat requires a registered npc`);
    if (scene.lore !== undefined) {
      strings(scene.lore, `${at}.lore`);
      for (const id of scene.lore) reference(id, loreIds, `${at}.lore`);
    }
    if (scene.onEnter !== undefined) vars(scene.onEnter, `${at}.onEnter`, true);
    for (const key of ['next', 'goto']) if (scene[key] !== undefined) reference(scene[key], sceneIds, `${at}.${key}`);
    if (scene.choices !== undefined) {
      uniqueIds(scene.choices, `${at} choice`);
      for (const choice of scene.choices) {
        requireText(choice.text, `${at} choice ${choice.id}.text`);
        reference(choice.next, sceneIds, `${at} choice ${choice.id}.next`);
        if (choice.set !== undefined) vars(choice.set, `${at} choice ${choice.id}.set`);
        if (choice.requires !== undefined) requirements(choice.requires, `${at} choice ${choice.id}.requires`);
        optionalText(choice.lockedHint, `${at} choice ${choice.id}.lockedHint`);
      }
    }
    if (scene.type === 'choice' && !scene.choices?.length) fail(`${at}: choice needs at least one choice`);
    if (scene.type === 'boss') {
      if (!record(scene.boss)) fail(`${at}: boss content is required`);
      if (!record(scene.boss.endings)) fail(`${at}: boss endings are required`);
      for (const key of ['truth', 'fold']) reference(scene.boss.endings[key], sceneIds, `${at}.boss.endings.${key}`);
      if (scene.boss.egg !== undefined) {
        if (!record(scene.boss.egg)) fail(`${at}: boss egg must be an object`);
        reference(scene.boss.egg.ending, sceneIds, `${at}.boss.egg.ending`);
        clue(scene.boss.egg.clue, `${at}.boss.egg.clue`);
      }
    }
    const bossExitIds = scene.type === 'boss' ? bossEndings(scene) : [];
    const exitKinds = Number(scene.next !== undefined) + Number(scene.goto !== undefined) + Number(!!scene.choices?.length) + Number(bossExitIds.length > 0);
    if (exitKinds > 1) fail(`${at} has ambiguous exits; use one of next, goto or choices`);
    if (scene.type === 'ending' && (scene.next !== undefined || scene.goto !== undefined)) fail(`${at}: ending next/goto is not rendered`);
    if (scene.type === 'encounter' && exitKinds) fail(`${at}: encounter exits must be declared in outcomes`);
    if (!['encounter', 'boss', 'ending'].includes(scene.type) && !exitKinds) fail(`${at} has no outgoing exit`);

    if (scene.clueDrops !== undefined) {
      uniqueIds(scene.clueDrops, `${at} clueDrop`);
      if (scene.type !== 'chat') fail(`${at}: clueDrops require a chat scene`);
      for (const drop of scene.clueDrops) { clue(drop.id, `${at}.clueDrops`); requireText(drop.when, `${at}.clueDrops.when`); }
    }
    if (scene.dialogue !== undefined) {
      if (scene.type !== 'chat' || !record(scene.dialogue)) fail(`${at}: dialogue requires a chat scene`);
      uniqueIds(scene.dialogue.topics, `${at} topic`);
      optionalText(scene.dialogue.leaveLabel, `${at}.dialogue.leaveLabel`);
      if (scene.dialogue.requiredClues !== undefined) clues(scene.dialogue.requiredClues, `${at}.dialogue.requiredClues`);
      for (const topic of scene.dialogue.topics) {
        for (const key of ['prompt', 'reply']) requireText(topic[key], `${at} topic ${topic.id}.${key}`);
        strings(topic.keywords, `${at} topic ${topic.id}.keywords`);
        if (topic.grants !== undefined) clues(topic.grants, `${at} topic ${topic.id}.grants`);
        if (topic.requires !== undefined) requirements(topic.requires, `${at} topic ${topic.id}.requires`, true);
      }
    }
    if (scene.type === 'investigate' && !record(scene.investigation)) fail(`${at}: investigate requires investigation content`);
    if (scene.investigation !== undefined) {
      if (scene.type !== 'investigate' || !record(scene.investigation)) fail(`${at}: investigation requires an investigate scene`);
      const inv = scene.investigation;
      requireText(inv.objective, `${at}.investigation.objective`);
      optionalText(inv.searchPlaceholder, `${at}.investigation.searchPlaceholder`);
      strings(inv.hints, `${at}.investigation.hints`);
      uniqueIds(inv.items, `${at} item`);
      uniqueIds(inv.checks, `${at} check`);
      for (const item of inv.items) {
        for (const key of ['title', 'text']) requireText(item[key], `${at} item ${item.id}.${key}`);
        strings(item.keywords, `${at} item ${item.id}.keywords`);
        clue(item.clue, `${at} item ${item.id}.clue`);
        if (item.requires !== undefined) requirements(item.requires, `${at} item ${item.id}.requires`, true);
        if (item.kind !== undefined && !['observation', 'testimony', 'record'].includes(item.kind)) fail(`invalid ${at} item ${item.id}.kind`);
      }
      for (const check of inv.checks) {
        for (const key of ['prompt', 'claim', 'success', 'failure']) requireText(check[key], `${at} check ${check.id}.${key}`);
        clues(check.answer, `${at} check ${check.id}.answer`, false);
        clues(check.grants, `${at} check ${check.id}.grants`, false);
        if (check.candidates !== undefined) {
          clues(check.candidates, `${at} check ${check.id}.candidates`, false);
          if (check.answer.some((id) => !check.candidates.includes(id))) fail(`${at} check ${check.id}: candidates omit an answer clue`);
        }
      }
    }
    if (scene.type === 'encounter' && !record(scene.encounter)) fail(`${at}: encounter content is required`);
    if (scene.encounter !== undefined) {
      if (scene.type !== 'encounter' || !record(scene.encounter)) fail(`${at}: encounter content requires an encounter scene`);
      const enc = scene.encounter;
      requireText(enc.objective, `${at}.encounter.objective`);
      if (!Array.isArray(enc.resources)) fail(`${at}.encounter.resources must be an array`);
      const resourceKeys = new Set();
      for (const resource of enc.resources) {
        if (!record(resource)) fail(`${at}: invalid resource`);
        stateKey(resource.key, `${at} resource`);
        requireText(resource.label, `${at} resource ${resource.key}.label`);
        optionalText(resource.unit, `${at} resource ${resource.key}.unit`);
        if (resource.key.startsWith('clue_') || resourceKeys.has(resource.key) || !Number.isFinite(resource.min) || !Number.isFinite(resource.max) || resource.min > resource.max) fail(`${at}: invalid resource bounds or duplicate key: ${resource.key}`);
        resourceKeys.add(resource.key);
        const initial = recipe.initialVars?.[resource.key];
        if (!numeric(initial) || Number(initial) < resource.min || Number(initial) > resource.max) fail(`${at}: initial resource out of range: ${resource.key}`);
      }
      uniqueIds(enc.actions, `${at} action`);
      uniqueIds(enc.outcomes, `${at} outcome`);
      if (!enc.actions.length || !enc.outcomes.length) fail(`${at}: encounter needs actions and outcomes`);
      for (const action of enc.actions) {
        for (const key of ['text', 'hint', 'feedback']) requireText(action[key], `${at} action ${action.id}.${key}`);
        optionalText(action.cost, `${at} action ${action.id}.cost`);
        if (action.once !== undefined && typeof action.once !== 'boolean') fail(`${at} action ${action.id}.once must be boolean`);
        conditions(action.requires ?? [], `${at} action ${action.id}.requires`);
        if (!Array.isArray(action.effects)) fail(`${at} action ${action.id}.effects must be an array`);
        for (const effect of action.effects) {
          if (!record(effect)) fail(`${at} action ${action.id}: invalid effect`);
          stateKey(effect.key, `${at} action ${action.id}`);
          if (!['set', 'add'].includes(effect.op) || !scalar(effect.value) || (effect.op === 'add' && !numeric(effect.value))) fail(`${at} action ${action.id}: invalid effect`);
          if (effect.key.startsWith('clue_') && (effect.op !== 'set' || effect.value !== 'found')) fail(`${at} action ${action.id}: clue effects must set found`);
        }
      }
      for (const outcome of enc.outcomes) {
        requireText(outcome.text, `${at} outcome ${outcome.id}.text`);
        conditions(outcome.when, `${at} outcome ${outcome.id}.when`);
        reference(outcome.next, sceneIds, `${at} outcome ${outcome.id}.next`);
      }
    }
  }
  const endingScenes = recipe.scenes.filter((scene) => scene.type === 'ending');
  if (!endingScenes.length) fail('at least one ending scene is required');
  for (const ending of recipe.endings ?? []) {
    if (!endingScenes.some((scene) => scene.id === ending.id)) fail(`ending ${ending.id} needs a matching ending scene`);
    requireText(ending.title, `ending ${ending.id}.title`);
    optionalText(ending.tone, `ending ${ending.id}.tone`);
  }
}

function bossEndings(scene) {
  const ids = Object.values(scene.boss?.endings ?? {});
  if (scene.boss?.egg?.ending) ids.push(scene.boss.egg.ending);
  return [...new Set(ids)];
}

function edgesOf(scene) {
  if (scene.type === 'boss') return bossEndings(scene).map((next) => ({ next, label: 'boss ending' }));
  if (scene.type === 'encounter') return scene.encounter.outcomes.map((outcome) => ({ next: outcome.next, conditions: outcome.when, label: `outcome ${outcome.id}` }));
  if (scene.choices?.length) return scene.choices.map((choice) => ({ next: choice.next, requires: choice.requires, set: choice.set, label: `choice ${choice.id}` }));
  return scene.next || scene.goto ? [{ next: scene.next || scene.goto, label: 'exit' }] : [];
}

function graphIssues(recipe, edges, reachable) {
  const issues = recipe.scenes.filter((scene) => !reachable.has(scene.id)).map((scene) => `scene ${scene.id} is unreachable from start`);
  const canEnd = new Set(recipe.scenes.filter((scene) => scene.type === 'ending').map((scene) => scene.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const scene of recipe.scenes) if (!canEnd.has(scene.id) && (edges.get(scene.id) ?? []).some((edge) => canEnd.has(edge.next))) {
      canEnd.add(scene.id); changed = true;
    }
  }
  for (const scene of recipe.scenes) if (reachable.has(scene.id) && !canEnd.has(scene.id)) issues.push(`scene ${scene.id} cannot escape to an ending (closed non-terminal cycle or blocked exit)`);
  return issues;
}

const add = (state, key, value) => {
  if (!state.has(key)) state.set(key, new Set());
  const values = state.get(key);
  if (values.has(value)) return false;
  values.add(value); return true;
};
function merge(target, source) {
  let changed = false;
  for (const [key, values] of source) for (const value of values) changed = add(target, key, value) || changed;
  return changed;
}
const clone = (state) => new Map([...state].map(([key, values]) => [key, new Set(values)]));
const possible = (state, requirements = {}) => Object.entries(requirements).every(([key, value]) => state.get(key)?.has(String(value)) || state.get(key)?.has(UNKNOWN_NUMBER));
const possibleConditions = (state, conditions = []) => conditions.every(({ key, op, value }) => [...(state.get(key) ?? [])].some((actual) => {
  if (actual === UNKNOWN_NUMBER) return true;
  if (op === 'eq') return actual === String(value);
  if (op === 'ne') return actual !== String(value);
  return numeric(actual) && numeric(value) && (op === 'gte' ? Number(actual) >= Number(value) : Number(actual) <= Number(value));
}));
const hasClues = (state, ids = []) => ids.every((id) => state.get(id)?.has('found'));

function localClosure(scene, incoming) {
  const state = clone(incoming);
  for (const [id, value] of Object.entries(scene.onEnter ?? {})) add(state, id, value);
  let changed = true;
  while (changed) {
    changed = false;
    const grant = (ids) => { for (const id of ids ?? []) changed = add(state, id, 'found') || changed; };
    for (const item of scene.investigation?.items ?? []) if (possible(state, item.requires)) grant([item.clue]);
    for (const check of scene.investigation?.checks ?? []) if (hasClues(state, check.answer)) grant(check.grants);
    for (const topic of scene.dialogue?.topics ?? []) if (possible(state, topic.requires)) grant(topic.grants);
    // Legacy semantic clue drops are structurally possible, not deterministic proof.
    if (!scene.dialogue) grant(scene.clueDrops?.map((drop) => drop.id));
    for (const action of scene.encounter?.actions ?? []) if (possibleConditions(state, action.requires)) {
      for (const effect of action.effects) {
        if (effect.op === 'set') changed = add(state, effect.key, String(effect.value)) || changed;
        else if ([...(state.get(effect.key) ?? [])].some((value) => value === UNKNOWN_NUMBER || numeric(value))) changed = add(state, effect.key, UNKNOWN_NUMBER) || changed;
      }
    }
  }
  return state;
}

/** Necessary-condition analysis, not a playthrough or exhaustive resource-state BFS.
 * Each scene receives unions of possible values from its predecessors. Numeric add
 * widens to unknown; correlations, costs, once flags and first-match outcomes are
 * deliberately not proven. Failure detects missing supply; success means only
 * that this conservative static analysis found no contradiction.
 */
export function inspectChapterReachability(recipe) {
  validateShape(recipe);
  const allEdges = new Map(recipe.scenes.map((scene) => [scene.id, edgesOf(scene)]));
  const staticReached = new Set([recipe.start]);
  const queue = [recipe.start];
  for (let i = 0; i < queue.length; i++) for (const edge of allEdges.get(queue[i])) if (!staticReached.has(edge.next)) { staticReached.add(edge.next); queue.push(edge.next); }
  const structuralIssues = graphIssues(recipe, allEdges, staticReached);
  const incoming = new Map([[recipe.start, new Map(Object.entries(recipe.initialVars ?? {}).map(([key, value]) => [key, new Set([value])]))]]);
  const outgoing = new Map();
  const enabledEdges = new Map();
  let changed = true;
  let passes = 0;
  while (changed) {
    changed = false; passes++;
    for (const scene of recipe.scenes) {
      if (!incoming.has(scene.id)) continue;
      const state = localClosure(scene, incoming.get(scene.id));
      outgoing.set(scene.id, state);
      const enabled = allEdges.get(scene.id).filter((edge) => possible(state, edge.requires) && possibleConditions(state, edge.conditions));
      enabledEdges.set(scene.id, enabled);
      for (const edge of enabled) {
        const transferred = clone(state);
        // A chosen branch overwrites state; do not carry its old value past it.
        for (const [key, value] of Object.entries(edge.set ?? {})) transferred.set(key, new Set([value]));
        if (!incoming.has(edge.next)) { incoming.set(edge.next, new Map()); changed = true; }
        changed = merge(incoming.get(edge.next), transferred) || changed;
      }
    }
  }
  const issues = [...structuralIssues, ...graphIssues(recipe, enabledEdges, new Set(incoming.keys()))];
  for (const scene of recipe.scenes) {
    const state = outgoing.get(scene.id);
    if (!state) continue;
    const checkGate = (ok, label) => { if (!ok) issues.push(`scene ${scene.id} ${label}: required clues or state have no reachable supply`); };
    for (const edge of allEdges.get(scene.id)) checkGate(possible(state, edge.requires) && possibleConditions(state, edge.conditions), edge.label);
    for (const item of scene.investigation?.items ?? []) checkGate(possible(state, item.requires), `item ${item.id}`);
    for (const check of scene.investigation?.checks ?? []) checkGate(hasClues(state, check.answer), `check ${check.id}`);
    for (const topic of scene.dialogue?.topics ?? []) checkGate(possible(state, topic.requires), `topic ${topic.id}`);
    checkGate(hasClues(state, scene.dialogue?.requiredClues), 'dialogue.requiredClues');
    for (const action of scene.encounter?.actions ?? []) checkGate(possibleConditions(state, action.requires), `action ${action.id}`);
  }
  return {
    method: 'scene-dataflow-fixed-point',
    status: issues.length ? 'invalid' : 'potentially-reachable',
    dynamicStateReachability: 'not_checked',
    limitations: ['Branch correlations are merged.', 'Resource costs, bounds during play, action once flags and first-match outcomes are not exhaustively simulated.', 'Legacy semantic clue drops require dialogue runtime validation.'],
    reachableSceneIds: recipe.scenes.filter((scene) => incoming.has(scene.id)).map((scene) => scene.id),
    possibleCluesByScene: Object.fromEntries([...outgoing].map(([id, state]) => [id, [...state].filter(([key, values]) => key.startsWith('clue_') && values.has('found')).map(([key]) => key).sort()])),
    passes,
    issues: [...new Set(issues)],
  };
}

export function validateChapter(recipe) {
  const report = inspectChapterReachability(recipe);
  if (report.issues.length) fail(report.issues.join('\n'));
  return report;
}

/** Preserve every reviewed field, including source summaries and future extensions. */
export function compileChapter(recipe, { version } = {}) {
  validateChapter(recipe);
  const base = version ?? recipe.version ?? '2.2.0';
  if (typeof base !== 'string' || !VERSION.test(base)) fail('version must be a 2.2.* or 2.3.* semantic version');
  const content = JSON.parse(canonicalJson({ ...recipe, version: base.split('+')[0] }));
  const digest = createHash('sha256').update(canonicalJson(content)).digest('hex');
  return { ...content, version: `${content.version}+sha256.${digest}` };
}
