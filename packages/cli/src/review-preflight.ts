/**
 * `praxisbound review preflight <manifest>` (contract §9, Story TST-027):
 * gathers every mechanical input the contract §9 table needs — the batch's
 * own index/plan diagnostics, the dependency graph, confirmation
 * applicability, unresolved requests, existing revision/response/story
 * findings, the fingerprint expectation, and (this slice only) whether a
 * Semantic Report file exists — and hands them to Core's
 * `evaluatePreflight`, which owns every classification, severity,
 * precedence, and outcome decision (R6). This module never re-implements
 * one of those decisions; it only collects input and projects the result.
 *
 * Out of scope for this slice (contract §9, Story R10a's vertical-slice
 * plan): the uncommitted-change / HEAD-revision git checks (`gitFindings`
 * is always `[]` here) and Preflight Report writing (`data.preflightRecord`
 * is not produced by this slice). `--expect-revision` is still parsed and
 * format-validated so a later slice can wire it in without an argv change.
 */

import { lstat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import {
  computeEffectiveRevisions,
  computeUnresolvedRequests,
  evaluatePreflight,
  validateRevisionRecordSet,
  type PreflightConfirmationState,
  type PreflightFinding,
  type ReviewDiagnostic,
} from "@praxisbound/core";

import { loadReviewConfirmationApplicability } from "./review-confirmation-records.js";
import {
  computeResponseCoverage,
  recordSetInvalidIssues,
} from "./review-input.js";
import {
  loadRecordsListingState,
  readResponseRecords,
  readRevisionRecords,
  recordsDirectory,
} from "./review-records.js";
import { checkStoryReadiness, createNodeStoryReader } from "./story.js";
import {
  envelope,
  escapeHumanControlCharacters,
  issue,
  runReviewIndexUnsafe,
  sanitizeInternalError,
  toDataValue,
  type ReviewIndexExecution,
  type ReviewOutputMode,
  type ReviewRenderedOutput,
} from "./review.js";

export const reviewPreflightHelp = `PraxisBound Batch Review Preflight

Usage:
  praxisbound review preflight <manifest> [--semantic-report <file>]
    [--expect-fingerprint <sha256> --expect-revision <commit>] [--json]
  praxisbound review preflight --help

A read-only evaluation of every mechanical contract §9 check: missing
sources, Story readiness, dependency cycles, unresolved requests, existing
record validity, and (this version) only whether a Semantic Report file
exists. It never runs make verify, never requires an unimplemented test to
pass, and never writes a source. REVIEW_READY only means no blocker was
found — it grants no execution authority and claims no absence of defects.
`;

const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;
const REVISION_PATTERN = /^[a-f0-9]{40}$/;

interface ParsedPreflightArguments {
  readonly mode: ReviewOutputMode;
  readonly manifest: string | undefined;
  readonly semanticReport: string | undefined;
  readonly expectFingerprint: string | undefined;
  readonly expectRevision: string | undefined;
  readonly valid: boolean;
}

function parsePreflightArguments(
  args: readonly string[],
): ParsedPreflightArguments {
  let mode: ReviewOutputMode = "human";
  let manifest: string | undefined;
  let semanticReport: string | undefined;
  let expectFingerprint: string | undefined;
  let expectRevision: string | undefined;
  let valid = true;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === undefined) {
      valid = false;
      continue;
    }
    if (token === "--json" && mode === "human") {
      mode = "json";
      continue;
    }
    if (token === "--semantic-report" && semanticReport === undefined) {
      const value = args[index + 1];
      index += 1;
      if (value === undefined || value.startsWith("-")) {
        valid = false;
        continue;
      }
      semanticReport = value;
      continue;
    }
    if (token === "--expect-fingerprint" && expectFingerprint === undefined) {
      const value = args[index + 1];
      index += 1;
      if (value === undefined || value.startsWith("-")) {
        valid = false;
        continue;
      }
      expectFingerprint = value;
      continue;
    }
    if (token === "--expect-revision" && expectRevision === undefined) {
      const value = args[index + 1];
      index += 1;
      if (value === undefined || value.startsWith("-")) {
        valid = false;
        continue;
      }
      expectRevision = value;
      continue;
    }
    if (manifest === undefined && !token.startsWith("-")) {
      manifest = token;
      continue;
    }
    valid = false;
  }

  // Both `--expect-*` flags, or neither: contract §9's usage row.
  if ((expectFingerprint === undefined) !== (expectRevision === undefined))
    valid = false;
  if (
    expectFingerprint !== undefined &&
    !FINGERPRINT_PATTERN.test(expectFingerprint)
  )
    valid = false;
  if (expectRevision !== undefined && !REVISION_PATTERN.test(expectRevision))
    valid = false;

  return {
    mode,
    manifest,
    semanticReport,
    expectFingerprint,
    expectRevision,
    valid: valid && manifest !== undefined,
  };
}

