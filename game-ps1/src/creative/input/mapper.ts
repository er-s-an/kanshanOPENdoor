/**
 * ActionMapper: resolves an author-declared ActionMap against raw device
 * frames each fixed step and exposes the frozen ActionState contract
 * (pressed/held/released edges + continuous axes).
 *
 * Edge semantics: edges are computed per applied frame by diffing the
 * effective-down set against the previous applied frame. A press seen in
 * step N is therefore NOT pressed in N+1, and edges never bleed across
 * steps because each frame produces an independent snapshot.
 *
 * Baseline control (focus arbitration): syncBaseline(frame) re-arms edge
 * memory against a given frame so the next applied frame emits no phantom
 * pressed/released edges; suppress(frame) additionally exposes an empty
 * state until the next applied frame. FocusManager uses these to guarantee
 * that input released while a layer was suppressed never surfaces as an
 * edge later.
 */
import type { ActionMap, ActionName, ActionState, AxisBinding, AxisName, ActionBinding, InputFrameSource } from '../core/input-types.ts';
import { CreativeError } from '../core/errors.ts';
import { EMPTY_RAW_FRAME, type InputDevice, type RawInputFrame, type ScopedOptions } from './types.ts';
import type { Scope } from '../core/scope.ts';

/** Immutable per-step resolution handed out by ActionMapper.applyFrame(). */
class ResolvedActions implements ActionState {
  private readonly pressedSet: ReadonlySet<ActionName>;
  private readonly heldSet: ReadonlySet<ActionName>;
  private readonly releasedSet: ReadonlySet<ActionName>;
  private readonly axes: ReadonlyMap<AxisName, number>;

  constructor(
    pressedSet: ReadonlySet<ActionName>,
    heldSet: ReadonlySet<ActionName>,
    releasedSet: ReadonlySet<ActionName>,
    axes: ReadonlyMap<AxisName, number>,
  ) {
    this.pressedSet = pressedSet;
    this.heldSet = heldSet;
    this.releasedSet = releasedSet;
    this.axes = axes;
  }

  pressed(action: ActionName): boolean {
    return this.pressedSet.has(action);
  }

  held(action: ActionName): boolean {
    return this.heldSet.has(action);
  }

  released(action: ActionName): boolean {
    return this.releasedSet.has(action);
  }

  axis(name: AxisName): number {
    return this.axes.get(name) ?? 0;
  }
}

/** Shared no-input state: every edge false, every axis 0. */
export const EMPTY_ACTION_STATE: ActionState = Object.freeze({
  pressed: (): boolean => false,
  held: (): boolean => false,
  released: (): boolean => false,
  axis: (): number => 0,
});

export interface ActionMapperOptions extends ScopedOptions {}

export class ActionMapper implements ActionState, InputFrameSource {
  private map: ActionMap;
  private readonly device: InputDevice | undefined;
  private previousDown = new Set<ActionName>();
  private current: ActionState = EMPTY_ACTION_STATE;
  private disposed = false;

  constructor(actionMap: ActionMap, device?: InputDevice, options: ActionMapperOptions = {}) {
    validateActionMap(actionMap);
    this.map = actionMap;
    this.device = device;
    const scope: Scope | undefined = options.scope;
    if (scope) scope.own(this);
  }

  // ------------------------------ ActionState ------------------------------

  pressed(action: ActionName): boolean {
    return this.current.pressed(action);
  }

  held(action: ActionName): boolean {
    return this.current.held(action);
  }

  released(action: ActionName): boolean {
    return this.current.released(action);
  }

  axis(name: AxisName): number {
    return this.current.axis(name);
  }

  /** State resolved for the most recent applied frame (empty before any). */
  snapshot(): ActionState {
    return this.current;
  }

  // ------------------------------ stepping ---------------------------------

  /**
   * Pull the next frame from the bound device, resolve it, and return the
   * new snapshot. Requires a device (see applyFrame for device-less use).
   */
  step(): ActionState {
    this.assertLive();
    if (!this.device) {
      throw new CreativeError(
        'INPUT_NO_DEVICE',
        'ActionMapper.step() requires a device; pass one to the constructor or use applyFrame()',
        { phase: 'input' },
      );
    }
    return this.applyFrame(this.device.nextFrame());
  }

