# PraxisBound Protocol Versioning

PraxisBound versions the repository-level contract that adopters copy and rely
on. The root [`VERSION`](../VERSION) file is the single authority for the
current protocol version. It contains one numeric `MAJOR.MINOR.PATCH` value
without a `v` prefix.

## Versioned surface

The protocol version covers:

* the Story, acceptance, verification, lifecycle, and repository contracts;
* the required repository surface, including `AGENTS.md`, Story files, and
  `make verify`;
* distributed Story, agent-guide, and CI templates; and
* the public command-line behavior and safety guarantees of bootstrap and the
  optional Repository Doctor.

Examples demonstrate the contract but are not protocol packages. In particular,
the private TypeScript example's package version is not the PraxisBound protocol
version.

## Change classification

Classify every adopter-facing change by its effect on a repository that follows
the previous contract:

| Class | Meaning | Examples |
| --- | --- | --- |
| Breaking | An adopter must change existing valid files, commands, or expectations to follow the new contract. | Removing or renaming required Story fields, changing `make verify` PASS semantics, removing a bootstrap option. |
| Additive | Existing valid adoption keeps working without changes and the new capability is optional. | Adding an optional Story field, a new bootstrap option whose absence preserves behavior, or the optional Repository Doctor CLI and its documented safety guarantees. |
| Corrective | The change repairs or clarifies the documented behavior without changing the supported interface. | Fixing a bootstrap safety defect or resolving contradictory wording. |

When impact is ambiguous, treat the change as breaking until a human records a
different classification. A breaking release must include migration guidance
that identifies affected adopters and the required repository changes.

## Compatibility policy

Before PraxisBound 1.0, PATCH releases within the same MINOR line are
backward-compatible. A new `0.MINOR.0` release may include documented breaking
changes. Adopters must read its migration guidance before upgrading.

Starting with 1.0, PraxisBound follows Semantic Versioning:

* MAJOR releases may contain breaking changes;
* MINOR releases add backward-compatible behavior; and
* PATCH releases contain backward-compatible corrections.

Compatibility applies to the versioned surface above. It does not promise that
optional example toolchains, third-party CI actions, or unversioned product code
will remain unchanged.

## Snapshots and releases

Bootstrap installs a copy-time snapshot and records which snapshot it installed
in `specs/.praxisbound-adoption`. It does not negotiate or automatically upgrade
the protocol version in an adopting repository. Adopters review new templates
and migration guidance before deliberately replacing managed files, whether with
`--force` or with `--upgrade`.

The repository may contain a new `VERSION` value before that revision is
published. Publishing a release requires a Git tag named
`vMAJOR.MINOR.PATCH` whose value matches `VERSION`; the file alone does not
create or publish a release.

Any change to the versioned surface must review its classification and update
`VERSION` in the same release change when the policy requires a new version.

Repository Doctor is an **Additive** capability: its absence does not invalidate
an existing adoption, and it does not require adopters to install a CLI or
change `make verify`. Changes to Doctor's public command forms, exit semantics,
or static and execution-mode safety guarantees are changes to the versioned
surface. This classification records the optional capability only; it does not
change `VERSION`, create a tag, or publish a release.

The Story `## Classification` declaration is a **Breaking** change to the Story
Contract: it adds a required Story field, so an existing Story written against
an earlier snapshot must be updated before `scripts/story-check` reports
`STORY_CONTRACT_OK`. Migration for `0.3.0`:

1. Add a `## Classification` section to every Story, declaring
   `Security sensitive` and `Baseline conformance` as `yes` or `no`.
2. For a Story declaring `Security sensitive: yes`, add `## Trust Boundary
   Fields` to `story.md` and a `## Security Fixture Matrix` to `acceptance.md`.
3. For a Story declaring `Baseline conformance: yes`, add
   `## Superseded Behavior` to `story.md`.

Nothing else in an existing adoption changes: `make verify` semantics, bootstrap
arguments, and Doctor behavior are unaffected, and a repository that never runs
`scripts/story-check` is not blocked by the new field.

