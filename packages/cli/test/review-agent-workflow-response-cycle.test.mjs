/**
 * TST-025 §1 (R-005), AC-001: the vendor-neutral Agent revision workflow
 * (`docs/batch-review/agent-workflow.md` §1) carried end to end — inventory
 * imported opinions, derive the effective set, revise sources at their
 * routed boundaries, and produce exactly one Revision Response per
 * effective id through `review respond`.
 *
 * These tests are a scripted, deterministic stand-in for a coding Agent
 * reading that document and operating the existing `review` CLI commands on
 * an isolated temporary repository. They prove only that the CLI accepts or
 * rejects the workflow's inputs the way the document says, and that the
 * scripted steps leave the expected bytes on disk. They do not, and cannot,
 * prove that a real Agent reading the document would make the same routing
 * or edit choices — that judgement is reserved to the separately recorded
 * real-Agent rehearsal (AC-011).
 */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { runReviewRender } from "../dist/review.js";

import {
  cleanupWorkspace,
  fixtureRepo,
  indexData,
  r001BlockSha256,
  revision,
} from "./review-import-respond-support.mjs";
import {
  acceptanceLocator,
  adrLocator,
  importSheet,
  respond,
  response,
  responsesText,
  specEntryLocator,
} from "./review-agent-workflow-support.mjs";

test("TST025-AC-001: the workflow produces exactly one response per effective revision id, ignoring a superseded one, and the record file equals the input verbatim", async () => {
  const batchId = "TST-9401-workflow";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const data = await indexData(root, manifestPath);

    // A first opinion that is later superseded by a second one carrying the same route.
    const revA = revision({
      fingerprint: data.fingerprint,
      targets: [
        {
          path: "specs/features/fixture/spec.md",
          anchor: "R-001",
          blockSha256: r001BlockSha256(data),
        },
      ],
      kind: "supplement",
      proposal: "Make the renderer show this entry's rationale inline.",
    });
    const sheet1 = await importSheet(root, manifestPath, batchId, [revA]);

    const revSupersedingA = revision({
      fingerprint: data.fingerprint,
      targets: revA.targets,
      supersedes: revA.id,
      proposal: "Instead, show the rationale in a tooltip.",
    });
    const revStory = revision({
      fingerprint: data.fingerprint,
      targets: [
        {
          path: "specs/stories/RF-001-fixture/acceptance.md",
          anchor: "AC-001",
          blockSha256: acceptanceLocator(data, "AC-001").blockSha256,
        },
      ],
      kind: "rewrite",
      proposal: "The acceptance wording drifted from the Spec entry.",
    });
    const revSpec = revision({
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
      proposal: "Add a second requirement, R-002.",
    });
    const revDecision = revision({
      fingerprint: data.fingerprint,
      targets: [
        {
          path: "specs/decisions/ADR-001-fixture.md",
          anchor: "ADR-001",
          blockSha256: adrLocator(data, "ADR-001").blockSha256,
        },
      ],
      kind: "supplement",
      proposal: "Reconsider the accepted decision.",
    });
    const sheet2 = await importSheet(root, manifestPath, batchId, [
      revA,
      revSupersedingA,
      revStory,
      revSpec,
      revDecision,
    ]);

    // Effective ids: revA is superseded, so only the remaining four are answered.
    const effectiveIds = [
      revSupersedingA.id,
      revStory.id,
      revSpec.id,
      revDecision.id,
    ].sort();

    // Authorized edits at the owning boundaries (story-derivation, spec-requirement).
    const acceptancePath = join(
      root,
      "specs/stories/RF-001-fixture/acceptance.md",
    );
    await writeFile(
      acceptancePath,
      "# Acceptance Criteria\n\n* [ ] AC-001: done differently.\n",
    );
    const specPath = join(root, "specs/features/fixture/spec.md");
    const specBefore = await readFile(specPath, "utf8");
    await writeFile(
      specPath,
      `${specBefore}\n## R-002：Second Entry\n\n- AC-001：line.\n`,
    );

    const data2 = await indexData(root, manifestPath);

    const responses = [
      response(revSupersedingA.id, {
        route: "presentation",
        outcome: "not-incorporated",
        rationale:
          "Presentation-only concern; the renderer will be adjusted separately.",
      }),
      response(revStory.id, {
        route: "story-derivation",
        outcome: "incorporated",
        rationale: "Reworded AC-001 to match the governing Spec entry.",
        locators: [acceptanceLocator(data2, "AC-001")],
      }),
      response(revSpec.id, {
        route: "spec-requirement",
        outcome: "incorporated",
        rationale: "Added R-002 to the Spec as authorized.",
        locators: [specEntryLocator(data2, "R-002")],
      }),
      response(revDecision.id, {
        route: "decision",
        outcome: "needs-decision",
        rationale: "Cannot change an accepted ADR without a human decision.",
        question:
          "Should ADR-001 be replaced, and if so with which alternative?",
      }),
    ];
    assert.deepEqual(responses.map((r) => r.revisionId).sort(), effectiveIds);

    const text = responsesText(
      batchId,
      data.fingerprint,
      data2.fingerprint,
      [sheet1.sheet.sha256, sheet2.sheet.sha256],
      responses,
    );
    const execution = await respond(root, manifestPath, text);
    assert.equal(
      execution.result.outcome,
      "success",
      JSON.stringify(execution.result),
    );
    const written = await readFile(
      join(root, execution.result.data.record),
      "utf8",
    );
    assert.equal(written, text);

    const parsed = JSON.parse(written);
    assert.deepEqual(
      parsed.responses.map((r) => r.revisionId).sort(),
      effectiveIds,
    );
    for (const r of parsed.responses) {
      assert.ok(typeof r.route === "string" && r.route.length > 0);
      assert.ok(typeof r.rationale === "string" && r.rationale.length > 0);
      if (r.outcome === "incorporated")
        assert.ok(r.locators.length > 0, `${r.revisionId} needs a locator`);
      else if (r.outcome === "needs-decision")
        assert.ok(
          typeof r.question === "string" && r.question.length > 0,
          `${r.revisionId} needs a question`,
        );
    }

    const render = await runReviewRender(
      [manifestPath, "--output", "review.html", "--json"],
      root,
    );
    assert.equal(
      render.result.outcome,
      "success",
      JSON.stringify(render.result),
    );
    await assert.doesNotReject(() => readFile(join(root, "review.html")));
  } finally {
    await cleanupWorkspace(root);
  }
});
