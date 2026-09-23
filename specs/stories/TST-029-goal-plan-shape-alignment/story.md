# Story: TST-029 Goal Plan Artifacts in the Shape ForgePilot Consumes

## Goal

`@praxisbound/core` exports and validates Goal Plan artifacts in the shape
ForgePilot's `goal preflight` consumes: a Goal Plan Declaration, a Goal Plan
Manifest, and a Plan Coverage Review as defined by
`specs/features/batch-review/schemas/goal-plan/`. The FP-51 shape published in
0.3.0 is removed with no compatibility layer. An artifact this Core exports
passes ForgePilot `32b7a68` `goal preflight` artifact checks, and an artifact
ForgePilot's own valid fixtures accept, this Core accepts.

## Context

GitHub issue #90 traces this work to `SPEC-BATCH-REVIEW/R-008`. `ADR-016`
(accepted in #111) found that the Goal Plan shape FP-51 published in
`@praxisbound/core` 0.3.0 fails ForgePilot's first check (`schemaVersion` `1`
versus `"1.0.0"`) and differs in almost every field, while ForgePilot's shape
was designed around batch review (`coverageIndex{batchId, fingerprint}`,
`declaration`). ForgePilot's ADR-0035 says PraxisBound owns the format; nothing
in PraxisBound produces it yet. Contract §10 now points at
`schemas/goal-plan/`, copied byte-for-byte from ForgePilot
`32b7a68ebf96d74b55acec8f1cd9408f2ba70dab`
`internal/app/testdata/goal-plan-artifacts/v1/`. The current implementation is
`packages/core/src/goal-plan-artifacts.ts`, documented in
`docs/typescript-tooling/goal-plan-artifacts.md`, with canonical fixtures in
`packages/core/test/fixtures/goal-plan-artifacts/`.

This Story changes only the Core artifact surface. `review goal-plan`, which
projects a Review Batch into these artifacts, is a later Story.

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
* Boundary: `goal plan artifacts Core module`
* Contract: `the Declaration, Manifest, and Coverage Review shapes are exactly specs/features/batch-review/schemas/goal-plan/; any disagreement is a contract defect, not an implementation choice`
* Contract: `export is deterministic: the same input yields the same bytes`
* Contract: `validation never infers requirement coverage, approval, or authority from artifact content`
* Owner: `goal plan artifacts Core module = PraxisBound tooling`

## Risk

* Level: high
* Reason: `public-contract`
* Reason: `security`
* Signal: `bounded-capacity`
* Signal: `error-projection`

## Capacity

* Bounded resource: `one artifact document and the source bytes it binds`
* Limit: `the schema bounds: ≤ 1000 nodes, ≤ 1000 dependsOn entries per node, ≤ 4000 reviewedSources, planId and nodeRef ≤ 128 characters, repo paths ≤ 1024 characters`
* Saturation behavior: `an over-bound artifact is rejected whole as malformed-artifact; nothing is truncated`
* Failure projection: `one stable category per rejection with a message that names the field, never the raw content`
* Evidence AC: `AC-004`

## Scope

### In Scope

* Replace the Manifest and Coverage Review types, exporters, and validators in
  `goal-plan-artifacts.ts` with the `schemas/goal-plan/` shape, and add the
  Declaration (export and validate).
* Artifact-level rules ForgePilot `32b7a68` `internal/app/preflight.go`
  enforces on these documents: `schemaVersion` `"1.0.0"`; nodes and each
  `dependsOn` sorted; `readinessContract.path` equal to
  `<storyRef>/readiness.json`; Manifest nodes equal to Declaration nodes; the
  Declaration digest binding; Coverage Review `manifestSha256`,
  `reviewedSources`, and `coverageIndex` equal to the Manifest's; `reviewId`
  UUIDv4; `reviewedAt` with exactly `.000Z`; `reviewer.assurance`
  `self-asserted`; dependency cycles and dangling references.
* Replacing the canonical fixtures, `docs/typescript-tooling/goal-plan-artifacts.md`,
  and the Core public exports and their tests.
