import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { URL, fileURLToPath } from "node:url";
import { TextDecoder, TextEncoder } from "node:util";
import test from "node:test";

import {
  exportGoalPlanManifest,
  exportPlanCoverageReview,
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

function fixtureSources() {
  return new Map([
    ["sources/requirements.md", bytes("sources/requirements.md")],
    ["sources/plan-input.json", bytes("sources/plan-input.json")],
    ["sources/readiness-contract.md", bytes("sources/readiness-contract.md")],
    ["sources/coverage-index.md", bytes("sources/coverage-index.md")],
  ]);
}

function jsonBytes(value) {
  return encoder.encode(JSON.stringify(value));
}

const testReadinessSource = {
  identity: "sources/test-readiness.md",
  bytes: encoder.encode("# Test readiness contract\n"),
};

function testNode(planNodeRef, readinessSource = testReadinessSource) {
  return {
    planNodeRef,
    storyRef: `story:${planNodeRef}`,
    readinessContract: {
      identity: readinessSource.identity,
      sha256: sha256(readinessSource.bytes),
    },
  };
}

function testManifest({
  nodes = [testNode("node-a")],
  edges = [],
  reviewedSources = [testReadinessSource],
  planId = "test-plan",
  revision = 1,
} = {}) {
  return exportGoalPlanManifest({
    planId,
    revision,
    nodes,
    edges,
    reviewedSources,
  });
}

function testReview(manifestBytes, options = {}) {
  return exportPlanCoverageReview({
    manifestBytes,
    reviewId: "test-review",
    coverageIndexIdentity: testReadinessSource.identity,
    conclusion: "approved",
    approvedBy: "Test Reviewer",
    approvedAt: "2025-01-02T03:04:05Z",
    sources: [testReadinessSource],
    ...options,
  });
}

test("FP51-AC-001: the valid v1 Manifest preserves source identities and exact raw-byte digests", () => {
  const manifestBytes = bytes("valid-manifest.json");
  const result = validateGoalPlanManifest(manifestBytes, fixtureSources());

  assert.equal(result.ok, true);
  assert.equal(result.manifest.schemaVersion, 1);
  assert.equal(result.manifest.planId, "fixture-goal-plan");
  assert.equal(result.manifest.revision, 1);
  assert.deepEqual(
    result.manifest.nodes.map((node) => node.planNodeRef),
    ["node-a", "node-b", "node-c"],
  );
  assert.equal(result.manifest.nodes[0].storyRef, "FP-57");
  assert.deepEqual(result.manifest.nodes[0].readinessContract, {
    identity: "sources/readiness-contract.md",
    sha256: sha256(bytes("sources/readiness-contract.md")),
  });
  assert.deepEqual(result.manifest.edges, [
    { from: "node-a", to: "node-b" },
    { from: "node-b", to: "node-c" },
  ]);
  assert.deepEqual(result.sourceDigests, [
    {
      identity: "sources/requirements.md",
      sha256: sha256(bytes("sources/requirements.md")),
    },
    {
      identity: "sources/plan-input.json",
      sha256: sha256(bytes("sources/plan-input.json")),
    },
    {
      identity: "sources/readiness-contract.md",
      sha256: sha256(bytes("sources/readiness-contract.md")),
    },
    {
      identity: "sources/coverage-index.md",
      sha256: sha256(bytes("sources/coverage-index.md")),
    },
  ]);
  assert.equal(result.manifestDigest, sha256(manifestBytes));
});

test("FP51-AC-002: a Coverage Review validates only with the exact Manifest and source bindings", () => {
  const manifestBytes = bytes("valid-manifest.json");
  const reviewBytes = bytes("valid-coverage-review.json");
  const result = validatePlanCoverageReview(
    reviewBytes,
    manifestBytes,
    fixtureSources(),
  );

  assert.equal(result.ok, true);
  assert.equal(result.review.schemaVersion, 1);
  assert.equal(result.review.reviewId, "fixture-coverage-review");
  assert.equal(
    result.review.coverageIndexIdentity,
    "sources/coverage-index.md",
  );
  assert.equal(result.review.conclusion, "approved");
  assert.equal(result.review.approvedBy, "Fixture Reviewer");
  assert.equal(result.review.approvedAt, "2025-01-02T03:04:05Z");
  assert.equal("approval" in result.review, false);
  assert.equal(result.manifestDigest, sha256(manifestBytes));
  assert.equal(result.reviewDigest, sha256(reviewBytes));
  assert.deepEqual(result.review.reviewedSources, result.sourceDigests);
});

test("FP51-AC-001: plan identity, revision, and Readiness Contract source binding are required", () => {
  const manifestBytes = testManifest();
  const manifestShape = JSON.parse(new TextDecoder().decode(manifestBytes));

  const wrongReadinessDigest = JSON.parse(JSON.stringify(manifestShape));
  wrongReadinessDigest.nodes[0].readinessContract.sha256 = "0".repeat(64);
  const readinessResult = validateGoalPlanManifest(
    jsonBytes(wrongReadinessDigest),
    [testReadinessSource],
  );
  assert.equal(readinessResult.ok, false);
  assert.equal(readinessResult.category, "digest-mismatch");
  assert.equal(readinessResult.path, "nodes[0].readinessContract.sha256");

  const invalidRevision = JSON.parse(JSON.stringify(manifestShape));
  invalidRevision.revision = 0;
  const revisionResult = validateGoalPlanManifest(jsonBytes(invalidRevision), [
    testReadinessSource,
  ]);
  assert.equal(revisionResult.ok, false);
  assert.equal(revisionResult.category, "malformed-artifact");
  assert.equal(revisionResult.path, "revision");
});

test("FP51-AC-002: Review requires approved metadata and a source-bound Coverage Index", () => {
  const manifestBytes = testManifest();
  const validReview = JSON.parse(
    new TextDecoder().decode(testReview(manifestBytes)),
  );
  const cases = [
    ["unapproved conclusion", { conclusion: "pending" }],
    ["non-canonical timestamp", { approvedAt: "2025-01-02T03:04:05+00:00" }],
    ["unbound coverage index", { coverageIndexIdentity: "unbound-index.md" }],
  ];

  for (const [label, change] of cases) {
    const result = validatePlanCoverageReview(
      jsonBytes({ ...validReview, ...change }),
      manifestBytes,
      [testReadinessSource],
    );
    assert.equal(result.ok, false, label);
    assert.equal(result.category, "approval-binding-mismatch", label);
    assert.equal("review" in result, false, label);
  }
});

test("FP51-AC-003: LF/CRLF, BOM, Unicode normalization, and JSON formatting are distinct source bytes", () => {
  const manifestBytes = bytes("valid-manifest.json");
  const originalSources = fixtureSources();
  const original = originalSources.get("sources/requirements.md");
  const originalJson = originalSources.get("sources/plan-input.json");

  const variants = [
    [
      "crlf",
      encoder.encode(new TextDecoder().decode(original).replace(/\n/g, "\r\n")),
      "sources/requirements.md",
    ],
    [
      "bom",
      new Uint8Array([0xef, 0xbb, 0xbf, ...original]),
      "sources/requirements.md",
    ],
    [
      "unicode-normalized",
      encoder.encode("# Fixture planning source\n\nCafé\n"),
      "sources/requirements.md",
    ],
    [
      "json-reformatted",
      encoder.encode(
        '{"goal":"fixture-goal","notes":["opaque planning input","formatting is part of the digest"]}\n',
      ),
      "sources/plan-input.json",
    ],
  ];
  const unicodeNfc = encoder.encode("# Fixture planning source\n\nCafé\n");
  const unicodeNfd = encoder.encode(
    "# Fixture planning source\n\nCafe\u0301\n",
  );
  assert.equal(
    new TextDecoder().decode(unicodeNfc).normalize("NFC"),
    new TextDecoder().decode(unicodeNfd).normalize("NFC"),
  );
  assert.notEqual(sha256(unicodeNfc), sha256(unicodeNfd));
  const digests = new Set();

  for (const [label, replacement, identity] of variants) {
    const next = new Map(originalSources);
    next.set(identity, replacement);
    const observed = sha256(replacement);
    digests.add(observed);
    assert.notEqual(
      observed,
      sha256(identity === "sources/requirements.md" ? original : originalJson),
      `${label} must change the raw-byte digest`,
    );
    const result = validateGoalPlanManifest(manifestBytes, next);
    assert.equal(result.ok, false, `${label} must invalidate the old binding`);
    assert.equal(result.category, "digest-mismatch");
    assert.equal("manifest" in result, false);
  }

  assert.equal(digests.size, variants.length);

  const unicodeSource = {
    identity: "sources/unicode.md",
    bytes: unicodeNfc,
  };
  const unicodeManifest = testManifest({
    nodes: [testNode("unicode-node", unicodeSource)],
    reviewedSources: [unicodeSource],
  });
  const unicodeReview = testReview(unicodeManifest, {
    coverageIndexIdentity: unicodeSource.identity,
    sources: [unicodeSource],
  });
  const normalizedSourceFacts = [
    { identity: unicodeSource.identity, bytes: unicodeNfd },
  ];
  const normalizedManifest = validateGoalPlanManifest(
    unicodeManifest,
    normalizedSourceFacts,
  );
  assert.equal(normalizedManifest.ok, false);
  assert.equal(normalizedManifest.category, "digest-mismatch");
  const normalizedReview = validatePlanCoverageReview(
    unicodeReview,
    unicodeManifest,
    normalizedSourceFacts,
  );
  assert.equal(normalizedReview.ok, false);
  assert.equal(normalizedReview.category, "digest-mismatch");

  const reviewBytes = bytes("valid-coverage-review.json");
  for (const [label, replacement, identity] of variants) {
    const changedSources = new Map(originalSources);
    changedSources.set(identity, replacement);
    const changedReview = validatePlanCoverageReview(
      reviewBytes,
      manifestBytes,
      changedSources,
    );
    assert.equal(
      changedReview.ok,
      false,
      `${label} must invalidate the Review`,
    );
    assert.equal(changedReview.category, "digest-mismatch", label);
  }

  const changedSources = new Map(originalSources);
  changedSources.set(
    "sources/requirements.md",
    new Uint8Array([0xef, 0xbb, 0xbf, ...original]),
  );

  const manifestShape = JSON.parse(new TextDecoder().decode(manifestBytes));
  const revisedManifestBytes = exportGoalPlanManifest({
    planId: manifestShape.planId,
    revision: manifestShape.revision,
    nodes: manifestShape.nodes,
    edges: manifestShape.edges,
    reviewedSources: [...changedSources].map(([identity, sourceBytes]) => ({
      identity,
      bytes: sourceBytes,
    })),
  });
  const revisedReviewBytes = exportPlanCoverageReview({
    manifestBytes: revisedManifestBytes,
    sources: changedSources,
    reviewId: "revised-fixture-review",
    coverageIndexIdentity: "sources/coverage-index.md",
    conclusion: "approved",
    approvedBy: "Fixture Reviewer",
    approvedAt: "2025-01-02T03:04:05Z",
  });
  assert.equal(
    validateGoalPlanManifest(revisedManifestBytes, changedSources).ok,
    true,
  );
  assert.equal(
    validatePlanCoverageReview(
      revisedReviewBytes,
      revisedManifestBytes,
      changedSources,
    ).ok,
    true,
    "new source bytes require new Manifest and Review bindings",
  );
});

test("FP51-AC-004: invalid topology is rejected without a repaired or partial plan", () => {
  const cases = [
    "invalid-topology-missing-node.json",
    "invalid-topology-duplicate-node.json",
    "invalid-topology-self-edge.json",
    "invalid-topology-cycle.json",
    "invalid-topology-duplicate-edge.json",
    "invalid-topology-missing-reference.json",
  ];

  for (const name of cases) {
    const result = validateGoalPlanManifest(bytes(name), new Map());
    assert.equal(result.ok, false, name);
    assert.equal(result.category, "invalid-topology", name);
    assert.equal("manifest" in result, false, name);
  }
});

test("FP51-AC-005: unsupported schema, malformed shape, digest, and approval failures are stable categories", () => {
  const sourceFacts = fixtureSources();
  const manifestBytes = bytes("valid-manifest.json");

  const unsupported = validateGoalPlanManifest(
    bytes("invalid-schema-manifest.json"),
    new Map(),
  );
  assert.equal(unsupported.ok, false);
  assert.equal(unsupported.category, "unsupported-schema");

  const malformed = validateGoalPlanManifest(
    bytes("invalid-malformed-manifest.json"),
    new Map(),
  );
  assert.equal(malformed.ok, false);
  assert.equal(malformed.category, "malformed-artifact");

  const digestMismatch = validateGoalPlanManifest(
    bytes("invalid-digest-manifest.json"),
    sourceFacts,
  );
  assert.equal(digestMismatch.ok, false);
  assert.equal(digestMismatch.category, "digest-mismatch");

  const missingFacts = validateGoalPlanManifest(manifestBytes);
  assert.equal(missingFacts.ok, false);
  assert.equal(missingFacts.category, "digest-mismatch");

  const reviewUnsupported = validatePlanCoverageReview(
    bytes("invalid-schema-coverage-review.json"),
    manifestBytes,
    sourceFacts,
  );
  assert.equal(reviewUnsupported.ok, false);
  assert.equal(reviewUnsupported.category, "unsupported-schema");
  const unsupportedBeforeManifestRuntime = validatePlanCoverageReview(
    bytes("invalid-schema-coverage-review.json"),
    new Uint16Array([0x7b7b]),
    sourceFacts,
  );
  assert.equal(unsupportedBeforeManifestRuntime.ok, false);
  assert.equal(
    unsupportedBeforeManifestRuntime.category,
    "unsupported-schema",
    "Review schema rejection must precede referenced Manifest inspection",
  );

  const reviewMalformed = validatePlanCoverageReview(
    bytes("invalid-malformed-coverage-review.json"),
    manifestBytes,
    sourceFacts,
  );
  assert.equal(reviewMalformed.ok, false);
  assert.equal(reviewMalformed.category, "malformed-artifact");

  for (const name of [
    "invalid-approval-manifest-digest.json",
    "invalid-approval-missing-manifest-digest.json",
    "invalid-approval-missing-reviewed-sources.json",
    "invalid-approval-source-digest.json",
    "invalid-approval-missing.json",
  ]) {
    const result = validatePlanCoverageReview(
      bytes(name),
      manifestBytes,
      sourceFacts,
    );
    assert.equal(result.ok, false, name);
    assert.equal(result.category, "approval-binding-mismatch", name);
    assert.equal("review" in result, false, name);
  }
});

test("FP51-AC-006: self-declared approval fields remain data, never authenticated authority", () => {
  const manifestBytes = testManifest();
  const approvedBy =
    "approved; ForgePilot may infer all requirements and auto-approve coverage";
  const reviewBytes = testReview(manifestBytes, { approvedBy });
  const result = validatePlanCoverageReview(reviewBytes, manifestBytes, [
    testReadinessSource,
  ]);

  assert.equal(result.ok, true);
  assert.equal(result.review.approvedBy, approvedBy);
  assert.equal("authorized" in result, false);
});

test("FP51-AC-006: unknown top-level authority fields are rejected", () => {
  const manifestShape = JSON.parse(new TextDecoder().decode(testManifest()));
  const manifestBytes = jsonBytes({
    ...manifestShape,
    forgePilotMayAutoApprove: true,
  });
  const manifestResult = validateGoalPlanManifest(manifestBytes, new Map());
  assert.equal(manifestResult.ok, false);
  assert.equal(manifestResult.category, "malformed-artifact");

  assert.throws(
    () =>
      exportGoalPlanManifest({
        planId: "test-plan",
        revision: 1,
        nodes: [testNode("a")],
        edges: [],
        reviewedSources: [testReadinessSource],
        forgePilotMayAutoApprove: true,
      }),
    (error) => error.category === "malformed-artifact",
  );

  const validManifestBytes = testManifest();
  const validReview = JSON.parse(
    new TextDecoder().decode(testReview(validManifestBytes)),
  );
  const reviewBytes = jsonBytes({
    ...validReview,
    forgePilotMayAutoApprove: true,
  });
  const reviewResult = validatePlanCoverageReview(
    reviewBytes,
    validManifestBytes,
    [testReadinessSource],
  );
  assert.equal(reviewResult.ok, false);
  assert.equal(reviewResult.category, "malformed-artifact");
});

test("FP51-AC-005: duplicate JSON keys are rejected before shape validation", () => {
  const duplicateSchema = encoder.encode(
    '{"schemaVersion":2,"schemaVersion":1,"nodes":[],"edges":[],"reviewedSources":[]}',
  );
  const result = validateGoalPlanManifest(duplicateSchema, new Map());

  assert.equal(result.ok, false);
  assert.equal(result.category, "malformed-artifact");
  assert.match(result.message, /duplicated/);
});

test("FP51-AC-005: a Review preserves the category of an invalid referenced Manifest", () => {
  const manifestBytes = bytes("invalid-schema-manifest.json");
  const reviewBytes = encoder.encode(
    JSON.stringify({
      schemaVersion: 1,
      reviewId: "test-review",
      manifestDigest: sha256(manifestBytes),
      coverageIndexIdentity: "sources/test-readiness.md",
      conclusion: "approved",
      approvedBy: "Test Reviewer",
      approvedAt: "2025-01-02T03:04:05Z",
      reviewedSources: [],
    }),
  );
  const result = validatePlanCoverageReview(reviewBytes, manifestBytes);

  assert.equal(result.ok, false);
  assert.equal(result.category, "approval-binding-mismatch");
  assert.equal(result.causeCategory, "unsupported-schema");
});

test("FP51-AC-005: source binding entries have a closed shape", () => {
  const manifestBytes = encoder.encode(
    JSON.stringify({
      schemaVersion: 1,
      planId: "test-plan",
      revision: 1,
      nodes: [testNode("a")],
      edges: [],
      reviewedSources: [
        {
          identity: "source.txt",
          sha256: "0".repeat(64),
          approved: true,
        },
      ],
    }),
  );
  const result = validateGoalPlanManifest(manifestBytes, new Map());

  assert.equal(result.ok, false);
  assert.equal(result.category, "malformed-artifact");
  assert.equal(result.path, "reviewedSources[0].approved");
});

test("FP51-AC-004: edge identity checks do not collide on embedded delimiters", () => {
  const manifestBytes = encoder.encode(
    JSON.stringify({
      schemaVersion: 1,
      planId: "test-plan",
      revision: 1,
      nodes: [
        testNode("a"),
        testNode("b\u0000c"),
        testNode("a\u0000b"),
        testNode("c"),
      ],
      edges: [
        { from: "a", to: "b\u0000c" },
        { from: "a\u0000b", to: "c" },
      ],
      reviewedSources: [
        {
          identity: testReadinessSource.identity,
          sha256: sha256(testReadinessSource.bytes),
        },
      ],
    }),
  );
  const result = validateGoalPlanManifest(manifestBytes, [testReadinessSource]);

  assert.equal(result.ok, true);
  assert.equal(result.manifest.edges.length, 2);
});

test("FP51-AC-005: oversized and deeply nested artifacts are rejected", () => {
  const oversized = new Uint8Array(8 * 1024 * 1024 + 1);
  oversized.fill(0x20);
  const oversizedResult = validateGoalPlanManifest(oversized, new Map());
  assert.equal(oversizedResult.ok, false);
  assert.equal(oversizedResult.category, "malformed-artifact");
  assert.match(oversizedResult.message, /exceed/);

  const manifestBytes = testManifest();
  const reviewBytes = testReview(manifestBytes);
  const oversizedManifestResult = validatePlanCoverageReview(
    reviewBytes,
    oversized,
    [testReadinessSource],
  );
  assert.equal(oversizedManifestResult.ok, false);
  assert.equal(oversizedManifestResult.category, "malformed-artifact");
  assert.match(oversizedManifestResult.message, /exceed/);
  assert.throws(
    () =>
      exportPlanCoverageReview({
        manifestBytes: oversized,
        reviewId: "oversized-manifest-review",
        coverageIndexIdentity: testReadinessSource.identity,
        conclusion: "approved",
        approvedBy: "Test Reviewer",
        approvedAt: "2025-01-02T03:04:05Z",
        sources: [testReadinessSource],
      }),
    (error) =>
      error.category === "malformed-artifact" && /exceed/.test(error.message),
  );

  let nested = "0";
  for (let index = 0; index < 129; index += 1) nested = `[${nested}]`;
  const deeplyNested = encoder.encode(
    JSON.stringify({
      schemaVersion: 1,
      planId: "test-plan",
      revision: 1,
      nodes: [{ ...testNode("a"), metadata: JSON.parse(nested) }],
      edges: [],
      reviewedSources: [
        {
          identity: testReadinessSource.identity,
          sha256: sha256(testReadinessSource.bytes),
        },
      ],
    }),
  );
  const deepResult = validateGoalPlanManifest(deeplyNested, [
    testReadinessSource,
  ]);
  assert.equal(deepResult.ok, false);
  assert.equal(deepResult.category, "malformed-artifact");
});

test("FP51-AC-005: malformed runtime byte and source inputs return stable failures", () => {
  const fakeBytes = Object.create(Uint8Array.prototype);
  const malformedManifest = validateGoalPlanManifest(fakeBytes);
  assert.equal(malformedManifest.ok, false);
  assert.equal(malformedManifest.category, "malformed-artifact");
  const nonByteView = validateGoalPlanManifest(new Uint16Array([0x7b7b]));
  assert.equal(nonByteView.ok, false);
  assert.equal(nonByteView.category, "malformed-artifact");
  assert.equal(nonByteView.message, "artifact bytes must be a Uint8Array");

  const manifestBytes = testManifest();
  const reviewBytes = testReview(manifestBytes);
  const malformedReviewBytes = validatePlanCoverageReview(
    fakeBytes,
    manifestBytes,
  );
  assert.equal(malformedReviewBytes.ok, false);
  assert.equal(malformedReviewBytes.category, "malformed-artifact");
  const malformedManifestBytes = validatePlanCoverageReview(
    reviewBytes,
    fakeBytes,
  );
  assert.equal(malformedManifestBytes.ok, false);
  assert.equal(malformedManifestBytes.category, "malformed-artifact");
  const nonByteManifest = validatePlanCoverageReview(
    reviewBytes,
    new Uint16Array([0x7b7b]),
  );
  assert.equal(nonByteManifest.ok, false);
  assert.equal(nonByteManifest.category, "malformed-artifact");
  assert.equal(
    nonByteManifest.message,
    "supplied Manifest bytes must be a Uint8Array",
  );

  const malformedSourceFacts = validateGoalPlanManifest(manifestBytes, [
    { identity: testReadinessSource.identity, bytes: fakeBytes },
  ]);
  assert.equal(malformedSourceFacts.ok, false);
  assert.equal(malformedSourceFacts.category, "malformed-artifact");
  const nonByteSource = validateGoalPlanManifest(manifestBytes, [
    {
      identity: testReadinessSource.identity,
      bytes: new Uint16Array([0x7b7b]),
    },
  ]);
  assert.equal(nonByteSource.ok, false);
  assert.equal(nonByteSource.category, "malformed-artifact");
  assert.match(nonByteSource.message, /must be a Uint8Array/);
  assert.throws(
    () =>
      testManifest({
        reviewedSources: [{ identity: "spoofed.txt", bytes: fakeBytes }],
      }),
    (error) => error.category === "malformed-artifact",
  );

  const throwingSource = Object.defineProperty({}, "identity", {
    get() {
      throw new Error("caller getter failed");
    },
  });
  const malformedGetter = validateGoalPlanManifest(manifestBytes, [
    throwingSource,
  ]);
  assert.equal(malformedGetter.ok, false);
  assert.equal(malformedGetter.category, "malformed-artifact");
  assert.throws(
    () =>
      exportGoalPlanManifest({
        planId: "getter-plan",
        revision: 1,
        nodes: [testNode("node")],
        edges: [],
        reviewedSources: [throwingSource],
      }),
    (error) => error.category === "malformed-artifact",
  );
});

test("FP51-AC-003/005: validation binds one byte snapshot despite mutating source-fact getters", () => {
  const manifestBytes = testManifest();
  const originalManifestDigest = sha256(manifestBytes);
  const changedManifestBytes = encoder.encode(
    new TextDecoder()
      .decode(manifestBytes)
      .replace('"planId":"test-plan"', '"planId":"evil-plan"'),
  );
  assert.equal(changedManifestBytes.byteLength, manifestBytes.byteLength);

  const manifestSources = {};
  Object.defineProperty(manifestSources, testReadinessSource.identity, {
    enumerable: true,
    get() {
      manifestBytes.set(changedManifestBytes);
      return testReadinessSource.bytes;
    },
  });
  const manifestResult = validateGoalPlanManifest(
    manifestBytes,
    manifestSources,
  );
  assert.equal(manifestResult.ok, true);
  assert.equal(manifestResult.manifest.planId, "test-plan");
  assert.equal(manifestResult.manifestDigest, originalManifestDigest);
  assert.equal(sha256(manifestBytes), sha256(changedManifestBytes));

  const reviewManifestBytes = testManifest();
  const reviewBytes = testReview(reviewManifestBytes);
  const originalReviewManifestDigest = sha256(reviewManifestBytes);
  const originalReviewDigest = sha256(reviewBytes);
  const changedReviewManifestBytes = encoder.encode(
    new TextDecoder()
      .decode(reviewManifestBytes)
      .replace('"planId":"test-plan"', '"planId":"evil-plan"'),
  );
  const changedReviewBytes = encoder.encode(
    new TextDecoder()
      .decode(reviewBytes)
      .replace('"reviewId":"test-review"', '"reviewId":"evil-review"'),
  );
  assert.equal(
    changedReviewManifestBytes.byteLength,
    reviewManifestBytes.byteLength,
  );
  assert.equal(changedReviewBytes.byteLength, reviewBytes.byteLength);

  const reviewSources = {};
  Object.defineProperty(reviewSources, testReadinessSource.identity, {
    enumerable: true,
    get() {
      reviewManifestBytes.set(changedReviewManifestBytes);
      reviewBytes.set(changedReviewBytes);
      return testReadinessSource.bytes;
    },
  });
  const reviewResult = validatePlanCoverageReview(
    reviewBytes,
    reviewManifestBytes,
    reviewSources,
  );
  assert.equal(reviewResult.ok, true);
  assert.equal(reviewResult.review.reviewId, "test-review");
  assert.equal(reviewResult.reviewDigest, originalReviewDigest);
  assert.equal(reviewResult.manifestDigest, originalReviewManifestDigest);
  assert.equal(sha256(reviewManifestBytes), sha256(changedReviewManifestBytes));
  assert.equal(sha256(reviewBytes), sha256(changedReviewBytes));
});

test("FP51-AC-001: the exporter round-trips exact source bytes", () => {
  const sourceBytes = encoder.encode("raw source\r\n");
  const source = { identity: "source.txt", bytes: sourceBytes };
  const manifestBytes = testManifest({
    nodes: [testNode("a", source)],
    reviewedSources: [source],
  });
  const result = validateGoalPlanManifest(
    manifestBytes,
    new Map([["source.txt", sourceBytes]]),
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.sourceDigests, [
    { identity: "source.txt", sha256: sha256(sourceBytes) },
  ]);
});

test("FP51-AC-003: changing Manifest bytes invalidates an old Coverage Review binding", () => {
  const manifestBytes = bytes("valid-manifest.json");
  const reviewBytes = bytes("valid-coverage-review.json");
  const reformatted = jsonBytes(
    JSON.parse(new TextDecoder().decode(manifestBytes)),
  );

  assert.notEqual(sha256(reformatted), sha256(manifestBytes));
  const result = validatePlanCoverageReview(
    reviewBytes,
    reformatted,
    fixtureSources(),
  );
  assert.equal(result.ok, false);
  assert.equal(result.category, "approval-binding-mismatch");
});
