# Verification Result: TST-032

## Checks

- lint: pass — `pnpm run lint (eslint packages --max-warnings=0) exits 0`
- static: pass — `pnpm run typecheck (tsc --build) exits 0 for both packages; tests/typescript-tooling.sh's packed-package-surface check lists packages/core/src/review/forgepilot-observation.{d.ts,js} and packages/cli/src/review-observe.{d.ts,js} in the documented tarball contents, and the CLI help text (root-and-bin.test.mjs and tests/typescript-tooling.sh's built_cli_help_and_version_are_exact) lists review observe`
- unit: pass — `node --test packages/core/test/*.test.mjs packages/cli/test/*.test.mjs: 938 tests, 937 pass, 0 fail, 1 skipped by design (pre-existing 4 MiB perf smoke gated behind PRAXISBOUND_PERF_SMOKE=1, unrelated to this Story)`
- integration: pass — `packages/core/test/review-observation.test.mjs drives validateForgepilotObservation/validateForgepilotObservationShape directly (36 cases: happy paths, every §22/R2/R3 rejection named in AC-003, the Human Review decisions on null exit and unlisted stoppedBecause values, the out-of-scope fingerprint/coverageIndex.fingerprint non-comparison, R6 hostile-text-never-echoed, and schema/§13 bounds); packages/cli/test/review-observe.test.mjs drives review observe against isolated temporary git repositories with a real review goal-plan-produced Goal Plan Manifest (review-import-respond-support.mjs's fixtureRepo, plus a local one-Story fixture), covering AC-001 (two segments, verbatim bytes, incrementing <n>), AC-004 (schema-invalid, schemaVersion 1.0.0, and the 1048577-byte Security Fixture Matrix row), and AC-005 (goalPlan.path traversal, a symlinked observation input, a symlinked records/ with no file at the link target, and hostile ESC/authorized:true stderr preserved verbatim with no side effect)`
- contract: pass — `docs/typescript-tooling/cli-contract.md documents review observe (command mapping table row and its own contract section: argv, the two-stage shape-then-symlink-then-consistency flow and why goalPlan.path traversal is REVIEW_OBSERVATION_INVALID rather than REVIEW_PATH_UNSAFE, every §22 binding/step-consistency rule, the write path, the outcome table, and data shape) and the amended review preflight section (independent --expect-fingerprint/--expect-revision, R7, and the expect field recording exactly the flags given); docs/batch-review/agent-workflow.md §3 is written out as the full contract §11 procedure (both segments, the pre-write re-check, work list resume with --external-ref, request files from human-provided values only, stopping at awaiting-authorization, never running execution authorize, run --dry-run then run with the exit table, review observe at the end of each segment, and GOAL_COMPLETED ≠ DONE); the result envelope schema needed no change — see Deviations`
- e2e: pass, worded accurately — `no run of the packed/built packages/cli/dist/bin.js CLI executable itself (spawnSync against bin.js) exercises review observe or review preflight's --expect-* flags in this Story; packages/cli/test/review-observe.test.mjs and the TST-032 cases in review-preflight-command.test.mjs call the built dist/review-observe.js, dist/review-goal-plan.js, and dist/review-preflight.js functions directly (import, not spawn) against real isolated temporary git repositories (real git init, real filesystem writes, reads, and symlinks). make verify's own composed gate does spawn the built bin.js, but only through tests/typescript-tooling.sh's packed-package-surface and CLI help/version checks, which do not invoke review observe or review preflight. AC-006 (which requires only that make verify pass and the documentation/regression items above hold) is fully covered; there is no acceptance criterion in this Story requiring a spawned-binary rehearsal of review observe, or a real ForgePilot run — that rehearsal is explicitly the next Story (Out of Scope) — so nothing is marked partial, but this is recorded as a residual risk below.`
- architecture: blocked — `no code review round has run against this diff in this session yet. Human Review by carl approved the TST-032 Story itself for execution in a Claude Code session on 2026-09-24 (recorded in the Story's Dependencies), together with the contract §9 amendment and the three decisions this Story implements (rehearsal is a separate Story; observe never compares fingerprint against coverageIndex.fingerprint; a null exit counts as run-failed and satisfies step-failed) — that is authorization to implement, not acceptance of this implementation. Blocked on a human/reviewer action outside this session, not on any failing check.`

