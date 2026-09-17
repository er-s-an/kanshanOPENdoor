import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RuntimeSessionHost } from '../../src/creative/core/index.ts';
import type { SceneContext, SceneInstance } from '../../src/creative/core/index.ts';
import { CameraDirector, FixedRig, FollowRig, PathRig } from '../../src/creative/camera/rigs.ts';
import type { CameraPose } from '../../src/creative/camera/rigs.ts';
import { cue, timeline, cameraBlend, cameraCut, tween, wait } from '../../src/creative/animation/timeline.ts';
import type { Timeline, TimelineHandle } from '../../src/creative/animation/timeline.ts';

const DT = 1 / 60;

function approx(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) <= eps;
}

function approxVec(v: THREE.Vector3, x: number, y: number, z: number, eps = 1e-6): boolean {
  return approx(v.x, x, eps) && approx(v.y, y, eps) && approx(v.z, z, eps);
}

function catchCode(fn: () => void): string | undefined {
  try {
    fn();
  } catch (err) {
    return (err as { code?: string }).code;
  }
  return undefined;
}

test('FixedRig holds a static pose and looks at its target', () => {
  const camera = new THREE.PerspectiveCamera();
  const rig = new FixedRig('fixed', { position: [0, 2, 5], lookAt: [0, 0, 0] });
  rig.update(DT);
  const director = new CameraDirector(camera, rig);
  director.update(DT);
  director.apply();
  assert.ok(approxVec(camera.position, 0, 2, 5));
  const dir = camera.getWorldDirection(new THREE.Vector3());
  const expected = new THREE.Vector3(0, 0, 0).sub(new THREE.Vector3(0, 2, 5)).normalize();
  assert.ok(approxVec(dir, expected.x, expected.y, expected.z, 1e-6), 'camera looks toward the target');
});

test('FollowRig damping converges to target+offset and never writes the target', () => {
  const player = new THREE.Object3D();
  player.position.set(1, 0, 1);
  const rig = new FollowRig('follow', { target: player, offset: [0, 2, 4], damping: 6 });
  const pose: CameraPose = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };

  for (let i = 0; i < 240; i += 1) rig.update(DT);
  rig.getPose(pose);
  assert.ok(approxVec(pose.position, 1, 2, 5, 1e-3), `converged to target+offset, got ${pose.position.toArray()}`);

  player.position.set(5, 0, 5); // player moves (authoritative controller)
  for (let i = 0; i < 240; i += 1) rig.update(DT);
  rig.getPose(pose);
  assert.ok(approxVec(pose.position, 5, 2, 9, 1e-3), 'tracks the moved target');

  assert.ok(approxVec(player.position, 5, 0, 5, 0), 'rig never wrote the player transform');
});

test('PathRig samples the curve at t and loops when asked', () => {
  const points = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 0, 0), new THREE.Vector3(10, 0, 10)];
  const expectedCurve = new THREE.CatmullRomCurve3(points.map((p) => p.clone()));
  const pose: CameraPose = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };

  const rig = new PathRig('path', { points, duration: 10, lookAt: 'forward' });
  rig.update(5); // half the traverse
  assert.ok(approx(rig.progress, 0.5, 1e-9));
  rig.getPose(pose);
  const expected = expectedCurve.getPoint(0.5);
  assert.ok(approxVec(pose.position, expected.x, expected.y, expected.z, 1e-6), 'position at t is the curve point');
  assert.ok(
    pose.quaternion.length() > 0.99 && pose.quaternion.length() < 1.01,
    'forward look yields a valid orientation',
  );

  const loop = new PathRig('loop', { points, duration: 10, loop: true });
  loop.update(12); // 1.2 traversals -> wraps to 0.2
  assert.ok(approx(loop.progress, 0.2, 1e-9));
  loop.getPose(pose);
  const wrapped = expectedCurve.getPoint(0.2);
  assert.ok(approxVec(pose.position, wrapped.x, wrapped.y, wrapped.z, 1e-6));
});

test('director cut/blend: camera pose interpolates and the active rig swaps after the blend', () => {
  const camera = new THREE.PerspectiveCamera();
  const rigA = new FixedRig('a', { position: [0, 0, 0], lookAt: [0, 0, -1] });
  const rigB = new FixedRig('b', { position: [10, 0, 0], lookAt: [10, 0, -1] });
  const director = new CameraDirector(camera, rigA);

  director.update(DT);
  director.apply();
  assert.ok(approxVec(camera.position, 0, 0, 0));
  assert.equal(director.activeRig, rigA);

  director.blendTo(rigB, 1);
  assert.equal(director.blending, true);
  assert.equal(director.activeRig, rigB, 'during a blend the incoming rig is the effective rig');

  director.update(0.25);
  director.apply();
  assert.ok(approx(camera.position.x, 2.5, 1e-6), 'linear blend weight at t=0.25 of 1s');
  assert.ok(approx(director.blendWeight, 0.25, 1e-9));

  director.update(0.75);
  director.apply();
  assert.equal(director.blending, false, 'blend completes');
  assert.equal(director.activeRig, rigB);
  assert.ok(approxVec(camera.position, 10, 0, 0));

  director.cut(rigA);
  director.apply();
  assert.ok(approxVec(camera.position, 0, 0, 0), 'cut snaps instantly');
});

