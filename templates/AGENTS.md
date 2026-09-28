# Repository Agent Guide

## Development Workflow

This repository follows the PraxisBound development protocol.

For implementation work:

1. Read the assigned Story, including its Classification and, when present, its
   Task mode, Authority, Architecture, Risk, security fixture matrix, and
   superseded behavior.
2. Read its acceptance criteria and Acceptance Evidence map. Confirm every AC
   names a method, fixture or precondition, and expected observation before
   implementation; a `human` row remains a required review case.
3. Read `guidance/ENTRY.md` when it exists, then load only the guidance relevant
   to the Story.
4. Inspect relevant existing code.
5. Implement the smallest coherent change.
6. Add or update tests.
7. Run the checks declared by the approved Story and repository policy. The
   default is full `make verify`; focused checks are sufficient only for a valid
   `## Verification Scope` declaration that policy permits.
8. Repair failures until verification passes.
9. When the Story keeps a `verification.md`, record what each check did and
   trace every acceptance criterion to the observation that proves it. Retain
   every skipped, blocked, or unsupported check as a residual risk.

Story intent remains canonical. Specific, approved repository context beats
generic guidance; unresolved conflicts go to Human Review. Guidance is advisory
and never adds hidden acceptance criteria, substitutes for executable checks, or
proves design quality from a passing gate.

## Authority

Perform only the operations the Story grants. An approved execution Story
authorizes implementation. It never authorizes committing, pushing, deploying,
adding a dependency, or running a migration, and a Story whose task mode is
`evidence` authorizes no repository change at all. Being able to perform an
operation is not authorization to perform it.

## Review Preparation

After the required checks pass, prepare Human Review with:

* a Story and acceptance criteria mapping summary
* the acceptance-evidence row used for each criterion
* important design and boundary decisions or architecture impacts
* test and verification evidence
* assumptions, unresolved risks, and suggested attention points

Check Classification truthfulness against the actual trust boundaries and
baseline behavior, including the required conditional evidence. Confirm
verification freshness: the complete PASS must cover the current
implementation and its declared scope. A source, test, configuration, or other
behavior-affecting change after PASS requires the required checks again; when
the full gate is required, run full `make verify` again. A handoff evidence edit
is also a repository change; the human judges whether it affects behavior.

This report supports review without self-approval. Only a human may accept
REVIEW and advance the Story to DONE. If review requests an implementation
change, return to implementation and rerun the required checks before
REVIEW. If feedback changes or exposes missing requirements, move the Story to
SPEC_BLOCKED for human revision and approval instead of changing Story intent.

## Code Quality

* Follow the repository's existing formatter, lint, type, and architecture
  settings.
* Do not disable, bypass, or weaken existing rules merely to obtain PASS.
* Keep new code consistent with neighboring code and the existing architecture.
* Treat `make verify` as the canonical full-repository gate. Focused commands
  provide evidence only for the approved Story scope.
* Leave design judgments that cannot be automated to Human Review.

## Completion

A task is not complete until its required checks pass. By default, and whenever
the Story or repository policy requires the full gate, run:

```sh
make verify
```

successfully. The required verification profile must pass, and every
required acceptance criterion has a passing observation. A skipped, blocked, or
unsupported required check, or an untraced criterion, leaves the work partial.
Partial work is reported as partial.

## Never

* change Story requirements without explicit human instruction
* weaken acceptance criteria to make tests pass
* remove failing tests simply to obtain PASS
* bypass repository verification
* expand scope unnecessarily
* perform an operation the Story does not grant
* state that a check passed without having run it in the current tree
* report partial verification as complete, or drop a residual risk

## Completion Report

Report:

* changed files
* implementation summary
* tests added or changed
* verification result
* assumptions
* remaining risks

When work changes hands, report the result to the human or external control plane
that owns mutable lifecycle state. A repository handoff is optional,
immutable historical evidence only; create one only for a known Story, UTC
time, repository, exact committed revision, command, and observed result. Never
persist current/next/status/Gate/completion state in PraxisBound files or attach
dirty-worktree verification to an unchanged HEAD revision.
