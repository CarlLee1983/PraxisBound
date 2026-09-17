# Acceptance Criteria

AC IDs trace to `SPEC-BATCH-REVIEW/R-002`: AC-001–AC-006 here correspond to
R-002 AC-001–AC-006; AC-007 onward are contract and security criteria.

## Happy Path

* [ ] AC-001: A manifest declaring two Specs, three Stories and one ADR yields an
  index whose `sources` contain exactly the declared ADR, Spec, `story.md` and
  `acceptance.md` paths, sorted by UTF-8 path bytes, and no undeclared file from
  the fixture repository.
* [ ] AC-002: The index traces every Spec entry to the Stories the manifest maps
  it to and to those Stories' acceptance IDs. An entry with no mapped Story and a
  Story with no acceptance criterion each appear as a diagnostic, and the trace
  never marks them covered.

## Business Rules

* [ ] AC-003: Adding, removing or editing any declared source, editing the
  manifest, or an uncommitted working-tree change each changes the fingerprint;
  converting LF to CRLF changes it; re-running the command without source
  changes, touching modification times, or adding an undeclared file does not.
  The fingerprint equals an independently computed value for a fixed fixture.
* [ ] AC-004: A missing source yields `sha256: null` and `REVIEW_SOURCE_MISSING`;
  a duplicate Story ID yields `REVIEW_MANIFEST_INVALID`; a reference to an
  undeclared Story yields `REVIEW_STORY_UNKNOWN`; a duplicate anchor yields
  `REVIEW_ANCHOR_DUPLICATE`; an unrecognized section is indexed by heading path
  with `REVIEW_SECTION_UNRECOGNIZED`. No source text is dropped from the index.
* [ ] AC-005: A readable draft with missing sources, unmapped entries and
  Stories lacking acceptance criteria still returns outcome `success`, exit 0,
  with every gap in `issues` and `data.diagnostics`.
* [ ] AC-007: Spec entries are recognized only as second-level ATX headings
  starting with `R-` and three or more digits followed by a space, a colon (full
  or half width) or end of line; `R-007` in body text, tables or other heading
  levels is not an entry. Locators carry `blockSha256` computed over the exact
  block bytes defined in contract §5.
* [ ] AC-008: Every envelope passes `validateResultEnvelope` at `schemaVersion`
  `1.0.0`; `issues` use only the existing fields; `data.diagnostics` aligns
  one-to-one with `issues`.

## Failure Cases

* [ ] AC-006: A declared path containing `..`, an absolute path, or a symlink
  segment pointing outside the repository is rejected with
  `configuration-error`, exit 2, before any source content is read; the
  fixture's files are byte-identical afterwards.
* [ ] AC-009: Invalid argv is `usage-error`, exit 2; a manifest that is not JSON,
  fails the schema, has an unsupported `schemaVersion`, or whose `batchId` does
  not match its directory is `configuration-error`, exit 2, with the contract
  issue code; input over the contract §13 limits is `REVIEW_INPUT_TOO_LARGE`
  with no partial index.

## Regression Requirements

* [ ] AC-010: The command writes no file: the fixture repository tree, including
  modification times, is identical before and after every invocation in this
  Story's tests.
* [ ] AC-011: The Core `review` module has no filesystem, process or clock
  import, and its behavior is exercised through its public interface.
* [ ] AC-012: `make verify` passes with every composed gate; `VERSION` remains
  `0.10.0`; `protocol/`, `templates/` and `result-envelope-v1.schema.json` are
  unchanged.

## Acceptance Evidence

