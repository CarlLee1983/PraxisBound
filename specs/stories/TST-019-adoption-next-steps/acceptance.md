# Acceptance Criteria

## Happy Path

* [ ] AC-001: Machine-readable `init` output carries an ordered next-step
  collection under the result envelope's `data`, on both the preview and the
  applied outcome. Each step carries a stable identifier and a human-readable
  description, and the gate-creation step precedes the confirmation step.
* [ ] AC-002: The same steps are printed as readable prose on stdout for a
  watching human, rendered from the same collection rather than composed
  separately.

## Business Rules

* [ ] AC-003: The gate-creation step describes a required observable outcome —
  a verification gate exposing `make verify` — and names no file body and no
  specific toolchain. The confirmation step names running `doctor` and
  observing PASS.
* [ ] AC-004: No mode of the command writes a verification gate into the target
  repository. `RESULT_SCHEMA_VERSION` is unchanged and existing result-envelope
  schema validation passes with the new `data` content.
* [ ] AC-005: Command-boundary tests assert step identifiers, presence and
  ordering, and never assert description wording, so rewording a step does not
  fail them.

## Failure Cases

* [ ] AC-006: An `init` invocation that fails before producing an outcome
  reports its existing typed failure and emits no next steps.

## Regression Requirements

* [ ] AC-007: A packed-package clean consumer applies adoption to a fresh
  fixture holding no verification gate, derives its actions from the emitted
  steps rather than from hard-coded adoption knowledge, creates a gate
  satisfying the described outcome, and reaches a PASSing `doctor`. It fails if
  a step is absent, misordered or insufficient, and it invokes no language model
  and requires no network credentials.
* [ ] AC-008: The portable shell path is unchanged: `scripts/bootstrap` and the
  other shell entrypoints emit no next steps, require no Node, and every
  existing gate composed by `make verify` passes. Protocol `VERSION` remains
  `0.10.0`.
* [ ] AC-009: `README.md` and `docs/getting-started.md` present both adoption
  paths side by side with their requirements stated, neither described as
  deprecated or as replacing the other, the package invocation written with the
  scoped name, and the unscoped spelling called out as not controlled by this
  project. The getting-started guide no longer implies a checkout of this
  repository is required.
* [ ] AC-010: `ADR-012` records the vendor-neutrality and machine-contract
  position, its rejected alternatives, and a falsification condition naming in
  backticks the modules that own adoption and activation.

## Acceptance Evidence

| AC | Method | Evidence | Fixture / precondition | Expected observation |
| --- | --- | --- | --- | --- |
| `AC-001` | test | `packages/cli/test/init-command.test.mjs` | `fresh and existing target fixtures invoked in preview and applied modes` | `ordered next steps under data on both outcomes; each step has an identifier and a description; gate step precedes confirmation step` |
| `AC-002` | test | `packages/cli/test/init-command.test.mjs` | `human-output invocation of the same fixtures` | `stdout prose names every emitted step in the emitted order` |
| `AC-003` | test | `packages/cli/test/init-command.test.mjs` | `applied outcome on a fresh fixture` | `gate step states the make verify outcome with no file body or toolchain name; confirmation step names doctor and PASS` |
| `AC-004` | test | `packages/cli/test/init-command.test.mjs` | `applied outcomes in safe, force and upgrade modes, each validated against the envelope schema` | `validateResultEnvelope accepts every envelope, schemaVersion is 1.0.0, and no path named like a Makefile is written in any mode` |
| `AC-005` | human | `TST-019 command-boundary test review` | `the diff of packages/cli/test/init-command.test.mjs` | `assertions reference identifiers, presence and ordering only; no assertion matches description wording` |
| `AC-006` | test | `packages/cli/test/init-command.test.mjs` | `an init invocation that fails before producing an outcome` | `existing typed failure is reported and no next steps are present` |
| `AC-007` | test | `tests/typescript-tooling.sh TST019-AC-007` | `packed core and cli tarballs installed into a disposable consumer, fresh fixture with no Makefile` | `steps are read from the result, a gate satisfying them is written, and doctor reports PASS without any language model or network credential` |
| `AC-008` | command | `make verify` | `current checkout` | `exit 0 with every composed gate passing and VERSION unchanged at 0.10.0` |
| `AC-009` | human | `TST-019 adopter documentation review` | `README.md and docs/getting-started.md after the change` | `both paths appear as equals with requirements stated, scoped name documented, unscoped name called out, and no checkout implied` |
| `AC-010` | human | `TST-019 decision record review` | `specs/decisions/ADR-012-vendor-neutral-machine-consumable-adoption-path.md` | `both decisions, the rejected alternatives, and a falsification condition naming the adoption and activation modules in backticks` |

## Verification Notes

Run `./scripts/verification-check specs/stories/TST-019-adoption-next-steps`
and `./scripts/story-check --ready specs/stories/TST-019-adoption-next-steps`
before implementation. Dispatch the packed-consumer case through
`run_case 'TST019-AC-007' <function>` and keep every adoption subject inside the
test's temporary directory. AC-007 is the load-bearing case: it proves the
emitted instructions sufficient, not that an agent can follow them. An actual
agent-driven adoption is a Human Review observation and is deliberately not an
acceptance criterion. Run the focused CLI and packed-consumer cases first, then
`make verify`.
