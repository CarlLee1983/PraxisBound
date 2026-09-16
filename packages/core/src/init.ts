import { createHash } from "node:crypto";

import { adoptionNextSteps } from "./adoption-next-steps.js";

import {
  IMPLEMENTED_PROTOCOL_VERSION,
  RESULT_SCHEMA_VERSION,
  type ResultDataValue,
  type ResultEnvelope,
  type ResultIssue,
} from "./result.js";
import type {
  MutationExecutionObservation,
  MutationFailure,
  MutationFailureStage,
  MutationPathKind,
  MutationPathObservation,
  MutationStageObservation,
  MutationStagePrecondition,
} from "./mutation.js";

export type InitMode = "safe" | "force" | "upgrade";
export type InitPathKind = MutationPathKind;
export type InitChangeKind = "install" | "replace" | "remove";

export type InitPathObservation = MutationPathObservation;

export interface InitSnapshotPayload {
  readonly path: string;
  readonly digest: string;
}

export interface InitSnapshot {
  readonly protocolVersion: string;
  readonly provenance: string;
  readonly revision: string;
  readonly snapshotDigest: string;
  readonly payloads: readonly InitSnapshotPayload[];
}

export interface InitPlanRequest {
  readonly mode: InitMode;
  readonly rootIdentity: string;
  readonly snapshot: InitSnapshot;
  readonly paths: readonly InitPathObservation[];
}

export interface InitPlannedChange {
  readonly [key: string]: ResultDataValue;
  readonly kind: InitChangeKind;
  readonly path: string;
  readonly digest: string;
}

export interface InitPlanEvaluation {
  readonly result: ResultEnvelope;
  readonly changes: readonly InitPlannedChange[];
  readonly plan?: InitMutationPlan;
}

export interface InitMutationPlan {
  readonly planVersion: "1";
  readonly operation: "init";
  readonly mode: InitMode;
  readonly rootIdentity: string;
  readonly protocolVersion: string;
  readonly provenance: string;
  readonly revision: string;
  readonly sourceDigest: string;
  readonly preconditions: readonly InitPathObservation[];
  readonly stagePreconditions: readonly InitStagePrecondition[];
  readonly effects: readonly InitPlannedChange[];
  readonly commitMarker: typeof adoptionMarkerPath;
  readonly planId: string;
}

export type InitStagePrecondition = MutationStagePrecondition;
export type InitStageObservation = MutationStageObservation;
export type InitMutationFailureStage = MutationFailureStage;
export type InitMutationFailure = MutationFailure;
export type InitMutationExecutionObservation = MutationExecutionObservation;

const freshDirectories = [
  "specs",
  "specs/stories",
  "specs/stories/_template",
  "guidance",
] as const;
const upgradeDirectories = [
  "specs",
  "specs/stories",
  "specs/stories/_template",
] as const;
const freshPayloadPaths = [
  "AGENTS.md",
  "specs/stories/_template/story.md",
  "specs/stories/_template/acceptance.md",
  "specs/stories/_template/task.md",
  "guidance/ENTRY.md",
  "guidance/PRINCIPLES.md",
  "guidance/DECISIONS.md",
  "guidance/PRACTICES.md",
] as const;
const upgradePayloadPaths = [
  "specs/stories/_template/story.md",
  "specs/stories/_template/acceptance.md",
  "specs/stories/_template/task.md",
] as const;
export const adoptionMarkerPath = "specs/.praxisbound-adoption";
export const legacyAdoptionMarkerPath = "specs/.forgeflow-adoption";
const sha256 = /^[a-f0-9]{64}$/;

function issue(code: string, message: string, path?: string): ResultIssue {
  return Object.freeze({
    code,
    message,
    ...(path === undefined ? {} : { path }),
  });
}

function result(
  status: "pass" | "fail" | "error",
  outcome:
    | "INIT_APPLIED"
    | "INIT_PREVIEW"
    | "INIT_CONFLICT"
    | "INIT_OPERATION_REFUSED"
    | "INIT_APPLY_FAILED_RECOVERED"
    | "INIT_RECOVERY_INCOMPLETE"
    | "INIT_CLEANUP_INCOMPLETE"
    | "ERROR",
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
    subject: "init",
    ...(data === undefined ? {} : { data }),
    ...(status === "error" && issues[0] !== undefined
      ? {
          error: Object.freeze({
            code: issues[0].code,
            message: issues[0].message,
          }),
        }
      : {}),
    issues: Object.freeze(issues),
  });
}