test('takeover token: cut holds, direct ops rejected, release restores the exact previous rig; player untouched', () => {
  const camera = new THREE.PerspectiveCamera();
  const player = new THREE.Object3D();
  player.position.set(2, 0, 2);
  const follow = new FollowRig('follow', { target: player, offset: [0, 3, 6], damping: 8 });
  const director = new CameraDirector(camera, follow);
  for (let i = 0; i < 300; i += 1) director.update(DT);
  director.apply();
  assert.ok(approxVec(camera.position, 2, 3, 8, 1e-3), 'follow rig converged before takeover');

  const csRig = new FixedRig('cs', { position: [50, 10, 50], lookAt: [0, 0, 0] });
  const token = director.takeover();
  assert.equal(director.takeoverHeld, true);
  assert.equal(
    catchCode(() => director.cut(csRig)),
    'CAMERA_TAKEOVER_HELD',
    'director.cut rejected while a token is held',
  );

  token.cut(csRig);
  director.update(DT);
  director.apply();
  assert.ok(approxVec(camera.position, 50, 10, 50), 'cutscene rig drives the camera');
  assert.ok(approxVec(player.position, 2, 0, 2, 0), 'camera never writes the player transform');

  token.release();
  assert.equal(token.released, true);
  assert.equal(director.takeoverHeld, false);
  assert.equal(director.activeRig, follow, 'previous rig restored exactly (identity)');
  assert.equal(catchCode(() => token.cut(csRig)), 'CAMERA_TOKEN_RELEASED', 'ops after release throw');

  for (let i = 0; i < 300; i += 1) director.update(DT);
  director.apply();
  assert.ok(approxVec(camera.position, 2, 3, 8, 1e-3), 'follow rig resumes converging with no drift');
  assert.ok(approxVec(player.position, 2, 0, 2, 0), 'player position still exact');

  token.release(); // idempotent
});

test('takeover tokens are strictly LIFO', () => {
  const camera = new THREE.PerspectiveCamera();
  const rig = new FixedRig('base', { position: [0, 0, 0], lookAt: [0, 0, -1] });
  const director = new CameraDirector(camera, rig);
  const t1 = director.takeover();
  const t2 = director.takeover();
  assert.equal(catchCode(() => t1.release()), 'CAMERA_TOKEN_ORDER', 'out-of-order release rejected');
  t2.release();
  t1.release();
  assert.equal(director.takeoverHeld, false);
  assert.equal(director.activeRig, rig);
});

test('restore resumes an in-flight blend from where it was interrupted', () => {
  const camera = new THREE.PerspectiveCamera();
  const rigA = new FixedRig('a', { position: [0, 0, 0], lookAt: [0, 0, -1] });
  const rigB = new FixedRig('b', { position: [10, 0, 0], lookAt: [10, 0, -1] });
  const director = new CameraDirector(camera, rigA);
  director.blendTo(rigB, 1);
  director.update(0.5); // halfway through a game-code blend

  const token = director.takeover();
  token.cut(rigA);
  token.release();
  assert.equal(director.blending, true, 'interrupted blend state restored');
  assert.ok(approx(director.blendWeight, 0.5, 1e-9), 'blend weight preserved');
  director.update(0.5);
  director.apply();
  assert.equal(director.blending, false);
  assert.ok(approxVec(camera.position, 10, 0, 0), 'restored blend completes to its original target');
});

interface CamRefs {
  ctx: SceneContext;
  player: THREE.Object3D;
  camera: THREE.PerspectiveCamera;
  director: CameraDirector;
  follow: FollowRig;
  cutscene?: Timeline;
  handle?: TimelineHandle;
}

