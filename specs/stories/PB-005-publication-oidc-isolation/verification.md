# Verification Result: PB-005

## Checks

* lint: pass — `make verify on f6cdbd90e56a8d6119c555f9f2298fa413f160f0; Prettier, ESLint, shell syntax including tests/publication-workflow.sh, and actionlint on verify.yml and publish.yml passed`
* static: pass — `make verify; Story readiness, verification planning, TypeScript typecheck, Go vet and staticcheck passed`
* unit: pass — `make verify; tests/protocol.sh PB005-AC-001, AC-002, AC-003, AC-006 and AC-008, and SHA-pin checks over verify.yml, publish.yml and the composite action`
* integration: pass — `tests/publication-workflow.sh PB005-AC-004, AC-005, AC-006 and AC-009 under sh and dash; tests/publish-dispatch.sh PB005-AC-007 under sh and dash`
* contract: pass — `publish.yml keeps the PB-004 candidate, exact-SHA verify.yml, unused-version and OIDC-only guards, held by PB004-AC-008 as narrowed in the Story's Superseded Behavior`
* e2e: pass — `all 30 checks on pull request #78 head f6cdbd90e56a8d6119c555f9f2298fa413f160f0 passed, including verify.yml's verify job through the composite action`
* architecture: pass — `Human Review: carl accepted in a Claude Code session on 2026-09-17 at 2026-09-17T06:12Z, reviewing main at 33c0d2c61000c34d49a47f94095c4c394879363f and the rehearsal evidence below. Accepted ADR-013's two-job split, the npm-publication environment gate, the shared composite setup and the helper precheck, with the residual risks below, including the observed unapproved rehearsal 35182525063.`

The first pull request head, dda39f1, failed `make verify-actions` in CI:
shellcheck on the runner reported SC2015 in the manifest step, which the local
shellcheck 0.11.0 did not report. f6cdbd9 replaces that construct with an
explicit `if`. The following were mutation-checked rather than only observed
green: removing the digest comparison failed PB005-AC-009; dropping `--dry-run`
from the rehearsal step failed PB005-AC-005; adding `id-token: write` to the pack
job, and separately at workflow level, failed PB005-AC-001; pinning an action in
the composite action to `@v7` failed the SHA-pin check; adding an `npx` step to
the publish job failed PB005-AC-003; removing the helper's environment precheck
failed PB005-AC-007.

## Evidence

* `AC-001`: pass — `tests/protocol.sh PB005-AC-001 observed two main-only jobs, id-token write only in the publish job, no workflow-level id-token, and environment npm-publication on the publish job.`
* `AC-002`: pass — `tests/protocol.sh PB005-AC-002 observed both candidate guards ordered before the setup action, cache false, make verify, npm pack of one package, the sha512 output and the artifact upload.`
* `AC-003`: pass — `tests/protocol.sh PB005-AC-003 held the publish job to an allowlist of setup-node and download-artifact and found no checkout, install, npx, pnpm, make or repository script; it downloads, compares sha512, publishes the tarball, and compares registry integrity into the run summary.`
* `AC-004`: pass — `tests/publication-workflow.sh PB005-AC-004 executed the committed guard step against fixture tarballs and fake npm: a published version, a CLI before Core, a CLI with a non-exact Core dependency, and a dispatched package differing from the tarball name were each refused before any publish.`
* `AC-005`: pass — `tests/publication-workflow.sh PB005-AC-005 observed a rehearsal reporting an existing version without failing, invoking only a dry-run publish, failing without the OIDC success line, and passing on a non-zero dry-run exit that shows the line; a real run never passed --dry-run.`
* `AC-006`: pass — `tests/protocol.sh PB005-AC-006 observed both jobs using .github/actions/setup-verification, the setup lines and composite structure in it and absent from the verify job, setup-go and pnpm caches following the input, the cache rationale, and no stored npm credential. actionlint does not lint composite actions, as the revised criterion records.`
* `AC-007`: pass — `tests/publish-dispatch.sh PB005-AC-007 observed refusal without dispatch for a missing and for an unprotected npm-publication environment, and the approval notice with the run URL after a confirmed dispatch; the PB004-AC-009 cases still pass.`
* `AC-008`: pass — `tests/protocol.sh PB005-AC-008 held docs/releasing.md section 8 to the environment approval, the rehearsal and its OIDC line, and the human setup order with the environment created before merging.`
* `AC-009`: pass — `tests/publication-workflow.sh PB005-AC-009 observed a mismatched digest refused before any npm command, a registry integrity mismatch failing after publication, and a rehearsal lacking the OIDC line failing, each with no real publish invocation.`
* `AC-010`: pass — `make verify exited 0 locally on f6cdbd9, and all 30 pull request checks for that head passed.`
* `AC-011`: pass — `The human created environment npm-publication (required reviewer CarlLee1983, self-review allowed, deployment branch main; the agent saw only the human's own gh api output) after PB-005 merged, contrary to the runbook's create-before-merge order. In that interval CarlLee1983 dispatched core rehearsal run 35182525063 at 2026-09-17T04:35:59Z: its publish job started four seconds after the pack job finished, has no approval record, and exchanged an OIDC token, so it ran without the environment gate. Because it was a rehearsal nothing was published, and it is not counted toward this criterion. PB-005 merged as 33c0d2c61000c34d49a47f94095c4c394879363f and its verify.yml push run 35182143422 successful. First round, dispatched before the human was asked to add the environment to the npm Trusted Publisher entries: rehearsal runs 35182844128 for core and 35183212638 for cli. The human then stated that both entries were set to environment npm-publication. Second round: runs 35183958788 for core and 35184196927 for cli. All four were human-dispatched from main at that SHA with rehearsal true, waited for and received the human's environment approval, and completed success with pack and publish succeeding; each publish job logged npm verbose oidc Successfully retrieved and set token, the second-round runs after POST 201 to the package OIDC token exchange; the guard reported 0.2.0 as already existing without enforcing it; the real publish and integrity steps were skipped; npm's dry-run then refused to publish over 0.2.0 as expected. latest and next remained 0.2.0 for both packages.`

## Authority Used

* plan
* modify
* commit
* push

## Residual Risks

* `The first real upload and provenance signature under the two-job structure cannot be observed without publishing; the next publication Story must record it as an acceptance criterion.`
* `A dispatch outside the helper, from the GitHub interface or gh workflow run, bypasses the helper's environment precheck. If npm-publication is missing or unprotected when such a dispatch runs, the publish job runs without approval. This was observed, not only inferred: rehearsal run 35182525063 ran its publish job with no approval before the environment was protected. Had it not been a rehearsal, and had the version been unused, it would have published without approval. Creating the environment before merging remains the only defense, and the runbook order was not followed this time.`
* `The rehearsals observed that the publish job downloads the artifact with no GITHUB_TOKEN permission beyond id-token, and that npm accepts the OIDC exchange when the job environment matches the Trusted Publisher entry. No rehearsal observed a deliberate mismatch, such as an entry naming a different environment, so rejection in that case rests on documentation.`
* `The rehearsal's success signal is the verbose npm log line "Successfully retrieved and set token", confirmed in npm/cli lib/utils/oidc.js; a future npm release that rewords it makes rehearsals fail closed.`
* `The composite action is checked structurally by tests/protocol.sh, not linted, because actionlint does not descend into composite actions. Its run steps are single commands.`
* `Local and CI shellcheck versions disagree: CI reported SC2015 that local shellcheck 0.11.0 did not, so a clean local make verify-actions does not guarantee a clean CI run.`
