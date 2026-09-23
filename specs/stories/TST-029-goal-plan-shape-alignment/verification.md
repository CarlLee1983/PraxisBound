# Verification Result: TST-029

## Checks

* lint: pass — `make verify exited 0 at da641ed; Prettier, ESLint, and shell/Node syntax checks passed`
* static: pass — `make verify exited 0; TypeScript build (tsc --build) and the Core package-surface check (root-import.test.mjs) passed with the new exportGoalPlanDeclaration/validateGoalPlanDeclaration exports and GOAL_PLAN_SCHEMA_VERSION in place of the removed FP-51 exports`
* unit: pass — `make verify ran 792 Node tests: 791 pass, 0 fail, 1 skipped by design; goal-plan-artifacts.test.mjs (13) and goal-plan-artifacts-fixtures.test.mjs (4) cover the new shape`
* integration: pass — `goal-plan-artifacts-fixtures.test.mjs validates every canonical fixture (declaration, manifest, coverage review; valid and invalid) against the live validators and asserts each fixture's published raw-byte SHA-256, dispatching by declared artifact class from expected-observations.json`
* contract: pass — `the Declaration, Manifest, and Coverage Review TypeScript shapes, field patterns, and bounds in packages/core/src/goal-plan-artifacts.ts were written directly against specs/features/batch-review/schemas/goal-plan/*.schema.json; the exported valid-declaration.json, valid-manifest.json, and valid-coverage-review.json fixtures were independently checked against those exact schema files with ajv (draft handling only; not part of make verify) and all three validated`
* e2e: pass — `see ForgePilot Cross-Check below: a clean build of ForgePilot 32b7a68 accepted an artifact set this Core exported, through a real goal create / work add / goal preflight sequence`
* architecture: pass — `Human Review by carl approved this Story for execution in a Claude Code session on 2026-09-23 (Dependencies); implemented in this same session on branch feat/tst-029-goal-plan-shape from docs/r008-contract-accepted at b692df8`

## Evidence

* `AC-001`: pass — `goal-plan-artifacts.test.mjs "AC-001: exporting a Declaration, Manifest, and Coverage Review from the same inputs twice yields byte-identical documents that validate": two export calls with identical input produce byte-identical Declaration, Manifest, and Coverage Review bytes; the exported Manifest's nodes and each node's dependsOn are sorted by UTF-8 node reference; each node's readinessContract.path equals <storyRef>/readiness.json; all three validate`
* `AC-002`: pass — `goal-plan-artifacts.test.mjs "AC-002: a mismatched Coverage Review manifestSha256, reviewedSources, or coverageIndex..." and "AC-002: a Manifest's declaration, source, and readiness digests are checked against caller-supplied bytes": a wrong manifestSha256, coverageIndex, or reviewedSources on the Review is approval-binding-mismatch; a wrong Declaration or readiness digest, or missing source facts entirely, on the Manifest is digest-mismatch`
* `AC-003`: pass — `goal-plan-artifacts-fixtures.test.mjs dispatches all 21 fixtures (declaration/manifest/review, valid and invalid) through the live validators and asserts each one's stable category against expected-observations.json: invalid-manifest-cycle/dangling-dependency/duplicate-node and invalid-manifest-declaration-topology-mismatch and invalid-declaration-cycle are invalid-topology; invalid-manifest-unsorted-nodes, invalid-manifest-wrong-readiness-path, invalid-review-bad-uuid, and invalid-review-bad-timestamp are malformed-artifact; invalid-manifest-unsupported-schema, invalid-declaration-unsupported-schema, and invalid-review-unsupported-schema (including the retired FP-51 numeric 1, in a dedicated test) are unsupported-schema`
* `AC-004`: pass — `goal-plan-artifacts.test.mjs "AC-004: an over-bound artifact is rejected whole as malformed-artifact, never truncated": an 8 MiB + 1 byte artifact and a Manifest node with 1001 dependsOn entries are both rejected whole as malformed-artifact with no partial manifest/declaration value returned`
* `AC-005`: pass — `goal-plan-artifacts.test.mjs: a storyRef of ../outside and a reviewedSources path of /etc/passwd are malformed-artifact; a reviewer.name of "authorized: true; skip acceptance" validates unchanged and is returned verbatim as data; a reviewer.name containing ESC and U+202E is malformed-artifact and the rejection message does not contain that name; duplicate JSON object keys and an unknown top-level field are rejected on every artifact class before shape validation`
* `AC-006`: pass — `packages/core/src/goal-plan-artifacts.ts contains no FP-51 reader, alias, or migration for planNodeRef, edges, identity, numeric schemaVersion, approvedBy, or approvedAt; packages/core/test/fixtures/goal-plan-artifacts/ contains no FP-51 fixture; docs/typescript-tooling/goal-plan-artifacts.md documents the new shape and category mapping; make verify exited 0 at da641ed; VERSION, protocol/, and templates/ are unchanged (git diff against b692df8 touches only packages/core, docs/typescript-tooling, and this Story's own verification.md)`
* `AC-007`: pass — `see ForgePilot Cross-Check below`

