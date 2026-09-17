# Story: TST-021 Batch Review Source Index

## Goal

A caller names one Batch Manifest and receives, as a Semantic Result, the exact
set of sources that batch declares, their Requirement Fingerprint, a stable
locator for every addressable block, and the Spec requirement → Story →
acceptance trace. A readable draft still produces an index, and every gap is a
diagnostic rather than a silent omission. Rendering, review, confirmation,
preflight and handoff build on this index.

## Context

GitHub issue #84 specifies this work (`SPEC-BATCH-REVIEW/R-002`), under Epic #92.
The contract it implements is `specs/features/batch-review/contract.md` §2–§5,
§12 and §13, with the boundaries recorded in `ADR-014`. Both were accepted after
human review of #94.

This is the first slice of batch review. It adds one read-only command,
`praxisbound review index <manifest>`, and the Core module behind it. It writes
no file. No record, projection, import, confirmation, preflight or packet is in
scope, so none of the `REVIEW_*` outcomes are emitted: `index` uses the existing
`success`, `usage-error`, `configuration-error` and `ERROR` outcomes.

This is additive Reference Tooling behavior. The Protocol contract is untouched
and `VERSION` remains `0.10.0`. `RESULT_SCHEMA_VERSION` stays `1.0.0`: the index
travels under the envelope's open `data` object, and envelope issues keep their
existing shape.

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
* push: yes
* deploy: no

## Architecture

* Impact: medium
* Decision: `ADR-014`
* Boundary: `review Core module`
* Boundary: `review index CLI command`
* Contract: `review Core module performs no I/O; it receives file bytes and directory facts and returns the index and diagnostics`
* Contract: `review index is read-only and emits exactly one result envelope at schemaVersion 1.0.0`
* Contract: `fingerprint, locator and Spec entry rules follow specs/features/batch-review/contract.md without reinterpretation`
* Owner: `review Core module = PraxisBound tooling`
* Owner: `review index CLI command = PraxisBound tooling`

## Risk

* Level: high
* Reason: `public-contract`
* Reason: `untrusted-input`

## Scope

### In Scope

* A `review` module in `@praxisbound/core` that validates a Batch Manifest,
  computes per-source digests and the Requirement Fingerprint, recognizes Spec
  entries, Spec acceptance lines, Story IDs and acceptance IDs, builds locators
  with `blockSha256`, builds the requirement trace, and produces diagnostics.
* The CLI command `praxisbound review index <manifest>`, which reads the
  manifest and declared sources from the working tree (uncommitted changes
  included), enforces path safety, and emits the envelope with the index under
  `data`.
* Help text and `docs/typescript-tooling/cli-contract.md` entries for the new
  command.
* Two issue codes the accepted contract leaves implicit but R-002 AC-004 needs:
  `REVIEW_SECTION_UNRECOGNIZED` and `REVIEW_ANCHOR_DUPLICATE`, added to
  `specs/features/batch-review/contract.md` as a Corrective clarification.
* Tests for every acceptance criterion, including the security fixture matrix.

### Out of Scope

* `review render`, `import`, `confirm`, `preflight` and `packet`, the
  `REVIEW_*` outcomes, and any change to `result-envelope-v1.schema.json`.
