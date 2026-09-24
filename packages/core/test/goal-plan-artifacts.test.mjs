import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { URL, fileURLToPath } from "node:url";
import { TextEncoder } from "node:util";
import test from "node:test";

import {
  exportGoalPlanDeclaration,
  exportGoalPlanManifest,
  exportPlanCoverageReview,
  validateGoalPlanDeclaration,
  validateGoalPlanManifest,
  validatePlanCoverageReview,
} from "@praxisbound/core";

const fixtureRoot = fileURLToPath(
  new URL("./fixtures/goal-plan-artifacts/", import.meta.url),
);
const encoder = new TextEncoder();

function bytes(name) {
  return readFileSync(`${fixtureRoot}${name}`);
}

function sha256(bytesValue) {
  return createHash("sha256").update(bytesValue).digest("hex");
}

const readinessA = {
  path: "specs/stories/EX-001-first/readiness.json",
  bytes: bytes("sources/readiness-a.json"),
};
const readinessB = {
  path: "specs/stories/EX-002-second/readiness.json",
  bytes: bytes("sources/readiness-b.json"),
};

function reviewedSourcesInput() {
  return [
    {
      path: "specs/decisions/ADR-001-example.md",
      bytes: bytes("sources/adr.md"),
    },
    { path: "specs/features/example/spec.md", bytes: bytes("sources/spec.md") },
    {
      path: "specs/stories/EX-001-first/acceptance.md",
      bytes: bytes("sources/acceptance-a.md"),
    },
    {
      path: "specs/stories/EX-001-first/story.md",
      bytes: bytes("sources/story-a.md"),
    },
    {
      path: "specs/stories/EX-002-second/acceptance.md",
      bytes: bytes("sources/acceptance-b.md"),
    },
    {
      path: "specs/stories/EX-002-second/story.md",
      bytes: bytes("sources/story-b.md"),
    },
  ];
}

const coverageIndex = {
  batchId: "BR-001-goal-plan-fixture",
  fingerprint: sha256(encoder.encode("fixture-fingerprint")),
};

function testDeclarationInput(nodes, planId = "test-plan") {
  return {
    planId,
    revision: 1,
    nodes,
  };
}

function testManifestInput({
  nodes = [
    {
      nodeRef: "node-a",
      storyRef: "specs/stories/EX-001-first",
      readiness: readinessA,
      dependsOn: [],
    },
  ],
  declarationInput,
} = {}) {
  const declaration = declarationInput ?? {
    planId: "test-plan",
    revision: 1,
    nodes: nodes.map((node) => ({
      nodeRef: node.nodeRef,
      storyRef: node.storyRef,
      dependsOn: node.dependsOn,
    })),
  };
  const declarationBytes = exportGoalPlanDeclaration(declaration);
  return exportGoalPlanManifest({
    planId: "test-plan",
    revision: 1,
    declaration: {
      path: "specs/plans/test-plan.json",
      bytes: declarationBytes,
    },
    nodes,
    reviewedSources: [readinessA],
    coverageIndex,
  });
}

test("AC-001: exporting a Declaration, Manifest, and Coverage Review from the same inputs twice yields byte-identical documents that validate", () => {
  const declarationInput = testDeclarationInput(
    [
      {
        nodeRef: "node-b",
        storyRef: "specs/stories/EX-002-second",
        dependsOn: ["node-a"],
      },
      {
        nodeRef: "node-a",
        storyRef: "specs/stories/EX-001-first",
        dependsOn: [],
      },
    ],
    "fixture-goal-plan",
  );
  const declarationBytesOne = exportGoalPlanDeclaration(declarationInput);
  const declarationBytesTwo = exportGoalPlanDeclaration(declarationInput);
  assert.deepEqual(declarationBytesOne, declarationBytesTwo);
  const declarationShape = JSON.parse(
    Buffer.from(declarationBytesOne).toString("utf8"),
  );
  assert.deepEqual(
    declarationShape.nodes.map((node) => node.nodeRef),
    ["node-a", "node-b"],
    "export sorts nodes by UTF-8 node reference",
  );
  const declResult = validateGoalPlanDeclaration(declarationBytesOne);
  assert.equal(declResult.ok, true);

  const manifestInput = {
    planId: "fixture-goal-plan",
    revision: 1,
    declaration: {
      path: "specs/plans/fixture-goal-plan.json",
      bytes: declarationBytesOne,
    },
    nodes: [
      {
        nodeRef: "node-b",
        storyRef: "specs/stories/EX-002-second",
        readiness: readinessB,
        dependsOn: ["node-a"],
      },
      {
        nodeRef: "node-a",
        storyRef: "specs/stories/EX-001-first",
        readiness: readinessA,
        dependsOn: [],
      },
    ],
    reviewedSources: reviewedSourcesInput(),
    coverageIndex,
  };
  const manifestBytesOne = exportGoalPlanManifest(manifestInput);
  const manifestBytesTwo = exportGoalPlanManifest(manifestInput);
  assert.deepEqual(manifestBytesOne, manifestBytesTwo);

  const manifestShape = JSON.parse(
    Buffer.from(manifestBytesOne).toString("utf8"),
  );
  assert.deepEqual(
    manifestShape.nodes.map((node) => node.nodeRef),
    ["node-a", "node-b"],
  );
  assert.equal(
    manifestShape.nodes[0].readinessContract.path,
    "specs/stories/EX-001-first/readiness.json",
  );
  assert.equal(
    manifestShape.nodes[1].readinessContract.path,
    "specs/stories/EX-002-second/readiness.json",
  );

  const facts = new Map([
    ["specs/plans/fixture-goal-plan.json", declarationBytesOne],
    [readinessA.path, readinessA.bytes],
    [readinessB.path, readinessB.bytes],
    ...reviewedSourcesInput().map((source) => [source.path, source.bytes]),
  ]);
  const manifestResult = validateGoalPlanManifest(manifestBytesOne, facts);
  assert.equal(manifestResult.ok, true);

  const reviewInput = {
    manifestBytes: manifestBytesOne,
    reviewId: "00000000-0000-4000-8000-000000000099",
    conclusion: "approved",
    reviewer: { name: "Test Reviewer", assurance: "self-asserted" },
    reviewedAt: "2026-01-02T03:04:05.000Z",
    sources: facts,
  };
  const reviewBytesOne = exportPlanCoverageReview(reviewInput);
  const reviewBytesTwo = exportPlanCoverageReview(reviewInput);
  assert.deepEqual(reviewBytesOne, reviewBytesTwo);
  const reviewResult = validatePlanCoverageReview(
    reviewBytesOne,
    manifestBytesOne,
    facts,
  );
  assert.equal(reviewResult.ok, true);
});

