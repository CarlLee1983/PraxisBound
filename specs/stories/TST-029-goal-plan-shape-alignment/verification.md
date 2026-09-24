# Verification Result: TST-029

## Checks

* lint: pass — `make verify exited 0; Prettier, ESLint, and shell/Node syntax checks passed`
* static: pass — `make verify exited 0; TypeScript build (tsc --build) and the Core package-surface check (root-import.test.mjs) passed with the new exportGoalPlanDeclaration/validateGoalPlanDeclaration exports and GOAL_PLAN_SCHEMA_VERSION in place of the removed FP-51 exports`
* unit: pass — `make verify ran 821 Node tests: 820 pass, 0 fail, 1 skipped by design; goal-plan-artifacts.test.mjs (38) and goal-plan-artifacts-fixtures.test.mjs (4) cover the new shape, the code-review fixes, the Q24 stricter-consumer-behavior rules, and the MEDIUM-1 Declaration edge bound below`
* integration: pass — `goal-plan-artifacts-fixtures.test.mjs validates every canonical fixture (declaration, manifest, coverage review; valid and invalid) against the live validators and asserts each fixture's published raw-byte SHA-256, dispatching by declared artifact class from expected-observations.json`
* contract: pass — `the Declaration, Manifest, and Coverage Review TypeScript shapes, field patterns, and bounds in packages/core/src/goal-plan-artifacts.ts were written directly against specs/features/batch-review/schemas/goal-plan/*.schema.json and contract §10's added rule block; the exported valid-declaration.json, valid-manifest.json, and valid-coverage-review.json fixtures were independently checked against the pre-Q24 schema files with ajv (draft handling only; not part of make verify) and all three validated — ajv 6's default (non-\`u\`-flag) regex compilation cannot evaluate the Q24 \\p{Cc}/\\p{Cf}/\\p{Zl}/\\p{Zp} pattern update, so that specific pattern is verified only by this Core's own tests, not re-checked with ajv`
* e2e: pass — `see ForgePilot Cross-Check below: a clean build of ForgePilot 32b7a68 accepted an artifact set this Core exported, through a real goal create / work add / goal preflight sequence, re-run at PraxisBound commit 0afaa96 (MEDIUM-2)`
* architecture: pass — `Human Review by carl approved this Story for execution in a Claude Code session on 2026-09-23 (Dependencies); implemented on branch feat/tst-029-goal-plan-shape from docs/r008-contract-accepted at b692df8; code review blocked the first round (HIGH-1, HIGH-2, MEDIUM-4, MEDIUM-6, MEDIUM-7, LOW-8, LOW-9, LOW-10, LOW-11), fixed with a failing test added first for each; Human Review then decided the HOLD items (Q24, commit f3ef1df: schemas/goal-plan/, contract §10, ADR-016, Story R7, and acceptance AC-003 updated), implemented the same way; a second code review found no CRITICAL/HIGH but MEDIUM-1 (Declaration also needs the 10000-edge bound, contract §10 commit b23ecd3) and MEDIUM-2 (re-run the cross-check evidence at current HEAD), both addressed below, then make verify`

## Evidence

