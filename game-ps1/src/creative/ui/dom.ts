/**
 * Minimal injectable document for the DOM UI toolkit (S11).
 *
 * Components only touch this structural subset:
 * - headless tests run everything on FakeDocument (see ./fakedom.ts);
 * - browsers run through BrowserDocumentAdapter over the real Document.
 *
 * All author-facing text enters elements via `textContent` — never
 * innerHTML — so the components are XSS-safe by construction. There is
 * deliberately no innerHTML anywhere in this interface.
 */

export interface DomClassList {
  add(...tokens: string[]): void;
  remove(...tokens: string[]): void;
  contains(token: string): boolean;
}

export interface DomElementLike {
  readonly tagName: string;
  textContent: string;
  hidden: boolean;
  readonly classList: DomClassList;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  appendChild(child: DomElementLike): void;
  remove(): void;
  addEventListener(type: string, listener: (event: unknown) => void): void;
  /** Invoke click listeners (real HTMLElement exposes this natively). */
  click?(): void;
}

export interface DocumentLike {
  createElement(tag: string): DomElementLike;
}

/** Adapter over a real browser `document`. Elements pass through untouched. */
export class BrowserDocumentAdapter implements DocumentLike {
  private readonly doc: Document;

  constructor(doc: Document = globalThis.document) {
    this.doc = doc;
  }

  createElement(tag: string): DomElementLike {
    return this.doc.createElement(tag) as unknown as DomElementLike;
  }
}

/** Convenience for the common "pass the real document if we have one" case. */
export function defaultDocument(): DocumentLike {
  if (typeof globalThis.document !== 'undefined') return new BrowserDocumentAdapter(globalThis.document);
  throw new Error('no global document; construct a BrowserDocumentAdapter or use FakeDocument');
}
