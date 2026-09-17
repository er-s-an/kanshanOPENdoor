import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Scope } from '../../src/creative/core/scope.ts';
import { CameraShake, ScreenFade, ScreenFlash } from '../../src/creative/effects/index.ts';

function findOverlay(camera: THREE.Camera, name: string): THREE.Mesh {
  const mesh = camera.children.find((c) => c.name === name);
  assert.ok(mesh, `overlay ${name} attached to camera`);
  return mesh as THREE.Mesh;
}

function materialOf(camera: THREE.Camera, name: string): THREE.MeshBasicMaterial {
  return findOverlay(camera, name).material as THREE.MeshBasicMaterial;
}

// Pixels are NOT_MEASURED; these tests read overlay material state and camera
// transforms (presentation-only effects — never gameplay facts).

test('fade: alpha tracks coverage step by step; nothing advances without update() (pause-aware)', () => {
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 100);
  const scope = new Scope();
  const fade = new ScreenFade(camera, { scope });
  const mat = materialOf(camera, 'screen-fade');
  const mesh = findOverlay(camera, 'screen-fade');

  fade.fadeOut(1, 0x000000);
  assert.equal(fade.progress, 0);
  assert.equal(mat.opacity, 0); // no update yet: paused simulations freeze it
  assert.equal(mesh.visible, false);

  for (const expected of [0.25, 0.5, 0.75, 1]) {
    fade.update(0.25);
    assert.ok(Math.abs(fade.progress - expected) < 1e-9);
    assert.ok(Math.abs(mat.opacity - expected) < 1e-9);
  }
  assert.equal(mesh.visible, true);
  assert.equal(mat.color.getHex(), 0x000000);
});

test('fade: overlay covers the perspective frustum at z=-1', () => {
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 100);
  const scope = new Scope();
  new ScreenFade(camera, { scope });
  const mesh = findOverlay(camera, 'screen-fade');
  const expectedH = 2 * Math.tan(THREE.MathUtils.degToRad(60) / 2);
  const expectedW = expectedH * (16 / 9);
  assert.ok(Math.abs(mesh.scale.x - expectedW) < 1e-6);
  assert.ok(Math.abs(mesh.scale.y - expectedH) < 1e-6);
  assert.equal(mesh.renderOrder, 1000);
});

test('fade: fadeTo lerps color over the duration; fadeIn reveals', () => {
  const camera = new THREE.PerspectiveCamera();
  const scope = new Scope();
  const fade = new ScreenFade(camera, { scope });

  fade.fadeTo(0xff0000, 1);
  fade.update(0.5);
  const mid = fade.currentColor;
  assert.ok(Math.abs(mid.r - 0.5) < 1e-6);
  assert.ok(Math.abs(mid.g) < 1e-6);
  assert.ok(Math.abs(mid.b) < 1e-6);
  fade.update(0.5);
  assert.equal(fade.currentColor.getHex(), 0xff0000);

  fade.fadeIn(1);
  fade.update(0.5);
  assert.ok(Math.abs(fade.progress - 0.5) < 1e-9);
  fade.update(0.5);
  assert.equal(fade.progress, 0);
  assert.equal(findOverlay(camera, 'screen-fade').visible, false);
});

test('fade: reduce-motion makes fades instant on/off', () => {
  const camera = new THREE.PerspectiveCamera();
  const scope = new Scope();
  const fade = new ScreenFade(camera, { scope, reduceMotion: true });

  fade.fadeOut(1);
  assert.equal(fade.progress, 1);
  fade.update(1 / 60);
  assert.equal(materialOf(camera, 'screen-fade').opacity, 1);

  fade.fadeIn(1);
  assert.equal(fade.progress, 0);
  fade.update(1 / 60);
  assert.equal(findOverlay(camera, 'screen-fade').visible, false);
});

test('fade: scope dispose removes the overlay from the camera', () => {
  const camera = new THREE.PerspectiveCamera();
  const scope = new Scope();
  const fade = new ScreenFade(camera, { scope });
  assert.equal(camera.children.length, 1);
  scope.dispose();
  assert.equal(fade.isDisposed, true);
  assert.equal(camera.children.length, 0);
});

