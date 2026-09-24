# Acceptance Criteria

AC IDs trace to `SPEC-BATCH-REVIEW/R-008`: this Story is its versioned real
rehearsal. Each criterion is a recorded observation in `verification.md`
backed by files under `evidence/`; a blocked step leaves its criterion
partial, never pass.

## Happy Path

* [ ] AC-001: ForgePilot `32b7a68` is built from `git archive` into a
  temporary directory; the evidence records the commit, Go version, build
  command, and binary sha256. (R-008 test and delivery)
* [ ] AC-002: In the fixture repository, `review goal-plan` returns
  `REVIEW_READY` after the human's `review confirm`, and the §11 first
  segment runs to `awaiting-authorization`: `work list` exits 1, `goal
  create` exits 0, each Story gets a Work Item whose dependencies are the
  Work Item IDs ForgePilot returned (not Story IDs), `goal preflight` exits 0,
  and `execution plan` exits 0; `review observe` accepts the record.
  (R-008/AC-001, AC-002, AC-003)
* [ ] AC-003: After the human runs `execution authorize`, `run --dry-run`
  exits 0 and the real `run` either completes with its exit mapped per the
  §11 table or is recorded as blocked with its output; `review observe`
  accepts the second-segment record, and the report states that
  `goal-completed` is technical completion only. (R-008/AC-005, AC-006,
  AC-007)

## Business Rules

* [ ] AC-004: Re-running the first segment against the existing Goal reads
  `work list` (exit 0), gets `created: false` for every Story, creates no
  duplicate Goal or Work Item, and is accepted by `review observe`.
  (R-008/AC-004)
* [ ] AC-005: Before authorization, `run --dry-run` is refused by ForgePilot
  with a non-zero exit, recorded as `step-failed`, and no Runner starts.
  (R-008/AC-002, AC-006)

## Failure Cases

* [ ] AC-006: Changing a batch source after `review goal-plan` makes the §11
  step 2 re-check return `REVIEW_STALE` with
  `REVIEW_PACKET_FINGERPRINT_MISMATCH`; the Agent stops with
  `preflight-not-ready` before any further ForgePilot write, and `review
  observe` accepts that record. (R-008/AC-002)

## Regression Requirements

* [ ] AC-007: `verification.md` traces AC-001 through AC-006 to evidence
  files with exact commands, the PraxisBound and ForgePilot commits, and
  verbatim outputs; lists every blocked step and incompatibility with a
  follow-up; `make verify` passes; no PraxisBound production code, schema,
  contract, `VERSION`, `protocol/`, or `templates/` file changes.

## Acceptance Evidence

| AC | Method | Evidence | Fixture / precondition | Expected observation |
| --- | --- | --- | --- | --- |
| `AC-001` | manual | `specs/stories/TST-033-forgepilot-rehearsal/evidence/` | `git archive 32b7a68 in a temporary directory` | `build-recorded-with-sha256` |
| `AC-002` | manual | `specs/stories/TST-033-forgepilot-rehearsal/evidence/` | `fixture repository, human-confirmed batch` | `first-segment-awaiting-authorization-observed` |
| `AC-003` | manual | `specs/stories/TST-033-forgepilot-rehearsal/evidence/` | `human ran execution authorize` | `second-segment-observed-or-blocked` |
| `AC-004` | manual | `specs/stories/TST-033-forgepilot-rehearsal/evidence/` | `existing Goal from AC-002` | `idempotent-retry-no-duplicates` |
| `AC-005` | manual | `specs/stories/TST-033-forgepilot-rehearsal/evidence/` | `Goal planned, not authorized` | `dry-run-refused-step-failed` |
| `AC-006` | manual | `specs/stories/TST-033-forgepilot-rehearsal/evidence/` | `source edited after goal-plan` | `stale-stop-before-write` |
| `AC-007` | command | `make verify` | `current checkout` | `full-composed-gate-exit-0` |

## Security Fixture Matrix

| Source field | Payload | Expected result | Persisted locations | Verification |
| --- | --- | --- | --- | --- |
| `ForgePilot stderr` | `verbatim error text from a non-zero exit` | preserve | `records/forgepilot-*.json stderr; not parsed for control flow` | `specs/stories/TST-033-forgepilot-rehearsal/evidence/` |
| `observation file` | `record of a segment that stopped at a refused dry-run` | preserve | `records/forgepilot-*.json with stoppedBecause step-failed; no run step` | `specs/stories/TST-033-forgepilot-rehearsal/evidence/` |
| `fixture source` | `story.md edited after review goal-plan` | reject | `preflight record REVIEW_PACKET_FINGERPRINT_MISMATCH; no ForgePilot write after it` | `specs/stories/TST-033-forgepilot-rehearsal/evidence/` |
