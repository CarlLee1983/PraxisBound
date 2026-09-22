/**
 * TST-025 §1 (R-005), AC-002: the four contract routes
 * (`docs/batch-review/agent-workflow.md` §1.4) — `presentation`,
 * `story-derivation`, `spec-requirement`, and `decision` — each edit only
 * the source their boundary owns, and `decision` never edits an accepted
 * ADR in place.
 *
 * These tests are a scripted, deterministic stand-in for a coding Agent
 * reading that document and operating the existing `review` CLI commands on
 * an isolated temporary repository. They prove only that the CLI accepts or
 * rejects the workflow's inputs the way the document says, and that the
 * scripted steps leave the expected bytes on disk. They do not, and cannot,
 * prove that a real Agent reading the document would choose the same route
 * or edit for a given opinion — that judgement is reserved to the
 * separately recorded real-Agent rehearsal (AC-011).
 */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
  cleanupWorkspace,
  fixtureRepo,
  indexData,
  r001BlockSha256,
  revision,
} from "./review-import-respond-support.mjs";
import {
  DEFINITION_SOURCES,
  acceptanceLocator,
  adrLocator,
  assertChanged,
  assertUnchanged,
  hashSources,
  importSheet,
  respond,
  response,
  responsesText,
  specEntryLocator,
} from "./review-agent-workflow-support.mjs";

