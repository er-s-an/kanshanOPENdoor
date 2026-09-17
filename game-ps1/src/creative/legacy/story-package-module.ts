/**
 * G17 legacy StoryPackage adapter: hosts a legacy StoryPackage 1.0 inside the
 * new RuntimeSessionHost — EXPLICIT compatibility, never a silent format
 * upgrade (plans/ps1-creative-runtime-20260916 README §3.5).
 *
 * What the adapter does:
 * - Format gate: a `format` field (e.g. `kanshan-experience`) means the value
 *   is NOT a StoryPackage 1.0; it is rejected with an explicit
 *   MANIFEST_FORMAT error pointing at the experience loader. Unknown formats
 *   are rejected the same way.
 * - Validation gate: the REAL shared validator from
 *   `@kanshan/story-contract` (structure + semantics + bounded state-space)
 *   runs on load. Invalid packages reject with the validator's own
 *   diagnostics as a MANIFEST-style LegacyManifestError.
 * - Declared legacy normalization (opt-out via `opts.strict`): packages
 *   exported by the OLD studio pipeline may carry cues without provenance
 *   (the old player gate never checked it — see src/runtime/player.ts
 *   assertPackage). The only such gap the adapter repairs is missing cue
 *   provenance, backfilled as `{ kind: 'invented', spans: [], note }` — the
 *   honest provenance kind for unsourced presentation text — after which the
 *   package must pass the FULL validator or still reject. The normalization
 *   is declared: it is reported as a session diagnostic, exposed on handles
 *   (`normalized`, `validationDiagnostics`), and refresh an embedded
 *   `packageDigest` so the manifest stays self-consistent. Anything else
 *   invalid rejects with the validator's diagnostics; `strict: true` disables
 *   even this backfill.
 * - World: built by the faithful WorldAssembler subset in `./world.ts`
 *     (src/runtime/world-assembler.ts is not loadable under Node strip-only
 *     TS — constructor parameter property — so its construction logic is
 *     mirrored node-for-node there).
 * - Progression: turn-based, exactly like the old StoryDirector's reducer
 *     path — `handles.completeOption(optionId)` / `handles.confirmEnd()` run
 *   the SHARED pure reducer (`reduceStoryState`, same one Studio/static
 *   tools use) with session/revision fencing, then commit namespaced facts:
 *   'legacy.complete-option' / 'legacy.confirm-end'. The CommitLog idempotency
 *   key makes replays duplicates, never double-applied rewards. Completion is
 *   a public module path — no debug setState, no teleports; these commits
 *   count as player evidence.
 * - Scene swaps: when the reducer moves to a beat in another scene, the world
 *   is rebuilt under the same module root (disposeObject path on the old one).
 * - Query accessor: `handles.state()` exposes the old reducer state
 *   (StoryState), plus beat/revision/available options.
 * - Destroy: world dispose (detach + disposeObject), wrapper disposed, host
 *   scope disposals ran; handles observe `worldDisposed` / `scopeDisposed`.
 *
 * What is intentionally NOT ported from the old runtime (documented
 * deviations):
 * - HUD/cue presentation, async beat flow and the SaveStore IndexedDB
 *   persistence stay in the legacy browser entry (src/runtime/*). The host
 *   session is the runtime here; saves keep the legacy identity rule (see
 *   ./save-identity.ts) and old saves are quarantined from new
 *   experienceDigest checkpoints — the adapter never mixes the two.
 * - The spatial `isReachable` camera/raycast gate (player-shell concern; the
 *   old entry keeps it for browser play).
 */
import * as THREE from 'three';
import {
  conditionPasses,
  createInitialState,
  packageDigest as sharedPackageDigest,
  reduceStoryState,
  validateStoryPackage,
} from '@kanshan/story-contract';
import type {
  Beat,
  CompleteOptionEvent,
  ConfirmEndEvent,
  Diagnostic as ContractDiagnostic,
  StoryPackage,
  StoryState,
} from '@kanshan/story-contract';
import { CreativeError } from '../core/errors.ts';
import type { CommitReceipt } from '../core/events.ts';
import type { SceneContext, SceneInstance } from '../core/context.ts';
import { LegacyWorldAssembler, disposeObject } from './world.ts';
import { legacyPackageDigest, legacySaveSlotKey } from './save-identity.ts';

export const LEGACY_COMPLETE_OPTION_EVENT = 'legacy.complete-option';
export const LEGACY_CONFIRM_END_EVENT = 'legacy.confirm-end';
export const LEGACY_PROVENANCE_BACKFILL_CODE = 'LEGACY_PROVENANCE_BACKFILL';

const MAX_DIAGNOSTICS_IN_MESSAGE = 8;
const DEFAULT_BACKFILL_NOTE =
  'Legacy studio export without recorded cue provenance; marked "invented" by the G17 ' +
  'legacy adapter (declared normalization, see src/creative/legacy/story-package-module.ts).';

