/**
 * `praxisbound review confirm <manifest>` (contract §8, §8 修訂，R-006): the
 * only way to write a Definition Confirmation record, checked and prompted
 * in the exact order the contract names. The terminal is an injected
 * adapter (Story TST-026 R9(a)) so automated tests drive every prompt
 * deterministically; `createDefaultReviewConfirmTerminal` is the real
 * `node:readline` implementation `bin.ts` uses. A confirmation is a human
 * claim bound to one fingerprint, never an approval, execution
 * authorization, or lifecycle state (`ADR-014`, R6, R7).
 *
 * Orchestration only: reading existing revisions/responses records and
 * computing unresolved requests lives in `review-confirm-load.ts`; the
 * interactive prompt flow lives in `review-confirm-interact.ts`; building
 * and writing the record lives in `review-confirm-write.ts`; the terminal
 * seam lives in `review-confirm-terminal.ts`.
 */

import {
  canonicalUtcTime,
  compareUtf8,
  computeUnresolvedRequests,
  type ConfirmationData,
} from "@praxisbound/core";

import { loadReviewConfirmationApplicability } from "./review-confirmation-records.js";
import { loadConfirmRecords } from "./review-confirm-load.js";
import { runConfirmInteraction } from "./review-confirm-interact.js";
import {
  createDefaultReviewConfirmTerminal,
  type ReviewConfirmTerminal,
} from "./review-confirm-terminal.js";
import {
  buildConfirmationRecordBytes,
  writeConfirmationRecord,
} from "./review-confirm-write.js";
import {
  loadRecordsListingState,
  recordsDirectory,
  type RecordFilesystem,
} from "./review-records.js";
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

export type { ReviewConfirmTerminal } from "./review-confirm-terminal.js";
export { createDefaultReviewConfirmTerminal } from "./review-confirm-terminal.js";

export const reviewConfirmHelp = `PraxisBound Batch Review Confirm

Usage:
  praxisbound review confirm <manifest> [--json]
  praxisbound review confirm --help

An explicit terminal act that covers the whole batch at once. Requires an
interactive terminal on both stdin and stdout: no --yes flag, environment
variable, or file input can produce a confirmation. Writes one create-new
records/confirmation-<fp12>.json bound to the current Requirement
Fingerprint (contract §8). A confirmation is a human claim, not identity
verification, not execution authorization, and not lifecycle state.
`;

function parseConfirmArguments(args: readonly string[]): {
  readonly mode: ReviewOutputMode;
  readonly manifest: string | undefined;
  readonly valid: boolean;
} {
  let mode: ReviewOutputMode = "human";
  let manifest: string | undefined;
  let valid = true;

  for (const token of args) {
    if (token === "--json" && mode === "human") {
      mode = "json";
      continue;
    }
    if (manifest === undefined && !token.startsWith("-")) {
      manifest = token;
      continue;
    }
    valid = false;
  }

  return { mode, manifest, valid: valid && manifest !== undefined };
}

function abortedEnvelope() {
  return envelope("fail", "failure", 1, [
    issue("REVIEW_CONFIRM_ABORTED", "the confirmation was not completed"),
  ]);
}

function buildConfirmSuccessEnvelope(
  index: {
    readonly batchId: string;
    readonly fingerprint: string;
    readonly sources: readonly {
      readonly path: string;
      readonly sha256: string | null;
    }[];
    readonly diagnostics: readonly {
      readonly code: string;
      readonly severity: "blocking" | "advisory";
      readonly message: string;
      readonly path?: string;
    }[];
  },
  record: string,
  deferred: ConfirmationData["deferred"],
  extraIssue?: ReturnType<typeof issue>,
) {
  const issues = [
    ...index.diagnostics.map((entry) =>
      issue(entry.code, entry.message, entry.path),
    ),
    ...(extraIssue === undefined ? [] : [extraIssue]),
  ];
  const diagnostics = index.diagnostics.map((entry) => ({
    code: entry.code,
    severity: entry.severity,
  }));
  return envelope("pass", "success", 0, issues, {
    batchId: index.batchId,
    fingerprint: index.fingerprint,
    sources: toDataValue(index.sources),
    diagnostics: toDataValue(diagnostics),
    record,
    deferred: toDataValue(deferred),
  });
}

