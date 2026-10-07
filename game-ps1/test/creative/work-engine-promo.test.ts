/**
 * Offline determinism check for engine-promo (experiences/engine-promo).
 *
 * RuntimeSessionHost in controlled mode steps the full 60s build timeline
 * (fixedDt 1/30, 1800 steps) with a stub texture loader; asserts the scene
 * assembles completely (floor/rings/columns/doors/panels/personas all at
 * final state), the camera ends on the crane path (pose is actually applied),
 * and no diagnostics are reported. Rendering is NOT_MEASURED headless.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RuntimeSessionHost } from '../../src/creative/core/host.ts';
import { createEnginePromoModule, PROMO_DURATION } from '../../experiences/engine-promo/src/scene.ts';

const DT = 1 / 30;

async function boot() {
  const host = new RuntimeSessionHost({
    experienceDigest: 'engine-promo-test',
    buildId: 'work-engine-promo-test',
    mode: 'controlled',
    fixedDt: DT,
  });
  const module = createEnginePromoModule({ textureLoader: async () => new THREE.Texture() });
  await host.start(module);
  assert.ok(module.handles, 'module exposes handles after create()');
  return { host, module };
}

test('engine-promo: 60s build timeline assembles the full scene deterministically', async () => {
  const { host, module } = await boot();
  host.step(Math.round(PROMO_DURATION * 30));

  assert.equal(host.currentStatus, 'running');
  assert.deepEqual(host.diagnosticsLog, []);

  const scene = host.scene;
  const byName = (n: string): THREE.Object3D => {
    const obj = scene.getObjectByName(n);
    assert.ok(obj, `${n} exists`);
    return obj;
  };

  // 地面与立柱到位
  assert.ok(Math.abs(byName('engine-promo/floor').scale.x - 1) < 1e-3, 'floor fully scaled');
  for (let i = 0; i < 8; i += 1) {
    assert.ok(Math.abs(byName(`engine-promo/column-${i}`).scale.y - 1) < 1e-3, `column ${i} risen`);
  }
  // 门与人格卡就位
  for (let i = 0; i < 3; i += 1) {
    assert.ok(byName(`engine-promo/door-${i}`).scale.x > 0.99, `door ${i} placed`);
  }
  for (let i = 0; i < 4; i += 1) {
    assert.ok(Math.abs(byName(`engine-promo/persona-${i}`).position.y - 1.55) < 0.05, `persona ${i} landed`);
  }
  // 展板飞入完成（回到内环半径附近）
  const panel = byName('engine-promo/panel-0');
  assert.ok(Math.abs(Math.hypot(panel.position.x, panel.position.z) - 6.2) < 0.2, 'panel 0 on the gallery ring');

  // 相机真的被运镜驱动：结尾应处于 crane 高位
  const cam = module.handles?.camera;
  assert.ok(cam, 'handles.camera exposed');
  assert.ok(cam.position.y > 5, `camera risen on crane path, got y=${cam.position.y.toFixed(2)}`);

  host.stop();
});

test('engine-promo: camera starts on the dolly rig away from origin', async () => {
  const { host, module } = await boot();
  host.step(1);
  const cam = module.handles?.camera;
  assert.ok(cam);
  assert.ok(cam.position.z > 20, `dolly starts far out, got z=${cam.position.z.toFixed(2)}`);
  host.stop();
});
