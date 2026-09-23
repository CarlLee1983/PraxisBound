/**
 * The Preflight Report record (contract §2, §9, §13; Story TST-027):
 * building one immutable record from an `evaluatePreflight` result and the
 * evidence around it, validating a stored one against
 * `preflight-report.schema.json`/`defs.schema.json`, and the "equal except
 * `checkedAt`" comparison contract §2's 修訂性澄清（R-007）deduplication
 * rule needs. Hand written against the schema, sharing primitives with the
 * other record validators via `revision-limits.ts` (the same pattern
 * `confirmation.ts` uses for `validateStoredConfirmationRecord`). This
 * module never touches a filesystem, process, or clock.
 */

import type { PreflightOutcome } from "./preflight.js";
import {
  BATCH_ID_PATTERN,
  MAX_BATCH_ID_LENGTH,
  MAX_TEXT_BYTES,
  REPO_PATH_PATTERN,
  SHA256_PATTERN,
  boundedStringProblem,
  isRecord,
  isUtcDateTime,
  problem,
  unknownKey,
  utf8Length,
  validateLocatorShape,
  type FieldProblem,
} from "./revision-limits.js";
import type { ReviewDiagnostic } from "./types.js";

/** Contract §13: a Preflight Report's `mechanical` plus `semantic` diagnostics never exceed this bound; over it is `ERROR`, exit 3 (the CLI's own check, review round 2 L4, uses this instead of a literal). */
export const MAX_DIAGNOSTICS = 10000;
const ISSUE_CODE_PATTERN = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;
const SEVERITIES = ["blocking", "advisory"] as const;
// Matches the schema's own forbidden-newline-family pattern for
// `diagnostic.message` (defs.schema.json).
// eslint-disable-next-line no-control-regex
const MESSAGE_FORBIDDEN_PATTERN = new RegExp("[\r\n\u0085\u2028\u2029]");
const REVISION_HEX_PATTERN = /^[a-f0-9]{40}$/;
const OUTCOMES: readonly PreflightOutcome[] = [
  "REVIEW_READY",
  "REVIEW_BLOCKED",
  "REVIEW_INCOMPLETE",
  "REVIEW_STALE",
];

export interface PreflightReportRecordRef {
  readonly path: string;
  readonly sha256: string;
}

export interface PreflightReportSemanticReportRef {
  readonly sha256: string;
}

export interface PreflightReportExpect {
  readonly fingerprint: string;
  readonly revision: string;
}

export interface PreflightReportRecord {
  readonly schemaVersion: "1.0.0";
  readonly batchId: string;
  readonly fingerprint: string;
  readonly outcome: PreflightOutcome;
  readonly checkedAt: string;
  readonly confirmation: PreflightReportRecordRef | null;
  /** Always `null` in this Story (checked for existence only); TST-028 fills it from the parsed Semantic Report. */
  readonly semanticReport: PreflightReportSemanticReportRef | null;
  readonly mechanical: readonly ReviewDiagnostic[];
  /** Always `[]` in this Story; TST-028 fills it. */
  readonly semantic: readonly ReviewDiagnostic[];
  readonly expect: PreflightReportExpect | null;
}

/** Builds one immutable Preflight Report record; a pure projection, no validation (the caller validates before writing, mirroring `buildConfirmationRecordBytes`'s H2 defense in depth). */
export function buildPreflightReportRecord(
  input: Omit<PreflightReportRecord, "schemaVersion">,
): PreflightReportRecord {
  return Object.freeze({
    schemaVersion: "1.0.0",
    batchId: input.batchId,
    fingerprint: input.fingerprint,
    outcome: input.outcome,
    checkedAt: input.checkedAt,
    confirmation: input.confirmation,
    semanticReport: input.semanticReport,
    mechanical: Object.freeze([...input.mechanical]),
    semantic: Object.freeze([...input.semantic]),
    expect: input.expect,
  });
}

/**
 * Fields compared for R7's deduplication rule: every field except
 * `checkedAt` (contract §2 「除 checkedAt 外全同」). Order-sensitive for the
 * diagnostic arrays, since Core's `evaluatePreflight` already returns them
 * in one deterministic order and a reordering would itself be a change.
 */
