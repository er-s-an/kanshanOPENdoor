# Scene SDK reference — SceneModule, host context, helpers, parameters

The one-level authoring surface. A module is ordinary TypeScript/Three.js; helpers and engine systems are optional imports. There is no global entity registry, prefab catalog, or JSON DSL. The authority for signatures is `game-ps1/src/creative/` (esp. `core/context.ts`); this page is the working summary. Engine source imports use `.ts` extensions on relative paths and run on Node ≥ 24 type-stripping.

## The contract (`src/creative/core/context.ts`)

```ts
export interface SceneModule {
  create(ctx: SceneContext): SceneInstance | Promise<SceneInstance>;
}

export interface SceneInstance {
  readonly root: THREE.Object3D;       // host adds this to the scene
  update?(frame: FrameContext): void;  // per fixed simulation step — free-form code lives here
  render?(frame: FrameContext): void;  // optional interpolation hook; commits are rejected inside it
  activate?(): void;
  deactivate?(): void;
  destroy?(): void;                    // release owned resources, subscriptions, actions
}

export interface FrameContext {
  dt: number;      // fixed simulation step (=== clock.fixedDt during simulate)
  time: number;    // simulation time at this step
  tick: number;    // fixed-step counter
  alpha: number;   // interpolation factor (render frames only)
  phase: 'simulate' | 'render';
}
```

`SceneContext` gives you:

- `scene` — the host-owned `THREE.Scene`; attach `root` (or keep it detached and add children yourself, as the minimal examples do).
- `scope` — resource/subscription/task tracker. Own your geometry/materials/texture and let `scope` dispose them; shared cached assets are borrowed with reference counting. A late-loading asset must never re-attach to a destroyed scene.
- `clock` — read-only view (`fixedDt`, `time`, `tick`, `isPaused`). Modules never advance it; procedural animation reads simulation time from the frame.
- `session` — `{ sessionId, generation, experienceDigest, buildId }` identity for this instance.
- `commit(name, payload, eventId)` — commit a namespaced fact/mechanism event with an idempotency key; returns a receipt. Committed facts survive pause and replay deduplicates them.
- `registerEventValidator(namePrefix, validator)` / `onCommit(listener)` — typed payloads and observable commits.
- `onPhase(phase, fn)` — hook an additional fixed-step phase (`intent` | `physics` | `mechanics` | `present`).
- `report(diagnostic)` — emit a bounded, secret-free diagnostic attached to this session.

## Project layout

```
game-ps1/experiences/<id>/
├── experience.json     # manifest
├── source.json         # source record (see sources.md)
├── src/
│   ├── scene.ts        # the entry SceneModule — the work itself
│   ├── three.ts        # local re-export: `export * from 'three';`
│   └── ...             # your own modules, factories, assets
└── tests (engine suite: game-ps1/test/creative/work-<id>.test.ts)
```

`src/three.ts` exists so experience code imports `'./three.ts'` instead of bare `'three'`: packaged hosts alias it, and inside the repo it resolves to the engine package's single copy (one module instance per session). The build aliases bare `three` to the same copy when a fixture imports it directly, but the shim is the house style.

## experience.json (manifest)

```json
{
  "format": "kanshan-experience",
  "formatVersion": 1,
  "id": "clockwork-flat",
  "title": "…",
  "entry": "src/scene.ts",
  "runtimeApiVersion": "r1.0",
  "checkpointSchemaVersion": 1,
  "params": { "spinSpeed": 0.5 }
}
```

The manifest records entry and compatibility (`runtimeApiVersion`, `checkpointSchemaVersion`), optional manifest-level `params`, optional `assets` (`{key, path}` logical refs), and a `sourceRecord` ref. It does **not** enumerate walls/objects/animations and never embeds executable code strings. `experienceDigest` is computed from substantive inputs (code, deps, assets, params, source record, runtime, lockfile) — stable across clean directories, excluding temp paths, build times, and reports.

## Geometry: helpers are optional

`src/creative/scene/helpers.ts` returns `{ object, colliders }` — a plain Three object plus neutral collider descriptions (`ColliderDesc[]` from `core/spatial.ts`) that the physics adapter turns into real colliders:

- `wallSegment({ length, height, thickness, material?, position?, yaw? })` — origin at the center of the bottom face; spans x ∈ [-length/2, length/2], y ∈ [0, height].
- `wallWithOpening({ …, opening: { kind: 'door'|'window'|'custom', width, height, sillHeight?, offsetX? } })` — openings are geometrically real: the mesh decomposes into sub-boxes and colliders describe the wall minus the opening, never one whole-wall box. A visible doorway must also be passable.
- `floorPolygon(points, { material?, y? })` — non-rectangular floors from an XZ point loop.
- `wallRun(points, { height, thickness, join?: 'butt'|'miter' })` — per-edge walls along a polygon; `miter` closes outer corners (exact at 90°).
- `placeOnFloorY(object, floorY)`, `faceToward(object, target)` — small placement utilities.

You may use, bypass, or replace any of them: irregular walls can be multi-segment boxes or `THREE.Shape` + `ExtrudeGeometry`; a concave collider approximation must be declared as such, not passed off as exact. Colliders and visible mesh must come from the same source of truth — the render pose and collision pose are never two timelines.

## Composition is ordinary code

Reusable factories are plain local functions that return `THREE.Group` (or any `Object3D`) plus optional system bindings — window frames, shelves, NPC constructors; nest them freely. Nothing must be registered with the engine first. When you bind an optional system, bind the small interface only:

- physics: `installPhysics(...)` → `PhysicsWorld`; bodies/colliders from your geometry.
- input: an `InputDevice` + `ActionMapper` → your controller (see `controllers/`, `input/`).
- audio: `AudioGraph` + `AudioPlayer` over an injectable backend (`RecordingBackend` headless, `RealBackend` in a page).
- camera: `CameraDirector` + rigs; cutscenes hold a control token and hand it back.
- UI: `Hud` over a `DocumentLike` (`FakeDocument` headless, DOM in a page).
- gameplay: `createState`, `ObjectiveTracker`, dialogue/inventory — typed events, serializable snapshots.

If the design does not need a system, do not import it — unused systems stay out of the bundle (the `noop-patch` fixture proves the rapier WASM stays out when physics is unused).

## Author parameters (`src/creative/scene/authoring.ts`)

```ts
export function describeParameters(): ParameterDef[] { /* pure data + validate predicates */ }

const parameters = exposeParameters([{
  authorId: 'clockwork.door-width',
  schemaVersion: 1,
  description: '滑门门板宽度（米）；重建机关后生效',
  value: 1.4,
  validate(v: unknown) { return typeof v === 'number' && v >= 0.9 && v <= 2.0 ? true : 'door-width 需在 0.9..2.0 米之间'; },
  apply(v: number) { rebuildDoor(v); },
}]);
parameters.get('clockwork.door-width')?.onChange((v) => { /* hot-update */ });
```

- `authorId` is your stable declared identity; unique per registry. Runtime-created meshes may carry only instance handles — not everything needs a permanent ID.
- `validate` returns `true` or a rejection reason; invalid values keep the old value.
- The entry module may export `describeParameters()` as a **pure** declaration (no SceneContext) so `author parameters list` can read parameters without running gameplay; when present it wins, manifest `params` fill the gaps. Code stays the source of truth.
- `snapshot()` carries only `{ authorId, schemaVersion, value }` — never functions.
- Versioned author commands (patch/undo/redo) are permanent author edits under `.kanshan/authoring/<experience>/`, completely separate from player checkpoints. See [animation-state.md](animation-state.md) for the three-histories rules and [tools.md](tools.md) for the CLI.
