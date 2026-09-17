/**
 * Integration test: the story-to-ps1 wrapper against the REAL engine-cli
 * (game-ps1/tools/engine-cli.mjs). Spawns the wrapper as a subprocess —
 * no imported stubs, no shell — and asserts:
 *   - capabilities forwards ok (exit 0);
 *   - session start/step/query/stop on clockwork-flat (controlled mode);
 *   - author parameters list (multi-word) on noop-patch;
 *   - build + export noop-patch into temp dirs;
 *   - target exit codes pass through exactly (missing experience -> 3);
 *   - missing target -> wrapper NOT_IMPLEMENTED exit 3; bad command -> 2.
 *
 * Run: node --test test/wrapper-integration.test.mjs   (from the skill dir;
 * requires the game-ps1 checkout at <repo>/game-ps1 — the wrapper's default
 * discovery expects exactly that layout.)
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(SKILL_DIR, "..", "..");
const WRAPPER = path.join(SKILL_DIR, "scripts", "story-to-ps1.mjs");
const ENGINE_CLI = path.join(REPO_ROOT, "game-ps1", "tools", "engine-cli.mjs");
const GAME_PS1 = path.join(REPO_ROOT, "game-ps1");
const CLOCKWORK = path.join("experiences", "clockwork-flat");
const NOOP = path.join("experiences", "noop-patch");
const SESSION_ID = `sk-it-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

interface RunResult {
  code: number;
  env: any;
  stdout: string;
  stderr: string;
}

function runWrapper(args: string[], timeoutMs = 180_000, env: NodeJS.ProcessEnv = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [WRAPPER, ...args], {
      cwd: GAME_PS1,
      env: { ...process.env, ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += String(d)));
    child.stderr.on("data", (d) => (stderr += String(d)));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`wrapper timed out: ${args.join(" ")}`));
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      let env2: any = null;
      try {
        env2 = JSON.parse(stdout);
      } catch {
        /* leave null; assertions report raw stdout */
      }
      resolve({ code: code ?? -1, env: env2, stdout, stderr });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function assertOk(result: RunResult, label: string): any {
  assert.equal(result.code, 0, `${label}: exit 0 (got ${result.code}: ${result.stdout}${result.stderr})`);
  assert.equal(result.env?.ok, true, `${label}: envelope ok (got ${result.stdout})`);
  assert.equal(typeof result.env?.requestId, "string", `${label}: requestId present`);
  return result.env.data;
}

function assertExit(result: RunResult, code: number, label: string): any {
  assert.equal(result.code, code, `${label}: exit ${code} (got ${result.code}: ${result.stdout}${result.stderr})`);
  assert.equal(result.env?.ok, false, `${label}: envelope not ok`);
  return result.env.diagnostics?.[0];
}

// --- guards + cleanup -------------------------------------------------------

test("test prerequisites: real engine-cli and experiences exist", () => {
  assert.ok(fs.existsSync(ENGINE_CLI), `engine-cli present at ${ENGINE_CLI}`);
  assert.ok(fs.existsSync(path.join(GAME_PS1, CLOCKWORK, "experience.json")), "clockwork-flat present");
  assert.ok(fs.existsSync(path.join(GAME_PS1, NOOP, "experience.json")), "noop-patch present");
});

after(async () => {
  // Never leave a daemon or state file behind, even on failure.
  await runWrapper(["session", "stop", "--session", SESSION_ID], 30_000).catch(() => {});
});

// --- happy paths ------------------------------------------------------------

test("capabilities forwards the real envelope (exit 0)", async () => {
  const data = assertOk(await runWrapper(["capabilities"], 60_000), "capabilities");
  assert.equal(data.protocol, "r1.0");
  assert.ok(Array.isArray(data.systems) && data.systems.length > 0, "systems listed");
  assert.ok(data.operations?.session?.commands.includes("session start"), "session ops listed");
  assert.ok(Array.isArray(data.notMeasured), "honest NOT_MEASURED list present");
});

