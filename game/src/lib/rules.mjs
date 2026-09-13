// The same deterministic rules run in the UI and Node tests. No model output is an effect.
export const outcomeKey = (sceneId) => `__encounter:${sceneId}:outcome`;
const usedKey = (sceneId, actionId) => `__encounter:${sceneId}:used:${actionId}`;

export function matches(conditions = [], vars = {}) {
  return conditions.every(({ key, op, value }) => {
    const actual = vars[key];
    if (actual === undefined) return false;
    if (op === 'eq') return String(actual) === String(value);
    if (op === 'ne') return String(actual) !== String(value);
    if (actual === '' || !Number.isFinite(Number(actual)) || !Number.isFinite(Number(value))) return false;
    if (op === 'gte') return Number(actual) >= Number(value);
    if (op === 'lte') return Number(actual) <= Number(value);
    return false;
  });
}

export function choiceLocked(choice, vars) {
  return Object.entries(choice.requires || {}).some(([key, value]) => vars[key] !== String(value))
    ? choice.lockedHint || '还未满足这项选择的条件' : null;
}

export function applyChoice(story, sceneId, choiceId, vars) {
  const scene = story.scenes.find((s) => s.id === sceneId);
  const choice = scene?.choices?.find((c) => c.id === choiceId);
  if (!choice || choiceLocked(choice, vars) || !story.scenes.some((s) => s.id === choice.next)) return null;
  return { choice, vars: applyEntry(story, choice.next, { ...vars, ...choice.set }), sceneId: choice.next };
}

const registeredClues = (story) => new Set((story.clues || []).map((c) => c.id));

export function applyEntry(story, sceneId, vars) {
  const declared = registeredClues(story);
  const next = { ...vars };
  for (const [id, value] of Object.entries(story.scenes.find((s) => s.id === sceneId)?.onEnter || {})) {
    if (declared.has(id) && value === 'found') next[id] = 'found';
  }
  return next;
}

export function inspectItem(story, sceneId, itemId, vars) {
  const scene = story.scenes.find((s) => s.id === sceneId);
  const item = scene?.type === 'investigate' && scene.investigation?.items.find((i) => i.id === itemId);
  if (!item || !registeredClues(story).has(item.clue) || choiceLocked(item, vars)) return null;
  return { item, vars: { ...vars, [item.clue]: 'found' } };
}

// Search is deliberately narrow: a failure exposes neither candidate ids nor hidden item metadata.
// NFKC plus punctuation/space folding keeps keyboard input deterministic across full-/half-width text.
const normalizeSearchText = (value) => typeof value === 'string'
  ? value.normalize('NFKC').toLocaleLowerCase('zh-CN').replace(/[\p{P}\p{S}\s]+/gu, '')
  : '';

export function searchInvestigation(story, sceneId, query, vars, mode) {
  const needle = normalizeSearchText(query);
  if (!needle) return { status: 'empty', item: null };
  const scene = story.scenes.find((candidate) => candidate.id === sceneId);
  if (scene?.type !== 'investigate' || !scene.investigation) return { status: 'miss', item: null };
  const normalizedMode = typeof mode === 'string' ? mode : null;
  const matchesQuery = scene.investigation.items.filter((item) => {
    if (choiceLocked(item, vars)) return false;
    if (normalizedMode && item.discover?.modes?.length && !item.discover.modes.includes(normalizedMode)) return false;
    const terms = [item.title, ...(item.keywords || []), ...(item.discover?.aliases || [])]
      .map(normalizeSearchText)
      .filter(Boolean);
    return terms.some((term) => term.includes(needle) || needle.includes(term));
  });
  if (matchesQuery.length === 0) return { status: 'miss', item: null };
  if (matchesQuery.length !== 1) return { status: 'ambiguous', item: null };
  const result = inspectItem(story, sceneId, matchesQuery[0].id, vars);
  return result ? { status: 'found', item: result.item, vars: result.vars } : { status: 'miss', item: null };
}

export function verifyEvidence(story, sceneId, checkId, evidenceIds, vars) {
  const scene = story.scenes.find((s) => s.id === sceneId);
  const check = scene?.type === 'investigate' && scene.investigation?.checks.find((c) => c.id === checkId);
  const declared = registeredClues(story);
  if (!check || !Array.isArray(evidenceIds) || !evidenceIds.length
      || evidenceIds.some((id) => typeof id !== 'string' || !declared.has(id) || vars[id] !== 'found')
      || new Set(evidenceIds).size !== evidenceIds.length) return null;
  const correct = check.answer.length === evidenceIds.length && check.answer.every((id) => evidenceIds.includes(id));
  const next = { ...vars };
  if (correct) for (const id of check.grants) if (declared.has(id)) next[id] = 'found';
  return { check, correct, vars: next };
}

export function completedOutcome(scene, vars) {
  return scene.encounter?.outcomes.find((o) => o.id === vars[outcomeKey(scene.id)]) || null;
}

export function actionLocked(scene, action, vars) {
  if (!scene.encounter || !scene.encounter.actions.some((a) => a.id === action.id)) return '动作不存在';
  if (completedOutcome(scene, vars)) return '这一幕已经结束';
  if (action.once !== false && vars[usedKey(scene.id, action.id)]) return '已经做过';
  if (!matches(action.requires, vars)) return action.hint || '需要先完成前面的行动';
  // Test the complete effect transaction before charging anything (including multiple costs).
  const pending = { ...vars };
  for (const effect of action.effects) {
    if (effect.key.startsWith('__')) return '动作配置无效';
    if (effect.op === 'set') pending[effect.key] = String(effect.value);
    else if (effect.op === 'add') {
      if (pending[effect.key] === undefined || !Number.isFinite(Number(pending[effect.key])) || !Number.isFinite(Number(effect.value))) return '动作配置无效';
      pending[effect.key] = String(Number(pending[effect.key]) + Number(effect.value));
    } else return '动作配置无效';
  }
  for (const resource of scene.encounter.resources) {
    if (!Number.isFinite(Number(pending[resource.key]))) return '资源配置无效';
    if (Number(pending[resource.key]) < resource.min) return `${resource.label}不足`;
  }
  return null;
}

export function applyAction(scene, actionId, vars) {
  const action = scene.encounter?.actions.find((a) => a.id === actionId);
  if (!action || actionLocked(scene, action, vars)) return null;
  const next = { ...vars };
  for (const effect of action.effects) {
    next[effect.key] = effect.op === 'set' ? String(effect.value) : String(Number(next[effect.key]) + Number(effect.value));
  }
  for (const resource of scene.encounter.resources) {
    next[resource.key] = String(Math.min(resource.max, Number(next[resource.key])));
  }
  next[usedKey(scene.id, action.id)] = String(Number(vars[usedKey(scene.id, action.id)] || 0) + 1);
  const outcome = scene.encounter.outcomes.find((o) => matches(o.when, next)) || null;
  if (outcome) next[outcomeKey(scene.id)] = outcome.id;
  const changes = scene.encounter.resources.filter((r) => vars[r.key] !== next[r.key])
    .map((r) => ({ key: r.key, label: r.label, before: vars[r.key], after: next[r.key] }));
  return { vars: next, action, outcome, changes };
}
