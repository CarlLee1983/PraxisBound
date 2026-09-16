# Existing Tooling Inventory

This inventory describes the executable surface at protocol `0.9.0`. Despite
the migration shorthand "Python to TypeScript," all seven listed executables
are currently POSIX `sh`, not Python. The migration oracle is therefore the
legacy shell Implementation.

The current public behavior is evidence for planning, not permission to copy its
implementation structure. Protocol Semantics must remain equivalent; shell
parsing, utility selection, banners, and formatting may change unless the
versioning policy already exposes them as compatibility-sensitive behavior.

## `scripts/bootstrap`

Command:
`scripts/bootstrap [--force | --upgrade] [--dry-run] [repository-directory]`

Purpose:
Install a fresh PraxisBound snapshot, explicitly replace the fresh-install managed
set, upgrade only the template/marker set, or preview one of those operations.

Inputs:
One optional target directory (default `.`); mutually exclusive `--force` and
`--upgrade`; optional `--dry-run`; source checkout `VERSION`, templates,
guidance, and Git state.

Outputs:
Human preview, warning, recovery, or success text. A successful non-preview run
produces managed repository files and `specs/.praxisbound-adoption` containing
`version` and source `revision`.

Files read:
`VERSION`; `templates/AGENTS.md`; three Story templates; four Guidance starter
files; existing managed target files; an existing adoption marker during
upgrade; source Git metadata when available.

Files written:
Fresh/force writes `AGENTS.md`, three files under
`specs/stories/_template/`, four files under `guidance/`, and the adoption
marker. Upgrade writes only the three Story templates and marker. Apply modes
create private sibling staging directories and remove them after success;
failed recovery may retain them.

Environment dependencies:
POSIX shell/filesystem semantics, permissions, signals, optional `git`, and
selected Git routing variables which are cleared for provenance lookup.

External process dependencies:
`dirname`, `sed`, `mkdir`, `cp`, `mv`, `rm`, `rmdir`, and optional `git`.

Exit codes:
`0` success or clean dry-run; `1` safety refusal, invalid source snapshot,
write/recovery failure, or unavailable upgrade; `2` invalid invocation or target
argument.

Failure modes:
Target conflict, unsafe symlink or path type, missing/invalid source version or
template, upgrade of a non-adoption, existing staging path, preparation or
rename failure, incomplete recovery, or incomplete cleanup. Recovery is
best-effort across files, not crash atomic under `SIGKILL` or power loss.

Side effects:
Dry-run is target-read-only. Apply creates directories, stages every payload,
renames the marker last, and reverse-recovers attempted paths on a detected
failure. It never runs target-owned code.

Protocol rules implemented:
Copy-time protocol snapshot identity; non-destructive default; explicit
replacement/upgrade; repository ownership of `AGENTS.md` and Guidance after
adoption; marker-last application; documented failure recovery. Bootstrap's
source-to-destination manifest is explicitly not the Repository Contract.

Presentation-only behavior:
`Would install`, `Would replace`, warning wording, path layout in messages, and
success prose. Exit category, no-write dry-run, affected file set, ownership,
and recovery outcome are semantic.

Tests covering behavior:
`tests/bootstrap.sh`, `tests/portability.sh`, Doctor fixtures, `Makefile`
`verify-bootstrap`, and adopter documentation assertions. The suite covers
snapshot provenance, conflicts, force/upgrade/dry-run, symlink/type safety,
staging faults, reverse recovery, and retained recovery evidence.

## `scripts/codex-activate`

Command:
`scripts/codex-activate [--apply] repository-directory`

Purpose:
Preview or explicitly install/update a repository-local pinned Codex skill
snapshot and bounded `AGENTS.md` block.

Inputs:
Required target directory; optional `--apply`; source skill content, source
`VERSION` and revision; target adoption marker, agent guide, and prior activation
snapshot.

Outputs:
Human preview/diff, already-installed result, warnings, recovery details, or
apply success.

Files read:
Target `AGENTS.md`, adoption marker, installed skill files/snapshot; source
`skills/praxisbound/agents-block.md`, `skills/praxisbound/SKILL.md`,
`skills/story-development/SKILL.md`, `VERSION`, and optional source Git state.

Files written:
On `--apply`, the bounded `AGENTS.md` section plus
`.agents/skills/praxisbound/{SKILL.md,story-development.md,.praxisbound-snapshot}`;
sibling stages and a temporary scratch tree are created and cleaned.

Environment dependencies:
POSIX filesystem/signals, `LC_ALL=C`, `TMPDIR`, optional `git`, and target file
permissions.

External process dependencies:
`awk`, `wc`, `tr`, `dd`, `mktemp`, `cksum`, `cmp`, `grep`, `sed`, `cp`, `cat`,
`diff`, `ls`, `chmod`, `mkdir`, `mv`, `rm`, `rmdir`, `dirname`, and optional
`git`.

