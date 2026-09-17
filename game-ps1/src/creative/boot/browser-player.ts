/**
 * Browser player shell for exported experiences.
 *
 * The private static export bundles the experience module; THIS shell is what
 * makes it a playable page: one WebGLRenderer + PS1 pipeline, one
 * RuntimeSessionHost in auto mode (the same host the headless tools drive),
 * DOM input/audio/document defaults resolved by the module itself, and a
 * single RAF loop. Audio unlock happens only on a real user gesture.
 *
 * Identity and author parameters come from the EXPORT, not hard-coded
 * defaults: index.html embeds `globalThis.__KANSHAN_BOOT__`
 * { experienceDigest, buildId, runtimeApiVersion } and ships
 * `params.overrides.json`; both are consumed here through the same protocols
 * the headless daemon uses, so browser and headless runs share one
 * configuration path.
 *
 * The shell owns no gameplay and no story specifics: camera/audio come from
 * the module's exposed handles when present. Simulation advances on the
 * host's fixed-step clock; presentation effects (shake/flash decay) advance
 * on the real frame clock so their duration does not depend on display Hz.
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
}

export interface BrowserPlayerHandle {
  readonly host: RuntimeSessionHost;
  readonly renderer: THREE.WebGLRenderer;
  readonly pipeline: PS1RenderPipeline;
  readonly camera: THREE.PerspectiveCamera;
  /** Stops the loop, removes listeners, disposes pipeline/renderer, stops the host. */
  destroy(): Promise<void>;
}

interface ModuleHandles {
  camera?: THREE.PerspectiveCamera;
  audio?: { unlock(): void };
  params?: { set(authorId: string, value: unknown): { ok: boolean; reason?: string } };
  [key: string]: unknown;
}

interface SceneModuleWithHandles extends SceneModule {
  handles?: ModuleHandles;
}

interface BootConfig {
  experienceDigest?: string;
  buildId?: string;
  runtimeApiVersion?: string;
  /** True when the export ships params.overrides.json. */
  hasOverrides?: boolean;
}

function readBootConfig(): BootConfig {
  const raw = (globalThis as Record<string, unknown>).__KANSHAN_BOOT__;
  return typeof raw === 'object' && raw !== null ? (raw as BootConfig) : {};
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

export async function bootExperience(entryModule: unknown, opts: BootOptions = {}): Promise<BrowserPlayerHandle> {
  const container = opts.container ?? document.body;
  const module = resolveSceneModule(entryModule as Record<string, unknown>);
  const boot = readBootConfig();

  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(1);
  container.appendChild(renderer.domElement);

  // Real identity from the export: saves/checkpoints bind to the same
  // experienceDigest the headless tools computed from the same files.
  const host = new RuntimeSessionHost({
    experienceDigest: boot.experienceDigest ?? 'browser-session',
    buildId: boot.buildId ?? 'browser',
    mode: 'auto',
  });

  let pipeline: PS1RenderPipeline | null = null;
  try {
    await host.start(module);
    // Author parameter overrides shipped with the export: same protocol as
    // the headless daemon (validated registry set, never code edits). Only
    // fetched when the export declares them, so a no-override work never
    // produces a 404 resource error in the console.
    if (boot.hasOverrides === true) {
      try {
        const res = await fetch('./params.overrides.json', { cache: 'no-store' });
        if (res.ok) {
          const overlay = (await res.json()) as Record<string, unknown>;
          const registry = module.handles?.params;
          if (registry) {
            for (const [authorId, value] of Object.entries(overlay)) {
              const applied = registry.set(authorId, value);
              if (applied && applied.ok === false) {
                host.report({ code: 'PARAM_OVERRIDE_REJECTED', message: `${authorId}: ${applied.reason ?? 'rejected'}` });
              }
            }
          }
        }
      } catch {
        // Unreadable overrides: code defaults are the source of truth.
      }
    }
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
  const onResize = (): void => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
  window.addEventListener('resize', onResize);

  let lastNow = performance.now();
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    // Presentation clock: real elapsed seconds. Simulation still advances on
    // the host's fixed-step accumulator via advance().
    const realDt = Math.min(0.25, Math.max(0, (now - lastNow) / 1000));
    lastNow = now;
    try {
      host.advance(now / 1000);
      host.renderFrame();
      if (host.currentStatus === 'error') {
        const diags = host.diagnosticsLog
          .map((d) => `[${d.phase ?? '?'}] ${d.code}: ${d.message}${d.source ? ` @ ${d.source}` : ''}`)
          .join('\n');
        showFatal(container, `运行错误:\n${diags}`);
        renderer.setAnimationLoop(null);
        return;
      }
      pipeline!.render(realDt, camera);
    } catch (err) {
      renderer.setAnimationLoop(null);
      showFatal(container, `运行崩溃:\n${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
      throw err;
    }
  });

  const handle: BrowserPlayerHandle = {
    host,
    renderer,
    get pipeline(): PS1RenderPipeline {
      if (!pipeline) throw new Error('pipeline not initialised');
      return pipeline;
    },
    camera,
    async destroy() {
      renderer.setAnimationLoop(null);
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('resize', onResize);
      pipeline?.dispose();
      pipeline = null;
      await host.stop().catch(() => {});
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
  return handle;
}
