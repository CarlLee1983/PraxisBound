/**
 * Pure Goal Plan Declaration, Goal Plan Manifest, and Plan Coverage Review
 * artifacts in the shape ForgePilot's `goal preflight` consumes
 * (`specs/features/batch-review/schemas/goal-plan/`).
 *
 * The functions in this module receive raw bytes and caller-owned source
 * facts. They do not read a filesystem, process, clock, or network, and they
 * never reserialize a candidate artifact while validating it. JSON is decoded
 * only to inspect the declared shape; every integrity decision hashes the
 * bytes supplied by the caller. Artifact text — a reviewer name, a `storyRef`,
 * or any other field — is data; it never changes a validation result (Story
 * TST-029 R5).
 */

import { sha256Hex } from "./review/fingerprint.js";
import { compareUtf8 } from "./review/path.js";

/** The only Goal Plan artifact schema version this module supports. */
export const GOAL_PLAN_SCHEMA_VERSION = "1.0.0" as const;

export type GoalPlanArtifactClass =
  "goal-plan-declaration" | "goal-plan-manifest" | "plan-coverage-review";

/** Stable public categories for rejected artifact input. */
export type GoalPlanFailureCategory =
  | "unsupported-schema"
  | "malformed-artifact"
  | "invalid-topology"
  | "digest-mismatch"
  | "approval-binding-mismatch";

export interface PlanIdentity {
  readonly id: string;
  readonly revision: number;
}

export interface CoverageIndex {
  readonly batchId: string;
  readonly fingerprint: string;
}

export interface GoalPlanSourceDigest {
  readonly path: string;
  readonly sha256: string;
}

export interface GoalPlanDeclarationNode {
  readonly nodeRef: string;
  readonly storyRef: string;
  readonly dependsOn: readonly string[];
}

export interface GoalPlanDeclaration {
  readonly schemaVersion: typeof GOAL_PLAN_SCHEMA_VERSION;
  readonly plan: PlanIdentity;
  readonly nodes: readonly GoalPlanDeclarationNode[];
}

export interface GoalPlanManifestNode {
  readonly nodeRef: string;
  readonly storyRef: string;
  readonly readinessContract: GoalPlanSourceDigest;
  readonly dependsOn: readonly string[];
}

export interface GoalPlanManifest {
  readonly schemaVersion: typeof GOAL_PLAN_SCHEMA_VERSION;
  readonly plan: PlanIdentity;
  readonly declaration: GoalPlanSourceDigest;
  readonly nodes: readonly GoalPlanManifestNode[];
  readonly reviewedSources: readonly GoalPlanSourceDigest[];
  readonly coverageIndex: CoverageIndex;
}

export interface PlanCoverageReviewer {
  readonly name: string;
  readonly assurance: "self-asserted";
}

export interface PlanCoverageReview {
  readonly schemaVersion: typeof GOAL_PLAN_SCHEMA_VERSION;
  readonly reviewId: string;
  readonly manifestSha256: string;
  readonly reviewedSources: readonly GoalPlanSourceDigest[];
  readonly coverageIndex: CoverageIndex;
  readonly conclusion: "approved";
  readonly reviewer: PlanCoverageReviewer;
  readonly reviewedAt: string;
}

/** A repository-relative path and the exact bytes it names. */
export interface GoalPlanSourceBytes {
  readonly path: string;
  readonly bytes: Uint8Array;
}

/** Caller-owned source facts accepted by the validators and exporters. */
export type GoalPlanSourceFacts =
  | ReadonlyMap<string, Uint8Array>
  | readonly GoalPlanSourceBytes[]
  | Readonly<Record<string, Uint8Array>>;

export interface GoalPlanDeclarationExportInput {
  readonly planId: string;
  readonly revision: number;
  readonly nodes: readonly {
    readonly nodeRef: string;
    readonly storyRef: string;
    readonly dependsOn: readonly string[];
  }[];
}

export interface GoalPlanManifestExportInput {
  readonly planId: string;
  readonly revision: number;
  readonly declaration: GoalPlanSourceBytes;
  readonly nodes: readonly {
    readonly nodeRef: string;
    readonly storyRef: string;
    readonly readiness: GoalPlanSourceBytes;
    readonly dependsOn: readonly string[];
  }[];
  readonly reviewedSources: readonly GoalPlanSourceBytes[];
  readonly coverageIndex: CoverageIndex;
}

export interface PlanCoverageReviewExportInput {
  readonly manifestBytes: Uint8Array;
  readonly reviewId: string;
  readonly conclusion: "approved";
  readonly reviewer: PlanCoverageReviewer;
  readonly reviewedAt: string;
  /** Raw integrity facts for the Manifest's declaration, readiness, and reviewed sources. */
  readonly sources: GoalPlanSourceFacts;
}

export interface GoalPlanValidationFailure {
  readonly ok: false;
  readonly artifact: GoalPlanArtifactClass;
  readonly category: GoalPlanFailureCategory;
  readonly message: string;
  readonly path?: string;
  readonly expected?: string;
  readonly observed?: string;
  /** A referenced artifact's failure category preserved for diagnostics. */
  readonly causeCategory?: GoalPlanFailureCategory;
}

export interface GoalPlanDeclarationValidationSuccess {
  readonly ok: true;
  readonly artifact: "goal-plan-declaration";
  readonly declaration: GoalPlanDeclaration;
  readonly declarationDigest: string;
}

export interface GoalPlanManifestValidationSuccess {
  readonly ok: true;
  readonly artifact: "goal-plan-manifest";
  readonly manifest: GoalPlanManifest;
  readonly manifestDigest: string;
}

export interface PlanCoverageReviewValidationSuccess {
  readonly ok: true;
  readonly artifact: "plan-coverage-review";
  readonly review: PlanCoverageReview;
  readonly reviewDigest: string;
  readonly manifestDigest: string;
}

export type GoalPlanDeclarationValidation =
  GoalPlanDeclarationValidationSuccess | GoalPlanValidationFailure;

export type GoalPlanManifestValidation =
  GoalPlanManifestValidationSuccess | GoalPlanValidationFailure;

export type PlanCoverageReviewValidation =
  PlanCoverageReviewValidationSuccess | GoalPlanValidationFailure;

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const BATCH_ID_PATTERN =
  /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-[0-9]+(?:-[a-z0-9]+(?:-[a-z0-9]+)*)?$/;
const PLAN_OR_NODE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
// Copied verbatim from schemas/goal-plan/goal-plan-defs.schema.json `repoPath`.
// The excluded control/format/bidi ranges are deliberate (repoPath schema pattern).
/* eslint-disable no-control-regex */
const REPO_PATH_PATTERN =
  /^(?!\/)(?![A-Za-z]:)(?!.*(?:^|\/)\.\.?(?:\/|$))(?!.*\/\/)(?!.*\/$)(?!.*\\)(?!.*[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]).+$/;
const REVIEW_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
// The excluded control/format/bidi ranges are deliberate (reviewer.name schema pattern).
const REVIEWER_NAME_PATTERN =
  /^(?!.*[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff])\S(?:[\s\S]*\S)?$/;
/* eslint-enable no-control-regex */
const REVIEWED_AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const MAX_NODES = 1000;
const MAX_DEPENDS_ON = 1000;
const MAX_REVIEWED_SOURCES = 4000;
const MAX_REPO_PATH_LENGTH = 1024;
const MAX_BATCH_ID_LENGTH = 128;
const MAX_REVIEWER_NAME_LENGTH = 256;
/** Bound untrusted JSON before parsing opaque node metadata and review data. */
const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;
const MAX_JSON_DEPTH = 128;

type JsonRecord = Record<string, unknown>;

interface ParsedJson {
  readonly ok: true;
  readonly value: unknown;
}

