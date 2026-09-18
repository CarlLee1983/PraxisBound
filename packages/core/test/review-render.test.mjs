import assert from "node:assert/strict";
import test from "node:test";
import { TextEncoder } from "node:util";

import { indexReviewBatch, renderReviewProjection } from "../dist/index.js";

const SPEC_PATH = "specs/features/fixture/spec.md";
const MISSING_SPEC_PATH = "specs/features/fixture/missing-spec.md";
const ADR_PATH = "specs/decisions/ADR-014-fixture.md";
const SHARED_DIR = "specs/stories/RF-SHARED-fixture";
const ORPHAN_DIR = "specs/stories/RF-ORPHAN-fixture";
const NOID_DIR = "specs/stories/no-id-fixture";

const encoder = new TextEncoder();

const SPEC_MD = `# Fixture Spec

Preamble text before any section, sentinel PREAMBLE_SENTENCE_ONE.

## Goal

Batch objective sentence GOAL_SENTENCE_SPEC.

## Non-goals

Batch exclusion sentence NONGOALS_SENTENCE_SPEC.

## Unrecognized Section

Unrecognized-section sentence UNRECOGNIZED_SENTENCE_SPEC.

## R-001：Fixture Requirement One

### Goal

Entry one goal sentence GOAL_SENTENCE_R001 <script>alert(1)</script><img src=x onerror=alert(1)>.

### Acceptance

- Not an AC bullet, prose only NOTANAC_SENTENCE_R001.
- AC-002：Entry one acceptance sentence AC_SENTENCE_R001_2.
 - Nested detail sentence NESTED_AC_SENTENCE_R001.
- AC-001：Entry one acceptance sentence AC_SENTENCE_R001_1.

### Out of Scope

Entry one exclusion sentence NONGOALS_SENTENCE_R001.

### Dependencies

Entry one dependency sentence DEPENDENCIES_SENTENCE_R001 [x](javascript:alert(1)) [y](data:text/html,unsafe) [z](mailto:a@example.test).

## R-002：Fixture Requirement Two

### Goal

Entry two goal sentence GOAL_SENTENCE_R002.

### Acceptance

- AC-001：Entry two acceptance sentence AC_SENTENCE_R002_1.

## R-003：Fixture Requirement Three Unmapped

### Goal

Entry three goal sentence GOAL_SENTENCE_R003.

### Acceptance

- AC-001：Entry three acceptance sentence AC_SENTENCE_R003_1.

## R-004：Fixture Requirement Four No Acceptance Heading

Entry four intro sentence INTRO_SENTENCE_R004.

- AC-001：Entry four acceptance sentence AC_SENTENCE_R004_1.
- AC-002：Entry four acceptance sentence AC_SENTENCE_R004_2.

### Dependencies

Entry four dependency sentence DEPENDENCIES_SENTENCE_R004.
`;

const SHARED_STORY_MD = `# Story: RF-SHARED Fixture Shared Story

## Goal

Shared story goal sentence GOAL_SENTENCE_SHARED.

## Scope

Shared story scope sentence SCOPE_SENTENCE_SHARED.

### In Scope

Nested scope sentence NESTED_IN_SCOPE_SENTENCE.

## Rules

Shared story rules sentence RULES_SENTENCE_SHARED.

## Expected Errors

Shared story errors sentence ERRORS_SENTENCE_SHARED.

## Constraints

Shared story constraints sentence CONSTRAINTS_SENTENCE_SHARED.

## Dependencies

Shared story dependency sentence DEPENDENCIES_SENTENCE_SHARED.
`;

const SHARED_ACCEPTANCE_MD = `# Acceptance Criteria

## Happy Path

* [ ] AC-001: Shared story acceptance sentence ACCEPTANCE_SENTENCE_SHARED_1.
* [ ] AC-002: Shared story acceptance sentence ACCEPTANCE_SENTENCE_SHARED_2.

### Edge Cases

* [ ] AC-003: Nested acceptance sentence ACCEPTANCE_SENTENCE_SHARED_3.

## Notes

Shared story notes sentence NOTES_SENTENCE_SHARED_FIRST.

## Notes

Shared story second notes sentence NOTES_SENTENCE_SHARED_SECOND.
`;

