/**
 * 看山任意门 · Kanshan Hall — the product's 3D front door.
 *
 * A bright, slightly dreamy Zhihu-brand circular hall (blue-white palette:
 * near-white glossy floor with blue ring inlays, slim white columns with
 * blue capital bands, translucent blue crystals, three white door arches
 * whose 端妃 gold / 蓝血 blue / 近视眼 teal glow is the wayfinding accent).
 * 刘看山 — the Zhihu mascot, procedurally built in kanshan.ts per the
 * official turnaround — peeks out of the entry door, greets the player,
 * then wanders the hall on his own; when the player lingers at a closed
 * door he runs over, opens it for them, and sees them off.
 *
 * Flow:
 *   (a) intro timeline (skippable, cancelPolicy 'finish'): near-black hall →
 *       a thin blue-white crack of light opens dead-center (the entry door)
 *       → the doorway swings wide and 看山 peeks his head out (~0.9s, ears
 *       perked) → he steps out, waves, and the hall lighting ramps up around
 *       him while the greet/intro/guide lines play above his head; the
 *       camera hands back to the player head.
 *   (b) roam state machine (ai/fsm): 看山 free-roams between a ring of
 *       waypoints (idle/sit pauses), NEVER tracking the player (hard minimum
 *       distance 1.2m, enforced every step); when the player lingers within
 *       1.6m of a closed door for >0.6s he runs to it, plays openDoor, the
 *       door swings and its glow rises, and a line above his head names the
 *       world.
 *   (c) portal.enter: crossing an open door's plane commits
 *       'portal.enter' {target} with eventId `portal:enter:<id>` exactly once
 *       per door per session, notifies portalEnter subscribers exactly once,
 *       and a white ScreenFade covers the screen — the host page performs the
 *       actual world transition.
 *   (d) handles.reEnter(): the host calls this after returning from a world;
 *       the fade clears, 看山 greets the player beside the door they left by
 *       with the return line. No duplicate portal.enter commit is possible.
 *
 * First-person wiring mirrors clockwork-flat: ActionMapper + fpsDefaults +
 * {moveYAxis:'move.z'} over a DomInputDevice (browser) or an injected
 * HeadlessInputDevice (tests). 看山's lines render as a DOM bubble above his
 * head (headsay.ts), falling back to the HUD subtitle when off-camera.
 * Audio is synth-only (AudioPlayer + RecordingBackend in tests).
 * Offline runs inject HeadlessInputDevice / RecordingBackend / FakeDocument.
 */
import * as THREE from './three.ts';
import type { SceneContext, SceneInstance, SceneModule } from '../../../src/creative/core/context.ts';
import type { Vec3 } from '../../../src/creative/core/spatial.ts';
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
import { HeadlessInputDevice } from '../../../src/creative/input/headless.ts';
import { ActionMapper, EMPTY_ACTION_STATE, mergeActionMaps } from '../../../src/creative/input/mapper.ts';
import { fpsDefaults } from '../../../src/creative/input/defaults.ts';
import type { InputDevice } from '../../../src/creative/input/types.ts';
import { FirstPersonController } from '../../../src/creative/controllers/first-person.ts';
import type { CharacterTuning } from '../../../src/creative/controllers/kinematic-character.ts';
import { installPhysics } from '../../../src/creative/physics/world.ts';
import type { PhysicsWorld } from '../../../src/creative/physics/world.ts';
import { createFsm } from '../../../src/creative/ai/fsm.ts';
import type { Fsm } from '../../../src/creative/ai/fsm.ts';
import { exposeParameters } from '../../../src/creative/scene/authoring.ts';
import type { ParameterDef, ParameterRegistry } from '../../../src/creative/scene/authoring.ts';
import { defaultDocument } from '../../../src/creative/ui/dom.ts';
import type { DocumentLike, DomElementLike } from '../../../src/creative/ui/dom.ts';
import { Hud } from '../../../src/creative/ui/hud.ts';
import { cameraBlend, cameraCut, cue, parallel, timeline, tween, wait } from '../../../src/creative/animation/timeline.ts';
import type { TimelineHandle, TimelineState } from '../../../src/creative/animation/timeline.ts';
import { ScreenFade } from '../../../src/creative/effects/screen.ts';
import { createKanshan } from './kanshan.ts';
import type { Kanshan } from './kanshan.ts';
import { createHall } from './hall.ts';
import type { DoorHandle, Hall, HallTextureLoader } from './hall.ts';
import { createHeadSay } from './headsay.ts';
import type { HeadSay } from './headsay.ts';
import { DIALOGUE, doorOpenBeat } from './dialogue.ts';

