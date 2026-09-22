/**
 * `praxisbound review respond <manifest> <responses.json>` (contract §7,
 * 修訂，R-005): the only way to write a Revision Response record, checked
 * in the exact order the contract names.
 */

import {
  buildTargetLookup,
  computeEffectiveRevisions,
  matchRevisionTarget,
  parseRevisionResponses,
  sha256Hex,
  validateRevisionRecordSet,
  type ReviewIndex,
} from "@praxisbound/core";

import {
  parseManifestAndFileArguments,
  readInputFile,
  recordSetInvalidIssues,
} from "./review-input.js";
import {
  createNewRecord,
  isRecordsPathUnsafe,
  readResponseRecords,
  readRevisionRecords,
  RECORD_MAX_BYTES,
} from "./review-records.js";
import {
  envelope,
  escapeHumanControlCharacters,
  issue,
  runReviewIndexUnsafe,
  sanitizeInternalError,
  toDataValue,
  type ReviewIndexExecution,
  type ReviewRenderedOutput,
} from "./review.js";

const RESPONSE_WRITE_MAX_ATTEMPTS = 100000;

export const reviewRespondHelp = `PraxisBound Batch Review Respond

Usage:
  praxisbound review respond <manifest> <responses.json> [--json]
  praxisbound review respond --help

Reads one Revision Response file and, after checking it against the
imported Revision Sheets and the current fingerprint (contract §7), writes
it verbatim to records/responses-<to12>-<n>.json. Writing a response record
never approves anything and never changes a source, confirmation, packet,
or other record.
`;

function mismatchIssues(
  missing: readonly string[],
  extra: readonly string[],
): readonly ReturnType<typeof issue>[] {
  return [
    ...missing.map((id) => ({
      ...issue(
        "REVIEW_RESPONSE_MISMATCH",
        "no response answers this effective request",
      ),
      subject: `revision:${id}`,
    })),
    ...extra.map((id) => ({
      ...issue(
        "REVIEW_RESPONSE_MISMATCH",
        "this response does not answer an effective request of the listed sheets",
      ),
      subject: `revision:${id}`,
    })),
  ];
}

