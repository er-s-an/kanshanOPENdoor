/**
 * 旷野信号站 · Signal Field — an original open-field, top-down signal-array
 * scene at dusk.
 *
 * An open, non-enclosed field (freeform floorPolygon ground, walls only as
 * local structures): three antenna masts stand scattered between a beacon
 * tower and a small control bunker. Each mast is rotated with repeated
 * interact presses; a mast counts as aligned once its head aims at the beacon
 * tower. When all three are aligned, a beacon timeline fires (camera blend to
 * the tower, synth swell, skippable with a declared finish policy) and the
 * objective completes. A guide NPC patrols declared nav waypoints and follows
 * the player only while it perceives them (range + physics line-of-sight);
 * its movement is behavior intent consumed by a kinematic character through
 * PhysicsWorld, so it never clips through structures.
 *
 * The work has TWO scenes (field + interior control bunker). R1 hosts load
 * exactly one SceneInstance per session, so the bunker is a second module
 * configuration sharing a SessionStateBag: persistent progress (notebook
 * memos, mast awards, objectives) is written to the bag on every fact and
 * hydrated on create, and scene transitions (door interacts) are mediated by
 * a bag-carried transition request plus a ScreenFade on each side.
 *
 * Offline runs inject HeadlessInputDevice / RecordingBackend / FakeDocument;
 * a browser host injects the DOM-backed equivalents instead.
 */
import * as THREE from './three.ts';
import type { SceneContext, SceneInstance } from '../../../src/creative/core/context.ts';
import type { ColliderDesc, Vec3 } from '../../../src/creative/core/spatial.ts';
import { CreativeError } from '../../../src/creative/core/errors.ts';
import { RealBackend } from '../../../src/creative/audio/backend.ts';
import type { AudioBackend, AudioNodeLike } from '../../../src/creative/audio/backend.ts';
import { AudioGraph } from '../../../src/creative/audio/graph.ts';
import { AudioPlayer } from '../../../src/creative/audio/player.ts';
import type { SynthVoice } from '../../../src/creative/audio/player.ts';
import { CameraDirector, FixedRig, FollowRig } from '../../../src/creative/camera/rigs.ts';
import { DomInputDevice } from '../../../src/creative/input/dom.ts';
import { ActionMapper } from '../../../src/creative/input/mapper.ts';
import { topdownDefaults } from '../../../src/creative/input/defaults.ts';
import type { InputDevice } from '../../../src/creative/input/types.ts';
import { TopDownController } from '../../../src/creative/controllers/top-down.ts';
import { KinematicCharacterCore } from '../../../src/creative/controllers/kinematic-character.ts';
import type { CharacterTuning } from '../../../src/creative/controllers/kinematic-character.ts';
import { installPhysics, quatFromYaw } from '../../../src/creative/physics/world.ts';
import type { PhysicsWorld } from '../../../src/creative/physics/world.ts';
import { createState } from '../../../src/creative/gameplay/state.ts';
import type { GameState, StateSnapshot } from '../../../src/creative/gameplay/state.ts';
import { ObjectiveTracker } from '../../../src/creative/gameplay/objectives.ts';
import type { ObjectiveSnapshot } from '../../../src/creative/gameplay/objectives.ts';
import { exposeParameters } from '../../../src/creative/scene/authoring.ts';
import type { ParameterDef, ParameterRegistry } from '../../../src/creative/scene/authoring.ts';
import { floorPolygon, wallSegment, wallWithOpening } from '../../../src/creative/scene/helpers.ts';
import type { SceneBuild } from '../../../src/creative/scene/helpers.ts';
import { defaultDocument } from '../../../src/creative/ui/dom.ts';
import type { DocumentLike, DomElementLike } from '../../../src/creative/ui/dom.ts';
import { Hud } from '../../../src/creative/ui/hud.ts';
import { createInteractionSystem } from '../../../src/creative/interaction/system.ts';
import type { InteractionSystem } from '../../../src/creative/interaction/system.ts';
import { createNavGraph } from '../../../src/creative/ai/nav.ts';
import type { NavGraph } from '../../../src/creative/ai/nav.ts';
import { createFollow, createPatrol, isStuck } from '../../../src/creative/ai/behaviors.ts';
import type { Behavior } from '../../../src/creative/ai/behaviors.ts';
import { createPerception } from '../../../src/creative/ai/perception.ts';
import { createFsm } from '../../../src/creative/ai/fsm.ts';
import type { Fsm } from '../../../src/creative/ai/fsm.ts';
import type { SessionStateBag } from '../../../src/creative/state/cross-scene.ts';
import { ScreenFade, ScreenFlash } from '../../../src/creative/effects/screen.ts';
import { cameraBlend, cue, timeline, wait } from '../../../src/creative/animation/timeline.ts';
import type { TimelineHandle, TimelineState } from '../../../src/creative/animation/timeline.ts';

// ---------------------------------------------------------------------------
// Layout constants (XZ plan; +X east, +Z south). The field has NO perimeter.
// ---------------------------------------------------------------------------

const MODULE_ID = 'signal-field';
const CHECKPOINT_SCHEMA_VERSION = 1;

/** Open freeform ground; irregular on purpose — no enclosing edge exists. */
const FIELD_POLY: ReadonlyArray<readonly [number, number]> = [
  [-26, -24], [-8, -28], [14, -26], [26, -16], [28, 2], [18, 12], [-2, 14], [-18, 10], [-28, -2],
];
const BEACON: Vec3 = [0, 0, -18];
const BUNKER_CENTER: readonly [number, number] = [-14, -6];
const SPAWN: Vec3 = [0, 1.0, 6.5];
const NPC_SPAWN: Vec3 = [-10, 1.0, -6];
const MEMO_FIELD_POS: Vec3 = [2, 0.7, 5];
const BUNKER_DOOR_POS: Vec3 = [-11.2, 1.0, -6];
const BUNKER_DOOR_OUTSIDE: Vec3 = [-10.2, 1.0, -6];
const FOLLOW_RANGE = 8;

interface MastDef {
  readonly id: string;
  readonly pos: readonly [number, number];
  /** Alignment rotation offset, in step units, authored per mast. */
  readonly offsetSteps: number;
}
const MAST_STEP_DEFAULT_DEG = 45;
const MASTS: readonly MastDef[] = [
  { id: 'mast-0', pos: [-8, -14], offsetSteps: 1 },
  { id: 'mast-1', pos: [10, -12], offsetSteps: 3 },
  { id: 'mast-2', pos: [6, 3.4], offsetSteps: 2 },
];

