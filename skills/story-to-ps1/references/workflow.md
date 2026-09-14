# Story-to-PS1 workflow

This reference is the operational checklist for `$story-to-ps1`. The repository includes a local Studio/CLI core, while provider calls, browser playtests and public release remain explicit gates rather than inferred success.

## 1. Inspect capabilities first

```sh
node skills/story-to-ps1/scripts/story-to-ps1.mjs capabilities --json
```

If the result is not `ok: true`, inspect `diagnostics`. `NOT_IMPLEMENTED` means the real target CLI is unavailable, not that generation succeeded in another mode. Do not proceed to `import`, `generate`, `build`, `validate`, or `preview` until the capability result names the available engine, schema, templates, actions, and provider modes. A target path can be supplied explicitly:

```sh
node skills/story-to-ps1/scripts/story-to-ps1.mjs --cli /absolute/path/to/story-cli capabilities --json
```

The wrapper accepts the command before or after `--cli`; it forwards only the command's own arguments to the target.

## 2. Author a bounded revision

Obtain the source text and an explicit purpose/usage statement from the user. Normalize text once and use Unicode code-point spans. Record:

- source digest, title, author, extent, and the exact stopping boundary;
- events and observations supported by the excerpt;
- what each actor knows, suspects, or does not know;
- each retained, adapted, and invented line or interaction;
- one or two scenes with a small number of anchors and a concrete player objective.

Prefer `inspect`, `collect`, `use`, `talk`, and `choose`. Keep a distinctive mechanic when it is expressible in the catalog; otherwise surface `CAPABILITY_GAP` instead of flattening it into an unexplained dialogue page. Do not add an ungrounded resolution after the excerpt boundary.

For host-agent authoring, write `analysis` and `blueprint` locally and import them. For provider authoring, use an explicitly configured provider. `mock` is allowed only for a labelled offline fixture and must never be described as provider-generated evidence.

## 3. Execute the deterministic chain

Use the real target CLI in this order, retaining every JSON result and request ID:

```sh
node skills/story-to-ps1/scripts/story-to-ps1.mjs import --project PROJECT --analysis analysis.json --blueprint blueprint.json --base-revision REVISION
node skills/story-to-ps1/scripts/story-to-ps1.mjs generate --project PROJECT --base-revision REVISION --mode provider --provider PROVIDER --max-calls 6 --max-repairs 2
node skills/story-to-ps1/scripts/story-to-ps1.mjs build --project PROJECT --revision REVISION
node skills/story-to-ps1/scripts/story-to-ps1.mjs validate --project PROJECT --revision REVISION --level static
node skills/story-to-ps1/scripts/story-to-ps1.mjs preview --project PROJECT --revision REVISION
```

`import` and `generate` are alternatives for creating authoring data; do not call both unless the target explicitly documents that sequence. `build` must be deterministic and offline. `validate --level browser` and `preview` count as run only when a real browser/player reports the requested revision. A screenshot, JSON Schema success, or debug teleport does not prove a natural playthrough.

## 4. Repair and stop

Repair only diagnostics that point to a concrete package field, state transition, spatial anchor, or source-provenance issue. Default to at most two repair rounds and keep a changed-path list. Never delete a core event solely to satisfy reachability. Stop with the strongest truthful status:

- `CAPABILITY_GAP`: the catalog or target cannot represent the requested mechanic;
- `NEEDS_REVIEW`: source interpretation, adaptation, or public-use decision needs a human;
- `NOT_IMPLEMENTED`: target tool or requested level is unavailable;
- `FAILED`: execution or validation failed;
- `NOT_RUN`: a requested browser/preview check was not performed.

Only call a package “playable” when the target's build, static validation, and browser playtest all succeed for the same immutable revision and the report shows its source boundary. Do not click approval or publish on the user's behalf.

## 5. Required handoff

Return the source digest and boundary, analysis, blueprint, package/manifest if created, exact revision and tool versions, validation/playtest reports, preview location if real, unresolved diagnostics, and whether the run was `host-agent`, configured `provider`, or labelled `mock`. Keep credentials, private source copies, model transcripts, and local author tokens out of exported public artifacts.
