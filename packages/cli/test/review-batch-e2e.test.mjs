import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { runReviewConfirm } from "../dist/review-confirm.js";

import {
  revision,
  sheetText,
  sha256Hex,
} from "./review-import-respond-support.mjs";
import {
  BATCH_ID,
  DEPENDENCIES,
  STORY_IDS,
  expectOutcome,
  fixture,
  manifest,
  readJson,
  semanticReport,
  terminal,
} from "./review-batch-e2e-support.mjs";

const args = (fixture) => [fixture.manifestPath, "--json"];
const bin = fileURLToPath(
  new globalThis.URL("../dist/bin.js", import.meta.url),
);
function cli(fx, command, commandArgs = []) {
  const child = spawnSync(
    globalThis.process.execPath,
    [bin, "review", command, ...commandArgs, "--json"],
    { cwd: fx.root, encoding: "utf8" },
  );
  assert.equal(child.stderr, "", child.stderr);
  const result = JSON.parse(child.stdout);
  assert.equal(child.status, result.exit, JSON.stringify(result));
  return { result };
}
const index = (fx) => cli(fx, "index", [fx.manifestPath]);
const render = (fx) =>
  cli(fx, "render", [fx.manifestPath, "--output", "review.html"]);
const preflight = (fx, report = "semantic-report.json") =>
  cli(fx, "preflight", [fx.manifestPath, "--semantic-report", report]);
const goalPlan = (fx, report = "semantic-report.json") =>
  cli(fx, "goal-plan", [fx.manifestPath, "--semantic-report", report]);
const codes = (execution) => execution.result.issues.map((issue) => issue.code);

async function confirm(fixture, fingerprint, answers = []) {
  const tty = terminal([...answers, fingerprint.slice(0, 8)]);
  const execution = await runReviewConfirm(args(fixture), fixture.root, {
    terminal: tty,
    now: () => new Date("2026-09-27T00:00:00Z"),
  });
  return { execution, tty };
}

async function setupConfirmed() {
  const fx = await fixture();
  const current = await index(fx);
  expectOutcome(current, "success");
  await semanticReport(fx.root, current.result.data.fingerprint);
  const confirmed = await confirm(fx, current.result.data.fingerprint);
  expectOutcome(confirmed.execution, "success");
  return { ...fx, fingerprint: current.result.data.fingerprint };
}

async function withFixture(body) {
  const fx = await fixture();
  try {
    await body(fx);
  } finally {
    await fx.cleanup();
  }
}

// ForgePilot 3a76aca outputs recorded during TST-035 supply the replay shape.
// Work-add payloads are explicitly rebound to this fixture's four nodes. The
// fourth uses a copied recorded output shape; it is not a ForgePilot run.
const recordedPath = fileURLToPath(
  new globalThis.URL(
    "../../../specs/stories/TST-035-forgepilot-second-segment/evidence/observations/obs-segment1.json",
    import.meta.url,
  ),
);
async function replay(fx, planExecution, overrides = {}) {
  const recorded = JSON.parse(await readFile(recordedPath, "utf8"));
  const goalPlanPath = `${planExecution.result.data.goalPlanDirectory}/manifest.json`;
  const bytes = await readFile(join(fx.root, goalPlanPath));
  const plan = JSON.parse(bytes);
  const steps = recorded.steps.map((step) => ({ ...step }));
  const recordedAdds = steps.filter((step) => step.command === "work-add");
  assert.equal(
    recordedAdds.length,
    3,
    "the provenance record must have three work-add outputs",
  );
  const insertion = steps.findIndex(
    (step) => step.command === "goal-preflight",
  );
  steps.splice(
    insertion,
    0,
    { ...recorded.steps.find((step) => step.command === "preflight") },
    { ...recordedAdds.at(-1) },
  );
  let added = 0;
  for (const step of steps) {
    if (step.command !== "work-add") continue;
    const node = plan.nodes[added];
    const payload = JSON.parse(step.stdout);
    const workItemId = `WI-00${added + 1}`;
    step.story = node.nodeRef;
    step.workItemId = workItemId;
    payload.work_item.id = workItemId;
    payload.work_item.goal_id = plan.plan.id;
    payload.work_item.story_ref = node.storyRef;
    payload.work_item.external_ref = node.nodeRef;
    payload.work_item.depends_on = node.dependsOn.map(
      (id) => `WI-00${STORY_IDS.indexOf(id) + 1}`,
    );
    step.stdout = JSON.stringify(payload);
    added += 1;
  }
  assert.equal(added, 4);
  const observation = {
    ...recorded,
    batchId: BATCH_ID,
    fingerprint: fx.fingerprint,
    goalPlan: { path: goalPlanPath, sha256: sha256Hex(bytes) },
    goalId: plan.plan.id,
    steps,
    ...overrides,
  };
  await writeFile(
    join(fx.root, "observation.json"),
    JSON.stringify(observation),
  );
  return cli(fx, "observe", [fx.manifestPath, "observation.json"]);
}

