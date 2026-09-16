# Ordered Implementation Tickets

These tickets are dependency ordered. Each is one independently reviewable
semantic slice. Before implementation, each ticket must be converted into an
approved PraxisBound Story with its own Classification, authority, architecture,
risk, acceptance evidence, and versioning classification.

Every implementation ticket ends with focused checks and repository
`make verify`. A ticket is partial if a required parity/platform check is
skipped, blocked, or unsupported.

## TST-001 — Establish TypeScript tooling foundation

Depends on: none.

Scope:

- Add a private root `package.json`, exact pnpm pin, `pnpm-workspace.yaml`, root
  lockfile, and `tsconfig.base.json`.
- Add publishable package skeletons for `@praxisbound/core` and `@praxisbound/cli`,
  ESM build outputs, package exports, and a `praxisbound` bin that supports only
  `--help` and `--version`.
- Add format, lint, typecheck, unit-test, build, and package-content checks to
  the existing root verification graph.
- Declare the Node engine matrix without changing the example package.

Non-goals:

- No Story/Handoff/Doctor/init/release semantics.
- No legacy command delegation, package publication, npm login, dependency
  addition beyond approved development tooling, protocol move, or script removal.

Acceptance criteria:

- Both packages build from a clean install and have no third-party runtime
  dependency except CLI's workspace dependency on Core.
- `praxisbound --help` and `--version` run from built output; all other commands
  return a documented not-implemented usage result.
- Package root exports contain no internal parser/Adapter path.
- Existing shell gates and outputs remain unchanged.

Verification:

- Frozen pnpm install, package build/typecheck/lint/unit tests, `npm pack --dry-run`
  content assertions, existing shell test suites, and `make verify`.

## TST-002 — Implement result and Protocol-selection contracts

Depends on: TST-001.

Scope:

- Promote the planning schema into the CLI package's published schema surface.
- Add Core discriminated result/issue/evidence/error types and one canonical CLI
  serializer.
- Add the exit mapping and conditional invariants between status, outcome,
  error, and actual process exit.
- Publish an issue-code catalog location and compatibility rules.
- Add a Protocol registry seeded only with exact `0.9.0`, selector resolution
  for `current`, `adopted`, and an explicit exact version, plus the
  `capabilities()` manifest and package compatibility metadata.

Non-goals:

- No migrated command, human renderer redesign, automatic Protocol upgrade,
  nearest-version fallback, second Protocol implementation, or ForgePilot
  change.

Acceptance criteria:

- Pass, fail, warning, configuration error, and internal error examples validate.
- Invalid combinations (for example `status: pass` with non-null error or an
  envelope exit differing from the process mapping) fail tests.
- Canonical serialization is deterministic and excludes absolute temp paths,
  time, duration, color, and stack traces.
- Repository paths reject absolute, drive-prefixed, backslash, empty-segment,
  trailing-separator, and dot-segment forms; SemVer and the required custom npm-
  range format reject invalid version metadata.
- `current`, readable adopted `0.9.0`, and explicit `0.9.0` resolve identically;
  malformed, missing-adoption, and unsupported selectors fail closed.
- `capabilities()` reports exact implemented versions/ranges and the result
  schema version from build constants, without inspecting a repository.

Verification:

- Core selector/registry unit tests, schema fixture validation, CLI serializer
  tests, package export/content test, and `make verify`.

## TST-003 — Build the differential parity harness

Depends on: TST-002.

Scope:

- Define the immutable fixture manifest, temporary-copy runner, before/after
  mutation manifest, legacy output normalizer contract, and semantic comparator.
- Seed the nine baseline fixture families without implementing a TypeScript
  capability.
- Add fail-closed tests for unknown legacy diagnostics and mismatched exit/
  mutation/evidence.

Non-goals:

- No production parser, command migration, expected-difference waiver, or
  replacement of current tests.

Acceptance criteria:

- The harness proves its own failure behavior with intentionally divergent fake
  results.
- Fixture sources remain byte-identical after every run.
- Existing shell commands can be normalized without the normalizer becoming a
  production dependency.

