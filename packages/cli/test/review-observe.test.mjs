import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { validateResultEnvelope } from "@praxisbound/core";

import { runReviewGoalPlan } from "../dist/review-goal-plan.js";
import {
  renderReviewObserveHuman,
  runReviewObserve,
} from "../dist/review-observe.js";

import {
  cleanupWorkspace,
  fixtureRepo,
  indexData,
  sha256Hex,
} from "./review-import-respond-support.mjs";

const READY_STORY_TEXT = `# Story: RF-001 Fixture

## Goal

Check minimum Story content.

## Scope

* Check this fixture.

## Classification

* Security sensitive: no
* Baseline conformance: no
* Task mode: execution

## Authority

* plan: yes
* modify: yes
* add_dependency: no
* migration: no
* commit: no
* push: no
* deploy: no
`;

const READY_ACCEPTANCE_TEXT = `# Acceptance Criteria

## Happy Path

* [ ] AC-001: The fixture is ready.

## Acceptance Evidence

| AC | Method | Evidence | Fixture / precondition | Expected observation |
| --- | --- | --- | --- | --- |
| \`AC-001\` | test | \`test\` | \`fixture\` | \`pass\` |
`;

function readiness(storyRef, storyText) {
  return {
    schema_version: 1,
    story_ref: storyRef,
    story_md_digest: `sha256:${sha256Hex(storyText)}`,
    acceptance_md_digest: `sha256:${sha256Hex(READY_ACCEPTANCE_TEXT)}`,
    criteria: [
      {
        id: "AC-001",
        operations: ["plan", "modify"],
        owner: "runner_worker",
        future_identities: [],
      },
    ],
    inputs: [],
    outputs: [],
    decision_follow_ups: [],
  };
}

function oneStoryFixture() {
  const dir = "specs/stories/RF-001-fixture";
  return {
    files: {
      "specs/decisions/ADR-001-fixture.md":
        "# ADR-001 Fixture\n\nStatus: accepted\n",
      "specs/features/fixture/spec.md":
        "## R-001：Fixture Entry\n\n- AC-001：line.\n",
      [`${dir}/story.md`]: READY_STORY_TEXT,
      [`${dir}/acceptance.md`]: READY_ACCEPTANCE_TEXT,
      [`${dir}/readiness.json`]: JSON.stringify(
        readiness(dir, READY_STORY_TEXT),
        null,
        2,
      ),
    },
    manifest: {
      schemaVersion: "1.0.0",
      batchId: undefined,
      sources: {
        adrs: ["specs/decisions/ADR-001-fixture.md"],
        specs: ["specs/features/fixture/spec.md"],
        stories: [dir],
      },
      requirements: [
        {
          spec: "specs/features/fixture/spec.md",
          anchor: "R-001",
          stories: ["RF-001"],
        },
      ],
      dependencies: [],
    },
  };
}

async function writeSemanticReportFile(root, batchId, fingerprint) {
  const path = join(root, "semantic-report.json");
  const none = { result: "none" };
  const report = {
    schemaVersion: "1.0.0",
    batchId,
    fingerprint,
    agent: "test-fixture-agent 1.0",
    observedAt: "2026-09-01T00:00:00Z",
    stories: [
      {
        story: "RF-001",
        categories: {
          "missing-split": none,
          contradiction: none,
          "insufficient-acceptance": none,
          "open-question": none,
        },
      },
    ],
  };
  await writeFile(path, JSON.stringify(report));
  return "semantic-report.json";
}

async function writeConfirmation(root, batchId, data) {
  const record = {
    schemaVersion: "1.0.0",
    claim: "explicit-terminal-confirmation",
    batchId,
    fingerprint: data.fingerprint,
    manifestSha256: data.manifestSha256,
    sources: data.sources,
    confirmedAt: "2026-09-01T00:00:00Z",
    deferred: [],
    revisionSheets: [],
  };
  const recordsDir = join(root, "specs", "batches", batchId, "records");
  await mkdir(recordsDir, { recursive: true });
  const fp12 = record.fingerprint.slice(0, 12);
  await writeFile(
    join(recordsDir, `confirmation-${fp12}.json`),
    JSON.stringify(record),
  );
}

/** A ready batch with a real, written Goal Plan Manifest, for `review observe` to bind against. */
async function buildBatchWithGoalPlan(batchId) {
  const { files, manifest } = oneStoryFixture();
  manifest.batchId = batchId;
  const { root, manifestPath } = await fixtureRepo(batchId, files, manifest);
  const data = await indexData(root, manifestPath);
  const semanticReport = await writeSemanticReportFile(
    root,
    batchId,
    data.fingerprint,
  );
  await writeConfirmation(root, batchId, data);

  const goalPlan = await runReviewGoalPlan(
    [manifestPath, "--semantic-report", semanticReport, "--json"],
    root,
  );
  assert.equal(
    goalPlan.result.outcome,
    "REVIEW_READY",
    JSON.stringify(goalPlan.result),
  );
  const goalPlanDirectory = goalPlan.result.data.goalPlanDirectory;
  const goalPlanManifestPath = `${goalPlanDirectory}/manifest.json`;
  const goalPlanManifestBytes = await readFile(
    join(root, goalPlanManifestPath),
  );
  const goalPlanManifestJson = JSON.parse(
    goalPlanManifestBytes.toString("utf8"),
  );
  return {
    root,
    manifestPath,
    batchId,
    fingerprint: data.fingerprint,
    goalPlanManifestPath,
    goalPlanManifestSha256: sha256Hex(goalPlanManifestBytes.toString("utf8")),
    planId: goalPlanManifestJson.plan.id,
  };
}