/** Runs `praxisbound review confirm <manifest>`. */
export async function runReviewConfirm(
  args: readonly string[],
  root: string = process.cwd(),
  options: {
    readonly terminal?: ReviewConfirmTerminal;
    readonly now?: () => Date;
    /** H3 (review round 1): injectable so a test can force the write itself to fail after the temp file is created, the same seam `review-records-write.test.mjs` already exercises for `createNewRecord`. */
    readonly filesystem?: RecordFilesystem;
  } = {},
): Promise<ReviewIndexExecution> {
  const parsed = parseConfirmArguments(args);
  if (!parsed.valid || parsed.manifest === undefined) {
    return {
      mode: parsed.mode,
      result: envelope("error", "usage-error", 2, [
        issue("REVIEW_USAGE", "Invalid arguments"),
      ]),
    };
  }

  const injectedTerminal = options.terminal;
  const ownedTerminal =
    injectedTerminal === undefined
      ? createDefaultReviewConfirmTerminal()
      : undefined;
  const terminal: ReviewConfirmTerminal = injectedTerminal ?? ownedTerminal!;
  const now = options.now ?? ((): Date => new Date());

  try {
    // §8 step 1: both stdin and stdout must be an interactive terminal,
    // checked before any manifest or filesystem access, and no flag,
    // environment variable, or file input can bypass it.
    if (!terminal.stdinIsTTY || !terminal.stdoutIsTTY) {
      return {
        mode: parsed.mode,
        result: envelope("error", "usage-error", 2, [
          issue(
            "REVIEW_CONFIRM_REQUIRES_TTY",
            "stdin and stdout must both be an interactive terminal",
          ),
        ]),
      };
    }

    const loaded = await runReviewIndexUnsafe(
      [parsed.manifest, "--json"],
      root,
    );
    if (loaded.result.outcome !== "success" || loaded.loaded === undefined)
      return { mode: parsed.mode, result: loaded.result };
    const { manifestPath, index } = loaded.loaded;

    // §8 step 2: a fingerprint computed over a missing source can never
    // back a confirmation (contract §4: "含 null 的指紋不可用於 confirm 與
    // packet"); `review index` reports the same gap as a diagnostic on an
    // otherwise-successful read, but `confirm` must refuse outright.
    const missingSource = index.sources.find(
      (source) => source.sha256 === null,
    );
    if (missingSource !== undefined) {
      return {
        mode: parsed.mode,
        result: envelope("fail", "failure", 1, [
          issue(
            "REVIEW_SOURCE_MISSING",
            "a declared source is missing",
            missingSource.path,
          ),
        ]),
      };
    }

    // One shared `records/` safety check and listing (Story TST-026 review
    // round 1): reused for the revisions/responses read this command
    // depends on (§7) and the purely informational staleness peek below.
    const listingState = await loadRecordsListingState(root, manifestPath);
    if (listingState.unsafe) {
      return {
        mode: parsed.mode,
        result: envelope("error", "configuration-error", 2, [
          issue("REVIEW_PATH_UNSAFE", "records path has a symlinked segment"),
        ]),
      };
    }
    if (!listingState.listing.ok && listingState.listing.reason === "error") {
      return {
        mode: parsed.mode,
        result: envelope("fail", "failure", 1, [
          issue(
            "REVIEW_RECORD_INVALID",
            "unable to read the records directory",
            recordsDirectory(manifestPath),
          ),
        ]),
      };
    }
    const names = listingState.listing.ok ? listingState.listing.names : [];

    // §7: every existing revisions-/responses- record must be individually
    // valid and mutually consistent (security M2); an invalid one refuses
    // the whole command. Scope note (review round 1): `confirmation-*.json`
    // files are never scanned here — only `review-confirm-write.ts`'s
    // single-target read touches one, at the very end (step 6).
    const recordsLoad = await loadConfirmRecords(
      root,
      manifestPath,
      index.batchId,
      names,
    );
    if (!recordsLoad.ok)
      return { mode: parsed.mode, result: recordsLoad.result };

    const effectiveById = new Map(
      recordsLoad.effective.map((revision) => [revision.id, revision] as const),
    );
    const unresolved = computeUnresolvedRequests(
      recordsLoad.effective,
      recordsLoad.responseRecords,
      index.fingerprint,
    );

    // §8 step 3: unresolved blocking requests refuse the whole command.
    if (unresolved.blocking.length > 0) {
      return {
        mode: parsed.mode,
        result: envelope(
          "fail",
          "failure",
          1,
          unresolved.blocking.map((id) => ({
            ...issue(
              "REVIEW_UNRESOLVED_BLOCKING",
              "an effective blocking request is unresolved",
            ),
            subject: `revision:${id}`,
          })),
        ),
      };
    }

    // Purely informational (review round 1): reused so the interactive
    // prompt can remind the human which sources changed since the last
    // valid confirmation, if any. Its own bounds/invalid-record diagnostics
    // are never propagated as a `confirm` failure — an unrelated
    // confirmation file being invalid or numerous never blocks `confirm`.
    const staleness = await loadReviewConfirmationApplicability(
      root,
      manifestPath,
      index,
      listingState,
    );

    // §8 steps 4–5: the interactive portion.
    const interaction = await runConfirmInteraction(
      terminal,
      index,
      unresolved.nonBlocking,
      effectiveById,
      staleness.applicability,
    );
    if (interaction.aborted)
      return { mode: parsed.mode, result: abortedEnvelope() };

    // H2: build and validate the record before any write is attempted.
    const record: ConfirmationData = {
      schemaVersion: "1.0.0",
      claim: "explicit-terminal-confirmation",
      batchId: index.batchId,
      fingerprint: index.fingerprint,
      manifestSha256: index.manifestSha256,
      sources: index.sources.map((source) => ({
        path: source.path,
        sha256: source.sha256 as string,
      })),
      confirmedAt: canonicalUtcTime(now().toISOString()),
      deferred: interaction.deferred,
      revisionSheets: [...recordsLoad.revisionSheetShas].sort(compareUtf8),
    };
    const built = buildConfirmationRecordBytes(record);
    if (!built.ok) {
      if (built.reason === "too-large") {
        return {
          mode: parsed.mode,
          result: envelope("fail", "failure", 1, [
            issue(
              "REVIEW_INPUT_TOO_LARGE",
              "the confirmation record exceeds the size limit (1 MiB)",
            ),
          ]),
        };
      }
      return { mode: parsed.mode, result: abortedEnvelope() };
    }

    // §8 step 6, H3: a single exclusive create-new write; only an EEXIST
    // race falls back to reading that one target.
    const written = await writeConfirmationRecord(
      root,
      manifestPath,
      index.batchId,
      index.fingerprint,
      built.bytes,
      options.filesystem === undefined
        ? {}
        : { filesystem: options.filesystem },
    );
    if (written.kind === "written") {
      return {
        mode: parsed.mode,
        result: buildConfirmSuccessEnvelope(
          index,
          written.relativePath,
          interaction.deferred,
        ),
      };
    }
    if (written.kind === "exists") {
      return {
        mode: parsed.mode,
        result: buildConfirmSuccessEnvelope(
          index,
          written.path,
          written.deferred,
          issue(
            "REVIEW_CONFIRMATION_EXISTS",
            "a confirmation for this fingerprint already exists",
          ),
        ),
      };
    }
    if (written.kind === "collision") {
      return {
        mode: parsed.mode,
        result: envelope("fail", "failure", 1, [
          issue(
            "REVIEW_RECORD_COLLISION",
            "an existing confirmation at this file name has different content",
            written.path,
          ),
        ]),
      };
    }
    if (written.kind === "unsafe") {
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
          "unable to write the confirmation record",
        ),
      ]),
    };
  } catch (error) {
    process.stderr.write(
      `praxisbound review confirm: internal error: ${sanitizeInternalError(error, root)}\n`,
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
  } finally {
    ownedTerminal?.close();
  }
}

