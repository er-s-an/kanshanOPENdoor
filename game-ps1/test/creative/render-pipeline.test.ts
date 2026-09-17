import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  PS1_BG,
  PS1_DEFAULT_FOG_DENSITY,
  PS1_SKIP_PATCH,
  PS1RenderPipeline,
} from '../../src/creative/render/ps1-pipeline.ts';

/** Headless stand-in: records render-target switches and camera snapshots. */
function fakeRenderer() {
  const targets: unknown[] = [];
  const snapshots: Array<{ x: number; y: number; z: number; roll: number }> = [];
  const renderer = {
    targets,
    snapshots,
    setRenderTarget(target: unknown) {
      targets.push(target);
    },
    render(_scene: unknown, camera: THREE.PerspectiveCamera) {
      snapshots.push({
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z,
        roll: camera.rotation.z,
      });
    },
  };
  return renderer as unknown as THREE.WebGLRenderer & {
    targets: unknown[];
    snapshots: Array<{ x: number; y: number; z: number; roll: number }>;
  };
}

function makeCamera(): THREE.PerspectiveCamera {
  return new THREE.PerspectiveCamera(75, 4 / 3, 0.05, 60);
}

test('constructor applies preset background and explicit fog to the scene (G04)', () => {
  const scene = new THREE.Scene();
  const pipeline = new PS1RenderPipeline(fakeRenderer(), scene);
  assert.ok(scene.background instanceof THREE.Color);
  assert.equal((scene.background as THREE.Color).getHex(), PS1_BG);
  assert.ok(scene.fog instanceof THREE.FogExp2);
  assert.equal(scene.fog.density, PS1_DEFAULT_FOG_DENSITY);
  pipeline.dispose();
});

test('fog is decoupled: myopia no longer feeds fog density (G04)', () => {
  const scene = new THREE.Scene();
  const pipeline = new PS1RenderPipeline(fakeRenderer(), scene);
  const fog = scene.fog as THREE.FogExp2;

  pipeline.setMyopia(1);
  pipeline.render(1 / 60, makeCamera());
  assert.equal(fog.density, PS1_DEFAULT_FOG_DENSITY, 'old formula would give 0.65');
  assert.equal(scene.fog, fog, 'pipeline does not even recreate the fog object');

  pipeline.setMyopia(0.35);
  pipeline.render(1 / 60, makeCamera());
  assert.equal(scene.fog instanceof THREE.FogExp2 ? scene.fog.density : null, PS1_DEFAULT_FOG_DENSITY);
  pipeline.dispose();
});

test('preset fog null renders fog-free even if the scene had fog (G04)', () => {
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xffffff, 0.9);
  const pipeline = new PS1RenderPipeline(fakeRenderer(), scene, { fog: null });
  assert.equal(scene.fog, null);
  pipeline.setMyopia(1);
  pipeline.render(1 / 60, makeCamera());
  assert.equal(scene.fog, null);
  pipeline.dispose();
});

test('distance defocus preset on/off gates the myopia uniform (G04)', () => {
  const scene = new THREE.Scene();
  const off = new PS1RenderPipeline(fakeRenderer(), scene, { distanceDefocus: { enabled: false } });
  off.setMyopia(1);
  off.render(1 / 60, makeCamera());
  assert.equal(off.uniforms.uMyopia.value, 0, 'defocus disabled forces the uniform to 0');
  off.dispose();

  const scene2 = new THREE.Scene();
  const on = new PS1RenderPipeline(fakeRenderer(), scene2);
  on.setMyopia(0.8);
  on.render(1 / 60, makeCamera());
  assert.equal(on.uniforms.uMyopia.value, 0.8);
  on.setMyopia(5);
  on.render(1 / 60, makeCamera());
  assert.equal(on.uniforms.uMyopia.value, 1, 'clamped');
  on.dispose();
});

test('vignette channel is opt-in and driven only by setVignette (G04)', () => {
  const scene = new THREE.Scene();
  const off = new PS1RenderPipeline(fakeRenderer(), scene);
  off.setVignette(0.9);
  off.render(1 / 60, makeCamera());
  assert.equal(off.uniforms.uSquint.value, 0, 'default off: no input action is wired');
  off.dispose();

  const scene2 = new THREE.Scene();
  const on = new PS1RenderPipeline(fakeRenderer(), scene2, {
    vignette: { enabled: true, strength: 0.5 },
  });
  on.render(1 / 60, makeCamera());
  assert.equal(on.uniforms.uSquint.value, 0.5);
  on.setVignette(0.9);
  on.render(1 / 60, makeCamera());
  assert.equal(on.uniforms.uSquint.value, 0.9);
  on.dispose();
});

