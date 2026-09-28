# Verification Contract

PraxisBound repositories expose one canonical command at the repository root:

```sh
make verify
```

This command is the canonical full-repository gate and the deterministic
authority on the checks it runs. The approved Story and repository policy
determine when it is required for human review.

## Repository responsibility

Each repository owns the contents of `make verify`. At an integration, release,
or repository-defined full-gate boundary, it must execute every automated check
the repository requires for review readiness, in a repeatable and
non-interactive way. Depending on the technology and risk, those
checks can include:

- formatting checks
- linting
- static type or architecture checks
- unit, integration, and acceptance tests
- generated-file or schema consistency checks

Repository-adopted formatters, linters, type checkers, static analyzers, and
architecture checkers should be placed behind this same command when their
results are required for review readiness. Each check must be deterministic,
non-interactive, suitable for CI, and return a nonzero status on failure.
Mutating commands such as automatic formatting remain separate so verification
does not rewrite source files to obtain PASS.

PraxisBound constrains the verification interface and its PASS/FAIL semantics,
not the tools behind it. It does not require a language, framework, formatter,
linter, type checker, architecture checker, test runner, CI provider, or an
additional Make target. Project-specific commands and setup remain in
repository tooling and documentation rather than in the PraxisBound protocol.
`make verify` remains the one canonical full-repository command and the
deterministic authority for its point-in-time PASS or FAIL result. An approved
Story may instead require focused checks for a bounded change where repository
policy permits. Focused commands exercise the changed surface; they do not
redefine the full gate's PASS.

## Optional Doctor invocation

[Repository Doctor](../docs/doctor.md) does not define another verification
gate. Its default inspection is static and always reports verification as not
run. When a caller explicitly uses `--run-verify` for a trusted repository,
Doctor runs this same `make verify` command exactly once from the physical
repository root and reports its original exit status. That execution is not
read-only or sandboxed and can run repository code, write files, start
services, or use the network.

## Result

- Exit status `0` means **PASS**. The implementation is eligible for
  human product and architecture review.
- Any nonzero exit status means **FAIL**. Verification output must identify the
  failing check well enough to begin diagnosis.

PASS does not approve the product intent, waive human review, or merge the
change. It is evidence for the implementation that the recorded command
checked. A later source, test, configuration, or other behavior-affecting
change invalidates that PASS for review and requires the required checks again.
When the Story or repository requires the full gate, that means another complete
`make verify`. FAIL cannot be reclassified by an agent.

This result is evidence, not persisted current state. When a control plane is
present, it owns whether verification is currently running, stale, blocked, or
accepted in the workflow and whether work is currently complete. PraxisBound
defines the verification semantics and may preserve immutable evidence without
maintaining a synchronized status field.

Doctor's `STRUCTURE_OK` result is only a static structure result, while
`VERIFIED_LOCAL` is local automated evidence. Neither checks CI or merge policy
(both remain `NOT_CHECKED`), and neither replaces required human review or the
repository's own merge decision.

## Verification profiles

