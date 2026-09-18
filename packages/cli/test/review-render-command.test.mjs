import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { validateResultEnvelope } from "@praxisbound/core";

import { runReviewRender } from "../dist/review.js";

const bin = fileURLToPath(
  new globalThis.URL("../dist/bin.js", import.meta.url),
);

function runCli(args, cwd) {
  return spawnSync(globalThis.process.execPath, [bin, ...args], {
    encoding: "utf8",
    cwd,
  });
}

async function fixture(build) {
  const root = await mkdtemp(join(tmpdir(), "review-render-"));
  try {
    const batchId = "TST-922-fixture";
    const batch = join(root, "specs", "batches", batchId);
    await mkdir(batch, { recursive: true });
    await mkdir(join(root, "specs", "features", "fixture"), {
      recursive: true,
    });
    await mkdir(join(root, "specs", "stories", "RF-001-fixture"), {
      recursive: true,
    });
    await writeFile(
      join(batch, "batch.json"),
      JSON.stringify({
        schemaVersion: "1.0.0",
        batchId,
        title: "Renderer fixture",
        sources: {
          adrs: [],
          specs: ["specs/features/fixture/spec.md"],
          stories: ["specs/stories/RF-001-fixture"],
        },
        requirements: [
          {
            spec: "specs/features/fixture/spec.md",
            anchor: "R-001",
            stories: ["RF-001"],
          },
        ],
        dependencies: [],
      }),
    );
    await writeFile(
      join(root, "specs", "features", "fixture", "spec.md"),
      "## R-001：Fixture\n\n[x](javascript:alert(1))\n",
    );
    await writeFile(
      join(root, "specs", "stories", "RF-001-fixture", "story.md"),
      "# Story: RF-001 Fixture\n\n## Goal\n\nRender safely.\n",
    );
    await writeFile(
      join(root, "specs", "stories", "RF-001-fixture", "acceptance.md"),
      "# Acceptance Criteria\n\n* [ ] AC-001: Render.\n",
    );
    return await build(root, `specs/batches/${batchId}/batch.json`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function assertEnvelope(execution) {
  assert.deepEqual(validateResultEnvelope(execution.result), {
    ok: true,
    value: execution.result,
  });
}

test("TST022-AC-001/006: review render atomically writes an offline projection from a readable draft", async () => {
  await fixture(async (root, manifest) => {
    const execution = await runReviewRender(
      [manifest, "--output", "review.html", "--json"],
      root,
    );

    assertEnvelope(execution);
    assert.equal(execution.result.outcome, "success");
    assert.equal(execution.result.exit, 0);
    assert.equal(execution.result.data.output, "review.html");
    const html = await readFile(join(root, "review.html"), "utf8");
    assert.match(html, /Offline reading snapshot/);
    assert.doesNotMatch(html, /href="javascript:/i);
  });
});

test("TST022-AC-009: the built CLI emits one schema-valid JSON envelope and a human result", async () => {
  await fixture(async (root, manifest) => {
    const json = runCli(
      ["review", "render", manifest, "--output", "cli.json.html", "--json"],
      root,
    );
    assert.equal(json.status, 0, json.stderr);
    assert.equal(json.stderr, "");
    const parsed = JSON.parse(json.stdout);
    assertEnvelope({ result: parsed });
    assert.equal(json.stdout, `${JSON.stringify(parsed)}\n`);

    const human = runCli(
      ["review", "render", manifest, "--output", "cli.human.html"],
      root,
    );
    assert.equal(human.status, 0, human.stderr);
    assert.equal(human.stderr, "");
    assert.match(human.stdout, /PraxisBound Batch Review Renderer/);
    assert.match(human.stdout, /Result: success/);
  });
});

test("TST022-AC-007: review render refuses every protected output alias without modifying it", async () => {
  await fixture(async (root, manifest) => {
    const source = join(root, "specs", "stories", "RF-001-fixture", "story.md");
    const before = await readFile(source, "utf8");
    const protectedTargets = [
      manifest,
      "specs/features/fixture/spec.md",
      "specs/stories/RF-001-fixture/story.md",
      "specs/stories/RF-001-fixture/acceptance.md",
      "specs/batches/TST-922-fixture/records",
      "specs/batches/TST-922-fixture/records/render.html",
    ];
    for (const target of protectedTargets) {
      const conflict = await runReviewRender(
        [manifest, "--output", target],
        root,
      );
      assertEnvelope(conflict);
      assert.equal(conflict.result.outcome, "configuration-error");
      assert.equal(conflict.result.issues[0].code, "REVIEW_OUTPUT_CONFLICT");
    }
    assert.equal(await readFile(source, "utf8"), before);

    const linked = join(root, "linked.html");
    await symlink(source, linked);
    const symlinkConflict = await runReviewRender(
      [manifest, "--output", "linked.html"],
      root,
    );
    assertEnvelope(symlinkConflict);
    assert.equal(symlinkConflict.result.outcome, "configuration-error");
    assert.equal(
      symlinkConflict.result.issues[0].code,
      "REVIEW_OUTPUT_CONFLICT",
    );

    const hardLinked = join(root, "hard-linked.html");
    await link(source, hardLinked);
    const hardLinkConflict = await runReviewRender(
      [manifest, "--output", "hard-linked.html"],
      root,
    );
    assertEnvelope(hardLinkConflict);
    assert.equal(hardLinkConflict.result.outcome, "configuration-error");
    assert.equal(
      hardLinkConflict.result.issues[0].code,
      "REVIEW_OUTPUT_CONFLICT",
    );
    assert.equal(await readFile(source, "utf8"), before);
  });
});

test("TST022-AC-006: readable drafts with a missing source keep their diagnostic in the projection", async () => {
  await fixture(async (root, manifest) => {
    await unlink(join(root, "specs", "features", "fixture", "spec.md"));
    const execution = await runReviewRender(
      [manifest, "--output", "incomplete.html"],
      root,
    );
    assertEnvelope(execution);
    assert.equal(execution.result.outcome, "success");
    assert.equal(
      execution.result.data.diagnostics[0].code,
      "REVIEW_SOURCE_MISSING",
    );
    const html = await readFile(join(root, "incomplete.html"), "utf8");
    assert.match(
      html,
      /Source was unavailable when this snapshot was produced/,
    );
  });
});

test("TST022-AC-008/009: render failure keeps a prior projection and cleans the staging file", async () => {
  await fixture(async (root, manifest) => {
    const priorOutput = join(root, "prior.html");
    const initial = await runReviewRender(
      [manifest, "--output", "prior.html"],
      root,
    );
    assertEnvelope(initial);
    assert.equal(initial.result.outcome, "success");
    const priorBytes = await readFile(priorOutput);
    const failure = await runReviewRender(
      [manifest, "--output", "prior.html"],
      root,
      {
        async rename() {
          throw new Error("fixture rename failure");
        },
      },
    );
    assertEnvelope(failure);
    assert.equal(failure.result.outcome, "failure");
    assert.equal(failure.result.exit, 1);
    assert.deepEqual(await readFile(priorOutput), priorBytes);
    assert.equal(
      (await readdir(root)).some((entry) =>
        /^\.prior\.html\..+\.tmp$/.test(entry),
      ),
      false,
    );

    const usage = await runReviewRender([manifest, "--json"], root);
    assertEnvelope(usage);
    assert.equal(usage.result.outcome, "usage-error");
    assert.equal(usage.result.exit, 2);
  });
});

test("TST022-AC-008/009: a missing output directory is named instead of reported as a generic write failure", async () => {
  await fixture(async (root, manifest) => {
    await writeFile(join(root, "plain-file"), "not a directory\n");
    for (const [output, directory] of [
      ["missing/review.html", "missing"],
      ["plain-file/review.html", "plain-file"],
    ]) {
      const execution = await runReviewRender(
        [manifest, "--output", output, "--json"],
        root,
      );

      assertEnvelope(execution);
      assert.equal(execution.result.outcome, "failure");
      assert.equal(execution.result.exit, 1);
      assert.deepEqual(execution.result.issues, [
        {
          code: "REVIEW_OUTPUT_WRITE_FAILED",
          message: "output directory does not exist",
          path: directory,
        },
      ]);
    }
    assert.equal((await readdir(root)).includes("missing"), false);

    const human = runCli(
      ["review", "render", manifest, "--output", "gone\u001b[2J/review.html"],
      root,
    );
    assert.equal(human.status, 1);
    assert.equal(
      human.stderr,
      "FAIL REVIEW_OUTPUT_WRITE_FAILED: output directory does not exist (gone\\x1b[2J)\n",
    );
  });
});
