# Compatibility, Parity, and Migration Plan

## Compatibility contract

The migration is additive while legacy shell commands remain unchanged. The
TypeScript implementation does not get to redefine current behavior simply
because its internal model is cleaner.

For the same invocation, protocol version, configuration, and isolated
repository fixture, parity compares:

1. aggregate semantic status and command-specific outcome;
2. stable detected issue identity, severity, subject, location, and structured
   parameters;
3. exit code;
4. evidence facts, including child invocation and raw child exit when relevant;
5. ordered mutation plan and observed create/replace/delete set;
6. generated artifact bytes, modes where contractual, and adoption/snapshot
   provenance;
7. no-write guarantees and recovery result.

Human wording, whitespace, wrapping, ANSI color, banners, and `Next:` prose are
not parity dimensions. A currently asserted diagnostic substring must still be
mapped to a stable issue code before its wording may change.

## Differential harness

```text
fixture source
     |
     +--> isolated legacy copy --> shell command --> legacy normalizer --+
     |                                                                 |
     +--> isolated TS copy -----> npm CLI --json -----------------------+--> comparator
     |                                                                 |
     `--> expected semantic manifest -----------------------------------+
```

Every run uses newly created temporary copies. A test never mutates the checked-
in fixture source or this repository's own Stories, handoff, Git state, or work
tree.

### Legacy normalizer

The shell implementation has no JSON mode. A test-only normalizer therefore:

- captures stdout, stderr, and exit status separately;
- maps documented result labels and known diagnostic forms to v1 issue codes;
- normalizes paths to fixture-relative POSIX paths;
- extracts stable evidence fields without treating prose as a public Interface;
- rejects any unmapped non-presentation diagnostic or impossible combination;
- records the normalizer mapping beside the fixture so changes are reviewable.

The normalizer is never shipped in Core or CLI and is never used by ForgePilot.
Its only purpose is to turn the legacy oracle into comparable semantic data.

### Mutation manifest

Before and after each invocation, the harness records a deterministic tree
manifest:

```text
relative path
node kind
content digest and byte length for regular files
mode bits only where existing behavior makes them observable
symlink target without following it
hard-link identity when the fixture exercises it
```

For mutating fault cases, the manifest also records attempted effects,
unrecovered paths, and retained recovery directories. Generated artifact byte
comparison is exact; mutation order is compared where marker/snapshot-last or
recovery order is a safety guarantee.

### Process observation

Doctor/verify and release fixtures record:

- executable, argv, working directory, and sanitized environment contract;
- invocation count;
- child exit or signal;
- whether output was routed without corrupting JSON stdout;
- before/after Git observations used for concurrent-change detection.

The harness uses a fake process Adapter for deterministic cases and real
temporary repositories for Git, permissions, symlinks, hard links, and rename/
recovery semantics.

## Golden fixture corpus

Checked-in fixtures are immutable sources under `fixtures/parity/`. Dynamic
attributes such as a Git SHA or permission denial are declared in a fixture
manifest and constructed inside the test temporary directory.

Minimum baseline:

| Fixture                       | Capabilities                            | Required observations                                                                                       |
| ----------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `valid-repository`            | doctor, story, verification, handoff    | Complete core structure; valid Story/Handoff/verification; exit `0`; no mutation.                           |
| `invalid-story`               | story, verification, doctor             | Malformed/contradictory Story yields stable issues; Doctor composes drift without turning it into exit `1`. |
| `missing-required-metadata`   | story                                   | Missing Classification and conditional declarations; aggregate incomplete.                                  |
| `invalid-verification`        | verification                            | Malformed record and failed/partial checks remain distinct.                                                 |
| `missing-evidence`            | story readiness, verification result    | Missing AC map or passing observation never becomes PASS.                                                   |
| `handoff-failure`             | handoff, doctor                         | Mutable fields, bad timestamp/SHA/scalar, and fence failures are distinguishable.                           |
| `release-failure`             | release                                 | Dirty tree, VERSION mismatch, wrong tag, and remote-not-checked evidence.                                   |
| `legacy-forgeflow-repository` | init upgrade, doctor, all static checks | Legacy ForgeFlow marker behavior; migration requires an explicit supported upgrade.                         |
| `fresh-repository`            | init                                    | Exact safe install plan/artifacts; default conflict on repeated init.                                       |

Required edge families expand that baseline:

- empty/unusual `PATH`, locale, CRLF, unclosed/variable fences, escaped pipes,
  restricted-YAML scalar forms, multiple Stories, custom decision root;
- missing/unreadable/wrong-type/symlink paths and hard-link interference;
- `make verify` exit `0`, arbitrary nonzero, missing `make`, and exact-once
  invocation;
- init fresh/force/upgrade/dry-run, preparation failure, replacement failure,
  cleanup failure, successful recovery, and incomplete recovery;
- Git worktree root, unborn HEAD, index flags, dirty submodules, annotated and
  lightweight tags, hostile config/hooks, promisor state, and concurrent change.

Each existing acceptance test is either represented by a golden fixture or
explicitly retained as a black-box legacy regression. Coverage mapping is stored
by acceptance ID; no existing test is removed merely because a new fixture
exists.

## Behavioral Parity Gate

A capability passes only when:

- all mapped legacy acceptance cases pass against the unchanged legacy command;
- the TypeScript Core tests pass at the public Interface;
- the TypeScript CLI black-box cases pass from a packed tarball;
- every shared fixture comparison passes on supported Node majors and Linux/
  macOS where filesystem semantics matter;
- all output is schema-valid and actual exit equals envelope `exitCode`;
- read-only commands have identical before/after manifests;
- mutating commands have equivalent planned and observed effects;
- no unknown legacy diagnostic was ignored;
- `make verify` passes in the current repository.

A deliberate difference is not waived inside the comparator. It becomes a
separate versioned Story with classification, migration guidance, and new
expected fixtures before parity is re-baselined.

## Migration waves

### Wave 0 — contracts and foundation

- Add the private pnpm workspace, Core/CLI package skeletons, build/type/test/
  lint gates, result schema/types, and a no-capability CLI help/version shell.
- Add the fixture manifest format, isolated runners, legacy normalizer skeleton,
  semantic comparator, and mutation manifest.
- Do not delegate any existing command to TypeScript.

### Wave 1 — Handoff contract

- Migrate `handoff check` first.
- Rationale: one input file, bounded restricted-YAML grammar, pure/read-only,
  no environment configuration or external process, and strong hostile-input
  coverage.

### Wave 2 — execution and recorded verification

- Migrate `verification check` in two slices: plan/profile resolution, then
  recorded-result/evidence evaluation.
- Establish the shared Story declaration reader that Story check consumes later;
  do not expose parser stages as public Core Interface.

### Wave 3 — Story contract and readiness

- Migrate default `story check`, then the opt-in `--ready` extension.
- This follows verification because Story is the largest semantic surface and
  can reuse the already-parity-tested declaration model.

### Wave 4 — Repository Doctor and canonical verification execution

- Migrate static Doctor only after TypeScript Story and Handoff evaluation pass.
- Add `praxisbound verify`, then parity for `doctor --run-verify` using the same
  exact-once process Adapter.
- Rationale for not starting with Doctor: current Doctor composes Story and
  Handoff; migrating it first would either shell out to legacy prose or create a
  second temporary rule implementation.

### Wave 5 — local release inspection

- Migrate `release check` with guarded Git observations and before/after
  consistency checks.
- Keep remote refs, GitHub Actions, releases, tags, and publication out of scope.

### Wave 6 — adoption initialization

- First ship deterministic init inspection/planning and `--dry-run`.
- Then add apply, force, upgrade, staging, marker-last order, reverse recovery,
  and fault-injection parity.
- No package fetch occurs at runtime; templates are the packed snapshot.

### Wave 7 — agent activation

- Migrate Codex activation preview, then apply/recovery.
- Keep it agent-specific and outside Core Protocol semantics. Do not introduce a
  general plugin system.

### Wave 8 — packaging, adoption validation, and default decisions

- Validate `npm pack`, clean install, version-pinned
  `npx --yes @praxisbound/cli@<tooling-version>` acquisition, package contents,
  direct local-binary offline execution after acquisition, supported Node
  matrix, and existing PraxisBound repository adoption.
- Validate an independent process consumer against the npm-packed CLI JSON
  commands. A ForgePilot-owned check, if available, supplies separate optional
  live-integration evidence.
- Decide each default switch independently; do not batch commands.

### Wave 9 — legacy retirement

- Classify the runtime/command-surface change under `protocol/versioning.md`.
- Revisit ADR-003 if portable shell entrypoints would be removed or require Node.
- Publish migration and rollback guidance.
- Remove one legacy Implementation per independently reviewable ticket. Retaining
  a portable compatibility Implementation is an acceptable final outcome.

TST-018 received separate Human Review approval on 2026-09-16. Its bounded
release-check removal keeps the direct command as a thin wrapper, confines Node
to optional maintainer tooling, removes the legacy selector and implementation,
and leaves adopter Protocol `VERSION` at `0.10.0`. Its verification record maps
every gate item below to fixed evidence before the executable oracle is removed.

## Why this order differs from the initial example

The example placed Doctor first. Actual code shows Doctor calls both Story and
Handoff checkers, while Handoff is the smallest self-contained deterministic
validator. The selected order reduces blast radius and prevents TypeScript
Doctor from depending on a test-only legacy-output parser. Bootstrap/init and
activation remain late because their side effects and recovery semantics have
the highest data-loss risk.

## Legacy removal gate

No legacy Implementation may be removed until all of these are observed:

- capability-specific TypeScript parity complete;
- the complete golden corpus and retained legacy tests pass;
- all command, JSON, issue, evidence, and exit contracts are documented;
- both packages build and `npm pack` contains only intended artifacts;
- version-pinned `npx --yes @praxisbound/cli@<tooling-version>` acquisition and
  execution succeed in clean npm consumer fixtures;
- direct installed-binary execution succeeds with network unavailable after
  package acquisition;
- supported Node/OS CI passes and root `make verify` passes;
- a fresh repository and at least one existing PraxisBound adoption are validated;
- the packed CLI process consumer contract remains valid, and any actually
  supported external process integration is unchanged or explicitly migrated;
- Protocol/tooling/version/package migration and rollback docs are complete;
- npm namespace ownership and provenance are verified;
- the command has completed a deprecation/default period defined by its Story;
- the runtime change is classified, and any Breaking change has migration
  guidance;
- removal is the sole semantic purpose of its own ticket.

Parity is necessary but not sufficient. If removing the portable command would
make Node required for an existing adoption workflow, removal remains blocked
until a Breaking Protocol decision is explicitly approved.

## Rollback model

- Before a default switch, rollback is selection-only: invoke the unchanged
  shell Implementation.
- After a per-command default switch, retain an explicit legacy selector or
  reversible wrapper for the defined deprecation window. TST-018 ended the
  release-check window; its rollback restores the complete pre-removal revision,
  not a copied script or hidden fallback.
- npm rollback pins the last known tooling version and changes dist-tags only
  through a separately authorized release action.
- Rolling back npm does not undo repository files written by `init`; restore
  through VCS or deliberately apply a reviewed older snapshot.
- No planning artifact authorizes dist-tag changes, publication, repository
  mutation outside this worktree, or removal.

## Risks and mitigations

| Risk                                                   | Impact                                                          | Mitigation / stop condition                                                                                             |
| ------------------------------------------------------ | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Node becomes an implicit Protocol runtime              | Violates primary architecture principle and ADR-003 assumptions | Keep packages optional and shell surface intact; treat sole-runtime switch as Breaking.                                 |
| Generic Markdown/YAML library accepts a wider language | False parity and altered validation                             | Preserve documented lexical subsets; fixture every edge grammar; no runtime parser dependency initially.                |
| One generic Core method becomes stringly or shallow    | Caller errors and leaked parser phases                          | Discriminated request/result unions; operation-specific `data`; only evaluate/plan/capabilities public.                 |
| JSON claims stability but omits needed facts           | ForgePilot falls back to prose/internal imports                 | Integration acceptance tests; issue/evidence catalog; unknown `data` forward-compatibility rule.                        |
| Exit normalization hides child failures                | Automation loses evidence                                       | Record raw child exit/signal and separately assert actual CLI exit.                                                     |
| Parity normalizer encodes wording                      | False confidence                                                | Map stable diagnostic forms fail-closed; expected semantic manifest is third oracle; wording excluded after mapping.    |
| Fixture corpus misses path/recovery behavior           | Data loss during init/activation                                | Real filesystem fault tests, mutation manifests, late migration waves, independent Sol/high review.                     |
| Protocol and tooling versions drift ambiguously        | Tool validates with wrong rules                                 | Exact resolved version in every result; no fallback; explicit tested supported range.                                   |
| npm coordinate is not controlled                       | Publication or supply-chain risk                                | Scoped logical names; prove organization permissions/provenance before release; never use unrelated unscoped package.   |
| Zero runtime dependencies cause home-grown complexity  | Maintenance burden                                              | Re-evaluate per capability; add a maintained dependency only with measured total-complexity reduction and parity proof. |
| Existing human-output consumers break                  | Hidden automation regressions                                   | Preserve shell commands during coexistence; document machine migration; default/removal in separate tickets.            |
| Windows expectations are assumed                       | Unsupported filesystem/process semantics                        | Initial support matrix names tested OSes only; add Windows only with dedicated path/signal/recovery fixtures.           |
