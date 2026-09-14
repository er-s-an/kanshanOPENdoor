import type {
  Action,
  Anchor,
  Beat,
  Condition,
  Cue,
  Diagnostic,
  Effect,
  Option,
  Scene,
  StoryPackage,
  StoryState,
  ValidationResult,
  WorldObject,
} from "./types.js";
import { exploreStateSpace } from "./state-space.js";

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function issue(
  diagnostics: Diagnostic[],
  code: string,
  path: string,
  message: string,
  severity: Diagnostic["severity"] = "error",
  evidence?: string,
  repairHint?: string,
): void {
  diagnostics.push({ code, severity, path, message, evidence, repairHint });
}

function pointer(path: string, key: string | number): string {
  const escaped = String(key).replace(/~/g, "~0").replace(/\//g, "~1");
  return `${path}/${escaped}`;
}

function objectAt(
  value: unknown,
  path: string,
  allowed: readonly string[],
  required: readonly string[],
  diagnostics: Diagnostic[],
): RecordValue | null {
  if (!isRecord(value)) {
    issue(diagnostics, "STRUCTURE_TYPE", path, "Expected an object.");
    return null;
  }
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) {
      issue(diagnostics, "STRUCTURE_ADDITIONAL_PROPERTY", pointer(path, key), `Unknown property '${key}'.`);
    }
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      issue(diagnostics, "STRUCTURE_REQUIRED", pointer(path, key), `Missing required property '${key}'.`);
    }
  }
  return value;
}

function stringAt(
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
  min = 0,
  max = Number.POSITIVE_INFINITY,
): value is string {
  if (typeof value !== "string") {
    issue(diagnostics, "STRUCTURE_TYPE", path, "Expected a string.");
    return false;
  }
  if (value.length < min || value.length > max) {
    issue(diagnostics, "STRUCTURE_LENGTH", path, `String length must be between ${min} and ${max}.`);
    return false;
  }
  return true;
}

function boolAt(value: unknown, path: string, diagnostics: Diagnostic[]): value is boolean {
  if (typeof value !== "boolean") {
    issue(diagnostics, "STRUCTURE_TYPE", path, "Expected a boolean.");
    return false;
  }
  return true;
}

function numberAt(
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
  min = Number.NEGATIVE_INFINITY,
  max = Number.POSITIVE_INFINITY,
): value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    issue(diagnostics, "STRUCTURE_NUMBER", path, "Expected a finite number.");
    return false;
  }
  if (value < min || value > max) {
    issue(diagnostics, "STRUCTURE_RANGE", path, `Number must be between ${min} and ${max}.`);
    return false;
  }
  return true;
}

function integerAt(
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
  min = Number.MIN_SAFE_INTEGER,
  max = Number.MAX_SAFE_INTEGER,
): value is number {
  if (!Number.isInteger(value)) {
    issue(diagnostics, "STRUCTURE_INTEGER", path, "Expected an integer.");
    return false;
  }
  return numberAt(value, path, diagnostics, min, max);
}

function enumAt<T extends string>(value: unknown, allowed: readonly T[], path: string, diagnostics: Diagnostic[]): value is T {
  if (!allowed.includes(value as T)) {
    issue(diagnostics, "STRUCTURE_ENUM", path, `Expected one of: ${allowed.join(", ")}.`);
    return false;
  }
  return true;
}

function idAt(value: unknown, path: string, diagnostics: Diagnostic[]): value is string {
  if (!stringAt(value, path, diagnostics, 1, 64)) return false;
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(value)) {
    issue(diagnostics, "STRUCTURE_ID", path, "ID must match ^[a-z][a-z0-9-]{0,63}$.");
    return false;
  }
  return true;
}

function arrayAt(value: unknown, path: string, diagnostics: Diagnostic[], min: number, max: number): unknown[] | null {
  if (!Array.isArray(value)) {
    issue(diagnostics, "STRUCTURE_TYPE", path, "Expected an array.");
    return null;
  }
  if (value.length < min || value.length > max) {
    issue(diagnostics, "STRUCTURE_LENGTH", path, `Array length must be between ${min} and ${max}.`);
  }
  return value;
}