Verification:

- Harness self-tests, repository cleanliness assertion around the fixture run,
  existing legacy suites, and `make verify`.

## TST-004 — Migrate Handoff contract evaluation

Depends on: TST-003.

Scope:

- Implement restricted Handoff block/scalar parsing and contract evaluation in
  Core.
- Add `praxisbound handoff check`, human rendering, JSON envelope, and parity for
  all current Handoff cases.

Non-goals:

- No YAML generalization, lifecycle/current-state model, Doctor migration,
  signature/clock/Git proof, or shell-script modification.

Acceptance criteria:

- Shared Story-ID and Handoff lexical corpora match legacy results/issues/exits.
- Static command has zero target writes and zero external process calls.
- JSON is schema-valid for every success, incomplete, and error fixture.

Verification:

- Core Handoff tests, packed-CLI black-box tests, Handoff parity suite under
  supported Node majors, `tests/handoff-check.sh`, and `make verify`.

## TST-005 — Migrate verification plan resolution

Depends on: TST-004.

Scope:

- Implement the shared Story declaration reader, task/authority/risk/architecture
  defaults, authority closure, and required-profile resolution.
- Add default `praxisbound verification check` plan mode and parity.

Non-goals:

- No `verification.md` result evaluation, ADR resolution, Story readiness, risk-
  contract content validation, or shell modification.

Acceptance criteria:

- Every legacy default/declaration/profile case has the same resolved values,
  stable issues, outcome, and exit.
- The declaration reader is internal; public Core exports remain the agreed deep
  Interface.
- Unknown/repeated/malformed declarations fail without thrown user-facing
  exceptions.

Verification:

- Core plan tests, relevant `tests/execution-governance.sh` parity cases,
  packed-CLI JSON/human tests, and `make verify`.

## TST-006 — Migrate recorded verification-result evaluation

Depends on: TST-005.

Scope:

- Implement `verification.md` parsing, required-layer evaluation, acceptance-
  evidence completeness, used-authority checking, residual-risk rules, and
  aggregate precedence.
- Add `praxisbound verification check --result` and parity.

Non-goals:

- No execution of recorded commands, automatic repair, Story readiness, or
  change to verification profile semantics.

Acceptance criteria:

- PASS/PARTIAL/FAIL/RESULT_INCOMPLETE and operational ERROR remain distinct.
- Silence, absent required checks, and unproven ACs never become PASS.
- Every current result-mode case matches legacy outcome/issues/exit/evidence.

Verification:

- Core result tests, result-mode parity, packed-CLI tests,
  `tests/execution-governance.sh`, and `make verify`.

## TST-007 — Migrate Story contract evaluation

Depends on: TST-006.

Scope:

- Implement default Story contract rules: IDs, Classification, security matrix,
  superseded behavior, governance declarations, decision resolution, and risk
  signal/contract structure.
- Add default `praxisbound story check` with discovery and custom decision-root
  configuration.

Non-goals:

- No `--ready`, general Markdown parser, architecture source analysis, Guidance
  validation, or shell default switch.

Acceptance criteria:

- Every default legacy Story case produces equivalent issues, per-subject facts,
  aggregate outcome, and exit.
- Explicit subject order and lexical discovery order are deterministic.
- Core reuses the declaration model from verification; it does not copy a second
  parser.

Verification:

- Core Story tests, default Story parity, configured-decision-root cases,
  packed-CLI tests, `tests/story-check.sh`, governance tests, and `make verify`.

## TST-008 — Migrate Story readiness evaluation

Depends on: TST-007.

Scope:

- Add Goal/Scope content, checkbox AC, Acceptance Evidence, placeholders, and
  risk-evidence link evaluation.
- Add `praxisbound story check --ready` and parity.

Non-goals:

- No requirement-quality scoring, language scoring, test-source parsing, evidence
  execution, or defaulting readiness on.

Acceptance criteria:

- Readiness remains opt-in and default Story outcomes are unchanged.
- Every current readiness/fence/pipe/placeholder/evidence case matches legacy.
- Non-English and technical values remain valid exactly where legacy accepts
  them.

