#!/usr/bin/env node

import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const VERSION = "0.1.0";
const COMMANDS = ["capabilities", "import", "generate", "build", "validate", "preview"];
const EXIT = Object.freeze({ ok: 0, badInput: 2, notImplemented: 3, failed: 5 });

function requestId() {
  return `story-to-ps1-${randomUUID()}`;
}

function emit(result, exitCode = EXIT.ok) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = exitCode;
}

function diagnostic(code, message, details = {}) {
  return { code, message, ...details };
}

function usage() {
  return "usage: story-to-ps1.mjs [--cli PATH] <capabilities|import|generate|build|validate|preview> [args]";
}

function parseArgs(argv) {
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
    if (value === "--json") {
      json = true;
      continue;
    }
    rest.push(value);
  }
  const commandIndex = rest.findIndex((value) => COMMANDS.includes(value));
  if (commandIndex < 0) return { error: usage() };
  if (commandIndex > 0) return { error: `command must come before target arguments\n${usage()}` };
  return { cli, json, command: rest[commandIndex], args: rest.slice(commandIndex + 1) };
}

function executableCandidate(value) {
  if (!value) return null;
  const candidate = isAbsolute(value) || value.includes("/") ? resolve(value) : value;
  if (!isAbsolute(candidate)) {
    for (const directory of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
      const path = join(directory, candidate);
      if (isExecutable(path)) return realPath(path);
    }
    return null;
  }
  return isExecutable(candidate) ? realPath(candidate) : null;
}

function isExecutable(path) {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function realPath(path) {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

function resolveTarget(explicit) {
  const configured = explicit ?? process.env.STORY_TO_PS1_CLI ?? process.env.STORY_PS1_CLI;
  if (!configured) return { status: "missing", configured: false, executable: null };
  const executable = executableCandidate(configured);
  if (!executable) return { status: "missing", configured: true, executable: null };
  return { status: "available", configured: true, executable };
}

function noTargetResult(target, command) {
  const explanation = target.configured
    ? "The configured Story-to-PS1 CLI is missing or not executable."
    : "No Story-to-PS1 CLI was configured; pass --cli PATH or set STORY_TO_PS1_CLI/STORY_PS1_CLI.";
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

function invoke(target, command, args, jsonRequested) {
  const forwarded = jsonRequested || command === "capabilities"
    ? (args.includes("--json") ? args : [...args, "--json"])
    : args;
  const timeout = Number.parseInt(process.env.STORY_TO_PS1_TIMEOUT_MS ?? "30000", 10);
  const maxTimeout = Number.isFinite(timeout) ? Math.min(Math.max(timeout, 1000), 120000) : 30000;
  const result = spawnSync(target.executable, [command, ...forwarded], {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: false,
    timeout: maxTimeout,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  });

  if (result.error || result.signal) {
    const timedOut = result.error?.code === "ETIMEDOUT";
    return {
      result: {
        ok: false,
        requestId: requestId(),
        data: null,
        diagnostics: [diagnostic("EXECUTION_FAILED", timedOut ? "Target CLI timed out." : "Target CLI could not be executed.", { command })],
      },
      exitCode: EXIT.failed,
    };
  }

  const output = String(result.stdout ?? "").trim();
  if (!output) {
    return {
      result: {
        ok: false,
        requestId: requestId(),
        data: null,
        diagnostics: [diagnostic("EXECUTION_FAILED", "Target CLI returned no JSON result.", { command })],
      },
      exitCode: EXIT.failed,
    };
  }
  try {
    const parsed = JSON.parse(output);
    if (!parsed || typeof parsed !== "object" || typeof parsed.ok !== "boolean") throw new Error("invalid result contract");
    return { result: parsed, exitCode: parsed.ok && result.status === 0 ? EXIT.ok : EXIT.failed };
  } catch {
    return {
      result: {
        ok: false,
        requestId: requestId(),
        data: null,
        diagnostics: [diagnostic("EXECUTION_FAILED", "Target CLI returned non-JSON output; no success was inferred.", { command })],
      },
      exitCode: EXIT.failed,
    };
  }
}

const parsed = parseArgs(process.argv.slice(2));
if (parsed.error) {
  emit({ ok: false, requestId: requestId(), data: null, diagnostics: [diagnostic("BAD_INPUT", parsed.error)] }, EXIT.badInput);
} else {
  const target = resolveTarget(parsed.cli);
  if (target.status !== "available") {
    emit(noTargetResult(target, parsed.command), EXIT.notImplemented);
  } else {
    const delegated = invoke(target, parsed.command, parsed.args, parsed.json);
    emit(delegated.result, delegated.exitCode);
  }
}
