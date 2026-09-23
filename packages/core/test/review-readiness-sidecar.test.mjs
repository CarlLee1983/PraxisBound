import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { TextEncoder } from "node:util";
import test from "node:test";

import {
  buildReadinessOutputOwners,
  checkReadinessSidecarConsistency,
  checkReadinessSidecarReferences,
  parseReadinessSidecar,
  transitiveDependencyClosureDirectories,
} from "@praxisbound/core";

function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

const STORY_DIRECTORY = "specs/stories/RF-001-fixture";

const storyText =
  "# Story: RF-001 Fixture\n\n" +
  "## Classification\n\n" +
  "* Security sensitive: no\n" +
  "* Baseline conformance: no\n" +
  "* Task mode: execution\n\n" +
  "## Authority\n\n" +
  "* plan: yes\n" +
  "* modify: yes\n" +
  "* add_dependency: no\n" +
  "* migration: no\n" +
  "* commit: no\n" +
  "* push: no\n" +
  "* deploy: no\n";

const acceptanceText =
  "# Acceptance Criteria\n\n## Happy Path\n\n* [ ] AC-001: done.\n";

const storyBytes = new TextEncoder().encode(storyText);
const acceptanceBytes = new TextEncoder().encode(acceptanceText);
const storyDigest = `sha256:${sha256Hex(storyText)}`;
const acceptanceDigest = `sha256:${sha256Hex(acceptanceText)}`;

function validSidecar(overrides = {}) {
  return {
    schema_version: 1,
    story_ref: STORY_DIRECTORY,
    story_md_digest: storyDigest,
    acceptance_md_digest: acceptanceDigest,
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
    ...overrides,
  };
}

function bytesOf(object) {
  return new TextEncoder().encode(JSON.stringify(object));
}

function baseContext(overrides = {}) {
  return {
    storyDirectory: STORY_DIRECTORY,
    storyMdBytes: storyBytes,
    acceptanceMdBytes: acceptanceBytes,
    acceptanceIds: ["AC-001"],
    grantedOperations: new Set(["plan", "modify"]),
    dependencyClosure: new Set(),
    ...overrides,
  };
}

test("AC-004: a valid Sidecar parses with no findings", () => {
  const parsed = parseReadinessSidecar(
    bytesOf(validSidecar()),
    STORY_DIRECTORY,
  );
  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.storyRef, STORY_DIRECTORY);
  const findings = checkReadinessSidecarConsistency(parsed.data, baseContext());
  assert.deepEqual(findings, []);
});

test("AC-004: a schema-invalid Sidecar (unknown field) yields ok:false, not too large", () => {
  const parsed = parseReadinessSidecar(
    bytesOf(validSidecar({ extra_field: true })),
    STORY_DIRECTORY,
  );
  assert.equal(parsed.ok, false);
  assert.equal(parsed.tooLarge, false);
});

test("AC-004: a schema-invalid Sidecar (bad owner enum) yields ok:false", () => {
  const parsed = parseReadinessSidecar(
    bytesOf(
      validSidecar({
        criteria: [
          {
            id: "AC-001",
            operations: ["plan"],
            owner: "not-a-real-owner",
            future_identities: [],
          },
        ],
      }),
    ),
    STORY_DIRECTORY,
  );
  assert.equal(parsed.ok, false);
  assert.equal(parsed.tooLarge, false);
});

test("AC-004: a wrong story_ref yields ok:false, not too large", () => {
  const parsed = parseReadinessSidecar(
    bytesOf(validSidecar({ story_ref: "specs/stories/OTHER-001-fixture" })),
    STORY_DIRECTORY,
  );
  assert.equal(parsed.ok, false);
  assert.equal(parsed.tooLarge, false);
  assert.match(parsed.message, /story_ref/);
});

test("AC-004: an over-limit Sidecar (over 1 MiB) yields ok:false, tooLarge:true", () => {
  const oversized = validSidecar({
    decision_follow_ups: Array.from({ length: 1 }).map(() => ({
      gate_id: "g",
      choice: "x".repeat(1024 * 1024 + 10),
      follow_up_story_ref: STORY_DIRECTORY,
    })),
  });
  const parsed = parseReadinessSidecar(bytesOf(oversized), STORY_DIRECTORY);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.tooLarge, true);
});

