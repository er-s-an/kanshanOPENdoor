# Tools reference — the real engine-cli surface (R1)

This is the operational command reference for the creative runtime tool protocol. The authority is `game-ps1/tools/commands.mjs` (frozen for R1); this file copies that surface with working examples. Commands were verified against the real CLI. When in doubt, trust `capabilities` and the engine source over this page.

## Envelope and exit codes

Every command prints exactly one JSON envelope on stdout:

```json
{ "toolVersion": "r1.0", "requestId": "req-...", "ok": true, "data": { }, "diagnostics": [] }
```

- `data` is bounded and versioned (per-command shapes below); `diagnostics` is a bounded list of `{code, message}`.
- Session-scoped results carry `sessionId` / `generation` / `tick` / `experienceDigest`; author results carry `experienceDigest` and revision ids.
- Process exit codes (from `tools/lib/envelope.mjs`): `0` ok · `2` invalid input/content · `3` missing/unavailable (incl. `NO_SESSION`, `MISSING_EXPERIENCE`) · `4` conflict (stale revision/session) · `5` execution failure.

The skill wrapper (`scripts/story-to-ps1.mjs`) forwards to this CLI without a shell and **passes exit codes through exactly**. Wrapper-only codes: `2` bad wrapper input, `3` no target CLI (`NOT_IMPLEMENTED`), `5` target unusable/no JSON.

## Discovery

```sh
node skills/story-to-ps1/scripts/story-to-ps1.mjs [--cli PATH] <command> [args]
```

Target resolution: `--cli PATH` > `STORY_TO_PS1_CLI` > `STORY_PS1_CLI` > repo default `<repo>/game-ps1/tools/engine-cli.mjs`. `--cli` may come before or after the command. Multi-word commands (`session start`, `author parameters list`, …) are matched by longest prefix and forwarded verbatim. Relative `--experience` paths resolve against the current working directory — run from `game-ps1/` (or pass absolute paths).

## capabilities

What is implemented, at what evidence level, with versions and limits. Always the first call of a session of work.

```sh
node skills/story-to-ps1/scripts/story-to-ps1.mjs capabilities
```

`data.systems[]` lists each system with `evidence: LOCAL_ENGINEERING | BROWSER_RENDER_AUDIO` and live `testEvidence` counts. `data.operations` groups the command families. `data.notMeasured` honestly lists `gpu`/`fps`/`screenshot` as `NOT_MEASURED` in a headless host — never claim them from a dependency name. `data.limits`: query default limit 200 / max 1000; clock fixedDt 1/60, max 5 catch-up steps; max 100,000 steps per `session step` call; daemon is 127.0.0.1 HTTP with a per-session bearer token, state under `game-ps1/.kanshan/sessions/`.

## session — controlled runs against a real RuntimeSessionHost

`session start` spawns a detached local daemon that owns a real session host running the experience's actual SceneModule (physics, controllers, mechanisms — not a fixture). All other session commands are authenticated RPCs to it.

```sh
# start (mode controlled = step-driven; auto = free-running). Returns handle + tick.
node skills/story-to-ps1/scripts/story-to-ps1.mjs session start --experience experiences/clockwork-flat --slot myrun
# -> data: { handle: { sessionId, generation, experienceDigest, buildId }, tick, mode, stateDir }

node skills/story-to-ps1/scripts/story-to-ps1.mjs session status  --session myrun
node skills/story-to-ps1/scripts/story-to-ps1.mjs session pause   --session myrun
node skills/story-to-ps1/scripts/story-to-ps1.mjs session resume  --session myrun
node skills/story-to-ps1/scripts/story-to-ps1.mjs session step    --session myrun --steps 300   # 1..100000
node skills/story-to-ps1/scripts/story-to-ps1.mjs session stop    --session myrun
```

Errors: `MISSING_EXPERIENCE` (exit 3) when the experience dir has no `experience.json`; `SESSION_CONFLICT` (exit 4) when the slot is already live; `NO_SESSION` (exit 3) once stopped or unknown; `SESSION_NOT_READY` (exit 3) if the daemon never became ready (check the `.log` next to the state file). Handles from a stopped session are rejected by generation fencing.

## query — bounded read-only views of the live session

