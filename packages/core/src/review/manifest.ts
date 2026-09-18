/**
 * Batch Manifest planning: validates the manifest against
 * `schemas/batch-manifest.schema.json` and contract §3 by hand (no schema
 * library; Story TST-021 Constraints), and resolves the declared source path
 * list. This module never touches a filesystem: it receives the manifest
 * path and bytes and returns a pure plan or a configuration error.
 */

import { readStoryId } from "../story-id.js";
import { sha256Hex } from "./fingerprint.js";
import {
  compareUtf8,
  escapeControlCharacters,
  isSyntacticallySafeRepoPath,
} from "./path.js";
import type {
  PlanReviewBatchResult,
  ReviewBatchPlan,
  ReviewBatchPlanDependency,
  ReviewBatchPlanRequirement,
  ReviewBatchStoryPlan,
  ReviewDiagnostic,
} from "./types.js";

const MANIFEST_MAX_BYTES = 1024 * 1024;
const MAX_NESTING_DEPTH = 32;
const MAX_STRING_LENGTH = 65536;
const MAX_ARRAY_ITEMS = 1000;
const MAX_SOURCES_PER_KIND = 200;
const PREFACE_MAX_BYTES = 4096;

const utf8Encoder = new TextEncoder();

const BATCH_ID_PATTERN =
  /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-[0-9]+(?:-[a-z0-9]+(?:-[a-z0-9]+)*)?$/;
const STORY_ID_PATTERN = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-[0-9]+$/;

function invalid(message: string, path?: string): PlanReviewBatchResult {
  return path === undefined
    ? { ok: false, code: "REVIEW_MANIFEST_INVALID", message }
    : { ok: false, code: "REVIEW_MANIFEST_INVALID", message, path };
}

function unsupportedSchema(message: string): PlanReviewBatchResult {
  return { ok: false, code: "REVIEW_SCHEMA_UNSUPPORTED", message };
}