test("R-009/AC-001 TST-038/AC-001..005: two-Spec four-Story review to accepted recorded observation", async () => {
  await withFixture(async (fx) => {
    const { stdout } = await import("node:child_process").then(
      ({ execFile }) =>
        new Promise((resolve, reject) =>
          execFile("make", ["verify"], { cwd: fx.root }, (error, out) =>
            error ? reject(error) : resolve({ stdout: out }),
          ),
        ),
    );
    assert.match(stdout, /fixture-verify-pass/);
    const first = await index(fx);
    expectOutcome(first, "success");
    assert.equal(first.result.data.specs.length, 2);
    assert.equal(first.result.data.stories.length, 4);
    expectOutcome(await render(fx), "success");
    const firstHtml = await readFile(join(fx.root, "review.html"), "utf8");
    assert.match(firstHtml, /Alpha/);
    assert.match(firstHtml, /Beta/);
    const originalConfirmation = await confirm(
      fx,
      first.result.data.fingerprint,
    );
    expectOutcome(originalConfirmation.execution, "success");
    assert.equal(
      (
        await readJson(
          fx.root,
          originalConfirmation.execution.result.data.record,
        )
      ).fingerprint,
      first.result.data.fingerprint,
    );

    const specPath = "specs/features/alpha/spec.md";
    const locator = first.result.data.specs[0].entries.find(
      (entry) => entry.id === "R-001",
    ).locator;
    const request = revision({
      fingerprint: first.result.data.fingerprint,
      targets: [
        { path: specPath, anchor: "R-001", blockSha256: locator.blockSha256 },
      ],
      kind: "rewrite",
      blocking: true,
      proposal: "Clarify alpha acceptance.",
    });
    await writeFile(
      join(fx.root, "sheet.md"),
      sheetText(BATCH_ID, first.result.data.fingerprint, [request]),
    );
    const imported = cli(fx, "import", [fx.manifestPath, "sheet.md"]);
    expectOutcome(imported, "success");
    await writeFile(
      join(fx.root, specPath),
      "## R-001：Alpha clarified\n\n- AC-001：The clarified alpha behavior works.\n",
    );
    const revised = await index(fx);
    expectOutcome(revised, "success");
    assert.notEqual(
      revised.result.data.fingerprint,
      first.result.data.fingerprint,
    );
    const revisedLocator = revised.result.data.specs[0].entries.find(
      (entry) => entry.id === "R-001",
    ).locator;
    const response = {
      schemaVersion: "1.0.0",
      batchId: BATCH_ID,
      fromFingerprint: first.result.data.fingerprint,
      toFingerprint: revised.result.data.fingerprint,
      revisionSheets: [imported.result.data.sheet.sha256],
      respondedAt: "2026-09-27T00:00:00Z",
      agent: "e2e-fixture-agent",
      responses: [
        {
          revisionId: request.id,
          route: "spec-requirement",
          outcome: "incorporated",
          rationale: "Clarified the alpha requirement.",
          locators: [revisedLocator],
        },
      ],
    };
    await writeFile(join(fx.root, "response.json"), JSON.stringify(response));
    expectOutcome(
      cli(fx, "respond", [fx.manifestPath, "response.json"]),
      "success",
    );
    const revisedRender = render(fx);
    expectOutcome(revisedRender, "success");
    assert.ok(
      revisedRender.result.issues.some(
        (issue) =>
          issue.code === "REVIEW_SOURCE_CHANGED" && issue.path === specPath,
      ),
    );
    const secondHtml = await readFile(join(fx.root, "review.html"), "utf8");
    assert.match(secondHtml, /Alpha clarified/);
    assert.match(secondHtml, /需複審/);
    assert.match(secondHtml, /沒有確認紀錄綁定目前指紋/);
    assert.match(
      secondHtml,
      /內容變動：<span class="doc-path">specs\/features\/alpha\/spec\.md<\/span>/,
    );
    assert.match(
      secondHtml,
      new RegExp(`data-pb-fingerprint="${revised.result.data.fingerprint}"`),
    );
    assert.notEqual(secondHtml, firstHtml);

    const confirmed = await confirm(fx, revised.result.data.fingerprint);
    expectOutcome(confirmed.execution, "success");
    assert.ok(
      confirmed.tty.transcript.some((line) =>
        line.includes(revised.result.data.fingerprint.slice(0, 8)),
      ),
    );
    const confirmation = await readJson(
      fx.root,
      confirmed.execution.result.data.record,
    );
    assert.equal(confirmation.claim, "explicit-terminal-confirmation");
    assert.equal(confirmation.fingerprint, revised.result.data.fingerprint);
    assert.notEqual(
      confirmed.execution.result.data.record,
      originalConfirmation.execution.result.data.record,
    );
    expectOutcome(render(fx), "success");
    const finalHtml = await readFile(join(fx.root, "review.html"), "utf8");
    assert.match(finalHtml, /有一份確認紀錄綁定目前指紋/);
    assert.doesNotMatch(finalHtml, /需複審/);
    await semanticReport(fx.root, revised.result.data.fingerprint);
    expectOutcome(await preflight(fx), "REVIEW_READY");
    expectOutcome(cli(fx, "readiness-digests", [fx.manifestPath]), "success");
    const planExecution = await goalPlan(fx);
    expectOutcome(planExecution, "REVIEW_READY");
    const plan = await readJson(
      fx.root,
      `${planExecution.result.data.goalPlanDirectory}/manifest.json`,
    );
    assert.deepEqual(
      plan.nodes.map((node) => node.nodeRef),
      STORY_IDS,
    );
    for (const node of plan.nodes)
      assert.deepEqual(
        node.dependsOn,
        DEPENDENCIES.find((edge) => edge.story === node.nodeRef)?.dependsOn ??
          [],
      );
    const fxWithFingerprint = {
      ...fx,
      fingerprint: revised.result.data.fingerprint,
    };
    const observed = await replay(fxWithFingerprint, planExecution);
    expectOutcome(observed, "success");
    const record = await readJson(fx.root, observed.result.data.record);
    const workAdds = record.steps.filter((step) => step.command === "work-add");
    assert.equal(workAdds.length, 4);
    for (const [position, step] of workAdds.entries()) {
      const work = JSON.parse(step.stdout).work_item;
      assert.equal(step.story, STORY_IDS[position]);
      assert.equal(step.workItemId, `WI-00${position + 1}`);
      assert.equal(work.id, step.workItemId);
      assert.equal(work.external_ref, STORY_IDS[position]);
      assert.equal(work.story_ref, plan.nodes[position].storyRef);
      assert.equal(work.goal_id, plan.plan.id);
      assert.deepEqual(
        work.depends_on,
        plan.nodes[position].dependsOn.map(
          (id) => `WI-00${STORY_IDS.indexOf(id) + 1}`,
        ),
      );
    }
    assert.equal(
      record.goalPlan.sha256,
      sha256Hex(await readFile(join(fx.root, record.goalPlan.path))),
    );
  });
});

