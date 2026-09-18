/**
 * Revision Sheet fence finding and schema-shape validation (contract §6,
 * §13). Ported from the embedded annotation page script's `parseSheet` /
 * `validateSheet` / `validateRevision` (`annotation-logic.ts`) so `review
 * import` and the TST-023 page reach the same judgement (Story TST-024
 * AC-005). Same-content judgement, dedupe, and `supersedes` chain checks
 * live in `revision-content.ts`. This module never touches a filesystem,
 * process, or clock.
 */

import {
  BATCH_ID_PATTERN,
  MAX_BATCH_ID_LENGTH,
  MAX_LIST_ITEMS,
  MAX_NESTING_DEPTH,
  MAX_RECORD_BYTES,
  REVISION_ID_PATTERN,
  SHA256_PATTERN,
  isRecord,
  isUtcDateTime,
  jsonParseFailureMessage,
  problem,
  rawJsonMaxDepth,
  textFieldProblem,
  unknownKey,
  utf8Length,
  validateLocatorShape,
  type FieldProblem,
} from "./revision-limits.js";
import {
  dedupeRevisions,
  supersedesConflicts,
  normalizedRevision,
  type RevisionRecord,
  type SupersedesConflict,
} from "./revision-content.js";

export const MAX_TARGETS = 100;
export {
  MAX_TEXT_BYTES,
  MAX_RECORD_BYTES,
  MAX_NESTING_DEPTH,
  MAX_BATCH_ID_LENGTH,
} from "./revision-limits.js";
export const MAX_REVISIONS = MAX_LIST_ITEMS;
export {
  dedupeRevisions,
  revisionContentKey,
  sameRevisionContent,
  supersedesConflicts,
} from "./revision-content.js";
export type {
  DedupeResult,
  RevisionLocatorValue,
  RevisionRecord,
  SupersedesConflict,
} from "./revision-content.js";

const FENCE_OPEN = "```praxisbound-revisions";
const FENCE_CLOSE = "```";

export const REVISION_KINDS = [
  "supplement",
  "rewrite",
  "add-requirement",
  "delete",
] as const;
export type RevisionKind = (typeof REVISION_KINDS)[number];

const SHEET_KEYS = [
  "schemaVersion",
  "batchId",
  "fingerprint",
  "exportedAt",
  "revisions",
];
const REVISION_KEYS = [
  "id",
  "fingerprint",
  "targets",
  "quote",
  "kind",
  "blocking",
  "proposal",
  "rationale",
  "createdAt",
  "supersedes",
];
const TEXT_FIELDS = ["quote", "proposal", "rationale"] as const;

export interface RevisionSheetData {
  readonly schemaVersion: "1.0.0";
  readonly batchId: string;
  readonly fingerprint: string;
  readonly exportedAt: string;
  readonly revisions: readonly RevisionRecord[];
}

function validateTargetsShape(targets: unknown): FieldProblem | undefined {
  if (!Array.isArray(targets) || targets.length < 1)
    return problem("at least one target is required");
  if (targets.length > MAX_TARGETS)
    return problem(`target count exceeds the limit (${MAX_TARGETS})`);
  for (const target of targets) {
    const found = validateLocatorShape(target);
    if (found) return found;
  }
  return undefined;
}

/** Same field-by-field shape as `revision-sheet.schema.json`'s `revisions[]` item. */
function validateRevisionShape(revision: unknown): FieldProblem | undefined {
  if (!isRecord(revision)) return problem("each revision must be an object");
  const extra = unknownKey(revision, REVISION_KEYS);
  if (extra !== undefined) return problem("revision has an unknown field");
  if (typeof revision.id !== "string" || !REVISION_ID_PATTERN.test(revision.id))
    return problem("id must be a valid ULID (REV- plus 26 characters)");
  if (
    typeof revision.fingerprint !== "string" ||
    !SHA256_PATTERN.test(revision.fingerprint)
  )
    return problem("fingerprint has an invalid form");
  const targetsProblem = validateTargetsShape(revision.targets);
  if (targetsProblem) return targetsProblem;
  for (const field of TEXT_FIELDS) {
    const found = textFieldProblem(revision[field], field);
    if (found) return found;
  }
  if (!REVISION_KINDS.includes(revision.kind as RevisionKind))
    return problem("kind has an invalid value");
  if (typeof revision.blocking !== "boolean")
    return problem("blocking must be a boolean");
  if (!isUtcDateTime(revision.createdAt))
    return problem("createdAt must be a UTC date-time");
  // `supersedes === id` (self-reference) is deliberately not rejected here:
  // `revision-content.ts`'s `supersedesConflicts` reports it alongside a
  // cycle or a doubled target, so every `supersedes` graph problem reaches
  // the caller as one conflict bucket (`REVIEW_REVISION_CONFLICT`), never
  // split between a shape error and a conflict.
  if (
    revision.supersedes !== undefined &&
    (typeof revision.supersedes !== "string" ||
      !REVISION_ID_PATTERN.test(revision.supersedes))
  )
    return problem("supersedes has an invalid form");
  return undefined;
}

