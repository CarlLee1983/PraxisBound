import assert from "node:assert/strict";
import test from "node:test";
import { TextEncoder } from "node:util";

import { renderReviewProjection } from "../dist/index.js";

const index = {
  batchId: "TST-922-fixture",
  title: "Readable fixture objective",
  fingerprint: "a".repeat(64),
  manifestSha256: "b".repeat(64),
  sources: [
    { path: "specs/features/fixture/spec.md", sha256: "c".repeat(64) },
    {
      path: "specs/stories/RF-001-fixture/story.md",
      sha256: "d".repeat(64),
    },
    {
      path: "specs/stories/RF-001-fixture/acceptance.md",
      sha256: "e".repeat(64),
    },
  ],
  adrs: [],
  specs: [
    {
      path: "specs/features/fixture/spec.md",
      entries: [
        {
          id: "R-001",
          heading: "R-001：Fixture",
          locator: {
            path: "specs/features/fixture/spec.md",
            anchor: "R-001",
            blockSha256: "f".repeat(64),
          },
          acceptance: [],
        },
      ],
      sections: [],
    },
  ],
  stories: [
    {
      id: "RF-001",
      path: "specs/stories/RF-001-fixture",
      acceptanceIds: ["AC-001", "AC-002"],
      locators: {
        story: [],
        acceptance: [
          {
            path: "specs/stories/RF-001-fixture/acceptance.md",
            anchor: "Acceptance Criteria",
            blockSha256: "1".repeat(64),
          },
          {
            path: "specs/stories/RF-001-fixture/acceptance.md",
            anchor: "AC-001",
            blockSha256: "2".repeat(64),
          },
          {
            path: "specs/stories/RF-001-fixture/acceptance.md",
            anchor: "AC-002",
            blockSha256: "3".repeat(64),
          },
        ],
      },
    },
  ],
  trace: [
    {
      spec: "specs/features/fixture/spec.md",
      anchor: "R-001",
      stories: [{ storyId: "RF-001", acceptanceIds: ["AC-001", "AC-002"] }],
    },
  ],
  dependencies: [],
  diagnostics: [
    {
      code: "REVIEW_SOURCE_MISSING",
      severity: "blocking",
      message: "declared source is missing: specs/missing.md",
      path: "specs/missing.md",
    },
  ],
};

test("TST022-AC-001/002/003/005: an offline projection retains sources, promotes Story sections, and makes untrusted markup inert", () => {
  const html = renderReviewProjection(index, [
    {
      path: "specs/features/fixture/spec.md",
      bytes: new TextEncoder().encode(
        "## R-001：Fixture\n\n[x](javascript:alert(1)) [data](data:text/html,unsafe) [safe](https://example.test/reference)\n\n| Long heading | Value |\n| --- | --- |\n| A very long cell | Still locally scrollable |\n",
      ),
    },
    {
      path: "specs/stories/RF-001-fixture/story.md",
      bytes: new TextEncoder().encode(
        "# Story: RF-001 Fixture\n\n## Goal\n\nShip it.\n\n## Scope\n\n<script>alert(1)</script><img src=x onerror=alert(1)>\n\n## Rules\n\nNo remote assets.\n\n## Expected Errors\n\nNo write.\n\n## Constraints\n\nOffline.\n",
      ),
    },
    {
      path: "specs/stories/RF-001-fixture/acceptance.md",
      bytes: new TextEncoder().encode(
        "# Acceptance Criteria\n\n* [ ] AC-001: Still pending.\n* [ ] AC-002: Also pending.\n",
      ),
    },
  ]);

  assert.match(html, /<!doctype html>/i);
  assert.match(html, /TST-922-fixture/);
  assert.match(html, /Requirement Fingerprint/);
  assert.match(html, /Readable fixture objective/);
  assert.match(html, /REVIEW_SOURCE_MISSING/);
  assert.match(html, /Spec → Story → Acceptance/);
  assert.match(html, /Story focus/);
  assert.match(html, /<h3>Goal<\/h3>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script[\s>]/i);
  assert.doesNotMatch(html, /<img[\s>]/i);
  assert.match(html, /<a class="unsafe-link">x<\/a>/);
  assert.match(html, /<a class="unsafe-link">data<\/a>/);
  assert.match(html, /<a href="https:\/\/example\.test\/reference">safe<\/a>/);
  assert.doesNotMatch(html, /href="javascript:/i);
  assert.doesNotMatch(html, /<(?:img|script|iframe|embed|object|link)[\s>]/i);
  assert.match(html, /@media print/);
  assert.match(html, /<nav aria-label="Review navigation">/);
  assert.match(html, /AC-001: Still pending/);
  assert.match(html, /href="#source-1-locator-1"/);
  assert.match(html, /id="source-1-locator-1"/);
  assert.match(html, /href="#source-3-locator-2"/);
  assert.match(html, /id="source-3-locator-2"/);
  assert.match(html, /href="#source-3-locator-3"/);
  assert.match(html, /id="source-3-locator-3"/);
  assert.equal((html.match(/id="source-3-locator-2"/g) ?? []).length, 1);
  assert.match(html, /<div class="table-scroll"><table>/);
  assert.match(html, /Content-Security-Policy/);
  // 64 字元 digest 沒有斷點，窄螢幕上須能換行，否則會撐寬整頁。
  assert.match(html, /\.source-digest \{[^}]*overflow-wrap: anywhere;/);
});
