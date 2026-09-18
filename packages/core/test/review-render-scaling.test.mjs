import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { TextEncoder } from "node:util";

import { indexReviewBatch, renderReviewProjection } from "../dist/index.js";

// Each pattern below once made one Core projection (index + render) scale
// quadratically or worse through a per-heading, per-entry, per-line, or
// per-character rescan. Every one must stay near-linear up to the 4 MiB
// per-source limit (contract §13); a linear bound is checked by comparing
// two sizes rather than by absolute time, so it holds on slow CI machines.

const SPEC_PATH = "specs/features/scaling/spec.md";
const STORY_DIR = "specs/stories/RF-SCALE-scaling";
const STORY_PATH = `${STORY_DIR}/story.md`;
const ACCEPTANCE_PATH = `${STORY_DIR}/acceptance.md`;
const ADR_PATH = "specs/decisions/ADR-900-scaling.md";

const encoder = new TextEncoder();

const BASE_FILES = {
  [SPEC_PATH]: "## R-900：Scaling fixture\n\n- AC-001: base\n",
  [STORY_PATH]: "# Story: RF-SCALE Scaling\n\n## Goal\n\nbase\n",
  [ACCEPTANCE_PATH]: "# Acceptance Criteria\n\n* [ ] AC-001: base\n",
  [ADR_PATH]: "# ADR-900: Scaling\n\n* Status: Accepted\n",
};

/** Runs index + render for the base fixture with `path`'s content replaced. */
function project(path, text) {
  const files = { ...BASE_FILES, [path]: text };
  const plan = {
    batchId: "TST-922-scaling",
    title: "Scaling fixture",
    preface: undefined,
    manifestSha256: "0".repeat(64),
    adrs: [ADR_PATH],
    specs: [SPEC_PATH],
    stories: [
      {
        directory: STORY_DIR,
        storyId: "RF-SCALE",
        storyPath: STORY_PATH,
        acceptancePath: ACCEPTANCE_PATH,
      },
    ],
    requirements: [{ spec: SPEC_PATH, anchor: "R-900", stories: ["RF-SCALE"] }],
    dependencies: [],
    sources: Object.keys(files).sort(),
    diagnostics: [],
    ambiguousStoryIds: [],
  };
  const observations = new Map(
    Object.entries(files).map(([source, content]) => [
      source,
      { kind: "file", bytes: encoder.encode(content) },
    ]),
  );
  const result = indexReviewBatch(plan, observations);
  assert.equal(result.kind, "ok");
  const documents = result.index.sources.map((source) => ({
    path: source.path,
    bytes: observations.get(source.path)?.bytes,
  }));
  return renderReviewProjection(result.index, documents);
}

function timed(path, text) {
  const start = performance.now();
  project(path, text);
  return performance.now() - start;
}

/** Repeats `unit` to about `bytes` UTF-8 bytes. */
function fill(unit, bytes) {
  return unit.repeat(Math.floor(bytes / encoder.encode(unit).length));
}

const SMALL = 50 * 1024;
const LARGE = 400 * 1024;

/**
 * 8x the input must cost at most ~12x the time plus a small constant: a
 * linear (or n log n) implementation passes with headroom, a quadratic one
 * (~64x) cannot.
 */
function assertNearLinear(path, generate) {
  timed(path, generate(SMALL)); // warm up
  const small = Math.min(
    timed(path, generate(SMALL)),
    timed(path, generate(SMALL)),
    timed(path, generate(SMALL)),
  );
  const large = Math.min(
    timed(path, generate(LARGE)),
    timed(path, generate(LARGE)),
  );
  assert.ok(
    large <= small * 12 + 150,
    `expected near-linear scaling, got ${SMALL}B=${small.toFixed(1)}ms ${LARGE}B=${large.toFixed(1)}ms`,
  );
}

const specEntries = (bytes) => {
  const parts = [];
  let size = 0;
  for (let id = 1; ; id += 1) {
    const unit = `## R-${String(id).padStart(4, "0")}：x\n- AC-001: y\n`;
    const length = encoder.encode(unit).length;
    if (size + length > bytes) return parts.join("");
    parts.push(unit);
    size += length;
  }
};

test("performance (A): many sibling `##` headings scale near-linearly", () => {
  assertNearLinear(SPEC_PATH, (bytes) => fill("## s\n", bytes));
});

test("performance (A): many `######` headings scale near-linearly in story.md and acceptance.md", () => {
  assertNearLinear(STORY_PATH, (bytes) => fill("###### a\n", bytes));
  assertNearLinear(ACCEPTANCE_PATH, (bytes) => fill("###### a\n", bytes));
});

test("performance (B): many Spec entries with AC lines scale near-linearly", () => {
  assertNearLinear(SPEC_PATH, specEntries);
});

test("performance (B): many duplicate Spec entry headings scale near-linearly", () => {
  assertNearLinear(SPEC_PATH, (bytes) => fill("## R-001：x\n", bytes));
});

test("performance (C): `[` runs before one `](` and an unclosed destination scale near-linearly", () => {
  assertNearLinear(
    SPEC_PATH,
    (bytes) => "[".repeat(bytes / 2) + "](" + "x".repeat(bytes / 2),
  );
});

test("performance (C): a run of `[` with no `]` scales near-linearly", () => {
  assertNearLinear(SPEC_PATH, (bytes) => "[".repeat(bytes));
});

test("performance (D): a table divider candidate with a long whitespace run scales near-linearly", () => {
  assertNearLinear(SPEC_PATH, (bytes) => `|a|\n---${" ".repeat(bytes)}x\n`);
});

test("performance (E): many acceptance.md groups with checkbox lines scale near-linearly", () => {
  assertNearLinear(ACCEPTANCE_PATH, (bytes) =>
    fill("## h\n* [ ] AC-001: x\n", bytes),
  );
});

test("performance: a ~4 MiB Spec of `##` headings projects in well under 10 s", () => {
  const text = fill("## s\n", 4 * 1024 * 1024 - 1024);
  const elapsed = timed(SPEC_PATH, text);
  assert.ok(
    elapsed < 10_000,
    `expected < 10000ms, took ${elapsed.toFixed(0)}ms`,
  );
});
