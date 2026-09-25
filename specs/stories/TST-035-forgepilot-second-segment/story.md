# Story: TST-035 ForgePilot Second-Segment Rehearsal on a Bootstrap Install

## Goal

Prove the contract §11 second segment against a real ForgePilot. TST-033
stopped at `execution plan` because `execution authorize` and `run` need a
Bootstrap-managed install that a source build cannot provide (F-4). This
Story reruns the handoff against ForgePilot `3a76aca`, installed through its
now-supported source-built Bootstrap. It observes an unauthorized real `run`
being refused, then `execution authorize`, `run --dry-run`, and a real
`run --runtime codex`, each mapped to a `review observe` record. It also
closes two gaps TST-034 left: a `goal-preflight-failed` record built from a
real ForgePilot response, and a test that makes the `run-failed` exclusions
load-bearing.

## Context

GitHub issue #90 traces this work to `SPEC-BATCH-REVIEW/R-008`. TST-029
through TST-034 delivered R-008 up to `awaiting-authorization`. R-008/AC-005
(start the existing Runner with no per-Story confirmation) and AC-007 (stop
at ForgePilot's Goal completion, no merge or deploy) are still unproven end
to end (`specs/stories/TST-033-forgepilot-rehearsal/verification.md`,
Residual Risks).

ForgePilot has moved six commits past `32b7a68`, to `3a76aca`. The facts
below were read from ForgePilot source during drafting. None were observed
by running ForgePilot:

* `fbd615c` makes the source-built Apple-Silicon Bootstrap a supported path
  (`docs/release/bootstrap.md`): `scripts/forgepilot-bootstrap plan`, then
  `install --approve <Plan ID>`, then `generation-v1 current` prints the
  `engineGeneration` values. The install creates `~/.local/bin/forgepilot`,
  `~/.local/bin/forgepilot-bootstrap`, and `~/.agents/skills/forgepilot-onboarding`,
  and refuses if any of them already exists.
* The CLI surface §11 uses (`work list`, `goal create`, `work add`, `goal
  preflight`, `execution plan` v2, `execution authorize`, `run`) and the
  `run` exit table are unchanged between the two commits.
* F-1, F-2, F-3, F-5, and F-6 still hold. `goal preflight` and `execution
  plan` still exit 0 on failed validation. No read-only authorization query
  exists. `run --dry-run` checks no authorization.
* New and optional: `execution supervise install` registers a LaunchAgent
  that starts runs by itself every 60 seconds. §11 does not use it.
* Installing `32b7a68` itself is expected to fail the Bootstrap's `make
  verify`, because `ea03e0f` repaired runner fixtures broken at that commit
  (inferred, not run).

The TST-034 code review found that deleting `last.exit !== 2` from the
`run-failed` rule in `packages/core/src/review/forgepilot-observation.ts`
fails no test, because no test pairs `run-failed` with an excluded exit.

TST-033 F-4 (a source build cannot provide `execution authorize` or `run`)
describes `32b7a68`. Its evidence stays as that record; this Story observes
`3a76aca`.

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
* Boundary: `ForgePilot integration evidence`
* Boundary: `ForgePilot observation Core module`
* Contract: `contract §11's ForgePilot baseline moves from 32b7a68 to 3a76aca only after this rehearsal passes the first segment at 3a76aca; the public CLI steps do not change`
* Contract: `every ForgePilot Goal, Work Item, and run is created in the fixture repository only; the Bootstrap install is the human's machine setup, not rehearsal state`
* Contract: `no PraxisBound production code changes; a defect found becomes a new Story`
* Owner: `ForgePilot integration evidence = PraxisBound tooling`

## Risk

* Level: high
* Reason: `security`
* Reason: `external-integration`
* Reason: `public-contract`
* Signal: `error-projection`

## Scope

### In Scope

* The human installs ForgePilot `3a76aca` through its Bootstrap. The
  evidence records the plan ID, the `generation-v1 current` output, the Go
  version, and the installed binary's sha256.
* A fixture repository in a temporary directory, with at least three
  Stories with dependencies, readiness sidecars, one Spec, and a batch
  manifest, built from the TST-033 fixture scripts. Driven by this
  repository's built CLI at a recorded commit.
* First segment at `3a76aca` through `awaiting-authorization`, using the
  real `engineGeneration` from the Bootstrap. `review observe` accepts the
  record.
* Before authorization, a real `run` of the planned Goal is refused by
  ForgePilot with no Worker started, and is recorded as `run-failed`. This
  observes the rule that contract §11 step 9 only read from source.
* The human runs `execution authorize`. On the human's session statement
  (ADR-017), the Agent runs `run --dry-run` and then the real `run
  --runtime codex --runtime-command <executablePath> --snapshot`. The exit
  is mapped by the §11 table, and `review observe` accepts the record.
* A second Goal whose Goal Plan is deliberately inconsistent, so that `goal
  preflight` exits 0 with non-empty top-level `diagnostics`. The Agent stops
  with `goal-preflight-failed`, and `review observe` accepts that record.
  This is the real-response case TST-034 lacked.
* `packages/core/test/review-observation.test.mjs`: one rejection test per
  excluded exit (2, 3, 130, 143) paired with `run-failed`. Each fails when
  its conjunct is removed.
* After the rehearsal passes the first segment, a **Corrective** amendment
  re-pins ForgePilot from `32b7a68` to `3a76aca`, in:
  * contract §10, §11, and §14
  * `docs/batch-review/agent-workflow.md` §3
  * ADR-016's pin paragraph, with an amendment note

  The amendment also replaces the F-4 wording ("a source build cannot
  satisfy") with the Bootstrap install requirement.
* Evidence under `specs/stories/TST-035-forgepilot-second-segment/evidence/`,
  plus `verification.md`.

### Out of Scope

* `execution supervise` in any form. No LaunchAgent is installed.
* Changing ForgePilot, or reading or writing any `.forgepilot` directory
  directly.
* Asking ForgePilot for an authorization query or for non-zero exits on
  failed validation. These are follow-up ForgePilot issues.
* Goal final acceptance, merge, or deploy after the run.
* The tooling 0.4.0 release, and R-009's full acceptance.
* Uninstalling or upgrading the Bootstrap install after the rehearsal.

## Inputs

* PraxisBound at a recorded commit on main, with `make verify` passing.
* The ForgePilot checkout at `3a76aca`.
* Values that only the human supplies in the session:
  * Worker Profile, caps, and `expiresAt`
  * the `--by` name for `execution authorize`
  * the statement that authorization ran
* The human's own terminal actions:
  * the Bootstrap `plan` / `install --approve`
  * `review confirm` (TTY)
  * `execution authorize`

## Outputs

* Evidence files, `verification.md`, the new Core tests, and the re-pin
  amendment in this repository.
* A fixture repository and its ForgePilot state in a temporary directory,
  not committed.
* The Bootstrap install under `~/.local/`, left in place for the human.

## Rules

* R1: The Agent never runs the Bootstrap `install`, `review confirm`, or
  `execution authorize`, and never installs supervision. The human does
  these, and the evidence records that and when.
* R2: The Agent never chooses a Worker Profile, caps, `expiresAt`, or
  `engineGeneration`. `engineGeneration` comes verbatim from `generation-v1
  current`, never a placeholder. A missing value stops the rehearsal at
  that step.
* R3: Every ForgePilot call uses the Bootstrap-installed binary by absolute
  path, with `--json`. A non-zero exit is never parsed, except §11 step 3's
  `work list`.
* R4: The real `run` executes only against the fixture repository, within
  the human-supplied caps. Its Codex usage is the one paid model call this
  Story allows, and it counts only once the human has authorized it.
* R5: Each segment ends with `review observe`. A rejected observation is
  itself evidence of a defect: it is recorded, not edited until it is
  accepted.
* R6: `GOAL_COMPLETED` is reported as ForgePilot's technical completion
  only.
* R7: Outputs are stored verbatim, truncated only as §13 allows and marked
  as truncated. Machine-specific absolute paths outside the temporary
  directories become placeholders, and each replacement is stated. The
  approval token is the only credential-like value recorded.
* R8: The re-pin amendment changes no §11 step, stop reason, or schema.
  Any step change found during the rehearsal becomes a separate Story.

## Expected Errors

* Bootstrap `install` refuses, because of a pre-existing link, a missing
  `go`, or a failed `make verify`: the output is recorded, the rehearsal is
  blocked, and the re-pin is not applied.
* Codex runtime unavailable, or not logged in: the real `run` is recorded
  as `run-failed` or blocked with its exact output, not as a pass.
* The unauthorized real `run` exits 0, or starts a Worker: this is an
  incompatibility with contract §11 step 9. The run is recorded, the Story
  stays partial, and a follow-up is proposed.
* A ForgePilot or PraxisBound rejection of a correctly formed input: this is
  recorded as an incompatibility with a follow-up.

## Error Projection

* Source failure: `a ForgePilot non-zero exit, a Bootstrap refusal, a PraxisBound rejection, or a missing human action`
* Public projection: `verification.md rows marked pass, blocked, or failed with the exact command and verbatim output`
* Detail policy: `outputs verbatim except placeholders for machine-specific absolute paths; no credentials other than the single-use approval token`
* Evidence AC: `AC-008`

## Dependencies

* Human Review by carl approved this Story for execution in a Claude Code
  session on 2026-09-25, with three decisions:
  * the re-pin to `3a76aca` is accepted as Corrective
  * carl performs the Bootstrap install on this machine
  * the paid Codex run is allowed; its caps are supplied by carl in the
    session at §11 step 6, as R2 requires
* TST-033 and TST-034 are merged.
* Precedes the tooling 0.4.0 release decision.

## Constraints

* Add no dependency to this repository. The Go toolchain and the Bootstrap
  install are recorded, not added.
* The re-pin is **Corrective** (§14): `review goal-plan`, `review observe`,
  and the Agent workflow are unreleased, and the CLI steps they depend on
  are unchanged. `protocol/`, `templates/`, `VERSION`, and every
  `schemaVersion` stay unchanged.
* Fixture state lives in temporary directories. Tests use isolated temporary
  repositories.
* `make verify` is authoritative for completion.
* Do not merge, publish, tag, release, deploy, or push.

## Guidance

Relevant:

* decision: `ADR-016` sets the handoff boundary and the pin.
* decision: `ADR-017` sets how the second segment is entered.
* decision: `ADR-014` keeps records from granting authority.
* principle: record what was observed, including blocked and failed steps.

Not applicable:

* no persistent-data migration, publication, or Protocol change applies

## Trust Boundary Fields

* `ForgePilot stdout, stderr, exit, and JSON output` — external process output.
* `forgepilot-bootstrap plan, install, and generation-v1 output` — external process output. It is the only source of `engineGeneration`.
* `Codex Worker changes in the fixture repository` — model output, never merged or copied into this repository.
* `human-supplied Worker Profile, caps, expiresAt, --by name, and the authorization statement` — session input.
* `fixture repository files and records/` — test data authored for the rehearsal.