test('timeline camera cut + release: prior follow rig resumes, cue commits once, player transform untouched (G09)', async () => {
  const refs = {} as CamRefs;
  const host = new RuntimeSessionHost({
    experienceDigest: 'exp-cam',
    buildId: 'build-cam',
    mode: 'controlled',
    fixedDt: DT,
  });
  await host.start({
    create(ctx: SceneContext): SceneInstance {
      refs.ctx = ctx;
      const root = new THREE.Group();
      refs.player = new THREE.Object3D();
      refs.player.position.set(3, 0, 3);
      root.add(refs.player);
      refs.camera = new THREE.PerspectiveCamera();
      refs.follow = new FollowRig('follow', { target: refs.player, offset: [0, 2, 4], damping: 8 });
      refs.director = new CameraDirector(refs.camera, refs.follow);
      refs.director.attach(ctx);
      const csRig = new FixedRig('cs-fixed', { position: [40, 12, 40], lookAt: [0, 0, 0] });
      refs.cutscene = timeline('cutscene')
        .add(cameraCut(csRig), wait(0.3), cue('cutscene.done'))
        .add(cameraCut(refs.follow));
      return { root };
    },
  });

  // Settle the follow rig first; the cutscene only starts when we run it.
  host.step(300);
  assert.ok(approxVec(refs.camera.position, 3, 2, 7, 1e-3), 'follow rig settled');

  refs.handle = refs.cutscene!.run(refs.ctx, { camera: refs.director });
  host.step(2); // cutscene takes over
  assert.equal(refs.director.activeRig!.name, 'cs-fixed');
  assert.ok(approxVec(refs.camera.position, 40, 12, 40, 1e-6), 'cutscene rig drives the camera');
  assert.ok(approxVec(refs.player.position, 3, 0, 3, 0), 'player untouched during the cutscene');

  host.step(60); // well past the 0.3s wait and the final cut back
  assert.equal(refs.handle!.state, 'completed', 'timeline completed');
  assert.equal(
    host.commits.entries.filter((e) => e.name === 'cutscene.done').length,
    1,
    'cue committed exactly once',
  );
  assert.equal(refs.director.activeRig, refs.follow, 'control returned to the previous rig after the takeover');
  assert.equal(refs.director.takeoverHeld, false, 'token released');

  host.step(300);
  assert.ok(approxVec(refs.camera.position, 3, 2, 7, 1e-3), 'follow rig resumes with no drift');
  assert.ok(approxVec(refs.player.position, 3, 0, 3, 0), 'player position exact at the end');
  await host.stop();
});

test('timeline cameraBlend is driven by the director clock and completes deterministically', async () => {
  const refs = {} as CamRefs;
  const host = new RuntimeSessionHost({
    experienceDigest: 'exp-cam2',
    buildId: 'build-cam2',
    mode: 'controlled',
    fixedDt: DT,
  });
  await host.start({
    create(ctx: SceneContext): SceneInstance {
      refs.ctx = ctx;
      const root = new THREE.Group();
      refs.player = new THREE.Object3D();
      root.add(refs.player);
      refs.camera = new THREE.PerspectiveCamera();
      refs.follow = new FollowRig('follow', { target: refs.player, offset: [0, 2, 4] });
      refs.director = new CameraDirector(refs.camera, refs.follow);
      refs.director.attach(ctx);
      const rigB = new FixedRig('b', { position: [10, 0, 0], lookAt: [0, 0, 0] });
      refs.cutscene = timeline('blend-cs').add(
        cameraBlend(rigB, 0.5),
        wait(0.1),
        tween({ target: refs.player, props: { 'position.x': 0 }, duration: 0.1 }),
      );
      return { root };
    },
  });

  host.step(120); // settle the follow rig before the cutscene
  refs.handle = refs.cutscene!.run(refs.ctx, { camera: refs.director });

  host.step(15); // blend created at step 1; director advanced it 14 steps by now
  assert.equal(refs.director.blending, true);
  assert.ok(
    approx(refs.director.blendWeight, (14 * DT) / 0.5, 1e-9),
    'blend weight driven by director updates',
  );

  host.step(60); // past blend + wait + trivial tween
  assert.equal(refs.handle!.state, 'completed');
  assert.equal(refs.director.blending, false, 'blend completed via natural play');
  assert.equal(refs.director.activeRig, refs.follow, 'token released back to the follow rig');
  await host.stop();
});

test('timeline with camera steps but no director throws a descriptive error', async () => {
  const host = new RuntimeSessionHost({
    experienceDigest: 'exp-cam3',
    buildId: 'build-cam3',
    mode: 'controlled',
    fixedDt: DT,
  });
  await host.start({
    create(ctx: SceneContext): SceneInstance {
      const root = new THREE.Group();
      const rig = new FixedRig('lonely', { position: [0, 0, 5], lookAt: [0, 0, 0] });
      timeline('no-director').add(cameraCut(rig)).run(ctx);
      return { root };
    },
  });
  host.step(1);
  assert.equal(host.currentStatus, 'error', 'missing director is a diagnosed module error');
  const diag = host.diagnosticsLog.find((d) => d.code === 'CAMERA_DIRECTOR_MISSING');
  assert.ok(diag, 'diagnostic carries CAMERA_DIRECTOR_MISSING');
  await host.stop();
});
