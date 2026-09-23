/**
 * Readiness Sidecar schema validation and batch consistency checks
 * (contract §21, §13; Story TST-030; `ADR-016`). Hand written against
 * `schemas/readiness-sidecar.schema.json` and `defs.schema.json`, sharing
 * primitives with the other hand-written validators via `revision-limits.ts`
 * (Story TST-030 Constraints: no new dependency).
 *
 * `<story>/readiness.json` is an authored definition source (`ADR-016`): its
 * criterion owners/operations, inputs, outputs, future identities, and
 * decision follow-ups are declarations nobody can infer from Story prose, so
 * this module only checks a Sidecar's *consistency* with its Story and batch
 * — never invents, completes, or infers a semantic field (Story R6). This
 * module never touches a filesystem, process, or clock.
 */

import { sha256Hex } from "./fingerprint.js";
import {
  JSON_SAFETY_DEPTH_EXCEEDED_MESSAGE,
  scanJsonSafety,
} from "./json-safety.js";
import {
  MAX_LIST_ITEMS,
  MAX_NESTING_DEPTH,
  MAX_RECORD_BYTES,
  REPO_PATH_PATTERN,
  codePointLength,
  isRecord,
  problem,
  unknownKey,
  type FieldProblem,
} from "./revision-limits.js";
import type { ReviewBatchPlanDependency } from "./types.js";

export const READINESS_SIDECAR_MAX_CRITERIA = 1000;
export const READINESS_SIDECAR_MAX_LIST_ITEMS = MAX_LIST_ITEMS;
export const READINESS_SIDECAR_MAX_OPERATIONS = 8;
export const READINESS_SIDECAR_MAX_FUTURE_IDENTITIES = 100;

const PREFIXED_SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const AC_ID_PATTERN = /^AC-[0-9]{3,}$/;
const DECLARATION_ID_PATTERN = /^\S(?:.*\S)?$/;

const OPERATIONS_ENUM = [
  "plan",
  "modify",
  "add_dependency",
  "migration",
  "commit",
  "push",
  "deploy",
  "publish",
] as const;
const OWNER_ENUM = [
  "runner_worker",
  "canonical_verification",
  "integration_final",
  "human",
  "external",
] as const;
type ReadinessOwner = (typeof OWNER_ENUM)[number];

/** Owners whose `operations` are compared against the Story's `## Authority` (contract §21). */
const AUTHORITY_COMPARED_OWNERS: ReadonlySet<string> = new Set([
  "runner_worker",
  "canonical_verification",
  "integration_final",
]);

const FUTURE_KIND_ENUM = ["commit", "publication", "release"] as const;
const AVAILABILITY_ENUM = [
  "preexisting",
  "produced_by_current_work_item",
  "prerequisite",
  "external",
] as const;

const TOP_KEYS = [
  "schema_version",
  "story_ref",
  "story_md_digest",
  "acceptance_md_digest",
  "criteria",
  "inputs",
  "outputs",
  "decision_follow_ups",
];
const CRITERION_KEYS = ["id", "operations", "owner", "future_identities"];
const FUTURE_IDENTITY_KEYS = ["kind", "availability", "prerequisite_story_ref"];
const INPUT_KEYS = ["id", "source"];
const SOURCE_KEYS = [
  "preexisting_artifact",
  "prerequisite_output",
  "external_preexisting",
];
const OUTPUT_KEYS = ["id"];
const DECISION_FOLLOW_UP_KEYS = ["gate_id", "choice", "follow_up_story_ref"];

export interface ReadinessFutureIdentity {
  readonly kind: (typeof FUTURE_KIND_ENUM)[number];
  readonly availability: (typeof AVAILABILITY_ENUM)[number];
  readonly prerequisiteStoryRef?: string;
}

export interface ReadinessCriterion {
  readonly id: string;
  readonly operations: readonly string[];
  readonly owner: ReadinessOwner;
  readonly futureIdentities: readonly ReadinessFutureIdentity[];
}

export interface ReadinessInput {
  readonly id: string;
  readonly preexistingArtifactPath?: string;
  readonly prerequisiteOutputId?: string;
  readonly externalPreexistingIdentity?: string;
}

export interface ReadinessOutput {
  readonly id: string;
}

export interface ReadinessDecisionFollowUp {
  readonly gateId: string;
  readonly choice: string;
  readonly followUpStoryRef: string;
}

