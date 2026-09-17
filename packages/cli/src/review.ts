import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import {
  IMPLEMENTED_PROTOCOL_VERSION,
  RESULT_SCHEMA_VERSION,
  indexReviewBatch,
  planReviewBatch,
  type ReviewIndex,
  type ReviewObservations,
  type ResultDataValue,
  type ResultEnvelope,
  type ResultIssue,
  type SourceObservation,
} from "@praxisbound/core";

export type ReviewOutputMode = "human" | "json";

export interface ReviewIndexExecution {
  readonly mode: ReviewOutputMode;
  readonly result: ResultEnvelope;
}

export interface ReviewRenderedOutput {
  readonly stdout: string;
  readonly stderr: string;
}

const MANIFEST_MAX_BYTES = 1024 * 1024;
const SOURCE_MAX_BYTES = 4 * 1024 * 1024;

export const reviewHelp = `PraxisBound Batch Review Source Index

Usage:
  praxisbound review index <manifest> [--json]
  praxisbound review index --help

Reads one Batch Manifest (specs/batches/<BATCH-ID>/batch.json) and the
working-tree bytes of every source it declares, and reports the Requirement
Fingerprint, stable locators, and the Spec requirement -> Story -> acceptance
trace as one result envelope.

The command is read-only: it writes no file and never follows a symlinked
path segment. A missing source, an unmapped Spec entry, or a Story without
acceptance criteria is reported as a diagnostic on a successful result, so a
readable draft still produces an index.
`;

function issue(code: string, message: string, path?: string): ResultIssue {
  return path === undefined ? { code, message } : { code, message, path };
}

function envelope(
  status: "pass" | "error",
  outcome: "success" | "usage-error" | "configuration-error" | "ERROR",
  exit: 0 | 2 | 3,
  issues: readonly ResultIssue[],
  data?: Readonly<Record<string, ResultDataValue>>,
): ResultEnvelope {
  return Object.freeze({
    schemaVersion: RESULT_SCHEMA_VERSION,
    protocolVersion: IMPLEMENTED_PROTOCOL_VERSION,
    status,
    outcome,
    exit,
    subject: "review",
    issues: Object.freeze([...issues]),
    ...(data === undefined ? {} : { data: Object.freeze(data) }),
  } as const);
}

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

/** Resolves the caller's manifest argument to a repository-relative POSIX path. */
function resolveManifestPath(
  root: string,
  manifestArgument: string,
):
  | {
      readonly ok: true;
      readonly absolute: string;
      readonly relativePath: string;
    }
  | { readonly ok: false } {
  const absolute = isAbsolute(manifestArgument)
    ? manifestArgument
    : resolve(root, manifestArgument);
  const relativePath = relative(root, absolute).split("\\").join("/");
  if (
    relativePath === "" ||
    relativePath.startsWith("..") ||
    isAbsolute(relativePath)
  ) {
    return { ok: false };
  }
  return { ok: true, absolute, relativePath };
}

/** Finds the first declared path with a symlinked segment, checking every segment, not only the last. */
async function findUnsafeSourcePath(
  root: string,
  paths: readonly string[],
): Promise<string | undefined> {
  for (const path of paths) {
    const segments = path.split("/");
    let prefix = "";
    for (const segment of segments) {
      prefix = prefix === "" ? segment : `${prefix}/${segment}`;
      let stats;
      try {
        stats = await lstat(resolve(root, prefix));
      } catch {
        break;
      }
      if (stats.isSymbolicLink()) return path;
    }
  }
  return undefined;
}

/** Finds the first declared source whose size exceeds contract §13's per-source limit. */
async function findOversizedSourcePath(
  root: string,
  paths: readonly string[],
): Promise<string | undefined> {
  for (const path of paths) {
    let stats;
    try {
      stats = await lstat(resolve(root, path));
    } catch {
      continue;
    }
    if (stats.isFile() && stats.size > SOURCE_MAX_BYTES) return path;
  }
  return undefined;
}

/**
 * Reads one source without ever following a symlink swapped in after the
 * safety pre-check: the handle is opened with `O_NOFOLLOW` and revalidated
 * before the read, exactly like Story's `readSafeSource`.
 */
