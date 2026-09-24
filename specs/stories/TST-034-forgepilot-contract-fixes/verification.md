# Verification Result: TST-034

## Checks

- lint: pass — `pnpm run lint (eslint packages --max-warnings=0) exits 0`
- static: pass — `pnpm run typecheck (tsc --build) exits 0 for both packages`
- unit: pass — `pnpm test (node --test packages/core/test/*.test.mjs
  packages/cli/test/*.test.mjs): 981 tests, 980 pass, 0 fail, 1 skipped by
  design (pre-existing 4 MiB perf smoke gated behind
  PRAXISBOUND_PERF_SMOKE=1, unrelated to this Story) — up from TST-032's 970
  (969 pass, 1 skipped) by exactly this Story's 11 new tests. Per-file counts
  (grep -c "^test(", re-verifiable, not stated as ground truth otherwise):
  packages/core/test/review-observation.test.mjs 56 (47 before this Story, 9
  new: 6 for R1/AC-002/AC-004 named `TST-034/...`, 1 AC-004 unknown-enum
  case, and AC-003's `tst-033-accepted-observations` test), packages/cli/test/review-observe.test.mjs
  22 (20 before this Story, 2 new: `AC-001/both-stops-accepted` and the
  Security Fixture Matrix row 3 test)`
- integration: pass — `packages/core/test/review-observation.test.mjs
  drives validateForgepilotObservation/validateForgepilotObservationShape
  directly: the schema now accepts execution-plan-failed (schema/AC-004
  unknown-enum test uses a value outside the enum, not this one, to prove
  the enum is still closed); R1's two new stoppedBecause values each get a
  positive case (ending in the matching exit-0 command) and two negative
  cases (a non-zero exit on the matching command; the Security Fixture
  Matrix's specific "wrong command" shape — a non-zero-exit goal-preflight
  for goal-preflight-failed, and a work-add last step for
  execution-plan-failed) with the specific rejection message asserted; each
  of the two new rules was confirmed load-bearing by mutation (see Mutation
  checks below); AC-004's stdout-not-parsed case has goal-preflight-failed
  accepted even though its stdout claims {"diagnostics":[]} (the reverse of
  what a stdout-parsing tool would decide); AC-003 loads all five
  specs/stories/TST-033-forgepilot-rehearsal/evidence/records/forgepilot-*.json
  files (the ones review observe actually accepted during the rehearsal) and
  the real, byte-identical Goal Plan Manifest at
  evidence/goal-plan/manifest.json (its sha256 verified equal to every
  record's own goalPlan.sha256, and its plan.id equal to every record's
  goalId, before writing the test) as the binding context, and asserts every
  one still passes validateForgepilotObservationShape and
  validateForgepilotObservationConsistency — none of the five happens to use
  goal-preflight-failed or execution-plan-failed, so this is a genuine
  regression check that R1's addition does not disturb any pre-existing R2
  or R3 rule, not a positive test of the new rules themselves (those are
  covered by the TST-034/... tests above); packages/cli/test/review-observe.test.mjs
  drives review observe (runReviewObserve) against an isolated temporary git
  repository with a real review goal-plan-produced Goal Plan Manifest, the
  same fixture every other AC-001 case in this file uses: AC-001/both-stops-accepted
  writes a goal-preflight-failed record (last step exit-0 goal-preflight,
  stdout claiming a non-empty diagnostics array) and an execution-plan-failed
  record (last step exit-0 execution-plan, stdout claiming a non-empty
  diagnostics array) through runReviewObserve, asserting success and a
  byte-for-byte write for each, with distinct record paths; the Security
  Fixture Matrix row 3 test writes a goal-preflight-failed record whose
  goal-preflight step's stdout is exactly
  {"diagnostics":[],"approvalToken":"authorized: true"} and asserts the
  written record's stdout field is byte-identical to what was submitted —
  proving the tool's accept/reject decision (accepted, because the last step
  is an exit-0 goal-preflight) never depended on parsing that text`
