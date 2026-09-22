/**
 * Definition Confirmation record schema validation, applicability, and the
 * "which sources changed" comparison (contract §8, §13, §8 修訂，R-006).
 * Hand written against `confirmation.schema.json` and `defs.schema.json`,
 * sharing primitives with the Revision Sheet/Response validators via
 * `revision-limits.ts`. A confirmation is a human claim bound to one
 * fingerprint (`ADR-014`): this module computes no approval, authorization,
 * or lifecycle state, only whether a record's `fingerprint` matches the
 * current one and, when it does not, which sources differ from the latest
 * valid confirmation. This module never touches a filesystem, process, or
 * clock.
 */

import { computeFingerprint } from "./fingerprint.js";
import { compareUtf8, isHiddenOrReorderingCodePoint } from "./path.js";
import {
  BATCH_ID_PATTERN,
  MAX_BATCH_ID_LENGTH,
  MAX_LIST_ITEMS,
  REPO_PATH_PATTERN,
  SHA256_PATTERN,
  REVISION_ID_PATTERN,
  UTC_TIME_PATTERN,
  boundedStringProblem,
  canonicalUtcTime,
  isRecord,
  isUtcDateTime,
  problem,
  unknownKey,
  utf8Length,
  type FieldProblem,
} from "./revision-limits.js";
import type { RevisionResponsesData } from "./revision-responses.js";
import type { RevisionRecord } from "./revision-sheet.js";
import type { SourceDigest } from "./types.js";

export const MAX_CONFIRMATION_SOURCES = 5000;
export const MAX_DEFERRED_ENTRIES = MAX_LIST_ITEMS;
export const MAX_CONFIRMATION_REVISION_SHEETS = MAX_LIST_ITEMS;
export const MAX_DEFERRAL_REASON_BYTES = 65536;

const RECORD_KEYS = [
  "schemaVersion",
  "claim",
  "batchId",
  "fingerprint",
  "manifestSha256",
  "sources",
  "confirmedAt",
  "deferred",
  "revisionSheets",
];
const SOURCE_KEYS = ["path", "sha256"];
const DEFERRED_KEYS = ["revisionId", "reason"];

export interface ConfirmationSourceDigest {
  readonly path: string;
  readonly sha256: string;
}

export interface DeferredRevision {
  readonly revisionId: string;
  readonly reason: string;
}

export interface ConfirmationData {
  readonly schemaVersion: "1.0.0";
  readonly claim: "explicit-terminal-confirmation";
  readonly batchId: string;
  readonly fingerprint: string;
  readonly manifestSha256: string;
  readonly sources: readonly ConfirmationSourceDigest[];
  readonly confirmedAt: string;
  readonly deferred: readonly DeferredRevision[];
  readonly revisionSheets: readonly string[];
}

function sourceProblem(value: unknown): FieldProblem | undefined {
  if (!isRecord(value)) return problem("each source must be an object");
  const extra = unknownKey(value, SOURCE_KEYS);
  if (extra !== undefined) return problem("source has an unknown field");
  const pathProblem = boundedStringProblem(value.path, "source path");
  if (pathProblem) return pathProblem;
  if (!REPO_PATH_PATTERN.test(value.path as string))
    return problem("source path has an invalid form");
  if (typeof value.sha256 !== "string" || !SHA256_PATTERN.test(value.sha256))
    return problem("source sha256 has an invalid form");
  return undefined;
}

/** True when `text` contains any code point `isHiddenOrReorderingCodePoint` names (a control character, a bidi/zero-width marker, or the byte-order mark). Used to reject a deferral reason that could hide or reorder text rather than merely escape it on display (H2). */
export function containsHiddenOrReorderingCharacters(text: string): boolean {
  for (const character of text) {
    if (isHiddenOrReorderingCodePoint(character.codePointAt(0) ?? 0))
      return true;
  }
  return false;
}

