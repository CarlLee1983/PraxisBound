import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { URL, fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";
import test from "node:test";

import {
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
    ["sources/requirements.md", bytes("sources/requirements.md")],
    ["sources/plan-input.json", bytes("sources/plan-input.json")],
    ["sources/readiness-contract.md", bytes("sources/readiness-contract.md")],
    ["sources/coverage-index.md", bytes("sources/coverage-index.md")],
  ]);
}

test("FP51-AC-007: published fixture digests are hashes of the version-controlled raw bytes", () => {
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
  for (const [identity, digest] of Object.entries(expected.sourceDigests)) {
    assert.equal(sha256(bytes(identity)), digest, identity);
  }
});

test("FP51-AC-007: every named fixture produces its published validator observation", () => {
  const expected = JSON.parse(
    new TextDecoder().decode(bytes("expected-observations.json")),
  );
  const facts = sourceFacts();

  for (const fixture of expected.artifacts) {
    const fixtureBytes = bytes(fixture.file);
    let result;
    if (fixture.artifact === "goal-plan-manifest") {
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