The declared [risk level](execution.md#risk) selects how much of the
verification surface a Story owes:

| Risk level | Required checks |
| --- | --- |
| `low` | `lint`, `static`, `unit` |
| `medium` | `lint`, `static`, `unit`, `integration` |
| `high` | `lint`, `static`, `unit`, `integration`, `contract`, `e2e` |

An `architecture` check is added when the Story declares
`Architecture impact: medium` or `high`.

A profile names verification *layers*, not commands. PraxisBound does not assume
that any repository has a command for each layer: the repository maps a layer to
its own tooling behind `make verify`, exactly as it already does. A layer the
repository does not have is recorded as `unsupported`. It is never recorded as
a pass.

The default profile for a Story that declares no risk is `low`, so an existing
Story keeps the surface it already had.

### Focused scope

An optional [Story declaration](execution.md#verification-scope) may select
focused verification. An executable Story retains every risk and architecture
layer in the table above and names one exact command for each. A low-risk,
low-impact documentation-only Story instead requires the `documentation` layer
and a command that validates the edited documents. Higher-risk or
higher-impact documentation requires the full gate.

No declaration means full `make verify`, preserving old Story and result
verdicts. An explicit `Scope: full` also requires a `full: pass` record naming
`make verify`. A focused record lists the full gate as `skipped` with a reason
and residual risk, or as `pass` with the exact `make verify` command.
`verification-check --result` compares each passing focused check's command
with the declaration and still requires passing acceptance evidence. It cannot
prove the command ran, that it exercised the changed files, or that a
repository's integration, release, or surface policy permits focused scope.
Human Review checks those facts. Never mark an unrun required gate PASS. A
skipped, blocked, unsupported, or absent required check leaves the result
partial, and a failed check remains failed.

## Verification result

A Story may record what verification actually did in
`specs/stories/<id>/verification.md`, using
[the result template](../templates/story/verification.md):

```markdown
## Checks

* unit: pass — `make verify`
* e2e: unsupported — `no browser environment in this repository`

## Evidence

* `AC-001`: pass — `PaymentRetryPolicyTest`

## Authority Used

* modify

## Residual Risks

* `end-to-end environment unavailable`
```

A check status is `pass`, `fail`, `skipped`, `blocked`, or `unsupported`. An
evidence status is `pass`, `fail`, `blocked`, or `skipped`. Every detail is one
exact backticked command, test, or reason.

## Acceptance evidence traceability

A green command is not a finished Story. `acceptance.md` declares, before
implementation, which observation will prove each criterion; `verification.md`
records, after implementation, what that observation actually was:

```text
Acceptance Criterion → Verification → Evidence
```

An entire test suite passing while no observation ties a criterion to a result
means the criterion is unproven, and the Story is not verified.

## Judging the result

```sh
./scripts/verification-check --result [story-directory ...]
```

reads the Story, resolves its profile, and judges the recorded result. It never
runs a recorded command and never infers one that was not recorded.

| Result | Exit | Meaning |
| --- | --- | --- |
| `VERIFICATION_PASS` | `0` | Every required check passed and every acceptance criterion has a passing observation. |
| `VERIFICATION_PARTIAL` | `1` | A required check is absent or did not pass, or a criterion is unproven. |
| `VERIFICATION_FAIL` | `1` | A check failed, a criterion failed, or an operation was used that the Story does not grant. |
| `VERIFICATION_RESULT_INCOMPLETE` | `1` | The record is missing or malformed, or an incomplete result retains no residual risk. |
| `ERROR` | `2` | Invalid invocation, or a missing, unreadable, or symlinked Story file. |

An operation recorded under `## Authority Used` that the Story does not grant is
an **authority conflict** and makes the result `VERIFICATION_FAIL`.

`PASS` here means the declared evidence is complete, not that the evidence is
convincing. Human Review still decides whether the recorded observation actually
proves the criterion.

## The verification flow

```text
make verify
     │
     ▼
resolve task mode, authority, risk, architecture impact
     │
     ▼
resolve the verification profile
     │
     ├── lint
     ├── static
     ├── unit
     ├── integration
     ├── contract
     ├── e2e
     └── architecture
     │
     ▼
record the result and the evidence per acceptance criterion
     │
     ▼
PASS · PARTIAL · FAIL
```

`make verify` remains the canonical full-repository gate. The required full or
focused commands supply the automated evidence for their declared scope. The
result record adds what an exit status cannot
carry: which layer each check belonged to, which criterion each observation
proves, which authority was used, and what risk survived.

## Completion

A Story is complete only when all of the following hold:

* the implementation is complete;
* the required verification passed;
* every required acceptance criterion has passing evidence; and
* no unresolved authority conflict remains.

A skipped required check, a blocked verification, or a missing observation makes
the Story `PARTIAL`. Partial work is not Done, and reporting it as Done is a
protocol violation rather than a rounding error.

## Repair loop

On FAIL, the implementing agent:

1. reads the failing check and diagnoses its root cause;
2. returns to implementation and repairs the code or tests;
3. preserves the approved Story and acceptance criteria;
4. reruns the required checks, including complete `make verify` when required.

The loop ends only with PASS or a genuine specification blocker that requires a
human decision. Story-specific verification notes may describe setup or useful
focused checks when an approved scope permits them. They never redefine the
canonical full-repository command.

## Continuous integration

CI should call `make verify` rather than maintain a second definition
of review readiness. Local agents and CI then evaluate the same contract, while
the repository remains free to evolve the checks behind it.
