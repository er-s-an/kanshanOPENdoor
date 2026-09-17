/**
 * 看山任意门 · Kanshan Hall — the product's 3D front door.
 *
 * A dark, misty circular hall with three glowing doors (端妃 gold / 蓝血 blue /
 * 近视眼 teal). 刘看山 — the Zhihu mascot, procedurally built in kanshan.ts
 * per the official turnaround — greets the player, follows them around the
 * hall, runs ahead to open doors, and sees them off as they step through.
 *
 * Flow:
 *   (a) intro timeline (skippable, cancelPolicy 'finish'): black → a crack of
 *       light in the entry door → the door opens → 看山 walks in waving →
 *       greet + intro subtitles; camera hands back to the player head.
 *   (b) guide state machine (ai/fsm): 看山 follows the player at ~2m (hard
 *       minimum 1.2m, intent-only simple seek — the hall is open); when the
 *       player lingers within 1.6m of a closed door for >0.8s he runs to it,
 *       plays openDoor, the door swings and its glow rises, and a subtitle
 *       names the world.
 *   (c) portal.enter: crossing an open door's plane commits
 *       'portal.enter' {target} with eventId `portal:enter:<id>` exactly once
 *       per door per session, notifies portalEnter subscribers exactly once,
 *       and a white ScreenFade covers the screen — the host page performs the
 *       actual world transition.
 *   (d) handles.reEnter(): the host calls this after returning from a world;
 *       the fade clears, 看山 greets the player near the door they left by
 *       with the return line. No duplicate portal.enter commit is possible.
 *
 * First-person wiring mirrors clockwork-flat: ActionMapper + fpsDefaults +
 * {moveYAxis:'move.z'} over a DomInputDevice (browser) or an injected
 * HeadlessInputDevice (tests). HUD subtitles via ui Hud (FakeDocument
 * headless). Audio is synth-only (AudioPlayer + RecordingBackend in tests).
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
import { cameraBlend, cameraCut, cue, timeline, tween, wait } from '../../../src/creative/animation/timeline.ts';
import type { TimelineHandle, TimelineState } from '../../../src/creative/animation/timeline.ts';
import { ScreenFade } from '../../../src/creative/effects/screen.ts';
import { createKanshan } from './kanshan.ts';
import type { Kanshan } from './kanshan.ts';
import { createHall } from './hall.ts';
import type { DoorHandle, Hall, HallTextureLoader } from './hall.ts';
import { DIALOGUE, doorOpenBeat } from './dialogue.ts';

// ---------------------------------------------------------------------------
// Layout + tuning constants
// ---------------------------------------------------------------------------

const SPAWN: Vec3 = [0, 1.0, 7];
const SPAWN_YAW = 0; // facing -Z, straight at the door arc
const KANSHAN_BEHIND_ENTRY: Vec3 = [0.4, 0, 11.7];
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
/** He starts easing into idle inside this radius while following. */
const KANSHAN_ARRIVE_RADIUS = 1.35;
const KANSHAN_WALK_SPEED = 2.4;
const KANSHAN_RUN_SPEED = 3.4;
const DOOR_TRIGGER_RADIUS = 1.6;
const DOOR_DWELL_SECONDS = 0.8;
const DOOR_OPEN_SPOT = 0.85; // meters in front of the door plane
const SEEOFF_SECONDS = 1.6;

