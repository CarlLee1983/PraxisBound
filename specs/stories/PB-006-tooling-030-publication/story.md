# Story: PB-006 Tooling 0.3.0 Publication and Provenance

## Goal

Prepare and verify the `@praxisbound/core` and `@praxisbound/cli` 0.3.0
release, including the first real two-job OIDC publication provenance evidence
and re-observation of the version-pinned agent adoption prompt.

## Context

GitHub issue #81 is the canonical requirement for this Story. FP-51 adds the
Goal Plan artifact public Core surface, so the human selected the additive
tooling release version 0.3.0. PB-005 established and rehearsed the two-job
OIDC publication workflow, but a rehearsal neither uploads a package nor
produces registry provenance. This Story records the first such real
observation without treating a successful workflow as an authorization.

The release uses one candidate SHA and lockstep package coordinates. The
adoption prompt names the exact published CLI version, so changing that text
invalidates TST-020's six human observations and requires their repetition on
the final prompt bytes.

## Classification

- Security sensitive: yes
- Baseline conformance: yes
- Task mode: execution

## Authority

- plan: yes
- modify: yes
- add_dependency: no
- migration: no
- commit: no
- push: no
- deploy: no

## Architecture

- Impact: high
- Decision: `ADR-013`
- Boundary: `public package release and provenance evidence`
- Boundary: `adopter-facing version-pinned agent prompt`
- Boundary: `human publication approval`
- Contract: `Core and CLI publish as immutable exact 0.3.0 package coordinates from one verified candidate SHA; the CLI depends on that exact Core coordinate, and only the approval-gated OIDC publish job may upload its packed artifact`
- Contract: `the agent adoption prompt pins every CLI invocation to the exact published CLI coordinate, and its recorded observations bind to its final prompt bytes`
- Owner: `public package release and provenance evidence = PraxisBound maintainers`
- Owner: `adopter-facing version-pinned agent prompt = PraxisBound maintainers`
- Owner: `human publication approval = human maintainer`

## Risk

- Level: high
- Reason: `public-contract`
- Reason: `dependency-supply-chain`
- Reason: `production-config`
- Reason: `irreversible-publication`

## Scope

### In Scope

- Raise both public package manifests and the CLI's exact Core dependency to
  0.3.0 in one release candidate.
- Update all adopter-facing exact CLI coordinates that describe the current
  published package, including the AI adoption prompt.
- Re-run static prompt validation and all six TST-020 human observations on
  the final prompt bytes.
- Establish local and exact-SHA remote verification evidence for one candidate.
- After separately granted human authorization, observe Core-before-CLI
  OIDC publication, environment approvals, public signature and attestation
  verification, npm provenance, registry integrity, and latest promotion.

### Out of Scope

- New Core or CLI behavior beyond the already implemented FP-51 public API.
- Changing the two-job workflow, npm access settings, Trusted Publisher
  settings, GitHub environment protection, credentials, or npm policy.
- Dispatching a workflow, approving an environment, pushing, creating a tag or
  release, publishing a package, or moving `latest` without separately granted
  human authorization.
- Replacing, unpublishing, or mutating an immutable published package version.

## Inputs

- The 0.2.0 public Core and CLI coordinates and their public registry state.
- FP-51's current public Core exports.
- A human-selected tooling version of 0.3.0.
- Human-maintained GitHub environment and npm Trusted Publisher configuration.
- A final release candidate SHA on `main` after separately authorized commit
  and push.

## Outputs

- A locally verified 0.3.0 candidate with lockstep Core and CLI coordinates.
- A prompt whose every CLI coordinate is 0.3.0, plus six fresh TST-020
  observations on its final bytes.
- When separately authorized and actually observed, immutable publication and
  provenance evidence for both 0.3.0 packages.

## Rules

- R1: Core and CLI package versions are both 0.3.0, and the CLI depends on
  exactly `@praxisbound/core@0.3.0`; no range is acceptable.
- R2: The candidate is verified locally and by a successful `verify.yml` push
  run whose exact head SHA equals the selected candidate SHA.
- R3: The human keeps `main` at that candidate SHA from Core dispatch through
  the successful CLI dispatch. Core publishes before CLI; a partial or
  mismatched result stops for Human Review.
- R4: Only the `npm-publication`-approved publish job with OIDC may publish.
  A rehearsal proves only its token exchange, never a real upload, signature,
  attestation, integrity, or provenance.
- R5: Every agent-prompt command pins `@praxisbound/cli@0.3.0`. All six TST-020
  observations use precisely the final prompt bytes and fresh non-interactive
  sessions; prior or assisted observations do not count.
- R6: A real upload is immutable. After an upload failure or partial release,
  retain evidence and stop; do not overwrite, unpublish, or move `latest` to
  conceal it.
- R7: npm and GitHub configuration, approval, credentials, and the contents of
  settings pages are never recorded in repository evidence.

## Expected Errors

- A source coordinate or CLI dependency differing from 0.3.0 is rejected by
  focused release checks before an external action.
- A changed, incomplete, or assisted prompt observation is not counted as
  TST-020 evidence.
- Missing exact-SHA CI, an absent/rejected environment approval, stale `main`,
  an unpublished Core coordinate before CLI, an integrity mismatch, missing
  signature/attestation, or mismatched provenance blocks the release and is
  recorded without calling it PASS.
- Existing 0.3.0 package coordinates or a partial remote release are stop
  conditions; no existing immutable package or tag is replaced.

## Dependencies

- GitHub issue #81.
- FP-51 supplies the additive Core public API included in this release.
- PB-005 supplies the approved two-job OIDC workflow and rehearsal evidence.
- TST-020 supplies the agent-prompt contract and observation method.

## Constraints

- Add no dependency, change no npm/GitHub configuration, and expose no
  credential or authentication material.
- `make verify` is authoritative for local candidate completion; its pass is
  insufficient for external release or human acceptance.
- External publication operations require a fresh, explicit human grant after
  the candidate and exact SHA have been established.

## Superseded Behavior

- `docs/getting-started.md` AI adoption prompt coordinates that pin 0.2.0 are
  superseded by 0.3.0 only after that version is published and publicly
  verified. Historical 0.2.0 evidence remains historical evidence.

## Trust Boundary Fields

- `candidate_sha` — human-approved exact Git revision for remote CI and both
  package dispatches.
- `npm-publication` — external human decision; a workflow result does
  not fabricate it.
- `registryMetadata` — package registry metadata, signatures, attestations, provenance, integrity,
  and dist-tags — untrusted external observations that must be queried and
  recorded exactly, never inferred from a local package build.
- `tst020Observations` — TST-020 agent transcripts and fixture results are external observations; only
  the stated prompt bytes, fresh-session conditions, and inspected results may
  count as evidence.
