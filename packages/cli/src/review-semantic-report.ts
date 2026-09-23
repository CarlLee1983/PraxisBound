/**
 * Reading `--semantic-report` for `review preflight` (contract §9, §13, §15;
 * Story TST-028, R10a). The path rule mirrors `--output`'s
 * (`resolveOutputPath`/`findUnsafeSourcePath` in `review.ts`): it must
 * resolve inside the repository with no symlinked segment, and the file is
 * opened with `O_NOFOLLOW`. Every other decision (well-formed, bound to the
 * current fingerprint, coverage, blocking) is Core's
 * `evaluateSemanticReport`; this module only resolves the path, reads the
 * file within the §13 size bound, and records its sha256 whenever the bytes
 * were actually read (Story TST-028 Capacity "Failure projection").
 */

import { constants } from "node:fs";
import { open } from "node:fs/promises";
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
  readonly findings: readonly PreflightFinding[];
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

function invalidEncodingFinding(): PreflightFinding {
  return {
    code: "REVIEW_SEMANTIC_INVALID",
    message: "Semantic Report is not valid UTF-8",
  };
}

function absent(): SemanticReportLoad {
  return {
    unsafe: false,
    sha256: undefined,
    agent: undefined,
    findings: [missingFinding()],
  };
}

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
  const absolute = isAbsolute(argument) ? argument : resolve(root, argument);
  const relativePath = relative(root, absolute).split("\\").join("/");
  if (
    relativePath === "" ||
    relativePath.startsWith("..") ||
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
  if (!resolved.ok)
    return { unsafe: true, sha256: undefined, agent: undefined, findings: [] };

  const unsafeSegment = await findUnsafeSourcePath(root, [
    resolved.relativePath,
  ]);
  if (unsafeSegment !== undefined)
    return { unsafe: true, sha256: undefined, agent: undefined, findings: [] };

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
    const stats = await handle.stat();
    if (!stats.isFile()) return absent();
    if (stats.size > RECORD_MAX_BYTES)
      return {
        unsafe: false,
        sha256: undefined,
        agent: undefined,
        findings: [tooLargeFinding()],
      };
    const bytes = await readBounded(handle, RECORD_MAX_BYTES);
    if (bytes === undefined)
      return {
        unsafe: false,
        sha256: undefined,
        agent: undefined,
        findings: [tooLargeFinding()],
      };
    const sha256 = sha256Hex(bytes);

    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return {
        unsafe: false,
        sha256,
        agent: undefined,
        findings: [invalidEncodingFinding()],
      };
    }

    const evaluation = evaluateSemanticReport(text, context);
    return {
      unsafe: false,
      sha256,
      agent: evaluation.agent,
      findings: evaluation.diagnostics.map((diagnostic) => ({
        code: diagnostic.code,
        message: diagnostic.message,
        ...(diagnostic.locator === undefined
          ? {}
          : { locator: diagnostic.locator }),
      })),
    };
  } finally {
    await handle.close().catch(() => undefined);
  }
}
