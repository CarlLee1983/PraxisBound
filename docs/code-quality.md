# Code Quality

Code quality is a repository-owned concern. PraxisBound can enforce code style,
but it does not prescribe one cross-language style, toolchain, framework, or
set of universal thresholds. Each repository selects rules that fit its risks
and technology and records them in its existing tooling and guidance.

## Automated enforcement

Every formatter, linter, type checker, static analyzer, or architecture checker
the repository adopts as a review-readiness requirement belongs behind its
canonical `make verify`. Each verification command must be:

* deterministic;
* non-interactive;
* suitable for CI; and
* nonzero on failure.

The verification path must check without rewriting source files. Keep mutating
developer conveniences separate: for example, `format` may modify files, while
`make verify` should run the formatter's check mode and must not modify code to
obtain PASS.

Do not obtain PASS by disabling rules, lowering their severity, ignoring files,
bypassing checks, or deleting tests. Repair the root cause or bring a genuine
rule change to Human Review as an explicit repository-policy decision.

## Enforcement boundaries

| Layer | Typical enforcement |
| --- | --- |
| Formatting | A formatter can completely constrain mechanically representable style. |
| Static quality | Linters, type checkers, unused-code checks, and repository-chosen complexity rules. |
| Architecture | PraxisBound supplies none of these; the repository does: dependency direction validation, forbidden imports, layer boundaries, public interface drift, and architecture drift. See [Architecture](../protocol/architecture.md). |
| Design judgment | Human Review of naming quality, reasonable abstractions, single responsibility, and other context-dependent trade-offs. |

An LLM code review may advise Human Review, but it is not a deterministic
blocking gate. It may block only after the repository converts the concern into
a reproducible machine rule with stable PASS/FAIL semantics.

Function length, parameter count, and complexity can be useful local signals,
but arbitrary numeric limits are not a substitute for Clean Code or design
judgment. A repository should choose any thresholds from its actual risk,
language, architecture, and maintenance context.

## CI and merge enforcement

Local development may use approved focused checks for a bounded change. CI at
the integration boundary should invoke the same full `make verify` gate; the
repository's merge policy supplies the final automated enforcement point. Merely committing
a CI workflow does not configure GitHub to reject merges that bypass a failed
check. A repository administrator must separately configure the relevant
required status check or ruleset.

Automated PASS only makes the change eligible for Human Review. It does not
approve product intent or replace design and architecture judgment.
The contextual dimensions and outcomes are defined in
[Human Review](human-review.md). Any requested implementation change must pass
the required checks again, including complete `make verify` when required,
before returning to review; an LLM score or
automated approval cannot substitute for human acceptance.
