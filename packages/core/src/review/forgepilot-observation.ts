/**
 * Pure validation for one ForgePilot observation (contract §22, Story
 * TST-032): hand-written against
 * `schemas/forgepilot-observation.schema.json` (`schemaVersion` `2.0.0`,
 * same primitives as the other record validators, `revision-limits.ts`),
 * plus the §11/§22 step-consistency rules (R2/R3). The CLI (`review
 * observe`) owns every filesystem access — reading the observation file,
 * locating and reading the Goal Plan Manifest it names, and writing the
 * accepted record — and passes this module only bytes and facts already in
 * hand: the manifest's own `batchId` and the named Goal Plan Manifest's raw
 * bytes (`undefined` when it could not be read at all, folded into the same
 * `REVIEW_OBSERVATION_INVALID` rejection as a wrong sha256 or an outside
 * path per §22). This module never touches a filesystem, process, or clock,
 * and never compares the observation's `fingerprint` against the Goal Plan
 * Manifest's `coverageIndex.fingerprint` (Story TST-032's Human Review
 * decision — that binding is out of scope).
 */

import {
  BATCH_ID_PATTERN,
  MAX_BATCH_ID_LENGTH,
  REPO_PATH_PATTERN,
  SHA256_PATTERN,
  boundedStringProblem,
  isRecord,
  isUtcDateTime,
  problem,
  rawJsonMaxDepth,
  unknownKey,
  type FieldProblem,
} from "./revision-limits.js";
import { sha256Hex } from "./fingerprint.js";

const STORY_ID_PATTERN = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-[0-9]+$/;
const GOAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const FORGEPILOT_VERSION_PATTERN = /^[a-f0-9]{40}$/;
const WORK_ITEM_ID_PATTERN = /^WI-[0-9]+$/;
const MAX_STEPS = 2000;
/** The schema's `steps[].stdout`/`stderr` `maxLength` — a deliberate exemption from the ordinary 64 KiB text limit (contract §13). */
const MAX_STEP_OUTPUT_LENGTH = 1048576;
/** The Goal Plan Manifest's own depth bound (contract §10: Manifest/Coverage Review ≤ 128 layers) — distinct from the observation's own 32-layer bound (§13) checked above. */
const MAX_GOAL_PLAN_MANIFEST_NESTING_DEPTH = 128;
/** `defs.schema.json`'s `storyId` bound. */
const MAX_STORY_ID_LENGTH = 64;

const STEP_COMMANDS = [
  "preflight",
  "work-list",
  "goal-create",
  "work-add",
  "goal-preflight",
  "execution-plan",
  "run-dry-run",
  "run",
] as const;
type StepCommand = (typeof STEP_COMMANDS)[number];

const STOPPED_BECAUSE_VALUES = [
  "awaiting-authorization",
  "goal-completed",
  "run-needs-human",
  "run-limit-reached",
  "run-interrupted",
  "run-failed",
  "authorization-missing",
  "preflight-not-ready",
  "goal-mismatch",
  "work-mismatch",
  "goal-preflight-failed",
  "step-failed",
  "result-unknown",
] as const;
type StoppedBecause = (typeof STOPPED_BECAUSE_VALUES)[number];

export interface ForgepilotObservationStep {
  readonly command: StepCommand;
  readonly story?: string;
  readonly workItemId?: string;
  readonly created?: boolean;
  readonly exit: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly truncated?: boolean;
  readonly originalStdoutBytes?: number;
  readonly originalStderrBytes?: number;
}

export interface ForgepilotObservationData {
  readonly schemaVersion: "2.0.0";
  readonly batchId: string;
  readonly fingerprint: string;
  readonly goalPlan: { readonly path: string; readonly sha256: string };
  readonly goalId?: string;
  readonly forgepilotVersion: string;
  readonly observedAt: string;
  readonly steps: readonly ForgepilotObservationStep[];
  readonly stoppedBecause: StoppedBecause;
}

const RECORD_KEYS = [
  "schemaVersion",
  "batchId",
  "fingerprint",
  "goalPlan",
  "goalId",
  "forgepilotVersion",
  "observedAt",
  "steps",
  "stoppedBecause",
];

