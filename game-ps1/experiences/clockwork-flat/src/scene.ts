/**
 * 钟鸣陋室 · Clockwork Flat — an original indoor mechanism-exploration scene.
 *
 * A small irregular flat in three connected spaces:
 *   A 门厅 (entry hall, ground)  →  B 中厅 (main hall, ground)  →  C 阁楼 (loft)
 * Progress is gated twice:
 *   1. a SlidingDoor blocks the A→B doorway until the player interacts with
 *      the door-release pedestal beside it;
 *   2. a MovingPlatform lift is the only way up to the loft (C sits at y=2.4).
 * Reaching the bronze bell in the loft completes the objective.
 *
 * The module is plain TS/Three over the creative runtime systems:
 * host phases (input → intent → physics → mechanics → present), physics +
 * kinematic mechanisms, first-person controller over an ActionMapper,
 * interaction system, timeline intro (skippable, declared policy), DOM HUD,
 * AudioPlayer with an injectable backend, GameState/Objectives checkpoints,
 * and exposeParameters for author tooling.
 *
 * Offline runs inject HeadlessInputDevice / RecordingBackend / FakeDocument;
 * a browser host injects the DOM-backed equivalents instead.
 */
import * as THREE from './three.ts';
import type { SceneContext, SceneInstance } from '../../../src/creative/core/context.ts';
import type { ColliderDesc, Vec3 } from '../../../src/creative/core/spatial.ts';
import { CreativeError } from '../../../src/creative/core/errors.ts';
import type { ActionState } from '../../../src/creative/core/input-types.ts';
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
import { MovingPlatform, SlidingDoor, driveMechanism } from '../../../src/creative/physics/mechanisms.ts';
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
import { cameraCut, cue, timeline, wait } from '../../../src/creative/animation/timeline.ts';
import type { TimelineHandle, TimelineState } from '../../../src/creative/animation/timeline.ts';

// ---------------------------------------------------------------------------
// Layout constants (XZ plan; +X east, +Z toward the door wall / "north" here)
// ---------------------------------------------------------------------------

const WALL_HEIGHT = 3.2;
const WALL_THICKNESS = 0.24;
const DOOR_WALL_Z = -5.2;
const DOOR_HEIGHT = 2.2;
const DOOR_WIDTH_DEFAULT = 1.4;
const DOOR_SECONDS_DEFAULT = 1.2;
const PLATFORM_SECONDS_DEFAULT = 3;
const LIFT_DWELL = 1;

const FLOOR_A: ReadonlyArray<readonly [number, number]> = [[-3.4, -5.2], [-3.4, -8.8], [1.8, -9.4], [3.4, -7.6], [3.4, -5.2]];
const FLOOR_B: ReadonlyArray<readonly [number, number]> = [[-3.4, -5.2], [-3.0, 0.8], [5.0, 0.4], [4.6, -5.2]];
// The loft floor overhangs the shaft by 0.1: the deck underlaps it, so the
// landing is a clean 1 cm step-up instead of a flush deck/floor straddle.
const FLOOR_C: ReadonlyArray<readonly [number, number]> = [[3.9, -2.2], [8.4, -1.8], [9.0, 1.6], [3.9, 1.2]];
const LOFT_Y = 2.4;

const SPAWN: Vec3 = [0, 1.0, -7.5];
const SPAWN_YAW = Math.PI; // face +Z, straight at the door wall
const SWITCH_POS: Vec3 = [0.9, 1.0, -6.1]; // door-release pedestal, in front of the door
const LIFT_FROM: Vec3 = [3.2, -0.11, 0]; // deck top 1 cm under floor level: a flush
const LIFT_TO: Vec3 = [3.2, 2.29, 0]; //     deck in the walled shaft blocks the walker
const LIFT_SIZE: Vec3 = [1.6, 0.2, 1.6];
const BELL_POS: Vec3 = [7.6, LOFT_Y, 0];

