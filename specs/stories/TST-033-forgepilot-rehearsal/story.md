# Story: TST-033 ForgePilot Handoff Rehearsal

## Goal

Rehearse the contract §11 handoff end to end against a clean build of
ForgePilot `32b7a68ebf96d74b55acec8f1cd9408f2ba70dab`, in an isolated fixture
repository, using only the released-to-main PraxisBound commands (`review
index`, `render`, `readiness-digests`, `preflight`, `goal-plan`, `observe`)
and ForgePilot's public CLI with `--json`. Record exactly what happened —
commands, versions, exits, outputs, and every observation `review observe`
accepted — as traceable evidence, including anything blocked or
incompatible. This is the "版本明確的真實演練" R-008 requires and the
precondition ADR-016 sets for the tooling 0.4.0 release.

## Context

GitHub issue #90 traces this work to `SPEC-BATCH-REVIEW/R-008`. `ADR-016`
orders R-008 as TST-029, TST-030, TST-031 (`review goal-plan`, #115), TST-032
(`review observe`, independent `--expect-*`, the §11 procedure, #117), then
this rehearsal, then the tooling 0.4.0 release, which may ship only after the
new Goal Plan shape has passed a real `goal preflight`.

The procedure is contract §11 as amended in TST-032 and written out in
`docs/batch-review/agent-workflow.md` §3. ForgePilot `32b7a68` facts checked
in its source for this draft: `work list` on an unknown Goal exits 1 with
`unknown goal` on stderr; `goal create` rejects an existing ID; `execution
plan` takes a `forgepilot.execution-plan-request/v2` file with
`goalPlanRequest`, `workerProfile` (`runtime`, `executablePath`, `model`,
`effort`, `sandbox`), `engineGeneration` (`sourceCommit`, `payloadSHA256`),
`caps`, and `expiresAt`; `execution authorize` takes `--request`,
`--approval-token`, and `--by`; `run` takes `--runtime <codex|fake>
--snapshot [--dry-run]`. TST-029's cross-check
(`specs/stories/TST-029-goal-plan-shape-alignment/evidence/`) is the layout
precedent for recorded evidence.

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

* Impact: low
* Decision: `ADR-016`
* Boundary: `ForgePilot integration evidence`
* Contract: `the rehearsal changes no PraxisBound production code, schema, or contract; a defect it finds becomes a new Story`
* Contract: `every ForgePilot state change happens in the fixture repository only, never in this repository or any real project`
* Owner: `ForgePilot integration evidence = PraxisBound tooling`

## Risk

* Level: high
* Reason: `security`
* Reason: `external-integration`
* Signal: `error-projection`

## Scope

### In Scope

* Building ForgePilot from `git archive 32b7a68` into a temporary directory
  (never a worktree of, or a build inside, the ForgePilot checkout), and
  recording the commit, Go version, and binary sha256.
* A fixture repository in a temporary directory with at least three Stories
  with dependencies, their Readiness Sidecars, one Spec, a batch manifest, and
  git history, driven by this repository's built CLI at a recorded commit.
* The §11 first segment to `awaiting-authorization`, a retry of it against the
  existing Goal, a stale-source stop, a pre-authorization `run --dry-run`
  refusal, and the second segment after the human authorizes.
* One `review observe` record per segment, each accepted.
* Evidence under `specs/stories/TST-033-forgepilot-rehearsal/evidence/`
  (scripts, request files, verbatim outputs) and `verification.md`.
* Any incompatibility found: recorded with the exact command and output, and
  proposed as a follow-up PraxisBound Story or ForgePilot issue.

### Out of Scope

* Changing PraxisBound code, schemas, contract, or templates; changing
  ForgePilot; reading or writing any `.forgepilot` directory directly.
* R-009's full end-to-end acceptance (two Specs, revision loop, browser
  review); the tooling release.
* Deciding Goal final acceptance, merge, or deploy after a run.

## Inputs

* PraxisBound at a recorded commit on main, built with `make verify`
  passing.
* ForgePilot source at `32b7a68`.
* Values only the human supplies in the session (§11 step 6): Worker Profile,
  caps, `expiresAt`, `engineGeneration`, and the `--by` name for `execution
  authorize`.
* The human's own terminal actions: `review confirm` (TTY) and `execution
  authorize`.

## Outputs

* Evidence files and `verification.md` in this repository.
* A fixture repository and ForgePilot state in a temporary directory, not
  committed.

## Rules

* R1: The Agent never runs `review confirm` or `execution authorize`; the
  human does, and the evidence records that they did and when.
* R2: The Agent never chooses a Worker Profile, caps, `expiresAt`, or
  `engineGeneration` value; missing values stop the rehearsal at that step.
* R3: Every ForgePilot call uses the built `32b7a68` binary by absolute path
  and `--json`; a non-zero exit is never parsed, except §11 step 3's `work
  list`, which is followed directly by `goal create`.
* R4: Each segment ends with `review observe`; a rejected observation is
  itself evidence of a defect and is recorded, not edited until accepted.
* R5: `GOAL_COMPLETED` is reported as ForgePilot's technical completion only.
* R6: Captured outputs are stored verbatim, truncated only as §13 allows and
  marked so; any absolute path of the human's machine outside the temporary
  directories is replaced by a placeholder, and the replacement is stated.
* R7: Nothing in the fixture is pushed, and no ForgePilot state outside the
  fixture repository is created or read.

## Expected Errors

* Missing human-supplied value or action: the rehearsal stops at that step
  and `verification.md` records the step as blocked.
* A real `run` needing an unavailable Codex runtime or credentials: recorded
  as blocked with the exact output, not as a pass.
* A ForgePilot or PraxisBound rejection of a correctly formed input: recorded
  as an incompatibility with a follow-up; the Story stays partial.

## Error Projection

* Source failure: `a ForgePilot non-zero exit, a PraxisBound rejection, or a missing human action`
* Public projection: `verification.md rows marked pass, blocked, or failed with the exact command and verbatim output`
* Detail policy: `outputs verbatim except placeholders for machine-specific absolute paths; no credentials or tokens other than the single-use approval token`
* Evidence AC: `AC-007`

## Dependencies

* Human Review by carl approved this Story for execution in a Claude Code
  session on 2026-09-24, with two decisions: the real `run` uses `--runtime
  codex` as contract §11 fixes, and is recorded as blocked when Codex cannot
  run; `engineGeneration`, which ForgePilot `32b7a68` requires but §11 step 6
  does not list, is a human-supplied value like the Worker Profile.
* TST-031 and TST-032 are merged; contract §11 as amended in #117.
* Precedes the tooling 0.4.0 release Story.

## Constraints

* Add no dependency to this repository; the Go toolchain used to build
  ForgePilot is recorded, not added.
* No versioned surface changes, so no `protocol/versioning.md`
  classification applies; `protocol/`, `templates/`, `VERSION`, and
  `schemaVersion` remain unchanged.
* `make verify` is authoritative for this repository's state.
* Do not merge, publish, tag, release, deploy, or push.

## Guidance

Relevant:

* decision: `ADR-016` sets the handoff boundary and the rehearsal pin
* decision: `ADR-014` keeps records from granting authority
* principle: record what was observed, including blocked and failed steps

Not applicable:

* no persistent-data migration, publication, or Protocol change applies

## Trust Boundary Fields

* `ForgePilot stdout, stderr, exit, and JSON output` — external process output.
* `ForgePilot source archive and Go toolchain` — external build inputs, pinned by commit and recorded version.
* `human-supplied Worker Profile, caps, expiresAt, engineGeneration, and --by name` — session input.
* `fixture repository files and records/` — test data authored for the rehearsal.
