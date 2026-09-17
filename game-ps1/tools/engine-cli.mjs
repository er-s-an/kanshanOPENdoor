#!/usr/bin/env node
/**
 * engine-cli: Agent/Studio entry to the creative runtime tool protocol.
 * Usage: node tools/engine-cli.mjs <group> <cmd> [--flag value ...] [--json]
 * Output: a single JSON ToolEnvelope on stdout. Exit codes per envelope.mjs.
 */
import { COMMANDS } from './commands.mjs';
import { envelope, exitCode, fail } from './lib/envelope.mjs';

export function parseFlags(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq >= 0) flags[a.slice(2, eq)] = a.slice(eq + 1);
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) flags[a.slice(2)] = argv[++i];
      else flags[a.slice(2)] = true;
    } else positional.push(a);
  }
  return { flags, positional };
}

export async function main(argv) {
  const { flags, positional } = parseFlags(argv);
  // Longest-prefix match so three-word commands (author parameters list) work.
  let cmd;
  for (let n = Math.min(3, positional.length); n >= 1 && !cmd; n -= 1) {
    cmd = COMMANDS[positional.slice(0, n).join(' ')];
  }
  const key = positional.join(' ');
  if (!cmd) {
    const env = fail('BAD_COMMAND', `unknown command "${positional.join(' ')}"; try: capabilities`);
    console.log(JSON.stringify(env));
    return exitCode(env);
  }
  try {
    const lib = await import(`./lib/${cmd.module}`);
    const result = await lib[cmd.fn]({ ...flags, ...(cmd.kind ? { kind: cmd.kind } : {}) });
    const env = result && typeof result === 'object' && 'ok' in result ? result : fail('BAD_RESULT', 'lib returned no envelope');
    console.log(JSON.stringify(env));
    return exitCode(env);
  } catch (err) {
    const env = envelope({
      ok: false,
      diagnostics: [{ code: 'TOOL_ERROR', message: err instanceof Error ? err.message : String(err) }],
    });
    console.log(JSON.stringify(env));
    return exitCode(env);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(await main(process.argv.slice(2)));
}