function tooLarge(message: string): PlanReviewBatchResult {
  return { ok: false, code: "REVIEW_INPUT_TOO_LARGE", message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface LimitScan {
  readonly maxDepth: number;
  readonly stringTooLong: boolean;
}

/**
 * Walks the parsed manifest with an explicit stack rather than recursion, so
 * a pathologically deep (but under-the-byte-limit) document cannot overflow
 * the call stack; it bails out the moment the depth limit is exceeded rather
 * than walking the remainder of an oversized document.
 */
function scanLimits(root: unknown): LimitScan {
  let maxDepth = 0;
  let stringTooLong = false;
  const stack: { readonly value: unknown; readonly depth: number }[] = [
    { value: root, depth: 1 },
  ];

  while (stack.length > 0) {
    const frame = stack.pop() as { value: unknown; depth: number };
    if (frame.depth > maxDepth) maxDepth = frame.depth;
    if (maxDepth > MAX_NESTING_DEPTH) return { maxDepth, stringTooLong };

    if (typeof frame.value === "string") {
      if (frame.value.length > MAX_STRING_LENGTH) stringTooLong = true;
      continue;
    }
    if (Array.isArray(frame.value)) {
      for (const item of frame.value)
        stack.push({ value: item, depth: frame.depth + 1 });
      continue;
    }
    if (isRecord(frame.value)) {
      for (const item of Object.values(frame.value))
        stack.push({ value: item, depth: frame.depth + 1 });
    }
  }

  return { maxDepth, stringTooLong };
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function hasDuplicates(items: readonly string[]): boolean {
  return new Set(items).size !== items.length;
}

interface RawManifest {
  readonly batchId: string;
  readonly title: string | undefined;
  readonly preface: string | undefined;
  readonly adrs: readonly string[];
  readonly specs: readonly string[];
  readonly stories: readonly string[];
  readonly requirements: readonly ReviewBatchPlanRequirement[];
  readonly dependencies: readonly ReviewBatchPlanDependency[];
}

type ShapeResult =
  | { readonly ok: true; readonly manifest: RawManifest }
  | { readonly ok: false; readonly result: PlanReviewBatchResult };

function fail(result: PlanReviewBatchResult): ShapeResult {
  return { ok: false, result };
}

function readManifestShape(value: unknown): ShapeResult {
  if (!isRecord(value)) return fail(invalid("manifest is not a JSON object"));

  const allowedFields = new Set([
    "schemaVersion",
    "batchId",
    "title",
    "preface",
    "sources",
    "requirements",
    "dependencies",
  ]);
  for (const field of Object.keys(value)) {
    if (!allowedFields.has(field))
      return fail(invalid(`manifest declares an unknown field: ${field}`));
  }
  for (const field of [
    "schemaVersion",
    "batchId",
    "sources",
    "requirements",
    "dependencies",
  ]) {
    if (!(field in value))
      return fail(invalid(`manifest is missing required field: ${field}`));
  }

  if (typeof value.schemaVersion !== "string")
    return fail(invalid("manifest schemaVersion must be a string"));
  if (value.schemaVersion !== "1.0.0" && value.schemaVersion !== "1.1.0")
    return fail(
      unsupportedSchema(
        `unsupported manifest schemaVersion: ${value.schemaVersion}`,
      ),
    );

  if (
    typeof value.batchId !== "string" ||
    !BATCH_ID_PATTERN.test(value.batchId)
  )
    return fail(
      invalid("manifest batchId does not match the Story ID grammar"),
    );

  if (
    "title" in value &&
    (typeof value.title !== "string" || value.title.length > 256)
  )
    return fail(
      invalid("manifest title must be a string of at most 256 characters"),
    );

  if ("preface" in value) {
    if (value.schemaVersion !== "1.1.0")
      return fail(
        invalid("manifest preface is only allowed when schemaVersion is 1.1.0"),
      );
    if (typeof value.preface !== "string")
      return fail(invalid("manifest preface must be a string"));
    if (utf8Encoder.encode(value.preface).byteLength > PREFACE_MAX_BYTES)
      return fail(
        tooLarge(`manifest preface exceeds ${PREFACE_MAX_BYTES} bytes`),
      );
  }

  if (!isRecord(value.sources))
    return fail(invalid("manifest sources must be an object"));
  const sourcesAllowed = new Set(["adrs", "specs", "stories"]);
  for (const field of Object.keys(value.sources)) {
    if (!sourcesAllowed.has(field))
      return fail(
        invalid(`manifest sources declares an unknown field: ${field}`),
      );
  }
  for (const field of ["adrs", "specs", "stories"]) {
    if (!(field in value.sources))
      return fail(
        invalid(`manifest sources is missing required field: ${field}`),
      );
  }

  const adrs = value.sources.adrs;
  const specs = value.sources.specs;
  const stories = value.sources.stories;
  if (!isStringArray(adrs) || adrs.length > MAX_ARRAY_ITEMS)
    return fail(invalid("manifest sources.adrs must be an array of strings"));
  if (!isStringArray(specs) || specs.length > MAX_ARRAY_ITEMS)
    return fail(invalid("manifest sources.specs must be an array of strings"));
  if (
    !isStringArray(stories) ||
    stories.length === 0 ||
    stories.length > MAX_ARRAY_ITEMS
  )
    return fail(
      invalid("manifest sources.stories must be a non-empty array of strings"),
    );
  if (hasDuplicates(adrs) || hasDuplicates(specs) || hasDuplicates(stories))
    return fail(invalid("manifest sources arrays must not repeat a path"));

  if (
    !Array.isArray(value.requirements) ||
    value.requirements.length > MAX_ARRAY_ITEMS
  )
    return fail(invalid("manifest requirements must be an array"));
  const requirements: ReviewBatchPlanRequirement[] = [];
  for (const entry of value.requirements) {
    if (!isRecord(entry))
      return fail(invalid("manifest requirement entry must be an object"));
    const entryAllowed = new Set(["spec", "anchor", "stories"]);
    for (const field of Object.keys(entry)) {
      if (!entryAllowed.has(field))
        return fail(
          invalid(`manifest requirement declares an unknown field: ${field}`),
        );
    }
    if (
      typeof entry.spec !== "string" ||
      !isSyntacticallySafeRepoPath(entry.spec)
    )
      return fail(
        invalid(
          `manifest requirement.spec is not a safe repository-relative path: ${escapeControlCharacters(
            String(entry.spec),
          )}`,
        ),
      );
    if (
      typeof entry.anchor !== "string" ||
      entry.anchor.length === 0 ||
      entry.anchor.length > 1024
    )
      return fail(
        invalid("manifest requirement.anchor must be a non-empty string"),
      );
    if (!isStringArray(entry.stories) || entry.stories.length > MAX_ARRAY_ITEMS)
      return fail(
        invalid("manifest requirement.stories must be an array of strings"),
      );
    if (hasDuplicates(entry.stories))
      return fail(
        invalid("manifest requirement.stories must not repeat a Story ID"),
      );
    for (const storyId of entry.stories) {
      if (!STORY_ID_PATTERN.test(storyId))
        return fail(
          invalid(
            `manifest requirement.stories names an invalid Story ID: ${storyId}`,
          ),
        );
    }
    requirements.push({
      spec: entry.spec,
      anchor: entry.anchor,
      stories: entry.stories,
    });
  }

  if (
    !Array.isArray(value.dependencies) ||
    value.dependencies.length > MAX_ARRAY_ITEMS
  )
    return fail(invalid("manifest dependencies must be an array"));
  const dependencies: ReviewBatchPlanDependency[] = [];
  for (const entry of value.dependencies) {
    if (!isRecord(entry))
      return fail(invalid("manifest dependency entry must be an object"));
    const entryAllowed = new Set(["story", "dependsOn"]);
    for (const field of Object.keys(entry)) {
      if (!entryAllowed.has(field))
        return fail(
          invalid(`manifest dependency declares an unknown field: ${field}`),
        );
    }
    if (typeof entry.story !== "string" || !STORY_ID_PATTERN.test(entry.story))
      return fail(
        invalid("manifest dependency.story must be a valid Story ID"),
      );
    if (
      !isStringArray(entry.dependsOn) ||
      entry.dependsOn.length === 0 ||
      entry.dependsOn.length > MAX_ARRAY_ITEMS
    )
      return fail(
        invalid(
          "manifest dependency.dependsOn must be a non-empty array of strings",
        ),
      );
    if (hasDuplicates(entry.dependsOn))
      return fail(
        invalid("manifest dependency.dependsOn must not repeat a Story ID"),
      );
    for (const storyId of entry.dependsOn) {
      if (!STORY_ID_PATTERN.test(storyId))
        return fail(
          invalid(
            `manifest dependency.dependsOn names an invalid Story ID: ${storyId}`,
          ),
        );
    }
    dependencies.push({ story: entry.story, dependsOn: entry.dependsOn });
  }

  return {
    ok: true,
    manifest: {
      batchId: value.batchId,
      title: typeof value.title === "string" ? value.title : undefined,
      preface: typeof value.preface === "string" ? value.preface : undefined,
      adrs,
      specs,
      stories,
      requirements,
      dependencies,
    },
  };
}

const MANIFEST_PATH_PATTERN = /^specs\/batches\/([^/]+)\/batch\.json$/;

/**
 * Requires the manifest argument to resolve to the exact declared shape,
 * `specs/batches/<BATCH-ID>/batch.json`, relative to the repository root.
 */
export function readManifestDirectoryName(
  manifestPath: string,
): string | undefined {
  const match = MANIFEST_PATH_PATTERN.exec(manifestPath);
  return match === null ? undefined : match[1];
}

function diagnostic(
  code: string,
  severity: ReviewDiagnostic["severity"],
  message: string,
  path?: string,
): ReviewDiagnostic {
  return path === undefined
    ? { code, severity, message }
    : { code, severity, message, path };
}

/** Recognizes two declared paths that are equal, or where one names an ancestor directory of the other. */
function pathsOverlap(a: string, b: string): boolean {
  if (a === b) return true;
  return a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

/**
 * Validates one Batch Manifest and resolves its declared source path list.
 * Every path-syntax, schema, and limit violation contract §3 and §13 name
 * fails the plan outright; every remaining defect (duplicate Story ID,
 * unknown Story reference) is a diagnostic on the plan, per Story TST-021 R8.
 */
export function planReviewBatch(
  manifestPath: string,
  manifestBytes: Uint8Array,
): PlanReviewBatchResult {
  if (manifestBytes.byteLength > MANIFEST_MAX_BYTES) {
    return tooLarge(`manifest exceeds ${MANIFEST_MAX_BYTES} bytes`);
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes);
  } catch {
    return invalid("manifest is not valid UTF-8");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return invalid("manifest is not valid JSON");
  }

  const limits = scanLimits(parsed);
  if (limits.maxDepth > MAX_NESTING_DEPTH) {
    return tooLarge(`manifest nesting exceeds ${MAX_NESTING_DEPTH} levels`);
  }
  if (limits.stringTooLong) {
    return tooLarge(
      `manifest contains a string longer than ${MAX_STRING_LENGTH} bytes`,
    );
  }

  const shape = readManifestShape(parsed);
  if (!shape.ok) return shape.result;
  const manifest = shape.manifest;

  const directoryName = readManifestDirectoryName(manifestPath);
  if (directoryName === undefined) {
    return invalid(
      `manifest path does not have the shape specs/batches/<BATCH-ID>/batch.json: ${escapeControlCharacters(manifestPath)}`,
    );
  }
  if (manifest.batchId !== directoryName) {
    return invalid(
      `manifest batchId ${manifest.batchId} does not match its directory ${directoryName}`,
    );
  }

  if (
    manifest.adrs.length > MAX_SOURCES_PER_KIND ||
    manifest.specs.length > MAX_SOURCES_PER_KIND ||
    manifest.stories.length > MAX_SOURCES_PER_KIND
  ) {
    return tooLarge(
      `batch declares more than ${MAX_SOURCES_PER_KIND} sources of one kind`,
    );
  }

  const declaredPaths = [
    ...manifest.adrs,
    ...manifest.specs,
    ...manifest.stories,
  ];
  for (const path of declaredPaths) {
    if (!isSyntacticallySafeRepoPath(path)) {
      return invalid(
        `declared path is not a safe repository-relative path: ${escapeControlCharacters(path)}`,
      );
    }
  }

  // Any two declared paths that are equal, or where one is an ancestor
  // directory of the other (a Story directory overlapping a declared file,
  // or the same path declared under two source kinds), are rejected outright
  // rather than diagnosed, exactly like a same-kind duplicate path.
  for (let i = 0; i < declaredPaths.length; i += 1) {
    for (let j = i + 1; j < declaredPaths.length; j += 1) {
      const a = declaredPaths[i] as string;
      const b = declaredPaths[j] as string;
      if (pathsOverlap(a, b)) {
        return invalid(`declared paths overlap: ${a} and ${b}`);
      }
    }
  }

  const diagnostics: ReviewDiagnostic[] = [];

  const stories: ReviewBatchStoryPlan[] = manifest.stories.map((directory) => ({
    directory,
    storyId: readStoryId(directory),
    storyPath: `${directory}/story.md`,
    acceptancePath: `${directory}/acceptance.md`,
  }));

  for (const story of stories) {
    if (story.storyId === undefined)
      diagnostics.push(
        diagnostic(
          "REVIEW_MANIFEST_INVALID",
          "blocking",
          `Story directory does not name a Story ID: ${story.directory}`,
          story.directory,
        ),
      );
  }

  const storyIdGroups = new Map<string, string[]>();
  for (const story of stories) {
    if (story.storyId === undefined) continue;
    const group = storyIdGroups.get(story.storyId) ?? [];
    group.push(story.directory);
    storyIdGroups.set(story.storyId, group);
  }
  const ambiguousStoryIds: string[] = [];
  for (const [storyId, directories] of storyIdGroups) {
    if (directories.length > 1) {
      ambiguousStoryIds.push(storyId);
      diagnostics.push(
        diagnostic(
          "REVIEW_MANIFEST_INVALID",
          "blocking",
          `duplicate Story ID in manifest: ${storyId} (${directories.join(", ")})`,
        ),
      );
    }
  }

  const knownStoryIds = new Set(storyIdGroups.keys());
  for (const requirement of manifest.requirements) {
    if (!manifest.specs.includes(requirement.spec))
      diagnostics.push(
        diagnostic(
          "REVIEW_MANIFEST_INVALID",
          "blocking",
          `requirement names a Spec not declared in this batch: ${requirement.spec}`,
          requirement.spec,
        ),
      );
    for (const storyId of requirement.stories) {
      if (!knownStoryIds.has(storyId))
        diagnostics.push(
          diagnostic(
            "REVIEW_STORY_UNKNOWN",
            "blocking",
            `requirement for ${escapeControlCharacters(requirement.anchor)} references a Story not in the batch: ${storyId}`,
            requirement.spec,
          ),
        );
    }
  }
  for (const dependency of manifest.dependencies) {
    if (!knownStoryIds.has(dependency.story))
      diagnostics.push(
        diagnostic(
          "REVIEW_STORY_UNKNOWN",
          "blocking",
          `dependency declares a Story not in the batch: ${dependency.story}`,
        ),
      );
    for (const dependsOn of dependency.dependsOn) {
      if (!knownStoryIds.has(dependsOn))
        diagnostics.push(
          diagnostic(
            "REVIEW_STORY_UNKNOWN",
            "blocking",
            `dependency of ${dependency.story} references a Story not in the batch: ${dependsOn}`,
          ),
        );
    }
  }

  const sources = [
    ...manifest.adrs,
    ...manifest.specs,
    ...stories.flatMap((story) => [story.storyPath, story.acceptancePath]),
  ].sort(compareUtf8);

  const plan: ReviewBatchPlan = {
    batchId: manifest.batchId,
    title: manifest.title,
    preface: manifest.preface,
    manifestSha256: sha256Hex(manifestBytes),
    adrs: manifest.adrs,
    specs: manifest.specs,
    stories,
    requirements: manifest.requirements,
    dependencies: manifest.dependencies,
    sources,
    diagnostics,
    ambiguousStoryIds,
  };

  return { ok: true, plan };
}