* A recorded cross-check against ForgePilot `32b7a68`'s valid and invalid
  fixtures and one exported artifact run through its `goal preflight`.

### Out of Scope

* `review goal-plan`, Readiness Sidecar content, `review observe`, and any
  ForgePilot command sequence (later R-008 Stories).
* Publishing a tooling release; the Breaking release is its own Story.
* Changes to ForgePilot.

## Inputs

* Caller-supplied artifact bytes and source bytes, as today.
* Export inputs: plan identity, nodes with Story reference and dependencies,
  reviewed source bytes, coverage index, and the reviewer facts a Coverage
  Review states.

## Outputs

* Declaration, Manifest, and Coverage Review bytes in the new shape.
* Validation results with the existing stable failure categories.

## Rules

* R1: `schemas/goal-plan/` is authoritative. Where the code and those schemas
  disagree, stop and report; do not edit the schemas in this Story.
* R2: Export serializes with two-space indentation, a single trailing
  newline, and no escaping of non-ASCII, with object keys in schema
  `required` order; the same input always yields the same bytes.
* R3: The existing failure categories (`unsupported-schema`,
  `malformed-artifact`, `invalid-topology`, `digest-mismatch`,
  `approval-binding-mismatch`) are kept; each new rule maps to one of them,
  documented in `goal-plan-artifacts.md`.
* R4: The 0.3.0 shape is removed: no reader, alias, or migration for
  `planNodeRef`, `edges`, `identity`, numeric `schemaVersion`, `approvedBy`,
  or `approvedAt`.
* R5: Artifact text, including a reviewer name or path that reads as an
  instruction or approval, is data and never changes a result.
* R6: The ForgePilot cross-check is recorded evidence of that commit only. It
  is not in `make verify`, because this repository cannot assume a ForgePilot
  checkout; the in-repository fixtures carry the automated guarantee.

## Expected Errors

* Unsupported `schemaVersion`: `unsupported-schema`.
* Schema, sort-order, readiness-path, UUID, or timestamp violations:
  `malformed-artifact`.
* Cycles, duplicate or dangling node references, Declaration and Manifest node
  mismatch: `invalid-topology`.
* Source, Declaration, or readiness digest differences: `digest-mismatch`.
* Coverage Review not bound to the Manifest's bytes, sources, or coverage
  index: `approval-binding-mismatch`.

## Error Projection

* Source failure: `a malformed, unsupported, cyclic, or digest-inconsistent Goal Plan artifact`
* Public projection: `a validation result with one stable category and a message naming the field`
* Detail policy: `messages name fields and repository-relative paths; they never echo artifact content, reviewer names, or absolute paths`
* Evidence AC: `AC-003`

## Dependencies

* Human Review by carl approved this Story for execution in a Claude Code
  session on 2026-09-23.
* `ADR-016` and contract §10 are accepted (#111).
* Independent of TST-030; both precede the `review goal-plan` Story.

## Constraints

* Add no dependency; validate by hand as the current module does.
* Classify the change as **Breaking** for `@praxisbound/core` (the 0.3.0 Goal
  Plan API and shape are removed). `protocol/`, `templates/`, and `VERSION`
  remain unchanged. Package versions are not bumped here; the release Story
  carries the version and migration guidance.
* Pure Core only: no file system, subprocess, or network access.
* Fixtures live in the test fixture directory, never in this repository's own
  Stories or batches.
* `make verify` is authoritative for completion. The ForgePilot cross-check is
  separately recorded evidence.
* Do not merge, publish, tag, release, deploy, or push.

## Guidance

Relevant:

* principle: small coherent changes
* principle: behavior-oriented testing
* decision: `ADR-016` makes PraxisBound own the shape ForgePilot consumes

Not applicable:

* no persistent-data migration, Protocol change, or model integration applies

## Trust Boundary Fields

* `Goal Plan Declaration` — every field is untrusted input to validation.
* `Goal Plan Manifest` — every field, including `storyRef`, paths, and digests.
* `Plan Coverage Review` — every field, including `reviewer.name` and `conclusion`.
* `source bytes` — caller-supplied bytes bound by digest.
