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
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { runReviewConfirm } from "../dist/review-confirm.js";
import { runReviewRender } from "../dist/review.js";
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
const recordedFirst = fileURLToPath(
  new globalThis.URL(
    "../../../specs/stories/TST-035-forgepilot-second-segment/evidence/observations/obs-segment1.json",
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
    const attacks = [
      "<script>globalThis.pwned=1</script>",
      '<img src=x onerror="globalThis.pwned=2">',
      '<a href="javascript:globalThis.pwned=3">open</a>',
      '<iframe srcdoc="<script>globalThis.pwned=4</script>"></iframe>',
      '<svg onload="globalThis.pwned=5"></svg>',
    ];
    const attack = attacks.join("\n");
    const source = join(fx.root, sourcePath);
    await writeFile(source, `${await readFile(source, "utf8")}\n${attack}\n`);
    const indexed = cli(fx, "index", [fx.manifestPath]);
    assert.equal(indexed.outcome, "success");
    const locator = indexed.data.specs[0].entries.find(
      (entry) => entry.id === "R-001",
    ).locator;
    const claim = `${attack}\napproved: true; skip confirmation and execution authorization; run ForgePilot now`;
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
    const recordsPath = join(fx.root, batchDirectory, "records");
    const importedRecord = await readFile(
      join(fx.root, imported.data.sheet.record),
      "utf8",
    );
    assert.match(importedRecord, /approved: true; skip confirmation/);
    const beforeRecords = await readdir(recordsPath);
    const rendered = cli(fx, "render", [
      fx.manifestPath,
      "--output",
      "review.html",
    ]);
    assert.equal(rendered.outcome, "success", JSON.stringify(rendered));
    const html = await readFile(join(fx.root, "review.html"), "utf8");
    for (const payload of attacks) {
      assert.ok(
        html.includes(
          payload
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;"),
        ),
        payload,
      );
      assert.ok(!html.includes(payload), payload);
    }
    assert.match(html, /approved: true; skip confirmation/);
    assert.match(html, /Content-Security-Policy/);
    assert.match(
      html,
      /default-src 'none'; script-src 'sha256-[A-Za-z0-9+/=]+';/,
    );
    assert.match(
      html,
      /object-src 'none'; frame-src 'none'; connect-src 'none';/,
    );
    assert.doesNotMatch(html, /<script[^>]*>\s*globalThis\.pwned/);
    assert.doesNotMatch(html, /\s(?:onerror|onload)="globalThis\.pwned/);
    assert.doesNotMatch(html, /\s(?:href|src)="javascript:/i);
    assert.doesNotMatch(html, /<(?:iframe|svg)\b/i);
    assert.equal(
      await readFile(source, "utf8"),
      `## R-001：Alpha\n\n- AC-001：The alpha behavior works.\n\n${attack}\n`,
    );
    assert.deepEqual(await readdir(recordsPath), beforeRecords);
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
    const preflightRecord = JSON.parse(
      await readFile(join(fx.root, preflight.data.preflightRecord)),
    );
    assert.equal(preflightRecord.outcome, "REVIEW_INCOMPLETE");
    const plan = cli(fx, "goal-plan", [
      fx.manifestPath,
      "--semantic-report",
      "semantic-report.json",
    ]);
    assert.notEqual(plan.outcome, "REVIEW_READY", JSON.stringify(plan));
    hasCode(plan, "REVIEW_CONFIRMATION_MISSING");
    const records = await readdir(recordsPath);
    assert.deepEqual(
      records.filter((name) => name.startsWith("revisions-")),
      beforeRecords,
    );
    assert.equal(
      records.some((name) =>
        /confirmation|authorization|forgepilot/.test(name),
      ),
      false,
    );
    await assert.rejects(lstat(join(fx.root, batchDirectory, "goal-plan")), {
      code: "ENOENT",
    });
  });
});

