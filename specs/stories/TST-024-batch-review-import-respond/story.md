# Story: TST-024 Batch Review Import and Respond

## Goal

A Revision Sheet exported from the Review Projection can be recorded for its
Review Batch with one command, which tells the Agent, target by target, whether
each Revision Request still matches the current sources. After revising
sources, the Agent records its Revision Responses through a second command that
checks the responses are complete and bound to real fingerprints before writing
them. Neither command changes sources, confirms a definition, or grants any
authority.

## Context

GitHub issue #105 (child of #87) traces this work to
`SPEC-BATCH-REVIEW/R-005`. R-005 is split in two: this Story covers the
mechanical, fully automatable part; TST-025 will cover the Agent revision
workflow Skill, showing imported requests and responses in the Review
Projection, and a real Agent rehearsal. TST-023 (#86, merged in #104) produces
the Revision Sheet and defines the page-side same-content, dedupe, and
`supersedes` rules that `review import` must match. `ADR-014` and
`specs/features/batch-review/contract.md` §2, §5, §6, §7, §12 and §13 define
the contract; the amendments marked 「修訂，R-005」 were decided in a grilling
session recorded in #105 and require human review before execution.

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
* Boundary: `review records Core module`
* Boundary: `review CLI commands`
* Contract: `review records Core owns reading, validating, and create-new writing of records/revisions-*.json and records/responses-*.json, and the contract §6 and §7 rules; it applies the same Revision Sheet judgement as the annotation page script`
* Contract: `review CLI commands expose import and respond through the existing result envelope with the contract §12 outcomes`
* Owner: `review records Core module = PraxisBound tooling`
* Owner: `review CLI commands = PraxisBound tooling`

## Risk

* Level: high
* Reason: `security`
* Reason: `public-contract`
* Signal: `bounded-capacity`
* Signal: `error-projection`

## Capacity

* Bounded resource: `an imported Revision Sheet, a Revision Response file, the records they are checked against, and each string they carry`
* Limit: `contract §13: each file at most 1 MiB, nesting depth at most 32, at most 1000 requests or responses, each string at most 64 KiB`
* Saturation behavior: `an input over any limit is rejected whole with REVIEW_INPUT_TOO_LARGE; nothing is written and nothing is truncated`
* Failure projection: `failure exit 1 with REVIEW_INPUT_TOO_LARGE and no new records/ file`
* Evidence AC: `AC-010`

## Error Projection

* Source failure: `invalid arguments, unreadable or invalid manifest, unsafe path, invalid existing records, rejected sheet or response content, write failure, or unexpected failure`
* Public projection: `usage-error/configuration-error exit 2, failure exit 1, or sanitized ERROR exit 3 with stable issue codes`
* Detail policy: `result envelopes use repository-relative paths and stable issue codes only; raw filesystem errors, absolute paths, and input bytes are not exposed`
* Evidence AC: `AC-011`

## Scope

### In Scope

* `praxisbound review import <manifest> <sheet>` as contract §6 specifies,
  including the R-005 amendments: refusal on invalid existing revisions records
  and per-request, per-target match results in `data`.
* `praxisbound review respond <manifest> <responses.json>` as contract §7
  specifies, including the R-005 amendments on fingerprint binding.
* A Core records module shared by both commands. `review index` and
  `review render` do not read `records/` in this Story; TST-025 reuses the
  module when the Review Projection shows imported requests.
* A shared Revision Sheet fixture set proving the CLI and the TST-023 page
  script reach the same judgement.
* CLI contract, result envelope outcome table, and contract text updates.

### Out of Scope

* The Agent revision workflow Skill, routing, and source editing (TST-025).
* Showing imported requests or responses in the Review Projection (TST-025).
* A real Agent rehearsal (TST-025).
* `review confirm`, `preflight`, `packet`, and ForgePilot work (R-006 to R-008).
* Any way to delete or modify an existing record.

## Inputs

* A Batch Manifest and the sources it selects.
* A Revision Sheet file (Markdown with one `praxisbound-revisions` block).
* A Revision Response file (JSON).
* Existing files under the batch `records/` directory.

## Outputs

* `records/revisions-<sheet12>.json`: the sheet's block JSON stored verbatim.
* `records/responses-<to12>-<n>.json`: the response JSON stored verbatim.
* Result envelopes with `data` `{ batchId, fingerprint, sources, diagnostics }`;
  `import` adds `sheet` and `revisions`, `respond` adds `record`.

## Rules

* R1: `import` validates the block, schema, and §13 limits; a different
  `batchId`, zero or several blocks, an unclosed block, or invalid JSON is
  `REVIEW_REVISION_SHEET_INVALID`; an over-limit input is
  `REVIEW_INPUT_TOO_LARGE`; each rejects the whole sheet.
* R2: Duplicate ids inside one sheet: same content is kept once; different
  content rejects the whole sheet with `REVIEW_REVISION_CONFLICT` listing ids.
* R3: Against every imported sheet: same id and same content is deduped; same
  id with different content rejects the whole sheet with
  `REVIEW_REVISION_CONFLICT` listing ids. Same content follows the §6
  canonical comparison exactly as the page does.
* R4: After dedupe, only new requests have `supersedes` checked: the target
  must exist in the imported sheets or this sheet and must not already be
  superseded by a different request; otherwise `REVIEW_REVISION_CONFLICT`.
* R5: With at least one new request the block JSON is written verbatim to
  `records/revisions-<sheet12>.json`; with none, nothing is written, the
  outcome is `success`, and `REVIEW_REVISION_DUPLICATE` is reported.
* R6: A request whose `fingerprint` differs from the current fingerprint is
  still written and reported with `REVIEW_REVISION_STALE_TARGET`.
* R7: `import` reports, for every request in the sheet, whether it is new or a
  duplicate and, for every target, `match`, `hash-mismatch`, `anchor-missing`,
  or `anchor-duplicate` against current sources by the §5 rules; a path that
  is not a batch source is `anchor-missing`; `#batch` matches only when its
  `blockSha256` equals the hash of the current fingerprint.
* R8: If any existing `records/revisions-*.json` is invalid (name prefix,
  schema, or limits), `import` fails with `REVIEW_RECORD_INVALID` naming the
  files and writes nothing.
* R9: `respond` checks, in order: schema and §13 limits; every
  `revisionSheets` entry names an imported record; `fromFingerprint` equals the
  `fingerprint` of one listed sheet; `toFingerprint` equals the fingerprint
  recomputed at write time (`REVIEW_RESPONSE_STALE` otherwise); exactly one
  response per effective request in the listed sheets
  (`REVIEW_RESPONSE_MISMATCH`); the §7 field rules and fingerprint-difference
  rule (`REVIEW_RESPONSE_INVALID`).
* R10: Effective requests are the requests in all imported sheets that no
  imported request supersedes.
* R11: A valid response file is written verbatim with create-new to
  `records/responses-<to12>-<n>.json`, `<n>` starting at 1 and incrementing
  when the name exists; `respond` also refuses when any existing responses or
  revisions record it depends on is invalid.
* R12: Every write is create-new; a symlink at `records/` or any parent is
  refused; no existing file is ever modified.
* R13: Request and response text is stored as data; nothing either command
  reads records a confirmation, changes a packet, edits a source, or grants
  authority, whatever the text says.

## Expected Errors

* Invalid argv: `usage-error`, exit 2.
* Unreadable or invalid manifest, unsafe path: `configuration-error`, exit 2.
* Rejected sheet or response content, invalid existing records: `failure`,
  exit 1, with the issue codes in R1–R11 and no new file.
* Write failure: `failure`, exit 1, with no partial file left behind.
* Unexpected failure: sanitized `ERROR`, exit 3.

## Dependencies

* TST-021 provides the batch index, locators, and fingerprint.
* TST-023 provides the Revision Sheet format and the page-side judgement.
* Contract amendments marked 「修訂，R-005」 are accepted by human review.

## Constraints

* Add no dependency.
* Every fixture is built inside the test temporary directory; tests never use
  this repository's own batch documents as their subject.
* `make verify` is authoritative for completion.
* Classify the change as Additive; update `docs/typescript-tooling/cli-contract.md`
  and the result envelope outcome table; no Protocol or template change.
* Do not merge, publish, tag, release, deploy, or push.

## Guidance

Relevant:

* principle: small coherent changes
* principle: behavior-oriented testing
* principle: explicit dependencies
* decision: `ADR-014` keeps Revision Requests as proposals and Revision Responses as Evidence without authority

Not applicable:

* no persistent-data migration, publication, or Protocol change applies

## Trust Boundary Fields

* `revision sheet file` — untrusted Markdown and JSON supplied on the command line.
* `revision proposal` — reader-provided text stored in records.
* `revision rationale` — reader-provided text stored in records.
* `revision id` — untrusted identifier compared against imported records.
* `revision response file` — untrusted Agent-produced JSON supplied on the command line.
* `records directory` — existing files whose names and contents are checked before use.
