import { sha256Hex } from "./canonical.js";
import type { StoryPackage } from "./types.js";

/** A tiny original fixture used by contract tests and local adapter examples. */
export const EXAMPLE_SOURCE = "At dusk, Lin finds a brass key beneath a note and must decide whether to open the quiet door.";

const span = { start: 0, end: [...EXAMPLE_SOURCE].length };

export const EXAMPLE_STORY_PACKAGE: StoryPackage = {
  schemaVersion: "1.0.0",
  id: "brass-key-demo",
  title: "The Brass Key",
  runtime: { engineMajor: 1, templateVersion: 1 },
  source: {
    id: "original-fixture",
    title: "The Brass Key",
    author: "Kanshan test fixture",
    digest: sha256Hex(EXAMPLE_SOURCE),
    codepointLength: [...EXAMPLE_SOURCE].length,
    extent: "complete",
    boundary: "The complete short fixture ends after the door decision.",
    usage: "private-prototype",
  },
  flags: [{ id: "noticed-detail", initial: false }],
  items: [{ id: "brass-key", label: "Brass key" }],
  facts: [{
    id: "key-under-note",
    kind: "observed",
    text: "A brass key lies beneath the note.",
    provenance: { kind: "sourced", spans: [span], note: "The fixture explicitly states this observation." },
  }],
  scenes: [{
    id: "quiet-room",
    template: "room-v1",
    spawn: { position: [0, 1.6, 2], yaw: 3.14 },
    objects: [
      { id: "note-object", prefab: "note-v1", position: [0, 0, 0], yaw: 0, itemId: "brass-key" },
      { id: "door-object", prefab: "door-v1", position: [0, 0, -3], yaw: 0 },
    ],
    anchors: [
      { id: "note-anchor", targetObject: "note-object", position: [0, 0, 0.8], radius: 0.8 },
      { id: "door-anchor", targetObject: "door-object", position: [0, 0, -2.2], radius: 0.8 },
    ],
  }],
  startBeat: "notice-note",
  beats: [
    {
      id: "notice-note",
      sceneId: "quiet-room",
      objective: "Look at the note.",
      entry: [{ kind: "narration", text: "At dusk, the room is quiet.", provenance: { kind: "adapted", spans: [span], note: "Condensed from the fixture opening." } }],
      action: { kind: "inspect", anchorId: "note-anchor" },
      options: [{
        id: "read-note",
        label: "Read the note",
        guards: [],
        cues: [{ kind: "narration", text: "A brass key glints beneath the note.", provenance: { kind: "sourced", spans: [span], note: "The fixture describes the key and note." } }],
        effects: [{ kind: "knowledge", id: "key-under-note", present: true }],
        next: "collect-key",
      }],
    },
    {
      id: "collect-key",
      sceneId: "quiet-room",
      objective: "Take the brass key.",
      entry: [],
      action: { kind: "collect", anchorId: "note-anchor", itemId: "brass-key" },
      options: [{
        id: "take-key",
        label: "Take the key",
        guards: [{ kind: "knowledge", id: "key-under-note", present: true }],
        cues: [{ kind: "narration", text: "The key is cold in your hand.", provenance: { kind: "invented", spans: [], note: "A tactile transition added for the playable adaptation." } }],
        effects: [{ kind: "inventory", id: "brass-key", present: true }],
        next: "door-choice",
      }],
    },
    {
      id: "door-choice",
      sceneId: "quiet-room",
      objective: "Decide what to do with the door.",
      entry: [{ kind: "narration", text: "The quiet door waits.", provenance: { kind: "adapted", spans: [span], note: "A concise transition from the fixture ending." } }],
      action: { kind: "choose" },
      options: [
        {
          id: "open-door",
          label: "Open the door",
          guards: [{ kind: "inventory", id: "brass-key", present: true }],
          cues: [{ kind: "narration", text: "You turn the key.", provenance: { kind: "invented", spans: [], note: "Playable choice feedback." } }],
          effects: [{ kind: "flag", id: "noticed-detail", value: true }],
          next: "finish",
        },
        {
          id: "keep-key",
          label: "Keep the key and wait",
          guards: [{ kind: "inventory", id: "brass-key", present: true }],
          cues: [{ kind: "narration", text: "You hold the key and wait.", provenance: { kind: "invented", spans: [], note: "Playable choice feedback." } }],
          effects: [],
          next: "finish",
        },
      ],
    },
    {
      id: "finish",
      sceneId: "quiet-room",
      objective: "Finish this excerpt.",
      entry: [{ kind: "narration", text: "The excerpt ends here.", provenance: { kind: "invented", spans: [], note: "The source boundary is intentionally explicit." } }],
      action: { kind: "end" },
      options: [],
    },
  ],
};