PraxisBound `0.10.0` is a **Breaking** identity migration from ForgeFlow
`0.9.0`. Fresh adoption writes `specs/.praxisbound-adoption` only. Bootstrap
`--upgrade` accepts a safe, valid legacy `specs/.forgeflow-adoption` only as
one-way migration input; both markers, unsafe paths, or malformed legacy data
are refused before mutation. See [Upgrading an adopting repository](../docs/upgrading.md).

The Handoff Contract, `scripts/story-check`, and `scripts/handoff-check` are
**Additive** capabilities: a repository without a handoff or without either
checker keeps working unchanged, and neither command is required by
`make verify` in an adopting repository. Changes to their command forms, result
names, or exit semantics are changes to the versioned surface.

`scripts/story-check` and `scripts/handoff-check` deciding without external
utilities is **Corrective** for `0.3.1`: it repairs documented behavior without
changing the supported interface. Both checkers accept and reject exactly what
they accepted and rejected before, and no adopter changes anything. Published
`0.3.0` carries the defect: under a `PATH` that resolves no external utility,
`handoff-check` reports `HANDOFF_CONTRACT_INCOMPLETE` for a conformant handoff
and Repository Doctor composes that into a `CONTRACT_DRIFT` that does not exist.

Documenting the adoption marker in the README and Repository Contract, using
the current protocol version in Doctor's sample output, and listing the example
traceability checks is **Corrective** for `0.3.2`. These changes align the
documentation with existing behavior and require no adopter changes.

Code Quality Guidance is **Additive** for `0.3.3`: it explains how a repository
can place its chosen automated quality tools behind the existing canonical
gate and strengthens the distributed agent guidance without invalidating an
existing adoption. It adds no required adoption file, Make target, tool, or
artifact and changes no `make verify` PASS, FAIL, or Repair Loop semantics.

Human Review Guidance is **Additive** for `0.3.4`: it adds optional contextual
review guidance and permits REVIEW to return through existing lifecycle states
without invalidating an existing adoption. It adds no required adoption file,
Make target, tool, or artifact; adds no lifecycle state; and changes no existing
transition or `make verify` PASS, FAIL, or Repair Loop semantics.

Review integrity and state consistency is **Corrective** for `0.3.5`: it
reconciles contradictory completion and publication records and clarifies that
Human Review checks Classification truthfulness and verification freshness.
Existing valid adoptions remain valid: the change adds no required file, field,
review attestation, lifecycle state, automated judgment, or adopter Make target,
and changes no existing PASS, FAIL, or Repair Loop semantics. Because
`bootstrap --upgrade` intentionally leaves repository-owned `AGENTS.md`
untouched, adopters manually compare the 0.3.3 through 0.3.5 agent guidance as
described in [Upgrading an Adopting Repository](../docs/upgrading.md).

FF-217 is a **Corrective** change for `0.3.6` against the `0.3.5` baseline: it
repairs documented Story Markdown parsing without changing command forms, result
names, exit codes, required fields, or adopter migration.

FF-218 optional `story-check --ready` is **Additive** for `0.3.6`: existing command forms,
default results, Doctor behavior and historical Stories stay valid. Only callers
opting in receive minimum-content checks and STORY_READINESS results. No
migration is required.