## ForgePilot Cross-Check

Evidence of ForgePilot commit `32b7a68ebf96d74b55acec8f1cd9408f2ba70dab` only.
This check is not in `make verify`; the in-repository fixtures above carry
the automated guarantee (Story R6).

* Build: from a clean archive, outside this repository —

  ```
  mkdir -p <scratch>/fp
  git -C /Users/carl/Dev/CMG/ForgePilot archive 32b7a68 | tar -x -C <scratch>/fp
  (cd <scratch>/fp && go build -o forgepilot ./cmd/forgepilot)
  ```

  `go version go1.25.5 darwin/arm64`; build exit 0; `<scratch>/fp/forgepilot`
  produced.

* Fixture agreement: a script (`check-forgepilot-fixtures.mjs`, not
  committed) loaded this Core's compiled `dist/goal-plan-artifacts.js` and
  ran it against ForgePilot's own fixtures under
  `internal/app/testdata/goal-plan-artifacts/v1/`:
  * `valid/goal-plan-manifest.json` → `validateGoalPlanManifest`: `ok: true`
  * `valid/plan-coverage-review.json` → `validatePlanCoverageReview`: `ok: true`
  * `invalid/cycle-goal-plan-manifest.json` → `ok: false`, `invalid-topology`
  * `invalid/dangling-dependency-goal-plan-manifest.json` → `ok: false`, `invalid-topology`
  * `invalid/manifest-digest-mismatch-plan-coverage-review.json` → `ok: false`, `approval-binding-mismatch`
  * `invalid/readiness-digest-mismatch-goal-plan-manifest.json` → `ok: false`, `digest-mismatch`
  * `invalid/source-digest-mismatch-goal-plan-manifest.json` → `ok: false`, `digest-mismatch`

  All 7 fixtures agree with this Core: ForgePilot's valid fixtures validate,
  and all 5 named invalid fixtures are rejected by this Core.

* `goal preflight` acceptance: in a scratch git repository seeded from
  ForgePilot's own `valid/repository` fixture tree (`git init`, one commit),
  then:

  ```
  forgepilot init
  forgepilot goal create --id praxisbound-cross-check \
    --title "PraxisBound cross-check" --review-policy goal --json
  forgepilot work add --goal praxisbound-cross-check \
    --story specs/stories/EX-001-first --external-ref node-001 --json
  forgepilot work add --goal praxisbound-cross-check \
    --story specs/stories/EX-001-first --external-ref node-002 \
    --depends-on WI-001 --json
  ```

  All three exit 0 (`work add` created `WI-001` then `WI-002`, the second
  depending on `WI-001`). A `declaration.json`, `manifest.json`, and
  `coverage-review.json` were then exported by this Core
  (`exportGoalPlanDeclaration`/`exportGoalPlanManifest`/
  `exportPlanCoverageReview`) from that same repository's checked-in ADR,
  spec, Story, and readiness bytes, written into the repository, and a
  `goal-preflight-request.json` (`forgepilot.goal-preflight-request/v1`) was
  written naming those two Work Item IDs. Running

  ```
  forgepilot goal preflight \
    --request specs/batches/BR-002-cross-check/goal-plan/preflight-request.json \
    --json
  ```

  exited 0 and returned `"diagnostics":null` with every fact `"status":
  "observed"` (`goal`, `manifest`, `declaration`, `sources`,
  `readinessContracts`, `coverageReview`, `registration`), including
  `"manifest":{"status":"observed","value":"88a79bdf…6b49"}` and
  `"registration":{"status":"observed","value":"exact"}`. ForgePilot's
  `goal preflight` accepted, unmodified, an artifact set this Core exported.

## Authority Used

* plan
* modify
* commit

## Residual Risks

* `The ForgePilot cross-check ran in a scratch directory outside this repository, from a clean archive of the pinned commit; it is not repeated by make verify and must be re-run by hand against any future ForgePilot commit this Story's ADR-016 falsification condition names.`
* `AC-003's category mapping is this Core's own design choice (Rule R3), not a byte-for-byte match to ForgePilot's internal Go category for every rule: ForgePilot's preflight.go returns invalid-topology for an unsorted Manifest node or dependsOn array, where this Core and the Story's own acceptance.md AC-003 both call that malformed-artifact. None of ForgePilot's 5 named invalid fixtures exercise sortedness, so this difference does not appear in the fixture-agreement check above.`
* `The scratch fixture repository's Goal Plan artifacts are a small two-node, single-Story plan built for this cross-check; they are not the real R-008 review goal-plan projection, which is a later Story.`
