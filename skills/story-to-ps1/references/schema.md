# StoryPackage v1 reference

The machine-readable authority is [`story-package.schema.json`](story-package.schema.json), schema version `1.0.0`, using JSON Schema draft 2020-12. In this repository it is a release copy of `docs/ps1-studio/schema/story-package.schema.json`; the canonical schema is edited there and a packaging step must refresh this copy and verify its digest. The current release-copy SHA-256 is `9f86f898d332ab498efca6fd0d8159b9c53d7648d596597c46cef40aae9c7c71`. Do not maintain a divergent hand-written schema in the Skill.

## Top-level contract

Required fields are:

| Field | Meaning | P0 limit |
| --- | --- | --- |
| `schemaVersion` | Content contract version | `1.0.0` |
| `id`, `title` | Stable package identity and display title | id is lowercase kebab-case |
| `runtime` | Engine/template compatibility | engine 1, template 1 |
| `source` | Digest, boundary, extent, usage, and optional verified URL | source max 20,000 code points |
| `flags`, `items`, `facts` | Typed state and source-grounded knowledge | 8 / 8 / 32 |
| `scenes` | Template, spawn, objects, and interaction anchors | 1–2 scenes |
| `startBeat`, `beats` | Deterministic narrative graph | up to 40 beats |

`source.usage` is `private-prototype` or `authorized-public`; it is a workflow assertion supplied by the author, not a legal determination. `source.extent` records `excerpt` or `complete`, and `source.boundary` says exactly where the playable slice stops. `verifiedUrl` is optional and must be a real HTTPS URL supplied by the user or source review.

## Provenance and knowledge

Every `fact` and every `narration`/`dialogue` cue carries `provenance`:

- `sourced`: directly supported by one or more source spans;
- `adapted`: a faithful compression, paraphrase, or playable presentation of spans;
- `invented`: a creative addition with an explanatory note and no implied canon.

Sourced and adapted entries require at least one `span` (`start`, `end`) within the normalized source. `fact.kind` distinguishes `observed`, `reported`, `hypothesis`, and `unknown`; do not collapse an actor's hypothesis into an observed fact. A `knowledge` guard/effect tracks player knowledge separately from flags and inventory.

## Runtime-safe actions

An action is one of:

`inspect` / `talk` with an `anchorId`; `collect` / `use` with an `anchorId` and `itemId`; or `choose` / `end` without arbitrary code. An ordinary action beat has exactly one option; a choice beat has two to four; an end beat has no options. Guards are typed `flag`, `inventory`, or `knowledge`. Effects reuse those typed records and are applied by the deterministic runtime after the selected option's cues.

Scene objects use the allowlisted prefabs `table-v1`, `key-v1`, `door-v1`, `note-v1`, `person-v1`, and `plant-v1`; scene templates are `room-v1` and `courtyard-v1`. Positions are bounded numeric triples and anchors refer to an object in the same scene. There is no expression language, JavaScript callback, arbitrary asset path, network URL, or model hook in the package.

## What validation does not prove

Schema validation catches shape and bounded values only. It does not prove source fidelity, adaptation authorization, semantic reachability, collision-free natural navigation, actor-knowledge correctness, audio quality, device performance, or public release readiness. Those require the target's static diagnostics, browser playtest, and separate human review records.
