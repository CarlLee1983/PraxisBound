# TypeScript Tooling Architecture

## Decision summary

PraxisBound keeps one language-independent Protocol and adds one official,
optional TypeScript Reference Tooling implementation. The repository adopts a
two-package workspace:

```text
PraxisBound Protocol
        ^
        | implements
        |
@praxisbound/core
        ^
        | consumes
        |
@praxisbound/cli
```

The packages are Modules with separate Interfaces, not separate sources of
truth. The Protocol continues to own adopter-visible rules and persistent
formats. Core owns deterministic decisions. CLI owns operating-system and
process effects plus presentation.

## Protocol / Core / CLI seam

### `protocol/`

Owns language-independent:

- Repository, Story, execution, verification, lifecycle, architecture,
  Handoff, and evidence rules.
- Persistent repository formats and exact lexical subsets.
- Required and optional capabilities.
- Version classification, compatibility, migration, and rollback requirements.
- Examples and future JSON Schema/YAML schemas when the schema itself is a
  Protocol contract.

It must not depend on:

- Node.js, npm, TypeScript declarations, generated JavaScript, or package
  installation.
- CLI argument frameworks, terminal rendering, or an AI/runtime service.
- Network state, remote APIs, LLM judgment, or interactive answers.

The existing flat Markdown files remain in place during the migration. Moving
them into `protocol/lifecycle/`, `protocol/story/`, and other subdirectories
would change adopter links and the versioned surface without improving the
initial TypeScript seam. Add `protocol/schemas/` lazily only for genuinely
language-independent schemas; do not place the CLI result schema there because
that schema versions Reference Tooling, not the Protocol.

### `packages/core/`

Owns deterministic:

- Restricted Markdown and Handoff scalar parsing.
- Story, Handoff, verification-result, evidence, authority, risk, and version
  models.
- Story/readiness validation, plan/profile resolution, verification-result
  evaluation, repository-inspection evaluation, and release-state evaluation.
- Stable issue codes, evidence values, aggregate precedence, and deterministic
  ordering.
- Protocol-version compatibility selection with no silent fallback.
- Init/activation conflict decisions and mutation planning from immutable input
  snapshots.

Core does not own:

- `process.argv`, `console`, terminal colors, progress, prompts, or exit.
- Reading the live filesystem, executing `git`/`make`, signals, staging/rename,
  rollback execution, npm installation, or network access.
- Current lifecycle authority, Human Review, architecture analysis, or
  repository-specific verification checks.

Core's dependencies are in-process. It receives immutable, normalized inputs
captured by an Adapter and returns values. Expected invalid documents are
results, not thrown exceptions.

### `packages/cli/`

Owns:

- Command hierarchy, option parsing, help, and deprecation aliases.
- Physical-root resolution, file discovery, `lstat`, permissions, content
  acquisition, and construction of immutable Core inputs.
- Safe Git/Make child processes and captured observations.
- Explicit trust/authorization transitions for target writes or target-owned
  code.
- Transactional file application, staging, signal handling, recovery, and
  reporting of unrecovered paths.
- Human rendering, JSON serialization, and process exit mapping.
- Packaged template snapshot/provenance and npm `bin` integration.

CLI never decides a Protocol verdict on its own. It acquires facts, asks Core to
evaluate or plan, performs an explicitly authorized effect, and asks Core to
evaluate the resulting observation where necessary.

## Core Interface draft

The recommended design combines the minimal and version-selected alternatives:
one evaluation entrypoint, one mutation-planning entrypoint, and capability
discovery. This provides Depth without exposing parser stages or filesystem
ports as the public Interface.

```ts
export interface PraxisBoundCore {
  evaluate(request: EvaluationRequest): SemanticResult;
  planMutation(request: MutationRequest): MutationPlanResult;
  capabilities(): CapabilityManifest;
}

export type EvaluationRequest =
  | StoryContractRequest
  | StoryReadinessRequest
  | VerificationPlanRequest
  | VerificationResultRequest
  | HandoffContractRequest
  | RepositoryInspectionRequest
  | VerificationExecutionObservationRequest
  | ReleaseInspectionRequest
  | MutationExecutionObservationRequest;

export type MutationRequest = InitPlanRequest | ActivationPlanRequest;
```