test("session start/step/query/stop on clockwork-flat via wrapper", async () => {
  const started = assertOk(
    await runWrapper(["session", "start", "--experience", CLOCKWORK, "--slot", SESSION_ID]),
    "session start",
  );
  assert.equal(started.handle.sessionId, SESSION_ID);
  assert.equal(typeof started.handle.experienceDigest, "string");
  assert.equal(started.mode, "controlled");

  try {
    const stepped = assertOk(
      await runWrapper(["session", "step", "--session", SESSION_ID, "--steps", "5"]),
      "session step",
    );
    assert.equal(stepped.advanced, 5);
    assert.equal(stepped.tick, 5);

    const status = assertOk(await runWrapper(["session", "status", "--session", SESSION_ID]), "session status");
    assert.equal(status.status, "running");

    const scene = assertOk(
      await runWrapper(["query", "scene", "--session", SESSION_ID, "--limit", "10"]),
      "query scene",
    );
    assert.equal(Array.isArray(scene.data), true);
    assert.ok(scene.data.length > 0 && scene.data.length <= 10, "bounded object list");
    assert.equal(scene.truncated, true, "limit truncation reported honestly");
  } finally {
    const stopped = assertOk(await runWrapper(["session", "stop", "--session", SESSION_ID]), "session stop");
    assert.equal(stopped.stopped, true);
  }

  // After stop the session is gone: the target reports NO_SESSION (exit 3) and
  // the wrapper passes that code through exactly.
  const gone = await runWrapper(["session", "status", "--session", SESSION_ID], 60_000);
  assertExit(gone, 3, "status after stop");
  assert.equal(gone.env.diagnostics[0].code, "NO_SESSION");
});

test("author parameters list (multi-word) on noop-patch", async () => {
  const data = assertOk(
    await runWrapper(["author", "parameters", "list", "--experience", NOOP]),
    "author parameters list",
  );
  assert.equal(data.kind, "author.parameters");
  const spin = data.params.find((p: any) => p.authorId === "spinSpeed");
  assert.ok(spin, "spinSpeed param declared");
  assert.equal(spin.currentValue, 0.5);
  assert.equal(spin.schemaVersion, 1);
});

test("build + export noop-patch into temp dirs", async () => {
  const buildOut = fs.mkdtempSync(path.join(os.tmpdir(), "story-ps1-build-"));
  const exportOut = fs.mkdtempSync(path.join(os.tmpdir(), "story-ps1-export-"));
  try {
    const build = assertOk(
      await runWrapper(["build", "--experience", NOOP, "--out", buildOut]),
      "build",
    );
    assert.equal(typeof build.buildId, "string");
    assert.equal(typeof build.artifactDigest, "string");
    assert.ok(build.files.length > 0, "build lists emitted files");
    for (const file of build.files) {
      assert.ok(fs.existsSync(path.join(buildOut, file.path)), `built file exists: ${file.path}`);
    }

    const exported = assertOk(
      await runWrapper(["export", "--experience", NOOP, "--out", exportOut]),
      "export",
    );
    assert.equal(exported.rapierPresent, false, "unused physics WASM stays out of the bundle");
    assert.ok(fs.existsSync(path.join(exportOut, "index.html")), "index.html exported");
    assert.ok(fs.existsSync(path.join(exportOut, "NOTICE.md")), "NOTICE.md exported");
    assert.ok(fs.existsSync(path.join(exportOut, "report.json")), "report.json exported");
  } finally {
    fs.rmSync(buildOut, { recursive: true, force: true });
    fs.rmSync(exportOut, { recursive: true, force: true });
  }
});

// --- failure paths ----------------------------------------------------------

test("target failure codes pass through exactly: missing experience -> 3", async () => {
  const result = await runWrapper(
    ["session", "start", "--experience", "experiences/does-not-exist", "--slot", SESSION_ID],
    60_000,
  );
  const diag = assertExit(result, 3, "missing experience");
  assert.equal(diag.code, "MISSING_EXPERIENCE");
});

test("missing configured target -> wrapper NOT_IMPLEMENTED exit 3", async () => {
  const result = await runWrapper(["--cli", "/nonexistent/engine-cli.mjs", "capabilities"], 30_000);
  const diag = assertExit(result, 3, "missing target");
  assert.equal(diag.code, "NOT_IMPLEMENTED");
  assert.match(diag.message, /missing or not executable/);
});

test("unknown wrapper command -> BAD_INPUT exit 2", async () => {
  const result = await runWrapper(["definitely-not-a-command"], 30_000);
  const diag = assertExit(result, 2, "unknown command");
  assert.equal(diag.code, "BAD_INPUT");
});