interface ParsedJsonFailure {
  readonly ok: false;
  readonly message: string;
}

type ParsedJsonResult = ParsedJson | ParsedJsonFailure;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failure(
  artifact: GoalPlanArtifactClass,
  category: GoalPlanFailureCategory,
  message: string,
  options: {
    readonly path?: string;
    readonly expected?: string;
    readonly observed?: string;
    readonly causeCategory?: GoalPlanFailureCategory;
  } = {},
): GoalPlanValidationFailure {
  const result: {
    ok: false;
    artifact: GoalPlanArtifactClass;
    category: GoalPlanFailureCategory;
    message: string;
    path?: string;
    expected?: string;
    observed?: string;
    causeCategory?: GoalPlanFailureCategory;
  } = { ok: false, artifact, category, message };
  if (options.path !== undefined) result.path = options.path;
  if (options.expected !== undefined) result.expected = options.expected;
  if (options.observed !== undefined) result.observed = options.observed;
  if (options.causeCategory !== undefined)
    result.causeCategory = options.causeCategory;
  return result;
}

function exportFailure(
  message: string,
  category: GoalPlanFailureCategory,
  causeCategory?: GoalPlanFailureCategory,
): TypeError {
  const error = new TypeError(message);
  Object.defineProperty(error, "category", {
    configurable: false,
    enumerable: true,
    value: category,
    writable: false,
  });
  if (causeCategory !== undefined)
    Object.defineProperty(error, "causeCategory", {
      configurable: false,
      enumerable: true,
      value: causeCategory,
      writable: false,
    });
  return error;
}

function isFailureCategory(value: unknown): value is GoalPlanFailureCategory {
  return (
    value === "unsupported-schema" ||
    value === "malformed-artifact" ||
    value === "invalid-topology" ||
    value === "digest-mismatch" ||
    value === "approval-binding-mismatch"
  );
}

function exportBoundaryFailure(
  error: unknown,
  artifact: GoalPlanArtifactClass,
): TypeError {
  try {
    if (error instanceof TypeError) {
      const category = Object.getOwnPropertyDescriptor(
        error,
        "category",
      )?.value;
      if (isFailureCategory(category)) return error;
    }
  } catch {
    // Caller-controlled proxy errors are normalized below.
  }
  return exportFailure(
    `${artifact} export input could not be read or serialized`,
    "malformed-artifact",
  );
}

function byteLengthOf(value: unknown): number | undefined {
  try {
    const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
    const typedArrayName = Object.getOwnPropertyDescriptor(
      typedArrayPrototype,
      Symbol.toStringTag,
    )?.get?.call(value);
    if (typedArrayName !== "Uint8Array") return undefined;
    const getter = Object.getOwnPropertyDescriptor(
      typedArrayPrototype,
      "byteLength",
    )?.get;
    return getter?.call(value);
  } catch {
    return undefined;
  }
}

function isUint8Array(value: unknown): value is Uint8Array {
  return byteLengthOf(value) !== undefined;
}

function snapshotUint8Array(
  value: unknown,
):
  | { readonly ok: true; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly reason: "invalid" | "too-large" } {
  const byteLength = byteLengthOf(value);
  if (byteLength === undefined) return { ok: false, reason: "invalid" };
  if (byteLength > MAX_ARTIFACT_BYTES)
    return { ok: false, reason: "too-large" };
  try {
    const snapshot = new Uint8Array(byteLength);
    snapshot.set(value as Uint8Array);
    return { ok: true, bytes: snapshot };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

/**
 * Scan JSON before handing it to JSON.parse so duplicate object keys and
 * pathological nesting cannot be hidden by the host parser. The scanner is
 * deliberately only a safety check; JSON.parse remains the syntax authority.
 */
function scanJsonSafety(text: string): string | undefined {
  let index = 0;
  let scanFailure: string | undefined;

  const fail = (message: string): false => {
    if (scanFailure === undefined) scanFailure = message;
    return false;
  };

  const skipWhitespace = (): void => {
    while (
      index < text.length &&
      (text[index] === " " ||
        text[index] === "\t" ||
        text[index] === "\n" ||
        text[index] === "\r")
    ) {
      index += 1;
    }
  };

  const readString = (): string | undefined => {
    if (text[index] !== '"') {
      fail("JSON string expected");
      return undefined;
    }
    const start = index;
    index += 1;
    while (index < text.length) {
      const character = text[index];
      if (character === '"') {
        index += 1;
        try {
          const value = JSON.parse(text.slice(start, index)) as unknown;
          if (typeof value !== "string") {
            fail("JSON object key is not a string");
            return undefined;
          }
          return value;
        } catch {
          fail("JSON string is malformed");
          return undefined;
        }
      }
      if (character === "\\") {
        index += 1;
        if (index >= text.length) {
          fail("JSON escape is incomplete");
          return undefined;
        }
        const escape = text[index];
        if (escape === "u") {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(index + 1, index + 5))) {
            fail("JSON unicode escape is malformed");
            return undefined;
          }
          index += 5;
        } else if ('"\\/bfnrt'.includes(escape ?? "")) {
          index += 1;
        } else {
          fail("JSON escape is malformed");
          return undefined;
        }
        continue;
      }
      if ((character?.charCodeAt(0) ?? 0) < 0x20) {
        fail("JSON string contains an unescaped control character");
        return undefined;
      }
      index += 1;
    }
    fail("JSON string is unterminated");
    return undefined;
  };

  const readValue = (depth: number): boolean => {
    if (depth > MAX_JSON_DEPTH)
      return fail("JSON nesting exceeds the supported depth");
    skipWhitespace();
    const character = text[index];
    if (character === "{") {
      index += 1;
      skipWhitespace();
      const keys = new Set<string>();
      if (text[index] === "}") {
        index += 1;
        return true;
      }
      while (index < text.length) {
        const key = readString();
        if (key === undefined) return false;
        if (keys.has(key)) return fail("JSON object key is duplicated");
        keys.add(key);
        skipWhitespace();
        if (text[index] !== ":") return fail("JSON object key lacks a colon");
        index += 1;
        if (!readValue(depth + 1)) return false;
        skipWhitespace();
        if (text[index] === "}") {
          index += 1;
          return true;
        }
        if (text[index] !== ",") return fail("JSON object lacks a separator");
        index += 1;
        skipWhitespace();
      }
      return fail("JSON object is unterminated");
    }
    if (character === "[") {
      index += 1;
      skipWhitespace();
      if (text[index] === "]") {
        index += 1;
        return true;
      }
      while (index < text.length) {
        if (!readValue(depth + 1)) return false;
        skipWhitespace();
        if (text[index] === "]") {
          index += 1;
          return true;
        }
        if (text[index] !== ",") return fail("JSON array lacks a separator");
        index += 1;
        skipWhitespace();
      }
      return fail("JSON array is unterminated");
    }
    if (character === '"') return readString() !== undefined;
    if (text.startsWith("true", index)) {
      index += 4;
      return true;
    }
    if (text.startsWith("false", index)) {
      index += 5;
      return true;
    }
    if (text.startsWith("null", index)) {
      index += 4;
      return true;
    }
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(
      text.slice(index),
    );
    if (number !== null) {
      index += number[0].length;
      return true;
    }
    return fail("JSON value is malformed");
  };

  skipWhitespace();
  if (!readValue(0)) return scanFailure ?? "JSON is malformed";
  skipWhitespace();
  if (index !== text.length) return "JSON contains trailing data";
  return scanFailure;
}

