# Acceptance Criteria

## Happy Path

- [ ] AC-001: Both public manifests declare 0.3.0 and the CLI declares an
      exact `@praxisbound/core` dependency of 0.3.0; the workspace lockfile and
      package tests remain consistent with those coordinates.
- [ ] AC-002: All current adopter-facing exact CLI commands, including the AI
      adoption prompt, use `@praxisbound/cli@0.3.0`; no prompt invocation keeps
      the former 0.2.0 coordinate.
- [ ] AC-003: Each of the six TST-020 observations is repeated against the
      exact final prompt bytes in a fresh non-interactive session with no later
      input, and the agent-inspected fixture observations satisfy TST-020.

## Business Rules

- [ ] AC-004: The local candidate passes its focused package, prompt, and
      publication-workflow checks and `make verify`; a subsequent successful
      `verify.yml` push run names exactly the approved candidate SHA.
- [ ] AC-005: After separately granted human authorization, Core 0.3.0 is
      dispatched and approved through `npm-publication`, verified publicly,
      then CLI 0.3.0 is dispatched and approved from the same frozen candidate
      SHA; neither workflow bypasses the OIDC two-job boundary.
- [ ] AC-006: For each uploaded package, a consumer with empty npm userconfig
      and cache verifies registry signatures and attestations, and recorded npm
      provenance names `CarlLee1983/PraxisBound`, `.github/workflows/publish.yml`,
      the candidate SHA, and its publish run; the run summary's registry
      integrity equals the packed artifact digest.

## Failure Cases

- [ ] AC-007: An old or non-exact package/prompt coordinate, stale candidate
      SHA, missing Core publication before CLI, missing/rejected environment
      approval, integrity mismatch, incomplete external evidence, or partial
      publish stops the release without an immutable overwrite, dist-tag move,
      or false PASS claim.

## Regression Requirements

- [ ] AC-008: Only after AC-005 and AC-006 pass may a human promote each 0.3.0
      package to `latest`; exact-version and `latest` public smoke checks are
      then recorded separately.
- [ ] AC-009: The Story contract, verification plan, and repository-wide
      `make verify` pass for the local release candidate.

## Acceptance Evidence

<!-- prettier-ignore -->
| AC | Method | Evidence | Fixture / precondition | Expected observation |
| --- | --- | --- | --- | --- |
| `AC-001` | test    | `packages/cli/package.json`          | `0.3.0 candidate`                                         | `Core and CLI versions and the exact CLI Core dependency agree`                          |
| `AC-002` | test    | `tests/bootstrap.sh TST020-AC-002`   | `final docs and CLI manifest`                             | `prompt syntax, required behavior, and every pin match 0.3.0`                            |
| `AC-003` | human   | `PB-006 TST-020 observation record`  | `final prompt bytes and six fresh fixture sessions`       | `all six observations count and their inspected outcomes pass`                           |
| `AC-004` | command | `make verify`                        | `clean 0.3.0 candidate`                                   | `local checks pass and remote head SHA equals candidate SHA`                             |
| `AC-005` | human   | `PB-006 publication approval record` | `separately authorized frozen main candidate`             | `Core then CLI upload through approved OIDC publish jobs`                                |
| `AC-006` | human   | `PB-006 public provenance record`    | `exact uploaded versions`                                 | `verified signatures, attestations, provenance, and matching integrity for each package` |
| `AC-007` | human   | `PB-006 release stop record`         | `invalid coordinate, binding, or partial external result` | `fail closed with no overwrite, hidden partial state, or false success`                  |
| `AC-008` | human   | `PB-006 latest promotion record`     | `AC-005 and AC-006 passing evidence`                      | `human-only promotion followed by exact and latest smoke results`                        |
| `AC-009` | command | `make verify`                        | `complete local candidate`                                | `all commands exit 0`                                                                    |

## Security Fixture Matrix

<!-- prettier-ignore -->
| Source field | Payload | Expected result | Persisted locations | Verification |
| --- | --- | --- | --- | --- |
| `packages/cli.packageJson.dependencies.@praxisbound/core` | `^0.3.0` | reject | `local release candidate` | `packages/cli/package.json` |
| `docs.gettingStarted.agentPrompt.coordinate` | `@praxisbound/cli@0.2.0` | reject | `documentation test result` | `tests/bootstrap.sh TST020-AC-002` |
| `workflowDispatch.candidate_sha` | `sha different from dispatch` | reject | `workflow run result` | `tests/publication-workflow.sh PB005-AC-004` |
| `publish.environmentApproval` | `absent or rejected` | reject | `external observation record` | `PB-006 publication approval record` |
| `registry.dist.integrity` | `digest different from packed artifact` | reject | `workflow summary` | `tests/publication-workflow.sh PB005-AC-009` |
| `registry.provenance` | `missing or mismatched metadata` | reject | `release evidence record` | `PB-006 public provenance record` |

## Verification Notes

Before changing source, run `./scripts/story-check --ready` and
`./scripts/verification-check` for this Story. Keep package-version behavior
tests focused on current source coordinates while retaining historical release
fixtures where their scenario needs a prior published version. Run the relevant
bootstrap prompt cases and publication-workflow cases before `make verify`.

No credential, environment-settings content, workflow dispatch, approval, npm
upload, tag, release, push, or dist-tag operation is authorized by this Story.
When a human separately authorizes those operations, preserve exact candidate
SHA, Core-before-CLI ordering, approval observations, and public results in
`verification.md`. A skipped, blocked, or unobserved external criterion leaves
the Story partial.
