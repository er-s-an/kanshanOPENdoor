/**
 * FocusManager: arbitrates which focus layer sees each fixed step's raw
 * input. Layers are prioritized modal-ui > editor > game; the single top
 * active layer's ActionMapper receives the frame, every other bound mapper
 * is suppressed.
 *
 * Suppression guarantees:
 * - A suppressed mapper exposes an empty state (no held states, no axes, no
 *   edges) for as long as it is suppressed.
 * - Suppressed frames still advance the mapper's edge baseline, so input
 *   that changes while a layer is suppressed can NEVER surface as a phantom
 *   pressed/released edge when the layer becomes active again.
 * - blur() (window blur / tab switch / focus loss) resets the device and
 *   re-baselines every mapper against an empty frame.
 */
import type { ActionState, FocusLayer, InputFrameSource } from '../core/input-types.ts';
import { ActionMapper, EMPTY_ACTION_STATE } from './mapper.ts';
import { EMPTY_RAW_FRAME, type InputDevice, type ScopedOptions } from './types.ts';
import type { Scope } from '../core/scope.ts';

/** Priority order, highest first. */
export const FOCUS_LAYER_ORDER: readonly FocusLayer[] = ['modal-ui', 'editor', 'game'];

export class FocusManager implements InputFrameSource {
  private readonly bindings = new Map<FocusLayer, ActionMapper>();
  private readonly activeLayers = new Set<FocusLayer>(['game']);
  private readonly device: InputDevice;
  private disposed = false;

  constructor(device: InputDevice, options: ScopedOptions = {}) {
    this.device = device;
    const scope: Scope | undefined = options.scope;
    if (scope) scope.own(this);
  }

  /** Bind (or replace) the mapper that receives input while `layer` is top. */
  bind(layer: FocusLayer, mapper: ActionMapper): void {
    this.assertLive();
    this.bindings.set(layer, mapper);
  }

  unbind(layer: FocusLayer): void {
    this.bindings.delete(layer);
  }

  /** Activate or deactivate a layer. `game` starts active. */
  setActive(layer: FocusLayer, active: boolean): void {
    this.assertLive();
    if (active) this.activeLayers.add(layer);
    else this.activeLayers.delete(layer);
  }

  isActive(layer: FocusLayer): boolean {
    return this.activeLayers.has(layer);
  }

  /** Highest-priority active layer, or null when nothing is active. */
  topLayer(): FocusLayer | null {
    for (const layer of FOCUS_LAYER_ORDER) {
      if (this.activeLayers.has(layer)) return layer;
    }
    return null;
  }

  /**
   * Pull the next frame from the device and route it: the top active
   * layer's mapper resolves it; all other bound mappers are suppressed.
   * Returns the top mapper's new snapshot, or null if the top active layer
   * has no mapper (input is swallowed either way).
   */
  step(): ActionState | null {
    this.assertLive();
    const frame = this.device.nextFrame();
    const top = this.topLayer();
    let result: ActionState | null = null;
    for (const layer of FOCUS_LAYER_ORDER) {
      const mapper = this.bindings.get(layer);
      if (!mapper) continue;
      if (layer === top) {
        mapper.applyFrame(frame);
        result = mapper.snapshot();
      } else {
        mapper.suppress(frame);
      }
    }
    return result;
  }

  /** Snapshot of the top active layer's mapper (empty when none/unbound). */
  snapshot(): ActionState {
    const top = this.topLayer();
    if (!top) return EMPTY_ACTION_STATE;
    return this.bindings.get(top)?.snapshot() ?? EMPTY_ACTION_STATE;
  }

  /**
   * Window blur / focus loss: drop all device state and re-baseline every
   * mapper against an empty frame, so nothing held at blur time produces a
   * phantom release (or re-press) afterwards.
   */
  blur(): void {
    this.device.reset();
    for (const mapper of this.bindings.values()) {
      mapper.suppress(EMPTY_RAW_FRAME);
    }
  }

  /**
   * Clear bindings. Bound mappers and the device own their own lifecycles
   * (each registers with its own Scope); they are NOT disposed here.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.bindings.clear();
    this.activeLayers.clear();
  }

  private assertLive(): void {
    if (this.disposed) {
      throw new Error('FocusManager is disposed');
    }
  }
}
