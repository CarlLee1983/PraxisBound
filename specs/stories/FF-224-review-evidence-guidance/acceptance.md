# Acceptance Criteria

## Guidance

* [x] AC-001: Human Review explains explicit untested cases, reasons, impact, and follow-up without waiving required behavior.
* [x] AC-002: Human Review includes detection, stop conditions, recovery, recovery verification, and justified non-applicability in a concrete example.
* [x] AC-003: Optional measurement covers elapsed delivery time, human effort, review rounds, rework, verification, and a defined post-delivery observation window without claiming causal improvement.
* [x] AC-004: Guidance reuses existing artifacts and preserves protocol, templates, checker behavior, and human approval authority.
* [x] AC-005: Complete make verify passes on the changed repository.

## Acceptance Evidence

| AC | Method | Evidence | Fixture / precondition | Expected observation |
| --- | --- | --- | --- | --- |
| `AC-001` | human | `docs/human-review.md` | `verification-limits guidance and CSV example` | `reviewer confirms reasons, impact, and unresolved required behavior are explicit` |
| `AC-002` | human | `docs/human-review.md` | `failure-recovery guidance and CSV example` | `reviewer confirms detection, stopping, recovery evidence, and non-applicability guidance` |
| `AC-003` | human | `docs/agentic-discipline.md` | `optional delivery-cost experiment` | `reviewer confirms measurement boundaries, review and rework costs, and inference limits` |
| `AC-004` | human | `git diff 672e69ccb51666fec234cf8dc38511379e05dadf; git status --short; cat specs/stories/FF-224-review-evidence-guidance/*.md` | `FF-224 changes against baseline 672e69ccb51666fec234cf8dc38511379e05dadf` | `reviewer confirms only guidance and Story/handoff records changed` |
| `AC-005` | command | `make verify` | `repository with locked example dependencies` | `exit 0` |

## Verification Notes

Carl accepted AC-001 through AC-004 and authorized the local commit on
2026-09-06 after reviewing the delivery summary. This records human acceptance,
not independent agent approval. No new automated tests are needed
for these documentation-only additions; run the existing canonical gate.

On 2026-09-06, complete `make verify` exited 0 (log:
`/tmp/forgeflow-ff224-verify.log`). Independent agent review found AC-004 omitted
untracked-file inventory; its evidence command now includes status and Story
file inspection. Final Story/handoff evidence-only edits were checked with
`./scripts/story-check --ready specs/stories/FF-224-review-evidence-guidance`,
`./scripts/handoff-check`, and `git diff --check`. Those checks prepared the
evidence for the subsequent human acceptance above.
