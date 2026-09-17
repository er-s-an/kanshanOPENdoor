#!/usr/bin/env node

/**
 * story-to-ps1.mjs — Skill wrapper around the REAL creative-runtime tool
 * CLI (game-ps1/tools/engine-cli.mjs, R1 tool protocol).
 *
 * The wrapper is a thin, honest adapter:
 * - discovers a real target CLI via --cli PATH, STORY_TO_PS1_CLI,
 *   STORY_PS1_CLI, or the repo-default location (game-ps1/tools/engine-cli.mjs
 *   relative to this skill); it never falls back to mock output;
 * - accepts the engine-cli command surface verbatim (including multi-word
 *   commands such as `session start` and `author parameters list`), strips
 *   only wrapper-owned flags (--cli), and forwards everything else without
 *   a shell;
 * - passes the target's exit code through exactly (0 ok / 2 invalid /
 *   3 missing / 4 conflict / 5 failure) — no flattening — and only emits its
 *   own envelopes for wrapper-level failures (bad input 2, no target 3,
 *   target-unusable 5).
 */
import { realpathSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const VERSION = "1.0.0";

/**
 * The real R1 tool surface (game-ps1/tools/commands.mjs). Longest-prefix
 * match wins, so `session`, `query`, `input`, `trace`, `observe`, and
 * `author parameters` groups all resolve to their sub-commands.
 */
export const COMMANDS = Object.freeze([
  "capabilities",
  "session start",
  "session status",
  "session pause",
  "session resume",
  "session step",
  "session stop",
  "query scene",
  "query object",
  "query commits",
  "input inject",
  "input replay",
  "trace start",
  "trace stop",
  "observe metrics",
  "observe logs",
  "author parameters list",
  "author patch",
  "author undo",
  "author redo",
  "build",
  "export",
  "check",
  "query physics",
]);

export const EXIT = Object.freeze({ ok: 0, badInput: 2, notImplemented: 3, failed: 5 });

const WRAPPER_EXIT = EXIT; // alias for readability at call sites

/** Resolve the repo-default engine-cli: <repo>/game-ps1/tools/engine-cli.mjs. */
function defaultCliCandidate() {
  // scripts/ -> story-to-ps1 -> skills -> repo root
  const scriptsDir = dirname(fileURLToPath(import.meta.url));
  return resolve(scriptsDir, "..", "..", "..", "game-ps1", "tools", "engine-cli.mjs");
}

export function requestId() {
  return `story-to-ps1-${randomUUID()}`;
}

export function diagnostic(code, message, details = {}) {
  return { code, message, ...details };
}

export function usage() {
  return [
    "usage: story-to-ps1.mjs [--cli PATH] <command> [args]",
    `commands: ${COMMANDS.join(" | ")}`,
    "env: STORY_TO_PS1_CLI or STORY_PS1_CLI may point at game-ps1/tools/engine-cli.mjs",
  ].join("\n");
}

/**
 * Strip wrapper-owned flags, then longest-prefix match the command words.
 * Returns { cli, json, command, args } or { error }.
 */
export function parseArgs(argv) {
  let cli;
  let json = false;
  const rest = [];
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--cli") {
      cli = argv[index + 1];
      if (!cli) return { error: "--cli requires an executable path" };
      index += 1;
      continue;
    }
    if (value.startsWith("--cli=")) {
      cli = value.slice("--cli=".length);
      if (!cli) return { error: "--cli requires an executable path" };
      continue;
    }
    if (value === "--json") {
      json = true;
      continue;
    }
    rest.push(value);
  }
  if (rest.length === 0) return { error: usage() };
  const match = matchCommand(rest);
  if (!match) {
    const flagAt = rest.findIndex((value) => value.startsWith("--"));
    const leading = (flagAt === -1 ? rest : rest.slice(0, flagAt)).slice(0, 3).join(" ");
    return { error: `unknown command "${leading}"\n${usage()}` };
  }
  return { cli, json, command: match.command, args: rest.slice(match.words) };
}

/** Longest-prefix match of the leading words against the command table. */
export function matchCommand(words) {
  const max = Math.min(3, words.length);
  for (let n = max; n >= 1; n -= 1) {
    const candidate = words.slice(0, n).join(" ");
    if (COMMANDS.includes(candidate)) {
      return { command: candidate, words: n };
    }
  }
  return null;
}

