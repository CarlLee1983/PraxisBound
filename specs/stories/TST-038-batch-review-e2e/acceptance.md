# Acceptance Criteria

* [ ] AC-001: A fixture builder creates two Specs and four dependent Stories, Readiness Sidecars and make verify inside the test temporary directory; repository Stories and worktree are never the subject under test.
* [ ] AC-002: The built CLI exercises index, render, import, respond, re-render, confirm, preflight, readiness-digests, goal-plan and observe; Definition Confirmation uses the existing injected terminal adapter without a noninteractive bypass.
* [ ] AC-003: Goal Plan reports REVIEW_READY and preserves all four declared Story dependencies.
* [ ] AC-004: Recorded real ForgePilot output is replayed and accepted by review observe without invoking ForgePilot or a paid model.
* [ ] AC-005: The success test name contains R-009/AC-001 and make verify passes.
* [ ] AC-006: Parent #125 Story 2 return paths have independent cases for stale sources, unmapped requirements, external dependencies, cycles, missing Semantic Report, stale feedback, unresolved blockers, unauthorized run records and missing preflight records; stale contract test paths point to actual test files.

## Acceptance Evidence

| AC | Method | Evidence | Fixture / precondition | Expected observation |
| --- | --- | --- | --- | --- |
| `AC-001` | command | `make verify` | `isolated fixtures and documented review` | `criterion demonstrated in verification.md` |
| `AC-002` | command | `make verify` | `isolated fixtures and documented review` | `criterion demonstrated in verification.md` |
| `AC-003` | command | `make verify` | `isolated fixtures and documented review` | `criterion demonstrated in verification.md` |
| `AC-004` | command | `make verify` | `isolated fixtures and documented review` | `criterion demonstrated in verification.md` |
| `AC-005` | command | `make verify` | `isolated fixtures and documented review` | `criterion demonstrated in verification.md` |
| `AC-006` | command | `make verify` | `isolated fixtures and documented review` | `criterion demonstrated in verification.md` |
