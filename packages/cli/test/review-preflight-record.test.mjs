import assert from "node:assert/strict";
import { mkdir, readdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
  validateResultEnvelope,
  validateStoredPreflightReportRecord,
} from "@praxisbound/core";

import { runReviewPreflight } from "../dist/review-preflight.js";

import {
  baseFixtureFiles,
  baseManifest,
  cleanupWorkspace,
  fixtureRepo,
  indexData,
} from "./review-import-respond-support.mjs";
import {
  hashSources,
  DEFINITION_SOURCES,
} from "./review-agent-workflow-support.mjs";

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

async function readyFixtureRepo(batchId, manifest = baseManifest(batchId)) {
  return fixtureRepo(batchId, readyFixtureFiles(), manifest);
}

async function writeSemanticReportFile(root) {
  await writeFile(join(root, "semantic-report.json"), "{}");
  return "semantic-report.json";
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

async function run(root, args, options) {
  const execution = await runReviewPreflight(args, root, options);
  assert.deepEqual(validateResultEnvelope(execution.result), {
    ok: true,
    value: execution.result,
  });
  return execution;
}

async function recordsFor(root, batchId) {
  const dir = join(root, "specs", "batches", batchId, "records");
  try {
    return (await readdir(dir)).sort();
  } catch {
    return [];
  }
}

async function preflightRecordsFor(root, batchId) {
  return (await recordsFor(root, batchId)).filter((name) =>
    name.startsWith("preflight-"),
  );
}

test("AC-001: the Preflight Report is written as preflight-<fp12>-1.json and validates against the Core validator", async () => {
  const batchId = "TST-9901-fixture";
  const { root, manifestPath } = await readyFixtureRepo(batchId);
  try {
    const data = await indexData(root, manifestPath);
    await writeConfirmation(root, batchId, data);
    const semanticReport = await writeSemanticReportFile(root);
    const fp12 = data.fingerprint.slice(0, 12);

    const execution = await run(root, [
      manifestPath,
      "--semantic-report",
      semanticReport,
      "--json",
    ]);
    assert.equal(execution.result.outcome, "REVIEW_READY");
    assert.equal(
      execution.result.data.preflightRecord,
      `specs/batches/${batchId}/records/preflight-${fp12}-1.json`,
    );

    const names = await preflightRecordsFor(root, batchId);
    assert.deepEqual(names, [`preflight-${fp12}-1.json`]);

    const bytes = await readFile(
      join(
        root,
        "specs",
        "batches",
        batchId,
        "records",
        `preflight-${fp12}-1.json`,
      ),
      "utf8",
    );
    const parsed = JSON.parse(bytes);
    const validated = validateStoredPreflightReportRecord(parsed, batchId);
    assert.equal(validated.ok, true, JSON.stringify(validated));
    assert.equal(parsed.outcome, "REVIEW_READY");
    assert.equal(parsed.fingerprint, data.fingerprint);
    assert.equal(parsed.semantic.length, 0);
    assert.equal(parsed.semanticReport, null);
    assert.equal(parsed.expect, null);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("AC-006: an identical rerun writes no new file and reports the same path", async () => {
  const batchId = "TST-9902-fixture";
  const { root, manifestPath } = await readyFixtureRepo(batchId);
  try {
    const data = await indexData(root, manifestPath);
    await writeConfirmation(root, batchId, data);
    const semanticReport = await writeSemanticReportFile(root);
    const fp12 = data.fingerprint.slice(0, 12);

    const first = await run(root, [
      manifestPath,
      "--semantic-report",
      semanticReport,
      "--json",
    ]);
    const second = await run(root, [
      manifestPath,
      "--semantic-report",
      semanticReport,
      "--json",
    ]);

    assert.equal(
      first.result.data.preflightRecord,
      second.result.data.preflightRecord,
    );
    const names = await preflightRecordsFor(root, batchId);
    assert.deepEqual(names, [`preflight-${fp12}-1.json`]);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("AC-006: a changed result (different --expect-fingerprint) writes a new -2 file", async () => {
  const batchId = "TST-9903-fixture";
  const { root, manifestPath } = await readyFixtureRepo(batchId);
  try {
    const data = await indexData(root, manifestPath);
    await writeConfirmation(root, batchId, data);
    const semanticReport = await writeSemanticReportFile(root);
    const fp12 = data.fingerprint.slice(0, 12);

    await run(root, [
      manifestPath,
      "--semantic-report",
      semanticReport,
      "--json",
    ]);
    const second = await run(root, [
      manifestPath,
      "--semantic-report",
      semanticReport,
      "--expect-fingerprint",
      "d".repeat(64),
      "--expect-revision",
      "e".repeat(40),
      "--json",
    ]);

    assert.equal(
      second.result.data.preflightRecord,
      `specs/batches/${batchId}/records/preflight-${fp12}-2.json`,
    );
    const names = await preflightRecordsFor(root, batchId);
    assert.deepEqual(names, [
      `preflight-${fp12}-1.json`,
      `preflight-${fp12}-2.json`,
    ]);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("AC-006: 201 pre-existing reports for the same fp12 never block a write, which lands at -202", async () => {
  const batchId = "TST-9904-fixture";
  const { root, manifestPath } = await readyFixtureRepo(batchId);
  try {
    const data = await indexData(root, manifestPath);
    await writeConfirmation(root, batchId, data);
    const semanticReport = await writeSemanticReportFile(root);
    const fp12 = data.fingerprint.slice(0, 12);

    const recordsDir = join(root, "specs", "batches", batchId, "records");
    await mkdir(recordsDir, { recursive: true });
    const validCopy = {
      schemaVersion: "1.0.0",
      batchId,
      fingerprint: data.fingerprint,
      outcome: "REVIEW_INCOMPLETE",
      checkedAt: "2026-09-01T00:00:00Z",
      confirmation: null,
      semanticReport: null,
      mechanical: [],
      semantic: [],
      expect: null,
    };
    for (let n = 1; n <= 201; n += 1) {
      await writeFile(
        join(recordsDir, `preflight-${fp12}-${n}.json`),
        JSON.stringify(validCopy),
      );
    }

    const execution = await run(root, [
      manifestPath,
      "--semantic-report",
      semanticReport,
      "--json",
    ]);
    assert.equal(
      execution.result.data.preflightRecord,
      `specs/batches/${batchId}/records/preflight-${fp12}-202.json`,
    );
    const names = await preflightRecordsFor(root, batchId);
    assert.equal(names.length, 202);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("AC-006: a malformed highest baseline is an advisory REVIEW_RECORD_INVALID, is not used for deduplication, and a new file is still written", async () => {
  const batchId = "TST-9905-fixture";
  const { root, manifestPath } = await readyFixtureRepo(batchId);
  try {
    const data = await indexData(root, manifestPath);
    await writeConfirmation(root, batchId, data);
    const semanticReport = await writeSemanticReportFile(root);
    const fp12 = data.fingerprint.slice(0, 12);

    const recordsDir = join(root, "specs", "batches", batchId, "records");
    await mkdir(recordsDir, { recursive: true });
    await writeFile(join(recordsDir, `preflight-${fp12}-1.json`), "not json");

    const execution = await run(root, [
      manifestPath,
      "--semantic-report",
      semanticReport,
      "--json",
    ]);
    assert.equal(
      execution.result.data.preflightRecord,
      `specs/batches/${batchId}/records/preflight-${fp12}-2.json`,
    );
    assert.ok(
      execution.result.issues.some(
        (entry) => entry.code === "REVIEW_RECORD_INVALID",
      ),
    );
    const invalidDiagnostic = execution.result.data.diagnostics.find(
      (entry) => entry.code === "REVIEW_RECORD_INVALID",
    );
    assert.equal(invalidDiagnostic.severity, "advisory");
    assert.equal(execution.result.outcome, "REVIEW_READY");
  } finally {
    await cleanupWorkspace(root);
  }
});

test("AC-006: a symlinked highest baseline is an advisory REVIEW_RECORD_INVALID, is not used for deduplication, and a new file is still written", async () => {
  const batchId = "TST-9906-fixture";
  const { root, manifestPath } = await readyFixtureRepo(batchId);
  try {
    const data = await indexData(root, manifestPath);
    await writeConfirmation(root, batchId, data);
    const semanticReport = await writeSemanticReportFile(root);
    const fp12 = data.fingerprint.slice(0, 12);

    const recordsDir = join(root, "specs", "batches", batchId, "records");
    await mkdir(recordsDir, { recursive: true });
    const elsewhere = join(root, "..", "elsewhere-preflight.json");
    await writeFile(elsewhere, JSON.stringify({ not: "used" }));
    await symlink(elsewhere, join(recordsDir, `preflight-${fp12}-1.json`));

    const execution = await run(root, [
      manifestPath,
      "--semantic-report",
      semanticReport,
      "--json",
    ]);
    assert.equal(
      execution.result.data.preflightRecord,
      `specs/batches/${batchId}/records/preflight-${fp12}-2.json`,
    );
    assert.ok(
      execution.result.issues.some(
        (entry) => entry.code === "REVIEW_RECORD_INVALID",
      ),
    );
  } finally {
    await cleanupWorkspace(root);
  }
});

test("AC-006: an injected write failure (link throws) yields REVIEW_INCOMPLETE with REVIEW_RECORD_WRITE_FAILED, no preflight file, and no leftover .write-*.tmp", async () => {
  const { defaultRecordFilesystem } = await import("../dist/review-records.js");
  const batchId = "TST-9907-fixture";
  const { root, manifestPath } = await readyFixtureRepo(batchId);
  try {
    const data = await indexData(root, manifestPath);
    await writeConfirmation(root, batchId, data);
    const semanticReport = await writeSemanticReportFile(root);
    const filesystem = {
      ...defaultRecordFilesystem,
      link: async () => {
        throw new Error("injected link failure");
      },
    };

    const execution = await run(
      root,
      [manifestPath, "--semantic-report", semanticReport, "--json"],
      { filesystem },
    );
    assert.equal(execution.result.outcome, "REVIEW_INCOMPLETE");
    assert.ok(
      execution.result.issues.some(
        (entry) => entry.code === "REVIEW_RECORD_WRITE_FAILED",
      ),
    );
    assert.equal(execution.result.data.preflightRecord, undefined);
    const names = await recordsFor(root, batchId);
    assert.deepEqual(
      names.filter(
        (name) => name !== `confirmation-${data.fingerprint.slice(0, 12)}.json`,
      ),
      [],
      "no preflight file and no leftover temp file",
    );
  } finally {
    await cleanupWorkspace(root);
  }
});

test("AC-007: the batch snapshot allows exactly the one new preflight file and nothing else changes", async () => {
  const batchId = "TST-9908-fixture";
  const { root, manifestPath } = await readyFixtureRepo(batchId);
  try {
    const data = await indexData(root, manifestPath);
    await writeConfirmation(root, batchId, data);
    const semanticReport = await writeSemanticReportFile(root);

    const paths = [manifestPath, ...DEFINITION_SOURCES];
    const before = await hashSources(root, paths);
    const namesBefore = await recordsFor(root, batchId);

    await run(root, [
      manifestPath,
      "--semantic-report",
      semanticReport,
      "--json",
    ]);

    const after = await hashSources(root, paths);
    for (const path of paths) assert.equal(before.get(path), after.get(path));

    const namesAfter = await recordsFor(root, batchId);
    const added = namesAfter.filter((name) => !namesBefore.includes(name));
    assert.equal(added.length, 1);
    assert.match(added[0], /^preflight-[0-9a-f]{12}-1\.json$/);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("review round 2 H1: an out-of-range baseline name (21 digits) never wins highest-n, is reported advisory, and allocation is unaffected", async () => {
  const batchId = "TST-9909-fixture";
  const { root, manifestPath } = await readyFixtureRepo(batchId);
  try {
    const data = await indexData(root, manifestPath);
    await writeConfirmation(root, batchId, data);
    const semanticReport = await writeSemanticReportFile(root);
    const fp12 = data.fingerprint.slice(0, 12);

    const recordsDir = join(root, "specs", "batches", batchId, "records");
    await mkdir(recordsDir, { recursive: true });
    // A name that "looks like" a preflight report for the current fp12 but
    // whose digit run is far outside `Number.isSafeInteger` range — this is
    // the exact H1 defect fixture (`Number("100000000000000000000")` loses
    // precision and formats back out as `1e+20`).
    await writeFile(
      join(recordsDir, `preflight-${fp12}-100000000000000000000.json`),
      "not used",
    );

    const execution = await run(root, [
      manifestPath,
      "--semantic-report",
      semanticReport,
      "--json",
    ]);
    // Allocation must land at -1 (the out-of-range name is excluded from
    // highest-n, not -100000000000000000001 and not stuck retrying forever).
    assert.equal(
      execution.result.data.preflightRecord,
      `specs/batches/${batchId}/records/preflight-${fp12}-1.json`,
    );
    assert.notEqual(execution.result.outcome, "ERROR");
    assert.ok(
      execution.result.issues.some(
        (entry) => entry.code === "REVIEW_RECORD_INVALID",
      ),
    );
  } finally {
    await cleanupWorkspace(root);
  }
});

test("review round 2 L2: a symlinked records/ directory is configuration-error REVIEW_PATH_UNSAFE, and nothing is written", async () => {
  const batchId = "TST-9910-fixture";
  const { root, manifestPath } = await readyFixtureRepo(batchId);
  try {
    const batchDir = join(root, "specs", "batches", batchId);
    const outsideTarget = join(root, "..", "outside-records");
    await mkdir(outsideTarget, { recursive: true });
    await symlink(outsideTarget, join(batchDir, "records"));

    const execution = await runReviewPreflight([manifestPath, "--json"], root);
    assert.deepEqual(validateResultEnvelope(execution.result), {
      ok: true,
      value: execution.result,
    });
    assert.equal(execution.result.outcome, "configuration-error");
    assert.equal(execution.result.issues[0].code, "REVIEW_PATH_UNSAFE");
    assert.deepEqual(await readdir(outsideTarget), []);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("review round 2 L3: a baseline whose content fingerprint does not start with its file name's fp12 is advisory REVIEW_RECORD_INVALID and not used for dedup", async () => {
  const batchId = "TST-9911-fixture";
  const { root, manifestPath } = await readyFixtureRepo(batchId);
  try {
    const data = await indexData(root, manifestPath);
    await writeConfirmation(root, batchId, data);
    const semanticReport = await writeSemanticReportFile(root);
    const fp12 = data.fingerprint.slice(0, 12);

    const recordsDir = join(root, "specs", "batches", batchId, "records");
    await mkdir(recordsDir, { recursive: true });
    const mismatched = {
      schemaVersion: "1.0.0",
      batchId,
      // A syntactically valid but different fingerprint than the file
      // name's own fp12 prefix promises.
      fingerprint: "f".repeat(64),
      outcome: "REVIEW_READY",
      checkedAt: "2026-09-01T00:00:00Z",
      confirmation: null,
      semanticReport: null,
      mechanical: [],
      semantic: [],
      expect: null,
    };
    await writeFile(
      join(recordsDir, `preflight-${fp12}-1.json`),
      JSON.stringify(mismatched),
    );

    const execution = await run(root, [
      manifestPath,
      "--semantic-report",
      semanticReport,
      "--json",
    ]);
    assert.equal(
      execution.result.data.preflightRecord,
      `specs/batches/${batchId}/records/preflight-${fp12}-2.json`,
    );
    assert.ok(
      execution.result.issues.some(
        (entry) => entry.code === "REVIEW_RECORD_INVALID",
      ),
    );
  } finally {
    await cleanupWorkspace(root);
  }
});

test("AC-006: a baseline file over the 1 MiB record bound is advisory REVIEW_RECORD_INVALID, not used for deduplication, and a new file is still written", async () => {
  const batchId = "TST-9912-fixture";
  const { root, manifestPath } = await readyFixtureRepo(batchId);
  try {
    const data = await indexData(root, manifestPath);
    await writeConfirmation(root, batchId, data);
    const semanticReport = await writeSemanticReportFile(root);
    const fp12 = data.fingerprint.slice(0, 12);

    const recordsDir = join(root, "specs", "batches", batchId, "records");
    await mkdir(recordsDir, { recursive: true });
    const oversized = "x".repeat(1024 * 1024 + 1);
    await writeFile(join(recordsDir, `preflight-${fp12}-1.json`), oversized);

    const execution = await run(root, [
      manifestPath,
      "--semantic-report",
      semanticReport,
      "--json",
    ]);
    assert.equal(
      execution.result.data.preflightRecord,
      `specs/batches/${batchId}/records/preflight-${fp12}-2.json`,
    );
    assert.ok(
      execution.result.issues.some(
        (entry) => entry.code === "REVIEW_RECORD_INVALID",
      ),
    );
  } finally {
    await cleanupWorkspace(root);
  }
});
