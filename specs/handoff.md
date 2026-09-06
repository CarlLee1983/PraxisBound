# ForgeFlow Handoff

This repository's own handoff, validated by `make verify` through
`scripts/handoff-check`. The block below is authoritative; the prose around it
is context only.

## Lifecycle

```yaml
workflow:
  current_story: FF-224
  next_story: pending
  completed_stories:
    - FF-201
    - FF-202
    - FF-203
    - FF-204
    - FF-205
    - FF-206
    - FF-207
    - FF-208
    - FF-209
    - FF-210
    - FF-211
    - FF-212
    - FF-213
    - FF-214
    - FF-215
    - FF-216
    - FF-217
    - FF-218
    - FF-219
    - FF-220
    - FF-221
    - FF-222
  status: review

baseline:
  repository: CarlLee1983/ForgeFlowV2
  branch: docs/ff-222-release-completion
  commit: 672e69ccb51666fec234cf8dc38511379e05dadf
  dirty_worktree: true
  story_owned_paths:
    - docs/human-review.md
    - docs/agentic-discipline.md
    - specs/handoff.md
    - specs/stories/FF-224-review-evidence-guidance/story.md
    - specs/stories/FF-224-review-evidence-guidance/acceptance.md
  known_unrelated_paths: []

verification:
  last_command: make verify
  result: pass
```

## Notes

* Carl accepted FF-224's delivered documentation and authorized a local commit
  on 2026-09-06. All FF-224 ACs are checked. The Story remains REVIEW until the
  repository merge policy is satisfied; next Story is pending. FF-223's human
  acceptance remains separate. Push, merge, and release are outside this scope.
  The baseline block describes the parent and owned paths prepared for this
  commit, not the worktree state after committing. Complete `make verify`
  passed again before commit (exit 0; `/tmp/forgeflow-ff224-commit-verify.log`).
  The final evidence-only update passed Story/handoff and whitespace checks.

* Carl approved the three documentation additions on 2026-09-06. FF-224 records
  that scope: verification limits, failure detection/recovery, and an optional
  delivery-cost experiment. The starting worktree was clean. FF-223 remains
  awaiting human acceptance; it is not marked complete by this follow-up.
  Next Story remains pending. No protocol/template changes or new tests are
  needed; human-method ACs were initially left for human acceptance.
  Complete `make verify` passed
  with exit 0; log: `/tmp/forgeflow-ff224-verify.log`. Independent review found
  an untracked-file inventory gap in AC-004's evidence command; it was corrected
  before the gate finished. The subsequent Story/handoff evidence-only update
  passed the readiness, handoff, and whitespace checks.

* Carl authorized a local FF-223 commit and requested final acceptance checks
  focused on ForgeFlow on 2026-09-06. Push, merge, release, and live-adopter
  changes remain outside scope. Human-method ACs and repository merge policy
  still require human completion; current Story remains REVIEW, next pending.
  The baseline block records the parent and owned changes prepared for this
  commit, not a claim that its future committed checkout is still dirty.
  Full `make verify` reran with exit 0 before commit; log:
  `/tmp/forgeflow-ff223-commit-verify.log`. AC-009 now records that command result.
  The subsequent evidence-only updates passed Story/handoff and whitespace checks.

* Carl requested the five FF-223 acceptance follow-ups on 2026-09-06: outside
  symlink-target preservation assertions, wrong-type fixtures, accurate marker
  drift documentation, a repository-owned walkthrough builder, and a complete
  final-snapshot C1-C11 rerun. All five are complete. The final startup pointer
  also resolves repository root before diagnosing a missing skill, correcting
  the nested-directory warning found in the first follow-up run. All twelve
  sessions were then rerun against one identical final snapshot; results and
  a non-applied, invalid C8 repair suggestion are recorded in walkthrough-results.md.
  Final `make verify`, local sh/dash portability, and independent Sol/high
  re-review passed. The following evidence-only status updates were checked with
  Story/handoff readers. FF-223 remains REVIEW for human acceptance, next pending.

* Carl approved FF-223 implementation on 2026-09-06 after the specification and
  grilling decisions. Optional Codex activation is implemented as Additive 0.4.1;
  current state is REVIEW awaiting Human Review, next pending.
  The pre-existing handoff and three Story planning files were preserved and
  advanced within that authorization. All dirty paths are attributed above.
  Installer safety and independent Sol/high review passed; fresh CLI observations
  and initial behavior misses are recorded in FF-223 task.md. Final full
  `make verify` and local `/bin/sh` and `/bin/dash` portability passed after the
  relevant implementation/guidance edits. This final status-only update records
  those results; its Story/handoff contracts are checked separately. CLI evidence
  retains host/isolation limitations; human-method ACs await human acceptance.
  That implementation authorization did not include live-adopter changes,
  commits, pushes, or release; the later local-commit authorization is above.