function vec3At(value: unknown, path: string, diagnostics: Diagnostic[]): void {
  const array = arrayAt(value, path, diagnostics, 3, 3);
  if (!array) return;
  for (const [index, entry] of array.entries()) numberAt(entry, pointer(path, index), diagnostics, -20, 20);
}

function checkSpan(value: unknown, path: string, diagnostics: Diagnostic[]): void {
  const record = objectAt(value, path, ["start", "end"], ["start", "end"], diagnostics);
  if (!record) return;
  integerAt(record.start, pointer(path, "start"), diagnostics, 0, 20000);
  integerAt(record.end, pointer(path, "end"), diagnostics, 1, 20000);
}

function checkProvenance(value: unknown, path: string, diagnostics: Diagnostic[]): void {
  const record = objectAt(value, path, ["kind", "spans", "note"], ["kind", "spans", "note"], diagnostics);
  if (!record) return;
  enumAt(record.kind, ["sourced", "adapted", "invented"] as const, pointer(path, "kind"), diagnostics);
  const spans = arrayAt(record.spans, pointer(path, "spans"), diagnostics, 0, 8);
  spans?.forEach((span, index) => checkSpan(span, pointer(pointer(path, "spans"), index), diagnostics));
  stringAt(record.note, pointer(path, "note"), diagnostics, 1, 1000);
  if ((record.kind === "sourced" || record.kind === "adapted") && Array.isArray(record.spans) && record.spans.length < 1) {
    issue(diagnostics, "STRUCTURE_PROVENANCE_SPAN", pointer(path, "spans"), "Sourced and adapted content requires at least one source span.");
  }
}

function checkCondition(value: unknown, path: string, diagnostics: Diagnostic[]): void {
  if (!isRecord(value)) {
    issue(diagnostics, "STRUCTURE_TYPE", path, "Condition must be an object.");
    return;
  }
  const kind = value.kind;
  if (kind === "flag") {
    const record = objectAt(value, path, ["kind", "id", "value"], ["kind", "id", "value"], diagnostics);
    if (!record) return;
    idAt(record.id, pointer(path, "id"), diagnostics);
    boolAt(record.value, pointer(path, "value"), diagnostics);
  } else if (kind === "inventory" || kind === "knowledge") {
    const record = objectAt(value, path, ["kind", "id", "present"], ["kind", "id", "present"], diagnostics);
    if (!record) return;
    idAt(record.id, pointer(path, "id"), diagnostics);
    boolAt(record.present, pointer(path, "present"), diagnostics);
  } else {
    issue(diagnostics, "STRUCTURE_CONDITION_KIND", pointer(path, "kind"), "Condition kind must be flag, inventory, or knowledge.");
  }
}

function checkCue(value: unknown, path: string, diagnostics: Diagnostic[]): void {
  const record = objectAt(value, path, ["kind", "text", "speaker", "provenance"], ["kind", "text", "provenance"], diagnostics);
  if (!record) return;
  enumAt(record.kind, ["narration", "dialogue"] as const, pointer(path, "kind"), diagnostics);
  stringAt(record.text, pointer(path, "text"), diagnostics, 1, 2000);
  checkProvenance(record.provenance, pointer(path, "provenance"), diagnostics);
  if (record.kind === "dialogue") {
    if (!Object.prototype.hasOwnProperty.call(record, "speaker")) {
      issue(diagnostics, "STRUCTURE_REQUIRED", pointer(path, "speaker"), "Dialogue requires a speaker.");
    } else stringAt(record.speaker, pointer(path, "speaker"), diagnostics, 1, 100);
  } else if (Object.prototype.hasOwnProperty.call(record, "speaker")) {
    issue(diagnostics, "STRUCTURE_ADDITIONAL_PROPERTY", pointer(path, "speaker"), "Narration cannot include a speaker.");
  }
}

