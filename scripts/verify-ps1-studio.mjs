#!/usr/bin/env node

/**
 * Static integration smoke check for the proposed PS1 Story Studio.
 *
 * This file deliberately has no npm dependencies and never starts a server,
 * browser, model provider, or real-device test. It verifies that the agreed
 * contracts are present and internally consistent so that a later build/test
 * command has a small, deterministic preflight.
 */

import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const jsonOutput = args.has("--json");

const results = [];

function record(status, id, message, details = undefined) {
  results.push({ status, id, message, ...(details ? { details } : {}) });
}

function pass(id, message, details) {
  record("PASS", id, message, details);
}

function warn(id, message, details) {
  record("WARN", id, message, details);
}

function fail(id, message, details) {
  record("FAIL", id, message, details);
}

function relPath(...parts) {
  return parts.join("/");
}

function absolute(rel) {
  return join(REPO_ROOT, ...rel.split("/"));
}

function hasFile(rel) {
  try {
    return lstatSync(absolute(rel)).isFile();
  } catch {
    return false;
  }
}

function hasDirectory(rel) {
  try {
    return lstatSync(absolute(rel)).isDirectory();
  } catch {
    return false;
  }
}

function readText(rel) {
  return readFileSync(absolute(rel), "utf8");
}

function readJson(rel, id) {
  if (!hasFile(rel)) {
    fail(id, `missing ${rel}`);
    return null;
  }
  try {
    return JSON.parse(readText(rel));
  } catch (error) {
    fail(id, `invalid JSON in ${rel}`, String(error.message));
    return null;
  }
}

function sourceFilesUnder(rel) {
  const root = absolute(rel);
  if (!hasDirectory(rel)) return [];
  const found = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (["node_modules", ".git", "dist", "coverage"].includes(entry.name)) continue;
      const target = join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (/\.(?:mjs|cjs|js|ts|tsx|jsx)$/.test(entry.name)) found.push(target);
    }
  };
  visit(root);
  return found;
}

function collectExportTargets(value, output = []) {
  if (typeof value === "string") {
    output.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectExportTargets(item, output);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectExportTargets(item, output);
  }
  return output;
}

