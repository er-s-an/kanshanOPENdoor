/**
 * 刘看山 — procedural mascot built from the official turnaround reference
 * (game/public/art/character/reference/liu-kanshan-turnaround.jpg):
 *
 *   - one white rounded body, slightly wider at the bottom (gumdrop silhouette)
 *   - two pointy ears on the top corners
 *   - one big black oval nose, two small dot eyes
 *   - thin black arms ending in paw blobs
 *   - thin black legs ending in round feet
 *   - one small white tail stub at the back
 *
 * Everything is low-poly MeshLambertMaterial so the silhouette reads at the
 * PS1 preset (320x240). Animations are procedural (sin-based), fully
 * deterministic — no RNG, no wall clock — driven by update(dt):
 *
 *   idle     gentle bob + breathe, occasional deterministic ear twitch
 *   walk     waddle: body roll ±0.08 rad, bounce, legs/arms counter-swing
 *   wave     right arm raised, oscillating
 *   openDoor lean forward + right arm reach (with a small confident tremble)
 *   sit      body lowered, legs folded (used pre-intro, behind the entry door)
 *
 * The rig is plain Object3D groups; this file never touches physics, commits
 * or the scene graph beyond its own root group.
 */
import * as THREE from './three.ts';

export type KanshanAction = 'idle' | 'walk' | 'wave' | 'openDoor' | 'sit';

export interface KanshanPlayOptions {
  /** Cross-fade into the new action, seconds. Default 0.22. */
  fadeSec?: number;
}

export interface KanshanOptions {
  /** Object3D name prefix (debugging/tools). */
  name?: string;
}

const WHITE = 0xf2f0ea;
const BLACK = 0x17171a;

// Proportions (meters). Total height ≈ 1.12 including ears; feet at y=0.
const TORSO_BOTTOM_Y = 0.2;
const TORSO_HEIGHT = 0.78;
const TORSO_HALF_WIDTH_BOTTOM = 0.26;
const TORSO_HALF_WIDTH_TOP = 0.205;
const TORSO_DEPTH = 0.3;
const TORSO_BEVEL = 0.035;
const EAR_TIP_Y = 1.12;
const NOSE_Y = 0.74;
const EYE_Y = 0.845;
const HIP_Y = 0.22;
const SHOULDER_Y = 0.66;
const ARM_LENGTH = 0.3;
const WALK_ROLL = 0.08; // rad, per the animation spec
const TURN_RATE = 7.5; // rad/s toward setYawToward targets
const DEFAULT_FADE = 0.22;

/** Mutable pose channels applied to the rig every update(). */
interface Channels {
  bodyY: number;
  bodyTiltX: number;
  bodyRollZ: number;
  breathe: number;
  armLx: number;
  armLz: number;
  armRx: number;
  armRz: number;
  legLx: number;
  legRx: number;
  earLz: number;
  earRz: number;
}

const ZERO_CHANNELS: Channels = {
  bodyY: 0,
  bodyTiltX: 0,
  bodyRollZ: 0,
  breathe: 0,
  armLx: 0,
  armLz: 0,
  armRx: 0,
  armRz: 0,
  legLx: 0,
  legRx: 0,
  earLz: 0,
  earRz: 0,
};

export interface Kanshan {
  readonly object: THREE.Group;
  /** Current action (last play() call). */
  readonly currentAction: KanshanAction;
  /** World-space root position (feet origin). Read-only handle. */
  readonly position: THREE.Vector3;
  setPosition(x: number, y: number, z: number): void;
  /** XZ distance from the root to a point. */
  distanceTo(x: number, z: number): number;
  /** Cross-fade to a new action. */
  play(action: KanshanAction, opts?: KanshanPlayOptions): void;
  /** Advance procedural animation by one fixed step. */
  update(dt: number): void;
  /** Turn the body yaw toward a world XZ point, rate-limited. */
  setYawToward(x: number, z: number, dt: number): void;
  dispose(): void;
}

/**
 * Deterministic ear-twitch pulse: every TWITCH_PERIOD seconds the right ear
 * gets a short smooth wiggle (one pulse, then rest). fract() of a phase keeps
 * it test-reproducible.
 */
function earTwitch(t: number): number {
  const period = 4.7;
  const active = 0.42;
  const phase = (t % period) / active;
  if (phase < 0 || phase >= 1) return 0;
  return Math.sin(phase * Math.PI); // 0 → 1 → 0 inside the window
}