function parseJson(bytes: Uint8Array): ParsedJsonResult {
  const byteLength = byteLengthOf(bytes);
  if (byteLength === undefined) {
    return { ok: false, message: "artifact bytes must be a Uint8Array" };
  }
  if (byteLength > MAX_ARTIFACT_BYTES)
    return {
      ok: false,
      message: "artifact bytes exceed the supported size",
    };

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const safetyFailure = scanJsonSafety(text);
    if (safetyFailure !== undefined)
      return { ok: false, message: safetyFailure };
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, message: "artifact bytes are not valid UTF-8 JSON" };
  }
}

/**
 * Reject an unknown field without echoing its (attacker-controlled) name:
 * the message and path name only the known container, never the field text
 * itself, so a hostile key can never appear in a diagnostic.
 */
function rejectUnknownFields(
  artifact: GoalPlanArtifactClass,
  value: JsonRecord,
  allowed: ReadonlySet<string>,
  path = "",
): GoalPlanValidationFailure | undefined {
  for (const field of Object.keys(value)) {
    if (!allowed.has(field))
      return failure(
        artifact,
        "malformed-artifact",
        path === ""
          ? `${artifact} declares an unknown field`
          : `${artifact} declares an unknown field at ${path}`,
        path === "" ? {} : { path },
      );
  }
  return undefined;
}

/** A fixed, non-echoing description of an unexpected value's shape. */
function describeType(value: unknown): string {
  if (value === undefined) return "missing";
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function readSchemaVersion(
  value: unknown,
  artifact: GoalPlanArtifactClass,
): GoalPlanValidationFailure | undefined {
  if (
    !isRecord(value) ||
    typeof value.schemaVersion !== "string" ||
    value.schemaVersion !== GOAL_PLAN_SCHEMA_VERSION
  )
    return failure(
      artifact,
      "unsupported-schema",
      `${artifact} schemaVersion must be ${GOAL_PLAN_SCHEMA_VERSION}`,
      {
        path: "schemaVersion",
        expected: GOAL_PLAN_SCHEMA_VERSION,
        observed: isRecord(value)
          ? describeType(value.schemaVersion)
          : "missing",
      },
    );
  return undefined;
}

function readPlanIdentity(
  artifact: GoalPlanArtifactClass,
  value: unknown,
  path = "plan",
):
  | { readonly ok: true; readonly plan: PlanIdentity }
  | GoalPlanValidationFailure {
  if (!isRecord(value))
    return failure(
      artifact,
      "malformed-artifact",
      `${path} must be an object`,
      {
        path,
      },
    );
  const unknown = rejectUnknownFields(
    artifact,
    value,
    new Set(["id", "revision"]),
    path,
  );
  if (unknown !== undefined) return unknown;
  if (typeof value.id !== "string" || !PLAN_OR_NODE_ID_PATTERN.test(value.id))
    return failure(
      artifact,
      "malformed-artifact",
      `${path}.id must match the plan identity pattern`,
      { path: `${path}.id` },
    );
  if (
    typeof value.revision !== "number" ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1
  )
    return failure(
      artifact,
      "malformed-artifact",
      `${path}.revision must be a positive safe integer`,
      { path: `${path}.revision` },
    );
  return { ok: true, plan: { id: value.id, revision: value.revision } };
}

function readRepoPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_REPO_PATH_LENGTH &&
    REPO_PATH_PATTERN.test(value)
  );
}

function readSourceDigest(
  artifact: GoalPlanArtifactClass,
  value: unknown,
  path: string,
):
  | { readonly ok: true; readonly binding: GoalPlanSourceDigest }
  | GoalPlanValidationFailure {
  if (!isRecord(value))
    return failure(
      artifact,
      "malformed-artifact",
      `${path} must be an object`,
      {
        path,
      },
    );
  const unknown = rejectUnknownFields(
    artifact,
    value,
    new Set(["path", "sha256"]),
    path,
  );
  if (unknown !== undefined) return unknown;
  if (!readRepoPath(value.path))
    return failure(
      artifact,
      "malformed-artifact",
      `${path}.path must be a valid repository-relative path`,
      { path: `${path}.path` },
    );
  if (typeof value.sha256 !== "string" || !SHA256_PATTERN.test(value.sha256))
    return failure(
      artifact,
      "malformed-artifact",
      `${path}.sha256 must be lowercase hexadecimal SHA-256`,
      { path: `${path}.sha256` },
    );
  return { ok: true, binding: { path: value.path, sha256: value.sha256 } };
}

function readCoverageIndex(
  artifact: GoalPlanArtifactClass,
  value: unknown,
  path = "coverageIndex",
):
  | { readonly ok: true; readonly coverageIndex: CoverageIndex }
  | GoalPlanValidationFailure {
  if (!isRecord(value))
    return failure(
      artifact,
      "malformed-artifact",
      `${path} must be an object`,
      {
        path,
      },
    );
  const unknown = rejectUnknownFields(
    artifact,
    value,
    new Set(["batchId", "fingerprint"]),
    path,
  );
  if (unknown !== undefined) return unknown;
  if (
    typeof value.batchId !== "string" ||
    value.batchId.length > MAX_BATCH_ID_LENGTH ||
    !BATCH_ID_PATTERN.test(value.batchId)
  )
    return failure(
      artifact,
      "malformed-artifact",
      `${path}.batchId must be a valid Batch identity`,
      { path: `${path}.batchId` },
    );
  if (
    typeof value.fingerprint !== "string" ||
    !SHA256_PATTERN.test(value.fingerprint)
  )
    return failure(
      artifact,
      "malformed-artifact",
      `${path}.fingerprint must be lowercase hexadecimal SHA-256`,
      { path: `${path}.fingerprint` },
    );
  return {
    ok: true,
    coverageIndex: { batchId: value.batchId, fingerprint: value.fingerprint },
  };
}

function readReviewedSources(
  artifact: GoalPlanArtifactClass,
  value: unknown,
  path = "reviewedSources",
):
  | { readonly ok: true; readonly bindings: readonly GoalPlanSourceDigest[] }
  | GoalPlanValidationFailure {
  if (!Array.isArray(value))
    return failure(artifact, "malformed-artifact", `${path} must be an array`, {
      path,
    });
  if (value.length > MAX_REVIEWED_SOURCES)
    return failure(
      artifact,
      "malformed-artifact",
      `${path} exceeds the supported source count`,
      { path },
    );
  const bindings: GoalPlanSourceDigest[] = [];
  let previous: string | undefined;
  const seen = new Set<string>();
  for (const [index, entry] of value.entries()) {
    const result = readSourceDigest(artifact, entry, `${path}[${index}]`);
    if (!result.ok) return result;
    if (seen.has(result.binding.path))
      return failure(
        artifact,
        "malformed-artifact",
        `${path} repeats path: ${result.binding.path}`,
        { path: `${path}[${index}].path` },
      );
    seen.add(result.binding.path);
    if (
      previous !== undefined &&
      compareUtf8(previous, result.binding.path) >= 0
    )
      return failure(
        artifact,
        "malformed-artifact",
        `${path} must be sorted by UTF-8 path bytes`,
        { path: `${path}[${index}].path` },
      );
    previous = result.binding.path;
    bindings.push(result.binding);
  }
  return { ok: true, bindings };
}

/**
 * Read a `dependsOn` array. `requireSorted` is true for a Manifest, whose
 * artifact-level rules ForgePilot's `preflight.go` enforces require UTF-8
 * sort order; a Declaration's `dependsOn` has no such requirement in either
 * the schema or ForgePilot's `parseGoalPlanDeclaration` — only uniqueness
 * and a valid node reference (Story TST-029 review HIGH-2).
 */
