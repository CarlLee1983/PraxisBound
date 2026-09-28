#!/usr/bin/env node
// TST-041：建立隔離的 2 份 Spec、4 張有依賴 Story 的真實 Runner 演練 fixture。
// 用法：node build-fixture.mjs <empty-target-directory> [batch-id]
// Sidecar 的兩個 digest 先填 0，由 `review readiness-digests` 更新，以實際走過該命令。
import { execFileSync } from "node:child_process";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const BATCH_ID = process.argv[3] ?? "BR-941-live";
const ZERO_DIGEST = `sha256:${"0".repeat(64)}`;

const STORIES = [
  {
    id: "FX-001",
    slug: "greet-function",
    title: "Greeting function",
    goal: "Add `greet(name)` in `src/greet.js`, returning `Hello, <name>!`.",
    scope: "Create `src/greet.js` exporting `greet`.",
    ac: '`greet("Ada")` returns `Hello, Ada!` and `greet("Lin")` returns `Hello, Lin!`.',
    dependsOn: [],
  },
  {
    id: "FX-002",
    slug: "greet-test",
    title: "Greeting test",
    goal: "Cover `greet` with a `node:test` test in `test/greet.test.js`.",
    scope: "Create `test/greet.test.js`; `node --test` passes.",
    ac: "`node --test` runs tests for both greeting examples and they pass.",
    dependsOn: ["FX-001"],
  },
  {
    id: "FX-003",
    slug: "farewell-function",
    title: "Farewell function",
    goal: "Add `farewell(name)` in `src/farewell.js`, returning `Goodbye, <name>!`.",
    scope:
      "Create `src/farewell.js` exporting `farewell` and `test/farewell.test.js` with a passing example.",
    ac: '`farewell("Ada")` returns `Goodbye, Ada!`, with a passing `node --test` case.',
    dependsOn: [],
  },
  {
    id: "FX-004",
    slug: "usage-readme",
    title: "Usage examples",
    goal: "Document both `greet` and `farewell` in `README.md`.",
    scope:
      "Add a Usage section to `README.md` showing calls and outputs for both functions.",
    ac: "`README.md` shows one call and its output for each function.",
    dependsOn: ["FX-002", "FX-003"],
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
  if (!target)
    throw new Error("usage: build-fixture.mjs <empty-target-directory>");
  const root = resolve(target);
  await mkdir(root, { recursive: true });
  if ((await readdir(root)).length > 0)
    throw new Error("target directory is not empty");

  const storyDirs = STORIES.map((s) => `specs/stories/${s.id}-${s.slug}`);
  await put(
    root,
    "README.md",
    "# Greeting and farewell fixture\n\nRehearsal fixture for PraxisBound TST-041.\n",
  );
  // ForgePilot 的 Runner 在每個 Work Item 之後執行 `make verify`。
  await put(
    root,
    "Makefile",
    "verify:\n\tnode --test\n\nverify-final:\n\tREQUIRE_COMPLETE=1 node --test\n",
  );
  await put(
    root,
    "package.json",
    `${JSON.stringify({ name: "batch-review-live-fixture", private: true, type: "module", scripts: { test: "node --test" } }, null, 2)}\n`,
  );
  await put(
    root,
    "test/acceptance.test.js",
    `import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const strict = process.env.REQUIRE_COMPLETE === "1";
function pending(name) {
  if (strict) test(name, () => assert.fail("required Story output is missing"));
  else test.skip(name, () => {});
}

if (existsSync("src/greet.js")) {
  test("greet public examples", async () => {
    const { greet } = await import("../src/greet.js");
    assert.equal(greet("Ada"), "Hello, Ada!");
    assert.equal(greet("Lin"), "Hello, Lin!");
  });
} else pending("greet public examples: Story FX-001 pending");

if (strict) {
  test("FX-002 has its own executable tests", () => {
    assert.ok(existsSync("test/greet.test.js"));
    assert.match(readFileSync("test/greet.test.js", "utf8"), /\\btest\\s*\\(/);
  });
}

if (existsSync("src/farewell.js")) {
  test("farewell public example", async () => {
    const { farewell } = await import("../src/farewell.js");
    assert.equal(farewell("Ada"), "Goodbye, Ada!");
  });
} else pending("farewell public example: Story FX-003 pending");

if (strict) {
  test("FX-003 has its own executable test", () => {
    assert.ok(existsSync("test/farewell.test.js"));
    assert.match(readFileSync("test/farewell.test.js", "utf8"), /\\btest\\s*\\(/);
  });
}

const readme = readFileSync("README.md", "utf8");
if (readme.includes("## Usage")) {
  test("usage describes both calls and outputs", () => {
    assert.match(readme, /greet\\(/);
    assert.match(readme, /Hello, Ada!/);
    assert.match(readme, /farewell\\(/);
    assert.match(readme, /Goodbye, Ada!/);
  });
} else pending("usage examples: Story FX-004 pending");
`,
  );
  await put(
    root,
    "specs/features/greeting/spec.md",
    "# Spec：Greeting\n\n## R-001：Greeting function and tests\n\n- AC-001：`greet(name)` 回傳 `Hello, <name>!`，且 `node --test` 涵蓋 Ada 與 Lin。\n",
  );
  await put(
    root,
    "specs/features/farewell/spec.md",
    "# Spec：Farewell\n\n## R-002：Farewell and usage\n\n- AC-001：`farewell(name)` 回傳 `Goodbye, <name>!`，有測試；README 同時說明 greet 與 farewell。\n",
  );
  for (const [i, story] of STORIES.entries()) {
    const dir = storyDirs[i];
    await put(root, `${dir}/story.md`, storyText(story));
    await put(root, `${dir}/acceptance.md`, acceptanceText(story));
    await put(
      root,
      `${dir}/readiness.json`,
      `${JSON.stringify(readiness(dir), null, 2)}\n`,
    );
  }
  const manifest = {
    schemaVersion: "1.1.0",
    batchId: BATCH_ID,
    title: "Greeting and farewell rehearsal batch",
    sources: {
      adrs: [],
      specs: [
        "specs/features/greeting/spec.md",
        "specs/features/farewell/spec.md",
      ],
      stories: storyDirs,
    },
    requirements: [
      {
        spec: "specs/features/greeting/spec.md",
        anchor: "R-001",
        stories: ["FX-001", "FX-002"],
      },
      {
        spec: "specs/features/farewell/spec.md",
        anchor: "R-002",
        stories: ["FX-003", "FX-004"],
      },
    ],
    dependencies: STORIES.filter((s) => s.dependsOn.length > 0).map((s) => ({
      story: s.id,
      dependsOn: s.dependsOn,
    })),
  };
  await put(
    root,
    `specs/batches/${BATCH_ID}/batch.json`,
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  const git = (...args) =>
    execFileSync("git", args, { cwd: root, stdio: "pipe" });
  git("init", "-q", "-b", "main");
  git("config", "user.name", "TST-041 rehearsal");
  git("config", "user.email", "rehearsal@example.invalid");
  git("add", "-A");
  git("commit", "-q", "-m", "chore: rehearsal fixture");
  process.stdout.write(`${root}\n`);
}

await main();
