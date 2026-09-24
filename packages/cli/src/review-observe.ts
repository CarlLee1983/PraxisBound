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
 * Two different file-reading strategies are used, deliberately:
 *
 * - The observation input itself (`<observation.json>`) is an arbitrary
 *   caller-supplied path, exactly like `review import`/`review respond`'s
 *   own input file (`review-input.ts`'s `readInputFile`): any path is
 *   accepted, including one outside the repository, but the leaf itself
 *   must not be a symlink (`lstat`, `O_NOFOLLOW` open, a post-open
 *   `dev`/`ino` identity check against the initial `lstat` — code review
 *   round 1 M3).
 * - `goalPlan.path`, named *inside* the observation, is a repository
 *   artifact (§22: it must lie under
 *   `specs/batches/<BATCH-ID>/goal-plan/`), so it is resolved and checked
 *   the stricter way `--semantic-report` is (`review-semantic-report.ts`,
 *   R10a): repository-relative, every path segment symlink-checked. It is
 *   read only after the observation has already passed schema validation
 *   (so the path is known syntactically safe, no `..`) *and* the cheap,
 *   filesystem-free `batchId`/prefix check has already passed (code review
 *   round 1 LOW) — a `goalPlan.path` outside the batch's own `goal-plan/`
 *   is always `REVIEW_OBSERVATION_INVALID`, and no file outside that
 *   directory, nor belonging to a different batch, is ever opened.
 */

import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import {
  goalPlanDirectoryPrefix,
  rawJsonMaxDepth,
  validateForgepilotObservationConsistency,
  validateForgepilotObservationShape,
  type ForgepilotObservationData,
  type ReviewIndex,
} from "@praxisbound/core";

import { findUnsafeSourcePath } from "./review-paths.js";
import {
  createNewRecord,
  readBounded,
  recordsDirectory,
  RECORD_MAX_BYTES,
} from "./review-records.js";
import { parseManifestAndFileArguments } from "./review-input.js";
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

/** The Goal Plan Manifest bound (contract §10: Manifest artifacts are bounded at 8 MiB), distinct from the 1 MiB bound on the observation input itself (§13). */
const GOAL_PLAN_MANIFEST_MAX_BYTES = 8 * 1024 * 1024;
const WRITE_MAX_ATTEMPTS = 100000;

type ObservationInputRead =
  | {
      readonly kind: "ok";
      readonly absolute: string;
      readonly bytes: Uint8Array;
    }
  | { readonly kind: "unsafe" }
  | { readonly kind: "missing" }
  | { readonly kind: "too-large" };

/**
 * Reads the observation input file itself: any path is accepted, the same
 * way `review import`/`review respond`'s own input file is
 * (`review-input.ts`'s `readInputFile`) — no repository-boundary
 * requirement — but the leaf must not be a symlink (code review round 1
 * M3: a path outside the repository is not itself unsafe, so it must never
 * be rejected with a "symlinked segment" message). The initial `lstat`
 * both rejects a symlinked leaf directly and supplies the identity a
 * post-open `dev`/`ino` check closes the TOCTOU window against.
 */
async function readObservationInputFile(
  root: string,
  argument: string,
  maxBytes: number,
): Promise<ObservationInputRead> {
  const absolute = isAbsolute(argument) ? argument : resolve(root, argument);
  let initialStats;
  try {
    initialStats = await lstat(absolute);
  } catch {
    return { kind: "missing" };
  }
  if (initialStats.isSymbolicLink()) return { kind: "unsafe" };
  if (!initialStats.isFile()) return { kind: "missing" };
  if (initialStats.size > maxBytes) return { kind: "too-large" };

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
    if (
      openedStats.dev !== initialStats.dev ||
      openedStats.ino !== initialStats.ino
    )
      return { kind: "unsafe" };
    if (!openedStats.isFile()) return { kind: "missing" };
    if (openedStats.size > maxBytes) return { kind: "too-large" };
    const bytes = await readBounded(handle, maxBytes);
    if (bytes === undefined) return { kind: "too-large" };
    return { kind: "ok", absolute, bytes };
  } finally {
    await handle.close().catch(() => undefined);
  }
}

type SafeRepoFileRead =
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
 * Resolves `argument` (already known to be a repository-relative path, no
 * `..`) inside `root`, rejects any symlinked segment, and reads at most
 * `maxBytes` with `O_NOFOLLOW`, closing the check-then-open TOCTOU window
 * with a post-open `lstat` identity check (mirrors `loadSemanticReport`'s
 * `resolveRepoRelativePath`, Story TST-028 security C1/M1). Used only for
 * `goalPlan.path`, a repository artifact §22 requires to live under
 * `goal-plan/` — never for the observation input itself (see
 * `readObservationInputFile`, code review round 1 M3).
 */
