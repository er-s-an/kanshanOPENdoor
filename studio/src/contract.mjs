import { assert, codepointLength, digest, ID_RE, StudioError } from './util.mjs';
import {
  packageDigest as sharedPackageDigest,
  validateStoryPackage as sharedValidateStoryPackage,
} from '@kanshan/story-contract';

export const ACTION_CATALOG = ['inspect', 'collect', 'use', 'talk', 'choose', 'end'];
export const VALID_FACT_KINDS = ['observed', 'reported', 'hypothesis', 'unknown'];
export const VALID_PROVENANCE = ['sourced', 'adapted', 'invented'];
export const VALID_USAGE = ['private-prototype', 'authorized-public'];
export const TEMPLATE_CATALOG = ['room-v1', 'courtyard-v1'];
export const PREFAB_CATALOG = ['table-v1', 'key-v1', 'door-v1', 'note-v1', 'person-v1', 'plant-v1'];
export const RUNTIME = { engineMajor: 1, templateVersion: 1 };

/** Run the canonical package validator used by the browser Player. */
export function validateWithSharedContract(pkg) {
  const result = sharedValidateStoryPackage(pkg, { maxStates: 100_000, maxMs: 30_000 });
  if (!result.ok) {
    const first = result.diagnostics[0];
    throw new StudioError('CONTENT_INVALID', first?.message || 'shared StoryPackage validation failed', { diagnostics: result.diagnostics });
  }
  return {
    packageDigest: sharedPackageDigest(pkg),
    // The shared explorer's state keys intentionally omit raw beat IDs. The
    // package graph is still returned for Studio's compact summary; full
    // state-space evidence remains in the shared validator diagnostics.
    reachableBeats: pkg.beats.map((beat) => beat.id),
    diagnostics: result.diagnostics,
  };
}

function checkId(value, name) { assert(typeof value === 'string' && ID_RE.test(value), 'CONTENT_INVALID', `${name} must be a kebab-case id`); }
function checkText(value, name, max = 1000) { assert(typeof value === 'string' && value.trim().length > 0 && value.length <= max, 'CONTENT_INVALID', `${name} must be non-empty and <= ${max} chars`); }
function checkVec3(value, name) { assert(Array.isArray(value) && value.length === 3 && value.every((n) => Number.isFinite(n) && n >= -20 && n <= 20), 'CONTENT_INVALID', `${name} must be a bounded vec3`); }

export function validateSource(source) {
  assert(source && typeof source === 'object', 'CONTENT_INVALID', 'source is required');
  for (const key of ['id', 'title', 'author', 'digest', 'extent', 'boundary', 'usage']) checkText(source[key], `source.${key}`, key === 'boundary' ? 1000 : 200);
  checkId(source.id, 'source.id');
  assert(/^[a-f0-9]{64}$/.test(source.digest), 'CONTENT_INVALID', 'source.digest must be sha256');
  assert(Number.isInteger(source.codepointLength) && source.codepointLength > 0 && source.codepointLength <= 20_000, 'CONTENT_INVALID', 'source.codepointLength is out of range');
  assert(['excerpt', 'complete'].includes(source.extent), 'CONTENT_INVALID', 'source.extent is invalid');
  assert(VALID_USAGE.includes(source.usage), 'CONTENT_INVALID', 'source.usage is invalid');
  if (source.verifiedUrl !== undefined) assert(typeof source.verifiedUrl === 'string' && source.verifiedUrl.startsWith('https://'), 'CONTENT_INVALID', 'verifiedUrl must use https');
  return source;
}

export function validateProvenance(provenance, sourceLength) {
  assert(provenance && VALID_PROVENANCE.includes(provenance.kind), 'CONTENT_INVALID', 'invalid provenance kind');
  assert(Array.isArray(provenance.spans) && provenance.spans.length <= 8, 'CONTENT_INVALID', 'invalid provenance spans');
  for (const span of provenance.spans) {
    assert(Number.isInteger(span.start) && Number.isInteger(span.end) && span.start >= 0 && span.end > span.start && span.end <= sourceLength, 'CONTENT_INVALID', 'provenance span is out of source bounds');
  }
  if (provenance.kind !== 'invented') assert(provenance.spans.length > 0, 'CONTENT_INVALID', 'sourced/adapted content needs a source span');
}

