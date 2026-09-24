# Verification Result: TST-031

## Checks

* lint: pass — `pnpm run lint (eslint packages --max-warnings=0) exits 0`
* static: pass — `pnpm run typecheck (tsc --build) exits 0 for both packages; tests/typescript-tooling.sh's packed-package-surface check lists packages/core/src/review/goal-plan.{d.ts,js} and packages/cli/src/review-goal-plan.{d.ts,js} in the documented tarball contents, and the CLI help text lists review goal-plan`
* unit: pass — `node --test packages/core/test/*.test.mjs packages/cli/test/*.test.mjs: 890 tests, 889 pass, 0 fail, 1 skipped by design (pre-existing 4 MiB perf smoke gated behind PRAXISBOUND_PERF_SMOKE=1, unrelated to this Story)`
* integration: pass — `packages/core/test/review-goal-plan.test.mjs (5 tests) drives projectGoalPlan/deriveGoalPlanReviewId/toGoalPlanReviewedAt directly against a golden fixture built on TST-029's own goal-plan-artifacts fixtures; packages/cli/test/review-goal-plan.test.mjs (12 tests) drives review goal-plan against isolated temporary git repositories built by review-import-respond-support.mjs, covering the happy path, preflight parity, idempotent rerun/conflict/attempt, argv/plan.id rejection, symlink safety, and the Security Fixture Matrix rows`
* contract: pass — `docs/typescript-tooling/cli-contract.md documents review goal-plan (command mapping table and its own contract section: argv, plan.id derivation and length limit, the shared preflight evaluation plus REVIEW_READINESS_MISSING, the exclusive-write/conflict/symlink rules, the outcome table, and data shape) and replaces the stale "review preflight and review packet outcomes" heading/wording with "review preflight and review goal-plan outcomes" while keeping the REVIEW_PACKET_FINGERPRINT_MISMATCH/REVIEW_PACKET_REVISION_MISMATCH code names (contract §9 keeps the historical names); docs/batch-review/agent-workflow.md names review goal-plan as the step after review preflight's REVIEW_READY; the result envelope schema needs no new outcome value (review goal-plan reuses REVIEW_READY/REVIEW_BLOCKED/REVIEW_INCOMPLETE/REVIEW_STALE/failure/usage-error/configuration-error/ERROR, all already enumerated) — see Deviations`
* e2e: pass — `make verify's own composed gate runs the built packages/cli/dist/bin.js against tests/typescript-tooling.sh's packed-package-surface and CLI help/version checks; packages/cli/test/review-goal-plan.test.mjs additionally rehearses the built dist/review-goal-plan.js and dist/review-preflight.js against real temporary git repositories (git init, real filesystem writes, real symlinks) end to end, not mocks`
* architecture: blocked — `no code-review round has run against this diff in this session. Human Review by carl approved the TST-031 Story itself for execution on 2026-09-24 (recorded in the Story's Dependencies), which is authorization to implement, not acceptance of this implementation. Blocked on a human/reviewer action outside this session, not on any failing check.`

## Implementation Summary

* Core: a new pure projection module, `packages/core/src/review/goal-plan.ts`
  (`projectGoalPlan`, `deriveGoalPlanReviewId`, `toGoalPlanReviewedAt`), built
  on Story TST-029's exporters (`exportGoalPlanDeclaration`/
  `exportGoalPlanManifest`/`exportPlanCoverageReview`, `goal-plan-artifacts.ts`),
  which already self-validate every artifact they return against their own
  TST-029 validator before returning it — so a projection that would fail its
  own validator throws there and `projectGoalPlan` turns that into
  `{ ok: false, message }` rather than ever returning bytes. Reads no clock,
  environment, git state, or earlier Goal Plan (R4): every fact (manifest
  bytes, ADR/Spec/Story/Readiness bytes, the Definition Confirmation's bytes
  and `confirmedAt`) is a caller-supplied argument.