function poseFor(action: KanshanAction, t: number, out: Channels): Channels {
  switch (action) {
    case 'idle': {
      const w = Math.sin(t * 1.4);
      out.bodyY = w * 0.006;
      out.breathe = w * 0.008;
      out.armLx = Math.sin(t * 1.4 + Math.PI) * 0.04;
      out.armRx = Math.sin(t * 1.4) * 0.04;
      out.armLz = 0.1 + w * 0.02;
      out.armRz = -0.1 - w * 0.02;
      out.earLz = 0.24;
      out.earRz = -0.24 - earTwitch(t) * 0.22;
      return out;
    }
    case 'walk': {
      const p = t * 7; // stride frequency, rad/s
      const s = Math.sin(p);
      out.bodyY = Math.abs(s) * 0.025 - 0.012;
      out.bodyRollZ = s * WALK_ROLL; // the waddle
      out.bodyTiltX = 0.06;
      out.legLx = s * 0.55;
      out.legRx = -s * 0.55;
      out.armLx = -s * 0.3;
      out.armRx = s * 0.3;
      out.armLz = 0.12;
      out.armRz = -0.12;
      out.earLz = 0.24 + Math.sin(p * 2) * 0.03;
      out.earRz = -0.24 + Math.sin(p * 2) * 0.03;
      return out;
    }
    case 'wave': {
      const w = Math.sin(t * 7);
      out.bodyY = Math.sin(t * 3.5) * 0.008;
      out.bodyRollZ = w * 0.02;
      out.armRz = -2.25 + w * 0.18; // raised, oscillating
      out.armRx = -0.35;
      out.armLz = 0.1;
      out.earLz = 0.24;
      out.earRz = -0.24;
      return out;
    }
    case 'openDoor': {
      out.bodyY = -0.02;
      out.bodyTiltX = 0.3; // lean into the push
      out.armRx = -1.5 + Math.sin(t * 9) * 0.02; // reach, slight confident tremble
      out.armRz = -0.3;
      out.armLz = 0.14;
      out.earLz = 0.24;
      out.earRz = -0.24;
      return out;
    }
    case 'sit': {
      const w = Math.sin(t * 1.1);
      out.bodyY = -0.13;
      out.bodyTiltX = -0.08;
      out.legLx = -1.3; // legs folded forward
      out.legRx = -1.3;
      out.armLx = 0.1;
      out.armRx = 0.1;
      out.armLz = 0.16;
      out.armRz = -0.16;
      out.bodyY += w * 0.003;
      out.earLz = 0.24;
      out.earRz = -0.24;
      return out;
    }
  }
}