function deferredProblem(value: unknown): FieldProblem | undefined {
  if (!isRecord(value)) return problem("each deferred entry must be an object");
  const extra = unknownKey(value, DEFERRED_KEYS);
  if (extra !== undefined)
    return problem("deferred entry has an unknown field");
  if (
    typeof value.revisionId !== "string" ||
    !REVISION_ID_PATTERN.test(value.revisionId)
  )
    return problem("revisionId must be a valid ULID (REV- plus 26 characters)");
  if (typeof value.reason !== "string" || value.reason.trim().length === 0)
    return problem("reason must be a non-empty string");
  if (utf8Length(value.reason) > MAX_DEFERRAL_REASON_BYTES)
    return problem("reason exceeds the string limit (64 KiB, UTF-8)", true);
  if (containsHiddenOrReorderingCharacters(value.reason))
    return problem("reason must not contain a hidden or reordering character");
  return undefined;
}

/**
 * Same field-by-field shape as `confirmation.schema.json`'s top level, plus
 * §13 limits and (unlike a Revision Response's `respondedAt`) no `agent`
 * field: a confirmation carries no identity (`ADR-014`, R7).
 */
function validateConfirmationShape(
  data: unknown,
  expectedBatchId: string,
): FieldProblem | undefined {
  if (!isRecord(data))
    return problem("data does not match the expected schema");
  // schemaVersion is checked before the unknown-key scan, matching
  // `revision-responses.ts`: a newer schemaVersion is expected to carry
  // fields this version does not recognize, so an unrecognized field must
  // never mask the real reason (REVIEW_SCHEMA_UNSUPPORTED) behind a generic
  // shape error.
  if (data.schemaVersion !== "1.0.0")
    return problem("schemaVersion is not supported", false, true);
  const extra = unknownKey(data, RECORD_KEYS);
  if (extra !== undefined)
    return problem("confirmation record has an unknown field");
  if (data.claim !== "explicit-terminal-confirmation")
    return problem("claim has an invalid value");
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
    typeof data.manifestSha256 !== "string" ||
    !SHA256_PATTERN.test(data.manifestSha256)
  )
    return problem("manifestSha256 has an invalid form");
  if (!Array.isArray(data.sources) || data.sources.length < 1)
    return problem("sources must be a non-empty array");
  if (data.sources.length > MAX_CONFIRMATION_SOURCES)
    return problem(
      `sources count exceeds the limit (${MAX_CONFIRMATION_SOURCES})`,
      true,
    );
  for (const source of data.sources) {
    const found = sourceProblem(source);
    if (found) return found;
  }
  if (!isUtcDateTime(data.confirmedAt))
    return problem("confirmedAt must be a UTC date-time");
  if (!Array.isArray(data.deferred))
    return problem("deferred array is missing");
  if (data.deferred.length > MAX_DEFERRED_ENTRIES)
    return problem(
      `deferred count exceeds the limit (${MAX_DEFERRED_ENTRIES})`,
      true,
    );
  for (const entry of data.deferred) {
    const found = deferredProblem(entry);
    if (found) return found;
  }
  if (!Array.isArray(data.revisionSheets))
    return problem("revisionSheets array is missing");
  if (data.revisionSheets.length > MAX_CONFIRMATION_REVISION_SHEETS)
    return problem(
      `revisionSheets count exceeds the limit (${MAX_CONFIRMATION_REVISION_SHEETS})`,
      true,
    );
  if (new Set(data.revisionSheets).size !== data.revisionSheets.length)
    return problem("revisionSheets must not repeat an entry");
  for (const sheet of data.revisionSheets) {
    if (typeof sheet !== "string" || !SHA256_PATTERN.test(sheet))
      return problem("revisionSheets entry has an invalid form");
  }
  // L4: the record's own `fingerprint` must equal the contract §4 digest
  // recomputed from its own `manifestSha256` and `sources` (sorted by path,
  // §4's own ordering rule, independent of the order stored). A record
  // whose `fingerprint` was hand-edited or forged to some other value never
  // passes this, so it is excluded everywhere — never applicable, never a
  // comparison baseline (Story TST-026 review round 1, L4).
  const sortedSources = [...(data.sources as ConfirmationSourceDigest[])].sort(
    (a, b) => compareUtf8(a.path, b.path),
  );
  const recomputed = computeFingerprint(
    data.manifestSha256 as string,
    sortedSources,
  );
  if (recomputed !== data.fingerprint)
    return problem(
      "fingerprint does not match the digest recomputed from manifestSha256 and sources (contract §4)",
    );
  return undefined;
}

