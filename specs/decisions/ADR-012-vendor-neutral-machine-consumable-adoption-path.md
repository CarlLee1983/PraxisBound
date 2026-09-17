# ADR-012: Adoption is vendor-neutral and machine-consumable

* Status: accepted
* Date: 2026-09-16
* Revised: 2026-09-17

## Context

Adoption is the moment a repository becomes subject to the Protocol, and it is
increasingly performed by an agent rather than by a person reading a guide. Two
questions about that moment were open, and both are answered the same way.

The first is what an Adoption receives. `templates/AGENTS.md` is the general
contract every Adoption gets. Alongside it the repository also ships a
vendor-native snapshot — `.agents/skills/praxisbound/`, installed by
`codex activate` — which encodes one vendor's convention for where an agent
discovers its instructions. Because the snapshot is useful, there is standing
pressure to fold it into adoption so that adopting once configures everything.

The second is what adoption tells the adopter when it finishes. `init` writes
the templates, the guidance and the adoption marker, but it deliberately does
not write a verification gate: the glossary defines an Adoption as a repository
that owns its local gate, so writing a `Makefile` would move ownership to the
Reference Tooling. The repository is therefore only Adopting when `init`
returns, and until now nothing said so. The alternatives for saying so were
prose on stdout, a documentation page the adopter is expected to find, or
structured data in the Semantic Result.

Three alternatives were considered and rejected:

* **A combined `adopt` command** folding `init` and activation into one entry
  point. Once the path was settled as vendor-neutral, `adopt` would write
  exactly the files `init` already writes, leaving two public commands with
  identical effects while forfeiting the evidence `init` has already
  accumulated from the public registry.
* **Writing the vendor-native snapshot during `init`**, so that adoption
  configures the agent as well. This makes one vendor's discovery convention a
  component of adopting the Protocol, which the Protocol does not define and
  cannot maintain for every vendor.
* **Renaming activation to a vendor-neutral spelling** so the snapshot could
  plausibly belong to the default path. The snapshot's content is vendor-native
  whatever the command is called; a neutral name would hide that rather than
  remove it, and the rename would break an installed command for no behavioral
  gain.

## Decision

The default adoption path is vendor-neutral. `init` writes the general
`AGENTS.md` contract and nothing vendor-specific; it does not write
`.agents/skills/praxisbound/`. The vendor-native snapshot stays behind its own
separate, explicitly invoked command, and its absence from the default path is
deliberate rather than an omission awaiting repair.

The next steps emitted when the Reference Tooling's `init` command finishes are
a machine contract, not prose for humans to parse. They are ordered structured
data in the Semantic Result's `data`, each step carrying a stable identifier
alongside a human-readable description. The identifiers, their ordering, and the
presence of a step are under version protection and change only through a
declared classification; the description wording is presentation and may be
reworded freely. A step identifier tells a consumer which action remains, not
how to perform it: how to perform an identified step is the consumer's own
knowledge, and the description is presentation over that same identity. The
prose printed for a watching human is rendered from the same steps and is
never the contract.

This governs the Reference Tooling only. The portable shell entrypoints are
untouched: `scripts/bootstrap` produces no Semantic Result and gains no next
steps.

## Boundaries

* `Bootstrap` owns what an adopted repository receives and what remains for the
  adopter to do, including the ordered next steps and their identifiers. It does
  not own the verification gate it describes, and it does not write vendor files.
* `Activation` owns the vendor-native snapshot, its installer, and its managed
  `AGENTS.md` section. It is never reached by the default adoption path.
* `Human Renderer` owns the wording of the printed steps. It does not own their
  identity, their order, or whether a step exists. It renders from the envelope
  ADR-008 defines.

## Consequences

Adopting the Protocol requires no vendor agreement, and a repository that never
runs activation can still reach Adoption. The cost is that an agent-driven
adoption under a supported vendor takes two commands rather than one, and a
vendor whose convention differs receives nothing tailored to it.

Treating the steps as a contract means an editor cannot silently drop or
reorder one to tidy the output, and a consumer may report progress by
identifier. It also means the steps cannot claim that an agent reaches
Adoption: that claim is untestable and CI must not depend on a language model.
The testable restatement is that following the emitted steps literally produces
a PASSing `doctor`; an actual agent-driven adoption is a Human Review
observation, not an automated check.

Because the steps live under `data` rather than at the top level of the ADR-008
envelope, which is closed to additional properties, adding them does not bump
`RESULT_SCHEMA_VERSION`.

## Falsified if

A vendor's discovery convention becomes necessary for an Adoption to reach a
PASSing `doctor`, or a supported consumer has to read the printed prose to
recover which step remains, or its identity or order, because it cannot obtain
that from the structured result. Either condition means the split between
`packages/core/src/init.ts`, `packages/core/src/adoption-next-steps.ts`,
`packages/cli/src/init.ts`, `packages/cli/src/init-mutation.ts`,
`packages/cli/src/init-observation.ts`, `packages/cli/src/init-snapshot.ts` and
`scripts/bootstrap` on the adoption side and
`packages/core/src/activation.ts`, `packages/cli/src/activation.ts`,
`packages/cli/src/activation-mutation.ts`,
`packages/cli/src/activation-observation.ts`,
`packages/cli/src/activation-snapshot.ts` and
`scripts/codex-activate` on the activation side no longer expresses the
contract, and the boundary must be redrawn as a Breaking change.

## Revision

Corrective, 2026-09-17: this revision names the module that holds the emitted
steps, states what a step identifier actually recovers, and aligns wording
with the glossary's Adopting and Adoption terms. The decision itself is
unchanged.
