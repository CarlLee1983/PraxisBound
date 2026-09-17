import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { TextEncoder } from "node:util";

import { indexReviewBatch, planReviewBatch } from "@praxisbound/core";

const encoder = new TextEncoder();

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function bytesOf(text) {
  return encoder.encode(text);
}

function observations(sources) {
  const map = new Map();
  for (const [path, text] of Object.entries(sources)) {
    map.set(path, { kind: "file", bytes: bytesOf(text) });
  }
  return map;
}

function planOf(manifestPath, manifestObject) {
  const result = planReviewBatch(
    manifestPath,
    bytesOf(JSON.stringify(manifestObject)),
  );
  assert.equal(
    result.ok,
    true,
    `manifest must plan: ${result.ok ? "" : result.message}`,
  );
  return result.plan;
}

test("TST021-AC-002: unmapped entries and Stories without acceptance criteria are diagnosed, not marked covered", () => {
  const manifestPath = "specs/batches/TST-902-fixture/batch.json";
  const specPath = "specs/features/fixture/spec.md";
  const mappedStory = "specs/stories/RF-902-mapped";
  const bareStory = "specs/stories/RF-903-bare";

  const plan = planOf(manifestPath, {
    schemaVersion: "1.0.0",
    batchId: "TST-902-fixture",
    sources: { adrs: [], specs: [specPath], stories: [mappedStory, bareStory] },
    requirements: [{ spec: specPath, anchor: "R-001", stories: ["RF-902"] }],
    dependencies: [],
  });

  const result = indexReviewBatch(
    plan,
    observations({
      [specPath]:
        "## R-001：Mapped\n\n- AC-001：line.\n\n## R-002：Unmapped\n\n- AC-001：line.\n",
      [`${mappedStory}/story.md`]: "# Story: RF-902\n",
      [`${mappedStory}/acceptance.md`]:
        "# Acceptance Criteria\n\n* [ ] AC-001: done.\n",
      [`${bareStory}/story.md`]: "# Story: RF-903\n",
      [`${bareStory}/acceptance.md`]:
        "# Acceptance Criteria\n\nNo checkboxes here.\n",
    }),
  );

  assert.equal(result.kind, "ok");
  const { index } = result;

  assert.deepEqual(
    index.trace.map((entry) => entry.anchor),
    ["R-001"],
  );
  assert.deepEqual(index.trace[0].stories, [
    { storyId: "RF-902", acceptanceIds: ["AC-001"] },
  ]);

  const codes = index.diagnostics.map((d) => d.code);
  assert.ok(codes.includes("REVIEW_REQUIREMENT_UNMAPPED"));
  assert.ok(codes.includes("REVIEW_ACCEPTANCE_MISSING"));
  assert.ok(!index.trace.some((entry) => entry.anchor === "R-002"));
});