export function preflightReportsEqualExceptCheckedAt(
  a: PreflightReportRecord,
  b: PreflightReportRecord,
): boolean {
  return (
    a.schemaVersion === b.schemaVersion &&
    a.batchId === b.batchId &&
    a.fingerprint === b.fingerprint &&
    a.outcome === b.outcome &&
    recordRefEqual(a.confirmation, b.confirmation) &&
    semanticReportRefEqual(a.semanticReport, b.semanticReport) &&
    diagnosticsEqual(a.mechanical, b.mechanical) &&
    diagnosticsEqual(a.semantic, b.semantic) &&
    expectEqual(a.expect, b.expect)
  );
}

function recordRefEqual(
  a: PreflightReportRecordRef | null,
  b: PreflightReportRecordRef | null,
): boolean {
  if (a === null || b === null) return a === b;
  return a.path === b.path && a.sha256 === b.sha256;
}

function semanticReportRefEqual(
  a: PreflightReportSemanticReportRef | null,
  b: PreflightReportSemanticReportRef | null,
): boolean {
  if (a === null || b === null) return a === b;
  return a.sha256 === b.sha256;
}

function expectEqual(
  a: PreflightReportExpect | null,
  b: PreflightReportExpect | null,
): boolean {
  if (a === null || b === null) return a === b;
  return a.fingerprint === b.fingerprint && a.revision === b.revision;
}

function diagnosticEqual(a: ReviewDiagnostic, b: ReviewDiagnostic): boolean {
  return (
    a.code === b.code &&
    a.severity === b.severity &&
    a.message === b.message &&
    a.path === b.path &&
    a.locator?.path === b.locator?.path &&
    a.locator?.anchor === b.locator?.anchor &&
    a.locator?.blockSha256 === b.locator?.blockSha256
  );
}

function diagnosticsEqual(
  a: readonly ReviewDiagnostic[],
  b: readonly ReviewDiagnostic[],
): boolean {
  if (a.length !== b.length) return false;
  return a.every((entry, index) =>
    diagnosticEqual(entry, b[index] as ReviewDiagnostic),
  );
}

function recordRefProblem(
  value: unknown,
  name: string,
): FieldProblem | undefined {
  if (!isRecord(value)) return problem(`${name} must be an object or null`);
  const extra = unknownKey(value, ["path", "sha256"]);
  if (extra !== undefined) return problem(`${name} has an unknown field`);
  const pathProblem = boundedStringProblem(value.path, `${name} path`);
  if (pathProblem) return pathProblem;
  if (!REPO_PATH_PATTERN.test(value.path as string))
    return problem(`${name} path has an invalid form`);
  if (typeof value.sha256 !== "string" || !SHA256_PATTERN.test(value.sha256))
    return problem(`${name} sha256 has an invalid form`);
  return undefined;
}

function diagnosticProblem(value: unknown): FieldProblem | undefined {
  if (!isRecord(value)) return problem("each diagnostic must be an object");
  const extra = unknownKey(value, [
    "code",
    "severity",
    "message",
    "path",
    "locator",
  ]);
  if (extra !== undefined) return problem("diagnostic has an unknown field");
  if (typeof value.code !== "string" || !ISSUE_CODE_PATTERN.test(value.code))
    return problem("diagnostic code has an invalid form");
  if (
    typeof value.severity !== "string" ||
    !(SEVERITIES as readonly string[]).includes(value.severity)
  )
    return problem("diagnostic severity has an invalid value");
  if (
    typeof value.message !== "string" ||
    value.message.length === 0 ||
    utf8Length(value.message) > MAX_TEXT_BYTES ||
    value.message.length > 4096 ||
    MESSAGE_FORBIDDEN_PATTERN.test(value.message)
  )
    return problem("diagnostic message has an invalid form");
  if (value.path !== undefined) {
    if (typeof value.path !== "string" || !REPO_PATH_PATTERN.test(value.path))
      return problem("diagnostic path has an invalid form");
  }
  if (value.locator !== undefined) {
    const locatorProblem = validateLocatorShape(value.locator);
    if (locatorProblem) return locatorProblem;
  }
  return undefined;
}

function diagnosticsArrayProblem(
  value: unknown,
  name: string,
): FieldProblem | undefined {
  if (!Array.isArray(value)) return problem(`${name} must be an array`);
  if (value.length > MAX_DIAGNOSTICS)
    return problem(
      `${name} count exceeds the limit (${MAX_DIAGNOSTICS})`,
      true,
    );
  for (const entry of value) {
    const found = diagnosticProblem(entry);
    if (found) return found;
  }
  return undefined;
}

