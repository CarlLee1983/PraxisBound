/**
 * The Revision Sheet same-content judgement, in-sheet dedupe, and
 * `supersedes` chain checks (contract §6 修訂性澄清，R-004), ported line for
 * line from the embedded annotation page script so `review import` and the
 * TST-023 page reach the same judgement (Story TST-024 AC-005). Split out
 * of `revision-sheet.ts` to keep that file to parsing and schema shape.
 * This module never touches a filesystem, process, or clock.
 */

import {
  canonicalUtcTime,
  isRecord,
  normalizeNewlines,
} from "./revision-limits.js";
import type { RevisionKind } from "./revision-sheet.js";

export interface RevisionLocatorValue {
  readonly path: string;
  readonly anchor: string;
  readonly blockSha256: string;
}

export interface RevisionRecord {
  readonly id: string;
  readonly fingerprint: string;
  readonly targets: readonly RevisionLocatorValue[];
  readonly quote: string;
  readonly kind: RevisionKind;
  readonly blocking: boolean;
  readonly proposal: string;
  readonly rationale: string;
  readonly createdAt: string;
  readonly supersedes?: string;
}

const TEXT_FIELDS = ["quote", "proposal", "rationale"] as const;

function copyLocator(target: RevisionLocatorValue): RevisionLocatorValue {
  return {
    path: target.path,
    anchor: target.anchor,
    blockSha256: target.blockSha256,
  };
}

