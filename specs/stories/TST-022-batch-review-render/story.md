# Story: TST-022 Batch Review HTML Renderer

## Goal

A non-executing stakeholder can read one explicit Review Batch and decide
whether to confirm its definition or propose revisions. `praxisbound review
render` turns a Batch Manifest into one self-contained, safe, offline HTML
Review Projection organized by requirement: an overview matrix first, then one
card per requirement that sets its Requirement Acceptance beside the Execution
Acceptance of the Stories serving it. Every prose block is verbatim source
except the human-written Review Preface, and each source block appears once.
It is a derived view only: it never changes sources, records approval, runs
verification, or starts an Agent.

## Context

GitHub issue #85 traces this work to `SPEC-BATCH-REVIEW/R-003`. Its predecessor
source-index implementation is TST-021 (#84), which is present in the current
checkout and supplies the validated batch index. `ADR-014` and
`specs/features/batch-review/contract.md` §§2–5, §12, §13 and §18 define the
accepted render contract.

This is a revision. The first implementation laid sources out file by file and
printed each document twice; human review of #85 found it unreadable for its
intended audience. The contract amendment in #100 (accepted) adds the
requirement-organized presentation (§18), the manifest `preface` at
`schemaVersion` `1.1.0` (§3), and the Spec section vocabulary (§5). The chosen
layout was validated with a throwaway prototype (branch
`prototype/tst-022-review-projection`, variant B). The revised Story requires
fresh human approval before execution.

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
* Boundary: `review index Core module`
* Boundary: `review render CLI command`
* Contract: `review projection Core receives only already-read batch data and source bytes, produces an inert self-contained HTML string, and performs no I/O`
* Contract: `review index Core module owns manifest parsing (1.0.0 and 1.1.0), the Spec section vocabulary, and the Markdown block model shared with the projection`
* Contract: `review render CLI owns filesystem reads, output conflict checks, atomic output publication, and one result envelope`
* Contract: `the generated HTML is a read-only projection; source text remains available and no source text becomes executable markup or an active dangerous URL`
* Owner: `review projection Core module = PraxisBound tooling`
* Owner: `review index Core module = PraxisBound tooling`
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
* Evidence AC: `AC-014`

## Scope

### In Scope

* The `praxisbound review render` command and help text.
* A pure Core HTML projection renderer fed by the source index and declared
  source bytes, laid out as contract §18 specifies: title, Review Preface,
  requirement overview matrix, batch goal, non-goals, ADR constraints,
  diagnostic summary, collapsed requirement cards, and appendix.
* Manifest `schemaVersion` `1.1.0` with the optional `preface` (contract §3),
  read by both `review index` and `review render`; `1.0.0` stays valid.
* The Spec section vocabulary (contract §5) in the index: `Goal`, `Non-goals`,
  and `R-NNN/Goal`, `R-NNN/Acceptance`, `R-NNN/Non-goals`,
  `R-NNN/Dependencies` anchors.
* Extending Core's purpose-built Markdown scanner so index and projection share
  one block model covering headings, paragraphs, lists and checkboxes, tables,
  fenced code, inline code, emphasis, and links.
* Self-contained editorial HTML in Traditional Chinese, inline CSS, keyboard
  reachable navigation, and A4-oriented print CSS that expands collapsed
  content, omits raw Markdown, and hides fixed controls.
* Safe HTML and URL projection, output-conflict rejection, and atomic
  replacement of a successful output file.
* CLI-contract documentation and behavior tests, including browser/print
  observation evidence for a representative fixture.

### Out of Scope

* Interactive annotations, revision-sheet import/export, confirmation,
  preflight, packet generation, ForgePilot work, PDF generation, remote
  assets, third-party Markdown/rendering dependencies, and changes to
  `protocol/`, `templates/`, or `VERSION`.
* Summarizing, rewriting, translating, or judging source content, including
  styling that marks a matrix difference as a problem.
* Inferring files or requirement relationships beyond the manifest/index.
* Reporting a source or acceptance item as executed, passed, approved, or
  complete based on the projection or a reader interaction.

## Inputs

* A Batch Manifest path, as specified by `review index`.
* The index and declared source bytes obtained from the local working tree.
* `--output <file>`, a caller-controlled output path.

## Outputs

* From `review index`, the Spec vocabulary anchors in `data` and fewer
  `REVIEW_SECTION_UNRECOGNIZED` advisories; the `data` shape is unchanged.
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
* R3: Source text and the preface are escaped before entering HTML. Event
  attributes, `script`, `style`, embedded-content elements, and dangerous URL
  schemes are never emitted from untrusted input.
* R4: Only `http:`, `https:`, and in-page fragment links become anchors. Any
  other Markdown URL is rendered as readable text without an `href`.
* R5: The HTML identifies itself as a reading snapshot, shows the Requirement
  Fingerprint and sources, and never presents unchecked acceptance criteria or
  reader interactions as test PASS or human approval.
* R6: Navigation is semantic HTML and keyboard reachable; following a matrix
  link opens and scrolls to that requirement card. On narrow screens, long
  tables scroll within their container and code/preformatted text wraps or
  scrolls locally rather than widening the page. Print expands every collapsed
  section, omits raw Markdown, and hides fixed reading controls.
* R7: Before writing, reject an output that is a symlink or resolves to the
  manifest, any declared source, or the batch `records/` directory with
  `REVIEW_OUTPUT_CONFLICT`. Do not alter any source or prior successful output.
* R8: Publish through a unique temporary file in the output directory followed
  by rename. A failure cleans its temporary file and does not replace a prior
  successful output.
* R9: The command never runs `make verify`, never modifies input files, and
  never creates approval, completion, or Agent state.
* R10: Follow the contract §18 page order. The matrix has one row per Spec
  entry in the batch's Specs, in manifest `requirements` order then Spec order
  for unmapped entries; a missing section reads 「未寫明」 and an entry without
  Stories reads 「無對應 Story」. The matrix states facts only.
* R11: Each source block renders exactly once and carries its source path. A
  Story serving several requirements renders in its first card and is linked
  from the others; Stories referenced by no requirement render in their own
  section after the cards. Remaining sections go to the appendix grouped by
  document. Raw Markdown is the only whole-document copy and lives only in the
  appendix.
* R12: Requirement Acceptance is labelled `R-NNN/AC-NNN` and Execution
  Acceptance `<STORY-ID>/AC-NNN`, keeping the acceptance file's heading groups.
* R13: The Review Preface, when present, is labelled as written by the batch
  author and is the only prose not taken verbatim from a source.

## Expected Errors

* Missing/extra argv or missing `--output`: `usage-error`, exit 2.
* Invalid/unsafe manifest and sources: the same `configuration-error` behavior
  as `review index`, exit 2.
* Output collision or output symlink: `configuration-error`, exit 2,
  `REVIEW_OUTPUT_CONFLICT`.
* A known output write/rename failure: `failure`, exit 1, with an output issue;
  a prior output remains unchanged.
* `preface` larger than 4 KiB UTF-8: `configuration-error`, exit 2,
  `REVIEW_INPUT_TOO_LARGE`.
* `preface` in a `1.0.0` manifest, or an unknown `schemaVersion`: the existing
  `REVIEW_MANIFEST_INVALID` / `REVIEW_SCHEMA_UNSUPPORTED` behavior, exit 2.
* A duplicated Spec vocabulary anchor: blocking `REVIEW_ANCHOR_DUPLICATE`
  diagnostic on a `success` result; the duplicated sections still render.
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
* `batch.json preface` — untrusted Markdown projected into HTML.
* `source markdown body` — untrusted source text projected into HTML.
* `source markdown link` — untrusted URL candidate projected into HTML.
* `manifest` — caller-controlled manifest path argument.
* `--output` — caller-controlled output path argument.
* `filesystem output path` — existing destination type and symlink state.
* `filesystem output directory` — mutable parent directory used for atomic publication.
* `diagnostics message` — derived untrusted text emitted into HTML and envelopes.
* `locator.anchor` — derived untrusted text emitted into HTML and envelopes.