function readDependsOn(
  artifact: GoalPlanArtifactClass,
  value: unknown,
  path: string,
  requireSorted: boolean,
):
  | { readonly ok: true; readonly dependsOn: readonly string[] }
  | GoalPlanValidationFailure {
  if (!Array.isArray(value))
    return failure(artifact, "malformed-artifact", `${path} must be an array`, {
      path,
    });
  if (value.length > MAX_DEPENDS_ON)
    return failure(
      artifact,
      "malformed-artifact",
      `${path} exceeds the supported dependency count`,
      { path },
    );
  const dependsOn: string[] = [];
  const seen = new Set<string>();
  let previous: string | undefined;
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== "string" || !PLAN_OR_NODE_ID_PATTERN.test(entry))
      return failure(
        artifact,
        "malformed-artifact",
        `${path}[${index}] must be a valid node reference`,
        { path: `${path}[${index}]` },
      );
    if (seen.has(entry))
      return failure(
        artifact,
        "malformed-artifact",
        `${path} repeats a dependency`,
        { path: `${path}[${index}]` },
      );
    seen.add(entry);
    if (requireSorted && previous !== undefined && previous >= entry)
      return failure(
        artifact,
        "malformed-artifact",
        `${path} must be sorted by UTF-8 node reference`,
        { path: `${path}[${index}]` },
      );
    previous = entry;
    dependsOn.push(entry);
  }
  return { ok: true, dependsOn };
}

interface TopologyNode {
  readonly nodeRef: string;
  readonly dependsOn: readonly string[];
}

function validateTopology(
  artifact: GoalPlanArtifactClass,
  nodes: readonly TopologyNode[],
): GoalPlanValidationFailure | undefined {
  const known = new Set(nodes.map((node) => node.nodeRef));
  const colors = new Map<string, 1 | 2>();
  const graph = new Map<string, string[]>();
  for (const node of nodes) {
    for (const dependency of node.dependsOn) {
      if (!known.has(dependency))
        return failure(
          artifact,
          "invalid-topology",
          `node ${node.nodeRef} depends on an unknown node: ${dependency}`,
        );
      if (dependency === node.nodeRef)
        return failure(
          artifact,
          "invalid-topology",
          `node ${node.nodeRef} depends on itself`,
        );
      const outgoing = graph.get(dependency) ?? [];
      outgoing.push(node.nodeRef);
      graph.set(dependency, outgoing);
    }
  }
  let cyclic = false;
  const visit = (id: string): boolean => {
    colors.set(id, 1);
    for (const next of graph.get(id) ?? []) {
      if (colors.get(next) === 1) return true;
      if (colors.get(next) === undefined && visit(next)) return true;
    }
    colors.set(id, 2);
    return false;
  };
  for (const id of known) {
    if (colors.get(id) === undefined && visit(id)) {
      cyclic = true;
      break;
    }
  }
  if (cyclic)
    return failure(artifact, "invalid-topology", "topology contains a cycle");
  return undefined;
}

function readDeclarationShape(
  value: unknown,
):
  | { readonly ok: true; readonly declaration: GoalPlanDeclaration }
  | GoalPlanValidationFailure {
  const artifact: GoalPlanArtifactClass = "goal-plan-declaration";
  if (!isRecord(value))
    return failure(
      artifact,
      "malformed-artifact",
      "Declaration must be a JSON object",
    );
  const unknownTop = rejectUnknownFields(
    artifact,
    value,
    new Set(["schemaVersion", "plan", "nodes"]),
  );
  if (unknownTop !== undefined) return unknownTop;
  const planResult = readPlanIdentity(artifact, value.plan);
  if (!planResult.ok) return planResult;

  if (!Array.isArray(value.nodes) || value.nodes.length === 0)
    return failure(
      artifact,
      "malformed-artifact",
      "Declaration nodes must be a non-empty array",
      {
        path: "nodes",
      },
    );
  if (value.nodes.length > MAX_NODES)
    return failure(
      artifact,
      "malformed-artifact",
      "Declaration nodes exceeds the supported count",
      {
        path: "nodes",
      },
    );

  const nodes: GoalPlanDeclarationNode[] = [];
  const seenRefs = new Set<string>();
  for (const [index, entry] of value.nodes.entries()) {
    const nodePath = `nodes[${index}]`;
    if (!isRecord(entry))
      return failure(
        artifact,
        "malformed-artifact",
        `${nodePath} must be an object`,
        {
          path: nodePath,
        },
      );
    const unknownNode = rejectUnknownFields(
      artifact,
      entry,
      new Set(["nodeRef", "storyRef", "dependsOn"]),
      nodePath,
    );
    if (unknownNode !== undefined) return unknownNode;
    if (
      typeof entry.nodeRef !== "string" ||
      !PLAN_OR_NODE_ID_PATTERN.test(entry.nodeRef)
    )
      return failure(
        artifact,
        "malformed-artifact",
        `${nodePath}.nodeRef is invalid`,
        {
          path: `${nodePath}.nodeRef`,
        },
      );
    if (seenRefs.has(entry.nodeRef))
      return failure(
        artifact,
        "invalid-topology",
        `duplicate plan node reference: ${entry.nodeRef}`,
        { path: `${nodePath}.nodeRef` },
      );
    seenRefs.add(entry.nodeRef);
    if (!readRepoPath(entry.storyRef))
      return failure(
        artifact,
        "malformed-artifact",
        `${nodePath}.storyRef is invalid`,
        {
          path: `${nodePath}.storyRef`,
        },
      );
    const dependsOnResult = readDependsOn(
      artifact,
      entry.dependsOn,
      `${nodePath}.dependsOn`,
      false,
    );
    if (!dependsOnResult.ok) return dependsOnResult;
    nodes.push({
      nodeRef: entry.nodeRef,
      storyRef: entry.storyRef,
      dependsOn: dependsOnResult.dependsOn,
    });
  }

  const topologyFailure = validateTopology(artifact, nodes);
  if (topologyFailure !== undefined) return topologyFailure;

  return {
    ok: true,
    declaration: {
      schemaVersion: GOAL_PLAN_SCHEMA_VERSION,
      plan: planResult.plan,
      nodes,
    },
  };
}

function validateDeclarationStructure(
  bytes: Uint8Array,
):
  | { readonly ok: true; readonly declaration: GoalPlanDeclaration }
  | GoalPlanValidationFailure {
  const parsed = parseJson(bytes);
  if (!parsed.ok)
    return failure(
      "goal-plan-declaration",
      "malformed-artifact",
      parsed.message,
    );
  const schemaFailure = readSchemaVersion(
    parsed.value,
    "goal-plan-declaration",
  );
  if (schemaFailure !== undefined) return schemaFailure;
  return readDeclarationShape(parsed.value);
}

export function validateGoalPlanDeclaration(
  declarationBytes: Uint8Array,
): GoalPlanDeclarationValidation {
  try {
    const snapshot = snapshotUint8Array(declarationBytes);
    if (!snapshot.ok)
      return failure(
        "goal-plan-declaration",
        "malformed-artifact",
        snapshot.reason === "too-large"
          ? "artifact bytes exceed the supported size"
          : "artifact bytes must be a Uint8Array",
      );
    const structure = validateDeclarationStructure(snapshot.bytes);
    if (!structure.ok) return structure;
    return {
      ok: true,
      artifact: "goal-plan-declaration",
      declaration: structure.declaration,
      declarationDigest: sha256Hex(snapshot.bytes),
    };
  } catch {
    return failure(
      "goal-plan-declaration",
      "malformed-artifact",
      "Declaration bytes could not be read",
    );
  }
}

