/**
 * G12.a source-boundary helpers.
 *
 * Every fact an author marks is bound to the source text in one of three
 * kinds: 'sourced' (verbatim span), 'adapted' (derived from a span) or
 * 'invented' (no source backing — explicitly flagged, never disguised as
 * sourced). Validation is structural only: span bounds, codepoint length and
 * a SHA-256 digest of the normalized slice. A validation report NEVER claims
 * a human fidelity review — it reports structure checks and says so.
 *
 * Span offsets are character offsets into the RAW source text; validation
 * slices the raw text first, then normalizes the slice for comparison.
 * Normalization matches SPEC-02: strip BOM, CRLF -> LF, plus Unicode NFC.
 */

export type SourceKind = 'sourced' | 'adapted' | 'invented';

/** Character offsets [start, end) into the raw source text. */
export interface SourceSpan {
  start: number;
  end: number;
}

/** Structural binding to the source: digest + length of the normalized slice. */
export interface SourceBinding {
  digest: string;
  length: number;
}

export interface FactRecord {
  readonly kind: SourceKind;
  /** The fact content as the author wrote it. */
  readonly text: string;
  readonly span?: SourceSpan;
  readonly note?: string;
  readonly binding?: SourceBinding;
}

export type ProvenanceErrorCode =
  | 'BAD_SPAN'
  | 'SPAN_TEXT_MISMATCH'
  | 'INVENTED_WITH_SPAN'
  | 'SOURCE_TEXT_REQUIRED'
  | 'BAD_SOURCE_TEXT';

export class ProvenanceError extends Error {
  readonly code: ProvenanceErrorCode;

  constructor(code: ProvenanceErrorCode, message: string) {
    super(message);
    this.name = 'ProvenanceError';
    this.code = code;
  }
}

export function normalizeSourceText(input: string): string {
  if (typeof input !== 'string') throw new ProvenanceError('BAD_SOURCE_TEXT', 'source text must be a string');
  return input.replace(/^﻿/, '').replace(/\r\n?/g, '\n').normalize('NFC');
}

/** Digest + codepoint length of the normalized text. */
export function bindSourceText(text: string): SourceBinding {
  const normalized = normalizeSourceText(text);
  return { digest: sha256Hex(utf8Encode(normalized)), length: [...normalized].length };
}

export interface MarkFactInput {
  kind: SourceKind;
  text: string;
  span?: SourceSpan;
  note?: string;
}

/**
 * Build a fact record bound to the source. 'sourced' requires a valid span
 * whose normalized slice equals the fact text (verbatim claim); 'adapted'
 * requires a valid span but allows the text to differ; 'invented' forbids a
 * span — invented content is explicitly marked, never bound.
 */
export function markFact(input: MarkFactInput, sourceText?: string): FactRecord {
  const { kind, text, span, note } = input;
  if (kind === 'invented') {
    if (span) {
      throw new ProvenanceError('INVENTED_WITH_SPAN', 'invented facts must not claim a source span');
    }
    return { kind, text, note };
  }
  if (sourceText === undefined) {
    throw new ProvenanceError('SOURCE_TEXT_REQUIRED', `kind "${kind}" requires the source text to bind its span`);
  }
  assertSpan(span, sourceText);
  const binding = bindSourceText(sourceText.slice(span.start, span.end));
  if (kind === 'sourced' && normalizeSourceText(text) !== normalizeSourceText(sourceText.slice(span.start, span.end))) {
    throw new ProvenanceError(
      'SPAN_TEXT_MISMATCH',
      `sourced fact text does not match the normalized source slice [${span.start}, ${span.end})`,
    );
  }
  return { kind, text, span: { start: span.start, end: span.end }, note, binding };
}

/**
 * Re-validate a record against the actual source text. Returns the list of
 * structural issues (empty = ok). Never throws for content problems.
 */