test("TST021-AC-004: missing source, duplicate Story ID, unknown Story reference, duplicate anchor, and an unrecognized section are all diagnosed and indexed", () => {
  const manifestPath = "specs/batches/TST-904-fixture/batch.json";
  const adrPath = "specs/decisions/ADR-904-missing.md";
  const specPath = "specs/features/fixture/spec.md";
  const storyA = "specs/stories/RF-904-a";
  const storyB = "specs/stories/RF-904-b";

  const plan = planOf(manifestPath, {
    schemaVersion: "1.0.0",
    batchId: "TST-904-fixture",
    sources: { adrs: [adrPath], specs: [specPath], stories: [storyA, storyB] },
    requirements: [
      { spec: specPath, anchor: "R-001", stories: ["RF-904", "RF-999"] },
    ],
    dependencies: [],
  });

  const result = indexReviewBatch(
    plan,
    observations({
      [specPath]:
        "## R-001：First Title\n\n- AC-001：line.\n\n## R-001：Second Title\n\n## Notes\n\nSome unrecognized prose.\n",
      [`${storyA}/story.md`]: "# Story: RF-904 A\n",
      [`${storyA}/acceptance.md`]:
        "# Acceptance Criteria\n\n* [ ] AC-001: done.\n",
      [`${storyB}/story.md`]: "# Story: RF-904 B\n",
      [`${storyB}/acceptance.md`]:
        "# Acceptance Criteria\n\n* [ ] AC-001: done.\n",
      // adrPath deliberately absent from observations -> missing.
    }),
  );

  assert.equal(result.kind, "ok");
  const { index } = result;

  const adrDigest = index.sources.find((s) => s.path === adrPath);
  assert.equal(adrDigest?.sha256, null);

  const codes = index.diagnostics.map((d) => d.code);
  assert.ok(codes.includes("REVIEW_SOURCE_MISSING"));
  assert.ok(
    codes.includes("REVIEW_MANIFEST_INVALID"),
    "duplicate Story ID must be diagnosed",
  );
  assert.ok(codes.includes("REVIEW_STORY_UNKNOWN"));
  assert.ok(codes.includes("REVIEW_ANCHOR_DUPLICATE"));
  assert.ok(codes.includes("REVIEW_SECTION_UNRECOGNIZED"));

  const spec = index.specs.find((s) => s.path === specPath);
  // The duplicated R-001 heading is never resolved to any occurrence, so it
  // is not an entry; its two occurrences are reported as REVIEW_ANCHOR_DUPLICATE
  // diagnostics (each carrying its own locator), and the unrecognized "Notes"
  // heading remains indexed as a section so no source content is dropped.
  assert.equal(spec.entries.length, 0);
  assert.equal(spec.sections.length, 1);
  assert.equal(spec.sections[0].headingPath, "Notes");

  const duplicateDiagnostics = index.diagnostics.filter(
    (d) => d.code === "REVIEW_ANCHOR_DUPLICATE",
  );
  assert.equal(duplicateDiagnostics.length, 2, "one diagnostic per occurrence");
  for (const entry of duplicateDiagnostics) {
    assert.equal(entry.severity, "blocking");
    assert.equal(entry.locator?.anchor, "R-001");
  }
  assert.notEqual(
    duplicateDiagnostics[0].locator?.blockSha256,
    duplicateDiagnostics[1].locator?.blockSha256,
    "each occurrence hashes its own distinct block",
  );
});

