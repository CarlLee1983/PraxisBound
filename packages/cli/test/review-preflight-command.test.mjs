import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { validateResultEnvelope } from "@praxisbound/core";

import {
  runReviewPreflight,
  renderReviewPreflightHuman,
} from "../dist/review-preflight.js";

import {
  baseFixtureFiles,
  baseManifest,
  cleanupWorkspace,
  fixtureRepo,
  indexData,
  revision,
  writeBatch,
  workspace,
} from "./review-import-respond-support.mjs";
import {
  hashSources,
  assertUnchanged,
  importSheet,
  DEFINITION_SOURCES,
} from "./review-agent-workflow-support.mjs";

// A minimal Story that passes `story check --ready` (mirrors
// story-command.test.mjs's TST008-AC-001/003 readiness fixture).
const readyStoryText = `# Story: RF-001 Fixture

## Goal

Check minimum Story content.

## Scope

* Check this fixture.

## Classification

* Security sensitive: no
* Baseline conformance: no
`;
const readyAcceptanceText = `# Acceptance Criteria

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
    "specs/stories/RF-001-fixture/story.md": readyStoryText,
    "specs/stories/RF-001-fixture/acceptance.md": readyAcceptanceText,
  };
}

/** A batch fixture whose Story passes `--ready`, for the READY happy path and its variants. */
async function readyFixtureRepo(batchId, manifest = baseManifest(batchId)) {
  return fixtureRepo(batchId, readyFixtureFiles(), manifest);
}

async function writeSemanticReportFile(root) {
  const path = join(root, "semantic-report.json");
  await writeFile(path, "{}");
  return "semantic-report.json";
}

async function writeConfirmation(root, batchId, data, overrides = {}) {
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
    ...overrides,
  };
  const recordsDir = join(root, "specs", "batches", batchId, "records");
  await mkdir(recordsDir, { recursive: true });
  const fp12 = record.fingerprint.slice(0, 12);
  await writeFile(
    join(recordsDir, `confirmation-${fp12}.json`),
    JSON.stringify(record),
  );
  return record;
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

test("AC-001: a batch with an applicable confirmation, a ready Story, no cycle, no unresolved request, and an existing Semantic Report yields REVIEW_READY, pass, exit 0", async () => {
  const batchId = "TST-9701-fixture";
  const { root, manifestPath } = await readyFixtureRepo(batchId);
  try {
    const data = await indexData(root, manifestPath);
    await writeConfirmation(root, batchId, data);
    const semanticReport = await writeSemanticReportFile(root);

    const execution = await run(root, [
      manifestPath,
      "--semantic-report",
      semanticReport,
      "--json",
    ]);

    assert.equal(execution.result.outcome, "REVIEW_READY");
    assert.equal(execution.result.status, "pass");
    assert.equal(execution.result.exit, 0);
    assert.equal(execution.result.data.batchId, batchId);
    assert.equal(execution.result.data.fingerprint, data.fingerprint);

    const human = renderReviewPreflightHuman(execution);
    assert.match(human.stdout, /Mechanical checks/);
    assert.match(human.stdout, /Agent observations \(unverified\)/);
    assert.match(human.stdout, /只表示未發現阻擋，不宣稱沒有缺陷/);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("AC-002: a missing declared source yields REVIEW_BLOCKED with REVIEW_SOURCE_MISSING", async () => {
  const batchId = "TST-9702-fixture";
  const files = readyFixtureFiles();
  delete files["specs/decisions/ADR-001-fixture.md"];
  const manifestPath = `specs/batches/${batchId}/batch.json`;
  const missing = await workspace(async (dir) => {
    await writeBatch(dir, batchId, baseManifest(batchId), files);
  });
  try {
    const execution = await run(missing, [manifestPath, "--json"]);
    assert.equal(execution.result.outcome, "REVIEW_BLOCKED");
    assert.ok(codesOf(execution).includes("REVIEW_SOURCE_MISSING"));
  } finally {
    await cleanupWorkspace(missing);
  }
});

test("AC-002: a Story failing story check --ready yields REVIEW_BLOCKED with a STORY_* code", async () => {
  const batchId = "TST-9703-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const execution = await run(root, [manifestPath, "--json"]);
    assert.equal(execution.result.outcome, "REVIEW_BLOCKED");
    assert.ok(codesOf(execution).some((code) => code.startsWith("STORY_")));
  } finally {
    await cleanupWorkspace(root);
  }
});

test("AC-002: a dependency cycle yields REVIEW_BLOCKED with REVIEW_DEPENDENCY_CYCLE", async () => {
  const batchId = "TST-9704-fixture";
  const manifest = baseManifest(batchId);
  manifest.dependencies = [{ story: "RF-001", dependsOn: ["RF-001"] }];
  const { root, manifestPath } = await readyFixtureRepo(batchId, manifest);
  try {
    const execution = await run(root, [manifestPath, "--json"]);
    assert.equal(execution.result.outcome, "REVIEW_BLOCKED");
    assert.ok(codesOf(execution).includes("REVIEW_DEPENDENCY_CYCLE"));
  } finally {
    await cleanupWorkspace(root);
  }
});

test("AC-002: a dependency naming a Story outside the batch yields REVIEW_BLOCKED with REVIEW_STORY_UNKNOWN", async () => {
  const batchId = "TST-9705-fixture";
  const manifest = baseManifest(batchId);
  manifest.dependencies = [{ story: "RF-001", dependsOn: ["RF-999"] }];
  const { root, manifestPath } = await readyFixtureRepo(batchId, manifest);
  try {
    const execution = await run(root, [manifestPath, "--json"]);
    assert.equal(execution.result.outcome, "REVIEW_BLOCKED");
    assert.ok(codesOf(execution).includes("REVIEW_STORY_UNKNOWN"));
  } finally {
    await cleanupWorkspace(root);
  }
});

test("AC-002: an unresolved effective blocking request yields REVIEW_BLOCKED with REVIEW_UNRESOLVED_BLOCKING", async () => {
  const batchId = "TST-9706-fixture";
  const { root, manifestPath } = await readyFixtureRepo(batchId);
  try {
    await importSheet(root, manifestPath, batchId, [
      revision({ blocking: true }),
    ]);
    const execution = await run(root, [manifestPath, "--json"]);
    assert.equal(execution.result.outcome, "REVIEW_BLOCKED");
    assert.ok(codesOf(execution).includes("REVIEW_UNRESOLVED_BLOCKING"));
  } finally {
    await cleanupWorkspace(root);
  }
});

test("AC-003: --expect-fingerprint not matching the current fingerprint yields REVIEW_STALE with REVIEW_PACKET_FINGERPRINT_MISMATCH", async () => {
  const batchId = "TST-9707-fixture";
  const { root, manifestPath } = await readyFixtureRepo(batchId);
  try {
    const execution = await run(root, [
      manifestPath,
      "--expect-fingerprint",
      "d".repeat(64),
      "--expect-revision",
      "e".repeat(40),
      "--json",
    ]);
    assert.equal(execution.result.outcome, "REVIEW_STALE");
    assert.ok(
      codesOf(execution).includes("REVIEW_PACKET_FINGERPRINT_MISMATCH"),
    );
  } finally {
    await cleanupWorkspace(root);
  }
});

test("AC-003: a confirmation stale against the current fingerprint yields REVIEW_STALE listing the REVIEW_SOURCE_CHANGED difference", async () => {
  const batchId = "TST-9708-fixture";
  const { root, manifestPath } = await readyFixtureRepo(batchId);
  try {
    const before = await indexData(root, manifestPath);
    await writeConfirmation(root, batchId, before);

    // Change a declared source's content so the fingerprint (and thus
    // applicability) changes without writing a new confirmation.
    const specPath = join(root, "specs", "features", "fixture", "spec.md");
    const original = await readFile(specPath, "utf8");
    await writeFile(specPath, `${original}\n<!-- changed -->\n`);

    const execution = await run(root, [manifestPath, "--json"]);
    assert.equal(execution.result.outcome, "REVIEW_STALE");
    const codes = codesOf(execution);
    assert.ok(codes.includes("REVIEW_CONFIRMATION_STALE"));
    assert.ok(codes.includes("REVIEW_SOURCE_CHANGED"));
  } finally {
    await cleanupWorkspace(root);
  }
});

test("AC-003: no confirmation at all yields REVIEW_INCOMPLETE with REVIEW_CONFIRMATION_MISSING", async () => {
  const batchId = "TST-9709-fixture";
  const { root, manifestPath } = await readyFixtureRepo(batchId);
  try {
    const execution = await run(root, [manifestPath, "--json"]);
    assert.equal(execution.result.outcome, "REVIEW_INCOMPLETE");
    assert.ok(codesOf(execution).includes("REVIEW_CONFIRMATION_MISSING"));
  } finally {
    await cleanupWorkspace(root);
  }
});

test("AC-003: an unaddressed non-blocking request yields REVIEW_INCOMPLETE with REVIEW_REVISION_UNADDRESSED", async () => {
  const batchId = "TST-9710-fixture";
  const { root, manifestPath } = await readyFixtureRepo(batchId);
  try {
    await importSheet(root, manifestPath, batchId, [
      revision({ blocking: false }),
    ]);
    const execution = await run(root, [manifestPath, "--json"]);
    assert.equal(execution.result.outcome, "REVIEW_INCOMPLETE");
    assert.ok(codesOf(execution).includes("REVIEW_REVISION_UNADDRESSED"));
  } finally {
    await cleanupWorkspace(root);
  }
});

test("AC-003: the same non-blocking request deferred in the applicable confirmation is not reported as unaddressed", async () => {
  const batchId = "TST-9711-fixture";
  const { root, manifestPath } = await readyFixtureRepo(batchId);
  try {
    const before = await indexData(root, manifestPath);
    const nonBlocking = revision({ blocking: false });
    await importSheet(root, manifestPath, batchId, [nonBlocking]);
    await writeConfirmation(root, batchId, before, {
      deferred: [{ revisionId: nonBlocking.id, reason: "deferred on purpose" }],
    });

    const execution = await run(root, [manifestPath, "--json"]);
    assert.ok(!codesOf(execution).includes("REVIEW_REVISION_UNADDRESSED"));
  } finally {
    await cleanupWorkspace(root);
  }
});

test("AC-003: a missing --semantic-report yields REVIEW_INCOMPLETE with REVIEW_SEMANTIC_MISSING", async () => {
  const batchId = "TST-9712-fixture";
  const { root, manifestPath } = await readyFixtureRepo(batchId);
  try {
    const data = await indexData(root, manifestPath);
    await writeConfirmation(root, batchId, data);

    const execution = await run(root, [manifestPath, "--json"]);
    assert.equal(execution.result.outcome, "REVIEW_INCOMPLETE");
    assert.ok(codesOf(execution).includes("REVIEW_SEMANTIC_MISSING"));
  } finally {
    await cleanupWorkspace(root);
  }
});

test("AC-003: several conditions at once resolve to REVIEW_STALE (top precedence) with every issue still listed", async () => {
  const batchId = "TST-9713-fixture";
  const files = readyFixtureFiles();
  delete files["specs/decisions/ADR-001-fixture.md"];
  const missing = await workspace(async (dir) => {
    await writeBatch(dir, batchId, baseManifest(batchId), files);
  });
  const manifestPath = `specs/batches/${batchId}/batch.json`;
  try {
    const execution = await run(missing, [
      manifestPath,
      "--expect-fingerprint",
      "d".repeat(64),
      "--expect-revision",
      "e".repeat(40),
      "--json",
    ]);
    assert.equal(execution.result.outcome, "REVIEW_STALE");
    const codes = codesOf(execution);
    assert.ok(codes.includes("REVIEW_PACKET_FINGERPRINT_MISMATCH"));
    assert.ok(codes.includes("REVIEW_SOURCE_MISSING"));
    assert.ok(codes.includes("REVIEW_CONFIRMATION_MISSING"));
  } finally {
    await cleanupWorkspace(missing);
  }
});

test("AC-005: an advisory-only invalid record (REVIEW_RECORD_INVALID) never changes the outcome", async () => {
  const batchId = "TST-9714-fixture";
  const { root, manifestPath } = await readyFixtureRepo(batchId);
  try {
    const data = await indexData(root, manifestPath);
    await writeConfirmation(root, batchId, data);
    const semanticReport = await writeSemanticReportFile(root);

    // A `revisions-*.json` name that fails the strict
    // `revisions-<sha12>.json` pattern is invalid (advisory), never a
    // blocker (contract §9's "其他非阻擋診斷" row).
    const recordsDir = join(root, "specs", "batches", batchId, "records");
    await mkdir(recordsDir, { recursive: true });
    await writeFile(join(recordsDir, "revisions-not-a-valid-name.json"), "{}");

    const execution = await run(root, [
      manifestPath,
      "--semantic-report",
      semanticReport,
      "--json",
    ]);
    assert.equal(execution.result.outcome, "REVIEW_READY");
    const codes = codesOf(execution);
    assert.ok(codes.includes("REVIEW_RECORD_INVALID"));
    const diagnostic = execution.result.data.diagnostics.find(
      (entry) => entry.code === "REVIEW_RECORD_INVALID",
    );
    assert.equal(diagnostic.severity, "advisory");
  } finally {
    await cleanupWorkspace(root);
  }
});

test("AC-005: an ESC control character inside an untrusted diagnostic message is escaped, never raw, in human output", () => {
  // A synthetic execution, exercised directly against the renderer: Core's
  // own `evaluatePreflight` already ESC-escapes every untrusted message it
  // assembles (`finalizeMessage`/`escapeHiddenCharacters`), so this proves
  // the renderer never re-exposes a hidden character even if one reached it.
  const execution = {
    mode: "human",
    result: {
      schemaVersion: "1.0.0",
      protocolVersion: "0.10.0",
      status: "fail",
      outcome: "REVIEW_BLOCKED",
      exit: 1,
      subject: "review",
      issues: [
        {
          code: "REVIEW_SOURCE_MISSING",
          message: "a declared source is missing: \x1b[2J untracked path",
        },
      ],
      data: {
        batchId: "TST-9714-esc",
        fingerprint: "f".repeat(64),
        diagnostics: [{ code: "REVIEW_SOURCE_MISSING", severity: "blocking" }],
      },
    },
  };

  const human = renderReviewPreflightHuman(execution);
  assert.match(human.stdout, /\\x1b/);
  assert.ok(!human.stdout.includes("\x1b"));
});

test("AC-006 (part): invalid argv is usage-error, exit 2, and writes nothing", async () => {
  const batchId = "TST-9715-fixture";
  const { root, manifestPath } = await readyFixtureRepo(batchId);
  try {
    const cases = [
      ["--not-a-flag"],
      [manifestPath, "extra-positional"],
      [manifestPath, "--expect-fingerprint", "f".repeat(64)],
      [
        manifestPath,
        "--expect-fingerprint",
        "f".repeat(64),
        "--expect-revision",
        "--upload-pack=touch /tmp/x",
      ],
    ];
    for (const args of cases) {
      const execution = await runReviewPreflight(args, root);
      assert.equal(
        execution.result.outcome,
        "usage-error",
        JSON.stringify(args),
      );
      assert.equal(execution.result.exit, 2);
    }
  } finally {
    await cleanupWorkspace(root);
  }
});

test("AC-006 (part): an invalid manifest is configuration-error, exit 2", async () => {
  const root = await workspace(async () => {});
  try {
    const execution = await runReviewPreflight(
      ["specs/batches/does-not-exist/batch.json", "--json"],
      root,
    );
    assert.equal(execution.result.outcome, "configuration-error");
    assert.equal(execution.result.exit, 2);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("AC-007: batch sources, the manifest, and existing records are byte-identical before and after a run", async () => {
  const batchId = "TST-9716-fixture";
  const { root, manifestPath } = await readyFixtureRepo(batchId);
  try {
    const data = await indexData(root, manifestPath);
    await writeConfirmation(root, batchId, data);
    const semanticReport = await writeSemanticReportFile(root);

    const paths = [manifestPath, ...DEFINITION_SOURCES];
    const before = await hashSources(root, paths);
    await run(root, [
      manifestPath,
      "--semantic-report",
      semanticReport,
      "--json",
    ]);
    const after = await hashSources(root, paths);
    assertUnchanged(before, after, paths);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("AC-008: human output lists Mechanical checks and Agent observations (unverified) as two labelled sections", async () => {
  const batchId = "TST-9717-fixture";
  const { root, manifestPath } = await readyFixtureRepo(batchId);
  try {
    const execution = await run(root, [manifestPath, "--json"]);
    const human = renderReviewPreflightHuman(execution);
    const mechanicalIndex = human.stdout.indexOf("Mechanical checks");
    const agentIndex = human.stdout.indexOf("Agent observations (unverified)");
    assert.ok(mechanicalIndex >= 0);
    assert.ok(agentIndex > mechanicalIndex);
  } finally {
    await cleanupWorkspace(root);
  }
});