/** MANIFEST-style rejection carrying the shared validator's own diagnostics. */
export class LegacyManifestError extends CreativeError {
  readonly diagnostics: readonly ContractDiagnostic[];

  constructor(diagnostics: readonly ContractDiagnostic[]) {
    super('MANIFEST_INVALID', summarizeDiagnostics(diagnostics), { phase: 'create' });
    this.name = 'LegacyManifestError';
    this.diagnostics = diagnostics;
  }
}

/** Explicit rejection of unknown / new-format values fed to the legacy loader. */
export class LegacyFormatError extends CreativeError {
  constructor(message: string) {
    super('MANIFEST_FORMAT', message, { phase: 'create' });
    this.name = 'LegacyFormatError';
  }
}

export interface StoryPackageModuleOptions {
  /**
   * strict: true disables even the declared cue-provenance backfill — the
   * package bytes must pass the shared validator exactly as authored.
   * Default false (the legacy pipeline's real exports keep working).
   */
  strict?: boolean;
  /** Note recorded on backfilled cue provenance (auditable). */
  backfillNote?: string;
}

/** Tool/test-facing surface of a running legacy story session. */
export interface LegacyStoryHandles {
  readonly packageId: string;
  readonly packageDigest: string;
  /** Legacy save slot key (`${packageDigest}:${slot}`) — never a checkpoint key. */
  readonly saveSlotKey: string;
  /** True when the declared cue-provenance normalization ran on load. */
  readonly normalized: boolean;
  /** Validator diagnostics from the first pass (empty when already valid). */
  readonly validationDiagnostics: readonly ContractDiagnostic[];
  /** Reducer state (old StoryState), cloned. */
  state(): StoryState;
  /** Current beat definition. */
  beat(): Beat;
  /** Current save revision (reducer fencing). */
  revision(): number;
  /** Ids of options whose guards pass in the current state. */
  availableOptionIds(): string[];
  /** Public completion path: run the shared reducer + commit legacy.complete-option. */
  completeOption(optionId: string): CommitReceipt;
  /** Public end confirmation: commit legacy.confirm-end. */
  confirmEnd(): CommitReceipt;
  /** True once the world was disposed (destroy ran). */
  readonly worldDisposed: boolean;
  /** True once the host scope disposed (host.stop ran). */
  readonly scopeDisposed: boolean;
}

export interface LegacyStoryModule {
  create(ctx: SceneContext): Promise<SceneInstance & { handles: LegacyStoryHandles }>;
  /** Populated once create() resolves. */
  handles?: LegacyStoryHandles;
}

interface GateResult {
  pkg: StoryPackage;
  normalized: boolean;
  validationDiagnostics: readonly ContractDiagnostic[];
}

