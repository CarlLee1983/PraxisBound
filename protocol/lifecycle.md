# Story Lifecycle

PraxisBound uses lifecycle states and transitions as shared protocol vocabulary.
They define what state names mean, but they are not persisted PraxisBound repository state.
A repository does not synchronize a current status in a
Story, acceptance file, task note, or handoff, and it does not need a workflow
engine, state database, or agent orchestrator. The current protocol version is
recorded in [`VERSION`](../VERSION).

When an external control plane is present, it is authoritative for current
work, lifecycle state, blockers or Gates, next action, review state,
verification-current state, and completion state. ForgePilot is one example;
PraxisBound neither depends on nor detects a control plane.

```text
DRAFT → READY → IMPLEMENTING → VERIFYING → REVIEW → DONE
                    ↑              │
                    └──── FAIL ────┘
                    ↑                         │
                    └── CHANGES REQUESTED ────┘

IMPLEMENTING ─┐
              ├→ SPEC_BLOCKED → READY
REVIEW ────────┘
```

## States

| State | Meaning | Exit condition |
| --- | --- | --- |
| DRAFT | Human intent is still being written or discussed. | Goal, scope, rules, and acceptance criteria are approved. |
| READY | The Story is approved and implementable. | An agent or engineer begins the bounded change. |
| IMPLEMENTING | Code, tests, and related repository artifacts are changing. | The implementation is ready for canonical verification, or a specification blocker is proven. |
| VERIFYING | The repository is executing the Story's required full or focused checks. | PASS advances to REVIEW; FAIL returns to IMPLEMENTING. |
| REVIEW | Automated verification passed and a human reviews product intent, design, and architecture. | The human accepts the work, requests implementation changes, or identifies a specification blocker. |
| DONE | Human review is complete and the repository's merge policy has been satisfied. | Terminal for this Story. |
| SPEC_BLOCKED | A missing or conflicting human decision prevents safe implementation. | The human resolves the blocker and approves the revised Story as READY. |

## Required transitions

- **DRAFT → READY** — a human approves the Story and acceptance criteria.
- **READY → IMPLEMENTING** — implementation begins.
- **IMPLEMENTING → VERIFYING** — the coherent change and tests are ready for the
  canonical gate.
- **VERIFYING → IMPLEMENTING** — a required check fails; diagnose and
  repair without weakening requirements.
- **VERIFYING → REVIEW** — the required checks pass.
- **REVIEW → DONE** — only a human may accept the verified work, after the
  repository merge policy is satisfied.
- **REVIEW → IMPLEMENTING** — Human Review requests an implementation, test,
  readability, or architecture change. The changed work must run the required
  checks again before a new PASS returns it to REVIEW.
- **REVIEW → SPEC_BLOCKED** — Human Review identifies a missing or conflicting
  product, policy, or architecture decision.
- **IMPLEMENTING → SPEC_BLOCKED** — a genuine intent decision is required.
- **SPEC_BLOCKED → READY** — the human resolves and approves the specification.

Verification failure alone is not a specification blocker. It remains part of
the implementation repair loop. These review outcomes do not change existing
PASS, FAIL, or Repair Loop semantics. See [Human Review](../docs/human-review.md)
for the contextual review dimensions and authority boundary.

## Completion is evidence, not a green command

`VERIFYING → REVIEW` requires more than a zero exit status. The Story advances
when the required verification passed and every required acceptance criterion
has passing evidence recorded against it. A required check that was skipped,
blocked, or unsupported, or a criterion with no observation, leaves the work
partial: it returns to IMPLEMENTING, or to SPEC_BLOCKED when the gap is a
missing human decision. This adds no state and changes no transition; it states
what passing required verification has to mean before REVIEW begins. See
[Completion](verification.md#completion).

## Handing work over

When historical execution context is useful, a handoff may preserve one
point-in-time observation anchored to a Story, time, repository revision, and
verification result. It does not persist or imply the current lifecycle state.
See the [Handoff Evidence Contract](handoff.md).
