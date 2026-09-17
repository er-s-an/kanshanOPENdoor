/**
 * 灯塔最后一班 · The Keeper's Last Shift — an original first-person indoor
 * narrative scene on a stormy last night in a small lighthouse.
 *
 * Two connected rooms: the lamp room (灯室, with the lamp apparatus, a window
 * onto the rain and a side table) and the keeper's quarters (值守室, with a
 * desk whose drawer is stuck, a bunk and a stove). The keeper's final
 * inspection round is a dialogue + inventory loop, NOT a door/platform puzzle:
 *
 *   1. TALK to 陈师傅, the old keeper who came to watch the last lighting.
 *      A DialogueRunner tree with three branch points; option effects commit
 *      durable facts (which ending the keeper chose) through the ctx commit
 *      channel with deterministic, idempotent eventIds.
 *   2. COLLECT three scattered logbook pages into an Inventory. One page sits
 *      inside the stuck desk drawer: it is not interactable until the drawer
 *      has been tugged open (two pulls by default; the first one only jams).
 *   3. LIGHT THE LAMP at the console — enabled only once the talk is done and
 *      all three pages are held. Lighting it starts the procedural rotating
 *      lamp, schedules the foghorn through the AudioPlayer, and runs a short
 *      skippable outro timeline; the final objective completes exactly once
 *      when the outro's cue commits (natural and skip reach the same state).
 *
 * Weather: a ParticleEmitter rains outside the west window (reduce-motion
 * halves emission). HUD is Chinese subtitles + prompts + a live objectives
 * line. Checkpoints capture progress/objectives/inventory/pose/commit-log and
 * restore wholesale into a fresh session; a checkpoint saved mid-dialogue is
 * an honest error, not a silent merge.
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
import { CameraDirector, FixedRig } from '../../../src/creative/camera/rigs.ts';
import type { CameraPose, CameraRig } from '../../../src/creative/camera/rigs.ts';
import { DomInputDevice } from '../../../src/creative/input/dom.ts';
import { ActionMapper, EMPTY_ACTION_STATE, mergeActionMaps } from '../../../src/creative/input/mapper.ts';
import { fpsDefaults } from '../../../src/creative/input/defaults.ts';
import type { InputDevice } from '../../../src/creative/input/types.ts';
import { FirstPersonController } from '../../../src/creative/controllers/first-person.ts';
import type { CharacterTuning } from '../../../src/creative/controllers/kinematic-character.ts';
import { installPhysics, quatFromYaw } from '../../../src/creative/physics/world.ts';
import type { PhysicsWorld } from '../../../src/creative/physics/world.ts';
import { createState } from '../../../src/creative/gameplay/state.ts';
import type { GameState, StateSnapshot } from '../../../src/creative/gameplay/state.ts';
import { ObjectiveTracker } from '../../../src/creative/gameplay/objectives.ts';
import type { ObjectiveSnapshot } from '../../../src/creative/gameplay/objectives.ts';
import { Inventory } from '../../../src/creative/gameplay/inventory.ts';
import type { InventorySnapshot } from '../../../src/creative/gameplay/inventory.ts';
import { DialogueRunner } from '../../../src/creative/gameplay/dialogue.ts';
import type { DialogueNode, DialogueView } from '../../../src/creative/gameplay/dialogue.ts';
import { createInteractionSystem } from '../../../src/creative/interaction/system.ts';
import type { InteractionSystem } from '../../../src/creative/interaction/system.ts';
import { exposeParameters } from '../../../src/creative/scene/authoring.ts';
import type { ParameterDef, ParameterRegistry } from '../../../src/creative/scene/authoring.ts';
import { floorPolygon, wallSegment, wallWithOpening } from '../../../src/creative/scene/helpers.ts';
import type { SceneBuild } from '../../../src/creative/scene/helpers.ts';
import { defaultDocument } from '../../../src/creative/ui/dom.ts';
import type { DocumentLike, DomElementLike } from '../../../src/creative/ui/dom.ts';
import { Hud } from '../../../src/creative/ui/hud.ts';
import { ParticleEmitter } from '../../../src/creative/effects/particles.ts';
import { ScreenFade, ScreenFlash } from '../../../src/creative/effects/screen.ts';
import { cameraCut, cue, timeline, wait } from '../../../src/creative/animation/timeline.ts';
import type { TimelineHandle, TimelineState } from '../../../src/creative/animation/timeline.ts';

// ---------------------------------------------------------------------------
// Layout constants (XZ plan; +X east, -Z north). Room A 灯室 z 0..6.4,
// room B 值守室 z -4.6..0, joined by a single doorway in the shared wall.
// ---------------------------------------------------------------------------

const WALL_HEIGHT = 3.0;
const WALL_THICKNESS = 0.24;
const DOOR_WIDTH = 1.3;
const DOOR_HEIGHT = 2.2;

const FLOOR_A: ReadonlyArray<readonly [number, number]> = [[-3.6, 0], [3.6, 0], [3.6, 6.4], [-3.6, 6.4]];
const FLOOR_B: ReadonlyArray<readonly [number, number]> = [[-3.0, 0], [3.0, 0], [3.0, -4.6], [-3.0, -4.6]];

const SPAWN: Vec3 = [0, 1.0, 5.1];
const SPAWN_YAW = 0; // facing -Z, into the lamp room toward the visitor
const NPC_POS: Vec3 = [1.7, 0, 1.1];
const LAMP_POS: Vec3 = [0, 0, 3.7]; // pedestal center; rotor rides on top
const CONSOLE_POS: Vec3 = [0, 0.95, 2.45];
const DESK_POS: Vec3 = [-1.8, 0, -4.0];
const DRAWER_BASE_Z = -3.54;
const DRAWER_SLIDE = 0.44;
const PAGE_DESK_POS: Vec3 = [-1.2, 0.8, -3.9];
const PAGE_SHELF_POS: Vec3 = [3.0, 1.02, 5.4];
const WINDOW_X = -3.6;
const RAIN_POS: Vec3 = [-4.8, 3.3, 4.2];

const CHARACTER_TUNING: CharacterTuning = {
  speed: 2.6,
  radius: 0.3,
  height: 1.7,
  gravity: 9.81,
  jumpSpeed: 4.5,
  maxSlopeAngle: (45 * Math.PI) / 180,
  maxStepHeight: 0.4,
};

const CHECKPOINT_SCHEMA_VERSION = 1;
const RAIN_RATE_DEFAULT = 70;
const LAMP_SPEED_DEFAULT = 0.9;
const DRAWER_TUGS_DEFAULT = 2;
export const PAGE_IDS = ['desk', 'drawer', 'shelf'] as const;
export type PageId = (typeof PAGE_IDS)[number];

const PAGE_LINES: Record<PageId, string> = {
  desk: '桌面上，一页日志被茶杯压出了一圈痕。',
  drawer: '抽屉深处，一页折了角的日志。',
  shelf: '桌沿边上，一页被风吹落的日志。',
};

// ---------------------------------------------------------------------------
// Dialogue tree: three branch points (q1, q2, q3). Option effects are durable
// facts committed through the runner's CommitChannel (the module's ctx) with
// deterministic eventIds `keeper:<nodeId>:<index>`.
// ---------------------------------------------------------------------------

export const DIALOGUE_NODES: readonly DialogueNode[] = [
  { id: 'arrive', speaker: '陈师傅', text: '三十年了，这间屋子一点没变。', next: 'q1' },
  {
    id: 'q1',
    speaker: '守塔人',
    text: '……你来了。',
    options: [
      { label: '灯灭了以后，船怎么办？', next: 'ships' },
      { label: '你怎么偏偏挑今晚来？', next: 'tonight' },
    ],
  },
  { id: 'ships', speaker: '陈师傅', text: '局里下了自动灯浮，比咱们的灯还亮。海上不等人呐。', next: 'q2' },
  { id: 'tonight', speaker: '陈师傅', text: '最后一班，总得有人看你把灯点完。这是规矩，也是情分。', next: 'q2' },
  {
    id: 'q2',
    speaker: '守塔人',
    text: '雨越来越大了。',
    options: [
      { label: '守了三十年，你没有什么留恋的吗？', next: 'linger' },
      { label: '日志页散了一地，帮我一起找吧。', next: 'pages' },
    ],
  },
  { id: 'linger', speaker: '陈师傅', text: '留恋？往后回忆多的是。今晚先把活儿干完。', next: 'q3' },
  { id: 'pages', speaker: '陈师傅', text: '去吧。三页都找齐了再点灯——一页都不能少。', next: 'q3' },
  {
    id: 'q3',
    speaker: '守塔人',
    text: '时候不早了。',
    options: [
      {
        label: '点完这盏灯，我就下山了。',
        next: 'end-a',
        effect: { name: 'keeper.ending-accepts', payload: { ending: 'accepts' } },
      },
      {
        label: '以后每个雨夜，我都会想起这里。',
        next: 'end-b',
        effect: { name: 'keeper.ending-warm', payload: { ending: 'warm' } },
      },
    ],
  },
  { id: 'end-a', speaker: '陈师傅', text: '好。让它亮着，替我照完这段路。' },
  { id: 'end-b', speaker: '陈师傅', text: '灯亮着，路就亮着。去吧。' },
];

// ---------------------------------------------------------------------------
// Progress state + checkpoint
// ---------------------------------------------------------------------------

export interface KeeperProgress {
  talkDone: boolean;
  pages: string[];
  drawerTugs: number;
  drawerOpened: boolean;
  lampLit: boolean;
  ending: string | null;
}

export interface RecordedCommit {
  name: string;
  payload: unknown;
  eventId: string;
}

/** JSON-serializable mid-route checkpoint (matches checkpointSchemaVersion 1). */
export interface KeeperCheckpoint {
  checkpointSchemaVersion: typeof CHECKPOINT_SCHEMA_VERSION;
  simTime: number;
  player: Vec3;
  viewYaw: number;
  viewPitch: number;
  state: StateSnapshot<KeeperProgress>;
  objectives: ObjectiveSnapshot;
  inventory: InventorySnapshot;
  commits: RecordedCommit[];
}

