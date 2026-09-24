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

// M1 (code review round 1): every R2 (step-order) test below deliberately
// uses `stoppedBecause: "preflight-not-ready"` (or another R3 value with no
// last-step constraint), never a value like "goal-completed" or
// "step-failed" whose own R3 constraint the chosen steps might
// independently satisfy or violate. A mutation test confirmed the previous
// versions (using "step-failed"/"goal-completed") still reported `ok:
// false` even with the R2 check deleted, because R3 alone already rejected
// them — these versions do not have that flaw: deleting the relevant R2
// check would flip each of these to `ok: true`. Each also asserts the
// specific rejection message, not just `ok === false`.

test("AC-003/step-and-binding-violations: run without an earlier exit-0 run-dry-run is rejected", () => {
  const result = assertRejected(
    observation({
      steps: [step({ command: "run" })],
      stoppedBecause: "preflight-not-ready",
    }),
  );
  assert.match(result.message, /run without an earlier exit-0 run-dry-run/);
});

test("AC-003/step-and-binding-violations: a run-dry-run exit non-zero does not count as the earlier exit-0 run-dry-run", () => {
  // A non-zero-exit run-dry-run as a non-last step is caught first by the
  // "every step but the last exits 0" rule (it never reaches "run" to prove
  // the dry-run didn't count) — still a genuine, mutation-sensitive R2
  // rejection, just via that message rather than the "run without an
  // earlier exit-0 run-dry-run" one.
  const result = assertRejected(
    observation({
      steps: [
        step({ command: "run-dry-run", exit: 1 }),
        step({ command: "run" }),
      ],
      stoppedBecause: "preflight-not-ready",
    }),
  );
  assert.match(result.message, /a non-last step did not exit 0/);
});

test("AC-003/step-and-binding-violations: run-dry-run sharing a record with goal-create is rejected", () => {
  const result = assertRejected(
    observation({
      steps: [
        step({ command: "goal-create" }),
        step({ command: "run-dry-run" }),
      ],
      stoppedBecause: "preflight-not-ready",
    }),
  );
  assert.match(
    result.message,
    /run-dry-run or run cannot share a record with goal-create or work-add/,
  );
});

test("AC-003/step-and-binding-violations: run sharing a record with work-add is rejected", () => {
  const result = assertRejected(
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
      stoppedBecause: "preflight-not-ready",
    }),
  );
  assert.match(
    result.message,
    /run-dry-run or run cannot share a record with goal-create or work-add/,
  );
});

test("AC-003/step-and-binding-violations: a non-last step with a non-zero exit is rejected", () => {
  const result = assertRejected(
    observation({
      steps: [
        step({ command: "preflight", exit: 1 }),
        step({ command: "work-list" }),
      ],
      stoppedBecause: "preflight-not-ready",
    }),
  );
  assert.match(result.message, /a non-last step did not exit 0/);
});

test("AC-003/step-and-binding-violations: an exit-0 work-add missing workItemId is rejected", () => {
  const result = assertRejected(
    observation({
      steps: [step({ command: "work-add", story: "RF-001", created: true })],
      stoppedBecause: "preflight-not-ready",
    }),
  );
  assert.match(
    result.message,
    /an exit-0 work-add step is missing workItemId or created/,
  );
});

