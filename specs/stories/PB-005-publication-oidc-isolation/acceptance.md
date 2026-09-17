# Acceptance Criteria

## Happy Path

* [ ] AC-001: `publish.yml` has a pack job and a publish job, both conditioned on
  `refs/heads/main`. Only the publish job declares `id-token: write`, the
  workflow-level permissions grant no `id-token`, and the publish job runs in
  environment `npm-publication`.
* [ ] AC-002: The pack job runs the candidate and exact-SHA `verify.yml` guards
  before any install, sets up through the shared composite action with the pnpm
  cache disabled, runs `make verify`, packs only the selected package, exposes
  the tarball's sha512 as a job output, and uploads the tarball as an artifact.
* [ ] AC-003: The publish job has no checkout, install, `make` or repository
  script step. It downloads the artifact, refuses an sha512 different from the
  pack job's output, publishes that tarball with
  `--tag next --access public --provenance`, and after publication fails unless
  the registry integrity for the version matches the digest, writing both to
  the run summary.

## Business Rules

* [ ] AC-004: The publish job reads name, version and Core dependency from the
  tarball's `package.json` and, before any npm command authenticates, refuses an
  already-published version, a CLI whose Core version is not public, and a CLI
  whose Core dependency is not the exact Core version.
* [ ] AC-005: With `rehearsal` true the run performs the same jobs, approval and
  guards except unused-version, which is reported and not enforced; it runs
  `npm publish <tarball> --dry-run --loglevel verbose` and fails unless the
  output shows the OIDC token was retrieved. No step reachable with `rehearsal`
  true publishes without `--dry-run`, and the real publish step never runs when
  it is true.
* [ ] AC-006: `verify.yml`'s `verify` job and the pack job use
  `.github/actions/setup-verification`; the action carries the setup lines
  `verify.yml` previously held and explains the pack job's disabled cache;
  `make verify-actions` lints it; neither workflow nor the action references
  `NPM_TOKEN` or `NODE_AUTH_TOKEN`.
* [ ] AC-007: After a confirmed dispatch, `scripts/publish-dispatch` prints that
  the run awaits approval of environment `npm-publication`, with the run URL,
  before watching it. Every existing refusal still dispatches nothing and the
  helper still never writes a dist-tag.
* [ ] AC-008: `docs/releasing.md` section 8 documents the environment approval,
  the rehearsal and how to read its result, and the human setup order: create
  the environment before the first dispatch, rehearse, add the environment to
  both npm Trusted Publisher entries, rehearse again.

## Failure Cases

* [ ] AC-009: Executing the publish job's guard and digest logic against local
  fixtures with fake `npm` shows each refusal in AC-003, AC-004 and AC-005: a
  mismatched digest, a published version on a real run, a CLI before Core, a CLI
  with a non-exact Core dependency, a registry integrity mismatch, and a
  rehearsal whose verbose output lacks the OIDC success line. Each refusal runs
  no real publish.

## Regression Requirements

* [ ] AC-010: `make verify` passes locally and in the pull request's `verify.yml`
  run, which exercises the shared composite action.
* [ ] AC-011: After the human creates environment `npm-publication` and the
  change is merged, a rehearsal dispatched from `main` succeeds with the OIDC
  exchange observed; after the human adds the environment name to both npm
  Trusted Publisher entries, a second rehearsal from `main` succeeds for both
  `core` and `cli`.

## Acceptance Evidence

