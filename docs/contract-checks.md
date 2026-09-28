# Contract Checks

PraxisBound ships three static, read-only checkers for the artifacts humans
write: `scripts/story-check` for Stories, `scripts/handoff-check` for handoffs,
and `scripts/verification-check` for the execution contract and the recorded
verification result.

Each reports declared structure only by default; Story readiness and the
recorded verification result are opt-in. None executes repository code, replaces
`make verify`, or authorizes a merge.

All three are written with shell builtins alone and invoke no external command.
A checker's verdict therefore depends on the files it was given and nothing
else: an unusual or empty `PATH` cannot turn a conformant artifact into an
`INCOMPLETE` result, which matters because Repository Doctor composes the Story
and handoff verdicts into its own.

## Story contract check

```sh
./scripts/story-check [story-directory ...]
```

With no argument, every directory under `specs/stories/` except `_template/` is
checked relative to the current directory.

Decision records normally resolve from `specs/decisions/`. A repository with an
existing ADR collection can select it for one invocation without moving records:

```sh
PRAXISBOUND_DECISIONS_ROOT=docs/adr ./scripts/story-check
```

The non-empty environment value is used as supplied and is the only decision
root for that invocation. When it is unset or empty, the default remains the
directory beside the Story collection. This setting affects `story-check` only;
it does not change the adoption marker, bootstrap, or Doctor.

The check enforces the [Story Contract](../protocol/story.md):

* every Story declares `Security sensitive` and `Baseline conformance` exactly
  once under `## Classification`, each as `yes` or `no`;
* `Security sensitive: yes` requires `## Trust Boundary Fields` in `story.md`
  and a `## Security Fixture Matrix` with at least one fixture row in
  `acceptance.md`;
* every fixture row declares five columns under a five-column separator, carries
  non-blank backticked values for the source field, payload, persisted
  locations, and verification, and states the expected result as `preserve`,
  `redact`, `reject`, or `omit`;
* `Baseline conformance: yes` requires `## Superseded Behavior` in `story.md`,
  naming each superseded test or behavior exactly;
* each optional, unique `Signal` under `## Risk` is one of
  `error-projection`, `concurrency`, `bounded-capacity`, or
  `retention-overflow`, and activates only its corresponding risk-contract
  section and required fields; and
* a Classification-gated section that contradicts its `yes` or `no`
  declaration fails in both directions.

The conditional risk contracts are:

| Signal | Section | Required field labels |
| --- | --- | --- |
| `error-projection` | `## Error Projection` | `Source failure`, `Public projection`, `Detail policy`, `Evidence AC` |
| `concurrency` | `## Concurrency` | `Contended resource`, `Linearization point`, `Conflict outcome`, `Evidence AC` |
| `bounded-capacity` | `## Capacity` | `Bounded resource`, `Limit`, `Saturation behavior`, `Failure projection`, `Evidence AC` |
| `retention-overflow` | `## Retention and Overflow` | `Retained resource`, `Retention bound`, `Overflow policy`, `Recovery / observability`, `Evidence AC` |

Each activated section appears exactly once. Each required label appears
exactly once with a non-empty same-line backticked value. A Story that declares
no Signal needs none of these sections and keeps its previous verdict. The
checker does not infer Signals from prose such as “queue”, “parallel”, or
“database”; omission of an applicable risk remains Human Review judgment.

A quoted payload may contain markup, so `<script>alert(1)</script>` is an exact
value; only a whole-cell placeholder or an empty quotation is rejected. A pipe
after an odd consecutive run of backslashes is payload; an even run leaves it a
column delimiter, and the checker preserves those payload characters. Fenced
examples inside a Story are documentation and are never parsed as declarations:
after surrounding spaces, tabs, and CR are trimmed, three or more matching
backticks or tildes open a fence; only the same character and at least the
opening length, with no non-whitespace suffix, closes it. Unclosed fences ignore
through EOF.

