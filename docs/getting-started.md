# Getting Started

PraxisBound can be added to an existing repository without installing an agent
runtime or changing its programming language.

## 1. Adopt the repository

Two paths reach the same Adoption. Neither replaces the other, and neither is
being retired.

| Path              | Requirements                                                                | Run from                                           |
| ----------------- | --------------------------------------------------------------------------- | -------------------------------------------------- |
| Portable shell    | files, Make, and the repository's existing CI; it needs no language runtime | a PraxisBound checkout                             |
| Published package | Node                                                                        | anywhere, including without a PraxisBound checkout |

Both install the same starter layout, refuse to replace a managed file, and
leave the verification gate to the repository. Neither is a prerequisite for
adopting the Protocol: both are Reference Tooling, and the contract they
install is the same either way. Choose on requirements, and on whether you
need the machine-readable Semantic Result that only the package path emits.

### Portable shell path

From a PraxisBound checkout, run:

```sh
./scripts/bootstrap /path/to/repository
```

### Published package path

The published CLI does the same work without a PraxisBound checkout. It
requires Node; the portable shell path does not.

```sh
npx @praxisbound/cli init /path/to/repository
npx @praxisbound/cli init --dry-run /path/to/repository
```

Applying is the default and `--dry-run` previews, mirroring the shell path's
`--dry-run`; `--force` and `--upgrade` carry the same meanings described below.

Like the shell path, `init` does not write the repository-owned `Makefile`.

From tooling version 0.2.0 onward, `init` also reports the ordered next steps
that remain before the repository reaches Adoption: create that gate,
then run Doctor and confirm PASS. The steps are printed for a person to read
and, with `--json`, carried as structured data under `data.nextSteps` so an
agent can act on them without parsing prose. Tooling 0.1.0 applies the same
adoption but reports no steps.

Use the scoped name exactly as written. The unscoped `praxisbound` name on
npm is not controlled by this project, so `npx praxisbound` does not install
PraxisBound.

### Adopt with an AI agent

The package path can be handed to an AI coding agent. Open a session in the
repository you want to adopt, commit or stash any work in progress, and paste
this prompt. It works with any agent that can run shell commands, and it relies
only on the structured next steps, not on printed prose:

```text
Adopt PraxisBound in this repository with its published CLI. Work from the
repository root. Do not commit.

1. Run `npx --yes @praxisbound/cli@0.2.0 init --json .` and read the JSON result.
2. If the outcome is INIT_CONFLICT, stop: report the conflicting paths listed
   in `issues`, change nothing, and do not use --force.
3. Perform every entry of `data.nextSteps` from the last `init` result, in
   order, identified by its `id`:
   - `verification-gate`: create or extend the root Makefile so that
     `make verify` runs the checks this repository already has (its tests, and
     its lint, typecheck or build where they exist) and exits non-zero when any
     of them fails. Never add checks the repository does not have, and never
     use a command that always succeeds.
   - `confirm-adoption`: run `npx --yes @praxisbound/cli@0.2.0 doctor --json .`
     and continue only when its status is pass.
   If an entry has any other `id`, stop and report it.
4. Run `npx --yes @praxisbound/cli@0.2.0 verify --json .` and require success.
5. Report which checks `make verify` runs, and the Doctor and verify results.
```

The prompt stops when the repository already holds a file PraxisBound manages,
most often its own `AGENTS.md`, because `init` then installs nothing and the
only way forward replaces that file. To let the agent replace it and merge your
instructions back, commit the file first and use this step 2 instead:

```text
2. If the outcome is INIT_CONFLICT: stop if any conflicting path has uncommitted
   changes. Otherwise run
   `npx --yes @praxisbound/cli@0.2.0 init --force --json .`, then merge every
   rule from the committed AGENTS.md (`git show HEAD:AGENTS.md`) into the
   installed AGENTS.md without dropping or weakening any of them, and continue
   with step 3. Include the `git diff` of AGENTS.md in your report.
```

