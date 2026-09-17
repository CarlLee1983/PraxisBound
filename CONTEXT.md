# PraxisBound Context

PraxisBound defines a repository-governance protocol and optional tooling that
observes or applies that protocol. This glossary keeps the contract, evidence,
and tooling terms distinct.

## Language

**PraxisBound Protocol**:
The language-independent, versioned contract that defines adoption, Stories,
verification, evidence, lifecycle meaning, and compatibility.
_Avoid_: TypeScript protocol, CLI protocol

**Adoption**:
A repository that exposes the PraxisBound-required entrypoints and owns its local
verification gate.
_Avoid_: installation, CLI installation, complete Adoption

**Adopting**:
The state of a repository that has received the installer-managed files but does
not yet satisfy Adoption, typically because it has no verification gate.
_Avoid_: half-adopted, incomplete Adoption

**Adoption Next Step**:
An action still owed before an Adopting repository becomes an Adoption, reported
by the Reference Tooling and identified by a stable id; the id names which
action remains, not how to perform it.
_Avoid_: instruction, hint, prose steps

**Reference Tooling**:
An official implementation that evaluates or applies PraxisBound contracts
without becoming a prerequisite for adopting the Protocol.
_Avoid_: protocol runtime, PraxisBound runtime

**Semantic Result**:
A deterministic, machine-readable statement of an evaluation outcome,
diagnostics, and supporting evidence, independent of human wording.
_Avoid_: stdout, log output

**Evidence**:
A declared or observed fact attached to a specific subject; it never implies
current lifecycle authority or human approval.
_Avoid_: status, approval

**Parity**:
Equivalence between two tooling implementations at the Semantic Result and
observable-effects level for the same repository fixture and invocation.
_Avoid_: identical output, rewrite completeness
