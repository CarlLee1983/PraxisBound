# Acceptance Criteria

* [x] AC-001: Preview is read-only; explicit installation in an adopted fixture
  installs the repository-local forgeflow skill and one startup section while
  preserving every byte outside that section and leaving adopter code unexecuted.
* [x] AC-002: Repeating the same installation makes no changes; an explicit
  snapshot update changes only owned content, records its version/revision, and
  works after the source checkout is unavailable. Local edits reject the update
  before any write, preserving the complete target tree until resolved.
* [x] AC-003: Unsafe paths, ambiguous ownership, and malformed section markers
  are rejected before writes; detected write failures restore original files or
  report unresolved paths and usable recovery copies without claiming success.
* [ ] AC-004: In a fresh Codex session with only the opted-in project available,
  a continuation request without a ForgeFlow path loads the correct current Story
  from the root or a nested directory and resumes approved implementation work.
* [ ] AC-005: A new request without a matching approved Story produces a draft
  and Acceptance Evidence before implementation; an independent request does not
  switch the current Story until the developer chooses to switch.
* [ ] AC-006: General discussion does not initiate a Story workflow; explicit
  skill invocation works; no-current, REVIEW, and contradictory-handoff cases
  report their actual state without invented selection, approval, or completion.
* [ ] AC-007: Missing integration files, version mismatch, and conflicting
  guidance produce specific diagnoses and proposed repairs without automatic
  updates; unrelated nonblocking work can continue.
* [x] AC-008: Existing bootstrap and --upgrade behavior, optional skill status,
  Doctor results, and make verify semantics remain compatible; documentation
  explains opt-in setup, update, rollback, and limits of implicit activation.
* [x] AC-009: Full make verify passes with the new deterministic installation
  tests; the recorded human walkthrough separately demonstrates the agent-facing
  outcomes without treating an LLM judgment as an automated blocking gate.

## Acceptance Evidence

| AC | Method | Evidence | Fixture / precondition | Expected observation |
| --- | --- | --- | --- | --- |
| `AC-001` | test | `tests/codex-activation.sh:FF223-AC-001` | `adopted temp repo with custom AGENTS prefix/suffix and executable canary` | `preview unchanged; install scoped; canary absent` |
| `AC-002` | test | `tests/codex-activation.sh:FF223-AC-002` | `snapshot A then B; unchanged and locally edited skill; source checkout moved` | `same snapshot no-op; explicit update scoped; local files resolve; edited snapshot rejects with entire tree unchanged` |
| `AC-003` | test | `tests/codex-activation.sh:FF223-AC-003` | `Security Fixture Matrix cases and injected write/recovery failures` | `nonzero failure; original bytes or named recovery copies; no success claim` |
| `AC-004` | human | `walkthrough-results.md: C1-C2` | `fresh sessions at temp adopted root and src/; approved TST-001 IMPLEMENTING; prompt 繼續開發` | `loads local handoff and TST-001; resumes without path prompt or repeated approval` |
| `AC-005` | human | `walkthrough-results.md: C3-C4` | `prompt add CSV export with no matching Story; repeat with unrelated TST-001 active` | `draft with evidence; no implementation before approval; no unsolicited switch` |
| `AC-006` | human | `walkthrough-results.md: C5-C8` | `fresh sessions: explanation request; explicit forgeflow; no current Story; REVIEW or contradictory handoff` | `task-appropriate response; no invented lifecycle transition` |
| `AC-007` | human | `walkthrough-results.md: C9-C11` | `missing skill; mismatched snapshot; conflicting guidance plus independent explanation request` | `specific diagnosis; no unapproved repair; independent explanation continues` |
| `AC-008` | test | `tests/codex-activation.sh:FF223-AC-008 plus existing bootstrap and doctor suites` | `legacy fixtures without integration and custom AGENTS; new integration docs` | `legacy verdicts unchanged; opt-in and rollback boundaries documented` |
| `AC-009` | command | `make verify` | `complete implementation checkout with recorded C1-C11 observations` | `exit 0; human evidence reviewed separately` |

## Security Fixture Matrix

| Source field | Payload | Expected result | Persisted locations | Verification |
| --- | --- | --- | --- | --- |
| `target.path` | `target/AGENTS.md -> outside/sentinel` | reject | `outside/sentinel and target managed files` | `tests/codex-activation.sh:FF223-AC-003` |
| `target.path` | `target/.agents -> outside/` | reject | `outside/ and target/AGENTS.md` | `tests/codex-activation.sh:FF223-AC-003` |
| `target.path` | `regular file at specs, specs/stories, .agents, .agents/skills, or .agents/skills/forgeflow` | reject | `complete target tree including original files moved aside inside fixture` | `tests/codex-activation.sh:FF223-AC-003` |
| `target.path` | `directory or FIFO at AGENTS.md, adoption marker, or any integration member` | reject | `complete target tree including wrong-type object and original bytes` | `tests/codex-activation.sh:FF223-AC-003` |
| `target.path` | `target/AGENTS.md hard-linked to outside/sentinel with bytes external-original` | preserve | `outside/sentinel remains external-original after install and injected recovery failures` | `tests/codex-activation.sh:FF223-AC-003` |
| `agents.contents` | `two complete ForgeFlow managed sections or an unmatched delimiter` | reject | `target/AGENTS.md and target/.agents/skills/forgeflow/` | `tests/codex-activation.sh:FF223-AC-003` |
| `agents.contents` | `custom prefix and suffix with CRLF and no final newline` | preserve | `target/AGENTS.md outside the owned section` | `tests/codex-activation.sh:FF223-AC-001` |
| `integration.contents` | `locally edited installed SKILL.md` | preserve | `target/.agents/skills/forgeflow/SKILL.md` | `tests/codex-activation.sh:FF223-AC-002` |
| `snapshot.identity` | `snapshot A installed; snapshot B available but update not authorized` | preserve | `installed integration files and identity; specs/.forgeflow-adoption` | `tests/codex-activation.sh:FF223-AC-002` |
| `workflow.inputs` | `Makefile verify target creates execution-canary` | omit | `target/execution-canary` | `tests/codex-activation.sh:FF223-AC-001` |

## Verification Notes

The deterministic paths above now exist and pass. Final-snapshot Codex CLI
observations and limitations are recorded in walkthrough-results.md; task.md
preserves earlier misses and implementation history. Human-method ACs
remain unchecked pending Human Review. Full make verify does not certify model
behavior or erase the documented host/isolation limitations.

Run deterministic cases through run_case with their FF223 AC IDs and include
them in root make verify. Use temporary files for all rejection and recovery
cases, including a pre-existing hard-link sentinel and replacement failures at
each managed write. Preview and refusals compare the complete fixture tree.

For C1-C11, record Codex host/version, model, exact prompt, fixture baseline,
loaded sources, observed actions, and transcript reference in task.md. Each case
starts fresh with the source checkout unavailable and no global forgeflow skill.
Build fixtures in temporary repositories; do not alter live dbcli or this repo.
Record misses honestly and verify explicit invocation as the fallback. The
walkthrough is human acceptance evidence, not a guarantee of deterministic AI.