test("TST025-AC-002: presentation, story-derivation, spec-requirement, and decision each change only their owning source", async () => {
  // presentation: only a renderer-side file outside the declared batch
  // sources changes; the batch fingerprint (computed only from declared
  // sources, contract §4) is unaffected by that edit.
  {
    const batchId = "TST-9402-presentation";
    const { root, manifestPath } = await fixtureRepo(batchId);
    try {
      const rendererNotePath = join(root, "docs", "renderer-notes.md");
      await mkdir(join(root, "docs"), { recursive: true });
      const rendererNoteBefore = "# Renderer notes\n\n(none yet)\n";
      await writeFile(rendererNotePath, rendererNoteBefore);

      const before = await hashSources(root, DEFINITION_SOURCES);
      const data = await indexData(root, manifestPath);
      const rev = revision({
        fingerprint: data.fingerprint,
        targets: [
          {
            path: "specs/features/fixture/spec.md",
            anchor: "R-001",
            blockSha256: r001BlockSha256(data),
          },
        ],
      });
      const sheet = await importSheet(root, manifestPath, batchId, [rev]);

      // The renderer-side edit: not a declared batch source.
      await writeFile(
        rendererNotePath,
        "# Renderer notes\n\nShow R-001's rationale inline instead of in a tooltip.\n",
      );
      const data2 = await indexData(root, manifestPath);
      assert.equal(
        data2.fingerprint,
        data.fingerprint,
        "a renderer-side edit outside the declared sources must not change the batch fingerprint",
      );

      const text = responsesText(
        batchId,
        data.fingerprint,
        data2.fingerprint,
        [sheet.sheet.sha256],
        [
          response(rev.id, {
            route: "presentation",
            outcome: "not-incorporated",
            rationale:
              "Presentation-only: adjusted docs/renderer-notes.md; no definition source needed to change.",
          }),
        ],
      );
      const execution = await respond(root, manifestPath, text);
      assert.equal(execution.result.outcome, "success");
      const after = await hashSources(root, DEFINITION_SOURCES);
      assertUnchanged(before, after, DEFINITION_SOURCES);
      const rendererNoteAfter = await readFile(rendererNotePath, "utf8");
      assert.notEqual(rendererNoteAfter, rendererNoteBefore);
    } finally {
      await cleanupWorkspace(root);
    }
  }

  // story-derivation: only the Story/acceptance file changes.
  {
    const batchId = "TST-9403-story";
    const { root, manifestPath } = await fixtureRepo(batchId);
    try {
      const before = await hashSources(root, DEFINITION_SOURCES);
      const data = await indexData(root, manifestPath);
      const rev = revision({
        fingerprint: data.fingerprint,
        targets: [
          {
            path: "specs/stories/RF-001-fixture/acceptance.md",
            anchor: "AC-001",
            blockSha256: acceptanceLocator(data, "AC-001").blockSha256,
          },
        ],
        kind: "rewrite",
      });
      const sheet = await importSheet(root, manifestPath, batchId, [rev]);
      await writeFile(
        join(root, "specs/stories/RF-001-fixture/acceptance.md"),
        "# Acceptance Criteria\n\n* [ ] AC-001: reworded to match the Spec.\n",
      );
      const data2 = await indexData(root, manifestPath);
      const text = responsesText(
        batchId,
        data.fingerprint,
        data2.fingerprint,
        [sheet.sheet.sha256],
        [
          response(rev.id, {
            route: "story-derivation",
            outcome: "incorporated",
            rationale: "Reworded the acceptance criterion.",
            locators: [acceptanceLocator(data2, "AC-001")],
          }),
        ],
      );
      const execution = await respond(root, manifestPath, text);
      assert.equal(execution.result.outcome, "success");
      const after = await hashSources(root, DEFINITION_SOURCES);
      assertUnchanged(before, after, [
        "specs/decisions/ADR-001-fixture.md",
        "specs/features/fixture/spec.md",
        "specs/stories/RF-001-fixture/story.md",
      ]);
      assertChanged(before, after, [
        "specs/stories/RF-001-fixture/acceptance.md",
      ]);
    } finally {
      await cleanupWorkspace(root);
    }
  }

  // spec-requirement: only the Spec changes.
  {
    const batchId = "TST-9404-spec";
    const { root, manifestPath } = await fixtureRepo(batchId);
    try {
      const before = await hashSources(root, DEFINITION_SOURCES);
      const data = await indexData(root, manifestPath);
      const rev = revision({
        fingerprint: data.fingerprint,
        targets: [
          {
            path: "specs/features/fixture/spec.md",
            anchor: "#document",
            blockSha256: data.sources.find(
              (s) => s.path === "specs/features/fixture/spec.md",
            ).sha256,
          },
        ],
        kind: "add-requirement",
      });
      const sheet = await importSheet(root, manifestPath, batchId, [rev]);
      const specPath = join(root, "specs/features/fixture/spec.md");
      const specBefore = await readFile(specPath, "utf8");
      await writeFile(
        specPath,
        `${specBefore}\n## R-002：New Requirement\n\n- AC-001：line.\n`,
      );
      const data2 = await indexData(root, manifestPath);
      const text = responsesText(
        batchId,
        data.fingerprint,
        data2.fingerprint,
        [sheet.sheet.sha256],
        [
          response(rev.id, {
            route: "spec-requirement",
            outcome: "incorporated",
            rationale: "Added R-002, authorized to modify the Spec.",
            locators: [specEntryLocator(data2, "R-002")],
          }),
        ],
      );
      const execution = await respond(root, manifestPath, text);
      assert.equal(execution.result.outcome, "success");
      const after = await hashSources(root, DEFINITION_SOURCES);
      assertUnchanged(before, after, [
        "specs/decisions/ADR-001-fixture.md",
        "specs/stories/RF-001-fixture/story.md",
        "specs/stories/RF-001-fixture/acceptance.md",
      ]);
      assertChanged(before, after, ["specs/features/fixture/spec.md"]);
    } finally {
      await cleanupWorkspace(root);
    }
  }

  // decision: the accepted ADR is never modified; the response is needs-decision.
  {
    const batchId = "TST-9405-decision";
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
      const text = responsesText(
        batchId,
        data.fingerprint,
        data.fingerprint,
        [sheet.sheet.sha256],
        [
          response(rev.id, {
            route: "decision",
            outcome: "needs-decision",
            rationale: "Cannot change an accepted ADR without a human.",
            question: "Should ADR-001 be superseded, and with what?",
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

  // decision, replacement-ADR proof: a locator on an undeclared path can never
  // be `match`, so an `incorporated` response naming it is structurally
  // impossible without a manifest change (out of this Story's authority).
  // This is a standalone `review import` probe, never answered by `respond`.
  {
    const batchId = "TST-9413-decision-replacement-probe";
    const { root, manifestPath } = await fixtureRepo(batchId);
    try {
      const data = await indexData(root, manifestPath);
      const probe = revision({
        fingerprint: data.fingerprint,
        targets: [
          {
            path: "specs/decisions/ADR-002-fixture-replacement.md",
            anchor: "#document",
            blockSha256: "0".repeat(64),
          },
        ],
      });
      const sheet = await importSheet(root, manifestPath, batchId, [probe]);
      assert.equal(
        sheet.revisions[0].targets[0].match,
        "anchor-missing",
        "a path the manifest never declares can never resolve to a locator",
      );
    } finally {
      await cleanupWorkspace(root);
    }
  }

  // decision, replacement-ADR branch: the scripted agent writes a new
  // `Status: proposed` ADR file, but this Story's authority never extends to
  // editing `batch.json`, so the new file is never a declared batch source.
  // The proof above shows a locator naming it can never be `match`, so
  // `incorporated` is impossible here; the response falls back to
  // `not-incorporated`, naming the proposal file so a human can add it to
  // the manifest and re-propose it.
  {
    const batchId = "TST-9414-decision-replacement";
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

      const replacementPath = join(
        root,
        "specs/decisions/ADR-002-fixture-replacement.md",
      );
      const replacementText =
        "# ADR-002 Fixture Replacement\n\nStatus: proposed\n\nSupersedes: ADR-001-fixture.\n";
      await writeFile(replacementPath, replacementText);

      const data2 = await indexData(root, manifestPath);
      // The new file is not a declared batch source, so it has no effect on
      // the fingerprint or the indexed sources list.
      assert.equal(data2.fingerprint, data.fingerprint);
      assert.ok(
        !data2.sources.some(
          (s) => s.path === "specs/decisions/ADR-002-fixture-replacement.md",
        ),
      );

      const text = responsesText(
        batchId,
        data.fingerprint,
        data2.fingerprint,
        [sheet.sheet.sha256],
        [
          response(rev.id, {
            route: "decision",
            outcome: "not-incorporated",
            rationale:
              "Proposed a replacement decision at specs/decisions/ADR-002-fixture-replacement.md (Status: proposed); it is not declared in the batch manifest, so no locator there can match, and it cannot be recorded as incorporated without a human adding it to batch.json sources.adrs.",
          }),
        ],
      );
      const execution = await respond(root, manifestPath, text);
      assert.equal(
        execution.result.outcome,
        "success",
        JSON.stringify(execution.result),
      );
      const parsed = JSON.parse(
        await readFile(join(root, execution.result.data.record), "utf8"),
      );
      assert.equal(parsed.responses[0].outcome, "not-incorporated");
      assert.ok(
        parsed.responses[0].rationale.includes(
          "specs/decisions/ADR-002-fixture-replacement.md",
        ),
      );

      const after = await hashSources(root, DEFINITION_SOURCES);
      assertUnchanged(before, after, ["specs/decisions/ADR-001-fixture.md"]);
      const replacementOnDisk = await readFile(replacementPath, "utf8");
      assert.equal(replacementOnDisk, replacementText);
      assert.ok(replacementOnDisk.includes("Status: proposed"));
    } finally {
      await cleanupWorkspace(root);
    }
  }
});
