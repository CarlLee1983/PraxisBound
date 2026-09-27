import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { sha256Hex } from "./review-import-respond-support.mjs";

const execFile = promisify(execFileCallback);
export const BATCH_ID = "BR-127-e2e";
export const STORY_IDS = ["FX-001", "FX-002", "FX-003", "FX-004"];
export const DEPENDENCIES = [
  { story: "FX-002", dependsOn: ["FX-001"] },
  { story: "FX-003", dependsOn: ["FX-001"] },
  { story: "FX-004", dependsOn: ["FX-002", "FX-003"] },
];

export function manifest() {
  return {
    schemaVersion: "1.0.0",
    batchId: BATCH_ID,
    sources: {
      adrs: ["specs/decisions/ADR-001-fixture.md"],
      specs: ["specs/features/alpha/spec.md", "specs/features/beta/spec.md"],
      stories: STORY_IDS.map((id) => `specs/stories/${id}-fixture`),
    },
    requirements: [
      {
        spec: "specs/features/alpha/spec.md",
        anchor: "R-001",
        stories: ["FX-001", "FX-002"],
      },
      {
        spec: "specs/features/beta/spec.md",
        anchor: "R-002",
        stories: ["FX-003", "FX-004"],
      },
    ],
    dependencies: globalThis.structuredClone(DEPENDENCIES),
  };
}

const acceptance = `# Acceptance Criteria\n\n* [ ] AC-001: The fixture passes its local verification.\n\n## Acceptance Evidence\n\n| AC | Method | Evidence | Fixture / precondition | Expected observation |\n| --- | --- | --- | --- | --- |\n| \`AC-001\` | command | \`make verify\` | \`isolated repository\` | \`fixture-verify-pass\` |\n`;

export async function fixture() {
  const base = await mkdtemp(join(tmpdir(), "review-batch-e2e-"));
  const root = join(base, "repo");
  await mkdir(root);
  try {
    await execFile("git", ["init", "-q"], { cwd: root });
    const files = {
      "specs/decisions/ADR-001-fixture.md":
        "# ADR-001 Fixture\n\nStatus: accepted\n",
      "specs/features/alpha/spec.md":
        "## R-001：Alpha\n\n- AC-001：The alpha behavior works.\n",
      "specs/features/beta/spec.md":
        "## R-002：Beta\n\n- AC-001：The beta behavior works.\n",
      Makefile: ".PHONY: verify\nverify:\n\t@echo fixture-verify-pass\n",
    };
    for (const id of STORY_IDS) {
      const dir = `specs/stories/${id}-fixture`;
      const story = `# Story: ${id} Fixture\n\n## Goal\n\nExercise ${id}.\n\n## Scope\n\n* Check the fixture local verification command and record its output.\n\n## Classification\n\n* Security sensitive: no\n* Baseline conformance: no\n* Task mode: execution\n\n## Authority\n\n* plan: yes\n* modify: yes\n* add_dependency: no\n* migration: no\n* commit: no\n* push: no\n* deploy: no\n`;
      files[`${dir}/story.md`] = story;
      files[`${dir}/acceptance.md`] = acceptance;
      files[`${dir}/readiness.json`] = JSON.stringify({
        schema_version: 1,
        story_ref: dir,
        story_md_digest: `sha256:${sha256Hex(story)}`,
        acceptance_md_digest: `sha256:${sha256Hex(acceptance)}`,
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
      });
    }
    const manifestPath = `specs/batches/${BATCH_ID}/batch.json`;
    files[manifestPath] = JSON.stringify(manifest());
    for (const [path, content] of Object.entries(files)) {
      await mkdir(join(root, path, ".."), { recursive: true });
      await writeFile(join(root, path), content);
    }
    return {
      root,
      manifestPath,
      cleanup: () => rm(base, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(base, { recursive: true, force: true });
    throw error;
  }
}

export async function semanticReport(root, fingerprint) {
  const none = { result: "none" };
  const report = {
    schemaVersion: "1.0.0",
    batchId: BATCH_ID,
    fingerprint,
    agent: "e2e-fixture-agent 1.0",
    observedAt: "2026-09-27T00:00:00Z",
    stories: STORY_IDS.map((story) => ({
      story,
      categories: {
        "missing-split": none,
        contradiction: none,
        "insufficient-acceptance": none,
        "open-question": none,
      },
    })),
  };
  await writeFile(join(root, "semantic-report.json"), JSON.stringify(report));
  return "semantic-report.json";
}

export function terminal(answers) {
  let next = 0;
  const transcript = [];
  return {
    stdinIsTTY: true,
    stdoutIsTTY: true,
    transcript,
    write(value) {
      transcript.push(value);
    },
    async question(prompt) {
      transcript.push(prompt);
      return answers[next++];
    },
  };
}

export async function readJson(root, path) {
  return JSON.parse(await readFile(join(root, path), "utf8"));
}

export function expectOutcome(execution, outcome) {
  assert.equal(
    execution.result.outcome,
    outcome,
    JSON.stringify(execution.result),
  );
}
