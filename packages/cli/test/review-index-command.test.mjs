import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { validateResultEnvelope } from "@praxisbound/core";

import { renderReviewIndexHuman, runReviewIndex } from "../dist/review.js";

const execFile = promisify(execFileCallback);

function hasRawControlCharacter(value) {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || codePoint === 0x7f) return true;
  }
  return false;
}

/** Same as `hasRawControlCharacter`, but tab, LF, and CR are allowed line formatting. */
function hasDisallowedControlCharacter(value) {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d)
      continue;
    if (codePoint <= 0x1f || codePoint === 0x7f) return true;
  }
  return false;
}

/** Every fixture repository lives under one throwaway container, never directly in the shared OS tmpdir. */
async function container(build) {
  const base = await mkdtemp(join(tmpdir(), "review-index-"));
  try {
    return { base, result: await build(base) };
  } catch (error) {
    await rm(base, { recursive: true, force: true });
    throw error;
  }
}

async function workspace(build) {
  const { base } = await container(async (containerDir) => {
    const root = join(containerDir, "repo");
    await mkdir(root, { recursive: true });
    await execFile("git", ["init", "-q"], { cwd: root });
    await build(root, containerDir);
  });
  return join(base, "repo");
}

async function cleanupWorkspace(root) {
  await rm(join(root, ".."), { recursive: true, force: true });
}

async function writeBatch(root, batchId, manifest, files) {
  const batchDir = join(root, "specs", "batches", batchId);
  await mkdir(batchDir, { recursive: true });
  await writeFile(join(batchDir, "batch.json"), JSON.stringify(manifest));
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, content);
  }
  return `specs/batches/${batchId}/batch.json`;
}

const specText = "## R-001：Fixture Entry\n\n- AC-001：line.\n";
const storyText = "# Story: RF-001 Fixture\n";
const acceptanceText = "# Acceptance Criteria\n\n* [ ] AC-001: done.\n";
const adrText = "# ADR-001 Fixture\n\nStatus: accepted\n";

function baseFixtureFiles() {
  return {
    "specs/decisions/ADR-001-fixture.md": adrText,
    "specs/features/fixture/spec.md": specText,
    "specs/stories/RF-001-fixture/story.md": storyText,
    "specs/stories/RF-001-fixture/acceptance.md": acceptanceText,
  };
}

