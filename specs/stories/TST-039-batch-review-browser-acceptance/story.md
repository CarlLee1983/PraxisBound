# Story: TST-039 Review Projection browser and A4 visual acceptance

## Goal

Record the manual visual acceptance requested by GitHub #130 for
`SPEC-BATCH-REVIEW/R-009/AC-005`, using the two-Spec, four-Story fixture from
TST-038. The observations, rather than an untested browser claim, determine
the support statement used by the subsequent guide ticket #131.

## Classification

* Security sensitive: no
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

The human invoked `implement-spec #130`, which authorizes an evidence branch
and PR. This Story does not authorize merging the PR, changing product code,
or claiming acceptance for an unobserved print capability.

## Scope

### In Scope

* Render the TST-038 isolated fixture and inspect initial, exported and
  restored annotation, revised source with review marker, and disabled browser
  storage states in Chrome and WebKit.
* Inspect each state at 1280 px, 390 px, and A4 print media. Record the exact
  browser versions, screenshots or PDF, and whether source, fingerprint, and
  visible opinion content remain accessible without clipping.
* State untested browser and print capabilities as unverified.

### Out of Scope

* Product code changes, automated screenshot comparison, browser dependency
  additions, ForgePilot execution, and the user guide owned by #131.

## Dependencies

* GitHub #127 / TST-038 provides the fixture and success path.
* GitHub #131 uses this evidence for its browser support statement.

## Constraints

* Use Playwright MCP for browser operations and keep its installation outside
  the repository.
* A print-media screenshot is not proof of physical A4 pagination; record that
  distinction when a browser cannot produce an A4 PDF through Playwright.
* A skipped, blocked, or unsupported check remains visible in verification.