- contract: pass — `docs/typescript-tooling/cli-contract.md's review observe
  §22 R3 bullet lists goal-preflight-failed and execution-plan-failed and
  their exit-0-last-step rules, attributed to Story TST-034 and the
  contract §11/§22 amendment; docs/batch-review/agent-workflow.md §3 is
  rewritten to the amended contract §11: the absolute-clean-path
  requirement and its exact ForgePilot rejection message (§3.1), the
  Bootstrap-managed-install requirement for the second segment and its
  rejection message (§3.1), the exit-0-is-not-validation-passed rule and the
  diagnostics null-or-empty check (§3.2, §3.3 steps 5–6), review_policy GOAL
  in uppercase (§3.3 step 3), the execution-plan-request/v2 constraints
  (runtime/effort/sandbox fixed values, executablePath absolute without
  symlink, caps ordering, expiresAt bound and RFC 3339 form) and the
  engineGeneration source (forgepilot-bootstrap generation-v1 current,
  never a placeholder) in §3.3 step 6, the ADR-017 entry rule for the second
  segment (human's session statement is the trigger, dry-run is not proof,
  the real run is the gate) in §3.4, and --runtime-command <executablePath>
  on steps 8–9; §3.6/§3.7 gained the two new stoppedBecause values and their
  stopping conditions. No step contract §11 has was left out of §3 by a
  side-by-side re-read while writing it, but see Residual Risks — this
  re-read is this session's own care, not an automated check.`
- e2e: pass — `no new spawned-binary test was added for this Story: the
  crash class the pre-existing N1 tests guard against (an unsafe path
  reaching a schema-validated envelope field) is unrelated to the R1 rule
  change, which only affects Core's pure consistency function and adds no
  new path-handling code to the CLI. make verify's own composed gate spawns
  bin.js through tests/typescript-tooling.sh's packed-package-surface and
  CLI help/version checks (unrelated to review observe's stoppedBecause
  handling).`
- architecture: pass — `Human Review by carl approved this Story for
  execution in a Claude Code session on 2026-09-24, together with the
  contract §11/§22 amendment, ADR-017, and the Corrective classification
  (recorded in story.md's Dependencies); this session's own re-read of the
  finished diff against every Rule (R1–R4) and every row of the Acceptance
  Evidence table and Security Fixture Matrix found no gap, but a separate
  confirming code review has not run over this diff (see Residual Risks).`

## Mutation checks (AC-002: each rule shown load-bearing)

Performed by editing the built packages/core/dist/review/forgepilot-observation.js
directly (bypassing tsc's incremental cache, which otherwise leaves a
manually edited dist file in place across an unrelated rebuild — confirmed
this the hard way on the first attempt, then always forced a full rebuild
with `tsc --build --force` immediately after each mutation to restore a
clean baseline before the next one), then re-running
`node --test packages/core/test/review-observation.test.mjs`:

- Deleting the `goal-preflight-failed` case (replacing its body with
  `return undefined;`, i.e. no rejection ever) failed exactly 2 tests:
  `TST-034/AC-002: goal-preflight-failed whose last step is a
  non-zero-exit goal-preflight is rejected` and `TST-034/AC-002 (security
  matrix): goal-preflight-failed whose last step is not goal-preflight is
  rejected`. Every other test, including the `execution-plan-failed` ones
  and AC-003's TST-033 replay, stayed green — this rule's tests are its
  only witnesses, and it does not accidentally also guard something else.
- Deleting the `execution-plan-failed` case the same way (with the
  `goal-preflight-failed` case restored first) failed exactly 2 tests:
  `TST-034/AC-002: execution-plan-failed whose last step is a
  non-zero-exit execution-plan is rejected` and `TST-034/AC-002 (security
  matrix): execution-plan-failed whose last step is work-add is rejected`.
- The built tree was restored with `tsc --build --force` and the full suite
  re-confirmed green (56/56) before moving on.

