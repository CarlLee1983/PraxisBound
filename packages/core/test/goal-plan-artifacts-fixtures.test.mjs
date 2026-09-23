import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { URL, fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";
import test from "node:test";

import {
  validateGoalPlanDeclaration,
  validateGoalPlanManifest,
  validatePlanCoverageReview,
} from "@praxisbound/core";

const fixtureRoot = fileURLToPath(
  new URL("./fixtures/goal-plan-artifacts/", import.meta.url),
);

function bytes(name) {
  return readFileSync(`${fixtureRoot}${name}`);
}

function sha256(bytesValue) {
  return createHash("sha256").update(bytesValue).digest("hex");
}

function sourceFacts() {
  return new Map([
    ["specs/plans/fixture-goal-plan.json", bytes("valid-declaration.json")],
    [
      "specs/stories/EX-001-first/readiness.json",
      bytes("sources/readiness-a.json"),
    ],
    [
      "specs/stories/EX-002-second/readiness.json",
      bytes("sources/readiness-b.json"),
    ],
    ["specs/decisions/ADR-001-example.md", bytes("sources/adr.md")],
    ["specs/features/example/spec.md", bytes("sources/spec.md")],
    [
      "specs/stories/EX-001-first/acceptance.md",
      bytes("sources/acceptance-a.md"),
    ],
    ["specs/stories/EX-001-first/story.md", bytes("sources/story-a.md")],
    [
      "specs/stories/EX-002-second/acceptance.md",
      bytes("sources/acceptance-b.md"),
    ],
    ["specs/stories/EX-002-second/story.md", bytes("sources/story-b.md")],
  ]);
}

test("R-008/AC-003: published fixture digests are hashes of the version-controlled raw bytes", () => {
  const expected = JSON.parse(
    new TextDecoder().decode(bytes("expected-observations.json")),
  );
  const artifactFiles = readdirSync(fixtureRoot, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(".json") &&
        entry.name !== "expected-observations.json",
    )
    .map((entry) => entry.name)
    .sort();

  assert.deepEqual(
    expected.artifacts.map((artifact) => artifact.file).sort(),
    artifactFiles,
    "every artifact fixture must have an observation entry",
  );
  for (const artifact of expected.artifacts) {
    assert.equal(sha256(bytes(artifact.file)), artifact.sha256, artifact.file);
  }

  const sourceFiles = readdirSync(fixtureRoot + "sources/")
    .map((name) => "sources/" + name)
    .sort();
  assert.deepEqual(
    Object.keys(expected.sourceDigests).sort(),
    sourceFiles,
    "every source fixture must have a published digest",
  );
  for (const [path, digest] of Object.entries(expected.sourceDigests)) {
    assert.equal(sha256(bytes(path)), digest, path);
  }
});

test("R-008/AC-003: every named fixture produces its published validator observation (topology, shape, and schema)", () => {
  const expected = JSON.parse(
    new TextDecoder().decode(bytes("expected-observations.json")),
  );

  for (const fixture of expected.artifacts) {
    const facts = sourceFacts();
    if (fixture.sourceOverrides !== undefined) {
      for (const [path, sourceFile] of Object.entries(
        fixture.sourceOverrides,
      )) {
        facts.set(path, bytes(sourceFile));
      }
    }
    const fixtureBytes = bytes(fixture.file);
    let result;
    if (fixture.artifact === "goal-plan-declaration") {
      result = validateGoalPlanDeclaration(fixtureBytes);
    } else if (fixture.artifact === "goal-plan-manifest") {
      result = validateGoalPlanManifest(fixtureBytes, facts);
    } else if (fixture.artifact === "plan-coverage-review") {
      assert.equal(typeof fixture.manifestFile, "string", fixture.file);
      result = validatePlanCoverageReview(
        fixtureBytes,
        bytes(fixture.manifestFile),
        facts,
      );
    } else {
      assert.fail(fixture.file + " declares an unknown artifact class");
    }

    assert.equal(result.ok, fixture.expected.ok, fixture.file);
    if (fixture.expected.category !== undefined)
      assert.equal(result.category, fixture.expected.category, fixture.file);
  }
});

test("R-008/AC-002: a Coverage Review's manifestSha256 must equal the digest of a different Manifest to be rejected", () => {
  const manifestBytes = bytes("valid-manifest.json");
  const otherManifestBytes = bytes("invalid-manifest-unsorted-nodes.json");
  const reviewShape = JSON.parse(
    new TextDecoder().decode(bytes("valid-coverage-review.json")),
  );
  const reviewBytes = Buffer.from(
    JSON.stringify({
      ...reviewShape,
      manifestSha256: sha256(otherManifestBytes),
    }),
  );
  const result = validatePlanCoverageReview(
    reviewBytes,
    manifestBytes,
    sourceFacts(),
  );
  assert.equal(result.ok, false);
  assert.equal(result.category, "approval-binding-mismatch");
});

test("R-008/AC-003: a Manifest schemaVersion of the retired numeric 1 is unsupported-schema", () => {
  const manifestShape = JSON.parse(
    new TextDecoder().decode(bytes("valid-manifest.json")),
  );
  const manifestBytes = Buffer.from(
    JSON.stringify({ ...manifestShape, schemaVersion: 1 }),
  );
  const result = validateGoalPlanManifest(manifestBytes, sourceFacts());
  assert.equal(result.ok, false);
  assert.equal(result.category, "unsupported-schema");
});
