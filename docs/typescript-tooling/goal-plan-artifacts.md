# Goal Plan Declaration, Manifest, and Plan Coverage Review v1

PraxisBound exposes three pure Core artifacts in the shape ForgePilot's
`goal preflight` consumes: a Goal Plan Declaration, a Goal Plan Manifest, and a
Plan Coverage Review, exactly as defined by
[`specs/features/batch-review/schemas/goal-plan/`](../../specs/features/batch-review/schemas/goal-plan/)
(copied byte-for-byte from ForgePilot
`32b7a68ebf96d74b55acec8f1cd9408f2ba70dab`). The 0.3.0 `@praxisbound/core`
shape (FP-51: numeric `schemaVersion`, `planNodeRef`, `edges`, `identity`,
`approvedBy`/`approvedAt`) is removed with no reader, alias, or migration
(Story TST-029, ADR-016). Where this module and those schemas ever disagree,
the schemas are authoritative; that is a contract defect, not an
implementation choice.

These artifacts make a reviewed planning input explicit and keep the reviewed
bytes bound to the facts that were inspected. They do not decide what a
requirement means, authenticate an approver, or grant a Goal, Runner, or
execution authority.

## Artifact shapes

All three artifacts use the string `schemaVersion: "1.0.0"`.

A **Goal Plan Declaration** is a JSON object with:

```json
{
  "schemaVersion": "1.0.0",
  "plan": { "id": "fixture-goal-plan", "revision": 1 },
  "nodes": [
    { "nodeRef": "node-a", "storyRef": "specs/stories/EX-001-first", "dependsOn": [] },
    {
      "nodeRef": "node-b",
      "storyRef": "specs/stories/EX-002-second",
      "dependsOn": ["node-a"]
    }
  ]
}
```

A **Goal Plan Manifest** is a JSON object with:

```json
{
  "schemaVersion": "1.0.0",
  "plan": { "id": "fixture-goal-plan", "revision": 1 },
  "declaration": { "path": "specs/plans/fixture-goal-plan.json", "sha256": "<64 lowercase hex>" },
  "nodes": [
    {
      "nodeRef": "node-a",
      "storyRef": "specs/stories/EX-001-first",
      "readinessContract": {
        "path": "specs/stories/EX-001-first/readiness.json",
        "sha256": "<64 lowercase hex>"
      },
      "dependsOn": []
    }
  ],
  "reviewedSources": [
    { "path": "specs/decisions/ADR-001-example.md", "sha256": "<64 lowercase hex>" }
  ],
  "coverageIndex": {
    "batchId": "BR-001-goal-plan-fixture",
    "fingerprint": "<64 lowercase hex>"
  }
}
```

`plan.id` and each `nodeRef` follow the plan identity pattern
(`[A-Za-z0-9][A-Za-z0-9._:-]{0,127}`); `plan.revision` is a positive safe
integer. `storyRef` and every path in a source binding are repository-relative
paths: no leading `/`, no drive letter, no `..` or empty segment, no `//`, no
backslash, and no control, format, or bidirectional-override character.
`nodes` and each node's `dependsOn` are sorted by UTF-8 byte order; an
out-of-order array, a wrong `readinessContract.path` (it must equal
`<storyRef>/readiness.json`), or an unknown field is `malformed-artifact`.
Duplicate node references, dangling `dependsOn` references, self-dependency,
a dependency cycle, and a Declaration whose identity or node topology does
not match its Manifest are `invalid-topology`.

Validating a Manifest with caller-supplied source facts checks three digest
bindings against the exact raw bytes supplied: the referenced Declaration
(`declaration.sha256`), every `reviewedSources` entry, and every node's
`readinessContract`. Any mismatch, or a binding whose bytes are absent from
the supplied source facts, is `digest-mismatch`. The referenced Declaration is
also parsed and structurally validated; a Declaration failure surfaces the
Declaration's own category.

A **Plan Coverage Review** is a JSON object with:

```json
{
  "schemaVersion": "1.0.0",
  "reviewId": "00000000-0000-4000-8000-000000000001",
  "manifestSha256": "<sha256 of the exact Manifest bytes>",
  "reviewedSources": [
    { "path": "specs/decisions/ADR-001-example.md", "sha256": "<64 lowercase hex>" }
  ],
  "coverageIndex": { "batchId": "BR-001-goal-plan-fixture", "fingerprint": "<64 lowercase hex>" },
  "conclusion": "approved",
  "reviewer": { "name": "Fixture Reviewer", "assurance": "self-asserted" },
  "reviewedAt": "2026-09-20T01:23:45.000Z"
}
```

`reviewId` is a UUIDv4. `reviewedAt` is an ISO 8601 UTC timestamp with exactly
three fractional-second digits (`.000Z`). `reviewer.name` is free-form text
with no control, format, or bidirectional-override character; it is data, not
an authenticated identity claim, and it never changes a validation result.
`reviewer.assurance` is always the literal `"self-asserted"`.

