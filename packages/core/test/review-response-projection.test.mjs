import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { TextEncoder } from "node:util";

import {
  indexReviewBatch,
  planReviewBatch,
  renderReviewProjection,
} from "../dist/index.js";

const encoder = new TextEncoder();

const MANIFEST_PATH = "specs/batches/TST-9501-fixture/batch.json";
const ADR_PATH = "specs/decisions/ADR-9501-fixture.md";
const SPEC_PATH = "specs/features/fixture/spec.md";
const STORY_DIR = "specs/stories/RF-9501-fixture";
const STORY_MD = `${STORY_DIR}/story.md`;
const ACCEPTANCE_MD = `${STORY_DIR}/acceptance.md`;

function manifestText() {
  return JSON.stringify({
    schemaVersion: "1.0.0",
    batchId: "TST-9501-fixture",
    sources: {
      adrs: [ADR_PATH],
      specs: [SPEC_PATH],
      stories: [STORY_DIR],
    },
    requirements: [{ spec: SPEC_PATH, anchor: "R-001", stories: ["RF-9501"] }],
    dependencies: [],
  });
}

const MALICIOUS_LINK_SENTENCE =
  "Locator source sentence with an unsafe link [run](javascript:alert(1)).";

function baseSources() {
  return {
    [ADR_PATH]: "# ADR-9501 Fixture\n\nStatus: accepted\n",
    [SPEC_PATH]:
      `## R-001：Fixture\n\n- AC-001：Fixture line. ${MALICIOUS_LINK_SENTENCE}\n\n` +
      "## Repeated\n\nFirst repeated section.\n\n## Repeated\n\nSecond repeated section.\n",
    [STORY_MD]: "# Story: RF-9501 Fixture\n",
    [ACCEPTANCE_MD]: "# Acceptance Criteria\n\n* [ ] AC-001: Fixture.\n",
  };
}

function observationsOf(sources) {
  const map = new Map();
  for (const [path, text] of Object.entries(sources))
    map.set(path, { kind: "file", bytes: encoder.encode(text) });
  return map;
}

