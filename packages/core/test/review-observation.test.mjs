import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { TextDecoder, TextEncoder } from "node:util";
import test from "node:test";

import {
  validateForgepilotObservation,
  validateForgepilotObservationShape,
} from "@praxisbound/core";

const BATCH_ID = "BR-001-checkout-refunds";
const GOAL_PLAN_ID = `${BATCH_ID}-8e2b7d4c1a09`;
const GOAL_PLAN_PATH = `specs/batches/${BATCH_ID}/goal-plan/${GOAL_PLAN_ID}/manifest.json`;

function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function goalPlanManifestBytes(planId = GOAL_PLAN_ID) {
  return new TextEncoder().encode(JSON.stringify({ plan: { id: planId } }));
}

const GOAL_PLAN_MANIFEST_BYTES = goalPlanManifestBytes();
const GOAL_PLAN_SHA256 = sha256Hex(
  new TextDecoder().decode(GOAL_PLAN_MANIFEST_BYTES),
);

function step(overrides = {}) {
  return {
    command: "preflight",
    exit: 0,
    stdout: "",
    stderr: "",
    ...overrides,
  };
}

function observation(overrides = {}) {
  return {
    schemaVersion: "2.0.0",
    batchId: BATCH_ID,
    fingerprint: "a".repeat(64),
    goalPlan: { path: GOAL_PLAN_PATH, sha256: GOAL_PLAN_SHA256 },
    forgepilotVersion: "3".padStart(40, "0"),
    observedAt: "2026-09-23T10:05:00Z",
    steps: [],
    stoppedBecause: "authorization-missing",
    ...overrides,
  };
}

function context(overrides = {}) {
  return {
    batchId: BATCH_ID,
    goalPlanManifestBytes: GOAL_PLAN_MANIFEST_BYTES,
    ...overrides,
  };
}

function assertRejected(data, ctx = context()) {
  const result = validateForgepilotObservation(data, ctx);
  assert.equal(result.ok, false, JSON.stringify(data));
  return result;
}

test("happy path: a well-formed authorization-missing observation with no steps is accepted", () => {
  const result = validateForgepilotObservation(observation(), context());
  assert.equal(result.ok, true);
});

test("happy path: an awaiting-authorization observation ending in an exit-0 execution-plan is accepted", () => {
  const result = validateForgepilotObservation(
    observation({
      steps: [
        step({ command: "goal-preflight" }),
        step({ command: "execution-plan" }),
      ],
      stoppedBecause: "awaiting-authorization",
    }),
    context(),
  );
  assert.equal(result.ok, true);
});

test("happy path: a goal-completed observation ending in exit-0 run, preceded by exit-0 run-dry-run, is accepted", () => {
  const result = validateForgepilotObservation(
    observation({
      steps: [step({ command: "run-dry-run" }), step({ command: "run" })],
      stoppedBecause: "goal-completed",
    }),
    context(),
  );
  assert.equal(result.ok, true);
});

test("AC-003/step-and-binding-violations: batchId mismatch is rejected", () => {
  assertRejected(observation({ batchId: "OTHER-999-fixture" }));
});

test("AC-003/step-and-binding-violations: goalPlan.path outside goal-plan/ is rejected", () => {
  assertRejected(
    observation({
      goalPlan: {
        path: `specs/batches/${BATCH_ID}/records/manifest.json`,
        sha256: GOAL_PLAN_SHA256,
      },
    }),
  );
});

test("AC-003/step-and-binding-violations: a missing Goal Plan Manifest is rejected", () => {
  assertRejected(observation(), context({ goalPlanManifestBytes: undefined }));
});

test("AC-003/step-and-binding-violations: a wrong goalPlan.sha256 is rejected", () => {
  assertRejected(
    observation({ goalPlan: { path: GOAL_PLAN_PATH, sha256: "b".repeat(64) } }),
  );
});

test("AC-003/step-and-binding-violations: goalId not equal to the manifest's plan.id is rejected", () => {
  assertRejected(observation({ goalId: "not-the-plan-id" }));
});

test("AC-003/step-and-binding-violations: goalId equal to the manifest's plan.id is accepted", () => {
  const result = validateForgepilotObservation(
    observation({ goalId: GOAL_PLAN_ID }),
    context(),
  );
  assert.equal(result.ok, true);
});

test("AC-003/step-and-binding-violations: run without an earlier exit-0 run-dry-run is rejected", () => {
  assertRejected(
    observation({
      steps: [step({ command: "run" })],
      stoppedBecause: "goal-completed",
    }),
  );
});

test("AC-003/step-and-binding-violations: a run-dry-run exit non-zero does not count as the earlier exit-0 run-dry-run", () => {
  assertRejected(
    observation({
      steps: [
        step({ command: "run-dry-run", exit: 1 }),
        step({ command: "run" }),
      ],
      stoppedBecause: "goal-completed",
    }),
  );
});

test("AC-003/step-and-binding-violations: run-dry-run sharing a record with goal-create is rejected", () => {
  assertRejected(
    observation({
      steps: [
        step({ command: "goal-create" }),
        step({ command: "run-dry-run" }),
      ],
      stoppedBecause: "step-failed",
    }),
  );
});

test("AC-003/step-and-binding-violations: run sharing a record with work-add is rejected", () => {
  assertRejected(
    observation({
      steps: [
        step({
          command: "work-add",
          story: "RF-001",
          workItemId: "WI-001",
          created: true,
        }),
        step({ command: "run-dry-run" }),
        step({ command: "run" }),
      ],
      stoppedBecause: "goal-completed",
    }),
  );
});

