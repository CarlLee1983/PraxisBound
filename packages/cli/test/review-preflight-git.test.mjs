import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { validateResultEnvelope } from "@praxisbound/core";

import { runReviewPreflight } from "../dist/review-preflight.js";
import { nodeReviewGitAdapter } from "../dist/review-git.js";

import {
  baseFixtureFiles,
  baseManifest,
  cleanupWorkspace,
  fixtureRepo,
  indexData,
  writeBatch,
  workspace,
} from "./review-import-respond-support.mjs";

const execFile = promisify(execFileCallback);

// A minimal Story that passes `story check --ready` (same fixture as
// review-preflight-command.test.mjs's AC-001 happy path).
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

async function git(root, args) {
  return execFile("git", args, { cwd: root });
}

async function commitAll(root) {
  await git(root, ["add", "-A"]);
  await git(root, [
    "-c",
    "user.email=test@example.com",
    "-c",
    "user.name=Test",
    "commit",
    "-q",
    "-m",
    "fixture commit",
  ]);
}

async function headCommit(root) {
  const { stdout } = await git(root, ["rev-parse", "HEAD"]);
  return stdout.trim();
}

async function statusPorcelain(root) {
  const { stdout } = await git(root, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ]);
  return stdout;
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

function codesOf(execution) {
  return execution.result.issues.map((entry) => entry.code);
}

test("AC-004: a clean committed batch with matching HEAD yields REVIEW_READY with --expect-revision/--expect-fingerprint", async () => {
  const batchId = "TST-9801-fixture";
  const { root, manifestPath } = await readyFixtureRepo(batchId);
  try {
    await commitAll(root);
    const head = await headCommit(root);
    const data = await indexData(root, manifestPath);
    await writeConfirmation(root, batchId, data);
    const semanticReport = await writeSemanticReportFile(root);

    const execution = await run(root, [
      manifestPath,
      "--semantic-report",
      semanticReport,
      "--expect-fingerprint",
      data.fingerprint,
      "--expect-revision",
      head,
      "--json",
    ]);
    assert.equal(execution.result.outcome, "REVIEW_READY");
    assert.ok(!codesOf(execution).includes("REVIEW_SOURCES_UNCOMMITTED"));
  } finally {
    await cleanupWorkspace(root);
  }
});

test("AC-004: a modified declared source yields REVIEW_BLOCKED with REVIEW_SOURCES_UNCOMMITTED naming that path", async () => {
  const batchId = "TST-9802-fixture";
  const { root, manifestPath } = await readyFixtureRepo(batchId);
  try {
    await commitAll(root);
    const head = await headCommit(root);
    const specPath = join(root, "specs", "features", "fixture", "spec.md");
    await writeFile(
      specPath,
      `${await readFile(specPath, "utf8")}\n<!-- edit -->\n`,
    );
    // The expected fingerprint must match the edited content so only the
    // uncommitted-change check (not a fingerprint mismatch) decides the
    // outcome here.
    const data = await indexData(root, manifestPath);

    const execution = await run(root, [
      manifestPath,
      "--expect-fingerprint",
      data.fingerprint,
      "--expect-revision",
      head,
      "--json",
    ]);
    const uncommitted = execution.result.issues.filter(
      (entry) => entry.code === "REVIEW_SOURCES_UNCOMMITTED",
    );
    assert.ok(
      uncommitted.some(
        (entry) => entry.path === "specs/features/fixture/spec.md",
      ),
    );
    assert.equal(execution.result.outcome, "REVIEW_BLOCKED");
  } finally {
    await cleanupWorkspace(root);
  }
});

test("AC-004: an untracked new declared source yields REVIEW_BLOCKED with REVIEW_SOURCES_UNCOMMITTED", async () => {
  const batchId = "TST-9803-fixture";
  const files = readyFixtureFiles();
  const manifest = baseManifest(batchId);
  manifest.sources.specs.push("specs/features/fixture/extra.md");
  manifest.requirements.push({
    spec: "specs/features/fixture/extra.md",
    anchor: "R-002",
    stories: ["RF-001"],
  });
  files["specs/features/fixture/extra.md"] =
    "## R-002：Extra\n\n- AC-001：line.\n";
  const { root, manifestPath } = await fixtureRepo(batchId, files, manifest);
  try {
    // Commit everything except the newly declared source, so it stays untracked.
    await git(root, [
      "add",
      "-A",
      "--",
      ".",
      ":!specs/features/fixture/extra.md",
    ]);
    await git(root, [
      "-c",
      "user.email=test@example.com",
      "-c",
      "user.name=Test",
      "commit",
      "-q",
      "-m",
      "fixture commit without extra",
    ]);
    const head = await headCommit(root);

    const execution = await run(root, [
      manifestPath,
      "--expect-fingerprint",
      "f".repeat(64),
      "--expect-revision",
      head,
      "--json",
    ]);
    const uncommitted = execution.result.issues.filter(
      (entry) => entry.code === "REVIEW_SOURCES_UNCOMMITTED",
    );
    assert.ok(
      uncommitted.some(
        (entry) => entry.path === "specs/features/fixture/extra.md",
      ),
    );
  } finally {
    await cleanupWorkspace(root);
  }
});