This is a documented subset, not a general Markdown parser: the checker reads
exact Classification bullets, Trust Boundary Fields and Superseded Behavior
bullets, and the exact matrix header with outer table pipes. Inline backticks do
not shield a raw pipe; use the documented backslash escape.

| Result | Exit | Meaning |
| --- | --- | --- |
| `STORY_CONTRACT_OK` | `0` | Every checked Story declares what the contract requires. |
| `STORY_CONTRACT_INCOMPLETE` | `1` | A declaration is missing, prose-only, or contradictory. |
| `ERROR` | `2` | Invalid invocation, or a missing, unreadable, or symlinked Story file. |

The Story template ships both conditional sections filled with an example row,
because most Stories need one of them. Delete the section that the Story's
Classification does not require; keeping it while declaring `no` is reported as
a contradiction.

The check checks declared structure, not Classification truthfulness. A Story
that claims `Security sensitive: no` for work that handles credentials passes
the checker and fails Human Review. Human Review compares the real trust
boundaries, baseline changes, and conditional evidence, and confirms that the
Story, Acceptance Criteria, Classification, implementation, and tests agree.

## Optional minimum-content readiness

```sh
./scripts/story-check --ready [story-directory ...]
```

The flag appears once before directories. With none, discovery is unchanged.
Default invocations and Doctor still check structure only; historical Stories
need no migration. This opt-in mode adds these exact minimum-content rules:

* `## Goal` and `## Scope` each contain a non-placeholder line. Nested headings
  are ignored as content and remain within that section; the next level-one or
  level-two heading ends it. Surrounding spaces, tabs and CR and one optional
  `* ` or `- ` bullet prefix are stripped.
* `acceptance.md` has at least one checkbox bullet, `* ` or `- ` followed by
  `[ ] `, `[x] ` or `[X] `, then `AC-`, one or more ASCII digits, a colon, and
  non-placeholder text on the same line. IDs are compared exactly and may not
  repeat anywhere in the same file. Other line formats do not supply an AC.
* `acceptance.md` has exactly one `## Acceptance Evidence` section with the
  exact five-column header `AC`, `Method`, `Evidence`, `Fixture / precondition`,
  and `Expected observation`. It has one row for every checkbox AC and no
  unknown or duplicate IDs. `Method` is exactly `test`, `command`, or `human`;
  the remaining cells are each one non-placeholder backticked value.
  Evidence placeholders are the finite values empty, `*`, `-`, `TBD`, `tbd`,
  `TODO`, `todo`, `N/A`, `n/a`, `...`, `<evidence>`, `<fixture>`,
  `<fixture / precondition>`, and `<expected observation>`. Technical values
  such as `<T>` remain valid when backticked.
* All these readers use the fence rules above; examples do not supply content.
* Every declared Risk Signal's required fields are concrete rather than one of
  the finite placeholders below. `Evidence AC` is exactly `AC-<digits>`, names
  a checkbox AC in the same `acceptance.md`, and that AC has a row in the
  existing Acceptance Evidence table. No second risk-evidence map is required.

The finite placeholder list is: empty text, bare `*` or `-`, `TBD`, `tbd`,
`TODO`, `todo`, `N/A`, `n/a`, `...`, `<goal>`, `<scope>`,
`<acceptance criterion>`, and `Describe the user or business outcome.`
Matching is exact after trimming and optional bullet removal; `<T>`, Chinese
requirements, and technical strings are not rejected by language or scoring.

Risk-contract values use the same blank, bare bullet, `TBD`, `TODO`, `N/A`, and
`...` tokens, plus these field-shaped placeholders: `<value>`,
`<source failure>`, `<public projection>`, `<detail policy>`,
`<contended resource>`, `<linearization point>`, `<conflict outcome>`,
`<bounded resource>`, `<limit>`, `<saturation behavior>`,
`<failure projection>`, `<retained resource>`, `<retention bound>`,
`<overflow policy>`, `<recovery / observability>`, and `<evidence ac>`.
Matching is exact after the required outer backticks are removed.

