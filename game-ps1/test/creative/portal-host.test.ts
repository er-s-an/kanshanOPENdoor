/**
 * Portal host + protocol evidence — no real browser.
 *
 * Protocol codec round-trips and the HOST-side door table are pure; the
 * transition state machine in src/portal/host.ts is driven through a fake
 * document/window (Portal*Like stubs local to this file — the ui toolkit's
 * FakeDocument is a different scope and is deliberately not imported).
 * Timers are fake and advanced explicitly via runFor(), so awaits chained on
 * win.setTimeout resolve deterministically.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PORTAL_HOST_SOURCE,
  PORTAL_MESSAGE_SOURCE,
  encodeHostMessage,
  encodeWorkMessage,
  isTrustedWorkMessage,
  isWorkMessage,
} from '../../src/portal/protocol.ts';
import {
  DEFAULT_PORTAL_TIMINGS,
  DOOR_IDS,
  DOOR_PAGES,
  createPortalHost,
  type DoorConfig,
  type KanshanHallHandlesLike,
  type PortalDocumentLike,
  type PortalElementLike,
  type PortalHost,
  type PortalWindowLike,
} from '../../src/portal/host.ts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ORIGIN = 'https://portal.test';

const SHORT_TIMINGS = { fadeMs: 40, readyTimeoutMs: 300, returnGraceMs: 80, errorDwellMs: 300 };

// ------------------------------ fake DOM ----------------------------------

class FakeClassList {
  private readonly tokens = new Set<string>();

  add(...tokens: string[]): void {
    for (const t of tokens) this.tokens.add(t);
  }

  remove(...tokens: string[]): void {
    for (const t of tokens) this.tokens.delete(t);
  }

  contains(token: string): boolean {
    return this.tokens.has(token);
  }
}

interface RecordedPost {
  message: unknown;
  targetOrigin: string;
}

class FakeFrameWindow {
  readonly posted: RecordedPost[] = [];

  postMessage(message: unknown, targetOrigin: string): void {
    this.posted.push({ message, targetOrigin });
  }
}

class FakePortalElement implements PortalElementLike {
  readonly tagName: string;
  textContent: string | null = null;
  hidden = false;
  readonly classList = new FakeClassList();
  readonly children: FakePortalElement[] = [];
  parent: FakePortalElement | null = null;
  contentWindow: FakeFrameWindow | null = null;
  focusCount = 0;
  private readonly attributes = new Map<string, string>();
  private readonly listeners = new Map<string, ((event: unknown) => void)[]>();

  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  appendChild(child: FakePortalElement): void {
    child.remove();
    child.parent = this;
    this.children.push(child);
  }

  remove(): void {
    if (!this.parent) return;
    const index = this.parent.children.indexOf(this);
    if (index >= 0) this.parent.children.splice(index, 1);
    this.parent = null;
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  focus(): void {
    this.focusCount += 1;
  }

  dispatch(type: string, event: unknown): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }

  descendants(out: FakePortalElement[] = []): FakePortalElement[] {
    for (const child of this.children) {
      out.push(child);
      child.descendants(out);
    }
    return out;
  }
}

class FakePortalDocument implements PortalDocumentLike {
  readonly body = new FakePortalElement('body');

  createElement(tag: string): FakePortalElement {
    const el = new FakePortalElement(tag);
    if (el.tagName === 'IFRAME') el.contentWindow = new FakeFrameWindow();
    return el;
  }
}

class FakePortalWindow implements PortalWindowLike {
  readonly location = { origin: ORIGIN };
  private nowMs = 0;
  private nextTimerId = 1;
  private timers: { id: number; at: number; fn: () => void }[] = [];
  private readonly listeners = new Map<string, ((event: unknown) => void)[]>();

  get now(): number {
    return this.nowMs;
  }

  setTimeout(fn: () => void, ms: number): number {
    const id = this.nextTimerId;
    this.nextTimerId += 1;
    this.timers.push({ id, at: this.nowMs + ms, fn });
    return id;
  }

  clearTimeout(id: number): void {
    this.timers = this.timers.filter((t) => t.id !== id);
  }

  pendingTimerCount(): number {
    return this.timers.length;
  }

  /** Advance the fake clock, running due timers; microtasks flush between steps. */
  tick(ms: number): void {
    const end = this.nowMs + ms;
    for (;;) {
      let earliest: { id: number; at: number; fn: () => void } | null = null;
      for (const t of this.timers) {
        if (t.at <= end && (earliest === null || t.at < earliest.at)) earliest = t;
      }
      if (!earliest) break;
      this.timers = this.timers.filter((t) => t.id !== earliest!.id);
      this.nowMs = earliest.at;
      earliest.fn();
    }
    this.nowMs = end;
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    this.listeners.set(type, list.filter((l) => l !== listener));
  }

  listenerCount(type: string): number {
    return (this.listeners.get(type) ?? []).length;
  }

  dispatch(type: string, event: unknown): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }
}

