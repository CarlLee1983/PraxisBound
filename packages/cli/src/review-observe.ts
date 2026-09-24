/**
 * `praxisbound review observe <manifest> <observation.json>` (contract §22,
 * Story TST-032): validates one Agent's observation of a §11 handoff
 * segment and, only when it is internally consistent, writes it once to
 * `records/forgepilot-<fp12>-<n>.json`. The command never calls ForgePilot
 * and never judges its current state (R1) — it only checks that the
 * observation is well formed, bound to this batch and Goal Plan, and
 * internally consistent per §11/§22 (Core's
 * `validateForgepilotObservationShape`/`validateForgepilotObservationConsistency`).
 *
 * File handling mirrors `--semantic-report`'s (`review-semantic-report.ts`,
 * R10a): the observation input and the Goal Plan Manifest it names are each
 * resolved to a repository-relative path, checked for a symlinked segment
 * before ever being opened, opened `O_NOFOLLOW`, and re-checked by
 * `dev`/`ino` against a fresh `lstat` after opening (TOCTOU). The Goal Plan
 * Manifest is only ever read once its path has already passed schema
 * validation (`REPO_PATH_PATTERN`, no `..`), so a syntactically invalid
 * `goalPlan.path` is always `REVIEW_OBSERVATION_INVALID`, never
 * `REVIEW_PATH_UNSAFE` — the two failures are checked in that order and
 * never confused (contract §22's path-traversal fixture).
 */

import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import {
  rawJsonMaxDepth,
  validateForgepilotObservationConsistency,
  validateForgepilotObservationShape,
  type ForgepilotObservationData,
} from "@praxisbound/core";

import { findUnsafeSourcePath } from "./review-paths.js";
import {
  createNewRecord,
  readBounded,
  RECORD_MAX_BYTES,
} from "./review-records.js";
import { parseManifestAndFileArguments } from "./review-input.js";
import {
  envelope,
  escapeHumanControlCharacters,
  issue,
  runReviewIndexUnsafe,
  sanitizeInternalError,
  type ReviewIndexExecution,
  type ReviewRenderedOutput,
} from "./review.js";

export const reviewObserveHelp = `PraxisBound Batch Review Observe

Usage:
  praxisbound review observe <manifest> <observation.json> [--json]
  praxisbound review observe --help

Validates one Agent's observation of a contract §11 ForgePilot handoff
segment against the current batch, its Goal Plan Manifest, and the §11/§22
step-consistency rules, and — only when it is internally consistent — writes
it once to records/forgepilot-<fp12>-<n>.json. The command never runs
ForgePilot and never judges its current state; the written record is
historical Evidence, not current status.
`;

/** The Goal Plan Manifest bound (contract §10 R2: Manifest artifacts are bounded at 8 MiB), distinct from the 1 MiB bound on the observation input itself (§13). */
const GOAL_PLAN_MANIFEST_MAX_BYTES = 8 * 1024 * 1024;
const WRITE_MAX_ATTEMPTS = 100000;

type SafeFileRead =
  | {
      readonly kind: "ok";
      readonly absolute: string;
      readonly relativePath: string;
      readonly bytes: Uint8Array;
    }
  | { readonly kind: "unsafe" }
  | { readonly kind: "missing" }
  | { readonly kind: "too-large" };

/**
 * Resolves `argument` to a repository-relative path, rejects any symlinked
 * segment or a path outside the repository, and reads at most `maxBytes`
 * with `O_NOFOLLOW`, closing the check-then-open TOCTOU window with a
 * post-open `lstat` identity check (mirrors `loadSemanticReport`'s
 * `resolveRepoRelativePath`, Story TST-028 security C1/M1).
 */
