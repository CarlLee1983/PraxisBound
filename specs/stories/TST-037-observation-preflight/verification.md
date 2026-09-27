# Verification Result: TST-037

Observed in the isolated implementation worktree on 2026-09-27 14:37 UTC. Focused evidence was followed by the integration observations below.

| Criterion | Observation |
| --- | --- |
| AC-001 | Contract §22 requires an earlier exit-0 `preflight` in the same observation for each of the five write commands. Contract §14 calls the unreleased change Corrective, keeps `schemaVersion` `2.0.0`, and states that output is opaque. Core positive/order/output tests pass. |
| AC-002 | ADR-018 records the tool-enforcement decision, its authority limit, and a `Falsified if` condition. |
| AC-003 | Five separate Core rejection cases each report the preflight-specific message. Removing the complete new guard from the generated Core module made all five fail (0 pass / 5 fail); the original module was restored. This proves the guard is load-bearing as a whole. The `run` case includes `run-dry-run` because the older order rule requires it, so it does not independently prove the guard's `run` branch is load-bearing. A spawned CLI case returns exit 1, `REVIEW_OBSERVATION_INVALID`, and no ForgePilot record. |
| AC-004 | The five checked-in TST-033 and nine checked-in TST-035 accepted records pass Core replay. For TST-035, manifests embedded in the recorded ForgePilot output were serialized to their original bytes and matched against each record's `goalPlan.sha256` before validation; historical evidence was unchanged. |
| AC-005 | Agent workflow and CLI contract describe the same rule. Focused Core and CLI tests passed (96 pass / 0 fail). The integrated `make verify` at source checkpoint `27eef70` passed (exit 0). |

Checks: `./scripts/verification-check specs/stories/TST-037-observation-preflight` passed (`VERIFICATION_PLAN_OK`); `pnpm run build` passed; `node --test packages/core/test/review-observation.test.mjs packages/cli/test/review-observe.test.mjs` passed (96/96). Mutation check intentionally exited nonzero with the guard removed from generated output, and its five expected failures were observed. No source or historical record was mutated for that check.

Remaining risk: this consistency rule validates a self-reported observation. It does not prove ForgePilot ran `preflight`, that its output was ready, or that execution was authorized.

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
