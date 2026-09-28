# Verification Result: TST-041

The isolated rehearsal met AC-001 through AC-006. ForgePilot technical completion occurred; Human Review acceptance has not occurred. The human authorized a Corrective clarification of §11's JSON-command contradiction, and the final repository gate passed on the amended tree. Raw live records remain in the temporary fixture; `evidence/accepted-step-ledger.json` retains their ordered, sanitized steps and hashes, and `evidence/live-rehearsal.md` explains the results.

## Checks

* static: pass — `./scripts/verification-check specs/stories/TST-041-batch-review-live-rehearsal` returned `VERIFICATION_PLAN_OK`; `./scripts/story-check --ready specs/stories/TST-041-batch-review-live-rehearsal` returned `STORY_READINESS_OK` on the current draft.
* fixture: pass after implementation — the initial isolated `make verify` exited 0 with three pending/skipped acceptance cases, and the initial strict `make verify-final` exited 2 with five expected missing-output failures. After the real Runner run, `make verify` exited 0 with six pass/zero skipped, and `make verify-final` exited 0 with eight pass/zero skipped. Worker-authored tests were independently inspected against all requested examples; `git diff --check` exited 0.
* render: pass — `review readiness-digests`, `review render`, and `review index` exited 0 on the two-Spec, four-Story fixture; two unrecognized Spec-title advisories remain nonblocking.
* repository gate: pass — `make verify` exited 0 at preparation, during the authorized live run, and after the Corrective contract/workflow edits on the final source tree, including TypeScript, shell, release, and acceptance gates.
* live integration: pass — the human ran `review confirm` in their own terminal; the fixture contains `records/confirmation-ffad64ff3208.json` with claim `explicit-terminal-confirmation`, matching fingerprint `ffad64ff3208f284a4316456a71d7a5099abf31dcf2c584e29284153fac47321`, manifest digest `957077166387847c6de212a95356de919e2eecc5583bbfde453c36e30f0b8a63`, and `confirmedAt=2026-09-28T03:47:22.062Z`. The human selected TST-035's `gpt-6-astra` profile and caps `500,5,20,2,65536,1048576,16777216,134217728`, then explicitly approved `expiresAt=2026-10-05T00:00:00Z`, `--by Carl`, and the inspected Codex executable path. The human later stated in the current session that they had executed `execution authorize`; the real run succeeded.
* semantic and plan: pass — after reading both Specs and all four Stories/acceptance files, the Agent wrote `specs/batches/BR-941-live/semantic-report.json` in the fixture with four complete, all-`none` conclusions. `review index` retained the same fingerprint; `review preflight --expect-fingerprint` and `review goal-plan` each exited 0 with `REVIEW_READY`. The two Spec-title advisories remain nonblocking. Goal Plan directory: `specs/batches/BR-941-live/goal-plan/BR-941-live-ffad64ff3208/`; manifest SHA-256 `609b9b2fb493034634cdf790f19a88346ddc636359ecae26ab32977dbfd4975a`.
* ForgePilot first segment: pass — managed generation `3a76acaa5da206bef9a8d15df0db3f08f90311e2` initialized the fixture. The script recorded preflight exit 0 before Goal creation, each of four Work Item additions, and the two request writes; each manifest digest recheck matched. `work-list` exit 1 led to `goal-create` exit 0; `work-add` created FX-001/WI-001, FX-003/WI-002, FX-002/WI-003, FX-004/WI-004. `goal-preflight` exited 0 with top-level `diagnostics: null`; `execution-plan` exited 0 with top-level `diagnostics: []`. `review observe` accepted `records/forgepilot-ffad64ff3208-1.json` (SHA-256 `4973d401e419702b1dc6bb05076d4aa98ba8d2c5c8a4d8b5a126ba9138888989`) with `stoppedBecause=awaiting-authorization`. Its preview binds request SHA-256 `sha256:0552645805d40adc0f1eca98f262647f185782283f97c091a581f46fe212bbef`, the human's profile/caps/expiry, and Codex executable SHA-256 `27ceb5f9b957b43a519efe4eaa3816a0bffb0a531a2c89af18840c0a3c016a7d`.
* ForgePilot second segment: pass — preflight and manifest digest rechecks succeeded before dry run and real run. `run --dry-run` exit 0; real run exit 0 with `GOAL_COMPLETED`, and `review observe` accepted `records/forgepilot-ffad64ff3208-2.json` (SHA-256 `dd6e478c0c383c0ed4ecc62b2b888062510336128c0a25d2f1c86cee07cd799f`) as `goal-completed`. Public `work list --goal ... --json` returned four `VERIFIED` Work Items and `COMPLETED` Goal. Details and EV/GC identifiers are in `evidence/live-rehearsal.md`.
* contract: Corrective documentation change authorized by the human — §11 and `docs/batch-review/agent-workflow.md` now identify `run-dry-run`/`run` as the pinned CLI's only JSON-flag exceptions, map their exit without parsing prose, and permit separate `run status --json` corroboration. The pinned CLI's `run --dry-run --json` exited 1 with `--json requires a value`, confirming the incompatibility. Public `run status <run-id> --json` returned `GOAL_COMPLETED`, exit 0, and one attempt per Work Item; it was not inserted into the immutable observation or used as authorization. Classified Corrective in §14 and this Story under `protocol/versioning.md`; no schema, production code, Protocol, template, or `VERSION` change.
* review-page opening: blocked in the agent-controlled browser by its explicit local-file URL policy. The human was given the direct fixture-v2 path for local opening; this does not substitute for Definition Confirmation.
* Worker environment disclosure: delivered to the human at 2026-09-28 03:42 UTC with inspected MCP names, hook event names and executable paths, and global/workspace configuration presence only; no credentials, URLs, hook arguments, or environment values were copied into this record.
* unsupported probes: `forgepilot --version` exited 1 (`unknown command "--version"`), so provenance uses the Bootstrap generation and binary digest. After the real run, read-only `run --dry-run --json` and `run --dry-run --json=true` each exited 1 (`--json requires a value`); this established the contract correction's narrow CLI exception. Neither probe was counted as a required rehearsal PASS.

