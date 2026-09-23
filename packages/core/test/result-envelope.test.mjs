import assert from "node:assert/strict";
import test from "node:test";

import { validateResultEnvelope } from "@praxisbound/core";

const base = {
  schemaVersion: "1.0.0",
  protocolVersion: "0.10.0",
  subject: "repository",
  issues: [],
};

const canonicalResults = [
  { status: "pass", outcome: "success", exit: 0 },
  { status: "fail", outcome: "failure", exit: 1 },
  { status: "warning", outcome: "warning", exit: 0 },
  { status: "error", outcome: "usage-error", exit: 2 },
  { status: "error", outcome: "configuration-error", exit: 2 },
  { status: "error", outcome: "internal-error", exit: 2 },
  { status: "pass", outcome: "RELEASE_READY", exit: 0 },
  { status: "fail", outcome: "RELEASE_INCOMPLETE", exit: 1 },
  { status: "pass", outcome: "ACTIVATION_PREVIEW", exit: 0 },
  { status: "pass", outcome: "ACTIVATION_APPLIED", exit: 0 },
  { status: "pass", outcome: "ACTIVATION_UNCHANGED", exit: 0 },
  { status: "fail", outcome: "ACTIVATION_CONFLICT", exit: 1 },
  { status: "fail", outcome: "ACTIVATION_OPERATION_REFUSED", exit: 1 },
  {
    status: "fail",
    outcome: "ACTIVATION_APPLY_FAILED_RECOVERED",
    exit: 1,
  },
  { status: "fail", outcome: "ACTIVATION_RECOVERY_INCOMPLETE", exit: 1 },
  { status: "fail", outcome: "ACTIVATION_CLEANUP_INCOMPLETE", exit: 1 },
  { status: "pass", outcome: "REVIEW_READY", exit: 0 },
  { status: "fail", outcome: "REVIEW_BLOCKED", exit: 1 },
  { status: "fail", outcome: "REVIEW_INCOMPLETE", exit: 1 },
  { status: "fail", outcome: "REVIEW_STALE", exit: 1 },
  { status: "error", outcome: "ERROR", exit: 2 },
  { status: "error", outcome: "ERROR", exit: 3 },
];

test("AC-001: canonical result outcomes satisfy the public envelope contract", () => {
  for (const mapping of canonicalResults) {
    const envelope = { ...base, ...mapping };

    assert.deepEqual(validateResultEnvelope(envelope), {
      ok: true,
      value: envelope,
    });
  }
});

test("TST011-AC-001/004: release envelopes retain only structured public data", () => {
  const envelope = {
    ...base,
    status: "pass",
    outcome: "RELEASE_READY",
    exit: 0,
    subject: "release",
    data: {
      remoteChecks: "not-performed",
      version: "0.2.1",
      expectedTag: "v0.2.1",
      localTag: "absent",
    },
  };

  assert.deepEqual(validateResultEnvelope(envelope), {
    ok: true,
    value: envelope,
  });
  assert.deepEqual(
    validateResultEnvelope({
      ...envelope,
      data: undefined,
    }),
    { ok: false, issues: [{ code: "INVALID_RESULT_DATA", field: "data" }] },
  );
});

test("TST011-AC-004: typed release errors are additive machine fields", () => {
  const envelope = {
    ...base,
    status: "error",
    outcome: "ERROR",
    exit: 2,
    subject: "release",
    error: { code: "RELEASE_USAGE", message: "Invalid arguments" },
  };

  assert.deepEqual(validateResultEnvelope(envelope), {
    ok: true,
    value: envelope,
  });
  assert.deepEqual(
    validateResultEnvelope({
      ...envelope,
      error: { code: "bad", message: "x" },
    }),
    {
      ok: false,
      issues: [{ code: "INVALID_ERROR_CODE", field: "error.code" }],
    },
  );
});

test("AC-001: canonical paths, subjects, and issues validate", () => {
  const envelope = {
    ...base,
    status: "fail",
    outcome: "failure",
    exit: 1,
    subject: "story:TST-002",
    path: "specs/stories/TST-002/story.md",
    issues: [
      {
        code: "MISSING_FIELD",
        message: "The Goal section is missing.",
        subject: "story:TST-002",
        path: "specs/stories/TST-002/story.md",
      },
    ],
  };

  assert.deepEqual(validateResultEnvelope(envelope), {
    ok: true,
    value: envelope,
  });
});

const validEnvelope = {
  ...base,
  status: "pass",
  outcome: "success",
  exit: 0,
};

const issueWithInheritedMessage = Object.assign(
  Object.create({ message: "Inherited message." }),
  { code: "MISSING_FIELD" },
);

function withoutField(value, field) {
  const copy = { ...value };
  delete copy[field];
  return copy;
}

