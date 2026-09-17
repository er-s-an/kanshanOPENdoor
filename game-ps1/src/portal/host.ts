/**
 * 看山任意门 · portal host — the page runtime for the product's 3D front door.
 *
 * The portal page boots the 刘看山 hall (a creative-runtime SceneModule) and
 * keeps it alive underneath while works run in full-viewport same-origin
 * iframes:
 *
 *   hall ──portalEnter(target)──▶ fade to white ──▶ iframe(src=door page)
 *   iframe ──'completed'/'exited' (trusted)──▶ dispose iframe, fade back, reEnter()
 *
 * Responsibilities (see agent contract):
 *  (a) boot is injected as deps.boot() so this file never imports the hall —
 *      boot.ts (page wiring) does the static import;
 *  (b) HOST-side door-id → page table; unknown ids surface an honest on-page
 *      error and never navigate blind;
 *  (c) white fade overlay (CSS class toggle, transition lives in portal.html),
 *      full-viewport iframe with sandbox="allow-scripts allow-same-origin" and
 *      no other permissions, focused on entry, plus a small 回到大厅 button and
 *      an Escape shortcut that posts { source: 'kanshan-host', type:
 *      'request-exit' } and ALWAYS hard-returns after a short grace window;
 *  (d) only isTrustedWorkMessage() with origin === location.origin is honored;
 *  (e) entering a work disposes nothing of the hall; returning re-shows the
 *      canvas (iframe removal) and calls handles.reEnter() exactly once;
 *  (f) all DOM writes go through textContent/classList/attributes — no
 *      innerHTML anywhere (the static portal.html skeleton is the only markup).
 *
 * Everything here is written against the tiny structural Portal*Like
 * interfaces so headless tests can drive the transition state machine with a
 * fake document/window (see test/creative/portal-host.test.ts); boot.ts maps
 * the real DOM onto these interfaces.
 */
import { encodeHostMessage, isTrustedWorkMessage, type WorkToHost } from './protocol.ts';

// ---------------------------------------------------------------------------
// Structural DOM subset (adapters in boot.ts map the real DOM onto these)
// ---------------------------------------------------------------------------

export interface PortalClassList {
  add(...tokens: string[]): void;
  remove(...tokens: string[]): void;
  contains(token: string): boolean;
}

export interface PortalFrameWindow {
  postMessage(message: unknown, targetOrigin: string): void;
}

export interface PortalElementLike {
  readonly tagName: string;
  textContent: string | null;
  hidden: boolean;
  readonly classList: PortalClassList;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  appendChild(child: PortalElementLike): void;
  remove(): void;
  addEventListener(type: string, listener: (event: unknown) => void): void;
  focus?(): void;
  readonly contentWindow?: PortalFrameWindow | null;
}

export interface PortalDocumentLike {
  readonly body: PortalElementLike;
  createElement(tag: string): PortalElementLike;
}

