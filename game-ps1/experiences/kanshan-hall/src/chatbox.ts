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
  'max-width:540px;background:#ffffff;color:#17325e;border:1px solid #b9d2f2;border-radius:12px;' +
  'box-shadow:0 6px 24px rgba(23,64,120,0.18);padding:12px 16px;z-index:20;';
const SPEAKER_STYLE = 'font-size:12px;color:#0066ff;letter-spacing:0.08em;margin-bottom:4px;';
const LINE_STYLE = 'font-size:15px;line-height:1.5;margin-bottom:8px;';
const OPTION_STYLE = 'font-size:14px;line-height:1.7;color:#24406e;';

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

export function createChatBox(options: { doc: DocumentLike; parent?: DomElementLike }): ChatBox {
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
  element.appendChild(speaker);
  element.appendChild(line);
  element.appendChild(optionsEl);
  options.parent?.appendChild(element);

  let currentLine = '';
  const rows: DomElementLike[] = [];
  const renderOptions = (labels: readonly string[]): void => {
    for (const row of rows) row.remove();
    rows.length = 0;
    for (const label of labels) {
      const row = doc.createElement('div');
      row.classList.add('kanshan-chat__option');
      row.setAttribute('style', OPTION_STYLE);
      row.textContent = label;
      optionsEl.appendChild(row);
      rows.push(row);
    }
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
