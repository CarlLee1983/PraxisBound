# Story: FF-224 Review Evidence Guidance

## Goal

Help adopters expose verification blind spots, explain failure recovery, and
measure the full cost of one small agent-assisted change.

## Context

On 2026-09-06 Carl approved the three documentation improvements proposed from
his article, "Agentic Coding 能加速實作，工程基本功決定你怎麼驗收":
https://carlstack.gravito.dev/blog/agentic-coding-software-engineering-fundamentals/.
This Story records that approved scope; it does not reinterpret the cited studies.

## Classification

* Security sensitive: no
* Baseline conformance: no

Documentation-only clarification and optional guidance; no protocol or template
change, version bump, or adopter migration.

## Scope

### In Scope

* Explain untested cases and their impact in existing Human Review guidance.
* Explain change-specific detection, stop conditions, recovery, and evidence,
  including justified non-applicability and a concrete example.
* Add an optional small-Story delivery-cost experiment to Agentic Discipline.
* Record verification and handoff without agent self-approval of either Story.

### Out of Scope

* New checkers, mandatory fields, metrics infrastructure, runtime changes,
  protocol/template edits, release, or automatic review approval.

## Inputs

* Existing Story, acceptance evidence, review guidance, and Carl's article.

## Outputs

* Updated docs/human-review.md and docs/agentic-discipline.md.

## Rules

* R1: Reuse existing review reports and Verification Notes; add no required artifact.
* R2: Unknown evidence remains unknown; unmet requirements cannot be waived as untested.
* R3: Detection and recovery guidance is contextual and includes verification limits.
* R4: Measurement includes review and rework, distinguishes elapsed time from effort,
  and makes no causal productivity claim from a small comparison.
* R5: Canonical make verify and human acceptance retain their existing authority.

## Expected Errors

* Missing intent decisions follow existing SPEC_BLOCKED handling; implementation
  failures remain in the repair loop.

## Dependencies

* Existing Human Review and optional Agentic Discipline guidance.

## Constraints

* Documentation only; no manufactured prose-matching tests or new dependencies.
