import { lstat, realpath } from "node:fs/promises";

import {
  evaluateInitMutation,
  IMPLEMENTED_PROTOCOL_VERSION,
  planMutation,
  RESULT_SCHEMA_VERSION,
  type InitPathObservation,
  type InitPlanEvaluation,
  type InitSnapshot,
  type ResultEnvelope,
  type ResultIssue,
} from "@praxisbound/core";

import {
  captureInitObservations,
  initFilesystemIdentity,
} from "./init-observation.js";
import {
  executeInitMutation,
  executeInitMutationWithSignals,
} from "./init-mutation.js";
import {
  loadPackagedInitBundle,
  type PackagedInitPayload,
} from "./init-snapshot.js";

export type InitOutputMode = "human" | "json";

export interface InitCommandExecution {
  readonly mode: InitOutputMode;
  readonly result: ResultEnvelope;
  readonly evaluation?: InitPlanEvaluation;
}

export interface InitRenderedOutput {
  readonly stdout: string;
  readonly stderr: string;
}

export interface InitInspection {
  readonly root: string;
  readonly rootIdentity: string;
  readonly snapshot: InitSnapshot;
  readonly paths: readonly InitPathObservation[];
  readonly payloads?: readonly PackagedInitPayload[];
}

export interface InitFilesystemAdapter {
  inspect(
    candidate: string,
    mode: "safe" | "force" | "upgrade",
  ): Promise<InitInspection>;
}

export const initHelp = `PraxisBound Init

Usage:
  praxisbound init [--force | --upgrade] [--dry-run] [--json] [repository-directory]
  praxisbound init --help

Plans or applies an offline PraxisBound initialization from the Protocol snapshot
bundled in this CLI package. --dry-run performs no target writes, staging, or
recovery. --force and --upgrade are mutually exclusive.
`;

function issue(code: string, message: string): ResultIssue {
  return Object.freeze({ code, message });
}

function commandError(
  mode: InitOutputMode,
  code: string,
  message: string,
): InitCommandExecution {
  const problems = Object.freeze([issue(code, message)]);
  return Object.freeze({
    mode,
    result: Object.freeze({
      schemaVersion: RESULT_SCHEMA_VERSION,
      protocolVersion: IMPLEMENTED_PROTOCOL_VERSION,
      status: "error" as const,
      outcome: "ERROR" as const,
      exit: 2 as const,
      subject: "init",
      error: Object.freeze({ code, message }),
      issues: problems,
    }),
  });
}

function internalError(mode: InitOutputMode): InitCommandExecution {
  const code = "INIT_INTERNAL_ERROR";
  const message = "Init could not complete because of an internal failure.";
  const problems = Object.freeze([issue(code, message)]);
  return Object.freeze({
    mode,
    result: Object.freeze({
      schemaVersion: RESULT_SCHEMA_VERSION,
      protocolVersion: IMPLEMENTED_PROTOCOL_VERSION,
      status: "error" as const,
      outcome: "ERROR" as const,
      exit: 3 as const,
      subject: "init",
      error: Object.freeze({ code, message }),
      issues: problems,
    }),
  });
}

function sourceRefusal(mode: InitOutputMode): InitCommandExecution {
  const code = "INIT_SNAPSHOT_UNAVAILABLE";
  const message =
    "The bundled Protocol snapshot could not be safely inspected.";
  return Object.freeze({
    mode,
    result: Object.freeze({
      schemaVersion: RESULT_SCHEMA_VERSION,
      protocolVersion: IMPLEMENTED_PROTOCOL_VERSION,
      status: "fail" as const,
      outcome: "INIT_OPERATION_REFUSED" as const,
      exit: 1 as const,
      subject: "init",
      issues: Object.freeze([issue(code, message)]),
    }),
  });
}

function parse(args: readonly string[]):
  | {
      readonly valid: true;
      readonly mode: InitOutputMode;
      readonly dryRun: boolean;
      readonly initMode: "safe" | "force" | "upgrade";
      readonly candidate?: string;
    }
  | { readonly valid: false; readonly mode: InitOutputMode } {
  const requestedMode: InitOutputMode = args.includes("--json")
    ? "json"
    : "human";
  let mode: InitOutputMode = "human";
  let dryRun = false;
  let initMode: "safe" | "force" | "upgrade" = "safe";
  let candidate: string | undefined;
  for (const argument of args) {
    if (candidate !== undefined) return { valid: false, mode: requestedMode };
    if (argument === "--json") {
      if (mode === "json") return { valid: false, mode: requestedMode };
      mode = "json";
    } else if (argument === "--dry-run") {
      if (dryRun) return { valid: false, mode: requestedMode };
      dryRun = true;
    } else if (argument === "--force" || argument === "--upgrade") {
      const requested = argument === "--force" ? "force" : "upgrade";
      if (initMode !== "safe") return { valid: false, mode: requestedMode };
      initMode = requested;
    } else if (argument.startsWith("-")) {
      return { valid: false, mode: requestedMode };
    } else if (candidate === undefined) {
      candidate = argument;
    } else {
      return { valid: false, mode: requestedMode };
    }
  }
  return Object.freeze({
    valid: true,
    mode,
    dryRun,
    initMode,
    ...(candidate === undefined ? {} : { candidate }),
  });
}