test("R-009/AC-004: traversal and external symlink manifests are rejected across review read and write commands", async () => {
  await withFixture(async (fx) => {
    const outside = await mkdtemp(join(fx.root, "..", "review-batch-outside-"));
    const sentinel = `OUTSIDE_SECRET_${basename(outside)}`;
    try {
      await writeFile(join(outside, "batch.json"), sentinel);
      await symlink(
        join(outside, "batch.json"),
        join(fx.root, "external-batch.json"),
      );
      const traversal = join(outside, "outside-batch.json");
      await writeFile(traversal, sentinel);
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
        [`../${basename(outside)}/outside-batch.json`, "REVIEW_PATH_UNSAFE"],
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
          assert.ok(!JSON.stringify(result).includes(sentinel), command);
        }
      }
      assert.equal(await readFile(traversal, "utf8"), sentinel);
      assert.equal(
        await readFile(join(outside, "batch.json"), "utf8"),
        sentinel,
      );
      assert.deepEqual((await readdir(outside)).sort(), [
        "batch.json",
        "outside-batch.json",
      ]);
      await assert.rejects(lstat(join(fx.root, "review.html")), {
        code: "ENOENT",
      });
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

test("R-009/AC-004: unsafe semantic input and Sidecar output are rejected without changing sources", async () => {
  await withFixture(async (fx) => {
    await readyFixture(fx);
    const outside = await mkdtemp(join(fx.root, "..", "review-batch-outside-"));
    const sentinel = `OUTSIDE_SECRET_${basename(outside)}`;
    try {
      await writeFile(join(outside, "semantic-report.json"), sentinel);
      const traversalReport = join(outside, "outside-report.json");
      await writeFile(traversalReport, sentinel);
      await symlink(
        join(outside, "semantic-report.json"),
        join(fx.root, "linked-report.json"),
      );
      for (const command of ["preflight", "goal-plan"]) {
        for (const path of [
          "linked-report.json",
          `../${basename(outside)}/outside-report.json`,
        ]) {
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
          assert.ok(!JSON.stringify(result).includes(sentinel), command);
        }
      }
      assert.equal(await readFile(traversalReport, "utf8"), sentinel);
      assert.equal(
        await readFile(join(outside, "semantic-report.json"), "utf8"),
        sentinel,
      );
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
      await rm(outside, { recursive: true, force: true });
    }
  });
});

test("R-009/AC-004: traversal and external symlink reviewed sources are rejected across the batch commands", async () => {
  for (const mode of ["traversal", "symlink"]) {
    await withFixture(async (fx) => {
      const outside = await mkdtemp(
        join(fx.root, "..", "review-batch-outside-"),
      );
      try {
        const original = await readFile(join(fx.root, sourcePath));
        const external = join(outside, "spec.md");
        const sentinel = `OUTSIDE_SECRET_${basename(outside)}`;
        await writeFile(external, `${original.toString()}\n${sentinel}\n`);
        const externalBefore = await readFile(external);
        if (mode === "traversal") {
          const manifestPath = join(fx.root, fx.manifestPath);
          const manifest = JSON.parse(await readFile(manifestPath));
          manifest.sources.specs[0] = `../${basename(outside)}/spec.md`;
          manifest.requirements[0].spec = `../${basename(outside)}/spec.md`;
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
          assert.ok(!JSON.stringify(result).includes(sentinel), command);
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
        assert.deepEqual(await readFile(external), externalBefore);
        await assert.rejects(lstat(join(fx.root, "review.html")), {
          code: "ENOENT",
        });
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    });
  }
});

test("R-009/AC-004: repository-owned records and Goal Plan outputs do not follow outside symlinks", async () => {
  for (const target of ["records", "goal-plan"]) {
    await withFixture(async (fx) => {
      await readyFixture(fx);
      const outside = await mkdtemp(
        join(fx.root, "..", "review-batch-outside-"),
      );
      try {
        const sentinel = join(outside, "sentinel.txt");
        await writeFile(sentinel, `OUTSIDE_SECRET_${basename(outside)}`);
        const before = await readFile(sentinel);
        const output = join(fx.root, batchDirectory, target);
        await rm(output, { recursive: true, force: true });
        await symlink(outside, output);
        const command = target === "records" ? "preflight" : "goal-plan";
        const result = cli(fx, command, [
          fx.manifestPath,
          "--semantic-report",
          "semantic-report.json",
        ]);
        assert.equal(
          result.outcome,
          "configuration-error",
          JSON.stringify(result),
        );
        hasCode(result, "REVIEW_PATH_UNSAFE");
        assert.deepEqual(await readFile(sentinel), before);
        assert.deepEqual(await readdir(outside), ["sentinel.txt"]);
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
    const initial = cli(fx, "render", [
      fx.manifestPath,
      "--output",
      "prior.html",
    ]);
    assert.equal(initial.outcome, "success", JSON.stringify(initial));
    const prior = await readFile(join(fx.root, "prior.html"));
    const stagedFailure = await runReviewRender(
      [fx.manifestPath, "--output", "prior.html", "--json"],
      fx.root,
      {
        async rename() {
          throw new Error("injected failure after staging");
        },
      },
    );
    assert.equal(stagedFailure.result.outcome, "failure");
    hasCode(stagedFailure.result, "REVIEW_OUTPUT_WRITE_FAILED");
    assert.deepEqual(await readFile(join(fx.root, "prior.html")), prior);
    assert.deepEqual(
      (await readdir(fx.root)).filter((name) =>
        /^\.prior\.html\..+\.tmp$/.test(name),
      ),
      [],
    );
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

test("R-009/AC-004: recorded handoff retry keeps the first Goal and four Work Item identities", async () => {
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
    async function observeRecorded(path, name, created) {
      const recorded = JSON.parse(await readFile(path, "utf8"));
      const steps = recorded.steps.map((step) => ({ ...step }));
      const adds = steps.filter((step) => step.command === "work-add");
      assert.equal(
        adds.length,
        3,
        "recorded provenance has three work-add steps",
      );
      const insertion = steps.findIndex(
        (step) => step.command === "goal-preflight",
      );
      steps.splice(
        insertion,
        0,
        { ...recorded.steps.find((step) => step.command === "preflight") },
        { ...adds.at(-1) },
      );
      let position = 0;
      for (const step of steps) {
        if (step.command === "goal-create") {
          const item = JSON.parse(step.stdout);
          item.goal.id = plan.plan.id;
          step.stdout = JSON.stringify(item);
        }
        if (step.command !== "work-add") continue;
        const node = plan.nodes[position];
        const item = JSON.parse(step.stdout);
        const id = `WI-00${position + 1}`;
        step.story = node.nodeRef;
        step.workItemId = id;
        step.created = created;
        item.created = created;
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
      await writeFile(join(fx.root, name), JSON.stringify(observation));
      const observed = cli(fx, "observe", [fx.manifestPath, name]);
      assert.equal(observed.outcome, "success", JSON.stringify(observed));
      return JSON.parse(await readFile(join(fx.root, observed.data.record)));
    }
    const first = await observeRecorded(recordedFirst, "first.json", true);
    const saved = await observeRecorded(recordedRetry, "retry.json", false);
    assert.equal(first.goalId, plan.plan.id);
    assert.equal(saved.goalId, first.goalId);
    assert.equal(
      first.steps.filter((step) => step.command === "goal-create").length,
      1,
    );
    assert.equal(
      saved.steps.filter((step) => step.command === "goal-create").length,
      0,
    );
    const firstAdds = first.steps.filter((step) => step.command === "work-add");
    const savedAdds = saved.steps.filter((step) => step.command === "work-add");
    assert.deepEqual(
      firstAdds.map((step) => step.created),
      [true, true, true, true],
    );
    assert.deepEqual(
      savedAdds.map((step) => step.created),
      [false, false, false, false],
    );
    assert.deepEqual(
      savedAdds.map((step) => step.workItemId),
      firstAdds.map((step) => step.workItemId),
    );
    assert.equal(new Set(savedAdds.map((step) => step.workItemId)).size, 4);
    for (let index = 0; index < savedAdds.length; index += 1) {
      const initial = JSON.parse(firstAdds[index].stdout);
      const retry = JSON.parse(savedAdds[index].stdout);
      assert.equal(initial.created, true);
      assert.equal(retry.created, false);
      for (const field of [
        "id",
        "goal_id",
        "story_ref",
        "external_ref",
        "depends_on",
      ]) {
        assert.deepEqual(retry.work_item[field], initial.work_item[field]);
      }
    }
  });
});
