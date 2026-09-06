# Human Review

Human Review is the required contextual judgment about product intent, design,
and architecture. It complements automated verification; it is not another
automated gate. A `make verify` PASS means the implementation may enter REVIEW,
not that Human Review passed.

An agent may prepare evidence, a summary, assumptions, unresolved risks, and
suggested attention points. An agent, test, or LLM cannot approve REVIEW or
advance a Story to DONE. Only a human can accept the review.

Review feedback should identify the Story or Acceptance Criterion, repository
policy, architecture rule, or concrete maintenance risk it addresses. Personal
preference alone is not a reason to request a change. Review also cannot
silently revise approved product requirements: when feedback changes intent, a
human first revises and reapproves the Story through SPEC_BLOCKED.

## Review dimensions

These are questions for informed judgment, not LLM scoring, numeric thresholds,
or a universal set of code structures.

### Intent and behavior

* Does the implementation satisfy the Story Goal, Scope, Rules, and Acceptance
  Criteria?
* Does it add unapproved behavior or omit a required failure case?
* Does error behavior match the Story's Expected Errors?

### Contract truthfulness and evidence freshness

Static contract checks confirm declared structure, not whether the declarations
match reality. Human Review asks:

* Does `Security sensitive` reflect the actual trust boundaries,
  authorization, confidential data, external input, and persistence behavior?
* Does `Baseline conformance` reflect any actual replacement of existing
  behavior or tests?
* When either declaration is `yes`, do `Trust Boundary Fields`,
  `Security Fixture Matrix`, or `Superseded Behavior` completely describe the
  real change?
* Was either declaration set to `no` merely to avoid the conditional sections?
  That is not acceptable.
* Do the Story, Acceptance Criteria, Classification, implementation, and tests
  agree?
* Does every Acceptance Evidence row name a sufficient method, fixture or
  precondition, and expected observation for its criterion? External facts and
  weak fixtures require explicit human judgment rather than a fabricated PASS.

Review also confirms that verification evidence belongs to the implementation
currently under review:

* Require a complete `make verify` PASS from the current implementation.
* A change to source code, tests, configuration, or another behavior-affecting
  file immediately invalidates the prior PASS. Run complete `make verify` again
  before returning to REVIEW.
* For a final handoff-only documentation change that does not affect the
  implementation, attribute its paths explicitly. The human reviewer decides
  whether it affects behavior and requires re-verification.
* A handoff checker validates the consistency of the recorded declaration. It
  does not prove that PASS occurred or remains fresh.

### Naming and readability

* Do names express business intent and use the repository's existing domain
  language?
* Are vague names such as `data`, `manager`, `helper`, or `util` hiding intent?
  The word alone is not a defect; judge it in context.
* Can a maintainer follow the control flow and data transformations?

### Responsibility and cohesion

* Does each function, class, or module have a clear, cohesive responsibility
  and reason to change?
* Has one unit accumulated unrelated reasons to change?
* Are responsibility boundaries sound even when the Story itself is small?

### Abstraction and duplication

* Does an abstraction reduce the cost of understanding the current system?
* Was an extension point introduced only for a need that has not appeared?
* Does duplicated code reveal one shared concept, or only look similar while
  representing different business intent?
* Would applying DRY incorrectly merge distinct domain concepts?

### Dependencies and architecture

Where the repository defines architecture rules, ask:

* Does dependency direction follow those rules?
* Does core business policy depend unnecessarily on a framework, database,
  transport, or vendor detail?
* Do external services pass through the repository's existing boundary, port,
  or adapter?
* Is the public interface minimal and driven by consumer needs?
* Does the implementation preserve existing module boundaries?

When an architecture restriction can be checked deterministically, a later
change should encode it as an architecture test behind `make verify`.

Use SOLID as contextual prompts, not as a demand that every language or change
adopt the same class structure:

* **SRP:** Does the unit have one clear reason to change?
* **OCP:** Does adding behavior require widespread changes to unrelated code?
* **LSP:** Do implementations of the same contract remain substitutable?
* **ISP:** Must a consumer depend on interface capabilities it does not need?
* **DIP:** Does high-level policy depend unnecessarily on low-level detail?