// ---------------------------------------------------------------------------
// Layout + tuning constants
// ---------------------------------------------------------------------------

const SPAWN: Vec3 = [0, 1.0, 7];
const SPAWN_YAW = 0; // facing -Z, straight at the door arc
const KANSHAN_BEHIND_ENTRY: Vec3 = [0.4, 0, 11.7];
/** Doorway threshold spot where he peeks out from behind the entry leaf. */
const KANSHAN_PEEK: Vec3 = [0.55, 0, 11.3];
const KANSHAN_STAGE: Vec3 = [0, 0, 5.2];

const CHARACTER_TUNING: CharacterTuning = {
  speed: 3,
  radius: 0.3,
  height: 1.7,
  gravity: 9.81,
  jumpSpeed: 5,
  maxSlopeAngle: (45 * Math.PI) / 180,
  maxStepHeight: 0.4,
};

/** 看山 keeps at least this XZ distance from the player, always. */
export const KANSHAN_MIN_DISTANCE = 1.2;
/** He starts easing into idle inside this radius while roaming. */
const KANSHAN_ARRIVE_RADIUS = 0.35;
const KANSHAN_WALK_SPEED = 2.4;
const KANSHAN_RUN_SPEED = 3.4;
const DOOR_TRIGGER_RADIUS = 1.6;
const DOOR_DWELL_SECONDS = 0.6;
const DOOR_OPEN_SPOT = 0.85; // meters in front of the door plane
const SEEOFF_SECONDS = 1.6;

/** Free-roam waypoint ring (r 3–6.5m); exported for tests/tools. */
export const ROAM_WAYPOINTS: readonly Vec3[] = [
  [0, 0, -4.5],
  [4.2, 0, -2.8],
  [5.4, 0, 2.0],
  [2.6, 0, 5.6],
  [-2.8, 0, 5.4],
  [-5.2, 0, 1.6],
  [-4.4, 0, -3.4],
];
/** Hall illumination at the very start (near-black; the intro ramps it). */
export const INTRO_LIGHT_RAMP_START = 0.04;

const DOOR_GLOW_DEFAULT = 1;

/** Frozen portal-host contract (see CONTRACT.md / portal page). */
export interface KanshanHallHandles {
  portalEnter: {
    /** Subscribe to committed portal.enter targets; replays nothing. */
    onEnter(cb: (target: string) => void): () => void;
  };
  /** Host returned the player from a world: clear the fade, greet, resume. */
  reEnter(): void;
  kanshan: { state(): string };
  doors: Array<{ id: string; title: string; state(): 'closed' | 'opening' | 'open' }>;
}

/** Test/tool-facing extras; a browser host uses the same object. */
export interface KanshanHallWorkHandles extends KanshanHallHandles {
  readonly physics: PhysicsWorld;
  readonly player: FirstPersonController;
  readonly hall: Hall;
  readonly kanshanRef: Kanshan;
  readonly hud: Hud;
  /** 看山's above-head subtitle bubble (falls back to the HUD off-camera). */
  readonly headSubtitle: HeadSay;
  readonly audio: AudioPlayer;
  readonly params: ParameterRegistry;
  readonly camera: THREE.PerspectiveCamera;
  readonly director: CameraDirector;
  readonly recordedCommits: readonly { name: string; payload: unknown; eventId: string }[];
  skipIntro(): void;
  introState(): TimelineState | 'none';
  unlockAudio(): void;
  /** Current XZ distance between 看山 and the player. */
  kanshanDistanceToPlayer(): number;
  /** White fade coverage 0..1. */
  fadeProgress(): number;
  /** Hall light ramp 0..1 (intro lighting ramp; 1 = full daylight). */
  lightingRamp(): number;
}

export interface KanshanHallOptions {
  device?: InputDevice;
  audioBackend?: AudioBackend;
  document?: DocumentLike;
  hudParent?: DomElementLike;
  camera?: THREE.PerspectiveCamera;
  textureLoader?: HallTextureLoader;
}

// ---------------------------------------------------------------------------
// Static author-parameter declaration (consumed by the engine-cli author
// tools WITHOUT running create(); pure data + validate predicates).
// ---------------------------------------------------------------------------

