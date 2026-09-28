# TST-041 live rehearsal observations

Observed on 2026-09-28 UTC in the isolated `fixture-v2` repository. Raw observations and accepted `review observe` records remain in that fixture. `accepted-step-ledger.json` retains the accepted records' ordered steps, exits, safe parsed outcomes, and raw-output digests for durable review. This summary and ledger omit the single-use approval token and inherited configuration values.

## Definition and plan

- Human terminal confirmation: `specs/batches/BR-941-live/records/confirmation-ffad64ff3208.json`, `confirmedAt=2026-09-28T03:47:22.062Z`, fingerprint `ffad64ff3208f284a4316456a71d7a5099abf31dcf2c584e29284153fac47321`, manifest SHA-256 `957077166387847c6de212a95356de919e2eecc5583bbfde453c36e30f0b8a63`.
- Agent Semantic Report: `specs/batches/BR-941-live/semantic-report.json`, SHA-256 `b8aaae9c6da2471c1a5b4a6f4462af56b10df5ec7de73099f94d3625b4a55c71`; four Stories and four categories per Story, with no blocking observation. Both `review preflight --expect-fingerprint` and `review goal-plan` exited 0 with `REVIEW_READY`; two Spec-title advisories remained.
- Goal Plan: `specs/batches/BR-941-live/goal-plan/BR-941-live-ffad64ff3208/`, manifest SHA-256 `609b9b2fb493034634cdf790f19a88346ddc636359ecae26ab32977dbfd4975a`.
- Preview: `forgepilot.execution-plan/v2`, Goal `BR-941-live-ffad64ff3208`, request SHA-256 `sha256:0552645805d40adc0f1eca98f262647f185782283f97c091a581f46fe212bbef`; `gpt-6-astra`, `medium`, `workspace-write`, caps `500,5,20,2,65536,1048576,16777216,134217728`, expiry `2026-10-05T00:00:00Z`. Top-level diagnostics were empty. The human personally ran `execution authorize --by Carl` and stated that action in the current session before the real run.

## ForgePilot segments

| Observation | Result | Evidence |
| --- | --- | --- |
| First segment, `2026-09-28T03:49:20Z` | `awaiting-authorization`; `review observe` exit 0 | `records/forgepilot-ffad64ff3208-1.json`, SHA-256 `4973d401e419702b1dc6bb05076d4aa98ba8d2c5c8a4d8b5a126ba9138888989` |
| Second segment, `2026-09-28T03:55:10Z` | `goal-completed`; real `run` exit 0; `review observe` exit 0 | `records/forgepilot-ffad64ff3208-2.json`, SHA-256 `dd6e478c0c383c0ed4ecc62b2b888062510336128c0a25d2f1c86cee07cd799f` |

The first segment recorded a passing preflight and matching manifest digest before Goal creation, each Work Item addition, and both request writes. `work list` exited 1 for the absent Goal; `goal create` exited 0. Four `work add` calls exited 0: FX-001→WI-001, FX-003→WI-002, FX-002→WI-003 (depends on WI-001), and FX-004→WI-004 (depends on WI-003 and WI-002). `goal preflight` exited 0 with top-level `diagnostics: null`; `execution plan` exited 0 with top-level `diagnostics: []`.

The second segment recorded preflight exit 0 and matching manifest digest before `run --dry-run` (exit 0) and again before the real `run` (exit 0). Run `run-20260928t035206-8347f9` independently started, resumed, and verified WI-001 through WI-004 in dependency order. Each Worker finished in its first technical attempt. The Runner produced PASS evidence EV-001 through EV-010 and Goal completion evidence GC-001. Public `work list --goal ... --json` returned Goal `COMPLETED` and all four Work Items `VERIFIED`; the fixture HEAD stayed `a47207c969f63f54d3a51535f09e832f0aa2885e` and candidates were `SNAPSHOT` revisions. No per-Story human confirmation occurred.

`run status run-20260928t035206-8347f9 --json` independently returned `stop_reason=GOAL_COMPLETED`, `exit_code=0`, `steps=13`, one attempt for each of WI-001 through WI-004, and `worker_pending=false`.

## Acceptance and observed issues

- `make verify` in the final fixture exited 0: six tests passed, zero failed, zero skipped. `make verify-final` exited 0: eight passed, zero failed, zero skipped. The independently inspected Worker tests assert `greet("Ada")`, `greet("Lin")`, `farewell("Ada")`, and `farewell("Lin")` against the requested strings. README shows both calls and outputs. `git diff --check` exited 0.
- ForgePilot#65 **recurred**: the approved plan carried `maxSteps=500` and `maxTechnicalAttemptsPerNode=5`, yet `run --dry-run` displayed a budget of 100 steps and 3 attempts per Work Item, and real run progress said `technical attempt 1/3`. The four items still completed, so this rehearsal cannot determine whether the Runner would enforce the approved limits after the third attempt.
- ForgePilot#66 **was not observed**: all four Workers returned in one technical attempt; no stall or timeout occurred.
- **Contract discrepancy and correction:** before this rehearsal's authorized correction, the batch contract §11 stated that every ForgePilot public CLI call uses `--json` and validates exit-0 JSON. Its specific `run` steps omitted that flag, as did ForgePilot's public help. This rehearsal followed the specific commands, so both `run --dry-run` and real `run` returned human-readable stdout; the second-segment driver validated exits and the observation shape, not JSON. A later read-only `run --dry-run --json` exited 1 with `forgepilot: --json requires a value`; `run --dry-run --json=true` did the same. The human explicitly authorized a Corrective contract and workflow clarification: only commands supporting `--json` require it; `run` decisions use exits, and optional `run status --json` is independent corroboration outside the observation. The live observation bytes remain unchanged.
- The inherited global Codex hooks again created `.gitignore` and `.ignore` in the fixture. These were outside the four Story deliverables. Their presence was disclosed as a Worker environment risk before authorization; neither was committed.
- The baseline fixture's `make verify` exited 0 with three skipped pending cases, while its strict `make verify-final` exited 2 with five missing-output failures. These were pre-implementation observations, retained rather than counted as final PASS. The agent-controlled browser was blocked from opening the local review page by its URL policy; the human opened and confirmed through their own terminal.

`GOAL_COMPLETED` is ForgePilot technical completion only. Human Review acceptance, merge, deployment, and GitHub issue closure have not occurred.