export interface PortalWindowLike {
  readonly location: { readonly origin: string };
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
  setTimeout(handler: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

// ---------------------------------------------------------------------------
// Hall contract (frozen between the two agents) — structural, so the parallel
// hall experience's own handle type slots in without a shared import.
// ---------------------------------------------------------------------------

export interface PortalDoorHandleLike {
  readonly id: string;
  readonly title: string;
  state(): 'closed' | 'opening' | 'open';
}

export interface KanshanHallHandlesLike {
  portalEnter: { onEnter(cb: (target: string) => void): () => void };
  reEnter(): void;
  doors: ReadonlyArray<PortalDoorHandleLike>;
  kanshan: { state(): string };
}

export interface PortalPlayerHandleLike {
  destroy(): Promise<void>;
}

export interface PortalBootResult {
  player: PortalPlayerHandleLike;
  hall: KanshanHallHandlesLike | null;
}

// ---------------------------------------------------------------------------
// HOST-side door table: door id → story page, relative to the dist root that
// portal.html builds into (it ships alongside the three legacy story pages).
// ---------------------------------------------------------------------------

export type DoorConfig = Readonly<Record<string, string>>;

export const DOOR_IDS = ['duanfei', 'blue-blood', 'myopia'] as const;
export type DoorId = (typeof DOOR_IDS)[number];

export const DOOR_PAGES: DoorConfig = {
  duanfei: './end-consort.html',
  // 蓝血门走 ARG 版（调查论证玩法，结局含人格分享卡）: same-origin from
  // dist/arg, /api proxied by portal-serve. scene=1 是直进通道（不加则只
  // 高亮门、进 ARG 自己的 2D 大厅）。Story id 来自网关注册表。
  'blue-blood': './arg/?scene=1&story=蓝血-2025684191967294692',
  // 必须用 myopia.html：站点根 / 已是 hall（index.html = hall），
  // 指 ./index.html 会 hall 套 hall 递归。
  myopia: './myopia.html',
};

export type PortalPhase = 'booting' | 'hall' | 'entering' | 'in-work' | 'error';

export interface PortalTimings {
  /** White fade transition; portal.html's CSS transition mirrors this. */
  fadeMs: number;
  /** How long enter() waits for the work's 'ready' / iframe load before revealing anyway. */
  readyTimeoutMs: number;
  /** Escape/button return posts request-exit, then hard-returns after this grace. */
  returnGraceMs: number;
  /** Unknown-door errors auto-dismiss back to the hall after this dwell. */
  errorDwellMs: number;
}

export const DEFAULT_PORTAL_TIMINGS: PortalTimings = {
  fadeMs: 320,
  readyTimeoutMs: 2500,
  returnGraceMs: 300,
  errorDwellMs: 4000,
};

export interface PortalHostDeps {
  boot(): Promise<PortalBootResult>;
  /** Door table; defaults to DOOR_PAGES. */
  config?: DoorConfig;
  doc: PortalDocumentLike;
  win: PortalWindowLike;
  timings?: Partial<PortalTimings>;
  log?: (line: string) => void;
}

export interface PortalHost {
  /** Boots the hall, subscribes portalEnter + window listeners. */
  start(): Promise<void>;
  /** Transition into a work's page; unknown ids land in an honest error state. */
  enter(target: string): Promise<void>;
  /** Hard return: dispose the iframe, fade back, reEnter() exactly once. */
  returnToHall(): void;
  /** Polite return: post request-exit to the work, hard-return after grace. */
  requestReturn(): void;
  state(): PortalPhase;
  /** Remove all listeners/iframe; tears down the player (hall) too. */
  dispose(): Promise<void>;
}

const FADE_CLASS = 'portal-fade';
const FADE_ON_CLASS = 'portal-fade--on';
const FRAME_CLASS = 'portal-frame';
const RETURN_CLASS = 'portal-return';
const ERROR_CLASS = 'portal-error';
const RETURN_LABEL = '回到大厅';

export function createPortalHost(deps: PortalHostDeps): PortalHost {
  const config = deps.config ?? DOOR_PAGES;
  const timings: PortalTimings = { ...DEFAULT_PORTAL_TIMINGS, ...deps.timings };
  const log = deps.log ?? (() => {});
  const origin = deps.win.location.origin;

  let phase: PortalPhase = 'booting';
  let player: PortalPlayerHandleLike | null = null;
  let hall: KanshanHallHandlesLike | null = null;
  let unsubscribeEnter: (() => void) | null = null;
  let disposed = false;

  let currentFrame: PortalElementLike | null = null;
  let returnGraceTimer: number | null = null;
  let errorTimer: number | null = null;

  // Wire the chrome up front so even boot failures can surface honestly.
  const fade = deps.doc.createElement('div');
  fade.classList.add(FADE_CLASS);
  const returnButton = deps.doc.createElement('button');
  returnButton.classList.add(RETURN_CLASS);
  returnButton.hidden = true;
  returnButton.textContent = RETURN_LABEL;
  const errorBar = deps.doc.createElement('div');
  errorBar.classList.add(ERROR_CLASS);
  errorBar.hidden = true;
  deps.doc.body.appendChild(fade);
  deps.doc.body.appendChild(returnButton);
  deps.doc.body.appendChild(errorBar);
  returnButton.addEventListener('click', () => {
    requestReturn();
  });

  // Escape while a work covers the viewport: the parent only sees keydown when
  // focus is on the parent chrome, so this is a best-effort shortcut; the
  // button and the work-side protocol cover the rest.
  const onKeydown = (raw: unknown): void => {
    const code = (raw as { code?: unknown } | null)?.code;
    if (code !== 'Escape') return;
    if (phase === 'in-work' || phase === 'entering') requestReturn();
  };

  const wait = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      deps.win.setTimeout(resolve, ms);
    });

