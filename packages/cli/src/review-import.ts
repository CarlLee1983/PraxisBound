/**
 * `praxisbound review import <manifest> <sheet>` (contract §6, 修訂，R-005).
 *
 * Reuses `runReviewIndexUnsafe` to load the manifest and current source
 * index, then validates every existing `records/revisions-*.json` before
 * parsing the caller's Revision Sheet, applying the contract §6 dedupe,
 * conflict, and `supersedes` rules (matching the TST-023 page script via
 * `@praxisbound/core`'s ported `revision-sheet` module), and reporting a
 * per-target match against the current sources (contract §5).
 */

import {
  buildTargetLookup,
  matchRevisionTarget,
  parseRevisionSheetBlock,
  sameRevisionContent,
  sha256Hex,
  validateRevisionRecordSet,
  type ReviewIndex,
  type RevisionRecord,
} from "@praxisbound/core";

import {
  conflictIssues,
  parseManifestAndFileArguments,
  readInputFile,
  recordSetInvalidIssues,
} from "./review-input.js";
import {
  createNewRecord,
  isRecordsPathUnsafe,
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

export const reviewImportHelp = `PraxisBound Batch Review Import

Usage:
  praxisbound review import <manifest> <sheet> [--json]
  praxisbound review import --help

Reads one exported Revision Sheet (a Markdown file with one
praxisbound-revisions block) and records it for the batch the manifest
declares. Every existing records/revisions-*.json is read and validated
first; a sheet with at least one new (non-duplicate) request is written
verbatim to records/revisions-<sheet12>.json. The command never changes a
source, confirms a definition, or grants any authority.
`;

interface TargetResult {
  readonly path: string;
  readonly anchor: string;
  readonly blockSha256: string;
  readonly match:
    "match" | "hash-mismatch" | "anchor-missing" | "anchor-duplicate";
}

interface RevisionResult {
  readonly id: string;
  readonly status: "new" | "duplicate";
  readonly targets: readonly TargetResult[];
}

/** Builds a Map from revision id to its full record, across every valid imported sheet. */
function flattenImported(
  bySha256: ReadonlyMap<
    string,
    { readonly revisions: readonly RevisionRecord[] }
  >,
): Map<string, RevisionRecord> {
  const byId = new Map<string, RevisionRecord>();
  for (const sheet of bySha256.values()) {
    for (const revision of sheet.revisions) byId.set(revision.id, revision);
  }
  return byId;
}

/** Runs `praxisbound review import <manifest> <sheet>`. */
export async function runReviewImport(
  args: readonly string[],
  root: string = process.cwd(),
): Promise<ReviewIndexExecution> {
  const parsed = parseManifestAndFileArguments(args);
  const sheetArgument = parsed.file;
  if (
    !parsed.valid ||
    parsed.manifest === undefined ||
    sheetArgument === undefined
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

    const existing = await readRevisionRecords(
      root,
      manifestPath,
      index.batchId,
    );
    if (existing.invalid.length > 0) {
      return {
        mode: parsed.mode,
        result: envelope(
          "fail",
          "failure",
          1,
          existing.invalid.map((entry) =>
            issue(
              "REVIEW_RECORD_INVALID",
              "existing revision record is invalid",
              entry.path,
            ),
          ),
        ),
      };
    }

    // Security M2: the already-imported records are re-checked as a whole,
    // not just individually, before this sheet is compared against them. A
    // cross-record inconsistency is a `records/` defect, reported as
    // `REVIEW_RECORD_INVALID` naming the involved file(s) — never
    // `REVIEW_REVISION_CONFLICT`, which means "this sheet conflicts".
    const recordSet = validateRevisionRecordSet(
      existing.records.map((record) => ({
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

    const sheetRead = await readInputFile(
      root,
      sheetArgument,
      RECORD_MAX_BYTES,
    );
    if (sheetRead.kind === "too-large") {
      return {
        mode: parsed.mode,
        result: envelope("fail", "failure", 1, [
          issue(
            "REVIEW_INPUT_TOO_LARGE",
            "sheet exceeds the size limit (1 MiB)",
          ),
        ]),
      };
    }
    if (sheetRead.kind === "missing") {
      return {
        mode: parsed.mode,
        result: envelope("fail", "failure", 1, [
          issue(
            "REVIEW_REVISION_SHEET_INVALID",
            "sheet is missing or unreadable",
          ),
        ]),
      };
    }
    if (sheetRead.kind === "invalid-utf8") {
      return {
        mode: parsed.mode,
        result: envelope("fail", "failure", 1, [
          issue(
            "REVIEW_REVISION_SHEET_INVALID",
            "sheet is not valid UTF-8 text",
          ),
        ]),
      };
    }

    const parsedSheet = parseRevisionSheetBlock(sheetRead.text, index.batchId);
    if (!parsedSheet.ok) {
      if (parsedSheet.unsupportedSchema) {
        return {
          mode: parsed.mode,
          result: envelope("fail", "failure", 1, [
            issue("REVIEW_SCHEMA_UNSUPPORTED", parsedSheet.message),
          ]),
        };
      }
      if (parsedSheet.tooLarge) {
        return {
          mode: parsed.mode,
          result: envelope("fail", "failure", 1, [
            issue("REVIEW_INPUT_TOO_LARGE", parsedSheet.message),
          ]),
        };
      }
      if (parsedSheet.conflictIds !== undefined) {
        return {
          mode: parsed.mode,
          result: envelope(
            "fail",
            "failure",
            1,
            conflictIssues(parsedSheet.message, parsedSheet.conflictIds),
          ),
        };
      }
      return {
        mode: parsed.mode,
        result: envelope("fail", "failure", 1, [
          issue("REVIEW_REVISION_SHEET_INVALID", parsedSheet.message),
        ]),
      };
    }

    const sheet = parsedSheet.sheet;
    const importedById = flattenImported(existing.bySha256);
    const sheetIds = new Set(sheet.revisions.map((revision) => revision.id));
    const knownIds = new Set<string>([...importedById.keys(), ...sheetIds]);

    // R3: same id against every imported sheet — same content dedupes, different content rejects the whole sheet.
    const crossSheetConflictIds: string[] = [];
    const statusById = new Map<string, "new" | "duplicate">();
    for (const revision of sheet.revisions) {
      const found = importedById.get(revision.id);
      if (found === undefined) {
        statusById.set(revision.id, "new");
      } else if (sameRevisionContent(found, revision)) {
        statusById.set(revision.id, "duplicate");
      } else {
        crossSheetConflictIds.push(revision.id);
      }
    }
    if (crossSheetConflictIds.length > 0) {
      return {
        mode: parsed.mode,
        result: envelope(
          "fail",
          "failure",
          1,
          conflictIssues(
            "revision has different content than an already imported revision",
            crossSheetConflictIds,
          ),
        ),
      };
    }

    // R4: after dedupe, only new revisions have `supersedes` checked against the combined known set.
    const supersededBy = new Map<string, string>();
    for (const [id, revision] of importedById)
      if (typeof revision.supersedes === "string")
        supersededBy.set(revision.supersedes, id);
    for (const revision of sheet.revisions)
      if (
        typeof revision.supersedes === "string" &&
        !supersededBy.has(revision.supersedes)
      )
        supersededBy.set(revision.supersedes, revision.id);

    const supersedesConflictIds: string[] = [];
    for (const revision of sheet.revisions) {
      if (statusById.get(revision.id) !== "new") continue;
      if (typeof revision.supersedes !== "string") continue;
      const target = revision.supersedes;
      const targetExists = knownIds.has(target);
      const supersededByOther =
        supersededBy.get(target) !== undefined &&
        supersededBy.get(target) !== revision.id;
      if (!targetExists || supersededByOther)
        supersedesConflictIds.push(revision.id);
    }
    if (supersedesConflictIds.length > 0) {
      return {
        mode: parsed.mode,
        result: envelope(
          "fail",
          "failure",
          1,
          conflictIssues(
            "revision's supersedes target does not exist or is already superseded",
            supersedesConflictIds,
          ),
        ),
      };
    }

    const newRevisions = sheet.revisions.filter(
      (revision) => statusById.get(revision.id) === "new",
    );

    let record: string | null = null;
    const blockBytes = new TextEncoder().encode(parsedSheet.jsonText);
    if (newRevisions.length > 0) {
      const sheet12 = sha256Hex(blockBytes).slice(0, 12);
      const written = await createNewRecord(
        root,
        manifestPath,
        () => `revisions-${sheet12}.json`,
        blockBytes,
        { maxAttempts: 1 },
      );
      if (!written.ok) {
        if (written.reason === "unsafe") {
          return {
            mode: parsed.mode,
            result: envelope("error", "configuration-error", 2, [
              issue(
                "REVIEW_PATH_UNSAFE",
                "records path has a symlinked segment",
              ),
            ]),
          };
        }
        return {
          mode: parsed.mode,
          result: envelope("fail", "failure", 1, [
            issue(
              "REVIEW_RECORD_WRITE_FAILED",
              "unable to write the revision record",
            ),
          ]),
        };
      }
      record = written.relativePath;
    }

    const lookup = buildTargetLookup(index);
    const batchBlockSha256 = sha256Hex(
      new TextEncoder().encode(index.fingerprint),
    );
    const revisions: RevisionResult[] = sheet.revisions.map((revision) => ({
      id: revision.id,
      status: statusById.get(revision.id) ?? "duplicate",
      targets: revision.targets.map((target) => ({
        path: target.path,
        anchor: target.anchor,
        blockSha256: target.blockSha256,
        match: matchRevisionTarget(
          lookup,
          manifestPath,
          batchBlockSha256,
          target,
        ),
      })),
    }));

    const extraIssues = [];
    if (newRevisions.length === 0)
      extraIssues.push(
        issue(
          "REVIEW_REVISION_DUPLICATE",
          "every revision in the sheet was already imported",
        ),
      );
    for (const revision of newRevisions)
      if (revision.fingerprint !== index.fingerprint)
        extraIssues.push({
          ...issue(
            "REVIEW_REVISION_STALE_TARGET",
            "revision was proposed against an earlier fingerprint",
          ),
          subject: `revision:${revision.id}`,
        });

    return {
      mode: parsed.mode,
      result: buildImportSuccessEnvelope(
        index,
        extraIssues,
        record,
        sha256Hex(blockBytes),
        revisions,
      ),
    };
  } catch (error) {
    process.stderr.write(
      `praxisbound review import: internal error: ${sanitizeInternalError(error, root)}\n`,
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

function buildImportSuccessEnvelope(
  index: ReviewIndex,
  extraIssues: readonly ReturnType<typeof issue>[],
  record: string | null,
  sheetSha256: string,
  revisions: readonly RevisionResult[],
) {
  const baseIssues = index.diagnostics.map((entry) =>
    issue(entry.code, entry.message, entry.path),
  );
  const baseDiagnostics = index.diagnostics.map((entry) => ({
    code: entry.code,
    severity: entry.severity,
    ...(entry.locator === undefined
      ? {}
      : { locator: toDataValue(entry.locator) }),
  }));
  const extraDiagnostics = extraIssues.map((entry) => ({
    code: entry.code,
    severity: "advisory" as const,
  }));

  return envelope("pass", "success", 0, [...baseIssues, ...extraIssues], {
    batchId: index.batchId,
    fingerprint: index.fingerprint,
    sources: toDataValue(index.sources),
    diagnostics: toDataValue([...baseDiagnostics, ...extraDiagnostics]),
    sheet: toDataValue({ sha256: sheetSha256, record }),
    revisions: toDataValue(revisions),
  });
}

/** Renders the human output for `review import`. */
export function renderReviewImportHuman(
  execution: ReviewIndexExecution,
): ReviewRenderedOutput {
  const { result } = execution;
  if (result.outcome === "usage-error") {
    return {
      stdout: "",
      stderr:
        "ERROR Invalid arguments\n" +
        "Usage: praxisbound review import <manifest> <sheet> [--json]\n" +
        "       praxisbound review import --help\n",
    };
  }
  if (result.outcome !== "success") {
    const lines = [
      "PraxisBound Batch Review Import",
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
        readonly sheet: {
          readonly sha256: string;
          readonly record: string | null;
        };
        readonly revisions: readonly RevisionResult[];
      }
    | undefined;
  const lines = ["PraxisBound Batch Review Import", ""];
  if (data !== undefined) {
    lines.push(`Batch: ${data.batchId}`);
    lines.push(`Fingerprint: ${data.fingerprint}`);
    lines.push(`Record: ${data.sheet.record ?? "(none, all duplicate)"}`);
    lines.push(`Revisions: ${data.revisions.length}`);
  }
  for (const reported of result.issues)
    lines.push(
      `ISSUE ${reported.code}: ${escapeHumanControlCharacters(reported.message)}`,
    );
  lines.push("", "Result: success", "");
  return { stdout: `${lines.join("\n")}\n`, stderr: "" };
}