FF-219 bootstrap failure recovery is a **Corrective** safety repair for `0.3.6`:
CLI forms and the marker format remain unchanged. Detected failures recover the
prior managed contents/existence, or report unresolved paths and recovery copies.
Preparing originals needs read access and staging space; failure is safe before
replacement. No adopter migration is introduced, and crash
atomicity is not promised. See [failure recovery](../docs/upgrading.md#failure-recovery).

FF-220 adds repository-only Corrective portability coverage without changing
the canonical gate. FF-221 prepares the compatible combined `0.3.6` release:
pre-1.0 PATCH releases may contain compatible additions as well as repairs.
No Breaking change or migration is introduced. See the
[release notes](../docs/releases/0.3.6.md).

FF-222 Acceptance Evidence is **Breaking** for `0.4.0`: a Story that already
passes `scripts/story-check --ready` must add the required `## Acceptance
Evidence` map before it passes again. This is a pre-1.0 MINOR release because
the readiness contract now requires one exact row per AC. Default
`scripts/story-check`, Doctor, `make verify`, and bootstrap command forms keep
their existing semantics.

Migration for `0.4.0`:

1. Run `./scripts/bootstrap --upgrade /path/to/repository` to install the new
   Story template and adoption marker. Manually reconcile repository-owned
   `AGENTS.md`; upgrade intentionally never replaces it.
2. For every Story checked with `--ready`, add exactly one `## Acceptance
   Evidence` row for each checkbox AC. Use `test`, `command`, or `human`, and
   name exact backticked evidence, fixture or precondition, and expected
   observation. Resolve an unavailable external invariant through Human Review
   or `SPEC_BLOCKED`; do not invent an automated proof.
3. Run `./scripts/story-check --ready <story-directory>` before implementation.
   A no-argument readiness invocation discovers every Story, so migrate every
   discovered Story before using that form.

The checker validates the declaration only. Existing evidence tables are
harmless to older checkers, but rollback requires pinning to the `0.3.6`
checker, templates, and guidance.

FF-223 Engineering Guidance Layer Phase 1 is **Additive** for `0.4.1`: a Story
may name human-readable, optional Guidance, fresh bootstrap installs a small
baseline, and Doctor reports a present baseline without making its absence an
adoption failure. Existing Stories and adoptions remain valid; `--upgrade`
intentionally does not read or write repository/team-owned `guidance/`.
`--force` remains the explicit replacement path. No parser validates Guidance
references because relevance and quality are Human Review judgment, not a stable
mechanical contract. `0.4.1` is a compatible pre-1.0 PATCH release under the
combined-release policy.

Doctor's contract-drift reporting is **Additive**: it adds three static-mode
result lines, composes the two checkers through their existing command forms,
and changes no exit status. It does add one new value to Doctor's `Result`
line, `CONTRACT_DRIFT`. A consumer that matches Doctor's output for
`STRUCTURE_OK` will stop matching for a repository whose Stories, handoff, or
adopted version drifted from this checkout, even though the exit status is
unchanged at `0`. Match the exit status, or accept both values, when the
distinction does not matter.

FF-224 execution governance is **Additive** for `0.5.0`: a Story may declare a
task mode, an authority set, architecture metadata, and a risk level; a
repository may keep decision records under `specs/decisions/` and a verification
result under `specs/stories/<id>/verification.md`; and
`scripts/verification-check` resolves and judges them. Every declaration is
optional and defaulted, so a Story written against an earlier snapshot keeps its
verdict, `scripts/story-check` and `scripts/handoff-check` keep their command
forms, result names, and exit statuses, and `make verify` PASS, FAIL, and Repair
Loop semantics are unchanged for an existing adopter.

No migration is required. An adopter that wants the new capability:

1. Runs `./scripts/bootstrap --upgrade /path/to/repository` to install the
   updated Story template. Repository-owned `AGENTS.md` is intentionally never
   replaced and is reconciled by hand.
2. Adds only the declarations a Story actually needs. Progressive disclosure is
   the contract: a low-risk Story declares nothing.
3. Copies [the result template](../templates/story/verification.md) and
   [the decision template](../templates/decision.md) when it wants recorded
   evidence or decision records. Neither is installed by bootstrap, because both
   are repository-owned content rather than a managed protocol file.

`scripts/verification-check` is part of the versioned surface: changes to its
command forms, result names, or exit semantics are changes to the contract. Its
absence does not invalidate an adoption, and `make verify` in an adopting
repository is not required to call it.

The `architecture` verification layer is deliberately a resolution check only.
The five checks that require analysing source code are deliberately out of scope
for ForgeFlow rather than planned for it, so no adopter can depend on ForgeFlow
supplying them:

* dependency direction validation
* forbidden imports
* layer boundaries
* public interface drift
* architecture drift

See
[Architecture](architecture.md) for the boundary and
[ADR-003](../specs/decisions/ADR-003-forgeflow-does-not-analyze-architecture.md)
for the decision.

FF-225 Codex project activation is **Additive** for `0.5.1`: an explicit opt-in
installer, `scripts/codex-activate`, adds a pinned repository-local skill under
`.agents/skills/forgeflow/` and a bounded managed section in an adopter's
`AGENTS.md`. Existing adoptions need no change. Plain `./scripts/bootstrap`,
`--upgrade`, the adoption marker format, Doctor results, `scripts/story-check`,
`scripts/handoff-check`, `scripts/verification-check`, and `make verify`
semantics are all unchanged. In particular `--upgrade` still never reads or
writes an adopter's `AGENTS.md`, and an adoption without the integration stays
valid.

Only the new installer manages that section and snapshot. It previews every
change before writing, refuses locally edited owned content, ambiguous
delimiters, unsafe path types, and unknown integration members, and has no force
flag or network fetch. The installed snapshot pins the instructions in the
repository; it does not upgrade Story templates or the adoption marker, so the
integration version and the adopted template version can legitimately differ.
See [Codex activation](../docs/codex-activation.md) for installation, update,
and rollback.

Skills remain optional guidance. The integration supplies no tool interception
and no mechanical gate: `make verify`, CI policy, and Human Review stay the
enforcement boundaries.

FF-226 is **Corrective** for `0.5.2`: the five analysis checks are now named
identically wherever they are listed, `architecture drift` is no longer dropped
from a restatement, the position is stated as a scope boundary rather than as
future work, and the architectural sense of contract drift is renamed `public
interface drift` to end a collision with Doctor's unrelated `CONTRACT_DRIFT`
result. `ADR-003` records the decision. No command form, result name, exit
status, or verdict changes, and no adopter migration is required.

## FF-227 one Story ID grammar

FF-227 one Story ID grammar is **Breaking** for `0.6.0`. `scripts/story-check`
and `scripts/handoff-check` disagreed about what a Story ID is: `story-check`
did not validate IDs at all, and `handoff-check` required a prefix, a hyphen,
and digits. A Story ID carrying a subsystem segment, such as `DBCLI-PLAT-001`,
therefore passed the Story Contract and could never appear in a conforming
handoff.

The grammar itself is only loosened, so no ID that was valid before becomes
invalid. The Breaking part is that `scripts/story-check` now validates Story
IDs: a repository holding a Story whose directory never named a conforming ID
sees a new failure where it previously saw a pass. Migration guidance is in
[the 0.6.0 release notes](../docs/releases/0.6.0.md).

## FF-228 configurable decision root

FF-228 configurable decision root is **Additive** for `0.7.0`.
`FORGEFLOW_DECISIONS_ROOT` is optional: when it is unset or empty,
`scripts/story-check` resolves `Decision:` records from the same
`specs/decisions/` directory as before. A repository with an established ADR
collection may explicitly select that directory for one Story-check invocation.
The command form, result names, exit statuses, decision filename grammar,
record-status rules, adoption marker, bootstrap, and Doctor behavior are
unchanged. No migration is required; [the 0.7.0 release notes](../docs/releases/0.7.0.md)
describe the opt-in configuration.

## P0-001 remove mutable lifecycle state

P0-001 is **Breaking** for `0.8.0`. A handoff that satisfied `0.7.0` by
persisting `workflow.current_story`, `workflow.next_story`,
`workflow.completed_stories`, `workflow.status`, mutable worktree state, and
the last verification claim no longer satisfies the Handoff Evidence Contract.
The replacement is one immutable point-in-time record anchored to a Story, UTC
time, repository, exact commit revision, verification command, and observed
result.

This hard cut is required to leave one current-state authority. Accepting both
schemas would keep ForgeFlow's lifecycle database valid beside an external
control plane. Command forms, result names, and exit statuses remain unchanged,
but existing valid handoff files must change, which meets the Breaking
definition above.

Migration for `0.8.0`:

1. Move current work, lifecycle status, blockers or Gates, next action, review,
   verification-current, and completion state to the team's external control
   plane or direct human coordination. ForgePilot is one example and is not
   required by ForgeFlow.
2. Remove the legacy `workflow` and `baseline` projections. If historical
   execution context is worth preserving, replace the file with one record
   containing `handoff.story`, `handoff.recorded_at`, `handoff.repository`,
   `handoff.revision`, `verification.command`, and `verification.result`.
   Rename `last_command` to `command`; use the exact committed revision rather
   than attaching dirty-worktree evidence to HEAD.
3. Reconcile repository-owned `AGENTS.md` and installed ForgeFlow skills so they
   select work only from explicit human or control-plane context and treat a
   handoff as historical evidence.
4. Run `./scripts/handoff-check`, Repository Doctor if used, and `make verify`.

Rollback requires restoring the `0.7.0` protocol, template, checker, and agent
guidance together. A `0.8.0` record cannot reconstruct current, next, or
completed work; obtain that state from the control plane or human rather than
inferring it from historical evidence.

P0-002 risk-driven Story readiness is **Additive** for `0.8.0`: the four
standard `Signal` declarations are optional and conditional. A Story that names
none of them requires no new section and keeps both its default Story-contract
and opt-in readiness verdicts. A Story that opts in must add only the matching
Error Projection, Concurrency, Capacity, or Retention and Overflow contract and
link it to an existing Acceptance Criterion and Acceptance Evidence row.

No migration is required. `Signal` does not replace Risk `Level` or `Reason`,
does not alter the resolved verification profile, and introduces no inference
from Story prose. Command forms, result names, exit statuses, Doctor defaults,
and `make verify` semantics remain unchanged. Rollback removes the optional
Signal declarations and corresponding sections together with the `0.8.0`
checker, protocol, template, and documentation.

## P1-003 structural contract simplification

P1-003 is **Breaking** for `0.9.0`. It clarifies and enforces the existing
minimal adoption boundary: `AGENTS.md`, a `Makefile` exposing `make verify`,
and `specs/stories/` are required entrypoints. A ready Story is described by
the durable invariant of `story.md` plus `acceptance.md`, while `task.md` and
additional Story-owned files remain optional. Bootstrap's source-to-destination
installation manifest is deliberately not part of that contract.

Existing repository adoptions remain valid, and a repository with no Guidance,
Handoff, Skills, or CI remains structurally complete. A repository that keeps
Guidance can customize the starter layout; Doctor validates only the detected
capability's `guidance/ENTRY.md` entrypoint.

Migration for `0.9.0` affects only consumers that parse Doctor's documented
`Guidance:` status values. Replace `OPTIONAL_LEGACY` and
`GUIDANCE_BASELINE_OK` with `NOT_PRESENT` and `GUIDANCE_CONTRACT_OK`
respectively. `GUIDANCE_INCOMPLETE` now depends on why the former baseline was
incomplete: a missing or blank `guidance/ENTRY.md` becomes
`GUIDANCE_CONTRACT_INCOMPLETE`, while a missing or blank starter document other
than `ENTRY.md` becomes `GUIDANCE_CONTRACT_OK`. An unsafe `ENTRY.md` remains
`ERROR`; a legacy `ERROR` caused only by a symlinked, wrong-type, or unreadable
non-entry starter document becomes `GUIDANCE_CONTRACT_OK`. No repository file,
Bootstrap layout, Story, or Guidance migration is required.
Rollback restores the `0.8.0` Doctor, protocol, templates, and documentation as
a set; it does not require reconstructing a bootstrap file inventory.

## Repository release readiness

PraxisBound maintainers can run root `make release-check` on a clean committed
candidate. It composes canonical verification with read-only local version,
worktree, commit, and tag-consistency checks. A local PASS is necessary but not
sufficient for publication: the command does not inspect or change remote refs,
GitHub Actions, or GitHub Releases.

The human-authorized [release runbook](../docs/releasing.md) defines the remote
exact-SHA evidence, stop conditions, publication commands, and post-publication
checks. This optional maintainer capability is additive; it does not change the
existing `make verify` contract or require adopters to install a release tool.

TST-018 is a **Breaking maintainer-tooling** change outside the adopter Protocol
surface. `make release-check` and direct `scripts/release-check` retain their
command forms, outputs, exits, read-only behavior, and remote-exclusion contract,
but the direct command now requires Node and
`RELEASE_CHECK_IMPLEMENTATION=legacy` no longer selects the removed shell
implementation. Human Review approved that runtime consequence after the
TST-017 deprecation/default period on 2026-09-16. Maintainers remove the selector
and use the repository's supported Node runtime; rollback restores the complete
pre-TST-018 revision. Adopting repositories gain no Node requirement and no
Protocol file, command, or expectation changes, so `VERSION` remains `0.10.0`.