Every request carries one exact `protocolVersion` plus operation-specific
immutable subjects. A subject uses repository-relative POSIX paths and captured
bytes/path facts. The CLI resolves `current` or adopted-version convenience
selectors before crossing the Core Seam.

```ts
interface BaseRequest {
  readonly protocolVersion: string;
  readonly operation: Operation;
}

interface RepositorySnapshot {
  readonly rootId: string;
  readonly entries: readonly RepositoryEntry[];
}

interface RepositoryEntry {
  readonly path: string;
  readonly kind: "missing" | "file" | "directory" | "symlink" | "other";
  readonly readable: boolean;
  readonly searchable?: boolean;
  readonly bytes?: Uint8Array;
  readonly identity?: string;
}
```

`rootId` identifies a subject within one result and must not contain an absolute
temporary path. The CLI may accept OS paths; Core diagnostics remain
repository-relative.

`planMutation` returns an opaque, content-addressed plan containing ordered
preconditions and intended effects. It never applies the plan. Before applying,
CLI recaptures the named preconditions and rejects a stale plan. This keeps the
decision deterministic and the effect boundary explicit.

```ts
interface MutationPlan {
  readonly planVersion: "1";
  readonly operation: "init" | "activation";
  readonly protocolVersion: string;
  readonly preconditions: readonly PathPrecondition[];
  readonly effects: readonly PlannedEffect[];
  readonly commitMarker: string;
}
```

After applying or recovering a plan, CLI submits a
`MutationExecutionObservationRequest` through `evaluate`. That request includes
the original content-addressed plan plus immutable observations for every
attempted, applied, restored, unrecovered, and cleaned path. Core—not the
mutation Adapter—then assigns the semantic outcome, issues, and evidence such as
`INIT_APPLIED` or `INIT_RECOVERY_INCOMPLETE`. The Adapter reports effects; it
does not decide whether the operation passed.

Interface invariants:

- Core never mutates an input, reads global state, or performs I/O.
- The same request bytes, declared protocol version, and Core version produce
  the same Semantic Result byte-for-byte after canonical JSON serialization.
- Unsupported versions return a typed configuration error; no nearest-version
  fallback or automatic upgrade exists.
- Explicit subjects retain caller order; discovered subjects are supplied in
  bytewise lexical path order by CLI.
- Diagnostics order by subject, source location, protocol rule order, then code.
- Aggregate precedence is `error` over `fail` over `incomplete`/`partial` over
  `pass`; command-specific legacy exceptions such as advisory Doctor drift are
  represented explicitly, not inferred from severity.
- Static evaluation never executes an evidence command, consults a control
  plane, infers undeclared risk, or performs Human Review.
- Silence or missing evidence never becomes PASS.

## Internal Adapter strategy

Adapters remain behind the CLI or test seam:

| Seam                   | Production Adapter                      | Test Adapter                   | Required real integration coverage                                |
| ---------------------- | --------------------------------------- | ------------------------------ | ----------------------------------------------------------------- |
| Filesystem observation | Node `fs`/`path`                        | object-backed immutable tree   | permissions, symlink/hard-link identity, rename semantics         |
| Child process          | Node `child_process.spawn`              | deterministic scripted process | exact cwd/argv/env, exit/signal, output routing                   |
| Git observation        | guarded `git` process Adapter           | recorded observation           | real temporary repo, refs, index flags, concurrent-change recheck |
| Mutation execution     | sibling staging/rename/recovery         | fault-injecting Adapter        | interruption, partial rename, recovery evidence, cleanup          |
| Template source        | files embedded in the published package | fixture bundle                 | `npm pack` content/provenance and offline execution               |

Batch review records follow the same split (TST-024): Core owns the pure
Revision Sheet and Revision Response validation, same-content judgement, and
target matching, while the CLI adapter owns reading `records/`, symlink and
identity checks, bounded reads, and the create-new write (exclusive temporary
file, `fsync`, then `link` to the final name). The Story's Architecture section
names Core as owning the reads and writes; the filesystem half lives in the CLI
so Core stays free of I/O.