export interface KeeperHandles {
  readonly physics: PhysicsWorld;
  readonly player: FirstPersonController;
  readonly tracker: ObjectiveTracker;
  readonly progress: GameState<KeeperProgress, KeeperProgress>;
  readonly inventory: Inventory;
  readonly dialogue: DialogueRunner;
  readonly interaction: InteractionSystem;
  readonly params: ParameterRegistry;
  readonly hud: Hud;
  readonly audio: AudioPlayer;
  readonly camera: THREE.PerspectiveCamera;
  readonly director: CameraDirector;
  readonly fade: ScreenFade;
  readonly flash: ScreenFlash;
  readonly rain: ParticleEmitter;
  readonly objectivesElement: DomElementLike;
  readonly dialogueElement: DomElementLike;
  readonly lamp: {
    lit(): boolean;
    rotorAngle(): number;
    speed(): number;
  };
  readonly drawer: {
    opened(): boolean;
    tugs(): number;
    z(): number;
  };
  readonly outro: {
    state(): TimelineState | 'none';
    readonly skipPolicy: string;
  };
  readonly recordedCommits: readonly RecordedCommit[];
  readonly viewYaw: number;
  saveCheckpoint(): KeeperCheckpoint;
  unlockAudio(): void;
}

export interface KeeperOptions {
  device?: InputDevice;
  audioBackend?: AudioBackend;
  document?: DocumentLike;
  hudParent?: DomElementLike;
  camera?: THREE.PerspectiveCamera;
  /** Mid-route checkpoint from saveCheckpoint() to restore in a fresh session. */
  checkpoint?: unknown;
  /** Host accessibility preference: rain emission halves, fades instant, flashes suppressed. */
  reduceMotion?: boolean;
}

export interface KeeperModule {
  create(ctx: SceneContext): Promise<SceneInstance & { handles: KeeperHandles }>;
  handles?: KeeperHandles;
}

// ---------------------------------------------------------------------------
// Static author-parameter declaration (engine-cli author tools consume this
// without running create() — pure data + validate predicates).
// ---------------------------------------------------------------------------

