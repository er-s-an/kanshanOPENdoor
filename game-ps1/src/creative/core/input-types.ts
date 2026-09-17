/**
 * Input contract shared between the input system (devices -> actions) and
 * consumers (controllers, UI, tools). Devices are replaceable; tests inject
 * synthetic frames. Actions are author-defined strings — nothing like
 * "squint" is baked into the contract.
 */
export type ActionName = string;
export type AxisName = string;

export interface ActionState {
  /** Edge: went down this step. */
  pressed(action: ActionName): boolean;
  /** Level: currently down. */
  held(action: ActionName): boolean;
  /** Edge: released this step. */
  released(action: ActionName): boolean;
  /** Continuous axis in [-1, 1] (e.g. move.x, look.y). 0 when unbound. */
  axis(name: AxisName): number;
}

/** Focus layers, highest priority first. Input is consumed by the top layer that handles it. */
export type FocusLayer = 'modal-ui' | 'editor' | 'game';

export interface InputFrameSource {
  /** Produce a read-only view for the current fixed step. */
  snapshot(): ActionState;
}

/**
 * Author-declared mapping: action/axis name <- device bindings.
 * The input system resolves devices into this map; works may extend it.
 */
export interface ActionMap {
  actions: Record<ActionName, ActionBinding[]>;
  axes: Record<AxisName, AxisBinding[]>;
}

export type ActionBinding =
  | { kind: 'key'; code: string }
  | { kind: 'mouse-button'; button: number }
  | { kind: 'touch-button'; id: string }
  | { kind: 'touch-hold'; id: string; minMs?: number };

export type AxisBinding =
  | { kind: 'key-pair'; negative: string; positive: string }
  | { kind: 'pointer-delta'; component: 'dx' | 'dy'; scale?: number }
  | { kind: 'touch-stick'; id: string; component: 'x' | 'y' };
