/**
 * Raw device layer: the boundary between physical input sources and the
 * action mapper. A device accumulates hardware/window events between fixed
 * steps and produces one immutable RawInputFrame per step.
 *
 * Everything here is DOM-free at import time: DomInputDevice only touches
 * DOM inside its constructor when real targets are passed, and tests inject
 * HeadlessInputDevice or fake EventTargets.
 */
import type { Scope } from '../core/scope.ts';

/** Snapshot of one touch button at a step boundary. */
export interface RawTouchButton {
  readonly down: boolean;
  /** How long the button has been held, in ms, at snapshot time. */
  readonly heldMs: number;
}

/** Snapshot of one virtual touch stick. Components are normalized to [-1, 1]. */
export interface RawTouchStick {
  readonly x: number;
  readonly y: number;
}

/**
 * Immutable view of everything the hardware reported for one fixed step.
 * Devices copy their mutable accumulators into a fresh frame on every
 * nextFrame(), so frames never change after being handed out.
 */
export interface RawInputFrame {
  /** Keyboard codes currently down (KeyboardEvent.code, e.g. 'KeyW'). */
  readonly keys: ReadonlySet<string>;
  /** Mouse buttons currently down (0 = primary). */
  readonly mouseButtons: ReadonlySet<number>;
  /** Pointer movement accumulated since the previous frame. */
  readonly pointerDX: number;
  readonly pointerDY: number;
  /** Touch buttons by author-assigned id. */
  readonly touchButtons: ReadonlyMap<string, RawTouchButton>;
  /** Touch sticks by author-assigned id. */
  readonly touchSticks: ReadonlyMap<string, RawTouchStick>;
}

/** Frozen empty frame, used for blur/focus-loss baselines. */
export const EMPTY_RAW_FRAME: RawInputFrame = Object.freeze({
  keys: new Set<string>(),
  mouseButtons: new Set<number>(),
  pointerDX: 0,
  pointerDY: 0,
  touchButtons: new Map<string, RawTouchButton>(),
  touchSticks: new Map<string, RawTouchStick>(),
});

/**
 * A replaceable input source. HeadlessInputDevice is driven by tests/tools;
 * DomInputDevice listens to real DOM events. Both produce the same frames.
 */
export interface InputDevice {
  /**
   * Produce the frame for the next fixed step. Transient state (pointer
   * deltas, one-shot accumulators) is consumed; held state persists until
   * the matching up/release event or reset().
   */
  nextFrame(): RawInputFrame;
  /** Drop all held state and transients (window blur, focus loss). */
  reset(): void;
}

/** Constructor options shared by devices/managers that tie into a Scope. */
export interface ScopedOptions {
  /** When given, dispose() is registered with the scope automatically. */
  scope?: Scope;
}

/**
 * Structural event shape shared by keyboard/mouse/pointer/window events.
 * Real DOM events satisfy it; tests synthesize plain objects.
 */
export interface DomEvent {
  type?: string;
  preventDefault?: () => void;
  stopPropagation?: () => void;
  target?: unknown;
  /** KeyboardEvent */
  code?: string;
  repeat?: boolean;
  /** MouseEvent */
  button?: number;
  movementX?: number;
  movementY?: number;
  clientX?: number;
  clientY?: number;
  /** PointerEvent */
  pointerId?: number;
  pointerType?: string;
}

export type DomListener = (event: DomEvent) => void;

/**
 * Structural subset of EventTarget used by DomInputDevice. Real DOM nodes
 * satisfy it; tests substitute fakes that count add/remove calls.
 */
export interface EventTargetLike {
  addEventListener(type: string, listener: DomListener, options?: unknown): void;
  removeEventListener(type: string, listener: DomListener, options?: unknown): void;
}

/** Minimal element shape for touch stick anchoring. */
export interface StickElementLike extends EventTargetLike {
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
}
