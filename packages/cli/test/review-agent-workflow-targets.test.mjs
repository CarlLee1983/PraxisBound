/**
 * TST-025 §1 (R-005), AC-004 / AC-009: `hash-mismatch`, `anchor-missing`,
 * and `anchor-duplicate` targets (contract §5, `docs/batch-review/agent-workflow.md`
 * §1.3) are never guessed at or overwritten, and an accepted ADR stays
 * byte-identical even when its own target matches.
 *
 * These tests are a scripted, deterministic stand-in for a coding Agent
 * reading that document and operating the existing `review` CLI commands on
 * an isolated temporary repository. They prove only that the CLI accepts or
 * rejects the workflow's inputs the way the document says, and that the
 * scripted steps leave the expected bytes on disk. They do not, and cannot,
 * prove that a real Agent reading the document would make the same stop or
 * question choice for a given target — that judgement is reserved to the
 * separately recorded real-Agent rehearsal (AC-011).
 */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { runReviewRespond } from "../dist/review-respond.js";

import {
  cleanupWorkspace,
  fixtureRepo,
  indexData,
  revision,
} from "./review-import-respond-support.mjs";
import {
  DEFINITION_SOURCES,
  adrLocator,
  assertUnchanged,
  codes,
  hashSources,
  importSheet,
  recordFileNames,
  respond,
  response,
  responsesText,
} from "./review-agent-workflow-support.mjs";