function sourceError(message: string): InitPlanEvaluation {
  const problems = Object.freeze([issue("INIT_SNAPSHOT_INVALID", message)]);
  return Object.freeze({
    result: result("fail", "INIT_OPERATION_REFUSED", 1, problems),
    changes: Object.freeze([]),
  });
}

function validSnapshot(snapshot: InitSnapshot): string | undefined {
  if (snapshot.protocolVersion !== IMPLEMENTED_PROTOCOL_VERSION)
    return "The bundled Protocol snapshot version is unsupported.";
  if (snapshot.provenance.length === 0)
    return "The bundled Protocol snapshot has no provenance.";
  if (
    !/^(?:unknown|[a-f0-9]{40}(?:-dirty)?|[a-f0-9]{64}(?:-dirty)?)$/.test(
      snapshot.revision,
    )
  )
    return "The bundled Protocol snapshot has an invalid revision.";
  if (!sha256.test(snapshot.snapshotDigest))
    return "The bundled Protocol snapshot has an invalid snapshot digest.";
  if (snapshot.payloads.length !== freshPayloadPaths.length)
    return "The bundled Protocol snapshot has an unexpected managed payload set.";
  const expected = new Set<string>(freshPayloadPaths);
  const seen = new Set<string>();
  for (const payload of snapshot.payloads) {
    if (
      !expected.has(payload.path) ||
      seen.has(payload.path) ||
      !sha256.test(payload.digest)
    )
      return "The bundled Protocol snapshot has an invalid managed payload.";
    seen.add(payload.path);
  }
  return undefined;
}

function immutableObservation(
  observation: InitPathObservation,
): InitPathObservation {
  return Object.freeze({
    path: observation.path,
    kind: observation.kind,
    ...(observation.readable === undefined
      ? {}
      : { readable: observation.readable }),
    ...(observation.searchable === undefined
      ? {}
      : { searchable: observation.searchable }),
    ...(observation.digest === undefined ? {} : { digest: observation.digest }),
    ...(observation.identity === undefined
      ? {}
      : { identity: observation.identity }),
    ...(observation.text === undefined ? {} : { text: observation.text }),
  });
}

function sameObservation(
  expected: InitPathObservation,
  actual: InitPathObservation | undefined,
): boolean {
  return (
    actual !== undefined &&
    expected.path === actual.path &&
    expected.kind === actual.kind &&
    expected.readable === actual.readable &&
    expected.searchable === actual.searchable &&
    expected.digest === actual.digest &&
    expected.identity === actual.identity &&
    expected.text === actual.text
  );
}

function uniquePaths(paths: readonly string[]): boolean {
  return new Set(paths).size === paths.length;
}

function executionData(
  plan: InitMutationPlan,
  observation: InitMutationExecutionObservation,
): Readonly<Record<string, ResultDataValue>> {
  return Object.freeze({
    mode: plan.mode,
    protocolVersion: plan.protocolVersion,
    provenance: plan.provenance,
    planId: plan.planId,
    changes: plan.effects,
    prepared: Object.freeze([...observation.prepared]),
    attempted: Object.freeze([...observation.attempted]),
    applied: Object.freeze([...observation.applied]),
    recoveryAttempted: Object.freeze([...observation.recoveryAttempted]),
    restored: Object.freeze([...observation.restored]),
    unrecovered: Object.freeze([...observation.unrecovered]),
    invalidated: Object.freeze([...observation.invalidated]),
    invalidationFailed: Object.freeze([...observation.invalidationFailed]),
    retained: Object.freeze([...observation.retained]),
    cleanupResidue: Object.freeze([...observation.cleanupResidue]),
    preconditionMismatches: Object.freeze([
      ...observation.preconditionMismatches,
    ]),
  });
}