async function readSourceObservation(
  root: string,
  path: string,
): Promise<SourceObservation> {
  const absolute = resolve(root, path);
  let pathStats;
  try {
    pathStats = await lstat(absolute);
  } catch {
    return { kind: "missing" };
  }
  if (pathStats.isSymbolicLink()) return { kind: "unsafe" };
  if (!pathStats.isFile()) return { kind: "missing" };

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
    if (!openedStats.isFile()) return { kind: "missing" };
    const bytes = await handle.readFile();
    return { kind: "file", bytes };
  } catch {
    return { kind: "missing" };
  } finally {
    await handle.close().catch(() => undefined);
  }
}

function toDataValue(value: unknown): ResultDataValue {
  return value as ResultDataValue;
}

function buildSuccessEnvelope(index: ReviewIndex): ResultEnvelope {
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
    manifestSha256: index.manifestSha256,
    sources: toDataValue(index.sources),
    adrs: toDataValue(index.adrs),
    specs: toDataValue(index.specs),
    stories: toDataValue(index.stories),
    trace: toDataValue(index.trace),
    dependencies: toDataValue(index.dependencies),
    diagnostics: toDataValue(diagnostics),
  });
}

function sanitizeInternalError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const oneLine = message.split("\n")[0] ?? "unexpected internal failure";
  return oneLine.length > 200 ? `${oneLine.slice(0, 200)}...` : oneLine;
}

/** Runs `praxisbound review index <manifest>`. */
export async function runReviewIndex(
  args: readonly string[],
  root: string = process.cwd(),
): Promise<ReviewIndexExecution> {
  try {
    return await runReviewIndexUnsafe(args, root);
  } catch (error) {
    const mode: ReviewOutputMode = args.includes("--json") ? "json" : "human";
    // The cause is never discarded: a sanitized, single-line rendering of it
    // always reaches stderr, even in JSON mode, where stdout is reserved for
    // the one envelope. The envelope's own issue message stays generic.
    process.stderr.write(
      `praxisbound review index: internal error: ${sanitizeInternalError(error)}\n`,
    );
    return {
      mode,
      result: envelope("error", "ERROR", 3, [
        issue(
          "REVIEW_INTERNAL_ERROR",
          "an unexpected internal failure occurred",
        ),
      ]),
    };
  }
}

