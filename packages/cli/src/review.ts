import { constants, realpathSync } from "node:fs";
import {
  lstat,
  open,
  readdir,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import {
  IMPLEMENTED_PROTOCOL_VERSION,
  RESULT_SCHEMA_VERSION,
  escapeHiddenCharacters,
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

import { loadReviewConfirmationApplicability } from "./review-confirmation-records.js";
import { loadReviewEvidence } from "./review-evidence.js";
import { findUnsafeSourcePath } from "./review-paths.js";
import { loadRecordsListingState, recordsDirectory } from "./review-records.js";

export type ReviewOutputMode = "human" | "json";

export interface ReviewIndexExecution {
  readonly mode: ReviewOutputMode;
  readonly result: ResultEnvelope;
  readonly loaded?: LoadedReviewBatch;
}

export interface LoadedReviewBatch {
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

export function issue(
  code: string,
  message: string,
  path?: string,
): ResultIssue {
  return path === undefined ? { code, message } : { code, message, path };
}

export function envelope(
  status: "pass",
  outcome: "success",
  exit: 0,
  issues: readonly ResultIssue[],
  data?: Readonly<Record<string, ResultDataValue>>,
): ResultEnvelope;
export function envelope(
  status: "fail",
  outcome: "failure",
  exit: 1,
  issues: readonly ResultIssue[],
  data?: Readonly<Record<string, ResultDataValue>>,
): ResultEnvelope;
export function envelope(
  status: "error",
  outcome: "usage-error" | "configuration-error" | "ERROR",
  exit: 2 | 3,
  issues: readonly ResultIssue[],
  data?: Readonly<Record<string, ResultDataValue>>,
): ResultEnvelope;
export function envelope(
  status: "pass",
  outcome: "REVIEW_READY",
  exit: 0,
  issues: readonly ResultIssue[],
  data?: Readonly<Record<string, ResultDataValue>>,
): ResultEnvelope;
export function envelope(
  status: "fail",
  outcome: "REVIEW_BLOCKED" | "REVIEW_INCOMPLETE" | "REVIEW_STALE",
  exit: 1,
  issues: readonly ResultIssue[],
  data?: Readonly<Record<string, ResultDataValue>>,
): ResultEnvelope;
export function envelope(
  status: "pass" | "fail" | "error",
  outcome:
    | "success"
    | "failure"
    | "usage-error"
    | "configuration-error"
    | "ERROR"
    | "REVIEW_READY"
    | "REVIEW_BLOCKED"
    | "REVIEW_INCOMPLETE"
    | "REVIEW_STALE",
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
  // Security C1: always resolve, unconditionally, even when the argument is
  // already absolute — an un-normalized absolute path (e.g. one containing
  // a `link/../` segment through a symlink) must never reach `open()`
  // while a *different*, lexically normalized path is what the safety
  // check below judged.
  const absolute = resolve(root, manifestArgument);
  const relativePath = relative(root, absolute).split("\\").join("/");
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith("../") ||
    isAbsolute(relativePath)
  ) {
    return { ok: false };
  }
  return { ok: true, absolute, relativePath };
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

/** `true` only for "the path does not exist" (ENOENT); every other failure (EACCES and similar) is a distinct, present-but-unreadable condition. */
function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

/**
 * Reads one source without ever following a symlink swapped in after the
 * safety pre-check: the handle is opened with `O_NOFOLLOW` and revalidated
 * before the read, exactly like Story's `readSafeSource`. MEDIUM (Story
 * TST-030): a path that exists but cannot be read (permission denied, a
 * directory in a file's place, or a lost race) is `unreadable`, distinct
 * from a genuinely absent (`missing`, ENOENT) one — every declared source
 * already treats the two identically (`REVIEW_SOURCE_MISSING`), but a
 * Readiness Sidecar must not count an `unreadable` one as absent (contract
 * §21 R1).
 */
async function readSourceObservation(
  root: string,
  path: string,
): Promise<SourceObservation> {
  const absolute = resolve(root, path);
  let pathStats;
  try {
    pathStats = await lstat(absolute);
  } catch (error) {
    return isNotFoundError(error)
      ? { kind: "missing" }
      : { kind: "unreadable" };
  }
  if (pathStats.isSymbolicLink()) return { kind: "unsafe" };
  if (!pathStats.isFile()) return { kind: "unreadable" };

  let handle;
  try {
    handle = await open(
      absolute,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch (error) {
    return isNotFoundError(error)
      ? { kind: "missing" }
      : { kind: "unreadable" };
  }

  try {
    const openedStats = await handle.stat();
    if (!openedStats.isFile()) return { kind: "unreadable" };
    const bytes = await handle.readFile();
    return { kind: "file", bytes };
  } catch {
    return { kind: "unreadable" };
  } finally {
    await handle.close().catch(() => undefined);
  }
}

export function toDataValue(value: unknown): ResultDataValue {
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

/**
 * One safe stderr line for an unexpected failure: the repository root (as
 * given and resolved) becomes `<root>` so no absolute path leaks, only the
 * first line is kept, and every remaining control character is escaped so a
 * message can never inject terminal escape sequences.
 */
export function sanitizeInternalError(error: unknown, root: string): string {
  const message = error instanceof Error ? error.message : String(error);
  const resolvedRoot = resolve(root);
  let realRoot: string | undefined;
  try {
    realRoot = realpathSync(resolvedRoot);
  } catch {
    realRoot = undefined;
  }
  const roots = [
    ...new Set(
      [root, resolvedRoot, realRoot].filter(
        (candidate): candidate is string => candidate !== undefined,
      ),
    ),
  ]
    .filter((candidate) => candidate.length > 1)
    .sort((a, b) => b.length - a.length);
  const relative = roots.reduce(
    (text, candidate) => text.split(candidate).join("<root>"),
    message,
  );
  const oneLine = relative.split("\n")[0] ?? "unexpected internal failure";
  const bounded =
    oneLine.length > 200 ? `${oneLine.slice(0, 200)}...` : oneLine;
  return escapeHumanControlCharacters(bounded);
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
      `praxisbound review index: internal error: ${sanitizeInternalError(error, root)}\n`,
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

export async function runReviewIndexUnsafe(
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
      // TOCTOU (M1): the fresh `lstat` above already ran before this open;
      // re-comparing its identity against what actually got opened closes
      // the window where the path changed in between.
      if (
        openedStats.dev !== manifestStats.dev ||
        openedStats.ino !== manifestStats.ino
      )
        throw new Error("manifest identity changed between check and open");
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

  // A Readiness Sidecar (Story TST-030, contract §21) is not a manifest-
  // declared source, so its path is gathered separately from `plan.sources`;
  // its presence is decided later, from `observations`, by `indexReviewBatch`
  // itself (R1: absent is not missing). Its path segments (including the
  // Story directory) are checked for a symlink the same way every other
  // declared path is (R7).
  const readinessPaths = plan.plan.stories.map((story) => story.readinessPath);

  const unsafePath = await findUnsafeSourcePath(root, [
    ...plan.plan.sources,
    ...readinessPaths,
  ]);
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

  // HIGH-3: a Readiness Sidecar is exempt from this generic per-source cap.
  // Contract §13/§21's own, tighter 1 MiB bound is Core's own check on its
  // bytes (`parseReadinessSidecar`), applied only where the Sidecar's
  // content is actually evaluated (`review preflight`/`review
  // readiness-digests`) — never an `index`/`render`-time hard failure.
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
  for (const path of [...plan.plan.sources, ...readinessPaths]) {
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
  // Security C1 (same fix as `resolveManifestPath`): always resolve,
  // unconditionally, even when the argument is already absolute.
  const absolute = resolve(root, outputArgument);
  const relativePath = relative(root, absolute).split("\\").join("/");
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith("../") ||
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

/** The realpath of `target`, or of its deepest existing ancestor when `target` itself does not exist yet. */
async function realpathOfDeepestExistingAncestor(
  target: string,
): Promise<string | undefined> {
  let current = target;
  for (;;) {
    try {
      return await realpath(current);
    } catch {
      const parent = dirname(current);
      if (parent === current) return undefined;
      current = parent;
    }
  }
}

/** Every regular file under `directory`, recursively, as absolute paths; empty when `directory` does not exist. */
async function listFilesRecursively(
  directory: string,
): Promise<readonly string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFilesRecursively(full)));
    else files.push(full);
  }
  return files;
}

/**
 * True when `outputAbsolute` would land inside the batch `records/`
 * directory, resolved by real filesystem identity rather than lexical path
 * comparison: a case-folded or otherwise differently-spelled path that
 * `isOutputConflict`'s string comparison cannot catch still resolves to the
 * same real parent directory on a case-insensitive filesystem, and an
 * existing destination that hard-links or aliases a file already inside
 * `records/` is caught by dev+ino even when no path segment matches at all.
 */
async function isRecordsDirectoryConflict(
  root: string,
  outputAbsolute: string,
  manifestPath: string,
): Promise<boolean> {
  const recordsAbsolute = resolve(root, dirname(manifestPath), "records");
  let recordsReal: string | undefined;
  try {
    recordsReal = await realpath(recordsAbsolute);
  } catch {
    recordsReal = undefined;
  }
  if (recordsReal !== undefined) {
    const ancestorReal = await realpathOfDeepestExistingAncestor(
      dirname(outputAbsolute),
    );
    if (
      ancestorReal === recordsReal ||
      (ancestorReal !== undefined &&
        ancestorReal.startsWith(`${recordsReal}${sep}`))
    )
      return true;
  }

  if (recordsReal === undefined) return false;
  let outputStats;
  try {
    outputStats = await lstat(outputAbsolute);
  } catch {
    return false;
  }
  for (const file of await listFilesRecursively(recordsReal)) {
    try {
      const stats = await lstat(file);
      if (stats.dev === outputStats.dev && stats.ino === outputStats.ino)
        return true;
    } catch {
      // A record that disappeared mid-check is not an alias to guard.
    }
  }
  return false;
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
  manifestPath: string,
  filesystem: ReviewRenderFilesystem,
): Promise<"success" | "conflict" | "missing-directory" | "failure"> {
  const outputDirectory = dirname(output.absolute);
  const stage = resolve(
    outputDirectory,
    `.${basename(output.absolute)}.${randomUUID()}.tmp`,
  );
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let renamed = false;
  let staged = false;
  try {
    handle = await open(
      stage,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    staged = true;
    await handle.writeFile(html, "utf8");
    await handle.close();
    handle = undefined;

    if ((await findUnsafeSourcePath(root, [output.relativePath])) !== undefined)
      return "conflict";
    if (await isProtectedOutputAlias(root, output.absolute, protectedPaths))
      return "conflict";
    if (await isRecordsDirectoryConflict(root, output.absolute, manifestPath))
      return "conflict";

    await filesystem.rename(stage, output.absolute);
    renamed = true;
    return "success";
  } catch (error) {
    // Only the staging open can report the parent directory as absent.
    const code = (error as NodeJS.ErrnoException).code;
    if (!staged && (code === "ENOENT" || code === "ENOTDIR"))
      return "missing-directory";
    return "failure";
  } finally {
    if (handle !== undefined) await handle.close().catch(() => undefined);
    if (!renamed) await unlink(stage).catch(() => undefined);
  }
}

export interface ExtraRenderIssue {
  readonly issue: ResultIssue;
  /** An invalid/over-limit record is always blocking; a confirmation staleness diagnostic (contract §8 修訂，R-006) is advisory — it never blocks a `render`. */
  readonly severity: "blocking" | "advisory";
}

function buildRenderSuccessEnvelope(
  index: ReviewIndex,
  output: string,
  extraIssues: readonly ExtraRenderIssue[] = [],
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
  // Evidence-area and confirmation-staleness diagnostics are appended after
  // the index's own, in the same relative order in `issues[]` and
  // `data.diagnostics[]` (matching how `review import`'s extra diagnostics
  // are appended, `buildImportSuccessEnvelope`).
  const extraDiagnostics = extraIssues.map((entry) => ({
    code: entry.issue.code,
    severity: entry.severity,
  }));
  return envelope(
    "pass",
    "success",
    0,
    [...issues, ...extraIssues.map((entry) => entry.issue)],
    {
      batchId: index.batchId,
      fingerprint: index.fingerprint,
      sources: toDataValue(index.sources),
      diagnostics: toDataValue([...diagnostics, ...extraDiagnostics]),
      output,
    },
  );
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
      ])) ||
      (await isRecordsDirectoryConflict(
        root,
        output.absolute,
        loaded.loaded.manifestPath,
      ))
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
    // One shared `records/` safety check and listing for every reader below
    // (contract §20, §8 修訂，R-006): `index` never reads `records/` at all,
    // and a symlinked or unlistable `records/` must produce exactly one
    // diagnostic, not one per reader (Story TST-026 review round 1).
    const listingState = await loadRecordsListingState(
      root,
      loaded.loaded.manifestPath,
    );
    const listingStateIssues: ExtraRenderIssue[] = [];
    if (listingState.unsafe) {
      listingStateIssues.push({
        issue: issue(
          "REVIEW_PATH_UNSAFE",
          "records path has a symlinked segment",
          recordsDirectory(loaded.loaded.manifestPath),
        ),
        severity: "blocking",
      });
    } else if (
      !listingState.listing.ok &&
      listingState.listing.reason === "error"
    ) {
      listingStateIssues.push({
        issue: issue(
          "REVIEW_RECORD_INVALID",
          "unable to read the records directory",
          recordsDirectory(loaded.loaded.manifestPath),
        ),
        severity: "blocking",
      });
    }
    // `index` never reads `records/` (contract §20); only `render` builds
    // the evidence area, from validated revision/response records alone.
    const { evidence, extraIssues } = await loadReviewEvidence(
      root,
      loaded.loaded.manifestPath,
      loaded.loaded.index.batchId,
      listingState,
    );
    // Confirmation applicability/staleness (contract §8 修訂，R-006) uses its
    // own separate 200-file/16 MiB bound and is `render`-only, like the
    // evidence area; `review index` never reads `records/`.
    const confirmationLoad = await loadReviewConfirmationApplicability(
      root,
      loaded.loaded.manifestPath,
      loaded.loaded.index,
      listingState,
    );
    const html = renderReviewProjection(
      loaded.loaded.index,
      documents,
      loaded.loaded.manifestPath,
      evidence,
      confirmationLoad.applicability,
    );
    const publication = await publishProjection(
      root,
      output,
      html,
      [
        loaded.loaded.manifestPath,
        ...loaded.loaded.index.sources.map((source) => source.path),
      ],
      loaded.loaded.manifestPath,
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
    if (publication === "missing-directory") {
      return {
        mode: parsed.mode,
        result: envelope("fail", "failure", 1, [
          issue(
            "REVIEW_OUTPUT_WRITE_FAILED",
            "output directory does not exist",
            dirname(output.relativePath).split("\\").join("/"),
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
        [
          ...listingStateIssues,
          ...extraIssues.map((entry) => ({
            issue: entry,
            severity: "blocking" as const,
          })),
          ...confirmationLoad.blockingIssues.map((entry) => ({
            issue: entry,
            severity: "blocking" as const,
          })),
          ...confirmationLoad.advisoryIssues.map((entry) => ({
            issue: entry,
            severity: "advisory" as const,
          })),
        ],
      ),
    };
  } catch (error) {
    // The cause is never discarded: a sanitized, single-line rendering of it
    // always reaches stderr, even in JSON mode; the envelope's own issue
    // message stays generic and never exposes an absolute path.
    process.stderr.write(
      `praxisbound review render: internal error: ${sanitizeInternalError(error, root)}\n`,
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

/**
 * Untrusted text (a revision id, an issue message assembled from input) is
 * never rendered to a human terminal without this escape — Core's
 * `escapeHiddenCharacters`, the one definition also used by the Review
 * Projection's evidence area for its own (HTML-free) messages, so every
 * place escapes exactly the same characters.
 */
export const escapeHumanControlCharacters = escapeHiddenCharacters;

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

function formatRenderFailure(reported: ResultIssue): string {
  const location =
    reported.path === undefined
      ? ""
      : ` (${escapeHumanControlCharacters(reported.path)})`;
  return `FAIL ${reported.code}: ${escapeHumanControlCharacters(reported.message)}${location}`;
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
      stderr: `${result.issues.map(formatRenderFailure).join("\n")}\n`,
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
  // A successful render can still carry diagnostics — an unmapped
  // requirement, a missing source, or (contract §20) an invalid or
  // over-limit evidence record — printed the same way `review index`
  // already prints its own on a successful result.
  for (const reported of result.issues) {
    const location =
      reported.path === undefined
        ? ""
        : ` (${escapeHumanControlCharacters(reported.path)})`;
    lines.push(
      `ISSUE ${reported.code}: ${escapeHumanControlCharacters(reported.message)}${location}`,
    );
  }
  lines.push("", "Result: success", "");
  return { stdout: `${lines.join("\n")}\n`, stderr: "" };
}