export interface ReadinessSidecarData {
  readonly storyRef: string;
  readonly storyMdDigest: string;
  readonly acceptanceMdDigest: string;
  readonly criteria: readonly ReadinessCriterion[];
  readonly inputs: readonly ReadinessInput[];
  readonly outputs: readonly ReadinessOutput[];
  readonly decisionFollowUps: readonly ReadinessDecisionFollowUp[];
}

export type ReadinessSidecarParseResult =
  | {
      readonly ok: true;
      readonly data: ReadinessSidecarData;
      /**
       * The exact `JSON.parse` result (after `scanJsonSafety` has already
       * ruled out a duplicate key), before any normalization: mutating only
       * this value's `story_md_digest`/`acceptance_md_digest` fields and
       * re-serializing it (`JSON.stringify(raw, null, 2)`) is how `review
       * readiness-digests` rewrites a Sidecar while preserving every other
       * field's original key order (contract §21 R4) — object key insertion
       * order is exactly source order for `JSON.parse`, so this is the one
       * value that carries it. `JSON.parse` defines each property directly
       * rather than through `[[Set]]`, so an authored `"__proto__"` key here
       * is an ordinary own property, never the object's prototype.
       */
      readonly raw: Record<string, unknown>;
    }
  | {
      readonly ok: false;
      readonly tooLarge: boolean;
      readonly message: string;
    };

function repoPathProblem(
  value: unknown,
  name: string,
): FieldProblem | undefined {
  if (typeof value !== "string" || value.length === 0)
    return problem(`${name} must be a non-empty string`);
  if (value.length > 2048 || codePointLength(value) > 1024)
    return problem(`${name} exceeds 1024 characters`);
  if (!REPO_PATH_PATTERN.test(value))
    return problem(`${name} has an invalid form`);
  return undefined;
}

function declarationIdProblem(
  value: unknown,
  name: string,
): FieldProblem | undefined {
  if (typeof value !== "string" || value.length === 0)
    return problem(`${name} must be a non-empty string`);
  if (codePointLength(value) > 256)
    return problem(`${name} exceeds 256 characters`);
  if (!DECLARATION_ID_PATTERN.test(value))
    return problem(`${name} has an invalid form (leading/trailing whitespace)`);
  return undefined;
}

function validateFutureIdentityShape(value: unknown): FieldProblem | undefined {
  if (!isRecord(value))
    return problem("each future identity must be an object");
  const extra = unknownKey(value, FUTURE_IDENTITY_KEYS);
  if (extra !== undefined)
    return problem("future identity has an unknown field");
  if (!(FUTURE_KIND_ENUM as readonly string[]).includes(value.kind as string))
    return problem("future identity kind has an invalid value");
  if (
    !(AVAILABILITY_ENUM as readonly string[]).includes(
      value.availability as string,
    )
  )
    return problem("future identity availability has an invalid value");
  const isPrerequisite = value.availability === "prerequisite";
  if (isPrerequisite) {
    const found = repoPathProblem(
      value.prerequisite_story_ref,
      "future identity prerequisite_story_ref",
    );
    if (found) return found;
  } else if ("prerequisite_story_ref" in value) {
    return problem(
      "future identity prerequisite_story_ref is only allowed when availability is prerequisite",
    );
  }
  return undefined;
}

function validateCriterionShape(value: unknown): FieldProblem | undefined {
  if (!isRecord(value)) return problem("each criterion must be an object");
  const extra = unknownKey(value, CRITERION_KEYS);
  if (extra !== undefined) return problem("criterion has an unknown field");
  if (typeof value.id !== "string" || !AC_ID_PATTERN.test(value.id))
    return problem("criterion id must match AC-<digits>");
  if (
    !Array.isArray(value.operations) ||
    value.operations.length > READINESS_SIDECAR_MAX_OPERATIONS
  )
    return problem("criterion operations must be an array");
  if (new Set(value.operations).size !== value.operations.length)
    return problem("criterion operations must not repeat a value");
  for (const operation of value.operations) {
    if (!(OPERATIONS_ENUM as readonly string[]).includes(operation as string))
      return problem("criterion operations has an invalid value");
  }
  if (!(OWNER_ENUM as readonly string[]).includes(value.owner as string))
    return problem("criterion owner has an invalid value");
  if (
    !Array.isArray(value.future_identities) ||
    value.future_identities.length > READINESS_SIDECAR_MAX_FUTURE_IDENTITIES
  )
    return problem("criterion future_identities must be an array");
  for (const identity of value.future_identities) {
    const found = validateFutureIdentityShape(identity);
    if (found) return found;
  }
  return undefined;
}