function checkMarkdownLinks(rel, id) {
  if (!hasFile(rel)) return;
  const text = readText(rel);
  const links = [...text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((match) => match[1]);
  let localCount = 0;
  for (const link of links) {
    if (/^(?:https?:|mailto:|#)/i.test(link)) continue;
    const linkPath = link.split("#", 1)[0];
    if (!linkPath) continue;
    localCount += 1;
    const target = resolve(dirname(absolute(rel)), linkPath);
    if (!existsSync(target)) {
      fail(`${id}.link`, `broken local link in ${rel}: ${link}`);
    }
  }
  pass(id, `checked ${localCount} local Markdown links in ${rel}`);
}

function checkPackage(rel, id, requiredScripts, requireStoryContract = false) {
  const packageRel = relPath(rel, "package.json");
  const pkg = readJson(packageRel, `${id}.package`);
  if (!pkg) return null;

  if (pkg.type !== "module") warn(`${id}.type`, `${packageRel} does not declare type=module`);
  else pass(`${id}.type`, `${packageRel} declares type=module`);

  const scripts = pkg.scripts && typeof pkg.scripts === "object" ? pkg.scripts : {};
  for (const scriptName of requiredScripts) {
    if (typeof scripts[scriptName] === "string" && scripts[scriptName].trim()) {
      pass(`${id}.script.${scriptName}`, `script ${scriptName} is declared`);
    } else {
      fail(`${id}.script.${scriptName}`, `missing non-empty npm script ${scriptName}`);
    }
  }

  if (pkg.exports === undefined) {
    fail(`${id}.exports`, `${packageRel} has no exports map`);
  } else {
    const targets = collectExportTargets(pkg.exports);
    if (!targets.length) {
      fail(`${id}.exports`, `${packageRel} exports map has no file target`);
    } else {
      for (const target of targets) {
        if (!target.startsWith("./") || target.includes("..")) {
          fail(`${id}.exports`, `unsafe export target ${target}`);
          continue;
        }
        if (!hasFile(relPath(rel, target.slice(2)))) {
          fail(`${id}.exports`, `export target does not exist: ${relPath(rel, target.slice(2))}`);
        } else {
          pass(`${id}.exports.${target}`, `export target exists: ${target}`);
        }
      }
    }
  }

  if (requireStoryContract) {
    const allDependencies = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
      ...(pkg.peerDependencies ?? {}),
    };
    const contractDependency = Object.keys(allDependencies).find((name) => /story-contract/i.test(name));
    if (contractDependency) {
      pass(`${id}.contract-dependency`, `${packageRel} declares ${contractDependency}`);
    } else {
      fail(`${id}.contract-dependency`, `${packageRel} does not declare a story-contract dependency`);
    }
  }
  return pkg;
}

function checkAppPackage(rel, id, requiredScripts, requireStoryContract = false) {
  const packageRel = relPath(rel, "package.json");
  const pkg = readJson(packageRel, `${id}.package`);
  if (!pkg) return null;
  const scripts = pkg.scripts && typeof pkg.scripts === "object" ? pkg.scripts : {};
  for (const scriptName of requiredScripts) {
    if (typeof scripts[scriptName] === "string" && scripts[scriptName].trim()) {
      pass(`${id}.script.${scriptName}`, `script ${scriptName} is declared`);
    } else {
      fail(`${id}.script.${scriptName}`, `missing non-empty npm script ${scriptName}`);
    }
  }
  if (requireStoryContract) {
    const allDependencies = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
      ...(pkg.peerDependencies ?? {}),
    };
    const contractDependency = Object.keys(allDependencies).find((name) => /story-contract/i.test(name));
    if (contractDependency) pass(`${id}.contract-dependency`, `${packageRel} declares ${contractDependency}`);
    else fail(`${id}.contract-dependency`, `${packageRel} does not declare a story-contract dependency`);
  }
  return pkg;
}

function allValues(value, callback, path = "$") {
  callback(value, path);
  if (Array.isArray(value)) {
    value.forEach((item, index) => allValues(item, callback, `${path}[${index}]`));
  } else if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, item]) => allValues(item, callback, `${path}.${key}`));
  }
}

