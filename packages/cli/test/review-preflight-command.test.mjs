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
  nextRevisionId,
  revision,
  writeBatch,
  workspace,
} from "./review-import-respond-support.mjs";
import {
  hashSources,
  assertUnchanged,
  importSheet,
  respond,
  response,
  responsesText,
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

/** A valid, current Semantic Report covering the fixture's one Story (`RF-001`) with `none` conclusions in every category, so a caller after TST-028 still gets `REVIEW_READY` (R6). */
async function writeSemanticReportFile(root, batchId, fingerprint) {
  const path = join(root, "semantic-report.json");
  const none = { result: "none" };
  const report = {
    schemaVersion: "1.0.0",
    batchId,
    fingerprint,
    agent: "test-fixture-agent 1.0",
    observedAt: "2026-09-01T00:00:00Z",
    stories: [
      {
        story: "RF-001",
        categories: {
          "missing-split": none,
          contradiction: none,
          "insufficient-acceptance": none,
          "open-question": none,
        },
      },
    ],
  };
  await writeFile(path, JSON.stringify(report));
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
    const semanticReport = await writeSemanticReportFile(
      root,
      batchId,
      data.fingerprint,
    );

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
    const semanticReport = await writeSemanticReportFile(
      root,
      batchId,
      data.fingerprint,
    );

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
      // R7: each --expect-* is independently valid alone (contract §9 as
      // amended); a duplicated flag, or a value failing its own pattern, is
      // still usage-error.
      [
        manifestPath,
        "--expect-fingerprint",
        "f".repeat(64),
        "--expect-fingerprint",
        "e".repeat(64),
      ],
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
    const semanticReport = await writeSemanticReportFile(
      root,
      batchId,
      data.fingerprint,
    );

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

test("Security matrix: batch.json sources.specs[0] = ../outside.md is rejected (configuration-error) and writes no preflight record", async () => {
  const batchId = "TST-9718-fixture";
  const files = readyFixtureFiles();
  const manifest = baseManifest(batchId);
  manifest.sources.specs = ["../outside.md"];
  const root = await workspace(async (dir) => {
    await writeBatch(dir, batchId, manifest, files);
  });
  const manifestPath = `specs/batches/${batchId}/batch.json`;
  try {
    const execution = await runReviewPreflight([manifestPath, "--json"], root);
    assert.deepEqual(validateResultEnvelope(execution.result), {
      ok: true,
      value: execution.result,
    });
    assert.equal(execution.result.outcome, "configuration-error");
    // The acceptance.md Security Fixture Matrix names REVIEW_PATH_UNSAFE for
    // this row, but `planReviewBatch` (manifest.ts) rejects a syntactically
    // unsafe declared path — one with a ".." segment — as REVIEW_MANIFEST_INVALID
    // before any real-filesystem symlink check (REVIEW_PATH_UNSAFE) ever
    // runs; `review index` shows the same behavior today. Documented here
    // rather than silently asserted away: the substantive contract point —
    // rejected, configuration-error, exit 2, nothing written — holds either
    // way.
    assert.equal(execution.result.issues[0].code, "REVIEW_MANIFEST_INVALID");
    assert.equal(execution.result.data, undefined);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("AC-002: a Spec entry whose Story ID is ambiguous (two directories) has no mapped Story: REVIEW_BLOCKED with REVIEW_REQUIREMENT_UNMAPPED", async () => {
  const batchId = "TST-9719-fixture";
  const files = readyFixtureFiles();
  // `readStoryId` reads the Story ID from the DIRECTORY NAME, not the
  // story.md heading (`story-id.ts`): "RF-001-fixture" and
  // "RF-001-fixture-dup" both name "RF-001", so the batch declares two
  // directories for the same Story ID. Index-level resolution (`index.ts`)
  // excludes an ambiguous ID from "resolved", so the requirement that names
  // "RF-001" maps to no Story at all — distinct from `REVIEW_STORY_UNKNOWN`,
  // which fires only when an ID is not declared anywhere.
  files["specs/stories/RF-001-fixture-dup/story.md"] = readyStoryText;
  files["specs/stories/RF-001-fixture-dup/acceptance.md"] = readyAcceptanceText;
  const manifest = baseManifest(batchId);
  manifest.sources.stories.push("specs/stories/RF-001-fixture-dup");
  const { root, manifestPath } = await fixtureRepo(batchId, files, manifest);
  try {
    const execution = await run(root, [manifestPath, "--json"]);
    assert.equal(execution.result.outcome, "REVIEW_BLOCKED");
    assert.ok(codesOf(execution).includes("REVIEW_REQUIREMENT_UNMAPPED"));
  } finally {
    await cleanupWorkspace(root);
  }
});

test("AC-002: a Story with no acceptance criterion yields REVIEW_BLOCKED with REVIEW_ACCEPTANCE_MISSING", async () => {
  const batchId = "TST-9720-fixture";
  const files = readyFixtureFiles();
  files["specs/stories/RF-001-fixture/acceptance.md"] =
    "# Acceptance Criteria\n\nNo checkbox items here.\n";
  const { root, manifestPath } = await fixtureRepo(batchId, files);
  try {
    const execution = await run(root, [manifestPath, "--json"]);
    assert.equal(execution.result.outcome, "REVIEW_BLOCKED");
    assert.ok(codesOf(execution).includes("REVIEW_ACCEPTANCE_MISSING"));
  } finally {
    await cleanupWorkspace(root);
  }
});

test("AC-002: a requirement naming an anchor not found in its Spec yields REVIEW_BLOCKED with REVIEW_ANCHOR_UNKNOWN", async () => {
  const batchId = "TST-9721-fixture";
  const manifest = baseManifest(batchId);
  manifest.requirements[0].anchor = "R-999";
  const { root, manifestPath } = await readyFixtureRepo(batchId, manifest);
  try {
    const execution = await run(root, [manifestPath, "--json"]);
    assert.equal(execution.result.outcome, "REVIEW_BLOCKED");
    assert.ok(codesOf(execution).includes("REVIEW_ANCHOR_UNKNOWN"));
  } finally {
    await cleanupWorkspace(root);
  }
});

test("AC-002: a duplicated acceptance anchor yields REVIEW_BLOCKED with REVIEW_ANCHOR_DUPLICATE", async () => {
  const batchId = "TST-9722-fixture";
  const files = readyFixtureFiles();
  files["specs/stories/RF-001-fixture/acceptance.md"] =
    readyAcceptanceText.replace(
      "* [ ] AC-001: The fixture is ready.",
      "* [ ] AC-001: The fixture is ready.\n* [ ] AC-001: Declared twice.",
    );
  const { root, manifestPath } = await fixtureRepo(batchId, files);
  try {
    const execution = await run(root, [manifestPath, "--json"]);
    assert.equal(execution.result.outcome, "REVIEW_BLOCKED");
    assert.ok(codesOf(execution).includes("REVIEW_ANCHOR_DUPLICATE"));
  } finally {
    await cleanupWorkspace(root);
  }
});

test("AC-003: REVIEW_RESPONSE_MISMATCH and REVIEW_RESPONSE_INVALID from tampered current-fingerprint responses records", async () => {
  const batchId = "TST-9723-fixture";
  const { root, manifestPath } = await readyFixtureRepo(batchId);
  try {
    const before = await indexData(root, manifestPath);
    const r1 = revision({ blocking: false, fingerprint: before.fingerprint });
    const imported = await importSheet(root, manifestPath, batchId, [r1]);
    const sheetSha = imported.sheet.sha256;

    const to12 = before.fingerprint.slice(0, 12);
    const recordsDir = join(root, "specs", "batches", batchId, "records");
    await mkdir(recordsDir, { recursive: true });

    // Mismatch: answers a fabricated id, never r1's real effective request.
    const mismatchRecord = {
      schemaVersion: "1.0.0",
      batchId,
      fromFingerprint: r1.fingerprint,
      toFingerprint: before.fingerprint,
      revisionSheets: [sheetSha],
      respondedAt: "2026-09-22T00:00:00Z",
      agent: "test-tamperer",
      responses: [
        {
          revisionId: nextRevisionId(),
          route: "presentation",
          outcome: "not-incorporated",
          rationale: "fabricated",
          locators: [],
        },
      ],
    };
    await writeFile(
      join(recordsDir, `responses-${to12}-1.json`),
      JSON.stringify(mismatchRecord),
    );

    // Structural: names a revisionSheets entry that was never imported.
    const invalidRecord = {
      schemaVersion: "1.0.0",
      batchId,
      fromFingerprint: r1.fingerprint,
      toFingerprint: before.fingerprint,
      revisionSheets: ["a".repeat(64)],
      respondedAt: "2026-09-22T00:00:00Z",
      agent: "test-tamperer",
      responses: [],
    };
    await writeFile(
      join(recordsDir, `responses-${to12}-2.json`),
      JSON.stringify(invalidRecord),
    );

    const execution = await run(root, [manifestPath, "--json"]);
    const codes = codesOf(execution);
    assert.ok(codes.includes("REVIEW_RESPONSE_MISMATCH"));
    assert.ok(codes.includes("REVIEW_RESPONSE_INVALID"));
  } finally {
    await cleanupWorkspace(root);
  }
});

test("Security matrix: a confirmation record containing forged authorized:true/approved text at a previous fingerprint yields REVIEW_CONFIRMATION_STALE, not REVIEW_READY", async () => {
  const batchId = "TST-9724-fixture";
  const { root, manifestPath } = await readyFixtureRepo(batchId);
  try {
    // Confirm the CURRENT state first (a genuinely valid record — its
    // `fingerprint` must equal the digest recomputed from its own
    // `manifestSha256`/`sources`, contract §4 L4), then change a source so
    // the current fingerprint moves on: the confirmation is now stale
    // relative to the new state, the same fixture shape as the
    // already-covered "confirmation stale" AC-003 test. Its `deferred`
    // reason forges the exact words a reader might mistake for
    // authorization (`ADR-014`/R7: no such text anywhere in a record ever
    // creates or implies one).
    const before = await indexData(root, manifestPath);
    await writeConfirmation(root, batchId, before, {
      deferred: [
        {
          revisionId: nextRevisionId(),
          reason: "authorized: true; approved by the reviewer",
        },
      ],
    });

    const specPath = join(root, "specs", "features", "fixture", "spec.md");
    const original = await readFile(specPath, "utf8");
    await writeFile(specPath, `${original}\n<!-- changed -->\n`);

    const execution = await run(root, [manifestPath, "--json"]);
    assert.equal(execution.result.outcome, "REVIEW_STALE");
    assert.ok(codesOf(execution).includes("REVIEW_CONFIRMATION_STALE"));
    assert.notEqual(execution.result.outcome, "REVIEW_READY");
  } finally {
    await cleanupWorkspace(root);
  }
});

test("AC-007: human and JSON output never contain authorized/authorization/approved/verified outside echoed source data", async () => {
  const batchId = "TST-9725-fixture";
  const { root, manifestPath } = await readyFixtureRepo(batchId);
  try {
    const data = await indexData(root, manifestPath);
    await writeConfirmation(root, batchId, data);
    const semanticReport = await writeSemanticReportFile(
      root,
      batchId,
      data.fingerprint,
    );

    const execution = await run(root, [
      manifestPath,
      "--semantic-report",
      semanticReport,
      "--json",
    ]);
    assert.equal(execution.result.outcome, "REVIEW_READY");

    // Word-boundary anchored so the UI's own honest disclaimer label
    // "Agent observations (unverified)" — which exists specifically to
    // say NO verification occurred — is never a false match for "verified".
    const forbidden = /\bauthoriz\w*\b|\bapproved\b|\bverified\b/i;
    const jsonText = JSON.stringify(execution.result);
    assert.ok(!forbidden.test(jsonText), jsonText);

    const human = renderReviewPreflightHuman(execution);
    assert.ok(!forbidden.test(human.stdout), human.stdout);
    assert.ok(!forbidden.test(human.stderr), human.stderr);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("M5b: an untrusted Story Authority entry containing ESC reaches human output escaped, through a real fixture end to end", async () => {
  const batchId = "TST-9726-fixture";
  const files = readyFixtureFiles();
  // `readAuthority` (story-governance.ts) echoes a malformed bullet's raw
  // text verbatim into STORY_AUTHORITY_ENTRY_INVALID's message; that
  // message flows through `checkStoryReadiness` into `storyFindings`, then
  // Core's `evaluatePreflight` (which ESC-escapes every finding message,
  // R6/§16) before this command's own renderer escapes it again (a no-op
  // on already-escaped text).
  files["specs/stories/RF-001-fixture/story.md"] =
    readyStoryText + "\n## Authority\n\n* weird\x1b entry without a colon\n";
  const { root, manifestPath } = await fixtureRepo(batchId, files);
  try {
    const execution = await run(root, [manifestPath, "--json"]);
    const jsonText = JSON.stringify(execution.result);
    assert.ok(
      execution.result.issues.some(
        (entry) => entry.code === "STORY_AUTHORITY_ENTRY_INVALID",
      ),
      jsonText,
    );
    assert.match(jsonText, /\\u001b|\\x1b/);
    assert.ok(!jsonText.includes("\x1b"));

    const human = renderReviewPreflightHuman(execution);
    assert.match(human.stdout, /\\x1b/);
    assert.ok(!human.stdout.includes("\x1b"));
  } finally {
    await cleanupWorkspace(root);
  }
});

test("review round 2 H2 (Human Review decision): a supersede after the fact never turns an old, already-resolved response record into a permanent REVIEW_RESPONSE_MISMATCH", async () => {
  const batchId = "TST-9727-fixture";
  const { root, manifestPath } = await readyFixtureRepo(batchId);
  try {
    const fpA = (await indexData(root, manifestPath)).fingerprint;
    const r1 = revision({ blocking: false, fingerprint: fpA });
    const sheet1 = await importSheet(root, manifestPath, batchId, [r1]);

    // Resolve r1 while it is still the effective request, bound to fpA.
    await respond(
      root,
      manifestPath,
      responsesText(
        batchId,
        fpA,
        fpA,
        [sheet1.sheet.sha256],
        [response(r1.id, { outcome: "not-incorporated" })],
      ),
    );

    // The author then incorporates the change: a source is edited, moving
    // the batch to a new fingerprint fpB, and a new revision r2 (declared
    // as superseding r1) is imported against it.
    const specPath = join(root, "specs", "features", "fixture", "spec.md");
    const original = await readFile(specPath, "utf8");
    await writeFile(specPath, `${original}\n<!-- incorporated -->\n`);
    const fpB = (await indexData(root, manifestPath)).fingerprint;
    const r2 = revision({
      blocking: false,
      fingerprint: fpB,
      supersedes: r1.id,
    });
    const sheet2 = await importSheet(root, manifestPath, batchId, [r2]);

    // Resolve r2 at the NEW current fingerprint fpB.
    await respond(
      root,
      manifestPath,
      responsesText(
        batchId,
        fpB,
        fpB,
        [sheet2.sheet.sha256],
        [response(r2.id, { outcome: "not-incorporated" })],
      ),
    );

    const execution = await run(root, [manifestPath, "--json"]);
    // Without the H2 fix, the OLD (fpA) response record would be
    // re-checked against today's effective requests (which no longer
    // include r1, since r2 superseded it) and permanently report
    // REVIEW_RESPONSE_MISMATCH for answering a now-ineffective id.
    assert.ok(!codesOf(execution).includes("REVIEW_RESPONSE_MISMATCH"));
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST-032/AC-002: --expect-fingerprint alone matches, runs no git, and records expect: { fingerprint }", async () => {
  const batchId = "TST-9718-fixture";
  const { root, manifestPath } = await readyFixtureRepo(batchId);
  try {
    const data = await indexData(root, manifestPath);
    await writeConfirmation(root, batchId, data);
    const semanticReport = await writeSemanticReportFile(
      root,
      batchId,
      data.fingerprint,
    );

    // The fixture repo (review-import-respond-support.mjs's `workspace`)
    // is `git init`ed but has no commit, so HEAD has none yet: if
    // --expect-fingerprint alone ran git, that would surface as
    // REVIEW_PACKET_REVISION_MISMATCH (STALE). REVIEW_READY here proves no
    // git observation ran for --expect-fingerprint alone.
    const withFlag = await run(root, [
      manifestPath,
      "--semantic-report",
      semanticReport,
      "--expect-fingerprint",
      data.fingerprint,
      "--json",
    ]);
    assert.equal(withFlag.result.outcome, "REVIEW_READY");
    assert.ok(!codesOf(withFlag).includes("REVIEW_PACKET_REVISION_MISMATCH"));

    const record = JSON.parse(
      await readFile(join(root, withFlag.result.data.preflightRecord), "utf8"),
    );
    assert.deepEqual(record.expect, { fingerprint: data.fingerprint });
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST-032/AC-002: --expect-fingerprint alone with a non-matching value is REVIEW_STALE with REVIEW_PACKET_FINGERPRINT_MISMATCH", async () => {
  const batchId = "TST-9719-fixture";
  const { root, manifestPath } = await readyFixtureRepo(batchId);
  try {
    const execution = await run(root, [
      manifestPath,
      "--expect-fingerprint",
      "d".repeat(64),
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

test("TST-032/AC-002: --expect-revision alone runs the ADR-015 checks and records expect: { revision }", async () => {
  const batchId = "TST-9720-fixture";
  const { root, manifestPath } = await readyFixtureRepo(batchId);
  try {
    const execution = await run(root, [
      manifestPath,
      "--expect-revision",
      "e".repeat(40),
      "--json",
    ]);
    // The fixture repo has no commit yet, so --expect-revision alone must
    // still trigger the ADR-015 git checks and report the HEAD mismatch,
    // proving it ran independently of --expect-fingerprint.
    assert.ok(codesOf(execution).includes("REVIEW_PACKET_REVISION_MISMATCH"));

    const record = JSON.parse(
      await readFile(join(root, execution.result.data.preflightRecord), "utf8"),
    );
    assert.deepEqual(record.expect, { revision: "e".repeat(40) });
  } finally {
    await cleanupWorkspace(root);
  }
});
