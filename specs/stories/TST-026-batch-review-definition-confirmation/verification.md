# Verification Result: TST-026

## Checks

* lint: pass — `make verify exited 0; Prettier, ESLint, and shell/Node syntax checks passed`
* static: pass — `make verify exited 0; TypeScript build, Story contract, verification-plan, and Core/CLI package-surface checks passed with the new confirmation modules in the documented tarball lists`
* unit: pass — `make verify ran 646 Node tests: 645 pass, 0 fail, 1 skipped by design (4 MiB wall-clock smoke gated behind PRAXISBOUND_PERF_SMOKE=1)`
* integration: pass — `review-confirm-command.test.mjs and review-render-confirmation-command.test.mjs drive review confirm through an injected terminal and review render against temporary repositories, asserting envelopes, records/ contents, and page markers`
* contract: pass — `contract §8 carries the 修訂，R-006 applicability block the tests assert; cli-contract.md documents review confirm, its ordered checks, outcomes, and issue codes, and render's advisory staleness diagnostics`
* e2e: pass — `a manual scratch script, not committed, drove the built binary under a Python pseudo-terminal: review confirm deferred one non-blocking request with a typed reason, showed its U+202E and ESC characters as visible escapes, and wrote records/confirmation-<fp12>.json; render then stated that a confirmation is bound to the current fingerprint; after an uncommitted acceptance.md edit, render reported REVIEW_SOURCE_CHANGED for that path only and placed 需複審 beside that path in its requirement card and appendix; piped stdin was refused with REVIEW_CONFIRM_REQUIRES_TTY and no record`
* architecture: pass — `Human Review: carl accepted TST-026 in a Claude Code session on 2026-09-22, reviewing feat/tst-026-definition-confirmation at d258ada after one code and security review round, and after accepting the contract §8 R-006 decisions`

## Evidence

* `AC-001`: pass — `review-confirm-command.test.mjs: one confirm writes one record whose fingerprint, manifestSha256, sources, deferred, and revisionSheets match the batch; render writes no confirmation`
* `AC-002`: pass — `review-confirm-command.test.mjs: an unresolved blocking request refuses with REVIEW_UNRESOLVED_BLOCKING and writes nothing; non-blocking requests are recorded with typed reasons; a missing, oversized, or hidden-character reason is rejected or aborts`
* `AC-003`: pass — `review-confirmation.test.mjs and review-confirm-command.test.mjs: byte changes, added and removed documents, a manifest change, and an uncommitted edit after a real git commit stop applicability; re-rendering and records/ changes do not`
* `AC-004`: pass — `review-confirmation.test.mjs and review-confirmation-projection.test.mjs: the exact added, removed, changed, and missing sources are listed against the latest valid confirmation, and 需複審 appears only beside changed sources, including inside requirement cards`
* `AC-005`: pass — `review-confirm-command.test.mjs: a re-confirm keeps the old record byte-identical; authority text in responses and a forged records/preflight-*.json never make a confirmation apply; a record whose fingerprint disagrees with its own sources is invalid`
* `AC-006`: pass — `review-confirm-command.test.mjs: no Story, handoff, lifecycle, Gate, or Work Item file is written and output makes no authorization or acceptance claim`
* `AC-007`: pass — `review-confirm-command.test.mjs: non-TTY (injected, and a real spawn of the built binary with piped stdin), missing source, wrong prefix, abort, an existing same-fp12 record whose full fingerprint differs (REVIEW_RECORD_COLLISION), symlinked records/, and an injected write failure each give the contract outcome and leave no new file; an existing record with the same full fingerprint is REVIEW_CONFIRMATION_EXISTS success per contract §8 step 6`
* `AC-008`: pass — `malformed, misnamed, and fp12-mismatched confirmation files are REVIEW_RECORD_INVALID, never applicable, and never the baseline; control, bidi, and zero-width characters in request text are escaped in the prompt transcript`
* `AC-009`: pass — `make verify exited 0; VERSION, protocol/, and templates/ are unchanged against origin/main; TST-022 through TST-025 tests pass, with one pinned page hash updated because every page now shows source-path labels in requirement cards`
* `AC-010`: pass — `recorded under Terminal Confirmation Rehearsal below: carl ran review confirm on an interactive terminal and it wrote records/confirmation-934ce93bf960.json`

## Terminal Confirmation Rehearsal

Historical Evidence of one human-run confirmation on 2026-09-22. It shows
that the interactive path works end to end on a real terminal. It is not
identity proof, authorization, or acceptance of the batch's content.

* `Tool: packages/cli/dist/bin.js built from feat/tst-026-definition-confirmation at d258ada`
* `Batch: BR-TST-025-rehearsal in a scratch clone at commit 2117a18 plus an uncommitted RF-001 acceptance.md edit and one imported non-blocking request REV-01K5TST026E2E0000000000001; an earlier scripted pseudo-terminal confirmation confirmation-9be3d79df5c6.json bound the pre-edit fingerprint`
* `Command: carl ran node packages/cli/dist/bin.js review confirm specs/batches/BR-TST-025-rehearsal/batch.json in a separate interactive terminal window`
* `Result: records/confirmation-934ce93bf960.json created at confirmedAt 2026-09-22T15:39:19.258Z for fingerprint 934ce93bf960…, deferring REV-01K5TST026E2E0000000000001 with the typed reason "not thing"; the earlier record was left in place with its original timestamp`
* `Projection observation: review render afterwards stated that a confirmation is bound to the current fingerprint and showed no 需複審 marker`
* `Not captured: the terminal transcript was not pasted back, so prompt wording and escapes on the human's screen are not recorded here; the facts above come from the record file and a re-render`

## Authority Used

* plan
* modify
* commit

## Residual Risks

* `Requirement cards now show a visible source-path label on every source block (contract §18 conformance needed for 需複審), which changes every rendered page, including pages TST-025 described as unchanged.`
* `A confirmation is a claim, not identity: a pseudo-terminal script that types blindly can complete review confirm, and anyone with write access can forge an internally consistent record (accepted in contract §15 and ADR-014).`
* `review confirm prompts are in English while the Review Projection is in Traditional Chinese.`
* `The hidden and reordering code-point set omits U+061C, U+2060–U+2064, U+206A–U+206F, U+FFF9–U+FFFB, and tag characters.`
* `review confirm reads revisions and responses records without an aggregate bound, as review import and respond already do.`
* `The round-one review fixes were checked by make verify and a scripted e2e run, not by a second independent review.`