function checkWorldObject(value: unknown, path: string, diagnostics: Diagnostic[]): void {
  const record = objectAt(value, path, ["id", "prefab", "position", "yaw", "itemId", "visibleWhen"], ["id", "prefab", "position", "yaw"], diagnostics);
  if (!record) return;
  idAt(record.id, pointer(path, "id"), diagnostics);
  enumAt(record.prefab, ["table-v1", "key-v1", "door-v1", "note-v1", "person-v1", "plant-v1"] as const, pointer(path, "prefab"), diagnostics);
  vec3At(record.position, pointer(path, "position"), diagnostics);
  numberAt(record.yaw, pointer(path, "yaw"), diagnostics, -6.284, 6.284);
  if (Object.prototype.hasOwnProperty.call(record, "itemId")) idAt(record.itemId, pointer(path, "itemId"), diagnostics);
  if (Object.prototype.hasOwnProperty.call(record, "visibleWhen")) {
    const visible = objectAt(record.visibleWhen, pointer(path, "visibleWhen"), ["flagId", "value"], ["flagId", "value"], diagnostics);
    if (visible) {
      idAt(visible.flagId, pointer(pointer(path, "visibleWhen"), "flagId"), diagnostics);
      boolAt(visible.value, pointer(pointer(path, "visibleWhen"), "value"), diagnostics);
    }
  }
}

function checkAnchor(value: unknown, path: string, diagnostics: Diagnostic[]): void {
  const record = objectAt(value, path, ["id", "targetObject", "position", "radius"], ["id", "targetObject", "position", "radius"], diagnostics);
  if (!record) return;
  idAt(record.id, pointer(path, "id"), diagnostics);
  idAt(record.targetObject, pointer(path, "targetObject"), diagnostics);
  vec3At(record.position, pointer(path, "position"), diagnostics);
  numberAt(record.radius, pointer(path, "radius"), diagnostics, 0.5, 1.5);
}

function checkScene(value: unknown, path: string, diagnostics: Diagnostic[]): void {
  const record = objectAt(value, path, ["id", "template", "spawn", "objects", "anchors"], ["id", "template", "spawn", "objects", "anchors"], diagnostics);
  if (!record) return;
  idAt(record.id, pointer(path, "id"), diagnostics);
  enumAt(record.template, ["room-v1", "courtyard-v1"] as const, pointer(path, "template"), diagnostics);
  const spawn = objectAt(record.spawn, pointer(path, "spawn"), ["position", "yaw"], ["position", "yaw"], diagnostics);
  if (spawn) {
    vec3At(spawn.position, pointer(pointer(path, "spawn"), "position"), diagnostics);
    numberAt(spawn.yaw, pointer(pointer(path, "spawn"), "yaw"), diagnostics, -6.284, 6.284);
  }
  const objects = arrayAt(record.objects, pointer(path, "objects"), diagnostics, 0, 32);
  objects?.forEach((object, index) => checkWorldObject(object, pointer(pointer(path, "objects"), index), diagnostics));
  const anchors = arrayAt(record.anchors, pointer(path, "anchors"), diagnostics, 0, 32);
  anchors?.forEach((anchor, index) => checkAnchor(anchor, pointer(pointer(path, "anchors"), index), diagnostics));
}

function checkAction(value: unknown, path: string, diagnostics: Diagnostic[]): void {
  if (!isRecord(value)) {
    issue(diagnostics, "STRUCTURE_TYPE", path, "Action must be an object.");
    return;
  }
  if (value.kind === "inspect" || value.kind === "talk") {
    const record = objectAt(value, path, ["kind", "anchorId"], ["kind", "anchorId"], diagnostics);
    if (record) idAt(record.anchorId, pointer(path, "anchorId"), diagnostics);
  } else if (value.kind === "collect" || value.kind === "use") {
    const record = objectAt(value, path, ["kind", "anchorId", "itemId"], ["kind", "anchorId", "itemId"], diagnostics);
    if (record) {
      idAt(record.anchorId, pointer(path, "anchorId"), diagnostics);
      idAt(record.itemId, pointer(path, "itemId"), diagnostics);
    }
  } else if (value.kind === "choose" || value.kind === "end") {
    objectAt(value, path, ["kind"], ["kind"], diagnostics);
  } else {
    issue(diagnostics, "STRUCTURE_ACTION_KIND", pointer(path, "kind"), "Action kind is unsupported.");
  }
}