function uniqueIds(values, label) {
  const seen = new Set();
  for (const value of values) { checkId(value, label); assert(!seen.has(value), 'CONTENT_INVALID', `duplicate ${label}: ${value}`); seen.add(value); }
}

export function validateStoryPackage(pkg, { sourceText = undefined } = {}) {
  assert(pkg && typeof pkg === 'object', 'CONTENT_INVALID', 'package must be an object');
  assert(pkg.schemaVersion === '1.0.0', 'CAPABILITY_GAP', `unsupported schemaVersion: ${pkg.schemaVersion}`);
  checkId(pkg.id, 'package.id'); checkText(pkg.title, 'package.title', 120);
  assert(pkg.runtime?.engineMajor === 1 && pkg.runtime?.templateVersion === 1, 'CAPABILITY_GAP', 'unsupported runtime/template version');
  validateSource(pkg.source);
  if (sourceText !== undefined) {
    assert(pkg.source.digest === digest(sourceText), 'CONTENT_INVALID', 'source digest does not match source text');
    assert(pkg.source.codepointLength === codepointLength(sourceText), 'CONTENT_INVALID', 'source codepointLength does not match source text');
  }
  for (const collection of ['flags', 'items', 'facts', 'scenes', 'beats']) assert(Array.isArray(pkg[collection]), 'CONTENT_INVALID', `${collection} must be an array`);
  assert(pkg.scenes.length >= 1 && pkg.scenes.length <= 2, 'CONTENT_INVALID', 'P0 supports 1-2 scenes');
  assert(pkg.beats.length >= 1 && pkg.beats.length <= 40, 'CONTENT_INVALID', 'beats must contain 1-40 entries');
  uniqueIds(pkg.flags.map((x) => x.id), 'flag.id'); uniqueIds(pkg.items.map((x) => x.id), 'item.id'); uniqueIds(pkg.facts.map((x) => x.id), 'fact.id'); uniqueIds(pkg.scenes.map((x) => x.id), 'scene.id'); uniqueIds(pkg.beats.map((x) => x.id), 'beat.id');
  const flags = new Set(pkg.flags.map((x) => x.id)); const items = new Set(pkg.items.map((x) => x.id)); const facts = new Set(pkg.facts.map((x) => x.id));
  assert(pkg.flags.length <= 8 && pkg.items.length <= 8 && pkg.facts.length <= 32, 'CONTENT_INVALID', 'package content exceeds P0 limits');
  for (const flag of pkg.flags) assert(typeof flag.initial === 'boolean', 'CONTENT_INVALID', `flag ${flag.id} initial must be boolean`);
  for (const item of pkg.items) checkText(item.label, `item ${item.id}.label`, 100);
  for (const fact of pkg.facts) { assert(VALID_FACT_KINDS.includes(fact.kind), 'CONTENT_INVALID', `fact ${fact.id} kind invalid`); checkText(fact.text, `fact ${fact.id}.text`, 1000); validateProvenance(fact.provenance, pkg.source.codepointLength); }
  const sceneIds = new Set(pkg.scenes.map((x) => x.id)); const anchors = new Map();
  for (const scene of pkg.scenes) {
    checkId(scene.id, 'scene.id'); assert(TEMPLATE_CATALOG.includes(scene.template), 'CAPABILITY_GAP', `unsupported scene template: ${scene.template}`);
    assert(scene.spawn && typeof scene.spawn === 'object', 'CONTENT_INVALID', `scene ${scene.id} spawn is required`); checkVec3(scene.spawn.position, `scene ${scene.id}.spawn.position`); assert(Number.isFinite(scene.spawn.yaw), 'CONTENT_INVALID', `scene ${scene.id}.spawn.yaw invalid`);
    assert(Array.isArray(scene.objects) && Array.isArray(scene.anchors), 'CONTENT_INVALID', `scene ${scene.id} objects/anchors must be arrays`);
    uniqueIds(scene.objects.map((x) => x.id), `scene ${scene.id} object.id`); uniqueIds(scene.anchors.map((x) => x.id), `scene ${scene.id} anchor.id`);
    for (const object of scene.objects) { assert(PREFAB_CATALOG.includes(object.prefab), 'CAPABILITY_GAP', `unsupported object prefab: ${object.prefab}`); checkVec3(object.position, `object ${object.id}.position`); assert(Number.isFinite(object.yaw) && object.yaw >= -6.284 && object.yaw <= 6.284, 'CONTENT_INVALID', `object ${object.id}.yaw invalid`); if (object.itemId) assert(items.has(object.itemId), 'CONTENT_INVALID', `object ${object.id} references unknown item`); if (object.visibleWhen) { assert(flags.has(object.visibleWhen.flagId) && typeof object.visibleWhen.value === 'boolean', 'CONTENT_INVALID', `object ${object.id} visibleWhen invalid`); } }
    for (const anchor of scene.anchors) { checkId(anchor.id, 'anchor.id'); checkVec3(anchor.position, `anchor ${anchor.id}.position`); assert(Number.isFinite(anchor.radius) && anchor.radius >= 0.5 && anchor.radius <= 1.5, 'CONTENT_INVALID', `anchor ${anchor.id}.radius invalid`); assert(typeof anchor.targetObject === 'string' && scene.objects.some((x) => x.id === anchor.targetObject), 'CONTENT_INVALID', `anchor ${anchor.id} target missing`); anchors.set(anchor.id, scene.id); }
  }
  checkId(pkg.startBeat, 'startBeat'); const beatIds = new Set(pkg.beats.map((x) => x.id)); assert(beatIds.has(pkg.startBeat), 'CONTENT_INVALID', 'startBeat does not reference a beat');
  const nextRefs = [];
  for (const beat of pkg.beats) {
    assert(sceneIds.has(beat.sceneId), 'CONTENT_INVALID', `beat ${beat.id} references unknown scene`); checkText(beat.objective, `beat ${beat.id}.objective`, 300); assert(Array.isArray(beat.entry) && Array.isArray(beat.options), 'CONTENT_INVALID', `beat ${beat.id} entry/options must be arrays`);
    validateCues(beat.entry, pkg, 'entry');
    const action = beat.action; assert(action && typeof action.kind === 'string' && ACTION_CATALOG.includes(action.kind), 'CAPABILITY_GAP', `beat ${beat.id} action is unsupported`);
    if (['inspect', 'talk'].includes(action.kind)) assert(typeof action.anchorId === 'string' && anchors.get(action.anchorId) === beat.sceneId, 'CONTENT_INVALID', `beat ${beat.id} action anchor must belong to its scene`);
    if (['collect', 'use'].includes(action.kind)) { assert(typeof action.anchorId === 'string' && anchors.get(action.anchorId) === beat.sceneId, 'CONTENT_INVALID', `beat ${beat.id} action anchor must belong to its scene`); assert(typeof action.itemId === 'string' && items.has(action.itemId), 'CONTENT_INVALID', `beat ${beat.id} action item unknown`); }
    if (['choose', 'end'].includes(action.kind)) assert(!action.anchorId && !action.itemId, 'CONTENT_INVALID', `${beat.id} ${action.kind} action cannot have anchor/item`);
    const optionIds = new Set();
    for (const option of beat.options) { checkId(option.id, `beat ${beat.id} option.id`); assert(!optionIds.has(option.id), 'CONTENT_INVALID', `duplicate option id: ${option.id}`); optionIds.add(option.id); checkText(option.label, `option ${option.id}.label`, 300); assert(Array.isArray(option.guards) && Array.isArray(option.cues) && Array.isArray(option.effects), 'CONTENT_INVALID', `option ${option.id} guards/cues/effects must be arrays`); validateGuards(option.guards, flags, items, facts); validateCues(option.cues, pkg, 'cue'); validateEffects(option.effects, flags, items, facts); if (option.next !== undefined) { checkId(option.next, `option ${option.id}.next`); nextRefs.push(option.next); } }
  }
  for (const next of nextRefs) assert(beatIds.has(next), 'CONTENT_INVALID', `option points to unknown beat ${next}`);
  const reachable = new Set(); const queue = [pkg.startBeat]; const beatsById = new Map(pkg.beats.map((x) => [x.id, x]));
  while (queue.length) { const current = queue.shift(); if (reachable.has(current)) continue; reachable.add(current); for (const option of beatsById.get(current).options) if (option.next) queue.push(option.next); }
  const unreachable = pkg.beats.filter((beat) => !reachable.has(beat.id)).map((beat) => beat.id);
  assert(unreachable.length === 0, 'CONTENT_INVALID', 'unreachable beats exist', { unreachable });
  const hasEnd = pkg.beats.some((beat) => beat.action.kind === 'end');
  assert(hasEnd, 'CONTENT_INVALID', 'package must contain an end beat');
  return { packageDigest: digest(pkg), reachableBeats: [...reachable], warnings: [] };
}