Exit codes:
`0` help, preview, no-op, or successful apply; `1` safety/validation/operation
failure; `2` invalid invocation.

Failure modes:
Missing adoption, unsafe file type/link, ambiguous managed markers, unknown or
incomplete integration content, locally edited owned content, malformed
snapshot/version, staging/write/recovery failure, or hard-link interference.

Side effects:
Preview creates only external scratch content and leaves the target unchanged.
Apply stages and recovery-protects the four target files and writes the snapshot
last. It performs no network request or target-code execution.

Protocol rules implemented:
This is optional agent-integration tooling, not a required Protocol capability.
Its stable semantics are repository-local pinning, visible provenance, preview
by default, explicit apply, bounded ownership, and refusal to overwrite local
drift.

Presentation-only behavior:
Unified diff layout and explanatory wording. Preview/apply distinction, managed
surface, provenance, refusal cases, and recovery are semantic.

Tests covering behavior:
`tests/codex-activation.sh`, the FF-225 walkthrough fixtures, portability tests,
documentation assertions, and `make verify-bootstrap`.

## `scripts/doctor`

Command:
`scripts/doctor [repository-directory]` or
`scripts/doctor --run-verify [repository-directory]`

Purpose:
Statically inspect a PraxisBound adoption and optional capabilities, or explicitly
run the repository-owned canonical verification gate once.

Inputs:
Target directory (default `.`); optional `--run-verify`; source checkout
`VERSION` and sibling checkers.

Outputs:
Human findings plus adopted version, Story/Handoff/Guidance states, optional
capability detection, result, verification/CI/merge statements, and next steps.
Results are `STRUCTURE_OK`, `CONTRACT_DRIFT`, `STRUCTURE_INCOMPLETE`, `ERROR`,
`VERIFIED_LOCAL`, or `VERIFICATION_FAILED`.

Files read:
Required `AGENTS.md`, `Makefile`, and `specs/stories/`; source `VERSION`;
adoption marker; every non-template Story through `story-check`; optional
`specs/handoff.md` through `handoff-check`; `guidance/ENTRY.md`; existence of
Skills and GitHub CI paths.

Files written:
None in static mode. `--run-verify` delegates to repository-owned code, which
may write arbitrary build or test artifacts.

Environment dependencies:
Static mode uses shell builtins and sibling checkers and remains valid with an
empty external `PATH`. Execution mode requires a discoverable `make`.

External process dependencies:
Static mode executes the checkout-owned `story-check` and `handoff-check` but no
target-owned command. Execution mode invokes `make verify` exactly once from the
physical target root.

Exit codes:
`0` structurally complete static result (including advisory contract drift) or
successful verification; `1` incomplete structure or failed verification; `2`
invalid invocation, unsafe/unreadable input, checker failure, or inability to
execute verification safely.

Failure modes:
Missing/blank core entrypoint, unsafe type/link/permission, unresolved root,
incomplete PraxisBound installation, composed-checker operational error, missing
`make`, or nonzero `make verify`.

Side effects:
Static mode is read-only and never executes target-owned code. `--run-verify`
crosses an explicit trust boundary and inherits all effects of the target's
`make verify`.

Protocol rules implemented:
Minimal Repository Contract, optional capability detection, marker/contract
drift, non-gating static diagnosis, and canonical gate ownership. Doctor does
not redefine PASS or authorize merge.

Presentation-only behavior:
Banner, `PASS`/`WARN`/`INFO` prose, layout, and `Next:` suggestions. Result
identity, exit code, read-only/execution boundary, exact-once invocation, and
child exit evidence are semantic.

Tests covering behavior:
`tests/doctor.sh`, `tests/portability.sh`, bootstrap/activation fixtures,
documentation checks, and `make verify-doctor`.

## `scripts/story-check`

Command:
`scripts/story-check [story-directory ...]` or
`scripts/story-check --ready [story-directory ...]`

Purpose:
Validate Story contract declarations; optionally add minimum-content,
acceptance-evidence, and risk-contract readiness checks.

Inputs:
Zero or more Story directories; no argument discovers non-`_template`
directories under `specs/stories/`; optional `--ready` first; optional non-empty
`PRAXISBOUND_DECISIONS_ROOT`.

Outputs:
Per-Story findings and IDs plus aggregate
`STORY_CONTRACT_OK`/`STORY_CONTRACT_INCOMPLETE` or
`STORY_READINESS_OK`/`STORY_READINESS_INCOMPLETE`; operational `ERROR`.

Files read:
Each Story's `story.md` and `acceptance.md`, plus every referenced decision
record from the selected decision root.

Files written:
None.

Environment dependencies:
POSIX shell builtins and filesystem readability. Only
`PRAXISBOUND_DECISIONS_ROOT` changes resolution; external `PATH` must not change a
verdict.