test("AC-002: a mismatched Coverage Review manifestSha256, reviewedSources, or coverageIndex is rejected as approval-binding-mismatch", () => {
  const manifestBytes = testManifestInput();
  const facts = new Map([
    ["specs/plans/test-plan.json", bytes("valid-declaration.json")],
    [readinessA.path, readinessA.bytes],
  ]);
  // The Declaration bound above is a stand-in whose digest the Manifest
  // does not reference; rebuild the exact facts from the Manifest bytes.
  const manifestShape = JSON.parse(Buffer.from(manifestBytes).toString("utf8"));
  const declarationBytes = exportGoalPlanDeclaration(
    testDeclarationInput([
      {
        nodeRef: "node-a",
        storyRef: "specs/stories/EX-001-first",
        dependsOn: [],
      },
    ]),
  );
  facts.set(manifestShape.declaration.path, declarationBytes);

  const validReview = JSON.parse(
    Buffer.from(
      exportPlanCoverageReview({
        manifestBytes,
        reviewId: "00000000-0000-4000-8000-000000000001",
        conclusion: "approved",
        reviewer: { name: "Test Reviewer", assurance: "self-asserted" },
        reviewedAt: "2026-01-02T03:04:05.000Z",
        sources: facts,
      }),
    ).toString("utf8"),
  );

  const cases = [
    ["manifestSha256", { manifestSha256: "0".repeat(64) }],
    [
      "coverageIndex",
      {
        coverageIndex: {
          ...validReview.coverageIndex,
          fingerprint: "1".repeat(64),
        },
      },
    ],
    ["reviewedSources", { reviewedSources: [] }],
  ];
  for (const [label, change] of cases) {
    const reviewBytes = Buffer.from(
      JSON.stringify({ ...validReview, ...change }),
    );
    const result = validatePlanCoverageReview(
      reviewBytes,
      manifestBytes,
      facts,
    );
    assert.equal(result.ok, false, label);
    assert.equal(result.category, "approval-binding-mismatch", label);
  }
});

test("AC-002: a Manifest's declaration, source, and readiness digests are checked against caller-supplied bytes", () => {
  const manifestBytes = testManifestInput();
  const manifestShape = JSON.parse(Buffer.from(manifestBytes).toString("utf8"));
  const declarationBytes = exportGoalPlanDeclaration(
    testDeclarationInput([
      {
        nodeRef: "node-a",
        storyRef: "specs/stories/EX-001-first",
        dependsOn: [],
      },
    ]),
  );

  const validFacts = new Map([
    [manifestShape.declaration.path, declarationBytes],
    [readinessA.path, readinessA.bytes],
  ]);
  assert.equal(validateGoalPlanManifest(manifestBytes, validFacts).ok, true);

  const wrongDeclaration = new Map(validFacts);
  wrongDeclaration.set(
    manifestShape.declaration.path,
    encoder.encode(
      '{"schemaVersion":"1.0.0","plan":{"id":"other","revision":1},"nodes":[]}',
    ),
  );
  const declarationDigestResult = validateGoalPlanManifest(
    manifestBytes,
    wrongDeclaration,
  );
  assert.equal(declarationDigestResult.ok, false);
  assert.equal(declarationDigestResult.category, "digest-mismatch");

  const wrongReadiness = new Map(validFacts);
  wrongReadiness.set(readinessA.path, encoder.encode("different bytes"));
  const readinessDigestResult = validateGoalPlanManifest(
    manifestBytes,
    wrongReadiness,
  );
  assert.equal(readinessDigestResult.ok, false);
  assert.equal(readinessDigestResult.category, "digest-mismatch");

  const missingFacts = validateGoalPlanManifest(manifestBytes);
  assert.equal(missingFacts.ok, false);
  assert.equal(missingFacts.category, "digest-mismatch");
});

test("AC-004: an over-bound artifact is rejected whole as malformed-artifact, never truncated", () => {
  const oversized = new Uint8Array(8 * 1024 * 1024 + 1);
  oversized.fill(0x20);
  const oversizedManifest = validateGoalPlanManifest(oversized, new Map());
  assert.equal(oversizedManifest.ok, false);
  assert.equal(oversizedManifest.category, "malformed-artifact");
  assert.match(oversizedManifest.message, /exceed/);

  const oversizedDeclaration = validateGoalPlanDeclaration(oversized);
  assert.equal(oversizedDeclaration.ok, false);
  assert.equal(oversizedDeclaration.category, "malformed-artifact");

  const manyDependsOn = Array.from(
    { length: 1001 },
    (_, i) => `dep-${String(i).padStart(4, "0")}`,
  );
  const tooManyDependsOnManifest = JSON.stringify({
    schemaVersion: "1.0.0",
    plan: { id: "test-plan", revision: 1 },
    declaration: { path: "specs/plans/test-plan.json", sha256: "0".repeat(64) },
    nodes: [
      {
        nodeRef: "node-a",
        storyRef: "specs/stories/EX-001-first",
        readinessContract: {
          path: "specs/stories/EX-001-first/readiness.json",
          sha256: "0".repeat(64),
        },
        dependsOn: manyDependsOn,
      },
    ],
    reviewedSources: [],
    coverageIndex: { batchId: "BR-001-fixture", fingerprint: "0".repeat(64) },
  });
  const tooManyResult = validateGoalPlanManifest(
    encoder.encode(tooManyDependsOnManifest),
    new Map(),
  );
  assert.equal(tooManyResult.ok, false);
  assert.equal(tooManyResult.category, "malformed-artifact");
});

