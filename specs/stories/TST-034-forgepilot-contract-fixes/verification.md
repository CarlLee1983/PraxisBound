# Verification Result: TST-034

## Checks

- lint: pass — `pnpm run lint (eslint packages --max-warnings=0) exits 0`
- static: pass — `pnpm run typecheck (tsc --build) exits 0 for both packages`
- unit: pass — `pnpm test (node --test packages/core/test/*.test.mjs
  packages/cli/test/*.test.mjs): 985 tests, 984 pass, 0 fail, 1 skipped by
  design (pre-existing 4 MiB perf smoke gated behind
  PRAXISBOUND_PERF_SMOKE=1, unrelated to this Story) — up from TST-032's 970
  (969 pass, 1 skipped) by this Story's 15 new tests (9 from the first pass,
  6 added in code review follow-up: 2 null-exit mutation-closing tests and 2
  CLI no-write tests). Per-file counts (grep -c "^test(",
  re-verifiable, not stated as ground truth otherwise):
  packages/core/test/review-observation.test.mjs 58 (47 before this Story,
  11 new), packages/cli/test/review-observe.test.mjs 24 (20 before this
  Story, 4 new)`
- integration: pass — `packages/core/test/review-observation.test.mjs
  drives validateForgepilotObservation/validateForgepilotObservationShape
  directly: the schema now accepts execution-plan-failed (schema/AC-004
  unknown-enum test uses a value outside the enum, not this one, to prove
  the enum is still closed); R1's two new stoppedBecause values each get a
  positive case (ending in the matching exit-0 command), a Security Fixture
  Matrix case (row 1: goal-preflight-failed with a non-zero-exit
  goal-preflight; row 2: execution-plan-failed with a work-add last step),
  a "wrong command" case (goal-preflight-failed ending in execution-plan;
  execution-plan-failed ending in a non-zero-exit execution-plan), and — code
  review follow-up MEDIUM-2 — a null-exit case for each, added after the
  reviewer's mutation (`exit === 0` → `exit !== 1` in the built module) left
  every pre-existing test green; each of the four rejection tests per rule
  asserts the specific rejection message, and each rule (including the
  null-exit branch) was independently confirmed load-bearing by mutation
  (see Mutation checks below); AC-004's stdout-not-parsed case has
  goal-preflight-failed accepted even though its stdout claims
  {"diagnostics":[]} (the reverse of what a stdout-parsing tool would
  decide); AC-003 loads all five
  specs/stories/TST-033-forgepilot-rehearsal/evidence/records/forgepilot-*.json
  files (the ones review observe actually accepted during the rehearsal,
  asserted to be exactly 5 — code review follow-up LOW, not merely "at
  least one") and the real, byte-identical Goal Plan Manifest at
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
  is an exit-0 goal-preflight) never depended on parsing that text; two new
  CLI tests (code review follow-up, covering the Security Fixture Matrix
  rows 1-2 "no file" claim end to end) submit the same row-1/row-2 shapes
  through the real command and assert failure/exit 1/REVIEW_OBSERVATION_INVALID
  and that records/ carries no forgepilot-*.json (assertNoForgepilotRecords:
  lstat ENOENT when records/ itself does not exist, or an empty
  forgepilot--prefixed listing when it does)`
- contract: pass — `docs/typescript-tooling/cli-contract.md's review observe
  §22 R3 bullet lists goal-preflight-failed and execution-plan-failed and
  their exit-0-last-step rules, attributed to Story TST-034 and the
  contract §11/§22 amendment; docs/batch-review/agent-workflow.md §3 is
  rewritten to the amended contract §11: the absolute-clean-path
  requirement and its exact ForgePilot rejection message (§3.1), the
  Bootstrap-managed-install requirement for the second segment and its
  rejection message (§3.1), the exit-0-is-not-validation-passed rule and the
  top-level-diagnostics-null-or-empty check (§3.2, §3.3 steps 5–6 — code
  review follow-up MEDIUM-1: reworded from "diagnostics 非 null 或非空",
  which literally also stopped on an empty array, to "頂層 diagnostics 既非
  null 也非空陣列", matching contract.md's own corrected wording and
  excluding nested diagnostics such as a successful execution plan's
  goalPlan.diagnostics), review_policy GOAL in uppercase (§3.3 step 3), the
  execution-plan-request/v2 constraints (runtime/effort/sandbox fixed
  values, executablePath absolute without symlink, caps ordering, expiresAt
  bound and RFC 3339 form) and the engineGeneration source
  (forgepilot-bootstrap generation-v1 current, never a placeholder) in §3.3
  step 6, the ADR-017 entry rule for the second segment (human's session
  statement is the trigger, dry-run is not proof, the real run is the gate,
  and — code review follow-up LOW — its exit-1 refusal is marked as read
  from ForgePilot's source, the second segment never having actually run)
  in §3.4, and --runtime-command <executablePath> on steps 8–9; §3.6/§3.7
  gained the two new stoppedBecause values and their stopping conditions,
  also reworded for the same top-level/nested diagnostics distinction. This
  session also committed, unchanged, the coordinator's own pending edits to
  contract.md (§11 preface and steps 5, 6, 9; §22) and ADR-016/ADR-017
  (Amended-by / Consequences) making the same top-level-diagnostics and
  source-level-exit-1 corrections at the contract layer — see the commit
  list below.`
