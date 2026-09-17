# Animation, mechanism state, and the three histories

How animation, moving mechanisms, checkpoints, and edits interact in the creative runtime — and who is allowed to write which transform. The authorities are `src/creative/animation/`, `src/creative/physics/mechanisms.ts`, `src/creative/gameplay/state.ts`, and the R1 systems plan (ENGINE-SYSTEMS §2/§5/§8); this page is the working summary.

## Three equivalent animation paths

All three are first-class; do not force every motion into one DSL:

1. **Native procedural update** — read `frame.dt` / `frame.time` in the module's `update` and write Three objects directly. Right for ambient motion, simple movers, anything derived from time or mechanism state.
2. **Three Clip / AnimationMixer** — mixer-driven skeletal or property clips, `timeScale` for pause; the mixer is scope-tracked like any resource.
3. **Timeline plan nodes** (`src/creative/animation/timeline.ts`) — `sequence(...)`, `parallel(...)`, `wait(duration)`, `tween({...})`, `playClip(action, {duration?, fadeIn?})`, `cameraCut(rig)`, `cameraBlend(rig, duration, {easing?})`, `cue(name, payload?, {eventId?})`; `timeline(name, opts)` builds a `TimelineHandle` with `pause/resume/skip/cancel/update/finished`.

Timelines exist for cutscene-shaped work: camera moves, scripted beats, sound cues. A timeline may carry callbacks — it is ordinary TS, not a sandboxed mini-language. Timeline **scrub previews use isolated preview instances**: scrubbing never commits facts, awards objectives, or writes save data.

## Skip, cancel, and end states

Every timeline that touches gameplay declares its terminal semantics up front (`TimelineOptions`):

- `cancelPolicy`: `'freeze'` (default — targets stay), `'finish'` (jump to end state), `'revert'` (restore start values).
- `endState: { natural, skip }` — the declared natural-completion and skip end states. The implementation enforces one finalize code path, so natural completion and `skip()` cannot diverge; skip and natural play sound-cue commits exactly once per run.

Only timelines with a declared skip policy are skippable, and skip reaches the same semantic end state as natural completion. A timeline must never push a character through collision to hit a mark; mechanisms needing instant rebuilds reconstruct colliders from declared checkpoint state.

## Mechanisms and kinematic targets

`src/creative/physics/mechanisms.ts` provides `SlidingDoor`, `MovingPlatform`, and `driveMechanism(...)`: moving doors/lifts are **kinematic** — the mechanism phase owns the target, physics solves collision/carry (a platform carries its rider), and the render pose is the same source of truth as the collider pose. Never animate a door mesh on one timeline while a stale whole-wall collider keeps blocking the doorway.

Mechanism state (door phase, platform phase, puzzle combination, follow target) is declared state: your module owns its schema, `stateVersion`, event handling, serialization, and restore. Progress-gating animation is not decoration — it commits facts through the commit channel with idempotent receipts.

## Transform authority

When more than one system could write the same transform, this table decides (R1 §2):

| Object | Authoritative writer | How other systems participate |
| --- | --- | --- |
| Dynamic rigid-body root transform | `PhysicsWorld` | animation/scripts act via forces, velocities, or an explicit teleport — never per-frame mesh writes |
| Player/NPC root motion | the selected controller + physics correction | navigation supplies path/velocity intent; skeletal clips affect visual child nodes only (root motion disabled unless wired) |
| Doors / lifts / kinematic objects | mechanism phase via kinematic target | timeline may supply targets; collision and render pose share one source |
| Cloth-like/light/particle visuals with no collision meaning | scene script or presentation system | free-form update; no forced state serialization |
| Camera | the active camera rig | cutscenes switch via a control token and restore the previous rig on exit; screen shake never moves the character's authoritative position |

Dev-mode may warn when two scripts compete for one bound channel rather than banning native transform operations outright. A debug teleport is not player movement and must appear as a trace marker — it is never completion evidence.

## State categories — do not merge them

1. **Narrative facts** — what the player learned/decided, with provenance (`sourced`/`adapted`/`invented`), committed through explicit events.
2. **Mechanism state** — door phase, combination, follow target; module-declared schema, versioned, serialized/restored by the module.
3. **Presentation state** — breathing, sway, dust; derived from time/seed/mechanism state; does not belong in a checkpoint.

Every mechanism with progress picks a restore strategy:

- **`checkpoint`** — guarantee only return to the nearest stable node; uncommitted transitions restart or roll back to a declared stable state.
- **`resumable`** — persist phase/progress/seed needed to restore visual, collision, and semantic state consistently.

Test at least: pause mid-animation, refresh mid-door-open, save failure, completion callbacks after destroy, and duplicate completion events. A committed fact is never undone by pause; an uncommitted animation never awards progress silently. A failed migration never overwrites the original slot.

## The three histories

| History | Records | Write/restore |
| --- | --- | --- |
| Author undo/redo | explicit author edits outside code (exposed parameters, asset refs) | versioned author commands; undo is a new inverse edit and never restores player progress |
| Player checkpoint | module-declared mechanism/fact restore data | gameplay transaction + receipt, bound to `experienceDigest` + slot; incompatible schema needs an explicit migration |
| Revision/build | pinned code, params, assets, runtime, config | immutable revisions and build records; a new build invalidates old running instances — nothing writes back late |

Author parameter commands validate `baseRevision + schemaVersion + commandId`, land as new revisions, and refuse stale bases (`REVISION_CONFLICT`). Debug/editor/play mutations are labeled distinctly: a running transform drag never becomes an author edit, and never counts as player completion evidence.

## Commits: idempotent, receipt-bound, observable

`ctx.commit(name, payload, eventId)` is the only fact channel. Namespaced names (`harbor.signal-aligned`) with module-owned payload validators; `eventId` makes replays deduplicate — a replayed route commits each fact once, never double-applying rewards. `onCommit` listeners and `query commits` expose the log; checkpoint restore replays recorded commits by original eventId to rebuild idempotent sets.