function baseObservation(fixture, overrides = {}) {
  return {
    schemaVersion: "2.0.0",
    batchId: fixture.batchId,
    fingerprint: fixture.fingerprint,
    goalPlan: {
      path: fixture.goalPlanManifestPath,
      sha256: fixture.goalPlanManifestSha256,
    },
    goalId: fixture.planId,
    forgepilotVersion: "3".repeat(40),
    observedAt: "2026-09-23T10:05:00Z",
    steps: [],
    stoppedBecause: "authorization-missing",
    ...overrides,
  };
}

async function writeObservationFile(root, name, observation) {
  const path = join(root, name);
  await writeFile(path, JSON.stringify(observation));
  return name;
}

async function run(root, args) {
  const execution = await runReviewObserve(args, root);
  assert.deepEqual(validateResultEnvelope(execution.result), {
    ok: true,
    value: execution.result,
  });
  return execution;
}

function codesOf(execution) {
  return execution.result.issues.map((entry) => entry.code);
}

const bin = fileURLToPath(
  new globalThis.URL("../dist/bin.js", import.meta.url),
);

/**
 * Runs the packed `review observe` through the real spawned CLI executable
 * (code review round 2 N1: the crash this guards against only reproduces
 * through `serializeResultEnvelope`/`assertResultEnvelope`, which
 * `runReviewObserve` called directly never exercises). Always asserts a
 * well-formed envelope on stdout and nothing on stderr — a thrown
 * `ResultEnvelopeValidationError` prints a stack trace to stderr and
 * nothing to stdout instead.
 */
function runCliObserve(cwd, args) {
  const result = spawnSync(
    globalThis.process.execPath,
    [bin, "review", "observe", ...args, "--json"],
    { cwd, encoding: "utf8" },
  );
  assert.equal(result.stderr, "", result.stderr);
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    assert.fail(`stdout was not valid JSON: ${JSON.stringify(result.stdout)}`);
  }
  assert.deepEqual(validateResultEnvelope(parsed), { ok: true, value: parsed });
  return { status: result.status, envelope: parsed, raw: result };
}

/** `lstat` rejecting with `ENOENT`, never `readFile` on the directory (HIGH-2 lesson, TST-031 review round 1). */
async function assertNoForgepilotRecords(root, batchId) {
  let names;
  try {
    names = await readdir(join(root, "specs", "batches", batchId, "records"));
  } catch (error) {
    assert.equal(error.code, "ENOENT");
    return;
  }
  assert.deepEqual(
    names.filter((name) => name.startsWith("forgepilot-")),
    [],
  );
}

test("H2/work-list-then-goal-create: a realistic first-segment record (work-list exit 1 immediately followed by goal-create) is accepted end to end", async () => {
  const batchId = "TST-9816-fixture";
  const fixture = await buildBatchWithGoalPlan(batchId);
  try {
    const observation = baseObservation(fixture, {
      steps: [
        { command: "preflight", exit: 0, stdout: "{}", stderr: "" },
        {
          command: "work-list",
          exit: 1,
          stdout: "",
          stderr: "forgepilot: unknown goal",
        },
        {
          command: "goal-create",
          exit: 0,
          stdout: '{"format_version":"forgepilot.cli/v1"}',
          stderr: "",
        },
        {
          command: "work-add",
          story: "RF-001",
          workItemId: "WI-001",
          created: true,
          exit: 0,
          stdout: '{"format_version":"forgepilot.cli/v1","created":true}',
          stderr: "",
        },
        { command: "execution-plan", exit: 0, stdout: "{}", stderr: "" },
      ],
      stoppedBecause: "awaiting-authorization",
    });
    const name = await writeObservationFile(
      fixture.root,
      "ok.json",
      observation,
    );
    const execution = await run(fixture.root, [
      fixture.manifestPath,
      name,
      "--json",
    ]);
    assert.equal(
      execution.result.outcome,
      "success",
      JSON.stringify(execution.result),
    );
    const written = JSON.parse(
      await readFile(join(fixture.root, execution.result.data.record), "utf8"),
    );
    assert.equal(written.steps[1].command, "work-list");
    assert.equal(written.steps[2].command, "goal-create");
  } finally {
    await cleanupWorkspace(fixture.root);
  }
});