const ORPHAN_STORY_MD = `# Story: RF-ORPHAN Fixture Orphan Story

## Goal

Orphan story goal sentence GOAL_SENTENCE_ORPHAN.
`;

const ORPHAN_ACCEPTANCE_MD = `Leading text before any heading, sentinel LEADING_TEXT_SENTENCE_ORPHAN.

# Acceptance Criteria

* [ ] AC-001: Orphan story acceptance sentence ACCEPTANCE_SENTENCE_ORPHAN_1.
`;

const NOID_STORY_MD = `# Story: No ID Fixture Story

## Goal

No-ID story goal sentence GOAL_SENTENCE_NOID.
`;

const NOID_ACCEPTANCE_MD = `# Acceptance Criteria

* [ ] AC-001: No-ID story acceptance sentence ACCEPTANCE_SENTENCE_NOID_1.
`;

const ADR_MD = `# ADR-014: Fixture Decision Title

* Status: Accepted

Decision body sentence ADR_BODY_SENTENCE.
`;

const PREFACE =
  "Preface sentence PREFACE_SENTENCE <script>alert(1)</script>[x](javascript:alert(1)).";

function buildFixture() {
  const plan = {
    batchId: "TST-922-fixture",
    title: "Readable fixture objective",
    preface: PREFACE,
    manifestSha256: "0".repeat(64),
    adrs: [ADR_PATH],
    specs: [SPEC_PATH],
    stories: [
      {
        directory: SHARED_DIR,
        storyId: "RF-SHARED",
        storyPath: `${SHARED_DIR}/story.md`,
        acceptancePath: `${SHARED_DIR}/acceptance.md`,
      },
      {
        directory: ORPHAN_DIR,
        storyId: "RF-ORPHAN",
        storyPath: `${ORPHAN_DIR}/story.md`,
        acceptancePath: `${ORPHAN_DIR}/acceptance.md`,
      },
      {
        directory: NOID_DIR,
        storyId: undefined,
        storyPath: `${NOID_DIR}/story.md`,
        acceptancePath: `${NOID_DIR}/acceptance.md`,
      },
    ],
    requirements: [
      { spec: SPEC_PATH, anchor: "R-001", stories: ["RF-SHARED"] },
      { spec: SPEC_PATH, anchor: "R-002", stories: ["RF-SHARED"] },
      { spec: MISSING_SPEC_PATH, anchor: "R-999", stories: ["RF-SHARED"] },
    ],
    dependencies: [{ story: "RF-SHARED", dependsOn: [] }],
    sources: [
      ADR_PATH,
      SPEC_PATH,
      `${ORPHAN_DIR}/acceptance.md`,
      `${ORPHAN_DIR}/story.md`,
      `${SHARED_DIR}/acceptance.md`,
      `${SHARED_DIR}/story.md`,
      `${NOID_DIR}/acceptance.md`,
      `${NOID_DIR}/story.md`,
    ].sort(),
    diagnostics: [],
    ambiguousStoryIds: [],
  };

  const files = {
    [SPEC_PATH]: SPEC_MD,
    [ADR_PATH]: ADR_MD,
    [`${SHARED_DIR}/story.md`]: SHARED_STORY_MD,
    [`${SHARED_DIR}/acceptance.md`]: SHARED_ACCEPTANCE_MD,
    [`${ORPHAN_DIR}/story.md`]: ORPHAN_STORY_MD,
    [`${ORPHAN_DIR}/acceptance.md`]: ORPHAN_ACCEPTANCE_MD,
    [`${NOID_DIR}/story.md`]: NOID_STORY_MD,
    [`${NOID_DIR}/acceptance.md`]: NOID_ACCEPTANCE_MD,
  };

  const observations = new Map(
    Object.entries(files).map(([path, text]) => [
      path,
      { kind: "file", bytes: encoder.encode(text) },
    ]),
  );

  const result = indexReviewBatch(plan, observations);
  assert.equal(result.kind, "ok", JSON.stringify(result));
  const { index } = result;

  const documents = index.sources.map((source) => ({
    path: source.path,
    bytes: observations.get(source.path)?.bytes,
  }));

  const html = renderReviewProjection(index, documents);
  return { index, html, files };
}

const { index, html, files } = buildFixture();

