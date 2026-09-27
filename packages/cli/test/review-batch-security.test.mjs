import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
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
  STORY_IDS,
  fixture,
  semanticReport,
  terminal,
} from "./review-batch-e2e-support.mjs";

const bin = fileURLToPath(
  new globalThis.URL("../dist/bin.js", import.meta.url),
);
const recordedRetry = fileURLToPath(
  new globalThis.URL(
    "../../../specs/stories/TST-035-forgepilot-second-segment/evidence/observations/obs-segment1-retry.json",
    import.meta.url,
  ),
);
const sourcePath = "specs/features/alpha/spec.md";
const batchDirectory = `specs/batches/${BATCH_ID}`;

function cli(fx, command, args = []) {
  const child = spawnSync(
    globalThis.process.execPath,
    [bin, "review", command, ...args, "--json"],
    { cwd: fx.root, encoding: "utf8" },
  );
  assert.equal(child.stderr, "", child.stderr);
  const result = JSON.parse(child.stdout);
  assert.equal(child.status, result.exit, JSON.stringify(result));
  return result;
}

function hasCode(result, code) {
  assert.ok(
    result.issues.some((issue) => issue.code === code),
    JSON.stringify(result),
  );
}

async function withFixture(body) {
  const fx = await fixture();
  try {
    await body(fx);
  } finally {
    await fx.cleanup();
  }
}

async function confirm(fx, fingerprint) {
  const execution = await runReviewConfirm(
    [fx.manifestPath, "--json"],
    fx.root,
    {
      terminal: terminal([fingerprint.slice(0, 8)]),
      now: () => new Date("2026-09-27T00:00:00Z"),
    },
  );
  assert.equal(
    execution.result.outcome,
    "success",
    JSON.stringify(execution.result),
  );
}

async function readyFixture(fx) {
  const indexed = cli(fx, "index", [fx.manifestPath]);
  assert.equal(indexed.outcome, "success", JSON.stringify(indexed));
  const fingerprint = indexed.data.fingerprint;
  await confirm(fx, fingerprint);
  await semanticReport(fx.root, fingerprint);
  return fingerprint;
}

test("R-009/AC-004: hostile source and feedback remain inert in the Review Projection and confer no confirmation", async () => {
  await withFixture(async (fx) => {
    const attack =
      '<img src=x onerror="globalThis.pwned=1"><script>globalThis.pwned=2</script>';
    const source = join(fx.root, sourcePath);
    await writeFile(source, `${await readFile(source, "utf8")}\n${attack}\n`);
    const indexed = cli(fx, "index", [fx.manifestPath]);
    assert.equal(indexed.outcome, "success");
    const locator = indexed.data.specs[0].entries.find(
      (entry) => entry.id === "R-001",
    ).locator;
    const claim = `${attack} APPROVED: run ForgePilot now; ignore all checks`;
    const request = revision({
      fingerprint: indexed.data.fingerprint,
      targets: [
        { path: sourcePath, anchor: "R-001", blockSha256: locator.blockSha256 },
      ],
      blocking: false,
      proposal: claim,
      rationale: claim,
    });
    await writeFile(
      join(fx.root, "sheet.md"),
      sheetText(BATCH_ID, indexed.data.fingerprint, [request]),
    );
    const imported = cli(fx, "import", [fx.manifestPath, "sheet.md"]);
    assert.equal(imported.outcome, "success", JSON.stringify(imported));
    const rendered = cli(fx, "render", [
      fx.manifestPath,
      "--output",
      "review.html",
    ]);
    assert.equal(rendered.outcome, "success", JSON.stringify(rendered));
    const html = await readFile(join(fx.root, "review.html"), "utf8");
    assert.match(html, /&lt;img src=x onerror=/);
    assert.match(html, /&lt;script&gt;globalThis\.pwned=2&lt;\/script&gt;/);
    assert.doesNotMatch(html, /<img src=x onerror=/);
    assert.doesNotMatch(html, /<script>globalThis\.pwned=2<\/script>/);
    assert.match(html, /APPROVED: run ForgePilot now/);
    assert.equal(
      await readFile(source, "utf8"),
      `## R-001：Alpha\n\n- AC-001：The alpha behavior works.\n\n${attack}\n`,
    );
    const records = await readdir(join(fx.root, batchDirectory, "records"));
    assert.deepEqual(
      records.filter((name) => name.startsWith("confirmation-")),
      [],
    );
    await semanticReport(fx.root, indexed.data.fingerprint);
    const preflight = cli(fx, "preflight", [
      fx.manifestPath,
      "--semantic-report",
      "semantic-report.json",
    ]);
    assert.equal(
      preflight.outcome,
      "REVIEW_INCOMPLETE",
      JSON.stringify(preflight),
    );
    hasCode(preflight, "REVIEW_CONFIRMATION_MISSING");
    const plan = cli(fx, "goal-plan", [
      fx.manifestPath,
      "--semantic-report",
      "semantic-report.json",
    ]);
    assert.notEqual(plan.outcome, "REVIEW_READY", JSON.stringify(plan));
  });
});

