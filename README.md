# PraxisBound

![PraxisBound turns human intent into verified engineering work](docs/assets/praxisbound-hero.png)

PraxisBound is an agent-agnostic development protocol for AI-assisted engineering.
It turns approved human intent into a bounded Story, makes repository tooling the
source of deterministic verification evidence, and sends verified work to human
review.

```text
Human → Story → Agent implementation → Verify → Repair → PASS → Human review → Merge
```

PraxisBound does not teach an agent how to code and does not require a particular
AI vendor. It defines the repository-level contract that Codex, Claude Code,
Cursor, OpenCode, Gemini CLI, and future coding agents can follow.

## Protocol

Each change starts as a Story under
`specs/stories/<story-id>/`:

- `story.md` records the approved goal, scope, inputs, outputs, rules,
  expected errors, dependencies, and constraints.
- `acceptance.md` turns the required behavior into checkable acceptance
  criteria.
- `task.md` may contain human working notes, but it is not a source of product
  requirements or authoritative lifecycle state.

The agent implements the smallest coherent change, adds or updates tests, and
runs the repository's canonical verification command:

```sh
make verify
```

The repository decides which format, lint, type, unit, integration, and
acceptance checks belong behind that command. A nonzero exit means the agent
returns to implementation, repairs the root cause without weakening the Story,
and verifies again. A zero exit makes the work eligible for human review; it
does not replace product or architecture judgment.

The protocol contracts include:

- [Story](protocol/story.md)
- [Verification](protocol/verification.md)
- [Execution](protocol/execution.md)
- [Architecture](protocol/architecture.md)
- [Lifecycle](protocol/lifecycle.md)
- [Handoff](protocol/handoff.md)
- [Repository adoption](protocol/repository-contract.md)
- [Versioning and compatibility](protocol/versioning.md)

PraxisBound defines what the work means and what proves it; it does not store what state the work is currently in.
Lifecycle names remain shared vocabulary. When
an external control plane is present, it owns current work, lifecycle and Gate
state, next action, review state, verification-current state, and completion
state. ForgePilot is one example, not a dependency: Story checks, Doctor,
bootstrap, and `make verify` work without it.

## Optional engineering guidance

PraxisBound may provide lightweight repository-readable engineering guidance that
helps agents reuse durable repository or team decisions. Guidance remains
advisory unless the adopting repository deliberately converts it into an
executable rule behind `make verify`; it never replaces the Story, verification,
or Human Review. The baseline is [selectively loaded](guidance/ENTRY.md), not a
knowledge-base platform or agent runtime.

## Execution governance

A Story may also declare the kind of work it is, the operations it authorizes,
the architecture it must not break, and its risk. These declarations are
optional and defaulted, so an existing Story keeps its meaning. The declared
risk selects a verification profile, and an optional per-Story result record
traces every acceptance criterion to the observation that proves it, so a
verified Story carries evidence rather than a claim.

When a Story explicitly declares `error-projection`, `concurrency`,
`bounded-capacity`, or `retention-overflow`, PraxisBound requires only that
risk's contract and links it to an existing Acceptance Criterion and Acceptance
Evidence row before readiness passes. Stories without a Signal gain no fields,
and the checker never infers risk from prose.

```sh
./scripts/verification-check specs/stories/<story-id>
./scripts/verification-check --result specs/stories/<story-id>
```

See [Execution Governance](docs/execution-governance.md) for the mental model
and a worked example.

## Code quality

PraxisBound can enforce Code Style without defining a cross-language style. The
adopting repository owns its formatter, lint, type, static-analysis, and
architecture rules and places the automated checks it requires behind
`make verify`. The resulting enforcement comes from that canonical command,
CI, and the repository's merge policy; design judgment remains with Human
Review. See [Code Quality](docs/code-quality.md) and
[Human Review](docs/human-review.md). A requested implementation change returns
to implementation and requires a new complete `make verify` PASS; Human Review
is neither an LLM score nor automated approval.

A CI workflow alone does not prevent a GitHub merge from bypassing failed
checks. A repository administrator must configure the corresponding required
status check or ruleset separately.

## Adopt PraxisBound in a repository

Two paths reach the same Adoption. Neither replaces the other, and neither is
being retired; pick the one that fits the environment you are adopting into.

| Path              | Requirements                                                                | Run from                                           |
| ----------------- | --------------------------------------------------------------------------- | -------------------------------------------------- |
| Portable shell    | files, Make, and the repository's existing CI; it needs no language runtime | a PraxisBound checkout                             |
| Published package | Node                                                                        | anywhere, including without a PraxisBound checkout |

### Portable shell path

Run the bootstrap script with the repository directory:

```sh
./scripts/bootstrap /path/to/repository
```

It installs an opinionated starter layout:

```text
AGENTS.md
guidance/
├── ENTRY.md
├── PRINCIPLES.md
├── DECISIONS.md
└── PRACTICES.md
specs/
├── .praxisbound-adoption
└── stories/
    └── _template/
        ├── story.md
        ├── acceptance.md
        └── task.md
```

