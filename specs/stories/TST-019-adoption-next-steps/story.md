# Story: TST-019 Adoption Next Steps

## Goal

A caller who adopts PraxisBound through the published package is told what
still has to happen before the repository is a complete Adoption, as structured
data it can act on rather than prose it has to interpret, and an adopter reading
the project's own documentation learns that this path exists at all.

## Context

GitHub issue #58 specifies this work; issues #59, #60, #61 and #62 are its
slices, not separate Stories. Adopting today assumes a checkout of this
repository: `README.md` and `docs/getting-started.md` teach only
`./scripts/bootstrap /path/to/repository`, and the published `@praxisbound/cli`
appears in neither.

A caller who knows to run the package still stops short. `init` writes
`AGENTS.md`, `guidance/`, the Story templates and the adoption marker, but it
deliberately writes no `Makefile`: the glossary defines an Adoption as a
repository that owns its local verification gate, so writing the gate would move
ownership to the Reference Tooling. Nothing told the caller a gate was still
missing, so `doctor` could not reach PASS and the repository was left
half-adopted with no instruction on how to finish. PB-003's public smoke
evidence records exactly this failure shape.

`ADR-012` records the position this Story implements: the adoption path is
vendor-neutral and machine-consumable. It was accepted on 2026-09-16 and its
architecture slice (issue #59) is already delivered.

This is additive Reference Tooling behavior. The Protocol contract is untouched
and `VERSION` remains `0.10.0`. The portable shell entrypoints remain
zero-dependency POSIX shell; TST-018 rule R6 — Node stays confined to optional
maintainer tooling — continues to hold, because the package path is an
alternative for adopters who already have Node, never a prerequisite for
adopting the Protocol.

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
* push: no
* deploy: no

## Architecture

* Impact: high
* Decision: `ADR-012`
* Boundary: `init next-step contract`
* Boundary: `CLI human renderer for init`
* Boundary: `packed-package sufficiency proof`
* Boundary: `adopter-facing adoption documentation`
* Contract: `init emits an ordered next-step collection under the result envelope data on both the preview and the applied outcome`
* Contract: `step identifiers, ordering and presence are version-protected; step descriptions are presentation and may be reworded`
* Contract: `no mode of the command writes a verification gate into the target repository`
* Owner: `init next-step contract = PraxisBound tooling`
* Owner: `CLI human renderer for init = PraxisBound tooling`
* Owner: `packed-package sufficiency proof = PraxisBound maintainers`
* Owner: `adopter-facing adoption documentation = PraxisBound maintainers`

## Risk

* Level: high
* Reason: `public-contract`

## Scope

### In Scope

* Emit an ordered next-step collection in `init`'s Semantic Result under the
  envelope's `data`, each step carrying a stable identifier and a
  human-readable description, on both the preview and the applied outcome.
* Print the same steps as readable prose on stdout for a watching human.
* Prove, against the packed package in a disposable clean consumer, that a
  consumer executing the emitted steps literally reaches a PASSing `doctor`.
* Present the package path and the portable shell path side by side in
  `README.md` and `docs/getting-started.md`, each with its requirements stated,
  and call out that the unscoped package name is not controlled by this
  project. (#58 and #62 say it "resolves to an unrelated third-party package".
  That was true of the former `forgeflow` name and was carried over by mistake:
  on 2026-09-16 `registry.npmjs.org/praxisbound` returned 404 while
  `registry.npmjs.org/forgeflow` returned an unrelated `forgeflow@0.6.0`. The
  documentation states the verifiable claim instead.)
* Record the vendor-neutrality and machine-contract position as `ADR-012`.

### Out of Scope

* Migrating `scripts/bootstrap`, `doctor`, `story-check`, `verification-check`,
  `handoff-check` or `codex-activate` to Node, or changing their behavior in any
  way.
* A new `adopt` command, deprecating `init`, or restructuring activation.
* Writing a `Makefile` into adopter repositories in any form, including a
  suggested file under a different name.
* Supporting any further vendor-native agent format, or writing
  `.agents/skills/praxisbound/` from the default adoption path.
* A reusable GitHub Action, publishing, tags, releases, dist-tags, Protocol
  `VERSION`, and the missing `0.10.0` release note.

## Inputs

* The caller's `init` invocation, its target repository path, and its mode
  (preview or applied, safe/force/upgrade).
* The existing result envelope and its `RESULT_SCHEMA_VERSION`.
* The packed `@praxisbound/core` and `@praxisbound/cli` tarballs installed into
  a disposable consumer.

## Outputs

* An ordered next-step collection under the result envelope's `data`, present on
  both the preview and the applied outcome.
* The same steps rendered as prose on stdout.
* A packed-consumer test that follows the steps literally and requires a PASSing
  `doctor`.
* `README.md` and `docs/getting-started.md` presenting both adoption paths as
  equals.

## Rules

* R1: The next steps live under the envelope's `data`, never at its top level,
  which is closed to additional properties. `RESULT_SCHEMA_VERSION` stays
  `1.0.0` and existing envelope validation keeps passing.
* R2: Each step is an object with a stable identifier and a human-readable
  description, and the collection is ordered. Identifiers, ordering and the
  presence of a step are version-protected; the description wording is not.
* R3: Two steps are in scope: create a verification gate exposing
  `make verify`, then run `doctor` and observe PASS. The gate step precedes the
  confirmation step.
* R4: The gate step states a required observable outcome, never a file body or a
  named toolchain, because the Reference Tooling cannot know whether the target
  is a Go, Node or Python repository.
* R5: No mode of the command writes a verification gate into the target
  repository. The steps communicate the ownership boundary; they never remove
  it.
* R6: The prose printed for a human is rendered from the same steps and is never
  the contract. Rewording a description is not a contract change; removing,
  reordering or renaming a step is.
* R7: The sufficiency proof runs against the packed package in a disposable
  consumer, derives its actions from the emitted steps rather than from
  hard-coded knowledge of what adoption requires, and invokes no language model
  and no network credentials. It proves the instructions sufficient; it does not
  test an agent.
* R8: The portable shell path is unchanged. `scripts/bootstrap` produces no
  Semantic Result, gains no next steps, and adopting through it still requires
  only files, Make and the repository's existing CI.

## Expected Errors

* An `init` invocation that fails before producing an outcome reports its
  existing typed failure and emits no next steps; the steps are an outcome
  payload, not a consolation for a failed run.
* A packed consumer that follows the steps and still cannot reach a PASSing
  `doctor` fails the sufficiency proof, naming the step that proved
  insufficient rather than reporting a generic mismatch.
* An envelope carrying next steps at the top level rather than under `data` is
  rejected by existing schema validation with its existing unknown-field
  behavior.
* `INIT_CLEANUP_INCOMPLETE` carries no next steps even though the target was
  written, because the run did not reach a clean outcome. This is deliberate
  and out of scope: the caller's next action is the reported staging residue,
  not the adoption gate. Restoring steps to that outcome is a Story of its own,
  not a defect to be repaired here.

## Dependencies

* `ADR-012` is accepted and records the vendor-neutrality and machine-contract
  position this Story implements.
* TST-012 and TST-013 supply the existing `init` planning, apply and recovery
  behavior this Story only adds output to.
* TST-016 supplies the packed process-consumer pattern and PB-003 the public
  package acquisition evidence the sufficiency proof reuses.
* GitHub issues #59, #60, #61 and #62 carry the approved slice boundaries.

## Constraints

* Add no dependency, and do not push, merge, publish, tag, release, deploy or
  migrate data.
* Keep every fixture inside the test's temporary directory; never make this
  repository's own Stories, handoff or work tree the subject under test.
* `make verify` is authoritative for completion. No Story-specific command
  redefines PASS.
* Changing `templates/` or `protocol/` requires a classification recorded here
  first; this Story expects to change neither.

## Guidance

Relevant:

* principle: small coherent changes
* principle: behavior-oriented testing
* principle: deep module interface
* decision: `ADR-008` defines the envelope the steps travel in
* decision: `ADR-012` defines what is version-protected about them

Not applicable:

* no persistent-data migration, package publication, or Protocol change applies
