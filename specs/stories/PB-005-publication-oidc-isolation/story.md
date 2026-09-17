# Story: PB-005 Publication OIDC Isolation

## Goal

Publishing a PraxisBound package never lets repository or dependency code run
where an npm OIDC credential can be minted, every publication waits for a human
approval enforced by GitHub, and the publication and verification workflows set
up from one shared definition instead of two copies that drift.

## Context

GitHub issue #73 specifies this work. PB-004's Human Review on 2026-09-17
accepted two residual risks and tracked them there: `publish.yml` grants
`id-token: write` to the one job that installs development dependencies, runs
`make verify` and publishes a package directory, whose lifecycle scripts rebuild
the CLI with pnpm; and `publish.yml` duplicates `verify.yml`'s setup, which
already drifted once and surfaced only as a failed release (#66).

`ADR-013` records the design this Story implements, settled in a design review
on 2026-09-17. Facts it rests on were checked against npm documentation and
npm/cli source: `npm publish <tarball>` authenticates through OIDC and runs no
package lifecycle script; provenance records the run and the tarball digest but
not the job; npm validates the calling workflow's filename, so the publishing
job stays in `publish.yml`; a Trusted Publisher entry may gain an environment
name at any time; `npm publish --dry-run` performs the OIDC token exchange but
reports its outcome only in verbose logs. How the registry treats an environment
mismatch is not documented, so it is observed by rehearsal rather than assumed.

This is not a hard prerequisite for the next tooling release. The risks are
recorded and accepted; whether to finish this first is decided when a release is
planned, so that an urgent patch cannot be blocked by it.

Tooling and Protocol versions are untouched: no package version changes, and
`VERSION` remains `0.10.0`.

## Classification

* Security sensitive: yes
* Baseline conformance: yes
* Task mode: mixed

## Authority

* plan: yes
* modify: yes
* add_dependency: no
* migration: no
* commit: yes
* push: yes
* deploy: no

## Architecture

* Impact: high
* Decision: `ADR-013`
* Decision: `ADR-010`
* Boundary: `publication pack job`
* Boundary: `publication publish job`
* Boundary: `shared verification setup`
* Boundary: `publication dispatch helper`
* Boundary: `npm-publication environment and Trusted Publisher entries`
* Contract: `only the publish job holds id-token write, and it checks out nothing, installs nothing and executes no repository or dependency code`
* Contract: `the published tarball is the pack job's artifact, proven by an sha512 comparison between jobs and against the registry integrity after publication`
* Contract: `every dispatch, rehearsal included, waits for approval of the npm-publication environment`
* Contract: `a rehearsal never reaches a real npm publish`
* Owner: `publication pack job = PraxisBound maintainers`
* Owner: `publication publish job = PraxisBound maintainers`
* Owner: `shared verification setup = PraxisBound maintainers`
* Owner: `publication dispatch helper = PraxisBound maintainers`
* Owner: `npm-publication environment and Trusted Publisher entries = Human Review and package maintainer`

## Risk

* Level: high
* Reason: `dependency-supply-chain`
* Reason: `production-config`

## Scope

### In Scope

* Split `publish.yml` into a pack job without `id-token` and a publish job with
  `id-token: write` in environment `npm-publication`, both conditioned on
  `main`.
* Pack job: candidate and exact-SHA `verify.yml` guards before any install,
  shared setup with the pnpm cache disabled, `make verify`, `npm pack` of the
  selected package only, its sha512 as a job output, and the tarball uploaded
  as an artifact.
* Publish job: no checkout and no install; Node 24 with the npm version check;
  download the artifact and refuse an sha512 mismatch; read name, version and
  Core dependency from the tarball's `package.json`; unused-version,
  Core-before-CLI and exact-Core-dependency guards on those values;
  `npm publish <tarball> --tag next --access public --provenance`; afterwards
  compare the registry integrity with the digest and write both to the run
  summary.
* A boolean `rehearsal` dispatch input, default false: the same jobs and
  approval, every guard except unused-version, which is reported rather than
  enforced, then `npm publish <tarball> --dry-run --loglevel verbose` that fails
  unless the log shows the OIDC token was retrieved.
* A composite action `.github/actions/setup-verification` used by `verify.yml`'s
  `verify` job and the pack job, with a `cache` input; the deliberate cache
  difference explained in the action.
* `scripts/publish-dispatch` printing that the run awaits `npm-publication`
  approval, with the run URL, after dispatching.
* Static tests holding the workflow split, the guards, the rehearsal boundary,
  the shared setup and the helper message; `make verify-actions` linting the
  composite action.
* `docs/releasing.md` section 8 updated for the approval step, the rehearsal,
  and the human setup order.
* Human steps, in order: create environment `npm-publication` with the
  maintainer as required reviewer, self-approval allowed, deployments limited to
  `main`, before any dispatch of the new workflow; merge; dispatch a rehearsal;
  add the environment name to both npm Trusted Publisher entries; dispatch a
  rehearsal again.

### Out of Scope

* Publishing any package version, writing dist-tags, or changing package
  versions or Protocol `VERSION`.
* A rehearsal mode in `scripts/publish-dispatch`; the maintainer dispatches a
  rehearsal with `gh workflow run` or the GitHub interface.
* Agent creation, configuration or inspection of the GitHub environment, npm
  Trusted Publisher entries, or any credential or access-settings page.
* Changing `verify.yml`'s `tooling-compatibility` or `portability` jobs, or the
  adopter CI template `templates/ci/github-actions.yml`.
* New dependencies. Pinned GitHub Actions for artifact transfer are workflow
  infrastructure, not package dependencies, and are pinned by full SHA like the
  existing actions.

## Inputs

* The current `publish.yml`, `verify.yml`, `scripts/publish-dispatch` and their
  tests on `main`.
* The npm Trusted Publisher entries for both packages, restricted to
  `CarlLee1983/PraxisBound` and `publish.yml`, as recorded by PB-003.
* The maintainer's GitHub environment and npm settings actions and the rehearsal
  runs they dispatch.

## Outputs

* A two-job `publish.yml` with a rehearsal mode.
* `.github/actions/setup-verification/action.yml`, used by both workflows.
* An updated dispatch helper, runbook and static tests.
* Two recorded successful rehearsal runs: before and after the npm Trusted
  Publisher entries gain the environment name.

## Rules

* R1: Only the publish job holds `id-token: write`. The workflow-level
  permissions grant no `id-token`.
* R2: The publish job has no checkout step, runs no package manager install, no
  `make`, and no script from the repository; its only package-derived input is
  the downloaded tarball.
* R3: The publish job publishes exactly the tarball the pack job produced in the
  same run: it refuses when the recomputed sha512 differs from the pack job's
  output, and after a real publication it fails when the registry integrity for
  that version differs.
* R4: The coordinates the publish-job guards check are read from the tarball's
  `package.json`, never from a checkout.
* R5: The candidate guard and the exact-SHA `verify.yml` guard run in the pack
  job before any dependency install, exactly as PB-004 enforces them.
* R6: Both jobs run only for `refs/heads/main`, and the publish job runs in
  environment `npm-publication`.
* R7: A rehearsal skips only the unused-version enforcement, reporting its
  result. It runs `npm publish --dry-run` and fails unless verbose output shows
  the OIDC token exchange succeeded. No path with `rehearsal` true runs a
  publish without `--dry-run`, and a real publication never passes `--dry-run`.
* R8: `verify.yml`'s `verify` job and the pack job set up through the same
  composite action. The pack job disables the pnpm cache.
* R9: Authentication stays OIDC only. No `NPM_TOKEN` or `NODE_AUTH_TOKEN` is
  referenced by either workflow or the composite action.
* R10: The agent prepares, verifies and records. Environment and Trusted
  Publisher configuration, dispatch, approval and inspection of settings pages
  belong to the human.

## Expected Errors

* A dispatch whose candidate is malformed, differs from `main`, or lacks a
  successful exact-SHA `verify.yml` push run fails in the pack job before any
  install, and the publish job never starts.
* A tarball whose recomputed sha512 differs from the pack job's output is
  refused before any npm command authenticates.
* A real dispatch for an already-published version, or a CLI whose Core version
  is not public, or a CLI tarball whose Core dependency is not the exact Core
  version, fails in the publish job before `npm publish`.
* A rejected or unapproved environment approval leaves the publish job unrun and
  nothing published.
* A rehearsal whose OIDC exchange fails, including one caused by an environment
  mismatch with the npm Trusted Publisher entry, fails the run; it does not pass
  on a zero exit status alone.
* A real publication whose registry integrity differs from the artifact digest
  fails the run after publication and is left in place for Human Review under
  PB-004 R6; the immutable version is never overwritten.

## Dependencies

* `ADR-013` is accepted and records the design this Story implements.
* PB-003 established Trusted Publishing for both packages; PB-004 added the
  exact-SHA `verify.yml` guard (#72) and the dispatch helper.
* Issue #73 carries the approved scope.

## Constraints

* Add no package dependency, and do not publish, dispatch, approve, write
  dist-tags, or configure or inspect access settings as the agent.
* Keep every test fixture inside the test's temporary directory.
* `make verify` is authoritative for local completion. Rehearsal evidence is
  external and recorded only when actually observed.
* Pin every added GitHub Action by full commit SHA.

## Guidance

Relevant:

* principle: small coherent changes
* practice: `docs/releasing.md` is the publication runbook
* decision: `ADR-013` defines the job split and the rehearsal boundary

Not applicable:

* no persistent-data migration, package version change or Protocol change
  applies

## Trust Boundary Fields

* `publish.candidate-sha` — human-supplied workflow dispatch input
* `publish.dispatch-ref` — branch the workflow is dispatched from
* `publish.package` — human-selected package choice
* `publish.rehearsal` — human-selected dispatch mode
* `publish.artifact` — tarball passed from the pack job to the publish job
* `publish.artifact-digest` — sha512 output of the pack job
* `publish.environment-approval` — human approval of `npm-publication`
* `npm.package-version` — version read from the tarball manifest
* `npm.authorization` — OIDC identity or any stored publication credential
* `npm.integrity` — registry-reported integrity after publication
* `publish.workflow` — the committed publication workflow and its guards
* `ci.setup` — the shared composite setup action

## Superseded Behavior

* `tests/protocol.sh verify.yml terms node-version-file: .node-version, require-lockfile: true, pnpm --dir examples/typescript install --frozen-lockfile, go-version-file: examples/go/go.mod, go -C examples/go mod download` — these setup lines move into `.github/actions/setup-verification/action.yml`, and the check follows them there while `verify.yml` must use the action.
* `tests/protocol.sh PB004-AC-008 guard [ "$(npm view "@praxisbound/core@$CORE_VERSION" version)" = "$CORE_VERSION" ]` — replaced by the Core-before-CLI guard reading the Core version from the tarball manifest.
* `tests/protocol.sh PB004-AC-008 guard npm publish "./packages/$PACKAGE" --tag next --access public --provenance` — replaced by publishing the downloaded tarball.
* `tests/protocol.sh PB004-AC-008 id-token: write anywhere in publish.yml` — narrowed to the publish job only, with no workflow-level grant.
* `tests/protocol.sh PB004-AC-008 fetch-depth: 0 in publish.yml` — held for the pack job, which runs make verify; the publish job has no checkout.
* `docs/releasing.md section 8 dispatch-then-watch procedure` — gains the environment approval, the rehearsal and the human setup order.