export function describeParameters(): ParameterDef[] {
  return [
    {
      authorId: 'keeper.rain-rate',
      schemaVersion: 1,
      description: '窗外雨点发射速率（粒/秒）；立即生效',
      value: RAIN_RATE_DEFAULT,
      validate(value: unknown) {
        return typeof value === 'number' && value >= 10 && value <= 140 ? true : 'rain-rate 需在 10..140 之间';
      },
    },
    {
      authorId: 'keeper.lamp-speed',
      schemaVersion: 1,
      description: '灯器旋转角速度（弧度/秒）；立即生效',
      value: LAMP_SPEED_DEFAULT,
      validate(value: unknown) {
        return typeof value === 'number' && value >= 0.2 && value <= 2.5 ? true : 'lamp-speed 需在 0.2..2.5 之间';
      },
    },
    {
      authorId: 'keeper.drawer-tugs',
      schemaVersion: 1,
      description: '拉开卡住的抽屉需要的拉动次数；立即生效',
      value: DRAWER_TUGS_DEFAULT,
      validate(value: unknown) {
        return typeof value === 'number' && value >= 1 && value <= 3 ? true : 'drawer-tugs 需在 1..3 之间';
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** First-person camera rig: reads the player head + view angles, writes only the camera. */
class HeadRig implements CameraRig {
  readonly name = 'player-head';
  private readonly sample: () => { position: Vec3; yaw: number; pitch: number };

  constructor(sample: () => { position: Vec3; yaw: number; pitch: number }) {
    this.sample = sample;
  }

  update(_dt: number): void {
    /* pose is derived fresh in getPose */
  }

  getPose(out: CameraPose): void {
    const s = this.sample();
    out.position.set(s.position[0], s.position[1] + 0.72, s.position[2]);
    out.quaternion.setFromEuler(new THREE.Euler(s.pitch, s.yaw, 0, 'YXZ'));
  }
}

function makeSynthClip(build: (out: AudioNodeLike, when: number, backend: AudioBackend) => SynthVoice | void) {
  return { kind: 'synth' as const, render: build };
}

/** Deterministic synth clips — no sampled assets, scheduling is replay-observable. */
function defaultClips() {
  return {
    'dialogue-blip': makeSynthClip((out, when, backend) => {
      const osc = backend.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(520, when);
      const gain = backend.createGain();
      gain.gain.setValueAtTime(0.22, when);
      gain.gain.linearRampToValueAtTime(0, when + 0.09);
      osc.connect(gain);
      gain.connect(out);
      osc.start(when);
      osc.stop(when + 0.1);
      return { stop: (t: number) => osc.stop(t) };
    }),
    'page-rustle': makeSynthClip((out, when, backend) => {
      const stops: Array<(t: number) => void> = [];
      const gain = backend.createGain();
      gain.gain.setValueAtTime(0.3, when);
      gain.gain.linearRampToValueAtTime(0, when + 0.22);
      gain.connect(out);
      [880, 1180].forEach((freq, i) => {
        const osc = backend.createOscillator();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, when + i * 0.05);
        osc.connect(gain);
        osc.start(when + i * 0.05);
        osc.stop(when + 0.22);
        stops.push((t: number) => osc.stop(t));
      });
      return { stop: (t: number) => stops.forEach((s) => s(t)) };
    }),
    'drawer-jam': makeSynthClip((out, when, backend) => {
      const osc = backend.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(95, when);
      osc.frequency.linearRampToValueAtTime(60, when + 0.1);
      const gain = backend.createGain();
      gain.gain.setValueAtTime(0.4, when);
      gain.gain.linearRampToValueAtTime(0, when + 0.12);
      osc.connect(gain);
      gain.connect(out);
      osc.start(when);
      osc.stop(when + 0.13);
      return { stop: (t: number) => osc.stop(t) };
    }),
    'drawer-scrape': makeSynthClip((out, when, backend) => {
      const osc = backend.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(65, when);
      osc.frequency.linearRampToValueAtTime(42, when + 0.55);
      const gain = backend.createGain();
      gain.gain.setValueAtTime(0, when);
      gain.gain.linearRampToValueAtTime(0.32, when + 0.06);
      gain.gain.setValueAtTime(0.32, when + 0.4);
      gain.gain.linearRampToValueAtTime(0, when + 0.6);
      osc.connect(gain);
      gain.connect(out);
      osc.start(when);
      osc.stop(when + 0.62);
      return { stop: (t: number) => osc.stop(t) };
    }),
    'lamp-ignite': makeSynthClip((out, when, backend) => {
      const sweep = backend.createOscillator();
      sweep.type = 'sawtooth';
      sweep.frequency.setValueAtTime(90, when);
      sweep.frequency.exponentialRampToValueAtTime(700, when + 1.1);
      const sub = backend.createOscillator();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(48, when);
      const gain = backend.createGain();
      gain.gain.setValueAtTime(0, when);
      gain.gain.linearRampToValueAtTime(0.4, when + 0.25);
      gain.gain.linearRampToValueAtTime(0, when + 1.3);
      sweep.connect(gain);
      sub.connect(gain);
      gain.connect(out);
      sweep.start(when);
      sweep.stop(when + 1.3);
      sub.start(when);
      sub.stop(when + 1.3);
      return {
        stop: (t: number) => {
          sweep.stop(t);
          sub.stop(t);
        },
      };
    }),
    foghorn: makeSynthClip((out, when, backend) => {
      // Two detuned low voices, slow attack, long decay — the last sounding.
      const stops: Array<(t: number) => void> = [];
      const gain = backend.createGain();
      gain.gain.setValueAtTime(0, when);
      gain.gain.linearRampToValueAtTime(0.5, when + 0.45);
      gain.gain.setValueAtTime(0.5, when + 2.1);
      gain.gain.linearRampToValueAtTime(0, when + 3.2);
      gain.connect(out);
      for (const [freq, detune] of [
        [73.4, 0],
        [110, 3],
      ] as const) {
        const osc = backend.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, when);
        if (detune !== 0 && 'detune' in osc) {
          (osc.detune as { setValueAtTime(v: number, t: number): void }).setValueAtTime(detune, when);
        }
        osc.connect(gain);
        osc.start(when);
        osc.stop(when + 3.2);
        stops.push((t: number) => osc.stop(t));
      }
      return { stop: (t: number) => stops.forEach((s) => s(t)) };
    }),
  };
}

function readCheckpoint(raw: unknown): KeeperCheckpoint | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object') {
    throw new CreativeError('BAD_SNAPSHOT', 'keepers-last-shift checkpoint must be an object', { phase: 'create' });
  }
  const cp = raw as KeeperCheckpoint;
  if (cp.checkpointSchemaVersion !== CHECKPOINT_SCHEMA_VERSION) {
    throw new CreativeError(
      'SCHEMA_VERSION_MISMATCH',
      `keepers-last-shift checkpoint schemaVersion ${String(cp.checkpointSchemaVersion)} does not match ${CHECKPOINT_SCHEMA_VERSION}`,
      { phase: 'create' },
    );
  }
  return cp;
}