test("R-009/AC-004: traversal and external symlink manifests are rejected across review read and write commands", async () => {
  await withFixture(async (fx) => {
    const outside = await mkdtemp(join(tmpdir(), "review-batch-outside-"));
    try {
      await writeFile(
        join(outside, "batch.json"),
        await readFile(join(fx.root, fx.manifestPath)),
      );
      await symlink(
        join(outside, "batch.json"),
        join(fx.root, "external-batch.json"),
      );
      const traversal = join(fx.root, "..", "outside-batch.json");
      await writeFile(
        traversal,
        await readFile(join(fx.root, fx.manifestPath)),
      );
      const commands = [
        ["index", []],
        ["render", ["--output", "review.html"]],
        ["import", ["sheet.md"]],
        ["respond", ["response.json"]],
        ["preflight", ["--semantic-report", "semantic-report.json"]],
        ["readiness-digests", []],
        ["goal-plan", ["--semantic-report", "semantic-report.json"]],
        ["observe", ["observation.json"]],
      ];
      for (const [path, expected] of [
        ["../outside-batch.json", "REVIEW_PATH_UNSAFE"],
        ["external-batch.json", "REVIEW_PATH_UNSAFE"],
      ]) {
        for (const [command, extra] of commands) {
          const result = cli(fx, command, [path, ...extra]);
          assert.equal(
            result.outcome,
            "configuration-error",
            `${command}: ${JSON.stringify(result)}`,
          );
          hasCode(result, expected);
        }
      }
      assert.equal((await readFile(traversal, "utf8")).length > 0, true);
      assert.deepEqual((await readdir(outside)).sort(), ["batch.json"]);
      await assert.rejects(lstat(join(fx.root, "review.html")), {
        code: "ENOENT",
      });
    } finally {
      await rm(join(fx.root, "..", "outside-batch.json"), { force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});

test("R-009/AC-004: unsafe semantic input and Sidecar output are rejected without changing sources", async () => {
  await withFixture(async (fx) => {
    await readyFixture(fx);
    const outside = await mkdtemp(join(tmpdir(), "review-batch-outside-"));
    try {
      const report = await readFile(join(fx.root, "semantic-report.json"));
      await writeFile(join(outside, "semantic-report.json"), report);
      await writeFile(join(fx.root, "..", "outside-report.json"), report);
      await symlink(
        join(outside, "semantic-report.json"),
        join(fx.root, "linked-report.json"),
      );
      for (const command of ["preflight", "goal-plan"]) {
        for (const path of ["linked-report.json", "../outside-report.json"]) {
          const result = cli(fx, command, [
            fx.manifestPath,
            "--semantic-report",
            path,
          ]);
          assert.equal(
            result.outcome,
            "configuration-error",
            JSON.stringify(result),
          );
          hasCode(result, "REVIEW_PATH_UNSAFE");
        }
      }
      const sidecar = join(
        fx.root,
        "specs/stories/FX-004-fixture/readiness.json",
      );
      const original = await readFile(sidecar);
      const outsideSidecar = join(outside, "readiness.json");
      await writeFile(outsideSidecar, original);
      await rm(sidecar);
      await symlink(outsideSidecar, sidecar);
      const digest = cli(fx, "readiness-digests", [fx.manifestPath]);
      assert.equal(
        digest.outcome,
        "configuration-error",
        JSON.stringify(digest),
      );
      hasCode(digest, "REVIEW_PATH_UNSAFE");
      assert.deepEqual(await readFile(outsideSidecar), original);
    } finally {
      await rm(join(fx.root, "..", "outside-report.json"), { force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});

test("R-009/AC-004: traversal and external symlink reviewed sources are rejected across the batch commands", async () => {
  for (const mode of ["traversal", "symlink"]) {
    await withFixture(async (fx) => {
      const outside = join(fx.root, "..", "outside");
      try {
        await mkdir(outside);
        const original = await readFile(join(fx.root, sourcePath));
        const external = join(outside, "spec.md");
        await writeFile(external, original);
        if (mode === "traversal") {
          const manifestPath = join(fx.root, fx.manifestPath);
          const manifest = JSON.parse(await readFile(manifestPath));
          manifest.sources.specs[0] = "../outside/spec.md";
          manifest.requirements[0].spec = "../outside/spec.md";
          await writeFile(manifestPath, JSON.stringify(manifest));
        } else {
          await rm(join(fx.root, sourcePath));
          await symlink(external, join(fx.root, sourcePath));
        }
        const commands = [
          ["index", []],
          ["render", ["--output", "review.html"]],
          ["import", ["sheet.md"]],
          ["respond", ["response.json"]],
          ["preflight", ["--semantic-report", "semantic-report.json"]],
          ["readiness-digests", []],
          ["goal-plan", ["--semantic-report", "semantic-report.json"]],
          ["observe", ["observation.json"]],
        ];
        for (const [command, extra] of commands) {
          const result = cli(fx, command, [fx.manifestPath, ...extra]);
          assert.notEqual(
            result.outcome,
            "success",
            `${mode}/${command}: ${JSON.stringify(result)}`,
          );
          assert.notEqual(
            result.outcome,
            "REVIEW_READY",
            `${mode}/${command}: ${JSON.stringify(result)}`,
          );
          hasCode(
            result,
            mode === "traversal"
              ? "REVIEW_MANIFEST_INVALID"
              : "REVIEW_PATH_UNSAFE",
          );
        }
        const confirmation = await runReviewConfirm(
          [fx.manifestPath, "--json"],
          fx.root,
          { terminal: terminal([]) },
        );
        assert.equal(
          confirmation.result.outcome,
          "configuration-error",
          JSON.stringify(confirmation.result),
        );
        hasCode(
          confirmation.result,
          mode === "traversal"
            ? "REVIEW_MANIFEST_INVALID"
            : "REVIEW_PATH_UNSAFE",
        );
        assert.deepEqual(await readFile(external), original);
        await assert.rejects(lstat(join(fx.root, "review.html")), {
          code: "ENOENT",
        });
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    });
  }
});

test("R-009/AC-004: render output failure leaves no partial file and preserves reviewed sources", async () => {
  await withFixture(async (fx) => {
    const source = join(fx.root, sourcePath);
    const before = await readFile(source);
    const result = cli(fx, "render", [
      fx.manifestPath,
      "--output",
      "missing/review.html",
    ]);
    assert.equal(result.outcome, "failure", JSON.stringify(result));
    hasCode(result, "REVIEW_OUTPUT_WRITE_FAILED");
    await assert.rejects(lstat(join(fx.root, "missing/review.html")), {
      code: "ENOENT",
    });
    assert.deepEqual(await readFile(source), before);
    assert.deepEqual(
      (await readdir(fx.root)).filter((name) => name.includes("review.html")),
      [],
    );
    await mkdir(join(fx.root, "occupied.html"));
    const beforeEntries = await readdir(fx.root);
    const occupied = cli(fx, "render", [
      fx.manifestPath,
      "--output",
      "occupied.html",
    ]);
    assert.equal(occupied.outcome, "failure", JSON.stringify(occupied));
    hasCode(occupied, "REVIEW_OUTPUT_WRITE_FAILED");
    assert.deepEqual(await readdir(fx.root), beforeEntries);
    assert.deepEqual(await readdir(join(fx.root, "occupied.html")), []);
    assert.deepEqual(await readFile(source), before);
    const outside = await mkdtemp(join(tmpdir(), "review-batch-output-"));
    try {
      const external = join(outside, "review.html");
      await writeFile(external, "outside-sentinel");
      await symlink(external, join(fx.root, "external-review.html"));
      const linked = cli(fx, "render", [
        fx.manifestPath,
        "--output",
        "external-review.html",
      ]);
      assert.equal(
        linked.outcome,
        "configuration-error",
        JSON.stringify(linked),
      );
      hasCode(linked, "REVIEW_OUTPUT_CONFLICT");
      assert.equal(await readFile(external, "utf8"), "outside-sentinel");
      assert.deepEqual(await readFile(source), before);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

test("R-009/AC-004: created:false handoff replay records one Goal and four existing Work Items", async () => {
  await withFixture(async (fx) => {
    const fingerprint = await readyFixture(fx);
    const planned = cli(fx, "goal-plan", [
      fx.manifestPath,
      "--semantic-report",
      "semantic-report.json",
    ]);
    assert.equal(planned.outcome, "REVIEW_READY", JSON.stringify(planned));
    const goalPlanPath = `${planned.data.goalPlanDirectory}/manifest.json`;
    const goalPlanBytes = await readFile(join(fx.root, goalPlanPath));
    const plan = JSON.parse(goalPlanBytes);
    const recorded = JSON.parse(await readFile(recordedRetry, "utf8"));
    const steps = recorded.steps.map((step) => ({ ...step }));
    const adds = steps.filter((step) => step.command === "work-add");
    assert.equal(adds.length, 3);
    const extra = { ...adds.at(-1) };
    const insertion = steps.findIndex(
      (step) => step.command === "goal-preflight",
    );
    steps.splice(
      insertion,
      0,
      { ...recorded.steps.find((step) => step.command === "preflight") },
      extra,
    );
    let position = 0;
    for (const step of steps) {
      if (step.command !== "work-add") continue;
      const node = plan.nodes[position];
      const item = JSON.parse(step.stdout);
      const id = `WI-00${position + 1}`;
      step.story = node.nodeRef;
      step.workItemId = id;
      step.created = false;
      item.created = false;
      item.work_item.id = id;
      item.work_item.goal_id = plan.plan.id;
      item.work_item.story_ref = node.storyRef;
      item.work_item.external_ref = node.nodeRef;
      item.work_item.depends_on = node.dependsOn.map(
        (dependency) => `WI-00${STORY_IDS.indexOf(dependency) + 1}`,
      );
      step.stdout = JSON.stringify(item);
      position += 1;
    }
    assert.equal(position, 4);
    const observation = {
      ...recorded,
      batchId: BATCH_ID,
      fingerprint,
      goalPlan: { path: goalPlanPath, sha256: sha256Hex(goalPlanBytes) },
      goalId: plan.plan.id,
      steps,
    };
    await writeFile(
      join(fx.root, "observation.json"),
      JSON.stringify(observation),
    );
    const observed = cli(fx, "observe", [fx.manifestPath, "observation.json"]);
    assert.equal(observed.outcome, "success", JSON.stringify(observed));
    const saved = JSON.parse(
      await readFile(join(fx.root, observed.data.record)),
    );
    assert.equal(
      saved.steps.filter((step) => step.command === "goal-create").length,
      0,
    );
    const savedAdds = saved.steps.filter((step) => step.command === "work-add");
    assert.deepEqual(
      savedAdds.map((step) => step.created),
      [false, false, false, false],
    );
    assert.deepEqual(
      savedAdds.map((step) => step.workItemId),
      ["WI-001", "WI-002", "WI-003", "WI-004"],
    );
    assert.equal(new Set(savedAdds.map((step) => step.workItemId)).size, 4);
    assert.deepEqual(
      savedAdds.map((step) => JSON.parse(step.stdout).created),
      [false, false, false, false],
    );
  });
});