* `AC-001`: pass — `goal-plan-artifacts.test.mjs "AC-001: exporting a Declaration, Manifest, and Coverage Review from the same inputs twice yields byte-identical documents that validate": two export calls with identical input produce byte-identical Declaration, Manifest, and Coverage Review bytes; the exported Manifest's nodes and each node's dependsOn are sorted by UTF-8 node reference; each node's readinessContract.path equals <storyRef>/readiness.json; all three validate`
* `AC-002`: pass — `goal-plan-artifacts.test.mjs "AC-002: a mismatched Coverage Review manifestSha256, reviewedSources, or coverageIndex..." and "AC-002: a Manifest's declaration, source, and readiness digests are checked against caller-supplied bytes": a wrong manifestSha256, coverageIndex, or reviewedSources on the Review is approval-binding-mismatch; a wrong Declaration or readiness digest, or missing source facts entirely, on the Manifest is digest-mismatch`
* `AC-003`: pass — `goal-plan-artifacts-fixtures.test.mjs dispatches all 21 fixtures (declaration/manifest/review, valid and invalid) through the live validators and asserts each one's stable category against expected-observations.json: invalid-manifest-cycle/dangling-dependency/duplicate-node and invalid-manifest-declaration-topology-mismatch and invalid-declaration-cycle are invalid-topology; invalid-manifest-unsorted-nodes, invalid-manifest-wrong-readiness-path, invalid-review-bad-uuid, and invalid-review-bad-timestamp are malformed-artifact; invalid-manifest-unsupported-schema, invalid-declaration-unsupported-schema, and invalid-review-unsupported-schema (including the retired FP-51 numeric 1, in a dedicated test) are unsupported-schema; goal-plan-artifacts.test.mjs "HIGH-2: a Declaration's dependsOn is not required to be sorted, only unique and valid" and "HIGH-2: a Manifest's dependsOn is still required to be sorted" confirm the two artifacts now diverge exactly as ForgePilot's own parseGoalPlanDeclaration and parseManifest do; the Q24 tests below cover acceptance.md's amended AC-003 wording (a real date-time, Cc/Cf/Zl/Zp characters, byte bounds, the 10000-edge total)`
* `AC-004`: pass — `goal-plan-artifacts.test.mjs "AC-004: an over-bound artifact is rejected whole as malformed-artifact, never truncated" (8 MiB + 1 byte; 1001 dependsOn entries) plus four added bound tests: more than 1000 nodes, more than 4000 reviewedSources, a planId over 128 characters, and a repository path over 1024 characters are each rejected whole as malformed-artifact; the Q24 tests add the Manifest total-dependsOn-edge, Declaration-specific size/depth, repoPath-byte, and reviewer.name-byte/code-point bounds; the MEDIUM-1 tests below add the same 10000-edge bound to the Declaration`
* `AC-005`: pass — `goal-plan-artifacts.test.mjs, one Security Fixture Matrix row per test: "Manifest nodes[0].storyRef of ../outside is rejected in isolation" and "Manifest reviewedSources[0].path of /etc/passwd is rejected in isolation" (previously combined in one artifact, so the storyRef rejection never ran on its own); a backslash path and a control-character path are each malformed-artifact; a storyRef containing instruction text that is still a syntactically valid path validates unchanged; a reviewer.name of "authorized: true; skip acceptance" validates unchanged and is returned verbatim as data; a reviewer.name containing ESC and U+202E is malformed-artifact and the message does not contain that name; duplicate JSON object keys and an unknown top-level field are rejected on every artifact class before shape validation`
* `AC-006`: pass — `packages/core/src/goal-plan-artifacts.ts contains no FP-51 reader, alias, or migration for planNodeRef, edges, identity, numeric schemaVersion, approvedBy, or approvedAt; packages/core/test/fixtures/goal-plan-artifacts/ contains no FP-51 fixture; docs/typescript-tooling/goal-plan-artifacts.md documents the new shape, the category mapping, the UTF-8-byte sort/compare rule, the Declaration-vs-Manifest dependsOn-sort divergence, the required sources on Coverage Review export, the no-echo diagnostic rule, and the Q24 Cc/Cf/Zl/Zp, byte-bound, real-date, total-edge, and per-artifact size/depth rules; make verify exited 0; VERSION, protocol/, and templates/ are unchanged (git diff against b692df8 touches only packages/core, docs/typescript-tooling, specs/decisions, specs/features/batch-review, specs/stories/TST-029-goal-plan-shape-alignment)`
* `AC-007`: pass — `see ForgePilot Cross-Check below`

## Code Review Fixes

A code review blocked the first implementation round. Each finding below was
given a failing test first (TDD), then fixed; `make verify` passed after all
fixes.

