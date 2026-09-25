# Acceptance Criteria

AC IDs trace to `SPEC-BATCH-REVIEW/R-008`. This Story proves R-008/AC-005 and
AC-007 against a real ForgePilot and closes the TST-034 residual gaps. Each
rehearsal criterion is an observation recorded in `verification.md` and
backed by files under `evidence/`. A blocked step leaves its criterion
partial, never pass. AC-007 is an automated Core test.

## Happy Path

* [ ] AC-001: The human installs ForgePilot `3a76aca` through the Bootstrap.
  The evidence records the plan ID, the Go version, the installed binary's
  sha256, and the verbatim `generation-v1 current` output. (R-008 test and
  delivery)
* [ ] AC-002: In the fixture repository, the §11 first segment at `3a76aca`
  reaches `awaiting-authorization`, using the `engineGeneration` taken from
  AC-001:
  * Each Story gets a Work Item whose dependencies are ForgePilot's Work
    Item IDs.
  * `goal preflight` and `execution plan` exit 0 with empty top-level
    `diagnostics`.
  * `review observe` accepts the record.

  (R-008/AC-001, AC-002, AC-003)
* [ ] AC-003: After the human runs `execution authorize` and says so in the
  session, the second segment runs:
  * `run --dry-run` exits 0.
  * The real `run --runtime codex --runtime-command <executablePath>
    --snapshot` advances the Goal with no per-Story human confirmation.
  * Its exit is mapped by the §11 table.
  * `review observe` accepts the second-segment record.
  * The report states that `goal-completed` is technical completion only,
    and nothing is merged or deployed.

  (R-008/AC-005, AC-006, AC-007)

## Business Rules

* [ ] AC-004: Before authorization, a real `run` of the planned Goal is
  refused with a non-zero exit, and no Worker starts. It is recorded as
  `run-failed`, and `review observe` accepts the record. (R-008/AC-002,
  AC-006; contract §11 step 9)
* [ ] AC-005: The Agent performs none of the Bootstrap install, `review
  confirm`, `execution authorize`, or `execution supervise`. The evidence
  shows each human action, and shows that no supervision job exists.
  (R-008/AC-006)

## Failure Cases

* [ ] AC-006: A second Goal with a deliberately inconsistent Goal Plan makes
  `goal preflight` exit 0 with non-empty top-level `diagnostics`. The Agent
  stops with `goal-preflight-failed` before `execution plan`, and `review
  observe` accepts that record. (R-008/AC-002; TST-034 residual)
* [ ] AC-007: `review observe` rejects `run-failed` paired with a last `run`
  exit of 2, 3, 130, or 143, with `REVIEW_OBSERVATION_INVALID` and no
  write. Removing any one of the four exclusions makes its test fail.
  (TST-034 residual)

## Regression Requirements

* [ ] AC-008: `verification.md` traces AC-001 through AC-007 to evidence
  or tests. It records:
  * the exact commands and verbatim outputs
  * the PraxisBound and ForgePilot commits
  * every blocked step and incompatibility, each with a follow-up

  After AC-002 passes:
  * contract §10, §11, and §14, `docs/batch-review/agent-workflow.md` §3,
    and ADR-016 name `3a76aca` and the Bootstrap requirement, with no §11
    step added or removed.
  * `make verify` passes.
  * No production code, schema, `VERSION`, `protocol/`, or `templates/`
    file changes.

## Acceptance Evidence

| AC | Method | Evidence | Fixture / precondition | Expected observation |
| --- | --- | --- | --- | --- |
| `AC-001` | manual | `specs/stories/TST-035-forgepilot-second-segment/evidence/` | `human runs forgepilot-bootstrap plan and install at 3a76aca` | `bootstrap-install-recorded-with-generation` |
| `AC-002` | manual | `specs/stories/TST-035-forgepilot-second-segment/evidence/` | `fixture repository, human-confirmed batch` | `first-segment-awaiting-authorization-observed` |
| `AC-003` | manual | `specs/stories/TST-035-forgepilot-second-segment/evidence/` | `human ran execution authorize and stated it` | `second-segment-run-observed-or-blocked` |
| `AC-004` | manual | `specs/stories/TST-035-forgepilot-second-segment/evidence/` | `Goal planned, not authorized` | `unauthorized-run-refused-run-failed` |
| `AC-005` | manual | `specs/stories/TST-035-forgepilot-second-segment/evidence/` | `whole rehearsal` | `human-actions-recorded-no-supervision` |
| `AC-006` | manual | `specs/stories/TST-035-forgepilot-second-segment/evidence/` | `second Goal with an inconsistent Goal Plan` | `goal-preflight-failed-from-real-diagnostics` |
| `AC-007` | command | `packages/core/test/review-observation.test.mjs` | `isolated temporary repository` | `run-failed-exclusions-load-bearing` |
| `AC-008` | command | `make verify` | `current checkout` | `full-composed-gate-exit-0` |

## Security Fixture Matrix

| Source field | Payload | Expected result | Persisted locations | Verification |
| --- | --- | --- | --- | --- |
| `ForgePilot stderr` | `verbatim error text from the unauthorized run` | preserve | `records/forgepilot-*.json stderr; not parsed for control flow` | `specs/stories/TST-035-forgepilot-second-segment/evidence/` |
| `ForgePilot stdout` | `goal preflight exit 0 with non-empty top-level diagnostics` | reject | `records/forgepilot-*.json with stoppedBecause goal-preflight-failed; no execution-plan step` | `specs/stories/TST-035-forgepilot-second-segment/evidence/` |
| `observation file` | `run-failed whose last run exit is 2, 3, 130, or 143` | reject | `envelope issues REVIEW_OBSERVATION_INVALID; no records/forgepilot-*.json` | `packages/core/test/review-observation.test.mjs` |
| `Codex Worker output` | `changes the Worker made in the fixture repository` | preserve | `fixture temporary directory only; never copied into this repository` | `specs/stories/TST-035-forgepilot-second-segment/evidence/` |