```sh
node skills/story-to-ps1/scripts/story-to-ps1.mjs query scene   --session myrun --limit 200
node skills/story-to-ps1/scripts/story-to-ps1.mjs query object  --session myrun --handle obj-12
node skills/story-to-ps1/scripts/story-to-ps1.mjs query commits --session myrun
```

`query scene` returns a bounded flat object list (`handle`, `name`, `type`, `parent`, TRS, `visible`, `userDataKeys`; `authorId` when bound) with a `truncated` flag — never the whole tree dumped into context. `query commits` returns the session's committed fact/mechanism events (the idempotent, receipt-bound log). All are read-only.

## input — the only playability evidence

```sh
node skills/story-to-ps1/scripts/story-to-ps1.mjs input inject --session myrun \
  --events '[{"type":"key","code":"KeyW","state":"pressed"},{"type":"pointer","dx":40,"dy":0}]'
node skills/story-to-ps1/scripts/story-to-ps1.mjs input replay --session myrun --trace /tmp/route.json
```

Events are public input only: keys, pointer deltas, mouse/touch. There is no setState/teleport channel, so inject + step counts as player evidence. `--events` must be a non-empty JSON array (`INVALID_EVENTS`, exit 2 otherwise). `input replay` takes a trace recorded by `trace start` (kind `normal-input`).

## trace — record and replay public-input routes

```sh
node skills/story-to-ps1/scripts/story-to-ps1.mjs trace start --session myrun --out /tmp/route.json
node skills/story-to-ps1/scripts/story-to-ps1.mjs trace stop  --session myrun
```

Records per-step frames of public input events (max 500,000 frames per trace). Use it to capture the intended route, then replay it against fresh sessions — including after a checkpoint restore — and compare `query`/`observe` results.

## observe — real counters, honest gaps

```sh
node skills/story-to-ps1/scripts/story-to-ps1.mjs observe metrics --session myrun
node skills/story-to-ps1/scripts/story-to-ps1.mjs observe logs   --session myrun
```

`metrics` returns real counters (tick/time/discardedTime/commits/diagnostics/object counts). GPU time, FPS, and screenshots are `NOT_MEASURED` in the headless host — do not invent them.

## author — versioned parameter edits (code stays the source of truth)

```sh
node skills/story-to-ps1/scripts/story-to-ps1.mjs author parameters list --experience experiences/noop-patch
node skills/story-to-ps1/scripts/story-to-ps1.mjs author patch --experience experiences/noop-patch \
  --set spinSpeed=1.5 --base-revision <head-or-empty> --command-id my-cmd-1
node skills/story-to-ps1/scripts/story-to-ps1.mjs author undo --experience experiences/noop-patch --command-id my-cmd-2
node skills/story-to-ps1/scripts/story-to-ps1.mjs author redo --experience experiences/noop-patch --command-id my-cmd-2
```

`list` merges the module's exported `describeParameters()` (pure declaration; wins) with manifest `params`, showing current values, `schemaVersion`, and overrides. `patch` validates every value against the declared `validate` predicate, then commits a new immutable revision under `.kanshan/authoring/<experience>/`; it is idempotent per `command-id` and refuses stale bases (`REVISION_CONFLICT`, exit 4). `undo` is a new inverse edit, never a restoration of player progress. Invalid values reject and keep the old value (`INVALID_PARAM_VALUE`, exit 2).

## build / export

```sh
node skills/story-to-ps1/scripts/story-to-ps1.mjs build  --experience experiences/noop-patch --out /tmp/noop-build
node skills/story-to-ps1/scripts/story-to-ps1.mjs export --experience experiences/noop-patch --out /tmp/noop-bundle
```

`build`: real bundling of the entry module's dependency graph. Returns `buildId`, `experienceDigest`, `artifactDigest`, emitted `files[]` with byte sizes, and diagnostics. Failures name the file/line or asset — a failed build is a failed build.

`export`: the **private static bundle** deliverable — `index.html`, emitted assets, `experience.json`, `source.json`, `NOTICE.md` (dependency attribution), `report.json` (closure check: referenced vs missing assets; `rapierPresent` tells you whether unused physics WASM leaked in). The default deliverable is local-private; publishing needs a separate human decision.
