# Verification Result: TST-035

Rehearsal run on 2026-09-25/26 against ForgePilot
`3a76acaa5da206bef9a8d15df0db3f08f90311e2`, installed through its Bootstrap,
with PraxisBound at `2adfe82cab5e7f55a4572d794af3a5265ee5a6b8` plus this
Story's uncommitted changes. Result: **pass** — AC-001 through AC-008 each
have a passing observation. Getting there took one model change, one
`--attempt` recovery and one fixture fix. All three are recorded under
Incidents and Deviations; none of them was edited to make a record accepted.

## Checks

* lint: pass — `make verify` exit 0 on this tree (2026-09-26).
* static: pass — `make verify` exit 0; `story-check` `STORY_CONTRACT_OK`.
* unit: pass — `packages/core/test/review-observation.test.mjs` 62 pass / 0 fail, including the four new AC-007 tests; `make verify` exit 0.
* integration: pass — AC-001 to AC-006 observed against the Bootstrap-installed ForgePilot; every `review observe` call exit 0.
* contract: pass — contract §10, §11 and §14, `docs/batch-review/agent-workflow.md` §3 and ADR-016 re-pinned to `3a76aca`; no §11 step, stop reason or schema changed (R8).
* e2e: pass — a real Codex Worker implemented all three fixture Stories, and ForgePilot completed the Goal on its own (`GOAL_COMPLETED`).
* architecture: pass — no production code, schema, `VERSION`, `protocol/` or `templates/` change.

## Environment

* Evidence paths use `<HOME>` for the human's home directory, `<tst035>` for the rehearsal scratch directory, and `<FORGEPILOT_SRC>` for the ForgePilot checkout (R7). Nothing else in the copied outputs was altered.
* ForgePilot: installed through Bootstrap plan `sha256:5cceef76d88f31c6afe8bae3c0899af45b36e1f63d7a0bdaacfa001c76ae2dcd` with `go1.25.5 darwin/arm64` (`evidence/logs/bootstrap-plan.txt`, `bootstrap-install.txt`). The install ran ForgePilot's own `make verify` (10:57:56Z–11:08:41Z, exit 0).
* `generation-v1 current`: `generation_id` `3a76acaa5da206bef9a8d15df0db3f08f90311e2`, `payload_digest` `sha256:6b82b953957d6bf8182bb09705ab8b4f690c0b7864b87193efde82df82b8cce5`. Installed CLI sha256 `426d85e6af61383365ef38017e8a05ed6027f0302679fc42c666a235ed951a82` (`evidence/logs/bootstrap-generation.txt`).
* Codex: `codex-cli 0.155.1`, logged in with a ChatGPT account. Authorized `executable_sha256` is `8eaf1ad1…0a9e`.
* Human-supplied values, all carl's (`evidence/config/`):
  * Worker Profile `codex` / resolved Codex path / `gpt-5-codex`, later `gpt-6-astra` / `medium` / `workspace-write`
  * caps 500 / 5 / 20 / 2 / 65536 / 1048576 / 16777216 / 134217728
  * `expiresAt` `2026-10-01T00:00:00Z`
  * `--by carl`
* Fixtures: `evidence/build-fixture.mjs`. The main batch is `BR-935-rehearsal` (fingerprint `d45922f0…`); the AC-006 batch is `BR-936-inconsistent` (fingerprint `af9f3f27…`). Each has three Stories, with FX-002 and FX-003 depending on FX-001, a Readiness Sidecar per Story, and `forgepilot init` run.
* Human actions:
  * carl ran `review confirm` for both batches in their own terminal: `confirmation-d45922f0a60f.json` at 2026-09-25T15:24:53Z, and `confirmation-af9f3f27b637.json` at 17:40:36Z after a first attempt aborted on a mistyped fingerprint and wrote nothing.
  * carl ran `execution authorize` twice (`evidence/logs/execution-authorize-*-by-human.txt`).
  * carl ran `goal cancel` once (`evidence/logs/goal-cancel-by-human.txt`).

## Acceptance Criteria