const STEP_KEYS = [
  "command",
  "story",
  "workItemId",
  "created",
  "exit",
  "stdout",
  "stderr",
  "truncated",
  "originalStdoutBytes",
  "originalStderrBytes",
];

function stepOutputProblem(
  value: unknown,
  name: string,
): FieldProblem | undefined {
  if (typeof value !== "string") return problem(`${name} must be a string`);
  if (value.length > MAX_STEP_OUTPUT_LENGTH)
    return problem(`${name} exceeds the step output limit`, true);
  return undefined;
}

function goalPlanRefProblem(value: unknown): FieldProblem | undefined {
  if (!isRecord(value)) return problem("goalPlan must be an object");
  const extra = unknownKey(value, ["path", "sha256"]);
  if (extra !== undefined) return problem("goalPlan has an unknown field");
  const pathProblem = boundedStringProblem(value.path, "goalPlan path");
  if (pathProblem) return pathProblem;
  if (!REPO_PATH_PATTERN.test(value.path as string))
    return problem("goalPlan path has an invalid form");
  if (typeof value.sha256 !== "string" || !SHA256_PATTERN.test(value.sha256))
    return problem("goalPlan sha256 has an invalid form");
  return undefined;
}

function stepProblem(value: unknown): FieldProblem | undefined {
  if (!isRecord(value)) return problem("each step must be an object");
  const extra = unknownKey(value, STEP_KEYS);
  if (extra !== undefined) return problem("step has an unknown field");
  if (
    typeof value.command !== "string" ||
    !(STEP_COMMANDS as readonly string[]).includes(value.command)
  )
    return problem("step command has an invalid value");
  if (value.story !== undefined) {
    if (
      typeof value.story !== "string" ||
      value.story.length > MAX_STORY_ID_LENGTH ||
      !STORY_ID_PATTERN.test(value.story)
    )
      return problem("step story has an invalid form");
  }
  if (value.workItemId !== undefined) {
    if (
      typeof value.workItemId !== "string" ||
      !WORK_ITEM_ID_PATTERN.test(value.workItemId)
    )
      return problem("step workItemId has an invalid form");
  }
  if (value.created !== undefined && typeof value.created !== "boolean")
    return problem("step created must be a boolean");
  if (
    value.exit !== null &&
    (typeof value.exit !== "number" || !Number.isInteger(value.exit))
  )
    return problem("step exit must be an integer or null");
  const stdoutProblem = stepOutputProblem(value.stdout, "step stdout");
  if (stdoutProblem) return stdoutProblem;
  const stderrProblem = stepOutputProblem(value.stderr, "step stderr");
  if (stderrProblem) return stderrProblem;
  if (value.truncated !== undefined && typeof value.truncated !== "boolean")
    return problem("step truncated must be a boolean");
  if (
    value.originalStdoutBytes !== undefined &&
    (typeof value.originalStdoutBytes !== "number" ||
      !Number.isInteger(value.originalStdoutBytes) ||
      value.originalStdoutBytes < 0)
  )
    return problem("step originalStdoutBytes must be a non-negative integer");
  if (
    value.originalStderrBytes !== undefined &&
    (typeof value.originalStderrBytes !== "number" ||
      !Number.isInteger(value.originalStderrBytes) ||
      value.originalStderrBytes < 0)
  )
    return problem("step originalStderrBytes must be a non-negative integer");
  return undefined;
}

