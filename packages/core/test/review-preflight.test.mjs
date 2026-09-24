import assert from "node:assert/strict";
import test from "node:test";

import { evaluatePreflight } from "@praxisbound/core";

const FP_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const FP_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function baseInput(overrides = {}) {
  return {
    fingerprint: FP_A,
    batchDiagnostics: [],
    dependencies: [],
    confirmation: { kind: "applies", deferredRevisionIds: [] },
    unresolved: { blocking: [], nonBlocking: [] },
    recordFindings: [],
    storyFindings: [],
    expectFingerprint: undefined,
    gitFindings: [],
    semanticGateFindings: [],
    semanticFindings: [],
    readinessFindings: [],
    ...overrides,
  };
}

test("AC-001: a fully clean batch with a present Semantic Report yields REVIEW_READY and no diagnostics", () => {
  const result = evaluatePreflight(baseInput());
  assert.equal(result.outcome, "REVIEW_READY");
  assert.deepEqual(result.mechanical, []);
  assert.deepEqual(result.semantic, []);
});

test("AC-002: each in-scope blocking batch diagnostic yields REVIEW_BLOCKED and keeps its issue code", () => {
  const blockingCodes = [
    "REVIEW_SOURCE_MISSING",
    "REVIEW_STORY_UNKNOWN",
    "REVIEW_REQUIREMENT_UNMAPPED",
    "REVIEW_ACCEPTANCE_MISSING",
    "REVIEW_ANCHOR_UNKNOWN",
    "REVIEW_ANCHOR_DUPLICATE",
    "REVIEW_MANIFEST_INVALID",
  ];
  for (const code of blockingCodes) {
    const result = evaluatePreflight(
      baseInput({
        batchDiagnostics: [
          { code, severity: "advisory", message: "a batch-level problem" },
        ],
      }),
    );
    assert.equal(result.outcome, "REVIEW_BLOCKED", code);
    assert.deepEqual(
      result.mechanical.map((diagnostic) => diagnostic.code),
      [code],
    );
  }
});

test("AC-002: a dependency cycle yields REVIEW_DEPENDENCY_CYCLE and REVIEW_BLOCKED, never REVIEW_READY", () => {
  const result = evaluatePreflight(
    baseInput({
      dependencies: [
        { story: "RF-001", dependsOn: ["RF-002"] },
        { story: "RF-002", dependsOn: ["RF-001"] },
      ],
    }),
  );
  assert.equal(result.outcome, "REVIEW_BLOCKED");
  assert.equal(result.mechanical.length, 1);
  assert.equal(result.mechanical[0].code, "REVIEW_DEPENDENCY_CYCLE");
  assert.equal(result.mechanical[0].severity, "blocking");
  assert.match(result.mechanical[0].message, /RF-001 -> RF-002/);
});

test("AC-002: an unresolved blocking request yields REVIEW_UNRESOLVED_BLOCKING and REVIEW_BLOCKED", () => {
  const result = evaluatePreflight(
    baseInput({ unresolved: { blocking: ["REV-1"], nonBlocking: [] } }),
  );
  assert.equal(result.outcome, "REVIEW_BLOCKED");
  assert.deepEqual(
    result.mechanical.map((diagnostic) => diagnostic.code),
    ["REVIEW_UNRESOLVED_BLOCKING"],
  );
});

test("AC-002: a STORY_* story-check issue yields REVIEW_BLOCKED and keeps its path", () => {
  const result = evaluatePreflight(
    baseInput({
      storyFindings: [
        {
          code: "STORY_ACCEPTANCE_INCOMPLETE",
          message: "acceptance not fully checked",
          path: "specs/stories/RF-001",
        },
      ],
    }),
  );
  assert.equal(result.outcome, "REVIEW_BLOCKED");
  assert.equal(result.mechanical[0].code, "STORY_ACCEPTANCE_INCOMPLETE");
  assert.equal(result.mechanical[0].severity, "blocking");
  assert.equal(result.mechanical[0].path, "specs/stories/RF-001");
});

test("AC-003: a stale confirmation yields REVIEW_CONFIRMATION_STALE followed by its §8 differences, outcome STALE", () => {
  const result = evaluatePreflight(
    baseInput({
      confirmation: {
        kind: "stale",
        differences: [
          {
            code: "REVIEW_SOURCE_CHANGED",
            severity: "advisory",
            message: "source changed",
            path: "specs/stories/RF-001/story.md",
          },
        ],
      },
    }),
  );
  assert.equal(result.outcome, "REVIEW_STALE");
  assert.deepEqual(
    result.mechanical.map((diagnostic) => diagnostic.code),
    ["REVIEW_CONFIRMATION_STALE", "REVIEW_SOURCE_CHANGED"],
  );
  assert.equal(result.mechanical[1].severity, "advisory");
});

