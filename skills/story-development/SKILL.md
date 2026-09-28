---
name: story-development
description: Implement an approved PraxisBound Story when a request names a Story ID or asks to build work from specs/stories, including tests, verification, repair, and delivery reporting.
---

# Story Development

Treat the approved Story as the intent boundary and repository verification as
the deterministic evidence authority. Current completion state belongs to the
human or external control plane.

## Develop the Story

1. Locate `specs/stories/<story-id>/story.md` and
   `acceptance.md`. Read any optional `task.md` as progress
   context only. If the Story is missing, ambiguous, or conflicts with another
   requirement, identify the exact blocker before changing code.
2. Extract the Goal, in-scope behavior, out-of-scope boundary, inputs, outputs,
   business rules, expected errors, constraints, and every acceptance item. The
   implementation contract is complete when each acceptance item maps through
   its Acceptance Evidence row to an observable behavior or verification check,
   fixture or precondition, and expected observation. When the Story is security
   sensitive, treat every row of its security fixture matrix as a required case
   with an exact payload and expected persisted output; when it declares
   superseded behavior, change the named tests deliberately instead of treating
   the conflict as a defect.
3. Read `guidance/ENTRY.md` when it exists, then load only the guidance relevant
   to the Story. Guidance is advisory: the approved Story remains canonical,
   specific approved context beats generic guidance, and a real conflict goes to
   Human Review rather than an invented resolution.
4. Resolve the Story's execution contract with
   `./scripts/verification-check specs/stories/<story-id>`. Perform only the
   operations its authority grants: an approved execution Story authorizes
   implementation, never committing, pushing, deploying, adding a dependency, or
   running a migration, and an `evidence` Story authorizes no repository change
   at all. Treat the declared architecture decisions and contracts as
   constraints, and let the declared risk raise inspection and verification
   depth without widening scope.
5. Read the repository agent guide and inspect the relevant architecture, code,
   tests, dependencies, and documented commands. Project tooling is the source
   of truth for technology-specific mechanics.
6. Form a dependency-ordered implementation plan for the smallest coherent
   end-to-end change. Keep requirement decisions with the human; ask only when a
   missing decision materially changes behavior or risk.
7. Implement within the Story boundary. Add or update tests at the lowest useful
   boundary for changed behavior, including stable regression coverage for
   repaired defects.
8. Run the approved Story's required checks. The default and any repository
   full-gate boundary require `make verify` from the repository root; a valid
   focused scope may name exact commands for a bounded change when policy
   permits. Record a full gate that was intentionally not run as unrun, never
   as PASS.
9. When the Story keeps a `verification.md`, record what each check did, trace
   every acceptance criterion to the observation that proves it, and retain
   every skipped, blocked, or unsupported check as a residual risk. Confirm the
   record with
   `./scripts/verification-check --result specs/stories/<story-id>`.

## Review Preparation

After PASS, assemble:

- a Story and acceptance criteria mapping summary;
- the Acceptance Evidence row used for each criterion;
- important design and boundary decisions or architecture impacts;
- test and verification evidence;
- assumptions, unresolved risks, and suggested attention points.

Check Classification truthfulness against the actual trust boundaries and
baseline behavior, including the required conditional evidence. Confirm
verification freshness: the complete PASS must cover the implementation under
review. A source, test, configuration, or other behavior-affecting change after
PASS requires the required checks again, including full `make verify` when
required.

This report supports review without self-approval. Only a human may accept
REVIEW and advance the Story to DONE. When review requests implementation
changes, return to implementation and rerun the required checks before
REVIEW. When feedback changes or exposes missing requirements, enter
SPEC_BLOCKED so a human can revise and reapprove the Story instead of changing
its intent during review.

## Repair Verification Failures

When verification fails, use its output to find the root cause, repair the
implementation or valid test defect, and run `make verify` again.
Preserve the approved Story, acceptance criteria, and required checks throughout
the loop.

Stop only when:

- the required checks exit successfully; or
- a genuine specification blocker requires human intent before safe progress is
  possible.

Verification failure by itself is not a specification blocker.

## Deliver

After PASS, report:

- changed files
- implementation summary
- tests added or changed
- the exact verification command and result
- assumptions
- remaining risks

When the work changes hands, report the result to the human or external control
plane that owns mutable lifecycle state. A PraxisBound handoff is optional,
immutable historical evidence only. Create one only when a known Story, UTC
time, repository, exact committed revision, command, and observed result can be
recorded truthfully. Never infer or persist current/next/status/Gate/completion
state in PraxisBound files, and never bind dirty-worktree verification to the
unchanged HEAD SHA.

If specification-blocked, report the conflicting or missing requirement,
evidence already inspected, and the smallest human decision needed. Do not
claim completion.
