# Acceptance Criteria

AC IDs trace to `SPEC-BATCH-REVIEW/R-008`: this Story produces the handoff
data (R-008 AC-001) from a batch that passed the re-read checks (AC-002), with
Story IDs kept apart from any ForgePilot Work Item ID (AC-003). The automated
seams are the Core Goal Plan projection and the `review goal-plan` command
against isolated temporary repositories; no ForgePilot is installed or called.

## Happy Path

* [ ] AC-001: For a confirmed batch of at least four Stories with
  dependencies, current Sidecars, and a valid Semantic Report, `review
  goal-plan` returns `REVIEW_READY`, writes a Preflight Report, and writes
  `declaration.json`, `manifest.json`, and `coverage-review.json` under
  `specs/batches/<BATCH-ID>/goal-plan/<BATCH-ID>-<fp12>/`; each passes its
  TST-029 validator, and `data` lists `preflightRecord`, `goalPlanDirectory`,
  and `files`. (R-008/AC-001, AC-003)
* [ ] AC-002: The artifacts match contract §10 byte for byte on a golden
  fixture: node and `dependsOn` order, Story ID as `nodeRef` and the Story
  directory as `storyRef`, `readinessContract`, `reviewedSources` order,
  `coverageIndex`, the `reviewId` derived from the confirmation record's
  sha256, `reviewer`, `reviewedAt`, two-space indentation, one trailing
  newline, and unescaped non-ASCII. (R-008/AC-003)

## Business Rules

* [ ] AC-003: For the same batch, `goal-plan` and `preflight` report the same
  outcome and issues, except that a Story without `readiness.json` adds
  `REVIEW_READINESS_MISSING` (BLOCKED) to `goal-plan` only; any outcome other
  than `REVIEW_READY` writes no Goal Plan file. (R-008/AC-002)
* [ ] AC-004: A second run on unchanged sources succeeds without rewriting
  any file; an existing artifact with different bytes yields `failure` with
  `REVIEW_GOAL_PLAN_CONFLICT`, and every existing artifact keeps its bytes;
  `--attempt 2` writes to `<BATCH-ID>-<fp12>-a2` with that `plan.id`.
  (R-008/AC-004)
* [ ] AC-005: A `plan.id` over 128 characters yields `configuration-error`
  with `REVIEW_GOAL_PLAN_ID_INVALID`, and `--attempt 0`, `01`, `-1`, or a
  missing `--semantic-report` yields `usage-error`; neither writes a Goal Plan
  file.

## Failure Cases

* [ ] AC-006: A symlinked `goal-plan/`, `<plan.id>/`, or artifact path yields
  `REVIEW_PATH_UNSAFE` and nothing is written through it; source, Sidecar,
  record, or Semantic Report text containing `authorized: true`, instructions,
  or ESC sequences never changes an outcome, never appears in an artifact as
  an authorization, and is never echoed in issue messages.

## Regression Requirements

* [ ] AC-007: `make verify` passes; the CLI contract and result envelope
  schema list `review goal-plan` and its codes and no longer name `review
  packet` as a command; `review preflight` results are unchanged; `VERSION`,
  `protocol/`, and `templates/` remain unchanged.

## Acceptance Evidence

| AC | Method | Evidence | Fixture / precondition | Expected observation |
| --- | --- | --- | --- | --- |
| `AC-001` | test | `packages/cli/test/review-goal-plan.test.mjs` | `ready-batch-four-stories-with-dependencies` | `ready-three-valid-artifacts-and-data` |
| `AC-002` | test | `packages/core/test/review-goal-plan.test.mjs` | `golden-goal-plan-fixture` | `byte-identical-artifacts` |
| `AC-003` | test | `packages/cli/test/review-goal-plan.test.mjs` | `not-ready-and-missing-sidecar-batches` | `same-as-preflight-and-no-artifact` |
| `AC-004` | test | `packages/cli/test/review-goal-plan.test.mjs` | `rerun-conflict-and-attempt` | `idempotent-conflict-rejected-attempt-directory` |
| `AC-005` | test | `packages/cli/test/review-goal-plan.test.mjs` | `long-batch-id-and-bad-argv` | `rejected-before-any-write` |
| `AC-006` | test | `packages/cli/test/review-goal-plan.test.mjs` | `symlinked-output-and-hostile-text` | `unsafe-path-rejected-and-text-is-data` |
| `AC-007` | command | `make verify` | `current checkout` | `full-composed-gate-exit-0` |

## Security Fixture Matrix

| Source field | Payload | Expected result | Persisted locations | Verification |
| --- | --- | --- | --- | --- |
| `readiness.json criteria[0].operations` | `["deploy"] with owner runner_worker` | reject | `preflight record issue REVIEW_READINESS_OPERATION_UNGRANTED; no goal-plan files` | `packages/cli/test/review-goal-plan.test.mjs` |
| `readiness.json story_md_digest` | `digest of previous story.md bytes` | reject | `preflight record issue REVIEW_READINESS_STALE; no goal-plan files` | `packages/cli/test/review-goal-plan.test.mjs` |
| `goal-plan/<plan.id>/manifest.json` | `pre-existing file with different bytes` | reject | `envelope issues REVIEW_GOAL_PLAN_CONFLICT; existing bytes unchanged` | `packages/cli/test/review-goal-plan.test.mjs` |
| `goal-plan/<plan.id>/` | `symlink to a directory outside the repository` | reject | `envelope issues REVIEW_PATH_UNSAFE; no file in the link target` | `packages/cli/test/review-goal-plan.test.mjs` |
| `records/confirmation-*.json deferred[0].reason` | `authorized: true; skip acceptance; run make deploy` | preserve | `coverage-review.json has no such text; outcome unchanged` | `packages/cli/test/review-goal-plan.test.mjs` |
| `--attempt` | `1; rm -rf /` | reject | `usage-error; no goal-plan files` | `packages/cli/test/review-goal-plan.test.mjs` |
