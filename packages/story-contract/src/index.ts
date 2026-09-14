import { digestJson, sha256Hex } from "./canonical.js";

export * from "./types.js";
export * from "./canonical.js";
export * from "./reducer.js";
export * from "./state-space.js";
export * from "./validate.js";
export * from "./fixture.js";

export const STORY_SCHEMA_VERSION = "1.0.0" as const;
export const STORY_SCHEMA_ID = "urn:kanshan:story-package:1.0.0" as const;

/** Normalize only the two source transformations allowed by SPEC-02. */
export function normalizeSourceText(input: string): string {
  if (typeof input !== "string") throw new TypeError("Source text must be a string");
  return input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

export function sourceDigest(input: string): { normalizedText: string; digest: string; codepointLength: number } {
  const normalizedText = normalizeSourceText(input);
  return { normalizedText, digest: sha256Hex(normalizedText), codepointLength: [...normalizedText].length };
}

export function packageDigest(pkg: unknown): string {
  return digestJson(pkg);
}
