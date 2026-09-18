# Story: TST-023 Batch Review Annotation Layer

## Goal

A reviewer reading a Review Projection can raise Revision Requests right where
a problem is, against one or many located blocks or the whole batch, and export
them as one Revision Sheet an Agent can trace to exact sources. Closing the page
and restoring the sheet later brings every request back to its place, or lists
it for re-matching when the sources have changed. The page never writes
sources, never records anything, and never turns a request into approval or
authority.

## Context

GitHub issue #86 traces this work to `SPEC-BATCH-REVIEW/R-004`. It builds on the
requirement-organized projection of TST-022 (#85, #101), whose blocks already
carry `data-path`, `data-anchor` and `data-block-sha256` locators.
`ADR-014` and `specs/features/batch-review/contract.md` §5, §6, §13, §16 and §19
define the accepted contract; §19 was added with this Story after a grilling
session and a throwaway prototype (branch `prototype/tst-023-annotation`: a
right-hand drawer with an inline entry button was chosen). Importing a sheet
into `records/` with `praxisbound review import` is a separate Story.

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
* Boundary: `review annotation Core module`
* Boundary: `review projection Core module`
* Contract: `review annotation Core owns the page script as one fixed string plus its pure logic (Revision Request creation, Revision Sheet export and parsing, restore matching, limits); it performs no I/O in Node`
* Contract: `review projection Core embeds that script unchanged and pins it with a CSP sha256 hash; every other script, connection, and frame stays forbidden`
* Contract: `source text, request text, and restored sheet content only ever reach the page as text nodes`
* Owner: `review annotation Core module = PraxisBound tooling`
* Owner: `review projection Core module = PraxisBound tooling`

## Risk

* Level: high
* Reason: `security`
* Reason: `public-contract`
* Signal: `bounded-capacity`

## Capacity

* Bounded resource: `a restored Revision Sheet, the requests it carries, each text field, and each generated quote`
* Limit: `contract §13: sheet at most 1 MiB, nesting depth at most 32, at most 1000 requests, each string at most 64 KiB; quote truncated at 64 KiB with a visible marker`
* Saturation behavior: `a sheet over any limit is rejected whole without partial restore; an over-long quote is truncated and marked, never rejected`
* Failure projection: `a readable page message naming the exceeded limit; existing drafts stay unchanged`
* Evidence AC: `AC-010`

## Scope

### In Scope

* An annotation layer in the page produced by `praxisbound review render`:
  a right-hand drawer (target selection, request form, request list, jump back
  to the source) and an inline entry on every annotatable element, all
  keyboard operable, all hidden in print.
* Revision Requests with the four `kind` values, `blocking`, one or many
  targets, whole-batch targets, `quote`, and `supersedes` for edits of exported
  requests, generated as contract §19 specifies.
* Revision Sheet export in the contract §6 format, by download and by a
  copyable text box.
* Restoring a Revision Sheet into the page: validation, limits, dedupe,
  conflict rejection, in-place attachment, and the 「待比對」 list.
* Auxiliary browser storage with visible fallbacks, an unexported-count
  indicator, and a leave-page prompt.
* Pure-logic tests run in Node against the exact embedded script, and
  recorded Chrome observations of the interactive flows.

### Out of Scope

* `praxisbound review import`, writing `records/`, Revision Responses,
  confirmation, preflight, and ForgePilot work.
* Multi-user sync, cloud storage, rich-text editing, arbitrary character-range
  selection, writing repository files, or calling any AI service.
* Printing Revision Requests; changing the §18 reading layout.
* Any dependency, including development-only browser automation.

## Inputs

* The rendered Review Projection and its batch identity and fingerprint.
* Reader input in the page.
* A Revision Sheet chosen or pasted by the reader.
* Browser storage, when available.

## Outputs

* A Revision Sheet (Markdown with one `praxisbound-revisions` JSON block)
  offered as a download and as copyable text.
* In-page state only; no file in the repository and no network request.
* `praxisbound review render` output gains the embedded script and its CSP
  hash; the CLI result envelope and `data` are unchanged.

## Rules

* R1: The page embeds exactly one script, produced by the renderer and pinned
  by its `sha256` in the CSP; `connect-src`, `frame-src` and every other source
  stay `'none'`. With JavaScript disabled the §18 page works unchanged.
* R2: Source text, request text, and restored sheet content are inserted only
  as text nodes; nothing a reader or a sheet provides becomes markup, an
  attribute, a URL, or code.
* R3: Annotatable targets are the elements carrying a locator plus the batch
  target `{ path: <manifest>, anchor: "#batch" }`; a request may name several.
* R4: `rationale` is required; `proposal` is required unless `kind` is
  `delete`; `blocking` defaults to `true`; a `delete` request never hides the
  original text.
* R5: `id` is a ULID from cryptographic randomness and the current time;
  `fingerprint` is the page fingerprint when the request is created and is
  never rewritten; the sheet `fingerprint` is the page fingerprint at export.
* R6: `quote` is the targets' displayed text joined by `\n---\n`, truncated at
  the contract §13 string limit with a visible marker.
* R7: An exported request is read-only; editing it creates a new request whose
  `supersedes` names the original `id`.
* R8: Export writes exactly one column-0 `praxisbound-revisions` fence whose JSON
  validates against `schemas/revision-sheet.schema.json`; every reader-provided
  text outside the block is emitted as `> ` quoted lines.
* R9: Restore applies the contract §6 block rules and §13 limits and rejects a
  different `batchId`. Same `id` with the same content is skipped and counted;
  same `id` with different content rejects the whole sheet and lists the ids.
* R10: A restored request attaches in place only when its `fingerprint` equals
  the page fingerprint and every target's `(path, anchor, blockSha256)` exists
  on the page; otherwise it is listed under 「待比對」 and attached nowhere.
* R11: Browser storage is auxiliary, keyed by `batchId` and page fingerprint.
  When it is unavailable the page says so persistently. A failed export,
  restore, or save never clears drafts and never marks them saved.
* R12: While unexported requests exist the page shows their count and asks
  before the page is left.
* R13: Nothing in the layer writes sources or `records/`, sends a request,
  records confirmation, or grants authority, whatever the request text says.
* R14: Print hides the whole annotation layer, leaving the §18 reading page.

## Expected Errors

* A restored sheet with zero or several `praxisbound-revisions` blocks, an
  unclosed block, invalid JSON, a schema violation, or a different `batchId`:
  the whole sheet is rejected with a readable message; drafts are unchanged.
* A restored sheet over the §13 limits: rejected with a readable message.
* Same `id` with different content: rejected, listing the conflicting ids.
* Browser storage unavailable or failing: persistent notice; export still works.
* Download blocked: the copyable text box still holds the full sheet.

## Dependencies

* TST-022 provides the Review Projection, its locators, and its CSP.
* `ADR-014` and the batch-review contract §19 are accepted.

## Constraints

* Add no dependency. Browser logic is tested in Node by running the exact
  embedded script source; interactive flows are recorded Chrome observations.
* Every fixture is built inside the test temporary directory; tests never use
  this repository's own batch documents as their subject.
* `make verify` is authoritative for completion.
* Classify the change as Additive and update the CLI contract where the render
  output is described; no Protocol or template surface changes.
* Do not merge, publish, tag, release, deploy, or push.

## Guidance

Relevant:

* principle: small coherent changes
* principle: behavior-oriented testing
* principle: explicit dependencies
* decision: `ADR-014` keeps Revision Requests as proposals without authority

Not applicable:

* no persistent-data migration, publication, or Protocol change applies

## Trust Boundary Fields

* `review page revision proposal` — reader-provided text shown in the page and exported.
* `review page revision rationale` — reader-provided text shown in the page and exported.
* `review page restored sheet` — untrusted Markdown and JSON chosen or pasted by the reader.
* `browser storage draft` — untrusted state read back from browser storage.
* `source markdown body` — untrusted source text used for `quote`.
* `locator.anchor` — derived untrusted text carried in targets.