async function readSafeRepoFile(
  root: string,
  argument: string,
  maxBytes: number,
): Promise<SafeRepoFileRead> {
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

/**
 * Story Error Projection ("a JSON-pointer or repository-relative locator in
 * the existing envelope", code review round 1 LOW): every rejection carries
 * its own `path` on the `issue()` and a matching `{code, severity, path?}`
 * diagnostic in `data.diagnostics`, one-to-one with `issues[]` (contract
 * §12), the same pairing `review respond`/`review goal-plan` use.
 */
function locatorDiagnostic(
  code: string,
  path?: string,
): {
  readonly code: string;
  readonly severity: "blocking";
  readonly path?: string;
} {
  return path === undefined
    ? { code, severity: "blocking" }
    : { code, severity: "blocking", path };
}

function invalidResult(
  message: string,
  path?: string,
): ReviewIndexExecution["result"] {
  return envelope(
    "fail",
    "failure",
    1,
    [issue("REVIEW_OBSERVATION_INVALID", message, path)],
    {
      diagnostics: toDataValue([
        locatorDiagnostic("REVIEW_OBSERVATION_INVALID", path),
      ]),
    },
  );
}

function tooLargeResult(
  message: string,
  path?: string,
): ReviewIndexExecution["result"] {
  return envelope(
    "fail",
    "failure",
    1,
    [issue("REVIEW_INPUT_TOO_LARGE", message, path)],
    {
      diagnostics: toDataValue([
        locatorDiagnostic("REVIEW_INPUT_TOO_LARGE", path),
      ]),
    },
  );
}

function unsafeResult(
  message: string,
  path?: string,
): ReviewIndexExecution["result"] {
  return envelope(
    "error",
    "configuration-error",
    2,
    [issue("REVIEW_PATH_UNSAFE", message, path)],
    {
      diagnostics: toDataValue([locatorDiagnostic("REVIEW_PATH_UNSAFE", path)]),
    },
  );
}

/**
 * The success envelope (code review round 1 M2): mirrors `review
 * respond`'s `buildRespondSuccessEnvelope` — `review index`'s own
 * diagnostics (e.g. `REVIEW_SOURCE_MISSING`) are surfaced in `issues[]`,
 * one-to-one with `data.diagnostics[]`, and `data` carries the same
 * `{batchId, fingerprint, sources, diagnostics}` minimal shape every other
 * review command does, plus `record`.
 */
function buildObserveSuccessEnvelope(
  index: ReviewIndex,
  record: string,
): ReviewIndexExecution["result"] {
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

    // M3: the observation input is an arbitrary caller-supplied path (like
    // review import/respond's own input file) — no repository-boundary
    // requirement, only a leaf-symlink/TOCTOU check.
    const observationRead = await readObservationInputFile(
      root,
      parsed.file,
      RECORD_MAX_BYTES,
    );
    if (observationRead.kind === "unsafe")
      return {
        mode: parsed.mode,
        result: unsafeResult(
          "the observation input file is a symlink",
          parsed.file,
        ),
      };
    if (observationRead.kind === "too-large")
      return {
        mode: parsed.mode,
        result: tooLargeResult(
          "the observation file exceeds the size limit (1 MiB)",
          parsed.file,
        ),
      };
    if (observationRead.kind === "missing")
      return {
        mode: parsed.mode,
        result: invalidResult(
          "the observation file could not be read",
          parsed.file,
        ),
      };

    const parsedJson = readObservationJson(observationRead.bytes);
    if (parsedJson.kind === "too-deep")
      return {
        mode: parsed.mode,
        result: tooLargeResult(
          "the observation JSON nesting exceeds the supported depth",
          parsed.file,
        ),
      };
    if (parsedJson.kind === "malformed")
      return {
        mode: parsed.mode,
        result: invalidResult(
          "the observation file is not valid JSON",
          parsed.file,
        ),
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
          ? tooLargeResult(shape.message, parsed.file)
          : invalidResult(shape.message, parsed.file),
      };
    const record: ForgepilotObservationData = shape.record;

    // LOW (code review round 1): the cheap, filesystem-free batchId/prefix
    // check runs before any attempt to read the file goalPlan.path names —
    // a mismatched batchId or a path outside this batch's own goal-plan/
    // never causes any file to be opened at all.
    const withinBatchGoalPlanDirectory =
      record.batchId === index.batchId &&
      record.goalPlan.path.startsWith(goalPlanDirectoryPrefix(index.batchId));

    let goalPlanManifestBytes: Uint8Array | undefined;
    if (withinBatchGoalPlanDirectory) {
      // R5: the Goal Plan Manifest path and every directory segment above
      // it must not resolve through a symlink either.
      const goalPlanRead = await readSafeRepoFile(
        root,
        record.goalPlan.path,
        GOAL_PLAN_MANIFEST_MAX_BYTES,
      );
      if (goalPlanRead.kind === "unsafe")
        return {
          mode: parsed.mode,
          result: unsafeResult(
            "goalPlan.path has a symlinked segment",
            record.goalPlan.path,
          ),
        };
      goalPlanManifestBytes =
        goalPlanRead.kind === "ok" ? goalPlanRead.bytes : undefined;
    }

    const consistency = validateForgepilotObservationConsistency(record, {
      batchId: index.batchId,
      goalPlanManifestBytes,
    });
    if (!consistency.ok)
      return {
        mode: parsed.mode,
        result: consistency.tooLarge
          ? tooLargeResult(consistency.message, parsed.file)
          : invalidResult(consistency.message, parsed.file),
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
          result: unsafeResult(
            "records path has a symlinked segment",
            recordsDirectory(manifestPath),
          ),
        };
      return {
        mode: parsed.mode,
        result: envelope(
          "error",
          "ERROR",
          3,
          [
            issue(
              "REVIEW_RECORD_WRITE_FAILED",
              "unable to write the observation record",
              recordsDirectory(manifestPath),
            ),
          ],
          {
            diagnostics: toDataValue([
              locatorDiagnostic(
                "REVIEW_RECORD_WRITE_FAILED",
                recordsDirectory(manifestPath),
              ),
            ]),
          },
        ),
      };
    }

    return {
      mode: parsed.mode,
      result: buildObserveSuccessEnvelope(index, written.relativePath),
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