function checkOption(value: unknown, path: string, diagnostics: Diagnostic[]): void {
  const record = objectAt(value, path, ["id", "label", "guards", "cues", "effects", "next"], ["id", "label", "guards", "cues", "effects", "next"], diagnostics);
  if (!record) return;
  idAt(record.id, pointer(path, "id"), diagnostics);
  stringAt(record.label, pointer(path, "label"), diagnostics, 1, 200);
  const guards = arrayAt(record.guards, pointer(path, "guards"), diagnostics, 0, 16);
  guards?.forEach((condition, index) => checkCondition(condition, pointer(pointer(path, "guards"), index), diagnostics));
  const cues = arrayAt(record.cues, pointer(path, "cues"), diagnostics, 0, 8);
  cues?.forEach((cue, index) => checkCue(cue, pointer(pointer(path, "cues"), index), diagnostics));
  const effects = arrayAt(record.effects, pointer(path, "effects"), diagnostics, 0, 16);
  effects?.forEach((effect, index) => checkCondition(effect, pointer(pointer(path, "effects"), index), diagnostics));
  idAt(record.next, pointer(path, "next"), diagnostics);
}

function checkBeat(value: unknown, path: string, diagnostics: Diagnostic[]): void {
  const record = objectAt(value, path, ["id", "sceneId", "objective", "entry", "action", "options"], ["id", "sceneId", "objective", "entry", "action", "options"], diagnostics);
  if (!record) return;
  idAt(record.id, pointer(path, "id"), diagnostics);
  idAt(record.sceneId, pointer(path, "sceneId"), diagnostics);
  stringAt(record.objective, pointer(path, "objective"), diagnostics, 1, 300);
  const entry = arrayAt(record.entry, pointer(path, "entry"), diagnostics, 0, 8);
  entry?.forEach((cue, index) => checkCue(cue, pointer(pointer(path, "entry"), index), diagnostics));
  checkAction(record.action, pointer(path, "action"), diagnostics);
  const options = arrayAt(record.options, pointer(path, "options"), diagnostics, 0, 4);
  options?.forEach((option, index) => checkOption(option, pointer(pointer(path, "options"), index), diagnostics));
  if (isRecord(record.action) && record.action.kind === "end" && Array.isArray(record.options) && record.options.length !== 0) {
    issue(diagnostics, "STRUCTURE_END_OPTIONS", pointer(path, "options"), "End beats cannot have options.");
  }
  if (isRecord(record.action) && record.action.kind === "choose" && Array.isArray(record.options) && (record.options.length < 2 || record.options.length > 4)) {
    issue(diagnostics, "STRUCTURE_CHOOSE_OPTIONS", pointer(path, "options"), "Choose beats require 2–4 options.");
  }
  if (isRecord(record.action) && ["inspect", "collect", "use", "talk"].includes(String(record.action.kind)) && Array.isArray(record.options) && record.options.length !== 1) {
    issue(diagnostics, "STRUCTURE_ACTION_OPTIONS", pointer(path, "options"), "Spatial action beats require exactly one option.");
  }
}