External process dependencies:
None.

Exit codes:
`0` selected Story contract/readiness passes; `1` at least one Story is
incomplete; `2` invalid invocation or an unsafe/missing/unreadable input prevents
evaluation.

Failure modes:
Invalid Story ID; missing/contradictory Classification; invalid trust-boundary,
security-matrix, superseded-behavior, governance, authority, architecture,
decision, risk, fence/table, Goal/Scope, AC, evidence-map, or risk-evidence
declaration; unsafe/missing file or invalid invocation. Operational error has
aggregate precedence over incomplete findings.

Side effects:
Read-only; it never runs evidence or judges requirement truthfulness.

Protocol rules implemented:
Story ID grammar; Story structure/classification; restricted Markdown fences and
tables; security/baseline contracts; execution governance; decision resolution;
risk signals/contracts; opt-in readiness; acceptance evidence. These rules are
Core semantics.

Presentation-only behavior:
Diagnostic sentences and spacing. Per-subject reporting, stable issue identity,
aggregate result, ordering, and exit semantics must be represented in parity.

Tests covering behavior:
`tests/story-check.sh`, shared governance cases in
`tests/execution-governance.sh`, Doctor composition, portability tests,
documentation assertions, and `make verify-story`.

## `scripts/verification-check`

Command:
`scripts/verification-check [story-directory ...]` or
`scripts/verification-check --result [story-directory ...]`

Purpose:
Resolve a Story's execution contract and required verification profile, or judge
a recorded `verification.md` against that plan and the Story's acceptance IDs.

Inputs:
Zero or more Story directories with the same discovery behavior as
`story-check`; optional `--result` first.

Outputs:
Resolved plan facts and
`VERIFICATION_PLAN_OK`/`VERIFICATION_PLAN_INCOMPLETE`; result mode returns
`VERIFICATION_PASS`, `VERIFICATION_PARTIAL`, `VERIFICATION_FAIL`, or
`VERIFICATION_RESULT_INCOMPLETE`; operational `ERROR`.

Files read:
Story `story.md`, `acceptance.md`, and, in result mode, `verification.md`.

Files written:
None.

Environment dependencies:
POSIX shell builtins and filesystem readability; external `PATH` must not affect
the result.

External process dependencies:
None.

Exit codes:
`0` valid plan or passing recorded result; `1` incomplete plan, partial/failing
result, or malformed/incomplete record; `2` invocation or operational error.

Failure modes:
Unknown/repeated task, authority, architecture, or risk declaration; invalid
authority closure; invalid profile inputs; missing required layer; failed,
partial, unsupported, or absent check; unproven AC; ungranted used authority;
missing residual risk; malformed/missing files. It never resolves ADR status or
risk-contract content, which remain Story-check responsibilities.

Side effects:
Read-only; recorded commands are evidence text and are never executed.

Protocol rules implemented:
Execution defaults and authority closure; profile resolution; result precedence;
required-layer and AC evidence completeness; used-authority enforcement;
residual-risk requirement; silence-never-PASS.

Presentation-only behavior:
Plan formatting and diagnostic prose. Resolved values, result identity,
precedence, evidence facts, and exit semantics are semantic.

Tests covering behavior:
`tests/execution-governance.sh`, portability tests, docs assertions, Story skill
references, and `make verify-execution`.

## `scripts/handoff-check`

Command:
`scripts/handoff-check [handoff-file]` (default `specs/handoff.md`)

Purpose:
Validate one immutable, point-in-time Handoff evidence block using PraxisBound's
restricted line-oriented YAML subset.

Inputs:
Zero or one Handoff path; optional `--help`.

Outputs:
Findings plus `HANDOFF_CONTRACT_OK`, `HANDOFF_CONTRACT_INCOMPLETE`, or
operational `ERROR`.

Files read:
Only the selected Handoff file.

Files written:
None.

Environment dependencies:
POSIX shell builtins and file readability; external `PATH` must not affect the
verdict.

External process dependencies:
None.

Exit codes:
`0` complete evidence contract; `1` incomplete/malformed contract; `2` invalid
invocation or unsafe/missing/unreadable/empty input.

Failure modes:
Missing/multiple/unclosed evidence fence; unknown/repeated/missing sections or
keys; invalid Story ID, UTC timestamp, full lowercase SHA, result, or generic
plain scalar; embedded YAML line break; legacy mutable lifecycle fields; unsafe
file path.

Side effects:
Read-only. It does not prove clock truth, repository identity, commit existence,
command execution, or record immutability.

Protocol rules implemented:
Handoff is immutable historical evidence, not current-state authority; exact
field set and lexical grammar; shared Story ID; allowed verification result.

Presentation-only behavior:
Finding prose and whitespace. Contract result, issue identity, subject location,
and exit semantics are semantic.