- e2e: not applicable — `no spawned-binary (dist/bin.js) test was added or
  needed for this Story: the crash class the pre-existing N1 tests guard
  against (an unsafe path reaching a schema-validated envelope field) is
  unrelated to the R1 rule change, which only affects Core's pure
  consistency function and adds no new path-handling code to the CLI; this
  Story's two new CLI no-write tests call runReviewObserve directly, the
  same way every other non-N1 test in the file does, not the packed binary.
  make verify's own composed gate still spawns bin.js through
  tests/typescript-tooling.sh's packed-package-surface and CLI help/version
  checks, unrelated to review observe's stoppedBecause handling.`
- architecture: pass — `Human Review by carl approved this Story for
  execution in a Claude Code session on 2026-09-24, together with the
  contract §11/§22 amendment, ADR-017, and the Corrective classification
  (recorded in story.md's Dependencies); a code review round has since run
  over the finished diff (mergeable, no CRITICAL/HIGH, make verify exit 0)
  and every MEDIUM/LOW finding is fixed in this pass (see the commit list
  below); this session's own re-read of the finished diff against every
  Rule (R1–R4) and every row of the Acceptance Evidence table and Security
  Fixture Matrix found no further gap, but see Residual Risks for what
  remains unverified regardless.`

## Mutation checks (AC-002: each rule shown load-bearing)

Performed by editing the built packages/core/dist/review/forgepilot-observation.js
directly (bypassing tsc's incremental cache, which otherwise leaves a
manually edited dist file in place across an unrelated rebuild — confirmed
this the hard way on the first attempt, then always forced a full rebuild
with `tsc --build --force` immediately after each mutation to restore a
clean baseline before the next one), then re-running
`node --test packages/core/test/review-observation.test.mjs`:

- Deleting the `goal-preflight-failed` case (replacing its body with
  `return undefined;`, i.e. no rejection ever) failed exactly the 2 tests
  that assert a rejection for that value (the non-zero-exit and null-exit
  cases; the "wrong command" and Security Fixture Matrix cases for this
  value both use a non-`goal-preflight` last step, which R2's own step-shape
  checks reject independently — those two stayed green even under this
  mutation, which is expected and does not indicate a gap, since AC-002's
  bar is "each rule shown load-bearing" and both stayed-green cases are
  redundantly covered by R2 already). Every other test, including the
  `execution-plan-failed` ones and AC-003's TST-033 replay, stayed green.
- Deleting the `execution-plan-failed` case the same way (with the
  `goal-preflight-failed` case restored first) failed exactly the 2
  corresponding tests for that value, the same pattern.
- Code review follow-up MEDIUM-2: the reviewer's own mutation — narrowing
  `last.exit === 0` to `last.exit !== 1` for each rule (still correctly
  rejecting exit 1, still correctly accepting exit 0, but wrongly accepting
  a `null` exit) — passed every test that existed before this pass. Adding
  `TST-034/AC-002: goal-preflight-failed whose last step is a null-exit
  goal-preflight is rejected` and its `execution-plan-failed` counterpart
  closed this: re-running the same `exit !== 1` mutation for each rule now
  fails exactly its own new null-exit test and no other.
- The built tree was restored with `tsc --build --force` and the full suite
  re-confirmed green (58/58) after every mutation above.