test("TST022-AC-001: the page follows the contract §18 order", () => {
  const markers = [
    "離線閱讀快照",
    "PREFACE_SENTENCE",
    "需求總覽矩陣",
    "批次目標",
    "不包含",
    "決策約束",
    "診斷摘要",
    "需求卡片",
    "未對應需求的 Story",
    "附錄",
  ];
  let cursor = -1;
  for (const marker of markers) {
    const position = html.indexOf(marker, cursor + 1);
    assert.ok(position !== -1, `missing marker (in order): ${marker}`);
    cursor = position;
  }
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /TST-922-fixture/);
  assert.match(html, /Readable fixture objective/);
  assert.match(html, /由批次作者撰寫（Review Preface）/);
  assert.match(html, new RegExp(index.fingerprint));
});

test("TST022-AC-002: the matrix has one row per Spec entry, verbatim cells, counts, and gap labels", () => {
  const matrix = html.slice(
    html.indexOf("需求總覽矩陣"),
    html.indexOf("批次目標"),
  );

  const r1 = matrix.indexOf("R-001");
  const r2 = matrix.indexOf("R-002");
  const r3 = matrix.indexOf("R-003");
  assert.ok(r1 !== -1 && r2 !== -1 && r3 !== -1);
  assert.ok(
    r1 < r2 && r2 < r3,
    "manifest order first, then Spec order for the unmapped entry",
  );

  assert.match(matrix, /GOAL_SENTENCE_R001/);
  assert.match(matrix, /NONGOALS_SENTENCE_R001/);
  assert.match(matrix, /RF-SHARED/);
  assert.match(matrix, /GOAL_SENTENCE_R002/);
  assert.match(matrix, /未寫明/); // R-002 has no ### Non-goals
  assert.match(matrix, /無對應 Story/); // R-003 is not in `requirements`
  assert.doesNotMatch(matrix, /class="diff|class="warn/);
});

test("TST022-AC-003: each card lists Requirement then Execution acceptance, then Story focus, then detail; cards are collapsed", () => {
  const cardsSection = html.slice(
    html.indexOf('<section class="cards">'),
    html.indexOf('<section class="orphan-stories">'),
  );
  assert.doesNotMatch(
    cardsSection.match(/<details class="card"/g)?.join("") ?? "",
    /open/,
  );

  const r1Card = cardsSection.slice(
    cardsSection.indexOf("R-001"),
    cardsSection.indexOf("R-002"),
  );
  const order = [
    "需求驗收",
    "R-001/AC-001",
    "AC_SENTENCE_R001_1",
    "執行驗收",
    "RF-SHARED/AC-001",
    "ACCEPTANCE_SENTENCE_SHARED_1",
    "Story 重點",
    "GOAL_SENTENCE_SHARED",
    "需求細節",
    "DEPENDENCIES_SENTENCE_R001",
  ];
  let cursor = -1;
  for (const marker of order) {
    const position = r1Card.indexOf(marker);
    assert.ok(position !== -1, `missing in card: ${marker}`);
    assert.ok(position > cursor, `out of order in card: ${marker}`);
    cursor = position;
  }

  // The second card sharing the same Story links back instead of repeating its content.
  const r2Card = cardsSection.slice(
    cardsSection.indexOf("R-002"),
    cardsSection.indexOf("R-003"),
  );
  assert.doesNotMatch(r2Card, /GOAL_SENTENCE_SHARED/);
  assert.match(r2Card, /已在其他卡片顯示/);
});

test("TST022 review finding 1: a later card links to a shared Story's focus instead of showing 「無對應 Story」", () => {
  const cardsSection = html.slice(
    html.indexOf('<section class="cards">'),
    html.indexOf('<section class="orphan-stories">'),
  );
  const r2Card = cardsSection.slice(
    cardsSection.indexOf("R-002"),
    cardsSection.indexOf("R-003"),
  );
  const storyFocus = r2Card.slice(
    r2Card.indexOf('class="story-focus"'),
    r2Card.indexOf('class="detail"'),
  );
  assert.doesNotMatch(
    storyFocus,
    /無對應 Story/,
    "R-002 does have a Story; it must not read 「無對應 Story」",
  );
  assert.match(
    storyFocus,
    /<a href="#card-[a-z0-9-]+">RF-SHARED 已在其他卡片顯示<\/a>/,
  );
});

