# ADR-019: Verification scope is an explicit Story obligation

* Status: accepted
* Date: 2026-09-28

## Context

ADR-001 derives verification layers from risk and architecture and keeps the
result next to the Story. The current protocol additionally requires full
`make verify` for every implementation change. This makes a documentation-only
change depend on unrelated executable checks while leaving the changed document
without a declared validation command.

## Decision

Keep full `make verify` as the default and as the canonical full-repository gate.
An optional Story `## Verification Scope` declaration may select focused checks
when repository policy permits. The Story declares the changed surface and an
exact command for every required check layer. For executable work, risk and
architecture continue to derive the layers. For low-risk, low-impact
documentation-only work, the surface derives a single `documentation` layer;
higher-risk or higher-impact documentation requires the full gate. An explicit
full declaration requires an exact `make verify` result entry. A focused result
records the full gate as skipped with a residual risk, or as passed when it ran.

The static checker validates declaration shape and recorded results. It cannot
tell whether the command actually ran, whether it exercises the changed files,
or whether integration, release, or repository policy requires full
verification. Human Review must judge those claims. An absent declaration keeps
the preexisting full-gate result semantics and verdicts.

## Alternatives

* Keep `make verify` mandatory for every change: preserves one simple rule but
  leaves documentation work subject to unrelated checks and offers no direct
  document validation requirement.
* Change the default to focused: makes existing Stories silently lose their
  full-gate obligation and is a breaking contract change.
* Let a Story freely list arbitrary check layers: can omit a risk-required
  layer while presenting a complete result.

## Consequences

This refines ADR-001's profile derivation by adding the declared surface for
the narrow documentation case. Existing Stories remain unchanged. A focused
result is a statement about the declared checks, not a substitute for an
independently required full gate.

## Falsified if

A repository cannot express its required focused checks through the existing
risk/architecture layers plus the documentation case, or a reliable phase or
policy signal becomes necessary for static checker enforcement. Revisit the
Story declaration and checker boundary rather than inferring those facts.