  /**
   * Resolve a caller-provided frame (used by FocusManager to route frames).
   * Computes edges against the previous applied frame or baseline.
   */
  applyFrame(frame: RawInputFrame): ActionState {
    this.assertLive();
    const downs = resolveDowns(this.map, frame);
    const pressed = new Set<ActionName>();
    const released = new Set<ActionName>();
    for (const name of downs) {
      if (!this.previousDown.has(name)) pressed.add(name);
    }
    for (const name of this.previousDown) {
      if (!downs.has(name)) released.add(name);
    }
    this.previousDown = downs;
    this.current = new ResolvedActions(pressed, downs, released, resolveAxes(this.map, frame));
    return this.current;
  }

  /**
   * Re-arm edge memory against the given frame (default: empty) without
   * exposing it: the next applied frame emits edges only for changes after
   * this baseline. Called on focus switch and blur.
   */
  syncBaseline(frame: RawInputFrame = EMPTY_RAW_FRAME): void {
    this.previousDown = resolveDowns(this.map, frame);
  }

  /**
   * Layer-suppressed step: expose NOTHING (no held, no axes, no edges) while
   * silently tracking the frame as the new baseline so resuming later emits
   * no phantom edges for input that changed during suppression.
   */
  suppress(frame: RawInputFrame): void {
    this.syncBaseline(frame);
    this.current = EMPTY_ACTION_STATE;
  }

  /** Replace/extend the action map at runtime. Resets edge memory. */
  setActionMap(actionMap: ActionMap): void {
    validateActionMap(actionMap);
    this.map = actionMap;
    this.previousDown = new Set<ActionName>();
  }

  dispose(): void {
    this.disposed = true;
    this.current = EMPTY_ACTION_STATE;
    this.previousDown.clear();
  }

  private assertLive(): void {
    if (this.disposed) {
      throw new CreativeError('INPUT_DISPOSED', 'ActionMapper is disposed', { phase: 'input' });
    }
  }
}

// ------------------------------ resolution ---------------------------------

export function resolveDowns(map: ActionMap, frame: RawInputFrame): Set<ActionName> {
  const downs = new Set<ActionName>();
  for (const name of Object.keys(map.actions)) {
    const bindings = map.actions[name];
    for (const binding of bindings) {
      if (bindingDown(binding, frame)) {
        downs.add(name);
        break;
      }
    }
  }
  return downs;
}

export function resolveAxes(map: ActionMap, frame: RawInputFrame): Map<AxisName, number> {
  const axes = new Map<AxisName, number>();
  for (const name of Object.keys(map.axes)) {
    axes.set(name, axisValue(map.axes[name], frame));
  }
  return axes;
}

function bindingDown(binding: ActionBinding, frame: RawInputFrame): boolean {
  switch (binding.kind) {
    case 'key':
      return frame.keys.has(binding.code);
    case 'mouse-button':
      return frame.mouseButtons.has(binding.button);
    case 'touch-button':
      return frame.touchButtons.has(binding.id);
    case 'touch-hold': {
      const track = frame.touchButtons.get(binding.id);
      if (!track) return false;
      return track.heldMs >= (binding.minMs ?? 0);
    }
  }
}

function axisValue(bindings: AxisBinding[], frame: RawInputFrame): number {
  let value = 0;
  for (const binding of bindings) {
    switch (binding.kind) {
      case 'key-pair': {
        if (frame.keys.has(binding.positive)) value += 1;
        if (frame.keys.has(binding.negative)) value -= 1;
        break;
      }
      case 'pointer-delta': {
        const delta = binding.component === 'dx' ? frame.pointerDX : frame.pointerDY;
        value += delta * (binding.scale ?? 1);
        break;
      }
      case 'touch-stick': {
        const stick = frame.touchSticks.get(binding.id);
        if (stick) value += binding.component === 'x' ? stick.x : stick.y;
        break;
      }
    }
  }
  return clampUnit(value);
}

function clampUnit(v: number): number {
  if (v > 1) return 1;
  if (v < -1) return -1;
  return v;
}

// ------------------------------ map helpers --------------------------------

const ACTION_KINDS = new Set(['key', 'mouse-button', 'touch-button', 'touch-hold']);
const AXIS_KINDS = new Set(['key-pair', 'pointer-delta', 'touch-stick']);

