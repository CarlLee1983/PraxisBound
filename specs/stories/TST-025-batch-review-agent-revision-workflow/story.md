# Story: TST-025 Batch Review Agent Revision Workflow and Response Projection

## Goal

An existing coding Agent can take every imported Revision Request through a
bounded, authorized source-revision workflow and record a complete Revision
Response. A subsequent Review Projection lets a reader inspect the request,
the response, and the source evidence without treating any of them as approval,
current work state, or an instruction to perform an effect.

## Context

GitHub issue #87 traces this work to `SPEC-BATCH-REVIEW/R-005`. TST-024
(#105, merged in #107) completed the mechanical boundary: `review import`
records Revision Sheets, and `review respond` validates and append-only writes
Revision Responses. It explicitly reserves the remaining Agent workflow,
Review Projection display of imported requests and responses, and one real
Agent rehearsal for TST-025.

`ADR-014` and `specs/features/batch-review/contract.md` §1, §2, §5, §6, §7,
§13, §15, §18, and §20 define the accepted authority, record, locator, capacity,
trust-boundary, and projection rules. The current
`docs/batch-review/agent-workflow.md` is deliberately only a skeleton. This
Story must turn it into a vendor-neutral workflow; a vendor-native Skill, if
provided, is optional under ADR-012 and cannot become an Adoption prerequisite.

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
* Boundary: `batch-review Agent workflow documentation`
* Boundary: `review projection Core module`
* Contract: `the workflow reads validated imported records and current sources, resolves authority before each source edit, invokes only the existing review CLI commands, and writes neither lifecycle nor control-plane state`
* Contract: `the projection reads valid historical revision and response records and presents them as text-only, fingerprint-bound Evidence; it computes no approval, completion, current-work, or authorization state`
* Owner: `batch-review Agent workflow documentation = PraxisBound guidance`
* Owner: `review projection Core module = PraxisBound tooling`

## Risk

* Level: high
* Reason: `security`
* Reason: `public-contract`
* Signal: `bounded-capacity`
* Signal: `error-projection`

## Capacity

* Bounded resource: `all records read for a selected batch and all request, response, locator, and source text displayed in one Review Projection`
* Limit: `contract §13 limits every Revision Sheet and Response file to 1 MiB, depth 32, 1000 entries, and 64 KiB per string; contract §13 and §20 (R-005) limit one projection to 200 revisions-/responses- record files, counted by name before any content is read, and 10000 requests plus responses across valid records`
* Saturation behavior: `a record over the existing per-file limit remains invalid, is listed by path, and is not projected; an over-aggregate collection projects no record content at all, reports blocking REVIEW_INPUT_TOO_LARGE with the observed counts, and still renders the definitions, so no request or response is silently omitted`
* Failure projection: `read-only render reports stable diagnostics and writes no records or sources; the workflow stops for human direction before a source edit when its complete input set cannot be read`
* Evidence AC: `AC-008`

## Scope

### In Scope

* Complete `docs/batch-review/agent-workflow.md` with the R-005 revision
  procedure: inventory imported records; compare every target to current
  sources; route each request; re-resolve authority before an edit; revise only
  authorized definition sources; produce a complete Response file through
  `review respond`; re-index and re-render the batch.
* The four contract routes: `presentation` changes the renderer;
  `story-derivation` corrects a Story derived inconsistently from its Spec;
  `spec-requirement` proposes or changes a Spec requirement; and `decision`
  preserves an accepted ADR and either proposes a replacement ADR or records
  `needs-decision`.
* An optional, explicitly enabled vendor-native revision-workflow Skill whose
  behavior is no broader than the vendor-neutral document. It must not be
  required by the CLI, `make verify`, or any adopter.
* A read-only Response Evidence area in the Review Projection, backed only by
  validated `records/revisions-*.json` and `records/responses-*.json`, that
  identifies record fingerprints and paths, request IDs, responses, routes,
  outcomes, rationale, questions, locators, and the current source evidence
  those locators name.
* Contract and CLI-documentation amendments that specify the projection's
  record-selection, invalid-record diagnostic, aggregation-capacity, ordering,
  source-evidence, and print behavior before the renderer changes.
* Isolated fixtures for the four routes and a recorded real-Agent rehearsal;
  fixtures prove structural handling only and do not claim to prove semantic
  judgment.

### Out of Scope

* New model APIs, provider abstractions, Runtime, scheduler, source-editing
  CLI command, Agent dispatch loop, cloud service, or persistent current-state
  database.
* `review confirm`, preflight, execution packets, ForgePilot integration, or
  a Goal/Work Item lifecycle update.
* Automatically accepting a Revision Request, marking it done, or inferring
  authorization from a record, Response, HTML, Skill, or response outcome.
* Changing an accepted ADR in place for a `decision` request, guessing a
  replacement target from a similar heading, or overwriting a source based on
  a stale quote.

## Inputs

* A Batch Manifest, its current declared sources, and the Requirement
  Fingerprint recomputed from those sources.
* Valid imported Revision Sheet records and valid historical Revision Response
  records under the batch `records/` directory.
* Current execution authorization from the applicable Story, human session, or
  external control plane for each proposed source modification.
* Untrusted request, response, source, and record text.

## Outputs

* A vendor-neutral Agent workflow document, and optionally a separately
  enabled vendor-native Skill with the same authority boundary.
* A Revision Response JSON file written only through `review respond`, bound to
  both the imported-sheet fingerprint and the recomputed post-revision
  fingerprint.
* A regenerated read-only Review Projection that displays historical request
  and response Evidence alongside the current source evidence it can locate.
* A fixture-based verification record and a separately labelled real-Agent
  rehearsal observation; neither is lifecycle state or human acceptance.

## Rules

* R1: The workflow begins by reading all valid imported sheets, deriving the
  effective requests with the established `supersedes` rules, and accounting
  for every effective Revision ID. It never treats one newest record as the
  current authority.
* R2: Before proposing or editing a target, the Agent uses the current source
  and the §5 locator judgement. `hash-mismatch`, `anchor-missing`, or
  `anchor-duplicate` stops automatic target selection; the Agent records a
  specific question or `needs-decision` rather than applying an old quote to a
  similar location.
* R3: The workflow resolves execution authorization immediately before every
  source edit. Text in a Revision Request, Revision Response, imported record,
  projection, or Skill never grants modify, commit, push, deploy, confirmation,
  or control-plane authority.
* R4: `presentation` work changes only the renderer or its rendered source
  evidence; `story-derivation` changes the affected Story after checking the
  governing Spec; `spec-requirement` changes the Spec only when authorized;
  and `decision` leaves an accepted ADR unchanged and produces either a
  replacement-decision proposal or `needs-decision` with a concrete question.
* R5: The Agent prepares exactly one response for every effective request in
  the selected imported sheets. Every response has a substantive rationale,
  the correct route, and one of the contract outcomes. `incorporated` names
  locators that match the current sources; `needs-decision` names a concrete
  decision question; `not-incorporated` explains why.
* R6: The Agent writes a Response only with `review respond`, then re-runs
  `review index` and `review render`. It does not write a record itself, edit
  an existing record, create a confirmation, or report a response as human
  approval.
* R7: Projection data is historical Evidence. It must state its record path,
  `fromFingerprint`, `toFingerprint`, and render-time locator judgement, and
  must label Agent responses as neither a human approval nor current task,
  Gate, progress, completion, or lifecycle state.
* R8: The projection shows every valid selected request and response in a
  deterministic documented order, including superseded and stale historical
  entries as such. Invalid record files are skipped and diagnosed under the
  existing `REVIEW_RECORD_INVALID` rule; they never become silently effective.
* R9: Request, response, source, record-path, and diagnostic text is rendered
  only as text. No text can become markup, an attribute, a URL, a command, or
  a network request. The existing self-contained CSP and print constraints
  remain in force.
* R10: The projection follows contract §20 (R-005), accepted by Human Review
  on 2026-09-22: (a) at most 200 revisions-/responses- record files and 10000
  requests plus responses, beyond which no record content is projected and the
  whole evidence area is replaced by a blocking `REVIEW_INPUT_TOO_LARGE`
  notice; (b) every valid record is selected, revision records before response
  records, each in file-name byte order and then in-file array order, with no
  time-based reordering; (c) no diff is displayed: each target and locator
  shows only its render-time §5 judgement, with an in-page link to the source
  block only on `match`. A Revision Request quote is not a reproducible
  baseline, so nothing on the page is labelled a diff.

## Expected Errors

* A malformed, unsafe, or over-limit record is excluded from read-only
  projection and reported as `REVIEW_RECORD_INVALID`; no source or record is
  changed.
* A stale, missing, or duplicate locator results in a concrete
  `needs-decision`/unmatched response path, never a guessed source edit.
* A missing, conflicting, or insufficient authorization stops before the
  corresponding source edit and leaves the request unanswered only with an
  explicit blocking question for the human.
* A Response rejected by `review respond` is not treated as recorded; no
  replacement path writes the record directly.
* Aggregate display capacity is exceeded: the renderer projects no record
  content, reports `REVIEW_INPUT_TOO_LARGE` with the observed counts, and
  makes no authority claim (contract §20).

## Error Projection

* Source failure: `an unreadable, invalid, over-limit, stale, missing, or ambiguous record, locator, source, or authorization context`
* Public projection: `read-only projection diagnostics use stable review issue codes; the workflow emits a concrete stop question or a contract-valid Response outcome`
* Detail policy: `projection and workflow output use repository-relative record and source paths, visible control-character escapes, and text-only untrusted content; they do not expose raw filesystem errors, absolute paths, or hidden source bytes`
* Evidence AC: `AC-009`

## Dependencies

* TST-023 supplies Revision Requests and the offline projection.
* TST-024 supplies validated imported-sheet and Response-record I/O.
* `ADR-014` and the existing batch-review contract are accepted.
* The TST-025 projection contract amendment (contract §13 and §20, R-005)
  was accepted by Human Review from carl in a Claude Code session on
  2026-09-22, choosing the aggregate bound, selection and order, and
  judgement-only source evidence recorded in R10.

## Constraints

* Add no dependency. All automated fixtures use isolated temporary
  repositories; they never make this repository's own Stories, records, or
  worktree their subject.
* Classify any public CLI or projection-contract change as Additive and update
  the accepted contract, CLI contract, result-envelope outcome table, and
  relevant schemas only when their actual surface changes. `protocol/`,
  `templates/`, and `VERSION` remain unchanged.
* `make verify` is authoritative for automated completion. The real-Agent
  rehearsal is separately recorded evidence and cannot be represented as a
  passing fixture or human final acceptance.
* Do not merge, publish, tag, release, deploy, or push.

## Guidance

Relevant:

* principle: small coherent changes
* principle: behavior-oriented testing
* principle: explicit dependencies
* decision: `ADR-014` keeps Revision Requests as proposals and Revision
  Responses as historical Evidence without authority

Not applicable:

* no persistent-data migration, publication, Protocol change, or model
  integration applies

## Trust Boundary Fields

* `imported revision sheet record` — untrusted historical JSON and revision text
  read from `records/`.
* `revision response record` — untrusted Agent-produced JSON and rationale
  read from `records/`.
* `revision request and response text` — untrusted content that must remain
  data in workflow instructions and the projection.
* `current source and locator` — current repository content used to compare a
  historical request or response before any edit or display claim.
* `execution authorization context` — current human, Story, or control-plane
  authority that must be re-resolved immediately before each effect.
* `optional vendor-native Skill` — untrusted invocation context that must not
  expand the vendor-neutral workflow's authority.