/** Validate only JSON shape, types, limits, and closed object boundaries. */
export function validateStructure(value: unknown): ValidationResult {
  const diagnostics: Diagnostic[] = [];
  const root = objectAt(
    value,
    "",
    ["schemaVersion", "id", "title", "runtime", "source", "flags", "items", "facts", "scenes", "startBeat", "beats"],
    ["schemaVersion", "id", "title", "runtime", "source", "flags", "items", "facts", "scenes", "startBeat", "beats"],
    diagnostics,
  );
  if (!root) return { ok: false, diagnostics };
  if (root.schemaVersion !== "1.0.0") issue(diagnostics, "STRUCTURE_SCHEMA_VERSION", "/schemaVersion", "schemaVersion must be exactly 1.0.0.");
  idAt(root.id, "/id", diagnostics);
  stringAt(root.title, "/title", diagnostics, 1, 120);
  const runtime = objectAt(root.runtime, "/runtime", ["engineMajor", "templateVersion"], ["engineMajor", "templateVersion"], diagnostics);
  if (runtime) {
    if (runtime.engineMajor !== 1) issue(diagnostics, "STRUCTURE_RUNTIME_VERSION", "/runtime/engineMajor", "engineMajor must be 1.");
    if (runtime.templateVersion !== 1) issue(diagnostics, "STRUCTURE_RUNTIME_VERSION", "/runtime/templateVersion", "templateVersion must be 1.");
  }
  const source = objectAt(root.source, "/source", ["id", "title", "author", "digest", "codepointLength", "extent", "boundary", "usage", "verifiedUrl"], ["id", "title", "author", "digest", "codepointLength", "extent", "boundary", "usage"], diagnostics);
  if (source) {
    idAt(source.id, "/source/id", diagnostics);
    stringAt(source.title, "/source/title", diagnostics, 1, 200);
    stringAt(source.author, "/source/author", diagnostics, 1, 200);
    if (!stringAt(source.digest, "/source/digest", diagnostics, 64, 64) || !/^[a-f0-9]{64}$/.test(String(source.digest))) issue(diagnostics, "STRUCTURE_DIGEST", "/source/digest", "digest must be 64 lowercase hexadecimal characters.");
    integerAt(source.codepointLength, "/source/codepointLength", diagnostics, 1, 20000);
    enumAt(source.extent, ["excerpt", "complete"] as const, "/source/extent", diagnostics);
    stringAt(source.boundary, "/source/boundary", diagnostics, 1, 1000);
    enumAt(source.usage, ["private-prototype", "authorized-public"] as const, "/source/usage", diagnostics);
    if (Object.prototype.hasOwnProperty.call(source, "verifiedUrl") && (!stringAt(source.verifiedUrl, "/source/verifiedUrl", diagnostics, 1, 2048) || !source.verifiedUrl.startsWith("https://"))) issue(diagnostics, "STRUCTURE_URL", "/source/verifiedUrl", "verifiedUrl must start with https://.");
  }

  const flags = arrayAt(root.flags, "/flags", diagnostics, 0, 8);
  flags?.forEach((flag, index) => {
    const path = pointer("/flags", index);
    const record = objectAt(flag, path, ["id", "initial"], ["id", "initial"], diagnostics);
    if (record) { idAt(record.id, pointer(path, "id"), diagnostics); boolAt(record.initial, pointer(path, "initial"), diagnostics); }
  });
  const items = arrayAt(root.items, "/items", diagnostics, 0, 8);
  items?.forEach((item, index) => {
    const path = pointer("/items", index);
    const record = objectAt(item, path, ["id", "label"], ["id", "label"], diagnostics);
    if (record) { idAt(record.id, pointer(path, "id"), diagnostics); stringAt(record.label, pointer(path, "label"), diagnostics, 1, 100); }
  });
  const facts = arrayAt(root.facts, "/facts", diagnostics, 0, 32);
  facts?.forEach((fact, index) => {
    const path = pointer("/facts", index);
    const record = objectAt(fact, path, ["id", "kind", "text", "provenance"], ["id", "kind", "text", "provenance"], diagnostics);
    if (record) { idAt(record.id, pointer(path, "id"), diagnostics); enumAt(record.kind, ["observed", "reported", "hypothesis", "unknown"] as const, pointer(path, "kind"), diagnostics); stringAt(record.text, pointer(path, "text"), diagnostics, 1, 1000); checkProvenance(record.provenance, pointer(path, "provenance"), diagnostics); }
  });
  const scenes = arrayAt(root.scenes, "/scenes", diagnostics, 1, 2);
  scenes?.forEach((scene, index) => checkScene(scene, pointer("/scenes", index), diagnostics));
  idAt(root.startBeat, "/startBeat", diagnostics);
  const beats = arrayAt(root.beats, "/beats", diagnostics, 1, 40);
  beats?.forEach((beat, index) => checkBeat(beat, pointer("/beats", index), diagnostics));
  return { ok: !diagnostics.some((diagnostic) => diagnostic.severity === "error"), diagnostics };
}