test('flash: instant on, linear decay to off', () => {
  const camera = new THREE.PerspectiveCamera();
  const scope = new Scope();
  const flash = new ScreenFlash(camera, { scope });
  const mat = materialOf(camera, 'screen-flash');
  const mesh = findOverlay(camera, 'screen-flash');

  flash.flash(0xffffff, 0.5, 0.8);
  assert.equal(flash.active, true);
  assert.ok(Math.abs(mat.opacity - 0.8) < 1e-9);

  flash.update(0.25);
  assert.ok(Math.abs(mat.opacity - 0.4) < 1e-9);
  flash.update(0.25);
  assert.equal(flash.active, false);
  assert.equal(mat.opacity, 0);
  assert.equal(mesh.visible, false);
});

test('flash: reduce-motion suppresses flashes', () => {
  const camera = new THREE.PerspectiveCamera();
  const scope = new Scope();
  const flash = new ScreenFlash(camera, { scope, reduceMotion: true });
  flash.flash(0xffffff, 0.5, 1);
  assert.equal(flash.active, false);
  assert.equal(materialOf(camera, 'screen-flash').opacity, 0);
});

test('shake: offsets are bounded, decay with sim dt, and restore the base transform', () => {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(10, 5, -2);
  camera.rotation.z = 0.3;
  const scope = new Scope();
  const shake = new CameraShake({ scope, amplitude: 0.5, decay: 2.5, roll: 0.06 });
  const base = camera.position.clone();
  const baseRotZ = camera.rotation.z;

  shake.shake(1);
  assert.equal(shake.traumaLevel, 1);
  shake.update(1 / 60);
  const o1 = shake.currentOffset;
  assert.ok(o1.length() > 0);
  for (const c of [o1.x, o1.y, o1.z]) assert.ok(Math.abs(c) <= 0.5 + 1e-9, 'component within amplitude');
  assert.ok(Math.abs(shake.currentRoll) <= 0.06 + 1e-9);

  shake.apply(camera);
  assert.notDeepEqual(camera.position.toArray(), base.toArray());
  assert.ok(Math.abs(camera.rotation.z - baseRotZ) > 0);

  shake.update(2); // trauma *= e^-5
  assert.ok(shake.traumaLevel < 0.01);
  assert.ok(shake.currentOffset.length() < o1.length());
  shake.apply(camera);
  shake.restore();
  assert.ok(camera.position.equals(base), 'base position restored');
  assert.ok(Math.abs(camera.rotation.z - baseRotZ) < 1e-9, 'base rotation restored');
  shake.update(2); // decay past the epsilon floor
  assert.equal(shake.traumaLevel, 0);
  assert.equal(shake.isShaking, false);
});

test('shake: applying twice in a frame never accumulates offset', () => {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(1, 2, 3);
  const scope = new Scope();
  const shake = new CameraShake({ scope, amplitude: 1 });
  const base = camera.position.clone();

  shake.shake(1);
  shake.update(1 / 60);
  shake.apply(camera);
  const afterFirst = camera.position.clone();
  shake.apply(camera); // re-apply without owner rewrite: subtract-then-add
  assert.ok(camera.position.distanceTo(afterFirst) < 1e-9);
  shake.restore();
  assert.ok(camera.position.equals(base));
});

test('shake: reduce-motion produces zero offset; scope dispose restores the camera', () => {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(4, 0, 7);
  const base = camera.position.clone();

  const rmScope = new Scope();
  const rmShake = new CameraShake({ scope: rmScope, amplitude: 1, reduceMotion: true });
  rmShake.shake(1);
  assert.equal(rmShake.traumaLevel, 0);
  rmShake.update(1 / 60);
  assert.equal(rmShake.currentOffset.length(), 0);
  rmShake.apply(camera);
  assert.ok(camera.position.equals(base));

  const scope = new Scope();
  const shake = new CameraShake({ scope, amplitude: 0.5 });
  shake.shake(1);
  shake.update(1 / 60);
  shake.apply(camera);
  assert.ok(!camera.position.equals(base));
  scope.dispose();
  assert.ok(camera.position.equals(base), 'scope dispose restores the camera base pose');
});

test('all effects: per-step sim dt drives progress (pause = no update calls)', () => {
  const camera = new THREE.PerspectiveCamera();
  const scope = new Scope();
  const fade = new ScreenFade(camera, { scope });
  const flash = new ScreenFlash(camera, { scope });

  fade.fadeOut(2);
  flash.flash(0xffffff, 2);
  // No update calls: sim is paused; nothing moves.
  assert.equal(fade.progress, 0);
  assert.equal(flash.active, true);
  assert.equal(materialOf(camera, 'screen-flash').opacity, 1);

  fade.update(1);
  assert.equal(fade.progress, 0.5);
  flash.update(1);
  assert.ok(Math.abs(materialOf(camera, 'screen-flash').opacity - 0.5) < 1e-9);
});