function validateInputSourceShape(value: unknown): FieldProblem | undefined {
  if (!isRecord(value)) return problem("input source must be an object");
  const extra = unknownKey(value, SOURCE_KEYS);
  if (extra !== undefined) return problem("input source has an unknown field");
  const present = SOURCE_KEYS.filter((key) => key in value);
  if (present.length !== 1)
    return problem("input source must declare exactly one field");
  if (value.preexisting_artifact !== undefined) {
    if (!isRecord(value.preexisting_artifact))
      return problem("input source preexisting_artifact must be an object");
    const nested = unknownKey(value.preexisting_artifact, ["path"]);
    if (nested !== undefined)
      return problem("input source preexisting_artifact has an unknown field");
    const found = repoPathProblem(
      value.preexisting_artifact.path,
      "input source preexisting_artifact.path",
    );
    if (found) return found;
    return undefined;
  }
  if (value.prerequisite_output !== undefined) {
    if (!isRecord(value.prerequisite_output))
      return problem("input source prerequisite_output must be an object");
    const nested = unknownKey(value.prerequisite_output, ["output_id"]);
    if (nested !== undefined)
      return problem("input source prerequisite_output has an unknown field");
    const found = declarationIdProblem(
      value.prerequisite_output.output_id,
      "input source prerequisite_output.output_id",
    );
    if (found) return found;
    return undefined;
  }
  if (!isRecord(value.external_preexisting))
    return problem("input source external_preexisting must be an object");
  const nested = unknownKey(value.external_preexisting, ["identity"]);
  if (nested !== undefined)
    return problem("input source external_preexisting has an unknown field");
  return declarationIdProblem(
    value.external_preexisting.identity,
    "input source external_preexisting.identity",
  );
}

function validateInputShape(value: unknown): FieldProblem | undefined {
  if (!isRecord(value)) return problem("each input must be an object");
  const extra = unknownKey(value, INPUT_KEYS);
  if (extra !== undefined) return problem("input has an unknown field");
  const idProblem = declarationIdProblem(value.id, "input id");
  if (idProblem) return idProblem;
  return validateInputSourceShape(value.source);
}

function validateOutputShape(value: unknown): FieldProblem | undefined {
  if (!isRecord(value)) return problem("each output must be an object");
  const extra = unknownKey(value, OUTPUT_KEYS);
  if (extra !== undefined) return problem("output has an unknown field");
  return declarationIdProblem(value.id, "output id");
}

function validateDecisionFollowUpShape(
  value: unknown,
): FieldProblem | undefined {
  if (!isRecord(value))
    return problem("each decision follow-up must be an object");
  const extra = unknownKey(value, DECISION_FOLLOW_UP_KEYS);
  if (extra !== undefined)
    return problem("decision follow-up has an unknown field");
  const gateProblem = declarationIdProblem(
    value.gate_id,
    "decision follow-up gate_id",
  );
  if (gateProblem) return gateProblem;
  const choiceProblem = declarationIdProblem(
    value.choice,
    "decision follow-up choice",
  );
  if (choiceProblem) return choiceProblem;
  return repoPathProblem(
    value.follow_up_story_ref,
    "decision follow-up follow_up_story_ref",
  );
}

