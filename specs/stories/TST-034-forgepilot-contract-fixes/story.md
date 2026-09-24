# Story: TST-034 Contract §11/§22 Fixes From the ForgePilot Rehearsal

## Goal

Make the batch review handoff match what ForgePilot `32b7a68` actually does,
as observed in the TST-033 rehearsal. `review observe` accepts the new
`execution-plan-failed` stop and binds `goal-preflight-failed` and
`execution-plan-failed` to their last step; `docs/batch-review/agent-workflow.md`
§3 follows the amended contract §11; and the observation schema, CLI contract,
and examples agree. No PraxisBound command calls ForgePilot.

## Context

GitHub issue #90 traces this work to `SPEC-BATCH-REVIEW/R-008`. TST-033 (#119)
rehearsed contract §11 against ForgePilot `32b7a68` and recorded six findings
in `specs/stories/TST-033-forgepilot-rehearsal/verification.md`:

* F-1 `goal preflight` and `execution plan` exit 0 on failed validation;
  failures appear only in `diagnostics`.
* F-2 `run --dry-run` does not check authorization; no ForgePilot command
  exposes it machine-readably (ADR-017).
* F-3 `work list` reports `review_policy` as `GOAL`.
* F-4 the second segment needs a Bootstrap-managed install;
  `engineGeneration` comes from `forgepilot-bootstrap generation-v1 current`.
* F-5 without `--runtime-command`, `run` resolves `codex` through `PATH`,
  whose symlink differs from the authorized resolved path.
* F-6 `execution-plan-request/v2` constraints the contract did not state.

This Story's documentation part is already amended alongside it: contract §11
preface and steps 3, 5, 6, 8, 9; §22's `stoppedBecause` rules; §14's
classification; `forgepilot-observation.schema.json` gains
`execution-plan-failed`; `ADR-017` (proposed with this Story) amends
`ADR-016`. The code lives in `packages/core/src/review/forgepilot-observation.ts`
(TST-032).

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
* push: no
* deploy: no

## Architecture

* Impact: medium
* Decision: `ADR-016`
* Decision: `ADR-017`
* Boundary: `ForgePilot observation Core module`
* Boundary: `review observe CLI command`
* Contract: `goal-preflight-failed ends with an exit-0 goal-preflight; execution-plan-failed ends with an exit-0 execution-plan`
* Contract: `review observe checks step shape only and never parses stdout for diagnostics`
* Contract: `the Agent enters the second segment only on the human's session statement that execution authorize ran; the real run is the authorization gate`
* Owner: `ForgePilot observation Core module = PraxisBound tooling`

## Risk

* Level: high
* Reason: `security`
* Reason: `public-contract`
* Signal: `error-projection`

## Scope

### In Scope

* `validateForgepilotObservationConsistency`: accept `execution-plan-failed`;
  require `goal-preflight-failed` to end with an exit-0 `goal-preflight` and
  `execution-plan-failed` to end with an exit-0 `execution-plan`.
* The hand-written schema check in Core accepts the new enum value.
* `docs/batch-review/agent-workflow.md` §3 rewritten to amended §11:
  absolute-path invocation, the Bootstrap requirement for the second segment,
  the `diagnostics` check after `goal preflight` and `execution plan`, `GOAL`,
  the request constraints and `engineGeneration` source, `--runtime-command`,
  and the ADR-017 entry rule for the second segment.
* `docs/typescript-tooling/cli-contract.md` for the new stop value and rules.

### Out of Scope

* Changing ForgePilot, or asking it for an authorization query or non-zero
  exits on failed validation (follow-up requests to ForgePilot).
* Re-running the rehearsal; deciding the 0.4.0 release condition.
* The TST-031 leap-second question.
* Rewriting TST-033's evidence scripts, which record what ran.

## Inputs

* Observation files given to `review observe`.

## Outputs

* Accepted observations written as before; rejected ones as before, with the
  new rules.

## Rules

* R1: `goal-preflight-failed` is accepted only when the last step is
  `goal-preflight` with exit 0; `execution-plan-failed` only when the last
  step is `execution-plan` with exit 0.
* R2: `review observe` never parses `stdout` to judge `diagnostics`; the
  Agent's `stoppedBecause` is checked only against step shape.
* R3: Every other §22 rule, including the TST-032 `work-list` exception, is
  unchanged.
* R4: The Agent workflow never fills `engineGeneration` with a placeholder and
  never starts the second segment without the human's statement.

## Expected Errors

* An observation with `goal-preflight-failed` or `execution-plan-failed`
  whose last step does not match: `failure`, `REVIEW_OBSERVATION_INVALID`,
  exit 1, no write.
* An unknown `stoppedBecause`: `failure`, `REVIEW_OBSERVATION_INVALID`.

## Error Projection

* Source failure: `an observation whose stoppedBecause does not match its last step`
* Public projection: `REVIEW_OBSERVATION_INVALID in the existing envelope`
* Detail policy: `never stdout, stderr, or other observation text, and never absolute paths`
* Evidence AC: `AC-002`

## Dependencies

* Human Review by carl approved this Story for execution in a Claude Code
  session on 2026-09-24, together with the contract §11/§22 amendment,
  ADR-017, and the Corrective classification.
* TST-032 (`review observe`) and TST-033 (the rehearsal) are merged.
* Precedes the tooling 0.4.0 release decision.

## Constraints

* Add no dependency.
* Classify the change as **Corrective** (§14): `review goal-plan`, `review
  observe`, and the Agent workflow are unreleased, and this corrects their
  contract to ForgePilot `32b7a68`'s observed behavior. Observation
  `schemaVersion` stays `2.0.0`; `protocol/`, `templates/`, and `VERSION`
  remain unchanged.
* Pure decisions live in Core; fixtures use isolated temporary repositories.
* `make verify` is authoritative for completion.
* Do not merge, publish, tag, release, deploy, or push.

## Guidance

Relevant:

* decision: `ADR-016` sets the handoff boundary; `ADR-017` amends its
  authorization observation
* principle: record what ForgePilot does, not what the contract assumed

Not applicable:

* no persistent-data migration, publication, Protocol change, ForgePilot
  call, or model integration applies

## Trust Boundary Fields

* `observation input file path and every field, including steps[].stdout and steps[].stderr` — Agent output.
* `goalPlan.path and the Goal Plan Manifest it names` — repository files that may be rewritten or forged.
