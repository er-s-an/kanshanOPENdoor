/**
 * 看山任意门 · modal dialogue box (和刘看山聊天).
 *
 * A bottom-center white card, consistent with the blue-white hall and the
 * kanshan-say head bubble: a speaker row (看山), his line, and the numbered
 * option rows (「1 这是哪儿？」). All content goes through textContent — never
 * markup — and all styling is a single inline style attribute, so the box
 * works identically over the injected DocumentLike (FakeDocument headless,
 * BrowserDocumentAdapter in the shell). No timers: the caller opens, updates
 * the line, and closes.
 */
import type { DocumentLike, DomElementLike } from '../../../src/creative/ui/dom.ts';

export const CHAT_BOX_CLASS = 'kanshan-chat';

const CARD_STYLE =
  'position:absolute;left:50%;transform:translateX(-50%);bottom:110px;min-width:300px;' +
  'max-width:min(540px,calc(100vw - 32px));background:#ffffff;color:#17325e;border:1px solid #b9d2f2;border-radius:12px;' +
  'box-shadow:0 6px 24px rgba(23,64,120,0.18);padding:12px 16px;z-index:20;';
const SPEAKER_STYLE = 'font-size:12px;color:#0066ff;letter-spacing:0.08em;margin-bottom:4px;';
const LINE_STYLE = 'font-size:15px;line-height:1.5;margin-bottom:8px;';
// Option rows are tappable on touch screens: fat-finger padding + a hairline
// separator + pointer cursor; the number prefix still matches the keyboard.
const OPTION_STYLE =
  'font-size:14px;line-height:1.7;color:#24406e;padding:8px 4px;border-top:1px solid #e6eefb;' +
  'cursor:pointer;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;';
const CLOSE_STYLE =
  'position:absolute;top:6px;right:10px;width:28px;height:28px;line-height:28px;text-align:center;' +
  'font-size:14px;color:#6b86ad;cursor:pointer;user-select:none;-webkit-user-select:none;' +
  '-webkit-tap-highlight-color:transparent;';

export interface ChatBoxOptions {
  doc: DocumentLike;
  parent?: DomElementLike;
  /** Tapped/clicked an option row (0-based, same order as open() labels). */
  onOption?: (index: number) => void;
  /** Tapped/clicked the ✕ close affordance (touch screens have no Esc). */
  onClose?: () => void;
}

export interface ChatBox {
  readonly element: DomElementLike;
  get visible(): boolean;
  /** His current line (what the line row shows). */
  lineText(): string;
  /** Show the card with a line and numbered option rows. */
  open(line: string, options: readonly string[]): void;
  /** Swap the line (an answer replaced the root question). */
  setLine(line: string): void;
  /** Hide the card and clear line + options. */
  close(): void;
}

export function createChatBox(options: ChatBoxOptions): ChatBox {
  const doc = options.doc;

  const element = doc.createElement('div');
  element.classList.add(CHAT_BOX_CLASS);
  element.setAttribute('style', CARD_STYLE);
  element.hidden = true;

  const speaker = doc.createElement('div');
  speaker.classList.add('kanshan-chat__speaker');
  speaker.setAttribute('style', SPEAKER_STYLE);
  speaker.textContent = '看山';
  const line = doc.createElement('div');
  line.classList.add('kanshan-chat__line');
  line.setAttribute('style', LINE_STYLE);
  const optionsEl = doc.createElement('div');
  optionsEl.classList.add('kanshan-chat__options');
  const closeButton = doc.createElement('div');
  closeButton.classList.add('kanshan-chat__close');
  closeButton.setAttribute('style', CLOSE_STYLE);
  closeButton.setAttribute('role', 'button');
  closeButton.setAttribute('aria-label', '关闭对话');
  closeButton.textContent = '✕';
  closeButton.addEventListener('click', () => options.onClose?.());
  element.appendChild(closeButton);
  element.appendChild(speaker);
  element.appendChild(line);
  element.appendChild(optionsEl);
  options.parent?.appendChild(element);

  let currentLine = '';
  const rows: DomElementLike[] = [];
  const renderOptions = (labels: readonly string[]): void => {
    for (const row of rows) row.remove();
    rows.length = 0;
    labels.forEach((label, index) => {
      const row = doc.createElement('div');
      row.classList.add('kanshan-chat__option');
      row.setAttribute('style', OPTION_STYLE);
      row.setAttribute('role', 'button');
      row.textContent = label;
      row.addEventListener('click', () => options.onOption?.(index));
      optionsEl.appendChild(row);
      rows.push(row);
    });
  };

  return {
    element,
    get visible(): boolean {
      return !element.hidden;
    },
    lineText(): string {
      return currentLine;
    },
    open(lineText: string, labels: readonly string[]): void {
      currentLine = lineText;
      line.textContent = lineText;
      renderOptions(labels);
      element.hidden = false;
    },
    setLine(lineText: string): void {
      currentLine = lineText;
      line.textContent = lineText;
    },
    close(): void {
      element.hidden = true;
      currentLine = '';
      line.textContent = '';
      renderOptions([]);
    },
  };
}
