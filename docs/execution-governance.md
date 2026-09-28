# Execution Governance

PraxisBound used to answer one question: is this implementation verified? That
left four questions unanswered around the gate, and an agent that cannot answer
them guesses.

```text
Intent
  ↓
Task routing        what kind of work is this?
  ↓
Story               what outcome is approved?
  ↓
Authority           what may the agent actually do?
  ↓
Architecture        what must survive this change?
  ↓
Risk                how much proof does it deserve?
  ↓
Implementation
  ↓
Verification        which checks does the profile require?
  ↓
Evidence            which observation proves which criterion?
  ↓
Done · Partial · Blocked
```

The agent executes. PraxisBound defines what may be done, what must not break,
what must be proven, and when the work is finished.

## The mental model in one paragraph

A Story declares its task mode, the authority it grants, the architecture it is
answerable to, and its risk. Risk and architecture select verification layers
for executable work. A low-risk, low-impact documentation-only Story may declare
focused documentation validation; otherwise the default is full `make verify`.
A focused executable Story names one exact command per required layer. A recorded
result maps each layer to what happened and each acceptance criterion to the
observation that proves it. Repository integration, release, or surface policy
can require the full gate despite a focused declaration; Human Review checks
that condition. Anything less is partial, and partial is not Done.

## Progressive disclosure

None of this is required. A small, low-risk Story declares nothing new and
behaves exactly as it did before:

```markdown
## Classification

* Security sensitive: no
* Baseline conformance: no
```

resolves to `Task mode: execution`, `plan` and `modify` authority, `Risk level:
low`, `Architecture impact: low`, and the `lint static unit` profile. A Story
only pays for the ceremony it actually needs.

A change that carries real weight says so:

```markdown
## Classification

* Security sensitive: no
* Baseline conformance: no
* Task mode: execution

## Authority

* plan: yes
* modify: yes
* add_dependency: no
* migration: no
* commit: no
* push: no
* deploy: no

## Architecture

* Impact: medium
* Decision: `ADR-003`
* Boundary: `PaymentGateway`
* Contract: `PaymentGateway public interface remains compatible`
* Owner: `PaymentGateway = payment-domain`

## Risk

* Level: high
* Reason: `payment`
* Reason: `external-api`
* Signal: `error-projection`
```

## What each part refuses to do

**Task mode** does not route work to an agent or start anything. It records the
kind of work so that a review task is not silently treated as a fix task.

**Authority** does not enforce anything at runtime. PraxisBound is not a sandbox
and cannot stop a command. It makes the boundary explicit and makes crossing it
visible: an operation recorded as used but not granted is an authority conflict,
and the verification result is `FAIL`.

**Architecture** does not analyze architecture. It resolves references —
a decision record exists and is usable, an owner names a declared boundary — and
leaves whether the boundary is the right boundary to Human Review.

**Risk** does not widen scope. A high-risk Story implements the same smallest
coherent change; it proves more about it.

A `Reason:` is one non-empty same-line backticked signal, for example
`versioned-surface`; it is not a prose paragraph or a value closed on another
line.

A standard `Signal:` does a different job. It declares that the Story carries
one of four engineering risks — `error-projection`, `concurrency`,
`bounded-capacity`, or `retention-overflow` — and activates the matching Story
readiness contract. For example, `concurrency` requires the contended resource,
linearization point, conflict outcome, and an Evidence AC before readiness can
pass. Signals do not change Risk `Level`, `Reason`, or the verification profile.
No Signal means no additional fields.

The flow is deliberately declaration-driven:

```text
Story declares applicable Signal
        ↓
matching contract becomes required
        ↓
Evidence AC names observable behavior
        ↓
the existing Acceptance Evidence row plans the proof
        ↓
story-check --ready
```

The checker does not guess. Words such as “queue”, “parallel”, and “database”
do not activate a contract; deciding whether a Story omitted a real risk remains
Human Review judgment.

**Evidence** does not prove itself. `VERIFICATION_PASS` means the declared
evidence is complete, not that it is convincing.

## A worked example

`specs/stories/FF-224-execution-governance/` is the end-to-end example in this
repository: a Story with all four declarations, an `ADR-001` reference that
resolves to `specs/decisions/`, an acceptance-evidence map written before
implementation, and a `verification.md` recording what each check and each
criterion actually did. Reproduce its verdicts with:

```sh
./scripts/story-check --ready specs/stories/FF-224-execution-governance
./scripts/verification-check --result specs/stories/FF-224-execution-governance
```

## Where this lives

| Concern | Contract |
| --- | --- |
| Task mode, authority, risk, execution invariants | [Execution Contract](../protocol/execution.md) |
| Architecture metadata, decisions, architecture verification | [Architecture Contract](../protocol/architecture.md) |
| Profiles, result model, evidence traceability, completion | [Verification Contract](../protocol/verification.md) |
| Story fields and readiness | [Story Contract](../protocol/story.md) |
| Checker command forms and results | [Contract Checks](contract-checks.md) |

## What this is not

PraxisBound is not becoming a coding agent, a workflow engine, a state database,
a scheduler, or a policy runtime. It stays what it was:

```text
Engineering Governance + Execution Contract + Verification Harness
```

Everything above is a declaration in a file a human approves and a static
checker reads.
