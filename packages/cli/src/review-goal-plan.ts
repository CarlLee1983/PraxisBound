/**
 * `praxisbound review goal-plan <manifest> --semantic-report <file>
 * [--attempt <n>]` (contract §10, Story TST-031): runs exactly the same
 * mechanical/Semantic Report evaluation `review preflight` does
 * (`gatherReviewPreflightEvaluation`, R1), adds `REVIEW_READINESS_MISSING`
 * for a batch Story with no Readiness Sidecar at all (`goal-plan`-only),
 * writes a Preflight Report the same way `review preflight` does
 * (`writeReviewPreflightRecord`), and — only when the outcome is
 * `REVIEW_READY` — projects the three Goal Plan artifacts with Core's pure
 * `projectGoalPlan` and writes them under
 * `specs/batches/<BATCH-ID>/goal-plan/<plan.id>/` (contract §10 steps 2–4).
 *
 * The command never runs ForgePilot and grants no execution authority
 * (contract §10, `ADR-016`).
 */

import { constants } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { resolve } from "node:path";

import {
  projectGoalPlan,
  type GoalPlanProjectionStory,
  type ReviewIndex,
} from "@praxisbound/core";

import {
  gatherReviewPreflightEvaluation,
  writeReviewPreflightRecord,
} from "./review-preflight.js";
import { findUnsafeSourcePath } from "./review-paths.js";
import { readRecordBytes } from "./review-records.js";
import {
  envelope,
  escapeHumanControlCharacters,
  issue,
  sanitizeInternalError,
  toDataValue,
  type ReviewIndexExecution,
  type ReviewOutputMode,
  type ReviewRenderedOutput,
} from "./review.js";

export const reviewGoalPlanHelp = `PraxisBound Batch Review Goal Plan

Usage:
  praxisbound review goal-plan <manifest> --semantic-report <file>
    [--attempt <n>] [--json]
  praxisbound review goal-plan --help

Runs the same evaluation as review preflight, additionally requiring a
Readiness Sidecar for every batch Story, and — only when the outcome is
REVIEW_READY — projects declaration.json, manifest.json, and
coverage-review.json under specs/batches/<BATCH-ID>/goal-plan/<plan.id>/.
The artifacts carry no authorization, verification result, or completion
claim, and the command never runs ForgePilot.
`;

const MAX_PLAN_ID_LENGTH = 128;
const ATTEMPT_PATTERN = /^[1-9][0-9]*$/;

interface ParsedGoalPlanArguments {
  readonly mode: ReviewOutputMode;
  readonly manifest: string | undefined;
  readonly semanticReport: string | undefined;
  readonly attempt: string | undefined;
  readonly valid: boolean;
}

function parseGoalPlanArguments(
  args: readonly string[],
): ParsedGoalPlanArguments {
  let mode: ReviewOutputMode = "human";
  let manifest: string | undefined;
  let semanticReport: string | undefined;
  let attempt: string | undefined;
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
    if (token === "--attempt" && attempt === undefined) {
      const value = args[index + 1];
      index += 1;
      if (value === undefined) {
        valid = false;
        continue;
      }
      attempt = value;
      continue;
    }
    if (manifest === undefined && !token.startsWith("-")) {
      manifest = token;
      continue;
    }
    valid = false;
  }

  // R3: --attempt is a decimal integer from 1, no leading zeros; anything
  // else (including a non-numeric or shell-injection-shaped value) is
  // usage-error. A missing --semantic-report is usage-error (Human Review
  // 2026-09-24 decision).
  if (attempt !== undefined && !ATTEMPT_PATTERN.test(attempt)) valid = false;

  return {
    mode,
    manifest,
    semanticReport,
    attempt,
    valid: valid && manifest !== undefined && semanticReport !== undefined,
  };
}

interface PlannedArtifact {
  readonly path: string;
  readonly absolute: string;
  readonly bytes: Uint8Array;
}

type ExistingArtifactState =
  | { readonly kind: "missing" }
  | { readonly kind: "symlink" }
  | { readonly kind: "file"; readonly bytes: Uint8Array }
  | { readonly kind: "error" };

const READ_EXISTING_MAX_BYTES = 8 * 1024 * 1024;

