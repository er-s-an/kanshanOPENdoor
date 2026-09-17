#!/usr/bin/env node
/**
 * verify-ps1-engine.mjs — R1 aggregate acceptance runner.
 *
 * Executes every required LOCAL_ENGINEERING check with its real command/cwd,
 * records exit codes and output tails, and writes
 * evidence/ps1-engine/r1/results.json. It does not grade: per-assertion
 * verdicts live in the test suites themselves; this runner proves they ran
 * and aggregates honestly (any non-zero exit -> overall FAIL).
 *
 * Usage: node scripts/verify-ps1-engine.mjs --json
 * Requires Node >= 24 on PATH (repo engines); type-stripping tests need it.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EVIDENCE_DIR = path.join(ROOT, 'evidence', 'ps1-engine', 'r1');

const CHECKS = [
  {
    id: 'story-contract.test',
    cwd: 'packages/story-contract',
    command: 'npm test',
    gates: ['legacy-contract', 'G12.a-foundation'],
  },
  {
    id: 'game-ps1.build',
    cwd: 'game-ps1',
    command: 'npm run build',
    gates: ['G01', 'G16'],
    note: 'tsc --noEmit over src+test, then vite build of the legacy entries',
  },
  {
    id: 'game-ps1.test-creative',
    cwd: 'game-ps1',
    command: 'node --test test/creative/*.test.ts',
    gates: [
      'G01', 'G02', 'G02.a', 'G03', 'G04', 'G05', 'G06', 'G06.a', 'G07', 'G07.a', 'G08*', 'G09', 'G10',
      'G11', 'G11.a', 'G12', 'G12.a', 'G13', 'G14', 'G15', 'G15.a', 'G15.b', 'G16', 'G17', 'G17.a', 'G18', 'G19',
    ],
    note: 'G08 audio = AUDIO_SCHEDULING_ONLY; GPU/FPS/audible output NOT_MEASURED here',
  },
  {
    id: 'studio.build',
    cwd: 'studio',
    command: 'npm run build',
    gates: ['legacy-studio'],
  },
  {
    id: 'studio.test',
    cwd: 'studio',
    command: 'npm test',
    gates: ['legacy-studio'],
  },
  {
    id: 'skill.check',
    cwd: 'skills/story-to-ps1',
    command: 'npm run check',
    gates: ['G18'],
  },
  {
    id: 'skill.test-integration',
    cwd: 'skills/story-to-ps1',
    command: 'npm run test:integration',
    gates: ['G15', 'G18'],
  },
  {
    id: 'verify-ps1-studio.legacy',
    cwd: '.',
    command: 'node scripts/verify-ps1-studio.mjs --json',
    gates: ['legacy-static'],
  },
  {
    id: 'root.test',
    cwd: '.',
    command: 'npm test',
    gates: ['legacy-root'],
  },
];

function run(check) {
  const startedAt = new Date().toISOString();
  const res = spawnSync(check.command, {
    cwd: path.join(ROOT, check.cwd),
    shell: true,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 32 * 1024 * 1024,
    timeout: 10 * 60 * 1000,
  });
  const out = `${res.stdout ?? ''}\n${res.stderr ?? ''}`;
  return {
    id: check.id,
    cwd: check.cwd,
    command: check.command,
    gates: check.gates,
    note: check.note,
    startedAt,
    exitCode: res.status,
    signal: res.signal,
    status: res.status === 0 ? 'PASS' : 'FAIL',
    outputTail: out.trim().split('\n').slice(-25),
  };
}

function main() {
  const json = process.argv.includes('--json');
  const nodeVersion = process.version;
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
  const wip = spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).stdout
    .split('\n')
    .filter(Boolean);

  const results = CHECKS.map(run);
  const failed = results.filter((r) => r.status !== 'PASS');
  const report = {
    generatedAt: new Date().toISOString(),
    node: nodeVersion,
    head,
    workingTreeChanges: wip.length,
    checks: results,
    summary: {
      total: results.length,
      pass: results.length - failed.length,
      fail: failed.length,
      status: failed.length === 0 ? 'PASS' : 'FAIL',
    },
    evidenceLevels: {
      LOCAL_ENGINEERING: failed.length === 0 ? 'PASS' : 'FAIL',
      BROWSER_RENDER_AUDIO: 'see B-group results (b01-browser-smoke) — NOT part of this runner',
      CREATIVE_REVIEW: 'UNREVIEWED',
      PUBLIC_RELEASE: 'NOT_REQUESTED',
    },
  };
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'results.json'), JSON.stringify(report, null, 2));
  if (json) {
    console.log(JSON.stringify({ status: report.summary.status, pass: report.summary.pass, fail: report.summary.fail, checks: results.map((r) => ({ id: r.id, status: r.status, exitCode: r.exitCode })) }, null, 2));
  } else {
    for (const r of results) console.log(`${r.status === 'PASS' ? 'PASS' : 'FAIL'}  ${r.id}`);
    console.log(`overall: ${report.summary.status}`);
  }
  process.exit(failed.length === 0 ? 0 : 1);
}

main();
