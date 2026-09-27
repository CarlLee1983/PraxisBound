# ADR-018: Validate preflight before ForgePilot write observations

* Status: accepted
* Date: 2026-09-27

## Context

Contract §11 tells the Agent to recheck batch readiness before ForgePilot writes, but the Agent supplies its own observation to `review observe`. Workflow instructions alone cannot keep a record with omitted rechecks from being accepted. The existing validator already checks step order without running ForgePilot or treating recorded output as authority.

## Decision

The observation validator rejects each `goal-create`, `work-add`, `execution-plan`, `run-dry-run`, or `run` step unless an earlier exit-0 `preflight` appears in the same record. One successful preflight may cover several later writes. The validator reads only command, exit, and order; `stdout` and `stderr` stay opaque. This makes the recorded evidence internally consistent with the workflow while leaving execution authorization with the human and ForgePilot.

## Consequences

Previously accepted observations without a recorded preflight now fail with `REVIEW_OBSERVATION_INVALID` and create no record. The observation schema remains version `2.0.0`; no token, adjacency, or new live readiness check is introduced. A fabricated observation can still claim a preflight occurred, so this rule does not prove that the command ran.

**Falsified if:** a ForgePilot write can correctly proceed under the batch-review contract without an earlier successful `preflight` in the same handoff segment, or the validation boundary gains a trustworthy live preflight result that makes the recorded step check redundant.
