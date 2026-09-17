/**
 * FakeDocument: an in-memory DocumentLike for headless tests. Elements store
 * textContent/attributes/classList/hidden directly, support listener-based
 * `click()`, and track parent/child links so tests can assert structure.
 * No layout, no styles, no events beyond what is explicitly dispatched.
 */
import type { DocumentLike, DomClassList, DomElementLike } from './dom.ts';

export class FakeClassList implements DomClassList {
  private readonly tokens = new Set<string>();

  add(...tokens: string[]): void {
    for (const token of tokens) this.tokens.add(token);
  }

  remove(...tokens: string[]): void {
    for (const token of tokens) this.tokens.delete(token);
  }

  contains(token: string): boolean {
    return this.tokens.has(token);
  }

  get size(): number {
    return this.tokens.size;
  }

  toArray(): string[] {
    return [...this.tokens];
  }
}

export class FakeElement implements DomElementLike {
  readonly tagName: string;
  textContent = '';
  hidden = false;
  readonly classList = new FakeClassList();
  parent: FakeElement | null = null;
  readonly children: FakeElement[] = [];
  private readonly attributes = new Map<string, string>();
  private readonly listeners = new Map<string, ((event: unknown) => void)[]>();

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  appendChild(child: FakeElement): void {
    child.remove();
    child.parent = this;
    this.children.push(child);
  }

  remove(): void {
    if (!this.parent) return;
    const index = this.parent.children.indexOf(this);
    if (index >= 0) this.parent.children.splice(index, 1);
    this.parent = null;
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  click(): void {
    for (const listener of [...(this.listeners.get('click') ?? [])]) listener({ type: 'click', target: this });
  }

  /** Depth-first search by class token; handy for structural assertions. */
  queryByClass(token: string): FakeElement | null {
    if (this.classList.contains(token)) return this;
    for (const child of this.children) {
      const found = child.queryByClass(token);
      if (found) return found;
    }
    return null;
  }

  /** Depth-first search by tag name. */
  queryByTag(tag: string): FakeElement | null {
    if (this.tagName === tag.toUpperCase()) return this;
    for (const child of this.children) {
      const found = child.queryByTag(tag);
      if (found) return found;
    }
    return null;
  }

  /** All descendant textContent, DFS order (for "no markup leaked" checks). */
  collectText(): string[] {
    const out: string[] = [];
    const walk = (el: FakeElement): void => {
      if (el.textContent.length > 0) out.push(el.textContent);
      for (const child of el.children) walk(child);
    };
    walk(this);
    return out;
  }
}

export class FakeDocument implements DocumentLike {
  readonly root = new FakeElement('#document');

  createElement(tag: string): FakeElement {
    return new FakeElement(tag);
  }
}
