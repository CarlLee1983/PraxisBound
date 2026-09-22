/**
 * `review render`'s "修訂紀錄證據" (revision-record evidence) area loader
 * (contract §13, §20 修訂，R-005): reads and validates `records/`, applies
 * the count-first 200-file bound, the pre-read 16&nbsp;MiB total-size bound,
 * and the post-read 10000-entry bound, and excludes any revision id whose
 * content disagrees across records (§6 security M2), before handing the
 * survivors to Core's `renderEvidenceSection`. Kept separate from
 * `review.ts` so that file does not keep growing, and to avoid an import
 * cycle: this module depends on `review-records.ts`, never the reverse.
 */

import { lstat } from "node:fs/promises";
import { resolve } from "node:path";

import type {
  RecordSetConflict,
  ResponseEvidenceRecord,
  ResultIssue,
  ReviewProjectionEvidence,
  RevisionEvidenceRecord,
} from "@praxisbound/core";
import {
  compareUtf8,
  escapeHiddenCharacters,
  isSyntacticallySafeRepoPath,
  validateRevisionRecordSet,
} from "@praxisbound/core";

import {
  countLooseRecordFileNames,
  filterLooseRecordFileNames,
  isRecordsPathUnsafe,
  listRecordsDirectory,
  readResponseRecords,
  readRevisionRecords,
  recordsDirectory,
} from "./review-records.js";

export const MAX_EVIDENCE_RECORD_FILES = 200;
export const MAX_EVIDENCE_TOTAL_BYTES = 16 * 1024 * 1024;
export const MAX_EVIDENCE_ENTRIES = 10000;

/**
 * Sums every loose `revisions-*.json`/`responses-*.json` file's filesystem-
 * reported size (contract §13/§20 修訂，R-005), `lstat`ing each so a
 * symlinked entry is never followed (its own size, not its target's, is
 * what gets summed — same non-follow discipline as every other `records/`
 * safety check). A name whose `lstat` itself fails (e.g. removed in a race
 * since the listing) contributes nothing to the sum; that file is left for
 * the ordinary per-file read below to find and report invalid, same as any
 * other unreadable record.
 */
export async function sumLooseRecordFileBytes(
  root: string,
  manifestPath: string,
  looseNames: readonly string[],
): Promise<number> {
  const directory = recordsDirectory(manifestPath);
  let total = 0;
  for (const name of looseNames) {
    let stats;
    try {
      stats = await lstat(resolve(root, directory, name));
    } catch {
      continue;
    }
    total += stats.size;
  }
  return total;
}

/** A minimal `ResultIssue` builder, kept local (rather than imported from `review.ts`) so this module never has to import back from its own caller. */
function buildIssue(code: string, message: string, path?: string): ResultIssue {
  return path === undefined ? { code, message } : { code, message, path };
}

/**
 * A `REVIEW_RECORD_INVALID` issue for one invalid record file. A record
 * file name is an attacker-controlled filesystem byte string: it can carry
 * a raw control character no envelope `path` field may ever hold
 * (`result.ts`'s `isPath`), so the safe (repo-relative, control-character-
 * free) case keeps the machine-readable `path` field, while the unsafe
 * case instead folds a visibly escaped rendering into `message` and omits
 * `path` — the envelope itself must always stay schema-valid, even when
 * the very thing it is reporting on has an unsafe name.
 */
function invalidRecordIssue(path: string): ResultIssue {
  if (isSyntacticallySafeRepoPath(path))
    return buildIssue("REVIEW_RECORD_INVALID", "record is invalid", path);
  return buildIssue(
    "REVIEW_RECORD_INVALID",
    `record is invalid: ${escapeHiddenCharacters(path)}`,
  );
}

/**
 * `REVIEW_RECORD_INVALID` issues for a `validateRevisionRecordSet` failure,
 * one per involved file — the same shape `review-input.ts`'s
 * `recordSetInvalidIssues` produces for `review import`/`review respond`,
 * duplicated here in miniature rather than imported, again to avoid a cycle
 * through `review.ts`.
 */