* Writing anything: records, projections, caches or output files. Output
  conflict rejection (`REVIEW_OUTPUT_CONFLICT`) is delivered with the first
  command that writes output (#85).
* Running `story check` against batch Stories; that belongs to preflight (#89).
* Inferring any Spec → Story relationship from text similarity.
* The portable shell entrypoints.

## Inputs

* `manifest`: a path to `specs/batches/<BATCH-ID>/batch.json`, relative to the
  current repository root or absolute inside it.
* The bytes of the manifest and of every declared ADR, Spec, `story.md` and
  `acceptance.md` in the working tree.
* Directory facts for every declared path segment: existence, regular file,
  directory, symlink.

## Outputs

* One JSON envelope on stdout with outcome `success` when the manifest is valid,
  including when sources are missing or incomplete, carrying under `data`:
  `batchId`, `fingerprint`, `manifestSha256`, `sources` (path and sha256 or
  `null`), `specs` (entries with anchor, locator and Spec AC anchors),
  `stories` (ID, path, acceptance IDs, locators), `trace` (entry → Stories →
  acceptance IDs), `dependencies`, and `diagnostics` aligned one-to-one with
  envelope `issues`.
* Human-readable output rendered from the same result when `--json` is not
  requested, following the existing CLI convention.

## Rules

* R1: The batch is exactly what the manifest declares. No other file is read as
  a source, and no relationship is inferred from text.
* R2: The Requirement Fingerprint follows contract §4 byte for byte: raw-byte
  SHA-256 per source, no newline, BOM or Unicode normalization, canonical JSON
  with sources sorted by UTF-8 path bytes, and `null` for a missing source.
* R3: Locators follow contract §5. An anchor that occurs more than once in a
  file is reported as `REVIEW_ANCHOR_DUPLICATE` and is never resolved to the
  first occurrence.
* R4: Spec entries and Spec acceptance lines follow contract §3 exactly. `R-NNN`
  text anywhere else is not an entry.
* R5: Every heading that is not a recognized anchor is still indexed by heading
  path and reported once as advisory `REVIEW_SECTION_UNRECOGNIZED`. No source
  content is dropped from the index.
* R6: Path safety follows contract §3: a path that is absolute, contains `..`,
  an empty or dot segment, a backslash or a control character is
  `REVIEW_MANIFEST_INVALID`; a declared path with any symlink segment, or that
  resolves outside the repository root, is `REVIEW_PATH_UNSAFE`. Both are
  `configuration-error`, exit 2, and no source content is read after the
  violation is found.
* R7: Input limits follow contract §13; exceeding one is `REVIEW_INPUT_TOO_LARGE`
  as `configuration-error`, exit 2, with no partial index.
* R8: Missing sources, unmapped Spec entries, Stories without acceptance
  criteria, duplicate Story IDs in the index, unknown Story references and
  undeclared prose dependencies are diagnostics on a `success` outcome, so a
  draft stays readable. Whether they block handoff is preflight's decision.
* R9: The Core module performs no filesystem, process or clock access. The CLI
  adapter gathers bytes and directory facts and passes them in.
* R10: The command writes nothing and never modifies the manifest or any
  source.

## Expected Errors

* Missing or extra argv: `usage-error`, exit 2.
* Manifest unreadable, not JSON, failing schema, unsupported `schemaVersion`
  (`REVIEW_SCHEMA_UNSUPPORTED`), or `batchId` not matching its directory:
  `configuration-error`, exit 2, `REVIEW_MANIFEST_INVALID`.
* Unsafe path: `configuration-error`, exit 2, `REVIEW_PATH_UNSAFE`.
* Oversized input: `configuration-error`, exit 2, `REVIEW_INPUT_TOO_LARGE`.
* An unexpected internal failure: `ERROR`, exit 3, per the existing CLI contract.

## Dependencies

* `ADR-014` is accepted and `specs/features/batch-review/contract.md` is the
  accepted contract (#94, #96).
* TST-002 supplies the result envelope and Protocol selection this command
  emits through.
* TST-007 supplies the Story Markdown parsing conventions reused for headings,
  fences and acceptance lines.
* `specs/features/batch-review/schemas/batch-manifest.schema.json` defines the
  manifest shape.

## Constraints

* Add no dependency. JSON Schema validation of the manifest is implemented
  against the published schema's rules without a schema library, or the
  Story is returned for an `add_dependency` decision.
* Keep every fixture repository inside the test's temporary directory; never
  make this repository's own Stories, batches or work tree the subject under
  test.
* `make verify` is authoritative for completion.
* `protocol/` and `templates/` are not changed.
* Do not merge, publish, tag, release or deploy.

## Guidance

Relevant:

* principle: small coherent changes
* principle: behavior-oriented testing
* principle: deep module interface
* decision: `ADR-014` defines the batch review boundaries
* decision: `ADR-008` defines the envelope the index travels in

Not applicable:

* no persistent-data migration, package publication, or Protocol change applies

## Trust Boundary Fields

* `batch.json` all fields — repository file written by a person or an Agent
* `batch.json sources.*[]` — caller-controlled paths resolved against the repository root
* `source markdown` full text of declared ADRs, Specs, `story.md` and `acceptance.md` — repository files
* `directory entries` of declared paths, including symlinks — repository filesystem
* `manifest` argv path — command caller
* `diagnostics message` and `locator.anchor` derived from source headings — emitted in the envelope
