# Verification Result: TST-015

## Checks

* lint: pass — `make verify`
* static: pass — `make verify`
* unit: pass — `make verify (324 tests passed)`
* integration: pass — `make verify; tests/typescript-tooling.sh passed`
* contract: pass — `make verify; story-check --ready and verification-check plan passed`
* e2e: pass — `local clean npm, pinned npx, and network-denied direct-bin checks passed; GitHub Actions run 34918256494 passed the Linux/macOS Node 22.13.0/22.x/24.0.0/24.x/26.0.0/26.x matrix at commit 337d2dd16645720331dd0dfe21c264f96c7880e6`
* architecture: pass — `independent Sol/high architecture review plus Standards and Spec reviews against origin/main; all material findings resolved`

## Evidence

* `AC-001`: blocked — `at 2026-09-15T01:40Z, the authenticated npmjs.com profile for carllee1983 listed organizations carll331983 and gravito but not forgeflow; the observer therefore could not prove @forgeflow organization control or package-creation authority. This criterion was never retried and remains blocked; the @forgeflow identity it depended on was later superseded by ADR-011, and the equivalent scope-control obligation passed as AC-004 of specs/stories/PB-003-npm-distribution/`
* `AC-002`: pass — `tests/typescript-tooling.sh TST015-AC-002 inspected exact tarball contents, metadata, dependencies, exports, bin mode, engines, copied legal/readme files, and embedded provenance hashes`
* `AC-003`: pass — `tests/typescript-tooling.sh TST015-AC-003 installed both tarballs with npm in an isolated consumer and exercised help, machine checks, verification, and init`
* `AC-004`: pass — `tests/typescript-tooling.sh TST015-AC-004 exercised exact-version npx acquisition through an isolated registry, rejected malformed/integrity-failing acquisition and ambient credentials, then ran the installed local bin with all network entry points denied`

## Authority Used

* modify

## Residual Risks

* `the authenticated observer is not shown as an @forgeflow organization member, so scope control and package-creation authority remain unproven`
* `this risk is retained as historical evidence, not as an open release risk: no release ever used the @forgeflow namespace, and ADR-011 replaced it with @praxisbound before the first publication`