function recordSetConflictIssues(
  conflicts: readonly RecordSetConflict[],
): ResultIssue[] {
  const seen = new Set<string>();
  const issues: ResultIssue[] = [];
  for (const conflict of conflicts) {
    for (const path of conflict.paths) {
      const key = `${path}\u0000${conflict.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      issues.push({
        ...buildIssue("REVIEW_RECORD_INVALID", conflict.message, path),
        subject: `revision:${conflict.id}`,
      });
    }
  }
  return issues;
}

export interface ReviewEvidenceLoad {
  readonly evidence: ReviewProjectionEvidence | undefined;
  readonly extraIssues: readonly ResultIssue[];
}

function overLimitLoad(
  extraIssues: readonly ResultIssue[],
  overLimit: NonNullable<ReviewProjectionEvidence["overLimit"]>,
): ReviewEvidenceLoad {
  return {
    evidence: {
      revisionRecords: [],
      responseRecords: [],
      invalidRecordPaths: [],
      overLimit,
    },
    extraIssues,
  };
}

/**
 * Reads and validates `records/` for the evidence area, applying the
 * count-first file bound before any content is read and the aggregate
 * entry bound after. Returns `evidence: undefined` when `records/` holds no
 * `revisions-*.json`/`responses-*.json` file at all (or cannot be read at
 * all), so the page omits the evidence section entirely and §18 output
 * stays unchanged. Never touches `review index`, which does not read
 * `records/`.
 */
export async function loadReviewEvidence(
  root: string,
  manifestPath: string,
  batchId: string,
): Promise<ReviewEvidenceLoad> {
  const recordsPath = recordsDirectory(manifestPath);

  if (await isRecordsPathUnsafe(root, manifestPath))
    return {
      evidence: undefined,
      extraIssues: [
        buildIssue(
          "REVIEW_PATH_UNSAFE",
          "records path has a symlinked segment",
          recordsPath,
        ),
      ],
    };

  // One `readdir` for the whole evidence load: the same listing serves the
  // file-name count and the two readers below, so `records/` is never
  // listed twice and there is no window for its contents to change between
  // a count and a read (TOCTOU).
  const listing = await listRecordsDirectory(root, manifestPath);
  if (!listing.ok) {
    if (listing.reason === "not-found")
      return { evidence: undefined, extraIssues: [] };
    // A listing failure that is not "the directory does not exist" (e.g.
    // permission denied, or `records/` replaced by a plain file) is a
    // defect of `records/` itself — the same code an individually invalid
    // record file gets, naming the directory instead of one file.
    return {
      evidence: undefined,
      extraIssues: [
        buildIssue(
          "REVIEW_RECORD_INVALID",
          "unable to read the records directory",
          recordsPath,
        ),
      ],
    };
  }

  const nameCounts = countLooseRecordFileNames(listing.names);
  const totalNames = nameCounts.revisionsNames + nameCounts.responsesNames;
  if (totalNames === 0) return { evidence: undefined, extraIssues: [] };

  if (totalNames > MAX_EVIDENCE_RECORD_FILES) {
    return overLimitLoad(
      [
        buildIssue(
          "REVIEW_INPUT_TOO_LARGE",
          `records/ has ${totalNames} revisions-/responses- files, exceeding the projection limit (${MAX_EVIDENCE_RECORD_FILES})`,
        ),
      ],
      { recordFileCount: totalNames },
    );
  }

  // Total size, `lstat`ed (never following a symlinked entry) from the same
  // listing, still before any file is opened (contract §13/§20 修訂，R-005).
  const looseNames = filterLooseRecordFileNames(listing.names);
  const totalBytes = await sumLooseRecordFileBytes(
    root,
    manifestPath,
    looseNames,
  );
  if (totalBytes > MAX_EVIDENCE_TOTAL_BYTES) {
    return overLimitLoad(
      [
        buildIssue(
          "REVIEW_INPUT_TOO_LARGE",
          `records/ revisions-/responses- files total ${totalBytes} bytes across ${totalNames} files, exceeding the projection limit (${MAX_EVIDENCE_TOTAL_BYTES} bytes)`,
        ),
      ],
      { totalBytes },
    );
  }

  const revisionsRead = await readRevisionRecords(
    root,
    manifestPath,
    batchId,
    listing.names,
  );
  const responsesRead = await readResponseRecords(
    root,
    manifestPath,
    batchId,
    listing.names,
  );

  // Security M2: cross-record consistency across every valid revisions
  // record, exactly as `review import`/`review respond` check it. A
  // conflicting id's records are excluded from the evidence content (never
  // silently trusted) and listed under 「未採計的紀錄」 like any other
  // invalid record; the conflict never reaches `computeSupersededBy`.
  //
  // `validateRevisionRecordSet` reports only the *first* problem it finds
  // (same-content conflicts, or else a `supersedes` graph problem) and
  // stops — it never re-checks `supersedes` once a content conflict is
  // excluded. So this re-validates the shrinking survivor set in rounds:
  // each round excludes every path its conflicts name, which is always at
  // least one file, so the loop always terminates (bounded by the record
  // count, itself bounded by the 200-file cap above) once a round reports
  // `ok`.
  const conflictPathSet = new Set<string>();
  const allConflicts: RecordSetConflict[] = [];
  let usableRevisionRecords = revisionsRead.records;
  for (;;) {
    const recordSet = validateRevisionRecordSet(
      usableRevisionRecords.map((record) => ({
        path: record.path,
        revisions: record.sheet.revisions,
      })),
    );
    if (recordSet.ok) break;
    allConflicts.push(...recordSet.conflicts);
    const roundPaths = new Set(
      recordSet.conflicts.flatMap((conflict) => conflict.paths),
    );
    for (const path of roundPaths) conflictPathSet.add(path);
    usableRevisionRecords = usableRevisionRecords.filter(
      (record) => !roundPaths.has(record.path),
    );
  }
  const conflictPaths = [...conflictPathSet];
  const conflictIssues = recordSetConflictIssues(allConflicts);

  // Displayed 「未採計的紀錄」 order: byte order by path, independent of
  // which check excluded a record (invalid shape vs. a cross-record
  // conflict) or which of the two readers found it — the envelope's own
  // `issues[]`/`data.diagnostics[]` order is untouched by this sort.
  const invalidRecordPaths = [
    ...revisionsRead.invalid.map((entry) => entry.path),
    ...responsesRead.invalid.map((entry) => entry.path),
    ...conflictPaths,
  ].sort(compareUtf8);
  const invalidIssues = [
    ...revisionsRead.invalid.map((entry) => invalidRecordIssue(entry.path)),
    ...responsesRead.invalid.map((entry) => invalidRecordIssue(entry.path)),
    ...conflictIssues,
  ];

  const revisionRecords: RevisionEvidenceRecord[] = usableRevisionRecords.map(
    (record) => ({
      path: record.path,
      sha256: record.sha256,
      sheet: record.sheet,
    }),
  );
  const responseRecords: ResponseEvidenceRecord[] = responsesRead.records.map(
    (record) => ({ path: record.path, data: record.record }),
  );

  const entryCount =
    revisionRecords.reduce(
      (sum, record) => sum + record.sheet.revisions.length,
      0,
    ) +
    responseRecords.reduce(
      (sum, record) => sum + record.data.responses.length,
      0,
    );

  if (entryCount > MAX_EVIDENCE_ENTRIES) {
    return overLimitLoad(
      [
        ...invalidIssues,
        buildIssue(
          "REVIEW_INPUT_TOO_LARGE",
          `valid records hold ${entryCount} revisions/responses, exceeding the projection limit (${MAX_EVIDENCE_ENTRIES})`,
        ),
      ],
      { entryCount },
    );
  }

  return {
    evidence: {
      revisionRecords,
      responseRecords,
      invalidRecordPaths,
    },
    extraIssues: invalidIssues,
  };
}
