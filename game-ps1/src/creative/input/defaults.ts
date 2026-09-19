/**
 * Starter action maps as plain data. Nothing in the input system references
 * these verbs — authors freely extend (mergeActionMaps) or replace them.
 *
 * Conventions used here (all data-level, all overridable):
 * - Axes are named '<domain>.<component>' and normalized to [-1, 1].
 * - 'move.*' uses W/up = positive; touch stick 'move' follows joystick
 *   convention (y positive = up).
 * - Touch bindings reference overlay ids ('jump', 'interact', ...) that a
 *   touch HUD binds via DomInputDevice's touchButtons/touchSticks maps.
 * - Look axes combine pointer-delta (mouse, optionally pointer-locked) with
 *   a 'look' touch-drag area (drag-to-look on touch screens); a work that
 *   never mounts those elements simply resolves them to 0.
 */
import type { ActionMap } from '../core/input-types.ts';

export const fpsDefaults: ActionMap = {
  actions: {
    forward: [
      { kind: 'key', code: 'KeyW' },
      { kind: 'key', code: 'ArrowUp' },
    ],
    back: [
      { kind: 'key', code: 'KeyS' },
      { kind: 'key', code: 'ArrowDown' },
    ],
    left: [
      { kind: 'key', code: 'KeyA' },
      { kind: 'key', code: 'ArrowLeft' },
    ],
    right: [
      { kind: 'key', code: 'KeyD' },
      { kind: 'key', code: 'ArrowRight' },
    ],
    jump: [
      { kind: 'key', code: 'Space' },
      { kind: 'touch-button', id: 'jump' },
    ],
    interact: [
      { kind: 'key', code: 'KeyE' },
      { kind: 'touch-button', id: 'interact' },
    ],
    sprint: [
      { kind: 'key', code: 'ShiftLeft' },
      { kind: 'touch-hold', id: 'sprint', minMs: 0 },
    ],
    primary: [
      { kind: 'mouse-button', button: 0 },
      { kind: 'touch-button', id: 'primary' },
    ],
  },
  axes: {
    'move.x': [
      { kind: 'key-pair', negative: 'KeyA', positive: 'KeyD' },
      { kind: 'key-pair', negative: 'ArrowLeft', positive: 'ArrowRight' },
      { kind: 'touch-stick', id: 'move', component: 'x' },
    ],
    'move.z': [
      { kind: 'key-pair', negative: 'KeyS', positive: 'KeyW' },
      { kind: 'key-pair', negative: 'ArrowDown', positive: 'ArrowUp' },
      { kind: 'touch-stick', id: 'move', component: 'y' },
    ],
    'look.x': [
      { kind: 'pointer-delta', component: 'dx', scale: 0.0025 },
      { kind: 'touch-drag', id: 'look', component: 'dx', scale: 0.0045 },
    ],
    'look.y': [
      { kind: 'pointer-delta', component: 'dy', scale: 0.0025 },
      { kind: 'touch-drag', id: 'look', component: 'dy', scale: 0.0045 },
    ],
  },
};

export const topdownDefaults: ActionMap = {
  actions: {
    interact: [
      { kind: 'key', code: 'KeyE' },
      { kind: 'key', code: 'Space' },
      { kind: 'touch-button', id: 'interact' },
    ],
    dash: [
      { kind: 'key', code: 'ShiftLeft' },
      { kind: 'touch-button', id: 'dash' },
    ],
    cancel: [{ kind: 'key', code: 'Escape' }],
  },
  axes: {
    'move.x': [
      { kind: 'key-pair', negative: 'KeyA', positive: 'KeyD' },
      { kind: 'key-pair', negative: 'ArrowLeft', positive: 'ArrowRight' },
      { kind: 'touch-stick', id: 'move', component: 'x' },
    ],
    'move.y': [
      { kind: 'key-pair', negative: 'KeyS', positive: 'KeyW' },
      { kind: 'key-pair', negative: 'ArrowDown', positive: 'ArrowUp' },
      { kind: 'touch-stick', id: 'move', component: 'y' },
    ],
  },
};
