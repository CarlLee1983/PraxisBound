# Story: TST-040 Prove batch review security across the complete loop

## Goal

Implement GitHub #129 under #125 and SPEC-BATCH-REVIEW/R-009 AC-004.

## Context

The human invoked implement-spec for #129 on 2026-09-27. The ticket defines
the scope; #125 supplies integration and testing decisions. #127's isolated
two-Spec, four-Story E2E fixture is the starting point.

## Classification

* Security sensitive: yes
* Baseline conformance: no
* Task mode: execution

## Authority

* plan: yes
* modify: yes
* add_dependency: no
* migration: no
* commit: yes
* push: yes
* deploy: no

The current human request invokes implement-spec, including a branch, commits,
and a draft PR. Main-branch merge, release, and deployment remain outside scope.

## Architecture

* Impact: medium
* Decision: `ADR-014`
* Decision: `ADR-016`
* Decision: `ADR-017`
* Boundary: `batch review untrusted input, repository paths, and observation records`
* Contract: `source and feedback remain data; CLI owns filesystem effects; records do not grant authority`
* Owner: `batch review untrusted input, repository paths, and observation records = PraxisBound tooling`

## Risk

* Level: high
* Reason: `security`

## Scope

### In Scope

* Exercise malicious source Markdown/HTML and feedback through the existing E2E fixture and assert the Review Projection cannot execute it.
* Prove feedback instructions or approval claims do not change confirmation, authorization, or review state.
* Test traversal and external symlinks across the loop's source-reading and source-writing commands.
* Inject output write failure and prove no partial output or source mutation remains.
* Replay a repeated ForgePilot handoff with `created: false` and prove its record is accepted without duplicate Goal or Work Item evidence.
* Name tests `R-009/AC-004` and pass `make verify`.

### Out of Scope

* Other #125 tickets, actual ForgePilot/model execution, dependencies, protocol/version changes, release, deployment, and merging the PR.

## Inputs

* The isolated R-009 fixture, hostile source and feedback, unsafe paths, and recorded ForgePilot observation shapes.

## Outputs

* Security acceptance tests and verification evidence.

## Rules

* R1: Test the built CLI and observable outcomes in a temporary repository.
* R2: Never infer authority from source, feedback, or recorded stdout.
* R3: Do not use this repository's own Stories or worktree as the fixture under test.

## Expected Errors

* Unsafe paths: a documented path or input error, with no outside read or write.
* Failed output: a failure result with no partial output or changed source.

## Dependencies

* GitHub #127 is complete; its E2E fixture supplies the test boundary.

## Constraints

* No dependency, migration, protocol, template, or VERSION change.
* `make verify` is authoritative. Preserve blocked and skipped observations.

## Guidance

* ADR-014: projection and feedback are proposals, not authority.
* ADR-016 and ADR-017: ForgePilot handoff and authorization remain separate.

## Trust Boundary Fields

* `spec.md source text` — untrusted Markdown and HTML.
* `story.md source text` — untrusted Markdown and HTML.
* `Review Projection text and attributes` — rendered untrusted text.
* `Revision Sheet proposal, rationale, and targets` — untrusted feedback.
* `manifest sources and CLI path arguments` — repository path boundary.
* `readiness.json and records paths` — owned read/write boundary.
* `observation.steps[].stdout and created` — untrusted handoff evidence.
* `observation.goalId and workItemId` — repeated identity evidence.