function readManifestShape(
  value: unknown,
):
  | { readonly ok: true; readonly manifest: GoalPlanManifest }
  | GoalPlanValidationFailure {
  const artifact: GoalPlanArtifactClass = "goal-plan-manifest";
  if (!isRecord(value))
    return failure(
      artifact,
      "malformed-artifact",
      "Manifest must be a JSON object",
    );
  const unknownTop = rejectUnknownFields(
    artifact,
    value,
    new Set([
      "schemaVersion",
      "plan",
      "declaration",
      "nodes",
      "reviewedSources",
      "coverageIndex",
    ]),
  );
  if (unknownTop !== undefined) return unknownTop;

  const planResult = readPlanIdentity(artifact, value.plan);
  if (!planResult.ok) return planResult;
  const declarationResult = readSourceDigest(
    artifact,
    value.declaration,
    "declaration",
  );
  if (!declarationResult.ok) return declarationResult;
  const reviewedSourcesResult = readReviewedSources(
    artifact,
    value.reviewedSources,
  );
  if (!reviewedSourcesResult.ok) return reviewedSourcesResult;
  const coverageIndexResult = readCoverageIndex(artifact, value.coverageIndex);
  if (!coverageIndexResult.ok) return coverageIndexResult;

  if (!Array.isArray(value.nodes) || value.nodes.length === 0)
    return failure(
      artifact,
      "malformed-artifact",
      "Manifest nodes must be a non-empty array",
      {
        path: "nodes",
      },
    );
  if (value.nodes.length > MAX_NODES)
    return failure(
      artifact,
      "malformed-artifact",
      "Manifest nodes exceeds the supported count",
      {
        path: "nodes",
      },
    );

  const nodes: GoalPlanManifestNode[] = [];
  const seenRefs = new Set<string>();
  let previousRef: string | undefined;
  for (const [index, entry] of value.nodes.entries()) {
    const nodePath = `nodes[${index}]`;
    if (!isRecord(entry))
      return failure(
        artifact,
        "malformed-artifact",
        `${nodePath} must be an object`,
        {
          path: nodePath,
        },
      );
    const unknownNode = rejectUnknownFields(
      artifact,
      entry,
      new Set(["nodeRef", "storyRef", "readinessContract", "dependsOn"]),
      nodePath,
    );
    if (unknownNode !== undefined) return unknownNode;
    if (
      typeof entry.nodeRef !== "string" ||
      !PLAN_OR_NODE_ID_PATTERN.test(entry.nodeRef)
    )
      return failure(
        artifact,
        "malformed-artifact",
        `${nodePath}.nodeRef is invalid`,
        {
          path: `${nodePath}.nodeRef`,
        },
      );
    if (seenRefs.has(entry.nodeRef))
      return failure(
        artifact,
        "invalid-topology",
        `duplicate plan node reference: ${entry.nodeRef}`,
        { path: `${nodePath}.nodeRef` },
      );
    seenRefs.add(entry.nodeRef);
    if (previousRef !== undefined && previousRef >= entry.nodeRef)
      return failure(
        artifact,
        "malformed-artifact",
        "Manifest nodes must be sorted by UTF-8 node reference",
        { path: `${nodePath}.nodeRef` },
      );
    previousRef = entry.nodeRef;

    if (!readRepoPath(entry.storyRef))
      return failure(
        artifact,
        "malformed-artifact",
        `${nodePath}.storyRef is invalid`,
        {
          path: `${nodePath}.storyRef`,
        },
      );
    const readinessResult = readSourceDigest(
      artifact,
      entry.readinessContract,
      `${nodePath}.readinessContract`,
    );
    if (!readinessResult.ok) return readinessResult;
    if (readinessResult.binding.path !== `${entry.storyRef}/readiness.json`)
      return failure(
        artifact,
        "malformed-artifact",
        `${nodePath}.readinessContract.path must equal ${entry.storyRef}/readiness.json`,
        { path: `${nodePath}.readinessContract.path` },
      );
    const dependsOnResult = readDependsOn(
      artifact,
      entry.dependsOn,
      `${nodePath}.dependsOn`,
      true,
    );
    if (!dependsOnResult.ok) return dependsOnResult;

    nodes.push({
      nodeRef: entry.nodeRef,
      storyRef: entry.storyRef,
      readinessContract: readinessResult.binding,
      dependsOn: dependsOnResult.dependsOn,
    });
  }

  const topologyFailure = validateTopology(artifact, nodes);
  if (topologyFailure !== undefined) return topologyFailure;

  return {
    ok: true,
    manifest: {
      schemaVersion: GOAL_PLAN_SCHEMA_VERSION,
      plan: planResult.plan,
      declaration: declarationResult.binding,
      nodes,
      reviewedSources: reviewedSourcesResult.bindings,
      coverageIndex: coverageIndexResult.coverageIndex,
    },
  };
}

function validateManifestStructure(
  bytes: Uint8Array,
):
  | { readonly ok: true; readonly manifest: GoalPlanManifest }
  | GoalPlanValidationFailure {
  const parsed = parseJson(bytes);
  if (!parsed.ok)
    return failure("goal-plan-manifest", "malformed-artifact", parsed.message);
  const schemaFailure = readSchemaVersion(parsed.value, "goal-plan-manifest");
  if (schemaFailure !== undefined) return schemaFailure;
  return readManifestShape(parsed.value);
}

function readSourceEntries(value: GoalPlanSourceFacts):
  | {
      readonly ok: true;
      readonly entries: readonly (readonly [string, Uint8Array])[];
    }
  | { readonly ok: false; readonly message: string } {
  if (value instanceof Map) {
    const entries: [string, Uint8Array][] = [];
    for (const [path, bytes] of value.entries()) {
      if (typeof path !== "string")
        return { ok: false, message: "source path must be a string" };
      if (!isUint8Array(bytes))
        return {
          ok: false,
          message: "source bytes for a bound path must be a Uint8Array",
        };
      entries.push([path, bytes]);
    }
    return { ok: true, entries };
  }
  if (Array.isArray(value)) {
    const entries: [string, Uint8Array][] = [];
    for (const [index, source] of value.entries()) {
      if (!isRecord(source) || typeof source.path !== "string")
        return {
          ok: false,
          message: `sources[${index}] must declare a string path`,
        };
      if (!isUint8Array(source.bytes))
        return {
          ok: false,
          message: `sources[${index}].bytes must be a Uint8Array`,
        };
      entries.push([source.path, source.bytes]);
    }
    return { ok: true, entries };
  }
  if (isRecord(value)) {
    const entries: [string, Uint8Array][] = [];
    for (const [path, bytes] of Object.entries(value)) {
      if (!isUint8Array(bytes))
        return {
          ok: false,
          message: "source bytes for a bound path must be a Uint8Array",
        };
      entries.push([path, bytes]);
    }
    return { ok: true, entries };
  }
  return {
    ok: false,
    message: "source facts must be a Map, an array, or an object",
  };
}

function sourceBytesByPath(
  sourceFacts: GoalPlanSourceFacts,
):
  | { readonly ok: true; readonly byPath: ReadonlyMap<string, Uint8Array> }
  | { readonly ok: false; readonly message: string } {
  const entriesResult = readSourceEntries(sourceFacts);
  if (!entriesResult.ok) return entriesResult;
  const byPath = new Map<string, Uint8Array>();
  for (const [path, bytes] of entriesResult.entries) {
    byPath.set(path, bytes);
  }
  return { ok: true, byPath };
}

function verifyBinding(
  artifact: GoalPlanArtifactClass,
  binding: GoalPlanSourceDigest,
  path: string,
  byPath: ReadonlyMap<string, Uint8Array>,
): GoalPlanValidationFailure | undefined {
  const bytes = byPath.get(binding.path);
  if (bytes === undefined)
    return failure(
      artifact,
      "digest-mismatch",
      `bound artifact is missing from source facts: ${binding.path}`,
      { path, expected: binding.sha256, observed: "missing" },
    );
  const observed = sha256Hex(bytes);
  if (observed !== binding.sha256)
    return failure(
      artifact,
      "digest-mismatch",
      `bound artifact digest does not match its current bytes: ${binding.path}`,
      { path, expected: binding.sha256, observed },
    );
  return undefined;
}

function sameStringSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const values = new Set(a);
  return b.every((value) => values.has(value));
}

function matchDeclarationToManifest(
  declaration: GoalPlanDeclaration,
  manifest: GoalPlanManifest,
): GoalPlanValidationFailure | undefined {
  if (
    declaration.plan.id !== manifest.plan.id ||
    declaration.plan.revision !== manifest.plan.revision ||
    declaration.nodes.length !== manifest.nodes.length
  )
    return failure(
      "goal-plan-manifest",
      "invalid-topology",
      "Declaration identity or node count does not match the Manifest",
    );
  const declared = new Map(
    declaration.nodes.map((node) => [node.nodeRef, node] as const),
  );
  for (const node of manifest.nodes) {
    const declaredNode = declared.get(node.nodeRef);
    if (
      declaredNode === undefined ||
      declaredNode.storyRef !== node.storyRef ||
      !sameStringSet(declaredNode.dependsOn, node.dependsOn)
    )
      return failure(
        "goal-plan-manifest",
        "invalid-topology",
        `Declaration node does not match the Manifest topology: ${node.nodeRef}`,
      );
  }
  return undefined;
}

/**
 * Validate a Goal Plan Manifest's shape, topology, and — when source facts
 * are supplied — every digest binding: the Declaration it references, each
 * reviewed source, and each node's Readiness Sidecar contract.
 */
function validateGoalPlanManifestInput(
  manifestBytes: Uint8Array,
  sourceFacts?: GoalPlanSourceFacts,
): GoalPlanManifestValidation {
  const structure = validateManifestStructure(manifestBytes);
  if (!structure.ok) return structure;
  const manifest = structure.manifest;

  if (sourceFacts === undefined)
    return failure(
      "goal-plan-manifest",
      "digest-mismatch",
      "raw source facts are required to verify the Declaration, reviewed sources, and readiness bindings",
      {
        path: "declaration",
        expected: "caller-supplied raw source bytes",
        observed: "missing",
      },
    );

  const byPathResult = sourceBytesByPath(sourceFacts);
  if (!byPathResult.ok)
    return failure(
      "goal-plan-manifest",
      "malformed-artifact",
      byPathResult.message,
      {
        path: "sources",
      },
    );
  const byPath = byPathResult.byPath;

  const declarationBindingFailure = verifyBinding(
    "goal-plan-manifest",
    manifest.declaration,
    "declaration.sha256",
    byPath,
  );
  if (declarationBindingFailure !== undefined) return declarationBindingFailure;

  const declarationBytes = byPath.get(manifest.declaration.path) as Uint8Array;
  const declarationResult = validateGoalPlanDeclaration(declarationBytes);
  if (!declarationResult.ok)
    return failure(
      "goal-plan-manifest",
      declarationResult.category,
      "referenced Declaration is not valid",
      { path: "declaration", causeCategory: declarationResult.category },
    );
  const matchFailure = matchDeclarationToManifest(
    declarationResult.declaration,
    manifest,
  );
  if (matchFailure !== undefined) return matchFailure;

  for (const [index, source] of manifest.reviewedSources.entries()) {
    const sourceFailure = verifyBinding(
      "goal-plan-manifest",
      source,
      `reviewedSources[${index}].sha256`,
      byPath,
    );
    if (sourceFailure !== undefined) return sourceFailure;
  }

  for (const [index, node] of manifest.nodes.entries()) {
    const readinessFailure = verifyBinding(
      "goal-plan-manifest",
      node.readinessContract,
      `nodes[${index}].readinessContract.sha256`,
      byPath,
    );
    if (readinessFailure !== undefined) return readinessFailure;
  }

  return {
    ok: true,
    artifact: "goal-plan-manifest",
    manifest,
    manifestDigest: sha256Hex(manifestBytes),
  };
}

export function validateGoalPlanManifest(
  manifestBytes: Uint8Array,
  sourceFacts?: GoalPlanSourceFacts,
): GoalPlanManifestValidation {
  try {
    const manifestSnapshot = snapshotUint8Array(manifestBytes);
    if (!manifestSnapshot.ok)
      return failure(
        "goal-plan-manifest",
        "malformed-artifact",
        manifestSnapshot.reason === "too-large"
          ? "artifact bytes exceed the supported size"
          : "artifact bytes must be a Uint8Array",
      );
    return validateGoalPlanManifestInput(manifestSnapshot.bytes, sourceFacts);
  } catch {
    return failure(
      "goal-plan-manifest",
      "malformed-artifact",
      "Manifest bytes or source facts could not be read",
    );
  }
}

function readReviewer(
  value: unknown,
):
  | { readonly ok: true; readonly reviewer: PlanCoverageReviewer }
  | GoalPlanValidationFailure {
  const artifact: GoalPlanArtifactClass = "plan-coverage-review";
  if (!isRecord(value))
    return failure(
      artifact,
      "malformed-artifact",
      "reviewer must be an object",
      {
        path: "reviewer",
      },
    );
  const unknown = rejectUnknownFields(
    artifact,
    value,
    new Set(["name", "assurance"]),
    "reviewer",
  );
  if (unknown !== undefined) return unknown;
  if (
    typeof value.name !== "string" ||
    value.name.length === 0 ||
    value.name.length > MAX_REVIEWER_NAME_LENGTH ||
    !REVIEWER_NAME_PATTERN.test(value.name)
  )
    return failure(artifact, "malformed-artifact", "reviewer.name is invalid", {
      path: "reviewer.name",
    });
  if (value.assurance !== "self-asserted")
    return failure(
      artifact,
      "malformed-artifact",
      'reviewer.assurance must be "self-asserted"',
      { path: "reviewer.assurance" },
    );
  return {
    ok: true,
    reviewer: { name: value.name, assurance: "self-asserted" },
  };
}

function readReviewShape(
  value: unknown,
):
  | { readonly ok: true; readonly review: PlanCoverageReview }
  | GoalPlanValidationFailure {
  const artifact: GoalPlanArtifactClass = "plan-coverage-review";
  if (!isRecord(value))
    return failure(
      artifact,
      "malformed-artifact",
      "Plan Coverage Review must be a JSON object",
    );
  const unknownTop = rejectUnknownFields(
    artifact,
    value,
    new Set([
      "schemaVersion",
      "reviewId",
      "manifestSha256",
      "reviewedSources",
      "coverageIndex",
      "conclusion",
      "reviewer",
      "reviewedAt",
    ]),
  );
  if (unknownTop !== undefined) return unknownTop;

  if (
    typeof value.reviewId !== "string" ||
    !REVIEW_ID_PATTERN.test(value.reviewId)
  )
    return failure(
      artifact,
      "malformed-artifact",
      "reviewId must be a UUIDv4",
      {
        path: "reviewId",
      },
    );
  if (
    typeof value.manifestSha256 !== "string" ||
    !SHA256_PATTERN.test(value.manifestSha256)
  )
    return failure(
      artifact,
      "malformed-artifact",
      "manifestSha256 must be lowercase hexadecimal SHA-256",
      { path: "manifestSha256" },
    );
  const reviewedSourcesResult = readReviewedSources(
    artifact,
    value.reviewedSources,
  );
  if (!reviewedSourcesResult.ok) return reviewedSourcesResult;
  const coverageIndexResult = readCoverageIndex(artifact, value.coverageIndex);
  if (!coverageIndexResult.ok) return coverageIndexResult;
  if (value.conclusion !== "approved")
    return failure(
      artifact,
      "malformed-artifact",
      'conclusion must be the literal "approved"',
      { path: "conclusion", expected: "approved" },
    );
  const reviewerResult = readReviewer(value.reviewer);
  if (!reviewerResult.ok) return reviewerResult;
  if (
    typeof value.reviewedAt !== "string" ||
    !REVIEWED_AT_PATTERN.test(value.reviewedAt) ||
    !Number.isFinite(Date.parse(value.reviewedAt))
  )
    return failure(
      artifact,
      "malformed-artifact",
      "reviewedAt must be an ISO 8601 UTC timestamp with exactly .000Z",
      { path: "reviewedAt" },
    );

  return {
    ok: true,
    review: {
      schemaVersion: GOAL_PLAN_SCHEMA_VERSION,
      reviewId: value.reviewId,
      manifestSha256: value.manifestSha256,
      reviewedSources: reviewedSourcesResult.bindings,
      coverageIndex: coverageIndexResult.coverageIndex,
      conclusion: "approved",
      reviewer: reviewerResult.reviewer,
      reviewedAt: value.reviewedAt,
    },
  };
}