test('dither preset toggles the dither uniform (G04)', () => {
  const scene = new THREE.Scene();
  const on = new PS1RenderPipeline(fakeRenderer(), scene);
  assert.equal(on.uniforms.uDither.value, 0.8);
  on.dispose();
  const scene2 = new THREE.Scene();
  const off = new PS1RenderPipeline(fakeRenderer(), scene2, { dither: false });
  assert.equal(off.uniforms.uDither.value, 0);
  off.dispose();
});

test('material patcher: patches once per material uuid, late materials picked up (G04)', () => {
  const scene = new THREE.Scene();
  const tex = new THREE.Texture();
  const mat = new THREE.MeshBasicMaterial({ map: tex });
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat));

  const pipeline = new PS1RenderPipeline(fakeRenderer(), scene);
  pipeline.render(1 / 60, makeCamera());
  assert.equal(tex.magFilter, THREE.NearestFilter);
  assert.equal(tex.minFilter, THREE.NearestFilter);
  assert.equal(pipeline.patchedMaterialCount, 1);
  assert.ok(pipeline.isMaterialPatched(mat));

  pipeline.render(1 / 60, makeCamera());
  assert.equal(pipeline.patchedMaterialCount, 1, 'idempotent: no re-patch on later frames');

  const tex2 = new THREE.Texture();
  const mat2 = new THREE.MeshBasicMaterial({ map: tex2 });
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat2));
  pipeline.render(1 / 60, makeCamera());
  assert.equal(pipeline.patchedMaterialCount, 2, 'new material discovered by the per-frame traverse');
  assert.equal(tex2.minFilter, THREE.NearestFilter);
  pipeline.dispose();
});

test('material patcher: opt-out flag and native ShaderMaterial bypass untouched (G04)', () => {
  const scene = new THREE.Scene();
  const optedTex = new THREE.Texture();
  const optedOut = new THREE.MeshBasicMaterial({ map: optedTex });
  optedOut.userData[PS1_SKIP_PATCH] = true;
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), optedOut));

  const shaderMat = new THREE.ShaderMaterial();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), shaderMat));

  const plainTex = new THREE.Texture();
  const plain = new THREE.MeshBasicMaterial({ map: plainTex });
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), plain));

  const pipeline = new PS1RenderPipeline(fakeRenderer(), scene);
  pipeline.render(1 / 60, makeCamera());

  assert.equal(optedTex.magFilter, THREE.LinearFilter, 'opt-out texture untouched');
  assert.equal(optedTex.minFilter, THREE.LinearMipmapLinearFilter);
  assert.equal(optedOut.version, 0, 'opt-out material not mutated (needsUpdate never set)');
  assert.equal(shaderMat.version, 0, 'native shader material untouched');
  assert.equal(plainTex.minFilter, THREE.NearestFilter, 'ordinary materials still patched');

  pipeline.render(1 / 60, makeCamera());
  assert.equal(optedOut.version, 0, 'bypass stays permanent across frames');
  pipeline.dispose();
});

test('beforeComposite hook runs once per frame and unsubscribes (G04)', () => {
  const scene = new THREE.Scene();
  const renderer = fakeRenderer();
  const pipeline = new PS1RenderPipeline(renderer, scene);
  const calls: Array<{ dt: number; renderTarget: unknown; camera: unknown }> = [];
  const unsub = pipeline.onBeforeComposite((frame) => {
    calls.push({ dt: frame.dt, renderTarget: frame.renderTarget, camera: frame.camera });
  });

  const cam = makeCamera();
  pipeline.render(1 / 60, cam);
  pipeline.render(1 / 60, cam);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].dt, 1 / 60);
  assert.equal(calls[0].renderTarget, pipeline.renderTarget);
  assert.equal(calls[0].camera, cam);

  unsub();
  pipeline.render(1 / 60, cam);
  assert.equal(calls.length, 2, 'unsubscribed hook stops firing');
  pipeline.dispose();
});

