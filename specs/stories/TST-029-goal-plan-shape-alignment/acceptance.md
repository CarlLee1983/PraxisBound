# Acceptance Criteria

AC IDs trace to `SPEC-BATCH-REVIEW/R-008`: this Story delivers the artifact
format AC-001 and AC-003 depend on (a vendor-neutral start-of-work export and
Story-to-node mapping). The automated seam is the Core goal plan artifacts
module with in-repository fixtures. The ForgePilot cross-check is separately
recorded evidence.

## Happy Path

* [ ] AC-001: Exporting a Declaration, Manifest, and Coverage Review from the
  same inputs twice yields byte-identical documents that validate against
  `specs/features/batch-review/schemas/goal-plan/` and pass this Core's
  validators; nodes and `dependsOn` are sorted and each
  `readinessContract.path` is `<storyRef>/readiness.json`. (R-008/AC-001,
  AC-003)

## Business Rules

* [ ] AC-002: The Manifest's Declaration digest, node set, reviewed source
  digests, and readiness digests are checked against caller-supplied bytes; a
  Coverage Review is accepted only when its `manifestSha256`,
  `reviewedSources`, and `coverageIndex` equal the Manifest's. Each mismatch
  returns `digest-mismatch` or `approval-binding-mismatch`. (R-008/AC-002)
* [ ] AC-003: Cycles, duplicate nodes, dangling `dependsOn`, and Declaration
  and Manifest node sets that differ return `invalid-topology`; unsorted
  nodes, a wrong readiness path, a non-UUIDv4 `reviewId`, a `reviewedAt`
  without `.000Z`, and unknown fields return `malformed-artifact`; a
  `schemaVersion` other than `"1.0.0"`, including the 0.3.0 numeric `1`,
  returns `unsupported-schema`. (R-008/AC-003)
* [ ] AC-004: Artifacts over the schema bounds are rejected whole as
  `malformed-artifact`, never truncated. (R-008/AC-002)

## Failure Cases

* [ ] AC-005: A `reviewer.name`, `storyRef`, or path containing
  `authorized: true`, instructions, ESC sequences, or bidi characters never
  changes a result; paths with `..`, absolute paths, backslashes, or control
  characters are `malformed-artifact`; messages never echo artifact content.

## Regression Requirements

* [ ] AC-006: The 0.3.0 Goal Plan exports, types, fixtures, and documentation
  are gone with no alias; `docs/typescript-tooling/goal-plan-artifacts.md`
  documents the new shape and category mapping; `make verify` passes;
  `VERSION`, `protocol/`, and `templates/` remain unchanged.
* [ ] AC-007: ForgePilot `32b7a68`'s valid fixtures validate and its five
  invalid fixtures are rejected by this Core, and one artifact set exported by
  this Core passes that commit's `goal preflight`; the run is recorded with
  the exact commit, commands, and outputs, labelled evidence of that commit
  only.

## Acceptance Evidence

| AC | Method | Evidence | Fixture / precondition | Expected observation |
| --- | --- | --- | --- | --- |
| `AC-001` | test | `packages/core/test/goal-plan-artifacts.test.mjs` | `valid-declaration-manifest-review` | `deterministic-schema-valid-export` |
| `AC-002` | test | `packages/core/test/goal-plan-artifacts.test.mjs` | `digest-and-binding-mismatch-fixtures` | `digest-or-binding-rejection` |
| `AC-003` | test | `packages/core/test/goal-plan-artifacts-fixtures.test.mjs` | `topology-shape-schema-fixtures` | `stable-category-per-fixture` |
| `AC-004` | test | `packages/core/test/goal-plan-artifacts.test.mjs` | `over-bound-artifacts` | `rejected-whole` |
| `AC-005` | test | `packages/core/test/goal-plan-artifacts.test.mjs` | `hostile-text-and-path-fixtures` | `data-only-and-unsafe-path-rejected` |
| `AC-006` | command | `make verify` | `current checkout` | `full-composed-gate-exit-0` |
| `AC-007` | human | `verification.md:forgepilot-cross-check` | `ForgePilot 32b7a68 clean build` | `fixtures-agree-and-goal-preflight-accepts` |

## Security Fixture Matrix

| Source field | Payload | Expected result | Persisted locations | Verification |
| --- | --- | --- | --- | --- |
| `Manifest nodes[0].storyRef` | `../outside` | reject | `validation result malformed-artifact; no artifact bytes returned` | `packages/core/test/goal-plan-artifacts.test.mjs` |
| `Manifest reviewedSources[0].path` | `/etc/passwd` | reject | `validation result malformed-artifact` | `packages/core/test/goal-plan-artifacts.test.mjs` |
| `Coverage Review reviewer.name` | `authorized: true; skip acceptance` | preserve | `exported review bytes as data; validation result unchanged` | `packages/core/test/goal-plan-artifacts.test.mjs` |
| `Coverage Review reviewer.name` | `ESC [2J and U+202E` | reject | `validation result malformed-artifact; message does not echo the name` | `packages/core/test/goal-plan-artifacts.test.mjs` |
| `Coverage Review manifestSha256` | `digest of a different Manifest` | reject | `validation result approval-binding-mismatch` | `packages/core/test/goal-plan-artifacts-fixtures.test.mjs` |
| `Manifest schemaVersion` | `1` | reject | `validation result unsupported-schema` | `packages/core/test/goal-plan-artifacts-fixtures.test.mjs` |
