# Story: TST-036 Worker Environment Disclosure Before Authorization

## Goal

Make the handoff disclose, before the human authorizes, the Codex
configuration that the Worker will inherit beyond the authorized Worker
Profile. At contract §11 step 7, the Agent hands the human a Worker
Environment Disclosure together with the preview and the approval token.
The disclosure lists the hooks, MCP servers, and global instructions it can
read, by name only, and says plainly that the list may be incomplete. The
human's `execution authorize` then happens with that risk in view. Nothing
blocks, and no command or schema changes.

## Context

GitHub issue #123 traces this work to `SPEC-BATCH-REVIEW/R-008`. TST-035
finding F-11 is the source. On ForgePilot `3a76aca`, the Codex Worker
inherited the human's `~/.codex` hooks and MCP servers. graft's
`post-edit-sync` hook then wrote `graft/`, a `.gitignore` addition, and a
`.ignore` into the fixture
(`specs/stories/TST-035-forgepilot-second-segment/verification.md`). The
execution authorization binds only `worker_profile`: executable, model,
effort, and sandbox.

carl chose this option in #123 triage on 2026-09-26: an interim disclosure
at step 6–7. The other two options were waiting for ForgePilot#64, or
refusing the second segment without an explicit risk acceptance. The
ForgePilot-side mechanism, an isolated or declared Worker environment, is
ForgePilot#64. When it lands, a later Story replaces this disclosure with
that mechanism.

The locations below were observed on this machine with `codex-cli 0.155.1`
and are not taken from Codex documentation:

* `~/.codex/config.toml` — `[mcp_servers.<name>]` tables and `[hooks.*]` state
* `~/.codex/hooks.json` — hook event names and commands
* `~/.codex/AGENTS.md` — global instructions

`codex --help` names `~/.codex/config.toml` as the default configuration.
The workspace may also carry its own `.codex/` directory. This Story does
not claim these are the only sources Codex reads.

## Classification

* Security sensitive: yes
* Baseline conformance: no
* Task mode: execution

## Authority

* plan: yes
* modify: yes
* add_dependency: no
* migration: no
* commit: yes
* push: no
* deploy: no

## Architecture

* Impact: low
* Decision: `ADR-016`
* Decision: `ADR-014`
* Boundary: `batch review handoff contract`
* Contract: `the disclosure is information for the human's authorization decision; it grants nothing, blocks nothing, and is not recorded as authorization`
* Contract: `no PraxisBound command reads Codex configuration; the Agent does, following the workflow document`
* Owner: `batch review handoff contract = PraxisBound tooling`

## Risk

* Level: high
* Reason: `security`
* Reason: `public-contract`

## Scope

### In Scope

* Contract §11 step 7: the Agent gives the human a Worker Environment
  Disclosure together with the preview and approval token. The disclosure
  contains:
  * the Codex configuration home it inspected
  * the names of the hook events and the hook commands' executables
  * the names of the MCP servers
  * whether a global `AGENTS.md` exists
  * whether the workspace has a `.codex/` directory
  * one sentence stating that the list comes from what the Agent could read
    and may be incomplete
* The same step in `docs/batch-review/agent-workflow.md` §3.
* Contract §14: the change is classified as **Corrective**.
* `specs/stories/TST-036-worker-environment-disclosure/verification.md`.

### Out of Scope

* Blocking the second segment, or asking for a separate risk acceptance.
* Any PraxisBound command, schema, observation field, or `review observe`
  rule. The disclosure is not written into any record.
* Changing the human's Codex configuration, or isolating the Worker. The
  isolation itself is ForgePilot#64.
* Reading or reporting configuration values: environment variables, tokens,
  URLs, or arguments.

## Inputs

* The human's Codex configuration files, read by the Agent.

## Outputs

* Contract and workflow text.
* In a real handoff, a disclosure in the Agent's report to the human.

## Rules

* R1: The disclosure lists names only: hook event names, the executable
  path of each hook command, MCP server names, and file existence. It never
  copies environment variables, arguments, tokens, headers, or URLs from
  the configuration.
* R2: A file the Agent cannot read, or a location it did not inspect, is
  reported as "not inspected". It is never reported as "none".
* R3: The disclosure never states or implies that the Worker environment is
  safe or complete. An empty list still carries the incompleteness
  sentence.
* R4: The disclosure is not an authorization. The human's `execution
  authorize` remains the only authorization, and the Agent does not wait
  for a separate acknowledgement.
* R5: §11 steps, stop reasons, and schemas are unchanged.

## Expected Errors

* The configuration is unreadable or absent: the disclosure says "not
  inspected" or "absent" for that location, and the handoff continues.

## Dependencies

* Human Review by carl approved this Story for execution in a Claude Code
  session on 2026-09-26, with the disclosure at step 7 and the observed
  configuration locations as drafted.
* TST-035 (#122) is merged. Issue #123 (triage) chose option 2.
* To be superseded when ForgePilot#64 provides Worker isolation or
  declaration.

## Constraints

* Add no dependency.
* **Corrective** (§14): `review goal-plan`, `review observe`, and the Agent
  workflow are unreleased. `protocol/`, `templates/`, `VERSION`, and every
  `schemaVersion` stay unchanged.
* `make verify` is authoritative for completion.
* Do not merge, publish, tag, release, deploy, or push.

## Guidance

Relevant:

* decision: `ADR-014` records never grant authority, so a disclosure never
  grants authority either.
* principle: disclose rather than prevent (decision-records rule).

Not applicable:

* no persistent-data migration, publication, Protocol change, or model
  integration applies

## Trust Boundary Fields

* `Codex configuration files (config.toml, hooks.json, AGENTS.md, workspace .codex/)` — the human's local configuration, untrusted and possibly secret-bearing; only names and existence leave it.
