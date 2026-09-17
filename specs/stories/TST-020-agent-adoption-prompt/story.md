# Story: TST-020 Agent Adoption Prompt

## Goal

An adopter can paste one documented, vendor-neutral prompt into an AI coding
agent and have the agent take a repository through Adoption with the published
package, and there is recorded evidence that real agents from more than one
vendor do so from the prompt alone.

## Context

TST-019 made `init`'s next steps a machine contract so that an agent can act on
them, and `ADR-012` states that an actual agent-driven adoption is a Human Review
observation rather than an automated check. Neither the prompt an adopter would
give an agent nor any such observation exists: `README.md` and
`docs/getting-started.md` say only that an agent can act on `data.nextSteps`.
TST019-AC-007 proves the steps sufficient when followed literally; it does not
prove that an agent follows them.

A design review on 2026-09-17 settled the approach. One fact shaped it: when the
target already holds `AGENTS.md`, `init` reports `INIT_CONFLICT`, installs
nothing and emits no next steps, and the only way forward with current tooling
is `--force`, which replaces that file. Many repositories already carry an
`AGENTS.md`, so the prompt must handle that case without silently discarding the
adopter's own instructions.

This Story changes documentation and adds evidence. It changes no command, no
Semantic Result and no Protocol surface. If the observations show the tooling is
insufficient, for example that merging an existing `AGENTS.md` back after
`--force` is unreliable, that finding is recorded and a tooling change becomes a
Story of its own.

## Classification

* Security sensitive: no
* Baseline conformance: no
* Task mode: mixed

## Authority

* plan: yes
* modify: yes
* add_dependency: no
* migration: no
* commit: yes
* push: yes
* deploy: no

## Architecture

* Impact: low
* Decision: `ADR-012`
* Boundary: `adopter-facing adoption documentation`
* Contract: `the agent adoption prompt uses only published package commands at the exact tooling version the repository declares`
* Owner: `adopter-facing adoption documentation = PraxisBound maintainers`

## Risk

* Level: medium
* Reason: `adopter-documentation`

## Scope

### In Scope

* An "Adopt with an AI agent" section in `docs/getting-started.md`, under the
  published package path, holding one copyable prompt and the explanation an
  adopter needs to use it.
* The prompt pins `@praxisbound/cli` to the exact version in
  `packages/cli/package.json` and instructs the agent to:
  run `init --json` on the repository root; act on `data.nextSteps` in order by
  `id`; build the verification gate from checks the repository already has,
  never from invented or always-passing commands; run Doctor and require PASS;
  then run `verify` and require success; report which checks the gate runs; and
  not commit.
* Existing `AGENTS.md` or another managed-file conflict: by default the agent
  stops and reports the conflicting paths without changing anything. The prompt
  documents a separate, optional replacement step the adopter may use instead:
  require the conflicting files to be committed so git holds the originals, run
  `init --force`, merge the repository's own instructions from the committed
  `AGENTS.md` back into the installed one, finish the steps, and present
  `git diff` for human review. Git, not a copy outside the repository, is the
  backup.
* A sentence in `README.md`'s published package section pointing to that
  section, and the missing package form of Codex activation in `README.md`.
* A static test holding the prompt's pinned version equal to the CLI package
  version and holding the prompt's required instructions.
* Six agent observations on the final committed prompt, run by the human in
  fresh sessions against two disposable fixture repositories the agent prepares
  outside this repository.

### Out of Scope

* Any change to `init`, Doctor, `verify`, the next-step contract or other
  tooling behavior, including preserving an existing `AGENTS.md` during `init`.
* Vendor-specific prompts, agent configuration files, or activation.
* Committing agent transcripts to the repository.
* Publishing a tooling version.

## Inputs

* The published `@praxisbound/cli` at the version in `packages/cli/package.json`.
* Two disposable fixture repositories: a Node project with no `AGENTS.md` whose
  tests run with `node --test` and no dependencies, and a Go project that already
  holds an `AGENTS.md` with marked repository-specific rules and its own tests.
* Claude Code and Codex sessions started fresh by the human.

## Outputs

* The prompt section in `docs/getting-started.md` and the `README.md` pointers.
* A static documentation test.
* A verification record of six observations against the final prompt commit.

## Rules

* R1: The prompt names only published package commands, pinned to the exact
  CLI version declared in `packages/cli/package.json`.
* R2: The prompt is vendor-neutral: it names no agent product and relies on no
  vendor-specific file or command.
* R3: The prompt tells the agent to act on next steps by `id` from `--json`
  output, not by parsing printed prose.
* R4: The gate must run checks the repository already has. A gate that still
  passes after one of those checks is broken does not satisfy this Story.
* R5: Without the optional authorization, the agent never runs `init --force`
  and leaves the repository unchanged on conflict. With it, every rule in the
  repository's original `AGENTS.md` survives in the result.
* R6: The agent does not commit.
* R7: Every recorded observation uses the same prompt text, identified by the
  commit that holds it. Changing the prompt after an observation invalidates
  every observation and requires all six to be repeated.
* R8: An observation counts only if the human's input during the session was
  limited to tool-permission decisions and, when the agent asked a question, the
  reply "follow the prompt and decide". Any other input marks the observation
  assisted; it is recorded and does not count.
* R9: Pass or fail for an observation is established by the agent inspecting the
  fixture repository's final state, not by the observed agent's own report.

## Expected Errors

* An observed agent that stops at `INIT_CONFLICT` under the optional
  authorization, or forces under the default prompt, fails that observation.
* A gate that runs no repository check, or still exits 0 after a repository test
  is deliberately broken, fails that observation even when Doctor and `verify`
  pass.
* An observation whose merged `AGENTS.md` drops any marked original rule fails.
* An observation in which the agent commits, or changes files outside the
  fixture repository, fails.
* A prompt whose pinned version differs from `packages/cli/package.json` fails
  the static test.

## Dependencies

* TST-019 supplies the next-step contract and `ADR-012` the vendor-neutral
  adoption position.
* PB-004 published `@praxisbound/cli@0.2.0`, which carries the next steps.

## Constraints

* Add no dependency and change no tooling behavior.
* Keep static test fixtures inside the test's temporary directory; keep the
  observation fixture repositories outside this repository.
* `make verify` is authoritative for local completion; observations are external
  and recorded only when actually made.

## Guidance

Relevant:

* principle: small coherent changes
* decision: `ADR-012` defines what an agent may rely on in the next steps

Not applicable:

* no persistent-data migration, publication or Protocol change applies
