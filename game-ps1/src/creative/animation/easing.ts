/**
 * Easing functions shared by tweens, camera blends and any other
 * normalized-progress interpolation. A tween/camera step stores a plain
 * function of t in [0,1]; authors may pass their own or pick one by name.
 */
import { CreativeError } from '../core/errors.ts';

export type EasingFn = (t: number) => number;

export const linear: EasingFn = (t) => t;
export const easeInOut: EasingFn = (t) => t * t * (3 - 2 * t);
export const easeIn: EasingFn = (t) => t * t * t;
export const easeOut: EasingFn = (t) => 1 - Math.pow(1 - t, 3);
/** Holds the start value, then snaps to the end value exactly at t = 1. */
export const step: EasingFn = (t) => (t >= 1 ? 1 : 0);

export const EASINGS = { linear, easeInOut, easeIn, easeOut, step } as const;
export type EasingName = keyof typeof EASINGS;

/** Accepts a custom function or one of the named easings; default linear. */
export function asEasing(easing?: EasingFn | EasingName): EasingFn {
  if (easing === undefined || easing === null) return linear;
  if (typeof easing === 'function') return easing;
  const fn = EASINGS[easing];
  if (!fn) {
    throw new CreativeError('BAD_EASING', `unknown easing "${String(easing)}"`, { phase: 'create' });
  }
  return fn;
}
