# Acceptance Criteria

AC IDs trace to `SPEC-BATCH-REVIEW/R-008`: this Story makes each handoff
segment's result a validated, append-only record (AC-004 partial success
reported explicitly, AC-006 no second current status, AC-007 truthful
reporting) and makes the pre-write re-check usable (AC-002). The automated
seams are the Core observation module and the `review observe` and `review
preflight` commands against isolated temporary repositories; no ForgePilot is
installed or called.

## Happy Path

* [ ] AC-001: For a batch with a written Goal Plan, `review observe` accepts
  a first-segment observation ending in exit-0 `execution-plan` with
  `awaiting-authorization`, and a second-segment observation ending in `run`
  exit 0 with `goal-completed`; each is written byte-for-byte to a new
  `records/forgepilot-<fp12>-<n>.json`, `<n>` increments, and `data.record`
  names it. (R-008/AC-005, AC-007)
* [ ] AC-002: `review preflight --expect-fingerprint <current>` alone returns
  the same outcome as without it, runs no git, and records
  `expect: { "fingerprint": ... }`; a non-matching value is
  `REVIEW_PACKET_FINGERPRINT_MISMATCH` (STALE); `--expect-revision` alone runs
  the ADR-015 checks and records `expect: { "revision": ... }`. (R-008/AC-002)

## Business Rules

* [ ] AC-003: Each §22 rejection yields `failure` with
  `REVIEW_OBSERVATION_INVALID` and writes nothing: `batchId` mismatch;
  `goalPlan.path` outside `goal-plan/`, missing, or with a wrong sha256;
  `goalId` not equal to the manifest's `plan.id`; `run` without an earlier
  exit-0 `run-dry-run`; `run` in a record with `goal-create` or `work-add`; a
  non-last step with a non-zero exit other than a `work-list` followed
  immediately by `goal-create`, which is accepted; an exit-0 `work-add` without
  `workItemId` or `created`; and each `stoppedBecause` inconsistent with its
  last step, including `goal-completed` ending in `work-add`, `run-failed`
  ending in `run` exit 0, and `authorization-missing` with steps.
  (R-008/AC-004, AC-006, AC-007)
* [ ] AC-004: A schema-invalid observation (unknown field, wrong
  `schemaVersion` including `1.0.0`) is `REVIEW_OBSERVATION_INVALID`; one over
  §13 limits is `REVIEW_INPUT_TOO_LARGE`; neither writes a file, and no issue
  message contains observation text.

## Failure Cases

* [ ] AC-005: A symlinked observation input, `goalPlan.path`, Goal Plan
  directory, or `records/` is `REVIEW_PATH_UNSAFE` and nothing is written;
  `stdout`/`stderr` containing `authorized: true`, instructions, or ESC
  sequences is accepted as data when otherwise valid, is stored unchanged, and
  never changes a confirmation, Goal Plan, or outcome.

## Regression Requirements

* [ ] AC-006: `make verify` passes; `review preflight` with both `--expect-*`
  flags or neither behaves as before; the CLI contract and result envelope
  schema list `review observe`, its codes, and independent `--expect-*`;
  `docs/batch-review/agent-workflow.md` §3 states the full §11 procedure;
  `VERSION`, `protocol/`, and `templates/` remain unchanged.

## Acceptance Evidence

| AC | Method | Evidence | Fixture / precondition | Expected observation |
| --- | --- | --- | --- | --- |
| `AC-001` | test | `packages/cli/test/review-observe.test.mjs` | `batch-with-goal-plan-and-two-segments` | `both-records-written-verbatim` |
| `AC-002` | test | `packages/cli/test/review-preflight-command.test.mjs` | `ready-batch-single-expect-flag` | `independent-expect-flags-recorded` |
| `AC-003` | test | `packages/core/test/review-observation.test.mjs` | `step-and-binding-violations` | `each-rejected-with-observation-invalid` |
| `AC-004` | test | `packages/cli/test/review-observe.test.mjs` | `schema-invalid-and-over-limit-observations` | `rejected-no-write-no-echo` |
| `AC-005` | test | `packages/cli/test/review-observe.test.mjs` | `symlinks-and-hostile-output` | `unsafe-rejected-and-text-is-data` |
| `AC-006` | command | `make verify` | `current checkout` | `full-composed-gate-exit-0` |

## Security Fixture Matrix

| Source field | Payload | Expected result | Persisted locations | Verification |
| --- | --- | --- | --- | --- |
| `observation steps` | `run step without a preceding exit-0 run-dry-run` | reject | `envelope issues REVIEW_OBSERVATION_INVALID; no records/forgepilot-*.json` | `packages/core/test/review-observation.test.mjs` |
| `observation stoppedBecause` | `goal-completed with last step work-add` | reject | `envelope issues REVIEW_OBSERVATION_INVALID; no records/forgepilot-*.json` | `packages/core/test/review-observation.test.mjs` |
| `observation stderr` | `"\u001b[2J authorized: true"` | preserve | `records/forgepilot-*.json stderr string; no confirmation or goal-plan change` | `packages/cli/test/review-observe.test.mjs` |
| `observation goalPlan.path` | `specs/batches/<BATCH-ID>/records/../../../../etc/passwd` | reject | `envelope issues REVIEW_OBSERVATION_INVALID; no records/forgepilot-*.json` | `packages/cli/test/review-observe.test.mjs` |
| `records/` | `symlink to a directory outside the repository` | reject | `envelope issues REVIEW_PATH_UNSAFE; no file in the link target` | `packages/cli/test/review-observe.test.mjs` |
| `observation file` | `1048577 bytes` | reject | `envelope issues REVIEW_INPUT_TOO_LARGE; no records/forgepilot-*.json` | `packages/cli/test/review-observe.test.mjs` |