/** Known structure footprints (XZ rects) — test evidence that nobody clips. */
const FIELD_OBSTACLES: ReadonlyArray<{ minX: number; maxX: number; minZ: number; maxZ: number; label: string }> = [
  { minX: -1.6, maxX: 1.6, minZ: -19.6, maxZ: -16.4, label: 'beacon-tower' },
  { minX: -16.2, maxX: -11.8, minZ: -7.7, maxZ: -4.3, label: 'bunker-hut' },
  { minX: MASTS[0].pos[0] - 0.4, maxX: MASTS[0].pos[0] + 0.4, minZ: MASTS[0].pos[1] - 0.4, maxZ: MASTS[0].pos[1] + 0.4, label: 'mast-0' },
  { minX: MASTS[1].pos[0] - 0.4, maxX: MASTS[1].pos[0] + 0.4, minZ: MASTS[1].pos[1] - 0.4, maxZ: MASTS[1].pos[1] + 0.4, label: 'mast-1' },
  { minX: MASTS[2].pos[0] - 0.4, maxX: MASTS[2].pos[0] + 0.4, minZ: MASTS[2].pos[1] - 0.4, maxZ: MASTS[2].pos[1] + 0.4, label: 'mast-2' },
  { minX: 5.2, maxX: 6.8, minZ: -3.6, maxZ: -2.4, label: 'crates' },
  { minX: -6.6, maxX: -5.4, minZ: -5.6, maxZ: -4.4, label: 'rocks' },
];

/** Nav waypoints — every node and every straight edge stays off the obstacles.
 * Nodes sit at the grounded capsule-center height (0.85): behaviors measure
 * 3D distance, and a node at ground level would sit 0.85 below the steering
 * position, outside any reasonable arrive radius. */
const NAV_NODES = [
  { id: 'n0', position: [0, 0.85, 4] as Vec3 },
  { id: 'n1', position: [-4, 0.85, -1] as Vec3 },
  { id: 'n2', position: [-10, 0.85, -6] as Vec3 },
  { id: 'n4', position: [0, 0.85, -8] as Vec3 },
  { id: 'n5', position: [5, 0.85, -5] as Vec3 },
  { id: 'nM0', position: [-8, 0.85, -11.6] as Vec3 },
  { id: 'nM1', position: [10, 0.85, -9.6] as Vec3 },
  { id: 'nM2', position: [6, 0.85, 1.2] as Vec3 },
];
const NAV_EDGES = [
  { from: 'n0', to: 'n1', twoWay: true },
  { from: 'n1', to: 'n2', twoWay: true },
  { from: 'n1', to: 'n4', twoWay: true },
  { from: 'n0', to: 'n4', twoWay: true },
  { from: 'n4', to: 'n5', twoWay: true },
  { from: 'n4', to: 'nM0', twoWay: true },
  { from: 'n4', to: 'nM1', twoWay: true },
  { from: 'n5', to: 'nM1', twoWay: true },
  { from: 'n0', to: 'nM2', twoWay: true },
  { from: 'n5', to: 'nM2', twoWay: true },
];

const PLAYER_TUNING: CharacterTuning = {
  speed: 3.2,
  radius: 0.3,
  height: 1.8,
  gravity: 9.81,
  jumpSpeed: 4.5,
  maxSlopeAngle: (45 * Math.PI) / 180,
  maxStepHeight: 0.4,
};
const NPC_SPEED_DEFAULT = 1.6;
const npcTuning: CharacterTuning = {
  speed: NPC_SPEED_DEFAULT,
  radius: 0.3,
  height: 1.7,
  gravity: 9.81,
  jumpSpeed: 4.5,
  maxSlopeAngle: (45 * Math.PI) / 180,
  maxStepHeight: 0.4,
};

/** Top-down camera sits south of the player looking north: screen-up = -Z. */
const TOPDOWN_YAW = 0;

// ---------------------------------------------------------------------------
// Progress state + checkpoint
// ---------------------------------------------------------------------------

export interface SignalProgress {
  /** Committed mast head yaws (radians around Y). */
  mastYaw: [number, number, number];
  /** One award commit per mast; a fact never un-happens. */
  mastAwarded: [boolean, boolean, boolean];
  /** Notebook memos collected across BOTH scenes. */
  memos: string[];
  beaconFired: boolean;
}

export interface RecordedCommit {
  name: string;
  payload: unknown;
  eventId: string;
}

/** JSON-serializable mid-route checkpoint (matches checkpointSchemaVersion 1). */
export interface SignalCheckpoint {
  checkpointSchemaVersion: typeof CHECKPOINT_SCHEMA_VERSION;
  scene: 'field';
  simTime: number;
  player: Vec3;
  state: StateSnapshot<SignalProgress>;
  objectives: ObjectiveSnapshot;
  npc: { position: Vec3; fsm: string };
  commits: RecordedCommit[];
}

export interface SignalNpcHandles {
  readonly position: Vec3;
  readonly state: string | null;
  readonly stuck: boolean;
}

export interface SignalHandles {
  readonly physics: PhysicsWorld;
  readonly player: TopDownController;
  readonly npc: SignalNpcHandles | null;
  readonly tracker: ObjectiveTracker;
  readonly progress: GameState<SignalProgress, SignalProgress>;
  readonly params: ParameterRegistry;
  readonly hud: Hud;
  readonly audio: AudioPlayer;
  readonly camera: THREE.PerspectiveCamera;
  readonly director: CameraDirector;
  readonly fade: ScreenFade;
  readonly interaction: InteractionSystem;
  readonly obstacles: ReadonlyArray<{ minX: number; maxX: number; minZ: number; maxZ: number; label: string }>;
  readonly masts: {
    aligned(i: number): boolean;
    yaw(i: number): number;
    /** Interact presses from the CURRENT yaw until aligned (fresh = authored). */
    pressesNeeded(i: number): number;
  } | null;
  readonly beacon: {
    fired(): boolean;
    state(): TimelineState | 'none';
    skip(): void;
    readonly skipPolicy: string;
  } | null;
  readonly recordedCommits: readonly RecordedCommit[];
  saveCheckpoint(): SignalCheckpoint;
  unlockAudio(): void;
}

