/**
 * Public, runtime-agnostic representation of a PS1 story package.
 *
 * This package deliberately contains no browser, Three.js, provider, or
 * filesystem dependency.  The player and Studio may add adapters around this
 * contract, but this module is the single source of truth for story state.
 */

export type Id = string;
export type Vec3 = readonly [number, number, number];

export type ProvenanceKind = "sourced" | "adapted" | "invented";
export type FactKind = "observed" | "reported" | "hypothesis" | "unknown";

export interface Span {
  start: number;
  end: number;
}

export interface Provenance {
  kind: ProvenanceKind;
  spans: Span[];
  note: string;
}

export interface SourceRecord {
  id: Id;
  title: string;
  author: string;
  digest: string;
  codepointLength: number;
  extent: "excerpt" | "complete";
  boundary: string;
  usage: "private-prototype" | "authorized-public";
  verifiedUrl?: string;
}

export interface RuntimeContract {
  engineMajor: 1;
  templateVersion: 1;
}

export interface StoryFlag {
  id: Id;
  initial: boolean;
}

export interface StoryItem {
  id: Id;
  label: string;
}

export interface StoryFact {
  id: Id;
  kind: FactKind;
  text: string;
  provenance: Provenance;
}

export interface FlagCondition {
  kind: "flag";
  id: Id;
  value: boolean;
}

export interface InventoryCondition {
  kind: "inventory";
  id: Id;
  present: boolean;
}

export interface KnowledgeCondition {
  kind: "knowledge";
  id: Id;
  present: boolean;
}

export type Condition = FlagCondition | InventoryCondition | KnowledgeCondition;
export type Effect = Condition;

export interface CueBase {
  text: string;
  provenance: Provenance;
}

export interface NarrationCue extends CueBase {
  kind: "narration";
}

export interface DialogueCue extends CueBase {
  kind: "dialogue";
  speaker: string;
}

export type Cue = NarrationCue | DialogueCue;

export type Prefab =
  | "table-v1"
  | "key-v1"
  | "door-v1"
  | "note-v1"
  | "person-v1"
  | "plant-v1";

export type SceneTemplate = "room-v1" | "courtyard-v1";

export interface WorldObject {
  id: Id;
  prefab: Prefab;
  position: Vec3;
  yaw: number;
  itemId?: Id;
  visibleWhen?: {
    flagId: Id;
    value: boolean;
  };
}

export interface Anchor {
  id: Id;
  targetObject: Id;
  position: Vec3;
  radius: number;
}

export interface Scene {
  id: Id;
  template: SceneTemplate;
  spawn: {
    position: Vec3;
    yaw: number;
  };
  objects: WorldObject[];
  anchors: Anchor[];
}

export interface InspectAction {
  kind: "inspect";
  anchorId: Id;
}

export interface TalkAction {
  kind: "talk";
  anchorId: Id;
}

export interface CollectAction {
  kind: "collect";
  anchorId: Id;
  itemId: Id;
}

export interface UseAction {
  kind: "use";
  anchorId: Id;
  itemId: Id;
}

export interface ChooseAction {
  kind: "choose";
}

export interface EndAction {
  kind: "end";
}

export type Action =
  | InspectAction
  | TalkAction
  | CollectAction
  | UseAction
  | ChooseAction
  | EndAction;

export interface Option {
  id: Id;
  label: string;
  guards: Condition[];
  cues: Cue[];
  effects: Effect[];
  next: Id;
}

export interface Beat {
  id: Id;
  sceneId: Id;
  objective: string;
  entry: Cue[];
  action: Action;
  options: Option[];
}

export interface StoryPackage {
  schemaVersion: "1.0.0";
  id: Id;
  title: string;
  runtime: RuntimeContract;
  source: SourceRecord;
  flags: StoryFlag[];
  items: StoryItem[];
  facts: StoryFact[];
  scenes: Scene[];
  startBeat: Id;
  beats: Beat[];
}

export interface StoryState {
  beatId: Id;
  flags: Record<Id, boolean>;
  inventory: Id[];
  collectedItems: Id[];
  knownFacts: Id[];
  ended: boolean;
}

export interface RunEnvelope {
  packageDigest: string;
  saveSlotId: string;
  engineMajor: 1;
  sessionId: string;
  generation: number;
  revision: number;
  state: StoryState;
}

export interface StoryEventBase {
  eventId: string;
  sessionId: string;
  expectedGeneration: number;
  expectedRevision: number;
  beatId: Id;
  type: string;
}

export interface CompleteOptionEvent extends StoryEventBase {
  type: "complete-option";
  optionId: Id;
}

export interface ConfirmEndEvent extends StoryEventBase {
  type: "confirm-end";
}

export type StoryEvent = CompleteOptionEvent | ConfirmEndEvent;

export interface FencingContext {
  sessionId: string;
  generation: number;
  revision: number;
}

export interface EventReceipt {
  eventId: string;
  accepted: boolean;
  revision: number;
  state: StoryState;
  diagnostics: Diagnostic[];
}

export interface ReduceOptions {
  fencing?: FencingContext;
  /** A serializable event-id → receipt map maintained by the adapter. */
  priorEvents?: Readonly<Record<string, EventReceipt>>;
}

export interface ReduceResult {
  accepted: boolean;
  state: StoryState;
  revision: number;
  diagnostics: Diagnostic[];
  receipt: EventReceipt;
}

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface Diagnostic {
  code: string;
  severity: DiagnosticSeverity;
  path: string;
  message: string;
  evidence?: string;
  repairHint?: string;
}

export interface ValidationResult {
  ok: boolean;
  diagnostics: Diagnostic[];
}

export interface StateSpaceEdge {
  from: string;
  to: string;
  eventType: StoryEvent["type"];
  optionId?: Id;
}

export interface StateSpaceResult extends ValidationResult {
  explored: number;
  truncated: boolean;
  endedStates: number;
  deadEndStates: number;
  states: string[];
  edges: StateSpaceEdge[];
}