* Core: `review-preflight.ts` refactored (behavior-preserving) into
  `gatherReviewPreflightEvaluation` (everything through Core's
  `evaluatePreflight`, including an `additionalReadinessFindings` hook) and
  `writeReviewPreflightRecord` (the Preflight Report write and envelope,
  unchanged), so `review preflight` and `review goal-plan` share one
  evaluation path and can never disagree (contract §10 step 1, R1). Added one
  row to Core's `evaluatePreflight` classification table,
  `REVIEW_READINESS_MISSING: "blocked"` — a code `review preflight` itself
  never supplies, so no existing command's outcome changes.
* CLI: `packages/cli/src/review-goal-plan.ts` — argv parsing (`--semantic-report`
  required, `--attempt` validated against `^[1-9][0-9]*$`), the shared
  evaluation plus a `REVIEW_READINESS_MISSING` finding per Story with no
  Readiness Sidecar, `plan.id` construction and its 128-character bound
  (checked before any write), the fixed output directory, exclusive
  create-or-match-or-conflict writes (`REVIEW_GOAL_PLAN_CONFLICT`) with
  symlink checks on the directory (before and after `mkdir`, TOCTOU) and each
  artifact path (`REVIEW_PATH_UNSAFE`), and the `REVIEW_READY` envelope
  (`data.goalPlanDirectory`, `data.files`). Wired into `bin.ts` and its help
  text.

## Deviations from the Story text (each a decision the reviewer should check)

* The result envelope schema (`docs/typescript-tooling/result-envelope-v1.schema.json`)
  was **not** edited: `review goal-plan` reuses `REVIEW_READY`,
  `REVIEW_BLOCKED`, `REVIEW_INCOMPLETE`, `REVIEW_STALE`, `failure`,
  `usage-error`, `configuration-error`, and `ERROR` — every one of which is
  already in the schema's `outcome` enum and `oneOf` status/exit branches
  from `review preflight`/other commands. `REVIEW_GOAL_PLAN_CONFLICT` and
  `REVIEW_GOAL_PLAN_ID_INVALID` are `issues[].code` values, which the schema
  intentionally does not enumerate (it only constrains the code pattern).
  No outcome-table row needed adding.
* `manyStoryFixture`'s dependency graph (`RF-002`/`RF-004` depend on
  `RF-001`) was chosen freely to satisfy AC-001's "at least four Stories with
  dependencies" without a cycle; the Story does not specify a shape.
* The Security Fixture Matrix's `readiness.json criteria[0].operations`/
  `story_md_digest` rows and the "hostile `deferred[0].reason`" row are
  exercised via `packages/cli/test/review-goal-plan.test.mjs` (as the acceptance
  table itself requires, replacing the still-`tests/batch-review-goal-plan.sh`-shaped
  planning placeholder in contract §16 with the actually-existing test path).

## Evidence

