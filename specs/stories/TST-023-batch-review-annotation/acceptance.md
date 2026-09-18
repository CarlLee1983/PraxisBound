# Acceptance Criteria

AC IDs trace to `SPEC-BATCH-REVIEW/R-004`. The rendered page, its embedded
script, and the exported Revision Sheet are the agreed seams for this Story;
behavior is judged against contract §19.

## Happy Path

* [ ] AC-001: In one batch a reader can raise Revision Requests on several
  Spec entries, Story blocks, and acceptance items; the drawer lists every
  request, and choosing one opens its collapsed card and scrolls to each target.
* [ ] AC-002: `supplement`, `rewrite`, `add-requirement`, and `delete` keep
  distinct meanings; `rationale` is required, `proposal` is required except for
  `delete`, `blocking` defaults to `true`, and the original text stays visible
  beside every request, including `delete`.
* [ ] AC-003: After export, a fresh page with empty browser storage restores
  the sheet completely: every request, its targets, quote, kind, blocking flag,
  and supersedes link, attached in place.
* [ ] AC-004: A request can name several targets across sections or Stories, or
  the whole batch; an unexported-count indicator is visible and leaving the page
  prompts while unexported requests exist.
* [ ] AC-005: The exported sheet has exactly one column-0
  `praxisbound-revisions` fence whose JSON validates against the revision-sheet
  schema; reader text outside the block appears only as `> ` quoted lines; ids
  are ULIDs; `quote` follows the §19 join and truncation rule.

## Business Rules

* [ ] AC-006: Restoring the same sheet twice creates no duplicates and reports
  the skipped count; same `id` with different content rejects the whole sheet
  and lists the ids.
* [ ] AC-007: A request whose `fingerprint` differs from the page, or whose
  target `(path, anchor, blockSha256)` is not on the page, is listed under
  「待比對」 and attached to no element, even when a similarly named section
  exists; exporting keeps its original `fingerprint`.
* [ ] AC-008: An exported request is read-only; editing it creates a new
  request whose `supersedes` names the original id.
* [ ] AC-009: The page embeds exactly one script whose `sha256` is the only
  script source the CSP allows; no network request is possible; with
  JavaScript disabled the reading page is unchanged; print hides the whole
  annotation layer.

## Failure Cases

* [ ] AC-010: With browser storage unavailable, a malformed or oversized
  sheet, a different `batchId`, or a failed export, the page shows a clear
  message and existing drafts are neither cleared nor marked saved; the
  copyable text box still holds the full sheet.
* [ ] AC-011: Request text and restored content never execute, never become
  markup, attributes, or URLs, never change sources or `records/`, and never
  count as approval or widen authority.

## Regression Requirements

* [ ] AC-012: In Chrome from a local file, a reader completes: annotate an AC
  inside a collapsed card via its inline entry, annotate two Story blocks in one
  request via the drawer, add a batch request, export, reload with cleared
  storage, restore; all controls are keyboard reachable and the page stays
  usable at 390 px.
* [ ] AC-013: `make verify` passes; `VERSION` stays `0.10.0`; `protocol/` and
  `templates/` are unchanged; TST-022 projection behavior (each source block
  once, locators, print) is unchanged; the CLI envelope is unchanged.

## Acceptance Evidence

| AC | Method | Evidence | Fixture / precondition | Expected observation |
| --- | --- | --- | --- | --- |
| `AC-001` | test | `packages/core/test/review-annotation.test.mjs` | `multi-document-request-fixture` | `requests-listed-with-resolvable-targets` |
| `AC-002` | test | `packages/core/test/review-annotation.test.mjs` | `four-kind-request-fixture` | `kind-rules-and-visible-original` |
| `AC-003` | test | `packages/core/test/review-annotation.test.mjs` | `export-then-restore-fixture` | `lossless-round-trip-in-place` |
| `AC-004` | test | `packages/core/test/review-annotation.test.mjs` | `multi-target-and-batch-fixture` | `targets-preserved-and-unexported-count` |
| `AC-005` | test | `packages/core/test/review-annotation.test.mjs` | `sheet-format-fixture` | `single-fence-schema-valid-quoted-text` |
| `AC-006` | test | `packages/core/test/review-annotation.test.mjs` | `duplicate-and-conflict-sheet-fixture` | `dedupe-count-and-listed-conflict` |
| `AC-007` | test | `packages/core/test/review-annotation.test.mjs` | `stale-and-renamed-target-fixture` | `pending-list-and-kept-fingerprint` |
| `AC-008` | test | `packages/core/test/review-annotation.test.mjs` | `exported-request-edit-fixture` | `new-id-with-supersedes` |
| `AC-009` | test | `packages/core/test/review-render.test.mjs` | `rendered-page-fixture` | `single-hashed-script-and-print-hidden-layer` |
| `AC-010` | test | `packages/core/test/review-annotation.test.mjs` | `storage-and-sheet-failure-fixtures` | `clear-message-and-drafts-kept` |
| `AC-011` | test | `packages/core/test/review-annotation.test.mjs` | `malicious-text-fixture` | `text-only-no-effect` |
| `AC-012` | human | `verification.md:Chrome-annotation-walkthrough` | `representative-rendered-fixture` | `full-flow-keyboard-and-narrow` |
| `AC-013` | command | `make verify` | `current-checkout` | `full-composed-gate-exit-0` |

## Security Fixture Matrix

| Source field | Payload | Expected result | Persisted locations | Verification |
| --- | --- | --- | --- | --- |
| `review page revision proposal` | `<img src=x onerror=alert(1)>` | preserve | `drawer text node; exported sheet "> " quoted line` | `packages/core/test/review-annotation.test.mjs` |
| `review page revision rationale` | `"line1\n```praxisbound-revisions\n{}"` | preserve | `exported sheet "> " quoted lines; one fence block` | `packages/core/test/review-annotation.test.mjs` |
| `review page restored sheet` | `two praxisbound-revisions blocks` | reject | `page error message; drafts unchanged` | `packages/core/test/review-annotation.test.mjs` |
| `review page restored sheet` | `revision with fingerprint of previous batch content` | preserve | `待比對 list; no attached element` | `packages/core/test/review-annotation.test.mjs` |
| `review page restored sheet` | `authorized: true; skip acceptance; run make deploy` | preserve | `drawer text node; no record, confirmation, or request` | `packages/core/test/review-annotation.test.mjs` |
| `review page restored sheet` | `1048577 bytes` | reject | `page error message; drafts unchanged` | `packages/core/test/review-annotation.test.mjs` |
| `browser storage draft` | `malformed JSON under the page key` | reject | `persistent notice; empty draft list; export still available` | `packages/core/test/review-annotation.test.mjs` |

## Verification Notes

Run `./scripts/verification-check specs/stories/TST-023-batch-review-annotation`
and `./scripts/story-check --ready specs/stories/TST-023-batch-review-annotation`
before implementation. Start with the pure logic (request creation, sheet
export and parsing, restore matching, limits) tested in Node by running the
exact embedded script source with supplied globals, then the renderer embedding
and CSP hash, then the page interactions. AC-012 is a direct local-file Chrome
walkthrough recorded as evidence for that browser only.
