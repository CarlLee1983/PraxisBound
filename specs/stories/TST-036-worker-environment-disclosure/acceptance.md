# Acceptance Criteria

AC IDs trace to `SPEC-BATCH-REVIEW/R-008` (authorization boundary) and issue
#123. This Story changes contract and workflow text only. Each criterion is
checked by reading the changed text in `verification.md`, and `make verify`
confirms that nothing else broke.

## Happy Path

* [ ] AC-001: Contract §11 step 7 and `agent-workflow.md` §3 step 7 require
  a Worker Environment Disclosure alongside the preview and approval token.
  The disclosure contains:
  * the inspected configuration home
  * hook events and each hook command's executable
  * MCP server names
  * whether a global `AGENTS.md` exists
  * whether the workspace has `.codex/`
  * the incompleteness sentence

  (R-008/AC-006; #123)

## Business Rules

* [ ] AC-002: Both texts state that the disclosure lists names and
  existence only, and never copies environment variables, arguments,
  tokens, headers, or URLs (R1).
* [ ] AC-003: Both texts state that an unread or uninspected location is
  reported as "not inspected", never as "none", and that the disclosure
  never claims the environment is safe or complete (R2, R3).
* [ ] AC-004: Both texts state that the disclosure grants no authorization,
  requires no separate acknowledgement, and does not block the handoff
  (R4). (R-008/AC-006; ADR-014)

## Regression Requirements

* [ ] AC-005: The following stay unchanged:
  * §11 steps, stop reasons, schemas, observation fields, and `review
    observe` rules (R5)
  * `protocol/`, `templates/`, and `VERSION`

  Contract §14 classifies the change as Corrective, and `make verify`
  passes.

## Acceptance Evidence

| AC | Method | Evidence | Fixture / precondition | Expected observation |
| --- | --- | --- | --- | --- |
| `AC-001` | manual | `specs/features/batch-review/contract.md` | `§11 step 7 and agent-workflow §3 step 7` | `disclosure-required-with-listed-contents` |
| `AC-002` | manual | `specs/features/batch-review/contract.md` | `§11 step 7 and agent-workflow §3 step 7` | `names-only-no-values` |
| `AC-003` | manual | `specs/features/batch-review/contract.md` | `§11 step 7 and agent-workflow §3 step 7` | `not-inspected-never-none` |
| `AC-004` | manual | `specs/features/batch-review/contract.md` | `§11 step 7 and agent-workflow §3 step 7` | `no-authorization-no-block` |
| `AC-005` | command | `make verify` | `current checkout` | `full-composed-gate-exit-0` |

## Security Fixture Matrix

| Source field | Payload | Expected result | Persisted locations | Verification |
| --- | --- | --- | --- | --- |
| `Codex config.toml mcp_servers` | `a server entry whose env holds an API token and whose args hold a URL` | reject | `disclosure lists the server name only; no token, env, argument, or URL in any report or record` | `specs/features/batch-review/contract.md` |
| `Codex hooks.json` | `a hook command with arguments that embed a path and a secret` | reject | `disclosure lists the event name and the executable only` | `specs/features/batch-review/contract.md` |
| `Codex configuration home` | `unreadable or absent file` | preserve | `disclosure says not inspected or absent, never none; handoff continues` | `specs/features/batch-review/contract.md` |
