/**
 * Pure Goal Plan Manifest and Plan Coverage Review artifacts.
 *
 * The functions in this module receive raw bytes and caller-owned source facts.
 * They do not read a filesystem, process, clock, or network, and they never
 * reserialize a candidate artifact while validating it.  JSON is decoded only
 * to inspect the declared shape; every integrity decision hashes the bytes
 * supplied by the caller.
 */

import { sha256Hex } from "./review/fingerprint.js";

/** The only Goal Plan Manifest schema currently supported by this module. */
export const GOAL_PLAN_MANIFEST_SCHEMA_VERSION = 1 as const;

/** The only Plan Coverage Review schema currently supported by this module. */
export const PLAN_COVERAGE_REVIEW_SCHEMA_VERSION = 1 as const;

export type GoalPlanArtifactClass =
  "goal-plan-manifest" | "plan-coverage-review";

/** Stable public categories for rejected artifact input. */
export type GoalPlanFailureCategory =
  | "unsupported-schema"
  | "malformed-artifact"
  | "invalid-topology"
  | "digest-mismatch"
  | "approval-binding-mismatch";

export interface GoalPlanNode {
  readonly planNodeRef: string;
  readonly storyRef: string;
  readonly readinessContract: GoalPlanReadinessContract;
  readonly [field: string]: unknown;
}

export interface GoalPlanReadinessContract {
  readonly identity: string;
  readonly sha256: string;
}

export interface GoalPlanEdge {
  readonly from: string;
  readonly to: string;
}

export interface GoalPlanSourceDigest {
  readonly identity: string;
  readonly sha256: string;
}

export interface GoalPlanManifest {
  readonly schemaVersion: typeof GOAL_PLAN_MANIFEST_SCHEMA_VERSION;
  readonly planId: string;
  readonly revision: number;
  readonly goalId?: string;
  readonly title?: string;
  readonly nodes: readonly GoalPlanNode[];
  readonly edges: readonly GoalPlanEdge[];
  readonly reviewedSources: readonly GoalPlanSourceDigest[];
}

export interface PlanCoverageReview {
  readonly schemaVersion: typeof PLAN_COVERAGE_REVIEW_SCHEMA_VERSION;
  readonly reviewId: string;
  readonly manifestDigest: string;
  readonly coverageIndexIdentity: string;
  readonly conclusion: "approved";
  readonly approvedBy: string;
  readonly approvedAt: string;
  readonly reviewedSources: readonly GoalPlanSourceDigest[];
}

/** A source identity and the exact bytes that identity names. */
export interface GoalPlanSourceBytes {
  readonly identity: string;
  readonly bytes: Uint8Array;
}

/** Caller-owned source facts accepted by the validators and exporter. */
export type GoalPlanSourceFacts =
  | ReadonlyMap<string, Uint8Array>
  | readonly GoalPlanSourceBytes[]
  | Readonly<Record<string, Uint8Array>>;

export interface GoalPlanManifestExportInput {
  readonly planId: string;
  readonly revision: number;
  readonly nodes: readonly GoalPlanNode[];
  readonly edges: readonly GoalPlanEdge[];
  readonly reviewedSources: readonly GoalPlanSourceBytes[];
  readonly schemaVersion?: number;
  readonly goalId?: string;
  readonly title?: string;
}

export interface PlanCoverageReviewExportInput {
  readonly manifestBytes: Uint8Array;
  readonly reviewId: string;
  readonly coverageIndexIdentity: string;
  readonly conclusion: "approved";
  readonly approvedBy: string;
  readonly approvedAt: string;
  readonly schemaVersion?: number;
  /** Raw integrity facts; required when the referenced Manifest lists sources. */
  readonly sources?: GoalPlanSourceFacts;
  /** Defaults to the Manifest's reviewedSources when omitted. */
  readonly reviewedSources?: readonly GoalPlanSourceDigest[];
}

export interface GoalPlanValidationFailure {
  readonly ok: false;
  readonly artifact: GoalPlanArtifactClass;
  readonly category: GoalPlanFailureCategory;
  readonly message: string;
  readonly path?: string;
  readonly expected?: string;
  readonly observed?: string;
  /** A referenced Manifest failure preserved for Coverage Review diagnostics. */
  readonly causeCategory?: GoalPlanFailureCategory;
}

export interface GoalPlanManifestValidationSuccess {
  readonly ok: true;
  readonly artifact: "goal-plan-manifest";
  readonly manifest: GoalPlanManifest;
  readonly manifestDigest: string;
  readonly sourceDigests: readonly GoalPlanSourceDigest[];
}

export interface PlanCoverageReviewValidationSuccess {
  readonly ok: true;
  readonly artifact: "plan-coverage-review";
  readonly review: PlanCoverageReview;
  readonly reviewDigest: string;
  readonly manifestDigest: string;
  readonly sourceDigests: readonly GoalPlanSourceDigest[];
}

export type GoalPlanManifestValidation =
  GoalPlanManifestValidationSuccess | GoalPlanValidationFailure;

export type PlanCoverageReviewValidation =
  PlanCoverageReviewValidationSuccess | GoalPlanValidationFailure;

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const UTC_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const MAX_NODES = 10000;
const MAX_EDGES = 20000;
const MAX_SOURCES = 10000;
const MAX_ID_LENGTH = 4096;
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