Tests covering behavior:
`tests/handoff-check.sh`, Doctor composition, shared Story-ID corpus,
portability tests, documentation assertions, and `make verify-handoff`.

## `scripts/release-check`

Command:
`scripts/release-check` (no arguments)

Purpose:
Inspect whether this PraxisBound checkout is a locally coherent release candidate.
Root `make release-check` first runs the full canonical gate and then this
script; direct invocation performs only the local release inspection. The
script is a thin POSIX wrapper around the TypeScript JSON compatibility adapter;
the superseded shell implementation and runtime selector were removed by
TST-018.

Inputs:
No arguments and no implementation selector; repository
Git/HEAD/index/worktree/tag state and committed/working `VERSION`.

Outputs:
On success: version, commit, expected tag, local-tag state, and the explicit
fact `remote_checks=not-performed`; otherwise one failure reason.

Files read:
Git metadata/index/refs; committed `HEAD:VERSION`; working `VERSION`; full
worktree status including submodules. Critical observations are read twice to
detect concurrent change.

Files written:
None intended.

Environment dependencies:
A supported Node.js runtime and the installed repository tooling. The
TypeScript Git adapter clears selected Git routing state, disables hooks and
optional locks, and performs guarded observations through the local Git
process.

External process dependencies:
`node` and `git`.

Exit codes:
`0` local candidate passes; `1` local readiness, adapter, or runtime failure;
`2` invalid invocation or retired/unknown implementation selection.

Failure modes:
Non-Git/non-root/unborn repository; hidden index flags; missing, malformed,
uncommitted, or mismatched `VERSION`; dirty worktree; wrong or conflicting tag;
tag not resolving to the expected commit; concurrent HEAD/tag/index/version/tree
change; guarded Git query failure; unavailable Node; invalid wrapper invocation;
or a retired/unknown implementation selector. No case invokes a shell fallback.

Side effects:
Read-only local Git inspection. It explicitly performs no remote lookup, CI
query, tag creation, release publication, or repository mutation.

Protocol rules implemented:
Protocol release identity and local candidate coherence. Remote exact-SHA,
GitHub Actions, publication, and human authorization remain outside the command.

Presentation-only behavior:
Failure sentence wording and line layout. Version/commit/tag observations,
remote-not-checked evidence, read-only guarantee, and exit semantics are
semantic.

Tests covering behavior:
`tests/release-check-entrypoint.sh`, TypeScript release conformance tests,
`tests/portability.sh`, release documentation, `make verify-tooling`, and
composed `make release-check`. Fixtures cover hostile Git configuration,
promisor/lazy-fetch protection, mutation detection, tag TOCTOU, malformed child
results, missing runtime, and absence of legacy fallback.

## Current coupling and extraction map

| Behavior                                                                                         | Owning destination                     | Reason                                                                      |
| ------------------------------------------------------------------------------------------------ | -------------------------------------- | --------------------------------------------------------------------------- |
| Story/Handoff IDs, restricted Markdown/YAML, declarations, defaults, profiles, result precedence | `@praxisbound/core`                      | Deterministic Protocol Semantics reused by CLI, tests, and library callers. |
| Repository observations represented as normalized values                                         | `@praxisbound/core` types and evaluators | Core evaluates facts without owning operating-system effects.               |
| Discovery, physical-root resolution, `lstat`, permission checks, file reads                      | CLI filesystem Adapter                 | Local I/O is not Protocol Semantics.                                        |
| Git and Make invocation plus environment sanitization                                            | CLI process Adapter                    | External state is observed at an effect seam and then evaluated by Core.    |
| Init/activation desired file set and conflict decisions                                          | Core mutation planner                  | The same input snapshot must produce the same proposed effects.             |
| Staging, rename, signal handling, rollback execution                                             | CLI mutation Adapter                   | These are operating-system effects, not deterministic decisions.            |
| Human text, colors, progress, help, `process.exitCode`                                           | CLI renderer/adapter                   | Presentation and process integration stay outside Core.                     |
| Historical legacy-output normalization                                                           | fixed TST-017/TST-018 evidence          | The removed oracle is retained as evidence, not executable production code. |

## Inventory conclusions

- The largest semantic risk is `story-check` (about 1,900 shell lines and the
  broadest contract surface), not Doctor.
- Doctor cannot reach independent parity until Story and Handoff evaluation are
  available because it composes both.
- `handoff-check` is the best first migrated capability: pure, bounded, no
  environment configuration, and already tested against hostile lexical input.
- `bootstrap` and `codex-activate` must remain late because parity includes
  mutations, recovery, hard links, and interruption behavior.
- Replacing current shell entrypoints with Node programs is not an additive
  refactor. It changes the versioned runtime/portability surface and needs a
  separate Breaking decision even after TypeScript parity is complete.
