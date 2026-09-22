# Verification Result: TST-025

## Checks

* lint: pass — `make verify exited 0; Prettier, ESLint, and shell/Node syntax checks passed`
* static: pass — `make verify exited 0; TypeScript build, Story contract, verification-plan, and Core/CLI package-surface checks passed after the new render-evidence, review-evidence, and review-paths modules were added to the documented tarball surface`
* unit: pass — `make verify ran 592 Node tests: 591 pass, 0 fail, 1 skipped by design (4 MiB wall-clock smoke gated behind PRAXISBOUND_PERF_SMOKE=1)`
* integration: pass — `review-render-evidence-command.test.mjs and the four review-agent-workflow-*.test.mjs files run review index, import, respond, and render against temporary repositories and assert envelopes, diagnostics, records/ contents, and source bytes`
* contract: pass — `contract §13 and §20 (R-005) carry the accepted projection rules; cli-contract.md documents the render evidence area and its diagnostics; render outcomes and the result-envelope schema are unchanged`
* e2e: pass — `a manual scratch script, not committed, drove the built praxisbound binary on a temporary batch: import reported target match, respond wrote records/responses-<to12>-1.json for a needs-decision answer, render produced an evidence area showing the request id, response question, raw match judgement, and the historical-Evidence note, with the injected img tag and U+202E escaped and no diff wording; adding records/responses-000000000000.json made render report REVIEW_RECORD_INVALID with that path and still succeed`
* architecture: blocked — `Human Review of the implementation has not happened; the REVIEW_PATH_UNSAFE rule and the prose-LF rendering rule, both added to contract §20 after the 2026-09-22 acceptance, await Human Review`

## Evidence

* `AC-001`: pass — `review-agent-workflow-response-cycle.test.mjs: a scripted agent answers every effective id exactly once (a superseded id is not answered) through review respond, and the record equals the input verbatim`
* `AC-002`: pass — `review-agent-workflow-routes.test.mjs: presentation leaves definition sources and the fingerprint unchanged, story-derivation changes only acceptance.md, spec-requirement changes only spec.md, and decision leaves the accepted ADR byte-identical with needs-decision or a not-incorporated replacement proposal`
* `AC-003`: pass — `review-response-projection.test.mjs and review-render-evidence-command.test.mjs show the request, response, record path, from/to fingerprints, locator, raw §5 judgement, and an in-page link on match`
* `AC-004`: pass — `review-agent-workflow-targets.test.mjs: hash-mismatch, anchor-missing, and anchor-duplicate targets are reported by import, left byte-identical, answered with a question or rationale, and an incorporated answer with the stale locator is rejected with REVIEW_RESPONSE_INVALID and no record`
* `AC-005`: pass — `tests assert revisions-before-responses file-name order over createdAt, superseded and stale labels, and no approval, state, or diff wording in the evidence area`
* `AC-006`: pass — `review-agent-workflow-authority.test.mjs: no revision Skill is shipped; import, respond, index, and render succeed without any Skill directory, and a hostile .agents/skills file changes neither render bytes nor index data`
* `AC-007`: pass — `review-response-projection.test.mjs: an img onerror payload in a request proposal and in response rationale and question, a javascript: link in source text, and authority phrases stay escaped text; bidi, zero-width, and BOM characters are escaped in request rationale, response rationale and question, and invalid record paths; review-agent-workflow-authority.test.mjs: no confirmation or other record is created`
* `AC-008`: pass — `invalid and cross-record-conflicting records, and a records/ path that cannot be listed (a plain file), are REVIEW_RECORD_INVALID with paths; 201 files and 11000 entries are REVIEW_INPUT_TOO_LARGE with no record content and no content read in the file-count case; exactly 200 files and 10000 entries render; no source or record is written`
* `AC-009`: pass — `review-agent-workflow-targets.test.mjs and -routes.test.mjs: stale, missing, duplicate, and accepted-ADR targets stop before any edit with a specific question or non-incorporated response`
* `AC-010`: pass — `make verify exited 0; VERSION, protocol/, and templates/ are unchanged against origin/main; with no records, review render output from the built CLI at 192bb85's parent 375684d and from this tree has the same sha256 (2f26796f…), a Core test pins that hash, and review index output is unchanged when records exist`
* `AC-011`: blocked — `no real existing coding Agent rehearsal has been run and recorded; it requires a human-observed run on a versioned batch`

## Authority Used

* plan
* modify
* commit

## Residual Risks

* `Record bytes have no aggregate bound: 200 valid files of up to 1 MiB each can expand past Node's maximum string length when escaped, turning render into REVIEW_INTERNAL_ERROR; a total-size cap is a pending human decision.`
* `Evidence labels such as match and "回應綁定當前指紋" compare self-reported record fields; anyone with repository write access can forge a record that looks incorporated.`
* `The workflow tests are a scripted stand-in: they prove the CLI surface and byte effects, not that a real Agent follows docs/batch-review/agent-workflow.md.`
* `@praxisbound/core gains four public exports (Additive): isHiddenOrReorderingCodePoint, escapeHiddenCharacters, isSyntacticallySafeRepoPath, compareUtf8.`
* `validateRevisionRecordSet names only the file holding the second superseder of a doubly superseded id; the first file stays valid and renders.`
* `The visible escape format does not escape a literal backslash, so record text containing the characters \x202e reads the same as an escaped U+202E; U+061C and U+2060–U+2064 are not in the hidden code-point set.`
* `A second independent code review verified the first-round fixes; the round-two fixes (iterated cross-record validation, envelope-safe record paths, byte-order sorting) were checked by make verify only.`
