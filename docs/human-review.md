# Human Review

Human Review is the required contextual judgment about product intent, design,
and architecture. It complements automated verification; it is not another
automated gate. A PASS for the Story's required checks means the implementation
may enter REVIEW, not that Human Review passed.

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

* Require a complete PASS for the approved Story scope from the implementation
  under review. When full verification is required, require a complete
  `make verify` PASS. A focused record never certifies the full gate.
* Confirm the focused commands actually exercised changed behavior or edited
  documents. Reject a focused scope when the Story or repository policy requires
  full verification at integration, release, or for the changed surface; the
  static checker cannot inspect phase or repository policy.
* A change to source code, tests, configuration, or another behavior-affecting
  file immediately invalidates the prior PASS. Run the required checks again
  before returning to REVIEW; run complete `make verify` when required.
* A handoff checker validates one immutable point-in-time evidence record. It
  does not prove that PASS occurred, remains fresh, or represents current
  lifecycle state. Never attach dirty-worktree verification to an unchanged
  HEAD revision.
* A handoff evidence edit is also a repository change. The human reviewer
  decides whether it affects behavior and requires complete re-verification for
  the approved scope.

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
change should encode it as an architecture check behind `make verify`. That
checker is the repository's to build: PraxisBound records and resolves
architecture declarations and does not analyse source, as
[Architecture](../protocol/architecture.md) states.

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

### Tests

* Do tests verify observable behavior instead of freezing private
  implementation details?
* Is there evidence for important success, failure, and regression behavior?
* Do the tests sufficiently protect this change?
* Was acceptance manufactured by deleting, weakening, or skipping tests? Such a
  change is not acceptable.

This is intentionally not a complete Test Quality Contract. Broader test
quality policy belongs in a separate Story.

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
for review. Run the required checks again, including complete `make verify`
when the Story or repository policy requires it; only a new PASS returns the
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