const MIST_DENSITY_DEFAULT = 1;
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
      authorId: 'kanshan-hall.mist-density',
      schemaVersion: 1,
      description: '地面雾气密度倍数（0..2），实时生效',
      value: MIST_DENSITY_DEFAULT,
      validate(value: unknown) {
        return typeof value === 'number' && value >= 0 && value <= 2 ? true : 'mist-density 需在 0..2 之间';
      },
    },
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

      // ---- HUD ------------------------------------------------------------------------
      const doc: DocumentLike = options.document ?? defaultDocument();
      const hud = new Hud(doc, options.hudParent);

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
      // The intro opens on black; the first cue fades the hall in.
      fade.fadeOut(0, 0x000000);

      // ---- 看山 ---------------------------------------------------------------------------
      const kanshan = createKanshan();
      ctx.scope.own(kanshan);
      kanshan.setPosition(KANSHAN_BEHIND_ENTRY[0], KANSHAN_BEHIND_ENTRY[1], KANSHAN_BEHIND_ENTRY[2]);
      kanshan.play('sit');
      root.add(kanshan.object);

      // ---- portal-enter subscription + exactly-once bookkeeping ---------------------------
      const portalListeners = new Set<(target: string) => void>();
      const enteredDoors = new Set<string>();
      let lastEnteredDoor: DoorHandle | null = null;
      const notifyPortalEnter = (target: string): void => {
        for (const cb of [...portalListeners]) cb(target);
      };

      // ---- guide state machine (ai/fsm) ------------------------------------------------------
      let openingDoor: DoorHandle | null = null;
      let openingTimer = 0;
      let openingCommitted = false;
      let seeoffTimer = 0;
      const dwellByDoor = new Map<string, number>();
      const fsm: Fsm = createFsm({
        initial: 'intro',
        states: [
          { id: 'intro' },
          {
            id: 'follow',
            update: (dt) => {
              followPlayer(dt);
              watchDoors(dt);
            },
          },
          {
            id: 'opening',
            enter: () => {
              openingTimer = 0;
              openingCommitted = false;
            },
            update: (dt) => {
              runToDoorAndOpen(dt);
            },
          },
          {
            id: 'seeoff',
            enter: () => {
              seeoffTimer = 0;
              kanshan.play('idle');
              hud.subtitle.queueLine(DIALOGUE.seeoff, { speaker: '看山', durationMs: 3400 });
            },
            update: (dt) => {
              seeoffTimer += dt;
              facePlayer(dt);
              if (seeoffTimer >= SEEOFF_SECONDS) fsm.fire('seeoff-done');
            },
          },
        ],
        transitions: [
          { from: 'intro', on: 'intro-done', to: 'follow' },
          { from: 'follow', on: 'player-at-door', to: 'opening' },
          { from: 'opening', on: 'door-open', to: 'seeoff' },
          { from: 'opening', on: 'abort-open', to: 'follow' },
          { from: 'seeoff', on: 'seeoff-done', to: 'follow' },
        ],
      });

      const followPlayer = (dt: number): void => {
        const p = player.position;
        const k = kanshan.position;
        // Trail slightly behind-and-beside the player (guide-follow), never
        // blocking the view forward: target = player pos - forward*1.8 + right*0.9.
        const fx = -Math.sin(viewYaw);
        const fz = -Math.cos(viewYaw);
        const tx = p[0] - fx * 1.8 + -fz * 0.9;
        const tz = p[2] - fz * 1.8 + fx * 0.9;
        const d = Math.hypot(k.x - tx, k.z - tz);
        const dp = Math.hypot(k.x - p[0], k.z - p[2]);
        if (d > KANSHAN_ARRIVE_RADIUS) {
          kanshan.play('walk');
          const speed = d > 4 || dp > 4 ? KANSHAN_RUN_SPEED : KANSHAN_WALK_SPEED;
          const ux = (tx - k.x) / d;
          const uz = (tz - k.z) / d;
          kanshan.setPosition(k.x + ux * speed * dt, k.y, k.z + uz * speed * dt);
          kanshan.setYawToward(p[0], p[2], dt);
        } else {
          kanshan.play('idle');
          facePlayer(dt);
        }
      };

      const facePlayer = (dt: number): void => {
        const p = player.position;
        kanshan.setYawToward(p[0], p[2], dt);
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

      const runToDoorAndOpen = (dt: number): void => {
        const door = openingDoor;
        if (!door) {
          fsm.fire('abort-open'); // defensive: never stall without a door
          return;
        }
        openingTimer += dt;
        if (!openingCommitted) {
          // Where 看山 operates the door: just outside the doorway, stepping
          // to the side when the player already occupies that spot.
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
          const k = kanshan.position;
          const d = Math.hypot(tx - k.x, tz - k.z);
          const doorDist = Math.hypot(door.position.x - k.x, door.position.z - k.z);
          const arrived = d < 0.25 || (openingTimer > 2.2 && doorDist < 2.6);
          if (!arrived) {
            kanshan.play('walk');
            const speed = KANSHAN_RUN_SPEED;
            kanshan.setPosition(k.x + ((tx - k.x) / d) * speed * dt, k.y, k.z + ((tz - k.z) / d) * speed * dt);
            kanshan.setYawToward(tx, tz, dt);
          } else {
            // Face the doorway, lean in, and open it (exactly once).
            kanshan.setYawToward(door.position.x, door.position.z, 1);
            kanshan.play('openDoor');
            openingCommitted = true;
            ctx.commit('kanshan.door-opening', { door: door.id }, `kanshan:door-opening:${door.id}`);
            door.open();
            const beat = doorOpenBeat(door.id);
            if (beat) hud.subtitle.queueLine(DIALOGUE[beat], { speaker: '看山', durationMs: 3600 });
            audio.play('door-chime', { position: [door.position.x, 1.2, door.position.z] });
          }
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
            crackTarget = 1;
            fade.fadeIn(1.6);
            break;
          case 'kanshan.intro-door':
            crackTarget = 0;
            hall.entryDoor.open();
            kanshan.play('walk');
            audio.play('door-creak', { position: [0, 1.2, 10.8] });
            break;
          case 'kanshan.intro-greet':
            kanshan.play('wave');
            hud.subtitle.queueLine(DIALOGUE.greet, { speaker: '看山', durationMs: 3800 });
            break;
          case 'kanshan.intro-guide':
            kanshan.play('idle');
            hud.subtitle.queueLine(DIALOGUE.intro, { speaker: '看山', durationMs: 4600 });
            hud.subtitle.queueLine(DIALOGUE.guide, { speaker: '看山', durationMs: 3800 });
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
          natural: 'cues committed, 看山 at the stage, entry door open, camera at the player head',
          skip: 'same end state as natural completion (finish policy fast-forwards)',
        },
      });
      intro.add(
        cameraCut(new FixedRig('intro-entry-outside', { position: [0.6, 1.5, 13.9], lookAt: [0, 1.1, 10.8] })),
        cue('kanshan.intro-begin', { beat: 'crack' }, { eventId: 'kanshan:intro:begin' }),
        wait(2.0),
        cameraCut(new FixedRig('intro-entry-inside', { position: [-0.9, 1.35, 7.4], lookAt: [0, 0.9, 10.8] })),
        cue('kanshan.intro-door', { beat: 'door' }, { eventId: 'kanshan:intro:door' }),
        // Walk-in route: swing wide of the player (who is frozen at spawn),
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
        wait(1.6),
        cameraCut(new FixedRig('intro-stage', { position: [1.7, 1.3, 3.2], lookAt: [0, 0.75, 5.2] })),
        cue('kanshan.intro-greet', { beat: 'greet' }, { eventId: 'kanshan:intro:greet' }),
        wait(2.4),
        cue('kanshan.intro-guide', { beat: 'guide' }, { eventId: 'kanshan:intro:guide' }),
        cameraBlend(headRig, 1.2),
        wait(2.4),
      );
      const introHandle: TimelineHandle = intro.run(ctx, { camera: director });
      const introActive = (): boolean =>
        introHandle.state === 'running' || introHandle.state === 'paused';

      // ---- author parameters (live apply) -----------------------------------------------------------
      const applyParameter: Record<string, (value: unknown) => void> = {
        'kanshan-hall.mist-density': (value) => hall.setMistDensity(Number(value)),
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
          // 看山 greets near the door the player left by (presentation only:
          // no new commits, never a duplicate portal.enter).
          fade.fadeIn(1.2);
          if (lastEnteredDoor) {
            kanshan.setPosition(
              lastEnteredDoor.position.x + lastEnteredDoor.forward.x * 1.6,
              0,
              lastEnteredDoor.position.z + lastEnteredDoor.forward.z * 1.6,
            );
          }
          kanshan.play('wave');
          hud.subtitle.queueLine(DIALOGUE.return, { speaker: '看山', durationMs: 3400 });
          if (fsm.stateId === 'opening' || fsm.stateId === 'seeoff') {
            openingDoor = null;
            fsm.fire('abort-open');
          }
        },
        kanshan: {
          state(): string {
            const id = fsm.stateId ?? 'intro';
            if (id === 'opening' && openingDoor) return `opening:${openingDoor.id}`;
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
      };

      const instance: SceneInstance = { root, update };
      module.handles = handles;
      return instance;
    },
  };
  return module;
}
