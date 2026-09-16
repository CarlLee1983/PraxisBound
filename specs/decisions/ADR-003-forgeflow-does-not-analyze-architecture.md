# ADR-003: ForgeFlow does not analyze architecture

* Status: accepted
* Date: 2026-09-07
* Accepted: 2026-09-07

## Context

`protocol/architecture.md` names five checks that require analysing source
code — dependency direction validation, forbidden imports, layer boundaries,
public contract drift, and architecture drift — and states that ForgeFlow does
not implement them. That statement is currently prose with no decision record
behind it, and the surrounding documents disagree about what it means.

`protocol/versioning.md` and `docs/releases/0.5.0.md` restate the list as
"future extensions", which reads as work ForgeFlow intends to do later. Both
restatements also silently drop `architecture drift`, so the canonical list has
five entries and the restatements have four. `docs/code-quality.md` names the
same territory with a third vocabulary.

The practical consequence was observed on 2026-09-07: a reader took the list as
a gap to be closed and asked for the checks to be implemented. Nothing in the
repository distinguished "not built yet" from "deliberately not ours to build",
so the question had to be re-derived from first principles instead of read off
a record.

The alternatives were to implement the checks inside ForgeFlow, to keep the
position as undocumented prose, or to record it as a decision with the
conditions that would overturn it.

## Decision

ForgeFlow records and resolves architecture declarations. It does not analyse
architecture. The five analysis checks are an extension point for the adopting
repository, which places its own checker behind `make verify` like any other
check, and records the `architecture` layer as `unsupported` with a residual
risk when it has none.

This is a scope boundary, not a schedule. The documents stop calling these
"future extensions" and say they are deliberately out of scope.

Two constraints make this the cheap position rather than a sacrifice.
ForgeFlow's checkers are portable POSIX shell restricted to shell builtins, so
they cannot depend on the caller's `PATH`; source analysis needs at minimum a
language-aware parser. And `protocol/repository-contract.md` limits adoption to
"files, Make, and existing development and CI systems", which a bundled
analyzer would break for every adopter, including those who never wanted it.

The architectural sense of "contract drift" is renamed `public interface drift`.
Doctor already ships `CONTRACT_DRIFT` as a result value for an unrelated
meaning — adoption marker, Story, handoff, and Guidance drift — and that name is
in adopters' hands. The unimplemented architectural sense exists only in prose,
so it is the side that moves.

## Boundaries

* `Story` owns architecture declarations: impact, decisions, boundaries,
  contracts, and ownership. It does not own whether the declared architecture is
  the right one, and it does not own analysis of the source.
* `Verification` owns which layers a profile requires and how a recorded layer
  status is judged. It does not own any layer's implementation, `architecture`
  included.
* `Repository` owns every analysis check it wants, behind its own `make verify`.
  ForgeFlow neither supplies these nor requires them.
* `Human Review` owns whether a declared boundary is the right boundary. No
  checker replaces that judgment.

## Consequences

An adopter that wants dependency-direction or forbidden-import enforcement must
build or adopt it themselves, and ForgeFlow gives them no head start beyond the
place to record the result. That cost is real and is accepted: the alternative
charges every adopter for a capability most of them will not use, in a protocol
whose whole claim is that adoption costs files and Make.

A high-risk Story in a repository with no architecture checker cannot reach a
complete profile. It records `architecture: unsupported` with a residual risk
and stays PARTIAL. That is the intended outcome, not a defect to engineer
around.

Because this is a scope boundary rather than a missing feature, a future request
to implement these five checks is a request to change this decision, and should
be answered by revisiting this record rather than by writing a checker.

TST-018 revisited this decision before retiring the portable release-check
implementation. The approved Node requirement is confined to PraxisBound's
optional maintainer release tool; it adds no runtime, parser, or analysis
requirement to an adopting repository. The files-and-Make adoption boundary and
the decision not to supply architecture analysis therefore remain unchanged.

## Falsified if

Adoption stops depending only on files, Make, and existing CI — for example if
ForgeFlow gains a runtime dependency for any other reason, so the cost argument
above no longer holds. If `protocol/architecture.md` states that ForgeFlow
analyses architecture, or `protocol/repository-contract.md` drops the
files-and-Make portability boundary, this decision no longer describes the
system and must be superseded rather than quietly contradicted.