function duplicateIds(values: readonly unknown[], path: string, diagnostics: Diagnostic[]): void {
  const seen = new Map<string, number>();
  values.forEach((value, index) => {
    if (!isRecord(value) || typeof value.id !== "string") return;
    const previous = seen.get(value.id);
    if (previous !== undefined) issue(diagnostics, "SEMANTIC_DUPLICATE_ID", pointer(pointer(path, index), "id"), `Duplicate id '${value.id}'.`, "error", `first occurrence at ${pointer(pointer(path, previous), "id")}`);
    else seen.set(value.id, index);
  });
}

function ids(values: readonly { id: string }[]): Set<string> {
  return new Set(values.map((value) => value.id));
}

function conditionKey(condition: Condition): string {
  return `${condition.kind}:${condition.id}`;
}

function hasCondition(conditions: readonly Condition[], expected: Condition): boolean {
  return conditions.some((condition) => {
    if (condition.kind !== expected.kind || condition.id !== expected.id) return false;
    if (condition.kind === "flag" && expected.kind === "flag") return condition.value === expected.value;
    if (condition.kind !== "flag" && expected.kind !== "flag") return condition.present === expected.present;
    return false;
  });
}

function checkConditionRefs(condition: Condition, path: string, flagIds: Set<string>, itemIds: Set<string>, factIds: Set<string>, diagnostics: Diagnostic[]): void {
  if (condition.kind === "flag" && !flagIds.has(condition.id)) issue(diagnostics, "SEMANTIC_UNKNOWN_FLAG", pointer(path, "id"), `Flag '${condition.id}' is not declared.`);
  if (condition.kind === "inventory" && !itemIds.has(condition.id)) issue(diagnostics, "SEMANTIC_UNKNOWN_ITEM", pointer(path, "id"), `Item '${condition.id}' is not declared.`);
  if (condition.kind === "knowledge" && !factIds.has(condition.id)) issue(diagnostics, "SEMANTIC_UNKNOWN_FACT", pointer(path, "id"), `Fact '${condition.id}' is not declared.`);
}

function checkSceneSemantics(scene: Scene, sceneIndex: number, flagIds: Set<string>, itemIds: Set<string>, diagnostics: Diagnostic[]): void {
  const scenePath = pointer("/scenes", sceneIndex);
  duplicateIds(scene.objects, pointer(scenePath, "objects"), diagnostics);
  duplicateIds(scene.anchors, pointer(scenePath, "anchors"), diagnostics);
  const objectIds = ids(scene.objects);
  scene.objects.forEach((object, index) => {
    const path = pointer(pointer(scenePath, "objects"), index);
    if (object.itemId) {
      if (!itemIds.has(object.itemId)) issue(diagnostics, "SEMANTIC_UNKNOWN_ITEM", pointer(path, "itemId"), `Object item '${object.itemId}' is not declared.`);
    }
    if (object.visibleWhen && !flagIds.has(object.visibleWhen.flagId)) issue(diagnostics, "SEMANTIC_UNKNOWN_FLAG", pointer(pointer(path, "visibleWhen"), "flagId"), `Visibility flag '${object.visibleWhen.flagId}' is not declared.`);
  });
  const anchorIds = ids(scene.anchors);
  scene.anchors.forEach((anchor, index) => {
    const path = pointer(pointer(scenePath, "anchors"), index);
    if (!objectIds.has(anchor.targetObject)) issue(diagnostics, "SEMANTIC_UNKNOWN_OBJECT", pointer(path, "targetObject"), `Anchor target '${anchor.targetObject}' is not declared in this scene.`);
    if (anchor.position[1] !== 0) issue(diagnostics, "SEMANTIC_ANCHOR_HEIGHT", pointer(path, "position"), "P0 anchor positions must be on the ground (Y=0).");
  });
  if (scene.spawn.position[1] < 0 || scene.spawn.position[1] > 20) issue(diagnostics, "SEMANTIC_SPAWN_HEIGHT", pointer(pointer(scenePath, "spawn"), "position"), "Spawn eye height is outside the supported template range.", "warning");
  void anchorIds;
}

