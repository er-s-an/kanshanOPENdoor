/**
 * Pure wrapper unit tests: argument parsing, multi-word command matching,
 * target discovery, and exit-code contract — no engine-cli required.
 * Run: node --test test/parse.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "story-to-ps1.mjs");
const wrapper = await import(pathToFileURL(SCRIPT).href);

const { parseArgs, matchCommand, resolveTarget, COMMANDS } = wrapper;

test("command table covers the real R1 engine-cli surface", () => {
  for (const command of [
    "capabilities",
    "session start", "session status", "session pause", "session resume", "session step", "session stop",
    "query scene", "query object", "query commits",
    "input inject", "input replay",
    "trace start", "trace stop",
    "observe metrics", "observe logs",
    "author parameters list", "author patch", "author undo", "author redo",
    "build",
    "export",
  ]) {
    assert.ok(COMMANDS.includes(command), `missing command: ${command}`);
  }
  // No legacy catalog-only commands remain.
  for (const gone of ["import", "generate", "validate", "preview"]) {
    assert.ok(!COMMANDS.includes(gone), `stale command still present: ${gone}`);
  }
});

test("multi-word commands resolve by longest prefix", () => {
  assert.deepEqual(matchCommand(["session", "start", "--experience", "x"]), {
    command: "session start",
    words: 2,
  });
  assert.deepEqual(matchCommand(["author", "parameters", "list", "--experience", "x"]), {
    command: "author parameters list",
    words: 3,
  });
  assert.deepEqual(matchCommand(["author", "patch", "--set", "a=1"]), { command: "author patch", words: 2 });
  assert.deepEqual(matchCommand(["build", "--experience", "x"]), { command: "build", words: 1 });
  assert.equal(matchCommand(["sesion", "start"]), null);
});

test("--cli may appear before or after the command; only command args are forwarded", () => {
  const before = parseArgs(["--cli", "/tmp/cli.mjs", "session", "step", "--session", "s1", "--steps", "5"]);
  assert.equal(before.error, undefined);
  assert.equal(before.cli, "/tmp/cli.mjs");
  assert.equal(before.command, "session step");
  assert.deepEqual(before.args, ["--session", "s1", "--steps", "5"]);

  const after = parseArgs(["query", "scene", "--session", "s1", "--cli", "/tmp/cli.mjs"]);
  assert.equal(after.error, undefined);
  assert.equal(after.cli, "/tmp/cli.mjs");
  assert.equal(after.command, "query scene");
  assert.deepEqual(after.args, ["--session", "s1"]);
});

test("--cli=PATH form is accepted and --json is stripped from forwarded args", () => {
  const parsed = parseArgs(["--cli=/tmp/cli.mjs", "capabilities", "--json"]);
  assert.equal(parsed.cli, "/tmp/cli.mjs");
  assert.equal(parsed.json, true);
  assert.deepEqual(parsed.args, []);
});

test("unknown command and empty argv are BAD_INPUT errors", () => {
  assert.ok(parseArgs([]).error.includes("usage:"));
  assert.ok(parseArgs(["preview", "--project", "x"]).error.includes('unknown command "preview"'));
  assert.ok(parseArgs(["--cli"]).error.includes("--cli requires"));
});

test("target resolution: explicit path wins, then env, then repo default", () => {
  const explicit = resolveTarget("/definitely/missing/engine-cli.mjs", {});
  assert.equal(explicit.status, "missing");
  assert.equal(explicit.configured, true);

  const fromEnv = resolveTarget(undefined, { STORY_TO_PS1_CLI: "/also/missing" });
  assert.equal(fromEnv.status, "missing");
  assert.equal(fromEnv.configured, true);

  const legacyEnv = resolveTarget(undefined, { STORY_PS1_CLI: "/still/missing" });
  assert.equal(legacyEnv.status, "missing");
  assert.equal(legacyEnv.configured, true);

  // No explicit, no env: repo default exists in this checkout.
  const fallback = resolveTarget(undefined, {});
  assert.equal(fallback.status, "available");
  assert.ok(fallback.executable.endsWith(path.join("game-ps1", "tools", "engine-cli.mjs")), fallback.executable);
  assert.equal(fallback.configured, false);

  // Explicit beats env.
  const wins = resolveTarget(SCRIPT, { STORY_TO_PS1_CLI: "/missing" });
  assert.equal(wins.status, "available");
  assert.equal(wins.configured, true);
});

test("emit writes one JSON line and returns the exit code", () => {
  let written = "";
  const code = wrapper.emit({ ok: true, requestId: "r" }, 0, { write: (s) => (written += s) });
  assert.equal(code, 0);
  assert.equal(JSON.parse(written).ok, true);
  assert.ok(written.endsWith("\n"));
});