The adoption marker records the installed protocol version and source revision
for later template upgrades.

The script refuses to overwrite any managed file. If replacing those exact
files is intentional, pass `--force` explicitly:

```sh
./scripts/bootstrap --force /path/to/repository
```

Preview the same static preflight without writing to the target:

```sh
./scripts/bootstrap --dry-run /path/to/repository
./scripts/bootstrap --force --dry-run /path/to/repository
```

A successful adoption means only that these installer-managed files were
installed. They are not PraxisBound's repository conformance inventory: the
required entrypoints are `AGENTS.md`, `Makefile` exposing `make verify`, and
`specs/stories/`. Guidance, templates, handoff evidence, Skills, CI, and
repository-specific extensions are optional capabilities. It does not write
the repository-owned `Makefile`, run Doctor, execute `make verify`, perform
human review, or authorize a merge.

### Published package path

The published CLI applies the same adoption without a checkout of this
repository. It requires Node; the portable shell path above does not.

```sh
npx @praxisbound/cli init /path/to/repository
npx @praxisbound/cli init --dry-run /path/to/repository
```

Applying is the default; `--dry-run` previews, and `--force` and `--upgrade`
behave as they do for the shell path.

`init` installs the same starter layout and, like the shell path, it does not
write the repository-owned `Makefile`: an Adoption owns its verification gate.

From tooling version 0.2.0 onward, `init` also reports the ordered next steps
that remain before the repository reaches Adoption — create that gate,
then run Doctor and confirm PASS. The steps are printed for a person to read
and, with `--json`, carried as structured data under `data.nextSteps` so an
agent can act on them without parsing prose. Tooling 0.1.0 applies the same
adoption but reports no steps.

Use the scoped name exactly as written. The unscoped `praxisbound` name on
npm is not controlled by this project, so `npx praxisbound` does not install
PraxisBound.

