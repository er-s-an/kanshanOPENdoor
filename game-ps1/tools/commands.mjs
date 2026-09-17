/**
 * engine-cli command table (frozen for R1). Each command maps to a lib module
 * function. lib modules are implemented independently; this table is the
 * shared seam. Commands marked [session] require --session <id> and talk to a
 * live session daemon; others run in-process.
 *
 * capabilities
 *   -> caps.capabilities() : { systems, operations, limits, evidenceLevels }
 * session start --experience <dir> [--mode controlled|auto] [--slot <id>]
 *   -> session.start(opts) : { handle, tick, stateDir }
 * session status|pause|resume|stop --session <id>
 *   -> session.status/pause/resume/stop({ sessionId })
 * session step --session <id> --steps N
 *   -> session.step({ sessionId, steps })
 * query scene|object|commits --session <id> [--handle h] [--limit n]
 *   -> session.query({ sessionId, kind, handle, limit })
 * input inject --session <id> --events <json-array>
 * input replay --session <id> --trace <file>  (replays a recorded public-input trace)
 *   -> session.inject({ sessionId, events }) / session.replay({ sessionId, tracePath })
 * trace start --session <id> --out <file> ; trace stop --session <id>
 *   -> session.traceStart/traceStop
 * observe metrics|logs --session <id>
 *   -> session.observe({ sessionId, kind })
 * author parameters list --experience <dir>
 * author patch --experience <dir> --set <authorId=value>... --base-revision <id> --command-id <id>
 * author undo|redo --experience <dir> --command-id <id>
 *   -> author.list/patch/undo/redo (see author.mjs)
 * build --experience <dir> [--out <dir>]
 *   -> build.build({ experienceDir, outDir }) : { buildId, digests, files }
 * export --experience <dir> --out <dir>
 *   -> build.exportBundle({ experienceDir, outDir }) : private static bundle
 *
 * Every [session] result carries sessionId/generation/tick. Handles from a
 * stopped session are rejected by the daemon (generation fencing in core).
 */
export const COMMANDS = {
  capabilities: { module: 'caps.mjs', fn: 'capabilities' },
  'session start': { module: 'session.mjs', fn: 'start' },
  'session status': { module: 'session.mjs', fn: 'status' },
  'session pause': { module: 'session.mjs', fn: 'pause' },
  'session resume': { module: 'session.mjs', fn: 'resume' },
  'session step': { module: 'session.mjs', fn: 'step' },
  'session stop': { module: 'session.mjs', fn: 'stop' },
  'query scene': { module: 'session.mjs', fn: 'query', kind: 'scene' },
  'query object': { module: 'session.mjs', fn: 'query', kind: 'object' },
  'query commits': { module: 'session.mjs', fn: 'query', kind: 'commits' },
  'query physics': { module: 'session.mjs', fn: 'query', kind: 'physics' },
  'input inject': { module: 'session.mjs', fn: 'inject' },
  'input replay': { module: 'session.mjs', fn: 'replay' },
  'trace start': { module: 'session.mjs', fn: 'traceStart' },
  'trace stop': { module: 'session.mjs', fn: 'traceStop' },
  'observe metrics': { module: 'session.mjs', fn: 'observe', kind: 'metrics' },
  'observe logs': { module: 'session.mjs', fn: 'observe', kind: 'logs' },
  'author parameters list': { module: 'author.mjs', fn: 'list' },
  'author patch': { module: 'author.mjs', fn: 'patch' },
  'author undo': { module: 'author.mjs', fn: 'undo' },
  'author redo': { module: 'author.mjs', fn: 'redo' },
  build: { module: 'build.mjs', fn: 'build' },
  export: { module: 'build.mjs', fn: 'exportBundle' },
  check: { module: 'check.mjs', fn: 'check' },
};
