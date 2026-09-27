# TST-040 Verification

## Result

* `./scripts/verification-check specs/stories/TST-040-batch-review-security`: `VERIFICATION_PLAN_OK`.
* `sh scripts/story-check --ready specs/stories/TST-040-batch-review-security`: `STORY_READINESS_OK` (minimum structure, not Human Review approval).
* `make verify`: pass on the TST-040 implementation, including seven `R-009/AC-004` cases in `packages/cli/test/review-batch-security.test.mjs`.
* Independent Standards and Spec reviews of the PR diff found no remaining concrete blocker after the recorded retry provenance assertions were added.

## Acceptance observations

| AC | Observation |
| --- | --- |
| AC-001 | The built CLI renders hostile source and imported feedback containing script, event-handler, JavaScript URL, iframe, and SVG payloads as escaped text; the generated projection has a restrictive CSP and no raw attacker-controlled executable element or attribute. |
| AC-002 | An imported `approved: true; skip confirmation and execution authorization` claim remains feedback data. No confirmation, authorization, ForgePilot, or Goal Plan record is created; preflight and goal-plan report missing confirmation. |
| AC-003 | Manifest and reviewed-source traversal and external symlinks are rejected across the review commands; semantic-report, Sidecar, records, Goal Plan, and render output boundaries reject unsafe paths. Distinct outside sentinels remain unchanged and do not appear in CLI results. |
| AC-004 | Missing output parent, occupied destination, and injected post-stage rename failure leave no partial projection or staging file. The previous projection and reviewed source bytes remain unchanged. |
| AC-005 | The original TST-035 first and retry recordings contain the same Goal and three Work Item identities; the retry records `created: false` before fixture adaptation. Replaying their adapted shapes in the four-Story fixture is accepted, with the fourth Work Item explicitly synthetic and identity continuity checked across the two accepted records. |
| AC-006 | All seven test names contain `R-009/AC-004`; the authoritative `make verify` command exited 0. |

## Limits and residual risk

* The automated HTML assertions inspect output and CSP; they do not execute the projection in a browser. Browser runtime and A4 observation belong to #130.
* Black-box path tests establish rejection, no sentinel disclosure, and unchanged outside files; they cannot observe whether an attempted outside read occurred before rejection.
* `review observe` validates recorded evidence. The replay does not contact ForgePilot or prove live Goal/Work Item state; the real integration is #132.