/** Resolved relative to `root`; a symlink, a non-file, or a missing path is `"missing"` — never followed, never read (this Story checks existence only). */
async function resolveSemanticReportState(
  root: string,
  argument: string | undefined,
): Promise<"present" | "missing"> {
  if (argument === undefined) return "missing";
  const absolute = isAbsolute(argument) ? argument : resolve(root, argument);
  try {
    const stats = await lstat(absolute);
    if (stats.isSymbolicLink() || !stats.isFile()) return "missing";
    return "present";
  } catch {
    return "missing";
  }
}

function buildConfirmationState(
  applicability: Awaited<
    ReturnType<typeof loadReviewConfirmationApplicability>
  >["applicability"],
): PreflightConfirmationState {
  if (applicability === undefined) return { kind: "missing" };
  if (applicability.applies) {
    return {
      kind: "applies",
      deferredRevisionIds: applicability.confirmation.record.deferred.map(
        (entry) => entry.revisionId,
      ),
    };
  }
  if (applicability.latest === undefined) return { kind: "missing" };
  const differences: ReviewDiagnostic[] = [
    ...applicability.sourceChanges.map((change): ReviewDiagnostic => ({
      code:
        change.kind === "added"
          ? "REVIEW_SOURCE_ADDED"
          : change.kind === "removed"
            ? "REVIEW_SOURCE_REMOVED"
            : "REVIEW_SOURCE_CHANGED",
      severity: "advisory",
      message: `source ${change.kind} since the latest valid confirmation`,
      path: change.path,
    })),
    ...(applicability.manifestChanged
      ? [
          {
            code: "REVIEW_MANIFEST_CHANGED",
            severity: "advisory" as const,
            message: "the manifest changed since the latest valid confirmation",
          },
        ]
      : []),
  ];
  return { kind: "stale", differences };
}

