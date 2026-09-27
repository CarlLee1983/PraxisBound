# Story: TST-038 Exercise the two-Spec four-Story batch review loop

## Goal

Implement GitHub #127, under #125 and SPEC-BATCH-REVIEW/R-009.

## Context

The human invoked implement-spec for #126 and #127 on 2026-09-27.
GitHub #127 supplies the execution scope; #125 supplies the integration
and testing decisions. Other #125 tickets remain outside this change.

## Classification

* Security sensitive: no
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

The current human session explicitly invokes the implement-spec workflow:
local ticket integration, commits, a pushed draft PR and readiness for review
are authorized. Merging the PR into main or releasing is not authorized.

## Architecture

* Impact: medium
* Decision: `ADR-016`
* Decision: `ADR-017`
* Boundary: `batch review observation and CLI integration`
* Contract: `Core validates observation shape; CLI owns filesystem effects; records never grant authority`
* Owner: `batch review observation and CLI integration = PraxisBound tooling`

## Risk

* Level: medium
* Reason: `integration-testing`

## Scope

### In Scope

* A fixture builder creates two Specs and four dependent Stories, Readiness Sidecars and make verify inside the test temporary directory; repository Stories and worktree are never the subject under test.
* The built CLI exercises index, render, import, respond, re-render, confirm, preflight, readiness-digests, goal-plan and observe; Definition Confirmation uses the existing injected terminal adapter without a noninteractive bypass.
* Goal Plan reports REVIEW_READY and preserves all four declared Story dependencies.
* Recorded real ForgePilot output is replayed and accepted by review observe without invoking ForgePilot or a paid model.
* The success test name contains R-009/AC-001 and make verify passes.
* Parent #125 Story 2 return paths have independent cases for stale sources, unmapped requirements, external dependencies, cycles, missing Semantic Report, stale feedback, unresolved blockers, unauthorized run records and missing preflight records; stale contract test paths point to actual test files.

### Out of Scope

* Other #125 tickets, actual ForgePilot or model execution, new dependencies,
  Protocol/template/version changes, release, deployment and main-branch merge.

## Inputs

* Isolated fixture definitions and recorded observation evidence.

## Outputs

* Focused implementation, tests, documentation and verification evidence.

## Rules

* R1: An earlier exit-0 preflight is sufficient; no adjacency or fresh-token
  requirement is added. Each observation is evaluated independently.
* R2: stdout and stderr remain opaque evidence, never proof of authorization.
* R3: Existing stop rules, bindings and work-list/goal-create adjacency remain.

## Expected Errors

* Missing earlier successful preflight: REVIEW_OBSERVATION_INVALID, no write.
* Existing return paths retain their documented outcomes.

## Dependencies

* #126 and #127 have no blockers and may be implemented concurrently.
* TST-032 through TST-035 supply existing observation behavior and evidence.

## Constraints

* Corrective for unreleased batch-review tooling; schemaVersion stays 2.0.0.
* No changes to protocol/, templates/ or VERSION. No new dependencies.
* make verify is authoritative. Preserve skipped and blocked evidence.

## Guidance

* ADR-014: evidence never grants authority.
* ADR-016 and ADR-017: external handoff and authorization boundaries.
