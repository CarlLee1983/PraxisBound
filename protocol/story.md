# Story Contract

A PraxisBound Story is the approved intent boundary for one independently
verifiable change. It describes the outcome and constraints without prescribing
an implementation unless the implementation itself is a required constraint.

## Location

Store each Story under:

```text
specs/stories/<story-id>/
├── story.md
├── acceptance.md
└── task.md
```

Use a stable, unique Story ID followed by an optional readable slug, for example
`ORD-123-refund-order`.

A Story ID is hyphen-separated segments of uppercase letters and digits:
the first segment starts with an uppercase letter,
each middle segment has an uppercase letter,
and the last segment is digits.
`FF-209` and `DBCLI-PLAT-001` conform; `FF-1-2` does not, because a bare
number is not a subsystem name. `scripts/story-check` and
`scripts/handoff-check` enforce this same grammar.

The directory name is the Story ID followed by an optional slug. The ID is the
shortest leading run of segments that is itself a Story ID, so
`FF-227-story-id-grammar` names `FF-227` and `FF-232-API-limits` names
`FF-232`. A slug is never read as part of the ID, because the ID stops as soon
as it is complete; `FF-1-2-x` therefore names `FF-1` with the slug `2-x`, and
`FF-1-2` is still not a Story ID anywhere one is required.
`scripts/story-check` fails a Story whose directory names no conforming ID, so
the problem is reported when the Story is written rather than when the handoff
records it, and it reports the ID it read for every Story it checks.

`story.md` and `acceptance.md` define approved intent and its observable
contract. `task.md` is optional human context and never overrides product
requirements. A mutable status, current step, blocker, or done marker in an
optional note is not authoritative lifecycle state, and PraxisBound tooling must
not use it to select work or infer a transition.

## Story fields

The Story records:

- **Goal** — the user or business outcome
- **Context** — background needed to interpret the change
- **Scope** — explicit in-scope and out-of-scope boundaries
- **Inputs** — data, events, or commands consumed
- **Outputs** — observable results produced
- **Rules** — numbered business invariants
- **Expected Errors** — required failure behavior
- **Dependencies** — systems or prior work the Story relies on
- **Classification** — whether the Story is security sensitive and whether it
  changes baseline behavior, each declared as `yes` or `no`
- **Guidance** — optional human-readable references to relevant engineering
  principles, decisions, or practices; never a product-requirement source
- **Constraints** — non-negotiable technical, operational, or policy limits

Four optional declarations extend the Story with its execution contract. A Story
that omits them resolves to the documented defaults and keeps the verdict it
already had:

- **Task mode** — an optional `## Classification` bullet declaring the work as
  `architecture`, `execution`, `evidence`, or `mixed`
- **Authority** — an optional `## Authority` section declaring `plan`,
  `modify`, `add_dependency`, `migration`, `commit`, `push`, and `deploy`
- **Architecture** — an optional `## Architecture` section declaring the impact
  and the decisions, boundaries, contracts, and ownership the change is
  answerable to
- **Risk** — an optional `## Risk` section declaring the level, its reasons,
  and repeatable standard Signals that activate conditional readiness contracts

See the [Execution Contract](execution.md) and the
[Architecture Contract](architecture.md).

Two sections are conditional on the Classification:

- **Trust Boundary Fields** — required when `Security sensitive: yes`. Name every
  user-controlled or externally derived field the requirement covers, including
  custom metadata, derived summaries, evidence labels, error details, and
  external references.
- **Superseded Behavior** — required when `Baseline conformance: yes`. Name each
  existing test or documented behavior the Story intentionally replaces, so a
  conflicting regression test is recognized as superseded rather than as a
  defect.

Use [the Story template](../templates/story/story.md) as the canonical field
layout.

### Optional guidance

A Story may include `## Guidance` with `Relevant:` and `Not applicable:` lists.
References are deliberately human-readable and are not parsed or validated:
relevance and engineering quality require judgment. Missing Guidance never makes
a Story invalid, and a reference never adds an implicit acceptance criterion.
Read only the relevant repository guidance after the approved Story and
acceptance criteria. More specific, explicitly approved context takes precedence
over generic guidance; surface a genuine unresolved conflict to Human Review.

### Risk-driven readiness contracts

`## Risk` may declare any of four optional, repeatable `Signal` values. A value
must be one same-line backticked literal, may appear at most once, and does not
replace or change the existing `Level` or `Reason` declarations:

| Signal | Required Story section | Required fields |
| --- | --- | --- |
| `error-projection` | `## Error Projection` | `Source failure`, `Public projection`, `Detail policy`, `Evidence AC` |
| `concurrency` | `## Concurrency` | `Contended resource`, `Linearization point`, `Conflict outcome`, `Evidence AC` |
| `bounded-capacity` | `## Capacity` | `Bounded resource`, `Limit`, `Saturation behavior`, `Failure projection`, `Evidence AC` |
| `retention-overflow` | `## Retention and Overflow` | `Retained resource`, `Retention bound`, `Overflow policy`, `Recovery / observability`, `Evidence AC` |

For example:

```markdown
## Risk

* Level: medium
* Reason: `shared-write-path`
* Signal: `concurrency`

## Concurrency

* Contended resource: `order status`
* Linearization point: `conditional database update`
* Conflict outcome: `return order_conflict`
* Evidence AC: `AC-005`
```

The normal Story check requires every activated section exactly once and every
listed field exactly once as a non-empty same-line backticked value. Readiness
additionally rejects the documented finite placeholders and requires
`Evidence AC` to name a real checkbox AC with a row in the existing
`## Acceptance Evidence` table. This reuses the one evidence map; no separate
risk-evidence table is created.