function validateExample(schema, example, sourceText) {
  const schemaId = schema?.$id;
  if (schema?.$schema !== "https://json-schema.org/draft/2020-12/schema") {
    fail("schema.meta", "StoryPackage schema is not Draft 2020-12");
  } else {
    pass("schema.meta", "StoryPackage schema declares Draft 2020-12");
  }
  if (schemaId !== "urn:kanshan:story-package:1.0.0") {
    fail("schema.id", `unexpected schema $id: ${String(schemaId)}`);
  } else {
    pass("schema.id", "StoryPackage schema $id is 1.0.0");
  }
  const requiredDefinitions = [
    "id", "vec3", "source", "span", "provenance", "flag", "item", "fact",
    "condition", "cue", "worldObject", "anchor", "scene", "action", "option", "beat",
  ];
  for (const definition of requiredDefinitions) {
    if (!schema?.$defs?.[definition]) fail("schema.definitions", `schema is missing $defs.${definition}`);
  }
  if (schema?.additionalProperties !== false) fail("schema.closed-root", "StoryPackage root must set additionalProperties=false");
  const schemaActionKinds = new Set();
  for (const branch of schema?.$defs?.action?.oneOf ?? []) {
    const kind = branch?.properties?.kind;
    for (const value of kind?.enum ?? []) schemaActionKinds.add(value);
    if (typeof kind?.const === "string") schemaActionKinds.add(kind.const);
  }
  if (schemaActionKinds.size === 0) fail("schema.action-catalog", "StoryPackage schema exposes no action kinds");
  const catalogFiles = sourceFilesUnder("studio");
  let foundCatalog = false;
  for (const file of catalogFiles) {
    const source = readFileSync(file, "utf8");
    const match = source.match(/ACTION_CATALOG\s*=\s*\[([\s\S]*?)\]/);
    if (!match) continue;
    foundCatalog = true;
    const catalog = [...match[1].matchAll(/["']([a-z-]+)["']/g)].map((entry) => entry[1]);
    const expected = [...schemaActionKinds].sort();
    const actual = [...new Set(catalog)].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      fail("contract.action-catalog", `Studio action catalog in ${file} drifts from schema (${actual.join(", ")} vs ${expected.join(", ")})`);
    } else {
      pass("contract.action-catalog", `Studio action catalog matches schema (${expected.join(", ")})`);
    }
    break;
  }
  if (!foundCatalog && hasDirectory("studio")) {
    fail("contract.action-catalog", "Studio exposes no static ACTION_CATALOG to compare with the schema");
  }

  const required = schema?.required ?? [];
  for (const key of required) {
    if (!(key in (example ?? {}))) fail(`example.required.${key}`, `example is missing required key ${key}`);
  }
  const rootProperties = new Set(Object.keys(schema?.properties ?? {}));
  for (const key of Object.keys(example ?? {})) {
    if (!rootProperties.has(key)) fail("example.root-keys", `example has key not declared by schema: ${key}`);
  }
  if (!example || example.schemaVersion !== "1.0.0") fail("example.version", "example schemaVersion is not 1.0.0");
  else pass("example.version", "example schemaVersion matches the contract");

  const expectedCodepoints = [...sourceText].length;
  const actualDigest = createHash("sha256").update(sourceText, "utf8").digest("hex");
  if (example.source?.codepointLength !== expectedCodepoints) {
    fail("example.source-length", `source codepointLength=${example.source?.codepointLength} but file has ${expectedCodepoints}`);
  } else {
    pass("example.source-length", `source codepointLength matches (${expectedCodepoints})`);
  }
  if (example.source?.digest !== actualDigest) {
    fail("example.source-digest", `source digest does not match ${relPath("docs", "ps1-studio", "examples", "source.txt")}`);
  } else {
    pass("example.source-digest", "source SHA-256 digest matches the package metadata");
  }

  const sourceCodepoints = [...sourceText];
  const ids = new Map();
  const registerIds = (array, label) => {
    if (!Array.isArray(array)) return;
    for (const item of array) {
      if (!item || typeof item.id !== "string") continue;
      if (ids.has(item.id)) fail("example.ids", `duplicate id ${item.id} in ${label} and ${ids.get(item.id)}`);
      else ids.set(item.id, label);
      if (!/^[a-z][a-z0-9-]{0,63}$/.test(item.id)) fail("example.ids", `invalid id ${item.id}`);
    }
  };
  registerIds(example.flags, "flags");
  registerIds(example.items, "items");
  registerIds(example.facts, "facts");
  registerIds(example.scenes, "scenes");
  registerIds(example.beats, "beats");
  for (const scene of example.scenes ?? []) {
    registerIds(scene.objects, `scene:${scene.id}.objects`);
    registerIds(scene.anchors, `scene:${scene.id}.anchors`);
  }
  for (const beat of example.beats ?? []) {
    for (const option of beat.options ?? []) registerIds([option], `beat:${beat.id}.options`);
  }

  const sceneIds = new Set((example.scenes ?? []).map((scene) => scene.id));
  const anchorIds = new Set();
  for (const scene of example.scenes ?? []) {
    const sceneObjectIds = new Set((scene.objects ?? []).map((object) => object.id));
    for (const anchor of scene.anchors ?? []) {
      anchorIds.add(anchor.id);
      if (!sceneObjectIds.has(anchor.targetObject)) {
        fail("example.scene-references", `anchor ${anchor.id} targets missing object ${anchor.targetObject}`);
      }
    }
  }
  const flagIds = new Set((example.flags ?? []).map((flag) => flag.id));
  const itemIds = new Set((example.items ?? []).map((item) => item.id));
  const factIds = new Set((example.facts ?? []).map((fact) => fact.id));
  const beatIds = new Set((example.beats ?? []).map((beat) => beat.id));
  if (!beatIds.has(example.startBeat)) fail("example.start-beat", `startBeat does not exist: ${example.startBeat}`);

  const checkCondition = (condition, location) => {
    if (!condition) return;
    if (condition.kind === "flag" && !flagIds.has(condition.id)) fail("example.guards", `${location} references missing flag ${condition.id}`);
    if (condition.kind === "inventory" && !itemIds.has(condition.id)) fail("example.guards", `${location} references missing item ${condition.id}`);
    if (condition.kind === "knowledge" && !factIds.has(condition.id)) fail("example.guards", `${location} references missing fact ${condition.id}`);
  };
  const checkEffect = (effect, location) => {
    if (!effect) return;
    if (effect.kind === "flag" && !flagIds.has(effect.id)) fail("example.effects", `${location} references missing flag ${effect.id}`);
    if (effect.kind === "inventory" && !itemIds.has(effect.id)) fail("example.effects", `${location} references missing item ${effect.id}`);
    if (effect.kind === "knowledge" && !factIds.has(effect.id)) fail("example.effects", `${location} references missing fact ${effect.id}`);
  };
  for (const [beatIndex, beat] of (example.beats ?? []).entries()) {
    const location = `beat[${beatIndex}] ${beat.id}`;
    if (!sceneIds.has(beat.sceneId)) fail("example.beats", `${location} references missing scene ${beat.sceneId}`);
    const action = beat.action ?? {};
    if (["inspect", "talk", "collect", "use"].includes(action.kind) && !anchorIds.has(action.anchorId)) {
      fail("example.actions", `${location} references missing anchor ${action.anchorId}`);
    }
    if (["collect", "use"].includes(action.kind) && !itemIds.has(action.itemId)) {
      fail("example.actions", `${location} references missing item ${action.itemId}`);
    }
    if (action.kind === "choose" && (beat.options?.length < 2 || beat.options?.length > 4)) {
      fail("example.options", `${location} choose action must have 2-4 options`);
    }
    if (action.kind === "end" && (beat.options?.length ?? 0) !== 0) {
      fail("example.options", `${location} end action must not have options`);
    }
    if (!['choose', 'end'].includes(action.kind) && (beat.options?.length ?? 0) !== 1) {
      fail("example.options", `${location} action must have exactly one option`);
    }
    for (const option of beat.options ?? []) {
      for (const guard of option.guards ?? []) checkCondition(guard, `${location}.${option.id}.guard`);
      for (const effect of option.effects ?? []) checkEffect(effect, `${location}.${option.id}.effect`);
      if (option.next !== undefined && !beatIds.has(option.next)) fail("example.transitions", `${location}.${option.id} points to missing beat ${option.next}`);
      for (const cue of option.cues ?? []) {
        if (cue.provenance?.kind !== "invented" && !(cue.provenance?.spans?.length > 0)) {
          fail("example.provenance", `${location}.${option.id} sourced/adapted cue has no source span`);
        }
      }
    }
    for (const cue of beat.entry ?? []) {
      if (cue.provenance?.kind !== "invented" && !(cue.provenance?.spans?.length > 0)) {
        fail("example.provenance", `${location} entry sourced/adapted cue has no source span`);
      }
    }
  }

  let spans = 0;
  allValues(example, (value, location) => {
    if (!value || typeof value !== "object" || !Array.isArray(value.spans)) return;
    for (const span of value.spans) {
      spans += 1;
      if (!Number.isInteger(span.start) || !Number.isInteger(span.end) || span.start < 0 || span.end <= span.start || span.end > sourceCodepoints.length) {
        fail("example.spans", `${location} contains out-of-range span ${JSON.stringify(span)}`);
      }
    }
  });
  pass("example.spans", `checked ${spans} provenance span(s) against source codepoints`);

  if (results.filter((result) => result.id.startsWith("example.") || result.id.startsWith("schema.")).some((result) => result.status === "FAIL")) {
    return;
  }
  pass("example.semantic-shape", "example references, action arities, transitions, and provenance are internally consistent");
}

function checkRuntime() {
  const runtimeRoot = "game-ps1/src/runtime";
  if (!hasDirectory(runtimeRoot)) {
    fail("runtime.root", `missing ${runtimeRoot}`);
    return;
  }
  pass("runtime.root", `${runtimeRoot} exists`);
  const runtimeFiles = sourceFilesUnder(runtimeRoot);
  const groups = [
    ["player", /player/i],
    ["director", /director/i],
    ["assembler", /assembler/i],
    ["interaction", /interaction/i],
    ["save", /save/i],
  ];
  for (const [name, pattern] of groups) {
    if (runtimeFiles.some((file) => pattern.test(file))) pass(`runtime.${name}`, `runtime contains a ${name} module`);
    else fail(`runtime.${name}`, `runtime has no source file matching ${name}`);
  }
  if (hasFile("game-ps1/player.html")) pass("runtime.entry", "game-ps1/player.html exists");
  else fail("runtime.entry", "missing game-ps1/player.html");
  const runtimeText = runtimeFiles.map((file) => readFileSync(file, "utf8")).join("\n");
  if (/story-contract/i.test(runtimeText)) pass("runtime.contract-import", "runtime references the shared story contract");
  else fail("runtime.contract-import", "runtime source does not reference story-contract");
}

function checkStudio() {
  // Accept the flat .mjs layout used by the first CLI implementation as well
  // as the planned subdirectory layout. This keeps the check about capabilities
  // and not a cosmetic file naming choice.
  const modules = [
    ["services", ["studio/src/services", "studio/src/services.mjs"]],
    ["cli", ["studio/src/cli", "studio/src/cli.mjs"]],
    ["authoring", ["studio/src/authoring", "studio/src/authoring.mjs", "studio/src/contract.mjs"]],
    ["server", ["studio/src/server", "studio/src/server.mjs"]],
    ["web", ["studio/src/web", "studio/src/web.mjs", "studio/src/ui.mjs"]],
  ];
  for (const [name, candidates] of modules) {
    const found = candidates.find((candidate) => hasFile(candidate) || (hasDirectory(candidate) && sourceFilesUnder(candidate).length));
    if (!found) {
      fail(`studio.module.${name}`, `missing Studio ${name} module (looked for ${candidates.join(", ")})`);
    } else {
      pass(`studio.module.${name}`, `Studio ${name} module found at ${found}`);
    }
  }
}

function checkSkill() {
  const draft = "docs/ps1-studio/skill-draft/story-to-ps1/SKILL.md";
  if (!hasFile(draft)) {
    fail("skill.draft", `missing ${draft}`);
    return;
  }
  const content = readText(draft);
  const frontmatter = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatter || !/^name:\s*story-to-ps1\s*$/m.test(frontmatter[1]) || !/^description:\s*\S.+$/m.test(frontmatter[1])) {
    fail("skill.frontmatter", `${draft} lacks the required name/description frontmatter`);
  } else {
    pass("skill.frontmatter", `${draft} has valid minimal frontmatter`);
  }
  for (const token of ["NOT_IMPLEMENTED", "capabilities", "validate", "preview"]) {
    if (content.includes(token)) pass(`skill.token.${token}`, `Skill draft documents ${token}`);
    else fail(`skill.token.${token}`, `Skill draft does not document ${token}`);
  }
  const installedCandidates = ["skills/story-to-ps1", ".codex/skills/story-to-ps1"];
  const installed = installedCandidates.find((candidate) => hasFile(relPath(candidate, "SKILL.md")));
  if (installed) pass("skill.installed", `installed Skill package found at ${installed}`);
  else warn("skill.installed", "no installed Skill package found; draft is intentionally not installed yet");
}

function checkSafety() {
  const roots = [
    "packages",
    "studio",
    "game-ps1/src/runtime",
    "docs/ps1-studio/examples",
    "scripts",
  ];
  const textExtensions = new Set([".json", ".mjs", ".cjs", ".js", ".ts", ".tsx", ".jsx", ".md", ".txt", ".html", ".css"]);
  const secretPatterns = [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}\b/,
    /\bBearer\s+[A-Za-z0-9._-]{20,}/i,
    /(?:api[_-]?key|access[_-]?secret|client[_-]?secret)\s*[:=]\s*["'][^"']{8,}["']/i,
  ];
  const traversalPattern = /(?:\.\.\/){2,}|(?:\.\.\\){2,}/;
  const files = [];
  const visit = (rel) => {
    const target = absolute(rel);
    if (!existsSync(target)) return;
    const stat = lstatSync(target);
    if (stat.isFile()) {
      if (textExtensions.has(extname(target).toLowerCase())) files.push(rel);
      return;
    }
    if (!stat.isDirectory()) return;
    for (const entry of readdirSync(target, { withFileTypes: true })) {
      if (["node_modules", ".git", "dist", "coverage", "evidence", "qa"].includes(entry.name)) continue;
      visit(relPath(rel, entry.name));
    }
  };
  for (const root of roots) visit(root);

  let scanned = 0;
  for (const rel of files) {
    const content = readText(rel);
    scanned += 1;
    for (const pattern of secretPatterns) {
      if (pattern.test(content)) fail("safety.secret", `possible secret pattern in ${rel}`);
    }
    // A single ../ is normal in npm file dependencies and relative imports;
    // two or more parent hops in an artifact is the obvious traversal case.
    if (/\.json$/i.test(rel) && traversalPattern.test(content)) fail("safety.traversal", `possible path traversal in JSON artifact ${rel}`);
    if (content.includes("\u0000")) fail("safety.binary", `NUL byte in text artifact ${rel}`);
  }
  pass("safety.scan", `scanned ${scanned} in-scope text artifacts for obvious secrets and traversal payloads`);
}

