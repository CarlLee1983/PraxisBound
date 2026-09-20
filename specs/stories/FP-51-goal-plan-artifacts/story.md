# Story: FP-51 Goal Plan Manifest and Plan Coverage Review artifacts

## Goal

Provide PraxisBound-owned, versioned Goal Plan Manifest and Plan Coverage
Review v1 artifacts so downstream ForgePilot can consume an explicitly reviewed
planning input without inferring requirements, topology, or approval.

## Context

ForgePilot issue #51 is the canonical requirement for this Story. Its parent
specification (#50) requires an upstream planning boundary before ForgePilot
can authorize or run a Goal: the complete plan must be explicit, and coverage
approval must remain bound to the exact reviewed sources and manifest bytes.

PraxisBound already has review-oriented source and trace conventions, but it
does not yet export the dedicated Goal Plan Manifest and Plan Coverage Review
documents required by that downstream contract. This Story delivers only the
PraxisBound v1 artifact surface, its validators, and portable canonical
raw-byte fixtures. It neither imports the artifacts into ForgePilot nor claims
that a consumer can decide what requirements mean or approve a review.

## Classification

- Security sensitive: yes
- Baseline conformance: no
- Task mode: execution

## Authority

- plan: yes
- modify: yes
- add_dependency: no
- migration: no
- commit: no
- push: no
- deploy: no

## Architecture

- Impact: medium
- Boundary: `Goal Plan artifact schema and validation`
- Boundary: `Plan Coverage Review export and validation`
- Boundary: `downstream planning-input consumer`
- Contract: `each v1 artifact validates its own supported schema version and binds source identities and exact raw-byte SHA-256 digests without newline, BOM, Unicode, or JSON reserialization normalization`
- Contract: `a v1 Manifest binds plan identity and revision, unique Plan Node References, Story references, each Readiness Contract identity/digest, complete dependency references, and exact reviewed source digests`
- Contract: `a Plan Coverage Review declares review identity, exact Manifest digest, reviewed source digests, coverage-index identity, approved conclusion, self-declared approver, and approval time`
- Contract: `the Coverage Review binding names the exact Goal Plan Manifest bytes and complete reviewed source identities and digests`
- Contract: `PraxisBound exports reviewed planning facts; downstream consumers, including ForgePilot, neither receive requirement-semantics authority nor an automatic coverage-approval capability`
- Owner: `Goal Plan artifact schema and validation = PraxisBound tooling`
- Owner: `Plan Coverage Review export and validation = PraxisBound tooling`
- Owner: `downstream planning-input consumer = consumer repository`

## Risk

- Level: high
- Reason: `public-contract`
- Reason: `untrusted-input`
- Signal: `error-projection`

## Error Projection

- Source failure: `unsupported schema, malformed artifact, invalid plan topology, source identity or raw-byte digest mismatch, or missing or mismatched approval binding`
- Public projection: `validator returns a stable machine-readable rejection that names the artifact class and failure category without accepting a partial artifact`
- Detail policy: `diagnostics identify declared artifact fields, identities, and expected-versus-observed digests only; they do not reinterpret source requirements or manufacture approval`
- Evidence AC: `AC-005`

## Scope

### In Scope

- Versioned v1 Goal Plan Manifest and Plan Coverage Review artifact definitions
  and PraxisBound export and validation surfaces.
- Validation that rejects an unsupported schema and validates plan identity and
  revision, unique Plan Node References, Story references, Readiness Contract
  source bindings, explicit dependency topology, reviewed source identities,
  and exact raw-byte SHA-256 digests.
- Validation that binds a Coverage Review's explicit self-declared approval
  fields and coverage-index identity to the exact Manifest digest and reviewed
  source identities and digests.
- Canonical raw-byte fixtures for one valid reviewed plan and invalid topology,
  digest, and approval-binding cases, plus fixture documentation sufficient for
  a downstream ForgePilot integration test to consume without re-encoding them.
- Focused tests and public documentation for the artifact contract and its
  non-authority boundary.

### Out of Scope

- ForgePilot code, ForgePilot state, Goal creation, Execution Authorization,
  Runner behavior, or ForgePilot-side import and authorization validation.
- Parsing source prose to infer requirement semantics, proving raw requirement
  completeness by set equality, or generating a Goal plan from text.
- Automatically approving coverage, authenticating an approver, or treating a
  validator pass as human approval.
- New review UI, remote service, package publication, protocol/template
  revision, migration, commit, push, deployment, or changing existing batch
  review artifact behavior.

## Inputs

- Candidate v1 Goal Plan Manifest bytes and Plan Coverage Review bytes.
- Declared reviewed source identities and their raw-byte content.
- An explicit plan-node and dependency-edge declaration.
- Explicit self-declared review identity, approved conclusion, approver, and
  timestamp carried as artifact data; none is authenticated.

## Outputs

- A v1 Goal Plan Manifest export and validator result.
- A v1 Plan Coverage Review export and validator result.
- Canonical, byte-preserved valid and invalid fixture artifacts with published
  expected validator observations.
- Documentation stating the limits of PraxisBound and downstream consumer
  authority.

## Rules

- R1: The Manifest and Coverage Review declare their schema versions; a
  validator rejects every unsupported version before treating an artifact as a
  reviewed planning input.
- R2: Source identity and digest binding uses SHA-256 of the exact raw bytes.
  Line-ending conversion, BOM insertion or removal, Unicode normalization, and
  JSON reserialization are changes, not equivalent representations.
- R3: A Manifest declares plan identity and revision, all uniquely referenced
  nodes, Story references, each Readiness Contract source identity and digest,
  and the complete dependency edge set explicitly. Its validator rejects
  invalid topology rather than silently dropping, adding, or repairing nodes
  or edges. Structural validation does not prove requirements were fully
  decomposed.
- R4: A Coverage Review declares review identity, exact Manifest raw-byte
  digest, the complete reviewed source identities and raw-byte digests,
  coverage-index identity, explicit `approved` conclusion, self-declared
  approver, and canonical UTC approval time. Its coverage-index identity must
  be among the Manifest's bound sources. Any mismatch or absence invalidates
  the review for consumption.
- R5: Validation establishes artifact conformance only. It neither assigns
  meaning to requirements nor grants, infers, upgrades, or auto-approves human
  coverage approval.
- R6: Canonical fixtures are stored and asserted as raw bytes. Tests may not
  derive expected digests by serializing parsed fixture objects.

## Expected Errors

- Unsupported schema, malformed required fields, or an artifact that cannot be
  decoded is rejected with a stable artifact-validation failure.
- A duplicate or missing Plan Node Reference, missing Story or Readiness
  Contract field, unknown edge endpoint, self-edge, or cycle is rejected; no
  repaired plan is exported.
- A source identity mismatch or raw-byte digest mismatch is rejected as an
  integrity failure.
- A missing review identity, explicit approved conclusion, approver, timestamp,
  coverage-index source binding, or any mismatch between its Manifest/source
  bindings and supplied artifacts is rejected as an approval-binding failure,
  not accepted as an unapproved draft.

## Dependencies

- ForgePilot issue #51, the canonical requirement for this export.
- ForgePilot issue #50 supplies the consumer-side context only; it does not
  authorize ForgePilot changes in this Story.
- Existing PraxisBound review/source-digest conventions where they can be
  reused without changing their existing artifact contracts.

## Constraints

- Add no dependency.
- Preserve fixture bytes exactly in version control and make expected digests
  independently auditable from the fixture files.
- Keep tests self-contained and do not use ForgePilot state, a ForgePilot Goal,
  or this repository's own mutable worktree as the artifact-under-test.
- `make verify` is authoritative for implementation completion; this planning
  Story does not claim that implementation is complete.
- Do not commit, push, publish, deploy, or modify any external repository.

## Guidance

Relevant:

- principle: explicit dependencies
- principle: behavior-oriented testing
- principle: deep module interface
- decision: `ADR-014` keeps review outputs and their authority boundaries explicit

Not applicable:

- no persistent-data migration or external lifecycle ownership applies

## Trust Boundary Fields

- `manifest.schemaVersion` — artifact-supplied version selected by a caller.
- `manifest.planId` and `manifest.revision` — external plan identity and revision.
- `manifest.nodes[].planNodeRef`, `storyRef`, and `readinessContract` —
  externally supplied node, Story, and readiness-source bindings.
- `manifest.edges` — externally supplied complete dependency references.
- `manifest.reviewedSources[]` — externally supplied source identities and digests.
- `coverageReview.schemaVersion` — artifact-supplied version selected by a caller.
- `coverageReview.reviewId` and `manifestDigest` — external review identity and
  exact Manifest-byte binding.
- `coverageReview.coverageIndexIdentity`, `conclusion`, `approvedBy`, and
  `approvedAt` — self-declared approval data and index binding, not authenticated
  identity or authority.
- `coverageReview.reviewedSources[]` — externally supplied source-binding claims.