const CHARACTER_TUNING: CharacterTuning = {
  speed: 3,
  radius: 0.3,
  height: 1.8,
  gravity: 9.81,
  jumpSpeed: 5,
  maxSlopeAngle: (45 * Math.PI) / 180,
  maxStepHeight: 0.4,
};

const CHECKPOINT_SCHEMA_VERSION = 1;

export interface ProgressState {
  doorOpened: boolean;
  introDone: boolean;
}

export interface RecordedCommit {
  name: string;
  payload: unknown;
  eventId: string;
}

/** JSON-serializable mid-route checkpoint (matches checkpointSchemaVersion 1). */
export interface ClockworkCheckpoint {
  checkpointSchemaVersion: typeof CHECKPOINT_SCHEMA_VERSION;
  simTime: number;
  player: Vec3;
  viewYaw: number;
  state: StateSnapshot<ProgressState>;
  objectives: ObjectiveSnapshot;
  commits: RecordedCommit[];
}

/** Test/tool-facing surface; a browser host uses the same object for wiring. */
export interface ClockworkHandles {
  readonly physics: PhysicsWorld;
  readonly player: FirstPersonController;
  readonly tracker: ObjectiveTracker;
  readonly progress: GameState<ProgressState, ProgressState>;
  readonly params: ParameterRegistry;
  readonly hud: Hud;
  readonly audio: AudioPlayer;
  readonly camera: THREE.PerspectiveCamera;
  readonly director: CameraDirector;
  readonly door: SlidingDoor;
  readonly platform: MovingPlatform;
  readonly recordedCommits: readonly RecordedCommit[];
  saveCheckpoint(): ClockworkCheckpoint;
  skipIntro(): void;
  unlockAudio(): void;
  introState(): TimelineState | 'none';
  readonly introSkipPolicy: string;
}

export interface ClockworkFlatOptions {
  /** Input source; defaults to a DOM device when a window exists (browser). */
  device?: InputDevice;
  /** Audio backend; RecordingBackend in headless runs, RealBackend in a page. */
  audioBackend?: AudioBackend;
  /** Document for the HUD; FakeDocument in headless runs. */
  document?: DocumentLike;
  /** Element the HUD appends to; defaults to the document-provided parent. */
  hudParent?: DomElementLike;
  camera?: THREE.PerspectiveCamera;
  /** Mid-route checkpoint from saveCheckpoint() to restore in a fresh session. */
  checkpoint?: unknown;
}

export interface ClockworkFlatModule {
  create(ctx: SceneContext): Promise<SceneInstance & { handles: ClockworkHandles }>;
  /** Populated once create() resolves. */
  handles?: ClockworkHandles;
}

function liftCycle(seconds: number): number {
  return 2 * (seconds + LIFT_DWELL);
}

/**
 * Static author-parameter declaration for the engine-cli author tools
 * (see the note above applyParameter in create()). Pure data + validate
 * predicates: no SceneContext, no gameplay, safe to call without create().
 */
export function describeParameters(): ParameterDef[] {
  return [
    {
      authorId: 'clockwork.door-width',
      schemaVersion: 1,
      description: '滑门门板宽度（米）；重建机关后生效',
      value: DOOR_WIDTH_DEFAULT,
      validate(value: unknown) {
        return typeof value === 'number' && value >= 0.9 && value <= 2.0 ? true : 'door-width 需在 0.9..2.0 米之间';
      },
    },
    {
      authorId: 'clockwork.door-seconds',
      schemaVersion: 1,
      description: '滑门开启耗时（秒）；重建机关后生效',
      value: DOOR_SECONDS_DEFAULT,
      validate(value: unknown) {
        return typeof value === 'number' && value >= 0.3 && value <= 3 ? true : 'door-seconds 需在 0.3..3 秒之间';
      },
    },
    {
      authorId: 'clockwork.platform-seconds',
      schemaVersion: 1,
      description: '升降平台单程耗时（秒）；重建机构并保持当前相位',
      value: PLATFORM_SECONDS_DEFAULT,
      validate(value: unknown) {
        return typeof value === 'number' && value >= 1 && value <= 6 ? true : 'platform-seconds 需在 1..6 秒之间';
      },
    },
  ];
}

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