For example, an actual criterion outside a fence can be:

```markdown
* [ ] AC-001: An empty order returns a total of zero cents.
```

In this mode `Structure: STORY_CONTRACT_OK` or `STORY_CONTRACT_INCOMPLETE`
reports the original checks separately. `Result: STORY_READINESS_OK` (exit 0)
means both structure and minimum content passed; `STORY_READINESS_INCOMPLETE`
(exit 1) means either failed. Operational errors remain `ERROR` (exit 2).
Neither result means human-approved READY, sound requirements, correct
implementation, or Human Review acceptance. The map declares a planned proof;
the checker never runs it or parses test sources. No AC must be automated.

## Execution governance and verification result check

```sh
./scripts/verification-check [story-directory ...]
./scripts/verification-check --result [story-directory ...]
```

Discovery matches `story-check`: with no argument, every directory under
`specs/stories/` except `_template/` is checked relative to the current
directory. The flag appears once before directories.

The default mode resolves and prints the task mode, authority set, risk level,
architecture impact, and required verification profile a Story declares,
applying the documented defaults from the
[Execution Contract](../protocol/execution.md). A Story that declares nothing
new resolves to `execution`, `plan` and `modify` authority, low risk, low
architecture impact, and the `lint static unit` profile.

An optional `## Verification Scope` section may declare `Scope: focused`, the
changed `Surface`, and one exact command per required layer. Both checkers
reject missing, duplicate, unknown, or ineligible declarations. A focused
documentation Story is limited to low risk and low architecture impact and
requires the `documentation` layer. `verification-check --result` matches each
passing focused command to the Story declaration, requires a full-gate
observation (`skipped` with residual risk or `pass` with `make verify`), and
traces every acceptance criterion. An explicit `Scope: full` requires an exact
`make verify` PASS entry. An absent section preserves previous result verdicts.
Neither checker runs commands or knows a repository's current integration or
release policy; Human Review judges those facts.

| Result | Exit | Meaning |
| --- | --- | --- |
| `VERIFICATION_PLAN_OK` | `0` | Every checked Story resolves to a valid execution contract. |
| `VERIFICATION_PLAN_INCOMPLETE` | `1` | A declaration is unknown, repeated, or invalid. |
| `ERROR` | `2` | Invalid invocation, or a missing, unreadable, or symlinked Story file. |

`--result` additionally reads `verification.md` beside the Story and judges it
against that profile and the Story's checkbox acceptance criteria. It reports a
`Plan:` line and then:

| Result | Exit | Meaning |
| --- | --- | --- |
| `VERIFICATION_PASS` | `0` | Every required check passed and every acceptance criterion has a passing observation. |
| `VERIFICATION_PARTIAL` | `1` | A required check is absent or did not pass, or a criterion is unproven. |
| `VERIFICATION_FAIL` | `1` | A check failed, a criterion failed, or an ungranted operation was used. |
| `VERIFICATION_RESULT_INCOMPLETE` | `1` | The record is missing or malformed, or an incomplete result retains no residual risk. |
| `ERROR` | `2` | An operational failure, as above. |

Like the other checkers it is written with shell builtins alone, so its verdict
depends on the files it was given and not on the caller's `PATH`. It never
executes a recorded command, never re-runs a check, and never infers a result
that was not written down: a required check that is simply absent is reported,
not assumed.

`scripts/story-check` also fails a Story whose directory does not name a
conforming Story ID, reporting the directory and the grammar. The ID grammar is
stated in [the Story Contract](../protocol/story.md) and [the Handoff
Contract](../protocol/handoff.md), and both checkers enforce it: `tests/story-check.sh`
`FF227-AC-005` feeds one shared corpus to both and fails if they disagree.