test("AC-003: a missing confirmation yields REVIEW_CONFIRMATION_MISSING and REVIEW_INCOMPLETE", () => {
  const result = evaluatePreflight(
    baseInput({ confirmation: { kind: "missing" } }),
  );
  assert.equal(result.outcome, "REVIEW_INCOMPLETE");
  assert.deepEqual(
    result.mechanical.map((diagnostic) => diagnostic.code),
    ["REVIEW_CONFIRMATION_MISSING"],
  );
});

test("AC-003: an unaddressed non-blocking request yields REVIEW_REVISION_UNADDRESSED and REVIEW_INCOMPLETE", () => {
  const result = evaluatePreflight(
    baseInput({ unresolved: { blocking: [], nonBlocking: ["REV-2"] } }),
  );
  assert.equal(result.outcome, "REVIEW_INCOMPLETE");
  assert.deepEqual(
    result.mechanical.map((diagnostic) => diagnostic.code),
    ["REVIEW_REVISION_UNADDRESSED"],
  );
});

test("AC-003: a non-blocking request deferred in an applying confirmation is not REVIEW_REVISION_UNADDRESSED", () => {
  const result = evaluatePreflight(
    baseInput({
      confirmation: { kind: "applies", deferredRevisionIds: ["REV-2"] },
      unresolved: { blocking: [], nonBlocking: ["REV-2"] },
    }),
  );
  assert.equal(result.outcome, "REVIEW_READY");
  assert.deepEqual(result.mechanical, []);
});

test("AC-003: a stale confirmation and an unresolved blocking request both list, precedence picks STALE over BLOCKED", () => {
  const result = evaluatePreflight(
    baseInput({
      confirmation: { kind: "stale", differences: [] },
      unresolved: { blocking: ["REV-1"], nonBlocking: [] },
    }),
  );
  assert.equal(result.outcome, "REVIEW_STALE");
  assert.deepEqual(
    result.mechanical.map((diagnostic) => diagnostic.code).sort(),
    ["REVIEW_CONFIRMATION_STALE", "REVIEW_UNRESOLVED_BLOCKING"].sort(),
  );
});

test("AC-003: REVIEW_PACKET_FINGERPRINT_MISMATCH is reported when expectFingerprint differs, outcome STALE", () => {
  const result = evaluatePreflight(baseInput({ expectFingerprint: FP_B }));
  assert.equal(result.outcome, "REVIEW_STALE");
  assert.deepEqual(
    result.mechanical.map((diagnostic) => diagnostic.code),
    ["REVIEW_PACKET_FINGERPRINT_MISMATCH"],
  );
});

test("AC-003: a matching expectFingerprint produces no diagnostic", () => {
  const result = evaluatePreflight(baseInput({ expectFingerprint: FP_A }));
  assert.equal(result.outcome, "REVIEW_READY");
  assert.deepEqual(result.mechanical, []);
});

test("AC-003/H1: a missing Semantic Report yields REVIEW_SEMANTIC_MISSING in mechanical[] (a gate diagnostic, shown in Mechanical checks) and REVIEW_INCOMPLETE", () => {
  const result = evaluatePreflight(
    baseInput({
      semanticGateFindings: [
        {
          code: "REVIEW_SEMANTIC_MISSING",
          message: "no Semantic Report was provided",
        },
      ],
    }),
  );
  assert.equal(result.outcome, "REVIEW_INCOMPLETE");
  assert.deepEqual(result.semantic, []);
  assert.deepEqual(
    result.mechanical.map((diagnostic) => diagnostic.code),
    ["REVIEW_SEMANTIC_MISSING"],
  );
});

test("review round 2 M3: REVIEW_INPUT_TOO_LARGE from recordFindings is REVIEW_INCOMPLETE, same class as the Semantic Report row", () => {
  const result = evaluatePreflight(
    baseInput({
      recordFindings: [
        {
          code: "REVIEW_INPUT_TOO_LARGE",
          message: "records/ has too many confirmation- files",
        },
      ],
    }),
  );
  assert.equal(result.outcome, "REVIEW_INCOMPLETE");
  assert.deepEqual(
    result.mechanical.map((diagnostic) => diagnostic.code),
    ["REVIEW_INPUT_TOO_LARGE"],
  );
  assert.equal(result.mechanical[0].severity, "blocking");
});

test("AC-004: REVIEW_NOT_A_GIT_REPOSITORY and REVIEW_SOURCES_UNCOMMITTED from gitFindings yield REVIEW_BLOCKED", () => {
  const result = evaluatePreflight(
    baseInput({
      gitFindings: [
        {
          code: "REVIEW_NOT_A_GIT_REPOSITORY",
          message: "not a git repository",
        },
        {
          code: "REVIEW_SOURCES_UNCOMMITTED",
          message: "uncommitted change",
          path: "specs/stories/RF-001/story.md",
        },
      ],
    }),
  );
  assert.equal(result.outcome, "REVIEW_BLOCKED");
  assert.deepEqual(
    result.mechanical.map((diagnostic) => diagnostic.code),
    ["REVIEW_NOT_A_GIT_REPOSITORY", "REVIEW_SOURCES_UNCOMMITTED"],
  );
});

