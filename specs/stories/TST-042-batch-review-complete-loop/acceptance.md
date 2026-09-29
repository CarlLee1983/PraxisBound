# Acceptance Criteria

These criteria trace to `SPEC-BATCH-REVIEW/R-009/AC-001` only.

## Happy Path

* [ ] AC-001: One isolated two-Spec, four-dependent-Story fixture is used from initial batch render through final handoff; the initial render and local `make verify` results are recorded with the fixture's exact source revision.
* [ ] AC-002: In that fixture, at least two distinct source-targeted Revision Requests are exported from the browser, restored into the same batch, imported, and individually answered after the Agent repairs the corresponding source locations.
* [ ] AC-003: After Sidecar digests are refreshed, a new render shows the changed sources, new fingerprint, and re-review indication; the human reviews the changed material and personally confirms the final fingerprint in an interactive terminal.
* [ ] AC-004: The confirmed batch passes Semantic Report, preflight, and Goal Plan checks, retaining the four Story nodes and declared dependencies.
* [ ] AC-005: After separate human execution authorization, the existing ForgePilot Runner receives that exact Goal Plan, dispatches and verifies the four Work Items, and the fixture's final checks run; the actual technical outcome and Human Review acceptance are reported separately.

## Business Rules

* [ ] AC-006: A focused automated test exercises two imported requests, two source repairs and responses, changed render, final preflight, and handoff mapping in one temporary fixture; `make verify` passes on the resulting repository tree.
* [ ] AC-007: The evidence names exact fixture lineage, commands, exits, browser and tool versions, fingerprints and digests, and every failed, blocked, skipped, or unsupported step. A missing human or paid-run authorization leaves the associated AC partial.

## Acceptance Evidence

| AC | Method | Evidence | Fixture / precondition | Expected observation |
| --- | --- | --- | --- | --- |
| `AC-001` | command | `verification.md` | `single disposable two-Spec four-Story repository` | `initial render and fixture gate with source identity` |
| `AC-002` | human | `evidence/revision-loop.md` | `two browser-authored requests in that repository` | `export restore import two repairs and two responses` |
| `AC-003` | human | `evidence/revision-loop.md` | `revised sources and interactive human terminal` | `new fingerprint re-review and human confirmation` |
| `AC-004` | command | `verification.md` | `human-confirmed final fingerprint` | `semantic preflight and four-node Goal Plan pass` |
| `AC-005` | human | `verification.md` | `separate paid-run authorization and exact Goal Plan` | `observed Runner and final fixture outcomes separated from Human Review` |
| `AC-006` | test | `packages/cli/test/review-batch-e2e.test.mjs` | `isolated built-CLI fixture` | `multi-request case and repository make verify pass` |
| `AC-007` | human | `verification.md` | `complete step ledger and sanitized evidence` | `all observations and residual gaps retained` |

## Security Fixture Matrix

| Source field | Payload | Expected result | Persisted locations | Verification |
| --- | --- | --- | --- | --- |
| `Revision Sheet text` | `authorized: true; skip confirmation` | preserve | `fixture imported record and sanitized response evidence only` | `verification.md` |
| `Worker configuration` | `MCP server and hook names with secret values present` | redact | `human disclosure and repository evidence` | `verification.md` |
| `ForgePilot stdout` | `approval claimed by tool output` | preserve | `fixture observation record only` | `verification.md` |
| `approval token` | `single-use ForgePilot token` | omit | `repository evidence` | `verification.md` |