function baseManifest(batchId) {
  return {
    schemaVersion: "1.0.0",
    batchId,
    sources: {
      adrs: ["specs/decisions/ADR-001-fixture.md"],
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

async function tree(root) {
  const entries = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      const stats = await lstat(full);
      const path = relative(root, full);
      if (stats.isSymbolicLink()) {
        entries.push({
          path,
          kind: "symlink",
          size: 0,
          sha256: "",
          mtimeMs: 0,
        });
        continue;
      }
      const bytes = await readFile(full);
      entries.push({
        path,
        kind: "file",
        size: stats.size,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        mtimeMs: stats.mtimeMs,
      });
    }
  }
  await walk(root);
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return entries;
}

/** Runs `review index`, asserting the fixture tree is byte- and mtime-identical before and after (AC-010), and that the envelope validates (AC-008). */
async function run(root, args) {
  const before = await tree(root);
  const execution = await runReviewIndex(args, root);
  assert.deepEqual(validateResultEnvelope(execution.result), {
    ok: true,
    value: execution.result,
  });
  const after = await tree(root);
  assert.deepEqual(after, before, "the command must write nothing");
  return execution;
}

test("TST021-AC-001/AC-010: a manifest declaring Specs, Stories and an ADR indexes exactly the declared sources and writes nothing", async () => {
  const root = await workspace(async (dir) => {
    await writeBatch(dir, "TST-921-fixture", baseManifest("TST-921-fixture"), {
      ...baseFixtureFiles(),
      "specs/features/undeclared.md": "# Undeclared\n",
    });
  });
  try {
    const manifestPath = "specs/batches/TST-921-fixture/batch.json";
    const execution = await run(root, [manifestPath]);

    assert.equal(execution.result.outcome, "success");
    assert.equal(execution.result.exit, 0);

    const paths = execution.result.data.sources.map((s) => s.path);
    assert.deepEqual(
      paths,
      [...paths].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    );
    assert.deepEqual(
      new Set(paths),
      new Set([
        "specs/decisions/ADR-001-fixture.md",
        "specs/features/fixture/spec.md",
        "specs/stories/RF-001-fixture/acceptance.md",
        "specs/stories/RF-001-fixture/story.md",
      ]),
    );
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST021-AC-005/AC-008: a draft with missing sources and unmapped entries still succeeds with every gap reported", async () => {
  const root = await workspace(async (dir) => {
    const manifest = baseManifest("TST-925-fixture");
    manifest.sources.specs = ["specs/features/fixture/spec.md"];
    manifest.requirements = [];
    await writeBatch(dir, "TST-925-fixture", manifest, {
      "specs/features/fixture/spec.md": specText,
      "specs/stories/RF-001-fixture/story.md": storyText,
      "specs/stories/RF-001-fixture/acceptance.md": acceptanceText,
      // ADR intentionally not written -> missing.
    });
  });
  try {
    const execution = await run(root, [
      "specs/batches/TST-925-fixture/batch.json",
    ]);

    assert.equal(execution.result.outcome, "success");
    assert.equal(execution.result.exit, 0);

    const codes = execution.result.issues.map((i) => i.code);
    assert.ok(codes.includes("REVIEW_SOURCE_MISSING"));
    assert.ok(codes.includes("REVIEW_REQUIREMENT_UNMAPPED"));
    assert.equal(
      execution.result.issues.length,
      execution.result.data.diagnostics.length,
    );
    for (let index = 0; index < execution.result.issues.length; index += 1) {
      assert.equal(
        execution.result.issues[index].code,
        execution.result.data.diagnostics[index].code,
      );
    }
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST021-AC-006 / security matrix: a `..` path is rejected before any source is read", async () => {
  let root;
  let containerDir;
  await container(async (dir) => {
    containerDir = dir;
    root = join(dir, "repo");
    await mkdir(root, { recursive: true });
    await execFile("git", ["init", "-q"], { cwd: root });
    const manifest = baseManifest("TST-926-fixture");
    manifest.sources.specs = ["../outside.md"];
    await writeBatch(root, "TST-926-fixture", manifest, {
      "specs/stories/RF-001-fixture/story.md": storyText,
      "specs/stories/RF-001-fixture/acceptance.md": acceptanceText,
    });
    // "outside.md" is a sibling of the repo root inside the same disposable
    // container, never a file dropped into the shared OS tmpdir.
    await writeFile(join(dir, "outside.md"), "# outside\n");
  });
  try {
    const execution = await run(root, [
      "specs/batches/TST-926-fixture/batch.json",
    ]);

    assert.equal(execution.result.outcome, "configuration-error");
    assert.equal(execution.result.exit, 2);
    assert.ok(
      execution.result.issues.some((i) => i.code === "REVIEW_MANIFEST_INVALID"),
    );
    assert.equal(execution.result.data, undefined);
  } finally {
    await rm(containerDir, { recursive: true, force: true });
  }
});

test("security matrix: an absolute path is rejected", async () => {
  const root = await workspace(async (dir) => {
    const manifest = baseManifest("TST-927-fixture");
    manifest.sources.specs = ["/etc/hosts"];
    await writeBatch(dir, "TST-927-fixture", manifest, {
      "specs/stories/RF-001-fixture/story.md": storyText,
      "specs/stories/RF-001-fixture/acceptance.md": acceptanceText,
    });
  });
  try {
    const execution = await run(root, [
      "specs/batches/TST-927-fixture/batch.json",
    ]);

    assert.equal(execution.result.outcome, "configuration-error");
    assert.ok(
      execution.result.issues.some((i) => i.code === "REVIEW_MANIFEST_INVALID"),
    );
    assert.equal(execution.result.data, undefined);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("security matrix: a symlinked Story directory pointing outside the repository is rejected", async () => {
  const outside = await mkdtemp(join(tmpdir(), "review-outside-"));
  const root = await workspace(async (dir) => {
    const manifest = baseManifest("TST-928-fixture");
    await writeBatch(dir, "TST-928-fixture", manifest, {
      "specs/decisions/ADR-001-fixture.md": adrText,
      "specs/features/fixture/spec.md": specText,
    });
    await mkdir(join(dir, "specs", "stories"), { recursive: true });
    await symlink(outside, join(dir, "specs", "stories", "RF-001-fixture"));
  });
  try {
    const execution = await run(root, [
      "specs/batches/TST-928-fixture/batch.json",
    ]);

    assert.equal(execution.result.outcome, "configuration-error");
    assert.ok(
      execution.result.issues.some((i) => i.code === "REVIEW_PATH_UNSAFE"),
    );
    assert.equal(execution.result.data, undefined);
  } finally {
    await cleanupWorkspace(root);
    await rm(outside, { recursive: true, force: true });
  }
});

test("security matrix: a symlinked ADR file inside the repository is rejected", async () => {
  const root = await workspace(async (dir) => {
    const manifest = baseManifest("TST-929-fixture");
    await writeBatch(dir, "TST-929-fixture", manifest, {
      "specs/features/fixture/spec.md": specText,
      "specs/stories/RF-001-fixture/story.md": storyText,
      "specs/stories/RF-001-fixture/acceptance.md": acceptanceText,
    });
    await mkdir(join(dir, "specs", "decisions"), { recursive: true });
    await writeFile(join(dir, "specs", "decisions", "ADR-real.md"), adrText);
    await symlink(
      join(dir, "specs", "decisions", "ADR-real.md"),
      join(dir, "specs", "decisions", "ADR-001-fixture.md"),
    );
  });
  try {
    const execution = await run(root, [
      "specs/batches/TST-929-fixture/batch.json",
    ]);

    assert.equal(execution.result.outcome, "configuration-error");
    assert.ok(
      execution.result.issues.some((i) => i.code === "REVIEW_PATH_UNSAFE"),
    );
  } finally {
    await cleanupWorkspace(root);
  }
});

test("code review item 3: a symlinked `specs/batches` directory pointing outside the repository is rejected", async () => {
  const outside = await mkdtemp(join(tmpdir(), "review-outside-batches-"));
  const root = await workspace(async (dir) => {
    await mkdir(join(outside, "TST-940-fixture"), { recursive: true });
    await writeFile(
      join(outside, "TST-940-fixture", "batch.json"),
      JSON.stringify(baseManifest("TST-940-fixture")),
    );
    await mkdir(join(dir, "specs"), { recursive: true });
    await symlink(outside, join(dir, "specs", "batches"));
  });
  try {
    const execution = await run(root, [
      "specs/batches/TST-940-fixture/batch.json",
    ]);

    assert.equal(execution.result.outcome, "configuration-error");
    assert.ok(
      execution.result.issues.some((i) => i.code === "REVIEW_PATH_UNSAFE"),
    );
    assert.equal(execution.result.data, undefined);
  } finally {
    await cleanupWorkspace(root);
    await rm(outside, { recursive: true, force: true });
  }
});

test("code review item 3: a manifest path with the wrong shape is a configuration error", async () => {
  const root = await workspace(async (dir) => {
    // Written at a plausible but non-conforming location: not
    // specs/batches/<BATCH-ID>/batch.json.
    await mkdir(join(dir, "specs", "batches", "TST-941-fixture"), {
      recursive: true,
    });
    await writeFile(
      join(dir, "specs", "batches", "TST-941-fixture", "manifest.json"),
      JSON.stringify(baseManifest("TST-941-fixture")),
    );
  });
  try {
    const execution = await run(root, [
      "specs/batches/TST-941-fixture/manifest.json",
    ]);

    assert.equal(execution.result.outcome, "configuration-error");
    assert.ok(
      execution.result.issues.some((i) => i.code === "REVIEW_MANIFEST_INVALID"),
    );
  } finally {
    await cleanupWorkspace(root);
  }
});

test("code review item 18: an unknown manifest field is a schema violation", async () => {
  const root = await workspace(async (dir) => {
    const manifest = baseManifest("TST-942-fixture");
    manifest.unexpectedField = true;
    await writeBatch(dir, "TST-942-fixture", manifest, baseFixtureFiles());
  });
  try {
    const execution = await run(root, [
      "specs/batches/TST-942-fixture/batch.json",
    ]);

    assert.equal(execution.result.outcome, "configuration-error");
    assert.ok(
      execution.result.issues.some((i) => i.code === "REVIEW_MANIFEST_INVALID"),
    );
  } finally {
    await cleanupWorkspace(root);
  }
});

test("code review item 18: a declared source over 4 MiB is rejected", async () => {
  const root = await workspace(async (dir) => {
    await writeBatch(dir, "TST-943-fixture", baseManifest("TST-943-fixture"), {
      "specs/decisions/ADR-001-fixture.md": "x".repeat(4 * 1024 * 1024 + 1),
      "specs/features/fixture/spec.md": specText,
      "specs/stories/RF-001-fixture/story.md": storyText,
      "specs/stories/RF-001-fixture/acceptance.md": acceptanceText,
    });
  });
  try {
    const execution = await run(root, [
      "specs/batches/TST-943-fixture/batch.json",
    ]);

    assert.equal(execution.result.outcome, "configuration-error");
    assert.ok(
      execution.result.issues.some((i) => i.code === "REVIEW_INPUT_TOO_LARGE"),
    );
    assert.equal(execution.result.data, undefined);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("code review item 18/AC-006: the manifest's own immediate parent directory being a symlink is rejected", async () => {
  const outside = await mkdtemp(join(tmpdir(), "review-outside-parent-"));
  const root = await workspace(async (dir) => {
    await writeFile(
      join(outside, "batch.json"),
      JSON.stringify(baseManifest("TST-944-fixture")),
    );
    await mkdir(join(dir, "specs", "batches"), { recursive: true });
    // Only the per-batch directory is a symlink; specs/batches itself is a
    // real directory, distinguishing this from the specs/batches case above.
    await symlink(outside, join(dir, "specs", "batches", "TST-944-fixture"));
  });
  try {
    const execution = await run(root, [
      "specs/batches/TST-944-fixture/batch.json",
    ]);

    assert.equal(execution.result.outcome, "configuration-error");
    assert.ok(
      execution.result.issues.some((i) => i.code === "REVIEW_PATH_UNSAFE"),
    );
  } finally {
    await cleanupWorkspace(root);
    await rm(outside, { recursive: true, force: true });
  }
});

test("security matrix: a control character in a declared path is rejected without a raw control character in the message", async () => {
  const root = await workspace(async (dir) => {
    const manifest = baseManifest("TST-930-fixture");
    manifest.sources.specs = ["specs/a\x1b[2Jb.md"];
    await writeBatch(dir, "TST-930-fixture", manifest, {
      "specs/stories/RF-001-fixture/story.md": storyText,
      "specs/stories/RF-001-fixture/acceptance.md": acceptanceText,
    });
  });
  try {
    const execution = await run(root, [
      "specs/batches/TST-930-fixture/batch.json",
    ]);

    assert.equal(execution.result.outcome, "configuration-error");
    const target = execution.result.issues.find(
      (i) => i.code === "REVIEW_MANIFEST_INVALID",
    );
    assert.ok(target);
    assert.equal(hasRawControlCharacter(target.message), false);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("security matrix: a manifest over the size limit is rejected without an index", async () => {
  const root = await workspace(async (dir) => {
    const manifest = baseManifest("TST-931-fixture");
    manifest.padding = "x".repeat(1048577);
    await writeBatch(dir, "TST-931-fixture", manifest, {
      "specs/decisions/ADR-001-fixture.md": adrText,
      "specs/features/fixture/spec.md": specText,
      "specs/stories/RF-001-fixture/story.md": storyText,
      "specs/stories/RF-001-fixture/acceptance.md": acceptanceText,
    });
  });
  try {
    const execution = await run(root, [
      "specs/batches/TST-931-fixture/batch.json",
    ]);

    assert.equal(execution.result.outcome, "configuration-error");
    assert.ok(
      execution.result.issues.some((i) => i.code === "REVIEW_INPUT_TOO_LARGE"),
    );
    assert.equal(execution.result.data, undefined);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST021-AC-009: invalid argv is a usage error", async () => {
  const root = await workspace(async () => undefined);
  try {
    const execution = await run(root, []);
    assert.equal(execution.result.outcome, "usage-error");
    assert.equal(execution.result.exit, 2);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("code review item 17: a bare flag-like argument with no manifest path is a usage error, not a help invocation", async () => {
  const root = await workspace(async () => undefined);
  try {
    const execution = await run(root, ["--help"]);
    assert.equal(execution.result.outcome, "usage-error");
    assert.equal(execution.result.exit, 2);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST021-AC-009: a manifest that is not JSON is a configuration error with the contract issue code", async () => {
  const root = await workspace(async (dir) => {
    const batchDir = join(dir, "specs", "batches", "TST-932-fixture");
    await mkdir(batchDir, { recursive: true });
    await writeFile(join(batchDir, "batch.json"), "not json");
  });
  try {
    const execution = await run(root, [
      "specs/batches/TST-932-fixture/batch.json",
    ]);
    assert.equal(execution.result.outcome, "configuration-error");
    assert.equal(execution.result.exit, 2);
    assert.ok(
      execution.result.issues.some((i) => i.code === "REVIEW_MANIFEST_INVALID"),
    );
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST021-AC-009: an unsupported schemaVersion is a configuration error with REVIEW_SCHEMA_UNSUPPORTED", async () => {
  const root = await workspace(async (dir) => {
    const manifest = baseManifest("TST-933-fixture");
    manifest.schemaVersion = "2.0.0";
    await writeBatch(dir, "TST-933-fixture", manifest, baseFixtureFiles());
  });
  try {
    const execution = await run(root, [
      "specs/batches/TST-933-fixture/batch.json",
    ]);
    assert.equal(execution.result.outcome, "configuration-error");
    assert.ok(
      execution.result.issues.some(
        (i) => i.code === "REVIEW_SCHEMA_UNSUPPORTED",
      ),
    );
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST021-AC-009: a mismatched batchId is a configuration error with REVIEW_MANIFEST_INVALID", async () => {
  const root = await workspace(async (dir) => {
    const manifest = baseManifest("TST-935-other");
    await writeBatch(dir, "TST-934-fixture", manifest, baseFixtureFiles());
  });
  try {
    const execution = await run(root, [
      "specs/batches/TST-934-fixture/batch.json",
    ]);
    assert.equal(execution.result.outcome, "configuration-error");
    assert.ok(
      execution.result.issues.some((i) => i.code === "REVIEW_MANIFEST_INVALID"),
    );
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST021 security matrix: a control character in a heading is escaped in diagnostics and human output", async () => {
  const root = await workspace(async (dir) => {
    const manifest = baseManifest("TST-936-fixture");
    manifest.requirements = [];
    await writeBatch(dir, "TST-936-fixture", manifest, {
      "specs/decisions/ADR-001-fixture.md": adrText,
      "specs/features/fixture/spec.md": "## Rules\x1b]8;;http://x\n\ncontent\n",
      "specs/stories/RF-001-fixture/story.md": storyText,
      "specs/stories/RF-001-fixture/acceptance.md": acceptanceText,
    });
  });
  try {
    const execution = await run(root, [
      "specs/batches/TST-936-fixture/batch.json",
    ]);

    assert.equal(execution.result.outcome, "success");
    for (const reported of execution.result.issues) {
      assert.equal(hasRawControlCharacter(reported.message), false);
    }

    const rendered = renderReviewIndexHuman(execution);
    assert.equal(hasDisallowedControlCharacter(rendered.stdout), false);
    assert.match(rendered.stdout, /\\x1b/);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("code review item 15: an uncommitted working-tree change changes the fingerprint; a mtime-only touch does not", async () => {
  const root = await workspace(async (dir) => {
    await writeBatch(
      dir,
      "TST-945-fixture",
      baseManifest("TST-945-fixture"),
      baseFixtureFiles(),
    );
    await execFile("git", ["add", "-A"], { cwd: dir });
    await execFile(
      "git",
      [
        "-c",
        "user.email=t@example.com",
        "-c",
        "user.name=t",
        "commit",
        "-q",
        "-m",
        "fixture",
      ],
      {
        cwd: dir,
      },
    );
  });
  try {
    const manifestArgs = ["specs/batches/TST-945-fixture/batch.json"];
    const committed = await run(root, manifestArgs);
    assert.equal(committed.result.outcome, "success");

    const adrPath = join(root, "specs", "decisions", "ADR-001-fixture.md");
    const stats = await lstat(adrPath);
    const touchedTime = new Date(stats.mtimeMs + 60000);
    await utimes(adrPath, touchedTime, touchedTime);

    const afterTouch = await runReviewIndex(manifestArgs, root);
    assert.equal(
      afterTouch.result.data.fingerprint,
      committed.result.data.fingerprint,
      "a mtime-only touch does not change the fingerprint",
    );

    // Now make an uncommitted content edit (never staged or committed).
    await writeFile(adrPath, `${adrText}uncommitted edit\n`);
    const afterEdit = await runReviewIndex(manifestArgs, root);
    assert.notEqual(
      afterEdit.result.data.fingerprint,
      committed.result.data.fingerprint,
      "an uncommitted working-tree edit changes the fingerprint",
    );

    // Restore the file so the tree-identity check in a future run() call
    // would not be confused by this test's own deliberate edit.
    await writeFile(adrPath, adrText);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST022-AC-006/AC-007: a 1.1.0 manifest with a preface is indexed successfully", async () => {
  const root = await workspace(async (dir) => {
    const manifest = baseManifest("TST-960-fixture");
    manifest.schemaVersion = "1.1.0";
    manifest.preface = "This batch reviews the fixture requirement.";
    await writeBatch(dir, "TST-960-fixture", manifest, baseFixtureFiles());
  });
  try {
    const execution = await run(root, [
      "specs/batches/TST-960-fixture/batch.json",
    ]);
    assert.equal(execution.result.outcome, "success");
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST022-AC-014: a preface in a 1.0.0 manifest is a configuration error with REVIEW_MANIFEST_INVALID", async () => {
  const root = await workspace(async (dir) => {
    const manifest = baseManifest("TST-961-fixture");
    manifest.preface = "Not allowed under 1.0.0.";
    await writeBatch(dir, "TST-961-fixture", manifest, baseFixtureFiles());
  });
  try {
    const execution = await run(root, [
      "specs/batches/TST-961-fixture/batch.json",
    ]);
    assert.equal(execution.result.outcome, "configuration-error");
    assert.equal(execution.result.exit, 2);
    assert.ok(
      execution.result.issues.some((i) => i.code === "REVIEW_MANIFEST_INVALID"),
    );
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST022-AC-014: a preface over 4 KiB UTF-8 is a configuration error with REVIEW_INPUT_TOO_LARGE", async () => {
  const root = await workspace(async (dir) => {
    const manifest = baseManifest("TST-962-fixture");
    manifest.schemaVersion = "1.1.0";
    manifest.preface = "a".repeat(4097);
    await writeBatch(dir, "TST-962-fixture", manifest, baseFixtureFiles());
  });
  try {
    const execution = await run(root, [
      "specs/batches/TST-962-fixture/batch.json",
    ]);
    assert.equal(execution.result.outcome, "configuration-error");
    assert.equal(execution.result.exit, 2);
    assert.ok(
      execution.result.issues.some((i) => i.code === "REVIEW_INPUT_TOO_LARGE"),
    );
  } finally {
    await cleanupWorkspace(root);
  }
});