test("TST022 readability: a requirement heading that already starts with its own ID is not shown twice", () => {
  const matrix = html.slice(
    html.indexOf("需求總覽矩陣"),
    html.indexOf("批次目標"),
  );
  const cardsSection = html.slice(
    html.indexOf('<section class="cards">'),
    html.indexOf('<section class="orphan-stories">'),
  );
  for (const section of [matrix, cardsSection]) {
    assert.doesNotMatch(section, /R-001[^\n]{0,3}R-001：/);
    assert.doesNotMatch(section, /R-002[^\n]{0,3}R-002：/);
  }
  assert.match(matrix, /R-001：Fixture Requirement One/);
  assert.match(
    cardsSection,
    /<summary>R-001：Fixture Requirement One<\/summary>/,
  );
});

test("TST022 readability: a Story ID is not repeated inside its own title", () => {
  const matrix = html.slice(
    html.indexOf("需求總覽矩陣"),
    html.indexOf("批次目標"),
  );
  assert.match(matrix, /RF-SHARED<\/a> Fixture Shared Story/);
  assert.doesNotMatch(matrix, /Story: RF-SHARED/);
});

test("TST022 readability: a vocabulary heading with an equivalent visible caption is visually hidden but keeps its locator", () => {
  const matrix = html.slice(
    html.indexOf("需求總覽矩陣"),
    html.indexOf("批次目標"),
  );
  assert.match(
    matrix,
    /<h6[^>]*data-anchor="R-001\/Goal"[^>]*class="visually-hidden"[^>]*>/,
  );

  const cardsSection = html.slice(
    html.indexOf('<section class="cards">'),
    html.indexOf('<section class="orphan-stories">'),
  );
  assert.match(
    cardsSection,
    /<h6[^>]*data-anchor="R-001\/Acceptance"[^>]*class="visually-hidden"[^>]*>/,
  );
  assert.match(
    cardsSection,
    /<h6[^>]*data-anchor="Goal"[^>]*class="visually-hidden"[^>]*>/,
  );
});

test("TST022 readability: the matrix link opens the card at its body, not the buried entry heading", () => {
  const matrix = html.slice(
    html.indexOf("需求總覽矩陣"),
    html.indexOf("批次目標"),
  );
  const match =
    /<a href="(#[a-z0-9-]+)">R-001：Fixture Requirement One<\/a>/.exec(matrix);
  assert.ok(match, "expected a matrix link to the R-001 card");
  const targetId = match[1].slice(1);

  const cardsSection = html.slice(
    html.indexOf('<section class="cards">'),
    html.indexOf('<section class="orphan-stories">'),
  );
  const r1Card = cardsSection.slice(
    cardsSection.indexOf("R-001"),
    cardsSection.indexOf("R-002"),
  );
  assert.match(r1Card, new RegExp(`<section class="req-ac" id="${targetId}">`));
  assert.ok(
    r1Card.indexOf(`id="${targetId}"`) < r1Card.indexOf("需求細節"),
    "the target id must sit before 需求細節, not at the buried entry heading",
  );
});

