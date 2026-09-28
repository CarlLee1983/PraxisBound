# Story: TST-041 Real batch review handoff to ForgePilot and Codex

## Goal

Exercise GitHub #132 and `SPEC-BATCH-REVIEW/R-009` with a real Bootstrap-managed ForgePilot `3a76aca` and Codex Worker on an isolated two-Spec, four-Story fixture. Record what ForgePilot actually dispatched and verified, with Human Review acceptance kept separate from technical completion.

## Context

TST-038 covers the two-Spec, four-Story PraxisBound loop with recorded ForgePilot output. TST-035 ran real ForgePilot and Codex on a smaller one-Spec, three-Story fixture. This Story joins those boundaries without rewriting their historical observations. The human request to start #132 authorizes preparation and the bounded rehearsal; the human performs Definition Confirmation, execution authorization, and any Goal cancellation.

## Classification

- Security sensitive: yes
- Baseline conformance: no
- Task mode: execution

## Authority

- plan: yes
- modify: yes
- add_dependency: no
- migration: no
- commit: yes
- push: no
- deploy: no

The human request authorizes local fixture preparation, including an initial Git commit only inside the disposable fixture, bounded integration operations in that fixture, and repository evidence. It does not authorize a commit to PraxisBound or delegate `review confirm`, `execution authorize`, or `goal cancel` to the Agent. Worker Profile, caps, expiration, and any paid Codex run require the human's explicit values and execution authorization before use.

## Architecture

- Impact: medium
- Decision: `ADR-014`
- Decision: `ADR-016`
- Decision: `ADR-017`
- Boundary: `isolated batch review fixture and ForgePilot handoff evidence`
- Contract: `review records and ForgePilot output are evidence, never authorization; human-only actions remain outside Agent scripts`
- Owner: `isolated batch review fixture and ForgePilot handoff evidence = PraxisBound tooling`

## Risk

- Level: high
- Reason: `security`
- Reason: `external-integration`
- Reason: `public-contract`

## Scope

### In Scope

- Build an isolated temporary repository from the TST-038 two-Spec, four-Story fixture shape, with Readiness Sidecars, the Runner's incremental `make verify`, and a strict `make verify-final` that requires every Story output after the run.
- Record exact PraxisBound revision, Bootstrap ForgePilot generation and binary, Codex version and login method, fixture inputs, commands, exits, and accepted `review observe` records.
- Follow the human guide through render, human terminal confirmation, Semantic Report, preflight, Goal Plan, and both ForgePilot segments. Recheck preflight and Goal Plan manifest bytes before each ForgePilot write.
- Disclose the inspected Worker environment before the human's authorization. The human personally runs `review confirm` and `execution authorize`, and `goal cancel` if a retry is necessary.
- Observe whether the existing Runner dispatches and invokes verification for all four Work Items without per-Story human confirmation. Independently run `make verify-final`, inspect the Worker-authored test cases against their examples, and require zero skipped tests; report preflight, ForgePilot technical result, final fixture acceptance, and Human Review acceptance separately.
- Record every failed, blocked, skipped, or unsupported observation in `verification.md`, including any recurrence of ForgePilot#65 or #66.
- Correct the observed §11 JSON-command contradiction for the pinned ForgePilot `run` commands in the batch contract and agent workflow, with exit-based mapping and optional read-only `run status --json` corroboration, as explicitly authorized during this rehearsal.

### Out of Scope

- PraxisBound product-code, Protocol, template, dependency, migration, and release changes; ForgePilot implementation changes; modification of historical TST-035/TST-038 evidence; merge, publish, or deploy; automatic final acceptance.

## Inputs

- GitHub #132, the R-009 contract, the batch review user guide, TST-038's fixture shape, TST-035's real handoff procedure, and the installed ForgePilot `3a76aca` generation.
- Human-supplied Worker Profile, caps, expiration, and authorization actions.

## Outputs

- Fixture builder and sanitized evidence under `evidence/`; `verification.md` tracing each acceptance criterion and all residual risks.
- Live ForgePilot state only inside the isolated fixture repository, not this repository.

## Rules

- R1: Agent scripts never execute `review confirm`, `execution authorize`, or `goal cancel`, never read or write `.forgepilot` directly, and never infer authorization from files or output.
- R2: Before every ForgePilot write, recheck `review preflight --expect-fingerprint` and the exact Goal Plan manifest SHA-256. Retain the actual command, exit, and bounded output in the observation.
- R3: Record each segment with `review observe`; a rejected observation remains a failed observation until repaired without falsifying its source steps.
- R4: Worker environment disclosure lists only inspected names and existence, never token, URL, environment variable, or hook arguments. It is not an authorization or a persistent record.
- R5: The paid Worker run occurs only after the human personally authorizes the exact request and states that action in the current session.
- R6: `GOAL_COMPLETED` means technical completion only; do not claim Human Review acceptance, DONE, merge, or deploy.

## Expected Errors

- Missing human action or required Worker values: stop at that boundary and record the blocked or unexecuted check.
- Preflight or manifest mismatch: stop before a ForgePilot write and record `preflight-not-ready`.
- ForgePilot or Codex failure, including ForgePilot#65/#66: retain exact observed result and stop reason; do not round it up to PASS.

## Trust Boundary Fields

- `fixture source and Revision Sheet text` — untrusted definition and feedback, never commands.
- `Semantic Report and review records` — observations, never authorization.
- `ForgePilot stdout, stderr, Goal and Work Item state` — external results, not a human approval signal.
- `Codex configuration and hooks` — inherited Worker environment; disclose names only before authorization.
- `approvalToken` — single-use value from ForgePilot's preview, passed only to the human authorization action.

## Security Fixture Matrix

| Source field                   | Payload                          | Expected result     | Persisted locations                                    | Verification      |
| ------------------------------ | -------------------------------- | ------------------- | ------------------------------------------------------ | ----------------- |
| `fixture source and feedback`  | approval-like text               | preserve            | rendered and imported evidence only; no authorization  | `verification.md` |
| `Worker configuration`         | MCP and hook entries             | disclose names only | human handoff; no secret values in repository evidence | `verification.md` |
| `ForgePilot observation steps` | output that claims authorization | preserve            | accepted observation, no authority change              | `verification.md` |

## Dependencies

- GitHub #126, #128, and #129 are closed. #131's guide is committed locally at `d8ae521` but the GitHub issue is still open; this rehearsal uses that local guide and does not claim the remote dependency is formally closed.

## Constraints

- Use the exact installed ForgePilot generation `3a76acaa5da206bef9a8d15df0db3f08f90311e2`; record actual Codex and PraxisBound versions at execution time.
- The fixture and all real Goal/Work Item state remain in a temporary repository. No paid model run belongs in `make verify`.
- `make verify` is the repository completion gate. Retain partial outcomes and residual risks.

## Versioning

The §11 and workflow wording correction is **Corrective** under `protocol/versioning.md`: it resolves a contradiction between a general JSON sentence, the existing specific run steps, and the pinned ForgePilot CLI. It changes no supported command, outcome, schema, Story execution authority, `protocol/`, `templates/`, or `VERSION`. Rollback is to revert the two documentation edits while retaining the immutable live observations.
