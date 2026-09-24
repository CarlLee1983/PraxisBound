# Verification Result: TST-033

Rehearsal run on 2026-09-24 against ForgePilot
`32b7a68ebf96d74b55acec8f1cd9408f2ba70dab`, PraxisBound main
`167b11fdf08b1f07632ffcd44d2142813b9d0835`. Result: **partial** — AC-001,
AC-002, AC-004, and AC-006 pass; AC-005 fails; AC-003 is blocked. The
blocked and failed criteria are findings about contract §11 and the
environment, not PraxisBound defects hidden behind a pass.

## Checks

* lint: pass — `make verify` (composed gate) exit 0 on this branch; the rehearsal adds no production code.
* static: pass — `make verify` exit 0; `story-check` `STORY_CONTRACT_OK`.
* unit: pass — `make verify` exit 0; no unit test added or changed (evidence-only Story).
* integration: pass for AC-001, AC-002, AC-004, AC-006; fail for AC-005; blocked for AC-003 — see Acceptance Criteria.
* contract: findings recorded — five contract §11 discrepancies with ForgePilot `32b7a68` (see Findings); no contract text changed by this Story.
* e2e: partial — the real ForgePilot binary ran every §11 first-segment step; `execution authorize` and the real `run` are blocked (AC-003).

## Environment

* Evidence paths use `<tst033>` for the session scratch directory and `<HOME>` for the human's home directory (R6); nothing else in the copied outputs was altered.
* ForgePilot: `git archive 32b7a68 | tar -x`, `go build -trimpath` with `go1.25.5 darwin/arm64`; binary sha256 `a143df2b61b61c3a4dce05a8c0623347a0842de6326714a520bf6f0cd546ab60` (`evidence/logs/log-build.txt`).
* Codex CLI on PATH: `codex-cli 0.155.1` (`<HOME>/.local/bin/codex`, a symlink).
* Fixture: `evidence/build-fixture.mjs` — one Spec, Stories FX-001, FX-002 (depends on FX-001), FX-003 (depends on FX-001), each with a Readiness Sidecar; git repository; `forgepilot init` exit 0 (`evidence/logs/log-init.txt`).
* PraxisBound flow before the handoff: `review readiness-digests` rewrote the three Sidecars' digests; `review render`; the human ran `review confirm` in their own terminal (`evidence/records/confirmation-4b4c807c88c2.json`); the Agent wrote `evidence/semantic-report.json`; `review goal-plan` returned `REVIEW_READY` (`evidence/logs/log-goal-plan.json`). The human's first `confirm` attempt wrote nothing (the cause was not captured); the second succeeded.
* Human-supplied values (`evidence/config.json`): Worker Profile `codex` / `<HOME>/.codex/.../0.155.1-aarch64-apple-darwin/bin/codex` / `gpt-5-codex` / `medium` / `workspace-write`; caps 500 / 5 / 20 / 2 / 65536 / 1048576 / 16777216 / 134217728; `expiresAt` `2026-10-01T00:00:00Z`; `engineGeneration` all-zero placeholder — **not a real generation**, because no Bootstrap-managed install exists (see AC-003).

## Acceptance Criteria

* `AC-001`: pass — `evidence/logs/log-build.txt`: commit, Go version, build command, binary sha256.
* `AC-002`: pass — `evidence/observations/obs-segment1.json`, accepted as `records/forgepilot-4b4c807c88c2-1.json`: `preflight` 0 → `work-list` 1 (stderr `unknown goal`) → `goal-create` 0 → per Story `preflight` 0, `work-add` 0 (`WI-001`/`WI-002`/`WI-003`, `created: true`) → `goal-preflight` 0 with `diagnostics: null` → `execution-plan` 0 with `diagnostics: []` and an approval token → `awaiting-authorization`. `work list` afterwards: `WI-002` and `WI-003` `depends_on` `["WI-001"]`, `external_ref` equal to the Story ID. This is the first real `goal preflight` of artifacts produced by `review goal-plan`.
* `AC-003`: blocked — the human ran `execution authorize` twice (`evidence/logs/log-ac003-authorize-by-human.txt`): through a relative path, `process image is not an absolute clean path`; through the absolute path, `ForgePilot process image is outside the managed Bootstrap root`. ForgePilot `32b7a68` authorizes and runs only from a Bootstrap-managed install, which this machine does not have and which ForgePilot's own docs call unsupported. The Agent therefore never entered the second segment and recorded it as `authorization-missing` with no steps (`evidence/observations/obs-ac003-segment2.json`, accepted as `records/forgepilot-4b4c807c88c2-5.json`). `run --dry-run` after authorization and the real `run` were not attempted.
* `AC-004`: pass — `evidence/observations/obs-ac004-retry-2.json`, accepted as `records/forgepilot-4b4c807c88c2-3.json`: `work-list` 0, every `work-add` `created: false` with the same IDs, no duplicate Goal or Work Item, `goal-preflight` `diagnostics: null`, `execution-plan` 0. The first retry (`obs-ac004-retry.json`, accepted as `-2`) stopped with `goal-mismatch` because of Finding F-3; the driver was changed to compare with ForgePilot's actual `GOAL` and re-run.
* `AC-005`: fail — `evidence/observations/obs-ac005-dryrun.json`, `evidence/logs/log-ac005.txt`: on the unauthorized Goal, `run --runtime codex --snapshot --dry-run` exited 0 (`First action: START WI-001`). ForgePilot does not refuse here, contrary to §11 step 8 and this AC. `review observe` rejected the honest record (`awaiting-authorization must end with an exit-0 execution-plan`), so no record was written: §22 has no `stoppedBecause` for "dry-run passed, no authorization yet" (Finding F-2).
* `AC-006`: pass — `evidence/observations/obs-ac006-stale.json`, accepted as `records/forgepilot-4b4c807c88c2-4.json`: after appending a line to FX-003 `story.md`, the first re-check returned `REVIEW_STALE` with `REVIEW_PACKET_FINGERPRINT_MISMATCH` (`records/preflight-a991b80e2cd0-1.json`); the driver stopped with `preflight-not-ready`; `work list` before and after showed the same three Work Items. The two `STORY_AUTHORITY_ENTRY_INVALID` in that run come from the test edit landing inside `## Authority`, not from the product. The edit was reverted with `git checkout`.
* `AC-007`: partial — this file and `evidence/` trace AC-001 to AC-006; `make verify` exit 0; no production code, schema, contract, `VERSION`, `protocol/`, or `templates/` change. Partial because AC-003 is blocked and AC-005 fails.