test("AC-004: a modified manifest yields REVIEW_BLOCKED with REVIEW_SOURCES_UNCOMMITTED naming the manifest", async () => {
  const batchId = "TST-9804-fixture";
  const { root, manifestPath } = await readyFixtureRepo(batchId);
  try {
    await commitAll(root);
    const head = await headCommit(root);
    const manifestAbsolute = join(root, manifestPath);
    const manifestJson = JSON.parse(await readFile(manifestAbsolute, "utf8"));
    manifestJson.title = "edited";
    await writeFile(manifestAbsolute, JSON.stringify(manifestJson));

    const execution = await run(root, [
      manifestPath,
      "--expect-fingerprint",
      "f".repeat(64),
      "--expect-revision",
      head,
      "--json",
    ]);
    const uncommitted = execution.result.issues.filter(
      (entry) => entry.code === "REVIEW_SOURCES_UNCOMMITTED",
    );
    assert.ok(uncommitted.some((entry) => entry.path === manifestPath));
  } finally {
    await cleanupWorkspace(root);
  }
});

test("AC-004: a HEAD not matching --expect-revision yields REVIEW_STALE with REVIEW_PACKET_REVISION_MISMATCH", async () => {
  const batchId = "TST-9805-fixture";
  const { root, manifestPath } = await readyFixtureRepo(batchId);
  try {
    await commitAll(root);

    const execution = await run(root, [
      manifestPath,
      "--expect-fingerprint",
      "f".repeat(64),
      "--expect-revision",
      "e".repeat(40),
      "--json",
    ]);
    assert.equal(execution.result.outcome, "REVIEW_STALE");
    assert.ok(codesOf(execution).includes("REVIEW_PACKET_REVISION_MISMATCH"));
  } finally {
    await cleanupWorkspace(root);
  }
});

test("AC-004 (ADR-015): a matching fingerprint and HEAD still yields REVIEW_BLOCKED with REVIEW_SOURCES_UNCOMMITTED when a source is uncommitted", async () => {
  const batchId = "TST-9806-fixture";
  const { root, manifestPath } = await readyFixtureRepo(batchId);
  try {
    await commitAll(root);
    const head = await headCommit(root);

    // Edit a declared source without committing, then take the CURRENT
    // fingerprint (over the edited content) as `--expect-fingerprint`: the
    // naive fingerprint+HEAD shortcut ADR-015 rejects would call this tree
    // clean, since both "match" trivially.
    const specPath = join(root, "specs", "features", "fixture", "spec.md");
    await writeFile(
      specPath,
      `${await readFile(specPath, "utf8")}\n<!-- edit -->\n`,
    );
    const data = await indexData(root, manifestPath);

    const execution = await run(root, [
      manifestPath,
      "--expect-fingerprint",
      data.fingerprint,
      "--expect-revision",
      head,
      "--json",
    ]);
    const codes = codesOf(execution);
    assert.ok(!codes.includes("REVIEW_PACKET_FINGERPRINT_MISMATCH"));
    assert.ok(!codes.includes("REVIEW_PACKET_REVISION_MISMATCH"));
    assert.ok(codes.includes("REVIEW_SOURCES_UNCOMMITTED"));
    assert.equal(execution.result.outcome, "REVIEW_BLOCKED");
  } finally {
    await cleanupWorkspace(root);
  }
});

test("AC-004: a directory outside git yields REVIEW_NOT_A_GIT_REPOSITORY", async () => {
  const batchId = "TST-9807-fixture";
  const files = readyFixtureFiles();
  const manifest = baseManifest(batchId);
  const root = await workspace(async () => {});
  // `workspace()` already runs `git init`; strip it to simulate a plain
  // directory outside any git working tree.
  await execFile("rm", ["-rf", join(root, ".git")]);
  await writeBatch(root, batchId, manifest, files);
  const manifestPath = `specs/batches/${batchId}/batch.json`;
  try {
    const execution = await run(root, [
      manifestPath,
      "--expect-fingerprint",
      "f".repeat(64),
      "--expect-revision",
      "e".repeat(40),
      "--json",
    ]);
    assert.ok(codesOf(execution).includes("REVIEW_NOT_A_GIT_REPOSITORY"));
  } finally {
    await cleanupWorkspace(root);
  }
});

