import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
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

function baseRenderManifest(batchId) {
  return {
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
  };
}

/**
 * Builds the same fixture repository as `fixture`, but lets the caller
 * replace the manifest entirely: `manifestText`, when given, is written
 * verbatim (invalid JSON, an edited `preface`, …) instead of the default
 * manifest object.
 */
async function fixtureWithManifest(manifestText, build) {
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
      manifestText ?? JSON.stringify(baseRenderManifest(batchId)),
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

function fixture(build) {
  return fixtureWithManifest(undefined, build);
}

function assertEnvelope(execution) {
  assert.deepEqual(validateResultEnvelope(execution.result), {
    ok: true,
    value: execution.result,
  });
}

test("TST022-AC-001/011: review render atomically writes an offline projection from a readable draft", async () => {
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
    assert.match(html, /離線閱讀快照/);
    assert.doesNotMatch(html, /href="javascript:/i);
  });
});

test("TST022-AC-014: the built CLI emits one schema-valid JSON envelope and a human result", async () => {
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

test("TST022-AC-012: review render refuses every protected output alias without modifying it", async () => {
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

test("TST022-AC-011: readable drafts with a missing source keep their diagnostic in the projection", async () => {
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
    assert.match(html, /此來源無法讀取/);
  });
});

test("TST022-AC-013/014: render failure keeps a prior projection and cleans the staging file", async () => {
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

test("TST022-AC-013/014: a missing output directory is named instead of reported as a generic write failure", async () => {
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

test("TST022-AC-007: a 1.1.0 manifest's preface renders labelled as author-written, and changing only the preface changes the fingerprint", async () => {
  await fixtureWithManifest(
    JSON.stringify({
      ...baseRenderManifest("TST-922-fixture"),
      schemaVersion: "1.1.0",
      preface: "Preface sentence PREFACE_SENTENCE_ONE.",
    }),
    async (root, manifest) => {
      const first = await runReviewRender(
        [manifest, "--output", "first.html", "--json"],
        root,
      );
      assertEnvelope(first);
      assert.equal(first.result.outcome, "success");
      const html = await readFile(join(root, "first.html"), "utf8");
      assert.match(html, /由批次作者撰寫（Review Preface）/);
      assert.match(html, /PREFACE_SENTENCE_ONE/);

      await writeFile(
        join(root, "specs", "batches", "TST-922-fixture", "batch.json"),
        JSON.stringify({
          ...baseRenderManifest("TST-922-fixture"),
          schemaVersion: "1.1.0",
          preface: "Preface sentence PREFACE_SENTENCE_TWO.",
        }),
      );
      const second = await runReviewRender(
        [manifest, "--output", "second.html", "--json"],
        root,
      );
      assertEnvelope(second);
      assert.equal(second.result.outcome, "success");
      assert.notEqual(
        first.result.data.fingerprint,
        second.result.data.fingerprint,
        "changing only the preface must change the Requirement Fingerprint",
      );
    },
  );
});

test("TST022-AC-014: review render returns documented, schema-valid configuration-error envelopes", async () => {
  await fixtureWithManifest("{ not valid json", async (root, manifest) => {
    const execution = await runReviewRender(
      [manifest, "--output", "review.html", "--json"],
      root,
    );
    assertEnvelope(execution);
    assert.equal(execution.result.outcome, "configuration-error");
    assert.equal(execution.result.exit, 2);
    assert.ok(
      execution.result.issues.some((i) => i.code === "REVIEW_MANIFEST_INVALID"),
    );
  });

  await fixtureWithManifest(
    JSON.stringify({
      ...baseRenderManifest("TST-922-fixture"),
      preface: "Not allowed under 1.0.0.",
    }),
    async (root, manifest) => {
      const execution = await runReviewRender(
        [manifest, "--output", "review.html", "--json"],
        root,
      );
      assertEnvelope(execution);
      assert.equal(execution.result.outcome, "configuration-error");
      assert.equal(execution.result.exit, 2);
      assert.ok(
        execution.result.issues.some(
          (i) => i.code === "REVIEW_MANIFEST_INVALID",
        ),
      );
    },
  );

  await fixtureWithManifest(
    JSON.stringify({
      ...baseRenderManifest("TST-922-fixture"),
      schemaVersion: "1.1.0",
      preface: "a".repeat(4097),
    }),
    async (root, manifest) => {
      const execution = await runReviewRender(
        [manifest, "--output", "review.html", "--json"],
        root,
      );
      assertEnvelope(execution);
      assert.equal(execution.result.outcome, "configuration-error");
      assert.equal(execution.result.exit, 2);
      assert.ok(
        execution.result.issues.some(
          (i) => i.code === "REVIEW_INPUT_TOO_LARGE",
        ),
      );
    },
  );
});

test("TST022 review finding 5: an output path that case-differs into the batch records/ directory is still rejected", async (t) => {
  await fixture(async (root, manifest) => {
    const batchDir = join(root, "specs", "batches", "TST-922-fixture");
    const recordsDir = join(batchDir, "records");
    await mkdir(recordsDir, { recursive: true });
    await writeFile(join(recordsDir, "existing.html"), "kept\n");

    // Detect whether this temp filesystem is case-sensitive by probing it
    // directly, rather than assuming the platform default.
    const probePath = join(batchDir, "CaseProbe.txt");
    await writeFile(probePath, "probe\n");
    const caseSensitive = await readFile(join(batchDir, "caseprobe.txt")).then(
      () => false,
      () => true,
    );
    await unlink(probePath);

    if (caseSensitive) {
      t.skip(
        "this temporary filesystem is case-sensitive; the case-variant alias cannot be exercised here",
      );
      return;
    }

    const conflict = await runReviewRender(
      [manifest, "--output", "specs/batches/TST-922-fixture/RECORDS/new.html"],
      root,
    );
    assertEnvelope(conflict);
    assert.equal(conflict.result.outcome, "configuration-error");
    assert.equal(conflict.result.exit, 2);
    assert.equal(conflict.result.issues[0].code, "REVIEW_OUTPUT_CONFLICT");
    assert.equal(
      await readFile(join(recordsDir, "existing.html"), "utf8"),
      "kept\n",
    );
  });
});

test("TST022 Security Fixture Matrix: an internal error reaches stderr without the repository root or raw control characters", async () => {
  await fixture(async (root, manifest) => {
    const escape = String.fromCharCode(0x1b);
    const bell = String.fromCharCode(0x07);
    const written = [];
    const originalWrite = globalThis.process.stderr.write;
    globalThis.process.stderr.write = (chunk) => {
      written.push(String(chunk));
      return true;
    };
    let execution;
    try {
      execution = await runReviewRender(
        [manifest, "--output", "out.html", "--json"],
        root,
        {
          async rename() {
            // Reading `code` in the publication's own error handler throws,
            // so this escapes as an unexpected internal failure.
            throw {
              get code() {
                throw new Error(
                  `EACCES: open '${root}/secret/path'${escape}[31mRED${escape}]0;title${bell}\nsecond line ${root}`,
                );
              },
            };
          },
        },
      );
    } finally {
      globalThis.process.stderr.write = originalWrite;
    }

    assertEnvelope(execution);
    assert.equal(execution.result.outcome, "ERROR");
    assert.equal(execution.result.exit, 3);
    const stderr = written.join("");
    assert.match(stderr, /internal error: EACCES: open '<root>\/secret\/path'/);
    assert.ok(!stderr.includes(root), "stderr must not carry the root path");
    assert.ok(!stderr.includes(escape) && !stderr.includes(bell));
    assert.match(stderr, /\\x1b\[31mRED\\x1b]0;title\\x07/);
    assert.doesNotMatch(stderr, /second line/);
    assert.equal(stderr.split("\n").length, 2, "one line plus its newline");
  });
});

test("TST022 Security Fixture Matrix: an internal error naming the root's realpath (e.g. /private/tmp vs /tmp) is also masked", async () => {
  await fixture(async (root, manifest) => {
    const realRoot = realpathSync(root);
    if (realRoot === root) {
      // Nothing to discriminate on this filesystem: the temp root has no
      // symlinked alias, so this case degenerates to the plain-root test.
      return;
    }
    const written = [];
    const originalWrite = globalThis.process.stderr.write;
    globalThis.process.stderr.write = (chunk) => {
      written.push(String(chunk));
      return true;
    };
    let execution;
    try {
      execution = await runReviewRender(
        [manifest, "--output", "out.html", "--json"],
        root,
        {
          async rename() {
            throw {
              get code() {
                throw new Error(`EACCES: open '${realRoot}/secret/path'`);
              },
            };
          },
        },
      );
    } finally {
      globalThis.process.stderr.write = originalWrite;
    }

    assertEnvelope(execution);
    assert.equal(execution.result.outcome, "ERROR");
    const stderr = written.join("");
    assert.match(stderr, /internal error: EACCES: open '<root>\/secret\/path'/);
    assert.ok(
      !stderr.includes(realRoot),
      "stderr must not carry the root's realpath",
    );
  });
});
