import assert from "node:assert/strict";
import test from "node:test";
import { TextEncoder } from "node:util";

import {
  indexReviewBatch,
  planReviewBatch,
  renderReviewProjection,
} from "../dist/index.js";

const encoder = new TextEncoder();

const MANIFEST_PATH = "specs/batches/TST-9701-fixture/batch.json";
const ADR_PATH = "specs/decisions/ADR-9701-fixture.md";
const SPEC_PATH = "specs/features/fixture/spec.md";
const STORY_DIR = "specs/stories/RF-9701-fixture";
const STORY_MD = `${STORY_DIR}/story.md`;
const ACCEPTANCE_MD = `${STORY_DIR}/acceptance.md`;

function manifestText() {
  return JSON.stringify({
    schemaVersion: "1.0.0",
    batchId: "TST-9701-fixture",
    sources: { adrs: [ADR_PATH], specs: [SPEC_PATH], stories: [STORY_DIR] },
    requirements: [{ spec: SPEC_PATH, anchor: "R-001", stories: ["RF-9701"] }],
    dependencies: [],
  });
}

function baseSources() {
  return {
    [ADR_PATH]: "# ADR-9701 Fixture\n\nStatus: accepted\n",
    [SPEC_PATH]: "## R-001：Fixture\n\n- AC-001：Fixture line.\n",
    [STORY_MD]: "# Story: RF-9701 Fixture\n",
    [ACCEPTANCE_MD]: "# Acceptance Criteria\n\n* [ ] AC-001: Fixture.\n",
  };
}

function observationsOf(sources) {
  const map = new Map();
  for (const [path, text] of Object.entries(sources))
    map.set(path, { kind: "file", bytes: encoder.encode(text) });
  return map;
}

function buildIndex() {
  const plan = planReviewBatch(MANIFEST_PATH, encoder.encode(manifestText()));
  assert.equal(plan.ok, true);
  const sources = baseSources();
  const result = indexReviewBatch(plan.plan, observationsOf(sources));
  assert.equal(result.kind, "ok", JSON.stringify(result));
  const { index } = result;
  const documents = index.sources.map((source) => ({
    path: source.path,
    bytes: encoder.encode(sources[source.path]),
  }));
  return { index, documents };
}

const { index, documents } = buildIndex();

function render(applicability) {
  return renderReviewProjection(
    index,
    documents,
    MANIFEST_PATH,
    undefined,
    applicability,
  );
}

function storedConfirmation(overrides = {}) {
  return {
    path: `specs/batches/TST-9701-fixture/records/confirmation-${index.fingerprint.slice(0, 12)}.json`,
    record: {
      schemaVersion: "1.0.0",
      claim: "explicit-terminal-confirmation",
      batchId: "TST-9701-fixture",
      fingerprint: index.fingerprint,
      manifestSha256: index.manifestSha256,
      sources: index.sources.map((s) => ({ path: s.path, sha256: s.sha256 })),
      confirmedAt: "2026-09-17T09:40:00Z",
      deferred: [],
      revisionSheets: [],
    },
    ...overrides,
  };
}

test("TST026-AC-004/render: with no applicability argument the page is byte-identical to render with no confirmation data at all", () => {
  const withoutArgument = renderReviewProjection(
    index,
    documents,
    MANIFEST_PATH,
  );
  const withUndefinedApplicability = render(undefined);
  assert.equal(withUndefinedApplicability, withoutArgument);
  assert.ok(!withoutArgument.includes("confirmation-status"));
  assert.ok(!withoutArgument.includes("需複審"));
});

test("TST026-AC-004/render: an applicable confirmation shows the bound-to-current-fingerprint state and no 需複審 badge anywhere", () => {
  const applicability = {
    applies: true,
    confirmation: storedConfirmation(),
  };
  const html = render(applicability);
  assert.ok(html.includes("有一份確認紀錄綁定目前指紋"));
  assert.ok(html.includes("確認是人類聲明，不是授權、核准執行或完成狀態。"));
  assert.ok(!html.includes("需複審"));
  assert.ok(!html.includes("沒有確認紀錄綁定目前指紋"));
});