test("AC-004: a git observation adapter reporting `failed` yields ERROR, exit 3", async () => {
  const batchId = "TST-9808-fixture";
  const { root, manifestPath } = await readyFixtureRepo(batchId);
  try {
    const fakeAdapter = { observe: async () => ({ kind: "failed" }) };
    const execution = await runReviewPreflight(
      [
        manifestPath,
        "--expect-fingerprint",
        "f".repeat(64),
        "--expect-revision",
        "e".repeat(40),
        "--json",
      ],
      root,
      { gitAdapter: fakeAdapter },
    );
    assert.deepEqual(validateResultEnvelope(execution.result), {
      ok: true,
      value: execution.result,
    });
    assert.equal(execution.result.outcome, "ERROR");
    assert.equal(execution.result.exit, 3);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("AC-004: without --expect-revision, the git adapter is never called", async () => {
  const batchId = "TST-9809-fixture";
  const { root, manifestPath } = await readyFixtureRepo(batchId);
  try {
    let called = false;
    const fakeAdapter = {
      observe: async () => {
        called = true;
        return { kind: "not-a-repository" };
      },
    };
    await runReviewPreflight([manifestPath, "--json"], root, {
      gitAdapter: fakeAdapter,
    });
    assert.equal(called, false);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("Security matrix: an untracked sibling path containing ESC is observed exactly by the git adapter and never surfaces as a batch issue", async () => {
  const batchId = "TST-9810-fixture";
  const { root, manifestPath } = await readyFixtureRepo(batchId);
  try {
    await commitAll(root);

    // A sibling file outside the declared batch sources: `batch.json`'s own
    // path pattern (`repoPath` in defs.schema.json) forbids a control
    // character, so an ESC-named *declared* source can never exist to begin
    // with — this is the closest fixture the schema allows, and it
    // documents that constraint rather than working around it. It still
    // proves the escaping property end to end: `nodeReviewGitAdapter`
    // reads `git status` in `-z` (NUL-separated) mode, so the raw ESC byte
    // passes through unquoted and unescaped (escaping for a human is the
    // CLI's job, contract §16, applied only when a value reaches human
    // output — never this module's).
    const untrackedName = "untracked-\x1b-sibling.md";
    await writeFile(join(root, untrackedName), "sibling content\n");

    const observation = await nodeReviewGitAdapter.observe(root);
    assert.equal(observation.kind, "observed");
    assert.ok(
      observation.changes.some((change) => change.path === untrackedName),
    );

    // Not a declared batch source or the manifest, so it must never surface
    // as a `REVIEW_SOURCES_UNCOMMITTED` issue.
    const head = await headCommit(root);
    const execution = await run(root, [
      manifestPath,
      "--expect-fingerprint",
      "f".repeat(64),
      "--expect-revision",
      head,
      "--json",
    ]);
    const uncommitted = execution.result.issues.filter(
      (entry) => entry.code === "REVIEW_SOURCES_UNCOMMITTED",
    );
    assert.ok(!uncommitted.some((entry) => entry.path === untrackedName));
  } finally {
    await cleanupWorkspace(root);
  }
});

test("AC-007: git status and HEAD are identical before and after a run", async () => {
  const batchId = "TST-9811-fixture";
  const { root, manifestPath } = await readyFixtureRepo(batchId);
  try {
    await commitAll(root);
    const head = await headCommit(root);

    const beforeStatus = await statusPorcelain(root);
    const beforeHead = await headCommit(root);

    await run(root, [
      manifestPath,
      "--expect-fingerprint",
      "f".repeat(64),
      "--expect-revision",
      head,
      "--json",
    ]);

    const afterStatus = await statusPorcelain(root);
    const afterHead = await headCommit(root);
    assert.equal(afterHead, beforeHead);
    // A preflight report write adds one untracked file under `records/`;
    // every other line of `git status` must stay identical.
    const beforeLines = new Set(
      beforeStatus.split("\n").filter((line) => line.length > 0),
    );
    const afterLines = afterStatus
      .split("\n")
      .filter((line) => line.length > 0);
    const newLines = afterLines.filter((line) => !beforeLines.has(line));
    assert.ok(
      newLines.every((line) => line.includes("/records/")),
      `unexpected git status change: ${JSON.stringify(newLines)}`,
    );
  } finally {
    await cleanupWorkspace(root);
  }
});