test("TST025-AC-004 / TST025-AC-009: hash-mismatch, anchor-missing, and anchor-duplicate targets are never guessed at or overwritten, and an accepted ADR stays byte-identical", async () => {
  // hash-mismatch: the source changed after the opinion was proposed.
  {
    const batchId = "TST-9406-hash-mismatch";
    const { root, manifestPath } = await fixtureRepo(batchId);
    try {
      const before = await hashSources(root, DEFINITION_SOURCES);
      const data = await indexData(root, manifestPath);
      const rev = revision({
        fingerprint: data.fingerprint,
        targets: [
          {
            path: "specs/features/fixture/spec.md",
            anchor: "R-001",
            blockSha256: "0".repeat(64),
          },
        ],
      });
      const sheet = await importSheet(root, manifestPath, batchId, [rev]);
      assert.equal(sheet.revisions[0].targets[0].match, "hash-mismatch");

      // No source edit: the scripted agent stops and records needs-decision.
      const text = responsesText(
        batchId,
        data.fingerprint,
        data.fingerprint,
        [sheet.sheet.sha256],
        [
          response(rev.id, {
            route: "spec-requirement",
            outcome: "needs-decision",
            rationale: "The targeted content changed after this opinion.",
            question:
              "The R-001 content this opinion targeted has changed; does it still apply to the current R-001 text?",
          }),
        ],
      );
      const execution = await respond(root, manifestPath, text);
      assert.equal(
        execution.result.outcome,
        "success",
        JSON.stringify(execution.result),
      );
      const after = await hashSources(root, DEFINITION_SOURCES);
      assertUnchanged(before, after, DEFINITION_SOURCES);

      // Answering it as incorporated with the stale (mismatched) locator is rejected, and writes nothing.
      const beforeRecords = await recordFileNames(root, batchId);
      const staleAttempt = responsesText(
        batchId,
        data.fingerprint,
        data.fingerprint,
        [sheet.sheet.sha256],
        [
          response(rev.id, {
            route: "spec-requirement",
            outcome: "incorporated",
            rationale: "Incorrectly treating the stale quote as still valid.",
            locators: [
              {
                path: "specs/features/fixture/spec.md",
                anchor: "R-001",
                blockSha256: "0".repeat(64),
              },
            ],
          }),
        ],
      );
      const staleFile = join(root, "..", "stale-attempt.json");
      await writeFile(staleFile, staleAttempt);
      const rejected = await runReviewRespond(
        [manifestPath, staleFile, "--json"],
        root,
      );
      assert.equal(rejected.result.outcome, "failure");
      assert.deepEqual(codes(rejected), ["REVIEW_RESPONSE_INVALID"]);
      const afterRecords = await recordFileNames(root, batchId);
      assert.deepEqual(
        afterRecords.filter((n) => n.startsWith("responses-")),
        beforeRecords.filter((n) => n.startsWith("responses-")),
      );
    } finally {
      await cleanupWorkspace(root);
    }
  }

  // anchor-missing: the target anchor does not exist.
  {
    const batchId = "TST-9407-anchor-missing";
    const { root, manifestPath } = await fixtureRepo(batchId);
    try {
      const before = await hashSources(root, DEFINITION_SOURCES);
      const data = await indexData(root, manifestPath);
      const rev = revision({
        fingerprint: data.fingerprint,
        targets: [
          {
            path: "specs/features/fixture/spec.md",
            anchor: "R-999",
            blockSha256: "1".repeat(64),
          },
        ],
      });
      const sheet = await importSheet(root, manifestPath, batchId, [rev]);
      assert.equal(sheet.revisions[0].targets[0].match, "anchor-missing");

      const text = responsesText(
        batchId,
        data.fingerprint,
        data.fingerprint,
        [sheet.sheet.sha256],
        [
          response(rev.id, {
            route: "spec-requirement",
            outcome: "needs-decision",
            rationale: "The targeted anchor does not exist.",
            question:
              "Which anchor in specs/features/fixture/spec.md did this opinion mean to target?",
          }),
        ],
      );
      const execution = await respond(root, manifestPath, text);
      assert.equal(execution.result.outcome, "success");
      const after = await hashSources(root, DEFINITION_SOURCES);
      assertUnchanged(before, after, DEFINITION_SOURCES);
    } finally {
      await cleanupWorkspace(root);
    }
  }

  // anchor-duplicate: two explicit R-001 headings collide.
  {
    const batchId = "TST-9408-anchor-duplicate";
    const dupSpecText =
      "## R-001：First\n\n- AC-001：line.\n\n## R-001：Second\n\n- AC-001：line.\n";
    const { root, manifestPath } = await fixtureRepo(batchId, {
      "specs/decisions/ADR-001-fixture.md":
        "# ADR-001 Fixture\n\nStatus: accepted\n",
      "specs/features/fixture/spec.md": dupSpecText,
      "specs/stories/RF-001-fixture/story.md": "# Story: RF-001 Fixture\n",
      "specs/stories/RF-001-fixture/acceptance.md":
        "# Acceptance Criteria\n\n* [ ] AC-001: done.\n",
    });
    try {
      const before = await hashSources(root, DEFINITION_SOURCES);
      const data = await indexData(root, manifestPath);
      const rev = revision({
        fingerprint: data.fingerprint,
        targets: [
          {
            path: "specs/features/fixture/spec.md",
            anchor: "R-001",
            blockSha256: "a".repeat(64),
          },
        ],
      });
      const sheet = await importSheet(root, manifestPath, batchId, [rev]);
      assert.equal(sheet.revisions[0].targets[0].match, "anchor-duplicate");

      const text = responsesText(
        batchId,
        data.fingerprint,
        data.fingerprint,
        [sheet.sheet.sha256],
        [
          response(rev.id, {
            route: "spec-requirement",
            outcome: "not-incorporated",
            rationale:
              "R-001 is ambiguous (two headings share the anchor); not applying without a human choosing one.",
          }),
        ],
      );
      const execution = await respond(root, manifestPath, text);
      assert.equal(execution.result.outcome, "success");
      const after = await hashSources(root, DEFINITION_SOURCES);
      assertUnchanged(before, after, DEFINITION_SOURCES);
    } finally {
      await cleanupWorkspace(root);
    }
  }

  // decision against an accepted ADR: even a matching target is never edited or answered incorporated.
  {
    const batchId = "TST-9409-accepted-adr";
    const { root, manifestPath } = await fixtureRepo(batchId);
    try {
      const before = await hashSources(root, DEFINITION_SOURCES);
      const data = await indexData(root, manifestPath);
      const rev = revision({
        fingerprint: data.fingerprint,
        targets: [
          {
            path: "specs/decisions/ADR-001-fixture.md",
            anchor: "ADR-001",
            blockSha256: adrLocator(data, "ADR-001").blockSha256,
          },
        ],
      });
      const sheet = await importSheet(root, manifestPath, batchId, [rev]);
      assert.equal(sheet.revisions[0].targets[0].match, "match");

      const text = responsesText(
        batchId,
        data.fingerprint,
        data.fingerprint,
        [sheet.sheet.sha256],
        [
          response(rev.id, {
            route: "decision",
            outcome: "needs-decision",
            rationale: "An accepted ADR is never edited in place.",
            question: "Should ADR-001 be superseded, and by what?",
          }),
        ],
      );
      const execution = await respond(root, manifestPath, text);
      assert.equal(execution.result.outcome, "success");
      const parsed = JSON.parse(
        await readFile(join(root, execution.result.data.record), "utf8"),
      );
      assert.notEqual(parsed.responses[0].outcome, "incorporated");
      const after = await hashSources(root, DEFINITION_SOURCES);
      assertUnchanged(before, after, ["specs/decisions/ADR-001-fixture.md"]);
    } finally {
      await cleanupWorkspace(root);
    }
  }
});
