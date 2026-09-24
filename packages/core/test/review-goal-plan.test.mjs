import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { URL, fileURLToPath } from "node:url";
import test from "node:test";

import {
  deriveGoalPlanReviewId,
  projectGoalPlan,
  toGoalPlanReviewedAt,
  validateGoalPlanDeclaration,
  validateGoalPlanManifest,
  validatePlanCoverageReview,
} from "@praxisbound/core";

const fixtureRoot = fileURLToPath(
  new URL("./fixtures/goal-plan-artifacts/sources/", import.meta.url),
);

function bytes(name) {
  return readFileSync(`${fixtureRoot}${name}`);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

const batchJsonBytes = Buffer.from(
  '{"schemaVersion":"1.0.0","batchId":"BR-001-goal-plan-fixture","adrs":["specs/decisions/ADR-001-example.md"],"specs":["specs/features/example/spec.md"],"stories":["specs/stories/EX-001-first","specs/stories/EX-002-second"]}\n',
  "utf8",
);

function goldenInput() {
  return {
    planId: "BR-001-goal-plan-fixture-abc123456789",
    batchId: "BR-001-goal-plan-fixture",
    fingerprint: sha256("fixture-fingerprint"),
    batchJson: {
      path: "specs/batches/BR-001-goal-plan-fixture/batch.json",
      bytes: batchJsonBytes,
    },
    adrs: [
      { path: "specs/decisions/ADR-001-example.md", bytes: bytes("adr.md") },
    ],
    specs: [
      { path: "specs/features/example/spec.md", bytes: bytes("spec.md") },
    ],
    stories: [
      {
        nodeRef: "EX-002-second",
        storyRef: "specs/stories/EX-002-second",
        dependsOn: ["EX-001-first"],
        readiness: {
          path: "specs/stories/EX-002-second/readiness.json",
          bytes: bytes("readiness-b.json"),
        },
        storyMd: {
          path: "specs/stories/EX-002-second/story.md",
          bytes: bytes("story-b.md"),
        },
        acceptanceMd: {
          path: "specs/stories/EX-002-second/acceptance.md",
          bytes: bytes("acceptance-b.md"),
        },
      },
      {
        nodeRef: "EX-001-first",
        storyRef: "specs/stories/EX-001-first",
        dependsOn: [],
        readiness: {
          path: "specs/stories/EX-001-first/readiness.json",
          bytes: bytes("readiness-a.json"),
        },
        storyMd: {
          path: "specs/stories/EX-001-first/story.md",
          bytes: bytes("story-a.md"),
        },
        acceptanceMd: {
          path: "specs/stories/EX-001-first/acceptance.md",
          bytes: bytes("acceptance-a.md"),
        },
      },
    ],
    confirmation: {
      // Non-ASCII, on purpose (AC-002: unescaped non-ASCII in the exported
      // reviewer.name — this path text flows straight into it).
      path: "specs/batches/BR-001-goal-plan-fixture/records/confirmation-abcdef123456-測試.json",
      bytes: Buffer.from('{"claim":"explicit-terminal-confirmation"}', "utf8"),
      confirmedAt: "2026-09-24T01:02:03.456789Z",
    },
  };
}

test("golden-goal-plan-fixture/AC-002: byte-identical-artifacts — declaration node/dependsOn order, storyRef/nodeRef, readinessContract, reviewedSources order, coverageIndex, reviewId, reviewer, reviewedAt, two-space indent, trailing newline, unescaped non-ASCII", () => {
  const input = goldenInput();
  const result = projectGoalPlan(input);
  assert.equal(result.ok, true, result.ok ? undefined : result.message);

  assert.equal(
    result.directory,
    "specs/batches/BR-001-goal-plan-fixture/goal-plan/BR-001-goal-plan-fixture-abc123456789",
  );

  // Every artifact ends with exactly one trailing newline and never a CRLF.
  for (const artifactBytes of [
    result.declaration,
    result.manifest,
    result.coverageReview,
  ]) {
    const text = Buffer.from(artifactBytes).toString("utf8");
    assert.match(text, /\n$/);
    assert.doesNotMatch(text, /\n\n$/);
    assert.doesNotMatch(text, /\r/);
  }

  const declaration = JSON.parse(
    Buffer.from(result.declaration).toString("utf8"),
  );
  assert.deepEqual(declaration, {
    schemaVersion: "1.0.0",
    plan: { id: input.planId, revision: 1 },
    nodes: [
      {
        nodeRef: "EX-001-first",
        storyRef: "specs/stories/EX-001-first",
        dependsOn: [],
      },
      {
        nodeRef: "EX-002-second",
        storyRef: "specs/stories/EX-002-second",
        dependsOn: ["EX-001-first"],
      },
    ],
  });
  assert.equal(
    Buffer.from(result.declaration).toString("utf8"),
    `${JSON.stringify(declaration, null, 2)}\n`,
    "two-space indentation, exactly as JSON.stringify(x, null, 2) produces",
  );
  assert.equal(validateGoalPlanDeclaration(result.declaration).ok, true);

  const manifest = JSON.parse(Buffer.from(result.manifest).toString("utf8"));
  assert.equal(manifest.schemaVersion, "1.0.0");
  assert.deepEqual(manifest.plan, { id: input.planId, revision: 1 });
  assert.deepEqual(manifest.declaration, {
    path: `${result.directory}/declaration.json`,
    sha256: sha256(result.declaration),
  });
  assert.deepEqual(
    manifest.nodes.map((node) => node.nodeRef),
    ["EX-001-first", "EX-002-second"],
    "Manifest nodes sorted by UTF-8 node reference",
  );
  assert.deepEqual(manifest.nodes[1].dependsOn, ["EX-001-first"]);
  assert.deepEqual(manifest.nodes[0].readinessContract, {
    path: "specs/stories/EX-001-first/readiness.json",
    sha256: sha256(bytes("readiness-a.json")),
  });
  assert.deepEqual(
    manifest.reviewedSources.map((source) => source.path),
    [
      "specs/batches/BR-001-goal-plan-fixture/batch.json",
      "specs/batches/BR-001-goal-plan-fixture/goal-plan/BR-001-goal-plan-fixture-abc123456789/declaration.json",
      "specs/decisions/ADR-001-example.md",
      "specs/features/example/spec.md",
      "specs/stories/EX-001-first/acceptance.md",
      "specs/stories/EX-001-first/readiness.json",
      "specs/stories/EX-001-first/story.md",
      "specs/stories/EX-002-second/acceptance.md",
      "specs/stories/EX-002-second/readiness.json",
      "specs/stories/EX-002-second/story.md",
    ].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))),
    "reviewedSources sorted by UTF-8 path bytes",
  );
  assert.deepEqual(manifest.coverageIndex, {
    batchId: input.batchId,
    fingerprint: input.fingerprint,
  });
  assert.equal(
    Buffer.from(result.manifest).toString("utf8"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  const review = JSON.parse(
    Buffer.from(result.coverageReview).toString("utf8"),
  );
  assert.equal(review.schemaVersion, "1.0.0");
  assert.equal(
    review.reviewId,
    deriveGoalPlanReviewId(sha256(input.confirmation.bytes)),
  );
  assert.match(
    review.reviewId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  assert.equal(review.manifestSha256, sha256(result.manifest));
  assert.deepEqual(review.reviewedSources, manifest.reviewedSources);
  assert.deepEqual(review.coverageIndex, manifest.coverageIndex);
  assert.equal(review.conclusion, "approved");
  assert.deepEqual(review.reviewer, {
    name: `PraxisBound Definition Confirmation ${input.confirmation.path}`,
    assurance: "self-asserted",
  });
  assert.ok(
    review.reviewer.name.includes("測試"),
    "non-ASCII text in the confirmation path is carried through unescaped",
  );
  assert.ok(
    Buffer.from(result.coverageReview).toString("utf8").includes("測試"),
    "the exported bytes contain the raw UTF-8 characters, not a \\u escape",
  );
  assert.equal(
    review.reviewedAt,
    toGoalPlanReviewedAt(input.confirmation.confirmedAt),
  );
  assert.equal(review.reviewedAt, "2026-09-24T01:02:03.456Z");
  assert.equal(
    Buffer.from(result.coverageReview).toString("utf8"),
    `${JSON.stringify(review, null, 2)}\n`,
  );

  // Full binding re-check with every reviewedSources byte actually supplied.
  const fullSources = new Map();
  fullSources.set(input.batchJson.path, input.batchJson.bytes);
  for (const adr of input.adrs) fullSources.set(adr.path, adr.bytes);
  for (const spec of input.specs) fullSources.set(spec.path, spec.bytes);
  for (const story of input.stories) {
    fullSources.set(story.storyMd.path, story.storyMd.bytes);
    fullSources.set(story.acceptanceMd.path, story.acceptanceMd.bytes);
    fullSources.set(story.readiness.path, story.readiness.bytes);
  }
  fullSources.set(`${result.directory}/declaration.json`, result.declaration);

  const manifestValidation = validateGoalPlanManifest(
    result.manifest,
    fullSources,
  );
  assert.equal(
    manifestValidation.ok,
    true,
    manifestValidation.ok ? undefined : manifestValidation.message,
  );
  const reviewValidation = validatePlanCoverageReview(
    result.coverageReview,
    result.manifest,
    fullSources,
  );
  assert.equal(
    reviewValidation.ok,
    true,
    reviewValidation.ok ? undefined : reviewValidation.message,
  );
});

test("R4: projecting the same input twice yields identical bytes (no clock, env, or git read)", () => {
  const input = goldenInput();
  const first = projectGoalPlan(input);
  const second = projectGoalPlan(goldenInput());
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.deepEqual(first.declaration, second.declaration);
  assert.deepEqual(first.manifest, second.manifest);
  assert.deepEqual(first.coverageReview, second.coverageReview);
});

test("a projection that would fail its own TST-029 validator returns ok:false instead of bytes", () => {
  const input = goldenInput();
  // An invalid nodeRef (empty string) makes the exported Declaration invalid,
  // which the exporter's own self-validation catches before any bytes
  // would be returned to a caller.
  input.stories[0] = { ...input.stories[0], nodeRef: "" };
  const result = projectGoalPlan(input);
  assert.equal(result.ok, false);
  assert.equal(typeof result.message, "string");
});

test("deriveGoalPlanReviewId forces the UUIDv4 version/variant nibbles", () => {
  const id = deriveGoalPlanReviewId(sha256("anything"));
  assert.match(
    id,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
});

test("toGoalPlanReviewedAt pads and truncates to exactly three fractional-second digits", () => {
  assert.equal(
    toGoalPlanReviewedAt("2026-09-24T01:02:03Z"),
    "2026-09-24T01:02:03.000Z",
  );
  assert.equal(
    toGoalPlanReviewedAt("2026-09-24T01:02:03.5Z"),
    "2026-09-24T01:02:03.500Z",
  );
  assert.equal(
    toGoalPlanReviewedAt("2026-09-24T01:02:03.123456789Z"),
    "2026-09-24T01:02:03.123Z",
  );
});