async function readSafeBoundedFile(
  root: string,
  argument: string,
  maxBytes: number,
): Promise<SafeFileRead> {
  const absolute = resolve(root, argument);
  const relativePath = relative(root, absolute).split("\\").join("/");
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith("../") ||
    isAbsolute(relativePath)
  )
    return { kind: "unsafe" };

  const unsafeSegment = await findUnsafeSourcePath(root, [relativePath]);
  if (unsafeSegment !== undefined) return { kind: "unsafe" };

  let handle;
  try {
    handle = await open(
      absolute,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch {
    return { kind: "missing" };
  }
  try {
    const openedStats = await handle.stat();
    let diskStats;
    try {
      diskStats = await lstat(absolute);
    } catch {
      return { kind: "unsafe" };
    }
    if (openedStats.dev !== diskStats.dev || openedStats.ino !== diskStats.ino)
      return { kind: "unsafe" };
    if (!openedStats.isFile()) return { kind: "missing" };
    if (openedStats.size > maxBytes) return { kind: "too-large" };
    const bytes = await readBounded(handle, maxBytes);
    if (bytes === undefined) return { kind: "too-large" };
    return { kind: "ok", absolute, relativePath, bytes };
  } finally {
    await handle.close().catch(() => undefined);
  }
}

type ObservationJsonRead =
  | { readonly kind: "ok"; readonly data: unknown }
  | { readonly kind: "malformed" }
  | { readonly kind: "too-deep" };

/**
 * Contract §13: nesting depth over 32 is an over-limit observation
 * (`REVIEW_INPUT_TOO_LARGE`), distinct from ordinary malformed JSON or
 * invalid UTF-8 (`REVIEW_OBSERVATION_INVALID`) — so the depth scan runs
 * before `JSON.parse`, the same way `parseRecordJson` does for other
 * records, but with the two outcomes kept separate here (review-records.ts's
 * shared helper folds both into one `ok: false`).
 */
function readObservationJson(bytes: Uint8Array): ObservationJsonRead {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { kind: "malformed" };
  }
  if (rawJsonMaxDepth(text) > 32) return { kind: "too-deep" };
  try {
    return { kind: "ok", data: JSON.parse(text) };
  } catch {
    return { kind: "malformed" };
  }
}

function invalidResult(message: string): ReviewIndexExecution["result"] {
  return envelope("fail", "failure", 1, [
    issue("REVIEW_OBSERVATION_INVALID", message),
  ]);
}

function tooLargeResult(message: string): ReviewIndexExecution["result"] {
  return envelope("fail", "failure", 1, [
    issue("REVIEW_INPUT_TOO_LARGE", message),
  ]);
}

function unsafeResult(message: string): ReviewIndexExecution["result"] {
  return envelope("error", "configuration-error", 2, [
    issue("REVIEW_PATH_UNSAFE", message),
  ]);
}

