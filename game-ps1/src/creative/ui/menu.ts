/**
 * Modal settings menu (S11). While open, the 'modal-ui' focus layer is
 * activated on the injected focus control (a core FocusManager satisfies it
 * structurally); closing releases it so input falls back to 'game'.
 *
 * Settings are DOM-state, observable by others:
 * - textScale: 'small' | 'normal' | 'large' -> mutually exclusive
 *   `ui-text-scale--*` classes on the root element.
 * - reduceMotion: boolean -> `ui-reduce-motion` class on the root plus an
 *   observable flag (getter + onReduceMotionChange) for non-DOM consumers.
 *
 * All labels via textContent. Authors can mount custom elements into `custom`.
 */
import type { FocusLayer } from '../core/input-types.ts';
import type { DocumentLike, DomElementLike } from './dom.ts';

export type TextScale = 'small' | 'normal' | 'large';

export const TEXT_SCALE_ORDER: readonly TextScale[] = ['small', 'normal', 'large'];

export interface SettingsState {
  textScale: TextScale;
  reduceMotion: boolean;
}

/** Structural subset of FocusManager used here; FocusManager satisfies it. */
export interface FocusControl {
  setActive(layer: FocusLayer, active: boolean): void;
  isActive?(layer: FocusLayer): boolean;
}

export interface SettingsMenuOptions {
  focus: FocusControl;
  parent?: DomElementLike;
  initial?: Partial<SettingsState>;
  title?: string;
}

const SCALE_CLASS: Record<TextScale, string> = {
  small: 'ui-text-scale--small',
  normal: 'ui-text-scale--normal',
  large: 'ui-text-scale--large',
};

function scaleLabel(scale: TextScale): string {
  return scale === 'small' ? '小' : scale === 'large' ? '大' : '标准';
}

export class SettingsMenu {
  readonly element: DomElementLike;
  readonly titleEl: DomElementLike;
  readonly scaleButton: DomElementLike;
  readonly motionButton: DomElementLike;
  readonly closeButton: DomElementLike;
  /** Author-mounted custom elements live here. */
  readonly custom: DomElementLike;
  private readonly focus: FocusControl;
  private state: SettingsState;
  private opened = false;
  private readonly listeners = new Set<(settings: SettingsState) => void>();
  private readonly motionListeners = new Set<(on: boolean) => void>();

  constructor(doc: DocumentLike, options: SettingsMenuOptions) {
    this.focus = options.focus;
    const initial = options.initial ?? {};
    this.state = {
      textScale: initial.textScale ?? 'normal',
      reduceMotion: initial.reduceMotion ?? false,
    };

    this.element = doc.createElement('section');
    this.element.classList.add('ui-menu');
    this.element.hidden = true;
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-modal', 'true');

    this.titleEl = doc.createElement('h2');
    this.titleEl.classList.add('ui-menu__title');
    this.titleEl.textContent = options.title ?? '设置';
    this.element.appendChild(this.titleEl);

    this.scaleButton = doc.createElement('button');
    this.scaleButton.setAttribute('type', 'button');
    this.scaleButton.classList.add('ui-menu__scale');
    this.element.appendChild(this.scaleButton);

    this.motionButton = doc.createElement('button');
    this.motionButton.setAttribute('type', 'button');
    this.motionButton.classList.add('ui-menu__motion');
    this.element.appendChild(this.motionButton);

    this.closeButton = doc.createElement('button');
    this.closeButton.setAttribute('type', 'button');
    this.closeButton.classList.add('ui-menu__close');
    this.closeButton.textContent = '关闭';
    this.element.appendChild(this.closeButton);

    this.custom = doc.createElement('div');
    this.custom.classList.add('ui-menu__custom');
    this.element.appendChild(this.custom);

    this.scaleButton.addEventListener('click', () => this.cycleTextScale());
    this.motionButton.addEventListener('click', () => this.setReduceMotion(!this.state.reduceMotion));
    this.closeButton.addEventListener('click', () => this.close());

    this.applyScaleClass();
    this.applyMotionClass();
    this.renderLabels();
    options.parent?.appendChild(this.element);
  }

  get isOpen(): boolean {
    return this.opened;
  }

  get settings(): SettingsState {
    return { ...this.state };
  }

  get textScale(): TextScale {
    return this.state.textScale;
  }

  /** Observable flag non-DOM consumers can poll; see also onReduceMotionChange. */
  get reduceMotion(): boolean {
    return this.state.reduceMotion;
  }

  open(): void {
    if (this.opened) return;
    this.opened = true;
    this.element.hidden = false;
    this.focus.setActive('modal-ui', true);
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.element.hidden = true;
    this.focus.setActive('modal-ui', false);
  }

  toggle(): void {
    if (this.opened) this.close();
    else this.open();
  }

  setTextScale(scale: TextScale): void {
    if (this.state.textScale === scale) {
      this.renderLabels();
      return;
    }
    this.state.textScale = scale;
    this.applyScaleClass();
    this.renderLabels();
    this.notify();
  }

  /** small -> normal -> large -> small; returns the new scale. */
  cycleTextScale(): TextScale {
    const index = TEXT_SCALE_ORDER.indexOf(this.state.textScale);
    const next = TEXT_SCALE_ORDER[(index + 1) % TEXT_SCALE_ORDER.length];
    this.setTextScale(next);
    return next;
  }

  setReduceMotion(on: boolean): void {
    if (this.state.reduceMotion === on) {
      this.renderLabels();
      return;
    }
    this.state.reduceMotion = on;
    this.applyMotionClass();
    this.renderLabels();
    for (const listener of [...this.motionListeners]) listener(on);
    this.notify();
  }

  /** Subscribe to any settings change; returns an unsubscribe function. */
  onChange(listener: (settings: SettingsState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Subscribe to reduce-motion toggles specifically. */
  onReduceMotionChange(listener: (on: boolean) => void): () => void {
    this.motionListeners.add(listener);
    return () => this.motionListeners.delete(listener);
  }

  private applyScaleClass(): void {
    for (const scale of TEXT_SCALE_ORDER) this.element.classList.remove(SCALE_CLASS[scale]);
    this.element.classList.add(SCALE_CLASS[this.state.textScale]);
  }

  private applyMotionClass(): void {
    if (this.state.reduceMotion) this.element.classList.add('ui-reduce-motion');
    else this.element.classList.remove('ui-reduce-motion');
  }

  private renderLabels(): void {
    this.scaleButton.textContent = `文字大小：${scaleLabel(this.state.textScale)}`;
    this.motionButton.textContent = `减少动态效果：${this.state.reduceMotion ? '开' : '关'}`;
  }

  private notify(): void {
    const snapshot = this.settings;
    for (const listener of [...this.listeners]) listener(snapshot);
  }
}
