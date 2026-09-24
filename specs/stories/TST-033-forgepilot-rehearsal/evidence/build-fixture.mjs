#!/usr/bin/env node
// TST-033：建立演練用的隔離 fixture repository（1 份 Spec、3 張有依賴的 Story、各自的 Readiness Sidecar）。
// 用法：node build-fixture.mjs <empty-target-directory>
// Sidecar 的兩個 digest 先填 0，由 `review readiness-digests` 更新，以實際走過該命令。
import { execFileSync } from "node:child_process";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const BATCH_ID = "BR-900-rehearsal";
const ZERO_DIGEST = `sha256:${"0".repeat(64)}`;

const STORIES = [
  {
    id: "FX-001",
    slug: "greet-function",
    title: "Greeting function",
    goal: "Add `greet(name)` in `src/greet.js`, returning `Hello, <name>!`.",
    scope: "Create `src/greet.js` exporting `greet`.",
    ac: "`greet(\"Ada\")` returns `Hello, Ada!`.",
    dependsOn: [],
  },
  {
    id: "FX-002",
    slug: "greet-test",
    title: "Greeting test",
    goal: "Cover `greet` with a `node:test` test in `test/greet.test.js`.",
    scope: "Create `test/greet.test.js`; `node --test` passes.",
    ac: "`node --test` runs the greeting test and it passes.",
    dependsOn: ["FX-001"],
  },
  {
    id: "FX-003",
    slug: "greet-readme",
    title: "Greeting usage note",
    goal: "Document `greet` usage in `README.md`.",
    scope: "Add a Usage section to `README.md`.",
    ac: "`README.md` shows one `greet` call and its output.",
    dependsOn: ["FX-001"],
  },
];

function storyText(story) {
  return `# Story: ${story.id} ${story.title}

## Goal

${story.goal}

## Scope

* ${story.scope}

## Classification

* Security sensitive: no
* Baseline conformance: no
* Task mode: execution

## Authority

* plan: yes
* modify: yes
* add_dependency: no
* migration: no
* commit: no
* push: no
* deploy: no
`;
}

function acceptanceText(story) {
  return `# Acceptance Criteria

## Happy Path

* [ ] AC-001: ${story.ac}

## Acceptance Evidence

| AC | Method | Evidence | Fixture / precondition | Expected observation |
| --- | --- | --- | --- | --- |
| \`AC-001\` | test | \`node --test\` | \`fixture repository\` | \`pass\` |
`;
}

function readiness(storyRef) {
  return {
    schema_version: 1,
    story_ref: storyRef,
    story_md_digest: ZERO_DIGEST,
    acceptance_md_digest: ZERO_DIGEST,
    criteria: [
      {
        id: "AC-001",
        operations: ["plan", "modify"],
        owner: "runner_worker",
        future_identities: [],
      },
    ],
    inputs: [],
    outputs: [],
    decision_follow_ups: [],
  };
}

async function put(root, path, content) {
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content);
}

async function main() {
  const target = process.argv[2];
  if (!target) throw new Error("usage: build-fixture.mjs <empty-target-directory>");
  const root = resolve(target);
  await mkdir(root, { recursive: true });
  if ((await readdir(root)).length > 0) throw new Error("target directory is not empty");

  const storyDirs = STORIES.map((s) => `specs/stories/${s.id}-${s.slug}`);
  await put(root, "README.md", "# Greeting fixture\n\nRehearsal fixture for PraxisBound TST-033.\n");
  await put(root, "package.json", `${JSON.stringify({ name: "greeting-fixture", private: true, type: "module", scripts: { test: "node --test" } }, null, 2)}\n`);
  await put(
    root,
    "specs/features/greeting/spec.md",
    "# Spec：Greeting\n\n## R-001：Greeting function\n\n- AC-001：`greet(name)` 回傳 `Hello, <name>!`，有測試與使用說明。\n",
  );
  for (const [i, story] of STORIES.entries()) {
    const dir = storyDirs[i];
    await put(root, `${dir}/story.md`, storyText(story));
    await put(root, `${dir}/acceptance.md`, acceptanceText(story));
    await put(root, `${dir}/readiness.json`, `${JSON.stringify(readiness(dir), null, 2)}\n`);
  }
  const manifest = {
    schemaVersion: "1.1.0",
    batchId: BATCH_ID,
    title: "Greeting rehearsal batch",
    sources: { adrs: [], specs: ["specs/features/greeting/spec.md"], stories: storyDirs },
    requirements: [
      { spec: "specs/features/greeting/spec.md", anchor: "R-001", stories: STORIES.map((s) => s.id) },
    ],
    dependencies: STORIES.filter((s) => s.dependsOn.length > 0).map((s) => ({ story: s.id, dependsOn: s.dependsOn })),
  };
  await put(root, `specs/batches/${BATCH_ID}/batch.json`, `${JSON.stringify(manifest, null, 2)}\n`);

  const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  git("init", "-q", "-b", "main");
  git("config", "user.name", "TST-033 rehearsal");
  git("config", "user.email", "rehearsal@example.invalid");
  git("add", "-A");
  git("commit", "-q", "-m", "chore: rehearsal fixture");
  process.stdout.write(`${root}\n`);
}

await main();
