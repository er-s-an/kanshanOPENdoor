/**
 * Browser player shell for exported experiences.
 *
 * The private static export bundles the experience module; THIS shell is what
 * makes it a playable page: one WebGLRenderer + PS1 pipeline, one
 * RuntimeSessionHost in auto mode (the same host the headless tools drive),
 * DOM input/audio/document defaults resolved by the module itself, and a
 * single RAF loop. Audio unlock happens only on a real user gesture.
 *
 * The shell owns no gameplay and no story specifics: camera/audio are taken
 * from the module's exposed handles when present.
 */
import * as THREE from 'three';
import { RuntimeSessionHost } from '../core/host.ts';
import type { SceneModule } from '../core/context.ts';
import { PS1RenderPipeline } from '../render/ps1-pipeline.ts';
import type { PS1Preset } from '../render/ps1-pipeline.ts';

export interface BootOptions {
  preset?: PS1Preset;
  /** Defaults to document.body. */
  container?: HTMLElement;
  experienceDigest?: string;
  buildId?: string;
}

interface ModuleHandles {
  camera?: THREE.PerspectiveCamera;
  audio?: { unlock(): void };
  [key: string]: unknown;
}

interface SceneModuleWithHandles extends SceneModule {
  handles?: ModuleHandles;
}

function resolveSceneModule(mod: Record<string, unknown>): SceneModuleWithHandles {
  const isModule = (v: unknown): v is SceneModuleWithHandles =>
    typeof v === 'object' && v !== null && typeof (v as SceneModule).create === 'function';
  if (isModule(mod)) return mod;
  for (const key of Object.keys(mod)) {
    const value = mod[key];
    if (typeof value === 'function' && /^create[A-Za-z0-9]*Module$/.test(key)) {
      const created = (value as () => unknown)();
      if (isModule(created)) return created;
    }
  }
  if (isModule(mod.default)) return mod.default as SceneModuleWithHandles;
  if (typeof mod.default === 'function') {
    const created = (mod.default as () => unknown)();
    if (isModule(created)) return created;
  }
  throw new Error('experience entry exports no SceneModule and no create*Module factory');
}

function showFatal(container: HTMLElement, message: string): void {
  const el = document.createElement('pre');
  el.style.cssText =
    'position:fixed;inset:1em;z-index:99;color:#f66;background:#000a;padding:1em;overflow:auto;font:12px monospace;white-space:pre-wrap;';
  el.textContent = message;
  container.appendChild(el);
}

export async function bootExperience(entryModule: unknown, opts: BootOptions = {}): Promise<void> {
  const container = opts.container ?? document.body;
  const module = resolveSceneModule(entryModule as Record<string, unknown>);

  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(1);
  container.appendChild(renderer.domElement);

  const host = new RuntimeSessionHost({
    experienceDigest: opts.experienceDigest ?? 'browser-session',
    buildId: opts.buildId ?? 'browser',
    mode: 'auto',
  });

  let pipeline: PS1RenderPipeline | null = null;
  try {
    await host.start(module);
    pipeline = new PS1RenderPipeline(renderer, host.scene, opts.preset ?? {});
  } catch (err) {
    showFatal(container, `场景装载失败 (create):\n${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    throw err;
  }

  const camera: THREE.PerspectiveCamera =
    module.handles?.camera ?? new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 200);
  if (!module.handles?.camera) host.scene.add(camera);

  // Real gesture unlock only: the first pointerdown/keydown unlocks audio.
  const unlock = (): void => {
    module.handles?.audio?.unlock();
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  renderer.setAnimationLoop(() => {
    try {
      host.advance(performance.now() / 1000);
      host.renderFrame();
      if (host.currentStatus === 'error') {
        const diags = host.diagnosticsLog
          .map((d) => `[${d.phase ?? '?'}] ${d.code}: ${d.message}${d.source ? ` @ ${d.source}` : ''}`)
          .join('\n');
        showFatal(container, `运行错误:\n${diags}`);
        renderer.setAnimationLoop(null);
        return;
      }
      pipeline!.render(host.clock.fixedDt, camera);
    } catch (err) {
      renderer.setAnimationLoop(null);
      showFatal(container, `运行崩溃:\n${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
      throw err;
    }
  });
}