test("TST026-AC-004/render: a stale confirmation lists exactly the changed source and manifest change, and marks only the changed source's doc-path blocks", () => {
  const stale = storedConfirmation({
    record: {
      ...storedConfirmation().record,
      fingerprint: "9".repeat(64),
      manifestSha256: "8".repeat(64),
      sources: index.sources.map((s) =>
        s.path === SPEC_PATH ? { path: s.path, sha256: "a".repeat(64) } : s,
      ),
    },
  });
  const applicability = {
    applies: false,
    latest: stale,
    sourceChanges: [{ path: SPEC_PATH, kind: "changed" }],
    manifestChanged: true,
  };
  const html = render(applicability);
  assert.ok(html.includes("沒有確認紀錄綁定目前指紋"));
  assert.ok(html.includes("2026-09-17T09:40:00Z"));
  assert.ok(html.includes("manifest 變動"));

  // Exactly one 需複審 badge for the Spec's doc-path label in 批次目標
  // (this fixture's Spec has no Non-goals block, so only one doc-group
  // renders it); the ADR's own doc-path in the appendix carries no badge.
  const goalStart = html.indexOf("<h2>批次目標</h2>");
  const goalEnd = html.indexOf("<h2>不包含</h2>");
  const goalSection = html.slice(goalStart, goalEnd);
  assert.ok(
    goalSection.includes(
      `${SPEC_PATH} <span class="review-badge">需複審</span>`,
    ),
  );

  const adrSummaryIndex = html.indexOf(`<summary>${ADR_PATH}</summary>`);
  assert.ok(
    adrSummaryIndex !== -1,
    "unchanged ADR must render without a badge on its own summary",
  );
});

test("TST026-AC-004/render: a removed source is listed only in the header, never as a badge (nothing in the current page corresponds to it)", () => {
  const applicability = {
    applies: false,
    latest: storedConfirmation(),
    sourceChanges: [
      { path: "specs/stories/RF-9701-removed/story.md", kind: "removed" },
    ],
    manifestChanged: false,
  };
  const html = render(applicability);
  assert.ok(html.includes("移除"));
  assert.ok(html.includes("specs/stories/RF-9701-removed/story.md"));
  assert.ok(!html.includes("需複審"));
});

test("TST026-AC-004: an acceptance.md-only change shows its 需複審 badge inside the requirement card next to its own doc-path label, not on story.md's", () => {
  const stale = storedConfirmation({
    record: {
      ...storedConfirmation().record,
      fingerprint: "9".repeat(64),
      sources: index.sources.map((s) =>
        s.path === ACCEPTANCE_MD ? { path: s.path, sha256: "a".repeat(64) } : s,
      ),
    },
  });
  const applicability = {
    applies: false,
    latest: stale,
    sourceChanges: [{ path: ACCEPTANCE_MD, kind: "changed" }],
    manifestChanged: false,
  };
  const html = render(applicability);

  const cardsStart = html.indexOf(`<section class="cards">`);
  const cardsEnd = html.indexOf(`<section class="orphan-stories">`);
  assert.ok(cardsStart !== -1 && cardsEnd !== -1);
  const cardsSection = html.slice(cardsStart, cardsEnd);

  assert.ok(
    cardsSection.includes(
      `${ACCEPTANCE_MD}</span> <span class="review-badge">需複審</span>`,
    ),
    "the acceptance.md doc-path label inside the card must carry the badge",
  );
  assert.ok(
    !cardsSection.includes(
      `${STORY_MD}</span> <span class="review-badge">需複審</span>`,
    ),
    "story.md's own doc-path label must not be badged when only acceptance.md changed",
  );
  // Every rendered source block now carries a visible path label (H1): the
  // Spec entry's 需求驗收/需求細節 and the Story's 執行驗收/Story 重點.
  assert.ok(
    cardsSection.includes(
      `<h3>需求驗收 <span class="doc-path">${SPEC_PATH}</span></h3>`,
    ),
  );
  assert.ok(
    cardsSection.includes(
      `<h3>需求細節 <span class="doc-path">${SPEC_PATH}</span></h3>`,
    ),
  );
  assert.ok(
    cardsSection.includes(`<span class="doc-path">${ACCEPTANCE_MD}</span>`),
  );
  assert.ok(cardsSection.includes(`<span class="doc-path">${STORY_MD}</span>`));
});

test("TST026-AC-004: a missing source (sha256 null) reads 缺失 in the header, not 內容變動, while the badge and REVIEW_SOURCE_CHANGED-style kind stay the same", () => {
  const stale = storedConfirmation();
  const applicability = {
    applies: false,
    latest: stale,
    sourceChanges: [{ path: SPEC_PATH, kind: "changed", missing: true }],
    manifestChanged: false,
  };
  const html = render(applicability);
  assert.ok(html.includes(`缺失：<span class="doc-path">${SPEC_PATH}</span>`));
  assert.ok(
    !html.includes(`內容變動：<span class="doc-path">${SPEC_PATH}</span>`),
  );
  assert.ok(
    html.includes("需複審"),
    "a missing source still gets the 需複審 badge",
  );
});

test("TST026-AC-004/render: review index output is unchanged by confirmation data (index never reads records/, contract §8 修訂，R-006)", () => {
  // `indexReviewBatch`'s own output has no confirmation field at all: the
  // index/index-diagnostics path is untouched by this Story.
  assert.ok(!("confirmationApplicability" in index));
  assert.ok(!JSON.stringify(index).includes("confirmation"));
});
