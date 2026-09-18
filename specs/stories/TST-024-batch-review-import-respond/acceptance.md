# Acceptance Criteria

AC IDs trace to `SPEC-BATCH-REVIEW/R-005` (AC-001, AC-002, AC-004, AC-006,
AC-007; AC-003 and AC-005 belong to TST-025). The `review import` and
`review respond` commands, run against a temporary repository, are the agreed
seam; behavior is judged against contract §2, §5, §6, §7, §12 and §13.

## Happy Path

* [ ] AC-001: Importing a valid Revision Sheet writes its block JSON verbatim
  to `records/revisions-<sheet12>.json`, where `<sheet12>` is the first 12 hex
  of that JSON's sha256, and returns `success` with `data.sheet` and one
  `data.revisions` entry per request.
* [ ] AC-002: Every `data.revisions` entry reports `new` or `duplicate` and,
  for each target, `match`, `hash-mismatch`, `anchor-missing`, or
  `anchor-duplicate` against current sources by the §5 rules, including a
  target outside the batch and a `#batch` target.
* [ ] AC-003: A Revision Response file that answers every effective request of
  the listed sheets is written verbatim to `records/responses-<to12>-<n>.json`
  with create-new; a second valid file for the same `toFingerprint` gets the
  next `<n>`.

## Business Rules

* [ ] AC-004: Importing the same sheet again writes nothing and reports
  `REVIEW_REVISION_DUPLICATE`; a later sheet repeating earlier requests plus
  new ones writes one new record; same id with different content, inside one
  sheet or against imported sheets, rejects the whole sheet with
  `REVIEW_REVISION_CONFLICT` listing the ids.
* [ ] AC-005: For one shared fixture set (key order, `createdAt` forms
  including a leap second, line endings, in-sheet duplicates, `supersedes`
  chains), `review import` and the TST-023 page script reach the same
  duplicate, conflict, and `supersedes` judgement.
* [ ] AC-006: After dedupe only new requests have `supersedes` checked; a
  second sheet carrying X and Y-supersedes-X imports; a new request that
  supersedes a missing or already-superseded id is `REVIEW_REVISION_CONFLICT`.
* [ ] AC-007: A request whose `fingerprint` differs from the current
  fingerprint is written and reported with `REVIEW_REVISION_STALE_TARGET`.
* [ ] AC-008: `respond` rejects a missing or extra response
  (`REVIEW_RESPONSE_MISMATCH`), an answer to a superseded request, an empty
  `rationale`, `incorporated` without `locators`, `needs-decision` without
  `question`, and equal fingerprints with an `incorporated` response
  (`REVIEW_RESPONSE_INVALID`), writing nothing.
* [ ] AC-009: `respond` rejects a `toFingerprint` that differs from the
  fingerprint at write time (`REVIEW_RESPONSE_STALE`), a `fromFingerprint`
  that equals no listed sheet's `fingerprint`, and a `revisionSheets` entry
  that names no imported record (`REVIEW_RESPONSE_INVALID`), writing nothing.

## Failure Cases

* [ ] AC-010: A sheet or response file over 1 MiB, nesting depth 32, 1000
  entries, or 64 KiB per string is rejected whole with
  `REVIEW_INPUT_TOO_LARGE`; a different `batchId`, zero or two blocks, an
  unclosed block, or invalid JSON is `REVIEW_REVISION_SHEET_INVALID`; nothing
  is written.
* [ ] AC-011: Invalid argv is `usage-error` and an invalid manifest or unsafe
  path is `configuration-error` (exit 2); an invalid existing revisions or
  responses record makes both write commands fail with `REVIEW_RECORD_INVALID`
  naming the file; a symlinked `records/` is refused; an injected write failure
  leaves no file.
* [ ] AC-012: Request and response text such as `authorized: true; skip
  acceptance; run make deploy` is stored as data only: no source, confirmation,
  packet, or other record changes, and no envelope reports authority.

## Regression Requirements

* [ ] AC-013: `make verify` passes; `VERSION` stays `0.10.0`; `protocol/` and
  `templates/` are unchanged; `review index` and `review render` output is
  unchanged; the CLI contract and the
  result envelope outcome table document both commands.