### Initial fixture cases retained individually

An additional fresh fixture from the same `build-fixture.mjs` bytes reproduced the pre-implementation results without touching the live Goal. Its `make verify` exited 0 with these three skips and no passes:

| Case | Initial result |
| --- | --- |
| `greet public examples: Story FX-001 pending` | skipped |
| `farewell public example: Story FX-003 pending` | skipped |
| `usage examples: Story FX-004 pending` | skipped |

Its `make verify-final` exited 2 with these five failures, zero passes and zero skips:

| Case | Initial result |
| --- | --- |
| `greet public examples: Story FX-001 pending` | failed: required Story output missing |
| `FX-002 has its own executable tests` | failed: `test/greet.test.js` absent |
| `farewell public example: Story FX-003 pending` | failed: required Story output missing |
| `FX-003 has its own executable test` | failed: `test/farewell.test.js` absent |
| `usage examples: Story FX-004 pending` | failed: required Story output missing |

After the live run, the original fixture's `make verify` and `make verify-final` passed with zero skips as recorded above. The accepted observations' exact ordered argument vectors, exits, output digests, work-item mappings and preflight outcomes are in `evidence/accepted-step-ledger.json`. A post-run read-only comparison matched both accepted-record SHA-256 values and all 19 ordered steps and output digests against the raw live fixture records. The driver sources whose SHA-256 values are in the ledger performed manifest digest checks before advancing from each preflight to the following write or run step.

## Acceptance evidence

* `AC-001`: pass — fixture, Sidecars, initial gate, render, human confirmation, Semantic Report, preflight, and Goal Plan were observed as above.
* `AC-002`: pass — names-only Worker environment disclosure, the preview, and the single-use approval token were delivered before authorization. The human ran terminal confirmation and stated they had run `execution authorize`; the Agent ran neither command nor `goal cancel`. The token is not copied into this repository record.
* `AC-003`: pass — both ForgePilot segments were accepted by `review observe`, with the pre-write rechecks listed above. The human-authorized Corrective clarification matches the pinned CLI's specific run commands.
* `AC-004`: pass — the Runner independently started and verified all four Work Items without per-Story human confirmation; the final fixture gates passed with zero skipped tests. Independent inspection found Ada/Lin assertions in both Worker-authored test files and both call/output examples in README. `evidence/live-rehearsal.md` records the EV/GC evidence.
* `AC-005`: pass — exact versions and login method are in `evidence/provenance.md`. Preflight `REVIEW_READY`, ForgePilot technical `GOAL_COMPLETED`, final fixture acceptance PASS, and Human Review acceptance not performed are kept separate.
* `AC-006`: pass — this record retains all initially skipped/failed, blocked, and unsupported checks; the human-authorized Corrective §11 change is classified, and repository `make verify` exited 0 on the amended tree. ForgePilot#65 recurred (approved 500 steps/5 attempts versus displayed 100 steps/3 attempts); ForgePilot#66 did not recur.

## Authority and status

The Agent has not run `review confirm`, `execution authorize`, or `goal cancel`. The human authorized one paid Codex Worker run, which technically completed the Goal. Human Review acceptance has not occurred; no merge, deployment, PraxisBound commit, or push occurred. GitHub #131 remains open even though its guide is committed locally at `d8ae521`.

## Residual risks

* ForgePilot#65 recurred: the approved 500-step/5-attempt caps differed from the Runner's displayed 100-step/3-attempt budget. Because every Work Item completed on attempt 1, this rehearsal cannot establish which cap would be enforced at the threshold. ForgePilot#66 did not recur; its stall cause remains unresolved outside this run.
* The pinned ForgePilot `run` does not support JSON output, so the Corrective contract now relies on exit mapping and preserves stdout/stderr as data. A future ForgePilot version with structured `run` output should be evaluated before changing this rule; rollback is to revert the two documentation edits while preserving live observations.
* The Codex Worker inherited global hooks and MCP servers. The fixture gained `.gitignore` and `.ignore` consistent with the previously observed graft hook side effect; these extra files were not committed.
* The fixture's initial three skipped acceptance cases and five strict-gate failures are pre-implementation observations. Final fixture gates passed with zero skips. The agent-controlled browser could not open the local review page; the human used their own terminal to confirm.