/** Same field-by-field shape as `forgepilot-observation.schema.json`. */
function validateObservationShape(data: unknown): FieldProblem | undefined {
  if (!isRecord(data))
    return problem("data does not match the expected schema");
  if (data.schemaVersion !== "2.0.0")
    return problem("schemaVersion is not supported", false, true);
  const extra = unknownKey(data, RECORD_KEYS);
  if (extra !== undefined) return problem("observation has an unknown field");
  if (
    typeof data.batchId !== "string" ||
    data.batchId.length > MAX_BATCH_ID_LENGTH ||
    !BATCH_ID_PATTERN.test(data.batchId)
  )
    return problem("batchId has an invalid form");
  if (
    typeof data.fingerprint !== "string" ||
    !SHA256_PATTERN.test(data.fingerprint)
  )
    return problem("fingerprint has an invalid form");
  const goalPlanProblem = goalPlanRefProblem(data.goalPlan);
  if (goalPlanProblem) return goalPlanProblem;
  if (data.goalId !== undefined) {
    if (typeof data.goalId !== "string" || !GOAL_ID_PATTERN.test(data.goalId))
      return problem("goalId has an invalid form");
  }
  if (
    typeof data.forgepilotVersion !== "string" ||
    !FORGEPILOT_VERSION_PATTERN.test(data.forgepilotVersion)
  )
    return problem("forgepilotVersion has an invalid form");
  if (!isUtcDateTime(data.observedAt))
    return problem("observedAt must be a UTC date-time");
  if (!Array.isArray(data.steps)) return problem("steps must be an array");
  if (data.steps.length > MAX_STEPS)
    return problem(`steps exceeds the limit (${MAX_STEPS})`, true);
  for (const step of data.steps) {
    const found = stepProblem(step);
    if (found) return found;
  }
  if (
    typeof data.stoppedBecause !== "string" ||
    !(STOPPED_BECAUSE_VALUES as readonly string[]).includes(data.stoppedBecause)
  )
    return problem("stoppedBecause has an invalid value");
  return undefined;
}

/**
 * A rejection message paired with a JSON Pointer (RFC 6901) naming the
 * offending field — never a filesystem path (code review round 2 N1: the
 * CLI has no safe, schema-conforming place to put a raw JSON Pointer on
 * `ResultIssue` itself, so it is carried in `data.diagnostics[]` instead;
 * see `review-observe.ts`).
 */
interface FieldRejection {
  readonly message: string;
  readonly pointer: string;
}

/**
 * R2: step order rules, independent of `stoppedBecause`. Contract §11 step
 * 3/§22 (Human Review 2026-09-24, H2): ForgePilot `32b7a68` has no
 * machine-readable Goal existence query — an unknown Goal only makes `work
 * list` exit non-zero and report `unknown goal` on stderr, which §11
 * forbids the Agent from parsing — and `goal create` itself rejects a
 * duplicate Goal ID, so the Agent tries `goal create` unconditionally after
 * a non-zero `work list` and lets ForgePilot's own exit decide. This is the
 * one exception to "every step but the last exits 0": a non-zero, *non-null*
 * `work-list` exit is allowed as a non-last step only when the very next
 * step is `goal-create`; every other non-last non-zero (or `null`) step is
 * still rejected, and `goal-create` itself gets no such exception.
 */
function stepOrderProblem(
  steps: readonly ForgepilotObservationStep[],
): FieldRejection | undefined {
  let sawDryRunExitZero = false;
  const lifecycleCommands = new Set(["run-dry-run", "run"]);
  const creationCommands = new Set(["goal-create", "work-add"]);
  const hasLifecycle = steps.some((step) =>
    lifecycleCommands.has(step.command),
  );
  const hasCreation = steps.some((step) => creationCommands.has(step.command));
  if (hasLifecycle && hasCreation)
    return {
      message:
        "run-dry-run or run cannot share a record with goal-create or work-add",
      pointer: "/steps",
    };

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index] as ForgepilotObservationStep;
    if (step.command === "run" && !sawDryRunExitZero)
      return {
        message: "run without an earlier exit-0 run-dry-run",
        pointer: `/steps/${index}`,
      };
    if (step.command === "run-dry-run" && step.exit === 0)
      sawDryRunExitZero = true;
    const isLast = index === steps.length - 1;
    if (!isLast && step.exit !== 0) {
      const next = steps[index + 1];
      const isWorkListBeforeGoalCreate =
        step.command === "work-list" &&
        step.exit !== null &&
        next !== undefined &&
        next.command === "goal-create";
      if (!isWorkListBeforeGoalCreate)
        return {
          message: "a non-last step did not exit 0",
          pointer: `/steps/${index}/exit`,
        };
    }
    if (
      step.command === "work-add" &&
      step.exit === 0 &&
      (step.workItemId === undefined || step.created === undefined)
    )
      return {
        message: "an exit-0 work-add step is missing workItemId or created",
        pointer: `/steps/${index}`,
      };
  }
  return undefined;
}