function smooth01(k: number): number {
  const x = Math.min(1, Math.max(0, k));
  return x * x * (3 - 2 * x);
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

interface PartNames {
  body: string;
  torso: string;
  earL: string;
  earR: string;
  nose: string;
  eyeL: string;
  eyeR: string;
  armL: string;
  armR: string;
  legL: string;
  legR: string;
  tail: string;
}

export function createKanshan(opts: KanshanOptions = {}): Kanshan {
  const prefix = opts.name ?? 'kanshan';
  const names: PartNames = {
    body: `${prefix}/body`,
    torso: `${prefix}/torso`,
    earL: `${prefix}/ear-l`,
    earR: `${prefix}/ear-r`,
    nose: `${prefix}/nose`,
    eyeL: `${prefix}/eye-l`,
    eyeR: `${prefix}/eye-r`,
    armL: `${prefix}/arm-l`,
    armR: `${prefix}/arm-r`,
    legL: `${prefix}/leg-l`,
    legR: `${prefix}/leg-r`,
    tail: `${prefix}/tail`,
  };

  const white = new THREE.MeshLambertMaterial({ color: WHITE });
  const black = new THREE.MeshLambertMaterial({ color: BLACK });

  const root = new THREE.Group();
  root.name = `${prefix}-root`;

  // Stage light: 看山 is the focal character in a dark hall — a small warm
  // fill riding above/front of him keeps his white body readable from any
  // angle without flattening the scene lighting.
  const fill = new THREE.PointLight(0xfff2dd, 3.0, 5.5, 1.6);
  fill.name = `${prefix}/fill-light`;
  fill.position.set(0, 1.5, 0.6);
  root.add(fill);

  // Body group carries bob/lean/roll/breathe; legs attach to the ROOT so a
  // sit-fold doesn't slide the feet under the floor with the lowered body.
  const body = new THREE.Group();
  body.name = names.body;
  body.position.y = TORSO_BOTTOM_Y;
  root.add(body);

  // Torso: rounded trapezoid profile (wider at the bottom), extruded + bevel.
  const wb = TORSO_HALF_WIDTH_BOTTOM;
  const wt = TORSO_HALF_WIDTH_TOP;
  const h = TORSO_HEIGHT;
  const rb = 0.11;
  const rt = 0.09;
  const shape = new THREE.Shape();
  shape.moveTo(-wb + rb, 0);
  shape.lineTo(wb - rb, 0);
  shape.quadraticCurveTo(wb, 0, wb, rb);
  shape.lineTo(wt, h - rt);
  shape.quadraticCurveTo(wt, h, wt - rt, h);
  shape.lineTo(-(wt - rt), h);
  shape.quadraticCurveTo(-wt, h, -wt, h - rt);
  shape.lineTo(-wb, rb);
  shape.quadraticCurveTo(-wb, 0, -wb + rb, 0);
  const torsoGeo = new THREE.ExtrudeGeometry(shape, {
    depth: TORSO_DEPTH,
    bevelEnabled: true,
    bevelThickness: TORSO_BEVEL,
    bevelSize: TORSO_BEVEL,
    bevelSegments: 1,
    curveSegments: 4,
  });
  torsoGeo.translate(0, 0, -TORSO_DEPTH / 2);
  const torso = new THREE.Mesh(torsoGeo, white);
  torso.name = names.torso;
  body.add(torso);

  // Ears: pointy cones on the top corners, tilted outward.
  const earGeo = new THREE.ConeGeometry(0.085, 0.24, 5);
  const earL = new THREE.Mesh(earGeo, white);
  earL.name = names.earL;
  earL.position.set(-0.125, TORSO_HEIGHT + 0.1, 0);
  earL.rotation.z = 0.24;
  const earR = new THREE.Mesh(earGeo, white);
  earR.name = names.earR;
  earR.position.set(0.125, TORSO_HEIGHT + 0.1, 0);
  earR.rotation.z = -0.24;
  body.add(earL, earR);

  // Nose: big black oval, proud of the face.
  const noseGeo = new THREE.SphereGeometry(1, 12, 10);
  const nose = new THREE.Mesh(noseGeo, black);
  nose.name = names.nose;
  nose.scale.set(0.088, 0.105, 0.09);
  nose.position.set(0, NOSE_Y - TORSO_BOTTOM_Y, TORSO_DEPTH / 2 + TORSO_BEVEL + 0.015);
  body.add(nose);

  // Eyes: two small black dots beside the nose top.
  const eyeGeo = new THREE.SphereGeometry(0.021, 8, 6);
  const eyeL = new THREE.Mesh(eyeGeo, black);
  eyeL.name = names.eyeL;
  eyeL.position.set(-0.105, EYE_Y - TORSO_BOTTOM_Y, TORSO_DEPTH / 2 + TORSO_BEVEL - 0.005);
  const eyeR = new THREE.Mesh(eyeGeo, black);
  eyeR.name = names.eyeR;
  eyeR.position.set(0.105, EYE_Y - TORSO_BOTTOM_Y, TORSO_DEPTH / 2 + TORSO_BEVEL - 0.005);
  body.add(eyeL, eyeR);

  // Tail: small white stub at the back.
  const tail = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), white);
  tail.name = names.tail;
  tail.scale.set(1, 0.9, 1);
  tail.position.set(0, 0.16, -(TORSO_DEPTH / 2 + TORSO_BEVEL - 0.005));
  body.add(tail);

  // Arms: shoulder-pivot groups; thin cylinder + paw blob + two toe bumps.
  const armGeo = new THREE.CylinderGeometry(0.024, 0.026, ARM_LENGTH - 0.04, 6);
  armGeo.translate(0, -(ARM_LENGTH - 0.04) / 2, 0);
  const pawGeo = new THREE.SphereGeometry(0.04, 8, 6);
  const toeGeo = new THREE.SphereGeometry(0.016, 6, 4);
  const makeArm = (side: -1 | 1): THREE.Group => {
    const g = new THREE.Group();
    g.position.set(side * 0.255, SHOULDER_Y - TORSO_BOTTOM_Y, 0);
    const limb = new THREE.Mesh(armGeo, black);
    const paw = new THREE.Mesh(pawGeo, black);
    paw.scale.set(0.9, 1.05, 0.9);
    paw.position.y = -ARM_LENGTH + 0.02;
    const toeL = new THREE.Mesh(toeGeo, black);
    toeL.position.set(-0.018, -ARM_LENGTH - 0.005, 0.012);
    const toeR = new THREE.Mesh(toeGeo, black);
    toeR.position.set(0.018, -ARM_LENGTH - 0.005, 0.012);
    g.add(limb, paw, toeL, toeR);
    body.add(g);
    return g;
  };
  const armL = makeArm(-1);
  armL.name = names.armL;
  const armR = makeArm(1);
  armR.name = names.armR;

  // Legs: hip-pivot groups on the root; thin cylinder + round flat foot.
  const legGeo = new THREE.CylinderGeometry(0.027, 0.03, 0.17, 6);
  legGeo.translate(0, -0.085, 0);
  const footGeo = new THREE.SphereGeometry(0.05, 8, 6);
  const makeLeg = (side: -1 | 1): THREE.Group => {
    const g = new THREE.Group();
    g.position.set(side * 0.1, HIP_Y, 0);
    const limb = new THREE.Mesh(legGeo, black);
    const foot = new THREE.Mesh(footGeo, black);
    foot.scale.set(0.85, 0.5, 1.3);
    foot.position.set(0, -0.185, 0.02);
    g.add(limb, foot);
    root.add(g);
    return g;
  };
  const legL = makeLeg(-1);
  legL.name = names.legL;
  const legR = makeLeg(1);
  legR.name = names.legR;

  let action: KanshanAction = 'idle';
  let t = 0;
  let blendK = 1;
  let blendSec = DEFAULT_FADE;
  const blendFrom: Channels = { ...ZERO_CHANNELS };
  const poseTarget: Channels = { ...ZERO_CHANNELS };
  const poseCurrent: Channels = { ...ZERO_CHANNELS };

  const apply = (c: Channels): void => {
    body.position.y = TORSO_BOTTOM_Y + c.bodyY;
    body.rotation.x = c.bodyTiltX;
    body.rotation.z = c.bodyRollZ;
    body.scale.y = 1 + c.breathe;
    armL.rotation.x = c.armLx;
    armL.rotation.z = c.armLz;
    armR.rotation.x = c.armRx;
    armR.rotation.z = c.armRz;
    legL.rotation.x = c.legLx;
    legR.rotation.x = c.legRx;
    earL.rotation.z = c.earLz;
    earR.rotation.z = c.earRz;
  };

  apply(poseFor('idle', 0, poseCurrent));

  return {
    object: root,
    get currentAction(): KanshanAction {
      return action;
    },
    get position(): THREE.Vector3 {
      return root.position;
    },
    setPosition(x: number, y: number, z: number): void {
      root.position.set(x, y, z);
    },
    distanceTo(x: number, z: number): number {
      return Math.hypot(root.position.x - x, root.position.z - z);
    },
    play(next: KanshanAction, opts: KanshanPlayOptions = {}): void {
      if (next === action && blendK >= 1) return;
      // Capture the live pose as the blend source so cross-fades never pop.
      for (const k of Object.keys(poseCurrent) as Array<keyof Channels>) blendFrom[k] = poseCurrent[k];
      action = next;
      blendSec = Math.max(0.0001, opts.fadeSec ?? DEFAULT_FADE);
      blendK = 0;
    },
    update(dt: number): void {
      if (!(dt >= 0) || !Number.isFinite(dt)) return;
      t += dt;
      poseFor(action, t, poseTarget);
      if (blendK < 1) {
        blendK = Math.min(1, blendK + dt / blendSec);
        const k = smooth01(blendK);
        for (const key of Object.keys(poseTarget) as Array<keyof Channels>) {
          poseCurrent[key] = blendFrom[key] + (poseTarget[key] - blendFrom[key]) * k;
        }
      } else {
        for (const key of Object.keys(poseTarget) as Array<keyof Channels>) poseCurrent[key] = poseTarget[key];
      }
      apply(poseCurrent);
    },
    setYawToward(x: number, z: number, dt: number): void {
      const dx = x - root.position.x;
      const dz = z - root.position.z;
      if (Math.hypot(dx, dz) < 1e-6) return;
      const target = Math.atan2(dx, dz); // body faces +Z at yaw 0
      const delta = wrapAngle(target - root.rotation.y);
      const max = TURN_RATE * Math.max(0, dt);
      root.rotation.y += Math.min(max, Math.max(-max, delta));
    },
    dispose(): void {
      root.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
      white.dispose();
      black.dispose();
    },
  };
}
