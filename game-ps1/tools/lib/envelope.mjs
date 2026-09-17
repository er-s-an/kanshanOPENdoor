/**
 * Engine tool protocol — frozen contract between the CLI entry, lib modules,
 * and (later) Studio/Agent clients. Every command returns this envelope.
 * All lib modules are plain .mjs; engine imports use the TS sources under
 * ../src/creative/ (Node >=24 type-stripping).
 */

/**
 * @typedef {Object} ToolEnvelope
 * @property {boolean} ok            transport+semantic success; failures set ok:false
 * @property {string} requestId
 * @property {unknown} [data]        bounded, versioned payload (see per-command)
 * @property {Array<{code:string,message:string,phase?:string,source?:string}>} [diagnostics]
 * @property {string} toolVersion    PROTOCOL_VERSION
 * @property {string} [experienceDigest]
 * @property {string} [buildId]
 * @property {string} [sessionId]
 * @property {number} [generation]
 */

export const PROTOCOL_VERSION = 'r1.0';

/** Exit codes (aligned with studio legacy CLI): 0 ok, 2 content/params invalid,
 *  3 target missing/unavailable, 4 conflict (stale revision/session), 5 execution failure. */
export const EXIT = { ok: 0, invalid: 2, missing: 3, conflict: 4, failed: 5 };

let counter = 0;
export function requestId() {
  return `req-${Date.now().toString(36)}-${++counter}`;
}

/** @param {Partial<ToolEnvelope> & {ok: boolean}} env */
export function envelope(env) {
  return { toolVersion: PROTOCOL_VERSION, requestId: requestId(), ...env };
}

export function ok(data, extra = {}) {
  return envelope({ ok: true, data, ...extra });
}

export function fail(code, message, extra = {}) {
  return envelope({ ok: false, diagnostics: [{ code, message }], ...extra });
}

/**
 * Map an envelope/error to a process exit code.
 * @param {ToolEnvelope} env
 */
export function exitCode(env) {
  if (env.ok) return EXIT.ok;
  const code = env.diagnostics?.[0]?.code ?? '';
  if (/^(BAD_|INVALID_|MANIFEST_|SCHEMA_)/.test(code)) return EXIT.invalid;
  if (/^(MISSING|NOT_FOUND|SESSION_NOT_READY|NO_SESSION)/.test(code)) return EXIT.missing;
  if (/CONFLICT|STALE|REVISION/.test(code)) return EXIT.conflict;
  return EXIT.failed;
}