/** R3: `stoppedBecause` consistency with the last step. */
function stoppedBecauseProblem(
  stoppedBecause: StoppedBecause,
  steps: readonly ForgepilotObservationStep[],
): FieldRejection | undefined {
  const last = steps[steps.length - 1];
  const lastPointer =
    steps.length > 0 ? `/steps/${steps.length - 1}` : "/steps";
  switch (stoppedBecause) {
    case "authorization-missing":
      return steps.length === 0
        ? undefined
        : {
            message: "authorization-missing must have no steps",
            pointer: "/steps",
          };
    case "awaiting-authorization":
      return last !== undefined &&
        last.command === "execution-plan" &&
        last.exit === 0
        ? undefined
        : {
            message:
              "awaiting-authorization must end with an exit-0 execution-plan",
            pointer: lastPointer,
          };
    case "goal-completed":
      return last !== undefined && last.command === "run" && last.exit === 0
        ? undefined
        : {
            message: "goal-completed must end with an exit-0 run",
            pointer: lastPointer,
          };
    case "run-needs-human":
      return last !== undefined && last.command === "run" && last.exit === 2
        ? undefined
        : {
            message: "run-needs-human must end with run exit 2",
            pointer: lastPointer,
          };
    case "run-limit-reached":
      return last !== undefined && last.command === "run" && last.exit === 3
        ? undefined
        : {
            message: "run-limit-reached must end with run exit 3",
            pointer: lastPointer,
          };
    case "run-interrupted":
      return last !== undefined &&
        last.command === "run" &&
        (last.exit === 130 || last.exit === 143)
        ? undefined
        : {
            message: "run-interrupted must end with run exit 130 or 143",
            pointer: lastPointer,
          };
    case "run-failed":
      return last !== undefined &&
        last.command === "run" &&
        last.exit !== 0 &&
        last.exit !== 2 &&
        last.exit !== 3 &&
        last.exit !== 130 &&
        last.exit !== 143
        ? undefined
        : {
            message:
              "run-failed must end with run at another exit, including null",
            pointer: lastPointer,
          };
    case "step-failed":
      return last !== undefined && last.exit !== 0
        ? undefined
        : {
            message: "step-failed must end with a non-zero or null exit",
            pointer: lastPointer,
          };
    default:
      // R3: values not listed above carry no last-step constraint beyond R2
      // (Story TST-032's Human Review decision).
      return undefined;
  }
}

export interface ForgepilotObservationContext {
  /** The manifest's own `batchId` (§22: the observation's `batchId` must equal it). */
  readonly batchId: string;
  /**
   * The bytes of the file the manifest's own `goalPlan.path` names,
   * `undefined` when it could not be read at all — outside `goal-plan/`, a
   * symlinked path, or missing all fold into the same
   * `REVIEW_OBSERVATION_INVALID` rejection as a wrong sha256 (§22); the CLI
   * never distinguishes these to this module.
   */
  readonly goalPlanManifestBytes: Uint8Array | undefined;
}

export type ForgepilotObservationValidation =
  | { readonly ok: true; readonly record: ForgepilotObservationData }
  | {
      readonly ok: false;
      readonly message: string;
      readonly tooLarge?: boolean;
      /**
       * A JSON Pointer (RFC 6901) naming the offending field, for a §22
       * binding or §11/§22 R2/R3 consistency rejection (never for a shape
       * rejection, which has no single offending field beyond "the
       * document"). Never a filesystem path (code review round 2 N1) — the
       * CLI places this only in `data.diagnostics[]`, never in an
       * `issue()`'s schema-constrained `path`/`subject`.
       */
      readonly pointer?: string;
    };

/**
 * Schema-only validation (`forgepilot-observation.schema.json`), with no
 * knowledge of the manifest or the Goal Plan Manifest it names. Exported
 * separately so a caller (the CLI) can learn `goalPlan.path` is at least
 * syntactically a well-formed repository-relative path — never containing
 * `..` or an unsafe character (contract §22, R5) — before it ever resolves
 * or reads that path on disk; only once this passes is the CLI's own
 * symlink check on `goalPlan.path` meaningful as a distinct
 * `REVIEW_PATH_UNSAFE` condition rather than a shape rejection.
 */