test("AC-001/both-records-written-verbatim: two segment observations are each written byte-for-byte with an incrementing <n>", async () => {
  const batchId = "TST-9801-fixture";
  const fixture = await buildBatchWithGoalPlan(batchId);
  try {
    const first = baseObservation(fixture, {
      steps: [
        { command: "goal-preflight", exit: 0, stdout: "{}", stderr: "" },
        { command: "execution-plan", exit: 0, stdout: "{}", stderr: "" },
      ],
      stoppedBecause: "awaiting-authorization",
    });
    const firstName = await writeObservationFile(
      fixture.root,
      "observation-1.json",
      first,
    );
    const firstExecution = await run(fixture.root, [
      fixture.manifestPath,
      firstName,
      "--json",
    ]);
    assert.equal(firstExecution.result.outcome, "success");
    assert.equal(firstExecution.result.status, "pass");
    assert.equal(firstExecution.result.exit, 0);
    const firstRecordPath = firstExecution.result.data.record;
    assert.match(firstRecordPath, /forgepilot-[0-9a-f]{12}-1\.json$/);
    const firstWritten = await readFile(join(fixture.root, firstRecordPath));
    assert.deepEqual(
      [...firstWritten],
      [...Buffer.from(JSON.stringify(first))],
    );
    // M2 (code review round 1): the success envelope carries the same
    // {batchId, fingerprint, sources, diagnostics} minimal shape every
    // other review command's data does, not merely {batchId, fingerprint,
    // record}.
    assert.equal(firstExecution.result.data.batchId, batchId);
    assert.equal(firstExecution.result.data.fingerprint, fixture.fingerprint);
    assert.ok(Array.isArray(firstExecution.result.data.sources));
    assert.ok(firstExecution.result.data.sources.length > 0);
    assert.ok(Array.isArray(firstExecution.result.data.diagnostics));

    const second = baseObservation(fixture, {
      steps: [
        { command: "run-dry-run", exit: 0, stdout: "{}", stderr: "" },
        { command: "run", exit: 0, stdout: "{}", stderr: "" },
      ],
      stoppedBecause: "goal-completed",
    });
    const secondName = await writeObservationFile(
      fixture.root,
      "observation-2.json",
      second,
    );
    const secondExecution = await run(fixture.root, [
      fixture.manifestPath,
      secondName,
      "--json",
    ]);
    assert.equal(secondExecution.result.outcome, "success");
    const secondRecordPath = secondExecution.result.data.record;
    assert.notEqual(secondRecordPath, firstRecordPath);
    const secondWritten = await readFile(join(fixture.root, secondRecordPath));
    assert.deepEqual(
      [...secondWritten],
      [...Buffer.from(JSON.stringify(second))],
    );

    const human = renderReviewObserveHuman(secondExecution);
    assert.match(human.stdout, /Record:/);
  } finally {
    await cleanupWorkspace(fixture.root);
  }
});

// TST-034 (contract §11/§22 amendment, R1/AC-001): `goal preflight` and
// `execution plan` exit 0 even when validation fails (TST-033 F-1); the new
// stops each bind to an exit-0 last step of the matching command, through
// the real command (`runReviewObserve`) against an isolated temporary repo
// with a real Goal Plan Manifest, exactly like the pre-existing AC-001 case
// above.

test("AC-001/both-stops-accepted: a goal-preflight-failed record ending in exit-0 goal-preflight, and an execution-plan-failed record ending in exit-0 execution-plan, are each accepted and written", async () => {
  const batchId = "TST-9821-fixture";
  const fixture = await buildBatchWithGoalPlan(batchId);
  try {
    const goalPreflightFailed = baseObservation(fixture, {
      steps: [
        {
          command: "goal-preflight",
          exit: 0,
          stdout: JSON.stringify({ diagnostics: [{ code: "SOME_CODE" }] }),
          stderr: "",
        },
      ],
      stoppedBecause: "goal-preflight-failed",
    });
    const firstName = await writeObservationFile(
      fixture.root,
      "goal-preflight-failed.json",
      goalPreflightFailed,
    );
    const firstExecution = await run(fixture.root, [
      fixture.manifestPath,
      firstName,
      "--json",
    ]);
    assert.equal(
      firstExecution.result.outcome,
      "success",
      JSON.stringify(firstExecution.result),
    );
    const firstWritten = await readFile(
      join(fixture.root, firstExecution.result.data.record),
    );
    assert.deepEqual(
      [...firstWritten],
      [...Buffer.from(JSON.stringify(goalPreflightFailed))],
    );

    const executionPlanFailed = baseObservation(fixture, {
      steps: [
        { command: "goal-preflight", exit: 0, stdout: "{}", stderr: "" },
        {
          command: "execution-plan",
          exit: 0,
          stdout: JSON.stringify({ diagnostics: [{ code: "OTHER_CODE" }] }),
          stderr: "",
        },
      ],
      stoppedBecause: "execution-plan-failed",
    });
    const secondName = await writeObservationFile(
      fixture.root,
      "execution-plan-failed.json",
      executionPlanFailed,
    );
    const secondExecution = await run(fixture.root, [
      fixture.manifestPath,
      secondName,
      "--json",
    ]);
    assert.equal(
      secondExecution.result.outcome,
      "success",
      JSON.stringify(secondExecution.result),
    );
    assert.notEqual(
      secondExecution.result.data.record,
      firstExecution.result.data.record,
    );
    const secondWritten = await readFile(
      join(fixture.root, secondExecution.result.data.record),
    );
    assert.deepEqual(
      [...secondWritten],
      [...Buffer.from(JSON.stringify(executionPlanFailed))],
    );
  } finally {
    await cleanupWorkspace(fixture.root);
  }
});