/** Runs `praxisbound review respond <manifest> <responses.json>`. */
export async function runReviewRespond(
  args: readonly string[],
  root: string = process.cwd(),
): Promise<ReviewIndexExecution> {
  const parsed = parseManifestAndFileArguments(args);
  const responsesArgument = parsed.file;
  if (
    !parsed.valid ||
    parsed.manifest === undefined ||
    responsesArgument === undefined
  ) {
    return {
      mode: parsed.mode,
      result: envelope("error", "usage-error", 2, [
        issue("REVIEW_USAGE", "Invalid arguments"),
      ]),
    };
  }

  try {
    const loaded = await runReviewIndexUnsafe(
      [parsed.manifest, "--json"],
      root,
    );
    if (loaded.result.outcome !== "success" || loaded.loaded === undefined)
      return { mode: parsed.mode, result: loaded.result };

    const { manifestPath, index } = loaded.loaded;

    if (await isRecordsPathUnsafe(root, manifestPath)) {
      return {
        mode: parsed.mode,
        result: envelope("error", "configuration-error", 2, [
          issue("REVIEW_PATH_UNSAFE", "records path has a symlinked segment"),
        ]),
      };
    }

    // §7 step 1: schema and §13 limits for every existing revisions/responses
    // record this command depends on.
    const revisionRecords = await readRevisionRecords(
      root,
      manifestPath,
      index.batchId,
    );
    const responseRecords = await readResponseRecords(
      root,
      manifestPath,
      index.batchId,
    );
    const invalid = [...revisionRecords.invalid, ...responseRecords.invalid];
    if (invalid.length > 0) {
      return {
        mode: parsed.mode,
        result: envelope(
          "fail",
          "failure",
          1,
          invalid.map((entry) =>
            issue(
              "REVIEW_RECORD_INVALID",
              "existing record is invalid",
              entry.path,
            ),
          ),
        ),
      };
    }

    // Security M2: already-imported revisions records are re-checked as a
    // whole, not just individually. A cross-record inconsistency is a
    // `records/` defect, reported as `REVIEW_RECORD_INVALID` naming the
    // involved file(s) — never `REVIEW_REVISION_CONFLICT`, which means
    // "this response conflicts".
    const recordSet = validateRevisionRecordSet(
      revisionRecords.records.map((record) => ({
        path: record.path,
        revisions: record.sheet.revisions,
      })),
    );
    if (!recordSet.ok) {
      return {
        mode: parsed.mode,
        result: envelope(
          "fail",
          "failure",
          1,
          recordSetInvalidIssues(recordSet.conflicts),
        ),
      };
    }

    // §7 step 1 (continued): the response file itself — schema, §13 limits,
    // and its `batchId` (M1; not a cross-record concern, so it is checked
    // here rather than folded into schema validation).
    const responsesRead = await readInputFile(
      root,
      responsesArgument,
      RECORD_MAX_BYTES,
    );
    if (responsesRead.kind === "too-large") {
      return {
        mode: parsed.mode,
        result: envelope("fail", "failure", 1, [
          issue(
            "REVIEW_INPUT_TOO_LARGE",
            "response file exceeds the size limit (1 MiB)",
          ),
        ]),
      };
    }
    if (responsesRead.kind === "missing") {
      return {
        mode: parsed.mode,
        result: envelope("fail", "failure", 1, [
          issue(
            "REVIEW_RESPONSE_INVALID",
            "response file is missing or unreadable",
          ),
        ]),
      };
    }
    if (responsesRead.kind === "invalid-utf8") {
      return {
        mode: parsed.mode,
        result: envelope("fail", "failure", 1, [
          issue(
            "REVIEW_RESPONSE_INVALID",
            "response file is not valid UTF-8 text",
          ),
        ]),
      };
    }

    const parsedResponses = parseRevisionResponses(responsesRead.text);
    if (!parsedResponses.ok) {
      if (parsedResponses.unsupportedSchema) {
        return {
          mode: parsed.mode,
          result: envelope("fail", "failure", 1, [
            issue("REVIEW_SCHEMA_UNSUPPORTED", parsedResponses.message),
          ]),
        };
      }
      return {
        mode: parsed.mode,
        result: envelope("fail", "failure", 1, [
          issue(
            parsedResponses.tooLarge
              ? "REVIEW_INPUT_TOO_LARGE"
              : "REVIEW_RESPONSE_INVALID",
            parsedResponses.message,
          ),
        ]),
      };
    }
    const responses = parsedResponses.record;

    if (responses.batchId !== index.batchId) {
      return {
        mode: parsed.mode,
        result: envelope("fail", "failure", 1, [
          issue(
            "REVIEW_RESPONSE_INVALID",
            "batchId does not match the current batch",
          ),
        ]),
      };
    }

    // §7 step 2: every `revisionSheets` entry names an imported record.
    const namedSheets = responses.revisionSheets.map((sha) =>
      revisionRecords.bySha256.get(sha),
    );
    if (namedSheets.some((sheet) => sheet === undefined)) {
      return {
        mode: parsed.mode,
        result: envelope("fail", "failure", 1, [
          issue(
            "REVIEW_RESPONSE_INVALID",
            "revisionSheets names a record that was never imported",
          ),
        ]),
      };
    }
    const listedSheets = namedSheets as NonNullable<
      (typeof namedSheets)[number]
    >[];

    // §7 step 3: `fromFingerprint` equals the `fingerprint` of at least one listed sheet.
    if (
      !listedSheets.some(
        (sheet) => sheet.fingerprint === responses.fromFingerprint,
      )
    ) {
      return {
        mode: parsed.mode,
        result: envelope("fail", "failure", 1, [
          issue(
            "REVIEW_RESPONSE_INVALID",
            "fromFingerprint matches no listed revision sheet",
          ),
        ]),
      };
    }

    // §7 step 4: `toFingerprint` equals the fingerprint recomputed at write time.
    if (responses.toFingerprint !== index.fingerprint) {
      return {
        mode: parsed.mode,
        result: envelope("fail", "failure", 1, [
          issue(
            "REVIEW_RESPONSE_STALE",
            "toFingerprint does not match the current fingerprint",
          ),
        ]),
      };
    }

    // §7 step 5: exactly one response per effective request of the listed sheets.
    // R10: effective requests are drawn from every imported sheet, not only
    // the ones this response file lists, so `supersedes` is resolved across
    // the whole batch (Core's `computeEffectiveRevisions`) before the
    // listed-sheet subset is taken.
    const effectiveAcrossBatch = new Set(
      computeEffectiveRevisions(
        [...revisionRecords.bySha256.values()].map((sheet) => sheet.revisions),
      ).map((revision) => revision.id),
    );
    const listedIds = new Set<string>();
    for (const sheet of listedSheets)
      for (const revision of sheet.revisions) listedIds.add(revision.id);
    const effectiveIds = [...listedIds].filter((id) =>
      effectiveAcrossBatch.has(id),
    );

    const responseIds = responses.responses.map(
      (response) => response.revisionId,
    );
    const responseIdCounts = new Map<string, number>();
    for (const id of responseIds)
      responseIdCounts.set(id, (responseIdCounts.get(id) ?? 0) + 1);
    const effectiveSet = new Set(effectiveIds);
    const missingIds = effectiveIds.filter(
      (id) => (responseIdCounts.get(id) ?? 0) !== 1,
    );
    const extraIds = [...responseIdCounts.keys()].filter(
      (id) => !effectiveSet.has(id),
    );
    if (missingIds.length > 0 || extraIds.length > 0) {
      return {
        mode: parsed.mode,
        result: envelope(
          "fail",
          "failure",
          1,
          mismatchIssues(missingIds, extraIds),
        ),
      };
    }

    // §7 step 6: the per-response field rules are already enforced by
    // `parseRevisionResponses`'s schema validation; the two-fingerprint
    // rule and "every `incorporated` locator matches current sources by §5"
    // both need the current source index, so they are checked here.
    const anyIncorporated = responses.responses.some(
      (response) => response.outcome === "incorporated",
    );
    if (
      anyIncorporated &&
      responses.fromFingerprint === responses.toFingerprint
    ) {
      return {
        mode: parsed.mode,
        result: envelope("fail", "failure", 1, [
          issue(
            "REVIEW_RESPONSE_INVALID",
            "fromFingerprint and toFingerprint must differ when a response is incorporated",
          ),
        ]),
      };
    }

    const lookup = buildTargetLookup(index);
    const batchBlockSha256 = sha256Hex(
      new TextEncoder().encode(index.fingerprint),
    );
    const nonMatchingIds: string[] = [];
    for (const response of responses.responses) {
      if (response.outcome !== "incorporated") continue;
      const allMatch = response.locators.every(
        (locator) =>
          matchRevisionTarget(
            lookup,
            manifestPath,
            batchBlockSha256,
            locator,
          ) === "match",
      );
      if (!allMatch) nonMatchingIds.push(response.revisionId);
    }
    if (nonMatchingIds.length > 0) {
      return {
        mode: parsed.mode,
        result: envelope(
          "fail",
          "failure",
          1,
          nonMatchingIds.map((id) => ({
            ...issue(
              "REVIEW_RESPONSE_INVALID",
              "an incorporated response's locator does not match current sources",
            ),
            subject: `revision:${id}`,
          })),
        ),
      };
    }

    const to12 = index.fingerprint.slice(0, 12);
    const written = await createNewRecord(
      root,
      manifestPath,
      (attempt) => `responses-${to12}-${attempt}.json`,
      responsesRead.bytes,
      { maxAttempts: RESPONSE_WRITE_MAX_ATTEMPTS },
    );
    if (!written.ok) {
      if (written.reason === "unsafe") {
        return {
          mode: parsed.mode,
          result: envelope("error", "configuration-error", 2, [
            issue("REVIEW_PATH_UNSAFE", "records path has a symlinked segment"),
          ]),
        };
      }
      return {
        mode: parsed.mode,
        result: envelope("fail", "failure", 1, [
          issue(
            "REVIEW_RECORD_WRITE_FAILED",
            "unable to write the response record",
          ),
        ]),
      };
    }

    return {
      mode: parsed.mode,
      result: buildRespondSuccessEnvelope(index, written.relativePath),
    };
  } catch (error) {
    process.stderr.write(
      `praxisbound review respond: internal error: ${sanitizeInternalError(error, root)}\n`,
    );
    return {
      mode: parsed.mode,
      result: envelope("error", "ERROR", 3, [
        issue(
          "REVIEW_INTERNAL_ERROR",
          "an unexpected internal failure occurred",
        ),
      ]),
    };
  }
}

