# Story: TST-028 Batch Review Semantic Report Validation

## Goal

`review preflight` stops treating any existing `--semantic-report` file as
enough. It reads the Agent's Semantic Report, checks that it is well formed,
bound to the current Requirement Fingerprint, and covers every Story in the
batch in all four categories, and lists its observations apart from the
mechanical results. A blocking observation blocks the handoff. A missing,
empty, malformed, stale, or incomplete report never lets the outcome reach
`REVIEW_READY`. The tool checks structure and coverage only; it never claims
the Agent's judgment is correct.

## Context

GitHub issue #89 traces this work to `SPEC-BATCH-REVIEW/R-007`. TST-027
delivered the mechanical checks, the Preflight Report, and a
`--semantic-report` flag that only checks that the file exists. Story R10a of
TST-027 stacks this Story on that branch so the two merge together and main
never reaches READY with an unread report. Contract §9 defines the Semantic
Report rows and their issue codes, §13 the input limits, §15 the report as
untrusted Agent output, and §16 two fixture rows.
`schemas/semantic-report.schema.json` and `examples/semantic-report.json`
exist. `docs/batch-review/agent-workflow.md` §2 is an empty skeleton this
Story fills.

## Classification

* Security sensitive: yes
* Baseline conformance: no
* Task mode: execution

## Authority

* plan: yes
* modify: yes
* add_dependency: no
* migration: no
* commit: yes
* push: no
* deploy: no

## Architecture

* Impact: medium
* Decision: `ADR-014`
* Boundary: `review preflight CLI command`
* Boundary: `semantic report Core module`
* Boundary: `batch review Agent workflow`
* Contract: `the Semantic Report is read once, bounded before parsing, and never written, executed, or treated as authorization`
* Contract: `the tool validates structure, fingerprint binding, locators, and coverage; it never validates the semantic correctness of an observation`
* Contract: `semantic diagnostics stay in the Preflight Report's semantic array, apart from mechanical diagnostics`
* Owner: `review preflight CLI command = PraxisBound tooling`
* Owner: `semantic report Core module = PraxisBound tooling`
* Owner: `batch review Agent workflow = PraxisBound documentation`

## Risk

* Level: high
* Reason: `security`
* Reason: `public-contract`
* Signal: `bounded-capacity`
* Signal: `error-projection`

## Capacity

* Bounded resource: `the one Semantic Report file read per run and the issues it carries`
* Limit: `contract §13: the file is ≤ 1 MiB, nesting depth ≤ 32, each string ≤ 64 KiB, and ≤ 1000 issues in total across all Stories and categories; the size is checked before the content is read`
* Saturation behavior: `an over-limit report is REVIEW_INPUT_TOO_LARGE, outcome INCOMPLETE, and none of its content reaches the Preflight Report`
* Failure projection: `the report's sha256 is recorded whenever its bytes were read within the size bound; semantic[] stays empty unless the report passed schema, batch, and fingerprint checks`
* Evidence AC: `AC-004`

## Scope

### In Scope

* Reading `--semantic-report` under the path rule decided in R10a, bounded by
  contract §13, and recording `semanticReport: {sha256}` in the Preflight
  Report.
* The contract §9 Semantic Report rows: `REVIEW_SEMANTIC_MISSING`,
  `REVIEW_INPUT_TOO_LARGE`, `REVIEW_SEMANTIC_INVALID`,
  `REVIEW_SEMANTIC_COVERAGE`, `REVIEW_SEMANTIC_STALE`,
  `REVIEW_SEMANTIC_BLOCKING`, `REVIEW_SEMANTIC_OBSERVATION`, and the R-007
  row for a Story outside the batch.
* A pure Core module that validates the report and turns it into semantic
  diagnostics, fed into `evaluatePreflight`.
* Human output that labels each line's severity, so blocking and advisory
  lines are distinguishable without `--json` (R10c).
* `docs/batch-review/agent-workflow.md` §2 filled in.
* CLI contract updates and one recorded real-Agent rehearsal.

### Out of Scope

* Judging whether an observation is true, complete, or well reasoned.
* Built-in model providers, model scoring, or running an Agent from the CLI.
* `review packet`, Execution Authorization, and ForgePilot (R-008).
* Changes to TST-027's mechanical checks, except the human severity labels.

## Inputs

* Everything TST-027's preflight reads.
* One Semantic Report file named by `--semantic-report`.

## Outputs

* The TST-027 envelope and Preflight Report, now with `semanticReport` set
  and `semantic[]` filled.
* Human output on stdout whose Agent observations section lists semantic
  diagnostics with their severity.

## Rules

