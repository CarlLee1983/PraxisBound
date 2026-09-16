# Story: TST-015 npm Package and Clean Consumer Validation

## Goal

Prove that packed Core and CLI artifacts are installable and reproducible for
clean npm consumers across the supported Node and operating-system matrix.

## Context

GitHub issue #40 follows completed TST-011 and TST-014. The packages already
build and have repository-local pnpm pack coverage, but release readiness still
requires npm-native package creation, clean npm-only consumers, reproducible
version-pinned acquisition, post-acquisition offline execution, namespace
control evidence, provenance metadata, and the supported Node/Linux/macOS
matrix.

## Classification

* Security sensitive: yes
* Baseline conformance: yes
* Task mode: execution

## Authority

* plan: yes
* modify: yes
* add_dependency: no
* migration: no
* commit: no
* push: no
* deploy: no

## Architecture

* Impact: high
* Boundary: `Core npm package`
* Boundary: `CLI npm package and forgeflow executable`
* Boundary: `npm consumer verification`
* Contract: `Core exposes only its package root and has no runtime dependency; CLI exposes only its package root and forgeflow bin and depends on the exact lockstep Core version`
* Contract: `automated acquisition uses the exact @forgeflow/cli tooling version while offline claims begin only after acquisition and use the installed local binary`
* Contract: `package release requires controlled scoped names and verifiable source/build provenance without using the unrelated unscoped forgeflow package`
* Owner: `Core npm package = ForgeFlow TypeScript tooling`
* Owner: `CLI npm package and forgeflow executable = ForgeFlow TypeScript tooling`
* Owner: `npm consumer verification = ForgeFlow TypeScript tooling`

## Risk

* Level: high
* Reason: `public-contract`
* Reason: `dependency-supply-chain`

## Scope

### In Scope

* Prove control of the selected npm scope as a separately observable release
  prerequisite without publishing either package.
* Create Core and CLI tarballs with npm, verify their exact allowlisted files,
  root exports, lockstep version and dependency metadata, executable bin and
  shebang, license, readme, engine policy, repository identity, and provenance
  publication policy.
* Install the tarballs into disposable clean consumers with npm only and run
  help, JSON static checks, canonical verification, and init from the installed
  CLI.
* Exercise exact-version `npx --yes @forgeflow/cli@<tooling-version>`
  acquisition against a disposable package source, then separately run the
  installed local binary with network entry points disabled.
* Test the admitted Node 22, 24, and 26 minimum/latest lines on Linux and macOS.

### Out of Scope

* npm publication, dist-tag writes, package-name or scope acquisition, GitHub
  release creation, Protocol version changes, or a release workflow.
* The unrelated unscoped `forgeflow` registry package, Windows support, a new
  package manager, or a new runtime/development dependency.
* Changing command semantics, switching compatibility entrypoints, removing a
  legacy implementation, or adding ForgePilot integration.

## Inputs

* Core and CLI package manifests, compiled output, package readmes and licenses,
  and the CLI's bundled Protocol snapshot and provenance manifest.
* npm pack metadata and tarballs produced from the package workspaces.
* The selected npm scope and an authenticated maintainer's organization role or
  equivalent package-creation permission observation.
* Clean npm consumer directories, an exact tooling version, and the supported
  Node/Linux/macOS CI matrix.

## Outputs

* Reproducible package-content and provenance observations for both tarballs.
* Passing clean npm consumer results for help, machine checks, verification,
  init, pinned acquisition, and network-disabled installed-binary execution.
* CI coverage for every supported Node minimum/latest line on Linux and macOS.
* A retained blocked result when namespace control or remote CI cannot be
  observed without maintainer/external-system authority.

## Rules

* R1: The selected coordinates remain `@forgeflow/core` and `@forgeflow/cli`,
  the CLI exposes `forgeflow`, and the two packages use one exact tooling
  version independently of Protocol `VERSION`.
* R2: Core has no runtime dependency. CLI's only runtime dependency is the exact
  Core version. Each package exports only `.`, contains only its allowlisted
  package surface, and declares public scoped publication with provenance and
  its exact source repository directory.
* R3: Consumer engines are exactly `^22.13.0 || ^24.0.0 || ^26.0.0`; CI covers
  the minimum and latest available release of Node 22, 24, and 26 on Linux and
  macOS. Windows remains unsupported until separately specified and tested.
* R4: A clean consumer requires npm/npx only. Repository development and
  package build may retain the pinned pnpm workspace, but no clean-consumer
  fixture may require pnpm or a source-checkout import.