function checkBeatSemantics(
  beat: Beat,
  beatIndex: number,
  sceneIds: Set<string>,
  beatIds: Set<string>,
  flagIds: Set<string>,
  itemIds: Set<string>,
  factIds: Set<string>,
  scenesById: Map<string, Scene>,
  diagnostics: Diagnostic[],
): void {
  const beatPath = pointer("/beats", beatIndex);
  if (!sceneIds.has(beat.sceneId)) issue(diagnostics, "SEMANTIC_UNKNOWN_SCENE", pointer(beatPath, "sceneId"), `Scene '${beat.sceneId}' is not declared.`);
  const scene = scenesById.get(beat.sceneId);
  const anchorsById = new Map(scene?.anchors.map((anchor) => [anchor.id, anchor]) ?? []);
  const objectsById = new Map(scene?.objects.map((object) => [object.id, object]) ?? []);
  const action = beat.action;
  if (action.kind !== "choose" && action.kind !== "end") {
    const anchorId = action.anchorId;
    if (!anchorsById.has(anchorId)) issue(diagnostics, "SEMANTIC_UNKNOWN_ANCHOR", pointer(pointer(beatPath, "action"), "anchorId"), `Anchor '${anchorId}' is not declared in scene '${beat.sceneId}'.`);
  }
  if ((action.kind === "collect" || action.kind === "use") && !itemIds.has(action.itemId)) issue(diagnostics, "SEMANTIC_UNKNOWN_ITEM", pointer(pointer(beatPath, "action"), "itemId"), `Action item '${action.itemId}' is not declared.`);
  if (action.kind === "collect") {
    const anchor = anchorsById.get(action.anchorId);
    const object = anchor ? objectsById.get(anchor.targetObject) : undefined;
    if (!object?.itemId || object.itemId !== action.itemId) issue(diagnostics, "SEMANTIC_COLLECT_TARGET", pointer(pointer(beatPath, "action"), "itemId"), "Collect action must target an anchor whose object has the same itemId.");
  }
  if (action.kind === "use" && !beat.options.some((option) => hasCondition(option.guards, { kind: "inventory", id: action.itemId, present: true }))) {
    issue(diagnostics, "SEMANTIC_USE_GUARD", beatPath, "Use action requires an inventory-present guard for its item.");
  }
  const optionIds = new Set<string>();
  beat.options.forEach((option, optionIndex) => {
    const optionPath = pointer(pointer(beatPath, "options"), optionIndex);
    if (optionIds.has(option.id)) issue(diagnostics, "SEMANTIC_DUPLICATE_OPTION_ID", pointer(optionPath, "id"), `Duplicate option id '${option.id}' in beat.`);
    optionIds.add(option.id);
    option.guards.forEach((condition, index) => checkConditionRefs(condition, pointer(pointer(optionPath, "guards"), index), flagIds, itemIds, factIds, diagnostics));
    option.effects.forEach((effect, index) => checkConditionRefs(effect, pointer(pointer(optionPath, "effects"), index), flagIds, itemIds, factIds, diagnostics));
    const effectsByKey = new Map<string, Effect>();
    option.effects.forEach((effect, index) => {
      const key = conditionKey(effect);
      const old = effectsByKey.get(key);
      if (old) {
        const oldValue = old.kind === "flag" ? old.value : old.present;
        const newValue = effect.kind === "flag" ? effect.value : effect.present;
        issue(diagnostics, "SEMANTIC_DUPLICATE_EFFECT", pointer(pointer(optionPath, "effects"), index), `Effect '${key}' is assigned more than once.`, "error", `previous value was ${String(oldValue)}; current value is ${String(newValue)}`);
      } else effectsByKey.set(key, effect);
    });
    if (!beatIds.has(option.next)) issue(diagnostics, "SEMANTIC_UNKNOWN_NEXT_BEAT", pointer(optionPath, "next"), `Next beat '${option.next}' is not declared.`);
    if (action.kind === "collect" && !hasCondition(option.effects, { kind: "inventory", id: action.itemId, present: true })) {
      issue(diagnostics, "SEMANTIC_COLLECT_EFFECT", pointer(optionPath, "effects"), "Collect action's option must explicitly add its item to inventory.");
    }
  });
}

