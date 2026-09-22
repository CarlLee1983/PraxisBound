# Story: TST-026 Batch Review Definition Confirmation and Staleness

## Goal

A human confirms a whole batch of definitions with one explicit terminal act.
The act writes a historical Definition Confirmation bound to the batch's
Requirement Fingerprint. Any later change to a batch source, the manifest, or
the batch's file set makes that confirmation stop applying to the current
version, and the tools name exactly which sources changed so only those need
re-review.

## Context

GitHub issue #88 traces this work to `SPEC-BATCH-REVIEW/R-006`, which is
blocked by R-005. TST-024 (#105) and TST-025 (#108) delivered import, respond,
the Agent revision workflow, and the projection evidence area. `ADR-014` fixes
that a confirmation is a human claim bound to one fingerprint, not a `current`
approval pointer, not Execution Authorization, and not lifecycle state.
`specs/features/batch-review/contract.md` §2, §4, §7, §8, §12, §13, and §15
already define the command, record, applicability rule, and staleness
diagnostics. `schemas/confirmation.schema.json` and
`examples/records/confirmation.json` exist. This Story implements them.

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
* Boundary: `review confirm CLI command`
* Boundary: `confirmation applicability Core module`
* Boundary: `review projection Core module`
* Contract: `review confirm writes a confirmation record only after an interactive terminal act that names the fingerprint; no flag, environment variable, file, or Agent text can produce one`
* Contract: `applicability is recomputed from current sources on every read; a confirmation never becomes current state, authorization, or lifecycle data`
* Owner: `review confirm CLI command = PraxisBound tooling`
* Owner: `confirmation applicability Core module = PraxisBound tooling`
* Owner: `review projection Core module = PraxisBound tooling`

## Risk

* Level: high
* Reason: `security`
* Reason: `public-contract`
* Signal: `bounded-capacity`
* Signal: `error-projection`

## Capacity

* Bounded resource: `confirmation records read from records/ and the sources, deferrals, and revision sheets one confirmation lists`
* Limit: `contract §13 limits each confirmation file to 1 MiB, depth 32, and 64 KiB per string; the schema limits sources to 5000, deferred to 1000, and revisionSheets to 1000; contract §8 (修訂，R-006) limits confirmation files read per command to 200 by name and 16 MiB by size, both checked before any content is read`
* Saturation behavior: `an over-limit or malformed confirmation file is REVIEW_RECORD_INVALID, never counted as applicable, and never used as the comparison baseline`
* Failure projection: `confirm writes nothing on any failure; read-only commands report stable diagnostics and write nothing`
* Evidence AC: `AC-003`

## Scope

### In Scope

* `praxisbound review confirm <manifest>` exactly as contract §8 steps 1–6
  define: TTY requirement, fingerprint recomputation, refusal on missing
  sources or unresolved blocking requests, per-request `defer` with a reason
  for unresolved non-blocking requests, typing the first 8 fingerprint
  characters, and create-new writing of `records/confirmation-<fp12>.json`.
* The contract §8 applicability rule and the source comparison that yields
  `REVIEW_SOURCE_ADDED`, `REVIEW_SOURCE_REMOVED`, `REVIEW_SOURCE_CHANGED`, and
  `REVIEW_MANIFEST_CHANGED`, as a Core function later reused by R-007
  preflight and R-008 packet.
* A 「需複審」 marker in the Review Projection on each source block of a
  changed document, and no marker on unchanged documents, per contract §8.
* CLI contract, result-envelope outcome table, and contract amendments for
  the open decisions below once accepted.
* Isolated fixtures for source content change, added and removed documents,
  a dirty working tree, render-only regeneration, unresolved blocking
  requests, and forged approval text.

### Out of Scope

* A confirmation button or confirmation write from the HTML page. The page
  cannot know the local repository state (R-006 工作內容), so confirmation is
  terminal-only.
* `review preflight`, `review packet`, Execution Authorization, and
  ForgePilot integration (R-007, R-008).
* Accounts, identity, signatures, or anti-forgery claims.
* Writing Story lifecycle, Gate, review, DONE, or ForgePilot Work Item state.

## Inputs

* A Batch Manifest and its current declared sources, read from the working
  tree including uncommitted changes.
* Valid imported Revision Sheet records and Revision Response records, to
  determine unresolved blocking and non-blocking requests (contract §7).
* Existing confirmation records under `records/`.
* An interactive terminal on stdin and stdout.

## Outputs

* On a successful confirm: one create-new
  `records/confirmation-<fp12>.json` and a success envelope.
* From read-only commands: applicability and per-source staleness
  diagnostics, and 「需複審」 markers in the projection.

## Rules

* R1: Confirmation covers the whole batch in one act. Reading progress, page
  scrolling, or opening the projection is never a confirmation.
* R2: `confirm` refuses with `REVIEW_UNRESOLVED_BLOCKING` while any effective
  blocking request is unresolved under contract §7. Each unresolved
  non-blocking request must be deferred with a typed reason, recorded in
  `deferred`; none is silently skipped.
* R3: A confirmation applies only when its `fingerprint` equals the fingerprint
  recomputed from the current working tree. Render time, HTML regeneration,
  `records/` changes, and verification artifacts never change applicability.
* R4: When no confirmation applies, the tools compare current sources with the
  latest valid confirmation's `sources` and list each added, removed, or
  changed source and a changed manifest. They never mark the new version
  confirmed and never mark unchanged documents for re-review.
* R5: Old confirmation records stay unchanged as history. A new fingerprint
  needs a new whole-batch `confirm`.
* R6: Only `review confirm` on an interactive terminal writes a confirmation.
  There is no `--yes`, environment variable, piped input, or file input.
  Response records, Agent text, preflight results, and strings such as
  `authorized: true` or `approved` in any source or record never create or
  imply a confirmation.
* R7: A confirmation grants no modify, commit, push, deploy, or execution
  authority and writes no lifecycle, Gate, review, DONE, or Work Item state.
* R8: All displayed source text, paths, and request text in the confirm
  prompt are shown with control characters visibly escaped (contract §8
  step 4), using the shared hidden and reordering code-point set.
* R9: Human Review on 2026-09-22 accepted these decisions, recorded in
  contract §8 (修訂，R-006): (a) automated tests drive `review confirm`
  through an injected terminal adapter, and one real interactive terminal run
  is recorded as evidence (AC-010); (b) only `render` reports applicability
  and staleness, as advisory diagnostics, and `review index` output is
  unchanged; (c) confirmation records stay out of the §20 evidence area and
  have their own bound of 200 files and 16 MiB checked before any content is
  read; (d) the latest valid confirmation is the one with the latest
  canonical `confirmedAt`, ties broken by the later file name in byte order,
  and 「需複審」 appears beside the source path label of each block of an
  added or changed source, with removed sources and a manifest change listed
  only in the header summary.

## Expected Errors

* stdin or stdout is not a TTY: `usage-error`, exit 2,
  `REVIEW_CONFIRM_REQUIRES_TTY`, nothing written.
* A source is missing: `failure`, exit 1, `REVIEW_SOURCE_MISSING`.
* An unresolved blocking request exists: `failure`, exit 1,
  `REVIEW_UNRESOLVED_BLOCKING`, listing the request ids.
* The typed fingerprint prefix does not match, a deferral has no reason, or
  the human aborts: `failure`, exit 1, `REVIEW_CONFIRM_ABORTED`, nothing
  written.
* A confirmation for the same fingerprint exists: same content is `success`
  with `REVIEW_CONFIRMATION_EXISTS`; different content is `failure` with
  `REVIEW_RECORD_COLLISION`; nothing written in either case.
* A malformed, misnamed, or over-limit confirmation file is
  `REVIEW_RECORD_INVALID` and is never applicable or used as a baseline.

## Error Projection

* Source failure: `a missing source, unsafe path, non-TTY invocation, unresolved blocking request, aborted prompt, colliding or invalid confirmation record, or write failure`
* Public projection: `stable review issue codes in the existing envelope; the interactive prompt writes only to stderr and stdout carries exactly one JSON envelope`
* Detail policy: `repository-relative paths, visibly escaped control characters, and no raw filesystem errors or absolute paths`
* Evidence AC: `AC-007`

## Dependencies

* TST-024 supplies validated record reading and create-new writing.
* TST-025 supplies the effective-request and response reading used to find
  unresolved requests, and the projection this Story marks.
* `ADR-014` and contract §8 are accepted.
* Decisions (a)–(d) in R9 were accepted by Human Review from carl in a
  Claude Code session on 2026-09-22.

## Constraints

* Add no dependency. Automated fixtures use isolated temporary repositories;
  they never make this repository's own Stories, records, or worktree their
  subject.
* Classify public CLI, projection, and contract changes as Additive and update
  the contract, CLI contract, result-envelope outcome table, and schemas only
  where their surface actually changes. `protocol/`, `templates/`, and
  `VERSION` remain unchanged.
* `make verify` is authoritative for automated completion. A real terminal
  run is separately recorded evidence.
* Do not merge, publish, tag, release, deploy, or push.

## Guidance

Relevant:

* principle: small coherent changes
* principle: behavior-oriented testing
* principle: explicit dependencies
* decision: `ADR-014` keeps a confirmation a historical claim bound to one
  fingerprint, never a current approval state

Not applicable:

* no persistent-data migration, publication, Protocol change, or model
  integration applies

## Trust Boundary Fields

* `confirmation record` — untrusted historical JSON read from `records/`; anyone with write access can author one.
* `revision and response records` — untrusted JSON used only to find unresolved requests.
* `batch source text` — untrusted Markdown shown in the confirm prompt and projection.
* `terminal input` — the fingerprint prefix, `defer` answers, and deferral reasons typed by the human.
* `manifest` — untrusted batch declaration whose sources feed the fingerprint.