* `HIGH-1` (messages/observed/path must never echo artifact content): fixed by rewriting `rejectUnknownFields` to name only the known container path, never the field text; `scanJsonSafety`'s duplicate-key message no longer includes the key; `readSchemaVersion`'s `observed` is now a fixed type description (`describeType`) instead of `String(value)`; the Manifest-to-Declaration and Review-to-Manifest failure wrapping no longer splices the nested `message`, only reuses its `category`/`causeCategory`. Tests: `goal-plan-artifacts.test.mjs` "HIGH-1: an unknown field name is never echoed…", "…a duplicated JSON object key is never echoed…", "…a hostile schemaVersion value is never echoed…", "…nested Declaration/Manifest failures are not spliced…", using the key/value `"\u001b[2J‮EVIL"`.
* `HIGH-2` (Declaration dependsOn must not require sorting): `readDependsOn` now takes a `requireSorted` flag; the Declaration caller passes `false` (only uniqueness and a valid reference are checked, matching the schema and ForgePilot's `parseGoalPlanDeclaration`), the Manifest caller still passes `true`. Tests: `goal-plan-artifacts.test.mjs` "HIGH-2: a Declaration's dependsOn is not required to be sorted…" and "…a Manifest's dependsOn is still required to be sorted".
* `MEDIUM-4` (sort/compare by UTF-8 bytes, not UTF-16): both the Manifest's `reviewedSources` validation sort check and the exporter's `sortedReviewedSources` now call the existing `compareUtf8` (`packages/core/src/review/path.ts`, already exported and already byte-comparing via `TextEncoder`) instead of JS `<`/`>` string comparison. Tests: `goal-plan-artifacts.test.mjs` "MEDIUM-4: reviewedSources are sorted and compared by UTF-8 bytes…" and "…exported reviewedSources are sorted by UTF-8 bytes…", using `s/Ａ` (fullwidth A) and `s/\u{1F600}` (grinning face), which UTF-16 code-unit order places in the opposite order from UTF-8 byte order.
* `MEDIUM-6` (tests): the combined path test was split into one test per Security Fixture Matrix row (storyRef `../outside` alone; reviewedSources path `/etc/passwd` alone); added AC-004 bound tests for nodes > 1000, reviewedSources > 4000, planId > 128 characters, and a repository path > 1024 characters; added tests for a backslash path, a control-character path, and a storyRef containing instruction text that leaves the result unchanged.
* `MEDIUM-7` (AC-007 evidence): see ForgePilot Cross-Check below — exact commands, verbatim outputs, and the untruncated Manifest digest are now recorded, and the two scripts used are saved under `specs/stories/TST-029-goal-plan-shape-alignment/evidence/`.
* `LOW-8` (`PlanCoverageReviewExportInput.sources` required): the TypeScript field is no longer optional, and `exportPlanCoverageReviewInput` now throws `malformed-artifact` at runtime if `sources` is omitted (untrusted-boundary functions in this module validate at runtime regardless of the static type). Test: `goal-plan-artifacts.test.mjs` "LOW-8: exportPlanCoverageReview requires sources".
* `LOW-9` (export and validate must report the same category for an invalid Manifest): `exportPlanCoverageReviewInput` now calls `validateGoalPlanManifest` unconditionally (since `sources` is required) and applies the identical digest-mismatch-preserved / else-approval-binding-mismatch-with-causeCategory rule `validatePlanCoverageReviewInput` already used. `exportFailure` was extended to optionally carry a `causeCategory`, mirrored through `exportBoundaryFailure`. Test: `goal-plan-artifacts.test.mjs` "LOW-9: export and validate report the same category and causeCategory for an invalid referenced Manifest".
* `LOW-10` (source-fact path echoed, including absolute paths): `readSourceEntries`'s Map- and Record-branch error messages no longer interpolate the caller-supplied path. Test: `goal-plan-artifacts.test.mjs` "LOW-10: an unbound source fact path (including an absolute path) is never echoed in the message", using `/etc/passwd`.
* `LOW-11` (verification.md counts; docs parity; residual risk): this file's counts are corrected above; `docs/typescript-tooling/goal-plan-artifacts.md` now states UTF-8 (not UTF-16) ordering, the no-echo diagnostic rule in full (unknown field, duplicate key, source path, hostile schemaVersion, no message splicing), that `reviewedSources` must be sorted and unique, and the Declaration-vs-Manifest `dependsOn` sort divergence; the Manifest-duplicate-`dependsOn`-category divergence is recorded in Residual Risks below.

## Q24: Stricter-Consumer-Behavior Rules

Human Review 2026-09-23 (Q24) decided the HOLD items from the first review
round: where `schemas/goal-plan/` is looser than ForgePilot `32b7a68`
`internal/app/preflight.go`, the stricter consumer behavior is the
specification. Commit `f3ef1df` (not authored in this session) updated the
`repoPath` and `reviewer.name` schema patterns, contract §10, Story R7, and
acceptance AC-003 accordingly; this round implements those rules in the
Core, test-first for each.

* Unicode Cc/Cf/Zl/Zp rejection in `repoPath` and `reviewer.name`:
  `REPO_PATH_PATTERN` and `REVIEWER_NAME_PATTERN` now use the `u`-flag
  regex classes `\p{Cc}\p{Cf}\p{Zl}\p{Zp}` in place of the earlier
  hand-picked byte-range approximation. Tests: `goal-plan-artifacts.test.mjs`
  "Q24: a repository path containing a Unicode Cf, Zl, or Zp character is
  rejected as malformed-artifact" and "…a reviewer.name containing a Unicode
  Cf, Zl, or Zp character…", covering U+00AD, U+2060, U+061C, U+FEFF,
  U+2028, and U+2029.
* `repoPath` ≤ 1024 UTF-8 bytes (not UTF-16 code units): `readRepoPath` now
  measures `utf8ByteLength` (a `TextEncoder`-backed helper) instead of
  `.length`. Test: "Q24: repoPath is bounded by UTF-8 bytes, not UTF-16 code
  units", using 400 three-byte-UTF-8 characters (400 UTF-16 units, 1200 UTF-8
  bytes).
