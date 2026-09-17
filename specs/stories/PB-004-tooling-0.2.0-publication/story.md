# Story: PB-004 Tooling 0.2.0 Publication

## Goal

Publish `@praxisbound/core@0.2.0` and `@praxisbound/cli@0.2.0` so that an
adopter acquiring the package path receives the TST-019 adoption next steps,
through the first OIDC-authenticated publication of either package.

## Context

TST-019 (#58) added ordered next steps to `init`, merged in PR #63, but the
published `@praxisbound/cli@0.1.0` predates it. The adopter documentation
therefore qualifies the behavior as available from tooling `0.2.0`, and until
that version exists an adopter following the package path receives no steps.

PB-003 published `0.1.0` with a bootstrap token, then moved both packages to
GitHub Actions Trusted Publishing, required 2FA, disallowed traditional tokens,
and revoked every bootstrap credential. Its own residual risk records that no
OIDC-authenticated publication has yet been observed: `0.2.0` is that first
one, and a trust misconfiguration can only surface now.

PB-003's public evidence covers `init`, `doctor`, `verification check` and
`verify`. `codex activate` has never been exercised from the public registry;
this Story closes that gap.

Tooling and Protocol versions are independent (`ADR-010`). The Protocol is
untouched, so `VERSION` remains `0.10.0`, released and tagged as `v0.10.0`.
Tooling `0.2.0` is an Additive MINOR release before 1.0.

Authority declares `deploy: no` although PB-003 declared `yes`. That is
deliberate: PB-003's agent operated the bootstrap publication, while here every
dispatch, 2FA prompt, and dist-tag write belongs to the human, and Authority
records only what the agent may do.

TST-019's verification record asks for the adopter documentation's "from
tooling version 0.2.0 onward" qualification to be removed once 0.2.0 is
published. This Story supersedes that request and keeps the sentence: it stays
true after publication, and it still tells an adopter pinned to 0.1.0 why no
steps appear.

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
* Decision: `ADR-010`
* Decision: `ADR-011`
* Decision: `ADR-012`
* Boundary: `Core npm package`
* Boundary: `CLI npm package and praxisbound executable`
* Boundary: `npm publication sequence`
* Contract: `Core and CLI declare one exact tooling version 0.2.0, independent of Protocol VERSION 0.10.0, and CLI depends on the exact Core version`
* Contract: `publication runs only from one approved main SHA with passing local verification and exact-SHA remote verification, the latter enforced by publish.yml itself, authenticates by OIDC with no stored token, and publishes Core to next before CLI`
* Contract: `latest moves to 0.2.0 only by an explicit human dist-tag write after next passes public smoke`
* Owner: `Core npm package = PraxisBound Reference Tooling`
* Owner: `CLI npm package and praxisbound executable = PraxisBound Reference Tooling`
* Owner: `npm publication sequence = Human Review and package maintainer`

## Risk

* Level: high
* Reason: `public-contract`
* Reason: `dependency-supply-chain`
* Reason: `irreversible-publication`

## Scope

### In Scope

* Raise both package manifests and the exact CLI-to-Core dependency to
  `0.2.0`, with the lockfile, version-pinned tests, and the current-coordinate
  documentation that follow from them.
* Document the subsequent-release procedure the runbook lacks: publishing an
  existing package by OIDC, and promoting `latest` by explicit human action.
* Human dispatch of `publish.yml` for Core, then CLI, from the approved merge
  SHA; public smoke of both at the exact version, including `init` emitting
  next steps and `codex activate` preview and apply.
* Human promotion of `latest` to `0.2.0` after that smoke, and a final smoke
  against `latest`.
* A static test holding `publish.yml` to the guards this Story's security
  fixtures rely on.
* `scripts/publish-dispatch`, a helper the human runs to perform one dispatch:
  it re-checks the candidate, CI, concurrency and registry state, requires the
  exact coordinate typed as confirmation, dispatches, and follows the run to
  the registry. It never writes a dist-tag.

### Out of Scope

* Any Protocol change, `VERSION` change, or Protocol tag or GitHub Release.
* Agent dispatch of the publish workflow, agent dist-tag writes, or agent
  inspection of npm or GitHub credential and access-settings pages.
* Republishing, unpublishing, or deprecating `0.1.0`.
* New dependencies, new commands, or changes to command semantics.
* A tooling tag or GitHub Release for `0.2.0`; tooling versions have none.

## Inputs

* The merged TST-019 implementation on `main`.
* The exact merge SHA of this Story's version change, its local `make verify`
  result, and its exact-SHA `verify.yml` run.
* Registry metadata, provenance, and dist-tags for both packages before and
  after publication.

## Outputs

* `@praxisbound/core@0.2.0` and `@praxisbound/cli@0.2.0` on npm with OIDC
  provenance naming the approved SHA and `publish.yml`.
* `latest` resolving to `0.2.0` for both packages after human promotion.
* A verification record of the dispatches, provenance, tags, and public smoke.

## Rules

* R1: Both packages declare exactly `0.2.0`; CLI's only runtime dependency is
  exact `@praxisbound/core@0.2.0`. Protocol `VERSION` stays `0.10.0`.
* R2: Publication dispatches `publish.yml` from `main` with the full 40-character
  lowercase merge SHA, `core` first. CLI is dispatched only after Core `0.2.0` is
  public and has passed smoke. `main` stays frozen at that SHA until the CLI
  dispatch succeeds; if anything merges first, stop for Human Review instead of
  publishing CLI from a different revision.
* R3: Authentication is OIDC only. No `NPM_TOKEN` or `NODE_AUTH_TOKEN` secret is
  added to make a publish succeed. An OIDC failure stops for Human Review.
* R4: Existing packages are published to `next`. `latest` stays at `0.1.0` until
  a human runs `npm dist-tag add` for `0.2.0` after `next` passes public smoke.
* R5: Public smoke runs in a credential-isolated npm-only consumer at the exact
  version and, after promotion, at `latest`. It covers root imports, help and
  version, `init` apply emitting `data.nextSteps`, Doctor, verification check,
  verify, and `codex activate` preview and apply, with installed-binary network
  calls denied after acquisition.
* R6: An immutable version is never overwritten. A failed or defective `0.2.0`
  is left in place for review, `latest` is not moved to it, and any fix ships
  as a new patch version.
* R7: The agent prepares, verifies, and records. Dispatch, 2FA, dist-tag writes,
  and any credential or access-settings inspection belong to the human.

## Expected Errors

* A dispatch whose `candidate_sha` is short, non-lowercase, or differs from the
  checked-out `main` revision fails at the candidate guard before any build.
* A dispatch for an already-published version fails at the unused-version check
  and publishes nothing.
* A CLI dispatch before Core `0.2.0` is public fails at the order check.
* An OIDC authentication failure at `npm publish` leaves the version unpublished
  and stops for Human Review without falling back to a token.
* A dispatch whose candidate has no successful `verify.yml` push run on `main`
  fails at the remote verification guard before any build.

## Dependencies

* TST-019 is merged on `main` through PR #63.
* PB-003 established OIDC Trusted Publishing and credential revocation for both
  packages.
* Protocol `0.10.0` is released and tagged as `v0.10.0` through PR #64.

## Constraints

* Add no dependency. Do not dispatch, publish, write dist-tags, or inspect
  credentials as the agent.
* Keep every fixture inside the test's temporary directory.
* `make verify` is authoritative for local completion; publication evidence is
  external and recorded only when actually observed.

## Guidance

Relevant:

* principle: small coherent changes
* practice: `docs/releasing.md` is the publication runbook
* decision: `ADR-010` keeps tooling and Protocol versions independent

Not applicable:

* no persistent-data migration or Protocol change applies

## Trust Boundary Fields

* `publish.candidate-sha` — human-supplied workflow dispatch input
* `publish.dispatch-ref` — branch the workflow is dispatched from
* `publish.package` — human-selected package choice
* `npm.package-version` — immutable registry version being published
* `npm.authorization` — OIDC identity or any stored publication credential
* `npm.provenance` — registry and build provenance statement
* `npm.dist-tags` — registry-resolved `next` and `latest`
* `package.manifest` — packed package metadata and exact dependency
* `publish.workflow` — the committed publication workflow and its guards

## Superseded Behavior

* `tests/typescript-tooling.sh installed CLI reports 0.1.0` — replaced by the packed version 0.2.0.
* `packages/cli/test/root-and-bin.test.mjs help banner v0.1.0 and version output 0.1.0` — replaced by v0.2.0 and 0.2.0.
* `packages/cli/test/activation-command.test.mjs version output 0.1.0` — replaced by 0.2.0.
* `docs/typescript-tooling/forgepilot-integration.md current coordinate 0.1.0` — replaced by 0.2.0.
