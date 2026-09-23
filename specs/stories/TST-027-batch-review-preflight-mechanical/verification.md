# Verification Result: TST-027

## Checks

* lint: pass — `make verify exited 0 at 16a75c4; Prettier, ESLint, and shell/Node syntax checks passed`
* static: pass — `make verify exited 0; TypeScript build, Story contract, verification-plan, identity, and Core/CLI package-surface checks passed with the five new modules in the documented tarball lists`
* unit: pass — `make verify ran 750 Node tests: 749 pass, 0 fail, 1 skipped by design (4 MiB wall-clock smoke gated behind PRAXISBOUND_PERF_SMOKE=1)`
* integration: pass — `review-preflight-command, review-preflight-record, review-preflight-git, and review-git tests drive review preflight and the git adapter against temporary repositories, including real temporary git repositories, asserting envelopes, records/ contents, and git state`
* contract: pass — `contract §2, §9, and §13 carry the 修訂性澄清（R-007） lines the tests assert; cli-contract.md documents review preflight, its checks, outcomes, record rules, and git behavior; result-envelope-v1.schema.json accepts the four outcomes only with their §12 status and exit`
* e2e: pass — `a manual scratch run, not committed, of the built binary in a scratch git repository holding ADR-014, ADR-015, the R-007 section of the spec, and this Story; see Preflight Rehearsal below`
* architecture: blocked — `awaiting Human Review of feat/tst-027-preflight-mechanical; one independent code and security review round ran and its findings were fixed in 16a75c4, and that fix round was checked by make verify and the rehearsal, not by a second review`

## Evidence

* `AC-001`: pass — `review-preflight-command.test.mjs and review-preflight-record.test.mjs: a confirmed batch whose Story passes story check --ready, with a Semantic Report file, yields REVIEW_READY, pass, exit 0, and records/preflight-<fp12>-1.json accepted by validateStoredPreflightReportRecord`
* `AC-002`: pass — `review-preflight-command.test.mjs: missing source, failing story readiness, dependency cycle, unknown Story, unmapped requirement, missing acceptance, unknown anchor, duplicate anchor, and unresolved blocking request each yield REVIEW_BLOCKED with their code, never READY`
* `AC-003`: pass — `review-preflight-command.test.mjs and review-preflight.test.mjs: fingerprint mismatch and stale confirmation give REVIEW_STALE with §8 differences; missing confirmation, unaddressed non-blocking request, tampered current-fingerprint response record, and missing Semantic Report give REVIEW_INCOMPLETE; a request deferred in the applying confirmation is not reported; combined conditions follow §9 precedence with every issue listed; an old response record left behind by a supersede no longer counts (Story R11a)`
* `AC-004`: pass — `review-preflight-git.test.mjs and review-git.test.mjs: outside git gives REVIEW_NOT_A_GIT_REPOSITORY; modified, untracked, ignored, and skip-worktree batch sources and a modified manifest each get their own REVIEW_SOURCES_UNCOMMITTED, including when fingerprint and HEAD both match; without --expect-revision the adapter is never called; git failure is ERROR exit 3`
* `AC-005`: pass — `review-preflight.test.mjs and review-preflight-command.test.mjs: severity is derived from the §9 class table, advisory-only fixtures stay READY, and an ESC in a Story Authority bullet reaches human output escaped through a real fixture; every issue carries a repository-relative path where the code has one`
* `AC-006`: pass — `review-preflight-record.test.mjs: identical rerun writes nothing and names the existing record; a changed result writes the next number; 201 existing reports do not block a write; oversized-number, malformed, over-1-MiB, symlinked, and name-mismatched baselines are advisory REVIEW_RECORD_INVALID and not used; an injected write failure gives REVIEW_INCOMPLETE with REVIEW_RECORD_WRITE_FAILED and no partial or temp file; usage and manifest errors exit 2 and write nothing; the 10000-diagnostic bound is tested at Core level only`
* `AC-007`: pass — `review-preflight-command.test.mjs and review-preflight-git.test.mjs: sources, manifest, existing records, git status, and HEAD are unchanged apart from the one new preflight file; output never uses authorized, approved, or verified outside echoed data`
* `AC-008`: pass — `review-preflight-command.test.mjs: human output has the Mechanical checks and Agent observations (unverified) sections, and REVIEW_READY prints 只表示未發現阻擋，不宣稱沒有缺陷`
* `AC-009`: pass — `make verify exited 0; VERSION, protocol/, and templates/ are unchanged against origin/main; TST-022 through TST-026 tests pass unchanged apart from the pinned help text, export list, and package surface that now include review preflight`

## Preflight Rehearsal

Historical Evidence of one scripted run on 2026-09-23 with the built binary
from 16a75c4. It shows the command working end to end. It is not a real
Agent's semantic review, and the confirmation was typed by a script through a
pseudo-terminal, not by a human.

* `Batch: BR-TST-027-rehearsal in a scratch git repository with ADR-014, ADR-015, the R-007 section of spec.md, and this Story`
* `Run 1, whole spec: REVIEW_BLOCKED with REVIEW_REQUIREMENT_UNMAPPED for the eight unmapped requirements, and records/preflight-bcf230a0bbee-1.json written`
* `Run 2, spec trimmed to R-007 and committed: REVIEW_INCOMPLETE with REVIEW_CONFIRMATION_MISSING and REVIEW_SEMANTIC_MISSING; advisory REVIEW_SECTION_UNRECOGNIZED did not change the result`
* `review confirm through a scripted pseudo-terminal wrote records/confirmation-0eb37a9142ec.json`
* `Run 3, with --semantic-report, --expect-fingerprint 0eb37a91…, and --expect-revision of HEAD: REVIEW_READY, exit 0, the fixed disclaimer, records/preflight-0eb37a9142ec-2.json`
* `Run 4, identical rerun with --json: REVIEW_READY naming preflight-0eb37a9142ec-2.json again; no third file`
* `Run 5, after an uncommitted edit to acceptance.md: REVIEW_STALE with REVIEW_CONFIRMATION_STALE, REVIEW_PACKET_FINGERPRINT_MISMATCH, REVIEW_SOURCES_UNCOMMITTED, and REVIEW_SOURCE_CHANGED for that file; git status and HEAD were unchanged by every run`

## Authority Used

* plan
* modify
* commit

## Residual Risks

* `TST-027 must not merge to main without TST-028 (Story R10a): until then any existing --semantic-report file lets the outcome reach REVIEW_READY.`
* `The Security Fixture Matrix row for batch.json sources.specs[0] = ../outside.md expects REVIEW_PATH_UNSAFE, but the command reports REVIEW_MANIFEST_INVALID, as review index already did before this branch; the test asserts the real code, and the row awaits Human Review.`
* `REVIEW_REVISION_STALE_TARGET is classified advisory in Core but never produced by preflight; the only producer is review import.`
* `--semantic-report accepts any path and only checks that a regular file exists at it, following parent symlinks; TST-028 must bound the path before reading the file.`
* `Any git exit 128 is reported as REVIEW_NOT_A_GIT_REPOSITORY, including dubious ownership and a corrupt repository; the result is still BLOCKED, but the message can mislead.`
* `Revision and response records are read without an aggregate bound, as review import, respond, and confirm already do.`
* `Human output prefixes every diagnostic with ISSUE, without its severity, so a reader cannot tell blocking from advisory lines without --json.`
* `The 10000-diagnostic ERROR bound is tested at Core level only; no CLI fixture reaches it.`
