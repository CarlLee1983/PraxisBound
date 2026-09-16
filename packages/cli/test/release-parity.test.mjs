import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { runReleaseCheck } from "../dist/release.js";

const execFile = promisify(execFileCallback);
async function git(cwd, args) {
  await execFile("git", args, { cwd, encoding: "utf8" });
}

async function gitOutput(cwd, args) {
  return (await execFile("git", args, { cwd, encoding: "utf8" })).stdout.trim();
}

async function fixture(label) {
  const root = await mkdtemp(join(tmpdir(), `forgeflow-release-${label}-`));
  await writeFile(join(root, "VERSION"), "0.2.1\n");
  await writeFile(join(root, "tracked.txt"), "tracked\n");
  await git(root, ["init", "-q"]);
  await git(root, ["config", "user.email", "release@example.test"]);
  await git(root, ["config", "user.name", "Release Test"]);
  await git(root, ["add", "."]);
  await git(root, ["commit", "-qm", "baseline"]);
  return root;
}

async function plainFixture(label) {
  const root = await mkdtemp(join(tmpdir(), `forgeflow-release-${label}-`));
  await writeFile(join(root, "VERSION"), "0.2.1\n");
  return root;
}

test("TST018-AC-005: retained local release fixtures preserve TypeScript conformance", async (t) => {
  const cases = [
    {
      label: "ready",
      prepare: async () => {},
      outcome: "RELEASE_READY",
      issue: undefined,
    },
    {
      label: "same-head-tag",
      prepare: async (root) => git(root, ["tag", "v0.2.1"]),
      outcome: "RELEASE_READY",
      issue: undefined,
    },
    {
      label: "annotated-tag",
      prepare: async (root) =>
        git(root, [
          "-c",
          "user.name=Release Test",
          "-c",
          "user.email=release@example.test",
          "tag",
          "-a",
          "v0.2.1",
          "-m",
          "release",
        ]),
      outcome: "RELEASE_READY",
      issue: undefined,
    },
    {
      label: "wrong-expected-tag",
      prepare: async (root) => {
        await git(root, ["tag", "v0.2.1"]);
        await writeFile(join(root, "tracked.txt"), "advanced\n");
        await git(root, ["add", "tracked.txt"]);
        await git(root, ["commit", "-qm", "advance"]);
      },
      outcome: "RELEASE_INCOMPLETE",
      issue: "RELEASE_EXPECTED_TAG_WRONG_HEAD",
    },
    {
      label: "non-commit-expected-tag",
      prepare: async (root) => {
        const blob = await gitOutput(root, ["hash-object", "-w", "VERSION"]);
        await git(root, ["update-ref", "refs/tags/v0.2.1", blob]);
      },
      outcome: "RELEASE_INCOMPLETE",
      issue: "RELEASE_EXPECTED_TAG_NOT_COMMIT",
    },
    {
      label: "conflicting-tag",
      prepare: async (root) => git(root, ["tag", "v0.2.0"]),
      outcome: "RELEASE_INCOMPLETE",
      issue: "RELEASE_CONFLICTING_TAG",
    },
    {
      label: "ambiguous-branch-and-tag",
      prepare: async (root) => {
        await git(root, ["branch", "v0.2.0"]);
        await git(root, ["tag", "v0.2.0"]);
      },
      outcome: "RELEASE_INCOMPLETE",
      issue: "RELEASE_CONFLICTING_TAG",
    },
    {
      label: "ordinary-tag",
      prepare: async (root) => git(root, ["tag", "latest"]),
      outcome: "RELEASE_READY",
      issue: undefined,
    },
    {
      label: "dirty-worktree",
      prepare: async (root) =>
        writeFile(join(root, "tracked.txt"), "changed\n"),
      outcome: "RELEASE_INCOMPLETE",
      issue: "RELEASE_WORKTREE_DIRTY",
    },
    {
      label: "invalid-version",
      prepare: async (root) => {
        await writeFile(join(root, "VERSION"), "0.02.1\n");
        await git(root, ["add", "VERSION"]);
        await git(root, ["commit", "-qm", "invalid version"]);
      },
      outcome: "RELEASE_INCOMPLETE",
      issue: "RELEASE_VERSION_INVALID",
    },
    ...[
      ["empty-version", ""],
      ["multiline-version", "0.2.1\nextra\n"],
      ["unterminated-extra-version", "0.2.1\nextra"],
      ["prefixed-version", "v0.2.1\n"],
    ].map(([label, content]) => ({
      label,
      prepare: async (root) => {
        await writeFile(join(root, "VERSION"), content);
        await git(root, ["add", "VERSION"]);
        await git(root, ["commit", "-qm", label]);
      },
      outcome: "RELEASE_INCOMPLETE",
      issue: "RELEASE_VERSION_INVALID",
    })),
    {
      label: "missing-version",
      prepare: async (root) => {
        await git(root, ["rm", "--cached", "VERSION"]);
        await writeFile(join(root, ".gitignore"), "VERSION\n");
        await git(root, ["add", ".gitignore"]);
        await git(root, ["commit", "-qm", "remove VERSION"]);
      },
      outcome: "RELEASE_INCOMPLETE",
      issue: "RELEASE_VERSION_MISSING",
    },
    {
      label: "assume-unchanged",
      prepare: async (root) => {
        await git(root, ["update-index", "--assume-unchanged", "VERSION"]);
        await writeFile(join(root, "VERSION"), "9.9.9\n");
      },
      outcome: "RELEASE_INCOMPLETE",
      issue: "RELEASE_INDEX_FLAGS",
    },
    {
      label: "skip-worktree",
      prepare: async (root) => {
        await git(root, ["update-index", "--skip-worktree", "VERSION"]);
        await writeFile(join(root, "VERSION"), "9.9.9\n");
      },
      outcome: "RELEASE_INCOMPLETE",
      issue: "RELEASE_INDEX_FLAGS",
    },
    {
      label: "replacement-ref",
      prepare: async (root) => {
        const original = await gitOutput(root, ["rev-parse", "HEAD"]);
        await writeFile(join(root, "VERSION"), "9.9.9\n");
        await git(root, ["add", "VERSION"]);
        await git(root, ["commit", "-qm", "replacement source"]);
        const replacement = await gitOutput(root, ["rev-parse", "HEAD"]);
        await git(root, ["replace", original, replacement]);
        await execFile("git", ["reset", "--hard", original], {
          cwd: root,
          env: { ...globalThis.process.env, GIT_NO_REPLACE_OBJECTS: "1" },
          encoding: "utf8",
        });
        await writeFile(join(root, "VERSION"), "9.9.9\n");
      },
      outcome: "RELEASE_INCOMPLETE",
      issue: "RELEASE_VERSION_MISMATCH",
    },
    ...[
      [
        "staged",
        async (root) => {
          await writeFile(join(root, "tracked.txt"), "staged\n");
          await git(root, ["add", "tracked.txt"]);
        },
      ],
      [
        "untracked",
        async (root) => writeFile(join(root, "untracked.txt"), "new\n"),
      ],
      ["deleted", async (root) => rm(join(root, "tracked.txt"))],
      [
        "renamed",
        async (root) => {
          await git(root, ["mv", "tracked.txt", "renamed.txt"]);
        },
      ],
    ].map(([label, prepare]) => ({
      label: `dirty-${label}`,
      prepare,
      outcome: "RELEASE_INCOMPLETE",
      issue: "RELEASE_WORKTREE_DIRTY",
    })),
    {
      label: "dirty-conflict",
      prepare: async (root) => {
        const branch = await gitOutput(root, [
          "symbolic-ref",
          "--short",
          "HEAD",
        ]);
        await git(root, ["checkout", "-qb", "conflict-side"]);
        await writeFile(join(root, "conflict.txt"), "side\n");
        await git(root, ["add", "conflict.txt"]);
        await git(root, ["commit", "-qm", "side conflict"]);
        await git(root, ["checkout", "-q", branch]);
        await writeFile(join(root, "conflict.txt"), "main\n");
        await git(root, ["add", "conflict.txt"]);
        await git(root, ["commit", "-qm", "main conflict"]);
        await assert.rejects(git(root, ["merge", "conflict-side"]));
      },
      outcome: "RELEASE_INCOMPLETE",
      issue: "RELEASE_WORKTREE_DIRTY",
    },
    {
      label: "dirty-submodule",
      prepare: async (root) => {
        const source = await mkdtemp(join(tmpdir(), "forgeflow-submodule-"));
        await git(source, ["init", "-q"]);
        await git(source, ["config", "user.email", "release@example.test"]);
        await git(source, ["config", "user.name", "Release Test"]);
        await writeFile(join(source, "content.txt"), "baseline\n");
        await git(source, ["add", "content.txt"]);
        await git(source, ["commit", "-qm", "baseline"]);
        await git(root, [
          "-c",
          "protocol.file.allow=always",
          "submodule",
          "add",
          "-q",
          source,
          "module",
        ]);
        await git(root, ["add", ".gitmodules", "module"]);
        await git(root, ["commit", "-qm", "add submodule"]);
        await writeFile(join(root, "module", "content.txt"), "dirty\n");
        await rm(source, { recursive: true, force: true });
      },
      outcome: "RELEASE_INCOMPLETE",
      issue: "RELEASE_WORKTREE_DIRTY",
    },
  ];

  for (const entry of cases) {
    const root = await fixture(entry.label);
    t.after(() => rm(root, { recursive: true, force: true }));
    await entry.prepare(root);
    const [explicit, currentDirectory] = await Promise.all([
      runReleaseCheck(["--json", root], "/irrelevant"),
      runReleaseCheck(["--json"], root),
    ]);
    assert.deepEqual(explicit.result, currentDirectory.result, entry.label);
    assert.equal(currentDirectory.result.outcome, entry.outcome, entry.label);
    assert.equal(
      currentDirectory.result.issues[0]?.code,
      entry.issue,
      entry.label,
    );
    assert.equal(
      currentDirectory.result.data.remoteChecks,
      "not-performed",
      entry.label,
    );
  }
});

