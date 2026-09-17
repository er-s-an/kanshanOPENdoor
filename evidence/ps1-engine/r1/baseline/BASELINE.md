# Baseline (M0 start)

- Date: 2026-09-16 (CST)
- HEAD: ff5c4f1db32fe558d0a66b1bb2103a6ae76dc894 (branch codex/initial-upload)
- WIP at start: only untracked plans/ps1-creative-runtime-20260916/ and plans/ps1-iteration-20260916/
- No AGENTS.md found in repo or ancestors (rechecked).
- Node: engines require >=24. Default PATH `node` is v22.0.0 (does NOT satisfy engines; lacks type stripping).
  `/opt/homebrew/bin/node` v25.9.0 satisfies and is used for all runs below (PATH prefix per command).
  Deviation recorded: engines say >=24, runs use v25.9.0; no Node 24 binary present on this machine.
- npm install state: game-ps1/studio/packages deps installed; @dimforge/rapier3d-compat 0.12.0 was present
  extraneously in game-ps1/node_modules (not in package.json/lockfile) — replaced by pinned 0.20.0 in M0.

## Baseline command results (full log: baseline-run.log)
- `npm --prefix packages/story-contract test` → 10/10 pass
- `npm --prefix game-ps1 run build` → pass (tsc --noEmit && vite build)
- `npm --prefix studio run build` / `test` → 3/3 pass
- `npm --prefix skills/story-to-ps1 run check` → pass (syntax only)
- `node scripts/verify-ps1-studio.mjs --json` → PASS (static checks; historical, not inherited as R1 evidence)
- root `npm test` → 1/1 pass

## Capability inventory
Three read-only inventory reports (game-ps1 runtime / studio+contract / skill+docs) are preserved verbatim
in inventory-swarm-raw.txt. Headline findings:
- game-ps1 is 4 divergent hosts (no shared clock, no fixed step, no teardown in engine layer).
- Fixed-template assumptions concentrated in runtime/types.ts + world-assembler.ts (2 templates, 6 prefabs).
- Two disagreeing digest functions: studio util.mjs JSON.stringify hash vs story-contract canonicalJson digest.
- Reusable verbatim: canonicalJson/sha256Hex, SaveStore CAS pattern, generation fencing, disposeObject,
  kit.ts geometry helpers, PS1 composite shader, SynthAudio primitives.