function baseManifestShape() {
  return {
    schemaVersion: "1.0.0",
    plan: { id: "test-plan", revision: 1 },
    declaration: { path: "specs/plans/test-plan.json", sha256: "0".repeat(64) },
    nodes: [
      {
        nodeRef: "node-a",
        storyRef: "specs/stories/EX-001-first",
        readinessContract: {
          path: "specs/stories/EX-001-first/readiness.json",
          sha256: "0".repeat(64),
        },
        dependsOn: [],
      },
    ],
    reviewedSources: [
      { path: "specs/decisions/ADR-001-example.md", sha256: "1".repeat(64) },
    ],
    coverageIndex: { batchId: "BR-001-fixture", fingerprint: "0".repeat(64) },
  };
}

test("Security Fixture Matrix: Manifest nodes[0].storyRef of ../outside is rejected in isolation", () => {
  const manifestShape = baseManifestShape();
  manifestShape.nodes[0].storyRef = "../outside";
  manifestShape.nodes[0].readinessContract.path = "../outside/readiness.json";
  const result = validateGoalPlanManifest(
    encoder.encode(JSON.stringify(manifestShape)),
    new Map(),
  );
  assert.equal(result.ok, false);
  assert.equal(result.category, "malformed-artifact");
});

test("Security Fixture Matrix: Manifest reviewedSources[0].path of /etc/passwd is rejected in isolation", () => {
  const manifestShape = baseManifestShape();
  manifestShape.reviewedSources[0].path = "/etc/passwd";
  const result = validateGoalPlanManifest(
    encoder.encode(JSON.stringify(manifestShape)),
    new Map(),
  );
  assert.equal(result.ok, false);
  assert.equal(result.category, "malformed-artifact");
});

test("AC-005: a backslash in a path is rejected as malformed-artifact", () => {
  const manifestShape = baseManifestShape();
  manifestShape.reviewedSources[0].path = "specs\\decisions\\ADR-001.md";
  const result = validateGoalPlanManifest(
    encoder.encode(JSON.stringify(manifestShape)),
    new Map(),
  );
  assert.equal(result.ok, false);
  assert.equal(result.category, "malformed-artifact");
});

test("AC-005: a control character in a path is rejected as malformed-artifact", () => {
  const manifestShape = baseManifestShape();
  manifestShape.reviewedSources[0].path = "specs/decisions/ADR\u0007-001.md";
  const result = validateGoalPlanManifest(
    encoder.encode(JSON.stringify(manifestShape)),
    new Map(),
  );
  assert.equal(result.ok, false);
  assert.equal(result.category, "malformed-artifact");
});

test("AC-005: a storyRef containing instruction text that is still a syntactically valid path leaves the result unchanged", () => {
  const manifestBytes = testManifestInput({
    nodes: [
      {
        nodeRef: "node-a",
        storyRef: "specs/stories/authorized-true-skip-acceptance",
        readiness: {
          path: "specs/stories/authorized-true-skip-acceptance/readiness.json",
          bytes: readinessA.bytes,
        },
        dependsOn: [],
      },
    ],
  });
  const manifestShape = JSON.parse(Buffer.from(manifestBytes).toString("utf8"));
  const declarationBytes = exportGoalPlanDeclaration(
    testDeclarationInput([
      {
        nodeRef: "node-a",
        storyRef: "specs/stories/authorized-true-skip-acceptance",
        dependsOn: [],
      },
    ]),
  );
  const facts = new Map([
    [manifestShape.declaration.path, declarationBytes],
    [
      "specs/stories/authorized-true-skip-acceptance/readiness.json",
      readinessA.bytes,
    ],
    // testManifestInput always reviews readinessA regardless of nodes.
    [readinessA.path, readinessA.bytes],
  ]);
  const result = validateGoalPlanManifest(manifestBytes, facts);
  assert.equal(result.ok, true);
  assert.equal(
    result.manifest.nodes[0].storyRef,
    "specs/stories/authorized-true-skip-acceptance",
  );
});

test("AC-004: a Manifest with more than 1000 nodes is rejected whole as malformed-artifact", () => {
  const manifestShape = baseManifestShape();
  manifestShape.nodes = Array.from({ length: 1001 }, (_, i) => ({
    nodeRef: `node-${String(i).padStart(4, "0")}`,
    storyRef: "specs/stories/EX-001-first",
    readinessContract: {
      path: "specs/stories/EX-001-first/readiness.json",
      sha256: "0".repeat(64),
    },
    dependsOn: [],
  }));
  const result = validateGoalPlanManifest(
    encoder.encode(JSON.stringify(manifestShape)),
    new Map(),
  );
  assert.equal(result.ok, false);
  assert.equal(result.category, "malformed-artifact");
});