function buildRespondSuccessEnvelope(index: ReviewIndex, record: string) {
  const issues = index.diagnostics.map((entry) =>
    issue(entry.code, entry.message, entry.path),
  );
  const diagnostics = index.diagnostics.map((entry) => ({
    code: entry.code,
    severity: entry.severity,
    ...(entry.locator === undefined
      ? {}
      : { locator: toDataValue(entry.locator) }),
  }));
  return envelope("pass", "success", 0, issues, {
    batchId: index.batchId,
    fingerprint: index.fingerprint,
    sources: toDataValue(index.sources),
    diagnostics: toDataValue(diagnostics),
    record,
  });
}

/** Renders the human output for `review respond`. */
export function renderReviewRespondHuman(
  execution: ReviewIndexExecution,
): ReviewRenderedOutput {
  const { result } = execution;
  if (result.outcome === "usage-error") {
    return {
      stdout: "",
      stderr:
        "ERROR Invalid arguments\n" +
        "Usage: praxisbound review respond <manifest> <responses.json> [--json]\n" +
        "       praxisbound review respond --help\n",
    };
  }
  if (result.outcome !== "success") {
    const lines = [
      "PraxisBound Batch Review Respond",
      "",
      `Result: ${result.outcome}`,
      "",
    ];
    for (const reported of result.issues)
      lines.push(
        `FAIL ${reported.code}: ${escapeHumanControlCharacters(reported.message)}`,
      );
    return { stdout: `${lines.join("\n")}\n`, stderr: "" };
  }
  const data = result.data as
    | {
        readonly batchId: string;
        readonly fingerprint: string;
        readonly record: string;
      }
    | undefined;
  const lines = ["PraxisBound Batch Review Respond", ""];
  if (data !== undefined) {
    lines.push(`Batch: ${data.batchId}`);
    lines.push(`Fingerprint: ${data.fingerprint}`);
    lines.push(`Record: ${data.record}`);
  }
  for (const reported of result.issues)
    lines.push(
      `ISSUE ${reported.code}: ${escapeHumanControlCharacters(reported.message)}`,
    );
  lines.push("", "Result: success", "");
  return { stdout: `${lines.join("\n")}\n`, stderr: "" };
}