/**
 * Minimal proximity interaction: nearest enabled candidate within radius,
 * dispatched once per 'interact' press edge (edges are per-step in the mapper).
 *
 * CAPABILITY_GAP workaround: the engine's creative/interaction/system.ts has
 * the same semantics (plus facing/occlusion gates) but is not loadable under
 * Node's strip-only TS — it declares a constructor parameter property, which
 * is non-erasable syntax, and no engine test imports that file. Until the
 * engine fixes that one line, this local equivalent keeps the work loadable;
 * swap back to createInteractionSystem() once it loads.
 */
interface LocalInteractable {
  id: string;
  getPosition(): Vec3;
  radius: number;
  enabled?: () => boolean;
  onInteract(): void;
}

function createLocalInteraction() {
  const interactables = new Map<string, LocalInteractable>();
  let focusedId: string | null = null;
  return {
    get focusedId(): string | null {
      return focusedId;
    },
    register(item: LocalInteractable): void {
      interactables.set(item.id, item);
    },
    /** Returns the focused candidate id; dispatches on the interact press edge. */
    update(source: Vec3, actions: ActionState): string | null {
      let best: LocalInteractable | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const item of interactables.values()) {
        if (item.enabled && !item.enabled()) continue;
        const p = item.getPosition();
        const d = Math.hypot(p[0] - source[0], p[1] - source[1], p[2] - source[2]);
        if (d <= item.radius && d < bestDistance) {
          best = item;
          bestDistance = d;
        }
      }
      focusedId = best?.id ?? null;
      if (best && actions.pressed('interact')) best.onInteract();
      return focusedId;
    },
  };
}

function makeSynthClip(build: (out: AudioNodeLike, when: number, backend: AudioBackend) => SynthVoice | void) {
  return { kind: 'synth' as const, render: build };
}

/** Deterministic synth clips — no sampled assets, scheduling is replay-observable. */
function defaultClips() {
  return {
    'switch-clunk': makeSynthClip((out, when, backend) => {
      const osc = backend.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(140, when);
      const gain = backend.createGain();
      gain.gain.setValueAtTime(0.5, when);
      gain.gain.linearRampToValueAtTime(0, when + 0.15);
      osc.connect(out);
      osc.start(when);
      osc.stop(when + 0.15);
      return { stop: (t: number) => osc.stop(t) };
    }),
    'door-groan': makeSynthClip((out, when, backend) => {
      const osc = backend.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(80, when);
      osc.frequency.linearRampToValueAtTime(38, when + 1.4);
      const gain = backend.createGain();
      gain.gain.setValueAtTime(0, when);
      gain.gain.linearRampToValueAtTime(0.4, when + 0.2);
      gain.gain.linearRampToValueAtTime(0, when + 1.4);
      osc.connect(out);
      osc.start(when);
      osc.stop(when + 1.4);
      return { stop: (t: number) => osc.stop(t) };
    }),
    'bell-chime': makeSynthClip((out, when, backend) => {
      const gain = backend.createGain();
      gain.gain.setValueAtTime(0, when);
      gain.gain.linearRampToValueAtTime(0.5, when + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, when + 2.5);
      gain.connect(out);
      const stops: Array<(t: number) => void> = [];
      for (const freq of [660, 990]) {
        const osc = backend.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, when);
        osc.connect(gain);
        osc.start(when);
        osc.stop(when + 2.5);
        stops.push((t: number) => osc.stop(t));
      }
      return { stop: (t: number) => stops.forEach((s) => s(t)) };
    }),
  };
}