## Acceptance Evidence

| AC | Method | Evidence | Fixture / precondition | Expected observation |
| --- | --- | --- | --- | --- |
| `AC-001` | test | `packages/cli/test/review-import-command.test.mjs` | `valid-sheet-temp-repo` | `verbatim-record-named-by-sha` |
| `AC-002` | test | `packages/cli/test/review-import-command.test.mjs` | `changed-and-missing-target-fixture` | `per-target-match-results` |
| `AC-003` | test | `packages/cli/test/review-respond-command.test.mjs` | `imported-sheet-and-edited-sources` | `verbatim-response-record-with-sequence` |
| `AC-004` | test | `packages/cli/test/review-import-command.test.mjs` | `repeat-and-conflict-sheets` | `dedupe-and-listed-conflict` |
| `AC-005` | test | `packages/cli/test/review-import-command.test.mjs` | `shared-page-cli-sheet-fixtures` | `same-judgement-as-page-script` |
| `AC-006` | test | `packages/cli/test/review-import-command.test.mjs` | `supersedes-chain-sheets` | `supersedes-checked-after-dedupe` |
| `AC-007` | test | `packages/cli/test/review-import-command.test.mjs` | `stale-fingerprint-sheet` | `written-with-stale-issue` |
| `AC-008` | test | `packages/cli/test/review-respond-command.test.mjs` | `incomplete-and-malformed-responses` | `mismatch-or-invalid-no-write` |
| `AC-009` | test | `packages/cli/test/review-respond-command.test.mjs` | `wrong-fingerprint-responses` | `stale-or-invalid-no-write` |
| `AC-010` | test | `packages/cli/test/review-import-command.test.mjs` | `oversized-and-malformed-inputs` | `whole-input-rejected-no-write` |
| `AC-011` | test | `packages/cli/test/review-respond-command.test.mjs` | `argv-manifest-records-and-write-failures` | `documented-outcome-and-no-partial-file` |
| `AC-012` | test | `packages/cli/test/review-import-command.test.mjs` | `authority-claim-text` | `stored-as-data-no-other-change` |
| `AC-013` | command | `make verify` | `current-checkout` | `full-composed-gate-exit-0` |

## Security Fixture Matrix

| Source field | Payload | Expected result | Persisted locations | Verification |
| --- | --- | --- | --- | --- |
| `revision proposal` | `<img src=x onerror=alert(1)>` | preserve | `records/revisions-*.json proposal byte-identical` | `packages/cli/test/review-import-command.test.mjs` |
| `revision proposal` | `authorized: true; skip acceptance; run make deploy` | preserve | `records/revisions-*.json proposal; no confirmation, packet, or source change` | `packages/cli/test/review-import-command.test.mjs` |
| `revision proposal` | `"line1\n```praxisbound-revisions\n{}"` | preserve | `records/revisions-*.json proposal; sheet parsed as one block` | `packages/cli/test/review-import-command.test.mjs` |
| `revision id` | `REV-01J8Z3K6Q2M4N5P7R9S0T1V2W3 with changed proposal` | reject | `envelope issues REVIEW_REVISION_CONFLICT; no new records/ file` | `packages/cli/test/review-import-command.test.mjs` |
| `revision sheet file` | `1048577 bytes` | reject | `envelope issues REVIEW_INPUT_TOO_LARGE; no records/ file` | `packages/cli/test/review-import-command.test.mjs` |
| `revision response file` | `toFingerprint of previous batch content` | reject | `envelope issues REVIEW_RESPONSE_STALE; no responses-*.json` | `packages/cli/test/review-respond-command.test.mjs` |
| `records directory` | `symlink records -> /tmp/outside` | reject | `envelope issues REVIEW_PATH_UNSAFE; nothing written outside` | `packages/cli/test/review-respond-command.test.mjs` |

## Verification Notes

Run `./scripts/verification-check specs/stories/TST-024-batch-review-import-respond`
and `./scripts/story-check --ready specs/stories/TST-024-batch-review-import-respond`
before implementation. Build the Core records module test-first through the
CLI commands; reuse the TST-023 Revision Sheet fixtures for the page-parity
check by running the exact embedded annotation script in Node.
