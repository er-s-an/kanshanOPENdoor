/**
 * 看山任意门 · touch controls overlay (手机触屏操控层).
 *
 * What desktop does with WASD + pointer-lock mouse + E/Space/Esc, touch does
 * with: a bottom-left virtual joystick ('move' stick), a right-half
 * drag-to-look area ('look' drag), and round buttons for jump / interact /
 * skip-intro. The overlay is pure DOM + inline styles (same discipline as
 * chatbox.ts / headsay.ts: textContent only, no markup, no timers) and holds
 * NO input state — the elements are registered with DomInputDevice's
 * touchSticks / touchDragAreas / touchButtons maps, so every gesture enters
 * the same RawInputFrame -> ActionMapper path as keyboard and mouse.
 *
 * The overlay starts hidden; the scene reveals it when a coarse pointer is
 * detected or on the first touchstart (hybrid laptops). Hidden means
 * `hidden` on the root: elements keep working for the device, nothing is
 * painted.
 *
 * Stacking: root z-index 10 — above the canvas, below the modal chat card
 * (z-20) and far below the portal iframe (z-30) that covers everything when
 * a world runs. The HUD prompt/subtitle stay unpositioned (page CSS owns
 * them); nothing here overlaps their hit area.
 *
 * Layout invariant: the interact button sits on the BOTTOM ROW (left of
 * jump), never under the chat card (bottom:110px+). A tap that opens the
 * chat is followed by the browser's synthetic click at the same spot — if
 * the freshly-opened card covered that spot, the click would land on an
 * option row and instantly close the dialogue (observed on real touch
 * emulation). The bottom row stays below the card's lower edge, so the
 * ghost click always lands on empty canvas.
 */
import type { DocumentLike, DomElementLike } from '../../../src/creative/ui/dom.ts';

export const TOUCH_ROOT_CLASS = 'kanshan-touch';
export const TOUCH_STICK_CLASS = 'kanshan-touch__stick';
export const TOUCH_KNOB_CLASS = 'kanshan-touch__knob';
export const TOUCH_LOOK_CLASS = 'kanshan-touch__look';
export const TOUCH_JUMP_CLASS = 'kanshan-touch__btn-jump';
export const TOUCH_INTERACT_CLASS = 'kanshan-touch__btn-interact';
export const TOUCH_SKIP_CLASS = 'kanshan-touch__btn-skip';
export const TOUCH_LOOK_HINT_CLASS = 'kanshan-touch__look-hint';

/** Stick knob travel at full deflection (px from base center). */
export const TOUCH_KNOB_TRAVEL_PX = 36;

const ROOT_STYLE = 'position:fixed;inset:0;pointer-events:none;z-index:10;touch-action:none;';
const STICK_STYLE =
  'position:absolute;left:20px;bottom:20px;width:124px;height:124px;border-radius:50%;' +
  'background:rgba(255,255,255,0.38);border:2px solid rgba(0,102,255,0.45);' +
  'box-shadow:0 2px 12px rgba(20,40,90,0.12);pointer-events:auto;touch-action:none;';
const KNOB_STYLE_BASE =
  'position:absolute;left:50%;top:50%;width:52px;height:52px;border-radius:50%;' +
  'background:rgba(0,102,255,0.55);border:1px solid rgba(255,255,255,0.7);pointer-events:none;';
const LOOK_STYLE =
  'position:absolute;right:0;top:0;width:55%;height:100%;pointer-events:auto;touch-action:none;';
const LOOK_HINT_STYLE =
  'position:absolute;right:24px;bottom:112px;color:rgba(23,50,94,0.55);font-size:12px;' +
  'letter-spacing:0.05em;pointer-events:none;';
const BUTTON_STYLE =
  'position:absolute;width:64px;height:64px;border-radius:50%;' +
  'background:rgba(255,255,255,0.88);border:2px solid #0066ff;color:#0066ff;' +
  'font-size:15px;line-height:64px;text-align:center;user-select:none;-webkit-user-select:none;' +
  '-webkit-tap-highlight-color:transparent;box-shadow:0 2px 10px rgba(20,40,90,0.16);' +
  'pointer-events:auto;touch-action:none;';
const SKIP_STYLE =
  'position:absolute;top:16px;right:16px;padding:10px 18px;border-radius:22px;' +
  'background:rgba(255,255,255,0.88);border:2px solid #0066ff;color:#0066ff;' +
  'font-size:14px;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;' +
  'box-shadow:0 2px 10px rgba(20,40,90,0.16);pointer-events:auto;touch-action:none;';