test("AC-003: a stale story_md_digest yields REVIEW_READINESS_STALE", () => {
  const parsed = parseReadinessSidecar(
    bytesOf(validSidecar({ story_md_digest: `sha256:${"0".repeat(64)}` })),
    STORY_DIRECTORY,
  );
  assert.equal(parsed.ok, true);
  const findings = checkReadinessSidecarConsistency(parsed.data, baseContext());
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, "REVIEW_READINESS_STALE");
});

test("AC-003: criteria ids differing from acceptance.md's AC ids yield REVIEW_READINESS_CRITERIA_MISMATCH", () => {
  const parsed = parseReadinessSidecar(
    bytesOf(
      validSidecar({
        criteria: [
          {
            id: "AC-002",
            operations: ["plan"],
            owner: "runner_worker",
            future_identities: [],
          },
        ],
      }),
    ),
    STORY_DIRECTORY,
  );
  assert.equal(parsed.ok, true);
  const findings = checkReadinessSidecarConsistency(parsed.data, baseContext());
  assert.ok(
    findings.some(
      (finding) => finding.code === "REVIEW_READINESS_CRITERIA_MISMATCH",
    ),
  );
});

test("AC-003: an operation outside Story Authority yields REVIEW_READINESS_OPERATION_UNGRANTED", () => {
  const parsed = parseReadinessSidecar(
    bytesOf(
      validSidecar({
        criteria: [
          {
            id: "AC-001",
            operations: ["deploy"],
            owner: "canonical_verification",
            future_identities: [],
          },
        ],
      }),
    ),
    STORY_DIRECTORY,
  );
  assert.equal(parsed.ok, true);
  const findings = checkReadinessSidecarConsistency(
    parsed.data,
    baseContext({ grantedOperations: new Set(["plan", "modify"]) }),
  );
  assert.ok(
    findings.some(
      (finding) => finding.code === "REVIEW_READINESS_OPERATION_UNGRANTED",
    ),
  );
});

test("AC-003: runner_worker may only carry plan and modify, even when the Story grants more", () => {
  const parsed = parseReadinessSidecar(
    bytesOf(
      validSidecar({
        criteria: [
          {
            id: "AC-001",
            operations: ["commit"],
            owner: "runner_worker",
            future_identities: [],
          },
        ],
      }),
    ),
    STORY_DIRECTORY,
  );
  assert.equal(parsed.ok, true);
  const findings = checkReadinessSidecarConsistency(
    parsed.data,
    baseContext({
      grantedOperations: new Set(["plan", "modify", "commit"]),
    }),
  );
  assert.ok(
    findings.some(
      (finding) => finding.code === "REVIEW_READINESS_OPERATION_UNGRANTED",
    ),
  );
});

test("AC-003: human and external owners are never compared with Authority", () => {
  const parsed = parseReadinessSidecar(
    bytesOf(
      validSidecar({
        criteria: [
          {
            id: "AC-001",
            operations: ["deploy", "push"],
            owner: "human",
            future_identities: [],
          },
        ],
      }),
    ),
    STORY_DIRECTORY,
  );
  assert.equal(parsed.ok, true);
  const findings = checkReadinessSidecarConsistency(
    parsed.data,
    baseContext({ grantedOperations: new Set() }),
  );
  assert.deepEqual(findings, []);
});

test("AC-003: a prerequisite_story_ref outside the dependency closure yields REVIEW_READINESS_REFERENCE_UNKNOWN", () => {
  const parsed = parseReadinessSidecar(
    bytesOf(
      validSidecar({
        criteria: [
          {
            id: "AC-001",
            operations: ["plan"],
            owner: "runner_worker",
            future_identities: [
              {
                kind: "commit",
                availability: "prerequisite",
                prerequisite_story_ref: "specs/stories/RF-002-other",
              },
            ],
          },
        ],
      }),
    ),
    STORY_DIRECTORY,
  );
  assert.equal(parsed.ok, true);
  const findings = checkReadinessSidecarReferences(
    parsed.data,
    baseContext({ dependencyClosure: new Set() }),
    {
      batchStoryDirectories: new Set([STORY_DIRECTORY]),
      outputOwners: new Map(),
    },
  );
  assert.ok(
    findings.some(
      (finding) => finding.code === "REVIEW_READINESS_REFERENCE_UNKNOWN",
    ),
  );
});

