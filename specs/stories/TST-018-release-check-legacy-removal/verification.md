# Verification Result: TST-018

## Checks

* lint: pass — `make verify; format, lint, shell syntax, Node syntax, and actionlint passed`
* static: pass — `make verify; Story readiness, verification planning, TypeScript typecheck, Go vet, staticcheck, and protocol inventories passed`
* unit: pass — `make verify; 329 TypeScript tests and the retained release conformance corpus passed`
* integration: pass — `tests/release-check-entrypoint.sh; tests/typescript-tooling.sh; make verify`
* contract: pass — `tests/release-check-entrypoint.sh; the exact Make recipe, six-line output, failure projection, migration, and whole-revision rollback checks passed`
* e2e: pass — `exact post-change SHA ad9e6c562f692b63dd223de8f140ecd12bf556fb passed all 30 push and pull-request checks in Actions runs 35068834571 and 35068839212 across the root gate, Node 22/24/26 on Linux/macOS, and both portability jobs`
* architecture: pass — `independent Sol/high public-contract, security, and portability review approved the corrected checkpoint with no remaining material finding`

The final local gate completed successfully before exact SHA
ad9e6c562f692b63dd223de8f140ecd12bf556fb was committed at
2026-09-16T07:29:59Z. The same worktree passed the focused entrypoint suite,
retained TypeScript release conformance, packed consumer and adoption checks,
`make verify-actions`, and
`PATH=/usr/bin:/bin make verify-portability PORTABILITY_SHELL=/bin/sh`. The
independent reviewer found and rechecked portability, fixture-matrix, rollback,
and Make-recipe fixes before approving the checkpoint. The first post-push
check exposed that the entrypoint suite ran before its build artifacts, and the
second exposed that shallow CI checkout omitted the fixed rollback revision.
The owning Make and checkout boundaries were corrected before the passing
exact-SHA runs recorded here.

## Evidence

* `AC-001`: pass — `The fixed Legacy Removal Gate below traces TST-016, TST-017, PB-003, clean main fcc5595d5c95a42a82e67bb6f82be7886fdfaa64, exact-SHA Actions run 35052445207, and the 2026-09-16 Human Review approval without claiming a live ForgePilot check.`
* `AC-002`: pass — `TST018-AC-002 copied the actual root Make recipe, observed verify and the Node adapter exactly once, preserved the six success lines and direct command, kept the disposable candidate clean, and suppressed inspection after verification failure.`
* `AC-003`: pass — `TST018-AC-003 proved the removed selectors, arguments, deterministic missing-Node path, non-root target, hostile child stderr, malformed or multiple JSON, unsupported versions, exit 17, invalid typed result, and newline data all fail closed without success, fallback, mutation, or remote invocation.`
* `AC-004`: pass — `TST018-AC-004 archived complete revision fcc5595d5c95a42a82e67bb6f82be7886fdfaa64 into a disposable rollback directory and observed its checker, selector, legacy and switch suites, Make wiring, and legacy branch as one set; current guidance names Node, selector removal, the full revision, external-state exclusions, and unchanged Protocol 0.10.0.`
* `AC-005`: pass — `Retained release conformance, packed consumers, adoption, local portability, complete make verify, and independent Sol/high review passed; exact SHA ad9e6c562f692b63dd223de8f140ecd12bf556fb then passed all 30 supported Node/Linux/macOS checks in Actions runs 35068834571 and 35068839212.`

## Fixed Pre-Removal Legacy Removal Gate

The executable legacy implementation may be deleted only after this fixed
checkpoint. Historical observations remain evidence; they are not rerun by
copying the legacy implementation into the post-removal tree.

| Gate item | Observation before removal |
| --- | --- |
| TypeScript capability parity | `TST-017 AC-001 through AC-005 passed; its fixed pre-switch checkpoint covered 19 TypeScript release cases and the retained shell suite.` |
| Golden corpus and retained legacy tests | `Clean main fcc5595d5c95a42a82e67bb6f82be7886fdfaa64 passed local make verify before removal, including tests/release-check.sh, release parity, and release-check-switch fixtures.` |
| Command, JSON, issue, evidence, and exit contracts | `TST-011, TST-016, TST-017, docs/typescript-tooling/cli-contract.md, and the v1 result schema record the supported interfaces.` |
| Package build and contents | `PB-003 AC-001 and AC-003 passed npm-created Core and CLI tarball inspection and clean npm-only consumers.` |
| Version-pinned public acquisition | `PB-003 public smoke installed exact @praxisbound/core@0.1.0 and @praxisbound/cli@0.1.0 from npm in isolated consumers.` |
| Installed offline execution | `PB-003 exact/latest consumers passed root imports and installed CLI commands with Node network calls denied after acquisition.` |
| Supported CI and root gate | `GitHub Actions main push run 35052445207 used exact SHA fcc5595d5c95a42a82e67bb6f82be7886fdfaa64 and passed all 15 Node/Linux/macOS jobs; the same clean SHA passed local make verify.` |
| Fresh and existing adoption | `TST-017 AC-005 and the root bootstrap, activation, packed-consumer, and adoption suites passed on the fixed checkpoint.` |
| Process-consumer integration | `TST-016 AC-001 through AC-005 passed the npm-packed generic process contract. No live ForgePilot-owned check ran, and none is claimed.` |
| Migration, rollback, and versions | `TST-018 docs preserve the direct command as a Node wrapper, retire the selector, keep Protocol VERSION 0.10.0, and restore the whole fcc5595 revision for rollback.` |
| Namespace ownership and provenance | `PB-003 AC-004 through AC-006 passed using the selected @praxisbound organization, public package provenance, human-confirmed trust and revocation, and post-hardening consumers.` |
| Deprecation/default period | `Human Review declared the TST-017 period complete on GitHub issue 43 on 2026-09-16.` |
| Runtime classification | `Human Review approved the Breaking maintainer-tooling Node requirement outside the adopter Protocol surface on issue 43; ADR-003 was revisited and remains valid.` |
| One semantic purpose | `GitHub issue 43 and this Story remove only the release-check legacy implementation and its selection/testing/docs seams.` |

## Authority Used

* plan
* modify
* commit
* push

## Residual Risks

* `No live ForgePilot-owned integration check has been observed; TST-016 treats it as optional external evidence and TST-018 must not claim otherwise.`