A Story with no Signal requires no risk-contract section and keeps its existing
verdict, including when older prose happens to use one of these headings. The
checker validates declared contracts only. It does not infer a Signal from
Story prose or decide whether the author omitted an applicable risk; that
remains Human Review judgment.

## Acceptance

`acceptance.md` translates intent into observable checks across the
happy path, business rules, failure cases, and regression requirements. Each
criterion should have one unambiguous outcome that a test, command, or human
review can evaluate.

Story-specific setup belongs under Verification Notes. An approved
[`## Verification Scope`](execution.md#verification-scope) declaration may name
focused commands that satisfy a Story where repository policy permits; absent
that declaration, full `make verify` remains required.
Use [the Acceptance template](../templates/story/acceptance.md).

### Acceptance evidence

Before a Story is checked with `--ready`, `acceptance.md` maps every checkbox
AC to one planned source of evidence:

| Column | Purpose |
| --- | --- |
| AC | One exact backticked checkbox AC ID. |
| Method | `test`, `command`, or `human`. |
| Evidence | The exact test, command, or review record. |
| Fixture / precondition | The exact data state or external condition needed. |
| Expected observation | The exact assertion, exit result, or observation. |

`scripts/story-check --ready` requires one `## Acceptance Evidence` section,
the exact header, one valid row for every AC, and no unknown or duplicate AC
rows. It validates only the declared map: it neither executes a command nor
parses a repository's test sources. A `human` row is valid for a contextual or
external fact, but must name the precondition and review observation so a gap
is visible before implementation. `make verify` and Human Review determine
whether declared evidence actually proves the result.

### Security fixture matrix

A Story declaring `Security sensitive: yes` states its secrecy, redaction,
authorization, or persistence requirements as an executable fixture matrix in
`acceptance.md` rather than as prose such as "no credentials". Each row is one
fixture:

| Column | Purpose |
| --- | --- |
| Source field | The untrusted input or derived field |
| Payload | The exact representative value |
| Expected result | `preserve`, `redact`, `reject`, or `omit` |
| Persisted locations | Every artifact field that must be checked |
| Verification | The test path or command that proves the result |

Every column except the expected result carries a non-blank exact value in
backticks, so that an implementing agent finds the required cases in the Story
instead of discovering them one review loop at a time. A quoted payload may
contain markup; only a whole-cell placeholder such as `<value>`, `TBD`, or an
empty quotation is rejected. A pipe after an odd consecutive run of backslashes
is part of the cell payload; an even run leaves it a delimiter. Payload
characters are preserved.

## Checking the contract

`scripts/story-check` statically reports a missing classification, a missing or
prose-only fixture matrix, a missing trust-boundary enumeration, or a missing
superseded-behavior declaration:

```sh
./scripts/story-check [story-directory ...]
```

A fenced example inside a Story is documentation: its contents are never read as
headings, declarations, or fixture rows. After surrounding spaces, tabs, and CR
are trimmed, a run of at least three backticks or tildes opens a fence. Only the
same character, at least the opening length, with no non-whitespace suffix
closes it. Unclosed fences ignore through EOF.

The checker supports this contract subset only, not general Markdown parsing:
exact Classification bullets, conditional-section bullets, and the exact matrix
header with outer table pipes. Inline backticks do not shield a raw pipe; use
the documented backslash escape.

It is read-only, exits `0` for `STORY_CONTRACT_OK`, `1` for
`STORY_CONTRACT_INCOMPLETE`, and `2` for an operational error. It judges the
declared structure only; it never decides whether a classification is truthful
and never replaces `make verify` or human review.

## Sizing and readiness

Optional `scripts/story-check --ready [story-directory ...]` checks minimum
content, acceptance-evidence completeness, and any declared risk contract as
well as structure; defaults and Doctor do not change. It requires
non-placeholder content under exact `## Goal` and `## Scope` headings and at
least one unique checkbox `AC-<digits>:` with same-line content, for example
`* [ ] AC-001: An empty order returns zero cents.` Subheadings do not count as
content; fenced examples are ignored. The finite placeholders include
`<acceptance criterion>` and the shipped Goal sentence. The complete supported
syntax and exact placeholder list are in [Contract Checks](../docs/contract-checks.md#optional-minimum-content-readiness).
`STORY_READINESS_OK` distinguishes readiness success from structural
`STORY_CONTRACT_OK`; neither grants human-approved READY. This mode does not
score language, require automation per AC, execute evidence, or migrate
historical Stories automatically.

A Story is small enough when one coherent implementation can satisfy all of its
acceptance criteria and be verified without partially delivering a second
outcome. Split Stories whose rules, dependencies, or rollout can be completed
and reviewed independently.

A Story is complete when the implementation is complete, the required
verification passed, every required acceptance criterion has passing evidence,
and no unresolved authority conflict remains. A skipped required check, a
blocked verification, or a missing observation makes the Story partial rather
than Done. See [Completion](verification.md#completion).

A Story is ready for implementation when:

- the Goal and scope are approved by a human;
- business rules and expected errors are explicit;
- acceptance criteria cover the required behavior;
- every acceptance criterion has a concrete evidence method, fixture or
  precondition, and expected observation;
- every declared Risk Signal has a concrete conditional contract whose
  Evidence AC exists and has planned Acceptance Evidence;
- the Classification is declared and its required sections are present;
- unresolved decisions do not materially change the implementation.

`READY` is the shared lifecycle term for this condition, not a status that the
Story file must persist. A control plane may track it externally without a
synchronized edit to `story.md`, `acceptance.md`, or `task.md`.

## Change control

Humans own Story intent and approve requirement changes. Agents may identify
ambiguity, conflicts, or missing decisions, but do not silently revise the Story
or weaken acceptance criteria. Record an approved change in the Story files
before implementation resumes.