`scripts/story-check` validates the declarations themselves. It reports an
unknown or repeated authority operation, an authority set that grants `deploy`
without `push`, `push` without `commit`, or `commit` without `modify`, an
`evidence` Story that grants any mutating operation, architecture impact
`medium` or `high` with no decision or contract, a referenced decision that does
not exist or is not usable, an owner naming an undeclared boundary, and a
recognized high-risk signal filed below `high`.

Both governance checkers accept the four standard `Signal` declarations and
reject unknown or duplicate values. A Signal is not a `Reason` and does not
change the resolved risk level or verification profile. Risk-contract sections,
their concrete readiness content, and their Evidence AC links belong to
`story-check`; `verification-check` only keeps the shared Risk declaration
grammar consistent while resolving the execution profile.

Each `Reason:` declaration needs one non-empty same-line backticked signal, for
example `versioned-surface`. A prose reason or a closing backtick on a later
line is malformed and reports that shape.

## Handoff contract check

```sh
./scripts/handoff-check [handoff-file]
```

The handoff file defaults to `specs/handoff.md`. The check enforces the
[Handoff Evidence Contract](../protocol/handoff.md): exactly one evidence block,
one `handoff` section, one `verification` section, and one value for each of
`story`, `recorded_at`, `repository`, `revision`, `command`, and `result`.
Story IDs use the shared grammar, recording time uses UTC seconds in
`YYYY-MM-DDTHH:MM:SSZ` form, revision is a full lowercase commit SHA, and result
is `pass`, `fail`, or `not_run`.

Unknown or repeated fields are rejected. Legacy `workflow` and `baseline`
sections are rejected rather than retained as a compatibility state database.
Current or next work, lifecycle status, completed work, Gates, review state,
and completion state belong to the external control plane when one is present.
PraxisBound does not require such a control plane and does not infer current state
from handoff prose.

The supported YAML subset is intentionally line-oriented and lexical. Each
field is one single-line value introduced by exactly one ASCII space after
the field's `:`; Story ID, time, revision, and result use their documented
exact grammars. Repository and command are unquoted, non-null
string-like plain scalars. YAML null, boolean, numeric, and special
floating-point forms; flow collections; quoted scalars; tags; anchors; aliases;
block scalars; and inline comments are rejected for those generic fields rather
than misread as text. Embedded YAML line breaks (CR, NEL, line separator, or
paragraph separator) are rejected on every source line before Markdown fences,
comments, or fields are interpreted; line-ending carriage returns in CRLF input
are normalized. Prose outside the block and whole-line comments inside it are
ignored.

| Result | Exit | Meaning |
| --- | --- | --- |
| `HANDOFF_CONTRACT_OK` | `0` | The point-in-time evidence block is structurally complete. |
| `HANDOFF_CONTRACT_INCOMPLETE` | `1` | A section or field is missing, repeated, unknown, or malformed. |
| `ERROR` | `2` | Invalid invocation, or a missing, unreadable, or symlinked handoff. |

`verification.result` records what was observed at the stated time and
revision. The checker does not re-run it, prove the revision exists, establish
clock truth, or prove the record was never edited. Immutability comes from the
record semantics and VCS history.

## Composed by Doctor

Repository Doctor composes the Story and handoff checks only.
`scripts/verification-check` is not part of Doctor's static inspection, so an
adopter's Doctor result is unchanged by this capability.

[Repository Doctor](doctor.md) runs both checks in static mode once the
required structure is confirmed, using their documented command forms and
adding no options to either. An `INCOMPLETE` result from either check is
reported as drift: Doctor prints a `WARN` line and reports
`Result: CONTRACT_DRIFT` instead of `STRUCTURE_OK`, while its exit status stays
`0`. An `ERROR` from either check is reported as `ERROR` and exits `2`.

Running either check directly stays exactly as documented above; Doctor is a
convenience that composes them, not a replacement for them.
