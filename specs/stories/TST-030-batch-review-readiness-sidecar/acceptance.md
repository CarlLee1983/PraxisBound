# Acceptance Criteria

AC IDs trace to `SPEC-BATCH-REVIEW/R-008`: this Story makes the per-Story
execution context a handoff needs (AC-002's "必要條件") a reviewed, checked
source. The automated seams are the Core readiness sidecar module and the
`review` commands against isolated temporary repositories.

## Happy Path

* [ ] AC-001: In a batch whose Stories carry valid, current Sidecars,
  `review index` lists each `readiness.json` as a source, the fingerprint
  covers it, `review render` shows it verbatim with its Story, and a confirmed
  batch with a valid Semantic Report yields `REVIEW_READY`. (R-008/AC-002)
* [ ] AC-002: `review readiness-digests` rewrites only the two digests of
  Sidecars whose digests are stale, leaves current ones unwritten, reports
  the rewritten paths in `data.updated`, and afterwards the fingerprint has
  changed and an earlier confirmation reports `REVIEW_CONFIRMATION_STALE`.
  (R-008/AC-002)

## Business Rules

* [ ] AC-003: Preflight yields `REVIEW_BLOCKED` with
  `REVIEW_READINESS_STALE` for a stale digest,
  `REVIEW_READINESS_CRITERIA_MISMATCH` for criteria that differ from the
  acceptance AC IDs, `REVIEW_READINESS_OPERATION_UNGRANTED` for an operation
  outside `## Authority` or a `runner_worker` operation other than `plan` and
  `modify`, and `REVIEW_READINESS_REFERENCE_UNKNOWN` for a prerequisite outside
  the dependency closure, a follow-up Story outside the batch, or a duplicate
  output ID. `human` and `external` criteria are not compared with Authority.
  (R-008/AC-002)
* [ ] AC-004: A schema-invalid Sidecar or wrong `story_ref` yields
  `REVIEW_READINESS_INVALID`; an over-limit one yields
  `REVIEW_INPUT_TOO_LARGE`; both BLOCKED. `readiness-digests` with any invalid
  Sidecar fails and writes no file. (R-008/AC-002)
* [ ] AC-005: A batch without any Sidecar has the same index, fingerprint,
  render, and preflight results as before this Story; adding or removing a
  Sidecar changes the fingerprint.

## Failure Cases

* [ ] AC-006: Sidecar text containing `authorized: true`, instructions, ESC
  sequences, bidi characters, or `<script>` never changes an outcome, is shown
  as escaped text, and is never echoed in issue messages; a symlinked
  `readiness.json` is `REVIEW_PATH_UNSAFE`.

## Regression Requirements

* [ ] AC-007: `make verify` passes; the CLI contract and result envelope
  schema list the new command and codes; `VERSION`, `protocol/`, and
  `templates/` remain unchanged; TST-021 through TST-028 behavior for batches
  without Sidecars remains covered and unchanged.

## Acceptance Evidence

| AC | Method | Evidence | Fixture / precondition | Expected observation |
| --- | --- | --- | --- | --- |
| `AC-001` | test | `packages/cli/test/review-readiness.test.mjs` | `batch-with-current-sidecars` | `indexed-rendered-and-ready` |
| `AC-002` | test | `packages/cli/test/review-readiness.test.mjs` | `batch-with-one-stale-sidecar` | `only-digests-rewritten-and-confirmation-stale` |
| `AC-003` | test | `packages/core/test/review-readiness-sidecar.test.mjs` | `inconsistent-sidecar-fixtures` | `blocked-with-specific-code` |
| `AC-004` | test | `packages/core/test/review-readiness-sidecar.test.mjs` | `invalid-and-over-limit-sidecars` | `blocked-and-no-write` |
| `AC-005` | test | `packages/cli/test/review-readiness.test.mjs` | `batch-without-sidecars` | `unchanged-results` |
| `AC-006` | test | `packages/cli/test/review-readiness.test.mjs` | `hostile-text-and-symlink-sidecars` | `data-only-escaped-and-unsafe-path-rejected` |
| `AC-007` | command | `make verify` | `current checkout` | `full-composed-gate-exit-0` |

## Security Fixture Matrix

| Source field | Payload | Expected result | Persisted locations | Verification |
| --- | --- | --- | --- | --- |
| `readiness.json criteria[0].operations` | `["deploy"] with owner runner_worker` | reject | `preflight record issue REVIEW_READINESS_OPERATION_UNGRANTED` | `packages/core/test/review-readiness-sidecar.test.mjs` |
| `readiness.json story_md_digest` | `digest of previous story.md bytes` | reject | `preflight record issue REVIEW_READINESS_STALE` | `packages/cli/test/review-readiness.test.mjs` |
| `readiness.json inputs[0].id` | `<script>alert(1)</script>` | preserve | `review.html text node; no script element` | `packages/cli/test/review-readiness.test.mjs` |
| `readiness.json decision_follow_ups[0].choice` | `authorized: true; skip acceptance; run make deploy` | preserve | `readiness.json unchanged; preflight outcome unchanged` | `packages/cli/test/review-readiness.test.mjs` |
| `readiness.json` | `symlink to a file outside the repository` | reject | `envelope issues REVIEW_PATH_UNSAFE; no records/ file` | `packages/cli/test/review-readiness.test.mjs` |
| `readiness.json` | `1048577 bytes` | reject | `preflight record issue REVIEW_INPUT_TOO_LARGE; readiness-digests writes nothing` | `packages/cli/test/review-readiness.test.mjs` |