/** Only the schema fields, as a fresh object (no page-only flags). */
function revisionToRecord(request: Record<string, unknown>): RevisionRecord {
  const record: Record<string, unknown> = {
    id: request.id,
    fingerprint: request.fingerprint,
    targets: (request.targets as RevisionLocatorValue[]).map(copyLocator),
    quote: request.quote,
    kind: request.kind,
    blocking: request.blocking,
    proposal: request.proposal,
    rationale: request.rationale,
    createdAt: request.createdAt,
  };
  if (typeof request.supersedes === "string")
    record.supersedes = request.supersedes;
  return record as unknown as RevisionRecord;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Object keys sorted at every level, `createdAt` in standard UTC form, text fields newline-normalized (contract §6 修訂性澄清 R-004). */
export function revisionContentKey(revision: RevisionRecord): string {
  const record = revisionToRecord(
    revision as unknown as Record<string, unknown>,
  ) as unknown as Record<string, unknown>;
  record.createdAt = canonicalUtcTime(record.createdAt as string);
  for (const field of TEXT_FIELDS)
    record[field] = normalizeNewlines(record[field] as string);
  return canonicalJson(record);
}

export function sameRevisionContent(
  a: RevisionRecord,
  b: RevisionRecord,
): boolean {
  return revisionContentKey(a) === revisionContentKey(b);
}

export function normalizedRevision(revision: RevisionRecord): RevisionRecord {
  const record = revisionToRecord(
    revision as unknown as Record<string, unknown>,
  ) as unknown as Record<string, unknown>;
  for (const field of TEXT_FIELDS)
    record[field] = normalizeNewlines(record[field] as string);
  return record as unknown as RevisionRecord;
}

export interface DedupeResult {
  readonly unique: readonly RevisionRecord[];
  readonly skipped: number;
  readonly conflictIds: readonly string[];
}

/** Same id inside one sheet: same content kept once, different content listed as a conflict. */
export function dedupeRevisions(
  revisions: readonly RevisionRecord[],
): DedupeResult {
  const firstById = new Map<string, RevisionRecord>();
  const unique: RevisionRecord[] = [];
  const conflictIds: string[] = [];
  let skipped = 0;
  for (const revision of revisions) {
    const first = firstById.get(revision.id);
    if (first === undefined) {
      firstById.set(revision.id, revision);
      unique.push(revision);
    } else if (sameRevisionContent(first, revision)) {
      skipped += 1;
    } else if (!conflictIds.includes(revision.id)) {
      conflictIds.push(revision.id);
    }
  }
  return { unique, skipped, conflictIds };
}

export interface SupersedesConflict {
  readonly id: string;
  readonly message: string;
}

/**
 * Self-reference, a cycle, or two different requests claiming the same
 * `supersedes` target, within one list. All three are reported here rather
 * than as a shape/schema problem, so the caller can surface them as
 * `REVIEW_REVISION_CONFLICT` (contract §6) rather than
 * `REVIEW_REVISION_SHEET_INVALID`.
 */
export function supersedesConflicts(
  list: readonly RevisionRecord[],
): readonly SupersedesConflict[] {
  const byId = new Map<string, RevisionRecord>();
  const supersededBy = new Map<string, string>();
  const conflicts: SupersedesConflict[] = [];
  for (const request of list) byId.set(request.id, request);
  for (const request of list) {
    if (typeof request.supersedes !== "string") continue;
    if (request.supersedes === request.id) {
      conflicts.push({
        id: request.id,
        message: `revision ${request.id} cannot supersede itself`,
      });
      continue;
    }
    const earlier = supersededBy.get(request.supersedes);
    if (earlier !== undefined) {
      conflicts.push({
        id: request.id,
        message: `revision ${request.supersedes} is superseded by both ${earlier} and ${request.id}`,
      });
      continue;
    }
    supersededBy.set(request.supersedes, request.id);
  }
  const reachesCycle = new Map<string, boolean>();
  for (const request of list) {
    const path: string[] = [];
    const onPath = new Set<string>();
    let cyclic = false;
    let current: RevisionRecord | undefined = request;
    while (current !== undefined && typeof current.supersedes === "string") {
      const known = reachesCycle.get(current.id);
      if (known !== undefined) {
        cyclic = known;
        break;
      }
      if (onPath.has(current.id)) {
        cyclic = true;
        break;
      }
      onPath.add(current.id);
      path.push(current.id);
      current = byId.get(current.supersedes);
    }
    for (const id of path) reachesCycle.set(id, cyclic);
    if (cyclic)
      conflicts.push({
        id: request.id,
        message: `revision ${request.id}'s supersedes forms a cycle`,
      });
  }
  return conflicts;
}

/**
 * Every valid imported request across the whole batch, minus any request
 * another valid imported request `supersedes` (contract §6: "採計全部已匯入
 * 修訂單中未被 supersedes 取代的意見"). `supersedes` is resolved against the
 * combined set of every sheet passed in, never against a caller-chosen
 * subset, so a request superseded by a revision imported in a different
 * sheet is still excluded (`review-respond.ts`'s R10 note). Order follows
 * first occurrence across `sheets` in the order given.
 */
export function computeEffectiveRevisions(
  sheets: readonly (readonly RevisionRecord[])[],
): readonly RevisionRecord[] {
  const byId = new Map<string, RevisionRecord>();
  for (const revisions of sheets)
    for (const revision of revisions)
      if (!byId.has(revision.id)) byId.set(revision.id, revision);
  const superseded = new Set<string>();
  for (const revision of byId.values())
    if (typeof revision.supersedes === "string")
      superseded.add(revision.supersedes);
  return [...byId.values()].filter((revision) => !superseded.has(revision.id));
}

export interface RecordSetConflict {
  readonly id: string;
  /** Every record file (repo-relative path, as the caller named it) that carries this id. */
  readonly paths: readonly string[];
  readonly message: string;
}

export interface RecordSetValidation {
  readonly ok: boolean;
  readonly conflicts: readonly RecordSetConflict[];
}

export interface PathedRevisionRecords {
  readonly path: string;
  readonly revisions: readonly RevisionRecord[];
}

/**
 * Cross-record consistency across every already imported `records/revisions-
 * *.json`, checked as a whole after each is individually schema-valid
 * (security M2): the same id must carry the same content in every record it
 * appears in, and the combined `supersedes` graph must still have no
 * self-reference, cycle, or doubled target. A record-set violation should
 * not be reachable in normal operation (each write already re-checks
 * against everything imported so far), but a manually placed or
 * concurrently written file could still produce one, so it is never
 * silently trusted. This is a defect of `records/` itself, distinct from a
 * rejected import sheet, so the caller reports it as `REVIEW_RECORD_INVALID`
 * naming the file(s), not `REVIEW_REVISION_CONFLICT`.
 */
export function validateRevisionRecordSet(
  records: readonly PathedRevisionRecords[],
): RecordSetValidation {
  const pathsById = new Map<string, Set<string>>();
  const firstById = new Map<string, RevisionRecord>();
  for (const record of records) {
    for (const revision of record.revisions) {
      const paths = pathsById.get(revision.id) ?? new Set<string>();
      paths.add(record.path);
      pathsById.set(revision.id, paths);
      if (!firstById.has(revision.id)) firstById.set(revision.id, revision);
    }
  }

  const contentConflictIds = new Set<string>();
  for (const record of records) {
    for (const revision of record.revisions) {
      const first = firstById.get(revision.id) as RevisionRecord;
      if (!sameRevisionContent(first, revision))
        contentConflictIds.add(revision.id);
    }
  }
  if (contentConflictIds.size > 0) {
    const conflicts = [...contentConflictIds].map((id) => ({
      id,
      paths: [...(pathsById.get(id) ?? [])],
      message: `revision ${id} has different content in different records`,
    }));
    return { ok: false, conflicts };
  }

  const conflicts = supersedesConflicts([...firstById.values()]);
  if (conflicts.length > 0) {
    const seen = new Set<string>();
    const mapped: RecordSetConflict[] = [];
    for (const entry of conflicts) {
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      mapped.push({
        id: entry.id,
        paths: [...(pathsById.get(entry.id) ?? [])],
        message: entry.message,
      });
    }
    return { ok: false, conflicts: mapped };
  }

  return { ok: true, conflicts: [] };
}
