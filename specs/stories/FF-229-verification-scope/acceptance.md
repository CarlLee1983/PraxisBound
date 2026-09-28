# Acceptance Criteria: FF-229

## Happy Path

* [ ] AC-001: A Story without a verification-scope declaration still requires full `make verify` and retains its previous result verdict.
* [ ] AC-002: An explicitly focused executable Story declares one exact command per required risk and architecture layer, records the matching commands and results, and traces every acceptance criterion.
* [ ] AC-003: A low-risk, low-impact focused documentation-only Story declares and records one exact documentation validation command and acceptance trace, without requiring an unrelated unit check; higher-risk or higher-impact documentation cannot select focused scope.

## Business Rules

* [ ] AC-004: An explicit full Story requires an exact `make verify` PASS record, while a default full Story retains its existing verdict; a focused result cannot satisfy an unrun full obligation.
* [ ] AC-005: The portable workflow and templates state that repository integration, release, and surface policies can require full verification; Human Review must reject a conflicting focused scope because the static checker has no phase or policy input.
* [ ] AC-006: The portable workflow and templates show exact focused command declarations and results, documentation validation, and how to report an intentionally unrun full gate.

## Failure Cases

* [ ] AC-007: Missing, invalid, ambiguous, skipped, blocked, unsupported, or failed required verification is not reported as PASS; a focused result records an intentionally unrun full gate as skipped with a residual risk.

## Regression Requirements

* [ ] AC-008: `make verify` and Doctor retain their command forms and exit semantics; existing Story/result fixtures keep their verdicts.
* [ ] AC-009: This repository's full `make verify` passes after the protocol and template changes, and versioning records an Additive opt-in with no adopter migration.

## Acceptance Evidence

| AC | Method | Evidence | Fixture / precondition | Expected observation |
| --- | --- | --- | --- | --- |
| `AC-001` | test | `tests/execution-governance.sh` | `legacy Story and result fixtures` | `full gate obligation and prior verdict unchanged` |
| `AC-002` | test | `tests/execution-governance.sh` | `focused executable Story at high risk with architecture impact` | `exact commands, all required layers, and AC evidence checked` |
| `AC-003` | test | `tests/execution-governance.sh` | `low-risk focused documentation Story and high-risk rejection fixture` | `documentation check required; ineligible focused scope rejected` |
| `AC-004` | test | `tests/execution-governance.sh` | `explicit and default full Story fixtures` | `focused record cannot satisfy full obligation` |
| `AC-005` | human | `Human Review record` | `integration, release, or repository surface policy applies` | `focused scope is rejected when policy requires full` |
| `AC-006` | test | `tests/review-integrity.sh` | `portable protocol and template text` | `scope and honest reporting rules are present` |
| `AC-007` | test | `tests/execution-governance.sh` | `invalid and incomplete focused result fixtures` | `PARTIAL, FAIL, or INCOMPLETE with residual risk` |
| `AC-008` | test | `tests/doctor.sh` | `existing Doctor and Story fixtures` | `command forms and existing verdicts unchanged` |
| `AC-009` | command | `make verify` | `PraxisBound checkout after this change` | `full repository gate exits 0` |

## Verification Notes

Use `make verify-execution` and `make verify-protocol` while implementing; run
root `make verify` before review. The current repository full-gate policy
applies to this Story's versioned protocol and template changes.
