# Verification Result: TST-036

Verified on 2026-09-26 at `3f9f4ef` with this Story's contract and workflow
changes applied. Result: **pass** — AC-001 through AC-005. This is a
text-only change, so no disclosure has yet been produced in a real handoff
(see Residual Risks).

## Checks

* lint: pass — `make verify` exit 0.
* static: pass — `make verify` exit 0; `story-check` `STORY_CONTRACT_OK`.
* unit: pass — `make verify` exit 0; no test added or changed (text-only Story).
* integration: pass — `make verify` exit 0; no command, schema, or `review observe` rule changed.

## Acceptance Criteria

* `AC-001`: pass. Contract §11 step 7 (「（修訂，R-008，TST-036）同時交給人一份 Worker 環境揭露…」) and `docs/batch-review/agent-workflow.md` §3 step 7 both require the disclosure alongside the preview and approval token. Both list the same contents:
  * the inspected configuration home
  * hook event names and each hook command's executable
  * MCP server names
  * global `AGENTS.md` existence
  * workspace `.codex/` existence
  * the incompleteness sentence
* `AC-002`: pass. Both texts say to list names and existence only, and never to copy environment variables, arguments, tokens, headers, or URLs. The workflow text also says hook commands are listed without arguments.
* `AC-003`: pass. Both texts say an unread or uninspected location is 「未檢視」, never 「無」, and that the disclosure never claims the environment is safe or complete. The contract adds that the incompleteness sentence stays even when the list is empty.
* `AC-004`: pass. Both texts say the disclosure is not an authorization, does not block the handoff, needs no separate acknowledgement, and is not written into any record; `execution authorize` remains the only authorization.
* `AC-005`: pass.
  * `git diff main` over `protocol/`, `templates/`, `VERSION`, `specs/features/batch-review/schemas/`, and `packages/` is empty.
  * No §11 step number, stop reason, or observation field changed.
  * Contract §14 records the change as **Corrective**, and the contract header records the revision.
  * `make verify` exit 0.

## Residual Risks

* No real handoff has produced a disclosure yet. Whether an Agent following the text lists the right items for a given Codex version has not been observed. The next rehearsal (R-009, #91) should record one.
* The configuration locations come from observing `codex-cli 0.155.1` on one machine, not from Codex documentation. Codex may read other sources that the disclosure does not name; the incompleteness sentence discloses this but does not close it.
* This is an interim measure. The Worker still inherits the environment, and closing that gap is ForgePilot#64.