// ------------------------------ fake hall ---------------------------------

interface FakeHall extends KanshanHallHandlesLike {
  reEnterCount: number;
  unsubscribeCount: number;
  fireEnter(target: string): void;
}

function makeFakeHall(): FakeHall {
  let enterCb: ((target: string) => void) | null = null;
  let reEnterCount = 0;
  let unsubscribeCount = 0;
  const hall: FakeHall = {
    get reEnterCount() {
      return reEnterCount;
    },
    get unsubscribeCount() {
      return unsubscribeCount;
    },
    portalEnter: {
      onEnter(cb: (target: string) => void): () => void {
        enterCb = cb;
        return () => {
          unsubscribeCount += 1;
          enterCb = null;
        };
      },
    },
    reEnter(): void {
      reEnterCount += 1;
    },
    doors: [
      { id: 'duanfei', title: '断妃', state: () => 'closed' },
      { id: 'blue-blood', title: '蓝血', state: () => 'closed' },
      { id: 'myopia', title: '近视眼勇闯恐怖游戏', state: () => 'closed' },
    ],
    kanshan: { state: () => 'idle' },
    fireEnter(target: string): void {
      if (!enterCb) throw new Error('portalEnter not subscribed');
      enterCb(target);
    },
  };
  return hall;
}

// ------------------------------ harness -----------------------------------

interface HostFixture {
  host: PortalHost;
  doc: FakePortalDocument;
  win: FakePortalWindow;
  hall: FakeHall;
  playerDestroyed: { count: number };
  frames(): FakePortalElement[];
  chromeByClass(token: string): FakePortalElement;
}

async function startHost(overrides?: { config?: DoorConfig; bootError?: Error }): Promise<HostFixture> {
  const doc = new FakePortalDocument();
  const win = new FakePortalWindow();
  const hall = makeFakeHall();
  const playerDestroyed = { count: 0 };
  const host = createPortalHost({
    boot: async () => {
      if (overrides?.bootError) throw overrides.bootError;
      return { player: { destroy: async () => undefined }, hall };
    },
    config: overrides?.config,
    doc,
    win,
    timings: SHORT_TIMINGS,
  });
  void playerDestroyed;
  await host.start();
  const frames = (): FakePortalElement[] =>
    doc.body.descendants().filter((el) => el.tagName === 'IFRAME');
  const chromeByClass = (token: string): FakePortalElement => {
    const found = doc.body.descendants().find((el) => el.classList.contains(token));
    assert.ok(found, `chrome element .${token} exists`);
    return found;
  };
  return { host, doc, win, hall, playerDestroyed, frames, chromeByClass };
}

