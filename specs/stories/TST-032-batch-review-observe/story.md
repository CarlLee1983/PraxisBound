# Story: TST-032 Batch Review Observe Command and Independent Expect Flags

## Goal

`praxisbound review observe <manifest> <observation.json>` validates an Agent's
observation of one ForgePilot handoff segment against contract §22 and, only
when it is internally consistent, writes it once to
`specs/batches/<BATCH-ID>/records/forgepilot-<fp12>-<n>.json`. `review
preflight` accepts `--expect-fingerprint` and `--expect-revision`
independently (contract §9 as amended), so the §11 re-check before each
ForgePilot write works. `docs/batch-review/agent-workflow.md` §3 becomes the
complete §11 Agent procedure. No PraxisBound production code calls ForgePilot.

## Context

GitHub issue #90 traces this work to `SPEC-BATCH-REVIEW/R-008`. `ADR-016`
orders R-008 delivery as TST-029 and TST-030, then `review goal-plan`
(TST-031, merged in #115), then `review observe` with the ForgePilot
rehearsal, then the tooling 0.4.0 release. The rehearsal needs a human to run
`execution authorize` and a clean ForgePilot `32b7a68` build, so it is a
separate Story that uses this one's command and procedure.

Contract §22 defines the command and its rejection rules; the schema is
`specs/features/batch-review/schemas/forgepilot-observation.schema.json`
(`schemaVersion` `2.0.0`) with the example
`specs/features/batch-review/examples/records/forgepilot.json`. §11 defines the
Agent sequence and its `stoppedBecause` table; §2 the record naming and
exclusive create; §12 the outcome and `data.record`; §13 the limits.

Contract §9 was amended (R-008) because §11 step 2 runs `review preflight
--expect-fingerprint` alone, which the implemented both-or-neither rule
(`packages/cli/src/review-preflight.ts`) rejects as `usage-error`. The
Preflight Report schema's `expect` now takes either field, at least one.

Record allocation, exclusive create, and path safety exist in
`packages/cli/src/review-records.ts` and `review-paths.ts`; Preflight Report
validation in `packages/core/src/review/preflight-report.ts`; the TST-031
Goal Plan directory rules in `packages/cli/src/review-goal-plan.ts`.

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
* Boundary: `review observe CLI command`
* Boundary: `ForgePilot observation Core module`
* Boundary: `review preflight`
* Contract: `observe validates internal consistency only and never calls ForgePilot or judges its current state`
* Contract: `an accepted observation is written once to records/forgepilot-<fp12>-<n>.json by exclusive create`
* Contract: `--expect-fingerprint and --expect-revision are independent; git runs only when --expect-revision is given`
* Owner: `review observe CLI command = PraxisBound tooling`
* Owner: `ForgePilot observation Core module = PraxisBound tooling`

## Risk

* Level: high
* Reason: `security`
* Reason: `public-contract`
* Signal: `bounded-capacity`
* Signal: `error-projection`

## Capacity

* Bounded resource: `one observation file per call`
* Limit: `contract §13: observation input ≤ 1 MiB, nesting depth ≤ 32, each string ≤ 64 KiB except step stdout and stderr, which the schema bounds at 1048576 characters`
* Saturation behavior: `an over-limit observation is failure with REVIEW_INPUT_TOO_LARGE and nothing is written`
* Failure projection: `issue codes and locators in the existing envelope; observation content, including stdout and stderr, is never echoed`
* Evidence AC: `AC-004`

## Scope

### In Scope

* A pure Core module that validates an observation against the schema and the
  §22 rules: `batchId` equals the manifest's; `goalPlan.path` lies under
  `specs/batches/<BATCH-ID>/goal-plan/`, exists, and matches its sha256;
  `goalId`, when present, equals that manifest's `plan.id`; step order per
  §11; `stoppedBecause` consistent with the last step and the §11 exit table.
* `review observe` in the CLI: argv, input size and path safety, reading the
  referenced Goal Plan Manifest, and writing the record with the existing
  record allocation and exclusive create; `data.record` per §12.
* `review preflight` argv and Preflight Report `expect` per amended §9:
  either flag alone is accepted; only `--expect-revision` runs git.
* `docs/batch-review/agent-workflow.md` §3 written out as the §11 procedure,
  including when to call `review observe` and what the Agent must never do.
* CLI contract and result envelope schema updates for the command, its codes,
  and the relaxed `--expect-*` rule.

### Out of Scope

* Running ForgePilot, the real rehearsal, and its evidence (next Story).
* Any PraxisBound production code that spawns ForgePilot.
* Reading ForgePilot records back into index, render, or preflight.
* Checking that the observation's `fingerprint` equals the Goal Plan
  Manifest's `coverageIndex.fingerprint` (§22 does not require it).
* Renaming `REVIEW_PACKET_*` codes; publishing a release; any Protocol or
  template change.

## Inputs

* The manifest and the observation file path.
* The Goal Plan Manifest named by `goalPlan.path`.
* Existing `records/forgepilot-*.json` names for `<n>` allocation.
* For `review preflight`: `--expect-fingerprint` and/or `--expect-revision`.

## Outputs

* On success: one new `records/forgepilot-<fp12>-<n>.json` with the input's
  bytes, and the envelope with `data.record`.
* On rejection: the envelope only; no file.
* For `review preflight`: a Preflight Report whose `expect` holds exactly the
  flags given, or `null`.

## Rules

* R1: The observation is untrusted data. The tool checks only schema, limits,
  batch and Goal Plan binding, and §11/§22 step consistency; it never infers
  that ForgePilot produced it, never reads `.forgepilot`, and never treats
  `goal-completed` as Human Review acceptance or DONE.
* R2: Step rules: no `run` without an earlier exit-0 `run-dry-run`;
  `run-dry-run` or `run` never share a record with `goal-create` or
  `work-add`; every step but the last exits 0; an exit-0 `work-add` has
  `workItemId` and `created`.
* R3: `stoppedBecause` rules: `awaiting-authorization` ends with an exit-0
  `execution-plan`; `goal-completed` (0), `run-needs-human` (2),
  `run-limit-reached` (3), `run-interrupted` (130 or 143), and `run-failed`
  (any other, including `null`) end with `run` at that exit; `step-failed`
  ends with a non-zero or `null` exit; `authorization-missing` has no steps.
  Other values carry no last-step constraint beyond R2.
* R4: The written file holds the input bytes unchanged; `<fp12>` comes from
  the record's `fingerprint`; creation is exclusive, and no existing record is
  rewritten.
* R5: A symlink at the observation input, `goalPlan.path` or any of its
  directories, or `records/` is `REVIEW_PATH_UNSAFE`.
* R6: Text in the observation, including `authorized: true`, ESC sequences,
  or instructions in `stdout`/`stderr`, is data: it never changes an outcome,
  and it is never echoed in issue messages.
* R7: `review preflight` with only `--expect-fingerprint` runs no git and
  records `expect: { fingerprint }`; with only `--expect-revision` it runs the
  ADR-015 checks and records `expect: { revision }`; with both, behavior is
  unchanged; each flag given twice is `usage-error`.

## Expected Errors

* Invalid argv: `usage-error`, exit 2.
* Unreadable or invalid manifest, unsafe path: `configuration-error`, exit 2.
* Observation invalid per schema or §22: `failure`,
  `REVIEW_OBSERVATION_INVALID`, exit 1, no write.
* Observation over §13 limits: `failure`, `REVIEW_INPUT_TOO_LARGE`, exit 1,
  no write.
* Record write failure: `ERROR`, exit 3, no partial file.

## Error Projection

* Source failure: `an oversized, malformed, unbound, or step-inconsistent observation, or an unsafe path`
* Public projection: `REVIEW_OBSERVATION_INVALID, REVIEW_INPUT_TOO_LARGE, or REVIEW_PATH_UNSAFE with a JSON-pointer or repository-relative locator in the existing envelope`
* Detail policy: `field locators and repository-relative paths; never stdout, stderr, or other observation text, and never absolute paths`
* Evidence AC: `AC-004`

## Dependencies

* Human Review by carl approved this Story for execution in a Claude Code
  session on 2026-09-24, together with the contract §9 amendment and three
  decisions: the real ForgePilot rehearsal is a separate Story after this
  one; `review observe` does not compare the observation's `fingerprint`
  with the Goal Plan Manifest's `coverageIndex.fingerprint`; a `null` exit
  counts as `run-failed` for `run` and satisfies `step-failed`.
* `ADR-016` and contract §2, §9 (as amended for independent `--expect-*`),
  §11–§13, §15–§16, §22.
* TST-031 (`review goal-plan`) is merged.
* Precedes the ForgePilot rehearsal Story and the tooling 0.4.0 release.

## Constraints

* Add no dependency.
* Classify the change as **Additive** (§14): a new command; `review
  preflight` accepts argv it used to reject, and existing Preflight Reports
  stay valid. `schemaVersion`, `protocol/`, `templates/`, and `VERSION`
  remain unchanged.
* Pure decisions live in Core; the CLI reads and writes files.
* Fixtures use isolated temporary repositories; no ForgePilot is installed or
  called by any test.
* `make verify` is authoritative for completion.
* Do not merge, publish, tag, release, deploy, or push.

## Guidance

Relevant:

* principle: small coherent changes
* principle: behavior-oriented testing
* decision: `ADR-016` has the Agent record observations through a validating
  command instead of PraxisBound spawning ForgePilot
* decision: `ADR-014` keeps records from granting authority
* decision: `ADR-015` governs `--expect-revision`

Not applicable:

* no persistent-data migration, publication, Protocol change, ForgePilot
  call, or model integration applies

## Trust Boundary Fields

* `observation input file path and every field, including steps[].stdout and steps[].stderr` — Agent output.
* `goalPlan.path and the Goal Plan Manifest it names` — repository files that may be rewritten or forged.
* `records/ directory entries, including symlinks` — repository file system.
* `CLI arguments --expect-fingerprint and --expect-revision` — caller input.
* `git command output (HEAD, working tree state)` — external process output.
