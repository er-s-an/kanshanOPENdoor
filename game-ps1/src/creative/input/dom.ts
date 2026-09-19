/**
 * DomInputDevice: an InputDevice backed by real DOM events.
 *
 * DOM access happens ONLY inside the constructor — never at import time —
 * and only when the caller passes real targets (they default to the global
 * window when one exists, so headless construction under Node is inert).
 * Every listener added is tracked and removed by dispose().
 *
 * Pointer lock: the device tracks lock state via 'pointerlockchange' on the
 * provided document. With requirePointerLock: true, mouse deltas accumulate
 * only while locked. Requesting lock itself stays with the host/canvas.
 */
import type {
  DomListener,
  EventTargetLike,
  InputDevice,
  RawInputFrame,
  RawTouchButton,
  RawTouchDrag,
  RawTouchStick,
  ScopedOptions,
  StickElementLike,
} from './types.ts';
import type { Scope } from '../core/scope.ts';

interface ListenerRecord {
  target: EventTargetLike;
  type: string;
  listener: DomListener;
}

interface StickConfig {
  element: StickElementLike;
  /** Normalization radius in px; defaults to half the element's min dimension. */
  radius?: number;
}

type StickTarget = StickElementLike | StickConfig;

export interface DomInputDeviceOptions extends ScopedOptions {
  /** keydown/keyup target (default: global window when present). Receives blur reset. */
  keys?: EventTargetLike;
  /** mousedown/mousemove target (typically the canvas). */
  pointer?: EventTargetLike;
  /** Document-like target for pointerlockchange/visibilitychange. */
  document?: EventTargetLike & { hidden?: boolean; pointerLockElement?: unknown };
  /** Object expected as document.pointerLockElement when locked. */
  pointerLockElement?: unknown;
  /** Accumulate mouse deltas only while pointer-locked (default false). */
  requirePointerLock?: boolean;
  /** Touch button id -> element to listen on. */
  touchButtons?: ReadonlyMap<string, EventTargetLike>;
  /** Touch stick id -> element (optionally with radius). */
  touchSticks?: ReadonlyMap<string, StickTarget>;
  /** Touch-drag area id -> element; drags accumulate per-step dx/dy (look). */
  touchDragAreas?: ReadonlyMap<string, EventTargetLike>;
  /** Called after every internal state reset (window blur, dispose). */
  onReset?: () => void;
  /** Clock for touch-hold durations (default: performance.now). */
  now?: () => number;
}

export class DomInputDevice implements InputDevice {
  private readonly keysDown = new Set<string>();
  private readonly mouseButtonsDown = new Set<number>();
  private pointerDX = 0;
  private pointerDY = 0;
  private readonly touchButtons = new Map<string, { downAt: number; pointerId: number | null }>();
  private readonly touchSticks = new Map<string, RawTouchStick>();
  private readonly stickPointers = new Map<string, { pointerId: number; originX: number; originY: number }>();
  private readonly dragPointers = new Map<string, { pointerId: number; lastX: number; lastY: number }>();
  private readonly dragAccumulators = new Map<string, { dx: number; dy: number }>();
  private readonly records: ListenerRecord[] = [];
  private readonly now: () => number;
  private readonly onReset?: () => void;
  private readonly lockDocument: (EventTargetLike & { hidden?: boolean; pointerLockElement?: unknown }) | undefined;
  private readonly lockElement: unknown;
  private readonly requirePointerLock: boolean;
  private lockActive = false;
  private disposed = false;