test("AC-003: a prerequisite_story_ref inside the dependency closure is not a finding", () => {
  const parsed = parseReadinessSidecar(
    bytesOf(
      validSidecar({
        criteria: [
          {
            id: "AC-001",
            operations: ["plan"],
            owner: "runner_worker",
            future_identities: [
              {
                kind: "commit",
                availability: "prerequisite",
                prerequisite_story_ref: "specs/stories/RF-002-other",
              },
            ],
          },
        ],
      }),
    ),
    STORY_DIRECTORY,
  );
  assert.equal(parsed.ok, true);
  const findings = checkReadinessSidecarReferences(
    parsed.data,
    baseContext({
      dependencyClosure: new Set(["specs/stories/RF-002-other"]),
    }),
    {
      batchStoryDirectories: new Set([
        STORY_DIRECTORY,
        "specs/stories/RF-002-other",
      ]),
      outputOwners: new Map(),
    },
  );
  assert.deepEqual(findings, []);
});

test("AC-003: a follow_up_story_ref outside the batch yields REVIEW_READINESS_REFERENCE_UNKNOWN", () => {
  const parsed = parseReadinessSidecar(
    bytesOf(
      validSidecar({
        decision_follow_ups: [
          {
            gate_id: "gate",
            choice: "proceed",
            follow_up_story_ref: "specs/stories/RF-999-outside",
          },
        ],
      }),
    ),
    STORY_DIRECTORY,
  );
  assert.equal(parsed.ok, true);
  const findings = checkReadinessSidecarReferences(parsed.data, baseContext(), {
    batchStoryDirectories: new Set([STORY_DIRECTORY]),
    outputOwners: new Map(),
  });
  assert.ok(
    findings.some(
      (finding) => finding.code === "REVIEW_READINESS_REFERENCE_UNKNOWN",
    ),
  );
});

test("AC-003: a prerequisite_output not owned by a Story in the dependency closure yields REVIEW_READINESS_REFERENCE_UNKNOWN", () => {
  const parsed = parseReadinessSidecar(
    bytesOf(
      validSidecar({
        inputs: [
          {
            id: "in-1",
            source: { prerequisite_output: { output_id: "out-1" } },
          },
        ],
      }),
    ),
    STORY_DIRECTORY,
  );
  assert.equal(parsed.ok, true);
  const outputOwners = new Map([["out-1", ["specs/stories/RF-002-other"]]]);
  const findings = checkReadinessSidecarReferences(
    parsed.data,
    baseContext({ dependencyClosure: new Set() }),
    { batchStoryDirectories: new Set([STORY_DIRECTORY]), outputOwners },
  );
  assert.ok(
    findings.some(
      (finding) => finding.code === "REVIEW_READINESS_REFERENCE_UNKNOWN",
    ),
  );
});

test("AC-003: outputs[].id declared by more than one Story yields REVIEW_READINESS_REFERENCE_UNKNOWN", () => {
  const parsed = parseReadinessSidecar(
    bytesOf(validSidecar({ outputs: [{ id: "shared-output" }] })),
    STORY_DIRECTORY,
  );
  assert.equal(parsed.ok, true);
  const owners = buildReadinessOutputOwners(
    new Map([
      [STORY_DIRECTORY, parsed.data],
      [
        "specs/stories/RF-002-other",
        { ...parsed.data, outputs: [{ id: "shared-output" }] },
      ],
    ]),
  );
  assert.deepEqual(owners.get("shared-output"), [
    STORY_DIRECTORY,
    "specs/stories/RF-002-other",
  ]);
  const findings = checkReadinessSidecarReferences(parsed.data, baseContext(), {
    batchStoryDirectories: new Set([
      STORY_DIRECTORY,
      "specs/stories/RF-002-other",
    ]),
    outputOwners: owners,
  });
  assert.ok(
    findings.some(
      (finding) => finding.code === "REVIEW_READINESS_REFERENCE_UNKNOWN",
    ),
  );
});

