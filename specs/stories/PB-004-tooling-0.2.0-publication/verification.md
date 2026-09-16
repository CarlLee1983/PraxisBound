# Verification Result: PB-004

## Checks

* lint: pass — `make verify on 5c7043d15a9cd2443555ba7629d57e1b66a0a93b; Prettier, ESLint, shell syntax, Node syntax, and actionlint passed`
* static: pass — `make verify on 5c7043d15a9cd2443555ba7629d57e1b66a0a93b; TypeScript typecheck, Story readiness, verification planning, and protocol inventories passed`
* unit: pass — `make verify on 5c7043d15a9cd2443555ba7629d57e1b66a0a93b; TypeScript suites passed with the version-pinned assertions at 0.2.0`
* integration: pass — `tests/typescript-tooling.sh PB003-AC-001 and PB003-AC-003; tests/publish-dispatch.sh PB004-AC-009`
* contract: pass — `tests/protocol.sh PB004-AC-005 and PB004-AC-008 held the runbook and publish.yml guards; public cli@0.2.0 metadata declares exact @praxisbound/core 0.2.0`
* e2e: pass — `exact SHA 5c7043d15a9cd2443555ba7629d57e1b66a0a93b passed all 15 jobs of verify.yml push run 35115020499; isolated public consumers of the exact 0.2.0 coordinates and of latest passed the AC-003 command set with installed-binary network calls denied`
* architecture: blocked — `no independent human architecture review of the PB-004 publication sequence has been performed`

The publication candidate is `5c7043d15a9cd2443555ba7629d57e1b66a0a93b`, the merge
commit of PR #67, which followed PR #66. The first candidate, `e7a87ab`, was
abandoned after its Core dispatch failed; see `AC-006`.

## Evidence

* `AC-001`: pass — `packages/core and packages/cli declare 0.2.0 and CLI depends on exact @praxisbound/core 0.2.0; tests/typescript-tooling.sh PB003-AC-001 passed the packed contract and the installed binary reported 0.2.0; VERSION remains 0.10.0.`
* `AC-002`: pass — `A human ran scripts/publish-dispatch against 5c7043d. publish.yml run 35115727823 published @praxisbound/core@0.2.0 and run 35116263632 then published @praxisbound/cli@0.2.0, both workflow_dispatch from main at that SHA, both to next. Each package's SLSA provenance names CarlLee1983/PraxisBound, .github/workflows/publish.yml, refs/heads/main, source commit 5c7043d, and its run. Both registry gitHead values are 5c7043d. The publish step environment carried no npm token, so these are the first OIDC-authenticated publications of either package.`
* `AC-003`: pass — `A consumer with empty userconfig and cache and no inherited environment installed exact core@0.2.0 and cli@0.2.0 with lockfile integrity matching the registry; npm audit signatures verified two registry signatures and two attestations. With installed-binary network calls denied: version 0.2.0; help banner v0.2.0; init --dry-run INIT_PREVIEW and init INIT_APPLIED both carrying nextSteps verification-gate,confirm-adoption; doctor failure before the gate and success after a Makefile exposing verify; verify success; codex activate preview ACTIVATION_PREVIEW writing nothing, and --apply ACTIVATION_APPLIED installing .agents/skills/praxisbound and the managed AGENTS.md block. verification check returned configuration-error VERIFICATION_NO_STORY_CHECKED on the fresh adoption, which holds only _template and matches the shell checker, and success once a Story was present.`
* `AC-004`: pass — `After AC-003 the human ran npm dist-tag add for both packages. A credential-free npm view then resolved latest=0.2.0 and next=0.2.0 for core and cli, and exact 0.1.0 still resolved for both. A fresh isolated consumer of @praxisbound/core@latest and @praxisbound/cli@latest installed 0.2.0, verified two signatures and two attestations, and passed the same command set.`
* `AC-005`: pass — `tests/protocol.sh PB004-AC-005 holds docs/releasing.md section 8 to OIDC-only publication, next-only landing, the main freeze, human 2FA latest promotion, and the agent boundary, and rejects a code fence carrying prose.`
* `AC-006`: pass — `publish.yml run 35111958597, the first Core dispatch from e7a87ab, failed in make verify before npm publish ran: the shallow checkout lacked rollback revision fcc5595 needed by the TST-018 rollback case. Nothing was published and 0.2.0 stayed unused. No token was added and nothing was overwritten or unpublished; PR #66 gave publish.yml a full-history checkout and the version was published from a new candidate. A CLI invocation of scripts/publish-dispatch made before Core was public was refused by the helper without dispatching.`
* `AC-007`: pass — `make verify exited 0 locally on a clean checkout of 5c7043d15a9cd2443555ba7629d57e1b66a0a93b, and verify.yml push run 35115020499 for that SHA succeeded with all 15 jobs.`
* `AC-008`: pass — `tests/protocol.sh PB004-AC-008 passed on 5c7043d, including full-history checkout for publish.yml and verify.yml; deleting the candidate guard was observed to fail it.`
* `AC-009`: pass — `tests/publish-dispatch.sh passed sixteen cases under sh and dash with fake gh and npm. Dropping the post-confirmation re-check and treating any npm failure as unpublished were each observed to fail it. The helper then performed both real dispatches in AC-002 and refused the premature CLI invocation in AC-006.`

## Authority Used

* plan
* modify
* commit
* push

## Residual Risks

* `The PB-004 publication sequence has had no independent human architecture review, so the architecture check is blocked and this Story is partial.`
* `PB-004 R2 and the security fixture rows for dispatch-ref, candidate-sha, package order and unused version are enforced by publish.yml and held statically by PB004-AC-008; apart from the historical e7a87ab failure, no deliberately rejected dispatch was observed against GitHub.`
* `Token-based publication is disallowed only by the npm package publishing-access setting, which PB-003 recorded from the human and this Story did not independently observe.`
