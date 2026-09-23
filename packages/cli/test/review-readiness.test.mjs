import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  readdir,
  readFile,
  rename as nodeRename,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { validateResultEnvelope } from "@praxisbound/core";

import { runReviewIndex, runReviewRender } from "../dist/review.js";
import {
  renderReviewPreflightHuman,
  runReviewPreflight,
} from "../dist/review-preflight.js";
import { runReviewReadinessDigests } from "../dist/review-readiness-digests.js";

import {
  baseFixtureFiles,
  baseManifest,
  cleanupWorkspace,
  fixtureRepo,
  indexData,
  sha256Hex,
  writeBatch,
  workspace,
} from "./review-import-respond-support.mjs";

const READY_STORY_TEXT = `# Story: RF-001 Fixture

## Goal

Check minimum Story content.

## Scope

* Check this fixture.

## Classification

* Security sensitive: no
* Baseline conformance: no
* Task mode: execution

## Authority

* plan: yes
* modify: yes
* add_dependency: no
* migration: no
* commit: no
* push: no
* deploy: no
`;

const READY_ACCEPTANCE_TEXT = `# Acceptance Criteria

## Happy Path

* [ ] AC-001: The fixture is ready.

## Acceptance Evidence

| AC | Method | Evidence | Fixture / precondition | Expected observation |
| --- | --- | --- | --- | --- |
| \`AC-001\` | test | \`test\` | \`fixture\` | \`pass\` |
`;

function readyFixtureFiles() {
  return {
    ...baseFixtureFiles(),
    "specs/stories/RF-001-fixture/story.md": READY_STORY_TEXT,
    "specs/stories/RF-001-fixture/acceptance.md": READY_ACCEPTANCE_TEXT,
  };
}

