# Goal Plan Manifest and Plan Coverage Review v1

PraxisBound exposes two pure Core artifacts for a downstream planning-input
consumer such as ForgePilot. They make a reviewed planning input explicit and
keep the reviewed bytes bound to the facts that were inspected. They do not
decide what a requirement means, authenticate an approver, or grant a Goal,
Runner, or execution authority.

## Artifact shapes

Both artifacts use the numeric `schemaVersion: 1`. The Goal Plan Manifest is a
JSON object with:

```json
{
  "schemaVersion": 1,
  "planId": "fixture-goal-plan",
  "revision": 1,
  "nodes": [
    {
      "planNodeRef": "node-a",
      "storyRef": "FP-57",
      "readinessContract": {
        "identity": "sources/readiness-contract.md",
        "sha256": "<64 lowercase hex>"
      },
      "label": "opaque planning label"
    },
    {
      "planNodeRef": "node-b",
      "storyRef": "FP-58",
      "readinessContract": {
        "identity": "sources/readiness-contract.md",
        "sha256": "<64 lowercase hex>"
      }
    }
  ],
  "edges": [{ "from": "node-a", "to": "node-b" }],
  "reviewedSources": [
    { "identity": "sources/requirements.md", "sha256": "<64 lowercase hex>" },
    {
      "identity": "sources/readiness-contract.md",
      "sha256": "<64 lowercase hex>"
    },
    { "identity": "sources/coverage-index.md", "sha256": "<64 lowercase hex>" }
  ]
}
```

`planId` is a required non-empty identity and `revision` is a positive safe
integer. Each node has a unique `planNodeRef`, a non-empty `storyRef`, and a
readiness contract whose identity and digest must match an entry in
`reviewedSources`. `storyRef` is preserved as an opaque reference; PraxisBound
does not parse Story content. Other node fields are opaque planning data.

`nodes` and `edges` are the explicit complete declarations, not inferred
dependencies. `from → to` means the `from` node is a prerequisite of the `to`
node. Every endpoint names a declared `planNodeRef`; self-edges, duplicate
edges, cycles, and nodes missing `planNodeRef` are rejected as invalid
topology. Structural validation cannot prove that the declared set covers every
requirement. The top-level shape and readiness contract object are closed, so
unknown fields cannot smuggle a ForgePilot authorization claim into a valid
artifact.

A Plan Coverage Review is a JSON object with:

```json
{
  "schemaVersion": 1,
  "reviewId": "coverage-review-2025-01",
  "manifestDigest": "<sha256 of the exact Manifest bytes>",
  "coverageIndexIdentity": "sources/coverage-index.md",
  "conclusion": "approved",
  "approvedBy": "Reviewer name as supplied",
  "approvedAt": "2025-01-02T03:04:05Z",
  "reviewedSources": [
    { "identity": "sources/requirements.md", "sha256": "<64 lowercase hex>" },
    {
      "identity": "sources/readiness-contract.md",
      "sha256": "<64 lowercase hex>"
    },
    { "identity": "sources/coverage-index.md", "sha256": "<64 lowercase hex>" }
  ]
}
```

The Review declares its identity, exact Manifest digest, coverage-index source,
explicit `approved` conclusion, self-declared approver, and canonical UTC
approval timestamp (`YYYY-MM-DDTHH:mm:ssZ`, optionally with exactly three
fractional-second digits). `approvedBy` is not authenticated. These fields are
data supplied to PraxisBound; structural validation does not claim the named
person actually approved anything. A Review is valid only when its Manifest
digest and complete source-binding set match the supplied Manifest and source
facts, and its coverage-index identity is among those bindings. Coverage
approval remains separate from ForgePilot execution approval and Human final
acceptance.

Artifact JSON uses a closed shape for source-binding entries as well as the
top-level objects: each entry contains only `identity` and `sha256`. Duplicate
JSON object keys are rejected before validation, so every consumer observes the
same declared value. Untrusted artifact input is bounded to 8 MiB and 128 JSON
nesting levels before parsing; callers should keep opaque node and approval data
within those limits.

## Core API

The public package root exports:

```ts
exportGoalPlanManifest(input): Uint8Array
validateGoalPlanManifest(bytes, sourceFacts?): GoalPlanManifestValidation
exportPlanCoverageReview(input): Uint8Array
validatePlanCoverageReview(
  reviewBytes,
  manifestBytes,
  sourceFacts?,
): PlanCoverageReviewValidation
```

Exporter inputs receive source bytes as `{ identity, bytes }` entries. The
exporter computes each SHA-256 digest itself and emits compact JSON without a
trailing newline. `exportPlanCoverageReview` computes `manifestDigest` from the
exact `manifestBytes` supplied by its caller and copies the Manifest's source
bindings unless an identical set is supplied explicitly.

Validators decode JSON only to inspect its declared shape. They hash the
exact bytes supplied at the public call boundary. Each call first takes one
private byte snapshot, then uses that same snapshot for decoding, binding checks,
and the returned digest even if caller-owned source-fact accessors mutate their
own buffers during validation. A Manifest or Review that declares any reviewed
sources must be validated with caller-supplied source facts; omitting those facts
is a `digest-mismatch`, not a successful integrity check. Line-ending changes,
BOM insertion or removal, Unicode normalization, and JSON formatting changes
therefore remain distinct. No validator reparses and reserializes an artifact to
establish its digest.

## Stable rejection categories

Every rejected result has `ok: false`, an `artifact` class, a stable
`category`, and a diagnostic message. The categories are:

| Category                    | Meaning                                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `unsupported-schema`        | `schemaVersion` is not the supported v1 value.                                                                                  |
| `malformed-artifact`        | JSON or a required field has an invalid shape.                                                                                  |
| `invalid-topology`          | Plan Node References or dependency edges do not form an explicit acyclic graph.                                                 |
| `digest-mismatch`           | A declared source digest differs from the supplied raw bytes, or a source is absent.                                            |
| `approval-binding-mismatch` | A Coverage Review lacks required approval metadata or does not bind the exact review, Manifest, coverage index, and source set. |

Failures never contain a partial `manifest` or `review` success value. Digest
diagnostics may name the declared identity and expected/observed digest; they do
not reconstruct or interpret the source's requirements.

When a Coverage Review references a Manifest that fails validation, a source
digest failure remains `digest-mismatch`. Other referenced-Manifest failures
are reported as `approval-binding-mismatch`, with the original category in
`causeCategory`; direct Manifest validation returns its original category.

## Canonical fixtures

The portable raw-byte fixtures are under
`packages/core/test/fixtures/goal-plan-artifacts/`:

- `valid-manifest.json`, `valid-coverage-review.json`, and the files under
  `sources/` are the valid reviewed plan.
- `invalid-topology-*.json` covers missing endpoints, duplicate Plan Node References,
  self-edges, and cycles.
- `invalid-digest-manifest.json` covers a source digest mismatch.
- `invalid-approval-*.json` covers Manifest/source binding failures and missing
  required approval metadata.
- `expected-observations.json` names each artifact fixture's class, exact
  raw-byte SHA-256, expected validator result, and referenced Manifest where
  applicable. It also publishes each source fixture's SHA-256. The fixture
  tests hash the files directly and dispatch by the declared artifact class;
  they do not infer the validator from a filename or derive expected values by
  serializing parsed JSON.

These files are test and integration inputs only. Consuming them does not create
ForgePilot state or decide whether coverage is sufficient.
