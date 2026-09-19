/**
 * Revision Response record schema validation (contract §7, §13). Hand
 * written against `revision-responses.schema.json` and `defs.schema.json`,
 * sharing its primitives with `revision-sheet.ts` via `revision-limits.ts`.
 * The two-fingerprint rule (§7 step 6, contract 修訂 per human review) and
 * the "every `incorporated` locator matches current sources" rule both need
 * the current source index, so they are checked by `review-respond.ts`
 * after this module's schema/§13 validation, not here. This module never
 * touches a filesystem, process, or clock.
 */

import {
  BATCH_ID_PATTERN,
  MAX_BATCH_ID_LENGTH,
  MAX_LIST_ITEMS,
  MAX_NESTING_DEPTH,
  MAX_RECORD_BYTES,
  SHA256_PATTERN,
  REVISION_ID_PATTERN,
  isRecord,
  isUtcDateTime,
  jsonParseFailureMessage,
  problem,
  rawJsonMaxDepth,
  unknownKey,
  utf8Length,
  validateLocatorShape,
  type FieldProblem,
} from "./revision-limits.js";
import type { RevisionLocatorValue } from "./revision-content.js";

export const MAX_RESPONSES = MAX_LIST_ITEMS;
export const MAX_LOCATORS = 100;
export const MAX_REVISION_SHEETS = MAX_LIST_ITEMS;
export const MAX_NONEMPTY_TEXT_BYTES = 65536;
export const MAX_AGENT_LENGTH = 256;

const RESPONSE_ROUTES = [
  "presentation",
  "story-derivation",
  "spec-requirement",
  "decision",
] as const;
export type ResponseRoute = (typeof RESPONSE_ROUTES)[number];

const RESPONSE_OUTCOMES = [
  "incorporated",
  "needs-decision",
  "not-incorporated",
] as const;
export type ResponseOutcome = (typeof RESPONSE_OUTCOMES)[number];

const RECORD_KEYS = [
  "schemaVersion",
  "batchId",
  "fromFingerprint",
  "toFingerprint",
  "revisionSheets",
  "respondedAt",
  "agent",
  "responses",
];
const RESPONSE_KEYS = [
  "revisionId",
  "route",
  "outcome",
  "rationale",
  "question",
  "locators",
  "blockingSuggestion",
];

export interface ResponseRecord {
  readonly revisionId: string;
  readonly route: ResponseRoute;
  readonly outcome: ResponseOutcome;
  readonly rationale: string;
  readonly question?: string;
  readonly locators: readonly RevisionLocatorValue[];
  readonly blockingSuggestion?: boolean;
}

export interface RevisionResponsesData {
  readonly schemaVersion: "1.0.0";
  readonly batchId: string;
  readonly fromFingerprint: string;
  readonly toFingerprint: string;
  readonly revisionSheets: readonly string[];
  readonly respondedAt: string;
  readonly agent: string;
  readonly responses: readonly ResponseRecord[];
}

function nonEmptyTextProblem(
  value: unknown,
  name: string,
): FieldProblem | undefined {
  if (typeof value !== "string" || value.trim().length === 0)
    return problem(`${name} must be a non-empty string`);
  if (utf8Length(value) > MAX_NONEMPTY_TEXT_BYTES)
    return problem(`${name} exceeds the string limit (64 KiB, UTF-8)`, true);
  return undefined;
}

function validateResponseShape(response: unknown): FieldProblem | undefined {
  if (!isRecord(response)) return problem("each response must be an object");
  const extra = unknownKey(response, RESPONSE_KEYS);
  if (extra !== undefined) return problem("response has an unknown field");
  if (
    typeof response.revisionId !== "string" ||
    !REVISION_ID_PATTERN.test(response.revisionId)
  )
    return problem("revisionId must be a valid ULID (REV- plus 26 characters)");
  if (!RESPONSE_ROUTES.includes(response.route as ResponseRoute))
    return problem("route has an invalid value");
  if (!RESPONSE_OUTCOMES.includes(response.outcome as ResponseOutcome))
    return problem("outcome has an invalid value");
  const rationaleProblem = nonEmptyTextProblem(response.rationale, "rationale");
  if (rationaleProblem) return rationaleProblem;
  if (response.question !== undefined) {
    const questionProblem = nonEmptyTextProblem(response.question, "question");
    if (questionProblem) return questionProblem;
  }
  if (response.outcome === "needs-decision" && response.question === undefined)
    return problem("question is required when outcome is needs-decision");
  if (!Array.isArray(response.locators))
    return problem("locators array is missing");
  if (response.locators.length > MAX_LOCATORS)
    return problem(`locators count exceeds the limit (${MAX_LOCATORS})`);
  if (response.outcome === "incorporated" && response.locators.length < 1)
    return problem("locators must be non-empty when outcome is incorporated");
  for (const locator of response.locators) {
    const found = validateLocatorShape(locator);
    if (found) return found;
  }
  if (
    response.blockingSuggestion !== undefined &&
    typeof response.blockingSuggestion !== "boolean"
  )
    return problem("blockingSuggestion must be a boolean");
  return undefined;
}