function validateReviewStructure(
  bytes: Uint8Array,
):
  | { readonly ok: true; readonly review: PlanCoverageReview }
  | GoalPlanValidationFailure {
  const parsed = parseJson(bytes);
  if (!parsed.ok)
    return failure(
      "plan-coverage-review",
      "malformed-artifact",
      parsed.message,
    );
  const schemaFailure = readSchemaVersion(parsed.value, "plan-coverage-review");
  if (schemaFailure !== undefined) return schemaFailure;
  return readReviewShape(parsed.value);
}

function sameBindings(
  left: readonly GoalPlanSourceDigest[],
  right: readonly GoalPlanSourceDigest[],
): boolean {
  if (left.length !== right.length) return false;
  const rightByPath = new Map(
    right.map((binding) => [binding.path, binding.sha256]),
  );
  return left.every(
    (binding) => rightByPath.get(binding.path) === binding.sha256,
  );
}

function sameCoverageIndex(a: CoverageIndex, b: CoverageIndex): boolean {
  return a.batchId === b.batchId && a.fingerprint === b.fingerprint;
}

/**
 * Validate a Plan Coverage Review against the exact Manifest bytes and,
 * when supplied, the raw source facts the Manifest binds.
 */
function validatePlanCoverageReviewInput(
  reviewBytes: Uint8Array,
  manifestBytes: Uint8Array,
  sourceFacts?: GoalPlanSourceFacts,
): PlanCoverageReviewValidation {
  const structure = validateReviewStructure(reviewBytes);
  if (!structure.ok) return structure;

  const manifestSnapshot = snapshotUint8Array(manifestBytes);
  if (!manifestSnapshot.ok)
    return failure(
      "plan-coverage-review",
      "malformed-artifact",
      manifestSnapshot.reason === "too-large"
        ? "supplied Manifest bytes exceed the supported artifact size"
        : "supplied Manifest bytes must be a Uint8Array",
      { path: "manifestBytes" },
    );
  const stableManifestBytes = manifestSnapshot.bytes;
  const actualManifestDigest = sha256Hex(stableManifestBytes);

  if (structure.review.manifestSha256 !== actualManifestDigest)
    return failure(
      "plan-coverage-review",
      "approval-binding-mismatch",
      "manifestSha256 does not match the supplied Manifest bytes",
      {
        path: "manifestSha256",
        expected: structure.review.manifestSha256,
        observed: actualManifestDigest,
      },
    );

  const manifestResult = validateGoalPlanManifest(
    stableManifestBytes,
    sourceFacts,
  );
  if (!manifestResult.ok) {
    const category =
      manifestResult.category === "digest-mismatch"
        ? "digest-mismatch"
        : "approval-binding-mismatch";
    return failure(
      "plan-coverage-review",
      category,
      "referenced Goal Plan Manifest is not valid",
      { path: "manifest", causeCategory: manifestResult.category },
    );
  }

  if (
    !sameBindings(
      structure.review.reviewedSources,
      manifestResult.manifest.reviewedSources,
    )
  )
    return failure(
      "plan-coverage-review",
      "approval-binding-mismatch",
      "reviewedSources do not match the Manifest's reviewedSources",
      { path: "reviewedSources" },
    );
  if (
    !sameCoverageIndex(
      structure.review.coverageIndex,
      manifestResult.manifest.coverageIndex,
    )
  )
    return failure(
      "plan-coverage-review",
      "approval-binding-mismatch",
      "coverageIndex does not match the Manifest's coverageIndex",
      { path: "coverageIndex" },
    );

  return {
    ok: true,
    artifact: "plan-coverage-review",
    review: structure.review,
    reviewDigest: sha256Hex(reviewBytes),
    manifestDigest: actualManifestDigest,
  };
}

export function validatePlanCoverageReview(
  reviewBytes: Uint8Array,
  manifestBytes: Uint8Array,
  sourceFacts?: GoalPlanSourceFacts,
): PlanCoverageReviewValidation {
  try {
    const reviewSnapshot = snapshotUint8Array(reviewBytes);
    if (!reviewSnapshot.ok)
      return failure(
        "plan-coverage-review",
        "malformed-artifact",
        reviewSnapshot.reason === "too-large"
          ? "artifact bytes exceed the supported size"
          : "artifact bytes must be a Uint8Array",
      );
    return validatePlanCoverageReviewInput(
      reviewSnapshot.bytes,
      manifestBytes,
      sourceFacts,
    );
  } catch {
    return failure(
      "plan-coverage-review",
      "malformed-artifact",
      "Review bytes, Manifest bytes, or source facts could not be read",
    );
  }
}