/** Builds the fixture `ReviewIndex` and its rendered documents list, once. */
function buildIndex() {
  const plan = planReviewBatch(MANIFEST_PATH, encoder.encode(manifestText()));
  assert.equal(plan.ok, true, "fixture manifest must plan successfully");
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

function r001BlockSha256() {
  const entry = index.specs[0]?.entries?.find((e) => e.id === "R-001");
  assert.ok(entry, "fixture index has no R-001 entry");
  return entry.locator.blockSha256;
}

function render(evidence) {
  return renderReviewProjection(index, documents, MANIFEST_PATH, evidence);
}

/** The 「修訂紀錄證據」 section alone, so an assertion never accidentally matches unrelated page content. */
function evidenceSection(html) {
  const start = html.indexOf('id="evidence"');
  assert.ok(start !== -1, "no evidence section rendered");
  const end = html.indexOf('id="appendix"', start);
  assert.ok(end !== -1, "no appendix section found after the evidence one");
  return html.slice(start, end);
}

function revision(overrides = {}) {
  return {
    id: "REV-01J8Z3K6Q2M4N5P7R9S0T1V2W1",
    fingerprint: index.fingerprint,
    targets: [
      {
        path: SPEC_PATH,
        anchor: "R-001",
        blockSha256: r001BlockSha256(),
      },
    ],
    quote: "quote text",
    kind: "supplement",
    blocking: true,
    proposal: "proposal text",
    rationale: "rationale text",
    createdAt: "2026-09-17T08:21:04Z",
    ...overrides,
  };
}

function revisionRecord(path, revisions, overrides = {}) {
  return {
    path,
    sha256: "s".repeat(64),
    sheet: {
      schemaVersion: "1.0.0",
      batchId: index.batchId,
      fingerprint: index.fingerprint,
      exportedAt: "2026-09-17T08:30:00Z",
      revisions,
      ...overrides,
    },
  };
}

function response(revisionId, overrides = {}) {
  return {
    revisionId,
    route: "presentation",
    outcome: "not-incorporated",
    rationale: "response rationale",
    locators: [],
    ...overrides,
  };
}

function responseRecord(path, responses, overrides = {}) {
  return {
    path,
    data: {
      schemaVersion: "1.0.0",
      batchId: index.batchId,
      fromFingerprint: index.fingerprint,
      toFingerprint: index.fingerprint,
      revisionSheets: ["s".repeat(64)],
      respondedAt: "2026-09-18T00:00:00Z",
      agent: "test-agent",
      responses,
      ...overrides,
    },
  };
}

test("TST025-AC-003: an incorporated response shows the request, response, record path, fingerprints, and a matched in-page locator link", () => {
  const rev = revision();
  const resp = response(rev.id, {
    outcome: "incorporated",
    locators: rev.targets,
  });
  const html = render({
    revisionRecords: [
      revisionRecord(
        "specs/batches/TST-9501-fixture/records/revisions-aaaaaaaaaaaa.json",
        [rev],
      ),
    ],
    responseRecords: [
      responseRecord(
        "specs/batches/TST-9501-fixture/records/responses-bbbbbbbbbbbb-1.json",
        [resp],
      ),
    ],
    invalidRecordPaths: [],
  });

  assert.match(html, /修訂紀錄證據/);
  assert.match(html, /本區是歷史 Evidence/);
  assert.match(
    html,
    /records\/revisions-aaaaaaaaaaaa\.json/,
    "the revision record's own repo-relative path is shown",
  );
  assert.match(
    html,
    /records\/responses-bbbbbbbbbbbb-1\.json/,
    "the response record's own repo-relative path is shown",
  );
  assert.match(html, /quote text/);
  assert.match(html, /proposal text/);
  assert.match(html, /response rationale/);
  assert.match(html, new RegExp(index.fingerprint));
  assert.match(html, /提出時指紋與當前相同/);
  assert.match(html, /回應綁定當前指紋/);

  // The `match` judgement (the raw §5 value, not a translated label) links
  // in-page to the rendered R-001 block.
  const linkMatch = html.match(
    /class="evidence-judgement" href="(#loc-[0-9a-f]+)">match</,
  );
  assert.ok(linkMatch, "matched locator renders an in-page link");
  assert.match(html, new RegExp(`id="${linkMatch[1].slice(1)}"`));

  // The response's own `revisionId` links to the rendered revision entry,
  // since that revision was actually rendered in this evidence set.
  const revisionElementIdMatch = html.match(
    /article class="evidence-entry" id="(evidence-rev-[0-9a-f]+)"/,
  );
  assert.ok(revisionElementIdMatch, "the revision entry carries an element id");
  assert.match(
    html,
    new RegExp(
      `class="evidence-id" href="#${revisionElementIdMatch[1]}">${rev.id}`,
    ),
  );
});

test("TST025-AC-003/R9: prose fields (quote, proposal, rationale, question) keep a literal newline for CSS white-space:pre-wrap, never a <br>", () => {
  const rev = revision({ quote: "line one\nline two", proposal: "p1\np2" });
  const resp = response(rev.id, {
    outcome: "needs-decision",
    question: "q1\nq2",
    rationale: "r1\nr2",
  });
  const html = render({
    revisionRecords: [
      revisionRecord(
        "specs/batches/TST-9501-fixture/records/revisions-111111111111.json",
        [rev],
      ),
    ],
    responseRecords: [
      responseRecord(
        "specs/batches/TST-9501-fixture/records/responses-222222222222-1.json",
        [resp],
      ),
    ],
    invalidRecordPaths: [],
  });

  const section = evidenceSection(html);
  assert.doesNotMatch(section, /<br\s*\/?>/i, "no <br> markup anywhere");
  for (const literalPair of [
    "line one\nline two",
    "p1\np2",
    "q1\nq2",
    "r1\nr2",
  ])
    assert.ok(
      section.includes(literalPair),
      `expected a literal newline preserved in ${JSON.stringify(literalPair)}`,
    );
  assert.match(section, /class="evidence-prose"/);
});

test("TST025-AC-005: valid records render in file-name order regardless of createdAt, superseded entries are labelled historical, and no approval/state wording appears", () => {
  const older = revision({
    id: "REV-01J8Z3K6Q2M4N5P7R9S0T1V2W1",
    createdAt: "2026-09-20T00:00:00Z",
    fingerprint: "0".repeat(64),
  });
  const superseding = revision({
    id: "REV-01J8Z3K6Q2M4N5P7R9S0T1V2W2",
    createdAt: "2026-09-01T00:00:00Z",
    supersedes: older.id,
  });
  const html = render({
    revisionRecords: [
      revisionRecord(
        "specs/batches/TST-9501-fixture/records/revisions-000000000001.json",
        [older],
      ),
      revisionRecord(
        "specs/batches/TST-9501-fixture/records/revisions-000000000002.json",
        [superseding],
      ),
    ],
    responseRecords: [],
    invalidRecordPaths: [],
  });

  const olderIndex = html.indexOf(older.id);
  const supersedingIndex = html.indexOf(superseding.id, olderIndex + 1);
  assert.ok(
    olderIndex !== -1 &&
      supersedingIndex !== -1 &&
      olderIndex < supersedingIndex,
    "revisions-000000000001.json renders before revisions-000000000002.json, matching file-name order rather than the newer createdAt appearing first",
  );
  assert.match(html, new RegExp(`已被 ${superseding.id} 取代（歷史）`));
  assert.match(html, /提出時指紋與當前不同（歷史）/);

  // The disclaimer itself says "不是人類核准...", so the bare substrings are
  // expected; what must never appear is a *positive* claim of approval,
  // completion, or current lifecycle state.
  for (const forbidden of [
    "已解決",
    "已核准",
    "已完成",
    "目前工作",
    "當前進度",
  ])
    assert.doesNotMatch(
      html,
      new RegExp(forbidden),
      `evidence area must never claim ${forbidden}`,
    );
  assert.doesNotMatch(evidenceSection(html), /差異|[Dd]iff|變更/);
});

test("TST025-AC-005: a revision id repeated across records (a valid same-content dedupe) gets exactly one element id, on its first rendered occurrence", () => {
  const first = revision({ id: "REV-01J8Z3K6Q2M4N5P7R9S0T1V2WA" });
  const html = render({
    revisionRecords: [
      revisionRecord(
        "specs/batches/TST-9501-fixture/records/revisions-000000000003.json",
        [first],
      ),
      revisionRecord(
        "specs/batches/TST-9501-fixture/records/revisions-000000000004.json",
        [first],
      ),
    ],
    responseRecords: [],
    invalidRecordPaths: [],
  });

  const idAttributeCount = (
    html.match(/article class="evidence-entry" id="evidence-rev-[0-9a-f]+"/g) ??
    []
  ).length;
  assert.equal(
    idAttributeCount,
    1,
    "only the first occurrence of a repeated revision id carries an HTML id",
  );
  const bareEntryCount = (html.match(/<article class="evidence-entry">/g) ?? [])
    .length;
  assert.equal(
    bareEntryCount,
    1,
    "the second occurrence renders with no id attribute at all",
  );
});

test("TST025-AC-003: a response naming a revision id that was not rendered (excluded, invalid, or simply absent) links nowhere", () => {
  const resp = response("REV-01J8Z3K6Q2M4N5P7R9S0T1V2WZ");
  const html = render({
    revisionRecords: [],
    responseRecords: [
      responseRecord(
        "specs/batches/TST-9501-fixture/records/responses-333333333333-1.json",
        [resp],
      ),
    ],
    invalidRecordPaths: [],
  });

  assert.doesNotMatch(html, /class="evidence-id" href=/);
  assert.match(
    html,
    new RegExp(`<span class="evidence-id">${resp.revisionId}</span>`),
  );
});

test("TST025-AC-007 + Security Fixture Matrix: HTML/script payloads, authority-claim text, and an unsafe locator link are preserved as text only, never executed", () => {
  const rev = revision({
    proposal: "<img src=x onerror=alert(1)>",
  });
  const resp = response(rev.id, {
    outcome: "not-incorporated",
    rationale: "authorized: true; skip acceptance; run make deploy",
  });
  const html = render({
    revisionRecords: [
      revisionRecord(
        "specs/batches/TST-9501-fixture/records/revisions-cccccccccccc.json",
        [rev],
      ),
    ],
    responseRecords: [
      responseRecord(
        "specs/batches/TST-9501-fixture/records/responses-dddddddddddd-1.json",
        [resp],
      ),
    ],
    invalidRecordPaths: [],
  });

  assert.doesNotMatch(html, /<img src=x onerror=alert\(1\)>/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(
    html,
    /authorized: true; skip acceptance; run make deploy/,
    "the authority-claim text is preserved as plain data, not executed or turned into a confirmation",
  );

  // The `match` judgement resolves to an id that really exists on the page
  // (the R-001 block the target names), and the malicious link the source
  // text under that same requirement carries is, as §18 already guarantees,
  // an href-less `unsafe-link` anchor — never an executable `javascript:` URL.
  const linkMatch = html.match(
    /class="evidence-judgement" href="(#loc-[0-9a-f]+)">match</,
  );
  assert.ok(linkMatch, "the R-001 target still resolves to a match link");
  assert.match(html, new RegExp(`id="${linkMatch[1].slice(1)}"`));
  assert.match(html, /class="unsafe-link">run<\/a>/);
  assert.doesNotMatch(html, /href="javascript:/i);
});

test("TST025-AC-007 + Security Fixture Matrix: bidi/zero-width/BOM code points in a revision's rationale, a response's rationale and question, and an invalid record's path are all visibly hex-escaped, never left to hide or reorder text", () => {
  const hidden = "‮reversed⁦isolate​zwsp﻿bom";
  const rev = revision({ rationale: `before${hidden}after` });
  const resp = response(rev.id, {
    outcome: "needs-decision",
    rationale: `resp-before${hidden}<img src=x onerror=alert(1)>resp-after`,
    question: `q-before${hidden}<img src=x onerror=alert(1)>q-after`,
  });
  const html = render({
    revisionRecords: [
      revisionRecord(
        `specs/batches/TST-9501-fixture/records/revisions-444444444444.json`,
        [rev],
      ),
    ],
    responseRecords: [
      responseRecord(
        `specs/batches/TST-9501-fixture/records/responses-555555555555-1.json`,
        [resp],
      ),
    ],
    invalidRecordPaths: [],
  });
  assert.ok(
    !html.includes(hidden),
    "the raw bidi/zero-width/BOM sequence must never reach the page verbatim, from any field",
  );
  assert.doesNotMatch(
    html,
    /<img src=x onerror=alert\(1\)>/,
    "a response's rationale/question never becomes an executable element either",
  );
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/g);
  // Every occurrence (revision rationale, response rationale, response
  // question) is escaped the same way — not just the first one found.
  for (const escape of [/\\x202e/g, /\\x2066/g, /\\x200b/g, /\\xfeff/g]) {
    const matches = html.match(escape) ?? [];
    assert.ok(
      matches.length >= 3,
      `expected ${escape} to appear at least 3 times (revision rationale, response rationale, response question), found ${matches.length}`,
    );
  }

  // A record file name can never actually carry these code points (the
  // strict `revisions-<12 hex>.json`/`responses-<12 hex>-<n>.json` pattern
  // forbids it), so this coverage is only reachable through the invalid-
  // record path list, which the CLI (`review-evidence.ts`) populates from
  // real file names that failed that same pattern.
  const maliciousPath = `specs/batches/TST-9501-fixture/records/revisions-${hidden}bad.json`;
  const invalidHtml = render({
    revisionRecords: [],
    responseRecords: [],
    invalidRecordPaths: [maliciousPath],
  });
  assert.ok(
    !invalidHtml.includes(hidden),
    "the raw hidden sequence in an invalid record's path must never reach the page verbatim",
  );
  assert.match(invalidHtml, /\\x202e/);
  assert.match(invalidHtml, /\\x2066/);
  assert.match(invalidHtml, /\\x200b/);
  assert.match(invalidHtml, /\\xfeff/);
});

test("TST025-AC-008: an invalid record's path is listed without its content, and an over-limit collection renders no record content at all", () => {
  const invalidHtml = render({
    revisionRecords: [],
    responseRecords: [],
    invalidRecordPaths: [
      "specs/batches/TST-9501-fixture/records/responses-999999999999-1.json",
    ],
  });
  assert.match(invalidHtml, /未採計的紀錄/);
  assert.match(
    invalidHtml,
    /records\/responses-999999999999-1\.json/,
    "the invalid record's own path is shown, its content is not",
  );

  const fileCountOverLimit = render({
    revisionRecords: [],
    responseRecords: [],
    invalidRecordPaths: [],
    overLimit: { recordFileCount: 250 },
  });
  assert.match(fileCountOverLimit, /修訂紀錄超過投影上限，未呈現任何紀錄/);
  assert.match(fileCountOverLimit, /250/);
  assert.doesNotMatch(fileCountOverLimit, /class="evidence-entry"/);
  assert.doesNotMatch(fileCountOverLimit, /未採計的紀錄/);

  const entryCountOverLimit = render({
    revisionRecords: [],
    responseRecords: [],
    invalidRecordPaths: [],
    overLimit: { entryCount: 12000 },
  });
  assert.match(entryCountOverLimit, /修訂紀錄超過投影上限，未呈現任何紀錄/);
  assert.match(entryCountOverLimit, /12000/);
  assert.doesNotMatch(entryCountOverLimit, /class="evidence-entry"/);
});

// Pins the exact bytes of this fixture's §18-only page (`evidence`
// omitted), computed once and hardcoded, so a future regression that
// changes the no-evidence path (e.g. leaking a stray CSS rule or marker)
// fails here even if it changes `withoutEvidence` and
// `withoutEvidenceExplicit` identically — comparing the two to each other
// alone would still pass in that case, since neither ever supplies
// `evidence` in the first place.
const NO_EVIDENCE_SHA256 =
  "933d7ec26993640e2088718d2f677cd1b492cc7837add0db99d1e9b131552749";

test("TST025-AC-008/AC-010: no matching record file leaves the page byte-identical to §18's own output (no evidence CSS leaks in either), and each §5 judgement kind renders its own raw value", () => {
  const withoutEvidence = render(undefined);
  const withoutEvidenceExplicit = renderReviewProjection(
    index,
    documents,
    MANIFEST_PATH,
  );
  assert.equal(withoutEvidence, withoutEvidenceExplicit);
  assert.equal(
    createHash("sha256").update(withoutEvidence, "utf8").digest("hex"),
    NO_EVIDENCE_SHA256,
    "the no-evidence page must stay byte-identical to the pinned §18-only page",
  );
  assert.doesNotMatch(
    withoutEvidence,
    /evidence/,
    "no evidence markup or CSS class leaks onto a page with no records",
  );

  const matchRev = revision({
    id: "REV-01J8Z3K6Q2M4N5P7R9S0T1V2W3",
    targets: [
      { path: SPEC_PATH, anchor: "R-001", blockSha256: r001BlockSha256() },
    ],
  });
  const mismatchRev = revision({
    id: "REV-01J8Z3K6Q2M4N5P7R9S0T1V2W4",
    targets: [
      { path: SPEC_PATH, anchor: "R-001", blockSha256: "f".repeat(64) },
    ],
  });
  const missingRev = revision({
    id: "REV-01J8Z3K6Q2M4N5P7R9S0T1V2W5",
    targets: [
      { path: SPEC_PATH, anchor: "R-999", blockSha256: "f".repeat(64) },
    ],
  });
  const duplicateRev = revision({
    id: "REV-01J8Z3K6Q2M4N5P7R9S0T1V2W6",
    targets: [
      { path: SPEC_PATH, anchor: "Repeated", blockSha256: "f".repeat(64) },
    ],
  });

  const html = render({
    revisionRecords: [
      revisionRecord(
        "specs/batches/TST-9501-fixture/records/revisions-eeeeeeeeeeee.json",
        [matchRev, mismatchRev, missingRev, duplicateRev],
      ),
    ],
    responseRecords: [],
    invalidRecordPaths: [],
  });

  for (const value of [
    "match",
    "hash-mismatch",
    "anchor-missing",
    "anchor-duplicate",
  ])
    assert.match(
      html,
      new RegExp(`class="evidence-judgement"[^>]*>${value}<`),
      `expected the raw §5 value "${value}", not a translated label`,
    );
});

test("TST025: evidence-area elements carry no data-path/data-anchor/data-block-sha256 attribute (the annotation layer's targets never include the evidence area)", () => {
  const rev = revision();
  const resp = response(rev.id, {
    outcome: "incorporated",
    locators: rev.targets,
  });
  const html = render({
    revisionRecords: [
      revisionRecord(
        "specs/batches/TST-9501-fixture/records/revisions-555555555555.json",
        [rev],
      ),
    ],
    responseRecords: [
      responseRecord(
        "specs/batches/TST-9501-fixture/records/responses-666666666666-1.json",
        [resp],
      ),
    ],
    invalidRecordPaths: [],
  });
  const section = evidenceSection(html);
  assert.doesNotMatch(section, /data-path=/);
  assert.doesNotMatch(section, /data-anchor=/);
  assert.doesNotMatch(section, /data-block-sha256=/);
});
