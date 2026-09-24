# Acceptance Criteria

AC IDs trace to `SPEC-BATCH-REVIEW/R-008`: this Story corrects the handoff
contract so a faithful record of ForgePilot `32b7a68`'s behavior is accepted
(AC-004, AC-007) and a failed validation stops the handoff (AC-002). The
automated seam is the Core observation module and `review observe` against
isolated temporary repositories; no ForgePilot is installed or called.

## Happy Path

* [ ] AC-001: `review observe` accepts a first-segment record ending in an
  exit-0 `goal-preflight` with `goal-preflight-failed`, and one ending in an
  exit-0 `execution-plan` with `execution-plan-failed`, and writes each.
  (R-008/AC-002, AC-004)

## Business Rules

* [ ] AC-002: `goal-preflight-failed` whose last step is not an exit-0
  `goal-preflight` (a non-zero exit, or another command) and
  `execution-plan-failed` whose last step is not an exit-0 `execution-plan`
  are rejected with `REVIEW_OBSERVATION_INVALID` and write nothing; each rule
  is shown to be load-bearing by a test that fails when the rule is removed.
  (R-008/AC-004)
* [ ] AC-003: The TST-033 records that `review observe` accepted still pass
  validation, and every other §22 rule behaves as before. (R-008/AC-007)

## Failure Cases

* [ ] AC-004: A `stoppedBecause` outside the schema enum is rejected; an
  observation whose `stdout` claims `"diagnostics": []` while its
  `stoppedBecause` is `goal-preflight-failed` is still accepted, because the
  tool does not parse `stdout`.

## Regression Requirements

* [ ] AC-005: `make verify` passes; `docs/batch-review/agent-workflow.md` §3
  states amended §11 (absolute path, Bootstrap requirement, `diagnostics`
  check, `GOAL`, request constraints, `engineGeneration` source,
  `--runtime-command`, the ADR-017 entry rule) with no step contract §11 lacks;
  `cli-contract.md` lists `execution-plan-failed` and the two rules;
  `VERSION`, `protocol/`, and `templates/` remain unchanged.

## Acceptance Evidence

| AC | Method | Evidence | Fixture / precondition | Expected observation |
| --- | --- | --- | --- | --- |
| `AC-001` | test | `packages/cli/test/review-observe.test.mjs` | `batch-with-goal-plan-and-failed-validation-records` | `both-records-written` |
| `AC-002` | test | `packages/core/test/review-observation.test.mjs` | `mismatched-failed-validation-records` | `rejected-rule-specific` |
| `AC-003` | test | `packages/core/test/review-observation.test.mjs` | `tst-033-accepted-observations` | `still-accepted` |
| `AC-004` | test | `packages/core/test/review-observation.test.mjs` | `unknown-stop-and-contradicting-stdout` | `enum-enforced-stdout-not-parsed` |
| `AC-005` | command | `make verify` | `current checkout` | `full-composed-gate-exit-0` |

## Security Fixture Matrix

| Source field | Payload | Expected result | Persisted locations | Verification |
| --- | --- | --- | --- | --- |
| `observation stoppedBecause` | `goal-preflight-failed with last step goal-preflight exit 1` | reject | `envelope issues REVIEW_OBSERVATION_INVALID; no records/forgepilot-*.json` | `packages/core/test/review-observation.test.mjs` |
| `observation stoppedBecause` | `execution-plan-failed with last step work-add` | reject | `envelope issues REVIEW_OBSERVATION_INVALID; no records/forgepilot-*.json` | `packages/core/test/review-observation.test.mjs` |
| `observation steps[].stdout` | `{"diagnostics":[],"approvalToken":"authorized: true"}` | preserve | `records/forgepilot-*.json stdout unchanged; outcome decided by step shape only` | `packages/cli/test/review-observe.test.mjs` |