function summarizeDiagnostics(diagnostics: readonly ContractDiagnostic[]): string {
  const shown = diagnostics
    .slice(0, MAX_DIAGNOSTICS_IN_MESSAGE)
    .map((d) => `${d.code} ${d.path}: ${d.message}`);
  const more = diagnostics.length - shown.length;
  return (
    `StoryPackage failed shared validation with ${diagnostics.length} diagnostic(s): ` +
    shown.join(' | ') +
    (more > 0 ? ` | …and ${more} more` : '')
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const CUE_PROVENANCE_PATH = /\/(entry|options\/\d+\/cues)\/\d+\/provenance$/;

/** The one loadable legacy gap: a cue (entry or option) without provenance. */
function isCueProvenanceGap(diagnostic: ContractDiagnostic): boolean {
  // A missing cue provenance produces a pair at the same path:
  // STRUCTURE_REQUIRED "Missing required property 'provenance'" from the cue
  // boundary check, and STRUCTURE_TYPE "Expected an object." from the
  // follow-up provenance check. The path is unambiguous, the message is not.
  return (
    diagnostic.severity === 'error' &&
    (diagnostic.code === 'STRUCTURE_REQUIRED' || diagnostic.code === 'STRUCTURE_TYPE') &&
    CUE_PROVENANCE_PATH.test(diagnostic.path)
  );
}

/**
 * Declared normalization: attach invented provenance to every cue lacking it.
 * Operates on a deep clone; the input is never mutated.
 */
function backfillCueProvenance(input: unknown, note: string): unknown {
  const clone = structuredClone(input);
  if (!isRecord(clone)) return clone;
  const beats = clone.beats;
  if (!Array.isArray(beats)) return clone;
  for (const beat of beats) {
    if (!isRecord(beat)) continue;
    backfillCueList(beat.entry, note);
    if (Array.isArray(beat.options)) {
      for (const option of beat.options) {
        if (isRecord(option)) backfillCueList(option.cues, note);
      }
    }
  }
  return clone;
}

function backfillCueList(cues: unknown, note: string): void {
  if (!Array.isArray(cues)) return;
  for (const cue of cues) {
    if (isRecord(cue) && !Object.prototype.hasOwnProperty.call(cue, 'provenance')) {
      cue.provenance = { kind: 'invented', spans: [], note };
    }
  }
}

/** Run the real shared validator; apply the declared backfill when eligible. */
function validateLegacyPackage(input: unknown, opts: StoryPackageModuleOptions): GateResult {
  const first = validateStoryPackage(input);
  if (first.ok) {
    return { pkg: input as StoryPackage, normalized: false, validationDiagnostics: [] };
  }
  if (opts.strict) throw new LegacyManifestError(first.diagnostics);
  const gaps = first.diagnostics.filter(isCueProvenanceGap);
  const hasRequiredGap = first.diagnostics.some(
    (d) => d.code === 'STRUCTURE_REQUIRED' && CUE_PROVENANCE_PATH.test(d.path),
  );
  const otherErrors = first.diagnostics.filter((d) => d.severity === 'error' && !isCueProvenanceGap(d));
  if (gaps.length === 0 || !hasRequiredGap || otherErrors.length > 0) {
    throw new LegacyManifestError(first.diagnostics);
  }
  const backfilled = backfillCueProvenance(input, opts.backfillNote ?? DEFAULT_BACKFILL_NOTE);
  // An embedded build-manifest digest must stay consistent with the bytes it
  // describes after the declared normalization (identity rule is unchanged:
  // packageDigest ?? source.digest — see ./save-identity.ts).
  if (isRecord(backfilled) && typeof backfilled.packageDigest === 'string') {
    backfilled.packageDigest = sharedPackageDigest(backfilled);
  }
  const second = validateStoryPackage(backfilled);
  if (!second.ok) throw new LegacyManifestError(second.diagnostics);
  return { pkg: backfilled as StoryPackage, normalized: true, validationDiagnostics: first.diagnostics };
}

function requireBeat(pkg: StoryPackage, beatId: string): Beat {
  const beat = pkg.beats.find((candidate) => candidate.id === beatId);
  if (!beat) throw new CreativeError('UNKNOWN_BEAT', `Beat not found: ${beatId}`, { phase: 'create' });
  return beat;
}

/**
 * Build the SceneModule hosting one legacy StoryPackage. `pkg` is `unknown`
 * on purpose: the adapter owns the gate, so invalid/mixed input never
 * reaches the host as a typed lie.
 */
export function createStoryPackageModule(
  pkg: unknown,
  options: StoryPackageModuleOptions = {},
): LegacyStoryModule {
  const module: LegacyStoryModule = {
    async create(ctx: SceneContext): Promise<SceneInstance & { handles: LegacyStoryHandles }> {
      // 1. Explicit format gate (new/unknown formats are not StoryPackage 1.0).
      if (isRecord(pkg) && 'format' in pkg) {
        const format = pkg.format;
        if (format === 'kanshan-experience') {
          throw new LegacyFormatError(
            'format "kanshan-experience" is an ExperienceManifest, not a StoryPackage 1.0: ' +
              'load it through the experience loader, not the legacy adapter',
          );
        }
        throw new LegacyFormatError(
          `unknown package format ${JSON.stringify(format)}: the legacy adapter loads StoryPackage schemaVersion 1.0.0 only`,
        );
      }
      // 2. Shared validator gate (+ declared cue-provenance normalization).
      const gate = validateLegacyPackage(pkg, options);
      const story = gate.pkg;

      const packageId = story.id;
      const digest = legacyPackageDigest(story);
      const root = new THREE.Group();
      root.name = `legacy-story:${packageId}`;

      const world = new LegacyWorldAssembler();
      let state: StoryState = createInitialState(story);
      let beat = requireBeat(story, state.beatId);
      let revision = 0;
      let destroyed = false;
      let worldDisposed = false;
      let scopeDisposed = false;

      world.load(story, beat.sceneId, state, root);

      ctx.registerEventValidator('legacy.*', (payload) => {
        if (!isRecord(payload)) return 'payload must be an object';
        if (typeof payload.packageId !== 'string') return 'payload.packageId must be a string';
        if (typeof payload.beatId !== 'string') return 'payload.beatId must be a string';
        return true;
      });
      ctx.scope.defer(() => {
        scopeDisposed = true;
      });
      if (gate.normalized) {
        const backfilled = gate.validationDiagnostics.filter((d) => d.code === 'STRUCTURE_REQUIRED').length;
        ctx.report({
          code: LEGACY_PROVENANCE_BACKFILL_CODE,
          message:
            `legacy package "${packageId}" carried ${backfilled} cue(s) without provenance; ` +
            'backfilled as invented (declared G17 normalization) and re-validated clean',
          phase: 'create',
        });
      }

      const assertLive = (): void => {
        if (destroyed) {
          throw new CreativeError('INSTANCE_DESTROYED', 'legacy story instance has been destroyed', { phase: 'command' });
        }
      };

      const reduce = (event: CompleteOptionEvent | ConfirmEndEvent): { next: StoryState; nextRevision: number } => {
        const result = reduceStoryState(state, event, story, {
          fencing: { sessionId: ctx.session.sessionId, generation: ctx.session.generation, revision },
        });
        if (!result.accepted) {
          for (const diagnostic of result.diagnostics) {
            ctx.report({ code: diagnostic.code, message: diagnostic.message, phase: 'mechanics' });
          }
          const firstDiagnostic = result.diagnostics[0];
          throw new CreativeError(
            firstDiagnostic?.code ?? 'REDUCE_REJECTED',
            firstDiagnostic ? `${firstDiagnostic.code} ${firstDiagnostic.path}: ${firstDiagnostic.message}` : 'reducer rejected the event',
            { phase: 'mechanics' },
          );
        }
        return { next: result.state, nextRevision: result.revision };
      };

      /** Commit first, then apply: a commit failure leaves state untouched. */
      const applyAccepted = (next: StoryState, nextRevision: number): void => {
        state = next;
        revision = nextRevision;
        const nextBeat = requireBeat(story, state.beatId);
        const sceneChanged = nextBeat.sceneId !== beat.sceneId;
        beat = nextBeat;
        if (sceneChanged) {
          world.load(story, beat.sceneId, state, root);
        } else {
          world.update(state);
        }
      };

      const handles: LegacyStoryHandles = {
        packageId,
        packageDigest: digest,
        saveSlotKey: legacySaveSlotKey(story),
        normalized: gate.normalized,
        validationDiagnostics: gate.validationDiagnostics,
        state: () => ({
          beatId: state.beatId,
          flags: { ...state.flags },
          inventory: [...state.inventory],
          collectedItems: [...state.collectedItems],
          knownFacts: [...state.knownFacts],
          ended: state.ended,
        }),
        beat: () => beat,
        revision: () => revision,
        availableOptionIds: () =>
          beat.options.filter((option) => option.guards.every((guard) => conditionPasses(guard, state))).map((option) => option.id),
        completeOption: (optionId: string): CommitReceipt => {
          assertLive();
          const option = beat.options.find((candidate) => candidate.id === optionId);
          if (!option) {
            throw new CreativeError('UNKNOWN_OPTION', `beat '${beat.id}' has no option '${optionId}'`, { phase: 'mechanics' });
          }
          const event: CompleteOptionEvent = {
            eventId: `${ctx.session.sessionId}:g${ctx.session.generation}:${beat.id}:${option.id}:r${revision}`,
            sessionId: ctx.session.sessionId,
            expectedGeneration: ctx.session.generation,
            expectedRevision: revision,
            beatId: beat.id,
            type: 'complete-option',
            optionId: option.id,
          };
          const { next, nextRevision } = reduce(event);
          const receipt = ctx.commit(
            LEGACY_COMPLETE_OPTION_EVENT,
            { packageId, beatId: beat.id, optionId: option.id, nextBeatId: next.beatId, revision: nextRevision },
            event.eventId,
          );
          applyAccepted(next, nextRevision);
          return receipt;
        },
        confirmEnd: (): CommitReceipt => {
          assertLive();
          const event: ConfirmEndEvent = {
            eventId: `${ctx.session.sessionId}:g${ctx.session.generation}:${beat.id}:confirm-end:r${revision}`,
            sessionId: ctx.session.sessionId,
            expectedGeneration: ctx.session.generation,
            expectedRevision: revision,
            beatId: beat.id,
            type: 'confirm-end',
          };
          const { next, nextRevision } = reduce(event);
          const receipt = ctx.commit(
            LEGACY_CONFIRM_END_EVENT,
            { packageId, beatId: beat.id, revision: nextRevision },
            event.eventId,
          );
          applyAccepted(next, nextRevision);
          return receipt;
        },
        get worldDisposed() {
          return worldDisposed;
        },
        get scopeDisposed() {
          return scopeDisposed;
        },
      };

      const instance: SceneInstance & { handles: LegacyStoryHandles } = {
        root,
        handles,
        // Legacy stories are turn-based: no per-step mechanics. The host
        // still owns the fixed clock; progression happens exclusively
        // through the public completion path above.
        destroy() {
          destroyed = true;
          world.dispose();
          worldDisposed = true;
          disposeObject(root);
        },
      };
      module.handles = handles;
      return instance;
    },
  };
  return module;
}
