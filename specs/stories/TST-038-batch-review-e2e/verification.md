# TST-038 Verification

## Acceptance trace

| Criterion | Observation |
| --- | --- |
| AC-001 | `R-009/AC-001` builds an isolated temporary Git repository with two Specs, four dependent Stories and Readiness Sidecars, and runs its `make verify`. Each case removes its fixture. |
| AC-002 | The success case invokes the built `dist/bin.js` for index, render, import, respond, re-render, preflight, readiness-digests, goal-plan and observe, checking JSON outcomes and process exit codes. Confirm uses the existing injected terminal adapter and records a fingerprint-bound confirmation. |
| AC-003 | The success case checks `REVIEW_READY`, all four Goal Plan nodes, and each declared dependency edge. |
| AC-004 | The success case replays TST-035 ForgePilot 3a76aca outputs, explicitly rebinding work-add payloads to four fixture nodes. The fourth work-add copies a recorded output shape and is synthetic; no real four-Story ForgePilot run is claimed. `review observe` accepts the record, and no ForgePilot or model process runs in the test. |
| AC-005 | The success test name includes `R-009/AC-001`; the focused suite passes. The full `make verify` gate remains for integration. |
| AC-006 | Nine independent cases cover stale source, unmapped requirement, external dependency, cycle, missing Semantic Report, stale feedback, unresolved blocker, unauthorized-run evidence and missing earlier preflight. The contract's nonexistent shell test paths now name existing test files. |

## Checks run

| Check | Result |
| --- | --- |
| `./scripts/verification-check specs/stories/TST-038-batch-review-e2e` | `VERIFICATION_PLAN_OK` |
| `pnpm run build` | passed |
| `node --test packages/cli/test/review-batch-e2e.test.mjs` | 10 passed after TST-037 validator integration |
| `pnpm run lint` | passed after final black-box adjustment |
| `pnpm exec prettier --check packages/cli/test/review-batch-e2e*.mjs` | passed after final black-box adjustment |
| `make verify` | pending integration checkpoint |

## Remaining risk

`review observe` validates observation shape and binding but treats ForgePilot stdout and stderr as opaque evidence. The replay proves the review CLI path and four-node mapping; it does not prove ForgePilot executed the new plan. The full gate must pass in the integrated tree before this Story is complete.