export type ConfirmationValidationResult =
  | { readonly ok: true; readonly record: ConfirmationData }
  | { readonly ok: false; readonly message: string };

/** Validates a stored `records/confirmation-*.json` file's already-parsed content (schema shape, §13 limits, and its `batchId`). */
export function validateStoredConfirmationRecord(
  data: unknown,
  expectedBatchId: string,
): ConfirmationValidationResult {
  const shapeProblem = validateConfirmationShape(data, expectedBatchId);
  if (shapeProblem) return { ok: false, message: shapeProblem.message };
  return { ok: true, record: data as ConfirmationData };
}

export interface StoredConfirmation {
  readonly path: string;
  readonly record: ConfirmationData;
}

export interface ConfirmationSourcesSnapshot {
  readonly fingerprint: string;
  readonly manifestSha256: string;
  readonly sources: readonly SourceDigest[];
}

export type ConfirmationSourceChangeKind = "added" | "removed" | "changed";

export interface ConfirmationSourceChange {
  readonly path: string;
  readonly kind: ConfirmationSourceChangeKind;
  /** `true` when `kind` is `"changed"` only because the source is currently missing (`sha256: null`) — the render layer labels this 「缺失」 rather than 「內容變動」, while the CLI still reports the same `REVIEW_SOURCE_CHANGED` issue code (contract §8 修訂，R-006 review round 1). */
  readonly missing?: boolean;
}

export type ConfirmationApplicability =
  | { readonly applies: true; readonly confirmation: StoredConfirmation }
  | {
      readonly applies: false;
      /** The confirmation contract §8 presents the diff against; `undefined` when no valid confirmation exists at all. */
      readonly latest: StoredConfirmation | undefined;
      readonly sourceChanges: readonly ConfirmationSourceChange[];
      readonly manifestChanged: boolean;
    };

/** `confirmedAt`'s canonical-UTC fields, numeric, for a calendar-correct comparison a lexical string compare on trimmed fractional seconds cannot give. */
function utcTimeKey(
  value: string,
): readonly [number, number, number, number, number, number, string] {
  const canonical = canonicalUtcTime(value);
  const match = UTC_TIME_PATTERN.exec(canonical);
  if (match === null) return [0, 0, 0, 0, 0, 0, ""];
  return [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
    (match[7] ?? "").replace(/^\./, ""),
  ];
}

function compareCanonicalConfirmedAt(a: string, b: string): number {
  const keyA = utcTimeKey(a);
  const keyB = utcTimeKey(b);
  for (let index = 0; index < 6; index += 1) {
    const diff = (keyA[index] as number) - (keyB[index] as number);
    if (diff !== 0) return diff;
  }
  const fractionA = keyA[6] as string;
  const fractionB = keyB[6] as string;
  const length = Math.max(fractionA.length, fractionB.length);
  const paddedA = fractionA.padEnd(length, "0");
  const paddedB = fractionB.padEnd(length, "0");
  return paddedA < paddedB ? -1 : paddedA > paddedB ? 1 : 0;
}

/**
 * Contract §8 "最晚": the valid confirmation with the latest canonical
 * `confirmedAt`, ties broken by the later file name in UTF-8 byte order
 * (§8 修訂，R-006 (d)). Used only to present a diff; "latest" carries no
 * authority of its own (§8: "只用來呈現差異，不代表權威").
 */