* `AC-001`: pass. The Agent installed ForgePilot `3a76aca` through the Bootstrap on carl's delegation. The install needed two preparation changes, recorded in `bootstrap-plan.txt`: a stale `~/.local/bin/forgepilot` link and a pre-Bootstrap `~/.local/share/forgepilot` layout were moved aside.
* `AC-002`: pass — `observations/obs-segment1.json`, accepted as `records/BR-935-rehearsal/forgepilot-d45922f0a60f-1.json`.
  * Steps and exits: `preflight` 0, `work-list` 1, `goal-create` 0, per-Story `preflight` 0 and `work-add` 0 (WI-001/002/003, `created: true`), `goal-preflight` 0, `execution-plan` 0.
  * `goal preflight` returned `diagnostics: null` and `execution plan` returned `[]`, with the real `engineGeneration`; the record ends in `awaiting-authorization`.
  * `work list` shows WI-002 and WI-003 depending on `WI-001`.
  * The `--attempt 2` re-run (`obs-segment1-a2.json`, record `-5`) repeats this on the new Goal with WI-004/005/006.
* `AC-003`: pass, reached on the third run of the second segment on Goal `BR-935-rehearsal-d45922f0a60f-a2` (`obs-segment2-a2-run3.json`, record `-8`).
  * `run --dry-run` exited 0. The real `run --runtime codex --runtime-command <executablePath> --snapshot` exited 0.
  * The Runner resumed WI-005, verified it, then started, implemented and verified WI-006. It asked for no per-Story human confirmation.
  * ForgePilot reported `Goal … completed automatically. Completion evidence: GC-001` and stopped with `GOAL_COMPLETED`. This maps to `goal-completed`, which is ForgePilot's technical completion only: not Human Review acceptance, not DONE.
  * Nothing was merged or committed in the fixture: HEAD is still `ba881dc`, and every candidate was a `SNAPSHOT` revision.
  * The two earlier runs on the same Goal ended `run-needs-human` (exit 2, record `-6`) and `run-limit-reached` (exit 3, record `-7`). Both were mapped by the §11 table and accepted.
* `AC-004`: pass — `observations/obs-ac004-unauthorized.json`, record `-2`.
  * Before any authorization, `run --dry-run` exited 0. The real `run` exited 1 with `forgepilot: goal "BR-935-rehearsal-d45922f0a60f" has no current execution authorization`, recorded as `run-failed`.
  * No Worker started: WI-001 stayed `READY`, and the fixture tree was unchanged.
* `AC-005`: pass. The Agent never ran `review confirm`, `execution authorize`, `goal cancel` or any `execution supervise` command; each human action is logged as listed under Environment. `~/Library/LaunchAgents` holds no ForgePilot job at the end. The Bootstrap install is the delegated exception, recorded in the Story (`2adfe82`).
* `AC-006`: pass — `observations/obs-ac006.json`, accepted as `records/BR-936-inconsistent/forgepilot-af9f3f27b637-1.json`.
  * With `--swap-mappings`, `goal preflight` exited 0 and returned `diagnostics: [{"code":"mapping-mismatch","message":"plan node \"FX-001\" does not match its Work Item story"}]`.
  * The driver stopped with `goal-preflight-failed` before `execution plan`.
  * Separately, a real `execution-plan-failed` was observed: `obs-segment1-retry.json`, record `-4`, with `registration-changed`.
* `AC-007`: pass. Four tests (`TST-035/AC-007: run-failed ending in run exit {2,3,130,143} is rejected`) were added. Each was mutation-checked by deleting its conjunct from `forgepilot-observation.ts`, rebuilding, and re-running: exactly that test failed each time. The source was restored afterwards (`git diff` empty).
* `AC-008`: pass. This file traces AC-001 to AC-007 to evidence. Before re-pinning, `git diff 32b7a68 3a76aca` over the pinned surfaces showed zero changed lines:
  * `internal/app/testdata/goal-plan-artifacts`
  * `internal/app/{preflight,execution}.go`
  * `internal/cli/{run,preflight}.go`
  * `internal/work`
  * `internal/runner/stop.go`

  The re-pin then changed contract §10, §11 and §14, `agent-workflow.md` §3 and ADR-016. `make verify` exit 0.