export interface SignalFieldOptions {
  device?: InputDevice;
  audioBackend?: AudioBackend;
  document?: DocumentLike;
  hudParent?: DomElementLike;
  camera?: THREE.PerspectiveCamera;
  /** Which scene this session loads. Default 'field'. */
  scene?: 'field' | 'bunker';
  /**
   * Cross-scene persistent state. Pass the SAME bag to the field and bunker
   * sessions; notebook/mast/objective progress survives the swap.
   */
  stateBag?: SessionStateBag;
  /** Mid-route checkpoint from saveCheckpoint() (field scene only). */
  checkpoint?: unknown;
  /** Host accessibility preference: fades become instant, flashes suppressed. */
  reduceMotion?: boolean;
}

export interface SignalFieldModule {
  create(ctx: SceneContext): Promise<SceneInstance & { handles: SignalHandles }>;
  handles?: SignalHandles;
}

// ---------------------------------------------------------------------------
// Static author-parameter declaration (engine-cli author tools consume this
// without running create() — pure data + validate predicates).
// ---------------------------------------------------------------------------

export function describeParameters(): ParameterDef[] {
  return [
    {
      authorId: 'signal.mast-step',
      schemaVersion: 1,
      description: '天线每次转动的角度（度）；未校准的天线按新步长重新计算',
      value: MAST_STEP_DEFAULT_DEG,
      validate(value: unknown) {
        return typeof value === 'number' && value >= 15 && value <= 90 ? true : 'mast-step 需在 15..90 度之间';
      },
    },
    {
      authorId: 'signal.npc-speed',
      schemaVersion: 1,
      description: '向导 NPC 巡逻/跟随速度（米/秒）；立即重建行为',
      value: NPC_SPEED_DEFAULT,
      validate(value: unknown) {
        return typeof value === 'number' && value >= 0.5 && value <= 3 ? true : 'npc-speed 需在 0.5..3 米/秒之间';
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Small math helpers
// ---------------------------------------------------------------------------

function wrapPi(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

function mastTargetYaw(i: number): number {
  const m = MASTS[i];
  return Math.atan2(BEACON[0] - m.pos[0], BEACON[2] - m.pos[1]);
}

function setAt3(a: readonly [number, number, number], i: number, v: number): [number, number, number] {
  const next: [number, number, number] = [a[0], a[1], a[2]];
  next[i] = v;
  return next;
}

function setAt3b(a: readonly [boolean, boolean, boolean], i: number, v: boolean): [boolean, boolean, boolean] {
  const next: [boolean, boolean, boolean] = [a[0], a[1], a[2]];
  next[i] = v;
  return next;
}

function makeSynthClip(build: (out: AudioNodeLike, when: number, backend: AudioBackend) => SynthVoice | void) {
  return { kind: 'synth' as const, render: build };
}

/** Deterministic synth clips — no sampled assets, scheduling is replay-observable. */
function defaultClips() {
  return {
    'signal-hum': makeSynthClip((out, when, backend) => {
      const gain = backend.createGain();
      gain.gain.setValueAtTime(0, when);
      gain.gain.linearRampToValueAtTime(0.5, when + 0.6);
      gain.connect(out);
      const stops: Array<(t: number) => void> = [];
      for (const [freq, detune] of [
        [110, 0],
        [165, 4],
      ] as const) {
        const osc = backend.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, when);
        if (detune !== 0 && 'detune' in osc) (osc.detune as { setValueAtTime(v: number, t: number): void }).setValueAtTime(detune, when);
        osc.connect(gain);
        osc.start(when);
        stops.push((t: number) => osc.stop(t));
      }
      return { stop: (t: number) => stops.forEach((s) => s(t)) };
    }),
    'mast-click': makeSynthClip((out, when, backend) => {
      const osc = backend.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(240, when);
      osc.frequency.linearRampToValueAtTime(170, when + 0.07);
      const gain = backend.createGain();
      gain.gain.setValueAtTime(0.35, when);
      gain.gain.linearRampToValueAtTime(0, when + 0.09);
      osc.connect(gain);
      gain.connect(out);
      osc.start(when);
      osc.stop(when + 0.1);
      return { stop: (t: number) => osc.stop(t) };
    }),
    'mast-chime': makeSynthClip((out, when, backend) => {
      const gain = backend.createGain();
      gain.gain.setValueAtTime(0, when);
      gain.gain.linearRampToValueAtTime(0.4, when + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, when + 1.1);
      gain.connect(out);
      const stops: Array<(t: number) => void> = [];
      for (const freq of [523, 784]) {
        const osc = backend.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, when);
        osc.connect(gain);
        osc.start(when);
        osc.stop(when + 1.1);
        stops.push((t: number) => osc.stop(t));
      }
      return { stop: (t: number) => stops.forEach((s) => s(t)) };
    }),
    'beacon-pulse': makeSynthClip((out, when, backend) => {
      const osc = backend.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(90, when);
      osc.frequency.exponentialRampToValueAtTime(880, when + 1.9);
      const gain = backend.createGain();
      gain.gain.setValueAtTime(0, when);
      gain.gain.linearRampToValueAtTime(0.45, when + 0.4);
      gain.gain.linearRampToValueAtTime(0, when + 2.1);
      osc.connect(gain);
      gain.connect(out);
      osc.start(when);
      osc.stop(when + 2.1);
      return { stop: (t: number) => osc.stop(t) };
    }),
    'memo-blip': makeSynthClip((out, when, backend) => {
      const osc = backend.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(660, when);
      const gain = backend.createGain();
      gain.gain.setValueAtTime(0.3, when);
      gain.gain.linearRampToValueAtTime(0, when + 0.14);
      osc.connect(gain);
      gain.connect(out);
      osc.start(when);
      osc.stop(when + 0.15);
      return { stop: (t: number) => osc.stop(t) };
    }),
    'door-thunk': makeSynthClip((out, when, backend) => {
      const osc = backend.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(75, when);
      osc.frequency.linearRampToValueAtTime(45, when + 0.22);
      const gain = backend.createGain();
      gain.gain.setValueAtTime(0.5, when);
      gain.gain.linearRampToValueAtTime(0, when + 0.26);
      osc.connect(gain);
      gain.connect(out);
      osc.start(when);
      osc.stop(when + 0.28);
      return { stop: (t: number) => osc.stop(t) };
    }),
  };
}

function readCheckpoint(raw: unknown): SignalCheckpoint | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object') {
    throw new CreativeError('BAD_SNAPSHOT', 'signal-field checkpoint must be an object', { phase: 'create' });
  }
  const cp = raw as SignalCheckpoint;
  if (cp.checkpointSchemaVersion !== CHECKPOINT_SCHEMA_VERSION) {
    throw new CreativeError(
      'SCHEMA_VERSION_MISMATCH',
      `signal-field checkpoint schemaVersion ${String(cp.checkpointSchemaVersion)} does not match ${CHECKPOINT_SCHEMA_VERSION}`,
      { phase: 'create' },
    );
  }
  if (cp.scene !== 'field') {
    throw new CreativeError('BAD_SNAPSHOT', `signal-field checkpoint scene must be "field", got ${String(cp.scene)}`, {
      phase: 'create',
    });
  }
  return cp;
}

function initialYaw(i: number, stepRad: number): number {
  return wrapPi(mastTargetYaw(i) + MASTS[i].offsetSteps * stepRad);
}

function createProgressState(stepRad: number): GameState<SignalProgress, SignalProgress> {
  return createState<SignalProgress>({
    schemaVersion: 1,
    metadata: { recovery: 'checkpoint', name: 'signal-progress' },
    initial: {
      mastYaw: [initialYaw(0, stepRad), initialYaw(1, stepRad), initialYaw(2, stepRad)],
      mastAwarded: [false, false, false],
      memos: [],
      beaconFired: false,
    },
    serialize: (s) => ({
      mastYaw: [s.mastYaw[0], s.mastYaw[1], s.mastYaw[2]],
      mastAwarded: [s.mastAwarded[0], s.mastAwarded[1], s.mastAwarded[2]],
      memos: [...s.memos],
      beaconFired: s.beaconFired,
    }),
    restore: (data) => {
      if (typeof data !== 'object' || data === null) {
        throw new CreativeError('BAD_SNAPSHOT', 'signal-progress data must be an object', { phase: 'command' });
      }
      const d = data as SignalProgress;
      if (!Array.isArray(d.mastYaw) || d.mastYaw.length !== 3 || !d.mastYaw.every((v) => Number.isFinite(v))) {
        throw new CreativeError('BAD_SNAPSHOT', 'signal-progress mastYaw must be 3 finite numbers', { phase: 'command' });
      }
      if (!Array.isArray(d.mastAwarded) || d.mastAwarded.length !== 3 || !d.mastAwarded.every((v) => typeof v === 'boolean')) {
        throw new CreativeError('BAD_SNAPSHOT', 'signal-progress mastAwarded must be 3 booleans', { phase: 'command' });
      }
      if (!Array.isArray(d.memos) || !d.memos.every((v) => v === 'field' || v === 'bunker')) {
        throw new CreativeError('BAD_SNAPSHOT', 'signal-progress memos must be an array of scene ids', { phase: 'command' });
      }
      return {
        mastYaw: [Number(d.mastYaw[0]), Number(d.mastYaw[1]), Number(d.mastYaw[2])],
        mastAwarded: [Boolean(d.mastAwarded[0]), Boolean(d.mastAwarded[1]), Boolean(d.mastAwarded[2])],
        memos: [...new Set(d.memos)],
        beaconFired: Boolean(d.beaconFired),
      };
    },
  });
}

// ---------------------------------------------------------------------------
// Module factory
// ---------------------------------------------------------------------------

export function createSignalFieldModule(options: SignalFieldOptions = {}): SignalFieldModule {
  const module: SignalFieldModule = {
    async create(ctx: SceneContext): Promise<SceneInstance & { handles: SignalHandles }> {
      const sceneKind = options.scene ?? 'field';
      const checkpoint = sceneKind === 'field' ? readCheckpoint(options.checkpoint) : null;
      const bag = options.stateBag;
      const physics = await installPhysics(ctx);
      const root = new THREE.Group();
      root.name = 'signal-field';

      // ---- live author parameters ------------------------------------------
      let mastStepDeg = MAST_STEP_DEFAULT_DEG;
      const stepRad = (): number => (mastStepDeg * Math.PI) / 180;
      const alignTol = (): number => Math.min(stepRad() * 0.45, 0.4);
      const isAlignedYaw = (yaw: number, i: number): boolean => Math.abs(wrapPi(yaw - mastTargetYaw(i))) <= alignTol();

      // ---- progress + objectives (checkpoint beats bag beats initial) ------
      const progress = createProgressState(stepRad());
      const tracker = new ObjectiveTracker({
        objectives: [
          { id: 'recover-logs', target: 2, title: '集齐信号手记' },
          { id: 'light-the-beacon', target: 3, title: '点亮信标' },
        ],
        commit: ctx,
      });
      if (checkpoint) {
        progress.restore(checkpoint.state);
        tracker.restore(checkpoint.objectives);
      } else if (bag?.hasPersistentState(MODULE_ID)) {
        const savedProgress = bag.get('persistent', MODULE_ID, 'progress');
        if (savedProgress !== undefined) progress.restore(savedProgress);
        const savedObjectives = bag.get('persistent', MODULE_ID, 'objectives');
        if (savedObjectives !== undefined) tracker.restore(savedObjectives);
      }
      const persist = (): void => {
        bag?.set('persistent', MODULE_ID, 'progress', progress.snapshot());
        bag?.set('persistent', MODULE_ID, 'objectives', tracker.snapshot());
      };
      persist();

      // Consume a pending scene transition request (both scenes do this).
      if (bag?.hasPersistentState(MODULE_ID)) {
        const pending = bag.get('persistent', MODULE_ID, 'transition');
        if (pending !== undefined) bag.unset('persistent', MODULE_ID, 'transition');
      }

      // ---- commit validators + the session fact log (checkpoint payload) ---
      ctx.registerEventValidator('signal.*', (payload) =>
        typeof payload === 'object' && payload !== null ? true : 'payload must be an object',
      );
      ctx.registerEventValidator('objectives.*', (payload) => {
        const p = payload as { objectiveId?: unknown };
        return typeof p?.objectiveId === 'string' ? true : 'objectiveId must be a string';
      });
      const recordedCommits: RecordedCommit[] = [];
      ctx.onCommit((envelope) => {
        recordedCommits.push({ name: envelope.name, payload: envelope.payload, eventId: envelope.eventId });
      });

      // ---- shared presentation bits ----------------------------------------
      const doc: DocumentLike = options.document ?? defaultDocument();
      const hud = new Hud(doc, options.hudParent);
      const notebookEl = doc.createElement('div');
      notebookEl.classList.add('ui-signal-notebook');
      hud.custom.appendChild(notebookEl);
      const syncNotebookHud = (): void => {
        const awarded = progress.value.mastAwarded.filter(Boolean).length;
        notebookEl.textContent = `信号手记 ${progress.value.memos.length}/2 · 天线 ${awarded}/3`;
      };
      syncNotebookHud();

      const backend = options.audioBackend ?? new RealBackend();
      const graph = new AudioGraph(backend);
      ctx.scope.own(graph);
      const audio = new AudioPlayer({ backend, graph, scope: ctx.scope, clips: defaultClips() });

      const camera = options.camera ?? new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 220);
      const fade = new ScreenFade(camera, { scope: ctx.scope, reduceMotion: options.reduceMotion ?? false });
      const flash = new ScreenFlash(camera, { scope: ctx.scope, reduceMotion: options.reduceMotion ?? false });

      // ---- input -------------------------------------------------------------
      let device: InputDevice;
      if (options.device) {
        device = options.device;
      } else if (typeof globalThis.window !== 'undefined') {
        device = new DomInputDevice({ scope: ctx.scope });
      } else {
        throw new CreativeError('INPUT_NO_DEVICE', 'signal-field needs an input device (pass options.device)', {
          phase: 'create',
        });
      }
      const mapper = new ActionMapper(topdownDefaults, device, { scope: ctx.scope });

      // ---- geometry ------------------------------------------------------------
      const material = new THREE.MeshLambertMaterial({ color: 0x8f8578 });
      const darkMaterial = new THREE.MeshLambertMaterial({ color: 0x5d564c });
      let bodyCounter = 0;
      const mount = (build: SceneBuild, prefix: string, y = 0): void => {
        if (y !== 0) build.object.position.y = y;
        root.add(build.object);
        const p = build.object.position;
        const q = quatFromYaw(build.object.rotation.y);
        for (const desc of build.colliders) {
          const id = `${prefix}-${bodyCounter++}`;
          physics.addBody(id, desc as ColliderDesc, { position: [p.x, p.y, p.z], quaternion: q });
        }
      };
      const box = (
        prefix: string,
        size: [number, number, number],
        pos: Vec3,
        mat: THREE.Material,
        yaw = 0,
      ): void => {
        const g = new THREE.Group();
        g.name = prefix;
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), mat);
        mesh.position.set(0, size[1] / 2, 0);
        g.add(mesh);
        g.position.set(pos[0], pos[1], pos[2]);
        g.rotation.y = yaw;
        root.add(g);
        physics.addBody(
          `${prefix}-${bodyCounter++}`,
          { shape: { kind: 'box', halfExtents: [size[0] / 2, size[1] / 2, size[2] / 2] }, body: 'static' },
          { position: [pos[0], pos[1] + size[1] / 2, pos[2]], quaternion: quatFromYaw(yaw) },
        );
      };

      if (sceneKind === 'field') {
        mount(floorPolygon(FIELD_POLY, { material }), 'field-floor');
        // Beacon tower: four legs + platform + lamp + center pedestal.
        for (const [lx, lz] of [
          [-1.1, -1.1],
          [-1.1, 1.1],
          [1.1, -1.1],
          [1.1, 1.1],
        ] as const) {
          box('beacon-leg', [0.32, 5.2, 0.32], [BEACON[0] + lx, 0, BEACON[2] + lz], darkMaterial);
        }
        box('beacon-pedestal', [0.7, 1.2, 0.7], [BEACON[0], 0, BEACON[2]], material);
        box('beacon-platform', [2.9, 0.25, 2.9], [BEACON[0], 5.0, BEACON[2]], darkMaterial);
        const lampMaterial = new THREE.MeshBasicMaterial({ color: progress.value.beaconFired ? 0xffd27a : 0x584e3a });
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 8), lampMaterial);
        lamp.name = 'beacon-lamp';
        lamp.position.set(BEACON[0], 5.55, BEACON[2]);
        root.add(lamp);
        // Bunker hut: local walls with a real doorway on the east face.
        const [bx, bz] = BUNKER_CENTER;
        mount(wallSegment({ length: 4.4, height: 2.6, thickness: 0.24, material, position: [bx, 0, bz - 1.7], yaw: 0 }), 'hut-n');
        mount(
          wallWithOpening({
            length: 3.4,
            height: 2.6,
            thickness: 0.24,
            material,
            position: [bx + 2.2, 0, bz],
            yaw: Math.PI / 2,
            opening: { kind: 'door', width: 1.1, height: 2.2, offsetX: -0.9 },
          }),
          'hut-e',
        );
        mount(wallSegment({ length: 4.4, height: 2.6, thickness: 0.24, material, position: [bx, 0, bz + 1.7], yaw: 0 }), 'hut-s');
        mount(wallSegment({ length: 3.4, height: 2.6, thickness: 0.24, material, position: [bx - 2.2, 0, bz], yaw: Math.PI / 2 }), 'hut-w');
        box('hut-roof', [4.8, 0.22, 3.8], [bx, 2.6, bz], darkMaterial);
        // Scattered props.
        box('crates', [1.6, 1.1, 1.2], [6, 0, -3], material);
        box('rock-a', [0.9, 0.7, 0.9], [-6, 0, -5], darkMaterial);
        box('rock-b', [0.7, 0.5, 0.7], [-5.4, 0, -4.6], darkMaterial);
        // Memo slate near spawn.
        box('memo-slate-pedestal', [0.5, 0.7, 0.4], [MEMO_FIELD_POS[0], 0, MEMO_FIELD_POS[2]], darkMaterial);
        // Antenna masts: pole (static) + rotating head (presentation mirrors
        // the committed yaw fact; interactables look the heads up by name).
        for (let i = 0; i < MASTS.length; i += 1) {
          const [mx, mz] = MASTS[i].pos;
          box(`${MASTS[i].id}-pole`, [0.4, 4.5, 0.4], [mx, 0, mz], darkMaterial);
          const head = new THREE.Group();
          head.name = `${MASTS[i].id}-head`;
          head.position.set(mx, 4.35, mz);
          const beam = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 1.6), new THREE.MeshLambertMaterial({ color: 0xc8b27a }));
          beam.position.set(0, 0, 0.8);
          const tip = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 0.26), new THREE.MeshBasicMaterial({ color: 0xd98f4a }));
          tip.position.set(0, 0, 1.6);
          head.add(beam, tip);
          head.rotation.y = progress.value.mastYaw[i];
          root.add(head);
        }
      } else {
        // ---- bunker interior (dollhouse: walls, no roof, for the top-down cam)
        mount(floorPolygon([[-2.7, -2.2], [2.7, -2.2], [2.7, 2.2], [-2.7, 2.2]], { material }), 'bunker-floor');
        mount(wallSegment({ length: 5.4, height: 2.6, thickness: 0.22, material, position: [0, 0, -2.2], yaw: 0 }), 'bunker-n');
        mount(
          wallWithOpening({
            length: 5.4,
            height: 2.6,
            thickness: 0.22,
            material,
            position: [0, 0, 2.2],
            yaw: 0,
            opening: { kind: 'door', width: 1.2, height: 2.2, offsetX: 0 },
          }),
          'bunker-s',
        );
        mount(wallSegment({ length: 4.4, height: 2.6, thickness: 0.22, material, position: [2.7, 0, 0], yaw: Math.PI / 2 }), 'bunker-e');
        mount(wallSegment({ length: 4.4, height: 2.6, thickness: 0.22, material, position: [-2.7, 0, 0], yaw: Math.PI / 2 }), 'bunker-w');
        box('bunker-console', [1.0, 0.9, 0.6], [1.6, 0, -1.5], darkMaterial);
        const screen = new THREE.Mesh(
          new THREE.PlaneGeometry(0.7, 0.4),
          new THREE.MeshBasicMaterial({ color: 0x9fd8b0 }),
        );
        screen.name = 'bunker-console-screen';
        screen.position.set(1.6, 1.0, -1.19);
        root.add(screen);
      }

      // ---- player --------------------------------------------------------------
      const spawn = checkpoint ? checkpoint.player : sceneKind === 'field' ? SPAWN : ([0, 1.0, 0.8] as Vec3);
      const player = new TopDownController(physics, PLAYER_TUNING, { id: 'player', spawn, faceMovement: true });
      ctx.scope.own(player);
      root.add(player.object);
      {
        const bodyMesh = new THREE.Mesh(
          new THREE.CylinderGeometry(0.3, 0.3, 1.8, 10),
          new THREE.MeshLambertMaterial({ color: 0xc8b27a }),
        );
        const nose = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.34), new THREE.MeshBasicMaterial({ color: 0x3a342a }));
        nose.position.set(0, 0.35, 0.36);
        player.object.add(bodyMesh, nose);
      }

      // ---- camera ----------------------------------------------------------------
      const followRig = new FollowRig('player-follow', {
        target: player.object,
        offset: sceneKind === 'field' ? [0, 13, 5] : [0, 9, 3.2],
        damping: 6,
      });
      const director = new CameraDirector(camera, followRig);
      director.attach(ctx);

      // ---- beacon reveal timeline (skippable; declared finish policy) --------------
      const beaconRig = new FixedRig('beacon-reveal', { position: [7.5, 7.0, -10.5], lookAt: [BEACON[0], 5.2, BEACON[2]] });
      const beaconTimeline = timeline('signal-beacon', {
        cancelPolicy: 'finish',
        endState: {
          natural: 'beacon cue committed, camera blended back to the player-follow rig',
          skip: 'same end state as natural completion (finish policy fast-forwards)',
        },
      });
      beaconTimeline.add(
        cameraBlend(beaconRig, 1.2),
        cue('signal.beacon-lit', { masts: 3 }, { eventId: 'signal:beacon:lit' }),
        wait(1.6),
      );
      let beaconHandle: TimelineHandle | null = null;
      const startBeacon = (): void => {
        if (beaconHandle !== null) return;
        beaconHandle = beaconTimeline.run(ctx, { camera: director });
      };

      // ---- interaction -------------------------------------------------------------
      const interaction = createInteractionSystem({ action: 'interact' });

      // ---- field-only systems: NPC + masts -------------------------------------------
      let npcCore: KinematicCharacterCore | null = null;
      let fsm: Fsm | null = null;
      let navGraph: NavGraph | null = null;
      const behaviors: { patrol: Behavior; follow: Behavior } = {
        patrol: undefined as unknown as Behavior,
        follow: undefined as unknown as Behavior,
      };
      let npcStuck = false;

      const pressesNeeded = (i: number): number => {
        const step = stepRad();
        const maxPress = Math.ceil((Math.PI * 2) / step) + 1;
        for (let k = 0; k <= maxPress; k += 1) {
          if (isAlignedYaw(wrapPi(progress.value.mastYaw[i] + k * step), i)) return k;
        }
        return maxPress;
      };

      if (sceneKind === 'field') {
        // -- NPC: patrol/follow behaviors over the declared nav graph; movement
        // intent is consumed by a kinematic character (never wall-clipping).
        navGraph = createNavGraph({ nodes: NAV_NODES, edges: NAV_EDGES });
        const rebuildBehaviors = (speed: number): void => {
          npcTuning.speed = speed;
          behaviors.patrol = createPatrol({
            graph: navGraph!,
            from: 'n2',
            to: 'n5',
            speed,
            arriveRadius: 0.5,
            loop: true,
          });
          behaviors.follow = createFollow({
            graph: navGraph!,
            getTargetPosition: () => player.position,
            speed,
            arriveRadius: 1.4,
          });
        };
        rebuildBehaviors(NPC_SPEED_DEFAULT);

        npcCore = new KinematicCharacterCore(physics, npcTuning, checkpoint ? checkpoint.npc.position : NPC_SPAWN, 'guide-npc');
        ctx.scope.own(npcCore);
        root.add(npcCore.object);
        const npcBody = new THREE.Mesh(
          new THREE.CylinderGeometry(0.3, 0.3, 1.7, 10),
          new THREE.MeshLambertMaterial({ color: 0x7a9bc8 }),
        );
        const npcNose = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.3), new THREE.MeshBasicMaterial({ color: 0x22303f }));
        npcNose.position.set(0, 0.3, 0.34);
        npcCore.object.add(npcBody, npcNose);

        const perception = createPerception(
          (origin, dir, maxDist, query) => physics.raycast(origin, dir, maxDist, query),
          { query: { excludeBody: 'guide-npc' } },
        );

        const driveBehavior = (b: Behavior, dt: number): void => {
          const out = b.update(dt, npcCore!.position);
          if (isStuck(out)) {
            // 'stalled' while pinned against a body (e.g. the player standing on
            // the patrol line) is ordinary physics, not a malfunction — it is
            // observable via handles.npc.stuck. Only genuine nav failures
            // (no-path / blocked gates) reach the host diagnostics log.
            npcStuck = true;
            if (out.reason !== 'stalled') {
              ctx.report({ code: out.code, message: out.detail, phase: 'mechanics' });
            }
            npcCore!.update(dt, 0, 0, false);
            return;
          }
          npcStuck = false;
          const [vx, , vz] = out.velocity;
          if (Math.hypot(vx, vz) > 1e-6) npcCore!.object.rotation.y = Math.atan2(vx, vz);
          const s = npcTuning.speed;
          npcCore!.update(dt, vx / s, vz / s, false);
        };

        fsm = createFsm({
          states: [
            { id: 'patrol', update: (dt) => driveBehavior(behaviors.patrol, dt) },
            { id: 'follow', update: (dt) => driveBehavior(behaviors.follow, dt) },
          ],
          transitions: [
            { from: 'patrol', to: 'follow', on: 'perceived' },
            { from: 'follow', to: 'patrol', on: 'lost' },
          ],
          initial: checkpoint ? checkpoint.npc.fsm : 'patrol',
        });

        ctx.onPhase('intent', (frame) => {
          const verdict = perception.canPerceive(npcCore!.position, player.position, FOLLOW_RANGE, {
            eyeOffset: [0, 1.35, 0],
            targetOffset: [0, 1.25, 0],
          });
          if (verdict.perceived && fsm!.stateId === 'patrol') fsm!.fire('perceived');
          else if (!verdict.perceived && fsm!.stateId === 'follow') fsm!.fire('lost');
          fsm!.update(frame.dt);
        });

        // -- Masts: each interact press rotates by one step; awarding is a fact.
        for (let i = 0; i < MASTS.length; i += 1) {
          const idx = i;
          const head = root.getObjectByName(`${MASTS[idx].id}-head`);
          interaction.register({
            id: MASTS[idx].id,
            getPosition: () => [MASTS[idx].pos[0], 1.0, MASTS[idx].pos[1]],
            radius: 2.4,
            enabled: () => !progress.value.mastAwarded[idx] && !progress.value.beaconFired,
            onInteract: () => {
              audio.play('mast-click');
              const nextYaw = wrapPi(progress.value.mastYaw[idx] + stepRad());
              progress.update((s) => ({ ...s, mastYaw: setAt3(s.mastYaw, idx, nextYaw) }));
              if (head) head.rotation.y = nextYaw;
              if (!progress.value.mastAwarded[idx] && isAlignedYaw(nextYaw, idx)) {
                progress.update((s) => ({ ...s, mastAwarded: setAt3b(s.mastAwarded, idx, true) }));
                ctx.commit('signal.mast-aligned', { mast: MASTS[idx].id }, `signal:${MASTS[idx].id}:aligned`);
                tracker.progress('light-the-beacon', 1, `signal:light-the-beacon:progress:${idx}`);
                audio.play('mast-chime');
              }
              persist(); // single write after every mutation (yaw and/or award)
            },
          });
        }
      }

      // ---- memos (both scenes) -------------------------------------------------------
      const registerMemo = (memoId: 'field' | 'bunker', pos: Vec3, radius: number): void => {
        interaction.register({
          id: `memo-${memoId}`,
          getPosition: () => pos,
          radius,
          enabled: () => !progress.value.memos.includes(memoId),
          onInteract: () => {
            progress.update((s) => ({ ...s, memos: [...new Set([...s.memos, memoId])] }));
            ctx.commit('signal.memo-collected', { memo: memoId }, `signal:memo-${memoId}:collected`);
            tracker.progress('recover-logs', 1, `signal:recover-logs:progress:memo-${memoId}`);
            audio.play('memo-blip');
            syncNotebookHud();
            persist(); // after every mutation: the bag must see the bump
          },
        });
      };
      const registerExitDoor = (id: string, pos: Vec3, to: 'field' | 'bunker'): void => {
        interaction.register({
          id,
          getPosition: () => pos,
          radius: 2.0,
          onInteract: () => {
            audio.play('door-thunk');
            fade.fadeOut(0.45);
            ctx.commit('signal.scene-exit', { to }, `signal:scene-exit:${to}`);
            bag?.set('persistent', MODULE_ID, 'transition', { to });
          },
        });
      };
      if (sceneKind === 'field') {
        registerMemo('field', MEMO_FIELD_POS, 2.0);
        registerExitDoor('bunker-door', BUNKER_DOOR_POS, 'bunker');
      } else {
        registerMemo('bunker', [1.6, 0.8, -1.05], 1.8);
        registerExitDoor('bunker-exit', [0, 1.0, 1.8], 'field');
      }

      // ---- checkpoint commit replay (facts carry over; presentation does not) -------
      if (checkpoint) {
        for (const fact of checkpoint.commits) {
          ctx.commit(fact.name, fact.payload, fact.eventId);
        }
      }

      // ---- presentation reactions to committed facts ---------------------------------
      ctx.onCommit((envelope) => {
        if (envelope.name === 'signal.memo-collected') {
          hud.subtitle.queueLine('手记翻开了新的一页。', { durationMs: 2600 });
        } else if (envelope.name === 'signal.mast-aligned') {
          const mastId = (envelope.payload as { mast?: string }).mast ?? '';
          const idx = MASTS.findIndex((m) => m.id === mastId);
          hud.subtitle.queueLine(`第${idx + 1}座天线对准了信标。`, { durationMs: 2600 });
        } else if (envelope.name === 'signal.beacon-lit') {
          hud.subtitle.queueLine('信标塔亮了——三束信号在暮色里汇合。', { durationMs: 3600 });
          audio.play('beacon-pulse');
          flash.flash(0xffd9a0, 0.7, 0.45);
          progress.update((s) => ({ ...s, beaconFired: true }));
          persist();
          const lamp = root.getObjectByName('beacon-lamp') as THREE.Mesh | undefined;
          if (lamp) (lamp.material as THREE.MeshBasicMaterial).color.set(0xffd27a);
          syncNotebookHud();
        } else if (envelope.name === 'signal.scene-exit') {
          hud.subtitle.queueLine('门在身后合上了。', { durationMs: 2200 });
        } else if (envelope.name === 'objectives.completed') {
          const objectiveId = (envelope.payload as { objectiveId?: unknown }).objectiveId;
          if (objectiveId === 'recover-logs') {
            hud.subtitle.queueLine('信号手记补全了。', { durationMs: 3200 });
          }
        }
      });

      // ---- phase wiring ----------------------------------------------------------------
      ctx.onPhase('input', () => {
        mapper.step();
      });
      ctx.onPhase('intent', (frame) => {
        player.update(mapper.snapshot(), TOPDOWN_YAW, frame.dt);
      });
      ctx.onPhase('mechanics', () => {
        const p = player.position;
        const res = interaction.update(0, { position: [p[0], p[1] + 0.1, p[2]] }, mapper.snapshot());
        const focused = res.candidateId;
        if (focused && focused.startsWith('mast-')) hud.prompt.show('按 E 转动天线');
        else if (focused === 'memo-field' || focused === 'memo-bunker') hud.prompt.show('按 E 记录手记');
        else if (focused === 'bunker-door' || focused === 'bunker-exit') hud.prompt.show('按 E 推门');
        else hud.prompt.hide();
      });
      let humStarted = false;
      // Every session starts covered and reveals once; the exit door later
      // reuses the same fade freely (nothing here fights it per-step).
      fade.fadeOut(0);
      let entryRevealed = false;
      ctx.onPhase('present', (frame) => {
        if (!entryRevealed) {
          entryRevealed = true;
          fade.fadeIn(0.5);
        }
        hud.subtitle.tick(frame.dt * 1000);
        audio.update(ctx.clock.time);
        const p = player.position;
        audio.setListenerPosition([p[0], p[1] + 1.2, p[2]]);
        fade.update(frame.dt);
        flash.update(frame.dt);
        if (sceneKind === 'field' && !humStarted && audio.state === 'unlocked') {
          humStarted = true;
          audio.play('signal-hum', { loop: true, position: [BEACON[0], 5, BEACON[2]], volume: 0.5, refDistance: 5, fadeIn: 0.5 });
        }
      });

      // ---- per-step module update (mechanics, after hooks) -------------------------------
      const update = (): void => {
        if (sceneKind === 'field' && !progress.value.beaconFired && beaconHandle === null && tracker.isComplete('light-the-beacon')) {
          // Restore-safe: a checkpoint saved between the third award and the
          // cue still reaches the beacon on the next step.
          startBeacon();
        }
        syncNotebookHud();
      };

      // ---- author parameters (live apply) -------------------------------------------------
      const applyParameter: Record<string, (value: unknown) => void> = {
        'signal.mast-step': (value) => {
          mastStepDeg = Number(value);
          // Offsets are authored in STEP units: re-derive each unawarded mast's
          // yaw against the new granularity so the puzzle stays solvable.
          // Awarded yaws are committed facts and never move.
          const step = stepRad();
          progress.update((s) => {
            let yaw = s.mastYaw;
            for (let i = 0; i < MASTS.length; i += 1) {
              if (!s.mastAwarded[i]) yaw = setAt3(yaw, i, initialYaw(i, step));
            }
            return { ...s, mastYaw: yaw };
          });
          persist();
          for (let i = 0; i < MASTS.length; i += 1) {
            if (progress.value.mastAwarded[i]) continue;
            const head = root.getObjectByName(`${MASTS[i].id}-head`);
            if (head) head.rotation.y = progress.value.mastYaw[i];
          }
        },
        'signal.npc-speed': (value) => {
          const speed = Number(value);
          if (sceneKind === 'field') {
            // Behaviors take speed at construction; rebuild them live (the NPC
            // keeps its position and FSM state, like clockwork's door rebuild).
            npcTuning.speed = speed;
            behaviors.patrol = createPatrol({
              graph: navGraph!,
              from: 'n2',
              to: 'n5',
              speed,
              arriveRadius: 0.5,
              loop: true,
            });
            behaviors.follow = createFollow({
              graph: navGraph!,
              getTargetPosition: () => player.position,
              speed,
              arriveRadius: 1.4,
            });
          }
        },
      };
      const params = exposeParameters(
        describeParameters().map((def) => ({ ...def, apply: applyParameter[def.authorId] })),
      );

      const handles: SignalHandles = {
        physics,
        player,
        npc:
          sceneKind === 'field' && npcCore && fsm
            ? {
                get position() {
                  return npcCore!.position;
                },
                get state() {
                  return fsm!.stateId;
                },
                get stuck() {
                  return npcStuck;
                },
              }
            : null,
        tracker,
        progress,
        params,
        hud,
        audio,
        camera,
        director,
        fade,
        interaction,
        obstacles: FIELD_OBSTACLES,
        masts:
          sceneKind === 'field'
            ? {
                aligned: (i) => progress.value.mastAwarded[i],
                yaw: (i) => progress.value.mastYaw[i],
                pressesNeeded,
              }
            : null,
        beacon:
          sceneKind === 'field'
            ? {
                fired: () => progress.value.beaconFired,
                state: () => (beaconHandle ? beaconHandle.state : 'none'),
                skip: () => beaconHandle?.skip(),
                skipPolicy: "finish (timeline cancelPolicy 'finish'): skip() fast-forwards to the identical end state",
              }
            : null,
        recordedCommits,
        saveCheckpoint(): SignalCheckpoint {
          if (sceneKind !== 'field' || !npcCore || !fsm) {
            throw new CreativeError('BAD_SCENE', 'saveCheckpoint is only available in the field scene', { phase: 'command' });
          }
          return {
            checkpointSchemaVersion: CHECKPOINT_SCHEMA_VERSION,
            scene: 'field',
            simTime: ctx.clock.time,
            player: [...player.position] as Vec3,
            state: progress.snapshot(),
            objectives: tracker.snapshot(),
            npc: { position: [...npcCore.position] as Vec3, fsm: fsm.stateId ?? 'patrol' },
            commits: recordedCommits.map((f) => ({ ...f })),
          };
        },
        unlockAudio(): void {
          audio.unlock();
        },
      };

      const instance: SceneInstance & { handles: SignalHandles } = { root, update, handles };
      module.handles = handles;
      return instance;
    },
  };
  return module;
}