  constructor(options: DomInputDeviceOptions = {}) {
    this.now = options.now ?? defaultNow;
    this.onReset = options.onReset;
    this.lockDocument = options.document;
    this.lockElement = options.pointerLockElement;
    this.requirePointerLock = options.requirePointerLock ?? false;
    const scope: Scope | undefined = options.scope;
    if (scope) scope.own(this);

    const keysTarget = options.keys ?? globalWindow();
    const pointerTarget = options.pointer ?? keysTarget;
    const touchButtons = options.touchButtons ?? new Map<string, EventTargetLike>();
    const touchSticks = options.touchSticks ?? new Map<string, StickTarget>();
    const touchDragAreas = options.touchDragAreas ?? new Map<string, EventTargetLike>();

    // Keyboard: edges de-duplicated by the mapper, so key repeat is harmless.
    if (keysTarget) {
      this.listen(keysTarget, 'keydown', (e) => {
        if (!e.code) return;
        if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault?.();
        this.keysDown.add(e.code);
      });
      this.listen(keysTarget, 'keyup', (e) => {
        if (e.code) this.keysDown.delete(e.code);
      });
      this.listen(keysTarget, 'blur', () => this.reset());
    }

    // Mouse buttons + movement.
    if (pointerTarget) {
      this.listen(pointerTarget, 'mousedown', (e) => {
        this.mouseButtonsDown.add(e.button ?? 0);
      });
      this.listen(pointerTarget, 'mousemove', (e) => {
        if (this.requirePointerLock && !this.lockActive) return;
        this.pointerDX += e.movementX ?? 0;
        this.pointerDY += e.movementY ?? 0;
      });
      this.listen(pointerTarget, 'contextmenu', (e) => e.preventDefault?.());
    }
    // mouseup must fire even when released outside the canvas: also listen
    // on the keys target (window) when it differs.
    const upTarget = keysTarget ?? pointerTarget;
    if (upTarget) {
      this.listen(upTarget, 'mouseup', (e) => {
        this.mouseButtonsDown.delete(e.button ?? 0);
      });
    }

    // Pointer lock tracking.
    if (this.lockDocument) {
      this.listen(this.lockDocument, 'pointerlockchange', () => {
        this.lockActive = this.lockDocument?.pointerLockElement === this.lockElement;
      });
    }

    // Page hidden (tab switch) behaves like blur.
    if (this.lockDocument) {
      this.listen(this.lockDocument, 'visibilitychange', () => {
        if (this.lockDocument?.hidden) this.reset();
      });
    }

    // Touch buttons: one active pointer per button.
    for (const [id, element] of touchButtons) {
      const down = (e: { pointerId?: number }): void => {
        this.touchButtons.set(id, { downAt: this.now(), pointerId: e.pointerId ?? null });
      };
      const up = (e: { pointerId?: number }): void => {
        const track = this.touchButtons.get(id);
        if (!track) return;
        // A pointerup from a different pointer must not release the button;
        // a bare lostpointercapture (no id) always does.
        if (e.pointerId !== undefined && track.pointerId !== null && e.pointerId !== track.pointerId) return;
        this.touchButtons.delete(id);
      };
      this.listen(element, 'pointerdown', (e) => {
        e.preventDefault?.();
        down(e);
      });
      this.listen(element, 'pointerup', up);
      this.listen(element, 'pointercancel', up);
      this.listen(element, 'lostpointercapture', up);
    }

    // Touch sticks: drag relative to element center (or first touch point).
    for (const [id, target] of touchSticks) {
      const config = isStickConfig(target) ? target : { element: target };
      const element = config.element;
      const begin = (e: { pointerId?: number; clientX?: number; clientY?: number }): void => {
        if (this.stickPointers.has(id)) return;
        const point = e.clientX !== undefined && e.clientY !== undefined
          ? { x: e.clientX, y: e.clientY }
          : null;
        const origin = stickOrigin(element, point);
        this.stickPointers.set(id, { pointerId: e.pointerId ?? -1, originX: origin.x, originY: origin.y });
        this.touchSticks.set(id, { x: 0, y: 0 });
      };
      const move = (e: { pointerId?: number; clientX?: number; clientY?: number }): void => {
        const track = this.stickPointers.get(id);
        if (!track || (e.pointerId !== undefined && e.pointerId !== track.pointerId)) return;
        if (e.clientX === undefined || e.clientY === undefined) return;
        const radius = config.radius ?? stickRadius(element);
        const x = radius > 0 ? (e.clientX - track.originX) / radius : 0;
        const y = radius > 0 ? (track.originY - e.clientY) / radius : 0;
        this.touchSticks.set(id, { x: clampUnit(x), y: clampUnit(y) });
      };
      const end = (e: { pointerId?: number }): void => {
        const track = this.stickPointers.get(id);
        if (track && e.pointerId !== undefined && e.pointerId !== track.pointerId) return;
        this.stickPointers.delete(id);
        this.touchSticks.delete(id);
      };
      this.listen(element, 'pointerdown', (e) => {
        e.preventDefault?.();
        begin(e);
      });
      this.listen(element, 'pointermove', move);
      this.listen(element, 'pointerup', end);
      this.listen(element, 'pointercancel', end);
      this.listen(element, 'lostpointercapture', end);
    }

    // Touch-drag areas: per-step pixel deltas (camera look). One active
    // pointer per area; deltas come from clientX/Y so no movementX reliance.
    for (const [id, element] of touchDragAreas) {
      const begin = (e: { pointerId?: number; clientX?: number; clientY?: number }): void => {
        if (this.dragPointers.has(id)) return;
        if (e.clientX === undefined || e.clientY === undefined) return;
        this.dragPointers.set(id, { pointerId: e.pointerId ?? -1, lastX: e.clientX, lastY: e.clientY });
      };
      const move = (e: { pointerId?: number; clientX?: number; clientY?: number }): void => {
        const track = this.dragPointers.get(id);
        if (!track || (e.pointerId !== undefined && e.pointerId !== track.pointerId)) return;
        if (e.clientX === undefined || e.clientY === undefined) return;
        const acc = this.dragAccumulators.get(id) ?? { dx: 0, dy: 0 };
        acc.dx += e.clientX - track.lastX;
        acc.dy += e.clientY - track.lastY;
        this.dragAccumulators.set(id, acc);
        track.lastX = e.clientX;
        track.lastY = e.clientY;
      };
      const end = (e: { pointerId?: number }): void => {
        const track = this.dragPointers.get(id);
        if (track && e.pointerId !== undefined && e.pointerId !== track.pointerId) return;
        this.dragPointers.delete(id);
      };
      this.listen(element, 'pointerdown', (e) => {
        e.preventDefault?.();
        begin(e);
      });
      this.listen(element, 'pointermove', move);
      this.listen(element, 'pointerup', end);
      this.listen(element, 'pointercancel', end);
      this.listen(element, 'lostpointercapture', end);
    }
  }

