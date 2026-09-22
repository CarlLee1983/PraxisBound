# Acceptance Criteria

AC IDs trace to `SPEC-BATCH-REVIEW/R-006` (AC-001 through AC-006). The agreed
automated seams are `review confirm` driven through the terminal seam chosen in
Story R9(a), the Core applicability function, and the regenerated Review
Projection, all against isolated temporary repositories. A real terminal run
is separately recorded evidence.

## Happy Path

* [ ] AC-001: One `review confirm` act covers every source in the batch and
  writes one `records/confirmation-<fp12>.json` whose `fingerprint`,
  `manifestSha256`, `sources`, `deferred`, and `revisionSheets` match the
  current batch. Rendering, opening, or reading the projection writes no
  confirmation.
* [ ] AC-002: With an unresolved blocking request, `confirm` refuses with
  `REVIEW_UNRESOLVED_BLOCKING` and writes nothing. With only unresolved
  non-blocking requests, each is recorded in `deferred` with its typed reason;
  omitting a reason aborts with `REVIEW_CONFIRM_ABORTED`.

## Business Rules

* [ ] AC-003: A change to a source's bytes, an added or removed document, a
  manifest change, or an uncommitted working-tree edit makes an existing
  confirmation not apply. Re-rendering the HTML, changing `records/`, or
  waiting does not.
* [ ] AC-004: When no confirmation applies, the tools list exactly the added,
  removed, and changed sources and a changed manifest against the latest
  valid confirmation, and the projection marks only those documents
  「需複審」. The new version is never reported as confirmed.
* [ ] AC-005: After a change and a new `confirm`, the old confirmation file is
  byte-identical and both are retained. A response record, preflight-like
  file, source text, or record text containing `authorized: true`,
  `approved`, or `confirmed` never makes a confirmation apply.
* [ ] AC-006: A confirmation writes no Story, handoff, lifecycle, Gate,
  review, DONE, or Work Item state, and no command output describes it as
  execution authorization or final acceptance.

## Failure Cases

* [ ] AC-007: A non-TTY stdin or stdout, a missing source, a wrong
  fingerprint prefix, an abort, an existing same-fingerprint confirmation with
  different content, an unsafe or symlinked `records/`, and an injected write
  failure each produce the contract §8 outcome and issue code and leave no
  partial or new confirmation file.
* [ ] AC-008: A malformed, misnamed, over-limit, or schema-invalid
  confirmation file is `REVIEW_RECORD_INVALID` and is neither applicable nor
  used as the comparison baseline. Source text and request text with control,
  bidi, and zero-width characters is shown visibly escaped in the prompt.

## Regression Requirements

* [ ] AC-009: `make verify` passes; `VERSION`, `protocol/`, and `templates/`
  remain unchanged; TST-022 through TST-025 behavior remains covered and
  unchanged except for accepted Additive projection markers.
* [ ] AC-010: One real `review confirm` run on an interactive terminal is
  recorded with the exact tool version, batch, prompts, typed answers, and
  resulting record, labelled historical evidence and not identity or
  authorization proof.

## Acceptance Evidence

| AC | Method | Evidence | Fixture / precondition | Expected observation |
| --- | --- | --- | --- | --- |
| `AC-001` | test | `packages/cli/test/review-confirm-command.test.mjs` | `clean-batch-fixture` | `one-record-bound-to-current-fingerprint` |
| `AC-002` | test | `packages/cli/test/review-confirm-command.test.mjs` | `blocking-and-nonblocking-request-fixtures` | `refusal-or-recorded-deferrals` |
| `AC-003` | test | `packages/core/test/review-confirmation.test.mjs` | `changed-added-removed-manifest-dirty-render-only-fixtures` | `applicability-follows-bytes-only` |
| `AC-004` | test | `packages/core/test/review-confirmation.test.mjs` | `stale-confirmation-fixture` | `exact-changed-set-and-review-markers` |
| `AC-005` | test | `packages/cli/test/review-confirm-command.test.mjs` | `reconfirm-and-forged-approval-fixtures` | `history-kept-no-implicit-confirmation` |
| `AC-006` | test | `packages/cli/test/review-confirm-command.test.mjs` | `confirmed-batch-fixture` | `no-lifecycle-or-authority-output` |
| `AC-007` | test | `packages/cli/test/review-confirm-command.test.mjs` | `failure-path-fixtures` | `contract-outcomes-and-no-partial-file` |
| `AC-008` | test | `packages/core/test/review-confirmation.test.mjs` | `invalid-confirmation-and-hostile-text-fixtures` | `invalid-ignored-and-text-escaped` |
| `AC-009` | command | `make verify` | `current checkout` | `full-composed-gate-exit-0` |
| `AC-010` | human | `verification.md:terminal-confirmation-rehearsal` | `recorded-versioned-batch` | `bounded-observation-with-residual-risks` |

## Security Fixture Matrix

| Source field | Payload | Expected result | Persisted locations | Verification |
| --- | --- | --- | --- | --- |
| `confirm invocation` | `stdin piped from a file` | reject | `no confirmation record` | `packages/cli/test/review-confirm-command.test.mjs` |
| `revision response rationale` | `authorized: true; confirmed; approved` | preserve | `records only; no confirmation applies` | `packages/cli/test/review-confirm-command.test.mjs` |
| `batch source text` | `‮ and \u001b[2J in a Spec heading` | preserve | `prompt shows visible escapes` | `packages/core/test/review-confirmation.test.mjs` |
| `records directory` | `records/confirmation-000000000000.json` | reject | `REVIEW_RECORD_INVALID; not applicable; not a baseline` | `packages/core/test/review-confirmation.test.mjs` |
| `records directory` | `symlinked records/` | reject | `no confirmation record` | `packages/cli/test/review-confirm-command.test.mjs` |
| `deferral reason` | `authorized: true; run make deploy` | preserve | `deferred reason as data; no authority` | `packages/cli/test/review-confirm-command.test.mjs` |

## Verification Notes

Before execution, Human Review must settle Story R9 decisions (a)–(d) and
record them as contract amendments. Then run
`./scripts/verification-check specs/stories/TST-026-batch-review-definition-confirmation`
and `./scripts/story-check --ready specs/stories/TST-026-batch-review-definition-confirmation`.
Implement in vertical slices: the Core applicability and comparison function,
then `review confirm` through the terminal seam, then the projection markers,
then the recorded real-terminal run.