const invalidEnvelopes = [
  ["non-object", null, "RESULT_NOT_OBJECT", "$"],
  [
    "missing field",
    withoutField(validEnvelope, "schemaVersion"),
    "MISSING_FIELD",
    "schemaVersion",
  ],
  [
    "unknown field",
    { ...validEnvelope, extra: true },
    "UNKNOWN_FIELD",
    "extra",
  ],
  [
    "invalid schema SemVer",
    { ...validEnvelope, schemaVersion: "01.0.0" },
    "INVALID_SEMVER",
    "schemaVersion",
  ],
  [
    "unsupported schema version",
    { ...validEnvelope, schemaVersion: "1.1.0" },
    "UNSUPPORTED_SCHEMA_VERSION",
    "schemaVersion",
  ],
  [
    "invalid Protocol SemVer",
    { ...validEnvelope, protocolVersion: "0.09.0" },
    "INVALID_SEMVER",
    "protocolVersion",
  ],
  [
    "unsupported Protocol version",
    { ...validEnvelope, protocolVersion: "0.9.1" },
    "UNSUPPORTED_PROTOCOL_VERSION",
    "protocolVersion",
  ],
  [
    "invalid status",
    { ...validEnvelope, status: "ok" },
    "INVALID_STATUS",
    "status",
  ],
  [
    "invalid outcome",
    { ...validEnvelope, outcome: "done" },
    "INVALID_OUTCOME",
    "outcome",
  ],
  ["invalid exit", { ...validEnvelope, exit: 4 }, "INVALID_EXIT", "exit"],
  [
    "inconsistent result combination",
    { ...validEnvelope, status: "fail", outcome: "failure", exit: 0 },
    "INVALID_RESULT_COMBINATION",
    "$",
  ],
  [
    "REVIEW_READY with fail status and exit 1",
    { ...validEnvelope, status: "fail", outcome: "REVIEW_READY", exit: 1 },
    "INVALID_RESULT_COMBINATION",
    "$",
  ],
  [
    "REVIEW_STALE with pass status and exit 0",
    { ...validEnvelope, status: "pass", outcome: "REVIEW_STALE", exit: 0 },
    "INVALID_RESULT_COMBINATION",
    "$",
  ],
  [
    "invalid subject",
    { ...validEnvelope, subject: "Story TST-002" },
    "INVALID_SUBJECT",
    "subject",
  ],
  ["empty path", { ...validEnvelope, path: "" }, "INVALID_PATH", "path"],
  [
    "undefined own path",
    { ...validEnvelope, path: undefined },
    "INVALID_PATH",
    "path",
  ],
  [
    "absolute path",
    { ...validEnvelope, path: "/story.md" },
    "INVALID_PATH",
    "path",
  ],
  [
    "parent path",
    { ...validEnvelope, path: "specs/../story.md" },
    "INVALID_PATH",
    "path",
  ],
  [
    "backslash path",
    { ...validEnvelope, path: "specs\\story.md" },
    "INVALID_PATH",
    "path",
  ],
  [
    "C1 control character in path",
    { ...validEnvelope, path: "specs/\u009fstory.md" },
    "INVALID_PATH",
    "path",
  ],
  [
    "invalid issues collection",
    { ...validEnvelope, issues: {} },
    "INVALID_ISSUES",
    "issues",
  ],
  [
    "invalid issue object",
    { ...validEnvelope, issues: ["problem"] },
    "INVALID_ISSUE",
    "issues[0]",
  ],
  [
    "invalid issue code",
    {
      ...validEnvelope,
      issues: [{ code: "missing-field", message: "Missing." }],
    },
    "INVALID_ISSUE_CODE",
    "issues[0].code",
  ],
  [
    "invalid issue message",
    {
      ...validEnvelope,
      issues: [{ code: "MISSING_FIELD", message: "line one\nline two" }],
    },
    "INVALID_ISSUE_MESSAGE",
    "issues[0].message",
  ],
  [
    "inherited issue message",
    { ...validEnvelope, issues: [issueWithInheritedMessage] },
    "INVALID_ISSUE_MESSAGE",
    "issues[0].message",
  ],
  [
    "invalid issue subject",
    {
      ...validEnvelope,
      issues: [
        { code: "MISSING_FIELD", message: "Missing.", subject: "Story 1" },
      ],
    },
    "INVALID_SUBJECT",
    "issues[0].subject",
  ],
  [
    "invalid issue path",
    {
      ...validEnvelope,
      issues: [
        { code: "MISSING_FIELD", message: "Missing.", path: "../story.md" },
      ],
    },
    "INVALID_PATH",
    "issues[0].path",
  ],
  [
    "unknown issue field",
    {
      ...validEnvelope,
      issues: [{ code: "MISSING_FIELD", message: "Missing.", extra: true }],
    },
    "UNKNOWN_FIELD",
    "issues[0].extra",
  ],
];

for (const [name, envelope, code, field] of invalidEnvelopes) {
  test(`AC-002: rejects ${name}`, () => {
    assert.deepEqual(validateResultEnvelope(envelope), {
      ok: false,
      issues: [{ code, field }],
    });
  });
}