const RECORD_KEYS = [
  "schemaVersion",
  "batchId",
  "fingerprint",
  "outcome",
  "checkedAt",
  "confirmation",
  "semanticReport",
  "mechanical",
  "semantic",
  "expect",
];

/** Same field-by-field shape as `preflight-report.schema.json`'s top level, plus §13's diagnostics-count bound. */
function validatePreflightReportShape(
  data: unknown,
  expectedBatchId: string,
): FieldProblem | undefined {
  if (!isRecord(data))
    return problem("data does not match the expected schema");
  if (data.schemaVersion !== "1.0.0")
    return problem("schemaVersion is not supported", false, true);
  const extra = unknownKey(data, RECORD_KEYS);
  if (extra !== undefined)
    return problem("preflight report record has an unknown field");
  if (
    typeof data.batchId !== "string" ||
    data.batchId.length > MAX_BATCH_ID_LENGTH ||
    !BATCH_ID_PATTERN.test(data.batchId)
  )
    return problem("batchId has an invalid form");
  if (data.batchId !== expectedBatchId)
    return problem("batchId does not match the current batch");
  if (
    typeof data.fingerprint !== "string" ||
    !SHA256_PATTERN.test(data.fingerprint)
  )
    return problem("fingerprint has an invalid form");
  if (
    typeof data.outcome !== "string" ||
    !(OUTCOMES as readonly string[]).includes(data.outcome)
  )
    return problem("outcome has an invalid value");
  if (!isUtcDateTime(data.checkedAt))
    return problem("checkedAt must be a UTC date-time");
  if (data.confirmation !== null) {
    const found = recordRefProblem(data.confirmation, "confirmation");
    if (found) return found;
  }
  if (data.semanticReport !== null) {
    if (!isRecord(data.semanticReport))
      return problem("semanticReport must be an object or null");
    const extra2 = unknownKey(data.semanticReport, ["sha256"]);
    if (extra2 !== undefined)
      return problem("semanticReport has an unknown field");
    if (
      typeof data.semanticReport.sha256 !== "string" ||
      !SHA256_PATTERN.test(data.semanticReport.sha256)
    )
      return problem("semanticReport sha256 has an invalid form");
  }
  const mechanicalProblem = diagnosticsArrayProblem(
    data.mechanical,
    "mechanical",
  );
  if (mechanicalProblem) return mechanicalProblem;
  const semanticProblem = diagnosticsArrayProblem(data.semantic, "semantic");
  if (semanticProblem) return semanticProblem;
  if (
    (data.mechanical as unknown[]).length +
      (data.semantic as unknown[]).length >
    MAX_DIAGNOSTICS
  )
    return problem(
      `mechanical plus semantic diagnostics exceed the limit (${MAX_DIAGNOSTICS})`,
      true,
    );
  if (data.expect !== null) {
    if (!isRecord(data.expect))
      return problem("expect must be an object or null");
    const extra3 = unknownKey(data.expect, ["fingerprint", "revision"]);
    if (extra3 !== undefined) return problem("expect has an unknown field");
    if (
      typeof data.expect.fingerprint !== "string" ||
      !SHA256_PATTERN.test(data.expect.fingerprint)
    )
      return problem("expect fingerprint has an invalid form");
    if (
      typeof data.expect.revision !== "string" ||
      !REVISION_HEX_PATTERN.test(data.expect.revision)
    )
      return problem("expect revision has an invalid form");
  }
  return undefined;
}

export type PreflightReportValidationResult =
  | { readonly ok: true; readonly record: PreflightReportRecord }
  | { readonly ok: false; readonly message: string };

/** Validates a stored `records/preflight-*.json` file's already-parsed content (schema shape, §13 limits, and its `batchId`). */
export function validateStoredPreflightReportRecord(
  data: unknown,
  expectedBatchId: string,
): PreflightReportValidationResult {
  const shapeProblem = validatePreflightReportShape(data, expectedBatchId);
  if (shapeProblem) return { ok: false, message: shapeProblem.message };
  return { ok: true, record: data as PreflightReportRecord };
}