test("TST022-AC-004: every source block renders exactly once outside the raw appendix, and every non-blank line's text is present", () => {
  const withoutRaw = html.replace(
    /<details class="raw no-print">[\s\S]*?<\/details>/,
    "",
  );

  const onceOutsideRaw = [
    "PREAMBLE_SENTENCE_ONE",
    "GOAL_SENTENCE_SPEC",
    "NONGOALS_SENTENCE_SPEC",
    "UNRECOGNIZED_SENTENCE_SPEC",
    "GOAL_SENTENCE_R001",
    "NOTANAC_SENTENCE_R001",
    "AC_SENTENCE_R001_1",
    "AC_SENTENCE_R001_2",
    "NESTED_AC_SENTENCE_R001",
    "NONGOALS_SENTENCE_R001",
    "DEPENDENCIES_SENTENCE_R001",
    "GOAL_SENTENCE_R002",
    "AC_SENTENCE_R002_1",
    "GOAL_SENTENCE_R003",
    "AC_SENTENCE_R003_1",
    "INTRO_SENTENCE_R004",
    "AC_SENTENCE_R004_1",
    "AC_SENTENCE_R004_2",
    "DEPENDENCIES_SENTENCE_R004",
    "GOAL_SENTENCE_SHARED",
    "SCOPE_SENTENCE_SHARED",
    "RULES_SENTENCE_SHARED",
    "ERRORS_SENTENCE_SHARED",
    "CONSTRAINTS_SENTENCE_SHARED",
    "DEPENDENCIES_SENTENCE_SHARED",
    "ACCEPTANCE_SENTENCE_SHARED_1",
    "ACCEPTANCE_SENTENCE_SHARED_2",
    "NOTES_SENTENCE_SHARED_FIRST",
    "NOTES_SENTENCE_SHARED_SECOND",
    "GOAL_SENTENCE_ORPHAN",
    "ACCEPTANCE_SENTENCE_ORPHAN_1",
    "LEADING_TEXT_SENTENCE_ORPHAN",
    "GOAL_SENTENCE_NOID",
    "ACCEPTANCE_SENTENCE_NOID_1",
    "ADR_BODY_SENTENCE",
  ];
  for (const sentinel of onceOutsideRaw) {
    const count = withoutRaw.split(sentinel).length - 1;
    assert.equal(
      count,
      1,
      `expected exactly one rendering of ${sentinel}, saw ${count}`,
    );
  }

  // Every non-blank source line's text (Markdown markers stripped) is present
  // somewhere outside the raw-Markdown appendix (TST022 review finding 15: a
  // check against the whole page always passes, since the raw appendix is a
  // verbatim copy of every source).
  for (const text of Object.values(files)) {
    for (const rawLine of text.split("\n")) {
      // A line with an inline Markdown link renders each link's text inside
      // its own element (an `<a>`, or inert text for an unsafe scheme,
      // contract §18 R4/AC-010), so the line's plain text is no longer one
      // contiguous run; that transformation is covered by the dedicated
      // AC-010 security test instead of this literal substring check.
      if (/\[[^\]]*]\([^)]*\)/.test(rawLine)) continue;
      const stripped = rawLine
        .replace(/^#{1,6}\s+/, "")
        .replace(/^\s*[-*]\s+(?:\[[ xX]\]\s+)?/, "")
        .replace(/^\*\s+Status:\s*/, "")
        .trim();
      if (stripped === "") continue;
      assert.ok(
        withoutRaw.includes(stripped) ||
          withoutRaw.includes(require_escape(stripped)),
        `line text missing from projection outside raw Markdown: ${stripped}`,
      );
    }
  }
});

test("TST022 review finding 2: a manifest requirement whose Spec is missing from the batch still gets a matrix row and card", () => {
  const matrix = html.slice(
    html.indexOf("需求總覽矩陣"),
    html.indexOf("批次目標"),
  );
  assert.match(matrix, /R-999/);
  const matrixRow = matrix.slice(matrix.indexOf("R-999"));
  assert.match(matrixRow, /未寫明/);

  const cardsSection = html.slice(
    html.indexOf('<section class="cards">'),
    html.indexOf('<section class="orphan-stories">'),
  );
  assert.match(cardsSection, /<summary>R-999<\/summary>/);
  const r999Card = cardsSection.slice(cardsSection.indexOf("R-999"));
  // Its Stories still come from the manifest's own declared list, even
  // though there is no resolved Spec entry or trace entry for it.
  assert.match(r999Card, /RF-SHARED/);
});

test("TST022 review finding 12: the ADR status badge is styled the same regardless of status", () => {
  assert.doesNotMatch(
    html,
    /\.adr-list \.status \{[^}]*#2e6b3a/,
    "the status badge must not single out a status (e.g. Accepted) with an approving color",
  );
  const decisions = html.slice(
    html.indexOf("決策約束"),
    html.indexOf("診斷摘要"),
  );
  assert.match(decisions, /<span class="status">Accepted<\/span>/);
});

test("TST022 review finding 7: text before a document's first heading appears in its appendix group", () => {
  const appendix = html.slice(html.indexOf('<section class="appendix"'));
  assert.match(appendix, /LEADING_TEXT_SENTENCE_ORPHAN/);
  // It renders exactly once outside the raw appendix, same as any other block.
  const withoutRaw = html.replace(
    /<details class="raw no-print">[\s\S]*?<\/details>/,
    "",
  );
  const count = withoutRaw.split("LEADING_TEXT_SENTENCE_ORPHAN").length - 1;
  assert.equal(count, 1);
});

