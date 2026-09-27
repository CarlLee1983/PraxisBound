# Acceptance Criteria

These criteria trace to GitHub #130 and `SPEC-BATCH-REVIEW/R-009/AC-005`.

## Happy Path

* [ ] AC-001: Observe four states from the TST-038 fixture: initial render;
  annotation, export, and restore; revised source with new fingerprint and
  `需複審`; and disabled-storage warning.
* [ ] AC-002: Observe each state in Chrome and WebKit at desktop 1280 px,
  narrow 390 px, and A4 print, without rounding unsupported print behavior
  up to a pass.
* [ ] AC-003: Inspect original source, fingerprint, and visible opinion text
  for clipping. Record any failure as a failure.

## Business Rules

* [ ] AC-004: Use Playwright MCP, add no repository dependency, and retain
  browser versions, screenshots or PDF, and written observations.
* [ ] AC-005: State browser capabilities not exercised here as `未驗證`.

## Acceptance Evidence

| AC | Method | Evidence | Fixture / precondition | Expected observation |
| --- | --- | --- | --- | --- |
| `AC-001` | human | `verification.md` | `TST-038 fixture` | `four-state-browser-record` |
| `AC-002` | human | `verification.md` | `Chrome and WebKit` | `desktop-narrow-a4-record-with-limits` |
| `AC-003` | human | `evidence/observations.md` | `source-fingerprint-and-opinion` | `clipping-inspection-record` |
| `AC-004` | human | `evidence/observations.md` | `Playwright MCP sessions` | `versions-and-artifacts` |
| `AC-005` | human | `evidence/observations.md` | `browser-support-scope` | `untested-capabilities-unverified` |
