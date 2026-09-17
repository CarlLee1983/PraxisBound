# Acceptance Criteria

## Happy Path

* [ ] AC-001: Core and CLI manifests declare `0.2.0`, CLI depends on exact
  `@praxisbound/core@0.2.0`, and freshly packed tarballs install into an
  npm-only consumer whose `praxisbound --version` reports `0.2.0`. Protocol
  `VERSION` remains `0.10.0`.
* [ ] AC-002: `publish.yml`, dispatched by a human from `main` with the full
  approved merge SHA, publishes `@praxisbound/core@0.2.0` and then
  `@praxisbound/cli@0.2.0` to `next`, authenticated by OIDC with no stored
  token, and each package's provenance names that SHA and `publish.yml`.
* [ ] AC-003: A credential-isolated npm-only consumer of the exact public
  `0.2.0` coordinates passes root imports, help and version, `init` apply whose
  result carries `data.nextSteps`, Doctor, verification check, verify, and
  `codex activate` preview and apply, with installed-binary network calls denied
  after acquisition.

## Business Rules

* [ ] AC-004: `latest` moves to `0.2.0` for both packages only by a recorded
  human `npm dist-tag add` after AC-003 passes, and the AC-003 smoke then
  passes again against `latest`. `@praxisbound/*@0.1.0` remain public and
  unchanged.
* [ ] AC-005: `docs/releasing.md` documents publishing an existing package by
  OIDC to `next` and promoting `latest` by explicit human action, without a
  stored token.

## Failure Cases

* [ ] AC-006: A failed dispatch or defective `0.2.0` is left in place and
  recorded; no token fallback, overwrite, unpublish, or `latest` move to it
  occurs.

## Regression Requirements

* [ ] AC-007: `make verify` passes on the approved SHA locally and in its
  exact-SHA `verify.yml` run.
* [ ] AC-008: `publish.yml` keeps its main-only job condition, full-SHA
  candidate guard, exact-SHA `verify.yml` success check, unused-version check,
  Core-before-CLI check, OIDC permission, and `next`-tagged provenance publish,
  and references no stored npm credential.
* [ ] AC-009: `scripts/publish-dispatch core|cli [sha]` refuses before any
  dispatch when arguments are malformed, `main` is not the candidate, the
  candidate's `verify.yml` push run on `main` did not succeed, a `publish.yml`
  run is active, the version is already published, CLI precedes its Core, or
  the typed confirmation is not the exact coordinate. Confirmed, it dispatches
  exactly once from `main`, watches that run, waits for the registry, and
  reports failure of either; it writes no dist-tag.

## Acceptance Evidence

| AC | Method | Evidence | Fixture / precondition | Expected observation |
| --- | --- | --- | --- | --- |
| `AC-001` | test | `tests/typescript-tooling.sh PB003-AC-001` | `fresh npm Core and CLI tarballs from the 0.2.0 manifests` | `exact package contract passes and the installed binary reports 0.2.0` |
| `AC-002` | human | `PB-004 publication record` | `approved merge SHA with passing local and exact-SHA remote verification` | `two successful publish.yml runs, Core before CLI, OIDC-authenticated, provenance naming the SHA and publish.yml` |
| `AC-003` | human | `PB-004 public smoke record` | `isolated npm-only consumer with empty userconfig and cache at exact 0.2.0` | `every listed command passes, init result carries data.nextSteps, codex activate preview and apply pass, no network after acquisition` |
| `AC-004` | human | `PB-004 dist-tag record` | `both packages at next=0.2.0 with passing exact-version smoke` | `human dist-tag write recorded; next and latest resolve to 0.2.0; latest smoke passes; 0.1.0 still resolves` |
| `AC-005` | test | `tests/protocol.sh PB004-AC-005` | `docs/releasing.md` | `the subsequent-release section names OIDC, next, human dist-tag promotion, and no stored token` |
| `AC-006` | human | `PB-004 publication record` | `any failed dispatch or defective published version` | `registry state retained and recorded with no overwrite, token fallback, or latest move` |
| `AC-007` | command | `make verify` | `approved merge SHA` | `exit 0 locally and success in the exact-SHA verify.yml run` |
| `AC-008` | test | `tests/protocol.sh PB004-AC-008` | `.github/workflows/publish.yml` | `every listed guard is present and neither NODE_AUTH_TOKEN nor NPM_TOKEN is referenced` |
| `AC-009` | test | `tests/publish-dispatch.sh PB004-AC-009` | `fake gh and npm on PATH with no network or credential` | `every refusal dispatches nothing; confirmed core and cli dispatch exact arguments, watch the run, and never call npm dist-tag` |

## Security Fixture Matrix

| Source field | Payload | Expected result | Persisted locations | Verification |
| --- | --- | --- | --- | --- |
| `publish.candidate-sha` | `37c5afb` | reject | `publish.yml candidate guard, before any build` | `tests/protocol.sh PB004-AC-008` |
| `publish.dispatch-ref` | `release/tooling-0.2.0` | reject | `publish.yml job condition; the job is skipped rather than failed, and no publish step runs` | `tests/protocol.sh PB004-AC-008` |
| `publish.package` | `cli before Core 0.2.0 is public` | reject | `publish.yml order check` | `tests/protocol.sh PB004-AC-008` |
| `npm.package-version` | `0.1.0` | reject | `publish.yml unused-version check` | `tests/protocol.sh PB004-AC-008` |
| `npm.authorization` | `NODE_AUTH_TOKEN reference in publish.yml` | reject | `.github/workflows/publish.yml` | `tests/protocol.sh PB004-AC-008` |
| `npm.authorization` | `token-authenticated publish of an existing package` | reject | `npm package publishing-access setting, human-observed only` | `PB-004 publication record` |
| `npm.provenance` | `repository CarlLee1983/PraxisBound workflow publish.yml` | preserve | `registry provenance statement` | `PB-004 publication record` |
| `npm.dist-tags` | `latest moved before exact-version smoke` | reject | `registry dist-tags` | `PB-004 dist-tag record` |
| `package.manifest` | `@praxisbound/core 0.1.0 dependency in CLI 0.2.0` | reject | `packed CLI manifest, by invariant assertion on the real tree rather than an injected fixture` | `tests/typescript-tooling.sh PB003-AC-001` |
| `publish.workflow` | `candidate guard line deleted` | reject | `.github/workflows/publish.yml` | `tests/protocol.sh PB004-AC-008` |
| `publish.candidate-sha` | `main SHA whose verify.yml push run did not succeed` | reject | `publish.yml remote verification guard, before any build` | `tests/protocol.sh PB004-AC-008` |

## Verification Notes

Run `./scripts/story-check --ready` and `./scripts/verification-check` for this
Story, then the focused package and protocol suites and `make verify`. AC-002,
AC-003, AC-004 and AC-006 are external observations made after a human
dispatch; they remain unrecorded until actually observed, and this Story is
partial until then. Never record credential values, authentication URLs, or
access-settings contents.