interface SourceEntryResult {
  readonly ok: true;
  readonly entries: readonly [string, Uint8Array][];
}

interface SourceEntryFailure {
  readonly ok: false;
  readonly message: string;
  readonly path: string;
}

type SourceEntriesResult = SourceEntryResult | SourceEntryFailure;

interface BindingResult {
  readonly ok: true;
  readonly bindings: readonly GoalPlanSourceDigest[];
}

interface BindingFailure {
  readonly ok: false;
  readonly category: "malformed-artifact" | "digest-mismatch";
  readonly message: string;
  readonly path: string;
  readonly expected?: string;
  readonly observed?: string;
}

type BindingReadResult = BindingResult | BindingFailure;

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
): TypeError {
  const error = new TypeError(message);
  Object.defineProperty(error, "category", {
    configurable: false,
    enumerable: true,
    value: category,
    writable: false,
  });
  return error;
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
      if (
        category === "unsupported-schema" ||
        category === "malformed-artifact" ||
        category === "invalid-topology" ||
        category === "digest-mismatch" ||
        category === "approval-binding-mismatch"
      )
        return error;
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
        if (keys.has(key)) return fail(`JSON object key is duplicated: ${key}`);
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

function readSchemaVersion(
  value: unknown,
  artifact: GoalPlanArtifactClass,
): GoalPlanValidationFailure | number {
  if (!isRecord(value) || !("schemaVersion" in value))
    return failure(
      artifact,
      "malformed-artifact",
      "artifact is missing required field schemaVersion",
      { path: "schemaVersion" },
    );
  if (typeof value.schemaVersion !== "number")
    return failure(
      artifact,
      "malformed-artifact",
      "artifact schemaVersion must be a number",
      { path: "schemaVersion" },
    );
  return value.schemaVersion;
}

function schemaFailure(
  artifact: GoalPlanArtifactClass,
  schemaVersion: number,
): GoalPlanValidationFailure {
  return failure(
    artifact,
    "unsupported-schema",
    `unsupported ${artifact} schemaVersion: ${String(schemaVersion)}`,
    { path: "schemaVersion", expected: "1", observed: String(schemaVersion) },
  );
}

function rejectUnknownFields(
  value: JsonRecord,
  allowed: ReadonlySet<string>,
  artifact: GoalPlanArtifactClass,
): GoalPlanValidationFailure | undefined {
  for (const field of Object.keys(value)) {
    if (!allowed.has(field))
      return failure(
        artifact,
        "malformed-artifact",
        `${artifact} declares an unknown field: ${field}`,
        { path: field },
      );
  }
  return undefined;
}

function readOptionalManifestText(
  value: JsonRecord,
  field: "planId" | "goalId" | "title",
): GoalPlanValidationFailure | undefined {
  if (!(field in value)) return undefined;
  if (typeof value[field] !== "string" || value[field].trim().length === 0)
    return failure(
      "goal-plan-manifest",
      "malformed-artifact",
      `Manifest ${field} must be a non-empty string when present`,
      { path: field },
    );
  if (value[field].length > MAX_ID_LENGTH)
    return failure(
      "goal-plan-manifest",
      "malformed-artifact",
      `Manifest ${field} is too long`,
      { path: field },
    );
  return undefined;
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

function readSourceEntries(value: GoalPlanSourceFacts): SourceEntriesResult {
  if (value instanceof Map) {
    const entries: [string, Uint8Array][] = [];
    for (const [identity, bytes] of value.entries()) {
      if (typeof identity !== "string")
        return {
          ok: false,
          message: "source identity must be a string",
          path: "sources",
        };
      if (!isUint8Array(bytes))
        return {
          ok: false,
          message: `source bytes for ${identity} must be a Uint8Array`,
          path: `sources.${identity}`,
        };
      entries.push([identity, bytes]);
    }
    return { ok: true, entries };
  }

  if (Array.isArray(value)) {
    const entries: [string, Uint8Array][] = [];
    for (const [index, source] of value.entries()) {
      if (!isRecord(source) || typeof source.identity !== "string")
        return {
          ok: false,
          message: "source entry must declare a string identity",
          path: `sources[${index}].identity`,
        };
      if (!isUint8Array(source.bytes))
        return {
          ok: false,
          message: "source entry bytes must be a Uint8Array",
          path: `sources[${index}].bytes`,
        };
      entries.push([source.identity, source.bytes]);
    }
    return { ok: true, entries };
  }

  if (isRecord(value)) {
    const entries: [string, Uint8Array][] = [];
    for (const [identity, bytes] of Object.entries(value)) {
      if (!isUint8Array(bytes))
        return {
          ok: false,
          message: `source bytes for ${identity} must be a Uint8Array`,
          path: `sources.${identity}`,
        };
      entries.push([identity, bytes]);
    }
    return { ok: true, entries };
  }

  return {
    ok: false,
    message: "source facts must be a Map, an array, or an object",
    path: "sources",
  };
}

function verifySourceDigests(
  bindings: readonly GoalPlanSourceDigest[],
  sourceFacts: GoalPlanSourceFacts,
  artifact: GoalPlanArtifactClass,
): GoalPlanValidationFailure | undefined {
  const entriesResult = readSourceEntries(sourceFacts);
  if (!entriesResult.ok)
    return failure(artifact, "malformed-artifact", entriesResult.message, {
      path: entriesResult.path,
    });

  const byIdentity = new Map<string, Uint8Array>();
  for (const [identity, bytes] of entriesResult.entries) {
    if (byIdentity.has(identity))
      return failure(
        artifact,
        "malformed-artifact",
        `source facts repeat identity: ${identity}`,
        { path: "sources" },
      );
    byIdentity.set(identity, bytes);
  }

  for (const [index, binding] of bindings.entries()) {
    const bytes = byIdentity.get(binding.identity);
    if (bytes === undefined)
      return failure(
        artifact,
        "digest-mismatch",
        `reviewed source is missing: ${binding.identity}`,
        {
          path: `reviewedSources[${index}].sha256`,
          expected: binding.sha256,
          observed: "missing",
        },
      );
    const observed = sha256Hex(bytes);
    if (observed !== binding.sha256)
      return failure(
        artifact,
        "digest-mismatch",
        `reviewed source digest mismatch: ${binding.identity}`,
        {
          path: `reviewedSources[${index}].sha256`,
          expected: binding.sha256,
          observed,
        },
      );
  }

  return undefined;
}

function readBindings(
  value: unknown,
  field = "reviewedSources",
): BindingReadResult {
  if (!Array.isArray(value))
    return {
      ok: false,
      category: "malformed-artifact",
      message: `${field} must be an array`,
      path: field,
    };
  if (value.length > MAX_SOURCES)
    return {
      ok: false,
      category: "malformed-artifact",
      message: `${field} exceeds the supported source count`,
      path: field,
    };

  const seen = new Set<string>();
  const bindings: GoalPlanSourceDigest[] = [];
  for (const [index, entry] of value.entries()) {
    if (!isRecord(entry))
      return {
        ok: false,
        category: "malformed-artifact",
        message: "reviewed source entry must be an object",
        path: `${field}[${index}]`,
      };
    for (const entryField of Object.keys(entry)) {
      if (entryField !== "identity" && entryField !== "sha256")
        return {
          ok: false,
          category: "malformed-artifact",
          message: `${field}[${index}] declares an unknown field: ${entryField}`,
          path: `${field}[${index}].${entryField}`,
        };
    }
    if (
      typeof entry.identity !== "string" ||
      entry.identity.trim().length === 0
    )
      return {
        ok: false,
        category: "malformed-artifact",
        message: "reviewed source identity must be a non-empty string",
        path: `${field}[${index}].identity`,
      };
    if (entry.identity.length > MAX_ID_LENGTH)
      return {
        ok: false,
        category: "malformed-artifact",
        message: "reviewed source identity is too long",
        path: `${field}[${index}].identity`,
      };
    if (seen.has(entry.identity))
      return {
        ok: false,
        category: "malformed-artifact",
        message: `reviewed source identity is duplicated: ${entry.identity}`,
        path: `${field}[${index}].identity`,
      };
    seen.add(entry.identity);
    if (typeof entry.sha256 !== "string" || !SHA256_PATTERN.test(entry.sha256))
      return {
        ok: false,
        category: "malformed-artifact",
        message: "reviewed source sha256 must be lowercase hexadecimal SHA-256",
        path: `${field}[${index}].sha256`,
      };
    bindings.push({ identity: entry.identity, sha256: entry.sha256 });
  }

  return { ok: true, bindings };
}

function readNodes(value: unknown):
  | { readonly ok: true; readonly nodes: readonly GoalPlanNode[] }
  | {
      readonly ok: false;
      readonly category: "malformed-artifact" | "invalid-topology";
      readonly message: string;
      readonly path: string;
    } {
  if (!Array.isArray(value))
    return {
      ok: false,
      category: "malformed-artifact",
      message: "nodes must be an array",
      path: "nodes",
    };
  if (value.length > MAX_NODES)
    return {
      ok: false,
      category: "malformed-artifact",
      message: "nodes exceeds the supported count",
      path: "nodes",
    };

  const seen = new Set<string>();
  const nodes: GoalPlanNode[] = [];
  for (const [index, valueEntry] of value.entries()) {
    if (!isRecord(valueEntry))
      return {
        ok: false,
        category: "malformed-artifact",
        message: "plan node must be an object",
        path: `nodes[${index}]`,
      };
    if (!("planNodeRef" in valueEntry))
      return {
        ok: false,
        category: "invalid-topology",
        message: "plan node is missing planNodeRef",
        path: `nodes[${index}].planNodeRef`,
      };
    if (
      typeof valueEntry.planNodeRef !== "string" ||
      valueEntry.planNodeRef.trim().length === 0
    )
      return {
        ok: false,
        category: "malformed-artifact",
        message: "plan node planNodeRef must be a non-empty string",
        path: `nodes[${index}].planNodeRef`,
      };
    if (valueEntry.planNodeRef.length > MAX_ID_LENGTH)
      return {
        ok: false,
        category: "malformed-artifact",
        message: "plan node planNodeRef is too long",
        path: `nodes[${index}].planNodeRef`,
      };
    if (seen.has(valueEntry.planNodeRef))
      return {
        ok: false,
        category: "invalid-topology",
        message: `plan node reference is duplicated: ${valueEntry.planNodeRef}`,
        path: `nodes[${index}].planNodeRef`,
      };
    seen.add(valueEntry.planNodeRef);

    if (
      typeof valueEntry.storyRef !== "string" ||
      valueEntry.storyRef.trim().length === 0
    )
      return {
        ok: false,
        category: "malformed-artifact",
        message: "plan node storyRef must be a non-empty string",
        path: `nodes[${index}].storyRef`,
      };
    if (valueEntry.storyRef.length > MAX_ID_LENGTH)
      return {
        ok: false,
        category: "malformed-artifact",
        message: "plan node storyRef is too long",
        path: `nodes[${index}].storyRef`,
      };

    const readinessContract = valueEntry.readinessContract;
    if (!isRecord(readinessContract))
      return {
        ok: false,
        category: "malformed-artifact",
        message: "plan node readinessContract must be an object",
        path: `nodes[${index}].readinessContract`,
      };
    const unknownReadinessField = Object.keys(readinessContract).find(
      (field) => field !== "identity" && field !== "sha256",
    );
    if (unknownReadinessField !== undefined)
      return {
        ok: false,
        category: "malformed-artifact",
        message: `readinessContract declares an unknown field: ${unknownReadinessField}`,
        path: `nodes[${index}].readinessContract.${unknownReadinessField}`,
      };
    if (
      typeof readinessContract.identity !== "string" ||
      readinessContract.identity.trim().length === 0 ||
      readinessContract.identity.length > MAX_ID_LENGTH
    )
      return {
        ok: false,
        category: "malformed-artifact",
        message:
          "readinessContract identity must be a non-empty bounded string",
        path: `nodes[${index}].readinessContract.identity`,
      };
    if (
      typeof readinessContract.sha256 !== "string" ||
      !SHA256_PATTERN.test(readinessContract.sha256)
    )
      return {
        ok: false,
        category: "malformed-artifact",
        message:
          "readinessContract sha256 must be lowercase hexadecimal SHA-256",
        path: `nodes[${index}].readinessContract.sha256`,
      };
    nodes.push(valueEntry as GoalPlanNode);
  }
  return { ok: true, nodes };
}

function readEdges(
  value: unknown,
  nodeIds: ReadonlySet<string>,
):
  | { readonly ok: true; readonly edges: readonly GoalPlanEdge[] }
  | {
      readonly ok: false;
      readonly category: "malformed-artifact" | "invalid-topology";
      readonly message: string;
      readonly path: string;
    } {
  if (!Array.isArray(value))
    return {
      ok: false,
      category: "malformed-artifact",
      message: "edges must be an array",
      path: "edges",
    };
  if (value.length > MAX_EDGES)
    return {
      ok: false,
      category: "malformed-artifact",
      message: "edges exceeds the supported count",
      path: "edges",
    };

  const outgoing = new Map<string, Set<string>>();
  const indegree = new Map<string, number>();
  for (const id of nodeIds) {
    outgoing.set(id, new Set());
    indegree.set(id, 0);
  }

  const edges: GoalPlanEdge[] = [];
  for (const [index, valueEntry] of value.entries()) {
    if (!isRecord(valueEntry))
      return {
        ok: false,
        category: "malformed-artifact",
        message: "plan edge must be an object",
        path: `edges[${index}]`,
      };
    const unknownEdgeField = Object.keys(valueEntry).find(
      (field) => field !== "from" && field !== "to",
    );
    if (unknownEdgeField !== undefined)
      return {
        ok: false,
        category: "malformed-artifact",
        message: `plan edge declares an unknown field: ${unknownEdgeField}`,
        path: `edges[${index}].${unknownEdgeField}`,
      };
    if (
      typeof valueEntry.from !== "string" ||
      valueEntry.from.trim().length === 0
    )
      return {
        ok: false,
        category: "invalid-topology",
        message: "plan edge is missing its from node reference",
        path: `edges[${index}].from`,
      };
    if (typeof valueEntry.to !== "string" || valueEntry.to.trim().length === 0)
      return {
        ok: false,
        category: "invalid-topology",
        message: "plan edge is missing its to node reference",
        path: `edges[${index}].to`,
      };
    if (!nodeIds.has(valueEntry.from) || !nodeIds.has(valueEntry.to))
      return {
        ok: false,
        category: "invalid-topology",
        message: `plan edge references an unknown node: ${valueEntry.from} -> ${valueEntry.to}`,
        path: `edges[${index}]`,
      };
    if (valueEntry.from === valueEntry.to)
      return {
        ok: false,
        category: "invalid-topology",
        message: `plan edge is a self-edge: ${valueEntry.from}`,
        path: `edges[${index}]`,
      };

    const children = outgoing.get(valueEntry.from) as Set<string>;
    if (children.has(valueEntry.to))
      return {
        ok: false,
        category: "invalid-topology",
        message: `plan edge is duplicated: ${valueEntry.from} -> ${valueEntry.to}`,
        path: `edges[${index}]`,
      };
    children.add(valueEntry.to);
    indegree.set(valueEntry.to, (indegree.get(valueEntry.to) ?? 0) + 1);
    edges.push({ from: valueEntry.from, to: valueEntry.to });
  }

  const ready: string[] = [];
  for (const [id, degree] of indegree.entries()) {
    if (degree === 0) ready.push(id);
  }
  let readyIndex = 0;
  let visited = 0;
  while (readyIndex < ready.length) {
    const id = ready[readyIndex] as string;
    readyIndex += 1;
    visited += 1;
    for (const child of outgoing.get(id) ?? []) {
      const nextDegree = (indegree.get(child) ?? 0) - 1;
      indegree.set(child, nextDegree);
      if (nextDegree === 0) ready.push(child);
    }
  }
  if (visited !== nodeIds.size)
    return {
      ok: false,
      category: "invalid-topology",
      message: "plan edges contain a cycle",
      path: "edges",
    };

  return { ok: true, edges };
}

function readManifestShape(value: unknown):
  | {
      readonly ok: true;
      readonly manifest: GoalPlanManifest;
      readonly sourceDigests: readonly GoalPlanSourceDigest[];
    }
  | GoalPlanValidationFailure {
  if (!isRecord(value))
    return failure(
      "goal-plan-manifest",
      "malformed-artifact",
      "Goal Plan Manifest must be a JSON object",
    );

  const unknownFieldFailure = rejectUnknownFields(
    value,
    new Set([
      "schemaVersion",
      "planId",
      "revision",
      "goalId",
      "title",
      "nodes",
      "edges",
      "reviewedSources",
    ]),
    "goal-plan-manifest",
  );
  if (unknownFieldFailure !== undefined) return unknownFieldFailure;
  if (
    typeof value.planId !== "string" ||
    value.planId.trim().length === 0 ||
    value.planId.length > MAX_ID_LENGTH
  )
    return failure(
      "goal-plan-manifest",
      "malformed-artifact",
      "Manifest planId must be a non-empty bounded string",
      { path: "planId" },
    );
  if (
    typeof value.revision !== "number" ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1
  )
    return failure(
      "goal-plan-manifest",
      "malformed-artifact",
      "Manifest revision must be a positive safe integer",
      { path: "revision" },
    );
  for (const field of ["goalId", "title"] as const) {
    const optionalFailure = readOptionalManifestText(value, field);
    if (optionalFailure !== undefined) return optionalFailure;
  }

  const nodesResult = readNodes(value.nodes);
  if (!nodesResult.ok)
    return failure(
      "goal-plan-manifest",
      nodesResult.category,
      nodesResult.message,
      {
        path: nodesResult.path,
      },
    );
  const edgesResult = readEdges(
    value.edges,
    new Set(nodesResult.nodes.map((node) => node.planNodeRef)),
  );
  if (!edgesResult.ok)
    return failure(
      "goal-plan-manifest",
      edgesResult.category,
      edgesResult.message,
      {
        path: edgesResult.path,
      },
    );
  const bindingsResult = readBindings(value.reviewedSources);
  if (!bindingsResult.ok)
    return failure(
      "goal-plan-manifest",
      bindingsResult.category,
      bindingsResult.message,
      {
        path: bindingsResult.path,
        ...(bindingsResult.expected === undefined
          ? {}
          : { expected: bindingsResult.expected }),
        ...(bindingsResult.observed === undefined
          ? {}
          : { observed: bindingsResult.observed }),
      },
    );

  const sourcesByIdentity = new Map(
    bindingsResult.bindings.map((source) => [source.identity, source.sha256]),
  );
  for (const [index, node] of nodesResult.nodes.entries()) {
    const sourceDigest = sourcesByIdentity.get(node.readinessContract.identity);
    if (sourceDigest === undefined)
      return failure(
        "goal-plan-manifest",
        "digest-mismatch",
        `readiness contract source is not declared: ${node.readinessContract.identity}`,
        {
          path: `nodes[${index}].readinessContract.identity`,
          expected: node.readinessContract.sha256,
          observed: "missing source binding",
        },
      );
    if (sourceDigest !== node.readinessContract.sha256)
      return failure(
        "goal-plan-manifest",
        "digest-mismatch",
        `readiness contract digest does not match its source binding: ${node.readinessContract.identity}`,
        {
          path: `nodes[${index}].readinessContract.sha256`,
          expected: node.readinessContract.sha256,
          observed: sourceDigest,
        },
      );
  }

  const manifest = {
    ...value,
    schemaVersion: GOAL_PLAN_MANIFEST_SCHEMA_VERSION,
    planId: value.planId,
    revision: value.revision,
    nodes: nodesResult.nodes,
    edges: edgesResult.edges,
    reviewedSources: bindingsResult.bindings,
  } as GoalPlanManifest;
  return {
    ok: true,
    manifest,
    sourceDigests: bindingsResult.bindings,
  };
}

function isCanonicalUtcTimestamp(value: string): boolean {
  if (!UTC_TIMESTAMP_PATTERN.test(value)) return false;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return false;
  const normalized = new Date(timestamp).toISOString();
  return normalized === value || normalized.replace(".000Z", "Z") === value;
}

function readReviewShape(value: unknown):
  | {
      readonly ok: true;
      readonly review: PlanCoverageReview;
      readonly sourceDigests: readonly GoalPlanSourceDigest[];
    }
  | GoalPlanValidationFailure {
  if (!isRecord(value))
    return failure(
      "plan-coverage-review",
      "malformed-artifact",
      "Plan Coverage Review must be a JSON object",
    );
  const unknownFieldFailure = rejectUnknownFields(
    value,
    new Set([
      "schemaVersion",
      "reviewId",
      "manifestDigest",
      "coverageIndexIdentity",
      "conclusion",
      "approvedBy",
      "approvedAt",
      "reviewedSources",
    ]),
    "plan-coverage-review",
  );
  if (unknownFieldFailure !== undefined) return unknownFieldFailure;
  for (const field of [
    "reviewId",
    "coverageIndexIdentity",
    "approvedBy",
  ] as const) {
    if (
      typeof value[field] !== "string" ||
      value[field].trim().length === 0 ||
      value[field].length > MAX_ID_LENGTH
    )
      return failure(
        "plan-coverage-review",
        "approval-binding-mismatch",
        `Plan Coverage Review ${field} must be a non-empty bounded string`,
        { path: field },
      );
  }
  if (value.conclusion !== "approved")
    return failure(
      "plan-coverage-review",
      "approval-binding-mismatch",
      'Plan Coverage Review must declare the explicit "approved" conclusion',
      { path: "conclusion", expected: "approved" },
    );
  if (
    typeof value.approvedAt !== "string" ||
    !isCanonicalUtcTimestamp(value.approvedAt)
  )
    return failure(
      "plan-coverage-review",
      "approval-binding-mismatch",
      "Plan Coverage Review approvedAt must be a canonical UTC timestamp",
      { path: "approvedAt" },
    );
  if (!("manifestDigest" in value))
    return failure(
      "plan-coverage-review",
      "approval-binding-mismatch",
      "Plan Coverage Review is missing manifestDigest",
      { path: "manifestDigest" },
    );
  if (typeof value.manifestDigest !== "string")
    return failure(
      "plan-coverage-review",
      "malformed-artifact",
      "Plan Coverage Review manifestDigest must be a string",
      { path: "manifestDigest" },
    );
  if (!SHA256_PATTERN.test(value.manifestDigest))
    return failure(
      "plan-coverage-review",
      "malformed-artifact",
      "manifestDigest must be lowercase hexadecimal SHA-256",
      { path: "manifestDigest" },
    );
  if (!("reviewedSources" in value))
    return failure(
      "plan-coverage-review",
      "approval-binding-mismatch",
      "Plan Coverage Review is missing reviewedSources",
      { path: "reviewedSources" },
    );
  const bindingsResult = readBindings(value.reviewedSources);
  if (!bindingsResult.ok)
    return failure(
      "plan-coverage-review",
      bindingsResult.category,
      bindingsResult.message,
      {
        path: bindingsResult.path,
        ...(bindingsResult.expected === undefined
          ? {}
          : { expected: bindingsResult.expected }),
        ...(bindingsResult.observed === undefined
          ? {}
          : { observed: bindingsResult.observed }),
      },
    );
  const review = {
    ...value,
    schemaVersion: PLAN_COVERAGE_REVIEW_SCHEMA_VERSION,
    reviewId: value.reviewId as string,
    manifestDigest: value.manifestDigest,
    coverageIndexIdentity: value.coverageIndexIdentity as string,
    conclusion: value.conclusion,
    approvedBy: value.approvedBy as string,
    approvedAt: value.approvedAt as string,
    reviewedSources: bindingsResult.bindings,
  } as PlanCoverageReview;
  return { ok: true, review, sourceDigests: bindingsResult.bindings };
}

function sameBindings(
  left: readonly GoalPlanSourceDigest[],
  right: readonly GoalPlanSourceDigest[],
): boolean {
  if (left.length !== right.length) return false;
  const rightByIdentity = new Map(
    right.map((binding) => [binding.identity, binding.sha256]),
  );
  return left.every(
    (binding) => rightByIdentity.get(binding.identity) === binding.sha256,
  );
}

function validateManifestStructure(bytes: Uint8Array):
  | {
      readonly ok: true;
      readonly manifest: GoalPlanManifest;
      readonly sourceDigests: readonly GoalPlanSourceDigest[];
    }
  | GoalPlanValidationFailure {
  const parsed = parseJson(bytes);
  if (!parsed.ok)
    return failure("goal-plan-manifest", "malformed-artifact", parsed.message);
  const schemaVersion = readSchemaVersion(parsed.value, "goal-plan-manifest");
  if (typeof schemaVersion !== "number") return schemaVersion;
  if (schemaVersion !== GOAL_PLAN_MANIFEST_SCHEMA_VERSION)
    return schemaFailure("goal-plan-manifest", schemaVersion);
  return readManifestShape(parsed.value);
}

function validateReviewStructure(bytes: Uint8Array):
  | {
      readonly ok: true;
      readonly review: PlanCoverageReview;
      readonly sourceDigests: readonly GoalPlanSourceDigest[];
    }
  | GoalPlanValidationFailure {
  const parsed = parseJson(bytes);
  if (!parsed.ok)
    return failure(
      "plan-coverage-review",
      "malformed-artifact",
      parsed.message,
    );
  const schemaVersion = readSchemaVersion(parsed.value, "plan-coverage-review");
  if (typeof schemaVersion !== "number") return schemaVersion;
  if (schemaVersion !== PLAN_COVERAGE_REVIEW_SCHEMA_VERSION)
    return schemaFailure("plan-coverage-review", schemaVersion);
  return readReviewShape(parsed.value);
}

/**
 * Validate one Goal Plan Manifest against optional caller-supplied raw source
 * facts. When facts are supplied, every declared digest is checked directly
 * against those bytes; no text or JSON normalization occurs.
 */
function validateGoalPlanManifestInput(
  manifestBytes: Uint8Array,
  sourceFacts?: GoalPlanSourceFacts,
): GoalPlanManifestValidation {
  const structure = validateManifestStructure(manifestBytes);
  if (!structure.ok) return structure;

  if (sourceFacts === undefined && structure.sourceDigests.length > 0)
    return failure(
      "goal-plan-manifest",
      "digest-mismatch",
      "raw source facts are required to verify reviewed source digests",
      {
        path: "reviewedSources",
        expected: "caller-supplied raw source bytes",
        observed: "missing",
      },
    );
  if (sourceFacts !== undefined) {
    const digestFailure = verifySourceDigests(
      structure.sourceDigests,
      sourceFacts,
      "goal-plan-manifest",
    );
    if (digestFailure !== undefined) return digestFailure;
  }

  return {
    ok: true,
    artifact: "goal-plan-manifest",
    manifest: structure.manifest,
    manifestDigest: sha256Hex(manifestBytes),
    sourceDigests: structure.sourceDigests,
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

/**
 * Validate a Plan Coverage Review against the exact Manifest bytes and, when
 * supplied, the raw source facts named by that Manifest.
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
  if (structure.review.manifestDigest !== actualManifestDigest)
    return failure(
      "plan-coverage-review",
      "approval-binding-mismatch",
      "Plan Coverage Review manifestDigest does not match the supplied Manifest bytes",
      {
        path: "manifestDigest",
        expected: structure.review.manifestDigest,
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
      `referenced Goal Plan Manifest is not valid: ${manifestResult.message}`,
      {
        path: "manifest",
        causeCategory: manifestResult.category,
      },
    );
  }

  if (!sameBindings(structure.sourceDigests, manifestResult.sourceDigests))
    return failure(
      "plan-coverage-review",
      "approval-binding-mismatch",
      "Plan Coverage Review reviewedSources do not match the Manifest bindings",
      { path: "reviewedSources" },
    );
  if (
    !manifestResult.sourceDigests.some(
      (source) => source.identity === structure.review.coverageIndexIdentity,
    )
  )
    return failure(
      "plan-coverage-review",
      "approval-binding-mismatch",
      `Coverage Index source is not bound by the Manifest: ${structure.review.coverageIndexIdentity}`,
      { path: "coverageIndexIdentity" },
    );

  return {
    ok: true,
    artifact: "plan-coverage-review",
    review: structure.review,
    reviewDigest: sha256Hex(reviewBytes),
    manifestDigest: actualManifestDigest,
    sourceDigests: manifestResult.sourceDigests,
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

function sourceBytesForExport(
  sources: readonly GoalPlanSourceBytes[],
): readonly GoalPlanSourceDigest[] {
  const identities = new Set<string>();
  return sources.map((source, index) => {
    if (!isRecord(source) || typeof source.identity !== "string")
      throw exportFailure(
        `reviewedSources[${index}] must declare a string identity`,
        "malformed-artifact",
      );
    if (source.identity.trim().length === 0)
      throw exportFailure(
        `reviewedSources[${index}].identity must not be empty`,
        "malformed-artifact",
      );
    if (identities.has(source.identity))
      throw exportFailure(
        `reviewedSources repeats identity: ${source.identity}`,
        "malformed-artifact",
      );
    if (!(source.bytes instanceof Uint8Array))
      throw exportFailure(
        `reviewedSources[${index}].bytes must be a Uint8Array`,
        "malformed-artifact",
      );
    identities.add(source.identity);
    return { identity: source.identity, sha256: sha256Hex(source.bytes) };
  });
}

function serializeArtifact(
  artifact: JsonRecord,
  artifactClass: GoalPlanArtifactClass,
): Uint8Array {
  try {
    const serialized = JSON.stringify(artifact);
    if (serialized === undefined)
      throw new Error("artifact did not serialize to JSON");
    return new TextEncoder().encode(serialized);
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

/**
 * Export a compact, newline-free v1 Goal Plan Manifest. Source digests are
 * calculated from the supplied bytes at export time.
 */
function exportGoalPlanManifestInput(
  input: GoalPlanManifestExportInput,
): Uint8Array {
  if (!isRecord(input))
    throw exportFailure(
      "Goal Plan Manifest export input must be an object",
      "malformed-artifact",
    );
  rejectUnknownExportFields(
    input,
    new Set([
      "schemaVersion",
      "planId",
      "revision",
      "goalId",
      "title",
      "nodes",
      "edges",
      "reviewedSources",
    ]),
    "goal-plan-manifest",
  );
  if (
    input.schemaVersion !== undefined &&
    input.schemaVersion !== GOAL_PLAN_MANIFEST_SCHEMA_VERSION
  )
    throw exportFailure(
      `unsupported Goal Plan Manifest schemaVersion: ${String(input.schemaVersion)}`,
      "unsupported-schema",
    );
  if (!Array.isArray(input.nodes) || !Array.isArray(input.edges))
    throw exportFailure(
      "Goal Plan Manifest export requires nodes and edges arrays",
      "malformed-artifact",
    );
  if (!Array.isArray(input.reviewedSources))
    throw exportFailure(
      "Goal Plan Manifest export requires reviewedSources",
      "malformed-artifact",
    );

  const sourceDigests = sourceBytesForExport(input.reviewedSources);
  const orderedArtifact: JsonRecord = {
    schemaVersion: GOAL_PLAN_MANIFEST_SCHEMA_VERSION,
    planId: input.planId,
    revision: input.revision,
    ...(input.goalId === undefined ? {} : { goalId: input.goalId }),
    ...(input.title === undefined ? {} : { title: input.title }),
    nodes: input.nodes,
    edges: input.edges,
    reviewedSources: sourceDigests,
  };
  const bytes = serializeArtifact(orderedArtifact, "goal-plan-manifest");
  const validation = validateGoalPlanManifest(bytes, input.reviewedSources);
  if (!validation.ok)
    throw exportFailure(
      `exported Goal Plan Manifest is invalid: ${validation.message}`,
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

/** Export a Coverage Review bound to the exact Manifest bytes and bindings. */
function exportPlanCoverageReviewInput(
  input: PlanCoverageReviewExportInput,
): Uint8Array {
  if (!isRecord(input))
    throw exportFailure(
      "Plan Coverage Review export input must be an object",
      "malformed-artifact",
    );
  rejectUnknownExportFields(
    input,
    new Set([
      "schemaVersion",
      "manifestBytes",
      "reviewId",
      "coverageIndexIdentity",
      "conclusion",
      "approvedBy",
      "approvedAt",
      "sources",
      "reviewedSources",
    ]),
    "plan-coverage-review",
  );
  if (
    input.schemaVersion !== undefined &&
    input.schemaVersion !== PLAN_COVERAGE_REVIEW_SCHEMA_VERSION
  )
    throw exportFailure(
      `unsupported Plan Coverage Review schemaVersion: ${String(input.schemaVersion)}`,
      "unsupported-schema",
    );
  const manifestSnapshot = snapshotUint8Array(input.manifestBytes);
  if (!manifestSnapshot.ok)
    throw exportFailure(
      manifestSnapshot.reason === "too-large"
        ? "Plan Coverage Review manifestBytes exceed the supported artifact size"
        : "Plan Coverage Review export requires manifestBytes",
      "malformed-artifact",
    );
  const manifestBytes = manifestSnapshot.bytes;
  const manifestStructure = validateManifestStructure(manifestBytes);
  if (!manifestStructure.ok)
    throw exportFailure(
      `cannot bind Coverage Review to invalid Manifest: ${manifestStructure.message}`,
      manifestStructure.category,
    );
  if (input.sources !== undefined) {
    const manifestValidation = validateGoalPlanManifest(
      manifestBytes,
      input.sources,
    );
    if (!manifestValidation.ok)
      throw exportFailure(
        `cannot bind Coverage Review to invalid Manifest: ${manifestValidation.message}`,
        manifestValidation.category,
      );
  }
  if (input.sources === undefined && manifestStructure.sourceDigests.length > 0)
    throw exportFailure(
      "Coverage Review export requires raw source facts for a Manifest with reviewed sources",
      "digest-mismatch",
    );

  let reviewedSources: readonly GoalPlanSourceDigest[] =
    manifestStructure.sourceDigests;
  if (input.reviewedSources !== undefined) {
    const reviewBindings = readBindings(input.reviewedSources);
    if (!reviewBindings.ok)
      throw exportFailure(
        `Coverage Review reviewedSources are invalid: ${reviewBindings.message}`,
        reviewBindings.category,
      );
    reviewedSources = reviewBindings.bindings;
  }
  if (!sameBindings(reviewedSources, manifestStructure.sourceDigests))
    throw exportFailure(
      "Coverage Review reviewedSources must match the Manifest bindings",
      "approval-binding-mismatch",
    );
  const orderedArtifact: JsonRecord = {
    schemaVersion: PLAN_COVERAGE_REVIEW_SCHEMA_VERSION,
    reviewId: input.reviewId,
    manifestDigest: sha256Hex(manifestBytes),
    coverageIndexIdentity: input.coverageIndexIdentity,
    conclusion: input.conclusion,
    approvedBy: input.approvedBy,
    approvedAt: input.approvedAt,
    reviewedSources,
  };
  const bytes = serializeArtifact(orderedArtifact, "plan-coverage-review");
  const validation = validatePlanCoverageReview(
    bytes,
    manifestBytes,
    input.sources,
  );
  if (!validation.ok)
    throw exportFailure(
      `exported Plan Coverage Review is invalid: ${validation.message}`,
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