/** Same field-by-field shape as `readiness-sidecar.schema.json`'s top level. */
function validateSidecarShape(data: unknown): FieldProblem | undefined {
  if (!isRecord(data))
    return problem("readiness.json does not match the expected schema");
  if (data.schema_version !== 1)
    return problem("schema_version is not supported", false, true);
  const extra = unknownKey(data, TOP_KEYS);
  if (extra !== undefined)
    return problem("readiness.json has an unknown field");

  const storyRefProblem = repoPathProblem(data.story_ref, "story_ref");
  if (storyRefProblem) return storyRefProblem;

  if (
    typeof data.story_md_digest !== "string" ||
    !PREFIXED_SHA256_PATTERN.test(data.story_md_digest)
  )
    return problem("story_md_digest has an invalid form");
  if (
    typeof data.acceptance_md_digest !== "string" ||
    !PREFIXED_SHA256_PATTERN.test(data.acceptance_md_digest)
  )
    return problem("acceptance_md_digest has an invalid form");

  if (
    !Array.isArray(data.criteria) ||
    data.criteria.length === 0 ||
    data.criteria.length > READINESS_SIDECAR_MAX_CRITERIA
  )
    return problem("criteria must be a non-empty array");
  // ForgePilot's `contractDefects` rejects a duplicate criterion id; tracked
  // by index only, never echoing the (schema-constrained, but still
  // Sidecar-authored) id value itself.
  const seenCriterionIds = new Set<string>();
  for (let index = 0; index < data.criteria.length; index += 1) {
    const criterion = data.criteria[index];
    const found = validateCriterionShape(criterion);
    if (found) return found;
    const id = (criterion as Record<string, unknown>).id as string;
    if (seenCriterionIds.has(id))
      return problem(`criteria[${index}].id duplicates an earlier criterion`);
    seenCriterionIds.add(id);
  }

  if (
    !Array.isArray(data.inputs) ||
    data.inputs.length > READINESS_SIDECAR_MAX_LIST_ITEMS
  )
    return problem("inputs must be an array");
  const seenInputIds = new Set<string>();
  for (let index = 0; index < data.inputs.length; index += 1) {
    const input = data.inputs[index];
    const found = validateInputShape(input);
    if (found) return found;
    const id = (input as Record<string, unknown>).id as string;
    if (seenInputIds.has(id))
      return problem(`inputs[${index}].id duplicates an earlier input`);
    seenInputIds.add(id);
  }

  if (
    !Array.isArray(data.outputs) ||
    data.outputs.length > READINESS_SIDECAR_MAX_LIST_ITEMS
  )
    return problem("outputs must be an array");
  for (const output of data.outputs) {
    const found = validateOutputShape(output);
    if (found) return found;
  }

  if (
    !Array.isArray(data.decision_follow_ups) ||
    data.decision_follow_ups.length > READINESS_SIDECAR_MAX_LIST_ITEMS
  )
    return problem("decision_follow_ups must be an array");
  for (const followUp of data.decision_follow_ups) {
    const found = validateDecisionFollowUpShape(followUp);
    if (found) return found;
  }

  return undefined;
}

function toReadinessData(data: {
  readonly story_ref: string;
  readonly story_md_digest: string;
  readonly acceptance_md_digest: string;
  readonly criteria: readonly unknown[];
  readonly inputs: readonly unknown[];
  readonly outputs: readonly unknown[];
  readonly decision_follow_ups: readonly unknown[];
}): ReadinessSidecarData {
  const criteria = data.criteria.map((entry) => {
    const record = entry as Record<string, unknown>;
    const futureIdentities = (
      record.future_identities as readonly Record<string, unknown>[]
    ).map((identity) => ({
      kind: identity.kind as ReadinessFutureIdentity["kind"],
      availability:
        identity.availability as ReadinessFutureIdentity["availability"],
      ...(identity.prerequisite_story_ref === undefined
        ? {}
        : {
            prerequisiteStoryRef: identity.prerequisite_story_ref as string,
          }),
    }));
    return {
      id: record.id as string,
      operations: record.operations as readonly string[],
      owner: record.owner as ReadinessOwner,
      futureIdentities,
    };
  });

  const inputs = data.inputs.map((entry) => {
    const record = entry as Record<string, unknown>;
    const source = record.source as Record<string, unknown>;
    if (isRecord(source.preexisting_artifact))
      return {
        id: record.id as string,
        preexistingArtifactPath: (
          source.preexisting_artifact as Record<string, unknown>
        ).path as string,
      };
    if (isRecord(source.prerequisite_output))
      return {
        id: record.id as string,
        prerequisiteOutputId: (
          source.prerequisite_output as Record<string, unknown>
        ).output_id as string,
      };
    return {
      id: record.id as string,
      externalPreexistingIdentity: (
        source.external_preexisting as Record<string, unknown>
      ).identity as string,
    };
  });

  const outputs = data.outputs.map((entry) => ({
    id: (entry as Record<string, unknown>).id as string,
  }));

  const decisionFollowUps = data.decision_follow_ups.map((entry) => {
    const record = entry as Record<string, unknown>;
    return {
      gateId: record.gate_id as string,
      choice: record.choice as string,
      followUpStoryRef: record.follow_up_story_ref as string,
    };
  });

  return {
    storyRef: data.story_ref,
    storyMdDigest: data.story_md_digest,
    acceptanceMdDigest: data.acceptance_md_digest,
    criteria,
    inputs,
    outputs,
    decisionFollowUps,
  };
}