These are real seams because each has at least two Adapters. They are not Core's
external Interface. Tests exercise Core through `evaluate`/`planMutation`, then
exercise CLI Adapters separately and together in black-box parity tests.

## Determinism contract

Given the same:

```text
repository snapshot
external-process observations
configuration
operation input
protocol version
tooling version
```

Core returns the same Semantic Result and mutation plan. Specifically, Core
must not directly depend on clock time, random IDs, locale, filesystem traversal
order, environment variables, network, remote state, prompts, LLMs, or mutable
process-global configuration.

Time, Git, and command results may appear only as supplied observations. CLI
normalizes environment-derived configuration into explicit request fields.
Human output may include presentation context, but JSON contract fields cannot
invent a timestamp or expose non-deterministic duration.

## Version model

Three values remain distinct:

| Value                    | Meaning                                           | Authority                                             |
| ------------------------ | ------------------------------------------------- | ----------------------------------------------------- |
| `toolingVersion`         | Published Core/CLI implementation version         | package metadata/build constant                       |
| `protocolVersion`        | Exact Protocol semantics selected for this result | resolved request/target and bundled Protocol registry |
| `supportedProtocolRange` | Protocol versions proven by this tooling release  | explicit package compatibility metadata               |

Core and CLI use one lockstep tooling version initially. That reduces release
combinations while both Interfaces stabilize; it does not couple tooling version
to Protocol `VERSION`.

The first implementation targets exact Protocol `0.9.0` semantics and declares
`>=0.9.0 <0.10.0` only after every supported patch is covered by the conformance
corpus. A later tool may report, for example:

```json
{
  "toolingVersion": "0.4.2",
  "protocolVersion": "2.1.0",
  "supportedProtocolRange": ">=2.0.0 <3.0.0"
}
```

Protocol selection rules:

1. An explicit exact selector wins.
2. An explicit `adopted` selector resolves the adoption marker or returns a
   configuration error.
3. Omission preserves current behavior by selecting the package's bundled
   current Protocol.
4. Unsupported or malformed versions fail closed; they never select the nearest
   rule set.
5. A marker mismatch is still observable drift for Doctor and does not silently
   alter another command's selected semantics.

Supporting more than one version means registering more than one conformance-
tested Protocol implementation. Do not scatter numeric version comparisons
through parsers.

## Monorepo decision

Adopt a small pnpm workspace when implementation begins:

