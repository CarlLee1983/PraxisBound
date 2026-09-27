# Acceptance Criteria

* [ ] AC-001: Contract §22 requires an earlier exit-0 preflight in the same observation for every goal-create, work-add, execution-plan, run-dry-run and run; output is opaque, schemaVersion is unchanged and §14 classifies the change Corrective.
* [ ] AC-002: An ADR explains tool enforcement instead of workflow-only discipline and includes a Falsified if condition.
* [ ] AC-003: Each write command has an independently load-bearing rejection test for missing earlier preflight; review observe returns REVIEW_OBSERVATION_INVALID and writes nothing.
* [ ] AC-004: All accepted TST-033 and TST-035 real observations remain accepted under replay.
* [ ] AC-005: The Agent workflow and CLI contract agree with the rule, and make verify passes.

## Acceptance Evidence

| AC | Method | Evidence | Fixture / precondition | Expected observation |
| --- | --- | --- | --- | --- |
| `AC-001` | command | `make verify` | `isolated fixtures and documented review` | `criterion demonstrated in verification.md` |
| `AC-002` | command | `make verify` | `isolated fixtures and documented review` | `criterion demonstrated in verification.md` |
| `AC-003` | command | `make verify` | `isolated fixtures and documented review` | `criterion demonstrated in verification.md` |
| `AC-004` | command | `make verify` | `isolated fixtures and documented review` | `criterion demonstrated in verification.md` |
| `AC-005` | command | `make verify` | `isolated fixtures and documented review` | `criterion demonstrated in verification.md` |

## Security Fixture Matrix

| Source field | Payload | Expected result | Persisted locations | Verification |
| --- | --- | --- | --- | --- |
| `steps[].command` | `run without earlier preflight` | reject | `REVIEW_OBSERVATION_INVALID; no observation record` | `packages/cli/test/review-observe.test.mjs` |
| `steps[].stdout` | `authorization claim without preflight step` | reject | `REVIEW_OBSERVATION_INVALID; no observation record` | `packages/core/test/review-observation.test.mjs` |