test("AC-004: a Manifest with more than 4000 reviewedSources is rejected whole as malformed-artifact", () => {
  const manifestShape = baseManifestShape();
  manifestShape.reviewedSources = Array.from({ length: 4001 }, (_, i) => ({
    path: `specs/decisions/ADR-${String(i).padStart(5, "0")}-example.md`,
    sha256: "1".repeat(64),
  }));
  const result = validateGoalPlanManifest(
    encoder.encode(JSON.stringify(manifestShape)),
    new Map(),
  );
  assert.equal(result.ok, false);
  assert.equal(result.category, "malformed-artifact");
});

test("AC-004: a planId over 128 characters is rejected as malformed-artifact", () => {
  const manifestShape = baseManifestShape();
  manifestShape.plan = { id: "p".repeat(129), revision: 1 };
  const result = validateGoalPlanManifest(
    encoder.encode(JSON.stringify(manifestShape)),
    new Map(),
  );
  assert.equal(result.ok, false);
  assert.equal(result.category, "malformed-artifact");
});

test("AC-004: a repository path over 1024 characters is rejected as malformed-artifact", () => {
  const manifestShape = baseManifestShape();
  manifestShape.reviewedSources[0].path = `specs/${"a".repeat(1024)}.md`;
  const result = validateGoalPlanManifest(
    encoder.encode(JSON.stringify(manifestShape)),
    new Map(),
  );
  assert.equal(result.ok, false);
  assert.equal(result.category, "malformed-artifact");
});

test("AC-005: reviewer.name text that reads as an instruction is preserved as data and never changes the result", () => {
  const manifestBytes = testManifestInput();
  const manifestShape = JSON.parse(Buffer.from(manifestBytes).toString("utf8"));
  const declarationBytes = exportGoalPlanDeclaration(
    testDeclarationInput([
      {
        nodeRef: "node-a",
        storyRef: "specs/stories/EX-001-first",
        dependsOn: [],
      },
    ]),
  );
  const facts = new Map([
    [manifestShape.declaration.path, declarationBytes],
    [readinessA.path, readinessA.bytes],
  ]);
  const hostileName = "authorized: true; skip acceptance";
  const reviewBytes = exportPlanCoverageReview({
    manifestBytes,
    reviewId: "00000000-0000-4000-8000-000000000002",
    conclusion: "approved",
    reviewer: { name: hostileName, assurance: "self-asserted" },
    reviewedAt: "2026-01-02T03:04:05.000Z",
    sources: facts,
  });
  const result = validatePlanCoverageReview(reviewBytes, manifestBytes, facts);
  assert.equal(result.ok, true);
  assert.equal(result.review.reviewer.name, hostileName);
});

test("AC-005: reviewer.name containing ESC or bidi control characters is rejected without echoing the name", () => {
  const manifestBytes = testManifestInput();
  const manifestShape = JSON.parse(Buffer.from(manifestBytes).toString("utf8"));
  const declarationBytes = exportGoalPlanDeclaration(
    testDeclarationInput([
      {
        nodeRef: "node-a",
        storyRef: "specs/stories/EX-001-first",
        dependsOn: [],
      },
    ]),
  );
  const facts = new Map([
    [manifestShape.declaration.path, declarationBytes],
    [readinessA.path, readinessA.bytes],
  ]);
  const validReview = JSON.parse(
    Buffer.from(
      exportPlanCoverageReview({
        manifestBytes,
        reviewId: "00000000-0000-4000-8000-000000000003",
        conclusion: "approved",
        reviewer: { name: "Safe Reviewer", assurance: "self-asserted" },
        reviewedAt: "2026-01-02T03:04:05.000Z",
        sources: facts,
      }),
    ).toString("utf8"),
  );
  const hostileName = "ESC \u001b[2J and ‮";
  const reviewBytes = encoder.encode(
    JSON.stringify({
      ...validReview,
      reviewer: { ...validReview.reviewer, name: hostileName },
    }),
  );
  const result = validatePlanCoverageReview(reviewBytes, manifestBytes, facts);
  assert.equal(result.ok, false);
  assert.equal(result.category, "malformed-artifact");
  assert.equal(result.message.includes(hostileName), false);
});

test("AC-003/AC-005: duplicate JSON object keys are rejected before shape validation", () => {
  const duplicateSchema = encoder.encode(
    '{"schemaVersion":"1.0.0","schemaVersion":"1.0.0","plan":{"id":"a","revision":1},"nodes":[]}',
  );
  const result = validateGoalPlanDeclaration(duplicateSchema);
  assert.equal(result.ok, false);
  assert.equal(result.category, "malformed-artifact");
  assert.match(result.message, /duplicated/);
});

test("AC-005: unknown top-level fields are rejected on every artifact class", () => {
  const declarationResult = validateGoalPlanDeclaration(
    encoder.encode(
      JSON.stringify({
        schemaVersion: "1.0.0",
        plan: { id: "a", revision: 1 },
        nodes: [{ nodeRef: "n", storyRef: "s", dependsOn: [] }],
        extra: true,
      }),
    ),
  );
  assert.equal(declarationResult.ok, false);
  assert.equal(declarationResult.category, "malformed-artifact");

  assert.throws(
    () =>
      exportGoalPlanDeclaration({
        planId: "a",
        revision: 1,
        nodes: [{ nodeRef: "n", storyRef: "s", dependsOn: [] }],
        extra: true,
      }),
    () => true,
  );
});

const HOSTILE_KEY = "\u001b[2J‮EVIL";