| AC | Method | Evidence | Fixture / precondition | Expected observation |
| --- | --- | --- | --- | --- |
| `AC-001` | test | `tests/protocol.sh PB005-AC-001` | `.github/workflows/publish.yml` | `two main-only jobs; id-token write appears only in the publish job; no workflow-level id-token; publish job environment npm-publication` |
| `AC-002` | test | `tests/protocol.sh PB005-AC-002` | `.github/workflows/publish.yml` | `pack job orders both candidate guards before the setup action, uses cache false, runs make verify, packs one package, outputs sha512 and uploads the artifact` |
| `AC-003` | test | `tests/protocol.sh PB005-AC-003` | `.github/workflows/publish.yml` | `publish job has no checkout, install, make or repository script; downloads, compares sha512, publishes the tarball, compares registry integrity and writes the summary` |
| `AC-004` | test | `tests/publication-workflow.sh PB005-AC-004` | `publish job guard logic run against fixture tarballs with fake npm` | `published version, CLI before Core and non-exact Core dependency are each refused before any authenticating npm command` |
| `AC-005` | test | `tests/publication-workflow.sh PB005-AC-005` | `publish job logic with rehearsal true and false, fake npm recording its arguments` | `rehearsal reports but does not enforce unused-version, invokes only a dry-run publish, fails without the OIDC success line; a real run never passes dry-run` |
| `AC-006` | test | `tests/protocol.sh PB005-AC-006` | `verify.yml, publish.yml, the composite action and the Makefile` | `both jobs use the action, the setup terms live in it, the cache rationale is present, verify-actions lints it, and no stored npm credential is referenced` |
| `AC-007` | test | `tests/publish-dispatch.sh PB005-AC-007` | `fake gh and npm on PATH with no network or credential` | `confirmed dispatch prints the npm-publication approval notice and run URL; existing refusals and the no-dist-tag case still pass` |
| `AC-008` | test | `tests/protocol.sh PB005-AC-008` | `docs/releasing.md` | `section 8 names the npm-publication approval, the rehearsal and its OIDC result, and the four-step human setup order` |
| `AC-009` | test | `tests/publication-workflow.sh PB005-AC-009` | `local fixture tarballs, a mismatched digest, fake npm responses` | `each listed refusal fails with its own message and no real publish invocation is recorded` |
| `AC-010` | command | `make verify` | `current checkout and the pull request verify.yml run` | `exit 0 locally and success for every verify.yml job on the pull request head` |
| `AC-011` | human | `PB-005 rehearsal record` | `environment npm-publication created by the human before the first dispatch; change merged to main` | `rehearsal runs for core and cli succeed with the OIDC success line before and after the npm Trusted Publisher entries gain the environment name` |

## Security Fixture Matrix

| Source field | Payload | Expected result | Persisted locations | Verification |
| --- | --- | --- | --- | --- |
| `publish.candidate-sha` | `main SHA whose verify.yml push run did not succeed` | reject | `pack job guard, before any install; publish job never starts` | `tests/protocol.sh PB005-AC-002` |
| `publish.dispatch-ref` | `release/tooling-0.3.0` | reject | `both job conditions; no job runs` | `tests/protocol.sh PB005-AC-001` |
| `publish.rehearsal` | `true on an unpublished version` | preserve | `dry-run publish only; registry unchanged` | `tests/publication-workflow.sh PB005-AC-005` |
| `publish.artifact` | `tarball altered after the pack job` | reject | `publish job digest comparison, before npm authenticates` | `tests/publication-workflow.sh PB005-AC-009` |
| `publish.artifact-digest` | `sha512 differing from the downloaded tarball` | reject | `publish job digest comparison` | `tests/publication-workflow.sh PB005-AC-009` |
| `publish.environment-approval` | `approval rejected by the reviewer` | reject | `GitHub environment gate; publish job never runs` | `PB-005 rehearsal record` |
| `npm.package-version` | `0.2.0 on a real run` | reject | `publish job unused-version guard reading the tarball manifest` | `tests/publication-workflow.sh PB005-AC-004` |
| `npm.authorization` | `NODE_AUTH_TOKEN reference in publish.yml or the setup action` | reject | `.github/workflows/publish.yml; .github/actions/setup-verification/action.yml` | `tests/protocol.sh PB005-AC-006` |
| `npm.authorization` | `Trusted Publisher environment differing from the job environment` | reject | `npm OIDC exchange, observed in rehearsal verbose output` | `PB-005 rehearsal record` |
| `npm.integrity` | `registry integrity differing from the artifact digest` | reject | `publish job post-publication check and run summary` | `tests/publication-workflow.sh PB005-AC-009` |
| `publish.workflow` | `id-token write added to the pack job` | reject | `.github/workflows/publish.yml` | `tests/protocol.sh PB005-AC-001` |
| `publish.workflow` | `checkout step added to the publish job` | reject | `.github/workflows/publish.yml` | `tests/protocol.sh PB005-AC-003` |
| `ci.setup` | `pnpm cache enabled for the pack job` | reject | `.github/workflows/publish.yml` | `tests/protocol.sh PB005-AC-002` |

## Verification Notes

Run `./scripts/story-check --ready` and `./scripts/verification-check` for this
Story before implementation. `tests/publication-workflow.sh` is a new suite: it
extracts the publish job's `run` blocks from `publish.yml` and executes them
under `sh` against fixtures in its temporary directory, with fake `npm` and no
network or credential, so the logic under test is the committed workflow text,
not a copy. Dispatch every case through `run_case`. Wire the suite into
`make verify`. Mutation-check at least the digest comparison, the rehearsal
dry-run branch and the job-scoped `id-token` assertion. AC-011 is an external
observation after the human's setup and dispatch; this Story stays partial until
it is recorded. The first real upload and provenance signature under the new
structure is not observable here and must be an acceptance criterion of the next
publication Story. Never record credential values or settings-page contents.