function serializeArtifact(
  artifact: JsonRecord,
  artifactClass: GoalPlanArtifactClass,
): Uint8Array {
  try {
    const serialized = JSON.stringify(artifact, null, 2);
    if (serialized === undefined)
      throw new Error("artifact did not serialize to JSON");
    return new TextEncoder().encode(`${serialized}\n`);
  } catch (error) {
    if (error instanceof TypeError && "category" in error) throw error;
    throw exportFailure(
      `could not serialize ${artifactClass}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      "malformed-artifact",
    );
  }
}

function sourceBindingForExport(
  source: GoalPlanSourceBytes,
  field: string,
): GoalPlanSourceDigest {
  if (!isRecord(source) || typeof source.path !== "string")
    throw exportFailure(
      `${field} must declare a string path`,
      "malformed-artifact",
    );
  if (!(source.bytes instanceof Uint8Array))
    throw exportFailure(
      `${field}.bytes must be a Uint8Array`,
      "malformed-artifact",
    );
  return { path: source.path, sha256: sha256Hex(source.bytes) };
}

function sortedReviewedSources(
  sources: readonly GoalPlanSourceBytes[],
): readonly GoalPlanSourceDigest[] {
  const seen = new Set<string>();
  const bindings = sources.map((source, index) => {
    const binding = sourceBindingForExport(source, `reviewedSources[${index}]`);
    if (seen.has(binding.path))
      throw exportFailure(
        `reviewedSources repeats path: ${binding.path}`,
        "malformed-artifact",
      );
    seen.add(binding.path);
    return binding;
  });
  return [...bindings].sort((a, b) => compareUtf8(a.path, b.path));
}

function sortedDependsOn(dependsOn: readonly string[]): readonly string[] {
  const unique = [...new Set(dependsOn)];
  if (unique.length !== dependsOn.length)
    throw exportFailure("dependsOn repeats a dependency", "malformed-artifact");
  return unique.sort();
}

function rejectUnknownExportFields(
  input: JsonRecord,
  allowed: ReadonlySet<string>,
  artifact: GoalPlanArtifactClass,
): void {
  for (const field of Object.keys(input)) {
    if (!allowed.has(field))
      throw exportFailure(
        `${artifact} export input declares an unknown field: ${field}`,
        "malformed-artifact",
      );
  }
}

/** Export a Goal Plan Declaration: sorted nodes, each with sorted dependsOn. */
function exportGoalPlanDeclarationInput(
  input: GoalPlanDeclarationExportInput,
): Uint8Array {
  if (!isRecord(input))
    throw exportFailure(
      "Declaration export input must be an object",
      "malformed-artifact",
    );
  rejectUnknownExportFields(
    input,
    new Set(["planId", "revision", "nodes"]),
    "goal-plan-declaration",
  );
  const nodes = [...input.nodes]
    .map((node) => ({
      nodeRef: node.nodeRef,
      storyRef: node.storyRef,
      dependsOn: sortedDependsOn(node.dependsOn),
    }))
    .sort((a, b) =>
      a.nodeRef < b.nodeRef ? -1 : a.nodeRef > b.nodeRef ? 1 : 0,
    );

  const orderedArtifact: JsonRecord = {
    schemaVersion: GOAL_PLAN_SCHEMA_VERSION,
    plan: { id: input.planId, revision: input.revision },
    nodes: nodes.map((node) => ({
      nodeRef: node.nodeRef,
      storyRef: node.storyRef,
      dependsOn: node.dependsOn,
    })),
  };
  const bytes = serializeArtifact(orderedArtifact, "goal-plan-declaration");
  const validation = validateGoalPlanDeclaration(bytes);
  if (!validation.ok)
    throw exportFailure(
      `exported Declaration is invalid: ${validation.message}`,
      validation.category,
    );
  return bytes;
}

export function exportGoalPlanDeclaration(
  input: GoalPlanDeclarationExportInput,
): Uint8Array {
  try {
    return exportGoalPlanDeclarationInput(input);
  } catch (error) {
    throw exportBoundaryFailure(error, "goal-plan-declaration");
  }
}

/** Export a Goal Plan Manifest bound to the exact Declaration and source bytes supplied. */
function exportGoalPlanManifestInput(
  input: GoalPlanManifestExportInput,
): Uint8Array {
  if (!isRecord(input))
    throw exportFailure(
      "Manifest export input must be an object",
      "malformed-artifact",
    );
  rejectUnknownExportFields(
    input,
    new Set([
      "planId",
      "revision",
      "declaration",
      "nodes",
      "reviewedSources",
      "coverageIndex",
    ]),
    "goal-plan-manifest",
  );
  const declaration = sourceBindingForExport(input.declaration, "declaration");
  const reviewedSources = sortedReviewedSources(input.reviewedSources);

  const nodes = [...input.nodes]
    .map((node) => {
      const readiness = sourceBindingForExport(
        node.readiness,
        `nodes.readiness`,
      );
      return {
        nodeRef: node.nodeRef,
        storyRef: node.storyRef,
        readinessContract: readiness,
        dependsOn: sortedDependsOn(node.dependsOn),
      };
    })
    .sort((a, b) =>
      a.nodeRef < b.nodeRef ? -1 : a.nodeRef > b.nodeRef ? 1 : 0,
    );

  const orderedArtifact: JsonRecord = {
    schemaVersion: GOAL_PLAN_SCHEMA_VERSION,
    plan: { id: input.planId, revision: input.revision },
    declaration,
    nodes: nodes.map((node) => ({
      nodeRef: node.nodeRef,
      storyRef: node.storyRef,
      readinessContract: node.readinessContract,
      dependsOn: node.dependsOn,
    })),
    reviewedSources,
    coverageIndex: {
      batchId: input.coverageIndex.batchId,
      fingerprint: input.coverageIndex.fingerprint,
    },
  };
  const bytes = serializeArtifact(orderedArtifact, "goal-plan-manifest");

  const sourceFacts = new Map<string, Uint8Array>();
  sourceFacts.set(input.declaration.path, input.declaration.bytes);
  for (const source of input.reviewedSources)
    sourceFacts.set(source.path, source.bytes);
  for (const node of input.nodes)
    sourceFacts.set(node.readiness.path, node.readiness.bytes);

  const validation = validateGoalPlanManifest(bytes, sourceFacts);
  if (!validation.ok)
    throw exportFailure(
      `exported Manifest is invalid: ${validation.message}`,
      validation.category,
    );
  return bytes;
}

export function exportGoalPlanManifest(
  input: GoalPlanManifestExportInput,
): Uint8Array {
  try {
    return exportGoalPlanManifestInput(input);
  } catch (error) {
    throw exportBoundaryFailure(error, "goal-plan-manifest");
  }
}

/** Export a Plan Coverage Review bound to the exact Manifest bytes and its bindings. */
function exportPlanCoverageReviewInput(
  input: PlanCoverageReviewExportInput,
): Uint8Array {
  if (!isRecord(input))
    throw exportFailure(
      "Coverage Review export input must be an object",
      "malformed-artifact",
    );
  rejectUnknownExportFields(
    input,
    new Set([
      "manifestBytes",
      "reviewId",
      "conclusion",
      "reviewer",
      "reviewedAt",
      "sources",
    ]),
    "plan-coverage-review",
  );
  const manifestSnapshot = snapshotUint8Array(input.manifestBytes);
  if (!manifestSnapshot.ok)
    throw exportFailure(
      manifestSnapshot.reason === "too-large"
        ? "Coverage Review manifestBytes exceed the supported artifact size"
        : "Coverage Review export requires manifestBytes",
      "malformed-artifact",
    );
  const manifestBytes = manifestSnapshot.bytes;
  if (input.sources === undefined)
    throw exportFailure(
      "Coverage Review export requires sources to verify the referenced Manifest",
      "malformed-artifact",
    );
  // Mirrors validatePlanCoverageReviewInput's own referenced-Manifest
  // handling exactly, so the export and validate paths report the same
  // category and causeCategory for an invalid Manifest (Story TST-029
  // review LOW-9): digest-mismatch stays digest-mismatch, everything else
  // becomes approval-binding-mismatch with the Manifest's own category
  // preserved as causeCategory.
  const manifestValidation = validateGoalPlanManifest(
    manifestBytes,
    input.sources,
  );
  if (!manifestValidation.ok) {
    const category =
      manifestValidation.category === "digest-mismatch"
        ? "digest-mismatch"
        : "approval-binding-mismatch";
    throw exportFailure(
      "cannot bind Coverage Review to invalid Manifest",
      category,
      manifestValidation.category,
    );
  }
  const manifest = manifestValidation.manifest;

  const orderedArtifact: JsonRecord = {
    schemaVersion: GOAL_PLAN_SCHEMA_VERSION,
    reviewId: input.reviewId,
    manifestSha256: sha256Hex(manifestBytes),
    reviewedSources: manifest.reviewedSources,
    coverageIndex: manifest.coverageIndex,
    conclusion: input.conclusion,
    reviewer: {
      name: input.reviewer.name,
      assurance: input.reviewer.assurance,
    },
    reviewedAt: input.reviewedAt,
  };
  const bytes = serializeArtifact(orderedArtifact, "plan-coverage-review");
  const validation = validatePlanCoverageReview(
    bytes,
    manifestBytes,
    input.sources,
  );
  if (!validation.ok)
    throw exportFailure(
      `exported Coverage Review is invalid: ${validation.message}`,
      validation.category,
    );
  return bytes;
}

export function exportPlanCoverageReview(
  input: PlanCoverageReviewExportInput,
): Uint8Array {
  try {
    return exportPlanCoverageReviewInput(input);
  } catch (error) {
    throw exportBoundaryFailure(error, "plan-coverage-review");
  }
}