* `reviewer.name` ≤ 256 UTF-8 bytes AND ≤ 256 Unicode code points, and equal
  to itself trimmed: `readReviewer` adds explicit `utf8ByteLength`,
  code-point-count (`[...name].length`), and `name === name.trim()` checks
  alongside the existing pattern. Test: "Q24: reviewer.name is bounded by
  UTF-8 bytes and by code points, and must equal itself trimmed".
* `reviewedAt` real UTC date-time, any three fractional digits: the earlier
  `.000Z`-only wording (in this file, an earlier round, and the exporter's
  documentation) was wrong — ForgePilot's `time.Parse` layout accepts any
  three digits there. The `.000Z`-only check was already not present in the
  regex (it already accepted `\d{3}`); what changed is `Date.parse`, which
  silently rolls 30 February into 2 March and 24:00 into the next day rather
  than rejecting them, is replaced by `isRealUtcDateTime`, a
  `setUTCFullYear`/`setUTCHours` round-trip that rejects any calendar
  overflow. Test: "Q24: reviewedAt rejects an out-of-range calendar date or
  clock time, but accepts any three fractional digits", covering
  30 February and 24:00 (rejected) and `.123Z` (accepted). The Coverage
  Review exporter is unchanged and still emits `.000Z`.
* Manifest total `dependsOn` edges ≤ 10000: `readManifestShape` now
  accumulates `totalDependsOnEdges` across every node and rejects once it
  exceeds `MAX_TOTAL_DEPENDS_ON_EDGES`. Test: "Q24: a Manifest's total
  dependsOn edges are bounded at 10000 across all nodes" (11 nodes × 1000
  dependencies each = 11000).
* Declaration ≤ 1 MiB / depth ≤ 32; Manifest and Coverage Review ≤ 8 MiB /
  depth ≤ 128: `parseJson` and `scanJsonSafety` now take explicit
  `maxBytes`/`maxDepth` parameters; the Declaration call site passes
  `MAX_DECLARATION_BYTES`/`MAX_DECLARATION_JSON_DEPTH` (1 MiB / 32), the
  Manifest and Coverage Review call sites keep the module's existing 8 MiB /
  128 defaults. Tests: "Q24: a Declaration is bounded to 1 MiB, stricter than
  the Manifest/Review 8 MiB bound" and "…a Declaration's JSON nesting is
  bounded to depth 32, stricter than the Manifest/Review depth 128", each
  also asserting the identical oversized/deep payload is *not* rejected for
  that reason when read as a Manifest.

