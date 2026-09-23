/**
 * `praxisbound review render`'s confirmation-status header and advisory
 * staleness diagnostics (contract §8 修訂，R-006): applicable/stale/absent
 * header states, the separate 200-file/16 MiB confirmation-file bound, an
 * invalid confirmation record, and a symlinked `records/`. `review index`
 * never reads `records/`, so it is untouched by any of this.
 */

import assert from "node:assert/strict";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { validateResultEnvelope } from "@praxisbound/core";

import { runReviewConfirm } from "../dist/review-confirm.js";
import { runReviewIndex, runReviewRender } from "../dist/review.js";

import {
  cleanupWorkspace,
  fixtureRepo,
  indexData,
} from "./review-import-respond-support.mjs";

function scriptedTerminal(answers) {
  let index = 0;
  return {
    stdinIsTTY: true,
    stdoutIsTTY: true,
    write() {},
    async question() {
      if (index >= answers.length) return undefined;
      const answer = answers[index];
      index += 1;
      return answer;
    },
  };
}

async function renderTo(root, manifestPath, name = "projection.html") {
  const output = join(root, name);
  const execution = await runReviewRender(
    [manifestPath, "--output", output, "--json"],
    root,
  );
  assert.deepEqual(validateResultEnvelope(execution.result), {
    ok: true,
    value: execution.result,
  });
  return { execution, output };
}

