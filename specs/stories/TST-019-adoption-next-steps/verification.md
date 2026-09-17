# Verification Result: TST-019

## Checks

* lint: pass — `make verify; Prettier, ESLint, shell syntax, Node syntax, and actionlint passed`
* static: pass — `make verify; TypeScript typecheck, Story readiness, verification planning, Go vet, staticcheck, and protocol inventories passed`
* unit: pass — `make verify; 339 TypeScript tests passed, including the five TST019 command-boundary cases`
* integration: pass — `tests/typescript-tooling.sh TST019-AC-007; tests/bootstrap.sh TST019-AC-009`
* contract: pass — `packages/core/test/root-import.test.mjs and tests/typescript-tooling.sh PB003-AC-001 accepted the widened public export and package surfaces; validateResultEnvelope accepted every init envelope carrying nextSteps at RESULT_SCHEMA_VERSION 1.0.0`
* e2e: pass — `exact SHA 3fb0cb0e0435ea90850922fd55b60a6c4131ade1 passed all 30 push and pull-request checks in Actions runs 35101057401 and 35101095632, across the root gate, Node 22/24/26 on Linux and macOS, and both portability jobs`
* architecture: pass — `Human Review: carl accepted in a Claude Code session on 2026-09-17 at 02:49Z, reviewing main at 8c95d79b44a6485b4320cb4f25949135752e79b2. Accepted ADR-012 as revised, the next-step contract boundary in packages/core/src/adoption-next-steps.ts, core attaching and CLI rendering, with the known trade-offs that an id names which action remains while the consumer owns how to perform it, and that published 0.2.0 keeps the earlier confirm-adoption wording.`

The final local gate completed successfully before exact SHA
3fb0cb0e0435ea90850922fd55b60a6c4131ade1 was pushed. That revision is the tip
of PR #63, merged into main as 9857531b35d6f92f111fcf449e83b4c8b10cbe46; the
remote runs recorded above are for it. This record reached main later, and
changes only this file. Two
implementation slices were mutation-checked rather than merely observed green:
reversing the two steps in `packages/core/src/adoption-next-steps.ts` failed
`TST019-AC-007` as designed, and replacing the consumer's gate with a Makefile
carrying no `verify` rule failed it on the `make verify` assertion. The
documentation denial in `tests/bootstrap.sh` was likewise mutation-checked by
inverting the package-section sentence in `README.md`.

## Evidence

* `AC-001`: pass — `TST019-AC-001 observed ordered next steps under data on both the INIT_PREVIEW and INIT_APPLIED outcomes, each step carrying an identifier and a description, with the gate step before the confirmation step.`
* `AC-002`: pass — `TST019-AC-002 read the steps from the machine result and found every description present in the human stdout in the emitted order.`
* `AC-003`: pass — `TST019-AC-003 observed the gate step on one line and matching no toolchain name. That the confirmation step names Doctor and PASS rests on Human Review, because asserting it would contradict AC-005 (#71): carl accepted in a Claude Code session on 2026-09-17 at 02:49Z, reviewing main at 8c95d79b44a6485b4320cb4f25949135752e79b2, of the description "Run PraxisBound Doctor on this repository's root, using the same tooling that ran init, and confirm it reports PASS."`
* `AC-004`: pass — `TST019-AC-004 applied init in safe, force and upgrade modes and found no path named like a Makefile in any target; every envelope validated at schemaVersion 1.0.0.`
* `AC-005`: pass — `Human Review: carl accepted in a Claude Code session on 2026-09-17 at 02:49Z, reviewing main at 8c95d79b44a6485b4320cb4f25949135752e79b2. packages/cli/test/init-command.test.mjs asserts step identifiers, presence and ordering only. The single-line and toolchain-name checks on the gate step are negative structural constraints required by AC-003, not assertions of description wording: a rewording fails them only by naming a toolchain, which R4 already forbids.`
* `AC-006`: pass — `TST019-AC-006 observed INIT_CONFLICT and INIT_USAGE carrying no nextSteps, with their existing exit statuses unchanged.`
* `AC-007`: pass — `TST019-AC-007 applied the packed package in a disposable clean consumer to a gateless fixture, dispatched every action by the emitted step identifier, ran make verify in the target, and required doctor to report success; no language model or network credential was involved.`
* `AC-008`: pass — `make verify exited 0 with every composed gate passing; VERSION remains 0.10.0 and scripts/bootstrap is unchanged in this branch.`
* `AC-009`: pass — `Human Review: carl accepted in a Claude Code session on 2026-09-17 at 02:49Z, reviewing main at 8c95d79b44a6485b4320cb4f25949135752e79b2. README.md and docs/getting-started.md present both paths as equals with requirements, the scoped package name and the uncontrolled unscoped name; after #71 getting-started gives package equivalents past section 2 and fetches the handoff template from the v0.10.0 tag. tests/bootstrap.sh TST019-AC-009 holds the mechanical part.`
* `AC-010`: pass — `Human Review: carl accepted in a Claude Code session on 2026-09-17 at 02:49Z, reviewing main at 8c95d79b44a6485b4320cb4f25949135752e79b2. ADR-012 records both decisions, three rejected alternatives, and a falsification condition naming the adoption and activation modules in backticks, including packages/core/src/adoption-next-steps.ts since the Corrective revision.`

## Authority Used

* plan
* modify
* commit
* push

## Residual Risks

* `The next-step behavior is not in the published @praxisbound/cli 0.1.0. The adopter documentation qualifies it by tooling version; that qualification must be removed when 0.2.0 is published, and until then an adopter following the package path receives no steps.`
* `INIT_CLEANUP_INCOMPLETE carries no next steps although the target was written. This is deliberate and recorded in the Story's Expected Errors, not a defect, but it is the one outcome that changes a repository without telling the caller what remains.`
* `Human Review on 2026-09-17 (#71) requested changes: the confirm-adoption description no longer presumes a praxisbound binary on PATH, ADR-012 was revised as Corrective, and docs/getting-started.md gained package-path equivalents. The published @praxisbound/cli 0.2.0 still prints the earlier wording, which tells an npx adopter to run praxisbound doctor; by review decision no 0.2.1 is published for it, so the corrected wording ships with the next tooling release. Ids and order are unchanged, so machine consumers are unaffected.`
* `The checks above were first observed on 3fb0cb0, before the review changes. After #71 and #72 merged, verify.yml push run 35175618834 for exact SHA 8c95d79b44a6485b4320cb4f25949135752e79b2 succeeded with all 15 jobs, and make verify exited 0 locally on that revision with only these verification records changed; the per-check lines above keep their original observations.`
* `The earlier request to remove the tooling 0.2.0 qualification from the adopter documentation was superseded by PB-004, which keeps it.`
