# Verification Result: TST-037

Observed in the isolated implementation worktree on 2026-09-27 14:37 UTC. This is focused evidence; the required integrated `make verify` result is pending.

| Criterion | Observation |
| --- | --- |
| AC-001 | Contract §22 requires an earlier exit-0 `preflight` in the same observation for each of the five write commands. Contract §14 calls the unreleased change Corrective, keeps `schemaVersion` `2.0.0`, and states that output is opaque. Core positive/order/output tests pass. |
| AC-002 | ADR-018 records the tool-enforcement decision, its authority limit, and a `Falsified if` condition. |
| AC-003 | Five separate Core rejection cases each report the preflight-specific message. Removing the complete new guard from the generated Core module made all five fail (0 pass / 5 fail); the original module was restored. This proves the guard is load-bearing as a whole. The `run` case includes `run-dry-run` because the older order rule requires it, so it does not independently prove the guard's `run` branch is load-bearing. A spawned CLI case returns exit 1, `REVIEW_OBSERVATION_INVALID`, and no ForgePilot record. |
| AC-004 | The five checked-in TST-033 and nine checked-in TST-035 accepted records pass Core replay. For TST-035, manifests embedded in the recorded ForgePilot output were serialized to their original bytes and matched against each record's `goalPlan.sha256` before validation; historical evidence was unchanged. |
| AC-005 | Agent workflow and CLI contract describe the same rule. Focused Core and CLI tests passed (96 pass / 0 fail). `make verify` has not been run at this worktree checkpoint; integrated completion remains pending. |

Checks: `./scripts/verification-check specs/stories/TST-037-observation-preflight` passed (`VERIFICATION_PLAN_OK`); `pnpm run build` passed; `node --test packages/core/test/review-observation.test.mjs packages/cli/test/review-observe.test.mjs` passed (96/96). Mutation check intentionally exited nonzero with the guard removed from generated output, and its five expected failures were observed. No source or historical record was mutated for that check.

Remaining risk: this consistency rule validates a self-reported observation. It does not prove ForgePilot ran `preflight`, that its output was ready, or that execution was authorized. The integrated `make verify` gate remains required.
