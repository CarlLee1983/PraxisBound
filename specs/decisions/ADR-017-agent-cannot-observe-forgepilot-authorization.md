# ADR-017: The Agent cannot observe a ForgePilot authorization before running

* Status: accepted
* Date: 2026-09-24
* Accepted: 2026-09-24 (human review, with TST-034)
* Amends: ADR-016 — "the Agent runs `run` only after observing that authorization in ForgePilot"

## Context

ADR-016 has the Agent stop at `execution plan`, leave `execution authorize` to
the human, and run `run` only after observing the authorization in ForgePilot.
Contract §11 step 8 relied on `run --dry-run` for that observation: "未經授權的
Goal 會在這一步被 ForgePilot 拒絕".

The TST-033 rehearsal against ForgePilot `32b7a68` showed otherwise. An
unauthorized Goal's `run --dry-run` exits 0 and names its first action. No
ForgePilot command exposes the authorization machine-readably: the `execution`
subcommands are plan, authorize, revise, resume, stop, declare, and retention;
`work list --json` carries no authorization field; `status` is human-readable
only. The real `run` does refuse: without a current authorization it fails
with "goal … has no current execution authorization" and exits 1.

## Decision

* The Agent starts the second segment only when the human states in the
  current session that they ran `execution authorize`. That statement is the
  trigger, not proof: no file, record, or Agent memory stands in for it.
* `run --dry-run` stays as a scope and runtime check and is never read as
  evidence of authorization.
* The real `run` is the authorization gate. If the human's statement was
  wrong, ForgePilot refuses with exit 1, reported as `run-failed`.
* Without the human's statement the Agent does not enter the second segment
  and writes no observation for it.

## Consequences

Contract §11 step 8 and its preface are revised (TST-034). An unauthorized
Goal can now reach the real `run` call, which is safe only because ForgePilot
refuses it; if a later ForgePilot starts work on an unauthorized Goal, this
decision no longer holds. A machine-readable authorization query in ForgePilot
would let the Agent observe the authorization as ADR-016 intended; it is a
follow-up request to ForgePilot, not a PraxisBound change.

**Falsified if:** ForgePilot's `run` without `--dry-run` stops refusing a Goal
that has no current execution authorization, or ForgePilot adds a
machine-readable authorization query — then contract §11 step 8 in
`specs/features/batch-review/contract.md` returns to observing the
authorization before `run`, as `specs/decisions/ADR-016-batch-handoff-emits-goal-plan-artifacts.md` decided.
