/**
 * 看山任意门 · portal page wiring — the ONLY module that imports the hall
 * experience (experiences/kanshan-hall/src/scene.ts, created by the parallel
 * agent) and the creative boot shell. It maps the real DOM onto the tiny
 * Portal*Like interfaces of host.ts and starts the portal host.
 *
 * portal.html loads this file; tests import host.ts/protocol.ts directly so
 * they never transitively load experiences/** or the creative runtime.
 */
import { bootExperience } from '../creative/boot/browser-player.ts';
import { createKanshanHallModule } from '../../experiences/kanshan-hall/src/scene.ts';
import {
  DOOR_PAGES,
  createPortalHost,
  type KanshanHallHandlesLike,
  type PortalClassList,
  type PortalDocumentLike,
  type PortalElementLike,
  type PortalFrameWindow,
  type PortalWindowLike,
} from './host.ts';

// ---------------------------------------------------------------------------
// Real-DOM → Portal*Like adapters
// ---------------------------------------------------------------------------

const wrapCache = new WeakMap<HTMLElement, RealPortalElement>();

function wrap(el: HTMLElement): RealPortalElement {
  const cached = wrapCache.get(el);
  if (cached) return cached;
  const wrapped = new RealPortalElement(el);
  wrapCache.set(el, wrapped);
  return wrapped;
}

function unwrap(el: PortalElementLike): HTMLElement {
  return el instanceof RealPortalElement ? el.el : (el as unknown as HTMLElement);
}

class RealPortalElement implements PortalElementLike {
  readonly el: HTMLElement;

  constructor(el: HTMLElement) {
    this.el = el;
  }

  get tagName(): string {
    return this.el.tagName;
  }

  get textContent(): string | null {
    return this.el.textContent;
  }

  set textContent(value: string | null) {
    this.el.textContent = value;
  }

  get hidden(): boolean {
    return this.el.hidden;
  }

  set hidden(value: boolean) {
    this.el.hidden = value;
  }

  get classList(): PortalClassList {
    return this.el.classList;
  }

  setAttribute(name: string, value: string): void {
    this.el.setAttribute(name, value);
  }

  getAttribute(name: string): string | null {
    return this.el.getAttribute(name);
  }

  appendChild(child: PortalElementLike): void {
    this.el.appendChild(unwrap(child));
  }

  remove(): void {
    this.el.remove();
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    this.el.addEventListener(type, listener as EventListener);
  }

  focus(): void {
    this.el.focus();
  }

  get contentWindow(): PortalFrameWindow | null {
    return this.el instanceof HTMLIFrameElement ? (this.el.contentWindow as unknown as PortalFrameWindow) : null;
  }
}

class RealPortalDocument implements PortalDocumentLike {
  get body(): PortalElementLike {
    return wrap(document.body);
  }

  createElement(tag: string): PortalElementLike {
    return wrap(document.createElement(tag));
  }
}

function toWindowLike(win: Window): PortalWindowLike {
  return {
    location: { origin: win.location.origin },
    addEventListener: (type, listener) => {
      win.addEventListener(type, listener as EventListener);
    },
    removeEventListener: (type, listener) => {
      win.removeEventListener(type, listener as EventListener);
    },
    setTimeout: (handler, ms) => win.setTimeout(handler, ms),
    clearTimeout: (id) => {
      win.clearTimeout(id);
    },
  };
}

function showFatal(message: string): void {
  const pre = document.createElement('pre');
  pre.style.cssText =
    'position:fixed;inset:1em;z-index:99;color:#f66;background:#000a;padding:1em;overflow:auto;font:12px monospace;white-space:pre-wrap;';
  pre.textContent = message;
  document.body.appendChild(pre);
}

// ---------------------------------------------------------------------------
// Page entry
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const container = document.getElementById('app') ?? document.body;
  const hallModule = createKanshanHallModule();
  const host = createPortalHost({
    boot: async () => {
      // The hall is its own art direction: bright Zhihu blue-white brand
      // space (fog-free, defocus off) — very different from the default
      // preset's dark horror tuning.
      const player = await bootExperience({ default: hallModule }, {
        container,
        preset: {
          background: 0xe9f1fb,
          fog: null,
          distanceDefocus: { enabled: false },
          vignette: { enabled: false },
        },
      });
      // Same controlled-testing hook the export shell exposes.
      (globalThis as Record<string, unknown>).__kanshanPlayer = player;
      // Structural cast: the hall's own handles type is declared in
      // experiences/kanshan-hall and must satisfy KanshanHallHandlesLike
      // (portalEnter / reEnter / doors / kanshan) per the frozen contract.
      const hall = hallModule.handles as unknown as KanshanHallHandlesLike | undefined;
      if (!hall) throw new Error('kanshan-hall 未暴露 portal 句柄（handles 为空）');
      return { player, hall };
    },
    config: DOOR_PAGES,
    doc: new RealPortalDocument(),
    win: toWindowLike(window),
  });
  window.addEventListener('pagehide', () => {
    void host.dispose();
  });
  await host.start();
}

main().catch((err) => {
  showFatal(`任意门启动失败：\n${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
});
