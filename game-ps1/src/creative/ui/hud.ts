/**
 * DOM HUD toolkit (S11): subtitle/caption line with an explicit FIFO queue
 * and an interaction prompt. All text via textContent; no layout, no timers
 * unless the caller drives tick(dtMs) with declared durations.
 *
 * Queue model (deterministic, caller-driven):
 * - show(text): display now, replacing the current line.
 * - queue(text): display now if idle, else append to the FIFO.
 * - dismiss(): hide the current line and promote the next queued one.
 * - clear(): hide the current line and drop the whole queue.
 * - tick(dtMs): auto-dismiss lines shown with durationMs.
 */
import type { DocumentLike, DomElementLike } from './dom.ts';

export interface SubtitleOptions {
  speaker?: string;
  /** Auto-dismiss after this many ms via tick(); omit for manual dismiss. */
  durationMs?: number;
}

interface QueuedLine {
  text: string;
  speaker: string | undefined;
  remainingMs: number | undefined;
}

export class SubtitleLine {
  readonly element: DomElementLike;
  private readonly speakerEl: DomElementLike;
  private readonly textEl: DomElementLike;
  private current: QueuedLine | null = null;
  private readonly queue: QueuedLine[] = [];

  constructor(doc: DocumentLike, parent?: DomElementLike) {
    this.element = doc.createElement('div');
    this.element.classList.add('ui-subtitle');
    this.element.hidden = true;
    this.element.setAttribute('aria-live', 'polite');
    this.speakerEl = doc.createElement('span');
    this.speakerEl.classList.add('ui-subtitle__speaker');
    this.textEl = doc.createElement('span');
    this.textEl.classList.add('ui-subtitle__text');
    this.element.appendChild(this.speakerEl);
    this.element.appendChild(this.textEl);
    parent?.appendChild(this.element);
  }

  get visible(): boolean {
    return !this.element.hidden;
  }

  get text(): string {
    return this.current?.text ?? '';
  }

  get speaker(): string | undefined {
    return this.current?.speaker;
  }

  get queueLength(): number {
    return this.queue.length;
  }

  show(text: string, options: SubtitleOptions = {}): void {
    this.current = { text, speaker: options.speaker, remainingMs: options.durationMs };
    this.render();
  }

  queueLine(text: string, options: SubtitleOptions = {}): void {
    const line: QueuedLine = { text, speaker: options.speaker, remainingMs: options.durationMs };
    if (!this.current) {
      this.current = line;
      this.render();
    } else {
      this.queue.push(line);
    }
  }

  /** Hide the current line; promote the next queued line if any. */
  dismiss(): void {
    this.current = this.queue.shift() ?? null;
    this.render();
  }

  /** Hide everything and drop pending lines. */
  clear(): void {
    this.current = null;
    this.queue.length = 0;
    this.render();
  }

  /** Advance auto-dismiss timers; only lines with durationMs are affected. */
  tick(dtMs: number): void {
    if (!this.current) return;
    if (this.current.remainingMs === undefined) return;
    this.current.remainingMs -= dtMs;
    if (this.current.remainingMs <= 0) this.dismiss();
  }

  private render(): void {
    if (!this.current) {
      this.element.hidden = true;
      this.speakerEl.textContent = '';
      this.textEl.textContent = '';
      return;
    }
    this.element.hidden = false;
    this.speakerEl.textContent = this.current.speaker ?? '';
    this.textEl.textContent = this.current.text;
  }
}

/** Single interaction prompt line ("按 E 互动"); visibility is the state. */
export class InteractionPrompt {
  readonly element: DomElementLike;
  private readonly labelEl: DomElementLike;

  constructor(doc: DocumentLike, parent?: DomElementLike) {
    this.element = doc.createElement('div');
    this.element.classList.add('ui-prompt');
    this.element.hidden = true;
    this.labelEl = doc.createElement('span');
    this.labelEl.classList.add('ui-prompt__label');
    this.element.appendChild(this.labelEl);
    parent?.appendChild(this.element);
  }

  get visible(): boolean {
    return !this.element.hidden;
  }

  get label(): string {
    return this.labelEl.textContent;
  }

  show(label: string): void {
    this.labelEl.textContent = label;
    this.element.hidden = false;
  }

  hide(): void {
    this.element.hidden = true;
    this.labelEl.textContent = '';
  }
}

/**
 * Facade bundling subtitle + prompt under one root, with a dedicated
 * container where authors can mount their own custom DOM elements.
 */
export class Hud {
  readonly element: DomElementLike;
  readonly subtitle: SubtitleLine;
  readonly prompt: InteractionPrompt;
  /** Author-mounted custom elements live here. */
  readonly custom: DomElementLike;

  constructor(doc: DocumentLike, parent?: DomElementLike) {
    this.element = doc.createElement('section');
    this.element.classList.add('ui-hud');
    this.element.setAttribute('aria-label', 'game hud');
    this.subtitle = new SubtitleLine(doc, this.element);
    this.prompt = new InteractionPrompt(doc, this.element);
    this.custom = doc.createElement('div');
    this.custom.classList.add('ui-hud__custom');
    this.element.appendChild(this.custom);
    parent?.appendChild(this.element);
  }
}