/** Runs `praxisbound review preflight <manifest>`. */
export async function runReviewPreflight(
  args: readonly string[],
  root: string = process.cwd(),
): Promise<ReviewIndexExecution> {
  const parsed = parsePreflightArguments(args);
  if (!parsed.valid || parsed.manifest === undefined) {
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

    const listingState = await loadRecordsListingState(root, manifestPath);
    const recordFindings: PreflightFinding[] = [];
    if (listingState.unsafe) {
      recordFindings.push({
        code: "REVIEW_RECORD_INVALID",
        message: "records path has a symlinked segment",
        path: recordsDirectory(manifestPath),
      });
    } else if (
      !listingState.listing.ok &&
      listingState.listing.reason === "error"
    ) {
      recordFindings.push({
        code: "REVIEW_RECORD_INVALID",
        message: "unable to read the records directory",
        path: recordsDirectory(manifestPath),
      });
    }
    const names = listingState.listing.ok ? listingState.listing.names : [];

    const revisionRecords = await readRevisionRecords(
      root,
      manifestPath,
      index.batchId,
      names,
    );
    const responseRecords = await readResponseRecords(
      root,
      manifestPath,
      index.batchId,
      names,
    );
    for (const entry of revisionRecords.invalid)
      recordFindings.push({
        code: "REVIEW_RECORD_INVALID",
        message: "existing record is invalid",
        path: entry.path,
      });
    for (const entry of responseRecords.invalid)
      recordFindings.push({
        code: "REVIEW_RECORD_INVALID",
        message: "existing record is invalid",
        path: entry.path,
      });

    const recordSet = validateRevisionRecordSet(
      revisionRecords.records.map((record) => ({
        path: record.path,
        revisions: record.sheet.revisions,
      })),
    );
    if (!recordSet.ok) {
      for (const conflictIssue of recordSetInvalidIssues(recordSet.conflicts))
        recordFindings.push({
          code: conflictIssue.code,
          message: conflictIssue.message,
          ...(conflictIssue.path === undefined
            ? {}
            : { path: conflictIssue.path }),
        });
    }

    const effective = computeEffectiveRevisions(
      [...revisionRecords.bySha256.values()].map((sheet) => sheet.revisions),
    );
    const effectiveIds = new Set(effective.map((revision) => revision.id));

    // Contract §7's stored-responses re-check (this Story re-verifies every
    // already-written responses record, not only the one `review respond`
    // would write today): the same `computeResponseCoverage` `review
    // respond` itself uses, so the two commands can never disagree.
    for (const stored of responseRecords.records) {
      const listedSheets = stored.record.revisionSheets.map((sha) =>
        revisionRecords.bySha256.get(sha),
      );
      if (listedSheets.some((sheet) => sheet === undefined)) {
        recordFindings.push({
          code: "REVIEW_RESPONSE_INVALID",
          message: "revisionSheets names a record that was never imported",
          path: stored.path,
        });
        continue;
      }
      const sheets = listedSheets as NonNullable<
        (typeof listedSheets)[number]
      >[];
      const responseIds = stored.record.responses.map(
        (response) => response.revisionId,
      );
      const coverage = computeResponseCoverage(
        sheets,
        effectiveIds,
        responseIds,
      );
      for (const id of coverage.missingIds)
        recordFindings.push({
          code: "REVIEW_RESPONSE_MISMATCH",
          message: `no response answers effective revision ${id}`,
          path: stored.path,
        });
      for (const id of coverage.extraIds)
        recordFindings.push({
          code: "REVIEW_RESPONSE_MISMATCH",
          message: `this response does not answer an effective request of its listed sheets: ${id}`,
          path: stored.path,
        });
    }

    const confirmationLoad = await loadReviewConfirmationApplicability(
      root,
      manifestPath,
      index,
      listingState,
    );
    for (const blocking of confirmationLoad.blockingIssues)
      recordFindings.push({
        code: "REVIEW_RECORD_INVALID",
        message: blocking.message,
        ...(blocking.path === undefined ? {} : { path: blocking.path }),
      });
    const confirmation = buildConfirmationState(confirmationLoad.applicability);

    const unresolved = computeUnresolvedRequests(
      effective,
      responseRecords.records.map((record) => record.record),
      index.fingerprint,
    );

    const reader = createNodeStoryReader(undefined, root);
    const storyFindings: PreflightFinding[] = [];
    for (const story of index.stories) {
      const entry = await checkStoryReadiness(reader, story.path);
      if (entry.kind === "error") {
        storyFindings.push({
          code: entry.issue.code,
          message: entry.issue.message,
          path: story.path,
        });
        continue;
      }
      for (const storyIssue of entry.issues)
        storyFindings.push({
          code: storyIssue.code,
          message: storyIssue.message,
          path: story.path,
        });
    }

    const semanticReport = await resolveSemanticReportState(
      root,
      parsed.semanticReport,
    );

    const evaluation = evaluatePreflight({
      fingerprint: index.fingerprint,
      batchDiagnostics: index.diagnostics,
      dependencies: index.dependencies,
      confirmation,
      unresolved,
      recordFindings,
      storyFindings,
      expectFingerprint: parsed.expectFingerprint,
      // The uncommitted-change / HEAD-revision git checks are a later slice
      // (Story R10a's vertical-slice plan); `--expect-revision` is parsed
      // and format-validated above but not yet acted on.
      gitFindings: [],
      semanticReport,
    });

    return {
      mode: parsed.mode,
      result: buildPreflightEnvelope(index, evaluation),
      loaded: loaded.loaded,
    };
  } catch (error) {
    process.stderr.write(
      `praxisbound review preflight: internal error: ${sanitizeInternalError(error, root)}\n`,
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

function buildPreflightEnvelope(
  index: {
    readonly batchId: string;
    readonly fingerprint: string;
    readonly sources: readonly {
      readonly path: string;
      readonly sha256: string | null;
    }[];
  },
  evaluation: ReturnType<typeof evaluatePreflight>,
) {
  const mechanicalAndSemantic = [
    ...evaluation.mechanical,
    ...evaluation.semantic,
  ];
  const issues = mechanicalAndSemantic.map((entry) =>
    issue(entry.code, entry.message, entry.path),
  );
  const diagnostics = mechanicalAndSemantic.map((entry) => ({
    code: entry.code,
    severity: entry.severity,
    ...(entry.locator === undefined
      ? {}
      : { locator: toDataValue(entry.locator) }),
  }));
  const data = {
    batchId: index.batchId,
    fingerprint: index.fingerprint,
    sources: toDataValue(index.sources),
    diagnostics: toDataValue(diagnostics),
  };

  if (evaluation.outcome === "REVIEW_READY")
    return envelope("pass", "REVIEW_READY", 0, issues, data);
  return envelope("fail", evaluation.outcome, 1, issues, data);
}

/** Renders the human output for `review preflight`: two labelled sections (Story R-007/AC-006, AC-008 contract §9), the fixed `REVIEW_READY` disclaimer (R8), and ESC-escaped untrusted text throughout. */
export function renderReviewPreflightHuman(
  execution: ReviewIndexExecution,
): ReviewRenderedOutput {
  const { result } = execution;
  if (result.outcome === "usage-error") {
    return {
      stdout: "",
      stderr:
        "ERROR Invalid arguments\n" +
        "Usage: praxisbound review preflight <manifest> [--semantic-report <file>]\n" +
        "         [--expect-fingerprint <sha256> --expect-revision <commit>] [--json]\n" +
        "       praxisbound review preflight --help\n",
    };
  }
  if (
    result.outcome !== "REVIEW_READY" &&
    result.outcome !== "REVIEW_BLOCKED" &&
    result.outcome !== "REVIEW_INCOMPLETE" &&
    result.outcome !== "REVIEW_STALE"
  ) {
    const lines = [
      "PraxisBound Batch Review Preflight",
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
        readonly diagnostics: readonly {
          readonly code: string;
          readonly severity: "blocking" | "advisory";
        }[];
      }
    | undefined;

  // This Story's `semantic` is always empty (TST-028 parses the Semantic
  // Report); the mechanical/semantic split is purely by array position,
  // since Core already orders `mechanical` first.
  const semanticCodes = new Set<string>();
  const mechanicalIssues = result.issues.filter(
    (reported) => !semanticCodes.has(reported.code),
  );

  const lines = ["PraxisBound Batch Review Preflight", ""];
  if (data !== undefined) {
    lines.push(`Batch: ${data.batchId}`);
    lines.push(`Fingerprint: ${data.fingerprint}`);
  }
  lines.push("", "Mechanical checks");
  if (mechanicalIssues.length === 0) {
    lines.push("none");
  } else {
    for (const reported of mechanicalIssues) {
      const location =
        reported.path === undefined
          ? ""
          : ` (${escapeHumanControlCharacters(reported.path)})`;
      lines.push(
        `ISSUE ${reported.code}: ${escapeHumanControlCharacters(reported.message)}${location}`,
      );
    }
  }
  lines.push("", "Agent observations (unverified)", "none");
  lines.push("", `Result: ${result.outcome}`);
  if (result.outcome === "REVIEW_READY") {
    lines.push("", "只表示未發現阻擋，不宣稱沒有缺陷");
  }
  lines.push("");

  return { stdout: `${lines.join("\n")}\n`, stderr: "" };
}
