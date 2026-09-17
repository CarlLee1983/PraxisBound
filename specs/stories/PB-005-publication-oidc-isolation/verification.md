# Verification Result: PB-005

## Checks

* lint: pass — `make verify on f6cdbd90e56a8d6119c555f9f2298fa413f160f0; Prettier, ESLint, shell syntax including tests/publication-workflow.sh, and actionlint on verify.yml and publish.yml passed`
* static: pass — `make verify; Story readiness, verification planning, TypeScript typecheck, Go vet and staticcheck passed`
* unit: pass — `make verify; tests/protocol.sh PB005-AC-001, AC-002, AC-003, AC-006 and AC-008, and SHA-pin checks over verify.yml, publish.yml and the composite action`
* integration: pass — `tests/publication-workflow.sh PB005-AC-004, AC-005, AC-006 and AC-009 under sh and dash; tests/publish-dispatch.sh PB005-AC-007 under sh and dash`
* contract: pass — `publish.yml keeps the PB-004 candidate, exact-SHA verify.yml, unused-version and OIDC-only guards, held by PB004-AC-008 as narrowed in the Story's Superseded Behavior`
* e2e: pass — `all 30 checks on pull request #78 head f6cdbd90e56a8d6119c555f9f2298fa413f160f0 passed, including verify.yml's verify job through the composite action`
* architecture: blocked — `no human architecture review of the implementation has been performed`

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
* `AC-011`: blocked — `requires the human to create environment npm-publication, merge, and dispatch rehearsals for core and cli before and after adding the environment to both npm Trusted Publisher entries; not yet observed.`

## Authority Used

* plan
* modify
* commit
* push

## Residual Risks

* `The architecture check and AC-011 are blocked, so this Story is partial and must not be reported as complete.`
* `The first real upload and provenance signature under the two-job structure cannot be observed without publishing; the next publication Story must record it as an acceptance criterion.`
* `A dispatch from the GitHub interface bypasses the helper's environment precheck. If npm-publication does not exist when such a dispatch runs, GitHub creates it without protection and the publish job runs without approval. Creating the environment before merging is the only defense.`
* `That the publish job's download-artifact step needs no GITHUB_TOKEN permission beyond id-token, and how the npm registry treats an environment mismatch, rest on documentation and code reading; the AC-011 rehearsals are their first observation.`
* `The rehearsal's success signal is the verbose npm log line "Successfully retrieved and set token", confirmed in npm/cli lib/utils/oidc.js; a future npm release that rewords it makes rehearsals fail closed.`
* `The composite action is checked structurally by tests/protocol.sh, not linted, because actionlint does not descend into composite actions. Its run steps are single commands.`
* `Local and CI shellcheck versions disagree: CI reported SC2015 that local shellcheck 0.11.0 did not, so a clean local make verify-actions does not guarantee a clean CI run.`
