/**
 * Filesystem access to `records/confirmation-*.json` (contract §8, §8 修訂，
 * R-006): the count-first 200-file bound, the pre-read 16 MiB total-size
 * bound (both checked before any content is read, and kept separate from
 * §13/§20's `revisions-`/`responses-` evidence bounds), per-record validation
 * (schema, §13 limits, fp12-vs-`fingerprint` filename match), reused by both
 * `review confirm` (the same-fingerprint collision check) and `review
 * render` (the applicability/staleness advisory diagnostics). Kept separate
 * from `review-records.ts` so that file does not keep growing, mirroring how
 * `review-evidence.ts` is split out for the `revisions-`/`responses-`
 * bounds.
 */

import { lstat } from "node:fs/promises";
import { resolve } from "node:path";

import {
  compareConfirmationApplicability,
  compareUtf8,
  validateStoredConfirmationRecord,
  type ConfirmationApplicability,
  type ConfirmationData,
  type ReviewIndex,
} from "@praxisbound/core";

import {
  parseRecordJson,
  readRecordBytes,
  recordsDirectory,
  type RecordsListingState,
} from "./review-records.js";

export const MAX_CONFIRMATION_RECORD_FILES = 200;
export const MAX_CONFIRMATION_TOTAL_BYTES = 16 * 1024 * 1024;

const CONFIRMATION_RECORD_STRICT = /^confirmation-([0-9a-f]{12})\.json$/;

export function isLooseConfirmationName(name: string): boolean {
  return name.startsWith("confirmation-") && name.endsWith(".json");
}

export interface InvalidConfirmationRecord {
  readonly path: string;
}

export interface ValidConfirmationRecord {
  readonly path: string;
  readonly record: ConfirmationData;
}

export interface ConfirmationRecordsRead {
  readonly invalid: readonly InvalidConfirmationRecord[];
  readonly records: readonly ValidConfirmationRecord[];
}

/**
 * Reads and validates every `records/confirmation-*.json` from an
 * already-fetched `records/` directory listing (contract §2, §8): a loose
 * name that fails the strict `confirmation-<fp12>.json` pattern, or whose
 * `fp12` disagrees with the content's own `fingerprint`, is invalid, not
 * silently skipped, same as a `revisions-`/`responses-` record.
 */
export async function readConfirmationRecords(
  root: string,
  manifestPath: string,
  batchId: string,
  names: readonly string[],
): Promise<ConfirmationRecordsRead> {
  const entries = names.filter(isLooseConfirmationName);
  const invalid: InvalidConfirmationRecord[] = [];
  const records: ValidConfirmationRecord[] = [];
  for (const name of entries.sort(compareUtf8)) {
    const relativePath = `${recordsDirectory(manifestPath)}/${name}`;
    const match = CONFIRMATION_RECORD_STRICT.exec(name);
    if (match === null) {
      invalid.push({ path: relativePath });
      continue;
    }
    const bytes = await readRecordBytes(resolve(root, relativePath));
    if (bytes === undefined) {
      invalid.push({ path: relativePath });
      continue;
    }
    const parsed = parseRecordJson(bytes);
    if (!parsed.ok) {
      invalid.push({ path: relativePath });
      continue;
    }
    const validated = validateStoredConfirmationRecord(parsed.data, batchId);
    if (
      !validated.ok ||
      validated.record.fingerprint.slice(0, 12) !== match[1]
    ) {
      invalid.push({ path: relativePath });
      continue;
    }
    records.push({ path: relativePath, record: validated.record });
  }
  return { invalid, records };
}

/**
 * Sums every loose `confirmation-*.json` file's filesystem-reported size
 * (contract §8 修訂，R-006), `lstat`ing each so a symlinked entry is never
 * followed — the same non-follow discipline `review-evidence.ts`'s
 * `sumLooseRecordFileBytes` uses for `revisions-`/`responses-` files. A name
 * whose `lstat` itself fails contributes nothing to the sum and is left for
 * the ordinary per-file read to find and report invalid.
 */