async function readExistingArtifact(
  absolute: string,
): Promise<ExistingArtifactState> {
  let handle;
  try {
    handle = await open(
      absolute,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { kind: "missing" };
    if (code === "ELOOP") return { kind: "symlink" };
    return { kind: "error" };
  }
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) return { kind: "error" };
    if (stats.size > READ_EXISTING_MAX_BYTES) return { kind: "error" };
    return { kind: "file", bytes: await handle.readFile() };
  } catch {
    return { kind: "error" };
  } finally {
    await handle.close().catch(() => undefined);
  }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

type WriteArtifactsResult =
  | { readonly ok: true; readonly written: readonly string[] }
  | {
      readonly ok: false;
      readonly code: "REVIEW_PATH_UNSAFE" | "REVIEW_GOAL_PLAN_CONFLICT";
      readonly message: string;
      readonly path: string;
    }
  | { readonly ok: false; readonly code: "ERROR"; readonly message: string };

/**
 * Contract §10 step 4: every artifact is created exclusively; an existing
 * file with identical bytes counts as written and is left untouched; an
 * existing file with different bytes rejects the whole run
 * (`REVIEW_GOAL_PLAN_CONFLICT`) without rewriting or deleting anything
 * already there; a symlink anywhere on an artifact's path is
 * `REVIEW_PATH_UNSAFE` (R6). Files already created earlier in this same run
 * are never rolled back (R5) — only nothing further is written.
 */
async function writeGoalPlanArtifacts(
  root: string,
  directory: string,
  artifacts: readonly PlannedArtifact[],
): Promise<WriteArtifactsResult> {
  // R6: the directory and every parent up to the repository root, checked
  // before any directory is created or file written.
  if ((await findUnsafeSourcePath(root, [directory])) !== undefined) {
    return {
      ok: false,
      code: "REVIEW_PATH_UNSAFE",
      message: "the Goal Plan directory has a symlinked segment",
      path: directory,
    };
  }

  try {
    await mkdir(resolve(root, directory), { recursive: true });
  } catch {
    return {
      ok: false,
      code: "ERROR",
      message: "unable to create the Goal Plan directory",
    };
  }

  // TOCTOU: re-check after mkdir, in case a symlink was substituted for a
  // segment concurrently with directory creation.
  if ((await findUnsafeSourcePath(root, [directory])) !== undefined) {
    return {
      ok: false,
      code: "REVIEW_PATH_UNSAFE",
      message: "the Goal Plan directory has a symlinked segment",
      path: directory,
    };
  }

  const written: string[] = [];
  for (const artifact of artifacts) {
    if ((await findUnsafeSourcePath(root, [artifact.path])) !== undefined) {
      return {
        ok: false,
        code: "REVIEW_PATH_UNSAFE",
        message: "an artifact path has a symlinked segment",
        path: artifact.path,
      };
    }

    let handle;
    try {
      handle = await open(
        artifact.absolute,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o644,
      );
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        return {
          ok: false,
          code: "ERROR",
          message: `unable to write ${artifact.path}`,
        };
      }
      const existing = await readExistingArtifact(artifact.absolute);
      if (existing.kind === "symlink") {
        return {
          ok: false,
          code: "REVIEW_PATH_UNSAFE",
          message: "an artifact path has a symlinked segment",
          path: artifact.path,
        };
      }
      if (existing.kind === "file") {
        if (bytesEqual(existing.bytes, artifact.bytes)) {
          written.push(artifact.path);
          continue;
        }
        return {
          ok: false,
          code: "REVIEW_GOAL_PLAN_CONFLICT",
          message: "an existing Goal Plan artifact has different bytes",
          path: artifact.path,
        };
      }
      return {
        ok: false,
        code: "ERROR",
        message: `unable to write ${artifact.path}`,
      };
    }
    try {
      await handle.writeFile(artifact.bytes);
    } catch {
      return {
        ok: false,
        code: "ERROR",
        message: `unable to write ${artifact.path}`,
      };
    } finally {
      await handle.close().catch(() => undefined);
    }
    written.push(artifact.path);
  }

  return { ok: true, written };
}

