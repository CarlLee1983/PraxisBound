/**
 * `review confirm`'s read of the existing `records/revisions-*.json`/
 * `records/responses-*.json` it depends on (contract §7), and the effective/
 * unresolved-request computation built from them. Split out of
 * `review-confirm.ts` so that file stays focused on orchestration.
 *
 * Scope note (Story TST-026 review round 1): `records/confirmation-*.json`
 * files are never read here. Contract §8 lists no refusal driven by other
 * confirmation records, so an invalid or numerous confirmation collection
 * must never block `confirm` — only `review render`'s advisory staleness
 * diagnostics and `confirm`'s own single-target read (`review-confirm-write.ts`)
 * touch `confirmation-*.json` at all.
 */

import {
  computeEffectiveRevisions,
  validateRevisionRecordSet,
  type ResultEnvelope,
  type RevisionRecord,
  type RevisionResponsesData,
} from "@praxisbound/core";

import { recordSetInvalidIssues } from "./review-input.js";
import { readResponseRecords, readRevisionRecords } from "./review-records.js";
import { envelope, issue } from "./review.js";

export type ConfirmRecordsLoad =
  | {
      readonly ok: true;
      readonly effective: readonly RevisionRecord[];
      readonly responseRecords: readonly RevisionResponsesData[];
      /** Every valid imported revisions record's own content sha256. */
      readonly revisionSheetShas: readonly string[];
    }
  | { readonly ok: false; readonly result: ResultEnvelope };

/**
 * Reads and validates every existing `records/revisions-*.json`/
 * `records/responses-*.json` (name pattern, schema, §13 limits, and the §6
 * security M2 cross-record check), exactly as `review respond` validates
 * them — an invalid one refuses the whole command, since §7's unresolved-
 * request computation needs the full, trustworthy set. Takes an
 * already-fetched `records/` listing (`names`), so `records/` is never
 * listed twice.
 */
export async function loadConfirmRecords(
  root: string,
  manifestPath: string,
  batchId: string,
  names: readonly string[],
): Promise<ConfirmRecordsLoad> {
  const revisionRecords = await readRevisionRecords(
    root,
    manifestPath,
    batchId,
    names,
  );
  const responseRecords = await readResponseRecords(
    root,
    manifestPath,
    batchId,
    names,
  );
  const existingInvalid = [
    ...revisionRecords.invalid,
    ...responseRecords.invalid,
  ];
  if (existingInvalid.length > 0) {
    return {
      ok: false,
      result: envelope(
        "fail",
        "failure",
        1,
        existingInvalid.map((entry) =>
          issue(
            "REVIEW_RECORD_INVALID",
            "existing record is invalid",
            entry.path,
          ),
        ),
      ),
    };
  }

  // Security M2: a cross-record inconsistency among otherwise individually
  // valid revisions records is a defect of records/ itself.
  const recordSet = validateRevisionRecordSet(
    revisionRecords.records.map((record) => ({
      path: record.path,
      revisions: record.sheet.revisions,
    })),
  );
  if (!recordSet.ok) {
    return {
      ok: false,
      result: envelope(
        "fail",
        "failure",
        1,
        recordSetInvalidIssues(recordSet.conflicts),
      ),
    };
  }

  const effective = computeEffectiveRevisions(
    [...revisionRecords.bySha256.values()].map((sheet) => sheet.revisions),
  );

  return {
    ok: true,
    effective,
    responseRecords: responseRecords.records.map((record) => record.record),
    revisionSheetShas: [...revisionRecords.bySha256.keys()],
  };
}