async function mutateManifest(fx, change) {
  const updated = manifest();
  change(updated);
  await writeFile(join(fx.root, fx.manifestPath), JSON.stringify(updated));
}

for (const [name, change, code] of [
  [
    "unmapped requirement",
    (value) => {
      value.requirements[0].stories = ["FX-999"];
    },
    "REVIEW_REQUIREMENT_UNMAPPED",
  ],
  [
    "external dependency",
    (value) => {
      value.dependencies.push({ story: "FX-004", dependsOn: ["FX-999"] });
    },
    "REVIEW_STORY_UNKNOWN",
  ],
  [
    "dependency cycle",
    (value) => {
      value.dependencies.push({ story: "FX-001", dependsOn: ["FX-004"] });
    },
    "REVIEW_DEPENDENCY_CYCLE",
  ],
]) {
  test(`TST-038/AC-006: ${name} blocks preflight on the four-Story batch`, async () => {
    const fx = await fixture();
    try {
      await mutateManifest(fx, change);
      const result = await preflight(fx);
      expectOutcome(result, "REVIEW_BLOCKED");
      assert.ok(codes(result).includes(code), JSON.stringify(result.result));
    } finally {
      await fx.cleanup();
    }
  });
}

test("TST-038/AC-006: a source edit after confirmation returns stale and prevents a Goal Plan", async () => {
  const fx = await setupConfirmed();
  try {
    const path = join(fx.root, "specs/features/alpha/spec.md");
    await writeFile(
      path,
      `${await readFile(path, "utf8")}\n<!-- changed -->\n`,
    );
    const result = await preflight(fx);
    expectOutcome(result, "REVIEW_STALE");
    assert.ok(codes(result).includes("REVIEW_CONFIRMATION_STALE"));
    expectOutcome(await goalPlan(fx), "REVIEW_STALE");
  } finally {
    await fx.cleanup();
  }
});

