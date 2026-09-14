import assert from "node:assert/strict";
import test from "node:test";
import {
  EXAMPLE_STORY_PACKAGE,
  EXAMPLE_SOURCE,
  canonicalJson,
  createInitialState,
  digestJson,
  exploreStateSpace,
  normalizeSourceText,
  packageDigest,
  reduceStoryState,
  sha256Hex,
  sourceDigest,
  validateSemantics,
  validateStoryPackage,
  validateStructure,
} from "../dist/index.js";

const session = "test-session";
const event = (beatId, optionId, expectedRevision, eventId = `${beatId}-${optionId}-${expectedRevision}`) => ({
  eventId,
  sessionId: session,
  expectedGeneration: 0,
  expectedRevision,
  beatId,
  type: "complete-option",
  optionId,
});

test("canonical JSON sorts objects but retains arrays", () => {
  assert.equal(canonicalJson({ z: 1, a: { d: 2, c: 3 }, list: [2, 1] }), '{"a":{"c":3,"d":2},"list":[2,1],"z":1}');
  assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(digestJson({ b: 1, a: 2 }), digestJson({ a: 2, b: 1 }));
  assert.throws(() => canonicalJson({ bad: Number.NaN }), /non-finite/);
});

test("source normalization follows the source contract", () => {
  const value = sourceDigest("\uFEFFa\r\nb\rc\n");
  assert.equal(value.normalizedText, "a\nb\nc\n");
  assert.equal(value.codepointLength, 6);
  assert.equal(normalizeSourceText(EXAMPLE_SOURCE), EXAMPLE_SOURCE);
});

test("fixture passes structural, semantic, and bounded state validation", () => {
  assert.equal(validateStructure(EXAMPLE_STORY_PACKAGE).ok, true);
  assert.equal(validateSemantics(EXAMPLE_STORY_PACKAGE).ok, true);
  const result = validateStoryPackage(EXAMPLE_STORY_PACKAGE, { maxStates: 100, maxMs: 1_000 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.diagnostics, []);
});

test("structural validator rejects unknown properties and malformed IDs", () => {
  const malformed = structuredClone(EXAMPLE_STORY_PACKAGE);
  malformed.beats[0].unexpected = true;
  malformed.id = "Not Valid";
  const result = validateStructure(malformed);
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some((entry) => entry.code === "STRUCTURE_ADDITIONAL_PROPERTY"));
  assert.ok(result.diagnostics.some((entry) => entry.code === "STRUCTURE_ID"));
});

test("semantic validator catches broken references and effect conflicts", () => {
  const malformed = structuredClone(EXAMPLE_STORY_PACKAGE);
  malformed.beats[1].options[0].next = "missing-beat";
  malformed.beats[1].options[0].effects.push({ kind: "inventory", id: "brass-key", present: false });
  const structure = validateStructure(malformed);
  assert.equal(structure.ok, true);
  const result = validateSemantics(malformed);
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some((entry) => entry.code === "SEMANTIC_UNKNOWN_NEXT_BEAT"));
  assert.ok(result.diagnostics.some((entry) => entry.code === "SEMANTIC_DUPLICATE_EFFECT"));
});

test("reducer applies collect and end atomically", () => {
  let state = createInitialState(EXAMPLE_STORY_PACKAGE);
  let revision = 0;
  let result = reduceStoryState(state, event("notice-note", "read-note", revision), EXAMPLE_STORY_PACKAGE, { fencing: { sessionId: session, generation: 0, revision } });
  assert.equal(result.accepted, true);
  state = result.state;
  revision = result.revision;
  assert.deepEqual(state.knownFacts, ["key-under-note"]);

  result = reduceStoryState(state, event("collect-key", "take-key", revision), EXAMPLE_STORY_PACKAGE, { fencing: { sessionId: session, generation: 0, revision } });
  assert.equal(result.accepted, true);
  state = result.state;
  revision = result.revision;
  assert.deepEqual(state.inventory, ["brass-key"]);
  assert.deepEqual(state.collectedItems, ["brass-key"]);

  result = reduceStoryState(state, event("door-choice", "open-door", revision), EXAMPLE_STORY_PACKAGE, { fencing: { sessionId: session, generation: 0, revision } });
  assert.equal(result.accepted, true);
  state = result.state;
  revision = result.revision;
  result = reduceStoryState(state, { eventId: "finish", sessionId: session, expectedGeneration: 0, expectedRevision: revision, beatId: "finish", type: "confirm-end" }, EXAMPLE_STORY_PACKAGE, { fencing: { sessionId: session, generation: 0, revision } });
  assert.equal(result.accepted, true);
  assert.equal(result.state.ended, true);
});

test("generation/revision fencing rejects stale async work and prior events are idempotent", () => {
  const state = createInitialState(EXAMPLE_STORY_PACKAGE);
  const first = event("notice-note", "read-note", 0, "one");
  const accepted = reduceStoryState(state, first, EXAMPLE_STORY_PACKAGE, { fencing: { sessionId: session, generation: 0, revision: 0 } });
  assert.equal(accepted.accepted, true);
  const replay = reduceStoryState(state, first, EXAMPLE_STORY_PACKAGE, { fencing: { sessionId: session, generation: 0, revision: 0 }, priorEvents: { one: accepted.receipt } });
  assert.equal(replay.accepted, true);
  assert.equal(replay.revision, accepted.revision);
  const staleGeneration = reduceStoryState(state, { ...first, eventId: "two", expectedGeneration: 1 }, EXAMPLE_STORY_PACKAGE, { fencing: { sessionId: session, generation: 0, revision: 0 } });
  assert.equal(staleGeneration.accepted, false);
  assert.equal(staleGeneration.diagnostics[0].code, "STALE_GENERATION");
  const staleRevision = reduceStoryState(state, { ...first, eventId: "three", expectedRevision: 1 }, EXAMPLE_STORY_PACKAGE, { fencing: { sessionId: session, generation: 0, revision: 0 } });
  assert.equal(staleRevision.accepted, false);
  assert.equal(staleRevision.diagnostics[0].code, "STALE_REVISION");
});

test("bounded BFS explores every fixture branch and reaches confirm-end", () => {
  const result = exploreStateSpace(EXAMPLE_STORY_PACKAGE, { maxStates: 100, maxMs: 1_000 });
  assert.equal(result.ok, true);
  assert.equal(result.truncated, false);
  assert.equal(result.endedStates, 2);
  assert.equal(result.deadEndStates, 0);
  assert.ok(result.edges.some((edge) => edge.eventType === "confirm-end"));
});

test("bounded BFS reports inconclusive instead of passing when capped", () => {
  const result = exploreStateSpace(EXAMPLE_STORY_PACKAGE, { maxStates: 1, maxMs: 1_000 });
  assert.equal(result.ok, false);
  assert.equal(result.truncated, true);
  assert.ok(result.diagnostics.some((entry) => entry.code === "INCONCLUSIVE_STATE_SPACE"));
});

test("package digest is stable and independent of object insertion order", () => {
  const reordered = { ...EXAMPLE_STORY_PACKAGE, title: EXAMPLE_STORY_PACKAGE.title };
  assert.equal(packageDigest(EXAMPLE_STORY_PACKAGE), packageDigest(reordered));
});