export async function sumLooseConfirmationFileBytes(
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

interface ConfirmationIssueLike {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
}

function buildIssue(
  code: string,
  message: string,
  path?: string,
): ConfirmationIssueLike {
  return path === undefined ? { code, message } : { code, message, path };
}

export interface ReviewConfirmationLoad {
  /** `undefined` when no valid confirmation record exists at all — `records/` has none, the file bound was exceeded, or every found file was invalid (contract §8 修訂，R-006: "完全沒有確認紀錄時不產生，也不標示任何文件"). */
  readonly applicability: ConfirmationApplicability | undefined;
  /** `REVIEW_RECORD_INVALID`/`REVIEW_INPUT_TOO_LARGE`, always blocking. */
  readonly blockingIssues: readonly ConfirmationIssueLike[];
  /** `REVIEW_SOURCE_ADDED`/`REVIEW_SOURCE_REMOVED`/`REVIEW_SOURCE_CHANGED`/`REVIEW_MANIFEST_CHANGED`, always advisory, produced only when at least one valid confirmation exists and none applies (contract §8 修訂，R-006). */
  readonly advisoryIssues: readonly ConfirmationIssueLike[];
}

/**
 * Reads `records/confirmation-*.json`, applies the count-first 200-file
 * bound and the pre-read 16 MiB total-size bound (both checked before any
 * confirmation file content is read, separate from §13/§20's `revisions-`/
 * `responses-` evidence bounds), validates every file found, and computes
 * applicability against the current index (contract §8, §8 修訂，R-006).
 * Used by `review render` and, purely informationally, by `review confirm`'s
 * own staleness reminder; `review index` never reads `records/`. Takes the
 * one shared `records/` safety check and listing (`loadRecordsListingState`)
 * the caller already computed, so a symlinked or unlistable `records/`
 * produces one diagnostic from the caller, not a second copy here (Story
 * TST-026 review round 1).
 */
export async function loadReviewConfirmationApplicability(
  root: string,
  manifestPath: string,
  index: Pick<
    ReviewIndex,
    "batchId" | "fingerprint" | "manifestSha256" | "sources"
  >,
  state: RecordsListingState,
): Promise<ReviewConfirmationLoad> {
  const empty: ReviewConfirmationLoad = {
    applicability: undefined,
    blockingIssues: [],
    advisoryIssues: [],
  };

  if (state.unsafe) return empty;
  const listing = state.listing;
  if (!listing.ok) return empty;

  const looseNames = listing.names.filter(isLooseConfirmationName);
  if (looseNames.length === 0) return empty;

  if (looseNames.length > MAX_CONFIRMATION_RECORD_FILES) {
    return {
      ...empty,
      blockingIssues: [
        buildIssue(
          "REVIEW_INPUT_TOO_LARGE",
          `records/ has ${looseNames.length} confirmation- files, exceeding the limit (${MAX_CONFIRMATION_RECORD_FILES})`,
        ),
      ],
    };
  }

  const totalBytes = await sumLooseConfirmationFileBytes(
    root,
    manifestPath,
    looseNames,
  );
  if (totalBytes > MAX_CONFIRMATION_TOTAL_BYTES) {
    return {
      ...empty,
      blockingIssues: [
        buildIssue(
          "REVIEW_INPUT_TOO_LARGE",
          `records/ confirmation- files total ${totalBytes} bytes, exceeding the limit (${MAX_CONFIRMATION_TOTAL_BYTES} bytes)`,
        ),
      ],
    };
  }

  const read = await readConfirmationRecords(
    root,
    manifestPath,
    index.batchId,
    listing.names,
  );
  const blockingIssues = read.invalid.map((entry) =>
    buildIssue(
      "REVIEW_RECORD_INVALID",
      "confirmation record is invalid",
      entry.path,
    ),
  );

  const applicability = compareConfirmationApplicability(
    {
      fingerprint: index.fingerprint,
      manifestSha256: index.manifestSha256,
      sources: index.sources,
    },
    read.records,
  );

  // Advisory diagnostics only when at least one valid confirmation exists
  // and none applies (contract §8 修訂，R-006); `applicability.applies` and
  // the "no valid confirmation at all" case both produce none.
  const advisoryIssues: ConfirmationIssueLike[] =
    !applicability.applies && applicability.latest !== undefined
      ? [
          ...applicability.sourceChanges.map((change) =>
            buildIssue(
              change.kind === "added"
                ? "REVIEW_SOURCE_ADDED"
                : change.kind === "removed"
                  ? "REVIEW_SOURCE_REMOVED"
                  : "REVIEW_SOURCE_CHANGED",
              `source ${change.kind} since the latest valid confirmation`,
              change.path,
            ),
          ),
          ...(applicability.manifestChanged
            ? [
                buildIssue(
                  "REVIEW_MANIFEST_CHANGED",
                  "the manifest changed since the latest valid confirmation",
                  manifestPath,
                ),
              ]
            : []),
        ]
      : [];

  return { applicability, blockingIssues, advisoryIssues };
}