/**
 * Parses and validates one `readiness.json`'s bytes against contract §13's
 * size/nesting/string limits and `readiness-sidecar.schema.json`'s shape,
 * including that `story_ref` equals the Story directory that owns it
 * (contract §21). Never checks digests, criteria, operations, or references
 * against anything else — see `checkReadinessSidecarConsistency`.
 */
export function parseReadinessSidecar(
  bytes: Uint8Array,
  expectedStoryRef: string,
): ReadinessSidecarParseResult {
  if (bytes.byteLength > MAX_RECORD_BYTES)
    return {
      ok: false,
      tooLarge: true,
      message: `readiness.json exceeds ${MAX_RECORD_BYTES} bytes`,
    };

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return {
      ok: false,
      tooLarge: false,
      message: "readiness.json is not valid UTF-8",
    };
  }

  // HIGH-2 (code review round 2): scanned for duplicate object keys and
  // pathological nesting *before* `JSON.parse` ever sees the text — never
  // by a hand-written parser that assigns into a plain object (`obj[key] =
  // value`), which would let a `"__proto__"` key reach the
  // `Object.prototype.__proto__` accessor. `JSON.parse` itself defines each
  // property directly, so a `"__proto__"` key becomes an ordinary own data
  // property once this scan has ruled out a duplicate hiding it.
  const safetyFailure = scanJsonSafety(text, MAX_NESTING_DEPTH);
  if (safetyFailure !== undefined) {
    // The scan's own message may quote a duplicated key's name; never
    // surfaced verbatim (HIGH-1). Only "exceeds the supported depth" is a
    // fixed, content-free string, and the one case §13 treats as a size
    // limit rather than an ordinary invalidity.
    const tooLarge = safetyFailure === JSON_SAFETY_DEPTH_EXCEEDED_MESSAGE;
    return {
      ok: false,
      tooLarge,
      message: tooLarge
        ? `readiness.json nesting depth exceeds ${MAX_NESTING_DEPTH}`
        : "readiness.json is not valid JSON",
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      ok: false,
      tooLarge: false,
      message: "readiness.json is not valid JSON",
    };
  }

  // A single string over the 64 KiB bound anywhere in the document is
  // checked field by field below via `unicodeLengthGuard`-style problems on
  // every string field the schema defines; readiness.json carries no
  // free-text field long enough to need a dedicated string-length scan
  // (every string field is bounded well under 64 KiB by its own pattern),
  // so no separate whole-document string scan is required here.

  const shapeProblem = validateSidecarShape(parsed);
  if (shapeProblem)
    return {
      ok: false,
      tooLarge: shapeProblem.tooLarge,
      message: shapeProblem.message,
    };

  const record = parsed as {
    readonly story_ref: string;
    readonly story_md_digest: string;
    readonly acceptance_md_digest: string;
    readonly criteria: readonly unknown[];
    readonly inputs: readonly unknown[];
    readonly outputs: readonly unknown[];
    readonly decision_follow_ups: readonly unknown[];
  };

  if (record.story_ref !== expectedStoryRef)
    return {
      ok: false,
      tooLarge: false,
      // HIGH-1: never echo the Sidecar's own (attacker-controlled)
      // `story_ref` string; the field name is enough to locate the defect.
      message: "story_ref does not match the Story directory",
    };

  return {
    ok: true,
    data: toReadinessData(record),
    raw: parsed as Record<string, unknown>,
  };
}

export interface ReadinessSidecarStoryContext {
  readonly storyDirectory: string;
  readonly storyMdBytes: Uint8Array;
  readonly acceptanceMdBytes: Uint8Array;
  readonly acceptanceIds: readonly string[];
  /** Every operation the Story's `## Authority` marks `yes`. */
  readonly grantedOperations: ReadonlySet<string>;
  /** The Story's transitive `dependsOn` closure (manifest `dependencies`), by Story directory. */
  readonly dependencyClosure: ReadonlySet<string>;
}