/** Runs `praxisbound review observe <manifest> <observation.json>`. */
export async function runReviewObserve(
  args: readonly string[],
  root: string = process.cwd(),
): Promise<ReviewIndexExecution> {
  const parsed = parseManifestAndFileArguments(args);
  if (
    !parsed.valid ||
    parsed.manifest === undefined ||
    parsed.file === undefined
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

    // R5: the observation input file itself must not resolve through a
    // symlink, checked before anything else about it is read.
    const observationRead = await readSafeBoundedFile(
      root,
      parsed.file,
      RECORD_MAX_BYTES,
    );
    if (observationRead.kind === "unsafe")
      return {
        mode: parsed.mode,
        result: unsafeResult("observation input path has a symlinked segment"),
      };
    if (observationRead.kind === "too-large")
      return {
        mode: parsed.mode,
        result: tooLargeResult(
          "the observation file exceeds the size limit (1 MiB)",
        ),
      };
    if (observationRead.kind === "missing")
      return {
        mode: parsed.mode,
        result: invalidResult("the observation file could not be read"),
      };

    const parsedJson = readObservationJson(observationRead.bytes);
    if (parsedJson.kind === "too-deep")
      return {
        mode: parsed.mode,
        result: tooLargeResult(
          "the observation JSON nesting exceeds the supported depth",
        ),
      };
    if (parsedJson.kind === "malformed")
      return {
        mode: parsed.mode,
        result: invalidResult("the observation file is not valid JSON"),
      };

    // Schema only, no filesystem access yet: goalPlan.path is not resolved
    // or read until it is known to be a syntactically safe repository-
    // relative path (REPO_PATH_PATTERN), so a path-traversal payload is
    // always REVIEW_OBSERVATION_INVALID, never REVIEW_PATH_UNSAFE.
    const shape = validateForgepilotObservationShape(parsedJson.data);
    if (!shape.ok)
      return {
        mode: parsed.mode,
        result: shape.tooLarge
          ? tooLargeResult(shape.message)
          : invalidResult(shape.message),
      };
    const record: ForgepilotObservationData = shape.record;

    // R5: the Goal Plan Manifest path and every directory segment above it
    // must not resolve through a symlink either. The path is already known
    // to be a well-formed repository-relative path (schema-checked above),
    // so this is the first point it is ever touched on disk.
    const goalPlanRead = await readSafeBoundedFile(
      root,
      record.goalPlan.path,
      GOAL_PLAN_MANIFEST_MAX_BYTES,
    );
    if (goalPlanRead.kind === "unsafe")
      return {
        mode: parsed.mode,
        result: unsafeResult("goalPlan.path has a symlinked segment"),
      };
    const goalPlanManifestBytes =
      goalPlanRead.kind === "ok" ? goalPlanRead.bytes : undefined;

    const consistency = validateForgepilotObservationConsistency(record, {
      batchId: index.batchId,
      goalPlanManifestBytes,
    });
    if (!consistency.ok)
      return {
        mode: parsed.mode,
        result: consistency.tooLarge
          ? tooLargeResult(consistency.message)
          : invalidResult(consistency.message),
      };

    // R4: the accepted record is written verbatim (the exact input bytes),
    // exclusively, under a name derived from the record's own fingerprint —
    // never re-serialized, so it can never drift from what was validated.
    const fp12 = record.fingerprint.slice(0, 12);
    const written = await createNewRecord(
      root,
      manifestPath,
      (attempt) => `forgepilot-${fp12}-${attempt}.json`,
      observationRead.bytes,
      { maxAttempts: WRITE_MAX_ATTEMPTS },
    );
    if (!written.ok) {
      if (written.reason === "unsafe")
        return {
          mode: parsed.mode,
          result: unsafeResult("records path has a symlinked segment"),
        };
      return {
        mode: parsed.mode,
        result: envelope("error", "ERROR", 3, [
          issue(
            "REVIEW_RECORD_WRITE_FAILED",
            "unable to write the observation record",
          ),
        ]),
      };
    }

    return {
      mode: parsed.mode,
      result: envelope("pass", "success", 0, [], {
        batchId: index.batchId,
        fingerprint: index.fingerprint,
        record: written.relativePath,
      }),
    };
  } catch (error) {
    process.stderr.write(
      `praxisbound review observe: internal error: ${sanitizeInternalError(error, root)}\n`,
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

/** Renders the human output for `review observe`. */
export function renderReviewObserveHuman(
  execution: ReviewIndexExecution,
): ReviewRenderedOutput {
  const { result } = execution;
  if (result.outcome === "usage-error") {
    return {
      stdout: "",
      stderr:
        "ERROR Invalid arguments\n" +
        "Usage: praxisbound review observe <manifest> <observation.json> [--json]\n" +
        "       praxisbound review observe --help\n",
    };
  }
  if (result.outcome !== "success") {
    const lines = [
      "PraxisBound Batch Review Observe",
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

  const data = result.data as { readonly record?: string } | undefined;
  const lines = ["PraxisBound Batch Review Observe", ""];
  if (data?.record !== undefined)
    lines.push(`Record: ${escapeHumanControlCharacters(data.record)}`);
  lines.push("", "Result: success", "");
  return { stdout: `${lines.join("\n")}\n`, stderr: "" };
}