/** Same field-by-field shape as `revision-sheet.schema.json`'s top level, including the §13 limits it names. */
function validateSheetShape(
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
  const extra = unknownKey(data, SHEET_KEYS);
  if (extra !== undefined) return problem("sheet has an unknown field");
  if (
    typeof data.batchId !== "string" ||
    data.batchId.length > MAX_BATCH_ID_LENGTH ||
    !BATCH_ID_PATTERN.test(data.batchId)
  )
    return problem("batchId has an invalid form");
  if (expectedBatchId !== undefined && data.batchId !== expectedBatchId)
    return problem("batchId does not match the current batch");
  if (
    typeof data.fingerprint !== "string" ||
    !SHA256_PATTERN.test(data.fingerprint)
  )
    return problem("fingerprint has an invalid form");
  if (!isUtcDateTime(data.exportedAt))
    return problem("exportedAt must be a UTC date-time");
  if (!Array.isArray(data.revisions))
    return problem("revisions array is missing");
  if (data.revisions.length > MAX_REVISIONS)
    return problem(`revision count exceeds the limit (${MAX_REVISIONS})`, true);
  for (const revision of data.revisions) {
    const found = validateRevisionShape(revision);
    if (found) return found;
  }
  return undefined;
}

interface FenceResult {
  readonly ok: true;
  readonly jsonText: string;
}
interface FenceFailure {
  readonly ok: false;
  readonly message: string;
}

/** Exactly one column-0 opening fence and a later column-0 closing fence; `\r` at line end is ignored. */
function findFenceBlock(text: string): FenceResult | FenceFailure {
  const lines = text.split("\n");
  const opens: number[] = [];
  const closes: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = (lines[i] ?? "").replace(/\r$/, "");
    if (line === FENCE_OPEN) opens.push(i);
    else if (line === FENCE_CLOSE) closes.push(i);
  }
  if (opens.length !== 1)
    return {
      ok: false,
      message: `must contain exactly one praxisbound-revisions block, found ${opens.length}`,
    };
  const openLine = opens[0] as number;
  const closeLine = closes.find((line) => line > openLine);
  if (closeLine === undefined)
    return { ok: false, message: "praxisbound-revisions block is not closed" };
  return {
    ok: true,
    jsonText: lines.slice(openLine + 1, closeLine).join("\n"),
  };
}

export type RevisionSheetParseResult =
  | {
      readonly ok: true;
      readonly skipped: number;
      readonly sheet: RevisionSheetData;
      /** The exact text between the fence lines, verbatim — the bytes `review import` stores (never re-serialized). */
      readonly jsonText: string;
    }
  | {
      readonly ok: false;
      readonly tooLarge: boolean;
      readonly unsupportedSchema: boolean;
      readonly message: string;
      readonly conflictIds?: readonly string[];
    };

/** Parses and validates one `praxisbound-revisions` fenced block (contract §6, §13); in-sheet dedupe and supersedes chain checks included. */
export function parseRevisionSheetBlock(
  markdownText: string,
  expectedBatchId: string | undefined,
): RevisionSheetParseResult {
  if (utf8Length(markdownText) > MAX_RECORD_BYTES)
    return {
      ok: false,
      tooLarge: true,
      unsupportedSchema: false,
      message: "sheet exceeds the size limit (1 MiB)",
    };

  const fence = findFenceBlock(markdownText);
  if (!fence.ok)
    return {
      ok: false,
      tooLarge: false,
      unsupportedSchema: false,
      message: fence.message,
    };
  if (rawJsonMaxDepth(fence.jsonText) > MAX_NESTING_DEPTH)
    return {
      ok: false,
      tooLarge: true,
      unsupportedSchema: false,
      message: `JSON nesting depth exceeds the limit (${MAX_NESTING_DEPTH})`,
    };

  let data: unknown;
  try {
    data = JSON.parse(fence.jsonText);
  } catch (error) {
    return {
      ok: false,
      tooLarge: false,
      unsupportedSchema: false,
      message: jsonParseFailureMessage(error),
    };
  }
  const shapeProblem = validateSheetShape(data, expectedBatchId);
  if (shapeProblem)
    return {
      ok: false,
      tooLarge: shapeProblem.tooLarge,
      unsupportedSchema: shapeProblem.unsupportedSchema,
      message: shapeProblem.message,
    };

  const sheetData = data as RevisionSheetData;
  const deduped = dedupeRevisions(sheetData.revisions);
  if (deduped.conflictIds.length > 0)
    return {
      ok: false,
      tooLarge: false,
      unsupportedSchema: false,
      conflictIds: deduped.conflictIds,
      message: `same id, different content within the sheet: ${deduped.conflictIds.join(", ")}`,
    };
  const conflicts = supersedesConflicts(deduped.unique);
  if (conflicts.length > 0)
    return {
      ok: false,
      tooLarge: false,
      unsupportedSchema: false,
      conflictIds: [...new Set(conflicts.map((entry) => entry.id))],
      message: (conflicts[0] as SupersedesConflict).message,
    };

  return {
    ok: true,
    skipped: deduped.skipped,
    jsonText: fence.jsonText,
    sheet: {
      schemaVersion: sheetData.schemaVersion,
      batchId: sheetData.batchId,
      fingerprint: sheetData.fingerprint,
      exportedAt: sheetData.exportedAt,
      revisions: deduped.unique.map(normalizedRevision),
    },
  };
}

export type RevisionRecordValidationResult =
  | { readonly ok: true; readonly sheet: RevisionSheetData }
  | { readonly ok: false; readonly message: string };

/**
 * Validates a stored `records/revisions-*.json` file's parsed content
 * (schema shape, §13 limits, and that its `batchId` matches the current
 * batch; no in-sheet dedupe — a written record is already deduped). Used to
 * detect an invalid existing record (contract §6 修訂，R-005 / R8).
 */
export function validateStoredRevisionRecord(
  data: unknown,
  expectedBatchId: string,
): RevisionRecordValidationResult {
  const shapeProblem = validateSheetShape(data, expectedBatchId);
  if (shapeProblem) return { ok: false, message: shapeProblem.message };
  return { ok: true, sheet: data as RevisionSheetData };
}
