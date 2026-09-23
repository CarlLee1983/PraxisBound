import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPreflightReportRecord,
  MAX_DIAGNOSTICS,
  preflightReportsEqualExceptCheckedAt,
  validateStoredPreflightReportRecord,
} from "@praxisbound/core";

const FP = "a".repeat(64);
const BATCH_ID = "TST-9999-fixture";

function baseRecordInput(overrides = {}) {
  return {
    batchId: BATCH_ID,
    fingerprint: FP,
    outcome: "REVIEW_READY",
    checkedAt: "2026-09-23T00:00:00Z",
    confirmation: null,
    semanticReport: null,
    mechanical: [],
    semantic: [],
    expect: null,
    ...overrides,
  };
}

test("a record built by buildPreflightReportRecord round-trips through the stored validator", () => {
  const record = buildPreflightReportRecord(baseRecordInput());
  const validated = validateStoredPreflightReportRecord(record, BATCH_ID);
  assert.equal(validated.ok, true, JSON.stringify(validated));
  assert.equal(validated.record.schemaVersion, "1.0.0");
  assert.equal(validated.record.outcome, "REVIEW_READY");
});

test("a record whose batchId does not match the expected batch is rejected", () => {
  const record = buildPreflightReportRecord(baseRecordInput());
  const validated = validateStoredPreflightReportRecord(record, "OTHER-1");
  assert.equal(validated.ok, false);
});

test("an unsupported schemaVersion is rejected", () => {
  const record = {
    ...buildPreflightReportRecord(baseRecordInput()),
    schemaVersion: "9.9.9",
  };
  const validated = validateStoredPreflightReportRecord(record, BATCH_ID);
  assert.equal(validated.ok, false);
});

test("a diagnostic with an invalid code, severity, or over-length message is rejected", () => {
  const invalidCode = buildPreflightReportRecord(
    baseRecordInput({
      mechanical: [{ code: "not-a-code", severity: "blocking", message: "x" }],
    }),
  );
  assert.equal(
    validateStoredPreflightReportRecord(invalidCode, BATCH_ID).ok,
    false,
  );

  const invalidSeverity = buildPreflightReportRecord(
    baseRecordInput({
      mechanical: [
        { code: "REVIEW_SOURCE_MISSING", severity: "urgent", message: "x" },
      ],
    }),
  );
  assert.equal(
    validateStoredPreflightReportRecord(invalidSeverity, BATCH_ID).ok,
    false,
  );
});

test("contract §13: mechanical plus semantic over MAX_DIAGNOSTICS is rejected (the CLI's own ERROR/exit-3 bound relies on this same limit)", () => {
  const many = Array.from({ length: MAX_DIAGNOSTICS + 1 }, (_, index) => ({
    code: "REVIEW_RECORD_INVALID",
    severity: "advisory",
    message: `entry ${index}`,
  }));
  const record = buildPreflightReportRecord(
    baseRecordInput({ mechanical: many }),
  );
  const validated = validateStoredPreflightReportRecord(record, BATCH_ID);
  assert.equal(validated.ok, false);
});

test("exactly MAX_DIAGNOSTICS combined diagnostics is still accepted", () => {
  const half = Math.floor(MAX_DIAGNOSTICS / 2);
  const mechanical = Array.from({ length: half }, (_, index) => ({
    code: "REVIEW_RECORD_INVALID",
    severity: "advisory",
    message: `m${index}`,
  }));
  const semantic = Array.from(
    { length: MAX_DIAGNOSTICS - half },
    (_, index) => ({
      code: "REVIEW_SEMANTIC_OBSERVATION",
      severity: "advisory",
      message: `s${index}`,
    }),
  );
  const record = buildPreflightReportRecord(
    baseRecordInput({ mechanical, semantic }),
  );
  const validated = validateStoredPreflightReportRecord(record, BATCH_ID);
  assert.equal(validated.ok, true, JSON.stringify(validated));
});

test("preflightReportsEqualExceptCheckedAt ignores checkedAt but compares every other field, including expect", () => {
  const a = buildPreflightReportRecord(
    baseRecordInput({
      checkedAt: "2026-09-23T00:00:00Z",
      expect: { fingerprint: FP, revision: "b".repeat(40) },
    }),
  );
  const b = buildPreflightReportRecord(
    baseRecordInput({
      checkedAt: "2026-09-24T00:00:00Z",
      expect: { fingerprint: FP, revision: "b".repeat(40) },
    }),
  );
  assert.equal(preflightReportsEqualExceptCheckedAt(a, b), true);

  const differentExpect = buildPreflightReportRecord(
    baseRecordInput({
      checkedAt: "2026-09-24T00:00:00Z",
      expect: { fingerprint: FP, revision: "c".repeat(40) },
    }),
  );
  assert.equal(preflightReportsEqualExceptCheckedAt(a, differentExpect), false);
});

test("preflightReportsEqualExceptCheckedAt distinguishes a different outcome or diagnostic list", () => {
  const ready = buildPreflightReportRecord(baseRecordInput());
  const blocked = buildPreflightReportRecord(
    baseRecordInput({ outcome: "REVIEW_BLOCKED" }),
  );
  assert.equal(preflightReportsEqualExceptCheckedAt(ready, blocked), false);

  const withDiagnostic = buildPreflightReportRecord(
    baseRecordInput({
      mechanical: [
        { code: "REVIEW_RECORD_INVALID", severity: "advisory", message: "x" },
      ],
    }),
  );
  assert.equal(
    preflightReportsEqualExceptCheckedAt(ready, withDiagnostic),
    false,
  );
});