test("TST022 review finding 11: the page keeps a single <h1>, and card/appendix headings sit below their section heading", () => {
  const h1Count = (html.match(/<h1[ >]/g) ?? []).length;
  assert.equal(h1Count, 1, "the page must keep exactly one <h1>");
});

test("TST022 review finding 6: a Story directory with no Story ID renders in 未對應需求的 Story, titled by its directory path", () => {
  const orphanSection = html.slice(
    html.indexOf('<section class="orphan-stories">'),
    html.indexOf('<section class="appendix"'),
  );
  assert.match(
    orphanSection,
    new RegExp(`<h3>${"specs/stories/no-id-fixture".replace(/\//g, "\\/")}`),
  );
  assert.match(orphanSection, /GOAL_SENTENCE_NOID/);
  assert.match(orphanSection, /ACCEPTANCE_SENTENCE_NOID_1/);
});

// A very small helper: text rendered through the HTML escaper for the raw-Markdown
// appendix comparison above (script/img payload lines contain `<`/`>`/`&`).
function require_escape(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

test("TST022-AC-005: every projection locator equals the index Locator for the same block, once each", () => {
  const locators = [];
  for (const spec of index.specs) {
    if (spec.goal) locators.push(spec.goal);
    if (spec.nonGoals) locators.push(spec.nonGoals);
    for (const section of spec.sections) locators.push(section.locator);
    for (const entry of spec.entries) {
      locators.push(entry.locator);
      for (const acceptance of entry.acceptance)
        locators.push(acceptance.locator);
      for (const key of ["goal", "acceptance", "nonGoals", "dependencies"]) {
        if (entry.sections[key]) locators.push(entry.sections[key]);
      }
    }
  }
  for (const story of index.stories) {
    for (const locator of story.locators.story) locators.push(locator);
    for (const locator of story.locators.acceptance) locators.push(locator);
  }
  for (const adr of index.adrs)
    for (const locator of adr.locators) locators.push(locator);

  assert.ok(locators.length > 0);
  for (const locator of locators) {
    const attributeText = `data-path="${escapeAttribute(locator.path)}" data-anchor="${escapeAttribute(locator.anchor)}" data-block-sha256="${locator.blockSha256}"`;
    const count = html.split(attributeText).length - 1;
    assert.equal(
      count,
      1,
      `expected locator to render exactly once: ${locator.path}#${locator.anchor} (saw ${count})`,
    );
  }
});

function escapeAttribute(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

test("TST022-AC-004: an AC label always names its own <li>'s data-anchor, even with a non-AC bullet, a nested sub-bullet, and out-of-order ids", () => {
  const acListItem =
    /<li[^>]*><span class="ac-id">([^<]+)<\/span>[\s\S]*?<\/li>/g;
  const withAnchor = /data-anchor="([^"]+)"/;
  let sawAny = false;
  for (const match of html.matchAll(acListItem)) {
    const label = match[1];
    const anchor = withAnchor.exec(match[0])?.[1];
    if (anchor === undefined) continue;
    sawAny = true;
    const decodedAnchor = anchor.replaceAll("&gt;", ">");
    // The label is the qualified form of its own `<li>`'s anchor: identical
    // when the anchor is already qualified (Spec `R-NNN/AC-NNN`), or the
    // anchor prefixed with its Story id when the source Locator itself is
    // only path-scoped (`acceptance.md`'s bare `AC-NNN`).
    assert.ok(
      label === decodedAnchor || label.endsWith(`/${decodedAnchor}`),
      `label ${label} must be the qualified form of its own <li>'s data-anchor ${decodedAnchor}`,
    );
  }
  assert.ok(
    sawAny,
    "expected at least one labeled <li> with a locator to check",
  );
});

test("TST022-AC-009: the projection never claims PASS, completion, or approval; checkboxes are glyphs only", () => {
  assert.doesNotMatch(html, /<input/i);
  assert.doesNotMatch(html, /\bPASS\b/);
  assert.doesNotMatch(html, /已核准|已通過|已完成/);
  assert.match(html, /☐/);
  assert.match(html, /class="checkbox-glyph"/);
});

