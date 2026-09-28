# Execution Contract

The Story Contract says what a change must achieve. This contract says what kind
of work it is, what the implementing agent is allowed to do, how much risk it
carries, and which invariants hold while it is implemented.

Every declaration here is optional. A Story that declares none of them resolves
to the documented defaults, so a Story written against an earlier snapshot keeps
the verdict it already had.

## Task mode

A Story may declare one task mode in `## Classification`:

```markdown
* Task mode: execution
```

| Mode | Meaning |
| --- | --- |
| `architecture` | A boundary, ownership, contract, dependency, state-authority, migration, recovery, or retirement decision is the deliverable. |
| `execution` | Requirements and architecture are settled and the repository is being changed. |
| `evidence` | Inspection, review, or diagnosis only. The repository must not change. |
| `mixed` | The Story contains both a decision and the change that follows it. |

The default is `execution`, because that is what an approved PraxisBound Story has
always meant.

A review task is not a fix task. `evidence` never authorizes repository
mutation, whatever the agent is technically able to do.

## Authority

Authority is what the Story permits, declared in an optional `## Authority`
section as `yes` or `no`:

```markdown
## Authority

* plan: yes
* modify: yes
* add_dependency: no
* migration: no
* commit: no
* push: no
* deploy: no
```

The operations are separate grants, and one never implies the next:

```text
review != fix
plan != implement
implement != commit
commit != push
push != deploy
```

`scripts/story-check` rejects a Story that grants `deploy` without `push`,
`push` without `commit`, or `commit` without `modify`, and rejects an `evidence`
Story that grants any mutating operation.

### Defaults

An undeclared operation takes the default for the task mode. An `execution` or
`mixed` Story defaults to `plan: yes` and `modify: yes`, because entering
implementation is exactly what approving such a Story already authorized. An
`architecture` or `evidence` Story defaults to `plan: yes` and `modify: no`.

Every other operation defaults to `no` in every mode. Being able to commit,
push, deploy, add a dependency, or run a migration is never authorization to do
it, and a legacy Story that predates this contract grants none of them.

A Story may declare a subset; undeclared operations keep the default.

## Risk

A Story may declare its risk in an optional `## Risk` section:

```markdown
## Risk

* Level: high
* Reason: `payment`
* Reason: `external-api`
* Signal: `error-projection`
```

`Level` is `low`, `medium`, or `high` and defaults to `low`. A `medium` or
`high` level names at least one reason. These signals are recognized as
high-risk, and a Story naming one may not file it below `high`:

`authentication`, `authorization`, `security`, `payment`, `payments`,
`schema-migration`, `data-loss`, `public-contract`, `concurrency`,
`production-config`, `dependency-supply-chain`, `destructive-operation`.

Risk raises inspection depth, verification depth, and the evidence a Story owes.
It never widens implementation scope: a high-risk Story implements the same
smallest coherent change, and proves more about it.

Risk selects the [verification profile](verification.md#verification-profiles).

A Story may also declare any of these standard engineering-risk Signals, each
at most once: `error-projection`, `concurrency`, `bounded-capacity`, and
`retention-overflow`.

Signals are independent of `Level` and `Reason`: they do not select or raise a
verification profile. Instead, each Signal activates the corresponding
[risk-driven readiness contract](story.md#risk-driven-readiness-contracts).
The checker validates only explicitly declared Signals. It never infers one
from words such as “queue”, “parallel”, or “database”.

## Verification scope

The optional `## Verification Scope` section selects how the Story's required
checks are run. With no section, full verification applies and the repository
must run complete `make verify`. An explicit `Scope: full` additionally requires
a `full` result entry with status `pass` and command `make verify`, so new full declarations cannot
be satisfied by focused layer results alone. Older records keep their verdicts.

```markdown
## Verification Scope

* Scope: focused
* Surface: executable
* lint: `make lint-changed`
* static: `make static-changed`
* unit: `make unit-changed`
```

`Scope: focused` requires exactly one `Surface`: `executable` or
`documentation`, and one exact backticked command for every required layer.
For executable work, [risk and architecture](verification.md#verification-profiles)
still select those layers. A low-risk, low-architecture-impact documentation-only
Story instead declares `documentation` with one exact backticked command. Other documentation
work requires the full gate. Unknown, duplicate, missing, or extra checks make
the declaration incomplete. The checker matches a passing result's command to
the Story's declared command; it does not execute it.

A focused result records `full: skipped` with an exact reason and a residual
risk when the full gate was intentionally not run, or `full: pass` with command
`make verify` when it was run. Omitting this observation leaves the result partial.
A Story or acceptance requirement for the full gate cannot be narrowed by a
generic focused-work guideline. A repository may also require complete
`make verify` at integration, release, or for a specified surface. The static
checker has no phase or repository-policy input; Human Review must reject a
focused result that conflicts with such a requirement. This repository requires
the full gate for its own protocol and template changes.

## Execution invariants

These hold for every PraxisBound implementation. They are contract, not guidance:
a repository does not opt into them and an agent does not trade them away for a
green gate.

1. **Evidence before modification.** Read the relevant implementation, tests,
   contracts, and repository instructions before changing them. Never assume an
   API, command, path, or behavior that has not been observed in this tree.
2. **Smallest complete change.** Change only what the Story requires.
   Unrequested refactoring, speculative abstraction, formatting churn, and
   unrelated cleanup are out of scope even when they would be improvements.
3. **Preserve unrelated work.** Never overwrite or revert a change that belongs
   to someone else or to another Story.
4. **No authority escalation.** Perform only the operations the Story grants.
5. **Verification must exercise changed behavior.** A passing test proves
   something only when it actually covers the behavior the Story changed.
6. **Never weaken verification to obtain PASS.** Do not skip a test, weaken an
   assertion, delete a failing test, or silence an error to reach a green gate.
   A genuine specification conflict goes to Human Review or `SPEC_BLOCKED`.
7. **Never claim unexecuted verification.** A command that was not run in the
   current tree is not a PASS, and a record of a past run is not a result.
8. **Report residual risk.** Every skipped, blocked, unsupported, or failed
   verification survives into the result and the completion report. Silence is
   not evidence.

## Resolving the contract

```sh
./scripts/verification-check [story-directory ...]
```

resolves and prints the task mode, authority set, risk level, architecture
impact, and required verification profile for each Story, applying the defaults
above. It is static and read-only: it never executes a verification command.

| Result | Exit | Meaning |
| --- | --- | --- |
| `VERIFICATION_PLAN_OK` | `0` | Every checked Story resolves to a valid execution contract. |
| `VERIFICATION_PLAN_INCOMPLETE` | `1` | A declaration is unknown, repeated, or invalid. |
| `ERROR` | `2` | Invalid invocation, or a missing, unreadable, or symlinked Story file. |

The checker judges declarations, never their truthfulness. A Story that declares
`Task mode: evidence` for work that rewrites the repository passes the checker
and fails Human Review.
