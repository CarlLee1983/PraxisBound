# Acceptance Criteria

AC IDs trace to `SPEC-BATCH-REVIEW/R-003`. The command-line and output-file
seams are the agreed public seams for this Story; page structure is judged
against contract §18.

## Happy Path

* [ ] AC-001: `praxisbound review render <manifest> --output <file>` produces
  one self-contained HTML Review Projection from exactly the declared batch, in
  the contract §18 order: title with batch ID and Requirement Fingerprint,
  Review Preface, requirement overview matrix, batch goal, non-goals, ADR
  constraints, diagnostic summary, requirement cards, appendix.
* [ ] AC-002: The overview matrix has one row per Spec entry, showing the
  entry anchor and title, its `Goal` and `Non-goals` text verbatim, its Story
  IDs and titles, and its Requirement Acceptance and Execution Acceptance
  counts. A missing section reads 「未寫明」; an entry without Stories reads
  「無對應 Story」. No row carries styling that marks a difference as a problem.
* [ ] AC-003: Each requirement card lists Requirement Acceptance
  (`R-NNN/AC-NNN`), then Execution Acceptance (`<STORY-ID>/AC-NNN`, grouped by
  the acceptance file's headings), then the Story's Goal, Scope, Rules,
  Expected Errors, and Constraints, then the entry's remaining sections. Cards
  are collapsed on screen; a matrix link opens and scrolls to its card.
* [ ] AC-004: Every source block renders exactly once outside the raw
  Markdown appendix and carries its source path. A Story serving two
  requirements renders in the first card and is linked from the second; a
  Story serving none renders in the section after the cards; every remaining
  section of every document appears in the appendix. Every non-blank source
  line's text is present in the projection.
* [ ] AC-005: Headings, paragraphs, lists and checkboxes, tables, fenced code,
  inline code, emphasis, and links are rendered as HTML structure; no Markdown
  marker such as `##`, a code fence, or a list bullet remains as literal text
  outside the raw Markdown appendix. Every projection locator equals the index
  locator for the same block.
* [ ] AC-006: `review index` recognizes the contract §5 Spec vocabulary in
  Traditional Chinese and English: `Goal`, `Non-goals`, `R-NNN/Goal`,
  `R-NNN/Acceptance`, `R-NNN/Non-goals`, `R-NNN/Dependencies` get fixed
  anchors and no `REVIEW_SECTION_UNRECOGNIZED`; unlisted second-level headings
  keep their advisory; a duplicated vocabulary anchor yields blocking
  `REVIEW_ANCHOR_DUPLICATE`.
* [ ] AC-007: A `1.1.0` manifest's `preface` renders after the title, labelled
  as written by the batch author; changing only the preface changes the
  Requirement Fingerprint; a `1.0.0` manifest without `preface` still indexes
  and renders.
* [ ] AC-008: In Chrome opened from a local file, desktop (1280 px) and narrow
  (390 px) renderings have no page-level horizontal scroll, and keyboard
  navigation reaches every matrix link and opens its card. The A4 print
  preview shows every collapsed section expanded, omits raw Markdown, and
  hides fixed controls.

## Business Rules

* [ ] AC-009: The HTML identifies itself as a reading snapshot. It never
  reports an acceptance item as test PASS, completion, or human approval, and
  contains no control implying those claims; checkboxes and counts are source
  presentation only.
* [ ] AC-010: The generated file has no external resource URL, declares a
  restrictive Content-Security-Policy, and is usable directly from a local file
  URL. Only `http:`, `https:`, and in-page fragment links carry an `href`.
* [ ] AC-011: The command applies the same manifest/path/input handling as
  `review index`; a valid draft with missing sources or trace gaps still
  renders and preserves every diagnostic.

## Failure Cases

* [ ] AC-012: An output targeting the manifest, a declared source, the batch
  `records/` directory, or a symlink is rejected as `configuration-error`, exit
  2 with `REVIEW_OUTPUT_CONFLICT`; source and prior output bytes are unchanged.
* [ ] AC-013: A known output write or rename failure returns `failure`, exit 1,
  removes any temporary output, and leaves a prior successful output
  byte-identical; a missing output directory is named in the issue path and is
  not created.
* [ ] AC-014: Invalid render argv returns `usage-error`, exit 2. A non-JSON,
  schema-invalid, unsupported, or unsafe manifest, a `preface` in a `1.0.0`
  manifest, or a `preface` over 4 KiB UTF-8 returns `configuration-error`, exit
  2, with the documented issue code. Every emitted envelope validates at
  schema version `1.0.0`.

## Regression Requirements

* [ ] AC-015: `make verify` passes; `VERSION` stays `0.10.0`; `protocol/` and
  `templates/` are unchanged; TST-021 behavior is unchanged except the
  vocabulary anchors of AC-006; the CLI contract documents the render layout,
  manifest `1.1.0`, and the Additive classification.

## Acceptance Evidence

| AC | Method | Evidence | Fixture / precondition | Expected observation |
| --- | --- | --- | --- | --- |
| `AC-001` | test | `packages/core/test/review-render.test.mjs` | `two-requirement-batch-fixture` | `section-order-matches-contract-18` |
| `AC-002` | test | `packages/core/test/review-render.test.mjs` | `matrix-gaps-fixture` | `verbatim-cells-counts-and-gap-labels` |
| `AC-003` | test | `packages/core/test/review-render.test.mjs` | `two-requirement-batch-fixture` | `card-section-order-and-qualified-ac-ids` |
| `AC-004` | test | `packages/core/test/review-render.test.mjs` | `shared-and-orphan-story-fixture` | `each-block-once-and-every-line-present` |
| `AC-005` | test | `packages/core/test/review-markdown.test.mjs` | `markdown-subset-fixture` | `structured-html-and-matching-locators` |
| `AC-006` | test | `packages/core/test/review-index.test.mjs` | `spec-vocabulary-fixture` | `fixed-anchors-and-duplicate-diagnostic` |
| `AC-007` | test | `packages/cli/test/review-render-command.test.mjs` | `preface-manifest-fixture` | `labelled-preface-and-fingerprint-change` |
| `AC-008` | human | `verification.md:Chrome-local-file-and-print-preview` | `representative-rendered-fixture` | `no-page-scroll-keyboard-cards-and-a4-expanded-print` |
| `AC-009` | test | `packages/core/test/review-render.test.mjs` | `unchecked-acceptance-fixture` | `no-pass-completion-or-approval-claim` |
| `AC-010` | test | `packages/core/test/review-render.test.mjs` | `offline-security-fixture` | `inline-assets-csp-and-safe-links` |
| `AC-011` | test | `packages/cli/test/review-render-command.test.mjs` | `incomplete-draft-fixture` | `success-output-preserves-all-diagnostics` |
| `AC-012` | test | `packages/cli/test/review-render-command.test.mjs` | `output-conflict-fixture` | `configuration-error-and-unchanged-target` |
| `AC-013` | test | `packages/cli/test/review-render-command.test.mjs` | `output-publication-failure-fixture` | `failure-preserves-old-output-and-names-directory` |
| `AC-014` | test | `packages/cli/test/review-render-command.test.mjs` | `invalid-render-input-fixtures` | `documented-schema-valid-error-envelopes` |
| `AC-015` | command | `make verify` | `current-checkout` | `full-composed-gate-exit-0` |

## Security Fixture Matrix

| Source field | Payload | Expected result | Persisted locations | Verification |
| --- | --- | --- | --- | --- |
| `source markdown body` | `<script>alert(1)</script><img src=x onerror=alert(1)>` | preserve | `review.html text node` | `packages/core/test/review-render.test.mjs` |
| `source markdown link` | `[x](javascript:alert(1))` | omit | `review.html anchor.href` | `packages/core/test/review-render.test.mjs` |
| `source markdown link` | `[x](data:text/html,...)` | omit | `review.html anchor.href` | `packages/core/test/review-render.test.mjs` |
| `source markdown link` | `[x](mailto:a@example.test)` | omit | `review.html anchor.href` | `packages/core/test/review-render.test.mjs` |
| `batch.json preface` | `<script>alert(1)</script>[x](javascript:alert(1))` | preserve | `review.html text node; anchor without href` | `packages/core/test/review-render.test.mjs` |
| `batch.json preface` | `4097 bytes of UTF-8` | reject | `result.issues[*].code REVIEW_INPUT_TOO_LARGE; no review.html write` | `packages/cli/test/review-render-command.test.mjs` |
| `--output` | `manifest-source-records-or-symlink-path` | reject | `result.issues[*].code` | `packages/cli/test/review-render-command.test.mjs` |

## Verification Notes

Run `./scripts/verification-check specs/stories/TST-022-batch-review-render`
and `./scripts/story-check --ready specs/stories/TST-022-batch-review-render`
before implementation. Start with the index vocabulary and Markdown block
model, then the Core projection, then the public CLI seam. Build fixtures
within test temporary directories. AC-008 is a direct local-file Chrome check;
it is evidence for that browser only, not a claim of pixel parity across
browsers. The previous `verification.md` described the superseded file-by-file
layout and is removed; a new one is written after implementation.
