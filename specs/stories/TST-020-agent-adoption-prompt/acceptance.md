# Acceptance Criteria

## Happy Path

* [ ] AC-001: `docs/getting-started.md` has an "Adopt with an AI agent" section
  under the published package path with one copyable prompt, and `README.md`'s
  published package section points to it.
* [ ] AC-002: The prompt pins `@praxisbound/cli` to the exact version declared
  in `packages/cli/package.json` in every command it names, names no agent
  product, and instructs the agent to run `init --json`, act on
  `data.nextSteps` by `id`, build the gate from the repository's existing checks,
  require Doctor PASS and `verify` success, report the gate's checks, and not
  commit.
* [ ] AC-003: On the Node fixture with no `AGENTS.md`, one Claude Code and one
  Codex observation each end with Doctor PASS and `verify` exiting 0, a gate that
  fails when a repository test is deliberately broken, no commit, and no change
  outside the fixture.

## Business Rules

* [ ] AC-004: The prompt's default instruction stops on `INIT_CONFLICT` and
  reports the conflicting paths; a separate optional replacement step
  authorizes `init --force` only when the conflicting files are committed,
  merging the committed `AGENTS.md` back, finishing the steps and presenting
  `git diff`.
* [ ] AC-005: On the Go fixture holding an `AGENTS.md`, one Claude Code and one
  Codex observation with the default prompt each stop at the conflict, report
  it, do not force, and leave `git status` clean.
* [ ] AC-006: On the Go fixture holding an `AGENTS.md`, one Claude Code and one
  Codex observation with the optional authorization each keep every marked
  original rule and the installed PraxisBound sections in `AGENTS.md`, end with
  Doctor PASS and `verify` exiting 0, have a gate that fails when a repository
  test is deliberately broken, present the merge diff, and do not commit.

## Failure Cases

* [ ] AC-007: `tests/bootstrap.sh` fails when the prompt's pinned version
  differs from `packages/cli/package.json`, when a required instruction is
  removed, or when the prompt names an agent product.

## Regression Requirements

* [ ] AC-008: All six observations use the prompt at one recorded commit, each
  with human input limited per R8, and an observation made on an earlier prompt
  or with other input is recorded as not counting.
* [ ] AC-009: `make verify` passes, and `README.md` names the package form of
  Codex activation alongside the shell form.

## Acceptance Evidence

| AC | Method | Evidence | Fixture / precondition | Expected observation |
| --- | --- | --- | --- | --- |
| `AC-001` | test | `tests/bootstrap.sh TST020-AC-001` | `docs/getting-started.md and README.md` | `the section heading, one prompt block under the package path, and the README pointer are present` |
| `AC-002` | test | `tests/bootstrap.sh TST020-AC-002` | `the prompt block and packages/cli/package.json` | `every @praxisbound/cli reference carries the package version; each required instruction is present; no agent product name appears` |
| `AC-003` | human | `TST-020 agent observation record` | `Node fixture without AGENTS.md; fresh Claude Code and Codex sessions; final prompt commit` | `agent-inspected Doctor PASS, verify exit 0, broken-test gate failure, clean commit history and no outside change, for both agents` |
| `AC-004` | test | `tests/bootstrap.sh TST020-AC-004` | `the prompt block` | `default stop-and-report instruction and the separate optional replacement step with its committed-files condition, force and merge are both present` |
| `AC-005` | human | `TST-020 agent observation record` | `Go fixture with marked AGENTS.md; default prompt; both agents` | `agent-inspected conflict stop, reported paths, no force, clean git status, for both agents` |
| `AC-006` | human | `TST-020 agent observation record` | `Go fixture with marked AGENTS.md; prompt with optional authorization; both agents` | `agent-inspected marked rules and PraxisBound sections present, Doctor PASS, verify exit 0, broken-test gate failure, diff presented, no commit, for both agents` |
| `AC-007` | test | `tests/bootstrap.sh TST020-AC-007` | `copies of the documentation with a wrong version, a removed instruction, and an agent product name` | `each mutated copy is rejected` |
| `AC-008` | human | `TST-020 agent observation record` | `the prompt commit named in the record` | `six counting observations at that commit; any earlier-prompt or assisted observation listed as not counting` |
| `AC-009` | command | `make verify` | `current checkout` | `exit 0, and README.md shows both codex activation forms` |

## Verification Notes

Run `./scripts/story-check --ready` and `./scripts/verification-check` for this
Story first. The static cases in `tests/bootstrap.sh` read the committed
documentation and the CLI package manifest; mutated copies live in the test's
temporary directory. Pilot observations that shape the prompt are allowed and
recorded as not counting. Once the prompt is final and committed, run all six
observations against that commit; the agent inspects each fixture's final state
itself, including breaking one repository test to confirm the gate fails.
Never commit transcripts.