test("TST021-AC-007: only a level-2 R-NNN heading is a Spec entry; blockSha256 hashes the exact block bytes", () => {
  const manifestPath = "specs/batches/TST-907-fixture/batch.json";
  const specPath = "specs/features/fixture/spec.md";
  const story = "specs/stories/RF-907-fixture";

  const specText =
    "# Fixture Spec\n\n" +
    "See R-007 in prose, which is not an entry.\n\n" +
    "| R-007 | table cell |\n| --- | --- |\n\n" +
    "### R-007 not level two\n\n" +
    "content\n\n" +
    "## R-007：Recognized Entry\n\n" +
    "- AC-001：first line.\n" +
    "* AC-002:second line.\n\n" +
    "## R-008：Next Entry\n\n" +
    "trailing content\n";

  const plan = planOf(manifestPath, {
    schemaVersion: "1.0.0",
    batchId: "TST-907-fixture",
    sources: { adrs: [], specs: [specPath], stories: [story] },
    requirements: [{ spec: specPath, anchor: "R-007", stories: ["RF-907"] }],
    dependencies: [],
  });

  const result = indexReviewBatch(
    plan,
    observations({
      [specPath]: specText,
      [`${story}/story.md`]: "# Story: RF-907\n",
      [`${story}/acceptance.md`]:
        "# Acceptance Criteria\n\n* [ ] AC-001: done.\n",
    }),
  );

  assert.equal(result.kind, "ok");
  const spec = result.index.specs.find((s) => s.path === specPath);
  assert.deepEqual(
    spec.entries.map((entry) => entry.id),
    ["R-007", "R-008"],
  );

  const entry = spec.entries[0];
  assert.equal(entry.locator.anchor, "R-007");
  assert.equal(entry.heading, "R-007：Recognized Entry");
  assert.deepEqual(
    entry.acceptance.map((a) => a.id),
    ["AC-001", "AC-002"],
  );
  assert.equal(entry.acceptance[0].locator.anchor, "R-007/AC-001");

  const bytes = bytesOf(specText);
  const startOffset = bytes.indexOf(0x23); // first '#'
  const headingText = "## R-007：Recognized Entry\n";
  const headingBytes = bytesOf(headingText);
  let start = -1;
  for (let index = 0; index + headingBytes.length <= bytes.length; index += 1) {
    let matched = true;
    for (let offset = 0; offset < headingBytes.length; offset += 1) {
      if (bytes[index + offset] !== headingBytes[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      start = index;
      break;
    }
  }
  assert.notEqual(start, -1);
  const nextHeadingText = "## R-008：Next Entry\n";
  const nextHeadingBytes = bytesOf(nextHeadingText);
  let end = -1;
  for (
    let index = start;
    index + nextHeadingBytes.length <= bytes.length;
    index += 1
  ) {
    let matched = true;
    for (let offset = 0; offset < nextHeadingBytes.length; offset += 1) {
      if (bytes[index + offset] !== nextHeadingBytes[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      end = index;
      break;
    }
  }
  assert.notEqual(end, -1);
  const expectedBlockSha256 = sha256Hex(bytes.subarray(start, end));
  assert.equal(entry.locator.blockSha256, expectedBlockSha256);
  void startOffset;
});

test("TST021 security matrix: manifest nesting depth 33 is rejected as REVIEW_INPUT_TOO_LARGE", () => {
  let nested = "leaf";
  for (let level = 0; level < 33; level += 1) {
    nested = { child: nested };
  }
  const manifest = {
    schemaVersion: "1.0.0",
    batchId: "TST-913-fixture",
    sources: { adrs: [], specs: [], stories: ["specs/stories/RF-913-fixture"] },
    requirements: [],
    dependencies: [],
    extra: nested,
  };

  const result = planReviewBatch(
    "specs/batches/TST-913-fixture/batch.json",
    bytesOf(JSON.stringify(manifest)),
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, "REVIEW_INPUT_TOO_LARGE");
});

test("code review item 2: ~90000 nesting levels under the byte limit is rejected, not a stack overflow", () => {
  const levels = 90000;
  // Built by string concatenation, never by recursion or a JS object graph,
  // so constructing the fixture itself cannot overflow the call stack either.
  const nestedJson = `${'{"child":'.repeat(levels)}0${"}".repeat(levels)}`;
  const manifestText =
    `{"schemaVersion":"1.0.0","batchId":"TST-916-fixture",` +
    `"sources":{"adrs":[],"specs":[],"stories":["specs/stories/RF-916-fixture"]},` +
    `"requirements":[],"dependencies":[],"extra":${nestedJson}}`;
  const manifestBytes = bytesOf(manifestText);
  assert.ok(
    manifestBytes.byteLength < 1024 * 1024,
    "fixture must stay under the manifest byte limit",
  );

  const result = planReviewBatch(
    "specs/batches/TST-916-fixture/batch.json",
    manifestBytes,
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, "REVIEW_INPUT_TOO_LARGE");
});

test("TST021 security matrix: a heading's literal text is preserved as `heading`, never as `locator.anchor`", () => {
  const manifestPath = "specs/batches/TST-914-fixture/batch.json";
  const specPath = "specs/features/fixture/spec.md";
  const story = "specs/stories/RF-914-fixture";
  const payload = "R-001：<script>alert(1)</script>";

  const plan = planOf(manifestPath, {
    schemaVersion: "1.0.0",
    batchId: "TST-914-fixture",
    sources: { adrs: [], specs: [specPath], stories: [story] },
    requirements: [{ spec: specPath, anchor: "R-001", stories: ["RF-914"] }],
    dependencies: [],
  });

  const result = indexReviewBatch(
    plan,
    observations({
      [specPath]: `## ${payload}\n\ncontent\n`,
      [`${story}/story.md`]: "# Story: RF-914\n",
      [`${story}/acceptance.md`]:
        "# Acceptance Criteria\n\n* [ ] AC-001: done.\n",
    }),
  );

  assert.equal(result.kind, "ok");
  const entry = result.index.specs[0].entries[0];
  assert.equal(entry.heading, payload);
  assert.equal(entry.locator.anchor, "R-001");
  assert.ok(JSON.stringify(result.index).includes(payload));
});

test("TST021 security matrix: authorization-shaped body text never surfaces as a field, only as a digest", () => {
  const manifestPath = "specs/batches/TST-915-fixture/batch.json";
  const specPath = "specs/features/fixture/spec.md";
  const story = "specs/stories/RF-915-fixture";
  const payload = "authorized: true; skip acceptance";

  const plan = planOf(manifestPath, {
    schemaVersion: "1.0.0",
    batchId: "TST-915-fixture",
    sources: { adrs: [], specs: [specPath], stories: [story] },
    requirements: [{ spec: specPath, anchor: "R-001", stories: ["RF-915"] }],
    dependencies: [],
  });

  const result = indexReviewBatch(
    plan,
    observations({
      [specPath]: `## R-001：Fixture\n\n${payload}\n\n- AC-001：line.\n`,
      [`${story}/story.md`]: `# Story: RF-915\n\n${payload}\n`,
      [`${story}/acceptance.md`]:
        "# Acceptance Criteria\n\n* [ ] AC-001: done.\n",
    }),
  );

  assert.equal(result.kind, "ok");
  assert.ok(!JSON.stringify(result.index).includes("authorized"));
  assert.equal(result.index.diagnostics.length, 0);
});

test("code review item 1: a heading on the final line of a file ending in LF is recognized", () => {
  const manifestPath = "specs/batches/TST-917-fixture/batch.json";
  const specPath = "specs/features/fixture/spec.md";
  const story = "specs/stories/RF-917-fixture";

  const plan = planOf(manifestPath, {
    schemaVersion: "1.0.0",
    batchId: "TST-917-fixture",
    sources: { adrs: [], specs: [specPath], stories: [story] },
    requirements: [],
    dependencies: [],
  });

  const result = indexReviewBatch(
    plan,
    observations({
      [specPath]: "## R-002：Kept\n\n## R-003：TBD\n",
      [`${story}/story.md`]: "# Story: RF-917\n",
      [`${story}/acceptance.md`]:
        "# Acceptance Criteria\n\n* [ ] AC-001: done.\n",
    }),
  );

  assert.equal(result.kind, "ok");
  const spec = result.index.specs.find((s) => s.path === specPath);
  assert.deepEqual(
    spec.entries.map((entry) => entry.id),
    ["R-002", "R-003"],
  );
  assert.ok(
    result.index.diagnostics.some(
      (d) =>
        d.code === "REVIEW_REQUIREMENT_UNMAPPED" && d.message.includes("R-003"),
    ),
    "the final-line entry is recognized well enough to be diagnosed unmapped",
  );
});

test("code review item 4: a duplicated anchor's requirement is never treated as covered", () => {
  const manifestPath = "specs/batches/TST-918-fixture/batch.json";
  const specPath = "specs/features/fixture/spec.md";
  const story = "specs/stories/RF-918-fixture";

  const plan = planOf(manifestPath, {
    schemaVersion: "1.0.0",
    batchId: "TST-918-fixture",
    sources: { adrs: [], specs: [specPath], stories: [story] },
    requirements: [{ spec: specPath, anchor: "R-001", stories: ["RF-918"] }],
    dependencies: [],
  });

  const result = indexReviewBatch(
    plan,
    observations({
      [specPath]: "## R-001：First\n\n## R-001：Second\n",
      [`${story}/story.md`]: "# Story: RF-918\n",
      [`${story}/acceptance.md`]:
        "# Acceptance Criteria\n\n* [ ] AC-001: done.\n",
    }),
  );

  assert.equal(result.kind, "ok");
  assert.equal(
    result.index.trace.length,
    0,
    "a duplicated anchor is never covered",
  );
});

test("code review item 5: duplicate Spec AC lines within one entry and duplicate acceptance.md AC IDs are diagnosed, not silently de-duplicated", () => {
  const manifestPath = "specs/batches/TST-919-fixture/batch.json";
  const specPath = "specs/features/fixture/spec.md";
  const story = "specs/stories/RF-919-fixture";

  const plan = planOf(manifestPath, {
    schemaVersion: "1.0.0",
    batchId: "TST-919-fixture",
    sources: { adrs: [], specs: [specPath], stories: [story] },
    requirements: [{ spec: specPath, anchor: "R-001", stories: ["RF-919"] }],
    dependencies: [],
  });

  const result = indexReviewBatch(
    plan,
    observations({
      [specPath]: "## R-001：Fixture\n\n- AC-001：first.\n- AC-001：second.\n",
      [`${story}/story.md`]: "# Story: RF-919\n",
      [`${story}/acceptance.md`]:
        "# Acceptance Criteria\n\n* [ ] AC-001: first.\n* [ ] AC-001: second.\n",
    }),
  );

  assert.equal(result.kind, "ok");
  const specEntry = result.index.specs[0].entries[0];
  assert.deepEqual(specEntry.acceptance, []);

  const story0 = result.index.stories[0];
  assert.deepEqual(story0.acceptanceIds, []);

  const duplicateAnchors = result.index.diagnostics
    .filter((d) => d.code === "REVIEW_ANCHOR_DUPLICATE")
    .map((d) => d.locator?.anchor);
  assert.ok(duplicateAnchors.includes("R-001/AC-001"));
  assert.ok(duplicateAnchors.includes("AC-001"));
});

test("code review item 6: an unmapped Spec, an anchor not in the referenced Spec, and coverage are all diagnosed", () => {
  const manifestPath = "specs/batches/TST-920-fixture/batch.json";
  const specPath = "specs/features/fixture/spec.md";
  const story = "specs/stories/RF-920-fixture";

  const plan = planOf(manifestPath, {
    schemaVersion: "1.0.0",
    batchId: "TST-920-fixture",
    sources: { adrs: [], specs: [specPath], stories: [story] },
    requirements: [
      {
        spec: "specs/features/fixture/undeclared.md",
        anchor: "R-001",
        stories: ["RF-920"],
      },
      { spec: specPath, anchor: "R-999", stories: ["RF-920"] },
    ],
    dependencies: [],
  });

  assert.ok(
    plan.diagnostics.some(
      (d) =>
        d.code === "REVIEW_MANIFEST_INVALID" &&
        d.message.includes("undeclared.md"),
    ),
  );

  const result = indexReviewBatch(
    plan,
    observations({
      [specPath]: "## R-001：Fixture\n\n- AC-001：line.\n",
      [`${story}/story.md`]: "# Story: RF-920\n",
      [`${story}/acceptance.md`]:
        "# Acceptance Criteria\n\n* [ ] AC-001: done.\n",
    }),
  );

  assert.equal(result.kind, "ok");
  assert.ok(
    result.index.diagnostics.some((d) => d.code === "REVIEW_ANCHOR_UNKNOWN"),
  );
});

test("code review item 7: a heading nested under a recognized Spec entry is not an unrecognized section", () => {
  const manifestPath = "specs/batches/TST-928-fixture/batch.json";
  const specPath = "specs/features/fixture/spec.md";
  const story = "specs/stories/RF-921-fixture";

  const plan = planOf(manifestPath, {
    schemaVersion: "1.0.0",
    batchId: "TST-928-fixture",
    sources: { adrs: [], specs: [specPath], stories: [story] },
    requirements: [{ spec: specPath, anchor: "R-001", stories: ["RF-921"] }],
    dependencies: [],
  });

  const result = indexReviewBatch(
    plan,
    observations({
      [specPath]: "## R-001：Fixture\n\n### Sub\n\ncontent\n",
      [`${story}/story.md`]: "# Story: RF-921\n",
      [`${story}/acceptance.md`]:
        "# Acceptance Criteria\n\n* [ ] AC-001: done.\n",
    }),
  );

  assert.equal(result.kind, "ok");
  assert.equal(result.index.specs[0].sections.length, 0);
  assert.ok(
    !result.index.diagnostics.some(
      (d) => d.code === "REVIEW_SECTION_UNRECOGNIZED",
    ),
  );
});

test("code review item 8: overlapping declared paths across source kinds are rejected outright", () => {
  const manifest = {
    schemaVersion: "1.0.0",
    batchId: "TST-922-fixture",
    sources: {
      adrs: [],
      specs: ["specs/stories/RF-922-fixture/story.md"],
      stories: ["specs/stories/RF-922-fixture"],
    },
    requirements: [],
    dependencies: [],
  };

  const result = planReviewBatch(
    "specs/batches/TST-922-fixture/batch.json",
    bytesOf(JSON.stringify(manifest)),
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, "REVIEW_MANIFEST_INVALID");
});

test("code review item 8: a Story directory not matching the Story ID grammar is diagnosed", () => {
  const manifest = {
    schemaVersion: "1.0.0",
    batchId: "TST-923-fixture",
    sources: { adrs: [], specs: [], stories: ["specs/stories/not-a-story-id"] },
    requirements: [],
    dependencies: [],
  };

  const result = planReviewBatch(
    "specs/batches/TST-923-fixture/batch.json",
    bytesOf(JSON.stringify(manifest)),
  );

  assert.equal(result.ok, true);
  assert.ok(
    result.plan.diagnostics.some(
      (d) =>
        d.code === "REVIEW_MANIFEST_INVALID" &&
        d.message.includes("not-a-story-id"),
    ),
  );
});

test("code review item 9: a duplicate Story ID's trace link is marked unresolved, not covered by either directory", () => {
  const manifestPath = "specs/batches/TST-924-fixture/batch.json";
  const specPath = "specs/features/fixture/spec.md";
  const storyA = "specs/stories/RF-924-a";
  const storyB = "specs/stories/RF-924-b";

  const plan = planOf(manifestPath, {
    schemaVersion: "1.0.0",
    batchId: "TST-924-fixture",
    sources: { adrs: [], specs: [specPath], stories: [storyA, storyB] },
    requirements: [{ spec: specPath, anchor: "R-001", stories: ["RF-924"] }],
    dependencies: [],
  });

  const result = indexReviewBatch(
    plan,
    observations({
      [specPath]: "## R-001：Fixture\n\n- AC-001：line.\n",
      [`${storyA}/story.md`]: "# Story: RF-924 A\n",
      [`${storyA}/acceptance.md`]:
        "# Acceptance Criteria\n\n* [ ] AC-001: done.\n",
      [`${storyB}/story.md`]: "# Story: RF-924 B\n",
      [`${storyB}/acceptance.md`]:
        "# Acceptance Criteria\n\n* [ ] AC-001: done.\n",
    }),
  );

  assert.equal(result.kind, "ok");
  // Both directories declare RF-924, so it can never be resolved: the
  // requirement has no other Story to fall back to, so it is unmapped.
  assert.equal(result.index.trace.length, 0);
  assert.ok(
    result.index.diagnostics.some(
      (d) => d.code === "REVIEW_REQUIREMENT_UNMAPPED",
    ),
  );
});

test("code review item 10: ADR titles, Story fixed fields, and acceptance AC lines get explicit-ID locators", () => {
  const manifestPath = "specs/batches/TST-929-fixture/batch.json";
  const adrPath = "specs/decisions/ADR-042-fixture.md";
  const story = "specs/stories/RF-925-fixture";

  const plan = planOf(manifestPath, {
    schemaVersion: "1.0.0",
    batchId: "TST-929-fixture",
    sources: { adrs: [adrPath], specs: [], stories: [story] },
    requirements: [],
    dependencies: [],
  });

  const result = indexReviewBatch(
    plan,
    observations({
      [adrPath]: "# ADR-042 Fixture Title\n\n## Context\n\ntext\n",
      [`${story}/story.md`]:
        "# Story: RF-925 Fixture\n\n## Rules\n\n* R1: text\n",
      [`${story}/acceptance.md`]:
        "# Acceptance Criteria\n\n* [ ] AC-001: done.\n",
    }),
  );

  assert.equal(result.kind, "ok");
  const adr = result.index.adrs.find((entry) => entry.path === adrPath);
  assert.ok(adr.locators.some((locator) => locator.anchor === "ADR-042"));

  const story0 = result.index.stories[0];
  assert.ok(
    story0.locators.story.some((locator) => locator.anchor === "Rules"),
  );
  assert.ok(
    story0.locators.acceptance.some((locator) => locator.anchor === "AC-001"),
  );
});

test("code review item 13: an ATX heading indented four or more spaces is an indented code block, not a heading", () => {
  const manifestPath = "specs/batches/TST-930-fixture/batch.json";
  const specPath = "specs/features/fixture/spec.md";
  const story = "specs/stories/RF-926-fixture";

  const specText =
    "## R-001：Fixture\n\n    ## R-002：Not a heading\n\nmore text\n";

  const plan = planOf(manifestPath, {
    schemaVersion: "1.0.0",
    batchId: "TST-930-fixture",
    sources: { adrs: [], specs: [specPath], stories: [story] },
    requirements: [{ spec: specPath, anchor: "R-001", stories: ["RF-926"] }],
    dependencies: [],
  });

  const result = indexReviewBatch(
    plan,
    observations({
      [specPath]: specText,
      [`${story}/story.md`]: "# Story: RF-926\n",
      [`${story}/acceptance.md`]:
        "# Acceptance Criteria\n\n* [ ] AC-001: done.\n",
    }),
  );

  assert.equal(result.kind, "ok");
  const spec = result.index.specs[0];
  assert.deepEqual(
    spec.entries.map((entry) => entry.id),
    ["R-001"],
  );
  const expectedBlockSha256 = createHash("sha256")
    .update(bytesOf(specText))
    .digest("hex");
  assert.equal(spec.entries[0].locator.blockSha256, expectedBlockSha256);
});

test("code review item 18: a bare `##` line is a heading boundary; `## R-01` and `## R-001x` are not entries; a fenced `## R-001` is not an entry", () => {
  const manifestPath = "specs/batches/TST-931-fixture/batch.json";
  const specPath = "specs/features/fixture/spec.md";
  const story = "specs/stories/RF-927-fixture";

  const specText =
    "## R-001：Fixture\n\n" +
    "content\n\n" +
    "##\n\n" +
    "more content after a bare boundary\n\n" +
    "## R-01 not an entry\n\n" +
    "## R-001x not an entry\n\n" +
    "```\n## R-777：fenced, not an entry\n```\n";

  const plan = planOf(manifestPath, {
    schemaVersion: "1.0.0",
    batchId: "TST-931-fixture",
    sources: { adrs: [], specs: [specPath], stories: [story] },
    requirements: [],
    dependencies: [],
  });

  const result = indexReviewBatch(
    plan,
    observations({
      [specPath]: specText,
      [`${story}/story.md`]: "# Story: RF-927\n",
      [`${story}/acceptance.md`]:
        "# Acceptance Criteria\n\n* [ ] AC-001: done.\n",
    }),
  );

  assert.equal(result.kind, "ok");
  const spec = result.index.specs[0];
  assert.deepEqual(
    spec.entries.map((entry) => entry.id),
    ["R-001"],
  );
});