## Findings (contract §11/§22 versus ForgePilot `32b7a68`)

* F-1 `goal preflight` and `execution plan` exit 0 when validation fails; failures appear only in `diagnostics`. §11 steps 5–6 stop only on a non-zero exit, so a failed validation would pass. The driver checks `diagnostics` is empty (source: ForgePilot `internal/cli/preflight.go`, `internal/cli/execution.go`; not observed failing in this run).
* F-2 `run --dry-run` does not check authorization and exits 0 on an unauthorized Goal (observed, AC-005). §11 step 8's "未經授權的 Goal 會在這一步被 ForgePilot 拒絕" is false, and §22 cannot record the resulting state.
* F-3 `work list` reports `review_policy` as `GOAL`; §11 step 3 requires `goal` (observed, AC-004 first retry).
* F-4 `execution authorize` and the real `run` require a Bootstrap-managed install under `~/.local/share/forgepilot/versions/<commit>/`; `engineGeneration` is that install's generation, printed only by `forgepilot-bootstrap generation-v1 current`. §11 does not mention either, and a source build cannot satisfy them (observed, AC-003). ForgePilot also rejects an executable started through a relative path.
* F-5 The authorized `executablePath` is stored symlink-resolved, while `run` resolves `codex` through `PATH` (`<HOME>/.local/bin/codex`, a symlink, observed in the AC-005 dry-run). A real `run` would need `--runtime-command <resolved path>`, which §11 step 9 omits (source-level; not observed because `run` is blocked).
* F-6 `execution-plan-request/v2` constraints §11 step 6 does not state: `runtime` only `codex`, `effort` only `medium`, `sandbox` only `workspace-write`, `expiresAt` at most 14 days ahead in RFC 3339 without trailing fractional zeros, caps `maxWriteBytes ≤ maxRunBytes ≤ maxTotalBytes` (source-level; the request built from them was accepted).

Proposed follow-up: one contract §11/§22 amendment Story covering F-1, F-2, F-3, F-5, F-6 (with the matching `review observe` rule change for F-2), and a separate decision on F-4 — either wait for ForgePilot to support Bootstrap installs or accept a rehearsal that stops at `execution plan` as sufficient for the 0.4.0 release.

## Incidents

* One inspection command (`forgepilot work list`, after AC-004's first retry) ran with the working directory at this repository instead of the fixture, so ForgePilot read this repository's own `.forgepilot` state. It refused to run (`state uses schema version 12; run forgepilot migrate to upgrade it to 18`) and wrote nothing: no file under `.forgepilot` was newer than the rehearsal start. This breaches R7 (no ForgePilot state outside the fixture is read); every later ForgePilot command ran from the fixture.
* `review render --output` outside the fixture repository was refused with `REVIEW_OUTPUT_CONFLICT`, as designed; the page was rendered inside the fixture and excluded from git.

## Residual Risks

* The second segment (`run --dry-run` after authorization, the real Codex `run`, and its exit mapping) has never run against ForgePilot; R-008 AC-005 and AC-007 remain unproven end to end.
* `engineGeneration` was a placeholder, so the approval token in the evidence corresponds to no real install.
* F-1 and F-5 are read from ForgePilot source, not observed.
* The fixture is small (one Spec, three Stories); R-009's larger scenario is still pending.