export function validateSourceRecord(record: FactRecord, sourceText: string): string[] {
  const issues: string[] = [];
  if (typeof sourceText !== 'string') {
    issues.push('source-text-unavailable');
    return issues;
  }
  if (record.kind === 'invented') {
    if (record.span || record.binding) issues.push('invented-with-binding');
    return issues;
  }
  if (!record.span) {
    issues.push('missing-span');
    return issues;
  }
  const span = record.span;
  if (!Number.isInteger(span.start) || !Number.isInteger(span.end) || span.start < 0 || span.end > sourceText.length || span.start > span.end) {
    issues.push(`span-out-of-bounds [${span.start}, ${span.end}) for source length ${sourceText.length}`);
    return issues;
  }
  const expected = bindSourceText(sourceText.slice(span.start, span.end));
  if (!record.binding) {
    issues.push('missing-binding');
    return issues;
  }
  if (record.binding.length !== expected.length) {
    issues.push(`length-mismatch: recorded ${record.binding.length}, source slice has ${expected.length}`);
  }
  if (record.binding.digest !== expected.digest) {
    issues.push('digest-mismatch: recorded digest does not match the normalized source slice');
  }
  if (record.kind === 'sourced' && normalizeSourceText(record.text) !== normalizeSourceText(sourceText.slice(span.start, span.end))) {
    issues.push('sourced-text-mismatch: fact text differs from the normalized source slice');
  }
  return issues;
}

export interface ProvenanceIssue {
  index: number;
  text: string;
  issues: string[];
}

export interface ProvenanceReport {
  ok: boolean;
  total: number;
  byKind: Record<SourceKind, number>;
  /** Texts of invented facts — surfaced explicitly so nothing unbacked hides. */
  invented: string[];
  issues: ProvenanceIssue[];
  /** Structural checks only; this report never claims a human fidelity review. */
  review: {
    scope: 'structural';
    humanFidelityReview: 'not-performed';
    claimsHumanFidelityReview: false;
  };
}

export function buildProvenanceReport(records: readonly FactRecord[], sourceText?: string): ProvenanceReport {
  const byKind: Record<SourceKind, number> = { sourced: 0, adapted: 0, invented: 0 };
  const invented: string[] = [];
  const issues: ProvenanceIssue[] = [];
  records.forEach((record, index) => {
    byKind[record.kind] += 1;
    if (record.kind === 'invented') invented.push(record.text);
    if (sourceText !== undefined) {
      const found = validateSourceRecord(record, sourceText);
      if (found.length > 0) issues.push({ index, text: record.text, issues: found });
    }
  });
  return {
    ok: issues.length === 0,
    total: records.length,
    byKind,
    invented,
    issues,
    review: { scope: 'structural', humanFidelityReview: 'not-performed', claimsHumanFidelityReview: false },
  };
}

function assertSpan(span: SourceSpan | undefined, sourceText: string): asserts span is SourceSpan {
  if (!span || !Number.isInteger(span.start) || !Number.isInteger(span.end)) {
    throw new ProvenanceError('BAD_SPAN', 'span must be integer offsets { start, end }');
  }
  if (span.start < 0 || span.end > sourceText.length || span.start > span.end) {
    throw new ProvenanceError(
      'BAD_SPAN',
      `span [${span.start}, ${span.end}) is out of bounds for source length ${sourceText.length}`,
    );
  }
}

// ------------------------- portable SHA-256 -------------------------
// Same portable construction as packages/story-contract canonical.ts, kept
// local so this optional module has no package dependency.

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(value: number, amount: number): number {
  return (value >>> amount) | (value << (32 - amount));
}

function utf8Encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function sha256Hex(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? utf8Encode(input) : input;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const message = new Uint8Array(paddedLength);
  message.set(bytes);
  message[bytes.length] = 0x80;
  const bitLengthLow = (bytes.length << 3) >>> 0;
  const bitLengthHigh = Math.floor(bytes.length / 0x20000000);
  const tail = paddedLength - 8;
  message[tail] = (bitLengthHigh >>> 24) & 0xff;
  message[tail + 1] = (bitLengthHigh >>> 16) & 0xff;
  message[tail + 2] = (bitLengthHigh >>> 8) & 0xff;
  message[tail + 3] = bitLengthHigh & 0xff;
  message[tail + 4] = (bitLengthLow >>> 24) & 0xff;
  message[tail + 5] = (bitLengthLow >>> 16) & 0xff;
  message[tail + 6] = (bitLengthLow >>> 8) & 0xff;
  message[tail + 7] = bitLengthLow & 0xff;

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let offset = 0; offset < message.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      const index = offset + i * 4;
      w[i] = (
        (message[index] << 24) |
        (message[index + 1] << 16) |
        (message[index + 2] << 8) |
        message[index + 3]
      ) >>> 0;
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let i = 0; i < 64; i += 1) {
      const sigma1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + sigma1 + choice + K[i] + w[i]) >>> 0;
      const sigma0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sigma0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((word) => word.toString(16).padStart(8, '0'))
    .join('');
}
