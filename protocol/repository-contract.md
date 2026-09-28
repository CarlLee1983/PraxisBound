# Repository Contract

A repository adopts PraxisBound by exposing stable places for intent, agent
guidance, and deterministic verification. The contract is independent of
language, framework, AI vendor, and CI provider.

## Required entrypoints

An adopting repository provides exactly these core entrypoints:

```text
AGENTS.md
Makefile                  # exposes: make verify
specs/stories/
```

- `AGENTS.md` tells coding agents to follow the Story, preserve scope,
  test changed behavior, and use the verification scope the approved Story and
  repository policy require.
- `specs/stories/` stores approved intent and acceptance criteria.
- `make verify` runs every automated check required by the full-repository gate.

These entrypoints are the adoption contract. They are not an inventory of
every file PraxisBound may install, discover, or document. Each repository owns
its Makefile and technology-specific setup.

## Structural invariants

`specs/stories/` is the Story contract root. Each ready Story lives at
`specs/stories/<story-id>/`, contains `story.md` and `acceptance.md`, and may
contain additional Story-owned artifacts. `task.md` is optional human context,
not a required Story file. These structural invariants do not replace the
content rules of the [Story Contract](story.md).

The [bootstrap script](../scripts/bootstrap) uses an internal installation
manifest to copy its guide, starter Story template, optional Guidance starter,
and `specs/.praxisbound-adoption` marker. That source-to-destination list is an
installer implementation detail, not a repository conformance contract.

## Optional engineering guidance

Fresh bootstrap installs a four-document opinionated starter layout:
`guidance/ENTRY.md`, `PRINCIPLES.md`, `DECISIONS.md`, and `PRACTICES.md`. The
directory becomes repository/team-owned knowledge: an upgrade never reads or
writes it, while explicit `--force` replaces the starter files. Guidance is an
optional capability. Its detected contract is centered on a readable,
non-blank `guidance/ENTRY.md`; the remaining starter documents are neither a
protocol-required inventory nor a restriction on repository customization.

## Optional Repository Doctor

[Repository Doctor](../docs/doctor.md) is an optional PraxisBound command for
inspecting an adoption. In its default static mode, it requires only a readable
non-blank `AGENTS.md`, readable `specs/stories/`, and readable non-blank
`Makefile`; detected optional capabilities are checked at their own entrypoint.
It does not run `make`, target code, network
operations, dependency installation, or Git mutations. It does not require a
first Story, `_template/`, `task.md`, Skills, or CI configuration.

With explicit `--run-verify` authorization and only for a trusted repository,
Doctor invokes the repository-owned `make verify` once from the resolved
physical root. That mode is not read-only or sandboxed. Doctor does not change
this adoption contract, create an alternative verification command, or become
mandatory for existing adopters.

## Verification ownership

The repository decides which checks belong behind `make verify` and keeps that
full gate authoritative as the codebase evolves. Local development and CI call
it at integration, release, or any repository-defined full-gate boundary. An
approved Story may name focused commands for a bounded change when repository
policy permits. Those commands provide evidence for that Story's scope, not a
new full-repository PASS.

See [the Verification Contract](verification.md) for exit status and repair-loop
semantics.

## Requirement precedence

For implementation work:

1. approved `story.md` and `acceptance.md` define product
   intent;
2. specific repository guidance and architecture inform implementation judgment;
3. repository tooling determines automated PASS or FAIL;
4. human review decides whether verified work satisfies intent and may merge.

Guidance is advisory unless a repository makes a rule executable. When these
sources conflict, stop at the smallest unresolved intent decision
instead of silently changing requirements or bypassing verification.

## Optional extensions

Guidance, immutable Handoff evidence, Skills, CI configuration, the adoption
marker, templates, and repository-specific extensions are optional
capabilities. Their absence does not make core adoption incomplete. A detected
capability is validated only where PraxisBound defines its entrypoint contract;
new optional capabilities must not implicitly expand the required entrypoints.

## Portability boundary

PraxisBound does not require an agent runtime, workflow service, task scheduler,
database, dashboard, prompt format, or LLM abstraction. Repositories may add
their own tools, but adoption depends only on files, Make, and existing
development and CI systems.
