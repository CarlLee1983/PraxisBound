# ADR-016: Batch handoff emits Goal Plan artifacts and leaves the run to the control plane

* Status: accepted
* Date: 2026-09-23
* Accepted: 2026-09-23 (human review, merged #111)
* Amended by: ADR-017 — ForgePilot `32b7a68` offers no machine-readable authorization query, so the Agent starts the second segment on the human's session statement and the real `run` is the authorization gate; contract §11 (TST-034) also restricts "built from a clean copy" to the first segment, since the second needs a Bootstrap-managed install
* Amended: 2026-09-26 (TST-035, human review) — the pin moves to ForgePilot `3a76aca`, whose Bootstrap install supports the second segment; the §11 CLI surface and `run` exit table are unchanged between the two commits

## Context

Contract §10–§11 (R-008) were written against ForgePilot `f2ec4b5`: an
Execution Packet of PraxisBound's own shape, text-output parsing, no retry, and
recovery only through a new `--attempt` Goal. ForgePilot at `32b7a68` changed
underneath that design:

* `work add --external-ref` is a Goal-scoped idempotency key; `--json` and
  `work list --goal --json` give machine-readable results and lookup.
* `goal preflight` consumes a Goal Plan Manifest and a Plan Coverage Review —
  artifacts ForgePilot's ADR-0035 says PraxisBound owns, though nothing in
  PraxisBound produces them.
* `run --goal` refuses a Goal without an execution authorization, obtained by
  `execution plan` (approval token) then `execution authorize --by`.
* A GOAL-policy Goal completes itself; the "awaiting Goal review" state the
  Spec stops at no longer exists.

The Goal Plan shape PraxisBound published under FP-51 (`@praxisbound/core`
0.3.0) is not the shape ForgePilot consumes: `schemaVersion` alone
(`1` vs `"1.0.0"`) fails the first check. ForgePilot changed last, and its
shape was designed around batch review. ForgePilot also requires a
`<story>/readiness.json` sidecar that its ADR-0029 says PraxisBound owns and
PraxisBound's Protocol does not define.

Keeping the Execution Packet would leave two overlapping start-of-work
artifacts in one repository, with ForgePilot consuming only the other one.

## Decision

* PraxisBound adopts the Goal Plan shape ForgePilot's `goal preflight`
  consumes (`schemaVersion "1.0.0"`, `plan{id,revision}`, `declaration`,
  per-node `dependsOn`, `coverageIndex{batchId,fingerprint}`) as its Goal Plan
  artifacts, and removes the FP-51 shape published in `@praxisbound/core`
  0.3.0. The FP-51 shape had no consumer; this is Breaking for the tooling
  packages, not for the Protocol.
* `review goal-plan` (replacing `review packet`) projects, from a confirmed,
  preflighted Review Batch: the declaration (from `batch.json`), the Goal Plan
  Manifest, a Plan Coverage Review projected only from a Definition
  Confirmation whose fingerprint matches. The Execution Packet is removed,
  with no compatibility layer.
* The `<story>/readiness.json` sidecar is an authored definition source, not a
  derived file: its criterion owners and operations, inputs, outputs, future
  identities, and decision follow-ups are declarations nobody can infer from
  Story prose, and an empty array tells ForgePilot "none". It belongs to the
  Review Batch and the Requirement Fingerprint, is shown for human review, and
  is bound by the Definition Confirmation. Tooling only refreshes its digests
  on an explicit command before confirmation, and preflight blocks when its
  digests, criterion IDs, operations versus Story Authority, or prerequisite
  references disagree with the batch. It is a Reference Tooling convention, not
  a Protocol artifact.
* The Goal Plan artifacts bind content by digest, not by commit, because
  ForgePilot runs with `--snapshot` against the working tree. `review
  goal-plan` does not require committed sources; this replaces the premise in
  ADR-015 that a handoff binds a commit. The ADR-015 mechanism itself stays
  available through `review preflight --expect-revision`.
* This amends ADR-014's handoff paragraphs: a retry now resumes through
  `work list --json` and `--external-ref` instead of stopping at an existing
  Goal, and no artifact records an authorization source at all. ADR-014's
  authority boundaries stand.
* The Agent workflow drives ForgePilot's public CLI with `--json` and
  `--external-ref`, reads `work list --json` before continuing a retry, and
  stops on any mismatch. It never reads or writes `.forgepilot`.
* The Agent stops at `execution plan`. Only the human runs
  `execution authorize`; the Agent runs `run` only after observing that
  authorization in ForgePilot.
* The Agent writes its observation through a validating `review observe`
  command rather than spawning ForgePilot from PraxisBound production code.
* A `GOAL_COMPLETED` run is reported as ForgePilot's technical completion, not
  Human Review acceptance, DONE, or permission to merge or deploy.

## Consequences

Contract §2–§4, §9–§17, §21–§22, the observation and readiness schemas, and the R-007/R-008/R-009
wording about awaiting Goal review are revised and re-reviewed before any R-008
Story is implemented. Delivery then runs as separate Stories: Goal Plan shape
alignment and the readiness sidecar (independent of each other), then
`review goal-plan`, then `review observe` with the rehearsal, then a tooling
0.4.0 publication carrying the Breaking migration guidance only after the new
shape has passed a real `goal preflight`.

The handoff is bound to a pinned ForgePilot commit (`32b7a68` for the contract
revision, `3a76aca` since TST-035), installed through ForgePilot's own
Bootstrap, since `execution authorize` and a real `run` accept only a
Bootstrap-managed install. The rehearsal runs through `execution plan`; the
human runs `execution authorize`, then `run --dry-run` is required and a real
`run`, which needs a Codex runtime, may be recorded as blocked.

**Falsified if:** ForgePilot stops accepting the Goal Plan shape in
`specs/features/batch-review/schemas/goal-plan/`, or `run --goal`
no longer requires an execution authorization, or `work add` loses
`--external-ref` idempotency, or ForgePilot stops requiring
`readinessContract.path` to be `<storyRef>/readiness.json`, or ForgePilot's
`internal/app/preflight.go` loosens or tightens the artifact rules contract §10
mirrors — then the schemas and those rules are re-compared.
