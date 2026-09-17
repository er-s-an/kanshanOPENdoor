/**
 * Legacy save identity (G17): StoryPackage 1.0 saves keep their OWN identity
 * rule and are quarantined from new `experienceDigest` checkpoints.
 *
 * Identity rule (mirrors src/runtime/story-director.ts + save-store.ts, which
 * are read-only and not loadable under Node strip-only TS — save-store.ts
 * also uses a constructor parameter property — so the rule is reimplemented
 * here as pure functions):
 *
 * - packageDigest = pkg.packageDigest ?? pkg.source.digest
 *   (the optional build-manifest digest wins; the source digest is the
 *   fallback for packages exported before the compiler emitted one);
 * - legacy save slot key = `${packageDigest}:${saveSlotId}` with slot
 *   defaulting to 'default' (SaveStore constructor);
 * - the legacy envelope is the SaveEnvelope shape from
 *   src/runtime/types.ts: { packageDigest, saveSlotId, engineMajor,
 *   revision, state, lastCommittedEvent? }.
 *
 * Quarantine (tested in legacy-story-package.test.ts):
 * - new checkpoints bind `${experienceDigest}:${slot}` (see
 *   src/creative/state/checkpoint-store.ts `key`); a legacy key and a new key
 *   never share a slot string for the same content because the digest inputs
 *   are different canonicalizations ('kanshan-experience-identity' over
 *   code/params/assets/source vs the raw StoryPackage digest);
 * - even if a legacy envelope were addressed at the same key string, it can
 *   never hydrate a CheckpointStore: `checkpointRecordProblems` rejects it
 *   (no experienceDigest/slot/checkpointSchemaVersion fields), producing a
 *   `corrupt` outcome that is quarantined for reporting — never loaded.
 */
import type { StoryState } from '@kanshan/story-contract';

export const LEGACY_SAVE_SLOT_DEFAULT = 'default';
export const LEGACY_SAVE_ENGINE_MAJOR = 1;

/**
 * Structural input for the identity rule. `packageDigest` is the optional
 * build-manifest field from src/runtime/types.ts StoryPackage (the shared
 * contract type deliberately omits it — it is not part of schema 1.0.0), so
 * it is declared here structurally instead of via Pick<StoryPackage, ...>.
 */
export interface LegacyIdentityPackage {
  packageDigest?: string;
  source: { digest: string };
  runtime?: { engineMajor?: number };
}

/** Legacy save envelope — same shape as src/runtime/types.ts SaveEnvelope. */
export interface LegacySaveEnvelope {
  packageDigest: string;
  saveSlotId: string;
  engineMajor: number;
  revision: number;
  state: StoryState;
  lastCommittedEvent?: string;
}

/** pkg.packageDigest ?? pkg.source.digest (StoryDirector constructor rule). */
export function legacyPackageDigest(pkg: LegacyIdentityPackage): string {
  return pkg.packageDigest ?? pkg.source.digest;
}

/** `${packageDigest}:${slot}` — the SaveStore key rule. */
export function legacySaveSlotKey(pkg: LegacyIdentityPackage, slot: string = LEGACY_SAVE_SLOT_DEFAULT): string {
  return `${legacyPackageDigest(pkg)}:${slot}`;
}

export function createLegacySaveEnvelope(
  pkg: LegacyIdentityPackage,
  state: StoryState,
  revision: number,
  lastCommittedEvent?: string,
  saveSlotId: string = LEGACY_SAVE_SLOT_DEFAULT,
): LegacySaveEnvelope {
  const envelope: LegacySaveEnvelope = {
    packageDigest: legacyPackageDigest(pkg),
    saveSlotId,
    engineMajor: pkg.runtime?.engineMajor ?? LEGACY_SAVE_ENGINE_MAJOR,
    revision,
    state: {
      beatId: state.beatId,
      flags: { ...state.flags },
      inventory: [...state.inventory],
      collectedItems: [...state.collectedItems],
      knownFacts: [...state.knownFacts],
      ended: state.ended,
    },
  };
  if (lastCommittedEvent !== undefined) envelope.lastCommittedEvent = lastCommittedEvent;
  return envelope;
}