| AC | Method | Evidence | Fixture / precondition | Expected observation |
| --- | --- | --- | --- | --- |
| `AC-001` | test | `packages/cli/test/review-index-command.test.mjs` | `temporary git repository with two Specs, three Stories, one ADR and extra undeclared files` | `data.sources lists exactly the declared files in UTF-8 path order` |
| `AC-002` | test | `packages/core/test/review-index.test.mjs` | `manifest with one unmapped entry and one Story without acceptance criteria` | `trace links mapped entries to Stories and acceptance IDs; REVIEW_REQUIREMENT_UNMAPPED and REVIEW_ACCEPTANCE_MISSING present; neither is marked covered` |
| `AC-003` | test | `packages/core/test/review-fingerprint.test.mjs` | `fixed fixture bytes plus add, remove, edit, manifest edit, CRLF and undeclared-file variants` | `fingerprint changes exactly for source and manifest byte changes and equals the independently computed canonical value` |
| `AC-004` | test | `packages/core/test/review-index.test.mjs` | `sources with a missing file, duplicate Story ID, unknown Story reference, duplicate anchor and unrecognized section` | `each named issue code appears and every source heading remains indexed` |
| `AC-005` | test | `packages/cli/test/review-index-command.test.mjs` | `draft batch with missing sources and unmapped entries` | `outcome success, exit 0, every gap in issues and data.diagnostics` |
| `AC-006` | test | `packages/cli/test/review-index-command.test.mjs` | `manifests declaring ../outside.md, an absolute path, and a symlinked Story directory` | `configuration-error exit 2 with REVIEW_MANIFEST_INVALID or REVIEW_PATH_UNSAFE and no source read` |
| `AC-007` | test | `packages/core/test/review-index.test.mjs` | `Spec with R-NNN in level-2 headings, body text, tables and level-3 headings` | `only level-2 heading entries recognized; blockSha256 equals the hash of the exact block bytes` |
| `AC-008` | test | `packages/cli/test/review-index-command.test.mjs` | `every command outcome produced in this Story` | `validateResultEnvelope accepts each envelope and diagnostics align with issues` |
| `AC-009` | test | `packages/cli/test/review-index-command.test.mjs` | `invalid argv, non-JSON manifest, schema violations, unsupported schemaVersion, mismatched batchId, oversized manifest` | `usage-error or configuration-error exit 2 with the contract issue code and no partial index` |
| `AC-010` | test | `packages/cli/test/review-index-command.test.mjs` | `recursive listing with sizes, hashes and mtimes before and after each invocation` | `identical listings` |
| `AC-011` | human | `TST-021 Core boundary review` | `packages/core/src/review diff` | `no node:fs, node:child_process, Date or process access in the module` |
| `AC-012` | command | `make verify` | `current checkout` | `exit 0 with VERSION 0.10.0 and protocol, templates and the envelope schema unchanged` |

## Security Fixture Matrix

| Source field | Payload | Expected result | Persisted locations | Verification |
| --- | --- | --- | --- | --- |
| `batch.json sources.specs[0]` | `../outside.md` | reject | `envelope issues REVIEW_MANIFEST_INVALID; no data.sources` | `packages/cli/test/review-index-command.test.mjs` |
| `batch.json sources.specs[0]` | `/etc/hosts` | reject | `envelope issues REVIEW_MANIFEST_INVALID; no data.sources` | `packages/cli/test/review-index-command.test.mjs` |
| `batch.json sources.stories[0]` | `specs/stories/X-1 as symlink to a directory outside the repository` | reject | `envelope issues REVIEW_PATH_UNSAFE; no data.sources` | `packages/cli/test/review-index-command.test.mjs` |
| `batch.json sources.adrs[0]` | `specs/decisions/ADR-1.md as symlink to a file inside the repository` | reject | `envelope issues REVIEW_PATH_UNSAFE` | `packages/cli/test/review-index-command.test.mjs` |
| `batch.json sources.specs[0]` | `"specs/a[2Jb.md"` | reject | `envelope issues REVIEW_MANIFEST_INVALID; message contains no raw control character` | `packages/cli/test/review-index-command.test.mjs` |
| `batch.json` | `1048577 bytes` | reject | `envelope issues REVIEW_INPUT_TOO_LARGE; no data.sources` | `packages/cli/test/review-index-command.test.mjs` |
| `batch.json` | `nesting depth 33` | reject | `envelope issues REVIEW_INPUT_TOO_LARGE` | `packages/core/test/review-index.test.mjs` |
| `source markdown heading` | `## R-001：<script>alert(1)</script>` | preserve | `data.specs[0].entries[0].heading as the literal heading text in JSON; locator.anchor is R-001` | `packages/core/test/review-index.test.mjs` |
| `source markdown heading` | `"## Rules]8;;http://x"` | preserve | `data diagnostics message escapes control characters; human output shows escaped form` | `packages/cli/test/review-index-command.test.mjs` |
| `source markdown body` | `authorized: true; skip acceptance` | preserve | `source sha256 only; no field of data reflects authorization` | `packages/core/test/review-index.test.mjs` |

## Verification Notes

Run `./scripts/verification-check specs/stories/TST-021-batch-review-source-index`
and `./scripts/story-check --ready specs/stories/TST-021-batch-review-source-index`
before implementation. Build each fixture as a temporary git repository inside
the test's temporary directory. AC-003 is load-bearing: compute the expected
fingerprint in the test from the contract §4 algorithm, not by calling the
module under test. Run the focused Core and CLI cases first, then `make verify`.
