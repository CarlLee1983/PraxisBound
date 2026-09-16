# Story: TST-018 Release-Check Legacy Removal

## Goal

Retire the superseded shell release-check implementation after its approved
deprecation period while preserving one stable, read-only release-check command
interface backed by the verified TypeScript implementation.

## Context

GitHub issue #43 follows TST-017's completed default switch. TST-017 retained
the shell implementation and an explicit `legacy` selector for a bounded
deprecation period. TST-016, TST-017, PB-003, and exact-SHA main verification
now supply the process-consumer, parity, package, offline, provenance, and
supported-platform observations required by the Legacy Removal Gate.

On 2026-09-16 Human Review declared the TST-017 deprecation/default period
complete and approved the Node runtime consequence for this maintainer-only
release tool. The documented `scripts/release-check` command remains as a thin
POSIX wrapper around the TypeScript compatibility adapter. The legacy selector,
shell implementation, and legacy-only test implementation are removed. This is
a Breaking maintainer-tooling interface change because the direct command now
requires Node and `RELEASE_CHECK_IMPLEMENTATION=legacy` no longer selects a
fallback. It does not change the adopter Protocol surface described by
`protocol/versioning.md`; Protocol `VERSION` remains `0.10.0`.

## Classification

* Security sensitive: yes
* Baseline conformance: yes
* Task mode: mixed

## Authority

* plan: yes
* modify: yes
* add_dependency: no
* migration: no
* commit: yes
* push: yes
* deploy: no

## Architecture

* Impact: high
* Decision: `ADR-003`
* Boundary: `root make release-check entrypoint`
* Boundary: `direct scripts/release-check compatibility wrapper`
* Boundary: `TypeScript CLI JSON compatibility adapter`
* Boundary: `removed legacy shell implementation`
* Contract: `make release-check completes canonical verify exactly once before one TypeScript local inspection; failed verification prevents inspection`
* Contract: `the direct wrapper and Make entrypoint reach the same validated TypeScript adapter with no legacy fallback or remote action`
* Contract: `rollback restores the complete pre-TST-018 revision rather than selecting a retained implementation`
* Owner: `root make release-check entrypoint = PraxisBound maintainers`
* Owner: `direct scripts/release-check compatibility wrapper = PraxisBound maintainers`
* Owner: `TypeScript CLI JSON compatibility adapter = PraxisBound tooling`

## Risk

* Level: high
* Reason: `public-contract`
* Signal: `error-projection`

## Error Projection

* Source failure: `retired or unknown implementation selection, missing Node runtime, invalid wrapper invocation, malformed or unsupported child result, child exit mismatch, or diagnosed local release failure`
* Public projection: `no success record; one sanitized release-check failure and a nonzero process exit; no legacy fallback or remote action`
* Detail policy: `never expose child stderr, raw Git diagnostics, hostile JSON data, or removed implementation output as release evidence`
* Evidence AC: `AC-003`

## Scope

### In Scope

* Record every Legacy Removal Gate prerequisite against fixed observed evidence,
  including Human Review of the deprecation and runtime decision.
* Preserve `make release-check` and direct `./scripts/release-check` command
  forms, six-line success output, read-only behavior, and normalized failure
  contract through the TypeScript compatibility adapter.
* Remove the implementation selector, superseded shell logic, and legacy-only
  tests and documentation.
* Convert retained release fixtures from differential shell comparison to
  TypeScript conformance without dropping observable cases.
* Document Node runtime, migration, and full-revision rollback.

### Out of Scope

* Changing TypeScript Core/CLI release evaluation, JSON or human output,
  another command, Protocol `VERSION`, package features or versions, npm
  publication, tags, releases, remote checks, dependencies, or adopter runtime
  requirements.

## Inputs

* The fixed pre-removal TST-017 parity checkpoint and current exact-SHA main
  verification.
* TST-016 packed process-consumer evidence and PB-003 package, offline,
  namespace, provenance, and public-consumer evidence.
* The caller's wrapper arguments, implementation selector environment, Node
  availability, repository state, and TypeScript JSON child result.

