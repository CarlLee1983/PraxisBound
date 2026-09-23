# Story: TST-030 Batch Review Readiness Sidecar

## Goal

A Story in a Review Batch may carry an authored `readiness.json` Readiness
Sidecar. When present, it is a definition source: `review index` and the
Requirement Fingerprint include it, `review render` shows it verbatim for human
review, and `review preflight` blocks when it is malformed, its digests are
stale, its criteria differ from the Story's acceptance criteria, it declares
operations the Story does not grant, or it references Stories outside the
batch's dependency closure. `review readiness-digests` refreshes only its two
digests. No tool ever writes its semantic fields or infers them from prose.

## Context

GitHub issue #90 traces this work to `SPEC-BATCH-REVIEW/R-008`. `ADR-016`
(accepted in #111) decided that ForgePilot's required `<story>/readiness.json`
is an authored definition source, because its owners, operations, inputs,
outputs, future identities, and decision follow-ups cannot be derived from
Story prose, and an empty array tells ForgePilot "none". Contract §21 defines
the Sidecar, `review readiness-digests`, and the five preflight rows; §4 adds
it to the fingerprint when present; §2 lists it as a source. The schema is
`specs/features/batch-review/schemas/readiness-sidecar.schema.json`, derived
from ForgePilot `32b7a68` `internal/readiness/readiness.go`. Index and
fingerprint live in `packages/core/src/review/manifest.ts`,
`fingerprint.ts`, and `index.ts`; render in `render*.ts`; preflight in
`preflight.ts` and `packages/cli/src/review-preflight.ts`; Story Authority
parsing in `packages/core/src/story-governance.ts`.

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
* Boundary: `readiness sidecar Core module`
* Boundary: `review index and fingerprint`
* Boundary: `review render`
* Boundary: `review preflight`
* Boundary: `review readiness-digests CLI command`
* Contract: `a present Sidecar is a batch source in the fingerprint; an absent one is not missing`
* Contract: `readiness-digests rewrites only story_md_digest and acceptance_md_digest of existing Sidecars and never creates one`
* Contract: `preflight validates consistency with the Story and batch, never the truth of a declaration`
* Owner: `readiness sidecar Core module = PraxisBound tooling`
* Owner: `review readiness-digests CLI command = PraxisBound tooling`

## Risk

* Level: high
* Reason: `security`
* Reason: `public-contract`
* Signal: `bounded-capacity`
* Signal: `error-projection`

## Capacity

* Bounded resource: `one Sidecar per batch Story, at most 200 per batch`
* Limit: `contract §13 records limits per Sidecar: ≤ 1 MiB, nesting depth ≤ 32, each string ≤ 64 KiB; schema array bounds`
* Saturation behavior: `an over-limit Sidecar is REVIEW_INPUT_TOO_LARGE and BLOCKED in preflight; readiness-digests refuses and writes nothing`
* Failure projection: `issue codes and locators in the existing envelope; Sidecar content is never echoed`
* Evidence AC: `AC-004`

## Scope

### In Scope

* A pure Core module that validates a Sidecar against the schema and against
  its Story (digests, criteria IDs versus acceptance AC IDs, operations versus
  `## Authority`, references versus the batch dependency closure, output ID
  uniqueness across the batch).
* `review index` and the fingerprint include a present `readiness.json`
  (contract §3, §4).
* `review render` shows a present Sidecar verbatim as a JSON block with the
  Story, with the `#document` anchor, so Revision Requests can target it.
* The five §21 preflight rows, `REVIEW_READINESS_INVALID`,
  `REVIEW_READINESS_STALE`, `REVIEW_READINESS_CRITERIA_MISMATCH`,
  `REVIEW_READINESS_OPERATION_UNGRANTED`, and
  `REVIEW_READINESS_REFERENCE_UNKNOWN`, all BLOCKED.
* `praxisbound review readiness-digests <manifest>` per §21 and §12.
* CLI contract and result envelope schema updates for the new command and
  codes.

### Out of Scope

* Requiring a Sidecar (`REVIEW_READINESS_MISSING` belongs to `review
  goal-plan`, a later Story).
* Creating Sidecars, filling semantic fields, or inferring them from Story
  prose; any Protocol or template change.
* Goal Plan artifacts (TST-029) and ForgePilot interaction.

## Inputs

* Everything `review index`, `render`, and `preflight` read today.
* Each batch Story's `readiness.json`, when present.

## Outputs

* Index, fingerprint, render, and Preflight Report reflecting Sidecars.
* For `readiness-digests`: rewritten Sidecars and the envelope `data.updated`
  listing their paths.

## Rules

* R1: Presence decides membership. A present Sidecar joins the fingerprint's
  `sources`; an absent one contributes nothing and is not
  `REVIEW_SOURCE_MISSING`. Adding or removing one changes the fingerprint.
* R2: `owner` values `runner_worker`, `canonical_verification`, and
  `integration_final` must have every operation marked `yes` in the Story's
  `## Authority`; `runner_worker` may carry only `plan` and `modify`. `human`
  and `external` criteria are not compared with Authority.
* R3: `prerequisite_story_ref` and the Story owning a `prerequisite_output`
  must be in the Story's transitive `dependsOn` closure in the manifest;
  `follow_up_story_ref` must be a batch Story; `outputs[].id` is unique across
  the batch.
* R4: `readiness-digests` reads every batch Sidecar first. If any is invalid,
  it writes nothing and fails with `REVIEW_READINESS_INVALID`. Otherwise it
  rewrites each Sidecar whose digests differ, through a temporary file and
  atomic rename, with two-space indentation, one trailing newline, and the
  original key order; a Sidecar whose digests already match is not written.
* R5: `readiness-digests` edits definition sources, so it is an effect that
  needs Execution Authorization like any source edit; its documentation says
  to run it before `review confirm`, and that running it changes the
  fingerprint and makes an earlier confirmation inapplicable.
* R6: Sidecar text, including `authorized`, `approved`, instructions, ESC
  sequences, or bidi characters, is data. It never changes an outcome or
  grants authority, and render escapes it as text.
* R7: A symlinked `readiness.json` or Story directory segment is
  `REVIEW_PATH_UNSAFE`, as for other batch sources.

## Expected Errors

* Invalid or over-limit Sidecar in preflight: `REVIEW_BLOCKED`, exit 1.
* Stale digests, criteria mismatch, ungranted operation, unknown reference:
  `REVIEW_BLOCKED`, exit 1.
* `readiness-digests` with any invalid Sidecar: `failure`, exit 1, no write.
* Unsafe path: `configuration-error`, exit 2, `REVIEW_PATH_UNSAFE`.

## Error Projection

* Source failure: `an unreadable, oversized, malformed, stale, or inconsistent Readiness Sidecar`
* Public projection: `stable REVIEW_READINESS_* codes with locators in the existing envelope and Preflight Report`
* Detail policy: `repository-relative paths and field names; never Sidecar string content or absolute paths`
* Evidence AC: `AC-003`

## Dependencies

* Human Review by carl approved this Story for execution in a Claude Code
  session on 2026-09-23.
* `ADR-016` and contract §2–§4, §9, §12, §21 are accepted (#111).
* TST-021 through TST-028 supply index, render, confirm, and preflight.
* Independent of TST-029; both precede the `review goal-plan` Story.

## Constraints

* Add no dependency; validate the schema by hand with the existing
  `revision-limits.ts` helpers.
* Classify the change as **Additive** (§14): a batch whose Stories have Sidecars
  gets a new fingerprint, so earlier confirmations of it stop applying; no
  existing command's outcome for a batch without Sidecars changes.
  `schemaVersion`, `protocol/`, `templates/`, and `VERSION` remain unchanged.
* Pure decisions live in Core; the CLI reads and writes files.
* Fixtures use isolated temporary repositories.
* `make verify` is authoritative for completion.
* Do not merge, publish, tag, release, deploy, or push.

## Guidance

Relevant:

* principle: small coherent changes
* principle: behavior-oriented testing
* decision: `ADR-016` makes the Sidecar an authored source
* decision: `ADR-014` keeps records and projections from granting authority

Not applicable:

* no persistent-data migration, publication, Protocol change, or model
  integration applies

## Trust Boundary Fields

* `readiness.json` — every field is untrusted repository content written by a human or Agent.
* `readiness.json path and Story directory segments` — repository file system entries, including symlinks.
* `story.md ## Authority` — repository content read to compare operations.