Verification:

- Core readiness tests, readiness parity, packed-CLI tests, full
  `tests/story-check.sh`, and `make verify`.

## TST-009 — Migrate static Repository Doctor

Depends on: TST-004, TST-007, TST-008.

Scope:

- Implement filesystem observation for required/optional capabilities, limited
  Makefile clues, marker drift, and Core composition of TypeScript Story and
  Handoff results.
- Add static `praxisbound doctor` in human and JSON modes.

Non-goals:

- No `make verify`, repair, bootstrap, maturity score, architecture analysis, or
  shelling out to legacy checker prose.

Acceptance criteria:

- Static mode starts no target-owned process and leaves the target manifest
  unchanged.
- `CONTRACT_DRIFT` remains advisory exit `0`; unsafe/unconfirmable input remains
  ERROR exit `2`.
- All Doctor static fixtures match legacy semantic results.

Verification:

- Core inspection tests, fake/real filesystem Adapter tests, Doctor static
  parity, packed-CLI tests, `tests/doctor.sh` static cases, and `make verify`.

## TST-010 — Add canonical verification execution

Depends on: TST-009.

Scope:

- Add the process Adapter and `praxisbound verify` exact-once execution.
- Add parity for `praxisbound doctor --run-verify` using the same Adapter.
- Record child command/cwd/exit/signal as evidence and preserve JSON stdout.

Non-goals:

- No retry, repair, sandbox, dependency install, alternate gate, or CI/merge
  claim.

Acceptance criteria:

- Static Doctor remains process-free.
- Authorized execution runs `make verify` exactly once from physical root.
- Child zero/nonzero/missing-make/signal cases map to documented CLI exits while
  preserving raw child evidence.

Verification:

- Fake process contract tests, real temporary Make fixture, execution-mode
  Doctor parity, JSON stream tests, full `tests/doctor.sh`, and `make verify`.

## TST-011 — Migrate local release inspection

Depends on: TST-003, TST-010.

Scope:

- Implement guarded Git observation, Core release evaluation, before/after
  consistency checks, and `praxisbound release check [repository]`.
- Default the candidate to `.`, resolve its physical Git top-level, and require
  the candidate itself to be that worktree root. Parity passes the same fixture
  checkout explicitly to both Implementations.
- Add stable `RELEASE_READY`/`RELEASE_INCOMPLETE` JSON outcomes while mapping all
  legacy failure reasons.

Non-goals:

- No remote fetch, GitHub query/write, tag creation, publication, or automatic
  invocation of root verification by the direct CLI command.

Acceptance criteria:

- All current Git/index/VERSION/tag/concurrency fixtures match semantic legacy
  behavior and exit.
- Environment sanitization prevents lazy fetch, replacement refs, fsmonitor, or
  hooks from changing the observation.
- Result explicitly records that remote checks were not performed.
- Explicit-target and current-directory invocation produce the same result for
  the same physical checkout; a non-root candidate is a typed acquisition
  error.

Verification:

- Core release tests, fake and real Git Adapter tests, release parity,
  `tests/release-check.sh`, packed-CLI tests, and `make verify`.

## TST-012 — Add deterministic init planning and dry-run

Depends on: TST-003, TST-009.

Scope:

- Package the exact template snapshot and provenance.
- Implement repository/adoption/version detection, managed-path preflight,
  safe/force/upgrade mutation planning, and `praxisbound init --dry-run`.
- Emit exact planned changes in human and JSON modes.

Non-goals:

- No target write, staging, recovery, network fetch, prompt, or apply mode.

Acceptance criteria:

- Dry-run creates nothing under the target and returns an exact deterministic
  plan for fresh, conflict, force, upgrade, markerless, and unsafe-path fixtures.
- Force/upgrade mutual exclusion and managed surfaces match the documented
  contract.
- Packed package provenance is used; source checkout paths are not required.

Verification:

- Core plan tests, package-content/provenance tests, dry-run parity, target
  no-write manifests, `tests/bootstrap.sh` dry-run cases, and `make verify`.