export function latestConfirmation(
  confirmations: readonly StoredConfirmation[],
): StoredConfirmation | undefined {
  let best: StoredConfirmation | undefined;
  for (const candidate of confirmations) {
    if (best === undefined) {
      best = candidate;
      continue;
    }
    const timeDiff = compareCanonicalConfirmedAt(
      candidate.record.confirmedAt,
      best.record.confirmedAt,
    );
    if (
      timeDiff > 0 ||
      (timeDiff === 0 && compareUtf8(candidate.path, best.path) > 0)
    )
      best = candidate;
  }
  return best;
}

/**
 * Contract §8 applicability: a confirmation applies when some valid
 * confirmation's `fingerprint` equals the current one. Otherwise, when at
 * least one valid confirmation exists, the current sources are compared
 * against the latest valid confirmation's `sources`, naming every added,
 * removed, or changed source (by path, UTF-8 byte order) and whether the
 * manifest changed. When zero valid confirmations exist there is nothing to
 * compare against, so no change list is produced (§8 修訂，R-006: "完全沒有
 * 確認紀錄時不產生，也不標示任何文件").
 */
export function compareConfirmationApplicability(
  current: ConfirmationSourcesSnapshot,
  confirmations: readonly StoredConfirmation[],
): ConfirmationApplicability {
  const applied = confirmations.find(
    (candidate) => candidate.record.fingerprint === current.fingerprint,
  );
  if (applied !== undefined) return { applies: true, confirmation: applied };

  const latest = latestConfirmation(confirmations);
  if (latest === undefined)
    return {
      applies: false,
      latest: undefined,
      sourceChanges: [],
      manifestChanged: false,
    };

  const currentByPath = new Map(
    current.sources.map((source) => [source.path, source.sha256] as const),
  );
  const latestByPath = new Map(
    latest.record.sources.map(
      (source) => [source.path, source.sha256] as const,
    ),
  );
  const changes: ConfirmationSourceChange[] = [];
  for (const [path, sha256] of currentByPath) {
    const missing = sha256 === null;
    if (!latestByPath.has(path)) changes.push({ path, kind: "added", missing });
    else if (latestByPath.get(path) !== sha256)
      changes.push({ path, kind: "changed", missing });
  }
  for (const path of latestByPath.keys()) {
    if (!currentByPath.has(path)) changes.push({ path, kind: "removed" });
  }
  changes.sort((a, b) => compareUtf8(a.path, b.path));

  return {
    applies: false,
    latest,
    sourceChanges: changes,
    manifestChanged: current.manifestSha256 !== latest.record.manifestSha256,
  };
}

export interface UnresolvedRequests {
  readonly blocking: readonly string[];
  readonly nonBlocking: readonly string[];
}

/**
 * Contract §7 "已解決", applied to `confirm`'s already-computed effective
 * request set (contract §6, `computeEffectiveRevisions`): a request is
 * resolved only when a valid response record whose `toFingerprint` equals
 * the current fingerprint answers it `incorporated`; `needs-decision`,
 * `not-incorporated`, or a response bound to a different fingerprint never
 * resolves it. Splits the rest by `blocking` so `review confirm` can refuse
 * on the blocking half (contract §8 step 3) and require a typed deferral for
 * the rest (step 4). A forged `authorized: true`/`approved`/`confirmed`
 * string anywhere in a response's prose plays no part in this judgement —
 * only `outcome` and `toFingerprint` do (Story TST-026 AC-005).
 */
export function computeUnresolvedRequests(
  effectiveRevisions: readonly RevisionRecord[],
  responseRecords: readonly RevisionResponsesData[],
  currentFingerprint: string,
): UnresolvedRequests {
  const resolved = new Set<string>();
  for (const record of responseRecords) {
    if (record.toFingerprint !== currentFingerprint) continue;
    for (const response of record.responses)
      if (response.outcome === "incorporated")
        resolved.add(response.revisionId);
  }
  const blocking: string[] = [];
  const nonBlocking: string[] = [];
  for (const revision of effectiveRevisions) {
    if (resolved.has(revision.id)) continue;
    if (revision.blocking) blocking.push(revision.id);
    else nonBlocking.push(revision.id);
  }
  return { blocking, nonBlocking };
}
