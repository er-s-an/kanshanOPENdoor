import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  PS1_BG,
  PS1_DEFAULT_FOG_DENSITY,
  PS1_DEFAULT_PRESET,
  PS1_SKIP_PATCH,
  QUALITY_TIERS,
  applyMaterialPatch,
  applyPresetToScene,
  effectiveRenderSize,
  mergePS1Preset,
  resolvePS1Preset,
  shouldPatchMaterial,
} from '../../src/creative/render/ps1-pipeline.ts';

test('resolvePS1Preset(): defaults reproduce the original engine look (G04)', () => {
  const p = resolvePS1Preset();
  assert.deepEqual(p.resolution, { width: 320, height: 240 });
  assert.equal(p.resolutionScale, 1);
  assert.equal(p.quality, 'medium');
  assert.equal(p.dither, true);
  assert.deepEqual(p.distanceDefocus, {
    enabled: true,
    clearDistance: 1.0,
    linearGain: 0.6,
    quadraticGain: 0.26,
    baseRadiusPx: 0.5,
    maxRadiusPx: 6.4,
  });
  assert.deepEqual(p.vignette, { enabled: false, strength: 0 }, 'vignette channel is opt-in');
  assert.deepEqual(p.fog, { color: PS1_BG, density: PS1_DEFAULT_FOG_DENSITY }, 'explicit default fog');
  assert.equal(p.background, PS1_BG);
  assert.equal(p.chromaticAberration, 0.0032);
  assert.deepEqual(p, PS1_DEFAULT_PRESET);
});

test('resolvePS1Preset(): partial preset merges deep, fog null is honoured (G04)', () => {
  const p = resolvePS1Preset({
    resolution: { width: 640 },
    quality: 'high',
    vignette: { enabled: true },
    fog: null,
  });
  assert.deepEqual(p.resolution, { width: 640, height: 240 }, 'nested resolution merge keeps default height');
  assert.equal(p.quality, 'high');
  assert.deepEqual(p.vignette, { enabled: true, strength: 0 }, 'nested vignette merge keeps default strength');
  assert.equal(p.fog, null, 'null disables fog instead of falling back to the default');
  assert.equal(p.dither, true, 'untouched keys stay default');

  const kept = resolvePS1Preset({ fog: undefined });
  assert.deepEqual(kept.fog, { color: PS1_BG, density: PS1_DEFAULT_FOG_DENSITY }, 'undefined fog keeps default');

  const replaced = resolvePS1Preset({ fog: { color: 0x112233, density: 0.5 } });
  assert.deepEqual(replaced.fog, { color: 0x112233, density: 0.5 }, 'fog object replaces wholesale');
});

test('mergePS1Preset(): runtime merges keep the current base (G04)', () => {
  const base = resolvePS1Preset({ background: 0x112233, fog: null });
  const merged = mergePS1Preset(base, { dither: false });
  assert.equal(merged.background, 0x112233, 'base value survives');
  assert.equal(merged.dither, false);
  assert.equal(merged.fog, null, 'base fog-null survives');
  const withFog = mergePS1Preset(base, { fog: { color: 0x334455, density: 0.1 } });
  assert.deepEqual(withFog.fog, { color: 0x334455, density: 0.1 });
});

test('effectiveRenderSize(): tier math with even snapping and clamping (G04)', () => {
  const base = { width: 320, height: 240 };
  assert.deepEqual(effectiveRenderSize(base, 1, 'medium'), { width: 320, height: 240 });
  assert.deepEqual(effectiveRenderSize(base, 1, 'low'), { width: 160, height: 120 });
  assert.deepEqual(effectiveRenderSize(base, 1, 'high'), { width: 640, height: 480 });
  assert.deepEqual(effectiveRenderSize(base, 0.5, 'high'), { width: 320, height: 240 });
  assert.deepEqual(effectiveRenderSize({ width: 321, height: 241 }, 1, 'medium'), { width: 322, height: 242 }, 'snapped to even');
  assert.deepEqual(effectiveRenderSize(base, 0, 'low'), { width: 2, height: 2 }, 'clamped to a sane minimum');
  assert.equal(QUALITY_TIERS.medium.renderScale, 1);
});

test('applyPresetToScene(): background and fog applied explicitly and only then (G04)', () => {
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xffffff, 0.9);

  applyPresetToScene(scene, resolvePS1Preset());
  assert.ok(scene.background instanceof THREE.Color);
  assert.equal((scene.background as THREE.Color).getHex(), PS1_BG);
  assert.ok(scene.fog instanceof THREE.FogExp2);
  assert.equal(scene.fog.density, PS1_DEFAULT_FOG_DENSITY);
  assert.equal(scene.fog.color.getHex(), PS1_BG);

  const explicit = resolvePS1Preset({ fog: { color: 0x223344, density: 0.42 } });
  applyPresetToScene(scene, explicit);
  assert.ok(scene.fog instanceof THREE.FogExp2);
  assert.equal(scene.fog.density, 0.42, 'density is exactly what the preset declares');
  assert.equal(scene.fog.color.getHex(), 0x223344);

  applyPresetToScene(scene, resolvePS1Preset({ fog: null }));
  assert.equal(scene.fog, null, 'fog-null clears an existing fog');
});

test('shouldPatchMaterial(): Mesh materials pass, native shaders and opt-outs bypass (G04)', () => {
  assert.equal(shouldPatchMaterial(new THREE.MeshBasicMaterial()), true);
  assert.equal(shouldPatchMaterial(new THREE.MeshStandardMaterial()), true);
  assert.equal(shouldPatchMaterial(new THREE.ShaderMaterial()), false, 'native shader entry bypasses');
  assert.equal(shouldPatchMaterial(new THREE.PointsMaterial()), false);

  const optedOut = new THREE.MeshBasicMaterial();
  optedOut.userData[PS1_SKIP_PATCH] = true;
  assert.equal(shouldPatchMaterial(optedOut), false, 'per-material opt-out wins');
});

test('applyMaterialPatch(): nearest sampling, stable-minification override (G04)', () => {
  const map = new THREE.Texture();
  const stable = new THREE.Texture();
  stable.userData.ps1StableMinification = true;
  const mat = new THREE.MeshBasicMaterial({ map });
  mat.specularMap = stable;

  applyMaterialPatch(mat);
  assert.equal(map.magFilter, THREE.NearestFilter);
  assert.equal(map.minFilter, THREE.NearestFilter);
  assert.equal(map.generateMipmaps, false);
  assert.equal(stable.magFilter, THREE.NearestFilter);
  assert.equal(stable.minFilter, THREE.LinearMipmapLinearFilter, 'stable minification keeps mips');
  assert.equal(stable.generateMipmaps, true);
  assert.equal(mat.version, 1, 'needsUpdate=true bumps the material version');
});