function usableFile(path) {
  try {
    // The target is always spawned via `node <path>`; it does not need an
    // exec bit, it needs to be a real file.
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function executableCandidate(value) {
  if (!value) return null;
  const candidate = isAbsolute(value) || value.includes("/") ? resolve(value) : value;
  if (!isAbsolute(candidate)) {
    for (const directory of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
      const path = join(directory, candidate);
      if (usableFile(path)) return realPath(path);
    }
    return null;
  }
  return usableFile(candidate) ? realPath(candidate) : null;
}

function realPath(path) {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

/**
 * Resolve the target CLI. Order: explicit --cli > STORY_TO_PS1_CLI >
 * STORY_PS1_CLI > repo default. `env` is injectable for tests.
 */
export function resolveTarget(explicit, env = process.env) {
  const configured = explicit ?? env.STORY_TO_PS1_CLI ?? env.STORY_PS1_CLI;
  if (configured) {
    const executable = executableCandidate(configured);
    if (!executable) {
      return { status: "missing", configured: true, executable: null, candidate: configured };
    }
    return { status: "available", configured: true, executable };
  }
  const fallback = defaultCliCandidate();
  if (usableFile(fallback)) {
    return { status: "available", configured: false, executable: realPath(fallback) };
  }
  return { status: "missing", configured: false, executable: null, candidate: fallback };
}

function noTargetResult(target, command) {
  const explanation = target.configured
    ? `The configured engine-cli target is missing or not executable: ${target.candidate ?? "(unset)"}`
    : `No engine-cli target found; pass --cli PATH or set STORY_TO_PS1_CLI (expected at ${target.candidate ?? "game-ps1/tools/engine-cli.mjs"}).`;
  return {
    ok: false,
    requestId: requestId(),
    data: command === "capabilities"
      ? {
          skill: "story-to-ps1",
          wrapperVersion: VERSION,
          target: { status: "NOT_IMPLEMENTED", configured: target.configured },
          commands: COMMANDS,
        }
      : null,
    diagnostics: [diagnostic("NOT_IMPLEMENTED", explanation, { command })],
  };
}

/**
 * Forward to the target without a shell. The target's stdout must be one
 * JSON ToolEnvelope; its process exit code is passed through verbatim.
 */
export function invoke(target, command, args, env = process.env) {
  const timeout = Number.parseInt(env.STORY_TO_PS1_TIMEOUT_MS ?? "120000", 10);
  const maxTimeout = Number.isFinite(timeout) ? Math.min(Math.max(timeout, 1000), 300000) : 120000;
  const result = spawnSync(process.execPath, [target.executable, ...command.split(" "), ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: false,
    timeout: maxTimeout,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  });

  if (result.error || result.signal) {
    const timedOut = result.error?.code === "ETIMEDOUT";
    return {
      result: {
        ok: false,
        requestId: requestId(),
        data: null,
        diagnostics: [diagnostic("EXECUTION_FAILED", timedOut ? "engine-cli timed out." : "engine-cli could not be executed.", { command })],
      },
      exitCode: WRAPPER_EXIT.failed,
    };
  }

  const output = String(result.stdout ?? "").trim();
  if (!output) {
    return {
      result: {
        ok: false,
        requestId: requestId(),
        data: null,
        diagnostics: [diagnostic("EXECUTION_FAILED", "engine-cli returned no JSON result.", { command, status: result.status })],
      },
      exitCode: WRAPPER_EXIT.failed,
    };
  }
  try {
    const parsed = JSON.parse(output);
    if (!parsed || typeof parsed !== "object" || typeof parsed.ok !== "boolean") {
      throw new Error("invalid result contract");
    }
    // Pass the target's exit code through exactly; never flatten to 5.
    return { result: parsed, exitCode: result.status ?? WRAPPER_EXIT.failed };
  } catch {
    return {
      result: {
        ok: false,
        requestId: requestId(),
        data: null,
        diagnostics: [diagnostic("EXECUTION_FAILED", "engine-cli returned non-JSON output; no success was inferred.", { command })],
      },
      exitCode: WRAPPER_EXIT.failed,
    };
  }
}

export function emit(result, exitCode = WRAPPER_EXIT.ok, out = process.stdout) {
  out.write(`${JSON.stringify(result)}\n`);
  return exitCode;
}

/** CLI entry. Returns the process exit code (testable without exiting). */
export function main(argv, env = process.env, out = process.stdout) {
  const parsed = parseArgs(argv);
  if (parsed.error) {
    return emit({ ok: false, requestId: requestId(), data: null, diagnostics: [diagnostic("BAD_INPUT", parsed.error)] }, WRAPPER_EXIT.badInput, out);
  }
  const target = resolveTarget(parsed.cli, env);
  if (target.status !== "available") {
    return emit(noTargetResult(target, parsed.command), WRAPPER_EXIT.notImplemented, out);
  }
  const delegated = invoke(target, parsed.command, parsed.args, env);
  return emit(delegated.result, delegated.exitCode, out);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = main(process.argv.slice(2));
}