export interface ReadinessSidecarFinding {
  readonly storyDirectory: string;
  readonly code:
    | "REVIEW_READINESS_STALE"
    | "REVIEW_READINESS_CRITERIA_MISMATCH"
    | "REVIEW_READINESS_OPERATION_UNGRANTED"
    | "REVIEW_READINESS_REFERENCE_UNKNOWN";
  readonly message: string;
}

/**
 * Checks one parsed, schema-valid Sidecar's consistency with its own Story
 * (digests, criteria ids, operations versus Authority) — everything contract
 * §21's table checks except cross-batch references, which need every batch
 * Story's declared outputs and directories (`checkReadinessSidecarReferences`
 * below). Never checks schema shape (`parseReadinessSidecar`) and never
 * proves a declaration is *true*, only consistent (Story Rule "驗證宣告與
 * Story、批次一致，不證明宣告正確").
 */
export function checkReadinessSidecarConsistency(
  data: ReadinessSidecarData,
  context: ReadinessSidecarStoryContext,
): readonly ReadinessSidecarFinding[] {
  const findings: ReadinessSidecarFinding[] = [];
  const storyDigest = `sha256:${sha256Hex(context.storyMdBytes)}`;
  const acceptanceDigest = `sha256:${sha256Hex(context.acceptanceMdBytes)}`;
  if (
    data.storyMdDigest !== storyDigest ||
    data.acceptanceMdDigest !== acceptanceDigest
  ) {
    findings.push({
      storyDirectory: context.storyDirectory,
      code: "REVIEW_READINESS_STALE",
      message: `readiness.json digests do not match the current story.md/acceptance.md bytes: ${context.storyDirectory}`,
    });
  }

  // Compared as lists, not sets (Human Review 2026-09-23): same length and
  // the same id at each position, matching ForgePilot's slice-based
  // comparison — a reordering or a repeated id (already rejected at parse
  // time, `validateSidecarShape`) is not silently accepted by a set's
  // deduplication.
  const criteriaIds = data.criteria.map((criterion) => criterion.id);
  const sameList =
    criteriaIds.length === context.acceptanceIds.length &&
    criteriaIds.every((id, index) => id === context.acceptanceIds[index]);
  if (!sameList) {
    findings.push({
      storyDirectory: context.storyDirectory,
      code: "REVIEW_READINESS_CRITERIA_MISMATCH",
      message: `readiness.json criteria ids do not match acceptance.md's AC ids: ${context.storyDirectory}`,
    });
  }

  for (const criterion of data.criteria) {
    if (!AUTHORITY_COMPARED_OWNERS.has(criterion.owner)) continue;
    for (const operation of criterion.operations) {
      const grantedByAuthority = context.grantedOperations.has(operation);
      const allowedForOwner =
        criterion.owner !== "runner_worker" ||
        operation === "plan" ||
        operation === "modify";
      if (!grantedByAuthority || !allowedForOwner) {
        findings.push({
          storyDirectory: context.storyDirectory,
          code: "REVIEW_READINESS_OPERATION_UNGRANTED",
          message: `readiness.json criterion ${criterion.id} declares an operation its owner ${criterion.owner} may not perform: ${operation}`,
        });
      }
    }
  }

  return findings;
}

export interface ReadinessSidecarBatchContext {
  /** Every batch Story directory (contract §21 `follow_up_story_ref` must be one of these). */
  readonly batchStoryDirectories: ReadonlySet<string>;
  /** `outputs[].id` -> the Story directories that declare it (for uniqueness and `prerequisite_output` resolution). */
  readonly outputOwners: ReadonlyMap<string, readonly string[]>;
}

/**
 * Checks one Sidecar's cross-batch references (contract §21's last row):
 * `prerequisite_story_ref`/the Story owning a `prerequisite_output` must be
 * in the Story's dependency closure; `follow_up_story_ref` must name a batch
 * Story; `outputs[].id` must be unique across the batch. Kept apart from
 * `checkReadinessSidecarConsistency` because it needs every batch Sidecar's
 * declared outputs, not just this one's.
 */