### Error handling and side effects

* Are errors swallowed, distorted during translation, or stripped of useful
  diagnostic context?
* Are side effects, transactions, retries, timeouts, and resource cleanup clear?
* Are boundary inputs validated as the Story requires?
* Can the change persist results that the Story or tests do not cover?

### Failure detection and recovery

For changes with operational effects, ask which existing log, metric, trace,
exit result, or other observation would reveal a failure. Name the condition
that calls for stopping execution or rollout, the recovery procedure, and the
check that demonstrates recovery restored the required state. Distinguish a
procedure that was exercised from one that is only documented; identify any
irreversible effects or unverified recovery assumptions.

Use the existing review report or link the repository's runbook. If operational
recovery does not apply, explain why; a wording-only documentation change, for
example, has no runtime state to restore. These prompts do not require a new
monitoring system or authorize production execution.

### Tests

* Do tests verify observable behavior instead of freezing private
  implementation details?
* Is there evidence for important success, failure, and regression behavior?
* Do the tests sufficiently protect this change?
* Was acceptance manufactured by deleting, weakening, or skipping tests? Such a
  change is not acceptable.

This is intentionally not a complete Test Quality Contract. Broader test
quality policy belongs in a separate Story.

### Verification limits

In existing Verification Notes or the review report, name relevant cases that
were not exercised, why they were omitted, what the available evidence can
establish, and what remains uncertain. Consider external services, concurrent
operations, data lifecycle, and partial failures when they affect this change.
Point to the follow-up check or human decision needed. Explain non-applicability
instead of supplying an empty checklist.

An untested-case note does not waive required behavior or turn a missing
acceptance result into PASS. Repair implementation or evidence gaps through the
existing workflow; a missing or conflicting intent decision follows SPEC_BLOCKED.

For example, suppose an approved CSV-import Story requires atomic publication:
validation errors and interrupted writes must leave the previous output intact.
The review report can link fixtures for empty input, missing columns, and a
failure before publication. It can state that concurrent writers were not tested
because the approved scope is a single writer, so those fixtures establish no
concurrency guarantee. A nonzero exit and the import error log signal failure;
stop the batch on that result, remove only the failed attempt's temporary output,
and verify that the previous output is unchanged before retrying. Link the
fixture result demonstrating that recovery. A crash after publication needs
separate evidence if the Story covers it; these pre-publication tests do not
prove that case.

### Scope and maintainability

* Is this still the smallest coherent change that completes the Story?
* Did unrelated refactoring enter the change?
* Does it leave dead code, stale documentation, or an unexplained compatibility
  path?
* Does it add an extension point beyond a current requirement?

## Review preparation

The agent's delivery report should make review efficient by including:

* a Story and Acceptance Criteria mapping summary;
* important design decisions;
* architecture or boundary impacts;
* test and verification evidence;
* assumptions and unresolved risks; and
* areas the human should inspect closely.

This evidence supports human judgment. It never authorizes acceptance.

## Review outcomes

### Accepted

```text
REVIEW → DONE
```

A human may accept when product intent, design, and architecture are acceptable
and the repository merge policy is satisfied. An agent cannot choose this
outcome.

### Changes requested

```text
REVIEW → IMPLEMENTING → VERIFYING → REVIEW
```

Use this path when Human Review finds an implementation, test, readability, or
architecture issue. Any implementation change makes the prior PASS insufficient
for review. Run the complete `make verify` again; only a new PASS returns the
Story to REVIEW.

### Specification blocked

```text
REVIEW → SPEC_BLOCKED → READY
```

Use this path when review uncovers a missing or conflicting product, policy, or
architecture decision. A human must resolve the decision, revise the Story, and
reapprove it before the Story becomes READY. Do not resolve the blocker by
weakening tests or guessing the requirement.

## Compatibility

This guidance adds no required adopter artifact and no required review artifact.
It adds no reviewer metadata and no Make target, including no adopter Make
target. There is no automated approval or automatic Classification inference.
It adds no lifecycle state and changes no
existing PASS, FAIL, or Repair Loop semantics.