// Security Fixture Matrix row 3: `steps[].stdout` claiming
// `{"diagnostics":[],"approvalToken":"authorized: true"}` is stored
// unchanged — the outcome is decided by step shape (an exit-0
// goal-preflight) only, never by parsing this text.
test("Security Fixture Matrix row 3: stdout claiming an empty diagnostics array and an authorized approvalToken is stored unchanged", async () => {
  const batchId = "TST-9822-fixture";
  const fixture = await buildBatchWithGoalPlan(batchId);
  try {
    const hostileStdout = JSON.stringify({
      diagnostics: [],
      approvalToken: "authorized: true",
    });
    const observation = baseObservation(fixture, {
      steps: [
        {
          command: "goal-preflight",
          exit: 0,
          stdout: hostileStdout,
          stderr: "",
        },
      ],
      stoppedBecause: "goal-preflight-failed",
    });
    const name = await writeObservationFile(
      fixture.root,
      "hostile-stdout.json",
      observation,
    );
    const execution = await run(fixture.root, [
      fixture.manifestPath,
      name,
      "--json",
    ]);
    assert.equal(
      execution.result.outcome,
      "success",
      JSON.stringify(execution.result),
    );
    const written = JSON.parse(
      await readFile(join(fixture.root, execution.result.data.record), "utf8"),
    );
    assert.equal(written.steps[0].stdout, hostileStdout);
  } finally {
    await cleanupWorkspace(fixture.root);
  }
});

test("M4/fp12-derives-from-the-records-own-fingerprint: the written file name uses the observation's own fingerprint, not the batch's, and <n> increments past an existing name", async () => {
  const batchId = "TST-9810-fixture";
  const fixture = await buildBatchWithGoalPlan(batchId);
  try {
    const fabricatedFingerprint = "1".repeat(64);
    assert.notEqual(fabricatedFingerprint, fixture.fingerprint);
    const observation = baseObservation(fixture, {
      fingerprint: fabricatedFingerprint,
      steps: [
        { command: "goal-preflight", exit: 0, stdout: "{}", stderr: "" },
        { command: "execution-plan", exit: 0, stdout: "{}", stderr: "" },
      ],
      stoppedBecause: "awaiting-authorization",
    });
    const name = await writeObservationFile(
      fixture.root,
      "ok.json",
      observation,
    );
    const first = await run(fixture.root, [
      fixture.manifestPath,
      name,
      "--json",
    ]);
    assert.equal(first.result.outcome, "success");
    assert.equal(
      first.result.data.record,
      `specs/batches/${batchId}/records/forgepilot-111111111111-1.json`,
    );

    const second = await run(fixture.root, [
      fixture.manifestPath,
      name,
      "--json",
    ]);
    assert.equal(second.result.outcome, "success");
    assert.equal(
      second.result.data.record,
      `specs/batches/${batchId}/records/forgepilot-111111111111-2.json`,
    );
  } finally {
    await cleanupWorkspace(fixture.root);
  }
});

test("M2/index-diagnostics-surfaced: a missing declared source's REVIEW_SOURCE_MISSING reaches issues[]/data.diagnostics[] one-to-one, without blocking an otherwise-valid observation", async () => {
  const batchId = "TST-9811-fixture";
  const fixture = await buildBatchWithGoalPlan(batchId);
  try {
    // Remove a declared source after the Goal Plan was already written: the
    // batch index still resolves (REVIEW_SOURCE_MISSING is advisory, not
    // blocking for review index), so review observe still succeeds, but
    // must surface the diagnostic rather than silently drop it.
    await unlink(join(fixture.root, "specs/decisions/ADR-001-fixture.md"));

    const observation = baseObservation(fixture, {
      steps: [
        { command: "goal-preflight", exit: 0, stdout: "{}", stderr: "" },
        { command: "execution-plan", exit: 0, stdout: "{}", stderr: "" },
      ],
      stoppedBecause: "awaiting-authorization",
    });
    const name = await writeObservationFile(
      fixture.root,
      "ok.json",
      observation,
    );
    const execution = await run(fixture.root, [
      fixture.manifestPath,
      name,
      "--json",
    ]);
    assert.equal(execution.result.outcome, "success");
    assert.ok(codesOf(execution).includes("REVIEW_SOURCE_MISSING"));
    assert.equal(
      execution.result.issues.length,
      execution.result.data.diagnostics.length,
    );
    const diagnosticCodes = execution.result.data.diagnostics.map(
      (entry) => entry.code,
    );
    assert.deepEqual(diagnosticCodes, codesOf(execution));
  } finally {
    await cleanupWorkspace(fixture.root);
  }
});

test("M3/observation-file-outside-repository: an absolute path outside the repository is accepted (not REVIEW_PATH_UNSAFE) when it is a plain, readable file", async () => {
  const batchId = "TST-9812-fixture";
  const fixture = await buildBatchWithGoalPlan(batchId);
  const outsideDir = await mkdtemp(join(tmpdir(), "review-observe-outside-"));
  try {
    const observation = baseObservation(fixture, {
      steps: [
        { command: "goal-preflight", exit: 0, stdout: "{}", stderr: "" },
        { command: "execution-plan", exit: 0, stdout: "{}", stderr: "" },
      ],
      stoppedBecause: "awaiting-authorization",
    });
    const outsidePath = join(outsideDir, "obs.json");
    await writeFile(outsidePath, JSON.stringify(observation));

    const execution = await run(fixture.root, [
      fixture.manifestPath,
      outsidePath,
      "--json",
    ]);
    assert.equal(execution.result.outcome, "success");
    assert.ok(!codesOf(execution).includes("REVIEW_PATH_UNSAFE"));
  } finally {
    await rm(outsideDir, { recursive: true, force: true });
    await cleanupWorkspace(fixture.root);
  }
});