test("TST022-AC-010/Security Fixture Matrix: untrusted markup and unsafe links are inert; the page is offline and self-contained", () => {
  assert.doesNotMatch(html, /<script[\s>]/i);
  assert.doesNotMatch(html, /<img[\s>]/i);
  assert.doesNotMatch(html, /<iframe[\s>]/i);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /href="javascript:/i);
  assert.doesNotMatch(html, /href="data:/i);
  assert.doesNotMatch(html, /href="mailto:/i);
  assert.match(html, /<a class="unsafe-link">x<\/a>/);
  assert.match(html, /<a class="unsafe-link">y<\/a>/);
  assert.match(html, /<a class="unsafe-link">z<\/a>/);
  // Preface script/link payload is also inert, and never gets an href.
  assert.match(html, /由批次作者撰寫（Review Preface）[\s\S]*&lt;script&gt;/);
  assert.match(html, /Content-Security-Policy/);
  assert.doesNotMatch(html, /https?:\/\/(?!example\.test)/);
  assert.doesNotMatch(
    html,
    /<link[\s>]|<iframe[\s>]|<embed[\s>]|<object[\s>]/i,
  );
  assert.match(html, /overflow-wrap: anywhere/);
  assert.match(html, /@media print/);
  assert.match(html, /details::details-content/);
});

test("TST022-AC-008: long unbroken tokens in inline code wrap instead of widening a narrow page", () => {
  // A 64-character hash inside inline code has no break opportunity; without
  // this rule a 390 px viewport scrolls horizontally.
  assert.match(html, /(?:^|[\s,}])code \{[^}]*overflow-wrap: anywhere;/m);
});

test("TST022-AC-008: visually hidden headings stay inside the scrolling table container", () => {
  // An absolutely positioned visually-hidden element with no positioned
  // ancestor escapes the table's overflow clip and widens a narrow page.
  assert.match(html, /\.table-scroll \{[^}]*position: relative;/);
});

test("TST022-AC-004/005: a heading nested in a promoted block keeps its own locator and stays visible", () => {
  const nested = [
    ["In Scope", "Story: RF-SHARED Fixture Shared Story > Scope > In Scope"],
    ["Edge Cases", "Acceptance Criteria > Happy Path > Edge Cases"],
  ];
  for (const [text, anchor] of nested) {
    const element = new RegExp(`<h[1-6][^>]*>${text}</h[1-6]>`).exec(html);
    assert.ok(element, `${text} heading rendered`);
    assert.doesNotMatch(element[0], /visually-hidden/, `${text} is visible`);
    assert.ok(
      element[0].includes(`data-anchor="${anchor.replaceAll(">", "&gt;")}"`),
      `${text} carries its own locator`,
    );
  }
  // Two headings can legitimately share the same `(path, anchor)` when the
  // index has no explicit ID for either (contract §5 rule 2, e.g. duplicate
  // `## Notes`): what must stay unique is the HTML `id` each gets, and each
  // must keep its own `data-block-sha256` (TST022 review finding 4).
  const ids = [...html.matchAll(/\sid="(loc-[^"]+)"/g)].map(
    (match) => match[1],
  );
  assert.equal(new Set(ids).size, ids.length, "no duplicate ids");
});

test("TST022 review finding 4: two headings sharing the same heading-path anchor get distinct ids and their own block hash", () => {
  const notesHeadings = [
    ...html.matchAll(
      /<h[1-6]([^>]*data-anchor="Acceptance Criteria &gt; Notes"[^>]*)>Notes<\/h[1-6]>/g,
    ),
  ];
  assert.equal(notesHeadings.length, 2, "both duplicate Notes headings render");
  const [firstAttrs, secondAttrs] = notesHeadings.map((match) => match[1]);
  const idOf = (attrs) => /\sid="([^"]+)"/.exec(attrs)?.[1];
  const shaOf = (attrs) => /data-block-sha256="([^"]+)"/.exec(attrs)?.[1];
  assert.notEqual(idOf(firstAttrs), idOf(secondAttrs));
  assert.notEqual(shaOf(firstAttrs), shaOf(secondAttrs));
  assert.match(html, /NOTES_SENTENCE_SHARED_FIRST/);
  assert.match(html, /NOTES_SENTENCE_SHARED_SECOND/);
});