/**
 * Same field-by-field shape as `revision-responses.schema.json`'s top
 * level, plus §13 limits. `expectedBatchId` is checked when given
 * (`undefined` skips it, e.g. when the caller enforces it separately with
 * its own issue code, as `review-respond.ts` does for the input file).
 */
function validateRecordShape(
  data: unknown,
  expectedBatchId: string | undefined,
): FieldProblem | undefined {
  if (!isRecord(data))
    return problem("data does not match the expected schema");
  // schemaVersion is checked before the unknown-key scan: a document
  // declaring a newer schemaVersion is expected to carry fields this
  // version does not recognize, so an unrecognized field must never mask
  // the real reason (REVIEW_SCHEMA_UNSUPPORTED) behind a generic shape
  // error.
  if (data.schemaVersion !== "1.0.0")
    return problem("schemaVersion is not supported", false, true);
  const extra = unknownKey(data, RECORD_KEYS);
  if (extra !== undefined)
    return problem("response record has an unknown field");
  if (
    typeof data.batchId !== "string" ||
    data.batchId.length > MAX_BATCH_ID_LENGTH ||
    !BATCH_ID_PATTERN.test(data.batchId)
  )
    return problem("batchId has an invalid form");
  if (expectedBatchId !== undefined && data.batchId !== expectedBatchId)
    return problem("batchId does not match the current batch");
  if (
    typeof data.fromFingerprint !== "string" ||
    !SHA256_PATTERN.test(data.fromFingerprint)
  )
    return problem("fromFingerprint has an invalid form");
  if (
    typeof data.toFingerprint !== "string" ||
    !SHA256_PATTERN.test(data.toFingerprint)
  )
    return problem("toFingerprint has an invalid form");
  if (!Array.isArray(data.revisionSheets) || data.revisionSheets.length < 1)
    return problem("revisionSheets must be a non-empty array");
  if (data.revisionSheets.length > MAX_REVISION_SHEETS)
    return problem(
      `revisionSheets count exceeds the limit (${MAX_REVISION_SHEETS})`,
      true,
    );
  if (new Set(data.revisionSheets).size !== data.revisionSheets.length)
    return problem("revisionSheets must not repeat an entry");
  for (const sheet of data.revisionSheets) {
    if (typeof sheet !== "string" || !SHA256_PATTERN.test(sheet))
      return problem("revisionSheets entry has an invalid form");
  }
  if (!isUtcDateTime(data.respondedAt))
    return problem("respondedAt must be a UTC date-time");
  if (
    typeof data.agent !== "string" ||
    data.agent.length < 1 ||
    data.agent.length > MAX_AGENT_LENGTH
  )
    return problem("agent has an invalid form");
  if (!Array.isArray(data.responses))
    return problem("responses array is missing");
  if (data.responses.length > MAX_RESPONSES)
    return problem(
      `responses count exceeds the limit (${MAX_RESPONSES})`,
      true,
    );
  for (const response of data.responses) {
    const found = validateResponseShape(response);
    if (found) return found;
  }
  return undefined;
}

export type RevisionResponsesParseResult =
  | { readonly ok: true; readonly record: RevisionResponsesData }
  | {
      readonly ok: false;
      readonly tooLarge: boolean;
      readonly unsupportedSchema: boolean;
      readonly message: string;
    };

/** Parses and validates one Revision Response file's raw text (contract §7, §13). */
export function parseRevisionResponses(
  text: string,
): RevisionResponsesParseResult {
  if (utf8Length(text) > MAX_RECORD_BYTES)
    return {
      ok: false,
      tooLarge: true,
      unsupportedSchema: false,
      message: "response file exceeds the size limit (1 MiB)",
    };
  if (rawJsonMaxDepth(text) > MAX_NESTING_DEPTH)
    return {
      ok: false,
      tooLarge: true,
      unsupportedSchema: false,
      message: `JSON nesting depth exceeds the limit (${MAX_NESTING_DEPTH})`,
    };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      tooLarge: false,
      unsupportedSchema: false,
      message: jsonParseFailureMessage(error),
    };
  }
  const shapeProblem = validateRecordShape(data, undefined);
  if (shapeProblem)
    return {
      ok: false,
      tooLarge: shapeProblem.tooLarge,
      unsupportedSchema: shapeProblem.unsupportedSchema,
      message: shapeProblem.message,
    };
  return { ok: true, record: data as RevisionResponsesData };
}

export type RevisionResponsesValidationResult =
  | { readonly ok: true; readonly record: RevisionResponsesData }
  | { readonly ok: false; readonly message: string };

/** Validates a stored `records/responses-*.json` file's parsed content (schema shape, §13 limits, and its `batchId`). */
export function validateStoredResponsesRecord(
  data: unknown,
  expectedBatchId: string,
): RevisionResponsesValidationResult {
  const shapeProblem = validateRecordShape(data, expectedBatchId);
  if (shapeProblem) return { ok: false, message: shapeProblem.message };
  return { ok: true, record: data as RevisionResponsesData };
}