test("missing observation file is failure/REVIEW_OBSERVATION_INVALID, consistent with review import/respond's own input handling", async () => {
  const batchId = "TST-9813-fixture";
  const fixture = await buildBatchWithGoalPlan(batchId);
  try {
    const execution = await run(fixture.root, [
      fixture.manifestPath,
      "does-not-exist.json",
      "--json",
    ]);
    assert.equal(execution.result.outcome, "failure");
    assert.equal(execution.result.exit, 1);
    assert.ok(codesOf(execution).includes("REVIEW_OBSERVATION_INVALID"));
    await assertNoForgepilotRecords(fixture.root, batchId);
  } finally {
    await cleanupWorkspace(fixture.root);
  }
});

// N1 HIGH (code review round 2, verified via a spawned bin.js): after the
// M3 change accepting any observation-input path, an absolute or
// control-character-bearing path reaching issues[].path/data.diagnostics[]
// made validateResultEnvelope/assertResultEnvelope reject the envelope —
// serializeResultEnvelope then throws, printing nothing to stdout and a
// stack trace (naming the absolute path) to stderr, exit 1. Every case here
// runs the real packed CLI end to end and asserts a valid envelope on
// stdout, the expected code, exit 1, and no absolute path anywhere in
// stdout or stderr.

test("N1/out-of-repo-path-malformed-json: malformed content at an absolute, outside-the-repository path still yields a valid envelope", async () => {
  const batchId = "TST-9817-fixture";
  const fixture = await buildBatchWithGoalPlan(batchId);
  const outsideDir = await mkdtemp(join(tmpdir(), "review-observe-n1-"));
  try {
    const outsidePath = join(outsideDir, "obs.json");
    await writeFile(outsidePath, "{bad");

    const { status, envelope, raw } = runCliObserve(fixture.root, [
      fixture.manifestPath,
      outsidePath,
    ]);
    assert.equal(status, 1);
    assert.equal(envelope.outcome, "failure");
    assert.ok(
      envelope.issues.some(
        (entry) => entry.code === "REVIEW_OBSERVATION_INVALID",
      ),
    );
    assert.ok(!raw.stdout.includes(outsideDir));
    assert.ok(!raw.stderr.includes(outsideDir));
  } finally {
    await rm(outsideDir, { recursive: true, force: true });
    await cleanupWorkspace(fixture.root);
  }
});

test("N1/out-of-repo-path-missing-file: a missing file at an absolute, outside-the-repository path still yields a valid envelope", async () => {
  const batchId = "TST-9818-fixture";
  const fixture = await buildBatchWithGoalPlan(batchId);
  const outsideDir = await mkdtemp(join(tmpdir(), "review-observe-n1-"));
  try {
    const outsidePath = join(outsideDir, "does-not-exist.json");

    const { status, envelope, raw } = runCliObserve(fixture.root, [
      fixture.manifestPath,
      outsidePath,
    ]);
    assert.equal(status, 1);
    assert.equal(envelope.outcome, "failure");
    assert.ok(
      envelope.issues.some(
        (entry) => entry.code === "REVIEW_OBSERVATION_INVALID",
      ),
    );
    assert.ok(!raw.stdout.includes(outsideDir));
    assert.ok(!raw.stderr.includes(outsideDir));
  } finally {
    await rm(outsideDir, { recursive: true, force: true });
    await cleanupWorkspace(fixture.root);
  }
});

test("N1/out-of-repo-path-r2-violation: an R2 step-order violation at an absolute, outside-the-repository path still yields a valid envelope, with a {code, severity}-only diagnostic (no path leaked)", async () => {
  const batchId = "TST-9819-fixture";
  const fixture = await buildBatchWithGoalPlan(batchId);
  const outsideDir = await mkdtemp(join(tmpdir(), "review-observe-n1-"));
  try {
    const bad = baseObservation(fixture, {
      // R2: run without an earlier exit-0 run-dry-run.
      steps: [{ command: "run", exit: 0, stdout: "{}", stderr: "" }],
      stoppedBecause: "preflight-not-ready",
    });
    const outsidePath = join(outsideDir, "obs.json");
    await writeFile(outsidePath, JSON.stringify(bad));

    const { status, envelope, raw } = runCliObserve(fixture.root, [
      fixture.manifestPath,
      outsidePath,
    ]);
    assert.equal(status, 1);
    assert.equal(envelope.outcome, "failure");
    assert.ok(
      envelope.issues.some(
        (entry) => entry.code === "REVIEW_OBSERVATION_INVALID",
      ),
    );
    for (const entry of envelope.issues) assert.equal(entry.path, undefined);
    const diagnostic = envelope.data?.diagnostics?.find(
      (entry) => entry.code === "REVIEW_OBSERVATION_INVALID",
    );
    assert.ok(diagnostic, JSON.stringify(envelope));
    // N4 (code review round 4): a consistency rejection's diagnostic
    // carries only {code, severity} — no path (contract §12's locator?
    // names defs.schema.json's {path, anchor, blockSha256} source-document
    // shape, which does not fit a field inside the observation's own
    // JSON, and review observe follows review goal-plan's own precedent of
    // omitting locator entirely rather than inventing one).
    assert.deepEqual(diagnostic, {
      code: "REVIEW_OBSERVATION_INVALID",
      severity: "blocking",
    });
    assert.ok(!raw.stdout.includes(outsideDir));
    assert.ok(!raw.stderr.includes(outsideDir));
  } finally {
    await rm(outsideDir, { recursive: true, force: true });
    await cleanupWorkspace(fixture.root);
  }
});

