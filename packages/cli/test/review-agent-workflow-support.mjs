import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { validateResultEnvelope } from "@praxisbound/core";

import { runReviewImport } from "../dist/review-import.js";
import { runReviewRespond } from "../dist/review-respond.js";

import { sha256Hex, sheetText } from "./review-import-respond-support.mjs";

/**
 * The definition sources every base fixture repository declares (contract
 * §5's per-route ownership is proven by hashing exactly these paths before
 * and after a scripted route, TST025-AC-002 / AC-004).
 */
export const DEFINITION_SOURCES = [
  "specs/decisions/ADR-001-fixture.md",
  "specs/features/fixture/spec.md",
  "specs/stories/RF-001-fixture/story.md",
  "specs/stories/RF-001-fixture/acceptance.md",
];

/** Writes `revisions` as one exported sheet and imports it, asserting success. */
export async function importSheet(root, manifestPath, batchId, revisions) {
  const text = sheetText(batchId, revisions[0].fingerprint, revisions);
  const sheetFile = join(root, "..", `sheet-${revisions[0].id}.md`);
  await writeFile(sheetFile, text);
  const execution = await runReviewImport(
    [manifestPath, sheetFile, "--json"],
    root,
  );
  assert.equal(
    execution.result.outcome,
    "success",
    JSON.stringify(execution.result),
  );
  return execution.result.data;
}

/** Writes `text` as a responses file and runs `review respond`, asserting a valid envelope. */
export async function respond(root, manifestPath, text) {
  const file = join(
    root,
    "..",
    `responses-${sha256Hex(text).slice(0, 12)}.json`,
  );
  await writeFile(file, text);
  const execution = await runReviewRespond(
    [manifestPath, file, "--json"],
    root,
  );
  assert.deepEqual(validateResultEnvelope(execution.result), {
    ok: true,
    value: execution.result,
  });
  return execution;
}

/** The sorted issue codes on an execution's result. */
export function codes(execution) {
  return execution.result.issues.map((i) => i.code).sort();
}

/**
 * Reads the current bytes of every path in `relativePaths` (relative to
 * `root`) and returns a `Map` from path to sha256, used to prove a scripted
 * route only touched the source(s) its boundary owns (contract §5, R-005
 * `route` table, TST025-AC-002 / AC-004).
 */
export async function hashSources(root, relativePaths) {
  const hashes = new Map();
  for (const path of relativePaths) {
    const bytes = await readFile(join(root, path));
    hashes.set(path, sha256Hex(bytes));
  }
  return hashes;
}

/** Asserts every path in `before` still hashes to the same value in `root`. */
export function assertUnchanged(before, after, paths) {
  for (const path of paths) {
    const beforeHash = before.get(path);
    const afterHash = after.get(path);
    if (beforeHash === undefined || afterHash === undefined)
      throw new Error(`missing hash for ${path}`);
    if (beforeHash !== afterHash)
      throw new Error(`expected ${path} to be byte-identical but it changed`);
  }
}

/** Asserts every path in `paths` changed between `before` and `after`. */
export function assertChanged(before, after, paths) {
  for (const path of paths) {
    const beforeHash = before.get(path);
    const afterHash = after.get(path);
    if (beforeHash === undefined || afterHash === undefined)
      throw new Error(`missing hash for ${path}`);
    if (beforeHash === afterHash)
      throw new Error(`expected ${path} to change but it is byte-identical`);
  }
}

/** File names directly under the batch's `records/` directory, or `[]` if it does not exist. */
export async function recordFileNames(root, batchId) {
  const dir = join(root, "specs", "batches", batchId, "records");
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

export function response(revisionId, overrides = {}) {
  return {
    revisionId,
    route: "presentation",
    outcome: "not-incorporated",
    rationale: "rationale",
    locators: [],
    ...overrides,
  };
}

export function responsesText(
  batchId,
  fromFingerprint,
  toFingerprint,
  revisionSheets,
  responses,
  overrides = {},
) {
  return JSON.stringify({
    schemaVersion: "1.0.0",
    batchId,
    fromFingerprint,
    toFingerprint,
    revisionSheets,
    respondedAt: "2026-09-22T00:00:00Z",
    agent: "test-scripted-agent",
    responses,
    ...overrides,
  });
}

/** The Spec entry locator for `entryId` from a `review index --json` `data`. */
export function specEntryLocator(data, entryId) {
  const entry = data.specs[0]?.entries?.find((e) => e.id === entryId);
  if (entry === undefined)
    throw new Error(`fixture index has no ${entryId} entry`);
  return entry.locator;
}

/** The acceptance-file locator for explicit anchor `anchor` from `data`. */
export function acceptanceLocator(data, anchor) {
  const locator = data.stories[0]?.locators?.acceptance?.find(
    (l) => l.anchor === anchor,
  );
  if (locator === undefined)
    throw new Error(`fixture index has no acceptance anchor ${anchor}`);
  return locator;
}

/** The ADR document locator for explicit anchor `anchor` from `data`. */
export function adrLocator(data, anchor) {
  const locator = data.adrs[0]?.locators?.find((l) => l.anchor === anchor);
  if (locator === undefined)
    throw new Error(`fixture index has no ADR anchor ${anchor}`);
  return locator;
}