## TST-013 — Add init apply and recovery

Depends on: TST-012.

Scope:

- Implement CLI mutation application for fresh, force, and upgrade plans.
- Revalidate preconditions, stage beside each destination, apply marker last,
  reverse-recover detected failure, and expose recovery evidence.
- Submit the original plan and immutable attempted/applied/restored/unrecovered/
  cleanup observations back through Core evaluation for the final outcome.

Non-goals:

- No changed managed manifest, auto-merge, automatic upgrade, crash-atomic
  promise, Codex activation, or legacy removal.

Acceptance criteria:

- Successful generated artifacts are byte-equivalent to legacy for every mode.
- Fault injection proves preparation failure causes no target change and rename
  failure restores contents/existence or reports retained recovery evidence.
- Stale plans and unsafe links/types are refused before mutation.
- The mutation Adapter never assigns a pass/fail outcome; Core deterministically
  evaluates identical execution observations to identical results.
- Safety refusal, failed-but-restored apply, incomplete recovery, and committed-
  but-incomplete cleanup map respectively to the documented distinct exit-1
  outcomes.

Verification:

- Mutation Adapter unit/integration tests, real filesystem fault suite, complete
  bootstrap parity, full `tests/bootstrap.sh`, packed-CLI init tests, and
  `make verify`.

## TST-014 — Migrate Codex activation

Depends on: TST-013.

Scope:

- Implement activation preview, provenance/checksum drift checks, bounded agent
  block planning, apply, snapshot-last ordering, and recovery.
- Add `praxisbound codex activate` and `--apply`.
- Use the same Core mutation-execution observation contract as init.

Non-goals:

- No global skill, runtime fetch, generalized plugin/agent framework, force flag,
  Story template upgrade, or Protocol requirement.

Acceptance criteria:

- Preview/apply/no-op/conflict/recovery results and generated bytes match legacy.
- Unknown or locally edited owned content is never overwritten.
- No network or target-owned process is used.
- Safety refusal, failed-but-restored apply, incomplete recovery, and cleanup
  residue use the explicit activation exit-1 outcomes rather than `ERROR`.
- Faulted scratch cleanup in preview and no-op modes also produces
  `ACTIVATION_CLEANUP_INCOMPLETE`, with zero target mutation and retained-path
  evidence.

Verification:

- Core plan tests, activation Adapter and parity suites,
  `tests/codex-activation.sh`, walkthrough fixtures, packed-CLI tests, and
  `make verify`.

## TST-015 — Validate npm packages and clean npx consumers

Depends on: TST-011 and TST-014.

Scope:

- Prove npm scope ownership, package provenance, exact Core/CLI dependency,
  exports, bin mode/shebang, tarball allowlist, license/readme, and engine policy.
- Install tarballs into clean npm-only fixtures, run version-pinned
  `npx --yes @praxisbound/cli@<tooling-version>` acquisition tests, and invoke
  the installed `praxisbound` binary without pnpm or network.
- Add the supported Node/OS matrix.

Non-goals:

- No npm publish/dist-tag write, package-name acquisition, GitHub release, or
  change to Protocol `VERSION`.

Acceptance criteria:

- Clean consumers run help, JSON static checks, verify, and init from tarballs.
- Package acquisition behavior is distinguished from offline CLI runtime;
  templates and commands work offline after local tarball installation.
- Unpinned `npx @praxisbound/cli` is labeled a human convenience. Unscoped
  `npx forgeflow` is not documented as public acquisition while the unrelated
  `forgeflow@0.6.0` package owns that name.

Verification:

- `npm pack`, tarball inspection, clean npm install, pinned npx acquisition,
  direct local-bin offline matrix, provenance checks, supported Node/OS CI, and
  `make verify`.

## TST-016 — Validate the packed CLI process consumer contract

Depends on: TST-015.

Scope:

- Add an independent process consumer contract test for every npm-packed CLI
  JSON command without parsing human output.
- If a library integration is requested, test only Core package-root exports
  against the declared tooling SemVer.