  // ------------------------------ InputDevice ------------------------------

  nextFrame(): RawInputFrame {
    if (this.disposed) throw new Error('DomInputDevice is disposed');
    const buttons = new Map<string, RawTouchButton>();
    for (const [id, track] of this.touchButtons) {
      buttons.set(id, { down: true, heldMs: Math.max(0, this.now() - track.downAt) });
    }
    const drags = new Map<string, RawTouchDrag>();
    for (const [id, acc] of this.dragAccumulators) {
      drags.set(id, { dx: acc.dx, dy: acc.dy });
    }
    this.dragAccumulators.clear();
    const frame: RawInputFrame = {
      keys: new Set(this.keysDown),
      mouseButtons: new Set(this.mouseButtonsDown),
      pointerDX: this.pointerDX,
      pointerDY: this.pointerDY,
      touchButtons: buttons,
      touchSticks: new Map(this.touchSticks),
      touchDrags: drags,
    };
    this.pointerDX = 0;
    this.pointerDY = 0;
    return frame;
  }

  reset(): void {
    this.keysDown.clear();
    this.mouseButtonsDown.clear();
    this.pointerDX = 0;
    this.pointerDY = 0;
    this.touchButtons.clear();
    this.touchSticks.clear();
    this.stickPointers.clear();
    this.dragPointers.clear();
    this.dragAccumulators.clear();
    this.onReset?.();
  }

  /** Remove every listener this device added. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const record of this.records) {
      record.target.removeEventListener(record.type, record.listener);
    }
    this.records.length = 0;
    this.reset();
  }

  // ------------------------------ internals --------------------------------

  private listen(target: EventTargetLike, type: string, listener: DomListener): void {
    target.addEventListener(type, listener);
    this.records.push({ target, type, listener });
  }
}

function isStickConfig(target: StickTarget): target is StickConfig {
  return typeof (target as StickConfig).element?.addEventListener === 'function';
}

function stickOrigin(element: StickElementLike, point: { x: number; y: number } | null): { x: number; y: number } {
  const rect = element.getBoundingClientRect();
  if (point && rect.width === 0 && rect.height === 0) return point;
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function stickRadius(element: StickElementLike): number {
  const rect = element.getBoundingClientRect();
  return Math.min(rect.width, rect.height) / 2;
}

function clampUnit(v: number): number {
  if (v > 1) return 1;
  if (v < -1) return -1;
  return v;
}

function globalWindow(): EventTargetLike | undefined {
  return typeof window === 'undefined' ? undefined : (window as unknown as EventTargetLike);
}

function defaultNow(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}