function createProgressState(): GameState<KeeperProgress, KeeperProgress> {
  return createState<KeeperProgress>({
    schemaVersion: 1,
    metadata: { recovery: 'checkpoint', name: 'keeper-progress' },
    initial: { talkDone: false, pages: [], drawerTugs: 0, drawerOpened: false, lampLit: false, ending: null },
    serialize: (s) => ({
      talkDone: s.talkDone,
      pages: [...s.pages],
      drawerTugs: s.drawerTugs,
      drawerOpened: s.drawerOpened,
      lampLit: s.lampLit,
      ending: s.ending,
    }),
    restore: (data) => {
      if (typeof data !== 'object' || data === null) {
        throw new CreativeError('BAD_SNAPSHOT', 'keeper-progress data must be an object', { phase: 'command' });
      }
      const d = data as KeeperProgress;
      if (typeof d.talkDone !== 'boolean' || typeof d.drawerOpened !== 'boolean' || typeof d.lampLit !== 'boolean') {
        throw new CreativeError('BAD_SNAPSHOT', 'keeper-progress flags must be booleans', { phase: 'command' });
      }
      if (!Array.isArray(d.pages) || !d.pages.every((p) => (PAGE_IDS as readonly string[]).includes(p))) {
        throw new CreativeError('BAD_SNAPSHOT', 'keeper-progress pages must be an array of known page ids', { phase: 'command' });
      }
      if (!Number.isInteger(d.drawerTugs) || d.drawerTugs < 0) {
        throw new CreativeError('BAD_SNAPSHOT', 'keeper-progress drawerTugs must be a non-negative integer', { phase: 'command' });
      }
      if (d.ending !== null && d.ending !== 'accepts' && d.ending !== 'warm') {
        throw new CreativeError('BAD_SNAPSHOT', 'keeper-progress ending must be null, "accepts" or "warm"', { phase: 'command' });
      }
      return {
        talkDone: d.talkDone,
        pages: [...new Set(d.pages)],
        drawerTugs: d.drawerTugs,
        drawerOpened: d.drawerOpened,
        lampLit: d.lampLit,
        ending: d.ending,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// Module factory
// ---------------------------------------------------------------------------

export function createKeepersLastShiftModule(options: KeeperOptions = {}): KeeperModule {
  const module: KeeperModule = {
    async create(ctx: SceneContext): Promise<SceneInstance & { handles: KeeperHandles }> {
      const checkpoint = readCheckpoint(options.checkpoint);
      const reduceMotion = options.reduceMotion ?? false;
      const physics = await installPhysics(ctx);
      const root = new THREE.Group();
      root.name = 'keepers-last-shift';

      // ---- live author parameters ----------------------------------------
      let rainRate = RAIN_RATE_DEFAULT;
      let lampSpeed = LAMP_SPEED_DEFAULT;
      let drawerTugsRequired = DRAWER_TUGS_DEFAULT;

      // ---- progress + objectives + inventory (checkpoint restore) --------
      const progress = createProgressState();
      const tracker = new ObjectiveTracker({
        objectives: [
          { id: 'finish-handover', target: 1, title: '与陈老师傅交接' },
          { id: 'gather-pages', target: 3, title: '集齐三页日志' },
          { id: 'light-the-lamp', target: 1, title: '点亮灯器' },
        ],
        commit: ctx,
      });
      const inventory = new Inventory({ capacity: 3 });
      if (checkpoint) {
        progress.restore(checkpoint.state);
        tracker.restore(checkpoint.objectives);
        inventory.restore(checkpoint.inventory);
      }

      // ---- commit validators + the session fact log (checkpoint payload) --
      ctx.registerEventValidator('keeper.*', (payload) =>
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

      // ---- HUD --------------------------------------------------------------
      const doc: DocumentLike = options.document ?? defaultDocument();
      const hud = new Hud(doc, options.hudParent);
      const objectivesEl = doc.createElement('div');
      objectivesEl.classList.add('ui-keeper-objectives');
      hud.custom.appendChild(objectivesEl);
      const dialogueEl = doc.createElement('div');
      dialogueEl.classList.add('ui-keeper-dialogue');
      hud.custom.appendChild(dialogueEl);
      const syncObjectivesHud = (): void => {
        const done = tracker.isComplete('light-the-lamp');
        objectivesEl.textContent =
          `交接 ${progress.value.talkDone ? '✓' : '…'} · 日志页 ${progress.value.pages.length}/3 · 点灯 ${done ? '✓' : '…'}`;
      };
      syncObjectivesHud();

      // ---- audio -------------------------------------------------------------
      const backend = options.audioBackend ?? new RealBackend();
      const graph = new AudioGraph(backend);
      ctx.scope.own(graph);
      const audio = new AudioPlayer({ backend, graph, scope: ctx.scope, clips: defaultClips() });

      // ---- camera + screen effects -------------------------------------------
      const camera = options.camera ?? new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 120);
      const fade = new ScreenFade(camera, { scope: ctx.scope, reduceMotion });
      const flash = new ScreenFlash(camera, { scope: ctx.scope, reduceMotion });

      // ---- input --------------------------------------------------------------
      let device: InputDevice;
      if (options.device) {
        device = options.device;
      } else if (typeof globalThis.window !== 'undefined') {
        device = new DomInputDevice({ scope: ctx.scope });
      } else {
        throw new CreativeError('INPUT_NO_DEVICE', 'keepers-last-shift needs an input device (pass options.device)', {
          phase: 'create',
        });
      }
      // E advances dialogue lines and talks to the NPC; 1/2 choose; Escape skips
      // the outro. All dialogue driving is input-edge based in the mechanics phase.
      const actionMap = mergeActionMaps(fpsDefaults, {
        actions: {
          skip: [{ kind: 'key', code: 'Escape' }],
          'dialogue.1': [{ kind: 'key', code: 'Digit1' }],
          'dialogue.2': [{ kind: 'key', code: 'Digit2' }],
        },
        axes: {},
      });
      const mapper = new ActionMapper(actionMap, device, { scope: ctx.scope });

      // ---- geometry ------------------------------------------------------------
      const material = new THREE.MeshLambertMaterial({ color: 0x8d867b });
      const darkMaterial = new THREE.MeshLambertMaterial({ color: 0x565049 });
      const woodMaterial = new THREE.MeshLambertMaterial({ color: 0x6e5b45 });
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
      ): THREE.Group => {
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
        return g;
      };

      mount(floorPolygon(FLOOR_A, { material }), 'floor-a');
      mount(floorPolygon(FLOOR_B, { material }), 'floor-b');
      // Shared wall with the only doorway between the two rooms.
      mount(
        wallWithOpening({
          length: 7.2,
          height: WALL_HEIGHT,
          thickness: WALL_THICKNESS,
          material,
          position: [0, 0, 0],
          yaw: 0,
          opening: { kind: 'door', width: DOOR_WIDTH, height: DOOR_HEIGHT, offsetX: 0 },
        }),
        'wall-door',
      );
      // Threshold plate across the doorway: the two room floors are separate
      // trimeshes abutting under the wall; a 1 cm lip keeps the crossing smooth
      // (a flush plate in a walled doorway reads as an obstacle to the walker).
      mount(
        {
          object: (() => {
            const g = new THREE.Group();
            g.name = 'door-threshold';
            const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.04, 0.6), darkMaterial);
            mesh.position.set(0, -0.01, 0);
            g.add(mesh);
            return g;
          })(),
          colliders: [
            { shape: { kind: 'box', halfExtents: [0.75, 0.02, 0.3], offset: [0, -0.01, 0] }, body: 'static' },
          ],
        },
        'threshold',
      );
      mount(wallSegment({ length: 7.2, height: WALL_HEIGHT, thickness: WALL_THICKNESS, material, position: [0, 0, 6.4], yaw: 0 }), 'wall-a-s');
      // West wall of the lamp room carries the window the rain falls past.
      mount(
        wallWithOpening({
          length: 6.4,
          height: WALL_HEIGHT,
          thickness: WALL_THICKNESS,
          material,
          position: [WINDOW_X, 0, 3.2],
          yaw: Math.PI / 2,
          opening: { kind: 'window', width: 1.6, height: 1.2, sillHeight: 0.9, offsetX: -1.0 },
        }),
        'wall-window',
      );
      mount(wallSegment({ length: 6.4, height: WALL_HEIGHT, thickness: WALL_THICKNESS, material, position: [3.6, 0, 3.2], yaw: Math.PI / 2 }), 'wall-a-e');
      mount(wallSegment({ length: 6.0, height: WALL_HEIGHT, thickness: WALL_THICKNESS, material, position: [0, 0, -4.6], yaw: 0 }), 'wall-b-n');
      mount(wallSegment({ length: 4.6, height: WALL_HEIGHT, thickness: WALL_THICKNESS, material, position: [-3.0, 0, -2.3], yaw: Math.PI / 2 }), 'wall-b-w');
      mount(wallSegment({ length: 4.6, height: WALL_HEIGHT, thickness: WALL_THICKNESS, material, position: [3.0, 0, -2.3], yaw: Math.PI / 2 }), 'wall-b-e');

      // Lamp apparatus: pedestal (collider) + rotor with two beam arms + lens.
      const lampGroup = new THREE.Group();
      lampGroup.name = 'lamp-apparatus';
      lampGroup.position.set(LAMP_POS[0], 0, LAMP_POS[2]);
      const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.85, 2.1, 14), darkMaterial);
      pedestal.position.y = 1.05;
      lampGroup.add(pedestal);
      const lensMaterial = new THREE.MeshLambertMaterial({ color: 0x39434f });
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.7, 14), lensMaterial);
      lens.position.y = 2.45;
      lampGroup.add(lens);
      const rotor = new THREE.Group();
      rotor.name = 'lamp-rotor';
      rotor.position.y = 2.45;
      const beamMaterial = new THREE.MeshLambertMaterial({ color: 0x2c2c34 });
      for (const dir of [-1, 1] as const) {
        const beam = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.16, 0.16), beamMaterial);
        beam.position.set(dir * 1.7, 0, 0);
        rotor.add(beam);
      }
      lampGroup.add(rotor);
      const lampLight = new THREE.PointLight(0xffd9a0, 0, 20);
      lampLight.position.set(0, 2.5, 0);
      lampGroup.add(lampLight);
      root.add(lampGroup);
      physics.addBody(
        'lamp-pedestal',
        { shape: { kind: 'cylinder', halfHeight: 1.05, radius: 0.85 }, body: 'static' },
        { position: [LAMP_POS[0], 1.05, LAMP_POS[2]] },
      );

      // The visitor: 陈师傅, standing by the doorway.
      const npc = new THREE.Group();
      npc.name = 'npc-chen';
      npc.position.set(NPC_POS[0], 0, NPC_POS[2]);
      const npcBody = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.3, 1.4, 10), new THREE.MeshLambertMaterial({ color: 0x4a5568 }));
      npcBody.position.y = 0.8;
      const npcHead = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), new THREE.MeshLambertMaterial({ color: 0xc8a080 }));
      npcHead.position.y = 1.68;
      const npcNose = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.18), new THREE.MeshLambertMaterial({ color: 0x3a342c }));
      npcNose.position.set(0, 1.68, 0.22);
      npc.add(npcBody, npcHead, npcNose);
      root.add(npc);
      physics.addBody(
        'npc-chen-body',
        { shape: { kind: 'cylinder', halfHeight: 0.85, radius: 0.34 }, body: 'static' },
        { position: [NPC_POS[0], 0.85, NPC_POS[2]] },
      );

      // Quarters furniture.
      box('desk', [1.5, 0.78, 0.7], DESK_POS, woodMaterial);
      box('bunk', [0.95, 0.45, 2.0], [-2.5, 0, -2.0], darkMaterial);
      box('stove', [0.6, 0.95, 0.6], [2.4, 0, -4.0], darkMaterial);
      box('bookcase', [0.5, 1.6, 0.9], [2.7, 0, -0.5], woodMaterial);
      box('side-table', [0.7, 0.9, 0.5], [3.0, 0, 5.5], woodMaterial);

      // The stuck drawer: a free group that slides open in update().
      const drawerGroup = new THREE.Group();
      drawerGroup.name = 'desk-drawer';
      drawerGroup.position.set(DESK_POS[0], 0.58, DRAWER_BASE_Z);
      const drawerBox = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.2, 0.34), woodMaterial);
      const drawerPull = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.05), darkMaterial);
      drawerPull.position.set(0, 0, 0.19);
      drawerGroup.add(drawerBox, drawerPull);
      if (progress.value.drawerOpened) drawerGroup.position.z = DRAWER_BASE_Z + DRAWER_SLIDE;
      root.add(drawerGroup);

      // Logbook page props (visual only; visibility mirrors collected pages).
      const pageMaterial = new THREE.MeshLambertMaterial({ color: 0xe8e2d2, side: THREE.DoubleSide });
      const makePageProp = (id: PageId, parent: THREE.Object3D, local: Vec3): THREE.Mesh => {
        const page = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.24), pageMaterial);
        page.name = `page-prop-${id}`;
        page.rotation.x = -Math.PI / 2;
        page.position.set(local[0], local[1], local[2]);
        parent.add(page);
        return page;
      };
      const deskProp = makePageProp('desk', root, PAGE_DESK_POS);
      const drawerProp = makePageProp('drawer', drawerGroup, [0.16, 0.12, 0.04]);
      const shelfProp = makePageProp('shelf', root, PAGE_SHELF_POS);
      const pageProps: Record<PageId, THREE.Mesh> = { desk: deskProp, drawer: drawerProp, shelf: shelfProp };
      const syncPageProps = (): void => {
        for (const id of PAGE_IDS) pageProps[id].visible = !progress.value.pages.includes(id);
      };
      syncPageProps();

      // ---- player --------------------------------------------------------------
      const player = new FirstPersonController(physics, CHARACTER_TUNING, {
        id: 'player',
        spawn: checkpoint ? checkpoint.player : SPAWN,
        bindings: { moveYAxis: 'move.z' },
      });
      ctx.scope.own(player);
      root.add(player.object);
      let viewYaw = checkpoint ? checkpoint.viewYaw : SPAWN_YAW;
      let viewPitch = checkpoint ? checkpoint.viewPitch : 0;

      // ---- camera director -------------------------------------------------------
      const headRig = new HeadRig(() => ({ position: player.position, yaw: viewYaw, pitch: viewPitch }));
      const director = new CameraDirector(camera, headRig);
      director.attach(ctx);

      // ---- rain outside the window ----------------------------------------------
      const rain = new ParticleEmitter({
        scope: ctx.scope,
        maxParticles: 500,
        rate: rainRate,
        lifetime: 0.55,
        speed: { min: 8, max: 10 },
        cone: { axis: [0, -1, 0], angle: 0.15 },
        gravity: [0, -2, 0],
        size: { start: 1.8, end: 1.4 },
        color: { start: 0x8ea9c8, end: 0x5d7591 },
        reduceMotion,
      });
      rain.object.position.set(RAIN_POS[0], RAIN_POS[1], RAIN_POS[2]);
      root.add(rain.object);

      // ---- lamp glow presentation (idempotent; also applied after restore) ------
      let glowApplied = false;
      const applyLampGlow = (): void => {
        if (glowApplied) return;
        glowApplied = true;
        lensMaterial.color.set(0xffd9a0);
        beamMaterial.color.set(0xffe6b8);
        lampLight.intensity = 26;
      };

      // ---- dialogue runner ---------------------------------------------------------
      const dialogue = new DialogueRunner({ nodes: DIALOGUE_NODES, commit: ctx, eventNamespace: 'keeper' });
      dialogue.onChange((view: DialogueView | null) => {
        if (!view) {
          dialogueEl.textContent = '';
          // The work never cancels mid-run; a cleared view means the tree
          // completed. The talk is one durable fact + one objective unit.
          if (!progress.value.talkDone) {
            progress.update((s) => ({ ...s, talkDone: true }));
            ctx.commit('keeper.talk-done', {}, 'keeper:talk-done');
            tracker.progress('finish-handover', 1, 'keeper:finish-handover:done');
          }
          syncObjectivesHud();
          return;
        }
        hud.subtitle.show(view.text, { speaker: view.speaker, durationMs: 6000 });
        audio.play('dialogue-blip');
        dialogueEl.textContent =
          view.options.length > 0 ? view.options.map((o) => `${o.index + 1} · ${o.label}`).join('\n') : '';
      });

      // ---- outro timeline (skippable; declared policy) ----------------------------
      const outroRig = new FixedRig('outro-lamp', {
        position: [2.6, 2.1, 0.7],
        lookAt: [LAMP_POS[0], 2.3, LAMP_POS[2]],
      });
      const outro = timeline('keeper-outro', {
        cancelPolicy: 'finish',
        endState: {
          natural: 'outro cue committed exactly once, camera handed back to the player head',
          skip: 'same end state as natural completion (finish policy fast-forwards)',
        },
      });
      outro.add(cameraCut(outroRig), wait(4.6), cue('keeper.outro-done', {}, { eventId: 'keeper:outro:done' }), wait(0.6));
      let outroHandle: TimelineHandle | null = null;
      const startOutro = (): void => {
        if (outroHandle !== null) return;
        outroHandle = outro.run(ctx, { camera: director });
      };
      const outroActive = (): boolean =>
        outroHandle !== null && (outroHandle.state === 'running' || outroHandle.state === 'paused');

      // ---- interaction -------------------------------------------------------------
      const interaction = createInteractionSystem({ action: 'interact' });

      interaction.register({
        id: 'npc-chen',
        getPosition: () => [NPC_POS[0], 1.0, NPC_POS[2]],
        radius: 2.2,
        enabled: () => !progress.value.talkDone,
        onInteract: () => {
          if (!dialogue.running) void dialogue.start('arrive');
        },
      });

      const collectPage = (pageId: PageId): void => {
        const added = inventory.add('logbook-page');
        if (!added.ok) {
          ctx.report({ code: 'INVENTORY_REJECTED', message: added.reason, phase: 'mechanics' });
          return;
        }
        progress.update((s) => ({ ...s, pages: [...new Set([...s.pages, pageId])] }));
        ctx.commit('keeper.page-collected', { page: pageId }, `keeper:page:${pageId}:collected`);
        tracker.progress('gather-pages', 1, `keeper:gather-pages:${pageId}`);
        audio.play('page-rustle');
        hud.subtitle.queueLine(PAGE_LINES[pageId], { durationMs: 2800 });
        pageProps[pageId].visible = false;
        syncObjectivesHud();
      };

      interaction.register({
        id: 'page-desk',
        getPosition: () => PAGE_DESK_POS,
        radius: 1.5,
        enabled: () => !progress.value.pages.includes('desk'),
        onInteract: () => collectPage('desk'),
      });
      interaction.register({
        id: 'page-shelf',
        getPosition: () => PAGE_SHELF_POS,
        radius: 1.6,
        enabled: () => !progress.value.pages.includes('shelf'),
        onInteract: () => collectPage('shelf'),
      });
      // The page in the drawer is unreachable until the drawer is open: while
      // the drawer is closed this interactable is disabled and the drawer
      // itself is the only candidate at the desk front.
      interaction.register({
        id: 'page-drawer',
        getPosition: () => [
          drawerGroup.position.x + 0.16,
          drawerGroup.position.y + 0.12,
          drawerGroup.position.z + 0.04,
        ],
        radius: 1.4,
        enabled: () => progress.value.drawerOpened && !progress.value.pages.includes('drawer'),
        onInteract: () => collectPage('drawer'),
      });
      interaction.register({
        id: 'desk-drawer',
        getPosition: () => [DESK_POS[0], 0.68, DRAWER_BASE_Z + 0.04],
        radius: 1.5,
        enabled: () => !progress.value.drawerOpened,
        onInteract: () => {
          const tugs = progress.value.drawerTugs + 1;
          if (tugs >= drawerTugsRequired) {
            progress.update((s) => ({ ...s, drawerTugs: tugs, drawerOpened: true }));
            ctx.commit('keeper.drawer-opened', {}, 'keeper:drawer-opened');
            audio.play('drawer-scrape');
            hud.subtitle.show('再一使劲——抽屉开了。', { durationMs: 2600 });
          } else {
            progress.update((s) => ({ ...s, drawerTugs: tugs }));
            audio.play('drawer-jam');
            hud.subtitle.show('抽屉卡住了，纹丝不动。', { durationMs: 2600 });
          }
        },
      });

      const igniteLamp = (): void => {
        progress.update((s) => ({ ...s, lampLit: true }));
        ctx.commit('keeper.lamp-lit', {}, 'keeper:lamp-lit');
        audio.play('lamp-ignite');
        audio.playAt('foghorn', ctx.clock.time + 1.4, { volume: 0.9 });
        flash.flash(0xffe2b0, 0.8, 0.5);
        hud.prompt.hide();
        hud.subtitle.queueLine('火苗蹿起，透镜慢慢亮了起来。', { durationMs: 3200 });
        startOutro();
        syncObjectivesHud();
      };
      interaction.register({
        id: 'lamp-console',
        getPosition: () => CONSOLE_POS,
        radius: 1.9,
        // The declared chain: handover done + all three pages -> the console.
        enabled: () =>
          progress.value.talkDone && tracker.isComplete('gather-pages') && !progress.value.lampLit,
        onInteract: igniteLamp,
      });

      // ---- checkpoint commit replay (facts carry over; presentation does not) -----
      if (checkpoint) {
        for (const fact of checkpoint.commits) {
          ctx.commit(fact.name, fact.payload, fact.eventId);
        }
      }

      // ---- presentation reactions to committed facts --------------------------------
      ctx.onCommit((envelope) => {
        if (envelope.name === 'keeper.ending-accepts' || envelope.name === 'keeper.ending-warm') {
          const ending = (envelope.payload as { ending?: unknown }).ending;
          if (ending === 'accepts' || ending === 'warm') {
            progress.update((s) => ({ ...s, ending }));
          }
        } else if (envelope.name === 'keeper.lamp-lit') {
          applyLampGlow();
        } else if (envelope.name === 'keeper.outro-done') {
          // Exactly-once completion: the tracker short-circuits when the
          // restored snapshot already shows the objective complete.
          tracker.progress('light-the-lamp', 1, 'keeper:light-the-lamp:done');
          hud.subtitle.show('雨还在下，但海上有了光。', { speaker: '旁白', durationMs: 6000 });
          syncObjectivesHud();
        }
      });

      // ---- phase wiring ----------------------------------------------------------------
      ctx.onPhase('input', () => {
        mapper.step();
      });
      ctx.onPhase('intent', (frame) => {
        // Conversation and outro freeze the walker; the camera stays owned by
        // the active rig (head, or the outro rig while the timeline runs).
        if (dialogue.running || outroActive()) {
          player.update(EMPTY_ACTION_STATE, viewYaw, frame.dt);
          return;
        }
        const snap = mapper.snapshot();
        viewYaw -= snap.axis('look.x');
        viewPitch = Math.min(1.45, Math.max(-1.45, viewPitch - snap.axis('look.y')));
        player.update(snap, viewYaw, frame.dt);
      });
      ctx.onPhase('mechanics', () => {
        if (outroActive()) {
          hud.prompt.hide();
          // Public skip path: the Escape edge drives the declared finish policy.
          if (mapper.snapshot().pressed('skip')) outroHandle!.skip();
          return;
        }
        const wasRunning = dialogue.running;
        if (wasRunning) {
          // Input edges drive the runner's public advance/choose API. The edge
          // that STARTED the dialogue (this step's interact press) must not
          // also advance it, hence the wasRunning guard.
          hud.prompt.show('按 E 继续 · 按 1 / 2 选择');
          const view = dialogue.current;
          const snap = mapper.snapshot();
          if (view && view.options.length > 0) {
            if (snap.pressed('dialogue.1')) dialogue.choose(0);
            else if (snap.pressed('dialogue.2')) dialogue.choose(1);
          } else if (view && snap.pressed('interact')) {
            dialogue.advance();
          }
          return;
        }
        const p = player.position;
        const res = interaction.update(0, { position: [p[0], p[1] + 0.1, p[2]] }, mapper.snapshot());
        const id = res.candidateId;
        if (id === 'npc-chen') hud.prompt.show('按 E 与陈师傅交谈');
        else if (id === 'page-desk' || id === 'page-shelf') hud.prompt.show('按 E 拾起日志页');
        else if (id === 'page-drawer') hud.prompt.show('按 E 取出日志页');
        else if (id === 'desk-drawer') hud.prompt.show('按 E 拉开抽屉');
        else if (id === 'lamp-console') hud.prompt.show('按 E 点亮灯器');
        else hud.prompt.hide();
        if (dialogue.running) hud.prompt.show('按 E 继续 · 按 1 / 2 选择');
      });
      let entryRevealed = false;
      fade.fadeOut(0); // every session starts covered and reveals once
      ctx.onPhase('present', (frame) => {
        if (!entryRevealed) {
          entryRevealed = true;
          fade.fadeIn(0.8);
          hud.subtitle.queueLine('雨夜。你值灯塔的最后一班。', { speaker: '旁白', durationMs: 4200 });
        }
        hud.subtitle.tick(frame.dt * 1000);
        audio.update(ctx.clock.time);
        const p = player.position;
        audio.setListenerPosition([p[0], p[1] + 0.72, p[2]]);
        rain.update(frame.dt);
        fade.update(frame.dt);
        flash.update(frame.dt);
        syncObjectivesHud();
      });

      // ---- per-step module update (runs in the mechanics phase, after hooks) --------
      const update = (frame: { dt: number }): void => {
        const dt = frame.dt;
        // Procedural lamp: rotation is a pure function of the committed lampLit
        // fact, so a restored session resumes mid-sweep exactly.
        if (progress.value.lampLit) {
          rotor.rotation.y += dt * lampSpeed;
          applyLampGlow();
        }
        // Stuck drawer slides open after its last tug (damped slide).
        const drawerTarget = DRAWER_BASE_Z + (progress.value.drawerOpened ? DRAWER_SLIDE : 0);
        const dz = drawerTarget - drawerGroup.position.z;
        if (Math.abs(dz) > 1e-4) {
          drawerGroup.position.z += dz * Math.min(1, dt * 5);
        }
        // The visitor shifts his weight while he waits.
        npc.rotation.y = Math.sin(ctx.clock.time * 0.7) * 0.06;
        // Restore-safe: a checkpoint saved between ignition and the outro cue
        // still reaches the completion cue in the fresh session.
        if (progress.value.lampLit && outroHandle === null && !tracker.isComplete('light-the-lamp')) {
          startOutro();
        }
      };

      // ---- author parameters (live apply) ------------------------------------------------
      const applyParameter: Record<string, (value: unknown) => void> = {
        'keeper.rain-rate': (value) => {
          rainRate = Number(value);
          rain.setRate(rainRate);
        },
        'keeper.lamp-speed': (value) => {
          lampSpeed = Number(value);
        },
        'keeper.drawer-tugs': (value) => {
          drawerTugsRequired = Number(value);
        },
      };
      const params = exposeParameters(
        describeParameters().map((def) => ({ ...def, apply: applyParameter[def.authorId] })),
      );

      const handles: KeeperHandles = {
        physics,
        player,
        tracker,
        progress,
        inventory,
        dialogue,
        interaction,
        params,
        hud,
        audio,
        camera,
        director,
        fade,
        flash,
        rain,
        objectivesElement: objectivesEl,
        dialogueElement: dialogueEl,
        lamp: {
          lit: () => progress.value.lampLit,
          rotorAngle: () => rotor.rotation.y,
          speed: () => lampSpeed,
        },
        drawer: {
          opened: () => progress.value.drawerOpened,
          tugs: () => progress.value.drawerTugs,
          z: () => drawerGroup.position.z,
        },
        outro: {
          state: () => (outroHandle ? outroHandle.state : 'none'),
          skipPolicy: "finish (timeline cancelPolicy 'finish'): skip() fast-forwards to the identical end state",
        },
        recordedCommits,
        get viewYaw() {
          return viewYaw;
        },
        saveCheckpoint(): KeeperCheckpoint {
          if (dialogue.running) {
            throw new CreativeError(
              'BAD_STATE',
              'cannot saveCheckpoint while a dialogue is running; finish the conversation first',
              { phase: 'command' },
            );
          }
          return {
            checkpointSchemaVersion: CHECKPOINT_SCHEMA_VERSION,
            simTime: ctx.clock.time,
            player: [...player.position] as Vec3,
            viewYaw,
            viewPitch,
            state: progress.snapshot(),
            objectives: tracker.snapshot(),
            inventory: inventory.snapshot(),
            commits: recordedCommits.map((f) => ({ ...f })),
          };
        },
        unlockAudio(): void {
          audio.unlock();
        },
      };

      const instance: SceneInstance & { handles: KeeperHandles } = { root, update, handles };
      module.handles = handles;
      return instance;
    },
  };
  return module;
}