* R1: Checks run in order and each stops the rest: missing or unreadable →
  `REVIEW_SEMANTIC_MISSING`; over a §13 bound → `REVIEW_INPUT_TOO_LARGE`;
  not valid JSON, schema-invalid, or `batchId` differs →
  `REVIEW_SEMANTIC_INVALID`; `fingerprint` differs from the current one →
  `REVIEW_SEMANTIC_STALE`. Only a report that passes all four is checked for
  coverage and turned into observations.
* R2: Coverage: every batch Story appears exactly once. A batch Story that is
  missing is `REVIEW_SEMANTIC_COVERAGE`. A Story named twice, or a Story
  outside the batch (修訂性澄清，R-007), is `REVIEW_SEMANTIC_INVALID`. The
  schema already requires all four categories per Story.
* R3: Each issue whose `blocking` is `true` becomes one
  `REVIEW_SEMANTIC_BLOCKING`, each other issue one
  `REVIEW_SEMANTIC_OBSERVATION`, carrying the issue's locator and a message
  naming the Story and category, with the Agent's text escaped. Severity and
  outcome class still come only from Core's §9 table.
* R4: Each issue's locator must name a batch source, and its anchor and
  `blockSha256` must match a block in the current index; otherwise
  `REVIEW_SEMANTIC_INVALID` (R10b).
* R5: The report's `agent` field is recorded nowhere as identity. It is shown,
  escaped, only as the Agent's own claim.
* R6: A report whose every conclusion is `none` is valid. An empty file, an
  empty `stories` array, or a report that omits a Story is not.
* R7: Text inside the report, including `authorized`, `approved`, or
  instructions, is data. It never changes an outcome or grants authority.
* R8: `agent-workflow.md` §2 states the inputs, per-category guidance, the
  output, and stop conditions, and says the Agent never runs `review confirm`
  and never marks work done.
* R9: The rehearsal is one real Agent run on a recorded batch. It is labelled
  historical Evidence of that run only, never proof that future judgments
  are correct, and a simulated report is never described as a model run.
* R10: Human Review on 2026-09-23 accepted these decisions:
  (a) The `--semantic-report` path must resolve inside the repository with no
  symlink segment, and the file is opened with `O_NOFOLLOW`; a path outside
  the repository or through a symlink is `configuration-error`
  `REVIEW_PATH_UNSAFE`, as for `--output`.
  (b) Every issue locator must match a batch source, anchor, and block hash
  in the current index (R4), so every observation is traceable.
  (c) Human output labels each line `BLOCK` or `NOTE` instead of `ISSUE` in
  both sections; JSON output is unchanged.

## Expected Errors

* Unsafe `--semantic-report` path (R10a): `configuration-error`, exit 2,
  `REVIEW_PATH_UNSAFE`.
* Missing, over-limit, invalid, or incomplete report: `REVIEW_INCOMPLETE`,
  exit 1, unless a higher-precedence condition applies.
* Report bound to another fingerprint: `REVIEW_STALE`, exit 1.
* Blocking observation: `REVIEW_BLOCKED`, exit 1.

## Error Projection

* Source failure: `an unreadable, oversized, malformed, stale, incomplete, or out-of-batch Semantic Report`
* Public projection: `stable review issue codes in the existing envelope; semantic diagnostics in data.diagnostics[] and the Preflight Report's semantic array`
* Detail policy: `repository-relative paths, escaped Agent text, and JSON parse failures reported without echoing the raw input or absolute paths`
* Evidence AC: `AC-003`

## Dependencies

* TST-027 supplies preflight, the Preflight Report, and `evaluatePreflight`,
  and is stacked below this Story.
* `ADR-014` and contract §9 are accepted.
* Decisions (a)–(c) in R10 were accepted by Human Review from carl in a
  Claude Code session on 2026-09-23.

## Constraints

* Add no dependency; validate the schema by hand with the existing
  `revision-limits.ts` helpers, as TST-026 and TST-027 do.
* Classify the change as **Additive** (§14). `schemaVersion`, `protocol/`,
  `templates/`, and `VERSION` remain unchanged.
* Pure decisions live in Core; the CLI reads the file and wires the result.
* Fixtures use isolated temporary repositories.
* `make verify` is authoritative for completion. The Agent rehearsal is
  separately recorded evidence.
* Do not merge, publish, tag, release, deploy, or push. This Story merges to
  main only together with TST-027.

## Guidance

Relevant:

* principle: small coherent changes
* principle: behavior-oriented testing
* principle: explicit dependencies
* decision: `ADR-014` keeps Agent observations a proposal, never authority

Not applicable:

* no persistent-data migration, publication, Protocol change, or model
  integration applies

## Trust Boundary Fields

* `--semantic-report path` — caller-supplied path.
* `Semantic Report` — every field is untrusted Agent output, including `agent`, `observation`, `impact`, and `suggestion`.
* `Semantic Report locators` — untrusted references checked against the current index.