export function validateForgepilotObservationShape(
  data: unknown,
): ForgepilotObservationValidation {
  const shapeProblem = validateObservationShape(data);
  if (shapeProblem)
    return {
      ok: false,
      message: shapeProblem.message,
      tooLarge: shapeProblem.tooLarge,
    };
  return { ok: true, record: data as ForgepilotObservationData };
}

/**
 * The manifest's own `specs/batches/<BATCH-ID>/goal-plan/` prefix (contract
 * §22): exported so the CLI can gate an actual file read on this cheap,
 * filesystem-free check — a `goalPlan.path` outside this prefix (or a
 * `batchId` mismatch, checked by the caller alongside it) never causes any
 * file outside `goal-plan/` to be opened at all.
 */
export function goalPlanDirectoryPrefix(batchId: string): string {
  return `specs/batches/${batchId}/goal-plan/`;
}

/** Parses the Goal Plan Manifest's own `plan.id`, without otherwise validating it (§22 only needs this one field; Core's `validateGoalPlanManifest` is the authority for the artifact's own shape). */
function readGoalPlanManifestId(bytes: Uint8Array): string | undefined {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
  if (rawJsonMaxDepth(text) > MAX_GOAL_PLAN_MANIFEST_NESTING_DEPTH)
    return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || !isRecord(parsed.plan)) return undefined;
  return typeof parsed.plan.id === "string" ? parsed.plan.id : undefined;
}

/**
 * Contract §22's binding rules and §11/§22 step-consistency rules (R2/R3),
 * for an already schema-valid record (`validateForgepilotObservationShape`).
 * Never echoes any observation text (`stdout`, `stderr`, or otherwise) in
 * its failure message (R6).
 */
export function validateForgepilotObservationConsistency(
  record: ForgepilotObservationData,
  context: ForgepilotObservationContext,
): ForgepilotObservationValidation {
  if (record.batchId !== context.batchId)
    return {
      ok: false,
      message: "batchId does not match the manifest",
      pointer: "/batchId",
    };

  if (
    !record.goalPlan.path.startsWith(goalPlanDirectoryPrefix(context.batchId))
  )
    return {
      ok: false,
      message:
        "goalPlan.path does not lie under the batch's goal-plan directory",
      pointer: "/goalPlan/path",
    };

  if (context.goalPlanManifestBytes === undefined)
    return {
      ok: false,
      message:
        "goalPlan.path could not be read as the current Goal Plan Manifest",
      pointer: "/goalPlan/path",
    };
  if (sha256Hex(context.goalPlanManifestBytes) !== record.goalPlan.sha256)
    return {
      ok: false,
      message: "goalPlan.sha256 does not match the current Goal Plan Manifest",
      pointer: "/goalPlan/sha256",
    };

  if (record.goalId !== undefined) {
    const manifestPlanId = readGoalPlanManifestId(
      context.goalPlanManifestBytes,
    );
    if (manifestPlanId === undefined || record.goalId !== manifestPlanId)
      return {
        ok: false,
        message: "goalId does not match the Goal Plan Manifest's plan.id",
        pointer: "/goalId",
      };
  }

  const orderProblem = stepOrderProblem(record.steps);
  if (orderProblem !== undefined)
    return {
      ok: false,
      message: orderProblem.message,
      pointer: orderProblem.pointer,
    };

  const stoppedProblem = stoppedBecauseProblem(
    record.stoppedBecause,
    record.steps,
  );
  if (stoppedProblem !== undefined)
    return {
      ok: false,
      message: stoppedProblem.message,
      pointer: stoppedProblem.pointer,
    };

  return { ok: true, record };
}

/**
 * Convenience for a caller (Core's own tests) that already has every fact
 * `validateForgepilotObservationConsistency` needs and does not care about
 * the CLI's staged shape-then-symlink-then-consistency flow: schema
 * validation followed immediately by the consistency rules.
 */
export function validateForgepilotObservation(
  data: unknown,
  context: ForgepilotObservationContext,
): ForgepilotObservationValidation {
  const shape = validateForgepilotObservationShape(data);
  if (!shape.ok) return shape;
  return validateForgepilotObservationConsistency(shape.record, context);
}
