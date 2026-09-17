/**
 * 看山任意门 · portal message protocol — pure codec, no DOM.
 *
 * Work (iframe) → host messages all carry source 'kanshan-work' and one of the
 * known types below. The host only acts on a message after
 * isTrustedWorkMessage() enforces strict origin equality on top of the shape
 * checks in isWorkMessage(); anything else (null, garbage, a foreign source,
 * an unknown type) is rejected before it can drive the return flow.
 *
 * Host → work is a single courtesy message ('request-exit') the host posts
 * before a hard return so protocol-aware works can flush state; works opt in
 * by listening, and may also initiate the return themselves by posting
 * 'completed' (with an optional structured-cloneable detail) or 'exited'.
 *
 * Shared by the portal host page and (later) by works that opt into the
 * protocol; keep this module dependency-free.
 */

export const PORTAL_MESSAGE_SOURCE = 'kanshan-work';
export const PORTAL_HOST_SOURCE = 'kanshan-host';

export type WorkToHost =
  | { readonly source: typeof PORTAL_MESSAGE_SOURCE; readonly type: 'ready' }
  | { readonly source: typeof PORTAL_MESSAGE_SOURCE; readonly type: 'completed'; readonly detail?: unknown }
  | { readonly source: typeof PORTAL_MESSAGE_SOURCE; readonly type: 'exited' };

export type WorkMessageType = WorkToHost['type'];

export interface HostToWork {
  readonly source: typeof PORTAL_HOST_SOURCE;
  readonly type: 'request-exit';
}

export function encodeWorkMessage(type: 'ready' | 'exited'): WorkToHost;
export function encodeWorkMessage(type: 'completed', detail?: unknown): WorkToHost;
export function encodeWorkMessage(type: WorkMessageType, detail?: unknown): WorkToHost {
  if (type === 'completed') {
    return detail === undefined
      ? { source: PORTAL_MESSAGE_SOURCE, type: 'completed' }
      : { source: PORTAL_MESSAGE_SOURCE, type: 'completed', detail };
  }
  return { source: PORTAL_MESSAGE_SOURCE, type };
}

export function encodeHostMessage(type: 'request-exit'): HostToWork {
  return { source: PORTAL_HOST_SOURCE, type };
}

export function isWorkMessage(data: unknown): data is WorkToHost {
  if (typeof data !== 'object' || data === null) return false;
  const candidate = data as { source?: unknown; type?: unknown };
  if (candidate.source !== PORTAL_MESSAGE_SOURCE) return false;
  return candidate.type === 'ready' || candidate.type === 'completed' || candidate.type === 'exited';
}

export function isTrustedWorkMessage(event: { origin: string; data: unknown }, expectedOrigin: string): boolean {
  return event.origin === expectedOrigin && isWorkMessage(event.data);
}
