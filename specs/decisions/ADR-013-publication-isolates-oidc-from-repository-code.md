# ADR-013: Publication isolates OIDC from repository code

* Status: accepted
* Date: 2026-09-17

## Context

`publish.yml` publishes `@praxisbound/core` and `@praxisbound/cli` through npm
Trusted Publishing: the workflow run exchanges a GitHub OIDC token for a
short-lived npm credential, and no stored token exists. Until this decision the
workflow had one job, granted `id-token: write` for the whole workflow, and that
job installed the tooling and example dependencies, ran `make verify`, and ran
`npm publish ./packages/<package>`. Publishing a directory runs the package's
lifecycle scripts, and the CLI's `prepack` rebuilds it with pnpm. Every
development dependency therefore executed where an OIDC token could be minted.
PB-004's Human Review accepted that as a residual risk and tracked it in #73.

The same job also duplicated `verify.yml`'s setup. The two files drifted once:
`publish.yml` kept a shallow checkout that `verify.yml` no longer used, and
because `publish.yml` runs only during a real publication, the drift surfaced as
a failed release (#66). The guard against a repeat was a grep for selected
lines.

Publication authorization rested on the maintainer's discipline and on
`scripts/publish-dispatch`. A dispatch from the GitHub interface could skip the
helper, and nothing on the server required a human to approve the run.

Alternatives considered and rejected:

* **Scoping `id-token: write` to the existing single job.** It changes where the
  permission is written, not which code runs beside it.
* **Publishing from a reusable workflow.** npm validates the calling workflow's
  filename, and `id-token: write` must be granted to both caller and callee, so
  the token's reach becomes harder to reason about rather than smaller.
* **Keeping the duplicated setup and strengthening the grep.** It detects some
  drift after the fact; it does not remove the second copy that drifts.
* **Requiring a real publication to prove the new structure.** It couples an
  infrastructure change to a release that may not be wanted, and a failure would
  surface on an immutable version.

## Decision

Publication is two jobs in `publish.yml`.

The pack job holds no `id-token` permission. It refuses a candidate that is not
the dispatched `main` revision or lacks a successful exact-SHA `verify.yml` push
run before installing anything, sets up through the shared composite action,
runs `make verify`, packs only the selected package, publishes the tarball's
sha512 as a job output, and uploads the tarball as an artifact.

The publish job alone holds `id-token: write` and runs in the GitHub environment
`npm-publication`, whose required reviewer is a human maintainer. It does not
check out the repository and installs nothing. It downloads the artifact,
recomputes the sha512 and refuses a mismatch, reads the package name, version
and Core dependency from the tarball's own `package.json`, applies the
unused-version, Core-before-CLI and exact-Core-dependency guards to those
values, and publishes the tarball. Publishing a tarball runs no package
lifecycle script. After publication it compares the registry's integrity for
that version with the recomputed digest and records both in the run summary.

`verify.yml` and the pack job share one composite action,
`.github/actions/setup-verification`. The pack job disables the pnpm cache,
unlike `verify.yml`, so a cache written by an untrusted pull-request run never
feeds a publication artifact. That difference is deliberate.

A `rehearsal` input runs the same jobs, the same environment approval and every
guard except unused-version, which it reports instead of enforcing so that an
already-published version can be rehearsed. It then runs `npm publish --dry-run`
on the tarball and requires the OIDC token exchange to have succeeded. A
rehearsal never reaches a real `npm publish`.

## Boundaries

* The pack job owns proving the candidate and producing the one artifact that
  may be published. It never holds an OIDC permission.
* The publish job owns the OIDC exchange and the publication of exactly that
  artifact. It never executes repository or dependency code.
* The environment `npm-publication` and the npm Trusted Publisher entries are
  access settings owned by the human maintainer; agents neither configure nor
  inspect them.
* `scripts/publish-dispatch` owns the maintainer's dispatch experience, including
  telling the maintainer that the run awaits environment approval. It never
  approves a run or writes a dist-tag.

## Consequences

A compromised development dependency or package script can still corrupt what
the pack job builds, but it cannot mint an npm credential, and the artifact is
packed in the same job, from the same revision, immediately after `make verify`
passed there. `make verify` does not inspect that exact tarball; it proves the
revision, and the pack job's own packed-package tests prove the packing. Provenance names
the run and the tarball digest, not the job, so the digest comparison between
jobs is what ties the published bytes to the verified build.

Every publication now waits for a human approval in GitHub, in addition to the
dispatch. The first real upload and provenance signature under this structure
cannot be observed without publishing; a rehearsal proves the trust
configuration, including the environment, but not the registry's acceptance of
an upload. The next publication Story must record that first observation.

## Falsified if

A step in the publish job executes code from the repository or from an installed
dependency, a job other than the publish job receives `id-token: write`, or a
rehearsal can reach a real publication. Any of these means the split between
`.github/workflows/publish.yml`, `.github/actions/setup-verification/action.yml`
and `scripts/publish-dispatch` no longer isolates OIDC from repository code, and
this decision must be revisited.
