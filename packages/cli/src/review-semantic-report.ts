/**
 * Reading `--semantic-report` for `review preflight` (contract §9, §13, §15;
 * Story TST-028, R10a). The path rule mirrors `--output`'s
 * (`resolveOutputPath`/`findUnsafeSourcePath` in `review.ts`): it must
 * resolve inside the repository with no symlinked segment, and the file is
 * opened with `O_NOFOLLOW`. The path is always lexically normalized
 * (`resolve()`, unconditionally — never the caller-supplied literal) before
 * either the safety check or the open, so the two can never disagree about
 * which path they are judging (review round security C1); after opening,
 * the file's real identity (`fstat` dev/ino) is compared against a fresh
 * `lstat` of that same normalized path, closing the window between the
 * safety check and the open (TOCTOU, M1). Every other decision (well
 * formed, bound to the current fingerprint, coverage, blocking) is Core's
 * `evaluateSemanticReport`; this module only resolves the path, reads the
 * file within the §13 size bound, and records its sha256 whenever the bytes
 * were actually read (Story TST-028 Capacity "Failure projection").
 */

import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import {
  evaluateSemanticReport,
  sha256Hex,
  type PreflightFinding,
  type SemanticReportContext,
} from "@praxisbound/core";

import { findUnsafeSourcePath } from "./review-paths.js";
import { readBounded, RECORD_MAX_BYTES } from "./review-records.js";

export interface SemanticReportLoad {
  /** `true` when the path is unsafe (R10a): the caller stops before evaluating anything else and writes no Preflight Report. */
  readonly unsafe: boolean;
  /** Recorded whenever the bytes were read within the §13 bound, regardless of whether the content later proved valid. */
  readonly sha256: string | undefined;
  /** The report's own `agent` field, once read as a valid string — the Agent's unverified claim (R5). */
  readonly agent: string | undefined;
  /** R1 "gate" diagnostics (missing, size-before-read too-large, and every diagnostic Core's `evaluateSemanticReport` returns in `gate`) — placed in `mechanical[]` by the caller (Story H1). */
  readonly gateFindings: readonly PreflightFinding[];
  /** R2–R4 diagnostics (coverage, duplicate/outside-batch Story, locator, blocking, observation) — placed in `semantic[]` by the caller. */
  readonly semanticFindings: readonly PreflightFinding[];
}

function missingFinding(): PreflightFinding {
  return {
    code: "REVIEW_SEMANTIC_MISSING",
    message: "no Semantic Report was provided",
  };
}

function tooLargeFinding(): PreflightFinding {
  return {
    code: "REVIEW_INPUT_TOO_LARGE",
    message: "the Semantic Report file exceeds the size limit (1 MiB)",
  };
}

function absent(): SemanticReportLoad {
  return {
    unsafe: false,
    sha256: undefined,
    agent: undefined,
    gateFindings: [missingFinding()],
    semanticFindings: [],
  };
}

function unsafeLoad(): SemanticReportLoad {
  return {
    unsafe: true,
    sha256: undefined,
    agent: undefined,
    gateFindings: [],
    semanticFindings: [],
  };
}

/**
 * Always lexically normalizes `argument` (via `resolve()`, unconditionally
 * — never the caller-supplied literal, even when it is already absolute)
 * before computing the repository-relative path the safety check judges.
 * Security C1: the earlier `isAbsolute(argument) ? argument : resolve(...)`
 * form kept an absolute argument's literal `..`/symlink segments for the
 * later `open()` while the safety check judged a *different*,
 * `path.relative`-normalized string — an absolute argument like
 * `<root>/link/../report.json`, where `link` is a symlink out of the
 * repository, would normalize away to a safe-looking relative path while
 * still being opened, un-normalized, through the symlink. Resolving once,
 * unconditionally, and using that single result for both the check and the
 * open removes the discrepancy.
 */
function resolveRepoRelativePath(
  root: string,
  argument: string,
):
  | {
      readonly ok: true;
      readonly absolute: string;
      readonly relativePath: string;
    }
  | { readonly ok: false } {
  const absolute = resolve(root, argument);
  const relativePath = relative(root, absolute).split("\\").join("/");
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith("../") ||
    isAbsolute(relativePath)
  )
    return { ok: false };
  return { ok: true, absolute, relativePath };
}

/**
 * Reads and evaluates one `--semantic-report` file. `argument` being
 * `undefined` (the flag was never given) is `REVIEW_SEMANTIC_MISSING`, the
 * same as a path that does not resolve to a readable regular file — this
 * Story never distinguishes "flag absent" from "file missing" (R1).
 */
export async function loadSemanticReport(
  root: string,
  argument: string | undefined,
  context: SemanticReportContext,
): Promise<SemanticReportLoad> {
  if (argument === undefined) return absent();

  const resolved = resolveRepoRelativePath(root, argument);
  if (!resolved.ok) return unsafeLoad();

  const unsafeSegment = await findUnsafeSourcePath(root, [
    resolved.relativePath,
  ]);
  if (unsafeSegment !== undefined) return unsafeLoad();

  let handle;
  try {
    handle = await open(
      resolved.absolute,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch {
    return absent();
  }
  try {
    const openedStats = await handle.stat();
    // TOCTOU (M1): re-`lstat` the same normalized path right after opening
    // and require it to name the exact file the open landed on. A mismatch
    // means something changed the path between the safety check and the
    // open (or the open otherwise resolved somewhere else) — treated as
    // unsafe, never read.
    let diskStats;
    try {
      diskStats = await lstat(resolved.absolute);
    } catch {
      return unsafeLoad();
    }
    if (openedStats.dev !== diskStats.dev || openedStats.ino !== diskStats.ino)
      return unsafeLoad();
    if (!openedStats.isFile()) return absent();
    if (openedStats.size > RECORD_MAX_BYTES)
      return {
        unsafe: false,
        sha256: undefined,
        agent: undefined,
        gateFindings: [tooLargeFinding()],
        semanticFindings: [],
      };
    const bytes = await readBounded(handle, RECORD_MAX_BYTES);
    if (bytes === undefined)
      return {
        unsafe: false,
        sha256: undefined,
        agent: undefined,
        gateFindings: [tooLargeFinding()],
        semanticFindings: [],
      };
    const sha256 = sha256Hex(bytes);

    const evaluation = evaluateSemanticReport(bytes, context);
    const toFinding = (diagnostic: {
      readonly code: string;
      readonly message: string;
      readonly locator?: PreflightFinding["locator"];
    }): PreflightFinding => ({
      code: diagnostic.code,
      message: diagnostic.message,
      ...(diagnostic.locator === undefined
        ? {}
        : { locator: diagnostic.locator }),
    });
    return {
      unsafe: false,
      sha256,
      agent: evaluation.agent,
      gateFindings: evaluation.gate.map(toFinding),
      semanticFindings: evaluation.semantic.map(toFinding),
    };
  } finally {
    await handle.close().catch(() => undefined);
  }
}