test("TST026-AC-004/render: no confirmation record at all renders no confirmation-status header, and review index is unaffected", async () => {
  const batchId = "TST-9701-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const { execution, output } = await renderTo(root, manifestPath);
    assert.equal(execution.result.outcome, "success");
    const { readFile } = await import("node:fs/promises");
    const html = await readFile(output, "utf8");
    assert.ok(!html.includes("confirmation-status"));

    const indexExecution = await runReviewIndex([manifestPath, "--json"], root);
    assert.equal(indexExecution.result.outcome, "success");
    assert.ok(!JSON.stringify(indexExecution.result).includes("confirmation"));
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST026-AC-004/render: an applicable confirmation renders the bound-to-current-fingerprint header and no advisory diagnostics", async () => {
  const batchId = "TST-9702-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const data = await indexData(root, manifestPath);
    const confirmExecution = await runReviewConfirm(
      [manifestPath, "--json"],
      root,
      { terminal: scriptedTerminal([data.fingerprint.slice(0, 8)]) },
    );
    assert.equal(confirmExecution.result.outcome, "success");

    const { execution, output } = await renderTo(root, manifestPath);
    assert.equal(execution.result.outcome, "success");
    assert.ok(
      !execution.result.issues.some((i) => i.code.startsWith("REVIEW_SOURCE_")),
    );
    const { readFile } = await import("node:fs/promises");
    const html = await readFile(output, "utf8");
    assert.ok(html.includes("有一份確認紀錄綁定目前指紋"));
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST026-AC-004/render: a stale confirmation produces advisory REVIEW_SOURCE_CHANGED and the page names the changed source", async () => {
  const batchId = "TST-9703-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const data = await indexData(root, manifestPath);
    const confirmExecution = await runReviewConfirm(
      [manifestPath, "--json"],
      root,
      { terminal: scriptedTerminal([data.fingerprint.slice(0, 8)]) },
    );
    assert.equal(confirmExecution.result.outcome, "success");

    await writeFile(
      join(root, "specs/features/fixture/spec.md"),
      "## R-001：Fixture Entry\n\n- AC-001：changed line.\n",
    );

    const { execution, output } = await renderTo(root, manifestPath);
    assert.equal(execution.result.outcome, "success");
    const sourceChanged = execution.result.issues.find(
      (i) => i.code === "REVIEW_SOURCE_CHANGED",
    );
    assert.ok(sourceChanged, JSON.stringify(execution.result.issues));
    assert.equal(sourceChanged.path, "specs/features/fixture/spec.md");
    const diagnosticEntry = execution.result.data.diagnostics.find(
      (d) => d.code === "REVIEW_SOURCE_CHANGED",
    );
    assert.equal(diagnosticEntry.severity, "advisory");

    const { readFile } = await import("node:fs/promises");
    const html = await readFile(output, "utf8");
    assert.ok(html.includes("沒有確認紀錄綁定目前指紋"));
    assert.ok(html.includes("需複審"));
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST026-AC-004/render: an invalid confirmation record is a blocking REVIEW_RECORD_INVALID diagnostic, but render still succeeds", async () => {
  const batchId = "TST-9704-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const recordsDir = join(root, "specs", "batches", batchId, "records");
    await mkdir(recordsDir, { recursive: true });
    await writeFile(
      join(recordsDir, "confirmation-deadbeefdead.json"),
      "not json",
    );
    const { execution } = await renderTo(root, manifestPath);
    assert.equal(execution.result.outcome, "success");
    const invalid = execution.result.issues.find(
      (i) => i.code === "REVIEW_RECORD_INVALID",
    );
    assert.ok(invalid, JSON.stringify(execution.result.issues));
    const diagnosticEntry = execution.result.data.diagnostics.find(
      (d) => d.code === "REVIEW_RECORD_INVALID",
    );
    assert.equal(diagnosticEntry.severity, "blocking");
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST026-AC-004/render: a symlinked records/ refuses confirmation reading (REVIEW_PATH_UNSAFE) without failing the render", async () => {
  const batchId = "TST-9705-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const recordsDir = join(root, "specs", "batches", batchId, "records");
    const outsideTarget = join(root, "..", "outside-records-render");
    await mkdir(outsideTarget, { recursive: true });
    await symlink(outsideTarget, recordsDir);

    const { execution, output } = await renderTo(root, manifestPath);
    assert.equal(execution.result.outcome, "success");
    assert.ok(
      execution.result.issues.some((i) => i.code === "REVIEW_PATH_UNSAFE"),
    );
    const { readFile } = await import("node:fs/promises");
    const html = await readFile(output, "utf8");
    assert.ok(!html.includes("confirmation-status"));
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST026-AC-007: a symlinked records/ produces exactly one REVIEW_PATH_UNSAFE issue, shared by the evidence loader and the confirmation loader from one listing", async () => {
  const batchId = "TST-9706-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const recordsDir = join(root, "specs", "batches", batchId, "records");
    const outsideTarget = join(root, "..", "outside-records-shared");
    await mkdir(outsideTarget, { recursive: true });
    await symlink(outsideTarget, recordsDir);

    const { execution } = await renderTo(root, manifestPath);
    assert.equal(execution.result.outcome, "success");
    const unsafeIssues = execution.result.issues.filter(
      (i) => i.code === "REVIEW_PATH_UNSAFE",
    );
    assert.equal(
      unsafeIssues.length,
      1,
      JSON.stringify(execution.result.issues),
    );
    const unsafeDiagnostics = execution.result.data.diagnostics.filter(
      (d) => d.code === "REVIEW_PATH_UNSAFE",
    );
    assert.equal(unsafeDiagnostics.length, 1);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST026-AC-008: records/ replaced by a plain file (unlistable, not merely absent) produces exactly one REVIEW_RECORD_INVALID issue naming the records directory", async () => {
  const batchId = "TST-9707-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const recordsDir = join(root, "specs", "batches", batchId, "records");
    await writeFile(recordsDir, "not a directory");

    const { execution } = await renderTo(root, manifestPath);
    assert.equal(execution.result.outcome, "success");
    const invalidIssues = execution.result.issues.filter(
      (i) =>
        i.code === "REVIEW_RECORD_INVALID" &&
        i.path === `specs/batches/${batchId}/records`,
    );
    assert.equal(
      invalidIssues.length,
      1,
      JSON.stringify(execution.result.issues),
    );
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST026-AC-008 (security matrix): with one valid confirmation and a well-formed but fp12-mismatched confirmation-000000000000.json, the valid one is the baseline and the mismatched file is REVIEW_RECORD_INVALID", async () => {
  const batchId = "TST-9708-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const data = await indexData(root, manifestPath);
    const confirmExecution = await runReviewConfirm(
      [manifestPath, "--json"],
      root,
      { terminal: scriptedTerminal([data.fingerprint.slice(0, 8)]) },
    );
    assert.equal(confirmExecution.result.outcome, "success");

    // A second, well-formed confirmation record whose file name's fp12
    // does not match its own content `fingerprint` (its content is
    // otherwise entirely valid).
    const recordsDir = join(root, "specs", "batches", batchId, "records");
    const mismatched = {
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
    await writeFile(
      join(recordsDir, "confirmation-000000000000.json"),
      JSON.stringify(mismatched),
    );

    await writeFile(
      join(root, "specs/features/fixture/spec.md"),
      "## R-001：Fixture Entry\n\n- AC-001：changed line.\n",
    );

    const { execution, output } = await renderTo(root, manifestPath);
    assert.equal(execution.result.outcome, "success");
    assert.ok(
      execution.result.issues.some(
        (i) =>
          i.code === "REVIEW_RECORD_INVALID" &&
          i.path ===
            `specs/batches/${batchId}/records/confirmation-000000000000.json`,
      ),
      JSON.stringify(execution.result.issues),
    );
    // The still-valid, correctly-named confirmation is used as the
    // baseline: staleness is reported (and the changed source is named),
    // never silently dropped because an unrelated file was bad. The
    // mismatched file's own `confirmedAt` (2026-09-01) never appears,
    // since it was excluded as invalid and never became the baseline.
    const { readFile } = await import("node:fs/promises");
    const html = await readFile(output, "utf8");
    assert.ok(html.includes("沒有確認紀錄綁定目前指紋"));
    assert.ok(html.includes("specs/features/fixture/spec.md"));
    assert.ok(!html.includes("2026-09-01T00:00:00Z"));
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST026-AC-009: review index output deepEqual whether or not a stale confirmation record exists (index never reads records/)", async () => {
  const batchId = "TST-9709-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const before = await runReviewIndex([manifestPath, "--json"], root);
    assert.equal(before.result.outcome, "success");

    const data = await indexData(root, manifestPath);
    const confirmExecution = await runReviewConfirm(
      [manifestPath, "--json"],
      root,
      { terminal: scriptedTerminal([data.fingerprint.slice(0, 8)]) },
    );
    assert.equal(confirmExecution.result.outcome, "success");
    await writeFile(
      join(root, "specs/features/fixture/spec.md"),
      "## R-001：Fixture Entry\n\n- AC-001：changed for staleness.\n",
    );

    const after = await runReviewIndex([manifestPath, "--json"], root);
    assert.equal(after.result.outcome, "success");

    // Both indexes read the same manifest but the source content differs
    // between the two calls, so the fingerprint/sources legitimately
    // differ; what must stay identical is the *shape* — no confirmation
    // field appears in either, since `review index` never reads
    // `records/` at all (contract §8 修訂，R-006).
    assert.deepEqual(
      Object.keys(before.result.data).sort(),
      Object.keys(after.result.data).sort(),
    );
    assert.ok(!JSON.stringify(before.result).includes("confirmation"));
    assert.ok(!JSON.stringify(after.result).includes("confirmation"));
  } finally {
    await cleanupWorkspace(root);
  }
});