test("HIGH-1: an unknown field name is never echoed in the message or path", () => {
  const declarationBytes = encoder.encode(
    JSON.stringify({
      schemaVersion: "1.0.0",
      plan: { id: "a", revision: 1 },
      nodes: [{ nodeRef: "n", storyRef: "s", dependsOn: [] }],
      [HOSTILE_KEY]: true,
    }),
  );
  const result = validateGoalPlanDeclaration(declarationBytes);
  assert.equal(result.ok, false);
  assert.equal(result.category, "malformed-artifact");
  assert.equal(result.message.includes(HOSTILE_KEY), false);
  assert.equal((result.path ?? "").includes(HOSTILE_KEY), false);
});

test("HIGH-1: a duplicated JSON object key is never echoed in the message", () => {
  const key = JSON.stringify(HOSTILE_KEY);
  const duplicateKeyJson = `{"schemaVersion":"1.0.0","plan":{"id":"a","revision":1},"nodes":[],${key}:1,${key}:2}`;
  const result = validateGoalPlanDeclaration(encoder.encode(duplicateKeyJson));
  assert.equal(result.ok, false);
  assert.equal(result.category, "malformed-artifact");
  assert.match(result.message, /duplicated/);
  assert.equal(result.message.includes(HOSTILE_KEY), false);
});

test("HIGH-1: a hostile schemaVersion value is never echoed, and observed is a fixed type description", () => {
  const declarationBytes = encoder.encode(
    JSON.stringify({
      schemaVersion: HOSTILE_KEY,
      plan: { id: "a", revision: 1 },
      nodes: [{ nodeRef: "n", storyRef: "s", dependsOn: [] }],
    }),
  );
  const result = validateGoalPlanDeclaration(declarationBytes);
  assert.equal(result.ok, false);
  assert.equal(result.category, "unsupported-schema");
  assert.equal(result.message.includes(HOSTILE_KEY), false);
  assert.equal(result.observed, "string");
  assert.notEqual(result.observed, HOSTILE_KEY);
});

test("HIGH-1: nested Declaration/Manifest failures are not spliced into the Manifest message", () => {
  const manifestShape = baseManifestShape();
  manifestShape.declaration.sha256 = "0".repeat(64);
  const declarationBytes = encoder.encode(
    JSON.stringify({
      schemaVersion: HOSTILE_KEY,
      plan: { id: "a", revision: 1 },
      nodes: [],
    }),
  );
  const facts = new Map([
    [manifestShape.declaration.path, declarationBytes],
    [
      "specs/stories/EX-001-first/readiness.json",
      encoder.encode("placeholder"),
    ],
    ["specs/decisions/ADR-001-example.md", encoder.encode("placeholder")],
  ]);
  manifestShape.declaration.sha256 = sha256(declarationBytes);
  manifestShape.nodes[0].readinessContract.sha256 = sha256(
    encoder.encode("placeholder"),
  );
  manifestShape.reviewedSources[0].sha256 = sha256(
    encoder.encode("placeholder"),
  );
  const result = validateGoalPlanManifest(
    encoder.encode(JSON.stringify(manifestShape)),
    facts,
  );
  assert.equal(result.ok, false);
  assert.equal(result.category, "unsupported-schema");
  assert.equal(result.message.includes(HOSTILE_KEY), false);
});

test("LOW-10: an unbound source fact path (including an absolute path) is never echoed in the message", () => {
  const manifestBytes = testManifestInput();
  const hostilePath = "/etc/passwd";
  const facts = new Map([[hostilePath, "not bytes"]]);
  const result = validateGoalPlanManifest(manifestBytes, facts);
  assert.equal(result.ok, false);
  assert.equal(result.category, "malformed-artifact");
  assert.equal(result.message.includes(hostilePath), false);
});

test("HIGH-2: a Declaration's dependsOn is not required to be sorted, only unique and valid", () => {
  const declarationBytes = encoder.encode(
    JSON.stringify({
      schemaVersion: "1.0.0",
      plan: { id: "a", revision: 1 },
      nodes: [
        { nodeRef: "node-a", storyRef: "s/a", dependsOn: [] },
        { nodeRef: "node-b", storyRef: "s/b", dependsOn: [] },
        {
          nodeRef: "node-c",
          storyRef: "s/c",
          dependsOn: ["node-b", "node-a"],
        },
      ],
    }),
  );
  const result = validateGoalPlanDeclaration(declarationBytes);
  assert.equal(result.ok, true);
  assert.deepEqual(result.declaration.nodes[2].dependsOn, ["node-b", "node-a"]);
});

test("HIGH-2: a Manifest's dependsOn is still required to be sorted", () => {
  const manifestShape = baseManifestShape();
  manifestShape.nodes = [
    {
      nodeRef: "node-a",
      storyRef: "specs/stories/EX-001-first",
      readinessContract: {
        path: "specs/stories/EX-001-first/readiness.json",
        sha256: "0".repeat(64),
      },
      dependsOn: [],
    },
    {
      nodeRef: "node-b",
      storyRef: "specs/stories/EX-001-first",
      readinessContract: {
        path: "specs/stories/EX-001-first/readiness.json",
        sha256: "0".repeat(64),
      },
      dependsOn: [],
    },
    {
      nodeRef: "node-c",
      storyRef: "specs/stories/EX-001-first",
      readinessContract: {
        path: "specs/stories/EX-001-first/readiness.json",
        sha256: "0".repeat(64),
      },
      dependsOn: ["node-b", "node-a"],
    },
  ];
  const result = validateGoalPlanManifest(
    encoder.encode(JSON.stringify(manifestShape)),
    new Map(),
  );
  assert.equal(result.ok, false);
  assert.equal(result.category, "malformed-artifact");
});