test("AC-003/step-and-binding-violations: an exit-0 work-add missing created is rejected", () => {
  const result = assertRejected(
    observation({
      steps: [
        step({ command: "work-add", story: "RF-001", workItemId: "WI-001" }),
      ],
      stoppedBecause: "preflight-not-ready",
    }),
  );
  assert.match(
    result.message,
    /an exit-0 work-add step is missing workItemId or created/,
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

// M1 (code review round 1): positive and negative cases for every R3 value
// not already covered above (goal-completed, run-failed, step-failed,
// authorization-missing already have both from the happy-path and
// AC-003 tests).

test("R3/awaiting-authorization: a last step that is not execution-plan is rejected", () => {
  const result = assertRejected(
    observation({
      steps: [step({ command: "goal-preflight" })],
      stoppedBecause: "awaiting-authorization",
    }),
  );
  assert.match(
    result.message,
    /awaiting-authorization must end with an exit-0 execution-plan/,
  );
});

test("R3/awaiting-authorization: a non-zero exit on the last execution-plan step is rejected", () => {
  const result = assertRejected(
    observation({
      steps: [step({ command: "execution-plan", exit: 1 })],
      stoppedBecause: "awaiting-authorization",
    }),
  );
  assert.match(
    result.message,
    /awaiting-authorization must end with an exit-0 execution-plan/,
  );
});

test("R3/run-needs-human: last step run exit 2 is accepted", () => {
  const result = validateForgepilotObservation(
    observation({
      steps: [
        step({ command: "run-dry-run" }),
        step({ command: "run", exit: 2 }),
      ],
      stoppedBecause: "run-needs-human",
    }),
    context(),
  );
  assert.equal(result.ok, true);
});

test("R3/run-needs-human: last step run exit other than 2 is rejected", () => {
  const result = assertRejected(
    observation({
      steps: [
        step({ command: "run-dry-run" }),
        step({ command: "run", exit: 1 }),
      ],
      stoppedBecause: "run-needs-human",
    }),
  );
  assert.match(result.message, /run-needs-human must end with run exit 2/);
});

test("R3/run-limit-reached: last step run exit 3 is accepted", () => {
  const result = validateForgepilotObservation(
    observation({
      steps: [
        step({ command: "run-dry-run" }),
        step({ command: "run", exit: 3 }),
      ],
      stoppedBecause: "run-limit-reached",
    }),
    context(),
  );
  assert.equal(result.ok, true);
});

test("R3/run-limit-reached: last step run exit other than 3 is rejected", () => {
  const result = assertRejected(
    observation({
      steps: [
        step({ command: "run-dry-run" }),
        step({ command: "run", exit: 1 }),
      ],
      stoppedBecause: "run-limit-reached",
    }),
  );
  assert.match(result.message, /run-limit-reached must end with run exit 3/);
});

test("R3/run-interrupted: last step run exit 130 is accepted", () => {
  const result = validateForgepilotObservation(
    observation({
      steps: [
        step({ command: "run-dry-run" }),
        step({ command: "run", exit: 130 }),
      ],
      stoppedBecause: "run-interrupted",
    }),
    context(),
  );
  assert.equal(result.ok, true);
});

test("R3/run-interrupted: last step run exit 143 is accepted", () => {
  const result = validateForgepilotObservation(
    observation({
      steps: [
        step({ command: "run-dry-run" }),
        step({ command: "run", exit: 143 }),
      ],
      stoppedBecause: "run-interrupted",
    }),
    context(),
  );
  assert.equal(result.ok, true);
});

test("R3/run-interrupted: last step run exit other than 130 or 143 is rejected", () => {
  const result = assertRejected(
    observation({
      steps: [
        step({ command: "run-dry-run" }),
        step({ command: "run", exit: 137 }),
      ],
      stoppedBecause: "run-interrupted",
    }),
  );
  assert.match(
    result.message,
    /run-interrupted must end with run exit 130 or 143/,
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

test("schema: step story over the storyId 64-character bound is rejected (code review round 1 LOW)", () => {
  // Matches STORY_ID_PATTERN (^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-[0-9]+$) but is
  // 65 characters long: "A" + 62 "B"s + "-1".
  const tooLongStoryId = `A${"B".repeat(62)}-1`;
  assert.equal(tooLongStoryId.length, 65);
  const result = validateForgepilotObservationShape(
    observation({
      steps: [
        step({
          command: "work-add",
          story: tooLongStoryId,
          workItemId: "WI-001",
          created: true,
        }),
      ],
      stoppedBecause: "step-failed",
    }),
  );
  assert.equal(result.ok, false);
});

// H2 (Human Review 2026-09-24): contract §11 step 3's exception — a
// non-zero, non-null `work-list` exit is allowed as a non-last step only
// when the very next step is `goal-create`; every other non-last non-zero
// step is still rejected, and this is a coordinating-agent reading of "exit
// 非 0" for a `null` `work-list` exit specifically (treated as NOT covered
// by the exception — see verification.md).

test("H2/work-list-then-goal-create: a realistic first-segment record (preflight, work-list(1), goal-create(0), work-add(0)x2, execution-plan(0)) with awaiting-authorization is accepted", () => {
  const result = validateForgepilotObservation(
    observation({
      steps: [
        step({ command: "preflight", exit: 0 }),
        step({ command: "work-list", exit: 1 }),
        step({ command: "goal-create", exit: 0 }),
        step({
          command: "work-add",
          story: "RF-001",
          workItemId: "WI-001",
          created: true,
          exit: 0,
        }),
        step({
          command: "work-add",
          story: "RF-002",
          workItemId: "WI-002",
          created: true,
          exit: 0,
        }),
        step({ command: "execution-plan", exit: 0 }),
      ],
      stoppedBecause: "awaiting-authorization",
    }),
    context(),
  );
  assert.equal(result.ok, true, JSON.stringify(result));
});

test("H2/work-list-then-goal-create: [preflight, work-list(1), goal-create(1)] with step-failed is accepted (goal-create's own exit decides, no stderr parsed)", () => {
  const result = validateForgepilotObservation(
    observation({
      steps: [
        step({ command: "preflight", exit: 0 }),
        step({ command: "work-list", exit: 1 }),
        step({ command: "goal-create", exit: 1 }),
      ],
      stoppedBecause: "step-failed",
    }),
    context(),
  );
  assert.equal(result.ok, true, JSON.stringify(result));
});

test("H2/work-list-then-goal-create: work-list(1) followed by work-add (not goal-create) is rejected", () => {
  const result = assertRejected(
    observation({
      steps: [
        step({ command: "work-list", exit: 1 }),
        step({
          command: "work-add",
          story: "RF-001",
          workItemId: "WI-001",
          created: true,
        }),
      ],
      stoppedBecause: "preflight-not-ready",
    }),
  );
  assert.match(result.message, /a non-last step did not exit 0/);
});

test("H2/work-list-then-goal-create: work-list(1) as a non-last step followed by nothing but another preflight is rejected", () => {
  const result = assertRejected(
    observation({
      steps: [
        step({ command: "work-list", exit: 1 }),
        step({ command: "preflight", exit: 0 }),
      ],
      stoppedBecause: "preflight-not-ready",
    }),
  );
  assert.match(result.message, /a non-last step did not exit 0/);
});

test("H2/work-list-then-goal-create: goal-create(1) followed by another step is rejected (the exception never covers goal-create itself)", () => {
  const result = assertRejected(
    observation({
      steps: [
        step({ command: "goal-create", exit: 1 }),
        step({
          command: "work-add",
          story: "RF-001",
          workItemId: "WI-001",
          created: true,
        }),
      ],
      stoppedBecause: "preflight-not-ready",
    }),
  );
  assert.match(result.message, /a non-last step did not exit 0/);
});

test("H2/work-list-then-goal-create: work-list(null) followed by goal-create is rejected — a null exit is not covered by the exception", () => {
  const result = assertRejected(
    observation({
      steps: [
        step({ command: "work-list", exit: null }),
        step({ command: "goal-create", exit: 0 }),
      ],
      stoppedBecause: "preflight-not-ready",
    }),
  );
  assert.match(result.message, /a non-last step did not exit 0/);
});

// N3 (code review round 2, mutation-verified): the exception's command
// check (`step.command === "work-list"`) was untested — every accepted
// case above happens to use `work-list` as the qualifying step, so a
// mutation deleting that check (making ANY non-last non-zero-exit step
// followed by goal-create pass) failed 0 tests. These two use a different
// non-last command (still followed immediately by goal-create) and assert
// the specific rejection.

test("N3/exception-is-work-list-specific: preflight(1) immediately followed by goal-create is still rejected (only work-list qualifies)", () => {
  const result = assertRejected(
    observation({
      steps: [
        step({ command: "preflight", exit: 1 }),
        step({ command: "goal-create", exit: 0 }),
      ],
      stoppedBecause: "preflight-not-ready",
    }),
  );
  assert.match(result.message, /a non-last step did not exit 0/);
});

test("N3/exception-is-work-list-specific: goal-preflight(1) immediately followed by goal-create is still rejected (only work-list qualifies)", () => {
  const result = assertRejected(
    observation({
      steps: [
        step({ command: "goal-preflight", exit: 1 }),
        step({ command: "goal-create", exit: 0 }),
      ],
      stoppedBecause: "preflight-not-ready",
    }),
  );
  assert.match(result.message, /a non-last step did not exit 0/);
});

// N3 (mutation-verified): no existing test asserted a `step-failed` record
// is REJECTED when its last step exits 0 — deleting the `step-failed` R3
// branch entirely (always `undefined`, no rejection) failed 0 tests.
test("N3/step-failed-rejects-exit-0: step-failed whose last step exits 0 is rejected", () => {
  const result = assertRejected(
    observation({
      steps: [step({ command: "preflight", exit: 0 })],
      stoppedBecause: "step-failed",
    }),
  );
  assert.match(
    result.message,
    /step-failed must end with a non-zero or null exit/,
  );
});
