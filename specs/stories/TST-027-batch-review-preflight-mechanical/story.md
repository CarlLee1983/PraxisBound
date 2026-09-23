# Story: TST-027 Batch Review Mechanical Preflight and Report

## Goal

After a human confirms a batch of definitions, one read-only command answers
whether the batch can be handed to execution. `review preflight` runs every
mechanical check in contract §9. It reports each problem at its source and
writes a Preflight Report as historical Evidence. It never claims a READY
batch has no defects, and it never reports READY unless a Semantic Report was
provided.

## Context

GitHub issue #89 traces this work to `SPEC-BATCH-REVIEW/R-007`, which is
blocked by R-006. TST-026 (#109) delivered `review confirm` and the Core
applicability and source-comparison function that this Story reuses.
`ADR-014` fixes that preflight is Evidence, not authority. Contract §9 already
defines the command line, the check table, the issue codes, and the outcome
precedence. §2, §12, §13, §15, and §16 define the record, the outcomes, the
limits, and the security baseline. `schemas/preflight-report.schema.json` and
`examples/records/preflight.json` exist.

R-007 is split in two. This Story covers the mechanical checks and the report.
TST-028 adds Semantic Report parsing, schema and fingerprint validation,
coverage, and blocking decisions. Until TST-028 lands, this Story only checks
that the `--semantic-report` file exists. A missing report is
`REVIEW_SEMANTIC_MISSING`. Any existing file still lets the outcome reach
READY, so this Story does not merge to main on its own: TST-028 is stacked on
its branch and both merge together (R10).

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
* Decision: `ADR-014`
* Decision: `ADR-015`
* Boundary: `review preflight CLI command`
* Boundary: `review dependency graph Core module`
* Boundary: `release git adapter`
* Boundary: `result envelope outcome overloads`
* Contract: `preflight is read-only against every batch source and manifest; its only write is a create-new records/preflight-<fp12>-<n>.json`
* Contract: `the uncommitted-change check runs git; it never infers a clean tree from a matching fingerprint and HEAD`
* Contract: `REVIEW_READY means no blocker was found; it grants no execution authority and writes no lifecycle, Gate, or ForgePilot state`
* Owner: `review preflight CLI command = PraxisBound tooling`
* Owner: `review dependency graph Core module = PraxisBound tooling`
* Owner: `release git adapter = PraxisBound tooling`

## Risk

* Level: high
* Reason: `security`
* Reason: `public-contract`
* Signal: `bounded-capacity`
* Signal: `error-projection`

## Capacity

* Bounded resource: `the one preflight file read per run as the deduplication baseline, and the diagnostics in one report`
* Limit: `contract §13 (修訂性澄清，R-007): each run reads at most one existing preflight file, the highest -<n> under the current fp12, bounded at 1 MiB, depth 32, and 64 KiB per string; one report holds ≤ 10000 diagnostics`
* Saturation behavior: `an over-limit, malformed, or symlinked baseline file is an advisory REVIEW_RECORD_INVALID, never used for deduplication, and a new report is still written; over 10000 diagnostics is ERROR, exit 3, with no truncation`
* Failure projection: `a report write failure lowers the outcome to REVIEW_INCOMPLETE with REVIEW_RECORD_WRITE_FAILED; no partial file remains`
* Evidence AC: `AC-006`

## Scope

### In Scope

* `praxisbound review preflight <manifest> [--semantic-report <file>]
  [--expect-fingerprint <sha256> --expect-revision <commit>]` with every
  contract §9 row except the Semantic Report parsing, fingerprint, coverage,
  and blocking rows, which belong to TST-028.
* Per-Story checks through the existing `story check --ready`, keeping its
  issue codes.
* `REVIEW_DEPENDENCY_CYCLE` detection over manifest `dependencies`, as a
  pure Core module `packages/core/src/review/dependency-graph.ts`.
* A per-path working-tree status from the hardened `release-git.ts` adapter
  for `REVIEW_NOT_A_GIT_REPOSITORY` and `REVIEW_SOURCES_UNCOMMITTED`, and
  HEAD comparison for `REVIEW_PACKET_REVISION_MISMATCH`.
* The confirmation-row split and the REVIEW_REVISION_UNADDRESSED check,
  reusing TST-026's applicability function.
* Preflight Report writing with deduplication, and envelope overloads for the
  four new outcomes.
* CLI contract and result-envelope outcome table updates, and the
  contract amendments listed in R9.

### Out of Scope

* Semantic Report parsing, schema validation, fingerprint check, coverage,
  blocking and observation diagnostics, and `agent-workflow.md` §2 (TST-028).
* `review packet`, Execution Authorization resolution, and ForgePilot
  (R-008).
* Running `make verify`, running Story tests, or editing any source.
* Writing Story lifecycle, Gate, review, DONE, or Work Item state.

## Inputs

* A Batch Manifest and its declared sources, read from the working tree
  including uncommitted changes.
* Existing confirmation, revision, response, and preflight records under
  `records/`.
* An optional Semantic Report path, checked only for existence here.
* Optional `--expect-fingerprint` and `--expect-revision` values.
* `git` output for HEAD and per-path working-tree status, only when
  `--expect-revision` is given.

## Outputs

* One result envelope on stdout with `data.preflightRecord` and
  `data.diagnostics[]` aligned with `issues[]`.
* At most one create-new `records/preflight-<fp12>-<n>.json`.
* Human-readable output on stderr in two sections, mechanical results and
  Agent observations, with the fixed READY disclaimer.

## Rules

* R1: Outcome precedence follows contract §9: `ERROR`/`*-error` >
  `REVIEW_STALE` > `REVIEW_BLOCKED` > `REVIEW_INCOMPLETE` > `REVIEW_READY`.
  All issues are listed regardless of which one decides the outcome.
* R2: Confirmation split: a valid confirmation exists but does not match the
  current fingerprint → `REVIEW_CONFIRMATION_STALE` with the §8 source
  differences, outcome STALE; no valid confirmation at all →
  `REVIEW_CONFIRMATION_MISSING`, outcome INCOMPLETE.
* R3: Preflight does not check Execution Authorization. A read-only
  evaluation causes no effect that needs authorization; §10 resolves
  authorization at the time of each effect.
* R4: Per-Story checks run `story check --ready`, not the default contract
  mode, and keep its issue codes.
* R5: The uncommitted-change check runs git with argv arrays, no shell, a
  1 MiB output bound, and a cleaned environment, and reports each dirty or
  untracked batch path. A matching fingerprint and HEAD never stand in for
  this check.
* R6: Severity follows mechanically from the contract row: a row that affects
  the outcome is `blocking`; a row marked 「不影響結果」 is `advisory`. No
  severity is assigned by hand.
* R7: Every run with a valid manifest writes a Preflight Report, except when
  the latest report under the same `fp12` (highest `-<n>`) equals the new one
  in every field but `checkedAt`, including `expect`; then nothing is written
  and `data.preflightRecord` names the existing file. Allocation starts at
  the highest existing `-<n>` plus one and uses create-new with a small retry
  count for concurrent writers, so the number of accumulated reports never
  blocks a write.
* R8: `REVIEW_READY` output carries the fixed text 「只表示未發現阻擋，不宣稱沒有缺陷」.
  Every untrusted `message` and `path` shown to a human is ESC-escaped per
  §16. Preflight never edits a source, runs `make verify`, or requires
  unimplemented tests to pass.
* R9: Contract amendments, marked 修訂性澄清（R-007）: §9 confirmation split
  (R2) and the no-authorization note (R3); §9 write failure →
  `REVIEW_INCOMPLETE` with `REVIEW_RECORD_WRITE_FAILED`; §9 a Semantic Report
  naming a Story outside the batch → `REVIEW_SEMANTIC_INVALID` (implemented in
  TST-028); §13 the one-baseline-file bound in Capacity, plus the confirmation
  bound of 200 files / 16 MiB that TST-026 left out of §13; §2 the
  deduplication and allocation rules of R7.
* R10: Human Review on 2026-09-23 accepted these decisions:
  (a) TST-028 is stacked on this Story's branch and both merge to main
  together, so main never holds a build that reaches `REVIEW_READY` with an
  unparsed Semantic Report; no interim issue code is added.
  (b) Preflight has no aggregate file-count or size bound, because it reads
  only one baseline file and a count bound would lock out a tool that creates
  those files itself; this replaces the grill's 200-file / 16 MiB preflight
  bound.
  (c) ADR-015 is written before execution with `Status: proposed` and must be
  accepted before `story check --ready` passes.
  (d) The Additive classification is recorded in this Story, following
  TST-025 and TST-026; `protocol/versioning.md` is not edited.

## Expected Errors

* Invalid argv, or only one of `--expect-*` given: `usage-error`, exit 2.
* Unreadable or invalid manifest, unsafe path, unsupported schemaVersion:
  `configuration-error`, exit 2, nothing written.
* Internal failure or over 10000 diagnostics: `ERROR`, exit 3.
* Missing source, failing `story check --ready`, dependency cycle, unknown
  Story, unmapped requirement, missing acceptance, unknown or duplicate
  anchor, unresolved blocking request, not a git repository, uncommitted
  batch source: `REVIEW_BLOCKED`, exit 1.
* Fingerprint or revision mismatch, stale confirmation: `REVIEW_STALE`,
  exit 1.
* Missing confirmation, unaddressed non-blocking request, response mismatch or
  invalid, missing Semantic Report, report write failure:
  `REVIEW_INCOMPLETE`, exit 1.

## Error Projection

* Source failure: `a missing source, invalid record, git failure, failing story check, cycle, or report write failure`
* Public projection: `stable review issue codes in the existing envelope with data.diagnostics[] locators; stdout carries exactly one JSON envelope`
* Detail policy: `repository-relative paths, ESC-escaped untrusted text, no raw git stderr, filesystem errors, or absolute paths`
* Evidence AC: `AC-005`

## Dependencies

* TST-026 supplies confirmation applicability and source comparison.
* TST-024 and TST-025 supply record reading, create-new writing, and
  effective-request and response reading.
* `release-git.ts` supplies the hardened git runner and observation seam.
* `ADR-014` and contract §9 are accepted; `ADR-015` was accepted on 2026-09-23.
* Decisions (a)–(d) in R10 were accepted by Human Review from carl in a
  Claude Code session on 2026-09-23.
* TST-028 merges together with this Story (R10a).

## Constraints

* Add no dependency. Fixtures use isolated temporary repositories, including
  temporary git repositories; they never make this repository's own Stories,
  records, or worktree their subject.
* Classify the public CLI and contract changes as **Additive** (§14): a new
  command and four new outcomes. `schemaVersion`, `protocol/`, `templates/`,
  and `VERSION` remain unchanged.
* Pure decisions live in Core; the CLI gathers input, calls Core, assembles
  the report, and writes the file. `envelope()` gains typed overloads for the
  new outcomes; no cast bypasses the type check.
* `make verify` is authoritative for completion.
* Do not merge, publish, tag, release, deploy, or push.

## Guidance

Relevant:

* principle: small coherent changes
* principle: behavior-oriented testing
* principle: explicit dependencies
* decision: `ADR-014` keeps preflight Evidence, never authority
* decision: `ADR-015` runs git for the uncommitted-change check instead of
  inferring it from the fingerprint

Not applicable:

* no persistent-data migration, publication, Protocol change, or model
  integration applies

## Trust Boundary Fields

* `batch.json` — untrusted batch declaration, including `dependencies`.
* `batch source text` — untrusted Markdown read by `story check --ready` and anchor checks.
* `records/ directory entries` — untrusted, including symlinks and names that look like preflight files.
* `confirmation, revision, response, and preflight records` — untrusted historical JSON anyone with write access can forge.
* `--semantic-report path` — caller-supplied path, checked for existence only.
* `--expect-fingerprint and --expect-revision` — caller-supplied values.
* `git output` — external process output for HEAD and working-tree status.
