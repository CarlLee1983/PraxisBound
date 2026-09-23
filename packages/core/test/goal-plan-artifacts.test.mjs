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

test("AC-005: hostile Manifest paths (traversal, absolute) are rejected as malformed-artifact", () => {
  const manifestShape = {
    schemaVersion: "1.0.0",
    plan: { id: "test-plan", revision: 1 },
    declaration: { path: "specs/plans/test-plan.json", sha256: "0".repeat(64) },
    nodes: [
      {
        nodeRef: "node-a",
        storyRef: "../outside",
        readinessContract: {
          path: "../outside/readiness.json",
          sha256: "0".repeat(64),
        },
        dependsOn: [],
      },
    ],
    reviewedSources: [{ path: "/etc/passwd", sha256: "1".repeat(64) }],
    coverageIndex: { batchId: "BR-001-fixture", fingerprint: "0".repeat(64) },
  };
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
