/**
 * Creative input system (S05): devices -> raw frames -> action maps ->
 * focus arbitration. Plain TS, no import-time DOM access, everything
 * Scope-tied and disposable.
 */
export type {
  ActionName,
  AxisName,
  ActionState,
  FocusLayer,
  InputFrameSource,
  ActionMap,
  ActionBinding,
  AxisBinding,
} from '../core/input-types.ts';

export type {
  RawInputFrame,
  RawTouchButton,
  RawTouchStick,
  InputDevice,
  ScopedOptions,
  DomEvent,
  DomListener,
  EventTargetLike,
  StickElementLike,
} from './types.ts';
export { EMPTY_RAW_FRAME } from './types.ts';

export { HeadlessInputDevice } from './headless.ts';
export { DomInputDevice } from './dom.ts';
export type { DomInputDeviceOptions } from './dom.ts';

export {
  ActionMapper,
  EMPTY_ACTION_STATE,
  resolveDowns,
  resolveAxes,
  validateActionMap,
  mergeActionMaps,
} from './mapper.ts';
export type { ActionMapperOptions } from './mapper.ts';

export { FocusManager, FOCUS_LAYER_ORDER } from './focus.ts';

export { fpsDefaults, topdownDefaults } from './defaults.ts';