test("MEDIUM-4: reviewedSources are sorted and compared by UTF-8 bytes, not UTF-16 code units", () => {
  // "s/Ａ" (fullwidth A) sorts before "s/\u{1F600}" (grinning face) in
  // UTF-8 byte order (0xEF < 0xF0 at the first differing byte), but after it
  // under naive UTF-16 code-unit comparison (0xFF21 > the leading surrogate
  // 0xD83D).
  const fullwidthAPath = "s/Ａ";
  const emojiPath = "s/\u{1F600}";
  assert.ok(
    fullwidthAPath < emojiPath === false,
    "sanity: UTF-16 code-unit order places the emoji path first",
  );

  const manifestShape = baseManifestShape();
  manifestShape.reviewedSources = [
    { path: fullwidthAPath, sha256: sha256(encoder.encode("a")) },
    { path: emojiPath, sha256: sha256(encoder.encode("b")) },
  ];
  const facts = new Map([
    [fullwidthAPath, encoder.encode("a")],
    [emojiPath, encoder.encode("b")],
    ["specs/stories/EX-001-first/readiness.json", encoder.encode("readiness")],
    [manifestShape.declaration.path, encoder.encode("declaration")],
  ]);
  manifestShape.nodes[0].readinessContract.sha256 = sha256(
    encoder.encode("readiness"),
  );

  const result = validateGoalPlanManifest(
    encoder.encode(JSON.stringify(manifestShape)),
    facts,
  );
  // The Manifest's own declaration binding fails independently (a
  // placeholder digest), but that failure must not be "must be sorted" —
  // proving the UTF-8-order check accepts this correctly-ordered pair.
  assert.notEqual(result.category, "invalid-topology");
  if (result.ok === false) {
    assert.notEqual(
      result.message,
      "reviewedSources must be sorted by UTF-8 path bytes",
    );
  }
});

test("MEDIUM-4: exported reviewedSources are sorted by UTF-8 bytes, not UTF-16 code units", () => {
  const fullwidthA = { path: "s/Ａ", bytes: encoder.encode("a") };
  const emoji = { path: "s/\u{1F600}", bytes: encoder.encode("b") };
  const manifestBytes = testManifestInput({
    nodes: [
      {
        nodeRef: "node-a",
        storyRef: "specs/stories/EX-001-first",
        readiness: readinessA,
        dependsOn: [],
      },
    ],
  });
  const declarationBytes = exportGoalPlanDeclaration(
    testDeclarationInput([
      {
        nodeRef: "node-a",
        storyRef: "specs/stories/EX-001-first",
        dependsOn: [],
      },
    ]),
  );
  const exported = exportGoalPlanManifest({
    planId: "test-plan",
    revision: 1,
    declaration: {
      path: "specs/plans/test-plan.json",
      bytes: declarationBytes,
    },
    nodes: [
      {
        nodeRef: "node-a",
        storyRef: "specs/stories/EX-001-first",
        readiness: readinessA,
        dependsOn: [],
      },
    ],
    reviewedSources: [emoji, fullwidthA],
    coverageIndex,
  });
  const shape = JSON.parse(Buffer.from(exported).toString("utf8"));
  assert.deepEqual(
    shape.reviewedSources.map((source) => source.path),
    [fullwidthA.path, emoji.path],
    "the fullwidth-A path sorts before the emoji path in UTF-8 byte order",
  );
  void manifestBytes;
});

test("LOW-8: exportPlanCoverageReview requires sources", () => {
  const manifestBytes = testManifestInput();
  assert.throws(
    () =>
      exportPlanCoverageReview({
        manifestBytes,
        reviewId: "00000000-0000-4000-8000-000000000004",
        conclusion: "approved",
        reviewer: { name: "Test Reviewer", assurance: "self-asserted" },
        reviewedAt: "2026-01-02T03:04:05.000Z",
      }),
    (error) => error.category === "malformed-artifact",
  );
});

test("LOW-9: export and validate report the same category and causeCategory for an invalid referenced Manifest", () => {
  const manifestShape = baseManifestShape();
  manifestShape.nodes = [
    {
      nodeRef: "node-a",
      storyRef: "specs/stories/EX-001-first",
      readinessContract: {
        path: "specs/stories/EX-001-first/readiness.json",
        sha256: "0".repeat(64),
      },
      dependsOn: ["node-b"],
    },
    {
      nodeRef: "node-b",
      storyRef: "specs/stories/EX-001-first",
      readinessContract: {
        path: "specs/stories/EX-001-first/readiness.json",
        sha256: "0".repeat(64),
      },
      dependsOn: ["node-a"],
    },
  ];
  const invalidManifestBytes = encoder.encode(JSON.stringify(manifestShape));
  const manifestValidation = validateGoalPlanManifest(
    invalidManifestBytes,
    new Map(),
  );
  assert.equal(manifestValidation.ok, false);
  assert.equal(manifestValidation.category, "invalid-topology");

  const reviewValidation = validatePlanCoverageReview(
    encoder.encode(
      JSON.stringify({
        schemaVersion: "1.0.0",
        reviewId: "00000000-0000-4000-8000-000000000005",
        manifestSha256: sha256(invalidManifestBytes),
        reviewedSources: [],
        coverageIndex: manifestShape.coverageIndex,
        conclusion: "approved",
        reviewer: { name: "Test Reviewer", assurance: "self-asserted" },
        reviewedAt: "2026-01-02T03:04:05.000Z",
      }),
    ),
    invalidManifestBytes,
    new Map(),
  );
  assert.equal(reviewValidation.ok, false);
  assert.equal(reviewValidation.category, "approval-binding-mismatch");
  assert.equal(reviewValidation.causeCategory, "invalid-topology");

  assert.throws(
    () =>
      exportPlanCoverageReview({
        manifestBytes: invalidManifestBytes,
        reviewId: "00000000-0000-4000-8000-000000000006",
        conclusion: "approved",
        reviewer: { name: "Test Reviewer", assurance: "self-asserted" },
        reviewedAt: "2026-01-02T03:04:05.000Z",
        sources: new Map(),
      }),
    (error) =>
      error.category === "approval-binding-mismatch" &&
      error.causeCategory === "invalid-topology",
  );
});

