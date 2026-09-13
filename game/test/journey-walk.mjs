// Offline player driver: uses the production rule/dialogue functions and real story data.
// It never starts a server, calls an API, or inserts a clue that an interaction did not grant.
import assert from 'node:assert/strict';
import { applyAction, applyChoice, applyEntry, completedOutcome, inspectItem, verifyEvidence } from '../src/lib/rules.mjs';
import { finishDialogue, planDialogue } from '../server/dialogue.mjs';

export const knownClues = (vars) => Object.keys(vars).filter((id) => id.startsWith('clue_') && vars[id] === 'found');
const stateKey = (sceneId, vars) => JSON.stringify([sceneId, Object.entries(vars).sort(([a], [b]) => a.localeCompare(b))]);

export function ask(story, scene, vars, request) {
  const result = finishDialogue(planDialogue(scene, { ...request, cluesFound: knownClues(vars) }), { mode: 'scripted' });
  const allowed = new Set((scene.dialogue?.topics || []).flatMap((topic) => topic.grants || []));
  const registered = new Set((story.clues || []).map((clue) => clue.id));
  for (const id of result.clues) {
    assert.ok(allowed.has(id) && registered.has(id), `${scene.id}: dialogue granted unregistered clue ${id}`);
  }
  return { ...result, vars: { ...vars, ...Object.fromEntries(result.clues.map((id) => [id, 'found'])) } };
}

// Try every available lead in the current room; a new clue may unlock another lead.
export function investigateFully(story, scene, initialVars, history = []) {
  let vars = applyEntry(story, scene.id, initialVars);
  const events = [...history];
  for (let round = 0; round <= (story.clues?.length || 0); round += 1) {
    const beforeRound = stateKey(scene.id, vars);
    const record = (kind, id, result) => {
      if (!result || stateKey(scene.id, result.vars) === stateKey(scene.id, vars)) return;
      events.push({ kind, sceneId: scene.id, id, before: vars, after: result.vars, result });
      vars = result.vars;
    };
    for (const item of scene.investigation?.items || []) {
      record('inspect', item.id, inspectItem(story, scene.id, item.id, vars));
    }
    for (const topic of scene.dialogue?.topics || []) {
      record('talk', topic.id, ask(story, scene, vars, { topicId: topic.id }));
    }
    for (const check of scene.investigation?.checks || []) {
      record('verify', check.id, verifyEvidence(story, scene.id, check.id, check.answer, vars));
    }
    if (beforeRound === stateKey(scene.id, vars)) return { vars, events };
  }
  throw new Error(`${scene.id}: collecting available leads failed to settle`);
}

// Exhaust navigation branches, retaining a real path and interaction trace for each state.
export function walkStory(story) {
  const byId = new Map(story.scenes.map((scene) => [scene.id, scene]));
  const queue = [{ sceneId: story.start, vars: { ...story.initialVars }, path: [story.start], events: [] }];
  const seen = new Set();
  const states = [];
  const endings = new Map();
  for (let index = 0; index < queue.length; index += 1) {
    assert.ok(index < 25_000, `${story.story.id}: navigation state explosion`);
    const step = queue[index];
    const scene = byId.get(step.sceneId);
    assert.ok(scene, `Missing navigation target ${step.sceneId}`);
    const filled = investigateFully(story, scene, step.vars, step.events);
    const key = stateKey(scene.id, filled.vars);
    if (seen.has(key)) continue;
    seen.add(key);
    const current = { ...step, ...filled };
    states.push(current);
    if (scene.type === 'ending') {
      if (!endings.has(scene.id)) endings.set(scene.id, current);
      continue;
    }
    if (scene.type === 'encounter') {
      const outcome = completedOutcome(scene, current.vars);
      if (outcome) {
        assert.ok(byId.has(outcome.next), `${scene.id}: unknown outcome target ${outcome.next}`);
        queue.push({ sceneId: outcome.next, vars: applyEntry(story, outcome.next, current.vars), path: [...step.path, outcome.next], events: current.events });
      } else for (const action of scene.encounter.actions) {
        const result = applyAction(scene, action.id, current.vars);
        if (!result) continue;
        queue.push({ sceneId: scene.id, vars: result.vars, path: step.path,
          events: [...current.events, { kind: 'action', sceneId: scene.id, id: action.id, before: current.vars, after: result.vars, result }] });
      }
      continue;
    }
    for (const choice of scene.choices || []) {
      const result = applyChoice(story, scene.id, choice.id, current.vars);
      if (!result) continue;
      queue.push({ sceneId: result.sceneId, vars: result.vars, path: [...step.path, result.sceneId], events: current.events });
    }
    for (const next of new Set([scene.next, scene.goto].filter(Boolean))) {
      assert.ok(byId.has(next), `${scene.id} points to unknown scene ${next}`);
      queue.push({ sceneId: next, vars: applyEntry(story, next, current.vars), path: [...step.path, next], events: current.events });
    }
  }
  return { endings, states };
}