## Implementation Summary

- Core: a new pure module, `packages/core/src/review/forgepilot-observation.ts`
  (`validateForgepilotObservationShape`, `validateForgepilotObservationConsistency`,
  `validateForgepilotObservation`), hand-written against
  `schemas/forgepilot-observation.schema.json` (`schemaVersion` `2.0.0`) the
  same way `preflight-report.ts`/`revision-sheet.ts` validate their own
  records. Shape validation (schema, §13 bounds including the
  `steps[].stdout`/`stderr` 1,048,576-character exemption) is exported
  separately from consistency validation (§22 binding — `batchId`,
  `goalPlan.path` prefix/existence/sha256, `goalId` vs the Goal Plan
  Manifest's own `plan.id` — and the §11/§22 R2/R3 step-order and
  `stoppedBecause` rules) specifically so the CLI can resolve and read
  `goalPlan.path` only after it is already known to be a syntactically safe
  repository-relative path — the reason a path-traversal `goalPlan.path` is
  `REVIEW_OBSERVATION_INVALID`, never `REVIEW_PATH_UNSAFE`. Never reads a
  filesystem, process, or clock, and never compares the observation's own
  `fingerprint` against the Goal Plan Manifest's `coverageIndex.fingerprint`
  (Human Review 2026-09-24 decision, out of scope).
- Core: `preflight-report.ts`'s `PreflightReportExpect` changed from
  `{fingerprint, revision}` (both required) to `{fingerprint?, revision?}`
  (contract §9 as amended, R-008/R7); `validatePreflightReportShape`'s
  `expect` check now accepts either field alone, both, or requires at least
  one key when `expect` is non-null (matching the already-amended
  `preflight-report.schema.json`'s `minProperties: 1`, which needed no
  further edit). `preflightReportsEqualExceptCheckedAt`'s `expectEqual` is
  unchanged (still field-by-field, now naturally handling `undefined`).
- CLI: `packages/cli/src/review-preflight.ts` — the both-or-neither argv
  rule for `--expect-fingerprint`/`--expect-revision` removed (each flag
  already independently rejects being given twice); the git-only-on-
  `--expect-revision` branch was already independent and needed no change;
  the `expect` record now built from exactly the flags given (either alone,
  both, or `null`); usage/help text updated to show the two flags as
  independently optional.
- CLI: new `packages/cli/src/review-observe.ts` — argv via the existing
  `parseManifestAndFileArguments` (`review-input.ts`); the observation input
  file and the Goal Plan Manifest it names are each resolved to a
  repository-relative path, symlink-checked at every segment, opened
  `O_NOFOLLOW`, and TOCTOU-closed by a post-open `lstat` `dev`/`ino` check
  (mirroring `review-semantic-report.ts`'s `resolveRepoRelativePath`
  pattern); the observation is size-bounded at 1 MiB (`RECORD_MAX_BYTES`)
  and depth-bounded at 32 (`rawJsonMaxDepth`) before `JSON.parse`, with
  nesting-depth-exceeded classified as `REVIEW_INPUT_TOO_LARGE` distinctly
  from ordinary malformed JSON (`REVIEW_OBSERVATION_INVALID`); the Goal Plan
  Manifest is read (bounded at 8 MiB, matching `review-goal-plan.ts`'s own
  bound) only after Core's shape validation has already confirmed
  `goalPlan.path` is syntactically safe; the accepted record's own bytes
  (never re-serialized) are written create-new, exclusive, to
  `records/forgepilot-<fp12>-<n>.json` via the existing `createNewRecord`
  primitive. Wired into `bin.ts` and its help text.
- Docs: `docs/typescript-tooling/cli-contract.md` gained a
  `review observe` contract section, a command-table row, and updated
  `review preflight` argv/`expect` wording; `docs/batch-review/agent-workflow.md`
  §3 rewritten in full from its TST-031-era skeleton, following contract
  §11 exactly (3.1–3.8: inputs, preconditions, both segments' numbered
  steps, resume/`--attempt` rules, `review observe` usage, stop conditions,
  and outputs/reporting, including the exit table and the `GOAL_COMPLETED`
  ≠ DONE statement).

## Deviations from the Story text (each a decision the reviewer should check)