```text
PraxisBound/
|-- protocol/                   # stays language independent and initially flat
|-- packages/
|   |-- core/
|   |   |-- src/
|   |   `-- tests/
|   `-- cli/
|       |-- src/
|       |-- tests/
|       `-- schemas/
|-- fixtures/
|   `-- parity/
|-- guidance/
|-- specs/
|-- docs/
|-- examples/
|-- scripts/                    # unchanged legacy oracle during migration
|-- package.json                # private workspace root
|-- pnpm-workspace.yaml
|-- pnpm-lock.yaml
`-- tsconfig.base.json
```

Reasons:

- Core and CLI share types and release gates but publish independently named
  packages.
- One lockfile and one root verification integration avoid duplicated tooling.
- Package contents can be tested from tarballs without creating a new GitHub
  repository.
- The structure adds only two public Modules; it does not introduce a plugin
  system or speculative packages.

## npm distribution

Recommended logical packages:

- `@praxisbound/core`: public typed Core Interface and Semantic Result types;
  initially zero third-party runtime dependencies.
- `@praxisbound/cli`: public CLI with `bin: { "praxisbound": "..." }`; runtime
  dependency on the exact lockstep Core version, the published CLI result
  envelope schema, and no other third-party runtime dependency initially.

The supported zero-install spelling is:

```sh
npx @praxisbound/cli init
```

That unpinned spelling is a human convenience: npm may consult the registry,
select the latest dist-tag, and ask before package acquisition. Reproducible
automation pins the tooling version and suppresses the prompt:

```sh
npx --yes @praxisbound/cli@<tooling-version> init
```

After installing a packed or published CLI locally, offline validation invokes
`./node_modules/.bin/praxisbound`; package acquisition itself is not claimed to be
offline. `npx --no-install praxisbound init` may be used as an equivalent local-
binary convenience. The unscoped registry package `forgeflow@0.6.0` was owned by
an unrelated TypeScript CI/CD pipeline compiler when checked on 2026-09-12, so
public docs must not direct users to its unpinned command.
Registry observations:

- <https://registry.npmjs.org/forgeflow> (unrelated `forgeflow@0.6.0`)

Package ownership and provenance are publication prerequisites. If the current
scope is unavailable, substitute one the PraxisBound maintainers demonstrably
control; the Core/CLI architecture and `praxisbound` binary name do not change.
See npm's scope ownership model at <https://docs.npmjs.com/about-scopes/>.

No package is published in this planning phase.

## Node and package-manager policy

As decided on 2026-09-12:

- Consumer engine: `^22.13.0 || ^24.0.0 || ^26.0.0`.
- Node 20 is excluded because it is EOL. Node 22 and 24 are LTS; Node 26 is
  admitted as the current even release and tested before publication.
- CI tests the minimum supported release and latest available patch for every
  admitted major, with Node 24 as the primary development line.
- Dropping a supported Node line is a tooling compatibility change, never
  automatically a Protocol change.
- Development uses an exactly pinned pnpm workspace version and committed root
  lockfile. The current repository precedent is `pnpm@12.0.0`; changing that pin
  is a dedicated dependency/tooling change.
- Consumers use standard npm/npx package installation and never need pnpm.

Official runtime status sources:

- <https://nodejs.org/en/about/previous-releases>
- <https://nodejs.org/en/about/eol>
- <https://github.com/nodejs/Release/blob/main/schedule.json>

## Dependency policy

Initial runtime policy is deliberately zero third-party dependencies in Core and
only Core in CLI:

| Need                | Initial decision                        | Reason                                                             |
| ------------------- | --------------------------------------- | ------------------------------------------------------------------ |
| Restricted YAML     | purpose-built existing-subset parser    | A general parser accepts forms the Protocol intentionally rejects. |
| Markdown            | purpose-built scanner                   | PraxisBound documents an exact subset, not CommonMark.               |
| Schema validation   | development-only validator if needed    | CLI produces known types; consumers receive the JSON Schema.       |
| CLI parsing         | Node `util.parseArgs` plus small router | The command tree is bounded.                                       |
| Filesystem          | Node `fs`/`path`                        | Required safety primitives are built in.                           |
| Terminal formatting | plain output first                      | Color is not a requirement and adds compatibility surface.         |
| Process execution   | Node `child_process.spawn`              | Required for exact cwd/argv/env and streaming control.             |

A runtime dependency requires an implementation ticket to document necessity,
maintenance health, license, package size, transitive surface, deterministic
impact, and rejected built-in alternative. No application framework, remote
service, daemon, MCP, plugin system, or AI dependency enters this migration.

## ForgePilot integration seam

Two modes are intentionally distinct:

```text
Process Boundary
ForgePilot -> `praxisbound ... --json` -> versioned result envelope

Library Boundary
ForgePilot -> public `@praxisbound/core` Interface -> Semantic Result
```

The Process Boundary is the first stable and preferred integration. It isolates
Node module graphs and lets any language consume the same JSON/exit contract.
It must carry enough information that ForgePilot never parses human stdout.

The Library Boundary is appropriate only when ForgePilot shares the supported
Node runtime and needs high-volume in-process evaluation. It uses only package
root exports and supplies immutable observations; it never imports parser,
filesystem, or version-registry internals. Core SemVer then becomes an additional
compatibility dependency.

ForgePilot remains optional. Neither integration permits PraxisBound to read or
own ForgePilot's current lifecycle state. ForgePilot may consume evidence and
results; it does not become part of PraxisBound correctness.

## Architecture constraints inherited from the current Protocol

- `make verify` remains the one repository-owned canonical gate.
- TypeScript packages are optional tooling and therefore do not supersede
  ADR-003. Replacing the portable shell entrypoints with Node requirements would
  be Breaking and would require revisiting ADR-003.
- Static checks stay read-only and never execute target-owned code.
- `verify`/Doctor execution requires explicit user invocation and runs the target
  gate exactly once without retry or repair.
- Handoff stays immutable historical evidence; neither Core nor CLI becomes a
  lifecycle database.
- Architecture analysis remains adopter-owned and out of scope.
