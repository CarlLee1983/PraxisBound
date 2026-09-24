# Story: TST-031 Batch Review Goal Plan Command

## Goal

`praxisbound review goal-plan <manifest> --semantic-report <file>
[--attempt <n>]` turns a confirmed, preflighted Review Batch whose every Story
carries a Readiness Sidecar into the three Goal Plan artifacts ForgePilot's
`goal preflight` consumes: `declaration.json`, `manifest.json`, and
`coverage-review.json`, written under
`specs/batches/<BATCH-ID>/goal-plan/<plan.id>/`. The artifacts are a pure,
byte-reproducible projection of the current sources and the matching
Definition Confirmation; they carry no authorization and claim no completed
work. The command never runs ForgePilot.

## Context

GitHub issue #90 traces this work to `SPEC-BATCH-REVIEW/R-008`. `ADR-016`
(accepted in #111) replaced the unimplemented Execution Packet and `review
packet` with Goal Plan artifacts and ordered R-008 delivery as: Goal Plan shape
alignment (TST-029) and the Readiness Sidecar (TST-030), then this command,
then `review observe` with the ForgePilot rehearsal, then the tooling 0.4.0
release. Contract §10 defines the command, identities, projection, byte format,
and write rules; §2 lists the artifacts; §12 its outcomes and `data`; §13 its
limits; §15–§16 its trust boundary and security fixtures.

TST-029 supplies `exportGoalPlanDeclaration`, `exportGoalPlanManifest`,
`exportPlanCoverageReview`, and their validators in
`packages/core/src/goal-plan-artifacts.ts`. TST-030 supplies Sidecar
validation in `packages/core/src/review/readiness-sidecar.ts`. Preflight
evaluation and the Preflight Report live in
`packages/core/src/review/preflight.ts`, `preflight-report.ts`, and
`packages/cli/src/review-preflight.ts`; confirmation records in
`packages/cli/src/review-confirmation-records.ts`; path safety in
`packages/cli/src/review-paths.ts`.

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
* Boundary: `review goal-plan CLI command`
* Boundary: `Goal Plan projection Core module`
* Boundary: `review preflight`
* Contract: `goal-plan runs exactly the preflight evaluation, adds REVIEW_READINESS_MISSING, and writes artifacts only on REVIEW_READY`
* Contract: `plan.id is <BATCH-ID>-<fp12> or <BATCH-ID>-<fp12>-a<n>; plan.revision is 1`
* Contract: `artifacts are fully determined by current sources and the matching Definition Confirmation`
* Contract: `an existing artifact with identical bytes is success; different bytes is REVIEW_GOAL_PLAN_CONFLICT and nothing is rewritten`
* Owner: `review goal-plan CLI command = PraxisBound tooling`
* Owner: `Goal Plan projection Core module = PraxisBound tooling`

## Risk

* Level: high
* Reason: `security`
* Reason: `public-contract`
* Signal: `bounded-capacity`
* Signal: `error-projection`

## Capacity

* Bounded resource: `one Declaration, Manifest, and Coverage Review per plan.id, at most 200 nodes`
* Limit: `contract §10: Declaration ≤ 1 MiB and depth ≤ 32; Manifest and Coverage Review ≤ 8 MiB and depth ≤ 128; ≤ 10000 dependsOn edges each; plan.id ≤ 128 characters`
* Saturation behavior: `a plan.id over 128 characters is configuration-error REVIEW_GOAL_PLAN_ID_INVALID; a projection that fails its own TST-029 validator is ERROR and writes nothing`
* Failure projection: `issue codes and locators in the existing envelope; source and record content is never echoed`
* Evidence AC: `AC-005`

## Scope

### In Scope

* A pure Core projection from the parsed manifest, source bytes, Sidecar
  bytes, and the matching Definition Confirmation to the three artifacts'
  exact bytes, built on the TST-029 exporters, per contract §10 steps 2–3
  (identities, node order, `reviewedSources` order, `reviewId` derivation,
  `reviewer`, `reviewedAt`, JSON formatting).
* `review goal-plan` in the CLI: argv, the full preflight evaluation and its
  Preflight Report (§10 step 1), `REVIEW_READINESS_MISSING`, the fixed output
  directory, exclusive writes with byte-identical idempotency, and
  `REVIEW_GOAL_PLAN_CONFLICT` (§10 step 4).
* Each projected artifact passes its TST-029 validator before any file is
  written.
* `data` per §12: `preflightRecord`, `goalPlanDirectory`, `files`.
* CLI contract (`docs/typescript-tooling/cli-contract.md`) and result envelope
  schema updates for the command and its codes; the stale `review packet`
  wording there is replaced.
* `docs/batch-review/agent-workflow.md` names the command as the step after
  `REVIEW_READY`.

### Out of Scope

* Any ForgePilot command, `preflight-request.json`, `execution-request.json`,
  and the §11 Agent sequence (the `review observe` Story).
* `review observe` and its schema.
* Renaming `REVIEW_PACKET_FINGERPRINT_MISMATCH` or
  `REVIEW_PACKET_REVISION_MISMATCH` (§9 keeps the historical names).
* Deciding whether an older Goal was abandoned; `--attempt` is taken as given.
* Publishing a tooling release; any Protocol or template change.

## Inputs

* Everything `review preflight` reads today, including the Semantic Report.
* Each batch Story's `readiness.json`.
* The Definition Confirmation whose fingerprint matches the current one.
* `--attempt <n>` when given.
* Existing files under `specs/batches/<BATCH-ID>/goal-plan/<plan.id>/`.

## Outputs

* A new Preflight Report under `records/`, deduplicated as for `preflight`.
* On `REVIEW_READY`: `declaration.json`, `manifest.json`, and
  `coverage-review.json` under the fixed directory.
* The envelope with outcome, issues, and `data`.

## Rules

* R1: The evaluation is the one `review preflight` performs without
  `--expect-*`; the same batch yields the same issues and outcome from both
  commands, plus `REVIEW_READINESS_MISSING` (BLOCKED) for each Story without
  `readiness.json` in `goal-plan` only.
* R2: No Goal Plan file is created, opened for writing, or modified unless the
  outcome is `REVIEW_READY`; the Preflight Report is still written.
* R3: `--attempt` accepts a decimal integer from 1 without leading zeros;
  anything else is `usage-error`. `plan.id` over 128 characters is
  `configuration-error` with `REVIEW_GOAL_PLAN_ID_INVALID`, checked before any
  write.
* R4: The projection reads only the current sources, the manifest, and the
  matching Definition Confirmation; it reads no clock, environment, git state,
  or earlier Goal Plan. Running it twice on unchanged sources yields identical
  bytes.
* R5: Every file is created exclusively. An existing file with identical bytes
  counts as written and is left untouched. An existing file with different
  bytes makes the whole command `failure` with `REVIEW_GOAL_PLAN_CONFLICT`;
  files already created by this run stay, and no existing file is rewritten or
  deleted.
* R6: A symlink at the output directory, at `goal-plan/`, at any parent up to
  the repository root, or at an artifact path is `REVIEW_PATH_UNSAFE`, and
  nothing is written there.
* R7: Artifacts carry no authorization, verification result, or completion
  claim. Source, Sidecar, record, and Semantic Report text, including
  `authorized: true` or instructions, is data and never changes an outcome.
* R8: The command does not require committed sources and does not accept
  `--expect-revision`; the artifacts bind content by digest (§10 step 5).

## Expected Errors

* Invalid argv, including a missing `--semantic-report` or bad `--attempt`:
  `usage-error`, exit 2.
* Unreadable or invalid manifest, unsafe path, `plan.id` too long:
  `configuration-error`, exit 2.
* Not ready: the preflight outcome (`REVIEW_STALE`, `REVIEW_BLOCKED`,
  `REVIEW_INCOMPLETE`), exit 1, no artifact.
* Conflicting existing artifact: `failure`, `REVIEW_GOAL_PLAN_CONFLICT`,
  exit 1.
* A projection that fails its own validator, or an artifact write failure:
  `ERROR`, exit 3.

## Error Projection

* Source failure: `a not-ready batch, a missing Sidecar, an over-long plan.id, a conflicting or unsafe existing artifact, or a failed write`
* Public projection: `stable REVIEW_* codes with repository-relative locators in the existing envelope and Preflight Report`
* Detail policy: `repository-relative paths and codes; never source, Sidecar, record, or artifact content, and never absolute paths`
* Evidence AC: `AC-004`

## Dependencies

* Human Review by carl approved this Story for execution in a Claude Code
  session on 2026-09-24, including three rules the contract left open: a
  missing `--semantic-report` is `usage-error`, `--attempt` takes a decimal
  integer from 1 without leading zeros, and a failed artifact write or a
  projection failing its own validator is `ERROR`.
* `ADR-016` and contract §2, §9, §10, §12–§16 are accepted (#111).
* TST-029 (Goal Plan exporters and validators) and TST-030 (Readiness
  Sidecar) are merged.
* Precedes the `review observe` Story, which drives ForgePilot with these
  artifacts.

## Constraints

* Add no dependency.
* Classify the change as **Additive** (§14): a new command with new codes;
  no existing command's outcome, issue format, or `data` changes.
  `schemaVersion`, `protocol/`, `templates/`, and `VERSION` remain unchanged.
* Pure decisions live in Core; the CLI reads and writes files.
* Fixtures use isolated temporary repositories.
* `make verify` is authoritative for completion.
* Do not merge, publish, tag, release, deploy, or push.

## Guidance

Relevant:

* principle: small coherent changes
* principle: behavior-oriented testing
* decision: `ADR-016` replaces the Execution Packet with Goal Plan artifacts
* decision: `ADR-014` keeps records and projections from granting authority

Not applicable:

* no persistent-data migration, publication, Protocol change, ForgePilot
  call, or model integration applies

## Trust Boundary Fields

* `batch.json` — every field is untrusted repository content written by a human or Agent.
* `source Markdown and readiness.json` — untrusted repository content.
* `records/ Definition Confirmation and earlier records` — repository files anyone can rewrite or forge.
* `Semantic Report path and every field` — Agent output.
* `goal-plan/<plan.id>/ existing files and directory entries, including symlinks` — repository files that may be rewritten or forged.
* `CLI arguments --semantic-report and --attempt` — caller input.