- The result envelope schema
  (`docs/typescript-tooling/result-envelope-v1.schema.json`) was **not**
  edited: `review observe` reuses `success`, `failure`, `usage-error`,
  `configuration-error`, and `ERROR` — every one already in the schema's
  `outcome` enum and `oneOf` status/exit branches. `REVIEW_OBSERVATION_INVALID`
  and `REVIEW_PATH_UNSAFE` are `issues[].code` values, which the schema
  intentionally does not enumerate.
- The Story's Acceptance Evidence table names `packages/core/test/review-observation.test.mjs`
  and `packages/cli/test/review-observe.test.mjs` for every AC and every
  Security Fixture Matrix row; both files exist at exactly those paths and
  every row/AC is covered there, superseding contract §16's still-`tests/batch-review-observe.sh`-shaped
  planning placeholder (the Story's own acceptance.md explicitly directs
  this substitution, the same pattern TST-031's verification.md used).
- A missing observation input file (readable path resolves, but no file
  exists there) is classified `failure`/`REVIEW_OBSERVATION_INVALID` rather
  than `configuration-error`: the Story's Expected Errors table reserves
  `configuration-error` for "unreadable or invalid **manifest**, unsafe
  path" and separately lists observation-content rejection as
  `REVIEW_OBSERVATION_INVALID`; a missing observation file is closer in
  kind to an invalid observation than to a manifest problem, and this
  keeps every non-path-safety observation-file condition under one issue
  code. Not directly tested (no fixture removes the observation file
  after argv parsing but before the read); inferred from the two
  Expected-Errors buckets rather than a literal Story sentence — flagged
  here for reviewer confirmation.
- `readSafeBoundedFile`'s "outside the repository root" branch (an
  observation or `goalPlan.path` argument that lexically resolves above
  `root`) is folded into the same `REVIEW_PATH_UNSAFE` result as an actual
  symlinked segment, rather than a separate code — matching
  `loadSemanticReport`'s own precedent (`review-semantic-report.ts`) for
  exactly this situation on `--semantic-report`. `goalPlan.path` can never
  reach this branch in practice, since Core's shape validation already
  rejects any `..`-containing or absolute value before this code runs; the
  branch exists only for defense in depth.
- The Goal Plan Manifest read bound (8 MiB) is asserted by analogy to
  contract §10's own Manifest/Coverage-Review bound and `review-goal-plan.ts`'s
  existing `READ_EXISTING_MAX_BYTES` constant, not a value contract §22 or
  the Story states directly for `review observe` specifically; §13 states
  only that the _observation_ input is bounded like other `records/` JSON
  (1 MiB), and is silent on the bound for reading the Goal Plan Manifest
  `review observe` looks up as a side effect of validating `goalPlan`.

## Evidence