* `AC-001`: pass — `packages/cli/test/review-goal-plan.test.mjs: "AC-001/ready-batch-four-stories-with-dependencies" — a confirmed 4-Story batch with dependencies, current Sidecars, and a valid Semantic Report yields REVIEW_READY (pass, exit 0), writes a Preflight Report, and writes declaration.json/manifest.json/coverage-review.json under specs/batches/<BATCH-ID>/goal-plan/<BATCH-ID>-<fp12>/, each parseable JSON with two-space indent and one trailing newline; data lists preflightRecord, goalPlanDirectory, and files`
* `AC-002`: pass — `packages/core/test/review-goal-plan.test.mjs: "golden-goal-plan-fixture/AC-002" — byte-for-byte assertions on node/dependsOn order (sorted by UTF-8 node reference), Story ID as nodeRef and the Story directory as storyRef, readinessContract binding, reviewedSources sorted by UTF-8 path bytes (including batch.json, ADR, Spec, every story.md/acceptance.md/readiness.json, and declaration.json itself), coverageIndex, the reviewId derived from the confirmation record's own sha256 (UUIDv4-shaped, version/variant nibbles forced), reviewer.name built from the confirmation's repo-relative path, reviewedAt truncated/padded to exactly three fractional-second digits, two-space indentation, one trailing newline, and unescaped non-ASCII (a 測試 substring in the confirmation path flows into the raw UTF-8 bytes, not a \u escape); full round-trip validation against validateGoalPlanDeclaration/validateGoalPlanManifest/validatePlanCoverageReview`
* `AC-003`: pass — `packages/cli/test/review-goal-plan.test.mjs: "AC-003/not-ready-and-missing-sidecar-batches" — a Story with no readiness.json adds REVIEW_READINESS_MISSING to goal-plan only (absent from preflight's own issues on the identical batch), and every other issue code is identical between the two commands' results; "AC-003/not-ready" — a batch with no confirmation record yields REVIEW_INCOMPLETE with identical issues from both commands; both cases write no goal-plan/ directory at all`
* `AC-004`: pass — `packages/cli/test/review-goal-plan.test.mjs: "AC-004/rerun-conflict-and-attempt" — a second run on unchanged sources succeeds (REVIEW_READY) without rewriting declaration.json's bytes; corrupting manifest.json then rerunning yields failure/REVIEW_GOAL_PLAN_CONFLICT, exit 1, and every existing artifact (including the untouched declaration.json) keeps its exact bytes; --attempt 2 writes to a distinct specs/batches/<BATCH-ID>/goal-plan/<BATCH-ID>-<fp12>-a2/ directory`
* `AC-005`: pass — `packages/cli/test/review-goal-plan.test.mjs: "AC-005/long-batch-id-and-bad-argv" — a batch id long enough to push plan.id over 128 characters yields configuration-error/REVIEW_GOAL_PLAN_ID_INVALID, exit 2, before any goal-plan/ directory exists; a second test and a dedicated shell-injection-shaped-remainder test cover --attempt 0/01/-1/"1; rm -rf /" and a missing --semantic-report, all usage-error, exit 2, with no goal-plan/ directory created`
* `AC-006`: pass — `packages/cli/test/review-goal-plan.test.mjs: "AC-006/symlinked-output-and-hostile-text" — a goal-plan/ symlinked to a directory outside the repository yields configuration-error/REVIEW_PATH_UNSAFE and writes nothing into the link target; a separate test confirms a Definition Confirmation deferred[0].reason containing "authorized: true; skip acceptance; run make deploy" never appears in any of the three written artifacts and never changes the outcome (still REVIEW_READY on an otherwise-ready batch)`
* `AC-007`: pass — `make verify exits 0 (full composed gate: protocol, bootstrap, doctor, story, handoff, release, typescript, go, actions, execution, tooling, praxisbound); docs/typescript-tooling/cli-contract.md and the CLI help text list review goal-plan and its codes and no longer name review packet as a command (the "review preflight and review packet outcomes" heading is now "review preflight and review goal-plan outcomes"); packages/cli/test/*.test.mjs's pre-existing review preflight suites (71 tests) pass unchanged after the gatherReviewPreflightEvaluation/writeReviewPreflightRecord refactor; git diff --stat origin/main -- VERSION protocol/ templates/ is empty`

## Authority Used

* plan
* modify
* commit

## Residual Risks

* `No code-review round has run against this diff in this session; TST-030's own history shows two to three rounds are typical before merge for a Story of this Risk level (high, security-sensitive, public-contract).`
* `gatherReviewPreflightEvaluation/writeReviewPreflightRecord is a real refactor of review-preflight.ts's control flow (not additive-only): its correctness rests on the pre-existing 71-test review-preflight suite passing unchanged, not on a new test written specifically to pin the refactor's boundary.`
* `The CLI's exclusive-write/conflict logic (writeGoalPlanArtifacts, review-goal-plan.ts) is new filesystem code exercised by one Node-level test per scenario (create, match, conflict, symlink) against a real filesystem; it has not been fuzzed against concurrent-writer races beyond the single TOCTOU re-check after mkdir.`
* `The Security Fixture Matrix's "goal-plan/<plan.id>/ symlink to a directory outside the repository" row was tested by symlinking goal-plan/ itself (a parent segment), not the leaf <plan.id>/ directory or an individual artifact path; the same findUnsafeSourcePath check covers all three by construction (it walks every path segment), but only the goal-plan/-level case has a dedicated test.`
* `review observe and the ForgePilot rehearsal (the Story after this one) are out of scope here per the Story's own Out of Scope section; this Story's artifacts have never been fed to a real ForgePilot goal preflight.`