Every new rule maps to `malformed-artifact`, per the amended acceptance
AC-003, and every new message names only a fixed field path — no path,
name, or value is echoed. Verified by re-running the RED state: copying
`packages/core/src/goal-plan-artifacts.ts` from the prior commit (`8d895c7`)
into the worktree and re-running `goal-plan-artifacts.test.mjs` failed 7 of
the 8 new tests (the eighth, the byte/code-point/trim test, happened to pass
against the prior code too, since 257 ASCII characters and a 512-UTF-16-unit
emoji string were already over the prior UTF-16-`.length` bound by
coincidence — the byte-vs-code-point distinction cannot be isolated in a
test, because a code-point count over 256 always implies a byte count over
256 as well); restoring the fixed file turned all 8 green.

## Second Code Review Fixes

A second code review found TST-029 mergeable (no CRITICAL or HIGH), with two
MEDIUM findings and one LOW addressed below.

* `MEDIUM-1` (the 10000-edge bound must also apply to the Declaration):
  ForgePilot's `parseGoalPlanDeclaration` rejects a Declaration whose total
  `dependsOn` edges exceed 10000; this Core previously enforced that bound
  only on the Manifest. `readDeclarationShape` now accumulates
  `totalDependsOnEdges` across every node exactly as `readManifestShape`
  already did, rejecting as `malformed-artifact` once it exceeds
  `MAX_TOTAL_DEPENDS_ON_EDGES`; `exportGoalPlanDeclaration` inherits the
  check via its own self-validation call. Contract §10 was updated in
  commit `b23ecd3` (not authored in this session) before this fix. Tests:
  `goal-plan-artifacts.test.mjs` "MEDIUM-1: a Declaration's total dependsOn
  edges are bounded at 10000 across all nodes" (validate) and "…
  exportGoalPlanDeclaration rejects a Declaration whose total dependsOn
  edges exceed 10000" (export), both using 11 nodes × 1000 dependencies
  each = 11000. Verified RED: copying the pre-fix `goal-plan-artifacts.ts`
  (commit `b23ecd3`, before this round) into the worktree, both new tests
  failed; restoring the fix turned both green.
* `MEDIUM-2` (re-run the AC-007 cross-check at current HEAD): the evidence
  in the ForgePilot Cross-Check section below, and every file under
  `evidence/log-*`, was regenerated at PraxisBound commit `0afaa96` (the
  MEDIUM-1 fix), after the prior evidence was found to predate `8d895c7`
  and Q24 and to have an inconsistent `log-09` timestamp. See ForgePilot
  Cross-Check below.
* `LOW` (lone-surrogate paths): see Residual Risks below.

## ForgePilot Cross-Check

Evidence of ForgePilot commit `32b7a68ebf96d74b55acec8f1cd9408f2ba70dab`
only, re-run at PraxisBound commit `0afaa96` (the MEDIUM-1 fix; `git log
--oneline -1` in this repository at the time this evidence was captured).
The prior evidence in this section predated `8d895c7` and the Q24/MEDIUM-1
rule changes; this is a full re-run, not an amendment, and every
`evidence/log-*` file below was regenerated together (no more of the stale
log-09 timestamp older than logs 04–08 that the second review flagged).
Every regenerated file is byte-identical to its prior version except
`log-03-git-init.txt` (a fresh scratch git commit necessarily has a new
hash): the artifact exports and ForgePilot's own responses are deterministic
given the same inputs, so unchanged content here is expected, not a sign the
re-run did not happen.
This check is not in `make verify`; the in-repository fixtures above carry
the automated guarantee (Story R6). The two scripts used, and the exact
command output captured while running them, are saved under
`specs/stories/TST-029-goal-plan-shape-alignment/evidence/`.

### 1. Build ForgePilot from a clean archive, outside this repository

```
mkdir -p <scratch>/fp
git -C /Users/carl/Dev/CMG/ForgePilot archive 32b7a68 | tar -x -C <scratch>/fp
cd <scratch>/fp && go build -o forgepilot ./cmd/forgepilot
```

`go version go1.25.5 darwin/arm64`. Exit `0` (`evidence/log-01-forgepilot-build.txt`);
`<scratch>/fp/forgepilot` produced.

