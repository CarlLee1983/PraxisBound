# Verification Result: TST-028

## Checks

* lint: pass — `make verify exited 0 at c3cec3c; Prettier, ESLint, and shell/Node syntax checks passed`
* static: pass — `make verify exited 0; TypeScript build, Story contract, verification-plan, identity, and Core/CLI package-surface checks passed with semantic-report modules in the documented tarball lists`
* unit: pass — `make verify ran 799 Node tests: 798 pass, 0 fail, 1 skipped by design (4 MiB wall-clock smoke gated behind PRAXISBOUND_PERF_SMOKE=1)`
* integration: pass — `review-preflight-semantic.test.mjs and review-semantic-report.test.mjs drive the Core validator and review preflight against temporary repositories, reading the written Preflight Report; review-render-command.test.mjs covers the swept --output path fix`
* contract: pass — `cli-contract.md documents Semantic Report reading, the path rule, the gate and observation codes, and BLOCK/NOTE labels; the §9 Semantic Report rows and the R-007 out-of-batch row are what the tests assert`
* e2e: pass — `the built binary ran on a scratch batch with a Semantic Report written by a real Agent following agent-workflow.md §2; see Semantic Preflight Rehearsal below`
* architecture: blocked — `awaiting Human Review of feat/tst-028-preflight-semantic; one independent code and security review round found a CRITICAL path escape and more, all fixed in c3cec3c and checked by make verify and the rehearsal, not by a second review`

## Evidence

* `AC-001`: pass — `review-preflight-semantic.test.mjs: a confirmed batch with a valid current report yields REVIEW_READY, records semanticReport.sha256 of the file bytes, and lists non-blocking issues as advisory REVIEW_SEMANTIC_OBSERVATION with locators in semantic[]`
* `AC-002`: pass — `review-semantic-report.test.mjs and review-preflight-semantic.test.mjs: missing file, directory, FIFO, empty file, invalid UTF-8, invalid JSON, schema-invalid report, none-with-issues conclusion, different batchId, empty stories, duplicate Story, and out-of-batch Story give REVIEW_INCOMPLETE with MISSING or INVALID; an omitted Story gives REVIEW_SEMANTIC_COVERAGE; none reaches READY`
* `AC-003`: pass — `review-preflight-semantic.test.mjs: a previous-fingerprint report gives REVIEW_STALE with REVIEW_SEMANTIC_STALE in mechanical[], an empty semantic[], and the sha256 recorded; a blocking issue gives REVIEW_BLOCKED at its locator; a manifest, non-source, unknown-anchor, or wrong-hash locator gives REVIEW_SEMANTIC_INVALID`
* `AC-004`: pass — `review-preflight-semantic.test.mjs and review-semantic-report.test.mjs: over 1 MiB (checked by size before reading), depth 33, a string over 64 KiB, and more than 1000 issues give REVIEW_INPUT_TOO_LARGE, also when the same report has a schema error`
* `AC-005`: pass — `review-preflight-semantic.test.mjs: gate verdicts sit in mechanical[] and the Mechanical checks section, Agent observations in semantic[] and their own section, each human line is labelled BLOCK or NOTE, READY keeps the fixed disclaimer, and agent is shown only as Agent (self-reported)`
* `AC-006`: pass — `review-preflight-semantic.test.mjs: authorized/approved/instruction text is stored as data without changing the outcome; ESC and U+202E in agent are escaped; a symlink to a file outside the repository, ../x.json, and an absolute path through a symlinked directory followed by .. are REVIEW_PATH_UNSAFE or resolve inside the repository, never reading outside it, and write no Preflight Report`
* `AC-007`: pass — `make verify exited 0; VERSION, protocol/, and templates/ are unchanged against origin/main; TST-022 through TST-027 tests pass with only the accepted BLOCK/NOTE labels and fixture reports updated`
* `AC-008`: pass — `agent-workflow.md §2 states inputs, steps, guidance for the four categories, stop conditions, and output; one real Agent run is recorded under Semantic Preflight Rehearsal below`

## Semantic Preflight Rehearsal

Historical Evidence of one Agent run on 2026-09-23. It shows the workflow and
the command working end to end. It is not proof that this or any future
Agent's semantic judgments are correct, and the observations below are that
Agent's own claims.

* `Agent: Claude Code (claude-opus-5-5), the same session that implemented TST-027 and TST-028, following docs/batch-review/agent-workflow.md §2; not an independent reviewer`
* `Batch: BR-TST-027-rehearsal in a scratch git repository (ADR-014, ADR-015, the R-007 section of spec.md, TST-027 as it stood on 2026-09-23) at fingerprint 0eb37a9142ec…, with a script-typed confirmation`
* `Report: agent/semantic-report.json, sha256 5e5aabaac946…, one blocking missing-split (R-007/Acceptance: the batch maps all of R-007 to TST-027 while TST-027 leaves R-007 AC-002 to TST-028, which is outside the batch), one non-blocking insufficient-acceptance (acceptance AC-006: no criterion for the 10000-diagnostic ERROR bound), one non-blocking open-question (acceptance AC-005: whether preflight produces REVIEW_REVISION_STALE_TARGET); contradiction none`
* `Run at c3cec3c with --expect-fingerprint and --expect-revision of HEAD: REVIEW_BLOCKED; the Preflight Report preflight-0eb37a9142ec-3.json records the report sha256, REVIEW_SECTION_UNRECOGNIZED in mechanical[], and one REVIEW_SEMANTIC_BLOCKING with two REVIEW_SEMANTIC_OBSERVATION in semantic[]; the identical rerun reused that record`
* `After one added line in story.md: REVIEW_STALE with REVIEW_SEMANTIC_STALE and no semantic observations`
* `--semantic-report /etc/hosts: configuration-error, exit 2, REVIEW_PATH_UNSAFE`
* `The two non-blocking observations match residual risks TST-027 already recorded; the blocking one reflects this scratch batch's scope, not the real TST-027 plus TST-028 delivery`

## Authority Used

* plan
* modify
* commit

## Residual Risks

* `The rehearsal Agent is the implementing session, so the rehearsal shows the workflow can be followed, not that an independent Agent would reach the same judgments.`
* `A device node at the --semantic-report path is opened before the regular-file check; O_NONBLOCK keeps FIFOs from blocking, but a device open is not refused up front.`
* `story check and verification check still open absolute arguments without lexical normalization; they claim no in-repository rule, so this is not the TST-028 escape, but it was not changed.`
* `Absolute paths are now normalized lexically, so a/link/../b names a/b inside the repository rather than what the kernel would reach through the symlink; this is the intended safe reading and differs from shell semantics.`
* `The review fixes in c3cec3c were checked by make verify and the rehearsal, not by a second independent review.`
* `TST-027 and TST-028 must merge to main together (TST-027 Story R10a).`
