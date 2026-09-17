# Freeze record — R1 pre-holdout freeze

Date: 2026-09-17. HEAD: ff5c4f1db32fe558d0a66b1bb2103a6ae76dc894 (+ working-tree changes of this R1 effort; no commits made).

Frozen surface (any change after this point invalidates holdout evidence):
- `game-ps1/src/creative/**` — core + all systems + legacy adapter
- `game-ps1/tools/**` — engine-cli, lib (session/build/author/caps), web UI
- `skills/story-to-ps1/**` — authoring Skill + wrapper + references

Hash manifest: `freeze-hashes.txt` (98 files, SHA-256 per file, sorted).
Manifest digest: `9333d14e033d25cafc307f27f0dedece9833f860d74edf4c3d36bc9ef8d6ca7c` (regenerated after the audit-response fixes below).

State at freeze: 519/519 creative tests pass; `tsc --noEmit` clean; skill check 7/7 + wrapper integration 8/8.

Post-freeze amendment (2026-09-17, recorded honestly): after the holdout work passed,
the following additions landed WITHOUT touching any API the works use — the holdout
(work 3) still passes unmodified, and the freeze hash manifest was regenerated above:
- `src/creative/boot/browser-player.ts` (browser player shell for playable static exports)
- session daemon: `inspect.physics` query kind + author-override application at session start
- `tools/commands.mjs`: added `query physics`; CLI longest-prefix dispatch fix
- session state dir override `KANSHAN_SESSIONS_ROOT` (test isolation fix)
- clockwork-flat: wired the declared-but-unwired Escape skip action (work file, found by B01)

Development samples built BEFORE freeze (used to shape the architecture):
1. `experiences/clockwork-flat` — first-person indoor mechanisms (sliding door, lift), timeline intro, checkpoint replay.
2. `experiences/signal-field` — top-down open field, NPC patrol/follow + perception, cross-scene persistence via two sessions + SessionStateBag.

Holdout rule: the third work is written after this freeze against a new brief, changing ONLY
work TS/assets/params/tests. If core/systems/Skill/tools must change, that is a generalization
failure: record the gap, fix, re-freeze, and pick a NEW brief.

Audit-response amendment (2026-09-17): external audit of de8c066 found export P0s
(F01/F02) + contract gaps (F03–F09). All fixed and re-verified; see
architecture-decisions.md AD-09. Notable: the export path was proven broken at
the pinned commit (real CLI exit 5), which also invalidates the reproducibility
of the earlier green aggregate run; the new aggregate includes a separate
browser tier (test/browser/) and export tests that failed-before/passed-after.
