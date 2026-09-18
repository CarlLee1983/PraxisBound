# Story: TST-022 Batch Review HTML Renderer

## Goal

A reviewer can turn one explicit Batch Manifest into one self-contained, safe,
offline HTML Review Projection. The projection makes the batch, Requirement
Fingerprint, sources, Spec → Story → acceptance trace, and diagnostics easy to
navigate, while retaining every source document verbatim for inspection. It is
a derived view only: it never changes sources, records approval, runs
verification, or starts an Agent.

## Context

GitHub issue #85 traces this work to `SPEC-BATCH-REVIEW/R-003`. Its predecessor
source-index implementation is TST-021 (#84), which is present in the current
checkout and supplies the validated batch index. `ADR-014` and
`specs/features/batch-review/contract.md` §§2–5, §12, §13 define the accepted
render contract. The current human session approved this Story for execution.

The command is `praxisbound review render <manifest> --output <file> [--json]`.
It is an additive public CLI capability. The result envelope remains at schema
version `1.0.0`; `success`, `failure`, `usage-error`,
`configuration-error`, and `ERROR` use the existing status/exit mappings.

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
* Boundary: `review projection Core module`
* Boundary: `review render CLI command`
* Contract: `review projection Core receives only already-read batch data and source bytes, produces an inert self-contained HTML string, and performs no I/O`
* Contract: `review render CLI owns filesystem reads, output conflict checks, atomic output publication, and one result envelope`
* Contract: `the generated HTML is a read-only projection; source text remains available and no source text becomes executable markup or an active dangerous URL`
* Owner: `review projection Core module = PraxisBound tooling`
* Owner: `review render CLI command = PraxisBound tooling`

## Risk

* Level: high
* Reason: `security`
* Reason: `public-contract`
* Signal: `error-projection`

## Error Projection

* Source failure: `invalid render arguments, unsafe input or output collision, output staging/write/rename failure, or unexpected renderer failure`
* Public projection: `usage-error/configuration-error exit 2, failure exit 1, or sanitized ERROR exit 3 with stable issue codes`
* Detail policy: `result envelopes use repository-relative paths and stable issue codes only; raw filesystem errors, absolute paths, source bytes, and temporary filenames are not exposed`
* Evidence AC: `AC-009`

## Scope

### In Scope

* The `praxisbound review render` command and help text.
* A pure Core HTML projection renderer fed by the existing source index and
  declared source bytes.
* Self-contained editorial HTML, inline CSS, responsive navigation, keyboard
  reachable source links, and A4-oriented print CSS that hides fixed controls.
* Source, fingerprint, diagnostic, trace, and document rendering; Story Goal,
  Scope, Rules, Expected Errors, Constraints, and Acceptance are visibly
  promoted without removing the full source text.
* Safe HTML and URL projection, output-conflict rejection, and atomic
  replacement of a successful output file.
* CLI-contract documentation and behavior tests, including browser/print
  observation evidence for a representative fixture.

### Out of Scope

* Interactive annotations, revision-sheet import/export, confirmation,
  preflight, packet generation, ForgePilot work, PDF generation, remote
  assets, third-party Markdown/rendering dependencies, and changes to
  `protocol/`, `templates/`, or `VERSION`.
* Inferring files or requirement relationships beyond the manifest/index.
* Reporting a source or acceptance item as executed, passed, approved, or
  complete based on the projection or a reader interaction.

## Inputs

* A Batch Manifest path, as specified by `review index`.
* The index and declared source bytes obtained from the local working tree.
* `--output <file>`, a caller-controlled output path.

## Outputs

* On success, one self-contained UTF-8 HTML file at the requested safe output
  path and a schema-valid `success` envelope whose `data` includes the batch
  identity, fingerprint, sources, diagnostics, and output path.
* On a diagnosed output-write problem, a schema-valid `failure` envelope,
  exit 1; the last successful output remains byte-identical.
* On invalid argv, invalid manifest, unsafe source, or output conflict, the
  existing `usage-error`/`configuration-error` result with exit 2.

## Rules

* R1: Render only the manifest's declared batch. Reuse the existing index for
  fingerprint, trace, and diagnostics; missing/incomplete sources remain
  readable diagnostics on a `success` result.
* R2: The projection contains no network URLs, external scripts, stylesheets,
  fonts, images, frames, or embeds. It must work opened directly from disk.
* R3: Source text is escaped before entering HTML. It may be structured for
  reading, but full verbatim source remains available. Event attributes,
  `script`, `style`, embedded-content elements, and dangerous URL schemes are
  never emitted from untrusted input.
* R4: Only `http:`, `https:`, `mailto:`, and relative fragment links can become
  anchors. Any other Markdown URL is rendered as readable text without an
  `href`.
* R5: The HTML identifies itself as a reading snapshot, shows the Requirement
  Fingerprint and sources, and never presents unchecked acceptance criteria or
  reader interactions as test PASS or human approval.
* R6: Navigation is semantic HTML and keyboard reachable. On narrow screens,
  long tables scroll within their container and code/preformatted text wraps or
  scrolls locally rather than widening the page. Print CSS exposes all source
  content and hides fixed reading controls.
* R7: Before writing, reject an output that is a symlink or resolves to the
  manifest, any declared source, or the batch `records/` directory with
  `REVIEW_OUTPUT_CONFLICT`. Do not alter any source or prior successful output.
* R8: Publish through a unique temporary file in the output directory followed
  by rename. A failure cleans its temporary file and does not replace a prior
  successful output.
* R9: The command never runs `make verify`, never modifies input files, and
  never creates approval, completion, or Agent state.

## Expected Errors

* Missing/extra argv or missing `--output`: `usage-error`, exit 2.
* Invalid/unsafe manifest and sources: the same `configuration-error` behavior
  as `review index`, exit 2.
* Output collision or output symlink: `configuration-error`, exit 2,
  `REVIEW_OUTPUT_CONFLICT`.
* A known output write/rename failure: `failure`, exit 1, with an output issue;
  a prior output remains unchanged.
* Unexpected failure: `ERROR`, exit 3.

## Dependencies

* TST-021 provides `review index` and its pure indexed batch shape.
* `ADR-014` and the batch-review contract are accepted.
* TST-002 provides the existing result-envelope mappings reused here.

## Constraints

* Add no dependency.
* Every fixture repository is created inside the test temporary directory;
  tests never use this repository's own batch documents as their subject.
* `make verify` is authoritative for completion.
* Classify the CLI change as Additive in this Story and update the CLI contract;
  no Protocol or template surface changes.
* Do not merge, publish, tag, release, deploy, or push.

## Guidance

Relevant:

* principle: small coherent changes
* principle: behavior-oriented testing
* principle: explicit dependencies
* decision: `ADR-014` defines Review Projections as non-authoritative

Not applicable:

* no persistent-data migration, publication, or Protocol change applies

## Trust Boundary Fields

* `batch.json` — untrusted manifest content.
* `source markdown body` — untrusted source text projected into HTML.
* `source markdown link` — untrusted URL candidate projected into HTML.
* `manifest` — caller-controlled manifest path argument.
* `--output` — caller-controlled output path argument.
* `filesystem output path` — existing destination type and symlink state.
* `filesystem output directory` — mutable parent directory used for atomic publication.
* `diagnostics message` — derived untrusted text emitted into HTML and envelopes.
* `locator.anchor` — derived untrusted text emitted into HTML and envelopes.
