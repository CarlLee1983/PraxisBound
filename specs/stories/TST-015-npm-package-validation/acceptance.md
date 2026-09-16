# Acceptance Criteria

## Happy Path

* [ ] AC-001: The selected npm scope is demonstrably controlled before release.

## Business Rules

* [ ] AC-002: Tarballs contain only intended files, exact Core/CLI dependency
  metadata, valid exports, executable bin metadata, license, readme, and engine
  policy.

## Clean Consumer

* [ ] AC-003: Clean consumers run help, machine checks, verification, and init
  from installed tarballs.

## Acquisition and Offline Boundary

* [ ] AC-004: Version-pinned acquisition is distinguished from
  network-disabled local-binary execution after acquisition.

## Acceptance Evidence

| AC | Method | Evidence | Fixture / precondition | Expected observation |
| --- | --- | --- | --- | --- |
| `AC-001` | human | `maintainer npm scope-control review` | `maintainer-authenticated @forgeflow organization view with package-creation authority` | `review records control without publishing or exposing credentials` |
| `AC-002` | test | `tests/typescript-tooling.sh TST015-AC-002` | `fresh npm Core and CLI tarballs` | `exact contents, manifests, exports, bin, license, readme, engines, source, and provenance policy pass` |
| `AC-003` | test | `tests/typescript-tooling.sh TST015-AC-003` | `disposable npm-only consumer installed from both tarballs` | `installed help, JSON static checks, verification, and init all exit with their documented results` |
| `AC-004` | test | `tests/typescript-tooling.sh TST015-AC-004` | `disposable exact-version package source followed by installed consumer with network traps` | `pinned npx acquisition succeeds separately and direct local-bin commands make no network attempt` |

## Security Fixture Matrix

| Source field | Payload | Expected result | Persisted locations | Verification |
| --- | --- | --- | --- | --- |
| `npm.package-name` | `forgeflow` | reject | `automation coordinate validator` | `tests/typescript-tooling.sh TST015-AC-004` |
| `npm.package-version` | `latest` | reject | `automation coordinate validator` | `tests/typescript-tooling.sh TST015-AC-004` |
| `npm.registry-url` | `http://127.0.0.1:<fixture-port>` | preserve | `isolated npm process configuration` | `tests/typescript-tooling.sh TST015-AC-004` |
| `npm.packument` | `@forgeflow/cli exact-version fixture metadata` | preserve | `isolated npm cache only` | `tests/typescript-tooling.sh TST015-AC-004` |
| `npm.dist.tarball` | `http://127.0.0.1:<fixture-port>/@forgeflow/cli/-/cli-0.1.0.tgz` | preserve | `isolated npm cache only` | `tests/typescript-tooling.sh TST015-AC-004` |
| `npm.dist.integrity` | `sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=` | reject | `npm acquisition result` | `tests/typescript-tooling.sh TST015-AC-004` |
| `npm.dist.shasum` | `0000000000000000000000000000000000000000` | reject | `npm acquisition result` | `tests/typescript-tooling.sh TST015-AC-004` |
| `npm.tarball-bytes` | `corrupted packed CLI bytes` | reject | `npm cache and executable path` | `tests/typescript-tooling.sh TST015-AC-004` |
| `npm.request.authorization` | `Bearer ambient-secret` | omit | `fixture registry request log and test output` | `tests/typescript-tooling.sh TST015-AC-004` |
| `process.env.NODE_AUTH_TOKEN` | `ambient-node-auth-secret` | omit | `fixture registry request log and npm output` | `tests/typescript-tooling.sh TST015-AC-004` |
| `process.env.NPM_TOKEN` | `ambient-npm-secret` | omit | `fixture registry request log and npm output` | `tests/typescript-tooling.sh TST015-AC-004` |
| `process.env.npm_config_userconfig` | `hostile/npmrc` | omit | `fixture registry request log and npm output` | `tests/typescript-tooling.sh TST015-AC-004` |
| `process.env.npm_config_registry` | `https://hostile.invalid/` | omit | `acquisition request log and npm output` | `tests/typescript-tooling.sh TST015-AC-004` |
| `process.env.HTTP_PROXY` | `http://hostile.invalid/` | omit | `acquisition request log and npm output` | `tests/typescript-tooling.sh TST015-AC-004` |
| `process.env.HTTPS_PROXY` | `http://hostile.invalid/` | omit | `acquisition request log and npm output` | `tests/typescript-tooling.sh TST015-AC-004` |
| `package.manifest` | `unexpected install lifecycle script` | reject | `packed manifest and clean consumer filesystem` | `tests/typescript-tooling.sh TST015-AC-002` |
| `package.bin` | `#!/usr/bin/env node followed by packed CLI bytes` | preserve | `installed node_modules/.bin/forgeflow` | `tests/typescript-tooling.sh TST015-AC-002` |

## Verification Notes

Run npm package creation and inspection, clean npm installation, exact-version
npx acquisition, network-disabled direct local-bin execution, package and
snapshot provenance checks, and the configured Node/Linux/macOS consumer
matrix. Finish with `make verify`. Record the external npm scope-control review
and remote matrix results honestly; either remains blocked if it cannot be
observed in the current authorized environment.

`AC-001` was never observed and stays blocked. The `@forgeflow` namespace it
names was superseded by ADR-011 before any publication, and the equivalent
scope-control obligation is `AC-004` of
`specs/stories/PB-003-npm-distribution/`. This note records that history; it
does not relax, restate, or satisfy `AC-001`.