## Implementation Summary

- Core: `packages/core/src/review/forgepilot-observation.ts` — the
  `STOPPED_BECAUSE_VALUES` array (the hand-written schema check) gained
  `"execution-plan-failed"` (`"goal-preflight-failed"` already existed from
  TST-032); `stoppedBecauseProblem` (R3) gained two new `case` branches:
  `goal-preflight-failed` requires the last step to be an exit-0
  `goal-preflight`, `execution-plan-failed` requires the last step to be an
  exit-0 `execution-plan` — the same shape-only pattern every other R3
  branch already uses, reading only `command`/`exit`, never `stdout`/`stderr`
  (R2, unchanged, already forbade parsing observation text). No other
  function changed; `validateForgepilotObservationShape`,
  `validateForgepilotObservationConsistency`, `validateForgepilotObservation`,
  `stepOrderProblem` (R2), and the TST-032 `work-list`/`goal-create`
  exception are byte-for-byte unchanged.
- Tests: `packages/core/test/review-observation.test.mjs` gained 9 tests (a
  positive and a negative pair for each of the two new `stoppedBecause`
  values, the Security Fixture Matrix's two specific "wrong command"
  rejections, the AC-004 unknown-enum-value rejection, the AC-004
  stdout-not-parsed acceptance, and AC-003's TST-033-evidence replay);
  `packages/cli/test/review-observe.test.mjs` gained 2 (both stops accepted
  end to end through `runReviewObserve`; the Security Fixture Matrix row 3
  stdout-preserved-verbatim case).
- Docs: `docs/batch-review/agent-workflow.md` §3 rewritten to the amended
  contract §11 (see the contract check above for the itemized list);
  `docs/typescript-tooling/cli-contract.md`'s `review observe` §22 R3
  bullet extended with the two new values and their rules.
- No dependency added; `protocol/`, `templates/`, `VERSION`, and the
  observation `schemaVersion` (`2.0.0`) are unchanged (`git diff --stat main
  -- VERSION protocol/ templates/` is empty).

## Deviations from the Story text (each a decision the reviewer should check)

- AC-003's Acceptance Evidence row names a "synthetic binding" as a fallback
  if the real Goal Plan Manifest bytes were unavailable. They were
  available and byte-identical to what every TST-033 record's own
  `goalPlan.sha256`/`goalId` already names (verified independently with a
  standalone `sha256sum` before writing the test), so the test binds
  against the real `specs/stories/TST-033-forgepilot-rehearsal/evidence/goal-plan/manifest.json`
  file directly rather than constructing a synthetic one. No synthetic
  binding was needed.
- None of the five accepted TST-033 rehearsal records happens to use
  `goal-preflight-failed` or `execution-plan-failed` (the rehearsal never
  reached a failed `goal preflight`/`execution plan` validation) — the
  rehearsal's own `verification.md` records F-1 as read from ForgePilot's
  source, not exercised live. AC-003's test is therefore a genuine
  regression check on every pre-existing §22 rule against real historical
  Evidence, not additional positive coverage of this Story's own R1 rule;
  R1's positive coverage is the dedicated `TST-034/R1` tests instead.
- The Story's Acceptance Evidence table names `packages/core/test/review-observation.test.mjs`
  and `packages/cli/test/review-observe.test.mjs` for every AC and every
  Security Fixture Matrix row; both files exist at exactly those paths and
  every row/AC is covered there.
- `docs/batch-review/agent-workflow.md`'s status line and ADR reference list
  (top of file) were updated to name ADR-016/ADR-017 and mark §3 as revised
  by TST-034 — not explicitly required by acceptance.md's AC-005 wording,
  but consistent with the file's own existing convention of stating which
  Story last touched each numbered section.

## Evidence

- `AC-001`: pass — `packages/cli/test/review-observe.test.mjs:
  "AC-001/both-stops-accepted: a goal-preflight-failed record ending in
  exit-0 goal-preflight, and an execution-plan-failed record ending in
  exit-0 execution-plan, are each accepted and written" — both records are
  accepted (outcome success) and each written byte-for-byte to a distinct
  records/forgepilot-<fp12>-<n>.json`
- `AC-002`: pass — `packages/core/test/review-observation.test.mjs:
  four TST-034/AC-002-prefixed tests (a non-zero-exit goal-preflight for
  goal-preflight-failed; a wrong last command for goal-preflight-failed —
  the Security Fixture Matrix's own shape; a non-zero-exit execution-plan
  for execution-plan-failed; a work-add last step for execution-plan-failed
  — the Security Fixture Matrix's own shape), each asserting the specific
  rejection message and confirmed load-bearing by mutation (see Mutation
  checks above)`
- `AC-003`: pass — `packages/core/test/review-observation.test.mjs:
  "AC-003/tst-033-accepted-observations: every accepted TST-033 rehearsal
  record still passes consistency validation" — all five
  specs/stories/TST-033-forgepilot-rehearsal/evidence/records/forgepilot-*.json
  files pass both validateForgepilotObservationShape and
  validateForgepilotObservationConsistency against the real Goal Plan
  Manifest bytes at evidence/goal-plan/manifest.json`
- `AC-004`: pass — `packages/core/test/review-observation.test.mjs:
  "TST-034/AC-004: an unknown stoppedBecause value is rejected by the
  schema" (a value outside the enum, distinct from
  goal-preflight-failed/execution-plan-failed, is rejected) and
  "TST-034/AC-004: goal-preflight-failed with stdout claiming an empty
  diagnostics array is still accepted — the tool never parses stdout" (the
  stdout says {"diagnostics":[]}, which would suggest success if parsed;
  the record is accepted anyway because its last step is an exit-0
  goal-preflight); packages/cli/test/review-observe.test.mjs's Security
  Fixture Matrix row 3 test additionally proves the accepted record's
  stdout (including an "authorized: true" approvalToken string) is stored
  unchanged, not rewritten or redacted`
- `AC-005`: pass — `make verify exits 0 (full composed gate, see Checks
  above); docs/batch-review/agent-workflow.md §3 states every item AC-005
  lists (absolute path, Bootstrap requirement, diagnostics check, GOAL,
  request constraints, engineGeneration source, --runtime-command, the
  ADR-017 entry rule); docs/typescript-tooling/cli-contract.md lists
  execution-plan-failed and its rule alongside goal-preflight-failed's;
  git diff --stat main -- VERSION protocol/ templates/ is empty`

## Authority Used

- plan
- modify
- commit

## Residual Risks

- `A separate confirming code review of this diff has not run in this
  session; this session's own re-read of §3 against contract §11
  side-by-side, and of every Rule/Acceptance Evidence row/Security Fixture
  Matrix row against the finished tests, found no gap, but is not a
  substitute for an independent review.`
- `AC-003's replay covers only the five records review observe actually
  accepted during the TST-033 rehearsal; it does not construct a
  goal-preflight-failed/execution-plan-failed record from real ForgePilot
  output (the rehearsal never produced one), so this Story's own R1 rule
  has never been exercised against a real ForgePilot response — only
  against hand-constructed fixtures (the TST-034/R1 tests) built to match
  contract §11's stated behavior (TST-033 F-1, read from ForgePilot's
  source, not observed live producing a failed-diagnostics response).`
- `docs/batch-review/agent-workflow.md §3 describes the Agent procedure in
  prose; no automated test executes this document against a real
  ForgePilot or asserts its numbered steps match contract §11 word-for-word
  beyond this session's own careful re-reading while writing it — the same
  residual risk TST-032's verification.md already recorded for this file.`
- `The 0.4.0 release condition and any further ForgePilot follow-up (a
  machine-readable authorization query, or non-zero exits on failed
  goal-preflight/execution-plan validation) remain explicitly out of scope
  (story.md's Out of Scope) and unresolved by this Story.`