To have an AI coding agent run this path and create the gate for you, use the
prompt in [Adopt with an AI agent](docs/getting-started.md#adopt-with-an-ai-agent).

### After either path

Copy `specs/stories/_template` to a directory named for the Story, fill
in the requirements, and ask an agent to implement that Story ID.

The full manual flow is documented in
[Getting Started](docs/getting-started.md), with rationale in
[PraxisBound Concepts](docs/concepts.md). Moving an existing adoption to newer
Story templates is covered in
[Upgrading an adopting repository](docs/upgrading.md).

## Check Story and handoff contracts

For Codex users who want project-local activation without a repeated source-path
prompt, preview the optional integration with
`./scripts/codex-activate /path/to/repository` or
`npx @praxisbound/cli codex activate /path/to/repository`. Review it before
using `--apply`.
See [Codex project activation](docs/codex-activation.md) for setup and updates.

Two static, read-only checkers report contract gaps before an agent starts
implementing:

```sh
./scripts/story-check [story-directory ...]
./scripts/story-check --ready [story-directory ...]
./scripts/handoff-check [handoff-file]
```

`story-check` reports a missing Classification, a security-sensitive Story
without an executable [security fixture matrix](protocol/story.md), or a
baseline-conformance Story that does not name the behavior it supersedes.
Declared Risk Signals also activate their matching error-projection,
concurrency, capacity, or retention contract; `--ready` requires concrete
values and an Evidence AC already mapped by Acceptance Evidence.
`handoff-check` reports a handoff whose [evidence block](protocol/handoff.md)
does not identify one Story, UTC recording time, repository, exact revision,
verification command, and observed result. Handoff evidence is historical; it
does not select work or persist lifecycle state. Neither checker replaces
`make verify` or human review. See [Contract checks](docs/contract-checks.md).

## Diagnose an adoption (optional)

Repository Doctor can statically inspect an adoption without changing it:

```sh
./scripts/doctor /path/to/repository
```

It requires only the `AGENTS.md`, `specs/stories/`, and `Makefile` surface. When
`guidance/` is present, Doctor validates its `ENTRY.md` capability entrypoint;
the bootstrap four-file starter remains repository-customizable. Guidance,
Handoff evidence, Skills, and CI remain optional. Static success does not run
`make verify`, check CI or merge policy, or replace human review. For a
repository you trust, explicit execution mode runs its canonical gate once:

```sh
./scripts/doctor --run-verify /path/to/repository
```

This executes repository-owned code and is not read-only or sandboxed. See
[Repository Doctor](docs/doctor.md) for the command forms, safety boundary, and
result semantics.

## TypeScript tooling workspace

The root pnpm 12 workspace builds the public `@praxisbound/core` and
`@praxisbound/cli` package shells without replacing any portable shell command:

```sh
pnpm install --frozen-lockfile
make verify-tooling
node packages/cli/dist/bin.js --help
node packages/cli/dist/bin.js --version
```

The package version is the TypeScript tooling version, independent of the
PraxisBound Protocol version in `VERSION`. The CLI supports help, version, and the
migrated domain commands:

```sh
node packages/cli/dist/bin.js handoff check [--json] [handoff-file]
node packages/cli/dist/bin.js init [--force | --upgrade] [--dry-run] [--json] [repository-directory]
node packages/cli/dist/bin.js codex activate [--apply] [--json] repository-directory
node packages/cli/dist/bin.js doctor [--json] [repository-directory]
node packages/cli/dist/bin.js verify [--json] [repository-directory]
node packages/cli/dist/bin.js verification check [--json] [story-directory ...]
node packages/cli/dist/bin.js release check [--json] [repository-directory]
```

Migrated inspection commands are static and read-only; JSON mode emits one
canonical machine result. `init` is an explicit effect boundary unless
`--dry-run` is supplied; apply revalidates its plan and uses sibling staging,
marker-last replacement, and reverse recovery.
`codex activate` previews by default and applies only with `--apply`; it manages
the bounded project-local skill snapshot without network access or target-owned
process execution and reports drift, recovery, and cleanup through typed
activation outcomes. `doctor` inspects required and optional Repository Contract
capabilities, limited Makefile clues, marker drift, and static Story/Handoff
observations without executing target-owned code. `verification check` resolves the execution contract and required
verification profile a Story declares; it does not read `verification.md`.
`verify` explicitly executes the trusted repository's canonical `make verify`
target once from its physical root; it is not read-only or sandboxed.
`release check` performs guarded local Git observation only; it never performs
remote checks or changes the selected worktree.
Other migration commands remain unavailable, write a usage
diagnostic to standard error, and exit `2`; run `praxisbound --help` for the
available forms. Neither package exposes implementation subpaths. Core has no
runtime dependency, and CLI's only runtime dependency is Core.

The workspace keeps the lockfile consumable by single-document dependency
scanners, so pnpm does not switch versions automatically. `make verify-tooling`
rejects any pnpm version other than the exact `packageManager` pin before it
runs the workspace gates.

## TypeScript example

The example in `examples/typescript` uses pnpm 12 and demonstrates a
repository-owned verification pipeline:

```sh
cd examples/typescript
pnpm install --frozen-lockfile
make verify
```

Its `make verify` runs formatting, linting, static type checking, Story
traceability, and tests through one deterministic entry point.

## Go example

The example in `examples/go` demonstrates the same contract with Go:

```sh
go -C examples/go mod download
make -C examples/go verify
```

Its gate checks formatting, `go vet`, Staticcheck, Story traceability, and tests.

## Verify this repository

Install the tooling workspace and example's locked development dependencies,
then run PraxisBound's own canonical verification command from the repository
root:

```sh
pnpm install --frozen-lockfile
pnpm --dir examples/typescript install --frozen-lockfile
go -C examples/go mod download
make verify
```

The root command checks required protocol artifacts, bootstrap and Doctor
behavior, release-check behavior, the TypeScript tooling packages, and GitHub
Actions syntax, then delegates to both example repositories. The
repository workflow in [`.github/workflows/verify.yml`](.github/workflows/verify.yml)
sets up its Linux toolchains and locked dependencies before invoking this same
gate.

An auxiliary portability check runs the existing shell behavior suites from an
isolated, clean Git fixture without changing the canonical gate:

```sh
make verify-portability PORTABILITY_SHELL=/bin/sh
make verify-portability PORTABILITY_SHELL=/bin/dash
```

CI configures this check on macOS with `/bin/sh` and Ubuntu with `/bin/dash`.
Remote CI results remain unverified until those jobs execute; this does not
claim coverage for other shells or platforms.

## Prepare a PraxisBound release

From a clean committed release candidate, run the local-only readiness gate:

```sh
make release-check
```

It composes `make verify` with deterministic local version, Git, worktree, and
tag checks. It does not inspect remotes, CI, or GitHub Releases, and it never
changes local tags or other repository state. Follow the human-authorized
[release runbook](docs/releasing.md) for exact-SHA remote verification and
publication.

## Current protocol scope

The current protocol version is recorded in the root [`VERSION`](VERSION) file.
Its compatibility guarantees and versioned surface are defined by the
[Protocol Versioning policy](protocol/versioning.md).

PraxisBound is a declarative, manual protocol: Story and acceptance formats,
repository guidance, verification, lifecycle, and versioning contracts, a
reusable Story-development skill, executable TypeScript and Go examples, CI
support, a non-destructive bootstrap script, and a local release-readiness
check with a manual publication runbook. Repository Doctor is an optional
static diagnostic with explicitly authorized local verification. Optional
handoffs preserve immutable historical evidence, never current workflow state.

Multi-agent orchestration, workflow services, schedulers, agent runtimes,
dashboards, persistent workflow state, and language-model abstraction layers are
outside the current protocol scope.

## License

PraxisBound is available under the [MIT License](LICENSE).