- Out of scope for this pass (reviewer-flagged, left unfixed and recorded
  here per instruction): the pre-existing `run-failed` R3 branch's
  `last.exit !== 2 && last.exit !== 3 && ... ` condition — removing the
  `last.exit !== 2` conjunct specifically kills no test, because every
  `run-failed` test in the file happens to use an exit value already
  excluded by one of the other conjuncts. This is a gap in the
  *pre-existing* `run-failed` rule's own test coverage, not something this
  Story's R1 change introduced or touches; no test or code change was made
  for it here (see Residual Risks).

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
- Tests: `packages/core/test/review-observation.test.mjs` gained 11 tests
  (a positive case, a Security Fixture Matrix case, a "wrong command" case,
  and a null-exit case for each of the two new `stoppedBecause` values; the
  AC-004 unknown-enum-value rejection; the AC-004 stdout-not-parsed
  acceptance; and AC-003's TST-033-evidence replay, now asserting exactly 5
  records); `packages/cli/test/review-observe.test.mjs` gained 4 (both
  stops accepted end to end through `runReviewObserve`; the Security
  Fixture Matrix row 3 stdout-preserved-verbatim case; the Security Fixture
  Matrix rows 1-2 no-file-written cases). The `N3 (mutation-verified):
  no existing test asserted a step-failed record is REJECTED...` comment
  (pre-existing, TST-032) now again sits directly above its own test
  (`N3/step-failed-rejects-exit-0`); this Story's own new test block was
  moved to follow it, restoring that adjacency (code review follow-up LOW).
- Docs: `docs/batch-review/agent-workflow.md` §3 rewritten to the amended
  contract §11 (see the contract check above for the itemized list, including
  the code review follow-up's top-level-diagnostics wording and the
  source-level exit-1 note); `docs/typescript-tooling/cli-contract.md`'s
  `review observe` §22 R3 bullet extended with the two new values and their
  rules.
- No dependency added; `protocol/`, `templates/`, `VERSION`, and the
  observation `schemaVersion` (`2.0.0`) are unchanged (`git diff --stat main
  -- VERSION protocol/ templates/` is empty).

## Deviations from the Story text (each a decision the reviewer should check)

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
- Code review follow-up: an earlier draft of this document described a
  "synthetic binding" fallback for AC-003 that acceptance.md's own AC-003
  row never named (MEDIUM-3, coordinator-flagged); that paragraph has been
  removed rather than reworded to describe something the test does not do
  — the test binds against the real
  `specs/stories/TST-033-forgepilot-rehearsal/evidence/goal-plan/manifest.json`
  bytes only, with no synthetic path.

## Evidence

- `AC-001`: pass — `packages/cli/test/review-observe.test.mjs:
  "AC-001/both-stops-accepted: a goal-preflight-failed record ending in
  exit-0 goal-preflight, and an execution-plan-failed record ending in
  exit-0 execution-plan, are each accepted and written" — both records are
  accepted (outcome success) and each written byte-for-byte to a distinct
  records/forgepilot-<fp12>-<n>.json`
- `AC-002`: pass — `packages/core/test/review-observation.test.mjs: for each
  of goal-preflight-failed/execution-plan-failed — a Security Fixture
  Matrix case (row 1: non-zero-exit goal-preflight; row 2: work-add last
  step), a "wrong command" case, and a null-exit case (code review
  follow-up MEDIUM-2) — each asserting the specific rejection message and
  confirmed load-bearing by mutation (see Mutation checks above);
  packages/cli/test/review-observe.test.mjs's two new Security Fixture
  Matrix rows 1-2 tests additionally prove no records/forgepilot-*.json is
  written for either rejection, through the real command`
- `AC-003`: pass — `packages/core/test/review-observation.test.mjs:
  "AC-003/tst-033-accepted-observations: every accepted TST-033 rehearsal
  record still passes consistency validation" — exactly the five
  specs/stories/TST-033-forgepilot-rehearsal/evidence/records/forgepilot-*.json
  files (asserted by count, code review follow-up LOW) pass both
  validateForgepilotObservationShape and
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
  ADR-017 entry rule), reworded per code review follow-up MEDIUM-1/LOW;
  docs/typescript-tooling/cli-contract.md lists execution-plan-failed and
  its rule alongside goal-preflight-failed's; git diff --stat main --
  VERSION protocol/ templates/ is empty`

## Authority Used

- plan
- modify
- commit

## Residual Risks

- `A separate confirming code review of this diff has run once in this
  session (mergeable, no CRITICAL/HIGH); every MEDIUM/LOW finding from that
  round is fixed here, but this fix pass has not itself been re-reviewed.`
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
- `Out of scope for this pass (code review follow-up, reviewer-flagged): the
  pre-existing run-failed R3 branch has a conjunct (last.exit !== 2) whose
  removal kills no test in the current suite, because every run-failed test
  happens to use an exit value already excluded by another conjunct. This
  predates this Story (the run-failed rule itself is unchanged) and was
  left unfixed here per the coordinator's instruction to record it as a
  residual risk rather than address it in this Story's scope.`
- `The 0.4.0 release condition and any further ForgePilot follow-up (a
  machine-readable authorization query, or non-zero exits on failed
  goal-preflight/execution-plan validation) remain explicitly out of scope
  (story.md's Out of Scope) and unresolved by this Story.`
