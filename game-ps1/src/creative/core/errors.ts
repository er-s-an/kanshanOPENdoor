/**
 * Core error types for the creative runtime.
 * Every failure raised inside a host-managed phase carries its phase and an
 * optional source location so diagnostics can point back to module code.
 */

export type Phase =
  | 'create'
  | 'activate'
  | 'input'
  | 'intent'
  | 'physics'
  | 'mechanics'
  | 'present'
  | 'render'
  | 'commit'
  | 'deactivate'
  | 'destroy'
  | 'command'
  | 'query';

export const PHASE_ORDER = ['input', 'intent', 'physics', 'mechanics', 'present'] as const;
export type SimPhase = (typeof PHASE_ORDER)[number];

export interface Diagnostic {
  code: string;
  message: string;
  phase?: Phase;
  source?: string;
  tick?: number;
  sessionId?: string;
}

export class CreativeError extends Error {
  readonly code: string;
  readonly phase: Phase | undefined;
  readonly source: string | undefined;

  constructor(
    code: string,
    message: string,
    opts?: { phase?: Phase; source?: string; cause?: unknown },
  ) {
    super(message, opts?.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = 'CreativeError';
    this.code = code;
    this.phase = opts?.phase;
    this.source = opts?.source;
  }

  toDiagnostic(tick?: number, sessionId?: string): Diagnostic {
    return {
      code: this.code,
      message: this.message,
      phase: this.phase,
      source: this.source,
      tick,
      sessionId,
    };
  }
}

export function asDiagnostic(err: unknown, phase: Phase, tick?: number, sessionId?: string): Diagnostic {
  if (err instanceof CreativeError) return err.toDiagnostic(tick, sessionId);
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  return { code: 'UNEXPECTED', message, phase, source: firstUserFrame(stack), tick, sessionId };
}

/** Best-effort extraction of the first non-runtime stack frame (file:line). */
export function firstUserFrame(stack: string | undefined): string | undefined {
  if (!stack) return undefined;
  for (const line of stack.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('at ')) continue;
    if (trimmed.includes('node_modules') || trimmed.includes('node:internal')) continue;
    if (trimmed.includes('/creative/core/')) continue;
    const m = trimmed.match(/(\S+\.\w+:\d+(?::\d+)?)/);
    if (m) return m[1];
  }
  return undefined;
}