/** Advance the fake clock in small steps so chained timer awaits progress. */
async function runFor(win: FakePortalWindow, ms: number): Promise<void> {
  const step = 10;
  for (let t = 0; t < ms; t += step) {
    win.tick(step);
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** Full enter duration: fade in + ready timeout + fade out + margin. */
const ENTER_TOTAL = SHORT_TIMINGS.fadeMs + SHORT_TIMINGS.readyTimeoutMs + SHORT_TIMINGS.fadeMs + 60;

async function enterAndSettle(f: HostFixture, target: string): Promise<FakePortalElement> {
  const p = f.host.enter(target);
  await runFor(f.win, ENTER_TOTAL);
  await p;
  assert.equal(f.host.state(), 'in-work');
  const frames = f.frames();
  assert.equal(frames.length, 1);
  return frames[0];
}

// ------------------------------ protocol ----------------------------------

test('work message codec round-trips ready/completed/exited', () => {
  assert.equal(PORTAL_MESSAGE_SOURCE, 'kanshan-work');
  assert.equal(PORTAL_HOST_SOURCE, 'kanshan-host');
  assert.deepEqual(encodeWorkMessage('ready'), { source: 'kanshan-work', type: 'ready' });
  assert.deepEqual(encodeWorkMessage('exited'), { source: 'kanshan-work', type: 'exited' });
  assert.deepEqual(encodeWorkMessage('completed'), { source: 'kanshan-work', type: 'completed' });
  const detailed = encodeWorkMessage('completed', { score: 7 });
  assert.equal(detailed.type, 'completed');
  assert.deepEqual((detailed as { detail: unknown }).detail, { score: 7 });
  assert.deepEqual(encodeHostMessage('request-exit'), { source: 'kanshan-host', type: 'request-exit' });
  for (const msg of [encodeWorkMessage('ready'), encodeWorkMessage('completed'), encodeWorkMessage('exited')]) {
    assert.equal(isWorkMessage(msg), true);
  }
});

test('isWorkMessage rejects null, garbage, wrong source, and unknown types', () => {
  const bad: unknown[] = [
    null,
    undefined,
    'ready',
    42,
    true,
    [],
    {},
    { type: 'ready' },
    { source: 'evil', type: 'ready' },
    { source: 42, type: 'ready' },
    { source: 'kanshan-work' },
    { source: 'kanshan-work', type: 'bogus' },
    { source: 'kanshan-work', type: '' },
  ];
  for (const data of bad) {
    assert.equal(isWorkMessage(data), false, `rejected: ${JSON.stringify(data)}`);
  }
});

test('isTrustedWorkMessage enforces strict origin equality plus message shape', () => {
  const ready = encodeWorkMessage('ready');
  assert.equal(isTrustedWorkMessage({ origin: ORIGIN, data: ready }, ORIGIN), true);
  assert.equal(isTrustedWorkMessage({ origin: ORIGIN, data: encodeWorkMessage('exited') }, ORIGIN), true);
  assert.equal(isTrustedWorkMessage({ origin: 'https://evil.test', data: ready }, ORIGIN), false);
  assert.equal(isTrustedWorkMessage({ origin: `${ORIGIN}/`, data: ready }, ORIGIN), false);
  assert.equal(isTrustedWorkMessage({ origin: '', data: ready }, ORIGIN), false);
  assert.equal(isTrustedWorkMessage({ origin: ORIGIN, data: { source: 'evil', type: 'ready' } }, ORIGIN), false);
  assert.equal(isTrustedWorkMessage({ origin: ORIGIN, data: null }, ORIGIN), false);
});

// ------------------------------ door table --------------------------------

test('door config maps the three door ids to the real dist-relative story pages', () => {
  assert.deepEqual([...DOOR_IDS].sort(), ['blue-blood', 'duanfei', 'myopia']);
  assert.deepEqual(Object.keys(DOOR_PAGES).sort(), [...DOOR_IDS].sort());
  assert.equal(DOOR_PAGES.duanfei, './end-consort.html');
  // 蓝血门走 ARG 版（dist/arg + ?story= 深链），结局含人格分享卡。
  assert.equal(DOOR_PAGES['blue-blood'], './arg/?scene=1&story=蓝血-2025684191967294692');
  assert.equal(DOOR_PAGES.myopia, './myopia.html');
  assert.ok(DEFAULT_PORTAL_TIMINGS.readyTimeoutMs > DEFAULT_PORTAL_TIMINGS.fadeMs);
  assert.ok(DEFAULT_PORTAL_TIMINGS.fadeMs > 0);
});

test('story source pages exist as vite inputs at the game-ps1 root', () => {
  for (const page of ['end-consort.html', 'myopia.html']) {
    assert.ok(fs.existsSync(path.join(REPO_ROOT, page)), `${page} exists`);
  }
  // 蓝血门改走 ARG 版：其同步源是 game/dist（gitignored 构建产物，不总存在），
  // 这里只锁定集成契约本身（sync 脚本 + game 的构建入口）。
  assert.ok(fs.existsSync(path.join(REPO_ROOT, 'scripts', 'sync-arg.mjs')), 'sync-arg script exists');
  const gamePkg = JSON.parse(fs.readFileSync(path.resolve(REPO_ROOT, '..', 'game', 'package.json'), 'utf8'));
  assert.ok(gamePkg.scripts['build:experiences'], 'game build:experiences exists');
});

// ------------------------------ host state machine ------------------------

test('boot lands in the hall; portalEnter drives enter() into a sandboxed iframe', async () => {
  const f = await startHost();
  assert.equal(f.host.state(), 'hall');

  f.hall.fireEnter('blue-blood');
  await runFor(f.win, ENTER_TOTAL);
  assert.equal(f.host.state(), 'in-work');

  const frames = f.frames();
  assert.equal(frames.length, 1);
  const frame = frames[0];
  assert.equal(frame.getAttribute('src'), './arg/?scene=1&story=蓝血-2025684191967294692');
  // Door title from the hall contract's doors table, not the raw id.
  assert.equal(frame.getAttribute('title'), '蓝血');
  const perms = (frame.getAttribute('sandbox') ?? '').split(/\s+/);
  assert.ok(perms.includes('allow-scripts'), 'sandbox allows scripts');
  assert.ok(perms.includes('allow-same-origin'), 'sandbox allows same-origin');
  assert.ok(perms.includes('allow-pointer-lock'), 'sandbox allows pointer lock (legacy stories mouse-look)');
  assert.equal(perms.includes('allow-top-navigation'), false, 'no top-navigation permission');
  assert.equal(perms.some((p) => p.startsWith('allow-top-navigation')), false);
  assert.equal(perms.length, 3, 'exactly three sandbox permissions, no extras');
  assert.ok(frame.classList.contains('portal-frame'));
  assert.equal(frame.hidden, false);
  assert.equal(frame.focusCount, 1, 'iframe focused on entry');
  assert.equal(f.chromeByClass('portal-return').hidden, false, 'return affordance visible');
  assert.equal(f.hall.reEnterCount, 0, 'no reEnter during entry');
});

test('enter resolves early on the work ready message, before the ready timeout', async () => {
  const f = await startHost();
  const p = f.host.enter('duanfei');
  await runFor(f.win, SHORT_TIMINGS.fadeMs + 20);
  assert.equal(f.host.state(), 'entering', 'still waiting for the work');
  const frame = f.frames()[0];
  assert.ok(frame, 'iframe created under the white fade');

  f.win.dispatch('message', { origin: ORIGIN, data: encodeWorkMessage('ready'), source: frame.contentWindow });
  await runFor(f.win, SHORT_TIMINGS.fadeMs + 20);
  await p;
  assert.equal(f.host.state(), 'in-work');
  assert.ok(
    f.win.now < SHORT_TIMINGS.fadeMs + SHORT_TIMINGS.readyTimeoutMs,
    'ready short-circuited the timeout',
  );
});

test('enter resolves on the iframe load event when the work stays silent', async () => {
  const f = await startHost();
  const p = f.host.enter('myopia');
  await runFor(f.win, SHORT_TIMINGS.fadeMs + 20);
  const frame = f.frames()[0];
  frame.dispatch('load', { type: 'load' });
  await runFor(f.win, SHORT_TIMINGS.fadeMs + 20);
  await p;
  assert.equal(f.host.state(), 'in-work');
});

test('unknown door id shows an honest error and creates no iframe', async () => {
  const f = await startHost();
  await f.host.enter('no-such-door');
  assert.equal(f.host.state(), 'error');
  assert.equal(f.frames().length, 0, 'no iframe for an unknown door');
  const errorBar = f.chromeByClass('portal-error');
  assert.equal(errorBar.hidden, false);
  assert.match(errorBar.textContent ?? '', /no-such-door/);
  // Auto-dismisses back to the hall.
  await runFor(f.win, SHORT_TIMINGS.errorDwellMs + 20);
  assert.equal(f.host.state(), 'hall');
  assert.equal(errorBar.hidden, true);
});

test('a completed/exited message from the wrong origin does not return; the trusted one does', async () => {
  const f = await startHost();
  const frame = await enterAndSettle(f, 'myopia');
  assert.equal(f.host.state(), 'in-work');

  f.win.dispatch('message', { origin: 'https://evil.test', data: encodeWorkMessage('completed') });
  f.win.dispatch('message', {
    origin: ORIGIN,
    data: encodeWorkMessage('exited'),
    source: { not: 'the-current-frame' },
  });
  assert.equal(f.host.state(), 'in-work', 'untrusted messages ignored');
  assert.equal(f.frames().length, 1);
  assert.equal(f.hall.reEnterCount, 0);

  f.win.dispatch('message', { origin: ORIGIN, data: encodeWorkMessage('exited'), source: frame.contentWindow });
  assert.equal(f.host.state(), 'hall');
  assert.equal(f.hall.reEnterCount, 1, 'reEnter called exactly once');
  assert.equal(f.frames().length, 0, 'iframe disposed');
  assert.equal(f.chromeByClass('portal-return').hidden, true, 'return affordance hidden');
});

test('a trusted completed message also returns to the hall', async () => {
  const f = await startHost();
  await enterAndSettle(f, 'duanfei');
  f.win.dispatch('message', { origin: ORIGIN, data: encodeWorkMessage('completed', { done: true }) });
  assert.equal(f.host.state(), 'hall');
  assert.equal(f.hall.reEnterCount, 1);
  assert.equal(f.frames().length, 0);
});

test('returnToHall is idempotent: dispose iframe + reEnter exactly once', async () => {
  const f = await startHost();
  await enterAndSettle(f, 'blue-blood');
  f.host.returnToHall();
  assert.equal(f.host.state(), 'hall');
  assert.equal(f.hall.reEnterCount, 1);
  assert.equal(f.frames().length, 0);
  f.host.returnToHall();
  f.host.returnToHall();
  assert.equal(f.hall.reEnterCount, 1, 'subsequent returns are no-ops');
});

test('Escape posts request-exit to the work, then hard-returns after the grace window', async () => {
  const f = await startHost();
  const frame = await enterAndSettle(f, 'duanfei');

  f.win.dispatch('keydown', { code: 'KeyQ' });
  assert.equal(f.host.state(), 'in-work', 'non-Escape keys ignored');

  f.win.dispatch('keydown', { code: 'Escape' });
  assert.equal(f.host.state(), 'in-work', 'grace window still open');
  const posted = frame.contentWindow?.posted ?? [];
  assert.equal(posted.length, 1);
  assert.deepEqual(posted[0].message, { source: 'kanshan-host', type: 'request-exit' });
  assert.equal(posted[0].targetOrigin, ORIGIN, 'posted to the portal origin only');

  await runFor(f.win, SHORT_TIMINGS.returnGraceMs + 20);
  assert.equal(f.host.state(), 'hall', 'hard return always offered');
  assert.equal(f.hall.reEnterCount, 1);
  assert.equal(f.frames().length, 0);
});

test('the return button requests return like Escape', async () => {
  const f = await startHost();
  const frame = await enterAndSettle(f, 'myopia');
  f.chromeByClass('portal-return').dispatch('click', { type: 'click' });
  assert.equal(f.host.state(), 'in-work');
  assert.equal((frame.contentWindow?.posted ?? []).length, 1);
  await runFor(f.win, SHORT_TIMINGS.returnGraceMs + 20);
  assert.equal(f.host.state(), 'hall');
  assert.equal(f.hall.reEnterCount, 1);
});

test('a trusted exit message during the return grace returns immediately', async () => {
  const f = await startHost();
  const frame = await enterAndSettle(f, 'blue-blood');
  f.win.dispatch('keydown', { code: 'Escape' });
  assert.equal(f.win.pendingTimerCount(), 1, 'only the grace timer is pending');
  f.win.dispatch('message', { origin: ORIGIN, data: encodeWorkMessage('exited'), source: frame.contentWindow });
  assert.equal(f.host.state(), 'hall', 'returned before the grace window elapsed');
  assert.equal(f.hall.reEnterCount, 1);
  // Drain the fade-off wait plus the (now-cancelled) grace window: no second return.
  await runFor(f.win, SHORT_TIMINGS.returnGraceMs + SHORT_TIMINGS.fadeMs + 40);
  assert.equal(f.hall.reEnterCount, 1, 'grace timer was cancelled, not fired');
  assert.equal(f.win.pendingTimerCount(), 0);
});

test('boot failure lands in an honest error state with no listeners wired', async () => {
  const f = await startHost({ bootError: new Error('hall exploded') });
  assert.equal(f.host.state(), 'error');
  assert.match(f.chromeByClass('portal-error').textContent ?? '', /hall exploded/);
  assert.equal(f.win.listenerCount('message'), 0);
  assert.equal(f.win.listenerCount('keydown'), 0);
  // Nothing crashes when a stray message arrives anyway.
  f.win.dispatch('message', { origin: ORIGIN, data: encodeWorkMessage('exited') });
  assert.equal(f.host.state(), 'error');
});

test('dispose removes listeners, the iframe, and tears the player down once', async () => {
  const f = await startHost();
  await enterAndSettle(f, 'duanfei');
  await f.host.dispose();
  assert.equal(f.frames().length, 0);
  assert.equal(f.hall.unsubscribeCount, 1, 'portalEnter unsubscribed');
  assert.equal(f.win.listenerCount('message'), 0);
  assert.equal(f.win.listenerCount('keydown'), 0);
  await f.host.dispose();
  f.win.dispatch('keydown', { code: 'Escape' });
  f.win.dispatch('message', { origin: ORIGIN, data: encodeWorkMessage('exited') });
  assert.equal(f.host.state(), 'in-work', 'disposed host stays inert (teardown is not a transition)');
});
