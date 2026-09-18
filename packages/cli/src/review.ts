import { constants } from "node:fs";
import { lstat, open, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";

import {
  IMPLEMENTED_PROTOCOL_VERSION,
  RESULT_SCHEMA_VERSION,
  indexReviewBatch,
  planReviewBatch,
  renderReviewProjection,
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
  readonly loaded?: LoadedReviewBatch;
}

interface LoadedReviewBatch {
  readonly manifestPath: string;
  readonly index: ReviewIndex;
  readonly observations: ReviewObservations;
}

/** Filesystem boundary kept injectable for deterministic publication-failure tests. */
interface ReviewRenderFilesystem {
  readonly rename: typeof rename;
}

const defaultReviewRenderFilesystem: ReviewRenderFilesystem = { rename };

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

export const reviewRenderHelp = `PraxisBound Batch Review Renderer

Usage:
  praxisbound review render <manifest> --output <file> [--json]
  praxisbound review render --help

Writes one self-contained offline HTML Review Projection from the declared
batch. It never changes a source, records approval, runs verification, or
starts an Agent. The output must remain inside the repository and cannot
replace a declared source, manifest, records path, or symlink.
`;

function issue(code: string, message: string, path?: string): ResultIssue {
  return path === undefined ? { code, message } : { code, message, path };
}

function envelope(
  status: "pass",
  outcome: "success",
  exit: 0,
  issues: readonly ResultIssue[],
  data?: Readonly<Record<string, ResultDataValue>>,
): ResultEnvelope;
function envelope(
  status: "fail",
  outcome: "failure",
  exit: 1,
  issues: readonly ResultIssue[],
  data?: Readonly<Record<string, ResultDataValue>>,
): ResultEnvelope;
function envelope(
  status: "error",
  outcome: "usage-error" | "configuration-error" | "ERROR",
  exit: 2 | 3,
  issues: readonly ResultIssue[],
  data?: Readonly<Record<string, ResultDataValue>>,
): ResultEnvelope;
function envelope(
  status: "pass" | "fail" | "error",
  outcome:
    "success" | "failure" | "usage-error" | "configuration-error" | "ERROR",
  exit: 0 | 1 | 2 | 3,
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

function parseIndexArguments(args: readonly string[]): {
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

function parseRenderArguments(args: readonly string[]): {
  readonly mode: ReviewOutputMode;
  readonly manifest: string | undefined;
  readonly output: string | undefined;
  readonly valid: boolean;
} {
  let mode: ReviewOutputMode = "human";
  let manifest: string | undefined;
  let output: string | undefined;
  let valid = true;

  for (let position = 0; position < args.length; position += 1) {
    const token = args[position];
    if (token === undefined) {
      valid = false;
      continue;
    }
    if (token === "--json" && mode === "human") {
      mode = "json";
      continue;
    }
    if (token === "--output" && output === undefined) {
      output = args[position + 1];
      position += 1;
      if (output === undefined || output.startsWith("-")) valid = false;
      continue;
    }
    if (manifest === undefined && !token.startsWith("-")) {
      manifest = token;
      continue;
    }
    valid = false;
  }

  return {
    mode,
    manifest,
    output,
    valid: valid && manifest !== undefined && output !== undefined,
  };
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
  const parsed = parseIndexArguments(args);
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

  return {
    mode: parsed.mode,
    result: buildSuccessEnvelope(indexed.index),
    loaded: {
      manifestPath: resolved.relativePath,
      index: indexed.index,
      observations: observations as ReviewObservations,
    },
  };
}

function resolveOutputPath(
  root: string,
  outputArgument: string,
):
  | {
      readonly ok: true;
      readonly absolute: string;
      readonly relativePath: string;
    }
  | { readonly ok: false } {
  const absolute = isAbsolute(outputArgument)
    ? outputArgument
    : resolve(root, outputArgument);
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

function isOutputConflict(
  outputPath: string,
  manifestPath: string,
  sources: readonly { readonly path: string }[],
): boolean {
  if (outputPath === manifestPath) return true;
  if (sources.some((source) => source.path === outputPath)) return true;
  const recordsPath = `${dirname(manifestPath).split("\\").join("/")}/records`;
  return outputPath === recordsPath || outputPath.startsWith(`${recordsPath}/`);
}

/**
 * Compares the existing destination inode to protected files. This catches
 * hard links and case-folded aliases that lexical repository paths cannot
 * distinguish on a case-insensitive filesystem.
 */
async function isProtectedOutputAlias(
  root: string,
  outputAbsolute: string,
  protectedPaths: readonly string[],
): Promise<boolean> {
  let outputStats;
  try {
    outputStats = await lstat(outputAbsolute);
  } catch {
    return false;
  }
  if (outputStats.isSymbolicLink()) return true;
  for (const path of protectedPaths) {
    try {
      const protectedStats = await lstat(resolve(root, path));
      if (
        protectedStats.dev === outputStats.dev &&
        protectedStats.ino === outputStats.ino
      )
        return true;
    } catch {
      // Missing draft sources are already represented as diagnostics.
    }
  }
  return false;
}

async function publishProjection(
  root: string,
  output: { readonly absolute: string; readonly relativePath: string },
  html: string,
  protectedPaths: readonly string[],
  filesystem: ReviewRenderFilesystem,
): Promise<"success" | "conflict" | "failure"> {
  const outputDirectory = dirname(output.absolute);
  const stage = resolve(
    outputDirectory,
    `.${basename(output.absolute)}.${randomUUID()}.tmp`,
  );
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
    await handle.writeFile(html, "utf8");
    await handle.close();
    handle = undefined;

    if ((await findUnsafeSourcePath(root, [output.relativePath])) !== undefined)
      return "conflict";
    if (await isProtectedOutputAlias(root, output.absolute, protectedPaths))
      return "conflict";

    await filesystem.rename(stage, output.absolute);
    renamed = true;
    return "success";
  } catch {
    return "failure";
  } finally {
    if (handle !== undefined) await handle.close().catch(() => undefined);
    if (!renamed) await unlink(stage).catch(() => undefined);
  }
}

function buildRenderSuccessEnvelope(
  index: ReviewIndex,
  output: string,
): ResultEnvelope {
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
    output,
  });
}

/** Runs `praxisbound review render <manifest> --output <file>`. */
export async function runReviewRender(
  args: readonly string[],
  root: string = process.cwd(),
  filesystem: ReviewRenderFilesystem = defaultReviewRenderFilesystem,
): Promise<ReviewIndexExecution> {
  const parsed = parseRenderArguments(args);
  if (
    !parsed.valid ||
    parsed.manifest === undefined ||
    parsed.output === undefined
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

    const output = resolveOutputPath(root, parsed.output);
    if (!output.ok) {
      return {
        mode: parsed.mode,
        result: envelope("error", "configuration-error", 2, [
          issue(
            "REVIEW_OUTPUT_CONFLICT",
            "output path resolves outside the repository root",
          ),
        ]),
      };
    }
    if (
      isOutputConflict(
        output.relativePath,
        loaded.loaded.manifestPath,
        loaded.loaded.index.sources,
      ) ||
      (await findUnsafeSourcePath(root, [output.relativePath])) !== undefined ||
      (await isProtectedOutputAlias(root, output.absolute, [
        loaded.loaded.manifestPath,
        ...loaded.loaded.index.sources.map((source) => source.path),
      ]))
    ) {
      return {
        mode: parsed.mode,
        result: envelope("error", "configuration-error", 2, [
          issue(
            "REVIEW_OUTPUT_CONFLICT",
            "output path conflicts with batch data",
          ),
        ]),
      };
    }

    const documents = loaded.loaded.index.sources.map((source) => {
      const observation = loaded.loaded?.observations.get(source.path);
      return {
        path: source.path,
        bytes: observation?.kind === "file" ? observation.bytes : undefined,
      };
    });
    const html = renderReviewProjection(loaded.loaded.index, documents);
    const publication = await publishProjection(
      root,
      output,
      html,
      [
        loaded.loaded.manifestPath,
        ...loaded.loaded.index.sources.map((source) => source.path),
      ],
      filesystem,
    );
    if (publication === "conflict") {
      return {
        mode: parsed.mode,
        result: envelope("error", "configuration-error", 2, [
          issue(
            "REVIEW_OUTPUT_CONFLICT",
            "output path conflicts with batch data",
          ),
        ]),
      };
    }
    if (publication === "failure") {
      return {
        mode: parsed.mode,
        result: envelope("fail", "failure", 1, [
          issue(
            "REVIEW_OUTPUT_WRITE_FAILED",
            "unable to publish review output",
          ),
        ]),
      };
    }
    return {
      mode: parsed.mode,
      result: buildRenderSuccessEnvelope(
        loaded.loaded.index,
        output.relativePath,
      ),
    };
  } catch {
    process.stderr.write("praxisbound review render: internal error\n");
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

/** Renders the human output for `review render`. */
export function renderReviewRenderHuman(
  execution: ReviewIndexExecution,
): ReviewRenderedOutput {
  const { result } = execution;
  if (result.outcome === "usage-error") {
    return {
      stdout: "",
      stderr:
        "ERROR Invalid arguments\n" +
        "Usage: praxisbound review render <manifest> --output <file> [--json]\n" +
        "       praxisbound review render --help\n",
    };
  }
  if (result.outcome !== "success") {
    return {
      stdout: `PraxisBound Batch Review Renderer\n\nResult: ${result.outcome}\n`,
      stderr: `${result.issues.map((reported) => `FAIL ${reported.code}`).join("\n")}\n`,
    };
  }
  const data = result.data as
    | {
        readonly batchId: string;
        readonly fingerprint: string;
        readonly output: string;
      }
    | undefined;
  const lines = ["PraxisBound Batch Review Renderer", ""];
  if (data !== undefined) {
    lines.push(`Batch: ${data.batchId}`);
    lines.push(`Fingerprint: ${data.fingerprint}`);
    lines.push(`Output: ${data.output}`);
  }
  lines.push("", "Result: success", "");
  return { stdout: `${lines.join("\n")}\n`, stderr: "" };
}