## Outputs

* One release-check command interface backed only by the TypeScript adapter.
* The existing six success lines or a sanitized nonzero failure without
  fallback, mutation, network access, or publication.
* Migration and rollback guidance plus a verification record tracing the full
  Legacy Removal Gate.

## Rules

* R1: `release-check: verify` remains the sole Make ordering seam. It invokes
  `./scripts/release-check` exactly once only after verification passes.
* R2: `scripts/release-check` is a thin POSIX wrapper. With no retired selector
  it invokes Node and the TypeScript compatibility adapter exactly once. A
  `legacy` or unknown selector fails closed and invokes neither implementation.
* R3: The TypeScript adapter and CLI remain unchanged. Their validated result,
  success output, exit normalization, Git consistency checks, and no-write
  contract are the release-check behavior.
* R4: The removed shell implementation is not retained under another path,
  fixture, environment value, or automatic fallback.
* R5: This is Breaking for repository maintainers who directly used the shell
  runtime or legacy selector. Migrate to Node 22.13+/24+/26+ and the unchanged
  command form. Roll back by restoring the full pre-TST-018 revision.
* R6: Node remains confined to optional maintainer release tooling. Adopting
  repositories still require only files, Make, and their existing development
  and CI systems, so ADR-003 and Protocol `0.10.0` remain valid.

## Expected Errors

* Wrapper arguments, `legacy`, or an unknown implementation selector fail with
  usage or compatibility status before Node or removed shell logic runs.
* A missing Node runtime fails without fallback, mutation, or a success record.
* Malformed, multiple, unsupported, or exit-mismatched child results and typed
  release failures retain TST-017's sanitized failure behavior.

## Dependencies

* TST-016 and TST-017 are implemented and verified on main through PR #53;
  GitHub issues #41 and #42 are closed as completed.
* PB-003 records public package acquisition, exact/latest offline consumer,
  namespace, provenance, and credential-hardening evidence.
* Human Review approved the completed deprecation period and Breaking
  maintainer-tooling runtime decision on GitHub issue #43 on 2026-09-16.

## Constraints

* Add no dependency and do not commit, push, merge, publish, tag, release,
  deploy, migrate data, or perform remote release checks.
* Keep fixtures disposable and never make this repository's own worktree,
  Stories, or handoff the release subject under test.
* Preserve every observable TypeScript release-check case; remove only evidence
  whose sole purpose was executing the deleted shell implementation.

## Guidance

Relevant:

* principle: small coherent changes
* principle: explicit dependencies
* principle: behavior-oriented testing
* principle: deep module interface

Not applicable:

* no persistent-data migration or package publication applies

## Trust Boundary Fields

* `release.wrapper-arguments` — caller-supplied direct wrapper arguments
* `release.implementation-selector` — caller environment that may request a retired implementation
* `release.node-runtime` — PATH-resolved runtime needed by optional maintainer tooling
* `release.repository-root` — physical repository root passed to the TypeScript child
* `release.child-stdout` — process-produced JSON or malformed output
* `release.child-stderr` — process-produced presentation or Git diagnostic
* `release.child-exit` — actual process completion status or signal
* `release.schema-version` — externally read envelope compatibility value
* `release.protocol-version` — externally read envelope compatibility value
* `release.status-outcome-issues` — externally read typed result category
* `release.data` — externally read version, commit, tag, and remote-check fields
* `release.removal-evidence` — externally observed CI, package, provenance, and Human Review records

## Superseded Behavior

* `scripts/release-check shell implementation` — replaced by a thin wrapper around the already-default TypeScript adapter after the approved deprecation period.
* `scripts/release-check-select legacy branch` — removed because runtime selection and automatic fallback are no longer supported.
* `tests/release-check.sh legacy acceptance suite` — replaced by fixed pre-removal evidence and retained TypeScript conformance cases at the command interface.
* `make release-check RELEASE_CHECK_IMPLEMENTATION=legacy` — replaced by full-revision rollback with no data migration.