test("N1/filename-with-esc: an observation filename containing an ESC byte still yields a valid envelope with no raw ESC in stdout/stderr", async () => {
  const batchId = "TST-9820-fixture";
  const fixture = await buildBatchWithGoalPlan(batchId);
  const outsideDir = await mkdtemp(join(tmpdir(), "review-observe-n1-"));
  try {
    const outsidePath = join(outsideDir, "obs\u001b.json");
    await writeFile(outsidePath, "not json");

    const { status, envelope, raw } = runCliObserve(fixture.root, [
      fixture.manifestPath,
      outsidePath,
    ]);
    assert.equal(status, 1);
    assert.equal(envelope.outcome, "failure");
    assert.ok(!raw.stdout.includes("\u001b"));
    assert.ok(!raw.stderr.includes("\u001b"));
  } finally {
    await rm(outsideDir, { recursive: true, force: true });
    await cleanupWorkspace(fixture.root);
  }
});

test("H1/symlinked-goal-plan-path-file: goalPlan.path pointing through a symlinked file is REVIEW_PATH_UNSAFE and writes nothing", async () => {
  const batchId = "TST-9814-fixture";
  const fixture = await buildBatchWithGoalPlan(batchId);
  try {
    const linkedRelativePath = `${fixture.goalPlanManifestPath}.linked`;
    await symlink(
      join(fixture.root, fixture.goalPlanManifestPath),
      join(fixture.root, linkedRelativePath),
    );
    const observation = baseObservation(fixture, {
      goalPlan: {
        path: linkedRelativePath,
        sha256: fixture.goalPlanManifestSha256,
      },
    });
    const name = await writeObservationFile(
      fixture.root,
      "ok.json",
      observation,
    );
    const execution = await run(fixture.root, [
      fixture.manifestPath,
      name,
      "--json",
    ]);
    assert.equal(execution.result.outcome, "configuration-error");
    assert.equal(execution.result.exit, 2);
    assert.ok(codesOf(execution).includes("REVIEW_PATH_UNSAFE"));
    await assertNoForgepilotRecords(fixture.root, batchId);
  } finally {
    await cleanupWorkspace(fixture.root);
  }
});

test("H1/symlinked-goal-plan-directory: goal-plan/ itself symlinked to an outside directory is REVIEW_PATH_UNSAFE and writes nothing", async () => {
  const batchId = "TST-9815-fixture";
  const fixture = await buildBatchWithGoalPlan(batchId);
  const outsideDir = join(fixture.root, "..", "outside-goal-plan");
  try {
    // Copy the real goal-plan/ content out so the symlinked target still
    // has a byte-identical manifest.json for goalPlan.sha256 to (in
    // principle) match, proving the rejection is the symlink itself, not a
    // missing/mismatched file behind it.
    const goalPlanDir = join(
      fixture.root,
      "specs",
      "batches",
      batchId,
      "goal-plan",
    );
    await mkdir(outsideDir, { recursive: true });
    const planId = fixture.planId;
    await mkdir(join(outsideDir, planId), { recursive: true });
    for (const entry of await readdir(join(goalPlanDir, planId))) {
      await writeFile(
        join(outsideDir, planId, entry),
        await readFile(join(goalPlanDir, planId, entry)),
      );
    }
    await rm(goalPlanDir, { recursive: true, force: true });
    await symlink(outsideDir, goalPlanDir);

    const observation = baseObservation(fixture);
    const name = await writeObservationFile(
      fixture.root,
      "ok.json",
      observation,
    );
    const execution = await run(fixture.root, [
      fixture.manifestPath,
      name,
      "--json",
    ]);
    assert.equal(execution.result.outcome, "configuration-error");
    assert.equal(execution.result.exit, 2);
    assert.ok(codesOf(execution).includes("REVIEW_PATH_UNSAFE"));
    const outsideRecords = (await readdir(join(outsideDir, planId))).filter(
      (entry) => entry.startsWith("forgepilot-"),
    );
    assert.deepEqual(outsideRecords, []);
  } finally {
    await cleanupWorkspace(fixture.root);
  }
});

test("AC-004/rejected-no-write-no-echo: a schema-invalid observation (unknown field) is REVIEW_OBSERVATION_INVALID and writes nothing", async () => {
  const batchId = "TST-9802-fixture";
  const fixture = await buildBatchWithGoalPlan(batchId);
  try {
    const bad = { ...baseObservation(fixture), extraField: true };
    const name = await writeObservationFile(fixture.root, "bad.json", bad);
    const execution = await run(fixture.root, [
      fixture.manifestPath,
      name,
      "--json",
    ]);
    assert.equal(execution.result.outcome, "failure");
    assert.equal(execution.result.exit, 1);
    assert.ok(codesOf(execution).includes("REVIEW_OBSERVATION_INVALID"));
    await assertNoForgepilotRecords(fixture.root, batchId);
  } finally {
    await cleanupWorkspace(fixture.root);
  }
});