  const fadeOn = async (): Promise<void> => {
    fade.classList.add(FADE_ON_CLASS);
    await wait(timings.fadeMs);
  };

  const fadeOff = async (): Promise<void> => {
    fade.classList.remove(FADE_ON_CLASS);
    await wait(timings.fadeMs);
  };

  const clearTimer = (id: number | null): void => {
    if (id !== null) deps.win.clearTimeout(id);
  };

  const showError = (message: string): void => {
    phase = 'error';
    errorBar.textContent = message;
    errorBar.hidden = false;
    clearTimer(errorTimer);
    errorTimer = deps.win.setTimeout(() => {
      errorTimer = null;
      if (phase !== 'error') return;
      errorBar.hidden = true;
      errorBar.textContent = '';
      phase = 'hall';
    }, timings.errorDwellMs);
  };

  // --- enter/abort plumbing shared with the message listener ----------------
  let pendingReadyNotify: (() => void) | null = null;
  let abortEnter: (() => void) | null = null;

  const titleFor = (target: string): string => {
    const door = hall?.doors.find((d) => d.id === target);
    return door ? door.title : target;
  };

  async function enter(target: string): Promise<void> {
    if (disposed) return;
    if (phase === 'entering' || phase === 'in-work') {
      log(`enter('${target}') ignored while '${phase}'`);
      return;
    }
    const url = config[target];
    if (typeof url !== 'string' || url.length === 0) {
      // Unknown door id: honest on-page error, never navigate blind.
      log(`unknown door id: '${target}'`);
      showError(`找不到这扇门：${target}`);
      return;
    }
    clearTimer(errorTimer);
    errorTimer = null;
    errorBar.hidden = true;
    errorBar.textContent = '';
    phase = 'entering';

    // Ready gate: resolves on the work's 'ready', the iframe load event, or a
    // timeout — legacy story pages may not speak the protocol at all, so the
    // iframe must still come up. aborted flips on a mid-enter return.
    let settled = false;
    let aborted = false;
    const gate: { resolve: (() => void) | null } = { resolve: null };
    const readyGate = new Promise<void>((resolve) => {
      gate.resolve = resolve;
    });
    const settle = (via: string): void => {
      if (settled) return;
      settled = true;
      log(`enter '${target}' resolved via ${via}`);
      gate.resolve?.();
    };
    abortEnter = () => {
      aborted = true;
      settle('abort');
    };
    pendingReadyNotify = () => {
      settle('ready');
    };

    try {
      await fadeOn();
      if (aborted || disposed || phase !== 'entering') return;

      const frame = deps.doc.createElement('iframe');
      frame.setAttribute('src', url);
      // Exactly these two permissions — the works are first-party same-origin
      // pages and need script + same-origin; nothing else (no top navigation).
      // allow-pointer-lock: legacy stories acquire pointer lock on canvas
      //   mousedown for mouse-look.
      // allow-forms: the ARG investigation search is a real <form onSubmit>;
      //   Chrome blocks ALL form submissions (Enter AND the submit button) in
      //   a sandboxed iframe without this token — the search silently dead.
      // allow-popups: 结局页/门页的「阅读开放原文」是 target=_blank 链接，
      //   无此令牌会被静默拦截。不给 allow-popups-to-escape-sandbox，
      //   弹窗继承沙箱（原文页是纯静态 HTML，无需脚本）。
      frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-pointer-lock allow-forms allow-popups');
      frame.setAttribute('title', titleFor(target));
      frame.classList.add(FRAME_CLASS);
      const readyTimer = deps.win.setTimeout(() => {
        settle('timeout');
      }, timings.readyTimeoutMs);
      frame.addEventListener('load', () => {
        settle('load');
      });

      currentFrame = frame;
      deps.doc.body.appendChild(frame);
      frame.focus?.();
      returnButton.hidden = false;

      await readyGate;
      deps.win.clearTimeout(readyTimer);
      pendingReadyNotify = null;
      abortEnter = null;
      if (aborted || disposed) {
        await fadeOff();
        return;
      }
      await fadeOff();
      phase = 'in-work';
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`enter '${target}' failed: ${message}`);
      const frame = currentFrame;
      currentFrame = null;
      if (frame) frame.remove();
      returnButton.hidden = true;
      pendingReadyNotify = null;
      abortEnter = null;
      showError(`进入失败：${target}（${message}）`);
    }
  }

  function returnToHall(): void {
    if (phase !== 'in-work' && phase !== 'entering') return;
    phase = 'hall';
    clearTimer(returnGraceTimer);
    returnGraceTimer = null;
    const frame = currentFrame;
    currentFrame = null;
    if (frame) frame.remove();
    returnButton.hidden = true;
    // The hall instance survived underneath; one reEnter() per transition.
    hall?.reEnter();
    void fadeOff().catch(() => {});
  }

  function requestReturn(): void {
    if (phase !== 'in-work' && phase !== 'entering') return;
    const frameWindow = currentFrame?.contentWindow ?? null;
    if (frameWindow) {
      try {
        frameWindow.postMessage(encodeHostMessage('request-exit'), origin);
      } catch (err) {
        log(`request-exit post failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    // Always offer the hard return even if the work ignores the request.
    clearTimer(returnGraceTimer);
    returnGraceTimer = deps.win.setTimeout(() => {
      returnGraceTimer = null;
      returnToHall();
    }, timings.returnGraceMs);
  }

  const onMessage = (raw: unknown): void => {
    const event = raw as { origin?: unknown; data?: unknown; source?: unknown } | null;
    if (typeof event?.origin !== 'string') return;
    if (!isTrustedWorkMessage({ origin: event.origin, data: event.data }, origin)) return;
    const frameWindow = currentFrame?.contentWindow ?? null;
    if (event.source !== undefined && frameWindow !== null && event.source !== frameWindow) {
      log('ignored work message from an unknown frame');
      return;
    }
    const msg = event.data as WorkToHost;
    log(`work message: ${msg.type}`);
    if (msg.type === 'ready') {
      if (phase === 'entering') pendingReadyNotify?.();
      return;
    }
    // 'completed' / 'exited': finish the world, come back to the hall.
    if (phase === 'entering') abortEnter?.();
    if (phase === 'entering' || phase === 'in-work') returnToHall();
  };

  async function start(): Promise<void> {
    if (disposed) return;
    try {
      const result = await deps.boot();
      player = result.player;
      hall = result.hall;
    } catch (err) {
      showError(`大厅装载失败：${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    if (!hall) {
      showError('大厅未暴露任意门句柄');
      return;
    }
    phase = 'hall';
    unsubscribeEnter = hall.portalEnter.onEnter((target) => {
      enter(target).catch((err) => {
        showError(`进入失败：${target}（${err instanceof Error ? err.message : String(err)}）`);
      });
    });
    deps.win.addEventListener('message', onMessage);
    deps.win.addEventListener('keydown', onKeydown);
    log('portal host ready');
  }

  async function dispose(): Promise<void> {
    if (disposed) return;
    disposed = true;
    deps.win.removeEventListener('message', onMessage);
    deps.win.removeEventListener('keydown', onKeydown);
    if (unsubscribeEnter) {
      unsubscribeEnter();
      unsubscribeEnter = null;
    }
    clearTimer(returnGraceTimer);
    clearTimer(errorTimer);
    returnGraceTimer = null;
    errorTimer = null;
    const frame = currentFrame;
    currentFrame = null;
    if (frame) frame.remove();
    returnButton.hidden = true;
    errorBar.hidden = true;
    pendingReadyNotify = null;
    abortEnter = null;
    if (player) {
      const owned = player;
      player = null;
      await owned.destroy().catch(() => {});
    }
  }

  return {
    start,
    enter,
    returnToHall,
    requestReturn,
    state: () => phase,
    dispose,
  };
}
