# Build, run, debug, deliver

The feedback loop for experience projects: real build → real session → inspect → local fix → private bundle. All commands below go through the skill wrapper (`node skills/story-to-ps1/scripts/story-to-ps1.mjs …`); see [tools.md](tools.md) for the full surface and exit-code contract.

## Build and export semantics

`build --experience <dir> --out <dir>` runs a real bundler over the entry module's dependency graph. A successful result carries `buildId`, `experienceDigest`, `artifactDigest` (output bytes), `runtimeApiVersion`, the emitted `entry`, and a `files[]` listing with byte sizes. A failed build fails — diagnostics name the file/line or asset. Never present a schema/JSON check, a type check, or an explainer page as a build.

`export --experience <dir> --out <dir>` produces the **private static bundle**: `index.html`, emitted assets, `experience.json`, `source.json`, `NOTICE.md` (dependency/attribution), and `report.json` with the asset-closure check (`referenced` vs `missing`) and `rapierPresent` — `false` proves unused physics WASM stayed out. `artifactDigestScope` tells you exactly which files the digest covers. Publishing a bundle is a separate human decision, not a build flag.

## The run/inspect loop

```sh
W="node skills/story-to-ps1/scripts/story-to-ps1.mjs"
cd game-ps1

$W session start --experience experiences/<id> --slot fix1
$W session step --session fix1 --steps 60        # controlled mode: you own the clock
$W query scene --session fix1 --limit 200        # bounded flat view + truncated flag
$W query object --session fix1 --handle obj-12   # one object
$W query commits --session fix1                  # committed facts/mechanism events
$W observe metrics --session fix1                # tick/time/commits/diagnostics/object counts
$W observe logs --session fix1                   # session diagnostics
$W trace start --session fix1 --out /tmp/route.json
$W input inject --session fix1 --events '[...]'  # public input only
$W input replay --session fix1 --trace /tmp/route.json
$W session stop --session fix1
```

Rules that keep the evidence honest:

- **Public input only.** Keys/pointer/touch through `input inject`/`input replay` are playability evidence; `setState`/teleport are not available and must not be emulated by editing coordinates mid-run. A debug teleport is not player movement.
- **Traces are the regression net.** Record the intended route once; replay it after every fix and after checkpoint restores; compare `query`/`observe` before vs. after. `query commits` shows idempotent receipts — replayed runs never double-apply facts.
- **Bounded returns.** Queries are capped (`--limit`, default 200 / max 1000) with a `truncated` flag — inspect, never dump the world into context.
- **Honest gaps.** GPU/FPS/screenshot are `NOT_MEASURED` headless; browser-only output is only claimed from a browser host. Offline tests prove scheduling/state, not that sound sounds right or that the picture reads well — see the vision-in-the-loop habit in SKILL.md.

## Locate and locally fix

When something fails:

1. Read the diagnostic; map it to the file/line, asset, or mechanism event it names. Build errors point into `src/scene.ts` or your local modules; session errors name the session and phase.
2. Fix locally in the experience project — the project code is yours to edit. Helpers are ordinary functions: copy, adapt, or bypass them; write the mechanism directly when that is clearer.
3. Rebuild and replay the same recorded route; diff `query`/`observe` results.
4. Same root cause failing repeatedly → stop and report the blocker with diagnostics and a changed-path list.

Never delete a distinctive mechanic to force a green build, and never downgrade a free-code brief into a legacy catalog package when it struggles. Distinguish the two kinds of "can't":

- **No helper** → not a gap. Write the code (custom geometry, own animation, own interaction).
- **True host gap** → `CAPABILITY_GAP`, quoted against `capabilities` evidence levels, only after checking the real surface.

## Author-time edits during the loop

When a fix is better expressed as an exposed parameter than a code edit (door width, speeds, palette): `author parameters list` reads the module's declared parameters; `author patch --set authorId=value --base-revision <head> --command-id <id>` lands a validated, idempotent, versioned revision; `author undo|redo` walks the author history. Validation failures keep the old value. These edits are author history — they never rewrite player checkpoints and never count as playability evidence. Code remains the source of truth.

## Deliverable checklist

- [ ] `source.json` complete (provenance, boundary, usage) — see [sources.md](sources.md).
- [ ] `build` ok with digests; `export` ok with `NOTICE.md` + closure `missing: 0`.
- [ ] Session evidence: recorded trace replayed to the objective; mid-route checkpoint restore replayed too.
- [ ] `observe metrics` attached; `NOT_MEASURED` items listed, not glossed.
- [ ] Parameter changes (if any) via versioned author commands with ids.
- [ ] Unverified scope stated; no publish step executed.