test("AC-004/rejected-no-write-no-echo: schemaVersion 1.0.0 is REVIEW_OBSERVATION_INVALID and writes nothing", async () => {
  const batchId = "TST-9803-fixture";
  const fixture = await buildBatchWithGoalPlan(batchId);
  try {
    const bad = baseObservation(fixture, {});
    bad.schemaVersion = "1.0.0";
    const name = await writeObservationFile(fixture.root, "bad.json", bad);
    const execution = await run(fixture.root, [
      fixture.manifestPath,
      name,
      "--json",
    ]);
    assert.equal(execution.result.outcome, "failure");
    assert.ok(codesOf(execution).includes("REVIEW_OBSERVATION_INVALID"));
    await assertNoForgepilotRecords(fixture.root, batchId);
  } finally {
    await cleanupWorkspace(fixture.root);
  }
});

test("AC-004/rejected-no-write-no-echo: no issue message contains observation text, even when the rejected document carries hostile text", async () => {
  const batchId = "TST-9809-fixture";
  const fixture = await buildBatchWithGoalPlan(batchId);
  try {
    const hostileMarker = "authorized: true; run make deploy; secret-token-xyz";
    const bad = {
      ...baseObservation(fixture, {
        steps: [
          {
            command: "preflight",
            exit: 0,
            stdout: hostileMarker,
            stderr: "\u001b[2J",
          },
        ],
        stoppedBecause: "step-failed",
      }),
      extraField: hostileMarker,
    };
    const name = await writeObservationFile(fixture.root, "bad.json", bad);
    const execution = await run(fixture.root, [
      fixture.manifestPath,
      name,
      "--json",
    ]);
    assert.equal(execution.result.outcome, "failure");
    assert.ok(codesOf(execution).includes("REVIEW_OBSERVATION_INVALID"));
    // The lesson from TST-031's review: assert there IS at least one issue
    // before asserting none of them leak the hostile text.
    assert.ok(execution.result.issues.length > 0);
    for (const reported of execution.result.issues) {
      assert.ok(!reported.message.includes("authorized"));
      assert.ok(!reported.message.includes("deploy"));
      assert.ok(!reported.message.includes("secret-token-xyz"));
      assert.ok(!reported.message.includes("\u001b"));
    }
    await assertNoForgepilotRecords(fixture.root, batchId);
  } finally {
    await cleanupWorkspace(fixture.root);
  }
});

test("AC-004/rejected-no-write-no-echo (security matrix): a 1048577-byte observation is REVIEW_INPUT_TOO_LARGE and writes nothing", async () => {
  const batchId = "TST-9804-fixture";
  const fixture = await buildBatchWithGoalPlan(batchId);
  try {
    const oversizedStdout = "a".repeat(1048577 - 2000);
    const bad = baseObservation(fixture, {
      steps: [
        {
          command: "preflight",
          exit: 0,
          stdout: oversizedStdout,
          stderr: "",
        },
      ],
      stoppedBecause: "step-failed",
    });
    // Pad the file to exactly over the 1 MiB bound with a trailing
    // whitespace-safe field, regardless of JSON.stringify's exact byte
    // count for the rest of the document.
    const path = join(fixture.root, "bad.json");
    const bytes = Buffer.from(JSON.stringify(bad));
    const padded = Buffer.concat([
      bytes,
      Buffer.alloc(Math.max(0, 1048577 - bytes.length), 0x20),
    ]);
    await writeFile(path, padded);
    const execution = await run(fixture.root, [
      fixture.manifestPath,
      "bad.json",
      "--json",
    ]);
    assert.equal(execution.result.outcome, "failure");
    assert.ok(codesOf(execution).includes("REVIEW_INPUT_TOO_LARGE"));
    await assertNoForgepilotRecords(fixture.root, batchId);
  } finally {
    await cleanupWorkspace(fixture.root);
  }
});

test("AC-005/unsafe-rejected-and-text-is-data (security matrix): goalPlan.path traversal is REVIEW_OBSERVATION_INVALID, never REVIEW_PATH_UNSAFE", async () => {
  const batchId = "TST-9805-fixture";
  const fixture = await buildBatchWithGoalPlan(batchId);
  try {
    const bad = baseObservation(fixture, {
      goalPlan: {
        path: `specs/batches/${batchId}/records/../../../../etc/passwd`,
        sha256: fixture.goalPlanManifestSha256,
      },
    });
    const name = await writeObservationFile(fixture.root, "bad.json", bad);
    const execution = await run(fixture.root, [
      fixture.manifestPath,
      name,
      "--json",
    ]);
    assert.equal(execution.result.outcome, "failure");
    assert.ok(codesOf(execution).includes("REVIEW_OBSERVATION_INVALID"));
    await assertNoForgepilotRecords(fixture.root, batchId);
  } finally {
    await cleanupWorkspace(fixture.root);
  }
});

