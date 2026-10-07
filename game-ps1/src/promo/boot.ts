/**
 * promo.html 启动线：engine-promo 场景 + PS1 渲染管线。
 *
 * 永远走 controlled host（fixedDt 1/30）：
 * - 正常打开：rAF 每帧推一步，实时播放 60s 搭建时间线；
 * - ?manual=1：不启动 rAF，暴露 window.__promo.step(n) 供录制脚本逐帧驱动，
 *   每步渲染一帧，保证帧级确定性（时长精确、无掉帧）。
 */
import { RuntimeSessionHost } from '../creative/core/host.ts';
import { PS1RenderPipeline } from '../creative/render/ps1-pipeline.ts';
import { createEnginePromoModule, PROMO_DURATION } from '../../experiences/engine-promo/src/scene.ts';
import * as THREE from 'three';

interface PromoHook {
  ready: boolean;
  duration: number;
  step(n?: number): void;
}

declare global {
  interface Window {
    __promo?: PromoHook;
  }
}

async function main(): Promise<void> {
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(1);
  document.body.appendChild(renderer.domElement);

  const host = new RuntimeSessionHost({
    experienceDigest: 'engine-promo',
    buildId: 'promo-local',
    mode: 'controlled',
    fixedDt: 1 / 30,
  });

  const module = createEnginePromoModule();
  await host.start(module);
  const handles = module.handles;
  if (!handles) throw new Error('engine-promo: handles missing after create()');
  const camera = handles.camera;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();

  const pipeline = new PS1RenderPipeline(renderer, host.scene, {
    background: 0x070b12,
    resolution: { width: 480, height: 270 },
  });

  const frame = (): void => {
    host.step(1);
    host.renderFrame();
    pipeline.render(1 / 30, camera);
  };

  if (new URLSearchParams(window.location.search).get('manual') === '1') {
    window.__promo = {
      ready: true,
      duration: PROMO_DURATION,
      step(n = 1) {
        for (let i = 0; i < n; i += 1) frame();
      },
    };
  } else {
    renderer.setAnimationLoop(frame);
  }
}

main().catch((err) => {
  const el = document.createElement('pre');
  el.style.cssText = 'position:fixed;inset:1em;z-index:99;color:#f66;background:#000a;padding:1em;font:12px monospace;white-space:pre-wrap;';
  el.textContent = `promo 启动失败:\n${err instanceof Error ? (err.stack ?? err.message) : String(err)}`;
  document.body.appendChild(el);
  throw err;
});

