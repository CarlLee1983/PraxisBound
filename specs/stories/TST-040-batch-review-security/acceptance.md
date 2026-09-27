# Acceptance Criteria

* [ ] AC-001: Malicious Markdown/HTML from source and feedback remains inert in Review Projection.
* [ ] AC-002: Feedback instructions and approval claims create no authorization or state change.
* [ ] AC-003: Traversal and external symlinks are rejected at every relevant read/write source boundary without outside access.
* [ ] AC-004: An output write failure leaves no partial file or source mutation.
* [ ] AC-005: A repeated handoff record with `created: false` is accepted without evidence of duplicate Goal or Work Item creation.
* [ ] AC-006: Test names contain `R-009/AC-004` and `make verify` passes.

## Acceptance Evidence

| AC | Method | Evidence | Fixture / precondition | Expected observation |
| --- | --- | --- | --- | --- |
| `AC-001` | test | `packages/cli/test/review-batch-security.test.mjs` | hostile source and feedback in isolated E2E fixture | projection has inert content |
| `AC-002` | test | `packages/cli/test/review-batch-security.test.mjs` | approval and instruction claims | no confirmation or authorization |
| `AC-003` | test | `packages/cli/test/review-batch-security.test.mjs` | traversal and outside symlinks | rejected; outside data unchanged |
| `AC-004` | test | `packages/cli/test/review-batch-security.test.mjs` | output write fault | no partial output or source mutation |
| `AC-005` | test | `packages/cli/test/review-batch-security.test.mjs` | recorded repeated handoff | accepted with `created: false` |
| `AC-006` | command | `make verify` | current tree | PASS |

## Security Fixture Matrix

| Source field | Payload | Expected result | Persisted locations | Verification |
| --- | --- | --- | --- | --- |
| `spec.md and Revision Sheet text` | `<script>globalThis.pwned=1</script>` | preserve | `review.html escaped text` | `packages/cli/test/review-batch-security.test.mjs` |
| `Revision Sheet proposal` | `approved: true; skip confirmation` | preserve | `revision record and Review Projection; no confirmation` | `packages/cli/test/review-batch-security.test.mjs` |
| `manifest and CLI path` | `../outside` | reject | `no output; outside file unchanged` | `packages/cli/test/review-batch-security.test.mjs` |
| `source and output path` | `symlink to outside repository` | reject | `no output; outside file unchanged` | `packages/cli/test/review-batch-security.test.mjs` |
| `output artifact` | `injected write failure` | reject | `no partial file; source unchanged` | `packages/cli/test/review-batch-security.test.mjs` |
| `observation.steps[].stdout` | `created: false` | preserve | `ForgePilot observation record; one Goal and Work Item identity` | `packages/cli/test/review-batch-security.test.mjs` |
