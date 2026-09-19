/**
 * 看山任意门 · head subtitle bubble.
 *
 * A DOM line that floats above 看山's head: a plain div (class `kanshan-say`),
 * textContent-only, projected every tick from his head world position
 * (getWorldPosition -> camera project -> CSS pixels). The bubble is the
 * primary channel for his dialogue; when he is off-camera or farther than
 * MAX_DISTANCE meters the bubble hides and the line falls back to the bottom
 * HUD subtitle so no dialogue is ever lost. When the bubble is visible the
 * HUD stays clear.
 *
 * All DOM work goes through the injected DocumentLike (FakeDocument in
 * tests, BrowserDocumentAdapter in the shell); no layout, no timers — the
 * caller drives tick(dtMs), same discipline as the Hud subtitle queue.
 */
import * as THREE from './three.ts';
import type { DocumentLike, DomElementLike } from '../../../src/creative/ui/dom.ts';
import type { SubtitleLine } from '../../../src/creative/ui/hud.ts';

export const HEAD_SAY_CLASS = 'kanshan-say';
/** Bubble hides beyond this camera distance (m) and the HUD takes over. */
export const HEAD_SAY_MAX_DISTANCE = 9;
/** 看山's head height above his root origin (ear tips sit at ≈1.12). */
const HEAD_OFFSET_Y = 1.24;

interface SayLine {
  text: string;
  remainingMs: number;
}

export interface HeadSayOptions {
  doc: DocumentLike;
  /** Mount point for the bubble (the Hud root / custom container). */
  parent?: DomElementLike;
  /** Bottom subtitle channel used as the off-camera fallback. */
  hudSubtitle: SubtitleLine;
  /** World-space head anchor (root position; the offset is applied here). */
  headPosition: () => THREE.Vector3;
  camera: () => THREE.PerspectiveCamera;
  /** Logical viewport for the CSS projection; pass a getter so orientation
   *  changes / resizes on mobile are picked up on the next tick. */
  viewport?: { width: number; height: number } | (() => { width: number; height: number });
}

export interface HeadSay {
  readonly element: DomElementLike;
  /** Current line, regardless of which channel displays it ('' when idle). */
  text(): string;
  /** True when the bubble (not the HUD fallback) is showing the line. */
  bubbleVisible(): boolean;
  /** Queue a line above his head (or the HUD fallback when off-camera). */
  say(line: string, durationMs?: number): void;
  /** Replace the current line immediately (drop the queue) — modal dialogue. */
  sayNow(line: string, durationMs?: number): void;
  /** Advance timers + re-project. Call once per present tick. */
  tick(dtMs: number): void;
  /** Drop the current line and the whole queue from both channels. */
  clear(): void;
}

export function createHeadSay(options: HeadSayOptions): HeadSay {
  const doc = options.doc;
  const hud = options.hudSubtitle;
  const readViewport = (): { width: number; height: number } => {
    const v = options.viewport;
    if (typeof v === 'function') return v();
    return v ?? { width: 1280, height: 720 };
  };

  const element = doc.createElement('div');
  element.classList.add(HEAD_SAY_CLASS);
  // Full inline styling: the bubble must render correctly even in the
  // standalone export, which ships no page-level CSS for it. showBubble()
  // appends left/top to THIS base — it must never setAttribute('style')
  // from scratch or the base styles are wiped.
  const BASE_STYLE =
    'position:absolute;transform:translate(-50%,-115%);max-width:46ch;padding:6px 12px;' +
    'background:rgba(255,255,255,0.94);color:#1b1b2c;border:1px solid #cfe0fb;border-radius:10px;' +
    'font:14px/1.5 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;white-space:nowrap;' +
    'pointer-events:none;z-index:40;box-shadow:0 2px 10px rgba(20,40,90,0.18);';
  element.setAttribute('style', BASE_STYLE);
  element.hidden = true;
  element.setAttribute('aria-live', 'polite');
  options.parent?.appendChild(element);

  const queue: SayLine[] = [];
  let current: SayLine | null = null;
  let fallbackActive = false;

  const headWorld = new THREE.Vector3();
  const camSpace = new THREE.Vector3();
  const ndc = new THREE.Vector3();

  /** On-camera and within range → bubble eligible; otherwise HUD fallback. */
  const headOnCamera = (): boolean => {
    const camera = options.camera();
    headWorld.copy(options.headPosition());
    headWorld.y += HEAD_OFFSET_Y;
    const dx = headWorld.x - camera.position.x;
    const dy = headWorld.y - camera.position.y;
    const dz = headWorld.z - camera.position.z;
    if (Math.hypot(dx, dy, dz) > HEAD_SAY_MAX_DISTANCE) return false;
    camera.updateMatrixWorld();
    camSpace.copy(headWorld).applyMatrix4(camera.matrixWorldInverse);
    if (camSpace.z >= -0.05) return false; // behind or on the camera plane
    ndc.copy(headWorld).project(camera);
    return Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1 && ndc.z <= 1;
  };

  const showBubble = (line: string): void => {
    const camera = options.camera();
    const viewport = readViewport();
    headWorld.copy(options.headPosition());
    headWorld.y += HEAD_OFFSET_Y;
    camera.updateMatrixWorld();
    ndc.copy(headWorld).project(camera);
    const left = (ndc.x * 0.5 + 0.5) * viewport.width;
    const top = (0.5 - ndc.y * 0.5) * viewport.height;
    element.setAttribute('style', `${BASE_STYLE}left:${left.toFixed(1)}px;top:${top.toFixed(1)}px;`);
    element.textContent = line;
    element.hidden = false;
  };

  const hideBubble = (): void => {
    element.hidden = true;
    element.textContent = '';
  };

  return {
    element,
    text(): string {
      return current?.text ?? '';
    },
    bubbleVisible(): boolean {
      return current !== null && !element.hidden;
    },
    say(line: string, durationMs = 4000): void {
      queue.push({ text: line, remainingMs: durationMs });
    },
    sayNow(line: string, durationMs = 4000): void {
      // Modal dialogue (chat): the answer must land NOW, not behind the
      // still-showing previous line. The tick re-renders either channel.
      queue.length = 0;
      current = { text: line, remainingMs: durationMs };
    },
    tick(dtMs: number): void {
      if (current) {
        current.remainingMs -= dtMs;
        if (current.remainingMs <= 0) {
          current = null;
          if (fallbackActive) {
            hud.dismiss();
            fallbackActive = false;
          }
        }
      }
      if (!current && queue.length > 0) current = queue.shift() ?? null;
      if (!current) {
        hideBubble();
        return;
      }
      if (headOnCamera()) {
        if (fallbackActive) {
          hud.dismiss();
          fallbackActive = false;
        }
        showBubble(current.text);
      } else {
        hideBubble();
        // Self-healing: re-show whenever the HUD is not actually carrying
        // this line (external clear, channel hand-off, first fallback).
        if (!fallbackActive || hud.text !== current.text) {
          hud.show(current.text, { speaker: '看山' });
          fallbackActive = true;
        }
      }
    },
    clear(): void {
      queue.length = 0;
      current = null;
      hideBubble();
      if (fallbackActive) {
        hud.dismiss();
        fallbackActive = false;
      }
    },
  };
}