function validReadiness(overrides = {}) {
  return {
    schema_version: 1,
    story_ref: "specs/stories/RF-001-fixture",
    story_md_digest: `sha256:${sha256Hex(READY_STORY_TEXT)}`,
    acceptance_md_digest: `sha256:${sha256Hex(READY_ACCEPTANCE_TEXT)}`,
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

async function readyFixtureRepoWithReadiness(batchId, readiness) {
  const files = { ...readyFixtureFiles() };
  if (readiness !== undefined) {
    files["specs/stories/RF-001-fixture/readiness.json"] = JSON.stringify(
      readiness,
      null,
      2,
    );
  }
  return fixtureRepo(batchId, files, baseManifest(batchId));
}

function twoStoryFiles(readinessA, readinessB) {
  const files = { ...readyFixtureFiles() };
  files["specs/stories/RF-002-fixture/story.md"] = READY_STORY_TEXT;
  files["specs/stories/RF-002-fixture/acceptance.md"] = READY_ACCEPTANCE_TEXT;
  if (readinessA !== undefined)
    files["specs/stories/RF-001-fixture/readiness.json"] = JSON.stringify(
      readinessA,
      null,
      2,
    );
  if (readinessB !== undefined)
    files["specs/stories/RF-002-fixture/readiness.json"] = JSON.stringify(
      readinessB,
      null,
      2,
    );
  return files;
}

function twoStoryManifest(batchId) {
  const base = baseManifest(batchId);
  return {
    ...base,
    sources: {
      ...base.sources,
      stories: [...base.sources.stories, "specs/stories/RF-002-fixture"],
    },
  };
}

async function writeConfirmation(root, batchId, data) {
  const record = {
    schemaVersion: "1.0.0",
    claim: "explicit-terminal-confirmation",
    batchId,
    fingerprint: data.fingerprint,
    manifestSha256: data.manifestSha256,
    sources: data.sources,
    confirmedAt: "2026-09-01T00:00:00Z",
    deferred: [],
    revisionSheets: [],
  };
  const recordsDir = join(root, "specs", "batches", batchId, "records");
  await mkdir(recordsDir, { recursive: true });
  const fp12 = record.fingerprint.slice(0, 12);
  await writeFile(
    join(recordsDir, `confirmation-${fp12}.json`),
    JSON.stringify(record),
  );
}

function noneCategories() {
  const none = { result: "none" };
  return {
    "missing-split": none,
    contradiction: none,
    "insufficient-acceptance": none,
    "open-question": none,
  };
}

async function writeSemanticReport(root, batchId, fingerprint) {
  const text = JSON.stringify({
    schemaVersion: "1.0.0",
    batchId,
    fingerprint,
    agent: "test-agent 1.0",
    observedAt: "2026-09-01T00:00:00Z",
    stories: [{ story: "RF-001", categories: noneCategories() }],
  });
  await writeFile(join(root, "semantic-report.json"), text);
  return "semantic-report.json";
}

async function run(root, args) {
  const execution = await runReviewPreflight(args, root);
  assert.deepEqual(validateResultEnvelope(execution.result), {
    ok: true,
    value: execution.result,
  });
  return execution;
}

function codesOf(execution) {
  return execution.result.issues.map((entry) => entry.code);
}

test("AC-001: review index lists a present readiness.json as a source and the fingerprint covers it", async () => {
  const batchId = "TST-9901-readiness";
  const { root, manifestPath } = await readyFixtureRepoWithReadiness(
    batchId,
    validReadiness(),
  );
  try {
    const data = await indexData(root, manifestPath);
    const readinessSource = data.sources.find(
      (source) => source.path === "specs/stories/RF-001-fixture/readiness.json",
    );
    assert.notEqual(readinessSource, undefined);
    assert.match(readinessSource.sha256, /^[a-f0-9]{64}$/);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("AC-001: review render shows a present readiness.json verbatim with its Story", async () => {
  const batchId = "TST-9902-readiness";
  const { root, manifestPath } = await readyFixtureRepoWithReadiness(
    batchId,
    validReadiness(),
  );
  try {
    const execution = await runReviewRender(
      [manifestPath, "--output", "review.html", "--json"],
      root,
    );
    assert.equal(execution.result.outcome, "success");
    const html = await readFile(join(root, "review.html"), "utf8");
    assert.match(html, /Readiness Sidecar/);
    assert.match(html, /runner_worker/);
    assert.match(html, /readiness\.json/);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("AC-001: a confirmed batch with a valid current Sidecar and Semantic Report yields REVIEW_READY", async () => {
  const batchId = "TST-9903-readiness";
  const { root, manifestPath } = await readyFixtureRepoWithReadiness(
    batchId,
    validReadiness(),
  );
  try {
    const data = await indexData(root, manifestPath);
    await writeConfirmation(root, batchId, data);
    const reportName = await writeSemanticReport(
      root,
      batchId,
      data.fingerprint,
    );
    const execution = await run(root, [
      manifestPath,
      "--semantic-report",
      reportName,
      "--json",
    ]);
    assert.equal(execution.result.outcome, "REVIEW_READY");
  } finally {
    await cleanupWorkspace(root);
  }
});

test("AC-002: readiness-digests rewrites only stale digests, leaves current ones unwritten, and reports updated paths", async () => {
  const batchId = "TST-9904-readiness";
  const stale = validReadiness({
    story_md_digest: `sha256:${"0".repeat(64)}`,
  });
  const { root, manifestPath } = await readyFixtureRepoWithReadiness(
    batchId,
    stale,
  );
  try {
    const before = await indexData(root, manifestPath);
    await writeConfirmation(root, batchId, before);

    const execution = await runReviewReadinessDigests(
      [manifestPath, "--json"],
      root,
    );
    assert.equal(execution.result.outcome, "success");
    assert.deepEqual(execution.result.data.updated, [
      "specs/stories/RF-001-fixture/readiness.json",
    ]);

    const rewrittenText = await readFile(
      join(root, "specs/stories/RF-001-fixture/readiness.json"),
      "utf8",
    );
    assert.equal(rewrittenText.endsWith("\n"), true);
    assert.equal(rewrittenText.endsWith("\n\n"), false);
    const rewritten = JSON.parse(rewrittenText);
    assert.equal(
      rewritten.story_md_digest,
      `sha256:${sha256Hex(READY_STORY_TEXT)}`,
    );
    assert.equal(
      rewritten.acceptance_md_digest,
      `sha256:${sha256Hex(READY_ACCEPTANCE_TEXT)}`,
    );
    // Every other field is unchanged, including key order.
    assert.deepEqual(Object.keys(rewritten), Object.keys(stale));
    assert.deepEqual(rewritten.criteria, stale.criteria);

    // A second run: digests already match, nothing to rewrite.
    const second = await runReviewReadinessDigests(
      [manifestPath, "--json"],
      root,
    );
    assert.equal(second.result.outcome, "success");
    assert.deepEqual(second.result.data.updated, []);

    // The fingerprint changed, so the earlier confirmation is now stale.
    const reportName = await writeSemanticReport(
      root,
      batchId,
      before.fingerprint,
    );
    const preflight = await run(root, [
      manifestPath,
      "--semantic-report",
      reportName,
      "--json",
    ]);
    assert.equal(preflight.result.outcome, "REVIEW_STALE");
    assert.ok(codesOf(preflight).includes("REVIEW_CONFIRMATION_STALE"));
  } finally {
    await cleanupWorkspace(root);
  }
});

test("AC-002/AC-004: readiness-digests fails and writes nothing when any Sidecar is invalid", async () => {
  const batchId = "TST-9905-readiness";
  const invalid = { ...validReadiness(), story_ref: "specs/stories/wrong" };
  const { root, manifestPath } = await readyFixtureRepoWithReadiness(
    batchId,
    invalid,
  );
  try {
    const before = await readFile(
      join(root, "specs/stories/RF-001-fixture/readiness.json"),
      "utf8",
    );
    const execution = await runReviewReadinessDigests(
      [manifestPath, "--json"],
      root,
    );
    assert.equal(execution.result.outcome, "failure");
    assert.ok(codesOf(execution).includes("REVIEW_READINESS_INVALID"));
    const after = await readFile(
      join(root, "specs/stories/RF-001-fixture/readiness.json"),
      "utf8",
    );
    assert.equal(after, before);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("AC-003: preflight blocks with REVIEW_READINESS_CRITERIA_MISMATCH for criteria that differ from the AC ids", async () => {
  const batchId = "TST-9906-readiness";
  const mismatched = validReadiness({
    criteria: [
      {
        id: "AC-002",
        operations: ["plan"],
        owner: "runner_worker",
        future_identities: [],
      },
    ],
  });
  const { root, manifestPath } = await readyFixtureRepoWithReadiness(
    batchId,
    mismatched,
  );
  try {
    const execution = await run(root, [manifestPath, "--json"]);
    assert.equal(execution.result.outcome, "REVIEW_BLOCKED");
    assert.ok(
      codesOf(execution).includes("REVIEW_READINESS_CRITERIA_MISMATCH"),
    );
  } finally {
    await cleanupWorkspace(root);
  }
});

test("AC-004: a schema-invalid Sidecar yields REVIEW_BLOCKED with REVIEW_READINESS_INVALID", async () => {
  const batchId = "TST-9907-readiness";
  const invalid = { ...validReadiness(), unknown_field: true };
  const { root, manifestPath } = await readyFixtureRepoWithReadiness(
    batchId,
    invalid,
  );
  try {
    const execution = await run(root, [manifestPath, "--json"]);
    assert.equal(execution.result.outcome, "REVIEW_BLOCKED");
    assert.ok(codesOf(execution).includes("REVIEW_READINESS_INVALID"));
  } finally {
    await cleanupWorkspace(root);
  }
});

test("AC-004/Security: an over-limit readiness.json (1048577 bytes) yields REVIEW_INCOMPLETE with REVIEW_INPUT_TOO_LARGE, and readiness-digests writes nothing", async () => {
  const batchId = "TST-9908-readiness";
  const oversized = validReadiness({
    decision_follow_ups: [
      {
        gate_id: "gate",
        choice: "x".repeat(1024 * 1024 + 10),
        follow_up_story_ref: "specs/stories/RF-001-fixture",
      },
    ],
  });
  const { root, manifestPath } = await readyFixtureRepoWithReadiness(
    batchId,
    oversized,
  );
  try {
    const before = await readFile(
      join(root, "specs/stories/RF-001-fixture/readiness.json"),
      "utf8",
    );
    const execution = await run(root, [manifestPath, "--json"]);
    assert.equal(execution.result.outcome, "REVIEW_INCOMPLETE");
    assert.ok(codesOf(execution).includes("REVIEW_INPUT_TOO_LARGE"));

    const digests = await runReviewReadinessDigests(
      [manifestPath, "--json"],
      root,
    );
    assert.equal(digests.result.outcome, "failure");
    const after = await readFile(
      join(root, "specs/stories/RF-001-fixture/readiness.json"),
      "utf8",
    );
    assert.equal(after, before);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("AC-005: a batch without any Sidecar has no readiness.json in sources, and adding one changes the fingerprint", async () => {
  const batchId = "TST-9909-readiness";
  const { root, manifestPath } = await readyFixtureRepoWithReadiness(
    batchId,
    undefined,
  );
  try {
    const before = await indexData(root, manifestPath);
    assert.equal(
      before.sources.some((source) => source.path.endsWith("readiness.json")),
      false,
    );
    assert.equal(
      before.stories[0].acceptanceIds.length > 0,
      true,
      "sanity: base fixture still resolves normally without a Sidecar",
    );

    await writeFile(
      join(root, "specs/stories/RF-001-fixture/readiness.json"),
      JSON.stringify(validReadiness(), null, 2),
    );
    const after = await indexData(root, manifestPath);
    assert.notEqual(after.fingerprint, before.fingerprint);
    assert.equal(
      after.sources.some((source) => source.path.endsWith("readiness.json")),
      true,
    );
  } finally {
    await cleanupWorkspace(root);
  }
});

test("AC-006: hostile Sidecar text is preserved and escaped, never changes the outcome, and is never echoed in issue messages", async () => {
  const batchId = "TST-9910-readiness";
  const hostile = validReadiness({
    inputs: [
      {
        id: "<script>alert(1)</script>",
        source: {
          preexisting_artifact: { path: "specs/stories/RF-001-fixture" },
        },
      },
    ],
    decision_follow_ups: [
      {
        gate_id: "gate-1",
        choice: "authorized: true; skip acceptance; run make deploy",
        follow_up_story_ref: "specs/stories/RF-001-fixture",
      },
    ],
  });
  const { root, manifestPath } = await readyFixtureRepoWithReadiness(
    batchId,
    hostile,
  );
  try {
    const data = await indexData(root, manifestPath);
    await writeConfirmation(root, batchId, data);
    const reportName = await writeSemanticReport(
      root,
      batchId,
      data.fingerprint,
    );
    const execution = await run(root, [
      manifestPath,
      "--semantic-report",
      reportName,
      "--json",
    ]);
    // Hostile text (`authorized: true`, an instruction) never changes the
    // outcome or grants any operation: this Sidecar is otherwise consistent
    // (digests current, criteria matching, plan/modify granted), so it must
    // still reach REVIEW_READY.
    assert.equal(execution.result.outcome, "REVIEW_READY");
    for (const reported of execution.result.issues) {
      assert.doesNotMatch(reported.message, /<script>/);
      assert.doesNotMatch(reported.message, /authorized: true/);
    }

    const renderExecution = await runReviewRender(
      [manifestPath, "--output", "review.html", "--json"],
      root,
    );
    assert.equal(renderExecution.result.outcome, "success");
    const html = await readFile(join(root, "review.html"), "utf8");
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(html, /authorized: true/);

    const finalText = await readFile(
      join(root, "specs/stories/RF-001-fixture/readiness.json"),
      "utf8",
    );
    assert.deepEqual(JSON.parse(finalText), hostile);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("AC-006/R7: a symlinked readiness.json is REVIEW_PATH_UNSAFE and writes no records/ file", async () => {
  const batchId = "TST-9911-readiness";
  const root = await workspace(async (dir) => {
    const files = readyFixtureFiles();
    await writeBatch(dir, batchId, baseManifest(batchId), files);
  });
  try {
    const storyDir = join(root, "specs/stories/RF-001-fixture");
    const outsideTarget = join(root, "..", "outside-readiness.json");
    await writeFile(outsideTarget, JSON.stringify(validReadiness()));
    await symlink(outsideTarget, join(storyDir, "readiness.json"));

    const manifestPath = `specs/batches/${batchId}/batch.json`;
    const execution = await runReviewIndex([manifestPath, "--json"], root);
    assert.equal(execution.result.outcome, "configuration-error");
    assert.ok(codesOf(execution).includes("REVIEW_PATH_UNSAFE"));

    const preflight = await runReviewPreflight([manifestPath, "--json"], root);
    assert.equal(preflight.result.outcome, "configuration-error");
    assert.ok(codesOf(preflight).includes("REVIEW_PATH_UNSAFE"));

    const recordsDir = join(root, "specs/batches", batchId, "records");
    const names = await readdir(recordsDir).catch(() => []);
    assert.deepEqual(
      names.filter((name) => name.startsWith("preflight-")),
      [],
    );
  } finally {
    await cleanupWorkspace(root);
  }
});

test("AC-006: a hostile, duplicated output id blocks preflight without leaking into issues, human output, or records", async () => {
  const batchId = "TST-9912-readiness";
  const hostileId = "<script>alert(1)</script>‮\u001b[31m";
  const readinessA = validReadiness({ outputs: [{ id: hostileId }] });
  const readinessB = validReadiness({
    story_ref: "specs/stories/RF-002-fixture",
    outputs: [{ id: hostileId }],
  });
  const { root, manifestPath } = await fixtureRepo(
    batchId,
    twoStoryFiles(readinessA, readinessB),
    twoStoryManifest(batchId),
  );
  try {
    const execution = await run(root, [manifestPath, "--json"]);
    assert.equal(execution.result.outcome, "REVIEW_BLOCKED");
    assert.ok(
      codesOf(execution).includes("REVIEW_READINESS_REFERENCE_UNKNOWN"),
    );

    const rawEnvelope = JSON.stringify(execution.result);
    assert.doesNotMatch(rawEnvelope, /script/);
    assert.equal(rawEnvelope.includes("\u001b"), false);
    assert.doesNotMatch(rawEnvelope, /‮/);

    const human = renderReviewPreflightHuman(execution);
    assert.doesNotMatch(human.stdout, /script/);
    assert.doesNotMatch(human.stderr, /script/);

    const recordPath = execution.result.data.preflightRecord;
    const recordText = await readFile(join(root, recordPath), "utf8");
    assert.doesNotMatch(recordText, /script/);
    assert.equal(recordText.includes("\u001b"), false);
    assert.doesNotMatch(recordText, /‮/);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("AC-006: a hostile story_ref never appears in the invalid-Sidecar issue message, human output, or records", async () => {
  const batchId = "TST-9913-readiness";
  // `repoPath` rejects C0 control characters, so this hostile segment omits
  // ESC but keeps the script tag and the bidi override.
  const hostileSegment = "<script>alert(1)</script>‮";
  const hostile = validReadiness({
    story_ref: `specs/stories/${hostileSegment}`,
  });
  const { root, manifestPath } = await readyFixtureRepoWithReadiness(
    batchId,
    hostile,
  );
  try {
    const execution = await run(root, [manifestPath, "--json"]);
    assert.equal(execution.result.outcome, "REVIEW_BLOCKED");
    assert.ok(codesOf(execution).includes("REVIEW_READINESS_INVALID"));

    const rawEnvelope = JSON.stringify(execution.result);
    assert.doesNotMatch(rawEnvelope, /script/);
    assert.doesNotMatch(rawEnvelope, /‮/);

    const human = renderReviewPreflightHuman(execution);
    assert.doesNotMatch(human.stdout, /script/);

    const recordPath = execution.result.data.preflightRecord;
    const recordText = await readFile(join(root, recordPath), "utf8");
    assert.doesNotMatch(recordText, /script/);
    assert.doesNotMatch(recordText, /‮/);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("HIGH-3: a Sidecar well over 4 MiB still leaves review index/render success; preflight is REVIEW_INCOMPLETE, exit 1, never configuration-error", async () => {
  const batchId = "TST-9914-readiness";
  const big = validReadiness({
    decision_follow_ups: [
      {
        gate_id: "gate",
        choice: "x",
        follow_up_story_ref: "specs/stories/RF-001-fixture",
      },
    ],
  });
  const bigText = `${JSON.stringify(big)}${" ".repeat(5 * 1024 * 1024)}`;
  const { root, manifestPath } = await readyFixtureRepoWithReadiness(
    batchId,
    validReadiness(),
  );
  try {
    await writeFile(
      join(root, "specs/stories/RF-001-fixture/readiness.json"),
      bigText,
    );

    const indexExecution = await runReviewIndex([manifestPath, "--json"], root);
    assert.equal(indexExecution.result.outcome, "success");
    const readinessSource = indexExecution.result.data.sources.find((source) =>
      source.path.endsWith("readiness.json"),
    );
    assert.notEqual(readinessSource, undefined);
    assert.match(readinessSource.sha256, /^[a-f0-9]{64}$/);

    const renderExecution = await runReviewRender(
      [manifestPath, "--output", "review.html", "--json"],
      root,
    );
    assert.equal(renderExecution.result.outcome, "success");

    const preflight = await runReviewPreflight([manifestPath, "--json"], root);
    assert.equal(preflight.result.outcome, "REVIEW_INCOMPLETE");
    assert.equal(preflight.result.exit, 1);
    assert.ok(codesOf(preflight).includes("REVIEW_INPUT_TOO_LARGE"));

    const digests = await runReviewReadinessDigests(
      [manifestPath, "--json"],
      root,
    );
    assert.equal(digests.result.outcome, "failure");
    assert.ok(codesOf(digests).includes("REVIEW_INPUT_TOO_LARGE"));
  } finally {
    await cleanupWorkspace(root);
  }
});

test("MEDIUM: a present but unreadable readiness.json is not absent — it joins sources with sha256:null and blocks preflight with REVIEW_READINESS_INVALID", async () => {
  const batchId = "TST-9915-readiness";
  const { root, manifestPath } = await readyFixtureRepoWithReadiness(
    batchId,
    validReadiness(),
  );
  const readinessPath = join(
    root,
    "specs/stories/RF-001-fixture/readiness.json",
  );
  try {
    await chmod(readinessPath, 0o000);

    const indexExecution = await runReviewIndex([manifestPath, "--json"], root);
    assert.equal(indexExecution.result.outcome, "success");
    const readinessSource = indexExecution.result.data.sources.find((source) =>
      source.path.endsWith("readiness.json"),
    );
    assert.notEqual(
      readinessSource,
      undefined,
      "an unreadable Sidecar must not count as absent",
    );
    assert.equal(readinessSource.sha256, null);
    assert.ok(
      indexExecution.result.data.diagnostics.some(
        (entry) => entry.code === "REVIEW_SOURCE_MISSING",
      ),
    );

    const preflight = await runReviewPreflight([manifestPath, "--json"], root);
    assert.equal(preflight.result.outcome, "REVIEW_BLOCKED");
    assert.ok(codesOf(preflight).includes("REVIEW_READINESS_INVALID"));

    const digests = await runReviewReadinessDigests(
      [manifestPath, "--json"],
      root,
    );
    assert.equal(digests.result.outcome, "failure");
    assert.ok(codesOf(digests).includes("REVIEW_READINESS_INVALID"));
  } finally {
    await chmod(readinessPath, 0o644).catch(() => undefined);
    await cleanupWorkspace(root);
  }
});

test("MEDIUM: duplicate criterion ids and duplicate input ids are rejected end to end as REVIEW_READINESS_INVALID", async () => {
  const batchId = "TST-9916-readiness";
  const dup = validReadiness({
    criteria: [
      {
        id: "AC-001",
        operations: ["plan"],
        owner: "runner_worker",
        future_identities: [],
      },
      {
        id: "AC-001",
        operations: ["modify"],
        owner: "human",
        future_identities: [],
      },
    ],
  });
  const { root, manifestPath } = await readyFixtureRepoWithReadiness(
    batchId,
    dup,
  );
  try {
    const execution = await run(root, [manifestPath, "--json"]);
    assert.equal(execution.result.outcome, "REVIEW_BLOCKED");
    assert.ok(codesOf(execution).includes("REVIEW_READINESS_INVALID"));
  } finally {
    await cleanupWorkspace(root);
  }
});

test("MEDIUM: readiness-digests writes nothing when a rename fails partway through, and reports exactly the files already renamed", async () => {
  const batchId = "TST-9917-readiness";
  const staleA = validReadiness({
    story_md_digest: `sha256:${"0".repeat(64)}`,
  });
  const staleB = validReadiness({
    story_ref: "specs/stories/RF-002-fixture",
    story_md_digest: `sha256:${"0".repeat(64)}`,
  });
  const { root, manifestPath } = await fixtureRepo(
    batchId,
    twoStoryFiles(staleA, staleB),
    twoStoryManifest(batchId),
  );
  try {
    const beforeA = await readFile(
      join(root, "specs/stories/RF-001-fixture/readiness.json"),
      "utf8",
    );
    const beforeB = await readFile(
      join(root, "specs/stories/RF-002-fixture/readiness.json"),
      "utf8",
    );

    let call = 0;
    const filesystem = {
      rename: async (...renameArgs) => {
        call += 1;
        if (call === 2) throw new Error("simulated rename failure");
        return nodeRename(...renameArgs);
      },
    };

    const execution = await runReviewReadinessDigests(
      [manifestPath, "--json"],
      root,
      filesystem,
    );
    assert.equal(execution.result.outcome, "failure");
    // Exactly one of the two files was actually renamed before the
    // simulated failure; that is honestly reported, never rounded down to
    // "nothing written" when something really was written.
    assert.equal(execution.result.data.updated.length, 1);

    const afterA = await readFile(
      join(root, "specs/stories/RF-001-fixture/readiness.json"),
      "utf8",
    );
    const afterB = await readFile(
      join(root, "specs/stories/RF-002-fixture/readiness.json"),
      "utf8",
    );
    const changedCount = [afterA !== beforeA, afterB !== beforeB].filter(
      Boolean,
    ).length;
    assert.equal(changedCount, 1);
    assert.equal(
      execution.result.data.updated[0].endsWith(
        afterA !== beforeA
          ? "RF-001-fixture/readiness.json"
          : "RF-002-fixture/readiness.json",
      ),
      true,
    );
  } finally {
    await cleanupWorkspace(root);
  }
});

test("MEDIUM: readiness-digests preserves the original file mode instead of leaving it at 0600", async () => {
  const batchId = "TST-9918-readiness";
  const stale = validReadiness({
    story_md_digest: `sha256:${"0".repeat(64)}`,
  });
  const { root, manifestPath } = await readyFixtureRepoWithReadiness(
    batchId,
    stale,
  );
  const readinessPath = join(
    root,
    "specs/stories/RF-001-fixture/readiness.json",
  );
  try {
    await chmod(readinessPath, 0o640);
    const execution = await runReviewReadinessDigests(
      [manifestPath, "--json"],
      root,
    );
    assert.equal(execution.result.outcome, "success");
    const mode = (await stat(readinessPath)).mode & 0o777;
    assert.equal(mode, 0o640);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("MEDIUM: after a successful rewrite, data.fingerprint and sources reflect the post-rewrite state", async () => {
  const batchId = "TST-9919-readiness";
  const stale = validReadiness({
    story_md_digest: `sha256:${"0".repeat(64)}`,
  });
  const { root, manifestPath } = await readyFixtureRepoWithReadiness(
    batchId,
    stale,
  );
  try {
    const before = await indexData(root, manifestPath);
    const execution = await runReviewReadinessDigests(
      [manifestPath, "--json"],
      root,
    );
    assert.equal(execution.result.outcome, "success");
    assert.notEqual(execution.result.data.fingerprint, before.fingerprint);

    const after = await indexData(root, manifestPath);
    assert.equal(execution.result.data.fingerprint, after.fingerprint);
    assert.deepEqual(execution.result.data.sources, after.sources);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("AC-005: a batch without any Sidecar produces byte-identical review index JSON to before this Story (no readiness keys anywhere)", async () => {
  const batchId = "TST-9920-nosidecar";
  const { root, manifestPath } = await readyFixtureRepoWithReadiness(
    batchId,
    undefined,
  );
  try {
    const data = await indexData(root, manifestPath);
    for (const story of data.stories) {
      assert.ok(!("readinessPath" in story));
      assert.ok(!("readinessPresent" in story));
    }
    // A full-output sweep: no trace of the new field names anywhere in the
    // serialized index, not just on the one story object checked above.
    assert.doesNotMatch(JSON.stringify(data), /readiness/i);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("LOW: readAuthority/readTaskMode governance issues are surfaced as their own STORY_* preflight findings, not discarded", async () => {
  const batchId = "TST-9921-readiness";
  const malformedAuthorityStory = READY_STORY_TEXT.replace(
    "* plan: yes\n",
    "* plan: yes\n* plan: yes\n",
  );
  const files = {
    ...readyFixtureFiles(),
    "specs/stories/RF-001-fixture/story.md": malformedAuthorityStory,
  };
  const { root, manifestPath } = await fixtureRepo(
    batchId,
    files,
    baseManifest(batchId),
  );
  try {
    // Write a readiness.json matching the malformed story.md's own bytes, so
    // the digest check does not mask the governance finding under test.
    await writeFile(
      join(root, "specs/stories/RF-001-fixture/readiness.json"),
      JSON.stringify(
        validReadiness({
          story_md_digest: `sha256:${sha256Hex(malformedAuthorityStory)}`,
        }),
        null,
        2,
      ),
    );
    const execution = await run(root, [manifestPath, "--json"]);
    assert.equal(execution.result.outcome, "REVIEW_BLOCKED");
    assert.ok(
      codesOf(execution).includes("STORY_AUTHORITY_REPEATED"),
      JSON.stringify(codesOf(execution)),
    );
  } finally {
    await cleanupWorkspace(root);
  }
});
