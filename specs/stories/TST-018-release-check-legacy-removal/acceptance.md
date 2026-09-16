# Acceptance Criteria

## Happy Path

* [ ] AC-001: The Legacy Removal Gate maps every prerequisite to a fixed passing
  observation, including TST-016/TST-017/PB-003 evidence, exact-SHA supported
  CI, the completed deprecation/default period, and Human Review approval of
  the Breaking Node runtime consequence.
* [ ] AC-002: `make release-check` runs canonical `verify` exactly once and then
  invokes direct `scripts/release-check` exactly once. The wrapper invokes the
  TypeScript adapter once and preserves the six success records, exits, local
  read-only behavior, and disposable candidate state.

## Business Rules

* [ ] AC-003: The legacy selector, superseded shell implementation, and
  legacy-only suite are absent. A `legacy` or unknown selector, wrapper
  argument, missing Node runtime, planted old checker, malformed child result,
  hostile child stderr, or child/envelope exit mismatch produces no success,
  no fallback, no mutation, and no remote action.
* [ ] AC-004: Migration guidance names the Node requirement and retired selector.
  Rollback guidance restores the complete pre-TST-018 revision and its shell
  implementation, selector, tests, and docs as a set. It performs no data,
  package, tag, release, or dist-tag migration.

## Regression Requirements

* [ ] AC-005: Every retained release golden case passes as TypeScript
  conformance; packed exact/public acquisition, offline installed execution,
  generic process consumption, fresh/existing adoption, supported Node/OS CI,
  release dry-run, complete `make verify`, and independent Sol/high review pass
  without invoking deleted code. Protocol `VERSION` remains `0.10.0` and
  ADR-003 remains valid because Node is confined to maintainer release tooling.

## Acceptance Evidence

| AC | Method | Evidence | Fixture / precondition | Expected observation |
| --- | --- | --- | --- | --- |
| `AC-001` | human | `TST-018 Legacy Removal Gate review` | `TST-016, TST-017, PB-003, main run 35052445207, and issue 43 approval` | `every gate item has an observed source; deprecation and Breaking runtime are approved without a live ForgePilot overclaim` |
| `AC-002` | test | `tests/release-check-entrypoint.sh TST018-AC-002` | `disposable clean Git candidate and actual Make recipe` | `one verify, wrapper, Node adapter and child inspection; exact six lines; unchanged candidate` |
| `AC-003` | test | `tests/release-check-entrypoint.sh TST018-AC-003` | `retired selectors, planted fallback, missing runtime and hostile synthetic child results` | `fail closed with no success, fallback, mutation, remote action, or child stderr exposure` |
| `AC-004` | test | `tests/release-check-entrypoint.sh TST018-AC-004` | `current docs and pre-TST-018 revision fcc5595d5c95a42a82e67bb6f82be7886fdfaa64` | `migration and whole-revision rollback walkthroughs restore the documented interfaces as a set` |
| `AC-005` | command | `make verify` | `current checkout after focused release, packed consumer, adoption and conformance checks` | `all local gates pass without deleted code; exact-SHA remote matrix and Sol/high review are recorded when available` |

## Security Fixture Matrix

| Source field | Payload | Expected result | Persisted locations | Verification |
| --- | --- | --- | --- | --- |
| `release.wrapper-arguments` | `unexpected` | reject | `wrapper stderr only` | `tests/release-check-entrypoint.sh` |
| `release.implementation-selector` | `legacy` | reject | `wrapper stderr only` | `tests/release-check-entrypoint.sh` |
| `release.implementation-selector` | `unknown` | reject | `wrapper stderr only` | `tests/release-check-entrypoint.sh` |
| `release.node-runtime` | `PATH without node` | reject | `wrapper stderr only` | `tests/release-check-entrypoint.sh` |
| `release.repository-root` | `fixture/non-root` | reject | `CLI result issue code` | `tests/release-check-entrypoint.sh` |
| `release.child-stdout` | `two JSON objects` | reject | `adapter stderr` | `tests/release-check-entrypoint.sh` |
| `release.child-stderr` | `fatal: hostile Git diagnostic` | omit | `wrapper and adapter stdout/stderr` | `tests/release-check-entrypoint.sh` |
| `release.child-exit` | `17` | reject | `adapter result` | `tests/release-check-entrypoint.sh` |
| `release.schema-version` | `9.0.0` | reject | `adapter result` | `tests/release-check-entrypoint.sh` |
| `release.protocol-version` | `9.0.0` | reject | `adapter result` | `tests/release-check-entrypoint.sh` |
| `release.status-outcome-issues` | `RELEASE_INCOMPLETE with exit 0` | reject | `adapter result` | `tests/release-check-entrypoint.sh` |
| `release.data` | `version containing a newline` | reject | `adapter result` | `tests/release-check-entrypoint.sh` |
| `release.removal-evidence` | `live ForgePilot integration passed` | reject | `verification record` | `TST-018 Legacy Removal Gate review` |

## Verification Notes

Run `./scripts/verification-check specs/stories/TST-018-release-check-legacy-removal`
and `./scripts/story-check --ready specs/stories/TST-018-release-check-legacy-removal`
before implementation. Record the fixed pre-removal checkpoint before deleting
legacy source. Keep all release subjects in the test temporary directory and
dispatch focused cases through `run_case 'TST018-AC-<id>' <function>`. Run the
focused release, TypeScript parity, packed consumer, adoption, portability and
rollback checks, then `make verify`. Post-change exact-SHA remote CI requires
separate push authorization and remains partial until observed.