* Carl authorized commit and release on 2026-09-06. The release candidate
  includes FF-222 and the reviewed optional Agentic Discipline documentation.
  Acceptance review found trailing content accepted after the fifth evidence
  column and a test coupled to the live Story. Both are repaired; the new
  regression failed before the parser fix, and independent re-review confirmed
  both findings resolved. Full `make verify` passed after the fixes.
* Carl merged PR #11 at `998c63fd6b530b9b15ced35a4a118b41916c79fa`
  on 2026-09-06 (Asia/Taipei). FF-222 is DONE. The merged SHA passed
  full local `make release-check` before and after annotated-tag creation.
  Exact-SHA workflow 33980677522 passed Linux canonical verification, macOS
  `/bin/sh`, and Ubuntu `/bin/dash` portability.
* v0.4.0 was published on 2026-09-06 (Asia/Taipei):
  https://github.com/CarlLee1983/ForgeFlowV2/releases/tag/v0.4.0.
  Post-publication inspection confirmed remote annotated tag
  `9065cab4a06697ea63a353da966d3807cbf21bb2` peels to that release SHA, and the
  Release is neither draft nor prerelease. These are historical observations.
* The prior two-file documentation follow-up recorded completion after
  publication and did not change the released tag.

* Carl accepted FF-217 through FF-220 and explicitly authorized commit and full
  release on 2026-09-05. Carl then merged PR #9 at
  4d6dc963defde7fb93e08009730f40488284b592; FF-217 through FF-221 are DONE.
* The merged SHA passed full `make release-check` both before and after creating
  the annotated tag. Exact-SHA workflow 33933039270 passed Linux canonical,
  macOS /bin/sh and Ubuntu /bin/dash jobs.
* v0.3.6 was published on 2026-09-05. The annotated remote tag peels to the
  baseline commit and the GitHub Release is neither draft nor prerelease:
  https://github.com/CarlLee1983/ForgeFlowV2/releases/tag/v0.3.6.
  These are historical observations, not substitutes for future remote checks.
* This documentation-only follow-up records completion after publication; it
  does not change the released tag or require another release. Its six owned
  paths update the accepted Story records and handoff through the normal PR flow.

* Authorized sequence: FF-217 Markdown parsing, FF-218 optional readiness,
  FF-219 bootstrap recovery, FF-220 shell portability, FF-221 release preparation.
* The starting worktree was clean; local and GitHub main both resolved to
  9ac8eb3b08ab41733afb96c2d9e6258d0421b370, VERSION 0.3.5. The baseline above
  now records the implementation commit; these paths record its handoff follow-up.
  This accepted release advances VERSION to 0.3.6.

* FF-212 was merged in PR #5 as
  `94e7de17d753d3fd718314d604ccfcd808c95a47`.
* The corrective `v0.3.1` release was published from
  `1096ef5125f1e2d7c304f65d5c7405b76aadf335` after PR #6 merged its release
  preparation. The tag and GitHub Release both resolve to that baseline.
* FF-213 was merged in PR #7 and published as the documentation-only Corrective
  release `v0.3.2` from
  `7bbdf443ead484780e23df9abf055095d4c629e2`.
* The README hero image was added at
  `2e7677d25d3177410a38d446b4f9eebdd0d61d91` after that release.
* FF-214 delivered repository-owned Code Quality Guidance as protocol version
  `0.3.3`, kept `make verify` as the sole canonical gate, and hardened the
  TypeScript example against ESLint warnings.
* FF-215 delivered optional Human Review Guidance and review-return transitions
  through existing lifecycle states as protocol version `0.3.4`. The `v0.3.4`
  tag and GitHub Release were published from
  `8e0eb8c10bbd3d6d4d654de42ff7eee115d8c8a4` after Human Review accepted the
  committed implementation on `main`, so the Story is DONE.
* FF-216 corrects review-integrity and state-consistency guidance as protocol
  version `0.3.5`. Human Review accepted the Story, and PR #8 merged it into
  `main` as `473104a21a535c0739e01b6c47a48fef7ff13ec1`, so it is DONE.
* Release, tag, and CI state is remote and time-sensitive. Query it at decision
  time under `docs/releasing.md`; this handoff is not its long-term source of
  truth.
* Two behavioral narrowings from FF-212 that the callers cannot reach: the
  replaced `grep` predicates matched if any line of a multi-line value matched,
  and `AC-004` listed leading and trailing spaces the parser trims before either
  predicate is called.
* Still open, not selected: ForgeFlow installs no adoption marker for itself, so
  Doctor reports `Adopted version: UNKNOWN` against this repository. That is
  correct today and is recorded only so the gap is not mistaken for a defect.