test("TST018-AC-005: non-Git and unborn fixtures retain typed TypeScript results", async (t) => {
  const nonGit = await plainFixture("non-git");
  const unborn = await plainFixture("unborn");
  t.after(async () => {
    await rm(nonGit, { recursive: true, force: true });
    await rm(unborn, { recursive: true, force: true });
  });
  await git(unborn, ["init", "-q"]);
  for (const [label, root, issue] of [
    ["non-git", nonGit, "RELEASE_NOT_GIT_WORKTREE"],
    ["unborn", unborn, "RELEASE_HEAD_UNAVAILABLE"],
  ]) {
    const [explicit, currentDirectory] = await Promise.all([
      runReleaseCheck(["--json", root], "/irrelevant"),
      runReleaseCheck(["--json"], root),
    ]);
    assert.deepEqual(explicit.result, currentDirectory.result, label);
    assert.equal(currentDirectory.result.outcome, "RELEASE_INCOMPLETE", label);
    assert.equal(currentDirectory.result.issues[0]?.code, issue, label);
    assert.equal(
      currentDirectory.result.data.remoteChecks,
      "not-performed",
      label,
    );
  }
});

test("TST018-AC-005: explicit root and current-directory invocation have equal typed results", async (t) => {
  const root = await fixture("root-equivalence");
  t.after(() => rm(root, { recursive: true, force: true }));
  const [explicit, implicit] = await Promise.all([
    runReleaseCheck(["--json", root], "/irrelevant"),
    runReleaseCheck(["--json"], root),
  ]);
  assert.deepEqual(explicit.result, implicit.result);
});