export const nodeInitFilesystemAdapter: InitFilesystemAdapter = Object.freeze({
  async inspect(
    candidate: string,
    mode: "safe" | "force" | "upgrade",
  ): Promise<InitInspection> {
    const root = await realpath(candidate);
    const rootStats = await lstat(root);
    if (!rootStats.isDirectory())
      throw new Error("The target is not a directory.");
    let bundle;
    try {
      bundle = await loadPackagedInitBundle();
    } catch (error: unknown) {
      throw new InitSnapshotUnavailableError(error);
    }
    const paths = await captureInitObservations(root, mode);
    const legacy = paths.find(
      (entry) => entry.path === "specs/.forgeflow-adoption",
    );
    const revision =
      mode === "upgrade" &&
      legacy?.kind === "file" &&
      typeof legacy.text === "string"
        ? legacy.text.match(
            /^version=0\.9\.0\r?\nrevision=(unknown|[a-f0-9]{40}(?:-dirty)?|[a-f0-9]{64}(?:-dirty)?)\r?\n?$/,
          )?.[1]
        : undefined;
    return Object.freeze({
      root,
      rootIdentity: initFilesystemIdentity(rootStats),
      snapshot:
        revision === undefined
          ? bundle.snapshot
          : Object.freeze({ ...bundle.snapshot, revision }),
      paths,
      payloads: bundle.payloads,
    });
  },
});

export async function runInit(
  args: readonly string[],
  cwd: string = process.cwd(),
  adapter: InitFilesystemAdapter = nodeInitFilesystemAdapter,
  mutationExecutor: typeof executeInitMutation = executeInitMutationWithSignals,
): Promise<InitCommandExecution> {
  const invocation = parse(args);
  if (!invocation.valid)
    return commandError(invocation.mode, "INIT_USAGE", "Invalid arguments");
  let inspection: InitInspection;
  try {
    inspection = await adapter.inspect(
      invocation.candidate ?? cwd,
      invocation.initMode,
    );
  } catch (error: unknown) {
    if (error instanceof InitSnapshotUnavailableError)
      return sourceRefusal(invocation.mode);
    return commandError(
      invocation.mode,
      "INIT_TARGET_UNAVAILABLE",
      "The init target or bundled Protocol snapshot could not be inspected.",
    );
  }
  const evaluation = planMutation({
    mode: invocation.initMode,
    rootIdentity: inspection.rootIdentity,
    snapshot: inspection.snapshot,
    paths: inspection.paths,
  });
  if (invocation.dryRun || evaluation.result.outcome !== "INIT_PREVIEW")
    return Object.freeze({
      mode: invocation.mode,
      result: evaluation.result,
      evaluation,
    });
  if (evaluation.plan === undefined || inspection.payloads === undefined)
    return sourceRefusal(invocation.mode);
  try {
    const mutation = await mutationExecutor(
      inspection.root,
      evaluation.plan,
      inspection.snapshot,
      inspection.payloads,
    );
    const applied = evaluateInitMutation(evaluation.plan, mutation);
    return Object.freeze({
      mode: invocation.mode,
      result: applied.result,
      evaluation: applied,
    });
  } catch {
    return internalError(invocation.mode);
  }
}

class InitSnapshotUnavailableError extends Error {
  constructor(cause: unknown) {
    super("Bundled Protocol snapshot unavailable", { cause });
  }
}

export function renderInitHuman(
  execution: InitCommandExecution,
): InitRenderedOutput {
  if (
    execution.result.outcome !== "INIT_PREVIEW" &&
    execution.result.outcome !== "INIT_APPLIED"
  ) {
    const first = execution.result.issues[0];
    const detail =
      first === undefined ? "Init failed." : `${first.code}: ${first.message}`;
    const data = execution.result.data;
    const unrecovered = Array.isArray(data?.unrecovered)
      ? data.unrecovered
      : [];
    const retained = Array.isArray(data?.retained) ? data.retained : [];
    const cleanupResidue = Array.isArray(data?.cleanupResidue)
      ? data.cleanupResidue
      : [];
    const invalidationFailed = Array.isArray(data?.invalidationFailed)
      ? data.invalidationFailed
      : [];
    const lines = [
      `FAIL init: ${detail}`,
      ...unrecovered.map((path) => `UNRESTORED: ${String(path)}`),
      ...retained.map((path) => `Recovery copies retained: ${String(path)}`),
      ...invalidationFailed.map(
        (path) => `Marker invalidation failed: ${String(path)}`,
      ),
      ...cleanupResidue.map((path) => `Cleanup incomplete: ${String(path)}`),
    ];
    return Object.freeze({ stdout: "", stderr: `${lines.join("\n")}\n` });
  }
  const data = execution.result.data;
  const changes = Array.isArray(data?.changes) ? data.changes : [];
  // Rendered from the same collection the machine contract carries, so the
  // watching human sees exactly the steps the consumer was given.
  const nextSteps = (Array.isArray(data?.nextSteps) ? data.nextSteps : [])
    .map((step) => (step as { description?: unknown }).description)
    .filter(
      (description): description is string => typeof description === "string",
    );
  const preview = execution.result.outcome === "INIT_PREVIEW";
  const lines = [
    preview ? "PraxisBound init dry run" : "PraxisBound init",
    `Protocol snapshot: ${String(data?.protocolVersion)}`,
    `Provenance: ${String(data?.provenance)}`,
    "",
    ...changes.map((change) => {
      const entry = change as { kind?: unknown; path?: unknown };
      const verb = entry.kind === "replace" ? "replace" : "install";
      return preview
        ? `Would ${verb} ${String(entry.path)}`
        : `${verb === "replace" ? "Replaced" : "Installed"} ${String(entry.path)}`;
    }),
    "",
    ...(nextSteps.length === 0
      ? []
      : [
          "Next steps to complete this Adoption:",
          ...nextSteps.map(
            (description, index) => `${index + 1}. ${description}`,
          ),
          "",
        ]),
    preview
      ? "PraxisBound init dry run completed"
      : "PraxisBound init completed",
  ];
  return Object.freeze({ stdout: `${lines.join("\n")}\n`, stderr: "" });
}