test("transitiveDependencyClosureDirectories resolves a multi-hop chain and ignores a cycle", () => {
  const dependencies = [
    { story: "RF-001", dependsOn: ["RF-002"] },
    { story: "RF-002", dependsOn: ["RF-003"] },
    { story: "RF-003", dependsOn: ["RF-001"] },
  ];
  const directoryByStoryId = new Map([
    ["RF-001", "specs/stories/RF-001-a"],
    ["RF-002", "specs/stories/RF-002-b"],
    ["RF-003", "specs/stories/RF-003-c"],
  ]);
  const closure = transitiveDependencyClosureDirectories(
    "RF-001",
    dependencies,
    directoryByStoryId,
  );
  assert.deepEqual(
    [...closure].sort(),
    ["specs/stories/RF-002-b", "specs/stories/RF-003-c"].sort(),
  );
});

// --- Code review follow-up: HIGH-1, HIGH-3 (Core side), MEDIUM, LOW ---

const HOSTILE_ID = "<script>alert(1)</script>‮\u001b[31m";
// `repoPath`-typed fields (story_ref, prerequisite_story_ref,
// follow_up_story_ref) reject C0 control characters (including ESC), so
// this hostile segment carries the bidi override and the script tag but not
// the ANSI escape `HOSTILE_ID` also carries.
const HOSTILE_PATH_SEGMENT = "<script>alert(1)</script>‮";
const HOSTILE_STORY_REF = `specs/stories/${HOSTILE_PATH_SEGMENT}`;

test("MEDIUM: a duplicate criterion id is rejected as invalid, never echoing the id", () => {
  const sidecar = validSidecar({
    criteria: [
      {
        id: "AC-001",
        operations: ["plan"],
        owner: "runner_worker",
        future_identities: [],
      },
      {
        id: "AC-001",
        operations: ["deploy"],
        owner: "human",
        future_identities: [],
      },
    ],
  });
  const parsed = parseReadinessSidecar(bytesOf(sidecar), STORY_DIRECTORY);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.tooLarge, false);
  assert.match(parsed.message, /criteria\[1\]\.id/);
});

test("MEDIUM: a duplicate input id is rejected as invalid", () => {
  const sidecar = validSidecar({
    inputs: [
      {
        id: HOSTILE_ID,
        source: { external_preexisting: { identity: "x" } },
      },
      {
        id: HOSTILE_ID,
        source: { external_preexisting: { identity: "y" } },
      },
    ],
  });
  const parsed = parseReadinessSidecar(bytesOf(sidecar), STORY_DIRECTORY);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.tooLarge, false);
  assert.match(parsed.message, /inputs\[1\]\.id/);
  assert.doesNotMatch(parsed.message, /script/);
});

test("MEDIUM: a duplicate JSON key anywhere in the document is rejected as invalid", () => {
  const text = JSON.stringify(validSidecar()).replace(
    '"owner":"runner_worker"',
    '"owner":"human","owner":"runner_worker"',
  );
  // Sanity: the replacement actually landed (otherwise this test would pass
  // for the wrong reason).
  assert.match(text, /"owner":"human","owner":"runner_worker"/);
  const parsed = parseReadinessSidecar(
    new TextEncoder().encode(text),
    STORY_DIRECTORY,
  );
  assert.equal(parsed.ok, false);
  assert.equal(parsed.tooLarge, false);
  // HIGH-1 (round 2): the generic scanner's own message may quote the
  // duplicated key's name, so parseReadinessSidecar re-words every non-depth
  // safety failure to this fixed, content-free string rather than surfacing
  // it verbatim.
  assert.equal(parsed.message, "readiness.json is not valid JSON");
});

