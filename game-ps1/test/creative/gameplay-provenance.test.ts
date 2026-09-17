import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  markFact,
  validateSourceRecord,
  buildProvenanceReport,
  normalizeSourceText,
  bindSourceText,
  sha256Hex,
  ProvenanceError,
} from '../../src/creative/gameplay/provenance.ts';

const SOURCE = '﻿她因高度近视而看不清远处的人。\r\n仍选择把眼前的小孩当作需要照料的家人。';

test('sha256Hex matches node:crypto (independent cross-check)', () => {
  for (const sample of ['', 'abc', '中文文本\n第二行']) {
    const expected = createHash('sha256').update(sample, 'utf8').digest('hex');
    assert.equal(sha256Hex(sample), expected);
  }
});

test('normalizeSourceText strips BOM and CRLF, applies NFC', () => {
  const normalized = normalizeSourceText(SOURCE);
  assert.equal(normalized.startsWith('﻿'), false);
  assert.equal(normalized.includes('\r'), false);
  assert.equal(normalized, '她因高度近视而看不清远处的人。\n仍选择把眼前的小孩当作需要照料的家人。');
});

test('sourced fact binds digest/length of the normalized slice and validates clean', () => {
  const text = '她因高度近视而看不清远处的人。';
  const record = markFact({ kind: 'sourced', text, span: { start: 1, end: 1 + text.length } }, SOURCE);
  assert.equal(record.kind, 'sourced');
  assert.ok(record.binding);

  const expected = bindSourceText(text);
  assert.equal(record.binding.digest, expected.digest);
  assert.equal(record.binding.length, expected.length);
  assert.equal(validateSourceRecord(record, SOURCE).length, 0);
});

test('digest cross-checks against node:crypto over the normalized slice', () => {
  const text = '她因高度近视而看不清远处的人。';
  const slice = normalizeSourceText(SOURCE).split('\n')[0];
  const expected = createHash('sha256').update(slice, 'utf8').digest('hex');
  const record = markFact({ kind: 'sourced', text, span: { start: 1, end: 1 + text.length } }, SOURCE);
  assert.equal(record.binding?.digest, expected);
});

test('bad span rejected at mark time (out of bounds, non-integer)', () => {
  let caught: unknown = null;
  try {
    markFact({ kind: 'sourced', text: 'x', span: { start: 0, end: 99999 } }, SOURCE);
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof ProvenanceError);
  assert.equal(caught.code, 'BAD_SPAN');

  caught = null;
  try {
    markFact({ kind: 'adapted', text: 'x', span: { start: 2.5, end: 4 } }, SOURCE);
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof ProvenanceError);
  assert.equal(caught.code, 'BAD_SPAN');
});

test('sourced fact whose text differs from the slice is rejected (verbatim claim)', () => {
  let caught: unknown = null;
  try {
    markFact({ kind: 'sourced', text: '完全不同的句子。', span: { start: 1, end: 15 } }, SOURCE);
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof ProvenanceError);
  assert.equal(caught.code, 'SPAN_TEXT_MISMATCH');
});

test('adapted fact may paraphrase but still carries a structural binding', () => {
  const record = markFact(
    { kind: 'adapted', text: '近视的女主看不清远处，只看清眼前的小孩。', span: { start: 1, end: 1 + '她因高度近视而看不清远处的人。'.length }, note: 'paraphrase of line 1' },
    SOURCE,
  );
  assert.equal(record.kind, 'adapted');
  assert.ok(record.binding);
  assert.equal(validateSourceRecord(record, SOURCE).length, 0);
});

test('tampered digest or length is caught by validateSourceRecord', () => {
  const text = '她因高度近视而看不清远处的人。';
  const good = markFact({ kind: 'sourced', text, span: { start: 1, end: 1 + text.length } }, SOURCE);

  const badDigest = validateSourceRecord({ ...good, binding: { digest: '0'.repeat(64), length: good.binding!.length } }, SOURCE);
  assert.ok(badDigest.includes('digest-mismatch: recorded digest does not match the normalized source slice'));

  const badLength = validateSourceRecord({ ...good, binding: { digest: good.binding!.digest, length: 999 } }, SOURCE);
  assert.ok(badLength.some((i) => i.startsWith('length-mismatch')));
});

test('span validated against changed source text is caught', () => {
  const text = '她因高度近视而看不清远处的人。';
  const record = markFact({ kind: 'sourced', text, span: { start: 1, end: 1 + text.length } }, SOURCE);
  const issues = validateSourceRecord(record, '短文本');
  assert.ok(issues.some((i) => i.startsWith('span-out-of-bounds')));
});

test('invented content is explicitly marked and never bound; span on invented is an error', () => {
  const invented = markFact({ kind: 'invented', text: '七日后，大楼将会崩塌。', note: 'beyond chapter 1 cutoff' });
  assert.equal(invented.kind, 'invented');
  assert.equal(invented.binding, undefined);
  assert.equal(invented.span, undefined);
  assert.equal(validateSourceRecord(invented, SOURCE).length, 0);

  let caught: unknown = null;
  try {
    markFact({ kind: 'invented', text: 'x', span: { start: 0, end: 1 } }, SOURCE);
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof ProvenanceError);
  assert.equal(caught.code, 'INVENTED_WITH_SPAN');
});

test('sourced/adapted require the source text to bind', () => {
  let caught: unknown = null;
  try {
    markFact({ kind: 'sourced', text: 'x', span: { start: 0, end: 1 } });
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof ProvenanceError);
  assert.equal(caught.code, 'SOURCE_TEXT_REQUIRED');
});

test('report aggregates by kind, surfaces invented text, and never claims human fidelity review', () => {
  const line1 = '她因高度近视而看不清远处的人。';
  const records = [
    markFact({ kind: 'sourced', text: line1, span: { start: 1, end: 1 + line1.length } }, SOURCE),
    markFact({ kind: 'adapted', text: '她决定照料眼前的小孩。', span: { start: 16, end: 16 + '仍选择把眼前的小孩当作需要照料的家人。'.length } }, SOURCE),
    markFact({ kind: 'invented', text: '未知的后续剧情。' }),
  ];
  const report = buildProvenanceReport(records, SOURCE);
  assert.equal(report.ok, true);
  assert.equal(report.total, 3);
  assert.deepEqual(report.byKind, { sourced: 1, adapted: 1, invented: 1 });
  assert.deepEqual(report.invented, ['未知的后续剧情。']);
  assert.equal(report.review.scope, 'structural');
  assert.equal(report.review.humanFidelityReview, 'not-performed');
  assert.equal(report.review.claimsHumanFidelityReview, false, 'structure checks only — no human fidelity claim');
});

test('report flags structural issues and turns not-ok', () => {
  const line1 = '她因高度近视而看不清远处的人。';
  const good = markFact({ kind: 'sourced', text: line1, span: { start: 1, end: 1 + line1.length } }, SOURCE);
  const tampered = { ...good, binding: { digest: 'f'.repeat(64), length: good.binding!.length } };
  const report = buildProvenanceReport([good, tampered], SOURCE);
  assert.equal(report.ok, false);
  assert.equal(report.issues.length, 1);
  assert.equal(report.issues[0].index, 1);
});
