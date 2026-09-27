# Story: TST-037 Require a successful preflight before ForgePilot writes

## Goal

Implement GitHub #126, under #125 and SPEC-BATCH-REVIEW/R-009.

## Context

The human invoked implement-spec for #126 and #127 on 2026-09-27.
GitHub #126 supplies the execution scope; #125 supplies the integration
and testing decisions. Other #125 tickets remain outside this change.

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

* Level: high
* Reason: `public-contract`

## Scope

### In Scope

* Contract §22 requires an earlier exit-0 preflight in the same observation for every goal-create, work-add, execution-plan, run-dry-run and run; output is opaque, schemaVersion is unchanged and §14 classifies the change Corrective.
* An ADR explains tool enforcement instead of workflow-only discipline and includes a Falsified if condition.
* Each write command has an independently load-bearing rejection test for missing earlier preflight; review observe returns REVIEW_OBSERVATION_INVALID and writes nothing.
* All accepted TST-033 and TST-035 real observations remain accepted under replay.
* The Agent workflow and CLI contract agree with the rule, and make verify passes.

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

## Trust Boundary Fields

* `observation.steps[].command and exit` — untrusted Agent claims, checked for consistency.
* `observation.steps[].stdout and stderr` — opaque untrusted output, never parsed or echoed as authority.
* `observation.goalPlan and fingerprint` — existing binding rules remain unchanged.
