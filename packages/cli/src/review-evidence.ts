/**
 * `review render`'s "修訂紀錄證據" (revision-record evidence) area loader
 * (contract §13, §20 修訂，R-005): reads and validates `records/`, applies
 * the count-first 200-file bound and the post-read 10000-entry bound, and
 * excludes any revision id whose content disagrees across records (§6
 * security M2), before handing the survivors to Core's
 * `renderEvidenceSection`. Kept separate from `review.ts` so that file does
 * not keep growing, and to avoid an import cycle: this module depends on
 * `review-records.ts`, never the reverse.
 */

import type {
  ResponseEvidenceRecord,
  ResultIssue,
  ReviewProjectionEvidence,
  RevisionEvidenceRecord,
} from "@praxisbound/core";
import { validateRevisionRecordSet } from "@praxisbound/core";

import {
  countLooseRecordFileNames,
  isRecordsPathUnsafe,
  listRecordsDirectory,
  readResponseRecords,
  readRevisionRecords,
  recordsDirectory,
} from "./review-records.js";

const MAX_EVIDENCE_RECORD_FILES = 200;
const MAX_EVIDENCE_ENTRIES = 10000;

/** A minimal `ResultIssue` builder, kept local (rather than imported from `review.ts`) so this module never has to import back from its own caller. */
function buildIssue(code: string, message: string, path?: string): ResultIssue {
  return path === undefined ? { code, message } : { code, message, path };
}

/**
 * `REVIEW_RECORD_INVALID` issues for a `validateRevisionRecordSet` failure,
 * one per involved file — the same shape `review-input.ts`'s
 * `recordSetInvalidIssues` produces for `review import`/`review respond`,
 * duplicated here in miniature rather than imported, again to avoid a cycle
 * through `review.ts`.
 */
function recordSetConflictIssues(
  conflicts: readonly {
    readonly id: string;
    readonly paths: readonly string[];
    readonly message: string;
  }[],
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
  const recordSet = validateRevisionRecordSet(
    revisionsRead.records.map((record) => ({
      path: record.path,
      revisions: record.sheet.revisions,
    })),
  );
  const conflictPaths = recordSet.ok
    ? []
    : [...new Set(recordSet.conflicts.flatMap((conflict) => conflict.paths))];
  const conflictPathSet = new Set(conflictPaths);
  const usableRevisionRecords = revisionsRead.records.filter(
    (record) => !conflictPathSet.has(record.path),
  );
  const conflictIssues = recordSet.ok
    ? []
    : recordSetConflictIssues(recordSet.conflicts);

  const invalidRecordPaths = [
    ...revisionsRead.invalid.map((entry) => entry.path),
    ...responsesRead.invalid.map((entry) => entry.path),
    ...conflictPaths,
  ];
  const invalidIssues = [
    ...revisionsRead.invalid.map((entry) =>
      buildIssue("REVIEW_RECORD_INVALID", "record is invalid", entry.path),
    ),
    ...responsesRead.invalid.map((entry) =>
      buildIssue("REVIEW_RECORD_INVALID", "record is invalid", entry.path),
    ),
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