async function runReviewIndexUnsafe(
  args: readonly string[],
  root: string,
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

  const resolved = resolveManifestPath(root, parsed.manifest);
  if (!resolved.ok) {
    return {
      mode: parsed.mode,
      result: envelope("error", "configuration-error", 2, [
        issue(
          "REVIEW_PATH_UNSAFE",
          "manifest path resolves outside the repository root",
        ),
      ]),
    };
  }

  // Every segment of the manifest path is checked for a symlink, not only
  // the manifest file itself: a symlinked `specs/batches/` or `specs/`
  // directory is just as unsafe as a symlinked leaf file.
  const unsafeManifestPath = await findUnsafeSourcePath(root, [
    resolved.relativePath,
  ]);
  if (unsafeManifestPath !== undefined) {
    return {
      mode: parsed.mode,
      result: envelope("error", "configuration-error", 2, [
        issue(
          "REVIEW_PATH_UNSAFE",
          `manifest path has a symlinked segment: ${unsafeManifestPath}`,
          unsafeManifestPath,
        ),
      ]),
    };
  }

  let manifestStats;
  try {
    manifestStats = await lstat(resolved.absolute);
  } catch {
    return {
      mode: parsed.mode,
      result: envelope("error", "configuration-error", 2, [
        issue("REVIEW_MANIFEST_INVALID", "manifest is missing or unreadable"),
      ]),
    };
  }

  if (!manifestStats.isFile()) {
    return {
      mode: parsed.mode,
      result: envelope("error", "configuration-error", 2, [
        issue("REVIEW_MANIFEST_INVALID", "manifest is missing or unreadable"),
      ]),
    };
  }
  if (manifestStats.size > MANIFEST_MAX_BYTES) {
    return {
      mode: parsed.mode,
      result: envelope("error", "configuration-error", 2, [
        issue(
          "REVIEW_INPUT_TOO_LARGE",
          `manifest exceeds ${MANIFEST_MAX_BYTES} bytes`,
        ),
      ]),
    };
  }

  let manifestBytes;
  try {
    const handle = await open(
      resolved.absolute,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const openedStats = await handle.stat();
      if (!openedStats.isFile()) throw new Error("not a regular file");
      manifestBytes = await handle.readFile();
    } finally {
      await handle.close().catch(() => undefined);
    }
  } catch {
    return {
      mode: parsed.mode,
      result: envelope("error", "configuration-error", 2, [
        issue("REVIEW_MANIFEST_INVALID", "manifest is missing or unreadable"),
      ]),
    };
  }

  const plan = planReviewBatch(resolved.relativePath, manifestBytes);
  if (!plan.ok) {
    return {
      mode: parsed.mode,
      result: envelope("error", "configuration-error", 2, [
        issue(plan.code, plan.message, plan.path),
      ]),
    };
  }

  const unsafePath = await findUnsafeSourcePath(root, plan.plan.sources);
  if (unsafePath !== undefined) {
    return {
      mode: parsed.mode,
      result: envelope("error", "configuration-error", 2, [
        issue(
          "REVIEW_PATH_UNSAFE",
          `declared path has a symlinked segment: ${unsafePath}`,
          unsafePath,
        ),
      ]),
    };
  }

  const oversizedPath = await findOversizedSourcePath(root, plan.plan.sources);
  if (oversizedPath !== undefined) {
    return {
      mode: parsed.mode,
      result: envelope("error", "configuration-error", 2, [
        issue(
          "REVIEW_INPUT_TOO_LARGE",
          `declared source exceeds ${SOURCE_MAX_BYTES} bytes: ${oversizedPath}`,
          oversizedPath,
        ),
      ]),
    };
  }

  // Sources are read sequentially (bounded concurrency of one): a batch is
  // capped at a few hundred small Markdown files, so throughput is not a
  // concern, and sequential reads keep this adapter simple to reason about.
  const observations = new Map<string, SourceObservation>();
  for (const path of plan.plan.sources) {
    observations.set(path, await readSourceObservation(root, path));
  }

  const indexed = indexReviewBatch(
    plan.plan,
    observations as ReviewObservations,
  );

  if (indexed.kind === "unsafe") {
    return {
      mode: parsed.mode,
      result: envelope("error", "configuration-error", 2, [
        issue(
          "REVIEW_PATH_UNSAFE",
          `declared path has a symlinked segment: ${indexed.path}`,
          indexed.path,
        ),
      ]),
    };
  }
  if (indexed.kind === "too-large") {
    return {
      mode: parsed.mode,
      result: envelope("error", "configuration-error", 2, [
        issue(
          "REVIEW_INPUT_TOO_LARGE",
          `declared source exceeds ${SOURCE_MAX_BYTES} bytes: ${indexed.path}`,
          indexed.path,
        ),
      ]),
    };
  }

  return { mode: parsed.mode, result: buildSuccessEnvelope(indexed.index) };
}

function escapeHumanControlCharacters(value: string): string {
  let out = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    const isControl =
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint === 0x2028 ||
      codePoint === 0x2029;
    out += isControl
      ? `\\x${codePoint.toString(16).padStart(codePoint > 0xff ? 4 : 2, "0")}`
      : character;
  }
  return out;
}

/** Renders the human output for `review index`. */
export function renderReviewIndexHuman(
  execution: ReviewIndexExecution,
): ReviewRenderedOutput {
  const { result } = execution;

  if (result.outcome === "usage-error") {
    return {
      stdout: "",
      stderr:
        "ERROR Invalid arguments\n" +
        "Usage: praxisbound review index <manifest> [--json]\n" +
        "       praxisbound review index --help\n",
    };
  }

  if (result.outcome !== "success") {
    const lines = [
      "PraxisBound Batch Review Source Index",
      "",
      `Result: ${result.outcome}`,
      "",
    ];
    for (const reported of result.issues) {
      lines.push(`FAIL ${escapeHumanControlCharacters(reported.message)}`);
    }
    return { stdout: `${lines.join("\n")}\n`, stderr: "" };
  }

  const data = result.data as
    | {
        readonly batchId: string;
        readonly fingerprint: string;
        readonly sources: readonly {
          readonly path: string;
          readonly sha256: string | null;
        }[];
        readonly diagnostics: readonly { readonly code: string }[];
      }
    | undefined;

  const lines = ["PraxisBound Batch Review Source Index", ""];
  if (data !== undefined) {
    lines.push(`Batch: ${data.batchId}`);
    lines.push(`Fingerprint: ${data.fingerprint}`);
    lines.push(`Sources: ${data.sources.length}`);
  }
  for (const reported of result.issues) {
    lines.push(
      `ISSUE ${reported.code}: ${escapeHumanControlCharacters(reported.message)}`,
    );
  }
  lines.push("", `Result: ${result.outcome}`, "");

  return { stdout: `${lines.join("\n")}\n`, stderr: "" };
}