/** Validate an author-supplied ActionMap; throws CreativeError on typos. */
export function validateActionMap(map: ActionMap): void {
  if (!map || typeof map !== 'object' || !map.actions || typeof map.actions !== 'object' || !map.axes || typeof map.axes !== 'object') {
    throw new CreativeError('INPUT_INVALID_ACTION_MAP', 'ActionMap must have `actions` and `axes` records', { phase: 'input' });
  }
  for (const name of Object.keys(map.actions)) {
    assertName(name, 'action');
    const bindings = map.actions[name];
    if (!Array.isArray(bindings)) {
      throw invalidMap(`action "${name}" bindings must be an array`);
    }
    for (const binding of bindings) {
      if (!binding || typeof binding !== 'object' || !ACTION_KINDS.has(String(binding.kind))) {
        throw invalidMap(`action "${name}" has an unknown binding kind ${JSON.stringify((binding as { kind?: unknown })?.kind)}`);
      }
      if (binding.kind === 'key' && !isNonEmpty(binding.code)) throw invalidMap(`action "${name}" key binding needs a code`);
      if (binding.kind === 'mouse-button' && typeof binding.button !== 'number') throw invalidMap(`action "${name}" mouse-button needs a button number`);
      if ((binding.kind === 'touch-button' || binding.kind === 'touch-hold') && !isNonEmpty(binding.id)) throw invalidMap(`action "${name}" ${binding.kind} needs an id`);
      if (binding.kind === 'touch-hold' && binding.minMs !== undefined && (typeof binding.minMs !== 'number' || binding.minMs < 0)) {
        throw invalidMap(`action "${name}" touch-hold minMs must be a number >= 0`);
      }
    }
  }
  for (const name of Object.keys(map.axes)) {
    assertName(name, 'axis');
    const bindings = map.axes[name];
    if (!Array.isArray(bindings)) {
      throw invalidMap(`axis "${name}" bindings must be an array`);
    }
    for (const binding of bindings) {
      if (!binding || typeof binding !== 'object' || !AXIS_KINDS.has(String(binding.kind))) {
        throw invalidMap(`axis "${name}" has an unknown binding kind ${JSON.stringify((binding as { kind?: unknown })?.kind)}`);
      }
      if (binding.kind === 'key-pair' && (!isNonEmpty(binding.negative) || !isNonEmpty(binding.positive))) {
        throw invalidMap(`axis "${name}" key-pair needs negative and positive codes`);
      }
      if (binding.kind === 'pointer-delta' && binding.component !== 'dx' && binding.component !== 'dy') {
        throw invalidMap(`axis "${name}" pointer-delta component must be 'dx' or 'dy'`);
      }
      if (binding.kind === 'pointer-delta' && binding.scale !== undefined && typeof binding.scale !== 'number') {
        throw invalidMap(`axis "${name}" pointer-delta scale must be a number`);
      }
      if (binding.kind === 'touch-stick' && (!isNonEmpty(binding.id) || (binding.component !== 'x' && binding.component !== 'y'))) {
        throw invalidMap(`axis "${name}" touch-stick needs an id and component 'x' or 'y'`);
      }
    }
  }
}

/**
 * Merge two action maps: bindings for names only in one map are copied;
 * names present in both get base bindings followed by extra bindings.
 * Inputs are not mutated; the result is a new ActionMap.
 */
export function mergeActionMaps(base: ActionMap, extra: ActionMap): ActionMap {
  validateActionMap(base);
  validateActionMap(extra);
  return {
    actions: mergeBindings(base.actions, extra.actions),
    axes: mergeBindings(base.axes, extra.axes),
  };
}

function mergeBindings<T>(base: Record<string, T[]>, extra: Record<string, T[]>): Record<string, T[]> {
  const out: Record<string, T[]> = { ...base };
  for (const name of Object.keys(extra)) {
    const existing = out[name];
    out[name] = existing ? [...existing, ...extra[name]] : [...extra[name]];
  }
  return out;
}

function assertName(name: string, kind: string): void {
  if (!isNonEmpty(name)) throw invalidMap(`${kind} name must be a non-empty string`);
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function invalidMap(message: string): CreativeError {
  return new CreativeError('INPUT_INVALID_ACTION_MAP', message, { phase: 'input' });
}
