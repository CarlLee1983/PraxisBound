import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import process from "node:process";
import test from "node:test";
import { TextEncoder } from "node:util";

import { indexReviewBatch, renderReviewProjection } from "../dist/index.js";

// Each pattern below once made one Core projection (index + render) scale
// quadratically or worse through a per-heading, per-entry, per-line, or
// per-character rescan. Every one must stay near-linear up to the 4 MiB
// per-source limit (contract §13); a linear bound is checked by comparing
// two sizes rather than by absolute time, so it holds on slow CI machines.
//
// `pnpm test` runs every `*.test.mjs` file as one `node --test` invocation,
// and Node's own test runner schedules test files concurrently by default;
// isolating this file would mean restructuring that shared command for every
// suite. Instead each measurement interleaves small and large runs and
// compares medians over several rounds, so a scheduling hiccup that lands on
// one run lands on both series rather than only skewing one of them, and the
// pass/fail ratio carries generous headroom (16x for an 8x input, against a
// quadratic implementation's ~64x) so the guard survives a busy machine
// without losing its ability to catch a real regression.

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
  return renderReviewProjection(result.index, documents, "manifest.json");
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

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

const SMALL = 50 * 1024;
const LARGE = 400 * 1024;
const ROUNDS = 5;

/**
 * 8x the input must cost at most ~16x the time plus a small constant: a
 * linear (or n log n) implementation passes with headroom, a quadratic one
 * (~64x) cannot. Small and large runs alternate, one round at a time, and
 * the assertion compares medians rather than single samples so a scheduling
 * hiccup under a concurrently running test suite does not land on only one
 * side of the ratio.
 */
function assertNearLinear(path, generate) {
  const smallText = generate(SMALL);
  const largeText = generate(LARGE);
  timed(path, smallText); // warm up
  timed(path, largeText); // warm up
  const smalls = [];
  const larges = [];
  for (let round = 0; round < ROUNDS; round += 1) {
    smalls.push(timed(path, smallText));
    larges.push(timed(path, largeText));
  }
  const small = median(smalls);
  const large = median(larges);
  assert.ok(
    large <= small * 16 + 300,
    `expected near-linear scaling, got ${SMALL}B=${small.toFixed(1)}ms ${LARGE}B=${large.toFixed(1)}ms (medians of ${ROUNDS})`,
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
  // A generator that replaces the whole file with nothing but `######`
  // lines exercises the fast path for text before the first heading, not
  // the per-heading rescan the pattern is meant to catch (it stayed inside
  // the same near-linear ratio on both the buggy and the fixed build). A
  // short real preamble before the fill puts every `######` line after at
  // least one heading, which does discriminate: on the pre-fix build this
  // variant measured ~75x (story.md) and ~92x (acceptance.md) for an 8x
  // input, against ~9x here.
  assertNearLinear(
    STORY_PATH,
    (bytes) =>
      "# Story: RF-SCALE Scaling\n\n## Goal\n\n" + fill("###### a\n", bytes),
  );
  assertNearLinear(
    ACCEPTANCE_PATH,
    (bytes) => "# Acceptance Criteria\n\n" + fill("###### a\n", bytes),
  );
});

test("performance (B): many Spec entries with AC lines scale near-linearly", () => {
  assertNearLinear(SPEC_PATH, specEntries);
});

test("performance (B): many duplicate Spec entry headings scale near-linearly", () => {
  assertNearLinear(SPEC_PATH, (bytes) => fill("## R-001：x\n", bytes));
});

// The `[`/table-divider generators below are prefixed with a `## h\n`
// heading so the generated text renders as ordinary body content under a
// heading, the same as a real document. Without it, the whole file is text
// before the first heading, which takes a different, coincidentally fast
// path and does not exercise the per-character rescan these patterns are
// meant to catch (measured ~5-7x for an 8x input on the pre-fix build,
// against ~60-65x once a heading precedes the same text).

test("performance (C): `[` runs before one `](` and an unclosed destination scale near-linearly", () => {
  assertNearLinear(
    SPEC_PATH,
    (bytes) => "## h\n" + "[".repeat(bytes / 2) + "](" + "x".repeat(bytes / 2),
  );
});

test("performance (C): a run of `[` with no `]` scales near-linearly", () => {
  assertNearLinear(SPEC_PATH, (bytes) => "## h\n" + "[".repeat(bytes));
});

test("performance (D): a table divider candidate with a long whitespace run scales near-linearly", () => {
  assertNearLinear(
    SPEC_PATH,
    (bytes) => `## h\n|a|\n---${" ".repeat(bytes)}x\n`,
  );
});

test("performance (E): many acceptance.md groups with checkbox lines scale near-linearly", () => {
  assertNearLinear(ACCEPTANCE_PATH, (bytes) =>
    fill("## h\n* [ ] AC-001: x\n", bytes),
  );
});

// The absolute-time smoke test below is wall-clock, not ratio-based, so it
// has only 2-3x headroom against a 10s budget at the 4 MiB per-source limit
// (contract §13) and is timing-sensitive under a loaded, concurrent
// `node --test` run. The linear-ratio tests above already guard the
// regression this once caught; this one is an extra, opt-in smoke check for
// a quiet machine, run with:
//   PRAXISBOUND_PERF_SMOKE=1 node --test packages/core/test/review-render-scaling.test.mjs
test(
  "performance: a ~4 MiB Spec of `##` headings projects in well under 10 s",
  {
    skip:
      process.env.PRAXISBOUND_PERF_SMOKE !== "1" &&
      "set PRAXISBOUND_PERF_SMOKE=1 to run this wall-clock smoke test",
  },
  () => {
    const text = fill("## s\n", 4 * 1024 * 1024 - 1024);
    const elapsed = timed(SPEC_PATH, text);
    assert.ok(
      elapsed < 10_000,
      `expected < 10000ms, took ${elapsed.toFixed(0)}ms`,
    );
  },
);