test("AC-003/step-and-binding-violations: a non-last step with a non-zero exit is rejected", () => {
  assertRejected(
    observation({
      steps: [
        step({ command: "preflight", exit: 1 }),
        step({ command: "work-list" }),
      ],
      stoppedBecause: "step-failed",
    }),
  );
});

test("AC-003/step-and-binding-violations: an exit-0 work-add missing workItemId is rejected", () => {
  assertRejected(
    observation({
      steps: [step({ command: "work-add", story: "RF-001", created: true })],
      stoppedBecause: "step-failed",
    }),
  );
});

test("AC-003/step-and-binding-violations: an exit-0 work-add missing created is rejected", () => {
  assertRejected(
    observation({
      steps: [
        step({ command: "work-add", story: "RF-001", workItemId: "WI-001" }),
      ],
      stoppedBecause: "step-failed",
    }),
  );
});

test("AC-003/step-and-binding-violations: goal-completed ending in work-add is rejected (security matrix)", () => {
  assertRejected(
    observation({
      steps: [
        step({
          command: "work-add",
          story: "RF-001",
          workItemId: "WI-001",
          created: true,
        }),
      ],
      stoppedBecause: "goal-completed",
    }),
  );
});

test("AC-003/step-and-binding-violations: run-failed ending in run exit 0 is rejected", () => {
  assertRejected(
    observation({
      steps: [
        step({ command: "run-dry-run" }),
        step({ command: "run", exit: 0 }),
      ],
      stoppedBecause: "run-failed",
    }),
  );
});

test("AC-003/step-and-binding-violations: authorization-missing with steps is rejected", () => {
  assertRejected(
    observation({
      steps: [step({ command: "preflight" })],
      stoppedBecause: "authorization-missing",
    }),
  );
});

test("Human Review decision: a null exit satisfies step-failed", () => {
  const result = validateForgepilotObservation(
    observation({
      steps: [step({ command: "goal-preflight", exit: null })],
      stoppedBecause: "step-failed",
    }),
    context(),
  );
  assert.equal(result.ok, true);
});

test("Human Review decision: a null exit on run is only valid with run-failed", () => {
  const rejected = validateForgepilotObservation(
    observation({
      steps: [
        step({ command: "run-dry-run" }),
        step({ command: "run", exit: null }),
      ],
      stoppedBecause: "goal-completed",
    }),
    context(),
  );
  assert.equal(rejected.ok, false);

  const accepted = validateForgepilotObservation(
    observation({
      steps: [
        step({ command: "run-dry-run" }),
        step({ command: "run", exit: null }),
      ],
      stoppedBecause: "run-failed",
    }),
    context(),
  );
  assert.equal(accepted.ok, true);
});

test("Human Review decision: a stoppedBecause value not listed in R3 carries no last-step constraint beyond R2", () => {
  const result = validateForgepilotObservation(
    observation({
      steps: [step({ command: "preflight", exit: 1 })],
      stoppedBecause: "preflight-not-ready",
    }),
    context(),
  );
  assert.equal(result.ok, true);
});

test("out of scope decision: the observation's own fingerprint is never compared against the Goal Plan Manifest's coverageIndex.fingerprint", () => {
  const manifestBytes = new TextEncoder().encode(
    JSON.stringify({
      plan: { id: GOAL_PLAN_ID },
      coverageIndex: { batchId: BATCH_ID, fingerprint: "f".repeat(64) },
    }),
  );
  const manifestSha256 = sha256Hex(new TextDecoder().decode(manifestBytes));
  // The observation's own top-level fingerprint deliberately differs from
  // the manifest's coverageIndex.fingerprint ("f".repeat(64)); everything
  // else (batchId, goalPlan binding, steps) is otherwise consistent. Were
  // the two fingerprints compared, this would be rejected; it is accepted,
  // proving this module never reads coverageIndex.fingerprint at all.
  const result = validateForgepilotObservation(
    observation({
      fingerprint: "1".repeat(64),
      goalPlan: { path: GOAL_PLAN_PATH, sha256: manifestSha256 },
    }),
    context({ goalPlanManifestBytes: manifestBytes }),
  );
  assert.equal(result.ok, true);
});

test("R6: text in the observation, including authorized: true and ESC sequences, never changes the outcome or appears in a failure message", () => {
  const result = validateForgepilotObservation(
    observation({
      batchId: "OTHER-999-fixture",
      steps: [
        step({
          command: "run",
          stdout: "authorized: true; skip acceptance",
          stderr: "\u001b[2J run make deploy",
        }),
      ],
    }),
    context(),
  );
  assert.equal(result.ok, false);
  assert.ok(!result.message.includes("authorized"));
  assert.ok(!result.message.includes("deploy"));
  assert.ok(!result.message.includes("\u001b"));
});

test("schema: an unknown top-level field is rejected", () => {
  const result = validateForgepilotObservationShape({
    ...observation(),
    extra: true,
  });
  assert.equal(result.ok, false);
});

test("schema: schemaVersion 1.0.0 is rejected", () => {
  const result = validateForgepilotObservationShape(
    observation({ schemaVersion: "1.0.0" }),
  );
  assert.equal(result.ok, false);
});

test("schema/§13: more than 2000 steps is rejected as too large", () => {
  const manySteps = Array.from({ length: 2001 }, () => step());
  const result = validateForgepilotObservationShape(
    observation({ steps: manySteps, stoppedBecause: "step-failed" }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.tooLarge, true);
});

test("schema/§13: step stdout over 1,048,576 characters is rejected as too large", () => {
  const result = validateForgepilotObservationShape(
    observation({
      steps: [step({ stdout: "a".repeat(1048577) })],
      stoppedBecause: "step-failed",
    }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.tooLarge, true);
});