function observationMap(
  observations: readonly InitPathObservation[],
): Map<string, InitPathObservation> | undefined {
  const paths = new Map<string, InitPathObservation>();
  for (const observation of observations) {
    if (paths.has(observation.path)) return undefined;
    paths.set(observation.path, observation);
  }
  return paths;
}

function refused(
  observed: Map<string, InitPathObservation>,
  directories: readonly string[],
  destinations: readonly string[],
): InitPlanEvaluation | undefined {
  for (const path of directories) {
    const entry = observed.get(path);
    if (
      entry === undefined ||
      entry.kind === "symlink" ||
      entry.kind === "other" ||
      entry.kind === "unconfirmable" ||
      (entry.kind === "directory" &&
        (entry.readable !== true ||
          entry.searchable !== true ||
          entry.identity === undefined))
    ) {
      const problems = Object.freeze([
        issue(
          "INIT_UNSAFE_MANAGED_DIRECTORY",
          "A managed directory cannot be safely inspected.",
          path,
        ),
      ]);
      return Object.freeze({
        result: result("fail", "INIT_OPERATION_REFUSED", 1, problems),
        changes: Object.freeze([]),
      });
    }
  }
  for (const path of destinations) {
    const entry = observed.get(path);
    if (
      entry === undefined ||
      entry.kind === "symlink" ||
      entry.kind === "directory" ||
      entry.kind === "other" ||
      entry.kind === "unconfirmable" ||
      (entry.kind === "file" &&
        (entry.readable !== true ||
          entry.digest === undefined ||
          !sha256.test(entry.digest)))
    ) {
      const problems = Object.freeze([
        issue(
          "INIT_UNSAFE_MANAGED_PATH",
          "A managed destination cannot be safely inspected.",
          path,
        ),
      ]);
      return Object.freeze({
        result: result("fail", "INIT_OPERATION_REFUSED", 1, problems),
        changes: Object.freeze([]),
      });
    }
  }
  return undefined;
}