// -- Human Review 2026-09-23 (Q24): stricter-consumer-behavior rules ------

test("Q24: a repository path containing a Unicode Cf, Zl, or Zp character is rejected as malformed-artifact", () => {
  const hostileChars = [
    "­", // soft hyphen (Cf)
    "⁠", // word joiner (Cf)
    "؜", // Arabic letter mark (Cf)
    "﻿", // BOM (Cf)
    " ", // line separator (Zl)
    " ", // paragraph separator (Zp)
  ];
  for (const char of hostileChars) {
    const manifestShape = baseManifestShape();
    manifestShape.reviewedSources[0].path = `specs/decisions/ADR${char}001.md`;
    const result = validateGoalPlanManifest(
      encoder.encode(JSON.stringify(manifestShape)),
      new Map(),
    );
    assert.equal(result.ok, false, JSON.stringify(char));
    assert.equal(result.category, "malformed-artifact", JSON.stringify(char));
  }
});

test("Q24: a reviewer.name containing a Unicode Cf, Zl, or Zp character is rejected as malformed-artifact", () => {
  const manifestBytes = testManifestInput();
  const manifestShape = JSON.parse(Buffer.from(manifestBytes).toString("utf8"));
  const declarationBytes = exportGoalPlanDeclaration(
    testDeclarationInput([
      {
        nodeRef: "node-a",
        storyRef: "specs/stories/EX-001-first",
        dependsOn: [],
      },
    ]),
  );
  const facts = new Map([
    [manifestShape.declaration.path, declarationBytes],
    [readinessA.path, readinessA.bytes],
  ]);
  const validReview = JSON.parse(
    Buffer.from(
      exportPlanCoverageReview({
        manifestBytes,
        reviewId: "00000000-0000-4000-8000-000000000007",
        conclusion: "approved",
        reviewer: { name: "Safe Reviewer", assurance: "self-asserted" },
        reviewedAt: "2026-01-02T03:04:05.000Z",
        sources: facts,
      }),
    ).toString("utf8"),
  );
  for (const char of ["­", "⁠", "؜", "﻿"]) {
    const reviewBytes = encoder.encode(
      JSON.stringify({
        ...validReview,
        reviewer: { ...validReview.reviewer, name: `Review${char}er` },
      }),
    );
    const result = validatePlanCoverageReview(
      reviewBytes,
      manifestBytes,
      facts,
    );
    assert.equal(result.ok, false, JSON.stringify(char));
    assert.equal(result.category, "malformed-artifact", JSON.stringify(char));
  }
});

test("Q24: repoPath is bounded by UTF-8 bytes, not UTF-16 code units", () => {
  // 400 three-byte-UTF-8 characters: 400 UTF-16 code units (well under 1024)
  // but 1200 UTF-8 bytes (over the 1024-byte bound).
  const manifestShape = baseManifestShape();
  manifestShape.reviewedSources[0].path = `specs/${"中".repeat(400)}.md`;
  assert.ok(manifestShape.reviewedSources[0].path.length < 1024);
  const result = validateGoalPlanManifest(
    encoder.encode(JSON.stringify(manifestShape)),
    new Map(),
  );
  assert.equal(result.ok, false);
  assert.equal(result.category, "malformed-artifact");
});

test("Q24: reviewer.name is bounded by UTF-8 bytes and by code points, and must equal itself trimmed", () => {
  const manifestBytes = testManifestInput();
  const manifestShape = JSON.parse(Buffer.from(manifestBytes).toString("utf8"));
  const declarationBytes = exportGoalPlanDeclaration(
    testDeclarationInput([
      {
        nodeRef: "node-a",
        storyRef: "specs/stories/EX-001-first",
        dependsOn: [],
      },
    ]),
  );
  const facts = new Map([
    [manifestShape.declaration.path, declarationBytes],
    [readinessA.path, readinessA.bytes],
  ]);
  const validReview = JSON.parse(
    Buffer.from(
      exportPlanCoverageReview({
        manifestBytes,
        reviewId: "00000000-0000-4000-8000-000000000008",
        conclusion: "approved",
        reviewer: { name: "Safe Reviewer", assurance: "self-asserted" },
        reviewedAt: "2026-01-02T03:04:05.000Z",
        sources: facts,
      }),
    ).toString("utf8"),
  );
  const cases = [
    ["257 ASCII characters", "a".repeat(257)],
    ["256 four-byte emoji code points (1024 bytes)", "\u{1F600}".repeat(256)],
    ["a trailing tab", "Reviewer\t"],
  ];
  for (const [label, name] of cases) {
    const reviewBytes = encoder.encode(
      JSON.stringify({
        ...validReview,
        reviewer: { ...validReview.reviewer, name },
      }),
    );
    const result = validatePlanCoverageReview(
      reviewBytes,
      manifestBytes,
      facts,
    );
    assert.equal(result.ok, false, label);
    assert.equal(result.category, "malformed-artifact", label);
  }
});