export interface TouchControls {
  readonly root: DomElementLike;
  /** Joystick base — registered as the 'move' touch stick. */
  readonly stickBase: DomElementLike;
  /** Right-half drag area — registered as the 'look' touch-drag area. */
  readonly lookArea: DomElementLike;
  /** Round buttons — registered as same-named touch buttons. */
  readonly jumpButton: DomElementLike;
  readonly interactButton: DomElementLike;
  readonly skipButton: DomElementLike;
  /** True once the overlay has been revealed for this session. */
  revealed(): boolean;
  /** Show the overlay (idempotent). */
  reveal(): void;
  /** Move the joystick knob to the resolved move axes (call per present). */
  setKnob(x: number, y: number): void;
  /** The 「和刘看山聊聊」 button appears only when chat is offered. */
  setInteractVisible(visible: boolean): void;
  /** The 「跳过」 button appears only while the intro plays. */
  setSkipVisible(visible: boolean): void;
  /** Drag-to-look hint; hidden for good after the first look drag. */
  setLookHintVisible(visible: boolean): void;
  /** Look-hint visibility (tests). */
  lookHintVisible(): boolean;
}

export function createTouchControls(options: { doc: DocumentLike; parent?: DomElementLike }): TouchControls {
  const doc = options.doc;

  const root = doc.createElement('div');
  root.classList.add(TOUCH_ROOT_CLASS);
  root.setAttribute('style', ROOT_STYLE);
  root.hidden = true;

  const lookArea = doc.createElement('div');
  lookArea.classList.add(TOUCH_LOOK_CLASS);
  lookArea.setAttribute('style', LOOK_STYLE);
  lookArea.setAttribute('aria-label', '拖动转动视角');

  const lookHint = doc.createElement('div');
  lookHint.classList.add(TOUCH_LOOK_HINT_CLASS);
  lookHint.setAttribute('style', LOOK_HINT_STYLE);
  lookHint.textContent = '滑动右侧转视角';

  const stickBase = doc.createElement('div');
  stickBase.classList.add(TOUCH_STICK_CLASS);
  stickBase.setAttribute('style', STICK_STYLE);
  stickBase.setAttribute('aria-label', '移动摇杆');
  const knob = doc.createElement('div');
  knob.classList.add(TOUCH_KNOB_CLASS);
  knob.setAttribute('style', `${KNOB_STYLE_BASE}transform:translate(-50%,-50%);`);
  stickBase.appendChild(knob);

  const jumpButton = doc.createElement('div');
  jumpButton.classList.add(TOUCH_JUMP_CLASS);
  jumpButton.setAttribute('style', `${BUTTON_STYLE}right:24px;bottom:24px;`);
  jumpButton.setAttribute('role', 'button');
  jumpButton.setAttribute('aria-label', '跳跃');
  jumpButton.textContent = '跳';

  const interactButton = doc.createElement('div');
  interactButton.classList.add(TOUCH_INTERACT_CLASS);
  // Bottom row, left of jump: MUST stay below the chat card's bottom edge
  // (bottom:110px) — see the layout invariant in the module header.
  interactButton.setAttribute('style', `${BUTTON_STYLE}right:104px;bottom:24px;`);
  interactButton.setAttribute('role', 'button');
  interactButton.setAttribute('aria-label', '和刘看山聊聊');
  interactButton.textContent = '聊聊';
  interactButton.hidden = true;

  const skipButton = doc.createElement('div');
  skipButton.classList.add(TOUCH_SKIP_CLASS);
  skipButton.setAttribute('style', SKIP_STYLE);
  skipButton.setAttribute('role', 'button');
  skipButton.setAttribute('aria-label', '跳过开场');
  skipButton.textContent = '跳过 ▸';
  skipButton.hidden = true;

  root.appendChild(lookArea);
  root.appendChild(lookHint);
  root.appendChild(stickBase);
  root.appendChild(jumpButton);
  root.appendChild(interactButton);
  root.appendChild(skipButton);
  options.parent?.appendChild(root);

  let isRevealed = false;

  return {
    root,
    stickBase,
    lookArea,
    jumpButton,
    interactButton,
    skipButton,
    revealed(): boolean {
      return isRevealed;
    },
    reveal(): void {
      isRevealed = true;
      root.hidden = false;
    },
    setKnob(x: number, y: number): void {
      const kx = (Math.max(-1, Math.min(1, x)) * TOUCH_KNOB_TRAVEL_PX).toFixed(1);
      const ky = (-Math.max(-1, Math.min(1, y)) * TOUCH_KNOB_TRAVEL_PX).toFixed(1);
      knob.setAttribute('style', `${KNOB_STYLE_BASE}transform:translate(-50%,-50%) translate(${kx}px, ${ky}px);`);
    },
    setInteractVisible(visible: boolean): void {
      interactButton.hidden = !visible;
    },
    setSkipVisible(visible: boolean): void {
      skipButton.hidden = !visible;
    },
    setLookHintVisible(visible: boolean): void {
      lookHint.hidden = !visible;
    },
    lookHintVisible(): boolean {
      return !lookHint.hidden;
    },
  };
}