A Review's `manifestSha256`, `reviewedSources`, and `coverageIndex` are
checked for exact equality against the referenced Manifest's own fields
(`AC-002`); any mismatch is `approval-binding-mismatch`. When the referenced
Manifest itself fails validation, the Review inherits `digest-mismatch`
directly, or `approval-binding-mismatch` with the Manifest's own category
recorded in `causeCategory`, for every other Manifest failure.

Every artifact's top-level shape, and every nested object shape (`plan`,
source bindings, `coverageIndex`, `reviewer`), is closed: an unknown field is
`malformed-artifact`. Duplicate JSON object keys are rejected before shape
validation. Untrusted artifact input is bounded to 8 MiB and 128 JSON nesting
levels before parsing, and to the schema's structural bounds (≤ 1000 nodes,
≤ 1000 `dependsOn` entries per node, ≤ 4000 `reviewedSources`, `planId` and
`nodeRef` ≤ 128 characters, repository paths ≤ 1024 characters); an
over-bound artifact is rejected whole, never truncated.

## Core API

The public package root exports:

```ts
exportGoalPlanDeclaration(input): Uint8Array
validateGoalPlanDeclaration(bytes): GoalPlanDeclarationValidation

exportGoalPlanManifest(input): Uint8Array
validateGoalPlanManifest(bytes, sourceFacts?): GoalPlanManifestValidation

exportPlanCoverageReview(input): Uint8Array
validatePlanCoverageReview(
  reviewBytes,
  manifestBytes,
  sourceFacts?,
): PlanCoverageReviewValidation
```

Exporters receive raw source bytes as `{ path, bytes }` entries (or, for the
Manifest, per-node `{ path, bytes }` readiness bytes and a `{ path, bytes }`
Declaration binding); each SHA-256 digest is computed by the exporter itself.
Export serializes with two-space indentation, a single trailing newline, no
escaping of non-ASCII, and object keys in the schema's `required` order, so
the same input always yields the same bytes; nodes and `dependsOn` are sorted
before serialization.

Validators decode JSON only to inspect its declared shape. They hash the
exact bytes supplied at the public call boundary. Each call first takes one
private byte snapshot, then uses that same snapshot for decoding, binding
checks, and the returned digest even if caller-owned source-fact accessors
mutate their own buffers during validation. A Manifest that declares a
Declaration, reviewed sources, or readiness contracts must be validated with
caller-supplied source facts; omitting them is a `digest-mismatch`, not a
successful integrity check. No validator reparses or reserializes an artifact
to establish its digest.

## Stable rejection categories

Every rejected result has `ok: false`, an `artifact` class
(`goal-plan-declaration`, `goal-plan-manifest`, or `plan-coverage-review`), a
stable `category`, and a diagnostic message. The categories, and the rules
that map to them, are:

| Category                    | Meaning                                                                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `unsupported-schema`         | `schemaVersion` is not the supported `"1.0.0"` value (including the retired FP-51 numeric `1`).                                             |
| `malformed-artifact`         | JSON, a required field, sort order, a readiness path, a UUID, a timestamp, or an unknown field has an invalid shape.                        |
| `invalid-topology`           | A cycle, a duplicate or dangling node reference, or a Declaration whose identity or node set does not match its Manifest.                   |
| `digest-mismatch`            | A declared Declaration, reviewed-source, or readiness digest differs from the supplied raw bytes, or the bytes are absent.                  |
| `approval-binding-mismatch`  | A Coverage Review's `manifestSha256`, `reviewedSources`, or `coverageIndex` does not equal the referenced Manifest's own fields.             |

Failures never contain a partial `declaration`, `manifest`, or `review`
success value. Diagnostics may name the declared path and expected/observed
digest; they never echo artifact content, a reviewer name, or an absolute
path.

## Canonical fixtures

The portable raw-byte fixtures are under
`packages/core/test/fixtures/goal-plan-artifacts/`:

- `valid-declaration.json`, `valid-manifest.json`, `valid-coverage-review.json`,
  and the files under `sources/` are one reviewed, self-consistent plan.
- `invalid-manifest-*.json`, `invalid-declaration-*.json`, and
  `invalid-review-*.json` cover schema, shape, topology, digest, and
  approval-binding rejections for each artifact class.
- `expected-observations.json` names each artifact fixture's class, exact
  raw-byte SHA-256, expected validator result, and (for a Manifest or
  Coverage Review fixture) the Manifest it is validated against. It also
  publishes each source fixture's SHA-256. The fixture tests hash the files
  directly and dispatch by the declared artifact class; they do not infer the
  validator from a filename or derive expected values by serializing parsed
  JSON.

These files are test and integration inputs only. Consuming them does not
create ForgePilot state or decide whether coverage is sufficient.

## ForgePilot cross-check

This Core's fixtures carry the automated guarantee in `make verify`. A
separate, human-recorded cross-check against ForgePilot
`32b7a68ebf96d74b55acec8f1cd9408f2ba70dab` — its own valid and invalid
fixtures, and one artifact set this Core exports run through its
`goal preflight` — is evidence of that commit only (Story TST-029 R6), and is
recorded in `specs/stories/TST-029-goal-plan-shape-alignment/verification.md`.