### 2. Fixture agreement

```
pnpm --filter @praxisbound/core run build   # evidence/log-00-core-build.txt
node specs/stories/TST-029-goal-plan-shape-alignment/evidence/check-forgepilot-fixtures.mjs <scratch>/fp
```

Verbatim output (`evidence/log-02-fixture-check.txt`):

```
PASS valid/goal-plan-manifest.json -> ok=true category=undefined
PASS valid/plan-coverage-review.json -> ok=true category=undefined
PASS invalid/cycle-goal-plan-manifest.json -> ok=false category=invalid-topology
PASS invalid/dangling-dependency-goal-plan-manifest.json -> ok=false category=invalid-topology
PASS invalid/manifest-digest-mismatch-plan-coverage-review.json -> ok=false category=approval-binding-mismatch
PASS invalid/readiness-digest-mismatch-goal-plan-manifest.json -> ok=false category=digest-mismatch
PASS invalid/source-digest-mismatch-goal-plan-manifest.json -> ok=false category=digest-mismatch
all ForgePilot fixture checks passed
exit=0
```

All 7 fixtures agree with this Core: ForgePilot's own valid fixtures
validate, and all 5 named invalid fixtures are rejected by this Core with
the same category ForgePilot's own `preflight.go` would reach.

### 3. `goal preflight` acceptance

A scratch git repository was seeded from ForgePilot's own
`internal/app/testdata/goal-plan-artifacts/v1/valid/repository` fixture tree:

```
git init -q
git add -A
git -c user.email=test@example.com -c user.name=Test commit -q -m "fixture repo"
git log --oneline -1
```

Output (`evidence/log-03-git-init.txt`): `4f9199d fixture repo`.

```
<scratch>/fp/forgepilot init
```

Output (`evidence/log-04-forgepilot-init.txt`): `Initialized ForgePilot in <scratch fixture repository root>`.

```
<scratch>/fp/forgepilot goal create --id praxisbound-cross-check \
  --title "PraxisBound cross-check" --review-policy goal --json
```

Verbatim output, exit `0` (`evidence/log-05-goal-create.json`):

```json
{"format_version":"forgepilot.cli/v1","goal":{"id":"praxisbound-cross-check","title":"PraxisBound cross-check","description":"","status":"ACTIVE","review_policy":"GOAL","completion_policy":"VERIFIED"}}
```

```
<scratch>/fp/forgepilot work add --goal praxisbound-cross-check \
  --story specs/stories/EX-001-first --external-ref node-001 --json
```

Verbatim output, exit `0` (`evidence/log-06-work-add-001.json`):

```json
{"format_version":"forgepilot.cli/v1","created":true,"work_item":{"id":"WI-001","goal_id":"praxisbound-cross-check","story_ref":"specs/stories/EX-001-first","external_ref":"node-001","status":"READY","depends_on":[]}}
```

```
<scratch>/fp/forgepilot work add --goal praxisbound-cross-check \
  --story specs/stories/EX-001-first --external-ref node-002 \
  --depends-on WI-001 --json
```

Verbatim output, exit `0` (`evidence/log-07-work-add-002.json`):

```json
{"format_version":"forgepilot.cli/v1","created":true,"work_item":{"id":"WI-002","goal_id":"praxisbound-cross-check","story_ref":"specs/stories/EX-001-first","external_ref":"node-002","status":"PENDING","depends_on":["WI-001"]}}
```

A Declaration, Manifest, and Coverage Review were then exported by this Core
from that same repository's checked-in ADR, spec, Story, and readiness
bytes, and written into the repository:

```
node specs/stories/TST-029-goal-plan-shape-alignment/evidence/export-forgepilot-artifacts.mjs <scratch fixture repository root>
```

Verbatim output (`evidence/log-08-export-artifacts.json`):

```json
{
  "declarationPath": "specs/plans/praxisbound-cross-check.json",
  "manifestPath": "specs/batches/BR-002-cross-check/goal-plan/manifest.json",
  "reviewPath": "specs/batches/BR-002-cross-check/goal-plan/coverage-review.json"
}
```