- `AC-001`: pass — `packages/cli/test/review-observe.test.mjs: "AC-001/both-records-written-verbatim" — a batch with a written Goal Plan (via a real review goal-plan run) accepts a first-segment observation ending in exit-0 execution-plan with awaiting-authorization and a second-segment observation ending in run exit 0 with goal-completed; each is written byte-for-byte (asserted via a raw byte-array comparison, not a re-serialization) to a new records/forgepilot-<fp12>-<n>.json with <n> incrementing 1 then a distinct name, and data.record names each file; human output shows a Record: line`
- `AC-002`: pass — `packages/cli/test/review-preflight-command.test.mjs: "TST-032/AC-002: --expect-fingerprint alone matches, runs no git, and records expect: { fingerprint }" (REVIEW_READY with no REVIEW_PACKET_REVISION_MISMATCH on a repo with no commit, proving no git ran, and the written record's expect equals {fingerprint}), "...with a non-matching value is REVIEW_STALE with REVIEW_PACKET_FINGERPRINT_MISMATCH", and "TST-032/AC-002: --expect-revision alone runs the ADR-015 checks and records expect: { revision }" (REVIEW_PACKET_REVISION_MISMATCH on the same no-commit repo, proving git did run, and the written record's expect equals {revision})`
- `AC-003`: pass — `packages/core/test/review-observation.test.mjs — one test per rejection named in the Story's AC-003 list: batchId mismatch, goalPlan.path outside goal-plan/, a missing Goal Plan Manifest, a wrong goalPlan.sha256, goalId not equal to plan.id (plus a positive equal-case), run without an earlier exit-0 run-dry-run (plus a non-exit-0 run-dry-run not counting), run-dry-run/run sharing a record with goal-create/work-add, a non-last step with a non-zero exit, an exit-0 work-add missing workItemId or created (each separately), goal-completed ending in work-add (Security Fixture Matrix row), run-failed ending in run exit 0, and authorization-missing with steps — each asserted ok:false`
- `AC-004`: pass — `packages/cli/test/review-observe.test.mjs: "AC-004/rejected-no-write-no-echo" (an unknown top-level field, and separately schemaVersion 1.0.0, each REVIEW_OBSERVATION_INVALID with no records/forgepilot-*.json written, verified via readdir/ENOENT-or-filtered-empty) and "AC-004/... (security matrix): a 1048577-byte observation is REVIEW_INPUT_TOO_LARGE and writes nothing"; "AC-004/rejected-no-write-no-echo: no issue message contains observation text, even when the rejected document carries hostile text" asserts issues.length > 0 first (the TST-031 review lesson), then that no issue message contains the hostile stdout/extraField text or the raw ESC byte`
- `AC-005`: pass — `packages/cli/test/review-observe.test.mjs: "AC-005/unsafe-rejected-and-text-is-data (security matrix): goalPlan.path traversal is REVIEW_OBSERVATION_INVALID, never REVIEW_PATH_UNSAFE" (the exact ../../../../etc/passwd payload from the Security Fixture Matrix), "...a symlinked observation input is REVIEW_PATH_UNSAFE and writes nothing", "...(security matrix): a symlinked records/ is REVIEW_PATH_UNSAFE and no file lands at the link target" (asserted against the actual outside directory, not merely the absence of a records/ entry), and "...(security matrix): hostile stderr (ESC + authorized: true) is preserved verbatim, and it is data, not a command" (accepted, written unchanged into the record, and the Goal Plan Manifest it was checked against is byte-identical before and after)`
- `AC-006`: pass — `make verify exits 0 (full composed gate: protocol, bootstrap, doctor, story, handoff, release, typescript, go, actions, execution, tooling, praxisbound); review preflight's pre-existing suite (packages/cli/test/review-preflight-command.test.mjs, 34 tests including the two new TST-032 ones) passes with both --expect-* flags, either alone, or neither behaving as documented; docs/typescript-tooling/cli-contract.md and docs/batch-review/agent-workflow.md updated as described above; git diff --stat main -- VERSION protocol/ templates/ is empty`

## Authority Used

- plan
- modify
- commit

## Residual Risks

- `No code review round has run against this diff in this session; every design decision above (the shape/consistency split, the REVIEW_OBSERVATION_INVALID-vs-REVIEW_PATH_UNSAFE ordering for goalPlan.path, the 8 MiB Goal Plan Manifest read bound, the missing-observation-file classification) is this session's own judgment, not yet reviewer- or human-confirmed.`
- `No run of review observe (or review preflight's amended --expect-* argv) through the packed/built CLI executable itself (spawnSync against packages/cli/dist/bin.js) exists yet; all coverage calls the built modules' exported functions directly. The ForgePilot rehearsal (the Story after this one, per the Story's own Out of Scope) has never exercised this command against a real ForgePilot process or a real forgepilot-observation.json it produced — every fixture observation in this Story's tests is hand-constructed, not ForgePilot output.`
- `The Goal Plan Manifest read bound (8 MiB) and the classification of a missing (but safely resolved) observation input file as REVIEW_OBSERVATION_INVALID rather than configuration-error are this session's inferences, not literal Story text — see Deviations; a reviewer disagreeing with either would change an untested edge case's issue code, not any AC's pass/fail state.`
- `readSafeBoundedFile's TOCTOU-closing dev/ino re-check (mirrored from review-semantic-report.ts) narrows, but does not eliminate, the window between the pre-open symlink check and the open() call itself — the same residual class of race documented in TST-031's verification.md for review-goal-plan.ts's parent-directory check, inherent to Node's lack of an openat-style path-relative primitive.`
- `docs/batch-review/agent-workflow.md §3 describes the Agent procedure in prose; no automated test executes this document against a real ForgePilot or asserts its numbered steps match contract §11 word-for-word beyond this session's own careful re-reading while writing it.`