/** Runs `praxisbound review goal-plan <manifest> --semantic-report <file> [--attempt <n>]`. */
export async function runReviewGoalPlan(
  args: readonly string[],
  root: string = process.cwd(),
): Promise<ReviewIndexExecution> {
  const parsed = parseGoalPlanArguments(args);
  if (!parsed.valid || parsed.manifest === undefined) {
    return {
      mode: parsed.mode,
      result: envelope("error", "usage-error", 2, [
        issue("REVIEW_USAGE", "Invalid arguments"),
      ]),
    };
  }

  try {
    const gathered = await gatherReviewPreflightEvaluation(
      {
        mode: parsed.mode,
        manifest: parsed.manifest,
        semanticReport: parsed.semanticReport,
        expectFingerprint: undefined,
        expectRevision: undefined,
      },
      root,
      {},
      // contract §10 step 1: goal-plan-only REVIEW_READINESS_MISSING for a
      // Story with no Readiness Sidecar at all.
      (index: ReviewIndex) =>
        index.stories
          .filter((story) => story.readinessPresent !== true)
          .map((story) => ({
            code: "REVIEW_READINESS_MISSING",
            message: "Story has no Readiness Sidecar (readiness.json)",
            path: story.path,
          })),
    );
    if (!gathered.ok) return gathered.execution;
    const { index } = gathered.gathered;

    // R3/contract §10 step 2: plan.id length is checked before any write —
    // before even the Preflight Report.
    const fp12 = index.fingerprint.slice(0, 12);
    const planId =
      parsed.attempt === undefined
        ? `${index.batchId}-${fp12}`
        : `${index.batchId}-${fp12}-a${parsed.attempt}`;
    if (planId.length > MAX_PLAN_ID_LENGTH) {
      return {
        mode: parsed.mode,
        result: envelope("error", "configuration-error", 2, [
          issue(
            "REVIEW_GOAL_PLAN_ID_INVALID",
            `plan.id exceeds ${MAX_PLAN_ID_LENGTH} characters`,
          ),
        ]),
      };
    }

    const written = await writeReviewPreflightRecord(root, gathered.gathered);
    if (written.result.outcome !== "REVIEW_READY") return written;

    // Only REVIEW_READY reaches here: every check the mechanical/semantic
    // evaluation performs, including REVIEW_READINESS_MISSING, has already
    // passed, so every Story has a present, schema-valid Sidecar and a
    // Definition Confirmation applies to the current fingerprint.
    const { loadedBatch, confirmationLoad } = gathered.gathered;
    const { manifestPath, observations } = loadedBatch;

    if (confirmationLoad.applicability?.applies !== true) {
      // Should be unreachable (REVIEW_READY implies an applicable
      // confirmation, contract §9's confirmation row) — defense in depth.
      process.stderr.write(
        "praxisbound review goal-plan: internal error: no applicable Definition Confirmation despite REVIEW_READY\n",
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
    const confirmation = confirmationLoad.applicability.confirmation;
    const confirmationBytes = await readRecordBytes(
      resolve(root, confirmation.path),
    );
    const manifestBytes = await readRecordBytes(resolve(root, manifestPath));
    if (confirmationBytes === undefined || manifestBytes === undefined) {
      process.stderr.write(
        "praxisbound review goal-plan: internal error: could not re-read a required source\n",
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

    const bytesOf = (path: string): Uint8Array | undefined => {
      const observation = observations.get(path);
      return observation?.kind === "file" ? observation.bytes : undefined;
    };

    const dependencyIdsByStory = new Map(
      index.dependencies.map((entry) => [entry.story, entry.dependsOn]),
    );

    const stories: GoalPlanProjectionStory[] = [];
    for (const story of index.stories) {
      if (story.id === undefined || story.readinessPath === undefined) {
        process.stderr.write(
          "praxisbound review goal-plan: internal error: a ready batch Story is missing an ID or Readiness Sidecar path\n",
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
      const readinessBytes = bytesOf(story.readinessPath);
      const storyMdBytes = bytesOf(`${story.path}/story.md`);
      const acceptanceMdBytes = bytesOf(`${story.path}/acceptance.md`);
      if (
        readinessBytes === undefined ||
        storyMdBytes === undefined ||
        acceptanceMdBytes === undefined
      ) {
        process.stderr.write(
          "praxisbound review goal-plan: internal error: a ready batch Story is missing source bytes\n",
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
      stories.push({
        nodeRef: story.id,
        storyRef: story.path,
        dependsOn: dependencyIdsByStory.get(story.id) ?? [],
        readiness: { path: story.readinessPath, bytes: readinessBytes },
        storyMd: { path: `${story.path}/story.md`, bytes: storyMdBytes },
        acceptanceMd: {
          path: `${story.path}/acceptance.md`,
          bytes: acceptanceMdBytes,
        },
      });
    }

    const adrBindings = index.adrs.map((adr) => {
      const bytes = bytesOf(adr.path);
      return bytes === undefined ? undefined : { path: adr.path, bytes };
    });
    const specBindings = index.specs.map((spec) => {
      const bytes = bytesOf(spec.path);
      return bytes === undefined ? undefined : { path: spec.path, bytes };
    });
    if (
      adrBindings.some((entry) => entry === undefined) ||
      specBindings.some((entry) => entry === undefined)
    ) {
      process.stderr.write(
        "praxisbound review goal-plan: internal error: a ready batch is missing ADR or Spec bytes\n",
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

    const projection = projectGoalPlan({
      planId,
      batchId: index.batchId,
      fingerprint: index.fingerprint,
      batchJson: { path: manifestPath, bytes: manifestBytes },
      adrs: adrBindings as {
        readonly path: string;
        readonly bytes: Uint8Array;
      }[],
      specs: specBindings as {
        readonly path: string;
        readonly bytes: Uint8Array;
      }[],
      stories,
      confirmation: {
        path: confirmation.path,
        bytes: confirmationBytes,
        confirmedAt: confirmation.record.confirmedAt,
      },
    });

    if (!projection.ok) {
      process.stderr.write(
        `praxisbound review goal-plan: internal error: ${projection.message}\n`,
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

    const artifacts: PlannedArtifact[] = [
      {
        path: projection.declarationPath,
        absolute: resolve(root, projection.declarationPath),
        bytes: projection.declaration,
      },
      {
        path: projection.manifestPath,
        absolute: resolve(root, projection.manifestPath),
        bytes: projection.manifest,
      },
      {
        path: projection.coverageReviewPath,
        absolute: resolve(root, projection.coverageReviewPath),
        bytes: projection.coverageReview,
      },
    ];

    const writeResult = await writeGoalPlanArtifacts(
      root,
      projection.directory,
      artifacts,
    );
    if (!writeResult.ok) {
      if (writeResult.code === "ERROR") {
        process.stderr.write(
          `praxisbound review goal-plan: internal error: ${writeResult.message}\n`,
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
      if (writeResult.code === "REVIEW_PATH_UNSAFE") {
        return {
          mode: parsed.mode,
          result: envelope("error", "configuration-error", 2, [
            issue(writeResult.code, writeResult.message, writeResult.path),
          ]),
        };
      }
      return {
        mode: parsed.mode,
        result: envelope(
          "fail",
          "failure",
          1,
          [issue(writeResult.code, writeResult.message, writeResult.path)],
          written.result.data,
        ),
      };
    }

    const baseData = (written.result.data ?? {}) as Record<string, unknown>;
    return {
      mode: parsed.mode,
      result: envelope("pass", "REVIEW_READY", 0, written.result.issues, {
        ...baseData,
        goalPlanDirectory: projection.directory,
        files: toDataValue(writeResult.written),
      }),
    };
  } catch (error) {
    process.stderr.write(
      `praxisbound review goal-plan: internal error: ${sanitizeInternalError(error, root)}\n`,
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

/** Renders the human output for `review goal-plan`. */
export function renderReviewGoalPlanHuman(
  execution: ReviewIndexExecution,
): ReviewRenderedOutput {
  const { result } = execution;
  if (result.outcome === "usage-error") {
    return {
      stdout: "",
      stderr:
        "ERROR Invalid arguments\n" +
        "Usage: praxisbound review goal-plan <manifest> --semantic-report <file>\n" +
        "         [--attempt <n>] [--json]\n" +
        "       praxisbound review goal-plan --help\n",
    };
  }
  if (result.outcome !== "REVIEW_READY") {
    const lines = [
      "PraxisBound Batch Review Goal Plan",
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
        readonly preflightRecord?: string;
        readonly goalPlanDirectory?: string;
        readonly files?: readonly string[];
      }
    | undefined;
  const lines = ["PraxisBound Batch Review Goal Plan", ""];
  if (data?.preflightRecord !== undefined)
    lines.push(`Record: ${escapeHumanControlCharacters(data.preflightRecord)}`);
  if (data?.goalPlanDirectory !== undefined)
    lines.push(
      `Goal Plan: ${escapeHumanControlCharacters(data.goalPlanDirectory)}`,
    );
  for (const file of data?.files ?? [])
    lines.push(`  ${escapeHumanControlCharacters(file)}`);
  lines.push("", "Result: REVIEW_READY", "");
  return { stdout: `${lines.join("\n")}\n`, stderr: "" };
}
