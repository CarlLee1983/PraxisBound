# Story: FF-229 Scope verification to the approved change

## Goal

An adopting repository can verify a bounded change with checks that exercise its
changed surface, while a Story or repository integration policy can still require
the full `make verify` gate. The result states exactly what ran and what did not.

## Context

GitHub #102 identifies that the portable workflow currently requires the full
repository gate even for documentation-only work. This makes unrelated Go,
release, and build checks a prerequisite for editing Markdown or HTML in an
adopting repository. The existing `scripts/verification-check --result` also
requires the low-risk `lint`, `static`, and `unit` layers, so guidance alone
cannot make a documentation check a complete recorded result.

## Classification

* Security sensitive: no
* Baseline conformance: yes
* Task mode: mixed

## Superseded Behavior

* `protocol/verification.md`, `protocol/story.md`, `protocol/lifecycle.md`, and
  `templates/AGENTS.md` require full `make verify` for every implementation
  change. This Story retains that default but allows an approved, explicit
  focused scope where repository policy permits it.
* `tests/review-integrity.sh` and `tests/human-review.sh` pin blanket full-gate
  language. Replace those assertions with scope-aware review and freshness
  behavior without weakening a required full gate.

## Authority

* plan: yes
* modify: yes
* add_dependency: no
* migration: no
* commit: yes
* push: no
* deploy: no

## Architecture

* Impact: high
* Decision: `ADR-019`
* Contract: `make verify remains the canonical full-repository gate and its exit semantics do not change`
* Contract: `a Story declaration may narrow verification only when repository policy permits it`
* Contract: `old Stories and result records retain their existing verification verdicts`
* Boundary: `Story`
* Boundary: `Verification`
* Owner: `Story = protocol/story.md`
* Owner: `Verification = protocol/verification.md`

## Risk

* Level: high
* Reason: `public-contract`
* Reason: `versioned-surface`

## Scope

### In Scope

* Add an optional `## Verification Scope` section to `story.md`, defaulting to
  full. `Scope: focused` also declares `Surface: executable` or
  `Surface: documentation` and one exact backticked command per required check
  layer, using `* lint: \`command\`` style bullets. Missing or invalid
  declarations never silently narrow the gate.
* For focused executable work, preserve all verification layers required by
  risk and architecture, using the declared commands that exercise the changed
  behavior. For low-risk, low-architecture-impact documentation-only work,
  require one declared `documentation` validation command and acceptance
  evidence instead of unrelated `lint`, `static`, and `unit` layers. Higher-risk
  or higher-impact documentation work requires full verification.
* An explicit `Scope: full` adds an exact `make verify` result obligation.
  Focused results record the full gate as `skipped` with a reason and residual
  risk, or as `pass` if it actually ran. Absent declarations preserve the
  legacy result verdicts.
* Resolve the declaration and judge the recorded result in the existing
  read-only Story and verification checkers. Keep their command forms and result
  names; report skipped, blocked, unsupported, absent, or failed required checks
  honestly.
* Update the portable workflow, distributed templates, human-review guidance,
  and versioning record. A Story's `Scope: full` (or absent section) requires
  the full gate. Repository policy may additionally require it at integration,
  release, or on specified surfaces; the static checker does not know the
  current phase or a repository's policy, so Human Review checks that focused
  scope did not override such a requirement.
* Record the new surface-derived documentation profile in ADR-019, refining
  ADR-001's risk-and-architecture profile rule while retaining its default.
* Run this repository's full `make verify` after implementation, because this
  Story changes its protocol and templates under the current repository policy.

### Out of Scope

* Changing the command or PASS/FAIL semantics of `make verify`, Doctor's
  `--run-verify`, CI's configured gate, or the behavior of existing Stories.
* Automatically detecting changed files, classifying documentation versus
  executable content, inferring that a command ran, or proving design quality.
* Adding a new test runner, dependency, migration, or release tag.

## Inputs

* GitHub #102, `story.md`, `acceptance.md`, repository policy, and recorded
  `verification.md` observations.

## Outputs

* A resolved full or focused verification obligation, with a truthful result
  and acceptance trace.
* Updated protocol, templates, documentation, tests, and version classification.

## Rules

* R1: Absence of the new declaration preserves full `make verify` and every
  existing Story/result verdict. Invalid or ambiguous declarations fail closed.
* R2: A Story's explicit full requirement and any repository full-gate policy
  prevail over generic focused-work guidance. The checker enforces a Story's
  declaration; Human Review enforces repository policy and phase requirements.
  Focused work never turns an unrun required full gate into PASS.
* R3: Focused executable checks exercise the changed behavior and retain every
  risk/architecture layer. A focused documentation Story is eligible only when
  risk and architecture impact are both low; its declared command validates
  the actual edited documents. Each mode traces every acceptance criterion.
* R4: `verification.md` names each command and status; skipped, blocked,
  unsupported, failed, and unexecuted obligations stay visible. Human Review
  decides whether surface classification and evidence are truthful.
* R5: This Story is Additive under `protocol/versioning.md`: prior adoption and
  verification results remain valid without edits. Rollback removes the opt-in
  declaration and focused records, then runs full `make verify`.

## Expected Errors

* An invalid focused declaration or result is incomplete; no PASS is inferred.
* A missing required focused check or full gate produces a partial result; a
  failed check remains failed.
* A focused declaration that conflicts with repository policy is a Human Review
  blocker even when the static checker reports a complete record.

## Dependencies

* GitHub #102. No new package dependency.

## Constraints

* `scripts/` remains portable POSIX shell and read-only for checks.
* Existing `make verify`, Doctor, Story, and verification command forms and
  result names remain stable.