function hash(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function createAdoptionMarker(snapshot: InitSnapshot): string {
  return `version=${snapshot.protocolVersion}\nrevision=${snapshot.revision}\n`;
}

function stagePath(path: string, seed: string): string {
  const separator = path.lastIndexOf("/");
  const parent = separator === -1 ? "" : `${path.slice(0, separator + 1)}`;
  const name = path.slice(separator + 1);
  return `${parent}.praxisbound-install.${seed.slice(0, 16)}-${name}`;
}

function planBody(plan: Omit<InitMutationPlan, "planId">): object {
  return {
    planVersion: plan.planVersion,
    operation: plan.operation,
    mode: plan.mode,
    rootIdentity: plan.rootIdentity,
    protocolVersion: plan.protocolVersion,
    provenance: plan.provenance,
    revision: plan.revision,
    sourceDigest: plan.sourceDigest,
    preconditions: plan.preconditions,
    stagePreconditions: plan.stagePreconditions,
    effects: plan.effects,
    commitMarker: plan.commitMarker,
  };
}

function planIdentity(plan: Omit<InitMutationPlan, "planId">): string {
  return hash(JSON.stringify(planBody(plan)));
}

export function findInitPreconditionMismatches(
  plan: InitMutationPlan,
  observations: readonly InitPathObservation[],
  observedStages: readonly InitStageObservation[],
): readonly string[] {
  const paths = observationMap(observations);
  if (paths === undefined)
    return Object.freeze(plan.preconditions.map(({ path }) => path));
  const stages = new Map(observedStages.map((entry) => [entry.path, entry]));
  const mismatches = [
    ...plan.preconditions
      .filter(
        (expected) => !sameObservation(expected, paths.get(expected.path)),
      )
      .map(({ path }) => path),
    ...plan.stagePreconditions
      .filter((expected) => stages.get(expected.path)?.kind !== expected.kind)
      .map(({ path }) => path),
  ];
  return Object.freeze(mismatches);
}

function validExecutionObservation(
  plan: InitMutationPlan,
  observation: InitMutationExecutionObservation,
): boolean {
  const effectPaths = plan.effects.map(({ path }) => path);
  const allowedEffects = new Set(effectPaths);
  const allowedEvidence = new Set([
    ...plan.preconditions.map(({ path }) => path),
    ...plan.stagePreconditions.map(({ path }) => path),
  ]);
  const effectLists = [
    observation.prepared,
    observation.attempted,
    observation.applied,
    observation.recoveryAttempted,
    observation.restored,
    observation.unrecovered,
    observation.invalidated,
    observation.invalidationFailed,
  ];
  if (
    observation.planId !== plan.planId ||
    planIdentity(plan) !== plan.planId ||
    effectLists.some(
      (paths) =>
        !uniquePaths(paths) || paths.some((path) => !allowedEffects.has(path)),
    ) ||
    !uniquePaths(observation.retained) ||
    observation.retained.some((path) => !allowedEvidence.has(path)) ||
    !uniquePaths(observation.cleanupResidue) ||
    observation.cleanupResidue.some((path) => !allowedEvidence.has(path)) ||
    !uniquePaths(observation.preconditionMismatches) ||
    observation.preconditionMismatches.some(
      (path) => !allowedEvidence.has(path),
    ) ||
    observation.invalidated.some((path) => path !== plan.commitMarker) ||
    observation.invalidationFailed.some((path) => path !== plan.commitMarker) ||
    observation.invalidated.some((path) =>
      observation.invalidationFailed.includes(path),
    ) ||
    observation.attempted.some((path, index) => effectPaths[index] !== path) ||
    observation.applied.some(
      (path, index) => observation.attempted[index] !== path,
    ) ||
    observation.prepared.some((path, index) => effectPaths[index] !== path) ||
    (observation.failure !== undefined &&
      !/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/.test(observation.failure.code)) ||
    (observation.failure?.path !== undefined &&
      !allowedEvidence.has(observation.failure.path)) ||
    (observation.committed &&
      (observation.prepared.length !== effectPaths.length ||
        observation.prepared.some(
          (path, index) => effectPaths[index] !== path,
        ) ||
        observation.attempted.length !== effectPaths.length ||
        observation.attempted.some(
          (path, index) => effectPaths[index] !== path,
        ) ||
        observation.applied.length !== effectPaths.length ||
        observation.applied.some(
          (path, index) => effectPaths[index] !== path,
        ) ||
        observation.recoveryAttempted.length !== 0 ||
        observation.restored.length !== 0 ||
        observation.unrecovered.length !== 0 ||
        observation.invalidated.length !== 0 ||
        observation.invalidationFailed.length !== 0 ||
        observation.retained.length !== 0 ||
        observation.preconditionMismatches.length !== 0 ||
        (observation.failure !== undefined &&
          observation.failure.stage !== "cleanup")))
  ) {
    return false;
  }
  if (
    (observation.preconditionMismatches.length > 0 ||
      observation.failure?.stage === "precondition" ||
      observation.failure?.stage === "prepare") &&
    (observation.attempted.length !== 0 ||
      observation.applied.length !== 0 ||
      observation.recoveryAttempted.length !== 0 ||
      observation.restored.length !== 0 ||
      observation.unrecovered.length !== 0 ||
      observation.invalidated.length !== 0 ||
      observation.invalidationFailed.length !== 0 ||
      observation.retained.length !== 0)
  )
    return false;
  if (observation.failure?.stage === "cleanup" && !observation.committed)
    return false;
  if (
    observation.committed &&
    (observation.cleanupResidue.some(
      (path) => !plan.stagePreconditions.some((stage) => stage.path === path),
    ) ||
      (observation.failure?.stage === "cleanup" &&
        observation.failure.path !== undefined &&
        !plan.stagePreconditions.some(
          (stage) => stage.path === observation.failure?.path,
        )))
  )
    return false;
  if (
    !observation.committed &&
    (observation.failure?.stage === "apply" ||
      observation.failure?.stage === "recovery")
  ) {
    const reversedAttempts = [...observation.attempted].reverse();
    if (
      observation.prepared.length !== effectPaths.length ||
      observation.prepared.some((path, index) => effectPaths[index] !== path) ||
      observation.recoveryAttempted.length !== reversedAttempts.length ||
      observation.recoveryAttempted.some(
        (path, index) => reversedAttempts[index] !== path,
      ) ||
      observation.restored.some((path) =>
        observation.unrecovered.includes(path),
      ) ||
      new Set([...observation.restored, ...observation.unrecovered]).size !==
        observation.attempted.length ||
      observation.attempted.some(
        (path) =>
          !observation.restored.includes(path) &&
          !observation.unrecovered.includes(path),
      )
    )
      return false;
  }
  if (
    observation.failure?.stage === "apply" &&
    observation.attempted.length === 0
  )
    return false;
  if (
    (observation.unrecovered.length > 0 ||
      observation.invalidationFailed.length > 0) &&
    (observation.retained.length !== plan.stagePreconditions.length ||
      observation.retained.some(
        (path, index) => plan.stagePreconditions[index]?.path !== path,
      ))
  )
    return false;
  if (
    observation.unrecovered.length > 0 &&
    !observation.invalidated.includes(plan.commitMarker) &&
    !observation.invalidationFailed.includes(plan.commitMarker)
  )
    return false;
  if (
    observation.unrecovered.length === 0 &&
    (observation.invalidated.length > 0 ||
      observation.invalidationFailed.length > 0 ||
      observation.retained.length > 0)
  )
    return false;
  return true;
}

export function evaluateInitMutation(
  plan: InitMutationPlan,
  observation: InitMutationExecutionObservation,
): InitPlanEvaluation {
  if (!validExecutionObservation(plan, observation)) {
    const problems = Object.freeze([
      issue(
        "INIT_EXECUTION_OBSERVATION_INVALID",
        "The Init mutation execution observation is inconsistent.",
      ),
    ]);
    return Object.freeze({
      result: result("error", "ERROR", 3, problems),
      changes: plan.effects,
      plan,
    });
  }

  const data = executionData(plan, observation);
  if (
    (observation.preconditionMismatches.length > 0 ||
      observation.failure?.stage === "precondition") &&
    observation.cleanupResidue.length === 0
  ) {
    const code = observation.failure?.code ?? "INIT_STALE_PLAN";
    const message =
      code === "INIT_STAGE_COLLISION"
        ? "A private Init staging path already exists."
        : code === "INIT_PAYLOAD_INVALID"
          ? "The packaged Init payload does not match the plan."
          : "The Init plan became stale before application.";
    const paths =
      observation.preconditionMismatches.length === 0
        ? [observation.failure?.path].filter(
            (path): path is string => path !== undefined,
          )
        : observation.preconditionMismatches;
    const problems = Object.freeze(
      (paths.length === 0 ? [undefined] : paths).map((path) =>
        issue(code, message, path),
      ),
    );
    return Object.freeze({
      result: result("fail", "INIT_OPERATION_REFUSED", 1, problems, data),
      changes: plan.effects,
      plan,
    });
  }

  if (
    observation.unrecovered.length > 0 ||
    observation.invalidationFailed.length > 0 ||
    observation.failure?.stage === "recovery" ||
    (!observation.committed && observation.cleanupResidue.length > 0)
  ) {
    const paths = [
      ...observation.unrecovered,
      ...observation.invalidationFailed.filter(
        (path) => !observation.unrecovered.includes(path),
      ),
      ...(observation.unrecovered.length === 0 &&
      observation.invalidationFailed.length === 0
        ? observation.cleanupResidue
        : []),
    ];
    const problems = Object.freeze(
      (paths.length === 0 ? [observation.failure?.path] : paths).map((path) =>
        issue(
          "INIT_RECOVERY_INCOMPLETE",
          "An Init destination or recovery artifact requires manual recovery.",
          path,
        ),
      ),
    );
    return Object.freeze({
      result: result("fail", "INIT_RECOVERY_INCOMPLETE", 1, problems, data),
      changes: plan.effects,
      plan,
    });
  }

  if (!observation.committed && observation.failure !== undefined) {
    const problems = Object.freeze([
      issue(
        "INIT_APPLY_FAILED_RECOVERED",
        "Init application failed and the prior target state was restored.",
        observation.failure.path,
      ),
    ]);
    return Object.freeze({
      result: result("fail", "INIT_APPLY_FAILED_RECOVERED", 1, problems, data),
      changes: plan.effects,
      plan,
    });
  }

  if (
    observation.cleanupResidue.length > 0 ||
    observation.failure?.stage === "cleanup"
  ) {
    const paths =
      observation.cleanupResidue.length === 0
        ? [observation.failure?.path].filter(
            (path): path is string => path !== undefined,
          )
        : observation.cleanupResidue;
    const problems = Object.freeze(
      (paths.length === 0 ? [undefined] : paths).map((path) =>
        issue(
          "INIT_CLEANUP_INCOMPLETE",
          "Init applied, but private staging cleanup is incomplete.",
          path,
        ),
      ),
    );
    return Object.freeze({
      result: result("fail", "INIT_CLEANUP_INCOMPLETE", 1, problems, data),
      changes: plan.effects,
      plan,
    });
  }

  if (observation.committed) {
    return Object.freeze({
      result: result(
        "pass",
        "INIT_APPLIED",
        0,
        Object.freeze([]),
        Object.freeze({ ...data, nextSteps: adoptionNextSteps }),
      ),
      changes: plan.effects,
      plan,
    });
  }

  const problems = Object.freeze([
    issue(
      "INIT_EXECUTION_OBSERVATION_INVALID",
      "The Init mutation execution observation has no final state.",
    ),
  ]);
  return Object.freeze({
    result: result("error", "ERROR", 3, problems),
    changes: plan.effects,
    plan,
  });
}

function activePaths(mode: InitMode): {
  readonly directories: readonly string[];
  readonly payloads: readonly string[];
  readonly destinations: readonly string[];
} {
  const payloads = mode === "upgrade" ? upgradePayloadPaths : freshPayloadPaths;
  return Object.freeze({
    directories: mode === "upgrade" ? upgradeDirectories : freshDirectories,
    payloads,
    destinations:
      mode === "upgrade"
        ? [...payloads, legacyAdoptionMarkerPath, adoptionMarkerPath]
        : [...payloads, adoptionMarkerPath],
  });
}

export function getInitObservationScope(mode: InitMode): {
  readonly directories: readonly string[];
  readonly destinations: readonly string[];
} {
  const active = activePaths(mode);
  return Object.freeze({
    directories: Object.freeze([...active.directories]),
    destinations: Object.freeze([...active.destinations]),
  });
}

/**
 * Produces an init preview from captured facts only. This boundary never reads
 * a repository, calculates a clock value, or changes the supplied snapshot.
 */
export function planMutation(request: InitPlanRequest): InitPlanEvaluation {
  const invalidSource = validSnapshot(request.snapshot);
  if (invalidSource !== undefined) return sourceError(invalidSource);
  if (request.rootIdentity.length === 0) {
    const problems = Object.freeze([
      issue(
        "INIT_ROOT_IDENTITY_INVALID",
        "The Init target identity is invalid.",
      ),
    ]);
    return Object.freeze({
      result: result("error", "ERROR", 2, problems),
      changes: Object.freeze([]),
    });
  }

  const observed = observationMap(request.paths);
  if (observed === undefined) {
    const problems = Object.freeze([
      issue(
        "INIT_INVALID_SNAPSHOT",
        "Managed path observations are not unique.",
      ),
    ]);
    return Object.freeze({
      result: result("error", "ERROR", 2, problems),
      changes: Object.freeze([]),
    });
  }
  const active = activePaths(request.mode);
  const unsafe = refused(observed, active.directories, active.destinations);
  if (unsafe !== undefined) return unsafe;

  if (request.mode === "upgrade") {
    const stories = observed.get("specs/stories");
    if (stories?.kind !== "directory") {
      const problems = Object.freeze([
        issue(
          "INIT_UPGRADE_UNAVAILABLE",
          "No PraxisBound adoption is available to upgrade.",
          "specs/stories",
        ),
      ]);
      return Object.freeze({
        result: result("fail", "INIT_CONFLICT", 1, problems),
        changes: Object.freeze([]),
      });
    }
    const current = observed.get(adoptionMarkerPath);
    const legacy = observed.get(legacyAdoptionMarkerPath);
    if (current?.kind !== "missing" && legacy?.kind !== "missing") {
      const problems = Object.freeze([
        issue(
          "INIT_MARKER_AMBIGUOUS",
          "Current and legacy adoption markers are both present.",
        ),
      ]);
      return Object.freeze({
        result: result("fail", "INIT_CONFLICT", 1, problems),
        changes: Object.freeze([]),
      });
    }
    if (
      legacy?.kind !== "missing" &&
      !(
        legacy?.kind === "file" &&
        typeof legacy.text === "string" &&
        /^version=0\.9\.0\r?\nrevision=(?:unknown|[a-f0-9]{40}(?:-dirty)?|[a-f0-9]{64}(?:-dirty)?)\r?\n?$/.test(
          legacy.text,
        )
      )
    ) {
      const problems = Object.freeze([
        issue(
          "INIT_LEGACY_MARKER_INVALID",
          "The legacy adoption marker is malformed or unsupported.",
          legacyAdoptionMarkerPath,
        ),
      ]);
      return Object.freeze({
        result: result("fail", "INIT_OPERATION_REFUSED", 1, problems),
        changes: Object.freeze([]),
      });
    }
  } else if (request.mode === "safe") {
    const conflict = active.destinations.find(
      (path) => observed.get(path)?.kind === "file",
    );
    if (conflict !== undefined) {
      const problems = Object.freeze([
        issue(
          "INIT_MANAGED_CONFLICT",
          "A managed destination already exists.",
          conflict,
        ),
      ]);
      return Object.freeze({
        result: result("fail", "INIT_CONFLICT", 1, problems),
        changes: Object.freeze([]),
      });
    }
  }

  const digests = new Map(
    request.snapshot.payloads.map((payload) => [payload.path, payload.digest]),
  );
  const changes = Object.freeze(
    active.destinations
      .filter(
        (path) =>
          path !== legacyAdoptionMarkerPath ||
          observed.get(path)?.kind === "file",
      )
      .map((path) => {
        const present = observed.get(path)?.kind === "file";
        return Object.freeze({
          kind:
            path === legacyAdoptionMarkerPath
              ? "remove"
              : present
                ? "replace"
                : "install",
          path,
          digest:
            path === legacyAdoptionMarkerPath
              ? hash("")
              : path === adoptionMarkerPath
                ? hash(createAdoptionMarker(request.snapshot))
                : (digests.get(path) as string),
        });
      }),
  );
  const provenance = request.snapshot.provenance;
  const preconditions = Object.freeze(
    [...active.directories, ...active.destinations].map((path) =>
      immutableObservation(observed.get(path) as InitPathObservation),
    ),
  );
  const seed = hash(
    JSON.stringify({
      operation: "init",
      mode: request.mode,
      protocolVersion: request.snapshot.protocolVersion,
      sourceDigest: request.snapshot.snapshotDigest,
      rootIdentity: request.rootIdentity,
      preconditions,
      effects: changes,
    }),
  );
  const stagePreconditions = Object.freeze(
    changes.map(({ path }) =>
      Object.freeze({ path: stagePath(path, seed), kind: "missing" as const }),
    ),
  );
  const planWithoutId: Omit<InitMutationPlan, "planId"> = Object.freeze({
    planVersion: "1",
    operation: "init",
    mode: request.mode,
    rootIdentity: request.rootIdentity,
    protocolVersion: request.snapshot.protocolVersion,
    provenance,
    revision: request.snapshot.revision,
    sourceDigest: request.snapshot.snapshotDigest,
    preconditions,
    stagePreconditions,
    effects: changes,
    commitMarker: adoptionMarkerPath,
  });
  const plan = Object.freeze({
    ...planWithoutId,
    planId: planIdentity(planWithoutId),
  });
  return Object.freeze({
    result: result("pass", "INIT_PREVIEW", 0, Object.freeze([]), {
      mode: request.mode,
      protocolVersion: request.snapshot.protocolVersion,
      provenance,
      planId: plan.planId,
      changes,
      nextSteps: adoptionNextSteps,
    }),
    changes,
    plan,
  });
}