export function checkReadinessSidecarReferences(
  data: ReadinessSidecarData,
  context: ReadinessSidecarStoryContext,
  batch: ReadinessSidecarBatchContext,
): readonly ReadinessSidecarFinding[] {
  const findings: ReadinessSidecarFinding[] = [];
  const finding = (message: string): ReadinessSidecarFinding => ({
    storyDirectory: context.storyDirectory,
    code: "REVIEW_READINESS_REFERENCE_UNKNOWN",
    message,
  });

  // Every message below (HIGH-1) names only a field path and array index —
  // never a criterion id, gate id, output id, or any Sidecar-authored
  // string — so hostile Sidecar content can never reach an issue message.
  data.criteria.forEach((criterion, criterionIndex) => {
    criterion.futureIdentities.forEach((identity, identityIndex) => {
      if (identity.availability !== "prerequisite") return;
      const ref = identity.prerequisiteStoryRef;
      if (ref === undefined || !context.dependencyClosure.has(ref)) {
        findings.push(
          finding(
            `criteria[${criterionIndex}].future_identities[${identityIndex}].prerequisite_story_ref is outside the Story's dependency closure`,
          ),
        );
      }
    });
  });

  data.inputs.forEach((input, inputIndex) => {
    if (input.prerequisiteOutputId === undefined) return;
    const owners = batch.outputOwners.get(input.prerequisiteOutputId) ?? [];
    const owned = owners.some((owner) => context.dependencyClosure.has(owner));
    if (!owned) {
      findings.push(
        finding(
          `inputs[${inputIndex}].source.prerequisite_output.output_id is not owned by a Story in the dependency closure`,
        ),
      );
    }
  });

  data.decisionFollowUps.forEach((followUp, followUpIndex) => {
    if (!batch.batchStoryDirectories.has(followUp.followUpStoryRef)) {
      findings.push(
        finding(
          `decision_follow_ups[${followUpIndex}].follow_up_story_ref is outside the batch`,
        ),
      );
    }
  });

  // LOW: reported once per duplicated id, not once per occurrence.
  const reportedOutputIds = new Set<string>();
  data.outputs.forEach((output, outputIndex) => {
    if (reportedOutputIds.has(output.id)) return;
    const owners = batch.outputOwners.get(output.id) ?? [];
    if (owners.length > 1) {
      findings.push(
        finding(
          `outputs[${outputIndex}].id is declared by more than one Story`,
        ),
      );
    }
    reportedOutputIds.add(output.id);
  });

  return findings;
}

/** Builds `outputOwners` for `checkReadinessSidecarReferences`: every parsed Sidecar's `outputs[].id`, keyed to the Story directories that declare it. */
export function buildReadinessOutputOwners(
  sidecarsByStoryDirectory: ReadonlyMap<string, ReadinessSidecarData>,
): ReadonlyMap<string, readonly string[]> {
  const owners = new Map<string, string[]>();
  for (const [storyDirectory, data] of sidecarsByStoryDirectory) {
    for (const output of data.outputs) {
      const list = owners.get(output.id) ?? [];
      list.push(storyDirectory);
      owners.set(output.id, list);
    }
  }
  return owners;
}

/** The transitive `dependsOn` closure of one Story ID over manifest `dependencies`, resolved to Story directories via `directoryByStoryId`. Iterative (no recursion), so a long dependency chain cannot exhaust the call stack. */
export function transitiveDependencyClosureDirectories(
  storyId: string,
  dependencies: readonly ReviewBatchPlanDependency[],
  directoryByStoryId: ReadonlyMap<string, string>,
): ReadonlySet<string> {
  const edges = new Map<string, readonly string[]>(
    dependencies.map((entry) => [entry.story, entry.dependsOn] as const),
  );
  const visited = new Set<string>();
  const stack: string[] = [...(edges.get(storyId) ?? [])];
  while (stack.length > 0) {
    const next = stack.pop() as string;
    if (visited.has(next)) continue;
    visited.add(next);
    for (const dependsOn of edges.get(next) ?? []) stack.push(dependsOn);
  }
  // A cycle (already its own blocking diagnostic, `REVIEW_DEPENDENCY_CYCLE`)
  // could otherwise walk back to `storyId` itself; the Story's own directory
  // is never part of its own dependency closure.
  visited.delete(storyId);
  const directories = new Set<string>();
  for (const id of visited) {
    const directory = directoryByStoryId.get(id);
    if (directory !== undefined) directories.add(directory);
  }
  return directories;
}