/** Renders the human output for `review confirm`; prompts already went to stderr through the terminal adapter, so this only reports the final result. */
export function renderReviewConfirmHuman(
  execution: ReviewIndexExecution,
): ReviewRenderedOutput {
  const { result } = execution;
  if (
    result.outcome === "usage-error" &&
    result.issues[0]?.code === "REVIEW_CONFIRM_REQUIRES_TTY"
  ) {
    return {
      stdout: "",
      stderr:
        "ERROR REVIEW_CONFIRM_REQUIRES_TTY: stdin and stdout must both be an interactive terminal\n",
    };
  }
  if (result.outcome === "usage-error") {
    return {
      stdout: "",
      stderr:
        "ERROR Invalid arguments\n" +
        "Usage: praxisbound review confirm <manifest> [--json]\n" +
        "       praxisbound review confirm --help\n",
    };
  }
  if (result.outcome !== "success") {
    const lines = [
      "PraxisBound Batch Review Confirm",
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
  const lines = ["PraxisBound Batch Review Confirm", ""];
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
  lines.push(
    "A confirmation is a human claim bound to this fingerprint. It is not identity verification, execution authorization, or completion.",
  );
  if (
    result.issues.some(
      (reported) => reported.code === "REVIEW_CONFIRMATION_EXISTS",
    )
  ) {
    lines.push(
      "Note: a confirmation for this fingerprint already existed. Any deferral reasons you just typed were NOT recorded — the stored record's own `deferred` list (shown above) is what applies.",
    );
  }
  return { stdout: `${lines.join("\n")}\n`, stderr: "" };
}