## Findings (ForgePilot `3a76aca` and contract §11)

* F-7 (observed): `run --dry-run` and the real `run` both show ForgePilot's default budget, "100 steps, 3 attempts per work item, 8h0m0s duration, 30m0s agent timeout", not the authorized caps (500 steps, 5 attempts). The first real `run` stopped after 3 attempts.
* F-8 (observed): a `run` stopped by `RUNTIME_PROTOCOL_ERROR` or `VERIFICATION_REFUSED` leaves its Work Item `RUNNING`. A later `run --goal` resumed it without human action (run 2 resumed WI-004; run 3 resumed WI-005).
* F-9 (observed): `goal cancel` requires `--reason <text>`, which the usage in `forgepilot help` omits. `run` suggests `forgepilot run resume <run-id>`, which contract §11 does not use; §11's `run --goal` re-entry worked instead.
* F-10 (observed): `execution plan` accepts a `model` that the Codex login cannot use. Codex with a ChatGPT account rejected `gpt-5-codex` with HTTP 400, visible only as `run-failed` / `RUNTIME_PROTOCOL_ERROR`. On an authorized Goal, `execution plan` with a changed Worker Profile returns `registration-changed`. §11 now states both (step 6 note), and the recovery was the existing human `goal cancel` plus `--attempt` path. That path also exercises issue #95.
* F-11 (observed, security): the Codex Worker is not hermetic. It inherits the human's `~/.codex` hooks and MCP servers, and graft's `post-edit-sync` hook wrote `graft/`, a `.gitignore` addition and a `.ignore` into the fixture. None of these is covered by the authorized `worker_profile` (executable, model, effort, sandbox). Contract §11 does not require an isolated Worker environment.
* F-12 (observed, PraxisBound fixture defect): ForgePilot's Runner runs `make verify` after each Work Item (`VERIFICATION_REFUSED — this revision has no makefile`). The TST-033 fixture had no `Makefile`. It is added in `evidence/build-fixture.mjs`, and was added in the live fixture as commit `ba881dc`. The batch fingerprint was unchanged, because `Makefile` is not a batch source.

## Incidents and Deviations

* The first second-segment run (Goal `…-d45922f0a60f`, `gpt-5-codex`) ended `run-failed` after 3 attempts in 23 s (`obs-segment2.json`, record `-3`). The cause was found by reading the attempts' `session.log` read-only, on carl's instruction, as a deviation from the Story's Out of Scope (`evidence/logs/segment2-codex-failure.txt`). carl chose `gpt-6-astra`, ran `goal cancel`, and the handoff was redone with `--attempt 2`.
* On Goal `-a2`, the second run stopped `AGENT_TIMEOUT` → `run-limit-reached` after the Worker finished WI-005's change within about a minute and then produced no result for 29 minutes. The WI-005 `session.log` was read the same way (`evidence/logs/segment2-a2-wi005-timeout.txt`). It shows no cause after the last successful `exec`, so the stall remains unexplained (F-11 is a candidate, not a proven cause). The third run completed the Goal.
* Codex usage: the paid model call allowed by R4 ran in four `run`s: 23 s, 69 s, about 31 min (of which 30 min was the timeout), and 65 s.

## Residual Risks

* The WI-005 stall is unexplained; a Goal can lose a full agent timeout per stall.
* F-11: the Worker's inherited hooks and MCP servers can write to or act in the workspace outside the authorized profile. This needs a ForgePilot issue (isolated Worker home or declared environment) and a contract decision.
* F-7: the authorized caps may not be what the Runner enforces. This needs a ForgePilot issue. The observations here show the default budget, not the source of the discrepancy.
* The rehearsal used one small fixture on one machine and one Codex login type; R-009's larger end-to-end scenario is still pending.
* The re-pin rests on this rehearsal plus a zero-line `git diff` of the named ForgePilot paths; other ForgePilot changes between the commits (Bootstrap, supervision) were not exercised beyond what is recorded here.