/** Validate cross references and deterministic runtime semantics. */
export function validateSemantics(pkg: StoryPackage): ValidationResult {
  const diagnostics: Diagnostic[] = [];
  duplicateIds(pkg.flags, "/flags", diagnostics);
  duplicateIds(pkg.items, "/items", diagnostics);
  duplicateIds(pkg.facts, "/facts", diagnostics);
  duplicateIds(pkg.scenes, "/scenes", diagnostics);
  duplicateIds(pkg.beats, "/beats", diagnostics);
  const flagIds = ids(pkg.flags);
  const itemIds = ids(pkg.items);
  const factIds = ids(pkg.facts);
  const sceneIds = ids(pkg.scenes);
  const beatIds = ids(pkg.beats);
  const scenesById = new Map(pkg.scenes.map((scene) => [scene.id, scene]));
  if (!beatIds.has(pkg.startBeat)) issue(diagnostics, "SEMANTIC_UNKNOWN_START_BEAT", "/startBeat", `Start beat '${pkg.startBeat}' is not declared.`);
  pkg.facts.forEach((fact, index) => fact.provenance.spans.forEach((span, spanIndex) => {
    const path = pointer(pointer(pointer(pointer("/facts", index), "provenance"), "spans"), spanIndex);
    if (span.start >= span.end) issue(diagnostics, "SEMANTIC_INVALID_SPAN", path, "Source span must have start < end.");
    if (span.end > pkg.source.codepointLength) issue(diagnostics, "SEMANTIC_SPAN_OUT_OF_RANGE", path, "Source span exceeds source codepointLength.");
  }));
  pkg.scenes.forEach((scene, index) => checkSceneSemantics(scene, index, flagIds, itemIds, diagnostics));
  const collectibleObjects = new Map<string, string[]>();
  pkg.scenes.forEach((scene, sceneIndex) => scene.objects.forEach((object, objectIndex) => {
    if (!object.itemId) return;
    const locations = collectibleObjects.get(object.itemId) ?? [];
    locations.push(pointer(pointer(pointer("/scenes", sceneIndex), "objects"), objectIndex));
    collectibleObjects.set(object.itemId, locations);
  }));
  for (const [itemId, locations] of collectibleObjects) {
    if (locations.length > 1) issue(diagnostics, "SEMANTIC_DUPLICATE_ITEM_OBJECT", "/scenes", `Item '${itemId}' is represented by ${locations.length} collectible objects; it may appear only once in a package.`, "error", locations.join(", "));
  }
  pkg.beats.forEach((beat, index) => checkBeatSemantics(beat, index, sceneIds, beatIds, flagIds, itemIds, factIds, scenesById, diagnostics));
  return { ok: !diagnostics.some((diagnostic) => diagnostic.severity === "error"), diagnostics };
}

/** Run structure, semantic, and bounded state-space checks for untrusted JSON. */
export function validateStoryPackage(value: unknown, stateOptions?: { maxStates?: number; maxMs?: number }): ValidationResult {
  const structural = validateStructure(value);
  if (!structural.ok) return structural;
  const pkg = value as StoryPackage;
  const semantic = validateSemantics(pkg);
  if (!semantic.ok) return { ok: false, diagnostics: semantic.diagnostics };
  const state = exploreStateSpace(pkg, stateOptions);
  return { ok: state.ok, diagnostics: [...semantic.diagnostics, ...state.diagnostics] };
}

export function assertStoryPackage(value: unknown): StoryPackage {
  const result = validateStoryPackage(value);
  if (!result.ok) {
    throw new Error(result.diagnostics.map((diagnostic) => `${diagnostic.code} ${diagnostic.path}: ${diagnostic.message}`).join("\n"));
  }
  return value as StoryPackage;
}

export type { Action, Anchor, Beat, Condition, Cue, Option, Scene, StoryState, WorldObject };