export function describeParameters(): ParameterDef[] {
  return [
    {
      authorId: 'kanshan-hall.door-glow',
      schemaVersion: 1,
      description: '门扉辉光/点光强度倍数（0..3），实时生效',
      value: DOOR_GLOW_DEFAULT,
      validate(value: unknown) {
        return typeof value === 'number' && value >= 0 && value <= 3 ? true : 'door-glow 需在 0..3 之间';
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// First-person head rig (reads the player head; writes only the camera)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Synth clips (deterministic; RecordingBackend-observable in tests)
// ---------------------------------------------------------------------------

function makeSynthClip(build: (out: AudioNodeLike, when: number, backend: AudioBackend) => SynthVoice | void) {
  return { kind: 'synth' as const, render: build };
}

function defaultClips() {
  return {
    'door-creak': makeSynthClip((out, when, backend) => {
      const osc = backend.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(88, when);
      osc.frequency.linearRampToValueAtTime(36, when + 1.3);
      const gain = backend.createGain();
      gain.gain.setValueAtTime(0, when);
      gain.gain.linearRampToValueAtTime(0.32, when + 0.15);
      gain.gain.linearRampToValueAtTime(0, when + 1.3);
      osc.connect(gain);
      gain.connect(out);
      osc.start(when);
      osc.stop(when + 1.3);
      return { stop: (t: number) => osc.stop(t) };
    }),
    'door-chime': makeSynthClip((out, when, backend) => {
      const gain = backend.createGain();
      gain.gain.setValueAtTime(0, when);
      gain.gain.linearRampToValueAtTime(0.4, when + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, when + 2.2);
      gain.connect(out);
      const stops: Array<(t: number) => void> = [];
      for (const freq of [523.25, 784.0]) {
        const osc = backend.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, when);
        osc.connect(gain);
        osc.start(when);
        osc.stop(when + 2.2);
        stops.push((t: number) => osc.stop(t));
      }
      return { stop: (t: number) => stops.forEach((s) => s(t)) };
    }),
    'portal-wash': makeSynthClip((out, when, backend) => {
      const osc = backend.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(240, when);
      osc.frequency.exponentialRampToValueAtTime(980, when + 0.7);
      const gain = backend.createGain();
      gain.gain.setValueAtTime(0, when);
      gain.gain.linearRampToValueAtTime(0.35, when + 0.1);
      gain.gain.linearRampToValueAtTime(0, when + 0.8);
      osc.connect(gain);
      gain.connect(out);
      osc.start(when);
      osc.stop(when + 0.85);
      return { stop: (t: number) => osc.stop(t) };
    }),
    ambient: makeSynthClip((out, when, backend) => {
      // Soft two-voice pad; started as a loop on unlock by the host.
      const gain = backend.createGain();
      gain.gain.setValueAtTime(0, when);
      gain.gain.linearRampToValueAtTime(0.16, when + 2.5);
      gain.connect(out);
      const stops: Array<(t: number) => void> = [];
      for (const [freq, type] of [
        [110, 'sine'],
        [164.8, 'triangle'],
      ] as const) {
        const osc = backend.createOscillator();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, when);
        osc.connect(gain);
        osc.start(when);
        stops.push((t: number) => osc.stop(t));
      }
      return { stop: (t: number) => stops.forEach((s) => s(t)) };
    }),
  };
}

// ---------------------------------------------------------------------------
// Module factory
// ---------------------------------------------------------------------------

export function createKanshanHallModule(
  options: KanshanHallOptions = {},
): SceneModule & { handles?: KanshanHallHandles } {
  const module: SceneModule & { handles?: KanshanHallHandles } = {
    async create(ctx: SceneContext): Promise<SceneInstance> {
      const physics = await installPhysics(ctx);
      const root = new THREE.Group();
      root.name = 'kanshan-hall-experience';

      // ---- environment ------------------------------------------------------
      const hall: Hall = createHall(ctx, { physics, textureLoader: options.textureLoader });
      root.add(hall.object);

      // ---- commit channel ----------------------------------------------------
      ctx.registerEventValidator('kanshan.*', (payload) =>
        typeof payload === 'object' && payload !== null ? true : 'payload must be an object',
      );
      ctx.registerEventValidator('portal.*', (payload) => {
        const p = payload as { target?: unknown };
        return typeof p?.target === 'string' ? true : 'portal events require a string target';
      });
      const recordedCommits: Array<{ name: string; payload: unknown; eventId: string }> = [];
      ctx.onCommit((envelope) => {
        recordedCommits.push({ name: envelope.name, payload: envelope.payload, eventId: envelope.eventId });
      });

      // ---- player --------------------------------------------------------------
      const player = new FirstPersonController(physics, CHARACTER_TUNING, {
        id: 'player',
        spawn: SPAWN,
        bindings: { moveYAxis: 'move.z' },
      });
      ctx.scope.own(player);
      player.object.name = 'player';
      root.add(player.object);
      let viewYaw = SPAWN_YAW;
      let viewPitch = 0;

      // ---- input -----------------------------------------------------------------
      const hasDom = typeof globalThis.window !== 'undefined' && typeof globalThis.document !== 'undefined';
      const device: InputDevice = options.device ?? (hasDom ? new DomInputDevice({ scope: ctx.scope }) : new HeadlessInputDevice());
      const actionMap = mergeActionMaps(fpsDefaults, {
        actions: { skip: [{ kind: 'key', code: 'Escape' }] },
        axes: {},
      });
      const mapper = new ActionMapper(actionMap, device, { scope: ctx.scope });

      // ---- audio -------------------------------------------------------------------
      const backend = options.audioBackend ?? new RealBackend();
      const graph = new AudioGraph(backend);
      ctx.scope.own(graph);
      const audio = new AudioPlayer({ backend, graph, scope: ctx.scope, clips: defaultClips() });

      // ---- HUD + above-head subtitle bubble ------------------------------------
      const doc: DocumentLike = options.document ?? defaultDocument();
      // Mount to the page in browser runs; headless tests pass a parent or
      // leave it detached and assert on state instead.
      const hudParent = options.hudParent ?? (hasDom ? (globalThis.document.body as unknown as import('../../../src/creative/ui/dom.ts').DomElementLike) : undefined);
      const hud = new Hud(doc, hudParent);

      // ---- camera ------------------------------------------------------------------------
      const camera = options.camera ?? new THREE.PerspectiveCamera(74, 16 / 9, 0.05, 120);
      // The ScreenFade quad is parented to the camera; a camera-attached quad
      // renders only when the camera itself belongs to the scene graph (the
      // boot shell skips adding it because handles.camera exists).
      ctx.scene.add(camera);
      const headRig = new HeadRig(() => ({ position: player.position, yaw: viewYaw, pitch: viewPitch }));
      const director = new CameraDirector(camera, headRig);
      director.attach(ctx);
      const fade = new ScreenFade(camera, { scope: ctx.scope });
      // The intro opens on a near-black hall (light ramp ≈ 0), NOT on a black
      // overlay — the entry-door crack must shine through from the first
      // second. The fade quad is reserved for the white portal transition.

      // ---- 看山 ---------------------------------------------------------------------------
      const kanshan = createKanshan();
      ctx.scope.own(kanshan);
      kanshan.setPosition(KANSHAN_BEHIND_ENTRY[0], KANSHAN_BEHIND_ENTRY[1], KANSHAN_BEHIND_ENTRY[2]);
      kanshan.play('sit');
      root.add(kanshan.object);

      // ---- above-head subtitle bubble (Hud fallback when off-camera) ------------------------
      const kanshanHead = new THREE.Vector3();
      const headSay = createHeadSay({
        doc,
        parent: hud.custom,
        hudSubtitle: hud.subtitle,
        headPosition: () => kanshan.object.getWorldPosition(kanshanHead),
        camera: () => camera,
        viewport: hasDom ? { width: globalThis.window.innerWidth, height: globalThis.window.innerHeight } : undefined,
      });

      // ---- hall lighting ramp (intro: near-black -> daylight around him) ---------------------
      // Timeline-tweened proxy: a tween on userData.k keeps natural completion
      // and skip() in the SAME end state (finish policy fast-forwards it).
      const lightRampState = new THREE.Object3D();
      lightRampState.name = 'light-ramp-proxy';
      lightRampState.userData.k = INTRO_LIGHT_RAMP_START;
      hall.setLightRamp(INTRO_LIGHT_RAMP_START);

      // ---- portal-enter subscription + exactly-once bookkeeping ---------------------------
      const portalListeners = new Set<(target: string) => void>();
      const enteredDoors = new Set<string>();
      let lastEnteredDoor: DoorHandle | null = null;
      const notifyPortalEnter = (target: string): void => {
        for (const cb of [...portalListeners]) cb(target);
      };

      // ---- guide state machine (ai/fsm) ------------------------------------------------------
      // intro -> roam; roam --player-at-door--> to-door --at-door--> opening
      // --door-open--> seeoff --seeoff-done--> roam. 看山 free-roams the hall
      // on his own and NEVER tracks the player; a door run interrupts the
      // roam from wherever he happens to be.
      let openingDoor: DoorHandle | null = null;
      let openingTimer = 0;
      let openingCommitted = false;
      let seeoffTimer = 0;
      const dwellByDoor = new Map<string, number>();

      // Deterministic wander RNG (fixed seed): roam choices must replay
      // identically across sessions — the intro parity test compares runs.
      let roamSeed = 0x9e3779b9;
      const roamRandom = (): number => {
        roamSeed = (roamSeed * 1664525 + 1013904223) >>> 0;
        return roamSeed / 0x1_0000_0000;
      };

      // Roam motion state.
      let roamTarget = -1; // index into ROAM_WAYPOINTS, -1 = pick a fresh one
      let roamPauseSeconds = 0; // idle/sit time remaining at a waypoint
      let roamSitting = false;

      const pickWaypoint = (): number => {
        if (ROAM_WAYPOINTS.length === 1) return 0;
        let next = Math.floor(roamRandom() * ROAM_WAYPOINTS.length);
        if (next === roamTarget) next = (next + 1) % ROAM_WAYPOINTS.length;
        return next;
      };

      const fsm: Fsm = createFsm({
        initial: 'intro',
        states: [
          { id: 'intro' },
          {
            id: 'roam',
            update: (dt) => {
              roamUpdate(dt);
            },
          },
          {
            id: 'to-door',
            enter: () => {
              openingTimer = 0;
            },
            update: (dt) => {
              runToDoor(dt);
            },
          },
          {
            id: 'opening',
            enter: () => {
              openingTimer = 0;
              openingCommitted = false;
            },
            update: (dt) => {
              openDoorNow(dt);
            },
          },
          {
            id: 'seeoff',
            enter: () => {
              seeoffTimer = 0;
              kanshan.play('idle');
              headSay.say(DIALOGUE.seeoff, 3400);
            },
            update: (dt) => {
              seeoffTimer += dt;
              facePlayer(dt);
              if (seeoffTimer >= SEEOFF_SECONDS) fsm.fire('seeoff-done');
            },
          },
        ],
        transitions: [
          { from: 'intro', on: 'intro-done', to: 'roam' },
          { from: 'roam', on: 'player-at-door', to: 'to-door' },
          { from: 'to-door', on: 'at-door', to: 'opening' },
          { from: 'to-door', on: 'abort-open', to: 'roam' },
          { from: 'opening', on: 'door-open', to: 'seeoff' },
          { from: 'opening', on: 'abort-open', to: 'roam' },
          { from: 'seeoff', on: 'seeoff-done', to: 'roam' },
          { from: 'seeoff', on: 'abort-open', to: 'roam' },
        ],
      });

      const facePlayer = (dt: number): void => {
        const p = player.position;
        kanshan.setYawToward(p[0], p[2], dt);
      };

      /** Free-roam: wander the waypoint ring, pause (idle/sit), re-target. */
      const roamUpdate = (dt: number): void => {
        if (roamPauseSeconds > 0) {
          roamPauseSeconds -= dt;
          kanshan.play(roamSitting ? 'sit' : 'idle');
          if (roamPauseSeconds <= 0) roamTarget = pickWaypoint();
          watchDoors(dt);
          return;
        }
        if (roamTarget < 0) roamTarget = pickWaypoint();
        const wp = ROAM_WAYPOINTS[roamTarget];
        const k = kanshan.position;
        const d = Math.hypot(wp[0] - k.x, wp[2] - k.z);
        if (d <= KANSHAN_ARRIVE_RADIUS) {
          // Pause at the waypoint: usually idle 2–4s, sometimes sit 3–5s.
          roamSitting = roamRandom() < 0.35;
          roamPauseSeconds = roamSitting ? 3 + roamRandom() * 2 : 2 + roamRandom() * 2;
          watchDoors(dt);
          return;
        }
        kanshan.play('walk');
        kanshan.setPosition(
          k.x + ((wp[0] - k.x) / d) * KANSHAN_WALK_SPEED * dt,
          k.y,
          k.z + ((wp[2] - k.z) / d) * KANSHAN_WALK_SPEED * dt,
        );
        kanshan.setYawToward(wp[0], wp[2], dt);
        // Occasionally re-target mid-walk — he wanders, he doesn't commute.
        if (roamRandom() < dt * 0.1) roamTarget = pickWaypoint();
        watchDoors(dt);
      };

      /** Hard invariant: 看山 never stands closer than KANSHAN_MIN_DISTANCE. */
      const clampKanshanDistance = (): void => {
        const p = player.position;
        const k = kanshan.position;
        const dx = k.x - p[0];
        const dz = k.z - p[2];
        const d = Math.hypot(dx, dz);
        if (d >= KANSHAN_MIN_DISTANCE) return;
        if (d < 1e-4) {
          // Degenerate overlap: step straight back toward the hall center.
          const cx = -p[0];
          const cz = -p[2];
          const cd = Math.hypot(cx, cz) || 1;
          kanshan.setPosition(p[0] + (cx / cd) * KANSHAN_MIN_DISTANCE, k.y, p[2] + (cz / cd) * KANSHAN_MIN_DISTANCE);
          return;
        }
        const push = KANSHAN_MIN_DISTANCE / d;
        kanshan.setPosition(p[0] + dx * push, k.y, p[2] + dz * push);
      };

      const watchDoors = (dt: number): void => {
        const p = player.position;
        let nearest: DoorHandle | null = null;
        let nearestDist = Number.POSITIVE_INFINITY;
        for (const door of hall.doors) {
          if (door.state() !== 'closed') continue;
          const d = Math.hypot(p[0] - door.position.x, p[2] - door.position.z);
          if (d < DOOR_TRIGGER_RADIUS && d < nearestDist) {
            nearest = door;
            nearestDist = d;
          }
        }
        for (const door of hall.doors) {
          if (door === nearest) continue;
          dwellByDoor.set(door.id, 0);
        }
        if (!nearest) return;
        const dwell = (dwellByDoor.get(nearest.id) ?? 0) + dt;
        dwellByDoor.set(nearest.id, dwell);
        if (dwell >= DOOR_DWELL_SECONDS) {
          openingDoor = nearest;
          dwellByDoor.set(nearest.id, 0);
          fsm.fire('player-at-door');
        }
      };

      /** Where 看山 operates the door: just outside the doorway, sidestepping
       *  when the player already occupies that spot. */
      const doorSpot = (door: DoorHandle): { x: number; z: number } => {
        let tx = door.position.x + door.forward.x * DOOR_OPEN_SPOT;
        let tz = door.position.z + door.forward.z * DOOR_OPEN_SPOT;
        const px = player.position[0] - tx;
        const pz = player.position[2] - tz;
        if (Math.hypot(px, pz) < 1.1) {
          const perpX = -door.forward.z;
          const perpZ = door.forward.x;
          const sign = px * perpX + pz * perpZ >= 0 ? -1 : 1;
          tx += perpX * 1.3 * sign;
          tz += perpZ * 1.3 * sign;
        }
        return { x: tx, z: tz };
      };

      const runToDoor = (dt: number): void => {
        const door = openingDoor;
        if (!door) {
          fsm.fire('abort-open'); // defensive: never stall without a door
          return;
        }
        openingTimer += dt;
        const spot = doorSpot(door);
        const k = kanshan.position;
        const d = Math.hypot(spot.x - k.x, spot.z - k.z);
        const doorDist = Math.hypot(door.position.x - k.x, door.position.z - k.z);
        // Arrival, with a timeout fallback: the 1.2m player clamp can pin him
        // short of the exact spot when the player crowds the doorway.
        if (d < 0.25 || (openingTimer > 2.2 && doorDist < 2.6)) {
          fsm.fire('at-door');
          return;
        }
        kanshan.play('walk');
        kanshan.setPosition(k.x + ((spot.x - k.x) / d) * KANSHAN_RUN_SPEED * dt, k.y, k.z + ((spot.z - k.z) / d) * KANSHAN_RUN_SPEED * dt);
        kanshan.setYawToward(spot.x, spot.z, dt);
      };

      const openDoorNow = (dt: number): void => {
        const door = openingDoor;
        if (!door) {
          fsm.fire('abort-open'); // defensive: never stall without a door
          return;
        }
        if (!openingCommitted) {
          // Face the doorway, lean in, and open it (exactly once).
          kanshan.setYawToward(door.position.x, door.position.z, 1);
          kanshan.play('openDoor');
          openingCommitted = true;
          ctx.commit('kanshan.door-opening', { door: door.id }, `kanshan:door-opening:${door.id}`);
          door.open();
          const beat = doorOpenBeat(door.id);
          if (beat) headSay.say(DIALOGUE[beat], 3600);
          audio.play('door-chime', { position: [door.position.x, 1.2, door.position.z] });
        } else if (door.state() === 'open') {
          fsm.fire('door-open');
        } else {
          // Hold the openDoor pose while the leaf swings.
          kanshan.setYawToward(door.position.x, door.position.z, dt);
        }
      };

      // ---- presentation reactions to committed facts -------------------------------------------
      let introDone = false;
      let crackTarget = 0;
      ctx.onCommit((envelope) => {
        switch (envelope.name) {
          case 'kanshan.intro-begin':
            // Beat: a thin blue-white crack of light opens dead-center on a
            // near-black hall (the light ramp stays down until the greet).
            crackTarget = 1;
            break;
          case 'kanshan.intro-door':
            // Beat: the crack widens into the lit doorway and 看山 peeks out
            // (head + eyes around the leaf, body hidden, ears perked).
            crackTarget = 0;
            hall.entryDoor.open();
            kanshan.setPosition(KANSHAN_PEEK[0], KANSHAN_PEEK[1], KANSHAN_PEEK[2]);
            kanshan.setYawToward(SPAWN[0], SPAWN[2], 1);
            kanshan.play('peek');
            audio.play('door-creak', { position: [0, 1.2, 10.8] });
            break;
          case 'kanshan.intro-peek':
            headSay.say(DIALOGUE.peek, 1800);
            break;
          case 'kanshan.intro-stepout':
            kanshan.play('walk');
            break;
          case 'kanshan.intro-greet':
            kanshan.play('wave');
            headSay.say(DIALOGUE.greet, 3800);
            break;
          case 'kanshan.intro-guide':
            kanshan.play('idle');
            headSay.say(DIALOGUE.intro, 4600);
            headSay.say(DIALOGUE.guide, 3800);
            break;
          case 'kanshan.door-opening':
            audio.play('door-creak', { position: [0, 1.2, 0] });
            break;
          default:
            break;
        }
      });

      // ---- intro timeline (skippable; declared finish policy) --------------------------------------
      const intro = timeline('kanshan-hall-intro', {
        cancelPolicy: 'finish',
        endState: {
          natural: 'cues committed, 看山 at the stage, entry door open, hall lights fully up, camera at the player head',
          skip: 'same end state as natural completion (finish policy fast-forwards)',
        },
      });
      intro.add(
        cameraCut(new FixedRig('intro-entry-outside', { position: [0.6, 1.5, 13.9], lookAt: [0, 1.1, 10.8] })),
        cue('kanshan.intro-begin', { beat: 'crack' }, { eventId: 'kanshan:intro:begin' }),
        // Near-black hall: only the door crack grows for the first ~1.8s.
        wait(1.8),
        cue('kanshan.intro-door', { beat: 'door' }, { eventId: 'kanshan:intro:door' }),
        cue('kanshan.intro-peek', { beat: 'peek' }, { eventId: 'kanshan:intro:peek' }),
        // He holds the doorway — head and ears out, body hidden.
        wait(1.0),
        cue('kanshan.intro-stepout', { beat: 'stepout' }, { eventId: 'kanshan:intro:stepout' }),
        // Walk-out route: swing wide of the player (who is frozen at spawn),
        // then take the stage. Both legs stay >1.7m from the player.
        tween({
          target: kanshan.object,
          props: { position: new THREE.Vector3(2.6, 0, 5.6) },
          duration: 2.2,
        }),
        tween({
          target: kanshan.object,
          props: { position: new THREE.Vector3(KANSHAN_STAGE[0], KANSHAN_STAGE[1], KANSHAN_STAGE[2]) },
          duration: 1.0,
        }),
        wait(0.6),
        cameraCut(new FixedRig('intro-stage', { position: [1.7, 1.3, 3.2], lookAt: [0, 0.75, 5.2] })),
        cue('kanshan.intro-greet', { beat: 'greet' }, { eventId: 'kanshan:intro:greet' }),
        // The hall lighting ramps up around him while he greets.
        parallel(
          tween({ target: lightRampState, props: { 'userData.k': 1 }, duration: 2.4 }),
          wait(2.4),
        ),
        cue('kanshan.intro-guide', { beat: 'guide' }, { eventId: 'kanshan:intro:guide' }),
        cameraBlend(headRig, 1.2),
        wait(2.4),
      );
      const introHandle: TimelineHandle = intro.run(ctx, { camera: director });
      const introActive = (): boolean =>
        introHandle.state === 'running' || introHandle.state === 'paused';

      // ---- author parameters (live apply) -----------------------------------------------------------
      const applyParameter: Record<string, (value: unknown) => void> = {
        'kanshan-hall.door-glow': (value) => hall.setGlowIntensity(Number(value)),
      };
      const params = exposeParameters(
        describeParameters().map((def) => ({ ...def, apply: applyParameter[def.authorId] })),
      );

      // ---- portal plane crossing (mechanics) ----------------------------------------------------------
      // The leaf collider is removed the moment open() starts, so a player
      // pressing into the doorway can physically cross while the state is
      // still 'opening'. "Through the doorway" therefore means: behind the
      // plane while the door is no longer closed. The enteredDoors set gives
      // exactly one commit per door per session.
      const updatePortalCrossing = (): void => {
        const p = player.position;
        for (const door of hall.doors) {
          if (enteredDoors.has(door.id)) continue;
          if (door.state() === 'closed') continue;
          const side =
            (p[0] - door.position.x) * door.forward.x + (p[2] - door.position.z) * door.forward.z;
          if (side > -0.05) continue;
          enteredDoors.add(door.id);
          const receipt = ctx.commit('portal.enter', { target: door.id }, `portal:enter:${door.id}`);
          if (receipt.status === 'committed') {
            lastEnteredDoor = door;
            notifyPortalEnter(door.id);
            audio.play('portal-wash');
            fade.fadeTo(0xffffff, 0.6);
          }
        }
      };

      // ---- phase wiring ----------------------------------------------------------------------------------
      ctx.onPhase('input', () => {
        mapper.step();
      });
      ctx.onPhase('intent', (frame) => {
        const snap: ActionState = mapper.snapshot();
        if (introActive()) {
          if (snap.pressed('skip')) introHandle.skip();
          player.update(EMPTY_ACTION_STATE, viewYaw, frame.dt);
          return;
        }
        viewYaw -= snap.axis('look.x');
        viewPitch = Math.min(1.45, Math.max(-1.45, viewPitch - snap.axis('look.y')));
        player.update(snap, viewYaw, frame.dt);
      });

      let crack = 0;
      let ambientStarted = false;
      const update = (frame: { dt: number }): void => {
        const dt = frame.dt;
        // The intro drives the hall light ramp through a timeline tween.
        hall.setLightRamp(lightRampState.userData.k);
        hall.update(dt);
        kanshan.update(dt);
        crack += Math.min(1, Math.max(-1, (crackTarget - crack) * dt * 2.2));
        hall.setEntryCrack(crack);
        if (!introDone && !introActive()) {
          introDone = true;
          fsm.fire('intro-done');
        }
        if (introDone) fsm.update(dt);
        // The player can close the distance in ANY state (seeoff included):
        // the minimum-distance invariant is enforced unconditionally, once
        // per fixed step, for the whole session.
        clampKanshanDistance();
        updatePortalCrossing();
      };

      ctx.onPhase('present', (frame) => {
        // Lazy ambient start: the browser shell unlocks the player directly
        // from the first user gesture (handles.audio.unlock), so the pad is
        // started on the first present tick after that unlock.
        if (!ambientStarted && audio.state === 'unlocked') {
          ambientStarted = true;
          audio.play('ambient', { loop: true, bus: 'music', volume: 0.9, fadeIn: 2.5 });
        }
        hud.subtitle.tick(frame.dt * 1000);
        headSay.tick(frame.dt * 1000);
        audio.update(ctx.clock.time);
        const p = player.position;
        audio.setListenerPosition([p[0], p[1] + 0.72, p[2]]);
        fade.update(frame.dt);
      });

      // ---- handles -----------------------------------------------------------------------------------------
      const handles: KanshanHallWorkHandles = {
        portalEnter: {
          onEnter(cb: (target: string) => void): () => void {
            portalListeners.add(cb);
            return () => portalListeners.delete(cb);
          },
        },
        reEnter(): void {
          // The host has dropped its world overlay; reveal the hall again.
          // 看山 greets beside the door the player left by (presentation
          // only: no new commits, never a duplicate portal.enter) and holds
          // the spot for the greeting before he wanders off again.
          fade.fadeIn(1.2);
          if (lastEnteredDoor) {
            kanshan.setPosition(
              lastEnteredDoor.position.x + lastEnteredDoor.forward.x * 1.6,
              0,
              lastEnteredDoor.position.z + lastEnteredDoor.forward.z * 1.6,
            );
          }
          roamTarget = -1;
          roamSitting = false;
          roamPauseSeconds = 4.5; // the return line + a breath
          kanshan.play('wave');
          headSay.say(DIALOGUE.return, 3400);
          if (fsm.stateId === 'to-door' || fsm.stateId === 'opening' || fsm.stateId === 'seeoff') {
            openingDoor = null;
            fsm.fire('abort-open');
          }
        },
        kanshan: {
          state(): string {
            const id = fsm.stateId ?? 'intro';
            if ((id === 'to-door' || id === 'opening') && openingDoor) return `${id}:${openingDoor.id}`;
            return id;
          },
        },
        doors: hall.doors.map((door) => ({
          id: door.id,
          title: door.title,
          state: () => door.state(),
        })),
        physics,
        player,
        hall,
        kanshanRef: kanshan,
        hud,
        headSubtitle: headSay,
        audio,
        params,
        camera,
        director,
        recordedCommits,
        skipIntro(): void {
          introHandle.skip();
        },
        introState(): TimelineState | 'none' {
          return introHandle.state;
        },
        unlockAudio(): void {
          audio.unlock();
        },
        kanshanDistanceToPlayer(): number {
          const p = player.position;
          const k = kanshan.position;
          return Math.hypot(k.x - p[0], k.z - p[2]);
        },
        fadeProgress(): number {
          return fade.progress;
        },
        lightingRamp(): number {
          return hall.lightRamp();
        },
      };

      const instance: SceneInstance = { root, update };
      module.handles = handles;
      return instance;
    },
  };
  return module;
}