function validateCues(cues, pkg, label) { for (const cue of cues) { assert(cue && ['narration', 'dialogue'].includes(cue.kind), 'CAPABILITY_GAP', `${label} has unsupported cue`); checkText(cue.text, `${label}.text`, 2000); if (cue.kind === 'dialogue') checkText(cue.speaker, `${label}.speaker`, 100); assert(cue.provenance, 'CONTENT_INVALID', `${label} provenance is required`); validateProvenance(cue.provenance, pkg.source.codepointLength); } }
function validateGuards(guards, flags, items, facts) { for (const guard of guards) { assert(guard && ['flag', 'inventory', 'knowledge'].includes(guard.kind), 'CAPABILITY_GAP', 'unsupported guard'); assert((guard.kind === 'flag' ? flags : guard.kind === 'inventory' ? items : facts).has(guard.id), 'CONTENT_INVALID', `guard references unknown ${guard.kind}`); if (guard.kind === 'flag') assert(typeof guard.value === 'boolean' && guard.present === undefined, 'CONTENT_INVALID', 'flag guard requires value'); else assert(typeof guard.present === 'boolean' && guard.value === undefined, 'CONTENT_INVALID', 'inventory/knowledge guard requires present'); } }
function validateEffects(effects, flags, items, facts) { for (const effect of effects) { assert(effect && ['flag', 'inventory', 'knowledge'].includes(effect.kind), 'CAPABILITY_GAP', 'unsupported effect'); assert((effect.kind === 'flag' ? flags : effect.kind === 'inventory' ? items : facts).has(effect.id), 'CONTENT_INVALID', `effect references unknown ${effect.kind}`); if (effect.kind === 'flag') assert(typeof effect.value === 'boolean' && effect.present === undefined, 'CONTENT_INVALID', 'flag effect requires value'); else assert(typeof effect.present === 'boolean' && effect.value === undefined, 'CONTENT_INVALID', 'inventory/knowledge effect requires present'); } }

export function buildPackage({ sourceText, metadata, blueprint, analysis = null }) {
  let pkg = blueprint?.package || blueprint?.storyPackage || (blueprint?.schemaVersion ? blueprint : null);
  assert(pkg, 'CAPABILITY_GAP', 'blueprint must contain a canonical story package in package/storyPackage');
  pkg = JSON.parse(JSON.stringify(pkg));
  const source = {
    id: metadata.sourceId || metadata.id || pkg.source?.id || 'source',
    title: metadata.title || pkg.source?.title,
    author: metadata.author || pkg.source?.author,
    extent: metadata.extent || pkg.source?.extent || 'excerpt',
    boundary: metadata.boundary || pkg.source?.boundary,
    usage: metadata.usage || pkg.source?.usage || 'private-prototype',
    ...(metadata.verifiedUrl ? { verifiedUrl: metadata.verifiedUrl } : {}),
    digest: digest(sourceText),
    codepointLength: codepointLength(sourceText)
  };
  pkg.source = source;
  pkg.runtime = pkg.runtime || RUNTIME;
  return { package: pkg, analysis, sourceDigest: pkg.source.digest };
}
