# Acceptance Criteria

AC IDs trace to `SPEC-BATCH-REVIEW/R-003`. The command-line and output-file
seams are the agreed public seams for this Story.

## Happy Path

* [ ] AC-001: `praxisbound review render <manifest> --output <file>` produces
  one self-contained HTML Review Projection from exactly the declared batch.
  It shows the batch ID, Requirement Fingerprint, source list, diagnostics, and
  Spec requirement → Story → acceptance navigation, while retaining complete
  source text.
* [ ] AC-002: Story documents visibly promote Goal, Scope, Rules, Expected
  Errors, Constraints, and Acceptance, but the underlying source remains
  available verbatim rather than being replaced with an AI summary.
* [ ] AC-003: The generated file has no external resource URL and is usable
  directly from a local file URL. Navigation links are keyboard reachable;
  representative desktop and narrow-width renderings preserve readable text,
  long tables, and code.
* [ ] AC-004: In the recorded acceptance browser's A4 print preview, all source
  content is present and fixed reading controls are hidden.

## Business Rules

* [ ] AC-005: The HTML identifies itself as a reading snapshot and shows source
  identity. It never reports a source acceptance item as test PASS, completion,
  or human approval, and contains no control that implies those claims.
* [ ] AC-006: The command applies the same manifest/path/input handling as
  `review index`; a valid draft with missing sources or trace gaps still renders
  and preserves every diagnostic.

## Failure Cases

* [ ] AC-007: An output targeting the manifest, a declared source, the batch
  `records/` directory, or a symlink is rejected as `configuration-error`, exit
  2 with `REVIEW_OUTPUT_CONFLICT`; source and prior output bytes are unchanged.
* [ ] AC-008: A known output write or rename failure returns `failure`, exit 1,
  removes any temporary output, and leaves a prior successful output
  byte-identical.
* [ ] AC-009: Invalid render argv returns `usage-error`, exit 2; a non-JSON,
  schema-invalid, unsupported, or unsafe manifest returns the index command's
  `configuration-error`, exit 2. Every emitted envelope validates at schema
  version `1.0.0`.

## Regression Requirements

* [ ] AC-010: `make verify` passes; `VERSION` stays `0.10.0`; `protocol/` and
  `templates/` are unchanged; the public CLI addition is documented as
  Additive.

## Acceptance Evidence

| AC | Method | Evidence | Fixture / precondition | Expected observation |
| --- | --- | --- | --- | --- |
| `AC-001` | test | `packages/cli/test/review-render-command.test.mjs` | `declared-batch-fixture` | `trace-navigation-snapshot-and-verbatim-sources` |
| `AC-002` | test | `packages/core/test/review-render.test.mjs` | `promoted-story-sections-fixture` | `promoted-sections-and-verbatim-source` |
| `AC-003` | test | `packages/core/test/review-render.test.mjs` | `offline-responsive-security-fixture` | `inline-assets-safe-links-and-keyboard-navigation` |
| `AC-004` | human | `verification.md:Chrome-local-file-print-preview` | `representative-rendered-fixture` | `a4-complete-content-without-fixed-controls` |
| `AC-005` | test | `packages/core/test/review-render.test.mjs` | `unchecked-acceptance-fixture` | `no-pass-completion-or-approval-claim` |
| `AC-006` | test | `packages/cli/test/review-render-command.test.mjs` | `incomplete-draft-fixture` | `success-output-preserves-all-diagnostics` |
| `AC-007` | test | `packages/cli/test/review-render-command.test.mjs` | `output-conflict-fixture` | `configuration-error-and-unchanged-target` |
| `AC-008` | test | `packages/cli/test/review-render-command.test.mjs` | `output-publication-failure-fixture` | `failure-preserves-old-output-and-cleans-stage` |
| `AC-009` | test | `packages/cli/test/review-render-command.test.mjs` | `invalid-render-input-fixtures` | `documented-schema-valid-error-envelopes` |
| `AC-010` | command | `make verify` | `current-checkout` | `full-composed-gate-exit-0` |

## Security Fixture Matrix

| Source field | Payload | Expected result | Persisted locations | Verification |
| --- | --- | --- | --- | --- |
| `source markdown body` | `<script>alert(1)</script><img src=x onerror=alert(1)>` | preserve | `review.html source-text` | `packages/core/test/review-render.test.mjs` |
| `source markdown link` | `[x](javascript:alert(1))` | omit | `review.html anchor.href` | `packages/core/test/review-render.test.mjs` |
| `source markdown link` | `[x](data:text/html,...)` | omit | `review.html anchor.href` | `packages/core/test/review-render.test.mjs` |
| `--output` | `manifest-source-records-or-symlink-path` | reject | `result.issues[*].code` | `packages/cli/test/review-render-command.test.mjs` |

## Verification Notes

Run `./scripts/verification-check specs/stories/TST-022-batch-review-render`
and `./scripts/story-check --ready specs/stories/TST-022-batch-review-render`
before implementation. Start with Core projection tests, then the public CLI
output seam. Build fixtures within test temporary directories. Use a direct
local-file browser check for the visual and print criterion; this is evidence
for the named browser only, not a claim of pixel parity across browsers.