A `goal-preflight-request.json` (`forgepilot.goal-preflight-request/v1`,
saved as `evidence/preflight-request.json`) was written naming Work Item IDs
`WI-001` and `WI-002`. Running:

```
<scratch>/fp/forgepilot goal preflight \
  --request specs/batches/BR-002-cross-check/goal-plan/preflight-request.json \
  --json
```

exited `0` with the verbatim response saved at `evidence/log-09-preflight.json`.
Its `diagnostics` field is `null`. Every `facts` entry ForgePilot probed is
`"status":"observed"`: `goal`, `manifest`, `declaration`, `sources`,
`readinessContracts`, `coverageReview`, `registration`. The full (untruncated)
Manifest digest ForgePilot itself computed and returned is:

```
88a79bdfbbd964d5c96ac3b0eaf4660fda1433dc624f391c4131671e258b6b49
```

(`"facts":{"manifest":{"status":"observed","value":"88a79bdfbbd964d5c96ac3b0eaf4660fda1433dc624f391c4131671e258b6b49"}, …}`
in `evidence/log-09-preflight.json`), and `"registration":{"status":"observed","value":"exact"}`.
ForgePilot's `goal preflight` accepted, unmodified, an artifact set this
Core exported.

## Authority Used

* plan
* modify
* commit

## Residual Risks

* `The ForgePilot cross-check ran in a scratch directory outside this repository, from a clean archive of the pinned commit; it is not repeated by make verify and must be re-run by hand against any future ForgePilot commit this Story's ADR-016 falsification condition names.`
* `AC-003's category mapping is this Core's own design choice (Rule R3), not a byte-for-byte match to ForgePilot's internal Go category for every rule: ForgePilot's preflight.go returns invalid-topology for an unsorted Manifest node or dependsOn array, where this Core and the Story's own acceptance.md AC-003 both call that malformed-artifact. None of ForgePilot's 5 named invalid fixtures exercise sortedness, so this difference does not appear in the fixture-agreement check above.`
* `A duplicate entry within one Manifest node's dependsOn array is invalid-topology in ForgePilot's preflight.go (it folds the uniqueness and sort checks into one "must be sorted" comparison, which a duplicate also fails) but malformed-artifact in this Core (duplicate-dependency and sort-order are two separate, explicit checks here). Duplicate node references themselves — a different rule — are invalid-topology in both. None of ForgePilot's 5 named invalid fixtures exercise a duplicate dependsOn entry, so this difference does not appear in the fixture-agreement check above.`
* `The scratch fixture repository's Goal Plan artifacts are a small two-node, single-Story plan built for this cross-check; they are not the real R-008 review goal-plan projection, which is a later Story.`
* `JS's Unicode tables (the \p{Cc}, \p{Cf}, \p{Zl}, \p{Zp} property escapes this Core's REPO_PATH_PATTERN and REVIEWER_NAME_PATTERN now use) and Go's unicode package tables both track the Unicode Character Database but are generated from whatever Unicode version each language runtime ships; a character newly assigned to one of these categories in a Unicode revision one runtime has and the other does not would be accepted by one and rejected by the other. Not exercised by any test, since it depends on the two runtimes' installed Unicode versions at run time, not on this code.`
* `A path containing a lone (unpaired) UTF-16 surrogate, e.g. "a\ud800b", is accepted by both sides today: this Core's repoPath pattern and byte-length check operate on the JS string as given (WTF-16-tolerant), and Go's UTF-8 encoder replaces an unpaired surrogate with U+FFFD (the replacement character) rather than rejecting it, so ForgePilot's own repoPath validation also lets it through. The two sides then disagree on the actual bytes: this Core's TextEncoder-based utf8ByteLength and source-facts lookup key keep the lone surrogate as WTF-8 (an encoding neither valid UTF-8 nor rejected outright by encodeURIComponent-style APIs), while Go's os.ReadFile and any UTF-8-based tooling see the U+FFFD-substituted name. A caller could bind a source under a lone-surrogate identity that this Core resolves as one file and ForgePilot resolves as a different (U+FFFD-named) one. Not exercised by any test; second code review LOW finding, not fixed in this round.`
