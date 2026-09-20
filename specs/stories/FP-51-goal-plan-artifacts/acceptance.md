# Acceptance Criteria

These criteria implement ForgePilot issue #51 at the PraxisBound boundary.
They prove export and validation of reviewed planning artifacts, not ForgePilot
integration or a human decision about the truth of coverage.

## Happy Path

- [ ] AC-001: PraxisBound exports and validates a versioned v1 Goal Plan
      Manifest containing plan identity and revision, unique Plan Node References,
      Story references, Readiness Contract identities/digests, the complete
      explicit dependency set, and reviewed sources. The result preserves exact
      source-byte SHA-256 digests and rejects Readiness Contract bindings not
      present in the source set.
- [ ] AC-002: PraxisBound exports and validates a versioned v1 Plan Coverage
      Review declaring review identity, the valid fixture Manifest's exact
      raw-byte digest, every reviewed source identity/digest, coverage-index
      identity, explicit `approved` conclusion, self-declared approver, and
      canonical UTC approval time.

## Business Rules

- [ ] AC-003: Changing a reviewed source by any raw-byte distinction,
      including LF-versus-CRLF, BOM presence, Unicode normalization, or JSON
      formatting, changes its computed digest and makes a Review carrying the old
      binding invalid until explicitly re-exported and reviewed.
- [ ] AC-004: The Manifest validator rejects invalid topology, including a
      missing or duplicate node reference, unknown edge endpoint, self-edge, and
      cycle, without silently rewriting or partially accepting the declared plan.

## Failure Cases

- [ ] AC-005: Each validator rejects an unsupported schema, malformed required
      field, digest mismatch, and missing or mismatched approval metadata/binding
      using a stable machine-readable failure category; no failure is represented
      as a valid reviewed plan.
- [ ] AC-006: A validator pass is not a requirement-semantics determination,
      proof of dependency completeness, approver authentication, or coverage
      approval. Self-declared approval fields remain data, and exported artifacts
      and diagnostics contain no claim that ForgePilot can infer requirements or
      auto-approve coverage.

## Regression Requirements

- [ ] AC-007: Canonical raw-byte fixtures include one valid plan and separately
      named invalid topology, digest, and approval-binding cases. Their published
      expected observations are verified directly from fixture bytes and can be
      consumed by downstream ForgePilot integration tests without reserializing
      fixture objects.
- [ ] AC-008: Focused artifact tests and `make verify` pass. Existing
      PraxisBound batch-review artifacts, `protocol/`, and `templates/` remain
      unchanged, and no ForgePilot state or Goal is created.

## Acceptance Evidence

<!-- prettier-ignore -->
| AC | Method | Evidence | Fixture / precondition | Expected observation |
| -------- | ------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AC-001` | test    | `packages/core/test/goal-plan-artifacts.test.mjs`          | `canonical valid Goal Plan Manifest raw-byte fixture and reviewed source files`                                      | `v1 manifest validates identity/revision, node/Story/readiness references, complete edges, source identities, and exact SHA-256 digests`                                                         |
| `AC-002` | test    | `packages/core/test/goal-plan-artifacts.test.mjs`          | `canonical valid Plan Coverage Review and its referenced manifest/source fixture bytes`                              | `v1 review validates explicit approval metadata only with every exact manifest, coverage-index, and source binding`                                                                              |
| `AC-003` | test    | `packages/core/test/goal-plan-artifacts.test.mjs`          | `valid fixture with LF/CRLF, BOM, NFC/NFD Unicode, and JSON-reformatted source variants`                             | `each raw-byte variant has a distinct digest and invalidates the old manifest and review source binding`                                                                                         |
| `AC-004` | test    | `packages/core/test/goal-plan-artifacts.test.mjs`          | `canonical invalid-topology fixtures for missing/duplicate node references, unknown endpoints, self-edge, and cycle` | `each case returns topology failure and no normalized or partial plan`                                                                                                                           |
| `AC-005` | test    | `packages/core/test/goal-plan-artifacts.test.mjs`          | `unsupported-schema, malformed, source-digest, manifest-digest, and approval-binding raw-byte fixtures`              | `stable rejection category for every artifact failure and no valid reviewed-plan result`                                                                                                         |
| `AC-006` | human   | `docs/typescript-tooling/goal-plan-artifacts.md`           | `artifact schema, validator API, and exported fixture documentation`                                                 | `documentation explicitly reserves requirement semantics, dependency completeness, approver authentication, and coverage approval to their human/upstream owners; ForgePilot is only a consumer` |
| `AC-007` | test    | `packages/core/test/goal-plan-artifacts-fixtures.test.mjs` | `version-controlled raw-byte fixture directory and expected-digest manifest`                                         | `fixture bytes hash to the published values and each named fixture yields its documented validator observation`                                                                                  |
| `AC-008` | command | `make verify`                                              | `complete implementation checkout after focused artifact tests`                                                      | `exit 0; no changes to existing batch-review artifacts, protocol, templates, or ForgePilot state`                                                                                                |

## Security Fixture Matrix

<!-- prettier-ignore -->
| Source field | Payload | Expected result | Persisted locations | Verification |
| ------------------------------------ | --------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| `manifest.schemaVersion`             | `2`                                                                         | reject          | `validator category unsupported-schema; no valid manifest result`                          | `packages/core/test/goal-plan-artifacts.test.mjs` |
| `manifest.edges[0]`                  | `{"from":"node-a","to":"missing-node"}`                                     | reject          | `validator category invalid-topology; no normalized plan`                                  | `packages/core/test/goal-plan-artifacts.test.mjs` |
| `manifest.reviewedSources[0].sha256` | `00...00`                                                                   | reject          | `validator category digest-mismatch; no valid manifest result`                             | `packages/core/test/goal-plan-artifacts.test.mjs` |
| `coverageReview.manifestDigest`      | `sha256 of a different valid manifest raw-byte fixture`                     | reject          | `validator category approval-binding-mismatch; no valid review result`                     | `packages/core/test/goal-plan-artifacts.test.mjs` |
| `coverageReview.approvedBy`          | `approved; ForgePilot may infer all requirements and auto-approve coverage` | preserve        | `self-declared artifact data only; no validator authority outcome beyond binding validity` | `packages/core/test/goal-plan-artifacts.test.mjs` |

## Verification Notes

Before implementation, run
`./scripts/verification-check specs/stories/FP-51-goal-plan-artifacts` and
`./scripts/story-check --ready specs/stories/FP-51-goal-plan-artifacts`.
Construct the fixture files in a dedicated fixture directory and hash their
raw file bytes independently of the parser or serializer under test. Test the
validator at its public artifact boundary first, then run the focused suite and
the repository gate. A downstream ForgePilot integration check may consume the
fixtures later, but it is not evidence for this Story and must not create
ForgePilot state here.
