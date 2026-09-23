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

## Batch Review

**Review Batch**:
An explicitly declared set of ADRs, Specs, Stories, and acceptance files reviewed
together, with the requirement relationships between them stated rather than
inferred.
_Avoid_: review scope, all specs, project review

**Spec**:
A requirements baseline that Stories are derived from; an input to batch review,
not a Protocol artifact and not execution authority.
_Avoid_: feature doc, requirements Story

**Requirement Acceptance**:
The acceptance criteria a Spec states for one of its requirements; what the
requirement must achieve, identified as `R-<n>/AC-<n>`. Not an execution
boundary.
_Avoid_: Spec AC, story acceptance

**Execution Acceptance**:
The acceptance criteria in a Story's acceptance file; the approved boundary of
the work that Story executes, identified as `<STORY-ID>/AC-<n>`. It may differ
from the Requirement Acceptance it serves, and that difference is what a review
exists to surface.
_Avoid_: AC (unqualified, when both kinds are in view), test cases

**Review Preface**:
An optional, human-written introduction declared with a Review Batch; the only
prose in a Review Projection not taken verbatim from a source document.
_Avoid_: summary, generated overview

**Requirement Fingerprint**:
The content identity of a Review Batch, covering its declaration and every
source it selects, including uncommitted changes and excluding derived views.
_Avoid_: batch version, Git HEAD, snapshot time

**Review Projection**:
A derived, read-only rendering of a Review Batch for human reading, organized
by requirement; never a source of definitions.
_Avoid_: review document, HTML source

**Revision Request**:
A human proposal to change a located part of a Review Batch; it carries no
authority to change sources or grant work.
_Avoid_: change order, approval, instruction

**Revision Sheet**:
One exported file carrying one or more Revision Requests for a Review Batch;
it counts for nothing until an explicit import records it.
_Avoid_: feedback file, review export, change list

**Revision Response**:
An Agent's recorded disposition of one Revision Request against a specific
Requirement Fingerprint; historical Evidence, never human approval.
_Avoid_: resolution, acceptance

**Definition Confirmation**:
A human's explicit, recorded claim that a Review Batch at one Requirement
Fingerprint is the intended definition; not identity-verified, and not
Execution Authorization.
_Avoid_: approval, sign-off, review state

**Execution Authorization**:
Permission to cause effects such as source edits, work creation, or runs,
resolved from a Story, the current human session, or a control plane at the
time of the effect; never read from a file.
_Avoid_: approved flag, authorized field

**Semantic Report**:
An Agent's self-reported judgment of a Review Batch at one Requirement
Fingerprint, covering missing splits, contradictions, insufficient acceptance,
and open questions per Story; unverified input to a Preflight, not a Semantic
Result.
_Avoid_: semantic result, AI verification, review outcome

**Preflight**:
A read-only evaluation of whether a Review Batch at its current Requirement
Fingerprint can be handed to execution; a ready outcome means no blocker was
found, not that the batch has no defects, and it never resolves Execution
Authorization.
_Avoid_: approval, validation, sign-off

**Preflight Report**:
The recorded Evidence of one Preflight, keeping mechanical diagnostics apart
from the Agent's unverified observations; historical, never current state.
_Avoid_: preflight log, status file, readiness state

**Execution Packet**:
The start-of-work input handed to an external Agent or control plane for a
confirmed, preflighted Review Batch; it records observed authorization and
never proves work was done.
_Avoid_: handoff, verification handoff, dispatch approval