test('quality tiers switch render target size at runtime (G04)', () => {
  const scene = new THREE.Scene();
  const pipeline = new PS1RenderPipeline(fakeRenderer(), scene);
  assert.deepEqual(pipeline.renderSize, { width: 320, height: 240 });
  assert.equal(pipeline.qualityTier, 'medium');

  const mediumRt = pipeline.renderTarget;
  pipeline.setQualityTier('high');
  assert.equal(pipeline.qualityTier, 'high');
  assert.deepEqual(pipeline.renderSize, { width: 640, height: 480 });
  const res = pipeline.uniforms.uResolution.value as THREE.Vector2;
  assert.equal(res.x, 640);
  assert.equal(res.y, 480);
  assert.notEqual(pipeline.renderTarget, mediumRt, 'target rebuilt');

  pipeline.setQualityTier('low');
  assert.deepEqual(pipeline.renderSize, { width: 160, height: 120 });
  pipeline.render(1 / 60, makeCamera());
  assert.deepEqual(pipeline.renderSize, { width: 160, height: 120 }, 'renders at the new size');
  pipeline.dispose();
});

test('setPreset rebuilds only when size-affecting inputs change (G04)', () => {
  const scene = new THREE.Scene();
  const pipeline = new PS1RenderPipeline(fakeRenderer(), scene, { resolutionScale: 0.5 });

  const before = pipeline.renderTarget;
  pipeline.setPreset({ background: 0x112233 });
  assert.equal(pipeline.renderTarget, before, 'no rebuild for non-size changes');
  assert.ok(scene.background instanceof THREE.Color);
  assert.equal((scene.background as THREE.Color).getHex(), 0x112233);

  pipeline.setPreset({ resolution: { width: 400 } });
  assert.notEqual(pipeline.renderTarget, before);
  assert.deepEqual(pipeline.renderSize, { width: 200, height: 120 }, 'resolutionScale 0.5 applies');
  assert.equal(pipeline.preset.resolutionScale, 0.5, 'non-overridden base values survive');
  const res = pipeline.uniforms.uResolution.value as THREE.Vector2;
  assert.equal(res.x, 200);
  assert.equal(res.y, 120);

  pipeline.setPreset({ quality: 'high', resolutionScale: 1 });
  assert.deepEqual(pipeline.renderSize, { width: 800, height: 480 });
  pipeline.dispose();
});

test('flash decays by dt and camera shake restores the camera (G04)', () => {
  const scene = new THREE.Scene();
  const renderer = fakeRenderer();
  const pipeline = new PS1RenderPipeline(renderer, scene);

  pipeline.flashWhite(250);
  pipeline.render(0.1, makeCamera());
  assert.ok(Math.abs(pipeline.uniforms.uFlash.value - 0.6) < 1e-9, '1 - 0.1 * (1000/250)');
  pipeline.render(1, makeCamera());
  assert.equal(pipeline.uniforms.uFlash.value, 0);

  const cam = makeCamera();
  cam.position.set(1, 2, 3);
  cam.rotation.z = 0.1;
  pipeline.shake(1, 1000);
  pipeline.render(0.016, cam);
  const during = renderer.snapshots[renderer.snapshots.length - 1];
  assert.notDeepEqual(
    { x: during.x, y: during.y, z: during.z, roll: during.roll },
    { x: 1, y: 2, z: 3, roll: 0.1 },
    'camera offset while rendering',
  );
  assert.deepEqual(
    { x: cam.position.x, y: cam.position.y, z: cam.position.z, roll: cam.rotation.z },
    { x: 1, y: 2, z: 3, roll: 0.1 },
    'camera restored after the pass',
  );
  pipeline.dispose();
});

test('dispose frees GL-owned objects, is idempotent and rejects render (G04)', () => {
  const scene = new THREE.Scene();
  const tex = new THREE.Texture();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ map: tex })));

  const pipeline = new PS1RenderPipeline(fakeRenderer(), scene);
  pipeline.render(1 / 60, makeCamera());
  assert.equal(pipeline.patchedMaterialCount, 1);

  const rt = pipeline.renderTarget;
  let rtDispose = 0;
  rt.addEventListener('dispose', () => {
    rtDispose += 1;
  });

  pipeline.dispose();
  assert.equal(pipeline.disposed, true);
  assert.equal(rtDispose, 1, 'render target disposed');
  assert.equal(pipeline.patchedMaterialCount, 0, 'patch cache dropped');

  pipeline.dispose();
  assert.equal(rtDispose, 1, 'idempotent: second dispose is a no-op');

  assert.throws(() => pipeline.render(1 / 60, makeCamera()), /after dispose/);
  assert.equal(tex.minFilter, THREE.NearestFilter, 'scene materials keep their applied state');
});
