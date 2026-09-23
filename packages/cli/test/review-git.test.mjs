import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { nodeReviewGitAdapter } from "../dist/review-git.js";

const execFile = promisify(execFileCallback);
const roots = [];

async function git(cwd, args) {
  await execFile("git", args, { cwd, encoding: "utf8" });
}

async function gitOutput(cwd, args) {
  return (await execFile("git", args, { cwd, encoding: "utf8" })).stdout.trim();
}

async function tempRepo(label) {
  const root = await mkdtemp(join(tmpdir(), `forgeflow-review-git-${label}-`));
  roots.push(root);
  await git(root, ["init", "-q"]);
  await git(root, ["config", "user.email", "review@example.test"]);
  await git(root, ["config", "user.name", "Review Test"]);
  await git(root, ["config", "commit.gpgsign", "false"]);
  return root;
}

async function tempDir(label) {
  const root = await mkdtemp(join(tmpdir(), `forgeflow-review-git-${label}-`));
  roots.push(root);
  return root;
}

function changeSet(changes) {
  return new Set(
    changes.map((change) => `${change.status}\u0000${change.path}`),
  );
}

test.after(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

test("AC-004: a clean repository with a commit is observed with HEAD and no changes", async () => {
  const root = await tempRepo("clean");
  await writeFile(join(root, "a.txt"), "hello\n");
  await git(root, ["add", "a.txt"]);
  await git(root, ["commit", "-qm", "initial"]);
  const head = await gitOutput(root, ["rev-parse", "HEAD"]);

  const observation = await nodeReviewGitAdapter.observe(root);

  assert.equal(observation.kind, "observed");
  assert.equal(observation.head, head);
  assert.deepEqual(observation.changes, []);
});

test("AC-004: a modified tracked file is reported as a change", async () => {
  const root = await tempRepo("modified");
  await writeFile(join(root, "a.txt"), "hello\n");
  await git(root, ["add", "a.txt"]);
  await git(root, ["commit", "-qm", "initial"]);
  await writeFile(join(root, "a.txt"), "changed\n");

  const observation = await nodeReviewGitAdapter.observe(root);

  assert.equal(observation.kind, "observed");
  assert.deepEqual(changeSet(observation.changes), new Set([" M\u0000a.txt"]));
});

test("AC-004: a staged new file is reported as a change", async () => {
  const root = await tempRepo("staged-new");
  await writeFile(join(root, "a.txt"), "hello\n");
  await git(root, ["add", "a.txt"]);
  await git(root, ["commit", "-qm", "initial"]);
  await writeFile(join(root, "b.txt"), "new\n");
  await git(root, ["add", "b.txt"]);

  const observation = await nodeReviewGitAdapter.observe(root);

  assert.equal(observation.kind, "observed");
  assert.deepEqual(changeSet(observation.changes), new Set(["A \u0000b.txt"]));
});

test("AC-004: a deleted tracked file is reported as a change", async () => {
  const root = await tempRepo("deleted");
  await writeFile(join(root, "a.txt"), "hello\n");
  await git(root, ["add", "a.txt"]);
  await git(root, ["commit", "-qm", "initial"]);
  await rm(join(root, "a.txt"));

  const observation = await nodeReviewGitAdapter.observe(root);

  assert.equal(observation.kind, "observed");
  assert.deepEqual(changeSet(observation.changes), new Set([" D\u0000a.txt"]));
});

test("AC-004: an untracked file inside a nested directory is reported as a change", async () => {
  const root = await tempRepo("untracked-nested");
  await writeFile(join(root, "a.txt"), "hello\n");
  await git(root, ["add", "a.txt"]);
  await git(root, ["commit", "-qm", "initial"]);
  await mkdir(join(root, "nested"), { recursive: true });
  await writeFile(join(root, "nested", "new.txt"), "new\n");

  const observation = await nodeReviewGitAdapter.observe(root);

  assert.equal(observation.kind, "observed");
  assert.deepEqual(
    changeSet(observation.changes),
    new Set(["??\u0000nested/new.txt"]),
  );
});

test("AC-004: a rename reports both the new and the original path", async () => {
  const root = await tempRepo("rename");
  await writeFile(join(root, "a.txt"), "hello\n");
  await git(root, ["add", "a.txt"]);
  await git(root, ["commit", "-qm", "initial"]);
  await git(root, ["mv", "a.txt", "b.txt"]);

  const observation = await nodeReviewGitAdapter.observe(root);

  assert.equal(observation.kind, "observed");
  const paths = observation.changes.map((change) => change.path).sort();
  assert.deepEqual(paths, ["a.txt", "b.txt"]);
  for (const change of observation.changes) {
    assert.equal(change.status[0], "R");
  }
});

test("AC-004: a path containing an ESC byte and a space is returned exactly, not C-quoted", async () => {
  const root = await tempRepo("esc-path");
  await writeFile(join(root, "a.txt"), "hello\n");
  await git(root, ["add", "a.txt"]);
  await git(root, ["commit", "-qm", "initial"]);
  const weirdName = "weird\u001b name.txt";
  await writeFile(join(root, weirdName), "new\n");

  const observation = await nodeReviewGitAdapter.observe(root);

  assert.equal(observation.kind, "observed");
  const paths = observation.changes.map((change) => change.path);
  assert.ok(
    paths.includes(weirdName),
    `expected ${JSON.stringify(paths)} to include ${JSON.stringify(weirdName)}`,
  );
});

test("AC-004: root as a subdirectory of the repository reports root-relative paths", async () => {
  const root = await tempRepo("subdirectory");
  await mkdir(join(root, "sub"), { recursive: true });
  await writeFile(join(root, "sub", "a.txt"), "hello\n");
  await writeFile(join(root, "top.txt"), "top\n");
  await git(root, ["add", "."]);
  await git(root, ["commit", "-qm", "initial"]);
  await writeFile(join(root, "sub", "a.txt"), "changed\n");
  await writeFile(join(root, "top.txt"), "changed\n");

  const observation = await nodeReviewGitAdapter.observe(join(root, "sub"));

  assert.equal(observation.kind, "observed");
  const paths = observation.changes.map((change) => change.path);
  assert.deepEqual(paths, ["a.txt"]);
});

test("AC-004: an unborn branch is observed with head undefined", async () => {
  const root = await tempRepo("unborn");
  await writeFile(join(root, "a.txt"), "hello\n");

  const observation = await nodeReviewGitAdapter.observe(root);

  assert.equal(observation.kind, "observed");
  assert.equal(observation.head, undefined);
  assert.deepEqual(changeSet(observation.changes), new Set(["??\u0000a.txt"]));
});

test("AC-004: a directory outside any git repository is not-a-repository", async () => {
  const root = await tempDir("outside");

  const observation = await nodeReviewGitAdapter.observe(root);

  assert.deepEqual(observation, { kind: "not-a-repository" });
});

test("AC-004: a missing git executable is reported as failed", async () => {
  const root = await tempRepo("no-git");
  const emptyPath = await tempDir("empty-path");
  const priorPath = globalThis.process.env.PATH;
  globalThis.process.env.PATH = emptyPath;
  try {
    const observation = await nodeReviewGitAdapter.observe(root);
    assert.deepEqual(observation, { kind: "failed" });
  } finally {
    globalThis.process.env.PATH = priorPath;
  }
});

test("AC-004: GIT_DIR in the caller's environment does not redirect the observation", async () => {
  const root = await tempRepo("git-dir-leak");
  await writeFile(join(root, "a.txt"), "hello\n");
  await git(root, ["add", "a.txt"]);
  await git(root, ["commit", "-qm", "initial"]);
  await writeFile(join(root, "b.txt"), "new\n");

  const otherRoot = await tempRepo("git-dir-leak-decoy");
  const priorGitDir = globalThis.process.env.GIT_DIR;
  globalThis.process.env.GIT_DIR = join(otherRoot, ".git");
  try {
    const observation = await nodeReviewGitAdapter.observe(root);
    assert.equal(observation.kind, "observed");
    const paths = observation.changes.map((change) => change.path);
    assert.deepEqual(paths, ["b.txt"]);
  } finally {
    if (priorGitDir === undefined) delete globalThis.process.env.GIT_DIR;
    else globalThis.process.env.GIT_DIR = priorGitDir;
  }
});