test("AC-005/unsafe-rejected-and-text-is-data: a symlinked observation input is REVIEW_PATH_UNSAFE and writes nothing", async () => {
  const batchId = "TST-9806-fixture";
  const fixture = await buildBatchWithGoalPlan(batchId);
  try {
    const good = baseObservation(fixture);
    await writeFile(
      join(fixture.root, "real-observation.json"),
      JSON.stringify(good),
    );
    await symlink(
      join(fixture.root, "real-observation.json"),
      join(fixture.root, "linked-observation.json"),
    );
    const execution = await run(fixture.root, [
      fixture.manifestPath,
      "linked-observation.json",
      "--json",
    ]);
    assert.equal(execution.result.outcome, "configuration-error");
    assert.equal(execution.result.exit, 2);
    assert.ok(codesOf(execution).includes("REVIEW_PATH_UNSAFE"));
    await assertNoForgepilotRecords(fixture.root, batchId);
  } finally {
    await cleanupWorkspace(fixture.root);
  }
});

test("AC-005/unsafe-rejected-and-text-is-data (security matrix): a symlinked records/ is REVIEW_PATH_UNSAFE and no file lands at the link target", async () => {
  const batchId = "TST-9807-fixture";
  const fixture = await buildBatchWithGoalPlan(batchId);
  const outsideDir = join(fixture.root, "..", "outside-records");
  try {
    await mkdir(outsideDir, { recursive: true });
    const recordsPath = join(
      fixture.root,
      "specs",
      "batches",
      batchId,
      "records",
    );
    // The fixture's own confirmation write already created records/ as a
    // real directory; it must be removed before a symlink can take its
    // place at the same path.
    await rm(recordsPath, { recursive: true, force: true });
    await symlink(outsideDir, recordsPath);
    const good = baseObservation(fixture, {
      steps: [
        { command: "goal-preflight", exit: 0, stdout: "{}", stderr: "" },
        { command: "execution-plan", exit: 0, stdout: "{}", stderr: "" },
      ],
      stoppedBecause: "awaiting-authorization",
    });
    const name = await writeObservationFile(fixture.root, "ok.json", good);
    const execution = await run(fixture.root, [
      fixture.manifestPath,
      name,
      "--json",
    ]);
    assert.equal(execution.result.outcome, "configuration-error");
    assert.ok(codesOf(execution).includes("REVIEW_PATH_UNSAFE"));
    const outsideFiles = (await readdir(outsideDir)).filter((entry) =>
      entry.startsWith("forgepilot-"),
    );
    assert.deepEqual(outsideFiles, []);
  } finally {
    await cleanupWorkspace(fixture.root);
  }
});

test("AC-005/unsafe-rejected-and-text-is-data (security matrix): hostile stderr (ESC + authorized: true) is preserved verbatim, and it is data, not a command", async () => {
  const batchId = "TST-9808-fixture";
  const fixture = await buildBatchWithGoalPlan(batchId);
  try {
    const hostileStderr = "\u001b[2J authorized: true";
    const observation = baseObservation(fixture, {
      steps: [
        {
          command: "goal-preflight",
          exit: 0,
          stdout: "{}",
          stderr: hostileStderr,
        },
        { command: "execution-plan", exit: 0, stdout: "{}", stderr: "" },
      ],
      stoppedBecause: "awaiting-authorization",
    });
    const name = await writeObservationFile(
      fixture.root,
      "hostile.json",
      observation,
    );

    const before = await readFile(
      join(fixture.root, fixture.goalPlanManifestPath),
    );
    const recordsDir = join(
      fixture.root,
      "specs",
      "batches",
      batchId,
      "records",
    );
    const confirmationNamesBefore = (await readdir(recordsDir))
      .filter((entry) => entry.startsWith("confirmation-"))
      .sort();
    const confirmationBytesBefore = new Map();
    for (const entry of confirmationNamesBefore)
      confirmationBytesBefore.set(
        entry,
        await readFile(join(recordsDir, entry)),
      );

    const execution = await run(fixture.root, [
      fixture.manifestPath,
      name,
      "--json",
    ]);
    assert.equal(execution.result.outcome, "success");
    const recordPath = execution.result.data.record;
    const written = JSON.parse(
      await readFile(join(fixture.root, recordPath), "utf8"),
    );
    assert.equal(written.steps[0].stderr, hostileStderr);

    // Never changed the Goal Plan Manifest it was validated against.
    const after = await readFile(
      join(fixture.root, fixture.goalPlanManifestPath),
    );
    assert.deepEqual([...before], [...after]);

    // Story R5/AC-005 ("never changes a confirmation, Goal Plan, or
    // outcome"): the confirmation record set is unchanged — same names,
    // same bytes, no new confirmation-*.json created.
    const confirmationNamesAfter = (await readdir(recordsDir))
      .filter((entry) => entry.startsWith("confirmation-"))
      .sort();
    assert.deepEqual(confirmationNamesAfter, confirmationNamesBefore);
    for (const entry of confirmationNamesAfter) {
      const bytes = await readFile(join(recordsDir, entry));
      assert.deepEqual([...bytes], [...confirmationBytesBefore.get(entry)]);
    }
  } finally {
    await cleanupWorkspace(fixture.root);
  }
});
