/**
 * `praxisbound review readiness-digests <manifest>` (contract §21, Story
 * TST-030): the only way to rewrite a Readiness Sidecar's own digests. Reads
 * every present `<story>/readiness.json` first; if any is schema-invalid,
 * has the wrong `story_ref`, or is over the §13 size bound, nothing is
 * written and the whole command fails (contract §21 R4). Otherwise it
 * rewrites, through a temporary file and atomic rename, only the Sidecars
 * whose `story_md_digest`/`acceptance_md_digest` differ from the current
 * `story.md`/`acceptance.md` bytes — two spaces of indentation, one trailing
 * newline, every other field (and its original key order) unchanged. It
 * never creates a Sidecar and never touches any field but the two digests.
 */

import { constants } from "node:fs";
import { open, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
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

async function rewriteSidecar(
  root: string,
  path: string,
  bytes: Uint8Array,
): Promise<"written" | "unsafe" | "failed"> {
  const absolute = resolve(root, path);
  const stage = resolve(dirname(absolute), `.readiness.${randomUUID()}.tmp`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let renamed = false;
  try {
    handle = await open(
      stage,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    await handle.writeFile(bytes);
    await handle.close();
    handle = undefined;

    if ((await findUnsafeSourcePath(root, [path])) !== undefined)
      return "unsafe";

    await rename(stage, absolute);
    renamed = true;
    return "written";
  } catch {
    return "failed";
  } finally {
    if (handle !== undefined) await handle.close().catch(() => undefined);
    if (!renamed) await unlink(stage).catch(() => undefined);
  }
}

/** Runs `praxisbound review readiness-digests <manifest>`. */
export async function runReviewReadinessDigests(
  args: readonly string[],
  root: string = process.cwd(),
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
      return {
        mode: parsed.mode,
        result: envelope("fail", "failure", 1, [
          issue(
            "REVIEW_READINESS_INVALID",
            entry.parse.message,
            entry.storyDirectory,
          ),
        ]),
      };
    }

    const toRewrite: { readonly path: string; readonly bytes: Uint8Array }[] =
      [];
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
      toRewrite.push({
        path,
        bytes: new TextEncoder().encode(
          `${JSON.stringify(rewritten, null, 2)}\n`,
        ),
      });
    }

    const updated: string[] = [];
    for (const { path, bytes } of toRewrite) {
      const outcome = await rewriteSidecar(root, path, bytes);
      if (outcome === "unsafe") {
        return {
          mode: parsed.mode,
          result: envelope("error", "configuration-error", 2, [
            issue(
              "REVIEW_PATH_UNSAFE",
              "readiness.json path has a symlinked segment",
              path,
            ),
          ]),
        };
      }
      if (outcome === "failed") {
        return {
          mode: parsed.mode,
          result: envelope("fail", "failure", 1, [
            issue(
              "REVIEW_RECORD_WRITE_FAILED",
              "unable to rewrite readiness.json",
              path,
            ),
          ]),
        };
      }
      updated.push(path);
    }

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
    return {
      mode: parsed.mode,
      result: envelope("pass", "success", 0, issues, {
        batchId: index.batchId,
        fingerprint: index.fingerprint,
        sources: toDataValue(index.sources),
        diagnostics: toDataValue(diagnostics),
        updated: toDataValue(updated),
      }),
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