Review what the agent built before you commit it. In particular, confirm that
`make verify` fails when one of the repository's checks fails; a gate that
always exits 0 passes Doctor and `verify` but verifies nothing.

### What either path installs

Both paths install the opinionated starter layout:

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

`specs/.praxisbound-adoption` records the protocol version and PraxisBound revision
this snapshot came from. It is what a later `--upgrade` reads; see
[Upgrading an adopting repository](upgrading.md).

Both paths refuse to replace any managed file. Review conflicts manually; use
`--force` only when replacing those exact files is intentional.

Preview the same static safety and conflict checks without changing the target:

```sh
./scripts/bootstrap --dry-run /path/to/repository
./scripts/bootstrap --force --dry-run /path/to/repository
```

`--upgrade` moves an existing adoption to newer Story templates without reading
or writing repository-owned `AGENTS.md` or `guidance/`; it is documented in
[Upgrading an adopting repository](upgrading.md) and is mutually exclusive with
`--force`.

`--force` and `--dry-run` may appear in either order before the optional target,
but each flag may appear only once. A dry run reports the files it would install
or replace and exits nonzero for the same static refusals as a real install. It
does not create directories, staging paths, files, or links; a later real run
can still fail if the filesystem changes concurrently.

Run bootstrap only while you control the target repository and no other process
is concurrently replacing its paths. The portable shell script rejects managed
directory and file symlinks and uses single-file atomic replacement plus
[cross-file failure recovery](upgrading.md#failure-recovery). This is not an
atomic installation transaction or a sandbox for an actively hostile,
concurrently mutated filesystem.

Adoption success means only that this installer-managed guide, optional
Guidance starter, marker, and Story-template files were installed. It is not
the adoption contract: a conforming repository needs only `AGENTS.md`, a
`Makefile` exposing `make verify`, and `specs/stories/`. Neither path writes
the repository-owned `Makefile`, calls Doctor, runs `make verify`, reviews the
result, or authorizes a merge.

## 2. Inspect the adopted structure (optional)

Doctor confirms the static required structure without changing the target,
from a PraxisBound checkout or from the published package:

```sh
./scripts/doctor /path/to/repository
npx @praxisbound/cli doctor /path/to/repository
```

Immediately after a fresh adoption into an otherwise empty directory, this
command is expected to report the missing `Makefile` and exit `1`. Define the
repository gate in the next step, then run Doctor again.

It requires only a readable non-blank `AGENTS.md`, readable `specs/stories/`,
and readable non-blank `Makefile`. A ready Story contains `story.md` and
`acceptance.md`; `task.md` and additional Story-owned artifacts are optional.
Guidance, Handoff evidence, Skills, and CI are optional capabilities. A static
success does not execute `make verify`, check CI or merge policy, or replace
human review.

For a repository you trust, explicitly run its canonical gate once:

```sh
./scripts/doctor --run-verify /path/to/repository
npx @praxisbound/cli doctor --run-verify /path/to/repository
```

This mode executes repository-owned code and is neither read-only nor
sandboxed; it may write files, start services, or use the network. Read
[Repository Doctor](doctor.md) for all command forms and result semantics.

## 3. Define the repository gate

At the target repository root, provide a Makefile target named
`verify`:

```make
.PHONY: verify

verify:
	./repository-specific-verification
```

Replace the example command with the repository's format, lint, type,
architecture, unit, integration, and acceptance checks. Keep
`make verify` as the single review-readiness interface.

The repository owns its tools and rule severity. Verification should use
non-mutating check modes; keep commands that rewrite files, such as `format`,
separate from `make verify`. Repair a failing check rather than disabling or
weakening it merely to obtain PASS. See [Code Quality](code-quality.md) for the
automated and Human Review boundaries.

## 4. Create and approve a Story

Copy the template to a Story directory:

```sh
cp -R specs/stories/_template specs/stories/ORD-123-refund-order
```

Complete `story.md` and `acceptance.md`. A human approves
the Goal, scope, rules, expected errors, and acceptance criteria before the Story
enters READY.

For `--ready`, add an [Acceptance Evidence](../protocol/story.md#acceptance-evidence)
row for every AC. State the method, exact fixture or precondition, and expected
observation. This exposes missing test data or external lifecycle assumptions
before an agent starts implementation.

Declare the Story's `## Classification`. When it is security sensitive, state the
required redaction, rejection, and persistence cases as a
[security fixture matrix](../protocol/story.md) with exact payloads instead of
prose; when it changes baseline behavior, name the tests it supersedes. Check the
declaration before implementation starts:

```sh
./scripts/story-check specs/stories/ORD-123-refund-order
npx @praxisbound/cli story check specs/stories/ORD-123-refund-order
```

See [Contract checks](contract-checks.md) for the result and exit semantics.

## 5. Implement with an agent

Give any coding agent a bounded request:

```text
Implement Story ORD-123. Follow AGENTS.md and run make verify.
```

The agent reads the Story and acceptance criteria, then reads `guidance/ENTRY.md`
when available and loads only relevant Guidance before inspecting the repository,
implementing the smallest coherent change, adding tests, and running the
canonical gate. Guidance is advisory; the approved Story remains canonical.

## 6. Verify and repair

```sh
make verify
```

On FAIL, diagnose the output, repair the root cause, and run the same command
again. Preserve the Story and acceptance criteria. On PASS, produce the delivery
report required by `AGENTS.md`.

## 7. Hand the work over

When historical execution context will help, copy the handoff template to a
record path and replace its placeholders with one exact point-in-time
observation:

From a PraxisBound checkout:

```sh
mkdir -p specs/handoffs
cp /path/to/praxisbound/templates/handoff.md \
  specs/handoffs/2026-09-12T023000Z-ABC-005.md
./scripts/handoff-check specs/handoffs/2026-09-12T023000Z-ABC-005.md
```

Without a checkout, fetch the same template from the tagged release and check
it with the published package:

```sh
mkdir -p specs/handoffs
curl -fsSL -o specs/handoffs/2026-09-12T023000Z-ABC-005.md \
  https://raw.githubusercontent.com/CarlLee1983/PraxisBound/v0.10.0/templates/handoff.md
npx @praxisbound/cli handoff check specs/handoffs/2026-09-12T023000Z-ABC-005.md
```

The [Handoff Evidence Contract](../protocol/handoff.md) requires one Story, UTC
recording time, repository, exact committed revision, verification command, and
observed result. It is immutable evidence, not current workflow state. Do not
attach a dirty-worktree PASS to the unchanged HEAD SHA. When a control plane is
present, report current status, blockers, next action, review, and completion
there instead.

## 8. Review and merge

A human reviews the verified implementation for product intent and architecture,
then follows the repository's normal merge policy. Automated PASS makes work
eligible for review; it does not approve or merge it.

Use the [Human Review guidance](human-review.md) for contextual review questions
and outcomes. If review requests an implementation change, run the complete
`make verify` again before returning to review. An agent or LLM may prepare
evidence, but only a human can accept the review. Review also checks that Story
Classification matches the real implementation and that the PASS still applies
to the exact implementation under review.

## CI

Copy [the GitHub Actions template](../templates/ci/github-actions.yml) into the
target repository and add its toolchain/dependency setup steps. Keep the final
verification step as `make verify` so local and CI completion use the
same contract.

The workflow runs the check but does not make it mandatory for merging. A
repository administrator must separately configure the matching required
status check or ruleset in GitHub.

## Validate the included examples

TypeScript with pnpm 12:

```sh
pnpm --dir examples/typescript install --frozen-lockfile
make -C examples/typescript verify
```

Go:

```sh
go -C examples/go mod download
make -C examples/go verify
```

To validate the PraxisBound repository itself after dependencies are installed,
run `make verify` from its root.