* R5: Reproducible automation names
  `npx --yes @forgeflow/cli@<tooling-version>`. Unpinned scoped npx is labeled a
  human convenience, and documentation never recommends unscoped
  `npx forgeflow` while the unrelated package owns that name.
* R6: Package acquisition is a network/package-source operation. Offline
  guarantees begin only after acquisition and are proved by direct invocation
  of `./node_modules/.bin/forgeflow` with network entry points disabled.
* R7: An npm registry `E404` does not prove scope control. Release remains
  blocked until a maintainer-authenticated observation proves organization
  control and package-creation authority without exposing credentials.
* R8: This is Additive Reference Tooling validation. It changes no artifact
  under `protocol/` or `templates/` and requires no adopter migration.

## Expected Errors

* An unexpected tarball member, missing package artifact, manifest mismatch,
  invalid export, non-executable or invalid-shebang bin, provenance mismatch,
  package install failure, or consumer command failure fails the package gate.
* An unpinned acquisition, accidental unscoped coordinate, pnpm-dependent
  consumer, or network access during the offline phase fails the consumer gate.
* Missing npm organization evidence or unavailable remote matrix execution is
  retained as blocked evidence and cannot be rounded up to release readiness.

## Dependencies

* TST-011 local release inspection and TST-014 Codex activation.
* The package boundaries established by TST-001 and the npm distribution
  decision recorded in `specs/decisions/ADR-006-npm-distribution.md`.
* npm/npx supplied by each supported Node release and the existing pinned pnpm
  workspace used only to build and verify the repository.

## Constraints

* Do not publish, change a dist-tag, acquire or rename a package/scope, create a
  release, change Protocol `VERSION`, commit, push, deploy, migrate, or add a
  dependency.
* Do not read, copy, print, persist, or weaken isolation for npm credentials.
  Scope-control evidence records only the selected scope, observer authority,
  observation method, time, and pass/blocked result.
* Keep fixtures disposable and outside this repository's Stories, handoff, and
  worktree as the subject under test.

## Guidance

Relevant:

* principle: small coherent changes
* principle: explicit dependencies
* principle: behavior-oriented testing
* principle: deep module interface

Not applicable:

* no persistent-data or migration guidance applies

## Trust Boundary Fields

* `npm.scope` — selected external registry namespace
* `npm.package-name` — requested Core or CLI package coordinate
* `npm.package-version` — requested tooling version
* `npm.registry-url` — caller or environment selected acquisition service
* `npm.packument` — registry-supplied package metadata
* `npm.dist.tarball` — registry-supplied tarball URL
* `npm.dist.integrity` — registry-supplied package integrity
* `npm.dist.shasum` — registry-supplied package checksum
* `npm.tarball-bytes` — acquired executable package bytes
* `npm.request.authorization` — credential-bearing registry request header
* `process.env.NODE_AUTH_TOKEN` — inherited npm bearer credential
* `process.env.NPM_TOKEN` — inherited npm bearer credential
* `process.env.npm_config_userconfig` — inherited npm configuration path
* `process.env.npm_config_registry` — inherited npm registry selection
* `process.env.HTTP_PROXY` — inherited network proxy selection
* `process.env.HTTPS_PROXY` — inherited network proxy selection
* `package.manifest` — packed package metadata and lifecycle declarations
* `package.bin` — acquired CLI executable path and bytes

## Superseded Behavior

* `package.json and packages/*/package.json Node 20 engine allowance` — Node 20
  is replaced by the approved Node 22/24/26 consumer policy.
* `.github/workflows/verify.yml tooling-compatibility job on Ubuntu only` —
  package consumer coverage moves to the supported Linux/macOS matrix.
* `tests/typescript-tooling.sh pnpm clean-consumer fixture` — release validation
  is replaced by npm-native tarball creation and npm-only consumer evidence.

## Later Supersession

This Story's `@forgeflow` namespace identity clauses were themselves superseded
after acceptance. `AC-001` was never proven and stays blocked; it was not
retried under this Story.

* `@forgeflow/core, @forgeflow/cli, and the forgeflow executable` — superseded
  by the maintainer-controlled `@praxisbound/core`, `@praxisbound/cli`, and
  `praxisbound` identity decided in
  [ADR-011](../../decisions/ADR-011-praxisbound-identity-and-migration.md).
* `AC-001 npm scope control` — the equivalent obligation is carried by
  `AC-004` of `specs/stories/PB-003-npm-distribution/`, which passed with
  authenticated organization-owner evidence for `@praxisbound`.

The package-content, clean-consumer, acquisition, and offline fixtures this
Story built were retained and reused by PB-003; only the namespace identity was
replaced. This Story's result remains `VERIFICATION_PARTIAL`.