test("Q24: reviewedAt rejects an out-of-range calendar date or clock time, but accepts any three fractional digits", () => {
  const manifestBytes = testManifestInput();
  const manifestShape = JSON.parse(Buffer.from(manifestBytes).toString("utf8"));
  const declarationBytes = exportGoalPlanDeclaration(
    testDeclarationInput([
      {
        nodeRef: "node-a",
        storyRef: "specs/stories/EX-001-first",
        dependsOn: [],
      },
    ]),
  );
  const facts = new Map([
    [manifestShape.declaration.path, declarationBytes],
    [readinessA.path, readinessA.bytes],
  ]);
  const validReview = JSON.parse(
    Buffer.from(
      exportPlanCoverageReview({
        manifestBytes,
        reviewId: "00000000-0000-4000-8000-000000000009",
        conclusion: "approved",
        reviewer: { name: "Safe Reviewer", assurance: "self-asserted" },
        reviewedAt: "2026-01-02T03:04:05.123Z",
        sources: facts,
      }),
    ).toString("utf8"),
  );
  assert.equal(
    validatePlanCoverageReview(
      encoder.encode(JSON.stringify(validReview)),
      manifestBytes,
      facts,
    ).ok,
    true,
    "any three fractional digits, not only .000Z, must be accepted",
  );

  for (const reviewedAt of [
    "2026-02-30T00:00:00.000Z",
    "2026-01-01T24:00:00.000Z",
  ]) {
    const reviewBytes = encoder.encode(
      JSON.stringify({ ...validReview, reviewedAt }),
    );
    const result = validatePlanCoverageReview(
      reviewBytes,
      manifestBytes,
      facts,
    );
    assert.equal(result.ok, false, reviewedAt);
    assert.equal(result.category, "malformed-artifact", reviewedAt);
  }
});

test("Q24: a Manifest's total dependsOn edges are bounded at 10000 across all nodes", () => {
  const nodeCount = 11;
  const nodes = Array.from({ length: nodeCount }, (_, i) => ({
    nodeRef: `node-${String(i).padStart(3, "0")}`,
    storyRef: "specs/stories/EX-001-first",
    readinessContract: {
      path: "specs/stories/EX-001-first/readiness.json",
      sha256: "0".repeat(64),
    },
    dependsOn: Array.from(
      { length: 1000 },
      (_, j) => `dep-${String(j).padStart(4, "0")}`,
    ),
  }));
  const manifestShape = baseManifestShape();
  manifestShape.nodes = nodes;
  const result = validateGoalPlanManifest(
    encoder.encode(JSON.stringify(manifestShape)),
    new Map(),
  );
  assert.equal(result.ok, false);
  assert.equal(result.category, "malformed-artifact");
});

test("MEDIUM-1: a Declaration's total dependsOn edges are bounded at 10000 across all nodes", () => {
  const nodeCount = 11;
  const nodes = Array.from({ length: nodeCount }, (_, i) => ({
    nodeRef: `node-${String(i).padStart(3, "0")}`,
    storyRef: `s/${i}`,
    dependsOn: Array.from(
      { length: 1000 },
      (_, j) => `dep-${String(j).padStart(4, "0")}`,
    ),
  }));
  const declarationBytes = encoder.encode(
    JSON.stringify({
      schemaVersion: "1.0.0",
      plan: { id: "a", revision: 1 },
      nodes,
    }),
  );
  const result = validateGoalPlanDeclaration(declarationBytes);
  assert.equal(result.ok, false);
  assert.equal(result.category, "malformed-artifact");
});

test("MEDIUM-1: exportGoalPlanDeclaration rejects a Declaration whose total dependsOn edges exceed 10000", () => {
  const nodeCount = 11;
  const nodes = Array.from({ length: nodeCount }, (_, i) => ({
    nodeRef: `node-${String(i).padStart(3, "0")}`,
    storyRef: `s/${i}`,
    dependsOn: Array.from(
      { length: 1000 },
      (_, j) => `dep-${String(j).padStart(4, "0")}`,
    ),
  }));
  assert.throws(
    () =>
      exportGoalPlanDeclaration({
        planId: "a",
        revision: 1,
        nodes,
      }),
    (error) => error.category === "malformed-artifact",
  );
});

test("Q24: a Declaration is bounded to 1 MiB, stricter than the Manifest/Review 8 MiB bound", () => {
  const oversizedDeclaration = new Uint8Array(1024 * 1024 + 1);
  oversizedDeclaration.fill(0x20);
  const declarationResult = validateGoalPlanDeclaration(oversizedDeclaration);
  assert.equal(declarationResult.ok, false);
  assert.equal(declarationResult.category, "malformed-artifact");
  assert.match(declarationResult.message, /exceed/);

  // The same byte count is well under the Manifest's 8 MiB bound: it must
  // fail for a different reason (invalid JSON), not the size bound.
  const manifestResult = validateGoalPlanManifest(
    oversizedDeclaration,
    new Map(),
  );
  assert.equal(manifestResult.ok, false);
  assert.equal(manifestResult.category, "malformed-artifact");
  assert.doesNotMatch(manifestResult.message, /exceed/);
});

test("Q24: a Declaration's JSON nesting is bounded to depth 32, stricter than the Manifest/Review depth 128", () => {
  const innerDeclaration = JSON.stringify({
    schemaVersion: "1.0.0",
    plan: { id: "a", revision: 1 },
    nodes: [{ nodeRef: "n", storyRef: "s", dependsOn: [] }],
  });
  let nested = innerDeclaration;
  for (let i = 0; i < 33; i += 1) nested = `[${nested}]`;
  const nestedBytes = encoder.encode(nested);

  const declarationResult = validateGoalPlanDeclaration(nestedBytes);
  assert.equal(declarationResult.ok, false);
  assert.equal(declarationResult.category, "malformed-artifact");
  assert.match(declarationResult.message, /nesting/);

  // The identical 33-deep payload is well under the Manifest's 128-level
  // bound: it must fail for a different reason (the top level is an array,
  // not a Manifest object), not the nesting bound.
  const manifestResult = validateGoalPlanManifest(nestedBytes, new Map());
  assert.equal(manifestResult.ok, false);
  assert.doesNotMatch(manifestResult.message, /nesting/);
});