- Document process/library selection and compatibility failure behavior.
- Record an agreed ForgePilot-owned check separately when available; live
  ForgePilot integration is optional.

Non-goals:

- No ForgePilot redesign, lifecycle-state import, internal PraxisBound import,
  remote service, MCP, or AI-dependent verification.

Acceptance criteria:

- The packed process consumer handles pass/warning/fail/error and schema-version
  mismatch.
- No test matches human wording.
- PraxisBound never reads or changes ForgePilot's mutable lifecycle authority.

Verification:

- Consumer contract suite using packed CLI/Core artifacts, schema fixtures, and
  `make verify`; an available agreed ForgePilot-owned check supplies separate
  live-integration evidence.

## TST-017 — Switch the release-check compatibility entrypoint

Depends on: TST-011, TST-015, and TST-016's packed process contract.

Scope:

- Change only the repository's `make release-check` compatibility entrypoint or
  wrapper to select the fully migrated TypeScript local release inspection after
  explicit approval.
- Document version classification, deprecation window, selection/rollback, and
  unchanged Protocol semantics.

Non-goals:

- No second command, cleanup of legacy implementation, Protocol redesign, or
  Node requirement behind an existing path unless separately approved Breaking
  migration is in scope.

Acceptance criteria:

- The release-check capability's complete parity gate passes at the fixed
  checkpoint.
- Rollback selects the unchanged legacy implementation without data migration.
- Existing command form, machine result, exit, and safety contract stay valid or
  have explicit Breaking migration guidance.
- Repository `make release-check` still runs canonical `verify` exactly once
  before TypeScript local release inspection exactly once, and stops before the
  inspection when verification fails.

Verification:

- Full release-check parity, packed consumer matrix and process contract,
  existing adoption validation, Make target ordering/failure fixtures,
  `make verify`, and independent review. Preserve or explicitly migrate any
  supported external process integration.

## TST-018 — Remove the legacy release-check implementation

Depends on: TST-017 plus the complete Legacy Removal Gate.

Approved boundary: on 2026-09-16 Human Review declared the TST-017
deprecation/default period complete and approved the Breaking maintainer-tooling
Node requirement. Preserve `scripts/release-check` as a thin wrapper, remove the
selector and shell implementation, keep Protocol `VERSION` at `0.10.0`, and
roll back only by restoring the complete pre-TST-018 revision.

Scope:

- Remove only the superseded shell `release-check` Implementation after its
  documented deprecation/default period.
- Retain or deliberately migrate any versioned entrypoint required by the
  approved runtime strategy.
- Update migration and rollback documentation.

Non-goals:

- No behavior rewrite, second command removal, package feature, Protocol cleanup,
  or unrelated test deletion.

Acceptance criteria:

- Every Legacy Removal Gate item has attached passing evidence.
- Removal is correctly classified under `protocol/versioning.md`; a Node runtime
  requirement has explicit Breaking approval and revisits ADR-003.
- Golden fixtures, existing adoption, packed npx, generic process consumer
  contract, CI, and docs remain valid with no fallback to deleted code. Any
  supported external integration is preserved or explicitly migrated.

Verification:

- Full parity/conformance/consumer/CI matrix, `make verify`, release dry-run
  checks, migration walkthrough, rollback walkthrough, and independent Sol/high
  review.

## Ticket sequencing summary

```text
TST-001 foundation
  -> TST-002 result/version-selection contracts
    -> TST-003 parity harness
      -> TST-004 handoff
        -> TST-005 verification plan
          -> TST-006 verification result
            -> TST-007 story contract
              -> TST-008 story readiness
                -> TST-009 doctor static
                  -> TST-010 verify execution
                    -> TST-011 release inspection
                  -> TST-012 init plan/dry-run
        -> TST-013 init apply/recovery
          -> TST-014 Codex activation
TST-011 and TST-014
  -> TST-015 npm/npx validation
    -> TST-016 packed process consumer contract
      -> TST-017 release-check entrypoint switch
        -> TST-018 legacy release-check removal
```