function main() {
  const schema = readJson("docs/ps1-studio/schema/story-package.schema.json", "schema.file");
  const example = readJson("docs/ps1-studio/examples/story-package.json", "example.file");
  if (hasFile("docs/ps1-studio/examples/source.txt")) {
    const source = readText("docs/ps1-studio/examples/source.txt");
    pass("source.file", "original example source exists");
    if (schema && example) validateExample(schema, example, source);
  } else {
    fail("source.file", "missing docs/ps1-studio/examples/source.txt");
  }

  for (const rel of [
    "docs/ps1-studio/README.md",
    "docs/ps1-studio/PRD.md",
    "docs/ps1-studio/BASELINE.md",
    "docs/ps1-studio/SPEC-01-RUNTIME.md",
    "docs/ps1-studio/SPEC-02-CONTENT.md",
    "docs/ps1-studio/SPEC-03-TOOLS-STUDIO.md",
    "docs/ps1-studio/SPEC-04-SKILL.md",
    "docs/ps1-studio/ACCEPTANCE.md",
    "plans/ps1-studio.md",
  ]) {
    if (hasFile(rel)) pass(`docs.${rel}`, `required planning file exists: ${rel}`);
    else fail(`docs.${rel}`, `missing required planning file: ${rel}`);
  }
  checkMarkdownLinks("docs/ps1-studio/README.md", "docs.readme-links");
  checkMarkdownLinks("plans/ps1-studio.md", "docs.plan-links");

  checkPackage("packages/story-contract", "contract", ["build", "test"], false);
  checkPackage("studio", "studio", ["build", "test:core", "story"], true);
  checkRuntime();
  checkStudio();
  checkSkill();
  checkSafety();

  const counts = Object.fromEntries(["PASS", "WARN", "FAIL"].map((status) => [status, results.filter((item) => item.status === status).length]));
  const summary = {
    ok: counts.FAIL === 0,
    scope: "static-local-only",
    claimsNotMade: ["browser", "external-model", "real-device", "deployment", "natural-playthrough"],
    counts,
    checks: results,
  };
  if (jsonOutput) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    console.log("PS1 Story Studio integration smoke (static/local only)");
    for (const item of results) {
      const suffix = item.details ? ` — ${typeof item.details === "string" ? item.details : JSON.stringify(item.details)}` : "";
      console.log(`[${item.status}] ${item.id}: ${item.message}${suffix}`);
    }
    console.log(`Summary: ${counts.PASS} passed, ${counts.WARN} warnings, ${counts.FAIL} failed`);
    console.log("Not tested: browser, external model, real device, deployment, or natural playthrough.");
  }
  process.exitCode = summary.ok ? 0 : 1;
}

try {
  main();
} catch (error) {
  if (jsonOutput) {
    process.stdout.write(`${JSON.stringify({ ok: false, scope: "static-local-only", fatal: String(error?.stack ?? error) }, null, 2)}\n`);
  } else {
    console.error(`FATAL: ${error?.stack ?? error}`);
  }
  process.exitCode = 1;
}
