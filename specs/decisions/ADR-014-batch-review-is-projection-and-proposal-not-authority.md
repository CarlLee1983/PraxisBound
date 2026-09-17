# ADR-014: Batch review is projection and proposal, never authority

* Status: proposed
* Date: 2026-09-17

## Context

`specs/features/batch-review/spec.md` asks for a way to read a whole delivery
batch of ADRs, Specs, Stories and acceptance files, propose revisions in an
offline HTML page, have an existing Agent revise the sources, record a human
confirmation of the batch, run a start-of-work check, and hand the batch to an
external control plane such as ForgePilot.

Every artifact in that flow is tempting to treat as authority. An HTML page with
an "approve" button looks like a review state. A confirmation file looks like
execution permission. A packet listing Stories looks like a second work queue.
A Spec looks like a new Protocol artifact that ranks above Stories. Each of
those readings would contradict an existing contract: Stories are execution
authority (`protocol/story.md`, `protocol/execution.md`), lifecycle state lives
only in a control plane (`protocol/lifecycle.md`), and a repository handoff is
historical verification Evidence (`protocol/handoff.md`).

The alternatives considered and rejected were:

* **Making Spec a Protocol artifact.** It would change the versioned surface,
  force a precedence rule between Spec and Story, and infer Protocol fields from
  a planning document. The feature needs Specs only as input.
* **Recording approval and authorization as fields.** A file saying
  `approved: true` or `authorized: true` can be written by anyone, including the
  Agent it is meant to constrain, and silently outlives the content it approved.
* **A `current` confirmation or review pointer.** It is a second copy of mutable
  state that drifts from both the sources and the control plane.
* **Parsing ForgePilot's human text output to resume a partial handoff.** The
  text is not a published contract; a retry built on it can duplicate work.
* **A new envelope schema version for the review results.** Existing commands
  emit nothing new, and consumers pin the CLI package version.

## Decision

Batch review is Reference Tooling. It adds no Protocol artifact and changes
nothing under `protocol/` or `templates/`. A Spec is an input the batch declares;
a Story remains the only execution authority, and a Spec never overrides an
approved Story or ADR.

Each artifact has exactly one role:

* The **Batch Manifest** declares scope and the requirement relationships.
  Relationships not already present as IDs in the sources are stated explicitly
  in it, never inferred from similar text.
* The **Review Projection** (HTML) is derived and read-only. It never writes
  sources and its contents never count as confirmation.
* A **Revision Request** is a proposal. Its text never grants authority, however
  it is worded. Exported sheets count only after an explicit `review import`
  records them; every imported, unsuperseded request counts from then on, so no
  blocking request is lost by reading only the latest sheet.
* A **Revision Response** and a **Preflight Report** are historical Evidence
  bound to a Requirement Fingerprint.
* A **Definition Confirmation** is a human claim bound to one Requirement
  Fingerprint. It is obtained only through an interactive terminal operation
  that asks the human to type part of the fingerprint. This is a deliberate
  threshold for an explicit act, not identity verification, and it does not stop
  a malicious user or an Agent that emulates a terminal.
* **Execution Authorization** is never stored. The Execution Packet records only
  which authorization source was observed. It is re-resolved from the Story, the
  current human session or the control plane before every effect.

Records are append-only and named by fingerprint. No record points at the
current one. Whether a confirmation or report still applies is recomputed from
the current sources every time, so any change to the declared sources or the
manifest makes older records inapplicable without editing them.

The review results are added as `outcome` values `REVIEW_READY`,
`REVIEW_BLOCKED`, `REVIEW_INCOMPLETE` and `REVIEW_STALE` in the existing
envelope. The envelope's issue shape is unchanged: precise locators travel in
`data`. The classification is Additive and `schemaVersion` stays `1.0.0`.

External effects on ForgePilot happen only through its public CLI, only after a
fresh `REVIEW_READY`, and only from committed sources. The Goal ID is derived
from the batch ID and fingerprint, so repeating the same handoff stops at an
existing Goal instead of duplicating Work Items. A handoff that fails partway
stops and reports the Work Item IDs it observed. It never resumes by guessing,
and it never starts the Runner. Recovery belongs to a human working in
ForgePilot, who then asks for a new packet with an explicit attempt number that
yields a new Goal ID.

ForgePilot offers no machine-readable output for creating Goals and Work Items,
so the workflow reads exactly two documented lines: the Goal creation line and
the first line of `work add`, only to learn the ID it has just created. An
unparseable line stops the handoff as an unknown result. Text output is never
used to look up or resume an earlier attempt; that is the parsing this decision
rejects.

## Boundaries

* The `review` Core module owns the manifest, fingerprints, locators, record
  schemas and result classification. It performs no I/O and knows nothing about
  ForgePilot.
* The `review` CLI commands own reading sources, importing revision sheets,
  writing records and projections, and the terminal confirmation step. They
  never write sources, run `make verify`, commit or call ForgePilot.
* The Agent workflow owns revising sources, semantic preflight observations and
  ForgePilot calls. It resolves authorization before each effect.
* ForgePilot owns Goals, Work Items, Runner state and final acceptance.

## Consequences

A human can read and confirm a dirty, incomplete draft, but it cannot be handed
off until every declared source is committed. Committing needs its own
authorization. Every source edit invalidates the confirmation, so small fixes
cost a new confirmation; the projection marks only the changed documents for
re-review.

The confirmation step is inconvenient by design and proves only that an explicit
terminal act happened. Automation cannot create a confirmation without a
terminal, and CI cannot exercise the real prompt. Tests exercise the refusal of
non-interactive input and the record format instead.

Until ForgePilot offers machine-readable output and a Work Item idempotency key,
a partial handoff needs a human. That gap is reported as a ForgePilot issue
rather than worked around.

Consumers that validate envelopes against a schema copy they did not update with
their pinned CLI version will reject the new outcomes.

## Falsified if

This decision no longer holds, and the boundary must be redrawn, if a supported
consumer validates envelopes against
`docs/typescript-tooling/result-envelope-v1.schema.json` without pinning the CLI
package version; if ForgePilot publishes a Work Item idempotency key or JSON
listing that `specs/features/batch-review/contract.md` could use instead of
stopping; if any record defined in `specs/features/batch-review/contract.md`
becomes an input that grants an operation described in
`docs/typescript-tooling/cli-contract.md`; or if a batch review record starts
carrying the verification or lifecycle meaning that `protocol/handoff.md` and
`protocol/lifecycle.md` reserve.