function readCheckpoint(raw: unknown): ClockworkCheckpoint | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object') {
    throw new CreativeError('BAD_SNAPSHOT', 'clockwork checkpoint must be an object', { phase: 'create' });
  }
  const cp = raw as ClockworkCheckpoint;
  if (cp.checkpointSchemaVersion !== CHECKPOINT_SCHEMA_VERSION) {
    throw new CreativeError(
      'SCHEMA_VERSION_MISMATCH',
      `clockwork checkpoint schemaVersion ${String(cp.checkpointSchemaVersion)} does not match ${CHECKPOINT_SCHEMA_VERSION}`,
      { phase: 'create' },
    );
  }
  return cp;
}

/**
 * Build the SceneModule. The factory takes injected devices so one module
 * runs both in a browser page and in the headless offline replay harness.
 */
export function createClockworkFlatModule(options: ClockworkFlatOptions = {}): ClockworkFlatModule {
  const module: ClockworkFlatModule = {
    async create(ctx: SceneContext): Promise<SceneInstance & { handles: ClockworkHandles }> {
      const checkpoint = readCheckpoint(options.checkpoint);
      const physics = await installPhysics(ctx);
      const root = new THREE.Group();
      root.name = 'clockwork-flat';

      // ---- restore-declared state (wholesale; unknown shapes reject) --------
      const progress = createState<ProgressState>({
        schemaVersion: 1,
        metadata: { recovery: 'checkpoint', name: 'clockwork-progress' },
        initial: { doorOpened: false, introDone: false },
        serialize: (s) => ({ ...s }),
        restore: (data) => ({ doorOpened: Boolean(data?.doorOpened), introDone: Boolean(data?.introDone) }),
      });
      const tracker = new ObjectiveTracker({
        objectives: [
          { id: 'start-mechanism', target: 1, title: '启动门边机关' },
          { id: 'reach-bell', target: 1, title: '让钟重新走起来' },
        ],
        commit: ctx,
      });
      if (checkpoint) {
        progress.restore(checkpoint.state);
        tracker.restore(checkpoint.objectives);
      }

      // ---- commit validators + the session fact log (checkpoint payload) ----
      ctx.registerEventValidator('clockwork.*', (payload) =>
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

      // ---- geometry ------------------------------------------------------------
      const material = new THREE.MeshLambertMaterial({ color: 0x9b958a });
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
      const perimeter = (
        points: ReadonlyArray<readonly [number, number]>,
        skipClosingEdge: boolean,
        heights?: readonly number[],
      ): SceneBuild[] => {
        const builds: SceneBuild[] = [];
        const edgeCount = skipClosingEdge ? points.length - 1 : points.length;
        for (let i = 0; i < edgeCount; i += 1) {
          const [x0, z0] = points[i];
          const [x1, z1] = points[(i + 1) % points.length];
          const length = Math.hypot(x1 - x0, z1 - z0);
          builds.push(
            wallSegment({
              length,
              height: heights?.[i] ?? WALL_HEIGHT,
              thickness: WALL_THICKNESS,
              material,
              position: [(x0 + x1) / 2, 0, (z0 + z1) / 2],
              yaw: Math.atan2(-(z1 - z0), x1 - x0),
            }),
          );
        }
        return builds;
      };

      mount(floorPolygon(FLOOR_A, { material }), 'floor-a');
      mount(floorPolygon(FLOOR_B, { material }), 'floor-b');
      mount(floorPolygon(FLOOR_C, { material }), 'floor-c', LOFT_Y);
      for (const build of perimeter(FLOOR_A, true)) mount(build, 'wall-a');
      // Hall B's north and east edges run under the loft floor; cap them at the
      // loft underside so they don't rise through the walking surface up there.
      for (const build of perimeter(FLOOR_B, true, [WALL_HEIGHT, 2.35, 2.35])) mount(build, 'wall-b');
      for (const build of perimeter(FLOOR_C, true)) mount(build, 'wall-c', LOFT_Y);

      // Loft west wall (the skipped closing edge of FLOOR_C) with the lift
      // opening: the deck docks flush against it at the top of the shaft.
      mount(
        wallWithOpening({
          length: 3.4,
          height: WALL_HEIGHT,
          thickness: WALL_THICKNESS,
          material,
          position: [3.9, LOFT_Y, -0.5],
          yaw: Math.PI / 2,
          opening: { kind: 'custom', width: 2.0, height: WALL_HEIGHT, offsetX: -0.5 },
        }),
        'loft-west',
      );

      // Door wall between hall A and hall B; its opening is the only way through.
      // It spans both rooms' closing edges: A ends at x=3.4, B at x=4.6.
      let doorWidth = DOOR_WIDTH_DEFAULT;
      mount(
        wallWithOpening({
          length: 8.0,
          height: WALL_HEIGHT,
          thickness: WALL_THICKNESS,
          material,
          position: [0.6, 0, DOOR_WALL_Z],
          opening: { kind: 'door', width: doorWidth, height: DOOR_HEIGHT, offsetX: -0.6 },
        }),
        'door-wall',
      );

      // Threshold plate across the doorway. The two room floors are separate
      // trimeshes abutting under the door wall, and the kinematic character
      // catches on the exposed seam edge; a thin box plate (a real door
      // threshold) with a 1 cm lip makes the crossing smooth. The lip must
      // stay near 1 cm: a flush plate in a walled doorway makes the character
      // controller treat the floor itself as an obstacle.
      mount(
        {
          object: (() => {
            const g = new THREE.Group();
            g.name = 'door-threshold';
            const mesh = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.04, 1.0), material);
            mesh.position.set(0, -0.01, DOOR_WALL_Z);
            g.add(mesh);
            return g;
          })(),
          colliders: [
            { shape: { kind: 'box', halfExtents: [1.0, 0.02, 0.5], offset: [0, -0.01, DOOR_WALL_Z] }, body: 'static' },
          ],
        },
        'threshold',
      );

      // Lift shaft enclosure: side cheeks at z=±0.8 and a fascia under the
      // loft edge so the ground floor cannot walk out under the loft floor.
      mount(wallSegment({ length: 2.2, height: WALL_HEIGHT, thickness: WALL_THICKNESS, material, position: [3.5, 0, 0.92], yaw: 0 }), 'shaft-s');
      mount(wallSegment({ length: 2.2, height: WALL_HEIGHT, thickness: WALL_THICKNESS, material, position: [3.5, 0, -0.92], yaw: 0 }), 'shaft-n');
      mount(wallSegment({ length: 3.4, height: 2.35, thickness: WALL_THICKNESS, material, position: [4.12, 0, -0.5], yaw: Math.PI / 2 }), 'fascia');

      // Goal: reaching the bronze bell. A physics sensor would seem natural,
      // but the kinematic character controller treats sensor colliders as
      // obstacles (its shapecast has no sensor filter), so a walk-through
      // goal volume is authored as a plain proximity check instead.
      const BELL_TRIGGER_RADIUS = 1.5;

      // Props (visual only): the pedestal switch and the loft bell.
      const pedestal = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.0, 0.3), material);
      pedestal.name = 'door-switch-pedestal';
      pedestal.position.set(SWITCH_POS[0], 0.5, SWITCH_POS[2]);
      root.add(pedestal);
      const bell = new THREE.Group();
      bell.name = 'bronze-bell';
      const bellBodyMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.42, 0.6, 12), new THREE.MeshLambertMaterial({ color: 0x8a6f3a }));
      bellBodyMesh.position.y = 1.5;
      const bellPost = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.3, 0.12), material);
      bellPost.position.y = 0.65;
      bell.add(bellPost, bellBodyMesh);
      bell.position.set(BELL_POS[0], BELL_POS[1], BELL_POS[2]);
      root.add(bell);

      // ---- mechanisms (transform authority lives in the mechanism classes) ----
      let doorSeconds = DOOR_SECONDS_DEFAULT;
      let platformSeconds = PLATFORM_SECONDS_DEFAULT;
      let door = new SlidingDoor(physics, {
        id: 'clockwork-door',
        width: doorWidth,
        height: DOOR_HEIGHT,
        thickness: 0.15,
        closedPosition: [0, DOOR_HEIGHT / 2, DOOR_WALL_Z],
        openOffset: [0, DOOR_HEIGHT + 0.2, 0],
        duration: doorSeconds,
        startOpen: progress.value.doorOpened,
      });
      ctx.scope.own(door);
      driveMechanism(physics, door, ctx.clock.fixedDt);
      root.add(door.object);

      const liftPhaseStart = checkpoint ? (checkpoint.simTime % liftCycle(platformSeconds)) / liftCycle(platformSeconds) : 0;
      let platform = new MovingPlatform(physics, {
        id: 'clockwork-lift',
        size: LIFT_SIZE,
        from: LIFT_FROM,
        to: LIFT_TO,
        seconds: platformSeconds,
        dwell: LIFT_DWELL,
        start: liftPhaseStart,
      });
      ctx.scope.own(platform);
      driveMechanism(physics, platform, ctx.clock.fixedDt);
      root.add(platform.object);

      // ---- player --------------------------------------------------------------
      const player = new FirstPersonController(physics, CHARACTER_TUNING, {
        id: 'player',
        spawn: checkpoint ? checkpoint.player : SPAWN,
        bindings: { moveYAxis: 'move.z' },
      });
      ctx.scope.own(player);
      root.add(player.object);
      let viewYaw = checkpoint ? checkpoint.viewYaw : SPAWN_YAW;
      let viewPitch = 0;

      // ---- input -----------------------------------------------------------------
      let device: InputDevice;
      if (options.device) {
        device = options.device;
      } else if (typeof globalThis.window !== 'undefined') {
        device = new DomInputDevice({ scope: ctx.scope });
      } else {
        throw new CreativeError('INPUT_NO_DEVICE', 'clockwork-flat needs an input device (pass options.device)', {
          phase: 'create',
        });
      }
      const actionMap = mergeActionMaps(fpsDefaults, {
        actions: { skip: [{ kind: 'key', code: 'Escape' }] },
        axes: {},
      });
      const mapper = new ActionMapper(actionMap, device, { scope: ctx.scope });

      // ---- audio -----------------------------------------------------------------
      const backend = options.audioBackend ?? new RealBackend();
      const graph = new AudioGraph(backend);
      ctx.scope.own(graph);
      const audio = new AudioPlayer({ backend, graph, scope: ctx.scope, clips: defaultClips() });

      // ---- HUD -------------------------------------------------------------------
      const doc: DocumentLike = options.document ?? defaultDocument();
      const hud = new Hud(doc, options.hudParent);

      // ---- camera ------------------------------------------------------------------
      const camera = options.camera ?? new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 120);
      const headRig = new HeadRig(() => ({ position: player.position, yaw: viewYaw, pitch: viewPitch }));
      const director = new CameraDirector(camera, headRig);
      director.attach(ctx);

      // ---- interaction ---------------------------------------------------------------
      // Eye height ≈ the capsule center so the switch at y=1.0 is judged in reach.
      const interaction = createLocalInteraction();
      interaction.register({
        id: 'door-switch',
        getPosition: () => [SWITCH_POS[0], SWITCH_POS[1], SWITCH_POS[2]],
        radius: 2.2,
        enabled: () => !door.isOpen,
        onInteract: () => {
          audio.play('switch-clunk');
          door.open();
          progress.update((s) => ({ ...s, doorOpened: true }));
          ctx.commit('clockwork.door-opened', { door: 'clockwork-door' }, 'clockwork:door-opened');
          tracker.progress('start-mechanism', 1, 'clockwork:start-mechanism:progress:1');
        },
      });

      // ---- checkpoint commit replay (facts carry over; presentation does not) -------
      if (checkpoint) {
        for (const fact of checkpoint.commits) {
          ctx.commit(fact.name, fact.payload, fact.eventId);
        }
      }

      // ---- presentation reactions to committed facts ---------------------------------
      ctx.onCommit((envelope) => {
        if (envelope.name === 'clockwork.intro-begin') {
          hud.subtitle.queueLine('滴答……滴答……', { speaker: '旁白', durationMs: 2400 });
        } else if (envelope.name === 'clockwork.intro-door') {
          hud.subtitle.queueLine('所有的钟，都停在了十点一刻。', { speaker: '旁白', durationMs: 2600 });
        } else if (envelope.name === 'clockwork.door-opened') {
          hud.subtitle.queueLine('机关咬合，铁门升起来了。', { durationMs: 2600 });
          audio.play('door-groan');
        } else if (envelope.name === 'objectives.completed') {
          const objectiveId = (envelope.payload as { objectiveId?: unknown }).objectiveId;
          if (objectiveId === 'reach-bell') {
            hud.subtitle.queueLine('你合上了齿轮——钟，重新走了。', { durationMs: 3600 });
            audio.play('bell-chime');
          }
        }
      });

      // ---- intro timeline (skippable; declared policy) --------------------------------
      let introHandle: TimelineHandle | null = null;
      if (!progress.value.introDone) {
        const introRig = new FixedRig('intro-establishing', { position: [0, 2.7, -9.0], lookAt: [0.6, 0.9, -3.0] });
        const intro = timeline('clockwork-intro', {
          cancelPolicy: 'finish',
          endState: {
            natural: 'both intro cues committed, camera handed back to the player head',
            skip: 'same end state as natural completion (finish policy fast-forwards)',
          },
        });
        intro.add(
          cameraCut(introRig),
          cue('clockwork.intro-begin', { line: '滴答……滴答……' }, { eventId: 'clockwork:intro:begin' }),
          wait(2.4),
          cue('clockwork.intro-door', { line: '所有的钟，都停在了十点一刻。' }, { eventId: 'clockwork:intro:door' }),
          wait(2.2),
        );
        introHandle = intro.run(ctx, { camera: director });
      }
      const introActive = (): boolean =>
        introHandle !== null && (introHandle.state === 'running' || introHandle.state === 'paused');

      // ---- author parameters (M6 bindings; live-apply rebuilds the mechanism) --------
      //
      // Code stays the source of truth for author tooling: describeParameters()
      // is the STATIC declaration consumed by the engine-cli author commands
      // (tools/lib/author.mjs imports this module and calls it WITHOUT running
      // create(), so no gameplay logic executes). create() attaches the live
      // apply() closures — they need the built mechanisms — and hands the
      // defs to exposeParameters, keeping exactly one declaration site.
      // Author tools never parse this file as text and never regenerate it.
      const rebuildDoor = (width: number, seconds: number): void => {
        door.dispose();
        door = new SlidingDoor(physics, {
          id: 'clockwork-door',
          width,
          height: DOOR_HEIGHT,
          thickness: 0.15,
          closedPosition: [0, DOOR_HEIGHT / 2, DOOR_WALL_Z],
          openOffset: [0, DOOR_HEIGHT + 0.2, 0],
          duration: seconds,
          startOpen: progress.value.doorOpened,
        });
        ctx.scope.own(door);
        driveMechanism(physics, door, ctx.clock.fixedDt);
        root.add(door.object);
      };
      const rebuildPlatform = (seconds: number): void => {
        const oldCycle = liftCycle(platformSeconds);
        const phaseTime = ctx.clock.time % oldCycle;
        platform.dispose();
        platform = new MovingPlatform(physics, {
          id: 'clockwork-lift',
          size: LIFT_SIZE,
          from: LIFT_FROM,
          to: LIFT_TO,
          seconds,
          dwell: LIFT_DWELL,
          start: phaseTime / liftCycle(seconds),
        });
        ctx.scope.own(platform);
        driveMechanism(physics, platform, ctx.clock.fixedDt);
        root.add(platform.object);
      };
      const applyParameter: Record<string, (value: unknown) => void> = {
        'clockwork.door-width': (value) => {
          doorWidth = Number(value);
          rebuildDoor(doorWidth, doorSeconds);
        },
        'clockwork.door-seconds': (value) => {
          doorSeconds = Number(value);
          rebuildDoor(doorWidth, doorSeconds);
        },
        'clockwork.platform-seconds': (value) => {
          const next = Number(value);
          rebuildPlatform(next);
          platformSeconds = next;
        },
      };
      const params = exposeParameters(
        describeParameters().map((def) => ({ ...def, apply: applyParameter[def.authorId] })),
      );

      // ---- phase wiring ----------------------------------------------------------------
      ctx.onPhase('input', () => {
        mapper.step();
      });
      ctx.onPhase('intent', (frame) => {
        const snap: ActionState = mapper.snapshot();
        if (introActive()) {
          if (snap.pressed('skip')) introHandle?.skip();
          player.update(EMPTY_ACTION_STATE, viewYaw, frame.dt);
          return;
        }
        viewYaw -= snap.axis('look.x');
        viewPitch = Math.min(1.45, Math.max(-1.45, viewPitch - snap.axis('look.y')));
        player.update(snap, viewYaw, frame.dt);
      });
      ctx.onPhase('mechanics', (frame) => {
        void frame;
        // Record intro completion synchronously (natural or skipped): hosts may
        // step for a long time without yielding to microtasks.
        if (introHandle && !introActive() && !progress.value.introDone) {
          progress.update((s) => ({ ...s, introDone: true }));
        }
        if (introActive()) {
          hud.prompt.hide();
          return;
        }
        const p = player.position;
        const focused = interaction.update([p[0], p[1] + 0.1, p[2]], mapper.snapshot());
        if (focused === 'door-switch') hud.prompt.show('按 E 启动机关');
        else hud.prompt.hide();
      });
      ctx.onPhase('present', (frame) => {
        hud.subtitle.tick(frame.dt * 1000);
        audio.update(ctx.clock.time);
        const p = player.position;
        audio.setListenerPosition([p[0], p[1] + 0.72, p[2]]);
      });

      // ---- per-step module update (runs in the mechanics phase, after hooks) ------------
      const reachBell = (): void => {
        const result = tracker.progress('reach-bell', 1, 'clockwork:reach-bell:progress:1');
        if (result.applied) hud.prompt.hide();
      };
      const update = (): void => {
        const p = player.position;
        const dx = p[0] - BELL_POS[0];
        const dz = p[2] - BELL_POS[2];
        const dy = p[1] - (BELL_POS[1] + 0.9); // bell pedestal ≈ capsule height
        if (Math.hypot(dx, dz) < BELL_TRIGGER_RADIUS && Math.abs(dy) < 1.5) reachBell();
      };

      const handles: ClockworkHandles = {
        physics,
        player,
        tracker,
        progress,
        params,
        hud,
        audio,
        camera,
        director,
        get door() {
          return door;
        },
        get platform() {
          return platform;
        },
        recordedCommits,
        saveCheckpoint(): ClockworkCheckpoint {
          return {
            checkpointSchemaVersion: CHECKPOINT_SCHEMA_VERSION,
            simTime: ctx.clock.time,
            player: [...player.position] as Vec3,
            viewYaw,
            state: progress.snapshot(),
            objectives: tracker.snapshot(),
            commits: recordedCommits.map((f) => ({ ...f })),
          };
        },
        skipIntro(): void {
          introHandle?.skip();
        },
        unlockAudio(): void {
          audio.unlock();
        },
        introState(): TimelineState | 'none' {
          return introHandle ? introHandle.state : 'none';
        },
        introSkipPolicy: "finish (timeline cancelPolicy 'finish'): skip() fast-forwards to the identical end state",
      };

      const instance: SceneInstance & { handles: ClockworkHandles } = { root, update, handles };
      module.handles = handles;
      return instance;
    },
  };
  return module;
}
