# Architecture decisions (R1)

Living record. Each entry: decision, alternatives, consequences, status.

## AD-01 Physics adapter: @dimforge/rapier3d-compat pinned 0.20.0
- Status: DECIDED 2026-09-16 (M0).
- Verified on machine: `await RAPIER.init()` works headless in Node v25.9.0; `World`,
  `createCharacterController(offset)` with `setMaxSlopeClimbAngle`/`enableSnapToGround`,
  `castRay`, `castRayAndGetNormal`, `castShape`, `intersectionsWithRay` all present (smoke run, M0).
- License: Apache-2.0 (package.json of installed dist).
- Size: ~11 MB unpacked; single-file ESM with WASM inlined as base64 → bundles offline with Vite,
  no network fetch at runtime, no separate .wasm asset pipeline needed.
- Version choice: 0.12.0 was present extraneously in node_modules (not declared); latest is 0.20.0
  (2026-08). Pinned exact 0.20.0 via `--save-exact` for 4 years of character-controller fixes.
- Tree-shaking rule: only `creative/physics/**` may import it; works that never import physics
  must not get the WASM in their bundle (G01 check via bundle diff).
- Rejected: cannon-es (unmaintained), custom AABB-only (cannot do slopes/steps/moving platforms,
  and acceptance forbids fake colliders), Rapier non-compat `@dimforge/rapier3d` (separate .wasm
  loading complicates offline static export).

## AD-02 Single simulation clock, fixed step 1/60 default
- `SimulationClock` (creative/core/clock.ts): accumulator + maxCatchUpSteps (default 5) +
  maxFrameTime (0.25 s) + discardedTime diagnostics. Pause freezes sim time; resume(realNow)
  re-bases, so no giant catch-up dt. Manual `stepOnce` for controlled sessions only.
- Phase order per fixed step: input → intent → physics → mechanics → present (PHASE_ORDER,
  errors.ts). Module `update()` runs inside `mechanics` (after intent/physics hooks).
  `render()` hook runs interpolation with commits disabled (COMMIT_IN_RENDER).
- Not claimed: cross-browser/CPU physics determinism. Fixed step != deterministic replay.

## AD-03 Transform authority (write-access) model
- Declared, not yet enforced by systems (M2/M3 bind them): dynamic rigid body root = PhysicsWorld;
  player/NPC root = controller + physics correction (navigation gives intent only); kinematic
  mechanisms = mechanism phase + kinematic target (timeline gives target; collider and render pose
  share one source); cosmetic-only objects free; camera = active rig with control token.
- M0 implements the enforcement points: phase hooks + render-phase commit rejection.
  Physics/controller systems in M2 must route root motion through the adapter.

## AD-04 Identity: three histories, three digests
- `experienceDigest` (creative/core/identity.ts): canonical digest over {format, formatVersion,
  runtimeApiVersion, checkpointSchemaVersion, code files (relative logical paths only), params,
  asset content digests, sourceRecord}. Absolute/escaping paths rejected, never hashed. No build
  time, no machine paths, no logs/reports/self-reference — by construction (no such input fields).
- `artifactDigest`: bytes of emitted artifact (export integrity). `buildId`: task tracking only.
- Author undo, player checkpoint, revision/build are separate histories (S13/S14);
  author commands carry baseRevision + parameterSchemaVersion + commandId (protocol frozen in M5a).
- Reuses `canonicalJson`/`sha256Hex` from @kanshan/story-contract (single canonical primitive).
  The legacy studio `util.mjs` digest discrepancy (inventory finding) is a legacy-path defect to
  fix in M5 when wiring studio to the new identity, not by changing the canonical primitive.

## AD-05 RuntimeSessionHost protocol (M0 core frozen)
- In-process host (creative/core/host.ts) loads a SceneModule with an injectable THREE.Scene;
  headless sessions need no DOM/WebGL for the simulation part. Modes: `auto` (advance(realNow))
  and `controlled` (step(n) only). Manual step rejected while auto-running; advance rejected in
  controlled mode; stop() fences generation, invalidates handles, disposes scope.
- Queries are bounded (default 200, cap 1000, truncated flag) and read-only; object handles are
  session-scoped and cleared on stop.
- M5 will add: transport (CLI/JSON first), module loading from built bundles, persistence.
  Browser bridge consumes the same protocol; renderer/audio outputs are replaceable adapters,
  gameplay/colliders are not.

## AD-06 Exception isolation (G02.a)
- create/update/destroy throw → session enters `error`, scope still disposes (cleanup errors
  collected, not thrown through), diagnostics carry phase + best-effort source location
  (first non-runtime stack frame). Other sessions unaffected (each has own scope/scene/clock).

## AD-07 Node/runtime and TS test strategy
- Repo engines: node >=24. Machine default `node` is v22.0.0 (fails engines); all R1 commands run
  with /opt/homebrew/bin/node v25.9.0 on PATH. Recorded as environment deviation, not silently
  "fixed" by changing engines.
- Tests are TypeScript run via Node type-stripping (`node --test test/creative/*.test.ts`).
  Creative core is written in erasable-TS only (no enums/namespaces/parameter properties).
  tsc (5.9.3) type-checks with allowImportingTsExtensions + noEmit; Vite builds the same sources.

## AD-08 No global entity registry / no JSON DSL
- SceneModule = plain TS exporting create(ctx). Helpers are optional function libraries.
  Systems bind via small interfaces (physics body, mixer, sound, nav agent, persisted state,
  author parameter). Confirmed against ENGINE-SYSTEMS §1; no ECS layer will be added.
