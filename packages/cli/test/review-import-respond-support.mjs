import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { runReviewIndex } from "../dist/review.js";

const execFile = promisify(execFileCallback);

/** Every throwaway fixture repository lives under one disposable container, never directly in the shared OS tmpdir. */
export async function container(build) {
  const base = await mkdtemp(join(tmpdir(), "review-import-respond-"));
  try {
    return { base, result: await build(base) };
  } catch (error) {
    await rm(base, { recursive: true, force: true });
    throw error;
  }
}

export async function workspace(build) {
  const { base } = await container(async (containerDir) => {
    const root = join(containerDir, "repo");
    await mkdir(root, { recursive: true });
    await execFile("git", ["init", "-q"], { cwd: root });
    await build(root, containerDir);
  });
  return join(base, "repo");
}

export async function cleanupWorkspace(root) {
  await rm(join(root, ".."), { recursive: true, force: true });
}

export async function writeBatch(root, batchId, manifest, files) {
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

export const specText = "## R-001：Fixture Entry\n\n- AC-001：line.\n";
export const storyText = "# Story: RF-001 Fixture\n";
export const acceptanceText = "# Acceptance Criteria\n\n* [ ] AC-001: done.\n";
export const adrText = "# ADR-001 Fixture\n\nStatus: accepted\n";

export function baseFixtureFiles() {
  return {
    "specs/decisions/ADR-001-fixture.md": adrText,
    "specs/features/fixture/spec.md": specText,
    "specs/stories/RF-001-fixture/story.md": storyText,
    "specs/stories/RF-001-fixture/acceptance.md": acceptanceText,
  };
}

export function baseManifest(batchId) {
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

/** Builds a base fixture batch and returns `{ root, manifestPath }`. */
export async function fixtureRepo(
  batchId,
  files = baseFixtureFiles(),
  manifest = baseManifest(batchId),
) {
  const root = await workspace(async (dir) => {
    await writeBatch(dir, batchId, manifest, files);
  });
  return { root, manifestPath: `specs/batches/${batchId}/batch.json` };
}

/** The current index's `data`, via `review index --json`. */
export async function indexData(root, manifestPath) {
  const execution = await runReviewIndex([manifestPath, "--json"], root);
  if (execution.result.outcome !== "success")
    throw new Error(
      `fixture index failed: ${JSON.stringify(execution.result)}`,
    );
  return execution.result.data;
}

/** The `R-001` entry locator's `blockSha256` from a base fixture index. */
export function r001BlockSha256(data) {
  const entry = data.specs[0]?.entries?.find((e) => e.id === "R-001");
  if (entry === undefined) throw new Error("fixture index has no R-001 entry");
  return entry.locator.blockSha256;
}

export function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
let ulidSequence = 0;

/** A syntactically valid, monotonically distinct `REV-` id (contract §6, `REV-` + 26 Crockford characters). */
export function nextRevisionId() {
  ulidSequence += 1;
  let body = "";
  let value = ulidSequence;
  for (let i = 0; i < 26; i += 1) {
    body = CROCKFORD[value % 32] + body;
    value = Math.floor(value / 32);
  }
  return `REV-${body}`;
}

export function revision(overrides = {}) {
  return {
    id: nextRevisionId(),
    fingerprint: "f".repeat(64),
    targets: [
      {
        path: "specs/features/fixture/spec.md",
        anchor: "R-001",
        blockSha256: "a".repeat(64),
      },
    ],
    quote: "quote",
    kind: "supplement",
    blocking: true,
    proposal: "proposal",
    rationale: "rationale",
    createdAt: "2026-09-17T08:21:04Z",
    ...overrides,
  };
}

export function sheetText(
  batchId,
  fingerprint,
  revisions,
  exportedAt = "2026-09-17T08:30:00Z",
) {
  const json = JSON.stringify({
    schemaVersion: "1.0.0",
    batchId,
    fingerprint,
    exportedAt,
    revisions,
  });
  return `# Revision Sheet\n\n\`\`\`praxisbound-revisions\n${json}\n\`\`\`\n`;
}

export async function writeTempFile(dir, name, content) {
  const path = join(dir, name);
  await writeFile(path, content);
  return path;
}