test("AC-004: REVIEW_PACKET_REVISION_MISMATCH from gitFindings yields REVIEW_STALE", () => {
  const result = evaluatePreflight(
    baseInput({
      gitFindings: [
        {
          code: "REVIEW_PACKET_REVISION_MISMATCH",
          message: "HEAD does not match --expect-revision",
        },
      ],
    }),
  );
  assert.equal(result.outcome, "REVIEW_STALE");
});

test("AC-005: severity is derived from the code, never taken from a caller-supplied value", () => {
  const result = evaluatePreflight(
    baseInput({
      batchDiagnostics: [
        {
          code: "REVIEW_SECTION_UNRECOGNIZED",
          severity: "blocking",
          message: "unrecognized section",
        },
      ],
      recordFindings: [
        {
          code: "REVIEW_RECORD_INVALID",
          message: "malformed record",
          path: "records/preflight-000000000000-1.json",
        },
      ],
    }),
  );
  assert.equal(result.outcome, "REVIEW_READY");
  const bySeverity = Object.fromEntries(
    result.mechanical.map((diagnostic) => [
      diagnostic.code,
      diagnostic.severity,
    ]),
  );
  assert.equal(bySeverity.REVIEW_SECTION_UNRECOGNIZED, "advisory");
  assert.equal(bySeverity.REVIEW_RECORD_INVALID, "advisory");
});

test("AC-005: an advisory diagnostic never changes the outcome even alongside REVIEW_READY conditions", () => {
  const result = evaluatePreflight(
    baseInput({
      batchDiagnostics: [
        {
          code: "REVIEW_DEPENDENCY_UNDECLARED",
          severity: "advisory",
          message: "undeclared dependency",
        },
      ],
    }),
  );
  assert.equal(result.outcome, "REVIEW_READY");
});

test("an unrecognized REVIEW_* code is a programming error and throws", () => {
  assert.throws(() => {
    evaluatePreflight(
      baseInput({
        batchDiagnostics: [
          {
            code: "REVIEW_DOES_NOT_EXIST",
            severity: "advisory",
            message: "unknown code",
          },
        ],
      }),
    );
  }, /REVIEW_DOES_NOT_EXIST/);
});

test("mechanical is ordered by result class (STALE, BLOCKED, INCOMPLETE, ADVISORY) then by check order within a class", () => {
  const result = evaluatePreflight(
    baseInput({
      batchDiagnostics: [
        {
          code: "REVIEW_DEPENDENCY_UNDECLARED",
          severity: "advisory",
          message: "undeclared dependency",
        },
        {
          code: "REVIEW_SOURCE_MISSING",
          severity: "blocking",
          message: "source missing",
        },
      ],
      confirmation: { kind: "missing" },
      expectFingerprint: FP_B,
    }),
  );
  assert.deepEqual(
    result.mechanical.map((diagnostic) => diagnostic.code),
    [
      "REVIEW_PACKET_FINGERPRINT_MISMATCH",
      "REVIEW_SOURCE_MISSING",
      "REVIEW_CONFIRMATION_MISSING",
      "REVIEW_DEPENDENCY_UNDECLARED",
    ],
  );
  assert.equal(result.outcome, "REVIEW_STALE");
});

test("a message embedding untrusted text (a revision id) escapes a hidden character", () => {
  const result = evaluatePreflight(
    baseInput({
      unresolved: { blocking: ["REV-\u001b[2J"], nonBlocking: [] },
    }),
  );
  assert.equal(result.mechanical.length, 1);
  assert.ok(result.mechanical[0].message.includes("\\x1b"));
  assert.ok(!result.mechanical[0].message.includes("\u001b"));
});

test("a message over 4096 characters is shortened deterministically to exactly 4096 characters", () => {
  const longMessage = "x".repeat(5000);
  const result = evaluatePreflight(
    baseInput({
      recordFindings: [{ code: "REVIEW_RECORD_INVALID", message: longMessage }],
    }),
  );
  assert.equal(result.mechanical[0].message.length, 4096);
  assert.ok(result.mechanical[0].message.endsWith("..."));
});

test("H1: semanticGateFindings land in mechanical[] and semanticFindings land in semantic[], in the same run", () => {
  const result = evaluatePreflight(
    baseInput({
      semanticGateFindings: [
        { code: "REVIEW_SEMANTIC_STALE", message: "fingerprint mismatch" },
      ],
      semanticFindings: [
        {
          code: "REVIEW_SEMANTIC_OBSERVATION",
          message: "an observation",
        },
      ],
    }),
  );
  assert.deepEqual(
    result.mechanical.map((diagnostic) => diagnostic.code),
    ["REVIEW_SEMANTIC_STALE"],
  );
  assert.deepEqual(
    result.semantic.map((diagnostic) => diagnostic.code),
    ["REVIEW_SEMANTIC_OBSERVATION"],
  );
  assert.equal(result.outcome, "REVIEW_STALE");
});
