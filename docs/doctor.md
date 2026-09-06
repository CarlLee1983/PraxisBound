# Repository Doctor

ForgeFlow Repository Doctor is an optional diagnostic command for a repository
that adopts ForgeFlow. It checks the small required repository surface without
changing the target, and can run the repository's canonical gate only when the
caller explicitly authorizes that execution.

Doctor is not an installer, repair tool, global CLI framework, or merge gate.
Existing ForgeFlow adopters do not need to install or run it.

## Command forms

Run Doctor from a ForgeFlow checkout in one of these three forms:

```sh
./scripts/doctor [repository-directory]
./scripts/doctor --run-verify [repository-directory]
./scripts/doctor --help
```

The repository directory defaults to the current directory. `--run-verify` is
an optional leading flag; other option placements, unknown options, and excess
arguments are invalid. `--help` prints usage and exits successfully.

## Static structure check

Without `--run-verify`, Doctor performs a static, read-only check. It does not
run `make`, Make targets, repository code, shell configuration, network
requests, dependency or Skill installation, or Git mutations. It does not
create, replace, or repair repository files.

The only required paths are:

```text
AGENTS.md             # readable and non-blank regular file
specs/stories/        # readable directory
Makefile              # readable and non-blank regular file
```

`specs/stories/_template/`, a Story's `task.md`, Skills, and CI configuration
are optional, and `specs/stories/` may be empty immediately after bootstrap.
Bootstrap can install the guide and Story template, but each repository still
owns its `Makefile` and its verification implementation. Bootstrap success
means only that its managed files were installed; it is not Doctor success or
verification success.

Doctor resolves a requested repository-root symlink to its physical directory.
It does not follow a symlink at a required path inside that root: `AGENTS.md`,
`specs/`, `specs/stories/`, or `Makefile` produces `ERROR`, because that
required structure cannot be safely confirmed.

This refusal is a local diagnostic boundary, not protection against an
actively hostile process replacing paths concurrently. Run Doctor while you
control the target repository and its paths are stable.

Doctor performs only a deliberately limited Makefile text scan. A literal
`verify:` rule is a clue, not proof that verification is available or would
succeed. Comments, `.PHONY` declarations, and documentation text mentioning
`verify` do not count as a rule; neither do continued assignment text or
`define` bodies. `include` directives, continuations, definitions, and dynamic
target syntax remain `UNCONFIRMED`; an unconfirmed result never proves that
`make verify` is absent. Static mode always reports
`Verification: NOT_RUN`.

## Contract drift

Once the required structure is confirmed, static mode composes the two
[contract checks](contract-checks.md) against the same repository and reports
three more lines:

```text
Adopted version: 0.4.1
Story contract: STORY_CONTRACT_OK
Handoff: HANDOFF_CONTRACT_OK
```

`Adopted version:` is the `version` field of the FF-210 adoption marker
`specs/.forgeflow-adoption`, or `UNKNOWN` when the repository has no marker.
`Story contract:` runs `scripts/story-check` over every directory under
`specs/stories/` except `_template/`, and is `NO_STORIES` when there are none.
`Handoff:` runs `scripts/handoff-check` on `specs/handoff.md`, and is
`NOT_PRESENT` when that file does not exist.

Three signals are drift: an adopted version different from this checkout's
`VERSION`, `STORY_CONTRACT_INCOMPLETE`, and `HANDOFF_CONTRACT_INCOMPLETE`. Any
of them prints a `WARN` line and makes the result `CONTRACT_DRIFT` instead of
`STRUCTURE_OK`. **Drift does not change the exit status**, which stays `0`:
static mode reports what it found and never becomes a gate. A missing marker,
`NO_STORIES`, and `NOT_PRESENT` are reported but are not drift.

The composed checks are read-only, are given paths rather than being run from
inside the target, and never follow a symlink. They share Doctor's builtin-only
property, so the composed verdict does not change with the caller's `PATH`.
 A handoff, marker, or Story
directory that is a symlink, is unreadable, or that a checker cannot parse
reports `ERROR` and exits `2`. So does an incomplete ForgeFlow checkout: Doctor
needs its own `VERSION`, `scripts/story-check`, and `scripts/handoff-check`, and
says so rather than blaming the target repository. Run Doctor from a checkout
rather than through a symlink placed on `PATH`.

When the required structure itself is incomplete, the checks do not run and all
three lines report `NOT_CHECKED`. The three lines occupy the same position, just
above the `Result:` block, in every outcome.

Contract results are a static-mode capability. `--run-verify` output is
otherwise unchanged: a structure failure reports the same three `NOT_CHECKED`
lines in either mode, and a run that reaches verification reports none.

## Explicit local verification

Use execution mode only for a repository you trust:

```sh
./scripts/doctor --run-verify /path/to/repository
```

After Doctor safely confirms the required structure and finds `make`, it calls
the repository-owned canonical command exactly once from the physical
repository root:

```sh
make verify
```

This mode executes repository-owned code. It is neither read-only nor sandboxed
and may write files, start services, or use the network. Doctor streams the
command's output, does not retry or repair it, and reports the original Make
exit status.

## Results and decision boundaries

Doctor uses these process exit codes:

| Exit | Meaning |
| --- | --- |
| `0` | Help completed, required structure is complete in static mode, or explicitly run local verification passed. |
| `1` | Required structure is confirmed incomplete, or explicitly run local verification failed. |
| `2` | Invocation or repository-root error, a required path is unreadable or symlinked, `make` is unavailable in execution mode, or Doctor cannot safely confirm required structure. |

When both incomplete structure and an unconfirmable error are found, `2` takes
precedence over `1`.

The result labels distinguish `STRUCTURE_OK`, `CONTRACT_DRIFT`,
`STRUCTURE_INCOMPLETE`, `VERIFIED_LOCAL`, `VERIFICATION_FAILED`, and `ERROR`.
In all Doctor outcomes, CI and merge policy remain `NOT_CHECKED`.

| Evidence | What it means | What it does not mean |
| --- | --- | --- |
| Bootstrap success | The managed guide and Story-template files were installed. | The adopter-owned gate exists or adoption is complete. |
| `STRUCTURE_OK` | Doctor could confirm the three required structural paths, and found no contract drift. | `make verify`, CI, or human review passed. |
| `CONTRACT_DRIFT` | The structure is complete, but the Stories, handoff, or adopted version no longer match this checkout's protocol version. | The repository is broken, or that the drift blocks anything; the exit status is still `0`. |
| `VERIFIED_LOCAL` | The repository-configured automated gate returned zero in that local execution. | CI passed, the tests are sufficient, or the change may merge. |
| Human review | A person evaluates requirements, design, and test sufficiency. | Repository merge policy has automatically been satisfied. |
| Merge decision | The repository's own policy permits the reviewed change to merge. | Doctor made or automated that decision. |

Human review is always still required, and Doctor never authorizes a merge.

For the canonical verification and repair-loop contract, see the
[Verification Contract](../protocol/verification.md). For the adoption surface,
see the [Repository Contract](../protocol/repository-contract.md).