test("HIGH-2: a __proto__ key (top-level and inside a criterion) is rejected as an unknown field, never repointing the object's prototype", () => {
  const text = JSON.stringify(validSidecar()).replace(
    '"owner":"runner_worker"',
    '"__proto__":{"owner":"integration_final"},"owner":"runner_worker"',
  );
  const withTopLevelProto = `{"__proto__":{"polluted":true},${text.slice(1)}`;
  const parsed = parseReadinessSidecar(
    new TextEncoder().encode(withTopLevelProto),
    STORY_DIRECTORY,
  );
  assert.equal(parsed.ok, false);
  assert.equal(parsed.tooLarge, false);
  assert.match(parsed.message, /unknown field/);
  // The pollution must never have happened at all: a plain object literal
  // and `Object.prototype` itself must never see `polluted`.
  assert.equal({}.polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
});

test("HIGH-1: a wrong story_ref never echoes the Sidecar's own (attacker-controlled) story_ref value", () => {
  const parsed = parseReadinessSidecar(
    bytesOf(validSidecar({ story_ref: HOSTILE_STORY_REF })),
    STORY_DIRECTORY,
  );
  assert.equal(parsed.ok, false);
  assert.doesNotMatch(parsed.message, /script/);
  assert.equal(parsed.message.includes("\u001b"), false);
});

test("MEDIUM: criteria compared as an ordered list — same ids, wrong order, is a mismatch", () => {
  const sidecarText = JSON.stringify(
    validSidecar({
      criteria: [
        {
          id: "AC-002",
          operations: [],
          owner: "human",
          future_identities: [],
        },
        {
          id: "AC-001",
          operations: ["plan"],
          owner: "runner_worker",
          future_identities: [],
        },
      ],
    }),
  );
  const parsed = parseReadinessSidecar(
    new TextEncoder().encode(sidecarText),
    STORY_DIRECTORY,
  );
  assert.equal(parsed.ok, true);
  const findings = checkReadinessSidecarConsistency(
    parsed.data,
    baseContext({ acceptanceIds: ["AC-001", "AC-002"] }),
  );
  assert.ok(
    findings.some(
      (finding) => finding.code === "REVIEW_READINESS_CRITERIA_MISMATCH",
    ),
  );
});

test("HIGH-1: every checkReadinessSidecarReferences message names only a field path and index, never Sidecar content", () => {
  const parsed = parseReadinessSidecar(
    bytesOf(
      validSidecar({
        criteria: [
          {
            id: "AC-001",
            operations: ["plan"],
            owner: "runner_worker",
            future_identities: [
              {
                kind: "commit",
                availability: "prerequisite",
                prerequisite_story_ref: `specs/stories/${HOSTILE_PATH_SEGMENT}`,
              },
            ],
          },
        ],
        inputs: [
          {
            id: "in-1",
            source: { prerequisite_output: { output_id: HOSTILE_ID } },
          },
        ],
        outputs: [{ id: HOSTILE_ID }],
        decision_follow_ups: [
          {
            gate_id: HOSTILE_ID,
            choice: "authorized: true",
            follow_up_story_ref: `specs/stories/${HOSTILE_PATH_SEGMENT}`,
          },
        ],
      }),
    ),
    STORY_DIRECTORY,
  );
  assert.equal(parsed.ok, true);
  const outputOwners = buildReadinessOutputOwners(
    new Map([
      [STORY_DIRECTORY, parsed.data],
      [
        "specs/stories/RF-002-other",
        { ...parsed.data, outputs: [{ id: HOSTILE_ID }] },
      ],
    ]),
  );
  const findings = checkReadinessSidecarReferences(
    parsed.data,
    baseContext({ dependencyClosure: new Set() }),
    {
      batchStoryDirectories: new Set([STORY_DIRECTORY]),
      outputOwners,
    },
  );
  assert.ok(findings.length >= 4, JSON.stringify(findings));
  for (const finding of findings) {
    assert.doesNotMatch(finding.message, /script/);
    assert.equal(finding.message.includes("\u001b"), false);
    assert.doesNotMatch(finding.message, /‮/);
    assert.match(finding.message, /\[\d+\]/);
  }
});

test("LOW: a duplicated output id is reported once per id, not once per occurrence", () => {
  const parsed = parseReadinessSidecar(
    bytesOf(
      validSidecar({
        outputs: [{ id: "shared" }, { id: "shared" }, { id: "other" }],
      }),
    ),
    STORY_DIRECTORY,
  );
  assert.equal(parsed.ok, true);
  const outputOwners = buildReadinessOutputOwners(
    new Map([
      [STORY_DIRECTORY, parsed.data],
      [
        "specs/stories/RF-002-other",
        { ...parsed.data, outputs: [{ id: "shared" }] },
      ],
    ]),
  );
  const findings = checkReadinessSidecarReferences(parsed.data, baseContext(), {
    batchStoryDirectories: new Set([
      STORY_DIRECTORY,
      "specs/stories/RF-002-other",
    ]),
    outputOwners,
  });
  const referenceFindings = findings.filter(
    (finding) => finding.code === "REVIEW_READINESS_REFERENCE_UNKNOWN",
  );
  assert.equal(referenceFindings.length, 1, JSON.stringify(referenceFindings));
  assert.match(referenceFindings[0].message, /outputs\[0\]\.id/);
});
