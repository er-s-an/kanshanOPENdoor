/**
 * HeadlessInputDevice: a test/tool-driven InputDevice. Callers queue key
 * down/up, pointer deltas and touch events, then advance fixed steps with
 * nextFrame(). Virtual time (advance) drives touch-hold durations so
 * touch-hold thresholds are deterministic in tests.
 */
import type {
  InputDevice,
  RawInputFrame,
  RawTouchButton,
  RawTouchDrag,
  RawTouchStick,
  ScopedOptions,
} from './types.ts';
import type { Scope } from '../core/scope.ts';

export class HeadlessInputDevice implements InputDevice {
  private keys = new Set<string>();
  private mouseButtons = new Set<number>();
  private pointerDX = 0;
  private pointerDY = 0;
  private touchButtons = new Map<string, { downAt: number }>();
  private touchSticks = new Map<string, RawTouchStick>();
  private touchDrags = new Map<string, { dx: number; dy: number }>();
  private timeMs = 0;
  private disposed = false;

  constructor(options: ScopedOptions = {}) {
    const scope: Scope | undefined = options.scope;
    if (scope) scope.own(this);
  }

  get now(): number {
    return this.timeMs;
  }

  // ------------------------------ queueing --------------------------------

  keyDown(code: string): void {
    this.keys.add(code);
  }

  keyUp(code: string): void {
    this.keys.delete(code);
  }

  mouseDown(button: number): void {
    this.mouseButtons.add(button);
  }

  mouseUp(button: number): void {
    this.mouseButtons.delete(button);
  }

  /** Accumulate pointer movement (consumed by the next nextFrame()). */
  pointerDelta(dx: number, dy: number): void {
    this.pointerDX += dx;
    this.pointerDY += dy;
  }

  touchButtonDown(id: string): void {
    if (!this.touchButtons.has(id)) this.touchButtons.set(id, { downAt: this.timeMs });
  }

  touchButtonUp(id: string): void {
    this.touchButtons.delete(id);
  }

  /** Set a virtual stick's normalized position (clamped to [-1, 1]). */
  touchStickMove(id: string, x: number, y: number): void {
    this.touchSticks.set(id, { x: clampUnit(x), y: clampUnit(y) });
  }

  touchStickRelease(id: string): void {
    this.touchSticks.delete(id);
  }

  /** Accumulate a drag delta on an area (consumed by the next nextFrame()). */
  touchDrag(id: string, dx: number, dy: number): void {
    const acc = this.touchDrags.get(id) ?? { dx: 0, dy: 0 };
    acc.dx += dx;
    acc.dy += dy;
    this.touchDrags.set(id, acc);
  }

  /** Advance virtual time; affects heldMs reported for touch buttons. */
  advance(ms: number): void {
    this.timeMs += ms;
  }

  // ------------------------------ InputDevice ------------------------------

  nextFrame(): RawInputFrame {
    assertLive(this.disposed);
    const buttons = new Map<string, RawTouchButton>();
    for (const [id, track] of this.touchButtons) {
      buttons.set(id, { down: true, heldMs: Math.max(0, this.timeMs - track.downAt) });
    }
    const drags = new Map<string, RawTouchDrag>();
    for (const [id, acc] of this.touchDrags) {
      drags.set(id, { dx: acc.dx, dy: acc.dy });
    }
    this.touchDrags.clear();
    const frame: RawInputFrame = {
      keys: new Set(this.keys),
      mouseButtons: new Set(this.mouseButtons),
      pointerDX: this.pointerDX,
      pointerDY: this.pointerDY,
      touchButtons: buttons,
      touchSticks: new Map(this.touchSticks),
      touchDrags: drags,
    };
    // Transients are per-step; held state persists.
    this.pointerDX = 0;
    this.pointerDY = 0;
    return frame;
  }

  reset(): void {
    this.keys.clear();
    this.mouseButtons.clear();
    this.pointerDX = 0;
    this.pointerDY = 0;
    this.touchButtons.clear();
    this.touchSticks.clear();
    this.touchDrags.clear();
  }

  dispose(): void {
    this.disposed = true;
    this.reset();
  }
}

function clampUnit(v: number): number {
  if (v > 1) return 1;
  if (v < -1) return -1;
  return v;
}

function assertLive(disposed: boolean): void {
  if (disposed) {
    throw new Error('HeadlessInputDevice is disposed');
  }
}