test("TST-038/AC-006: missing Semantic Report prevents Goal Plan", async () => {
  const fx = await setupConfirmed();
  try {
    const result = await goalPlan(fx, "missing-report.json");
    expectOutcome(result, "REVIEW_INCOMPLETE");
    assert.ok(codes(result).includes("REVIEW_SEMANTIC_MISSING"));
  } finally {
    await fx.cleanup();
  }
});

test("TST-038/AC-006: stale Revision Sheet is retained as historical feedback", async () => {
  await withFixture(async (fx) => {
    const first = await index(fx);
    const locator = first.result.data.specs[0].entries.find(
      (entry) => entry.id === "R-001",
    ).locator;
    const request = revision({
      fingerprint: first.result.data.fingerprint,
      targets: [
        {
          path: "specs/features/alpha/spec.md",
          anchor: "R-001",
          blockSha256: locator.blockSha256,
        },
      ],
    });
    const path = join(fx.root, "specs/features/alpha/spec.md");
    await writeFile(
      path,
      `${await readFile(path, "utf8")}\n<!-- changed -->\n`,
    );
    await writeFile(
      join(fx.root, "stale-sheet.md"),
      sheetText(BATCH_ID, first.result.data.fingerprint, [request]),
    );
    const result = cli(fx, "import", [fx.manifestPath, "stale-sheet.md"]);
    expectOutcome(result, "success");
    assert.ok(codes(result).includes("REVIEW_REVISION_STALE_TARGET"));
    assert.equal(result.result.data.revisions[0].status, "new");
  });
});

test("TST-038/AC-006: an unresolved blocking request prevents confirmation", async () => {
  await withFixture(async (fx) => {
    const first = await index(fx);
    const locator = first.result.data.specs[0].entries.find(
      (entry) => entry.id === "R-001",
    ).locator;
    const request = revision({
      fingerprint: first.result.data.fingerprint,
      blocking: true,
      targets: [
        {
          path: "specs/features/alpha/spec.md",
          anchor: "R-001",
          blockSha256: locator.blockSha256,
        },
      ],
    });
    await writeFile(
      join(fx.root, "blocking-sheet.md"),
      sheetText(BATCH_ID, first.result.data.fingerprint, [request]),
    );
    expectOutcome(
      cli(fx, "import", [fx.manifestPath, "blocking-sheet.md"]),
      "success",
    );
    const confirmed = await confirm(fx, first.result.data.fingerprint);
    expectOutcome(confirmed.execution, "failure");
    assert.ok(
      codes(confirmed.execution).includes("REVIEW_UNRESOLVED_BLOCKING"),
    );
  });
});

test("TST-038/AC-006: recorded unauthorized run is accepted only as run-failed evidence", async () => {
  const fx = await setupConfirmed();
  try {
    const plan = await goalPlan(fx);
    expectOutcome(plan, "REVIEW_READY");
    const recorded = JSON.parse(
      await readFile(
        fileURLToPath(
          new globalThis.URL(
            "../../../specs/stories/TST-035-forgepilot-second-segment/evidence/observations/obs-ac004-unauthorized.json",
            import.meta.url,
          ),
        ),
        "utf8",
      ),
    );
    const result = await replay(fx, plan, {
      steps: recorded.steps,
      stoppedBecause: recorded.stoppedBecause,
    });
    expectOutcome(result, "success");
    const written = await readJson(fx.root, result.result.data.record);
    assert.equal(written.stoppedBecause, "run-failed");
    assert.equal(written.steps.at(-1).command, "run");
    assert.notEqual(written.steps.at(-1).exit, 0);
  } finally {
    await fx.cleanup();
  }
});

test("TST-038/AC-006: observation with no earlier successful preflight is rejected without a record", async () => {
  const fx = await setupConfirmed();
  try {
    const plan = await goalPlan(fx);
    expectOutcome(plan, "REVIEW_READY");
    const recorded = JSON.parse(await readFile(recordedPath, "utf8"));
    const steps = recorded.steps.filter((step) => step.command !== "preflight");
    const result = await replay(fx, plan, { steps });
    expectOutcome(result, "failure");
    assert.ok(codes(result).includes("REVIEW_OBSERVATION_INVALID"));
    assert.equal(result.result.data?.record, undefined);
    const records = await readdir(
      join(fx.root, "specs/batches", BATCH_ID, "records"),
    );
    assert.deepEqual(
      records.filter((name) => name.startsWith("forgepilot-")),
      [],
    );
  } finally {
    await fx.cleanup();
  }
});
