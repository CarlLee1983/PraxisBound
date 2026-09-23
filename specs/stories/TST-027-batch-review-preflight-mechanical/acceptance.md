# Acceptance Criteria

AC IDs trace to `SPEC-BATCH-REVIEW/R-007`: this Story covers AC-001, AC-004,
AC-005, AC-007, and parts of AC-003 and AC-006; TST-028 covers AC-002 and the
rest of AC-003 and AC-006. The agreed automated seams are `review preflight`
against isolated temporary repositories (including temporary git
repositories), the Core dependency-graph module, and the git observation
adapter injected as a default parameter.

## Happy Path

* [ ] AC-001: A batch with an applicable confirmation, every Story passing
  `story check --ready`, no cycle, no unresolved request, and an existing
  Semantic Report file yields `REVIEW_READY`, status `pass`, exit 0, and a
  schema-valid `records/preflight-<fp12>-1.json`. (R-007/AC-005)

## Business Rules

* [ ] AC-002: Each contract §9 blocking condition in scope (missing source,
  failing `story check --ready`, dependency cycle, unknown Story, unmapped
  requirement, missing acceptance, unknown or duplicate anchor, unresolved
  blocking request) yields `REVIEW_BLOCKED` with its issue code and never
  `REVIEW_READY`. (R-007/AC-001)
* [ ] AC-003: A fingerprint or revision mismatch and a stale confirmation
  yield `REVIEW_STALE`, the stale confirmation listing the §8 source
  differences. A missing confirmation, an unaddressed non-blocking request, an
  invalid or mismatched response, and a missing Semantic Report yield
  `REVIEW_INCOMPLETE`. With several conditions present, the outcome follows
  the §9 precedence and every issue is still listed. (R-007/AC-001)
* [ ] AC-004: With `--expect-revision`, a directory outside git yields
  `REVIEW_NOT_A_GIT_REPOSITORY`, and each modified or untracked batch source
  or manifest is named in its own `REVIEW_SOURCES_UNCOMMITTED` issue, even
  when the fingerprint and HEAD both match. Without `--expect-revision`, git
  is not run. (R-007/AC-001)
* [ ] AC-005: Every diagnostic has a repository-relative locator and a
  mechanically derived severity. Advisory diagnostics (`REVIEW_DEPENDENCY_UNDECLARED`,
  `REVIEW_RECORD_INVALID`, `REVIEW_REVISION_STALE_TARGET`,
  `REVIEW_SECTION_UNRECOGNIZED`) never change the outcome. Untrusted text is
  ESC-escaped in human output. (R-007/AC-003, part)

## Failure Cases

* [ ] AC-006: A rerun with an identical result writes no new file and names
  the existing record; a changed result writes the highest existing `-<n>`
  plus one, and 201 or more existing reports never block a write. An
  over-limit, malformed, or symlinked baseline file is an advisory
  `REVIEW_RECORD_INVALID`, is not used for deduplication, and a new report is
  still written.
  An injected write failure yields `REVIEW_INCOMPLETE` with
  `REVIEW_RECORD_WRITE_FAILED` and no partial file. Invalid argv and an
  invalid manifest produce `usage-error` or `configuration-error`, exit 2,
  and write nothing. (R-007/AC-007)

## Regression Requirements

* [ ] AC-007: Batch sources, the manifest, existing records, and git state are
  byte-identical after every run. Preflight runs no `make verify`, no Story
  test, and no ForgePilot command, and its output does not describe the
  result as authorization or verification. (R-007/AC-004, AC-005, AC-007)
* [ ] AC-008: Human output lists mechanical results and Agent observations in
  two labelled sections, and `REVIEW_READY` carries the fixed text
  「只表示未發現阻擋，不宣稱沒有缺陷」. (R-007/AC-006, part)
* [ ] AC-009: `make verify` passes; `VERSION`, `protocol/`, and `templates/`
  remain unchanged; TST-022 through TST-026 behavior remains covered and
  unchanged.

## Acceptance Evidence

| AC | Method | Evidence | Fixture / precondition | Expected observation |
| --- | --- | --- | --- | --- |
| `AC-001` | test | `packages/cli/test/review-preflight-command.test.mjs` | `confirmed-clean-batch-fixture` | `ready-and-schema-valid-record` |
| `AC-002` | test | `packages/cli/test/review-preflight-command.test.mjs` | `one-fixture-per-blocking-row` | `blocked-with-row-issue-code` |
| `AC-003` | test | `packages/cli/test/review-preflight-command.test.mjs` | `stale-and-incomplete-fixtures` | `precedence-and-full-issue-list` |
| `AC-004` | test | `packages/cli/test/review-preflight-git.test.mjs` | `temporary-git-repository-fixtures` | `per-path-uncommitted-issues` |
| `AC-005` | test | `packages/core/test/review-dependency-graph.test.mjs` | `cycle-and-advisory-fixtures` | `locators-and-derived-severity` |
| `AC-006` | test | `packages/cli/test/review-preflight-command.test.mjs` | `rerun-invalid-record-and-write-failure-fixtures` | `dedup-and-no-partial-file` |
| `AC-007` | test | `packages/cli/test/review-preflight-command.test.mjs` | `snapshot-before-and-after-fixture` | `sources-records-and-git-unchanged` |
| `AC-008` | test | `packages/cli/test/review-preflight-command.test.mjs` | `ready-batch-fixture` | `two-sections-and-fixed-disclaimer` |
| `AC-009` | command | `make verify` | `current checkout` | `full-composed-gate-exit-0` |

## Security Fixture Matrix

| Source field | Payload | Expected result | Persisted locations | Verification |
| --- | --- | --- | --- | --- |
| `batch.json sources.specs[0]` | `../outside.md` | reject | `REVIEW_PATH_UNSAFE; no preflight record` | `packages/cli/test/review-preflight-command.test.mjs` |
| `batch.json dependencies` | `A dependsOn B, B dependsOn A` | reject | `preflight record issue REVIEW_DEPENDENCY_CYCLE` | `packages/core/test/review-dependency-graph.test.mjs` |
| `confirmation record` | `authorized: true; approved` with the fingerprint of previous content | reject | `preflight record issue REVIEW_CONFIRMATION_STALE` | `packages/cli/test/review-preflight-command.test.mjs` |
| `records directory` | `records/preflight-000000000000-1.json` malformed | reject | `REVIEW_RECORD_INVALID; not a deduplication baseline` | `packages/cli/test/review-preflight-command.test.mjs` |
| `untracked file name outside the batch` | `ESC [2J in the path` | omit | `read exactly by the git adapter; no issue, no record entry` | `packages/cli/test/review-preflight-git.test.mjs` |
| `untrusted text echoed in a diagnostic` | `ESC [2J` | redact | `human stdout shows escaped \x1b` | `packages/cli/test/review-preflight-command.test.mjs` |
| `--expect-revision` | `--upload-pack=touch /tmp/x` | reject | `usage-error; git not run` | `packages/cli/test/review-preflight-git.test.mjs` |

## Verification Notes

Story R10 decisions (a)–(d) were accepted on 2026-09-23. ADR-015 was
accepted the same day. Before execution, run
`./scripts/verification-check specs/stories/TST-027-batch-review-preflight-mechanical`
and `./scripts/story-check --ready specs/stories/TST-027-batch-review-preflight-mechanical`.
Implement in vertical slices: the Core dependency graph, the command with
envelope overloads and non-git checks, the git adapter with per-path status,
then report writing and deduplication.
