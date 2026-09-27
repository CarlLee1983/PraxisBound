# TST-038 Verification

## Acceptance trace

| Criterion | Observation |
| --- | --- |
| AC-001 | `R-009/AC-001` builds an isolated temporary Git repository with two Specs, four dependent Stories and Readiness Sidecars, and runs its `make verify`. Each case removes its fixture. |
| AC-002 | The success case invokes the built `dist/bin.js` for index, render, import, respond, re-render, preflight, readiness-digests, goal-plan and observe, checking JSON outcomes and process exit codes. Confirm uses the existing injected terminal adapter before and after the source revision. The revised render reports `REVIEW_SOURCE_CHANGED`, names the changed Spec and displays `需複審` under the new fingerprint; the badge clears after confirmation of that fingerprint. |
| AC-003 | The success case checks `REVIEW_READY`, all four Goal Plan nodes, and each declared dependency edge. |
| AC-004 | The success case replays TST-035 ForgePilot 3a76aca outputs, explicitly rebinding each work-add step's Story and Work Item metadata and its stdout payload to the corresponding Goal Plan node and dependencies. The fourth work-add copies a recorded output shape and is synthetic; no real four-Story ForgePilot run is claimed. `review observe` accepts the record, and no ForgePilot or model process runs in the test. |
| AC-005 | The success test name includes `R-009/AC-001`; the focused suite passes. The integrated `make verify` at source checkpoint `27eef70` passed (exit 0). |
| AC-006 | Nine independent cases cover stale source, unmapped requirement, external dependency, cycle, missing Semantic Report, stale feedback, unresolved blocker, unauthorized-run evidence and missing earlier preflight. The contract's nonexistent shell test paths now name existing test files. |

## Checks run

| Check | Result |
| --- | --- |
| `./scripts/verification-check specs/stories/TST-038-batch-review-e2e` | `VERIFICATION_PLAN_OK` |
| `pnpm run build` | passed |
| `node --test packages/cli/test/review-batch-e2e.test.mjs` | 10 passed after TST-037 validator integration |
| `pnpm run lint` | passed after final black-box adjustment |
| `pnpm exec prettier --check packages/cli/test/review-batch-e2e*.mjs` | passed after final black-box adjustment |
| `make verify` | passed at integrated source checkpoint `27eef70`; review-fix focused checks are recorded below |

## Remaining risk

`review observe` validates observation shape and binding but treats ForgePilot stdout and stderr as opaque evidence. The replay proves the review CLI path and four-node mapping; it does not prove ForgePilot executed the new plan.

## Checks

* lint: pass — `make verify at 27eef70; review-fix pnpm run lint also passed.`
* static: pass — `make verify includes Story, execution, TypeScript and Actions checks; the two new Stories also pass story-check --ready.`
* unit: pass — `make verify: 1009 TypeScript tests, 1008 passed, 0 failed, 1 pre-existing opt-in performance smoke skipped.`
* integration: pass — `the composed make verify passed; the post-review review-batch-e2e.test.mjs focused run passed all 10 cases.`
* contract: pass — `independent Spec review of 8452708..27eef70 and the f4065ff delta verified the observation rule, unchanged schema, replay provenance and dependency mapping.`
* e2e: pass — `the built CLI success loop and nine return paths passed in temporary repositories; confirmation used the existing injected terminal adapter.`
* architecture: pass — `the read-only architect selected the existing Core consistency boundary before the CLI write; independent Standards and Spec reviewers found no residual issue after f4065ff.`

## Evidence

* `AC-001`: pass — `the corresponding acceptance-trace row above records the concrete observation; composed gate and independent review are recorded here.`
* `AC-002`: pass — `the corresponding acceptance-trace row above records the concrete observation; composed gate and independent review are recorded here.`
* `AC-003`: pass — `the corresponding acceptance-trace row above records the concrete observation; composed gate and independent review are recorded here.`
* `AC-004`: pass — `the corresponding acceptance-trace row above records the concrete observation; composed gate and independent review are recorded here.`
* `AC-005`: pass — `the corresponding acceptance-trace row above records the concrete observation; composed gate and independent review are recorded here.`
* `AC-006`: pass — `the corresponding acceptance-trace row above records the concrete observation; composed gate and independent review are recorded here.`

## Authority Used

* plan
* modify
* commit
* push

The human's explicit implement-spec invocation authorized local integration and
publication of PR #133. No dependency, migration, deployment or merge into main
was performed.

## Residual Risks

* `The canonical run skipped the pre-existing opt-in 4 MiB wall-clock render smoke (PRAXISBOUND_PERF_SMOKE=1); scaling ratio tests ran. This optional smoke is unrelated to these acceptance criteria.`
* `Observations are self-reported evidence, not proof of live ForgePilot execution or authorization. The fourth E2E work-add uses an explicitly synthetic recorded shape. Live and browser acceptance belong to other #125 tickets.`

## Verification record correction

The first result-file validation rejected prose outside the required single
backticked observation fields. The record formatting was corrected and the
result-file validation rerun; no product code or acceptance criterion changed.
The post-review gate was interrupted before completion to correct this record
format and restarted afterward; the interrupted run is not counted as PASS.
