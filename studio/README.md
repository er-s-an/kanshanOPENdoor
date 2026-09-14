# Kanshan PS1 Studio (P0 offline core)

This directory contains the first-party local services and lightweight UI used by the story-to-PS1 workflow. It is Node ESM with one local dependency, `@kanshan/story-contract`, so the CLI, service and PS1 Player share the same package contract.

## Run

```sh
npm --prefix studio run check
npm --prefix studio run build
npm --prefix studio test
npm --prefix studio run story -- capabilities
STORY_WORKSPACES=/tmp/kanshan-workspaces npm --prefix studio run server
```

The server binds to `127.0.0.1` and prints a per-process session token to stderr. API requests must send `x-story-studio-token`; the HTTP adapter rejects non-local Host/Origin values and wildcard CORS.

The host-agent offline path is:

1. `project create` stores source text and metadata in a file-backed workspace.
2. `revision import` accepts agent-authored analysis and a canonical `StoryPackage` blueprint.
3. `build`, `validate`, `preview`, and `export` operate on the exact revision.

`generate --mode provider` fails with `PROVIDER_UNAVAILABLE` when no explicit provider is configured. `generate --mode mock` is deterministic and marked `mock: true`; it is not AI/provider evidence. Browser validation is represented as `inconclusive` until a browser runner is installed. Public export consequently stays gated.

The package intentionally does not read credentials, fetch paid content, execute story-supplied code, or make provider calls implicitly. The exported private package contains only the deliberately playable story package and a manifest; raw source and authoring material stay in the workspace. The local browser shell is available at `/`; browser validation and public deployment remain explicit gates.
