/**
 * `praxisbound review readiness-digests <manifest>` (contract §21, Story
 * TST-030): the only way to rewrite a Readiness Sidecar's own digests. Reads
 * every present `<story>/readiness.json` first; if any is schema-invalid,
 * has the wrong `story_ref`, or is over the §13 size bound, nothing is
 * written and the whole command fails (contract §21 R4; an over-limit one
 * reports `REVIEW_INPUT_TOO_LARGE`, following §13 literally — Human Review
 * 2026-09-23). Otherwise it stages every rewrite as a temporary file first,
 * re-checks each Sidecar's bytes are still what was validated, and only
 * then renames every staged file into place — two-space indentation, one
 * trailing newline, every other field (and its original key order and file
 * mode) unchanged. It never creates a Sidecar and never touches any field
 * but the two digests.
 */

import { chmod, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";

import {
  loadBatchReadinessSidecars,
  prefixedSha256,
} from "./review-readiness.js";
import { findUnsafeSourcePath } from "./review-paths.js";
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

export const reviewReadinessDigestsHelp = `PraxisBound Batch Review Readiness Digests

Usage:
  praxisbound review readiness-digests <manifest> [--json]
  praxisbound review readiness-digests --help

Rewrites only the story_md_digest and acceptance_md_digest fields of every
batch Story's existing readiness.json whose digests are stale, through a
temporary file and atomic rename. It never creates a readiness.json and
never changes any other field. Run it before review confirm: it edits a
definition source, so it needs the same Execution Authorization as any
other source edit, and it changes the Requirement Fingerprint, making an
earlier confirmation inapplicable.
`;

function parseArguments(args: readonly string[]): {
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

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

interface PlannedRewrite {
  readonly path: string;
  readonly absolute: string;
  readonly bytes: Uint8Array;
  readonly originalDigest: string;
  readonly mode: number;
}

interface StagedRewrite extends PlannedRewrite {
  readonly stagePath: string;
}

async function cleanupStaged(staged: readonly StagedRewrite[]): Promise<void> {
  for (const entry of staged)
    await unlink(entry.stagePath).catch(() => undefined);
}

/** Filesystem boundary kept injectable for deterministic mid-rename-failure tests. */
export interface ReadinessDigestsFilesystem {
  readonly rename: typeof rename;
}

const defaultReadinessDigestsFilesystem: ReadinessDigestsFilesystem = {
  rename,
};

/** Runs `praxisbound review readiness-digests <manifest>`. */
export async function runReviewReadinessDigests(
  args: readonly string[],
  root: string = process.cwd(),
  filesystem: ReadinessDigestsFilesystem = defaultReadinessDigestsFilesystem,
): Promise<ReviewIndexExecution> {
  const parsed = parseArguments(args);
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
    const { index, observations } = loaded.loaded;

    const entries = loadBatchReadinessSidecars(index, observations);
    for (const entry of entries) {
      if (entry.parse.ok) continue;
      // §13/§21 literally: an over-limit Sidecar reports
      // REVIEW_INPUT_TOO_LARGE, a schema-invalid one REVIEW_READINESS_INVALID
      // (Human Review 2026-09-23) — both still fail the whole run, nothing
      // written (R4).
      return {
        mode: parsed.mode,
        result: envelope("fail", "failure", 1, [
          issue(
            entry.parse.tooLarge
              ? "REVIEW_INPUT_TOO_LARGE"
              : "REVIEW_READINESS_INVALID",
            entry.parse.message,
            entry.storyDirectory,
          ),
        ]),
      };
    }

    const planned: PlannedRewrite[] = [];
    for (const entry of entries) {
      if (!entry.parse.ok) continue;
      const { data, raw } = entry.parse;
      const storyMdBytes = observations.get(`${entry.storyDirectory}/story.md`);
      const acceptanceMdBytes = observations.get(
        `${entry.storyDirectory}/acceptance.md`,
      );
      if (storyMdBytes?.kind !== "file" || acceptanceMdBytes?.kind !== "file")
        continue;
      const currentStoryDigest = prefixedSha256(storyMdBytes.bytes);
      const currentAcceptanceDigest = prefixedSha256(acceptanceMdBytes.bytes);
      if (
        data.storyMdDigest === currentStoryDigest &&
        data.acceptanceMdDigest === currentAcceptanceDigest
      )
        continue;

      const rewritten = {
        ...raw,
        story_md_digest: currentStoryDigest,
        acceptance_md_digest: currentAcceptanceDigest,
      };
      const path = `${entry.storyDirectory}/readiness.json`;
      const absolute = resolve(root, path);
      const originalObservation = observations.get(path);
      const originalBytes =
        originalObservation?.kind === "file"
          ? originalObservation.bytes
          : new Uint8Array();
      let mode = 0o644;
      try {
        mode = (await stat(absolute)).mode & 0o777;
      } catch {
        // Fall through with the conventional default; the staging or
        // re-check step below will fail closed if the file is genuinely
        // gone or unreadable by the time it matters.
      }
      planned.push({
        path,
        absolute,
        bytes: new TextEncoder().encode(
          `${JSON.stringify(rewritten, null, 2)}\n`,
        ),
        originalDigest: sha256Hex(originalBytes),
        mode,
      });
    }

    if (planned.length === 0) {
      return {
        mode: parsed.mode,
        result: buildSuccessEnvelope(index, []),
      };
    }

    // MEDIUM: stage every temp file first; a single staging failure deletes
    // every temp already created and writes nothing at all.
    const staged: StagedRewrite[] = [];
    for (const item of planned) {
      const stagePath = resolve(
        dirname(item.absolute),
        `.readiness.${randomUUID()}.tmp`,
      );
      try {
        const handle = await open(
          stagePath,
          constants.O_WRONLY |
            constants.O_CREAT |
            constants.O_EXCL |
            constants.O_NOFOLLOW,
          0o600,
        );
        try {
          await handle.writeFile(item.bytes);
        } finally {
          await handle.close();
        }
        // Preserve the original file's mode (never leave the rewritten file
        // at the temp's own 0600): `open`'s own mode argument is subject to
        // umask, so it is corrected explicitly before the file is ever
        // visible at its final name.
        await chmod(stagePath, item.mode);
      } catch {
        await cleanupStaged(staged);
        return {
          mode: parsed.mode,
          result: envelope("fail", "failure", 1, [
            issue(
              "REVIEW_RECORD_WRITE_FAILED",
              "unable to stage a readiness.json rewrite",
              item.path,
            ),
          ]),
        };
      }
      staged.push({ ...item, stagePath });
    }

    // MEDIUM: re-check every Sidecar's bytes are still what was validated —
    // a concurrent modification between reading and renaming aborts the
    // whole run with nothing written.
    for (const item of staged) {
      let currentBytes: Uint8Array;
      try {
        currentBytes = await readFile(item.absolute);
      } catch {
        await cleanupStaged(staged);
        return {
          mode: parsed.mode,
          result: envelope("fail", "failure", 1, [
            issue(
              "REVIEW_RECORD_WRITE_FAILED",
              "readiness.json changed or became unreadable before it could be rewritten",
              item.path,
            ),
          ]),
        };
      }
      if (sha256Hex(currentBytes) !== item.originalDigest) {
        await cleanupStaged(staged);
        return {
          mode: parsed.mode,
          result: envelope("fail", "failure", 1, [
            issue(
              "REVIEW_RECORD_WRITE_FAILED",
              "readiness.json changed before it could be rewritten; nothing was written",
              item.path,
            ),
          ]),
        };
      }
      if ((await findUnsafeSourcePath(root, [item.path])) !== undefined) {
        await cleanupStaged(staged);
        return {
          mode: parsed.mode,
          result: envelope("error", "configuration-error", 2, [
            issue(
              "REVIEW_PATH_UNSAFE",
              "readiness.json path has a symlinked segment",
              item.path,
            ),
          ]),
        };
      }
    }

    // Rename every staged file into place. A failure partway through
    // reports exactly which files were already renamed (they are real,
    // persisted changes — never claimed away) and stops; any temp not yet
    // renamed is deleted rather than left behind.
    const updated: string[] = [];
    for (let index2 = 0; index2 < staged.length; index2 += 1) {
      const item = staged[index2] as StagedRewrite;
      try {
        await filesystem.rename(item.stagePath, item.absolute);
      } catch {
        await cleanupStaged(staged.slice(index2 + 1));
        return {
          mode: parsed.mode,
          result: envelope(
            "fail",
            "failure",
            1,
            [
              issue(
                "REVIEW_RECORD_WRITE_FAILED",
                "unable to rewrite readiness.json",
                item.path,
              ),
            ],
            { updated: toDataValue(updated) },
          ),
        };
      }
      updated.push(item.path);
    }

    // §21: after a successful rewrite the fingerprint changes, so the
    // response reports the post-rewrite state, never the one read at the
    // start of this run.
    const after = await runReviewIndexUnsafe([parsed.manifest, "--json"], root);
    if (after.result.outcome !== "success" || after.loaded === undefined) {
      // Extremely unlikely (the rewrite only ever touches two already-valid
      // digest fields), but never silently claim a fingerprint this run did
      // not actually observe.
      return {
        mode: parsed.mode,
        result: envelope("error", "ERROR", 3, [
          issue(
            "REVIEW_INTERNAL_ERROR",
            "readiness-digests could not re-read the batch after rewriting it",
          ),
        ]),
      };
    }

    return {
      mode: parsed.mode,
      result: buildSuccessEnvelope(after.loaded.index, updated),
    };
  } catch (error) {
    process.stderr.write(
      `praxisbound review readiness-digests: internal error: ${sanitizeInternalError(error, root)}\n`,
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

function buildSuccessEnvelope(
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
      readonly locator?: unknown;
    }[];
  },
  updated: readonly string[],
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
    updated: toDataValue(updated),
  });
}

/** Renders the human output for `review readiness-digests`. */
export function renderReviewReadinessDigestsHuman(
  execution: ReviewIndexExecution,
): ReviewRenderedOutput {
  const { result } = execution;
  if (result.outcome === "usage-error") {
    return {
      stdout: "",
      stderr:
        "ERROR Invalid arguments\n" +
        "Usage: praxisbound review readiness-digests <manifest> [--json]\n" +
        "       praxisbound review readiness-digests --help\n",
    };
  }
  if (result.outcome !== "success") {
    const lines = [
      "PraxisBound Batch Review Readiness Digests",
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
        readonly updated: readonly string[];
      }
    | undefined;
  const lines = ["PraxisBound Batch Review Readiness Digests", ""];
  if (data !== undefined) {
    lines.push(`Batch: ${data.batchId}`);
    lines.push(`Fingerprint: ${data.fingerprint}`);
    lines.push(`Updated: ${data.updated.length}`);
    for (const path of data.updated)
      lines.push(`  ${escapeHumanControlCharacters(path)}`);
  }
  lines.push("", "Result: success", "");
  return { stdout: `${lines.join("\n")}\n`, stderr: "" };
}
