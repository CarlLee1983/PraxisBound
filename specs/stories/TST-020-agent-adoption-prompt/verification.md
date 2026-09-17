# Verification Result: TST-020

## Checks

* lint: pass — `make verify on a232d70532c0e3125ce73c10642256f438799ac6; shell syntax for tests/bootstrap.sh and every composed gate passed`
* static: pass — `make verify; Story readiness and verification planning passed for TST-020`
* unit: pass — `tests/bootstrap.sh TST020-AC-001, AC-002, AC-004, AC-007 and AC-009 under sh and dash`
* integration: pass — `six fresh non-interactive agent sessions on the prompt at a232d70532c0e3125ce73c10642256f438799ac6, inspected by the agent, recorded under Evidence`

## Observation record

The prompt under observation is the text of `docs/getting-started.md` at
a232d70532c0e3125ce73c10642256f438799ac6. The agent extracted the prompt block
and, for the optional variant, substituted its step 2, then started each session
itself with that text as the only input: Claude Code 2.1.274 through
`claude -p` with tools Bash, Read, Edit, Write, Glob and Grep allowed, and Codex
0.154.0 through `codex exec` in the workspace-write sandbox with network access.
No session bypassed permissions or sandboxing, and none received further input.
Each session loaded the human's own global agent configuration; the Claude Code
sessions reported in the human's configured language, and a local graft tool
added ignore entries in the Codex sessions. Each observation ran on a new copy of
one of two fixture repositories created outside this repository with one initial
commit: `invoice-totals`, a Node project with no `AGENTS.md` tested by
`node --test`; and `shipping`, a Go project tested by `go test` whose committed
`AGENTS.md` holds rules marked FIXTURE-RULE-A, B and C. The agent then inspected
each fixture directly: commit count, `git status`, Doctor and `verify` through
the pinned CLI, the Makefile, and `make verify` after breaking one repository
behavior (the Node total or the Go base rate), restoring it, and rerunning.

Not counting:

* Two pilots on commit 887907a before the prompt was final. Both passed their
  inspections; the Codex pilot exposed a step 3 made unreachable by "Otherwise",
  a diff written outside the repository, cache writes outside the fixture, and
  environment-added ignore files, which led to the revisions in a65ab07.
* A first round of six on a65ab07. Five passed. The Codex optional-authorization
  session kept every rule and passed Doctor, `verify` and the broken-behavior
  check, but wrote the `AGENTS.md` diff to a file outside the repository and
  linked it instead of including it, failing AC-006. a232d70 changed step 2 to
  require the full diff inline, and all six were repeated.

Human Review: carl accepted TST-020 in a Claude Code session on 2026-09-17 at
2026-09-17T07:53Z, reviewing pull request #80 with the prompt at
a232d70532c0e3125ce73c10642256f438799ac6 and this record, including the small
sample, the agent-started sessions, the unisolated global configuration, and
the prompt's version pin.

## Evidence

* `AC-001`: pass — `tests/bootstrap.sh TST020-AC-001 found the Adopt with an AI agent section inside the published package path, its prompt and optional step 2 blocks, and the README pointer.`
* `AC-002`: pass — `tests/bootstrap.sh TST020-AC-002 found every @praxisbound/cli reference pinned to 0.2.0, the version in packages/cli/package.json, every required instruction, and no agent product or vendor name.`
* `AC-003`: pass — `Claude Code and Codex on the Node fixture each left one commit, Doctor pass, verify success, and a Makefile whose verify target runs npm test; after the total was broken make verify failed, and after restoring it passed. Outside the fixture only package caches and temporary files were written; the Codex session also shows a graft entry added to .gitignore and a .ignore file by the human's local tool.`
* `AC-004`: pass — `tests/bootstrap.sh TST020-AC-004 found the default stop on INIT_CONFLICT and the optional step 2 with its uncommitted-changes stop, init --force, git show HEAD:AGENTS.md merge and inline git diff.`
* `AC-005`: pass — `Claude Code and Codex on the Go fixture with the default prompt each reported INIT_CONFLICT on AGENTS.md, ran no init --force, left one commit and a clean git status, and stated that Doctor and verify were not run.`
* `AC-006`: pass — `Claude Code and Codex on the Go fixture with the optional step 2 each ran init --force after the conflict, kept FIXTURE-RULE-A, B and C and the installed Development Workflow section in AGENTS.md, left one commit, passed Doctor and verify, built a gate running go test and go vet that failed with the base rate broken and passed once restored, and included the full git diff of AGENTS.md in the final report. Compared with a fresh init of 0.2.0, both merged files only add a section holding the original rules, and Claude Code one sentence tying make verify to FIXTURE-RULE-B; neither changes any installed line.`
* `AC-007`: pass — `tests/bootstrap.sh TST020-AC-007 rejected copies with a wrong pinned version, an unpinned reference, a removed gate, commit and force instruction, a removed git show merge source, an agent product name, a stale package version and a README without the pointer.`
* `AC-008`: pass — `the six observations above all used the prompt at a232d70532c0e3125ce73c10642256f438799ac6 in fresh non-interactive sessions with no further input; the pilots and the first round are recorded as not counting.`
* `AC-009`: pass — `make verify exited 0 on a232d70, and README.md names ./scripts/codex-activate and npx @praxisbound/cli codex activate.`

## Authority Used

* plan
* modify
* commit
* push

## Residual Risks

* `The observations cover two agents, two small fixture repositories and one run each. They show the prompt can succeed from the prompt alone, not that it succeeds reliably across agents, models or larger repositories.`
* `Both sessions carried the human's global agent configuration. A differently configured agent may behave differently; the observations do not isolate the prompt from that configuration.`
* `Merging an existing AGENTS.md depends on the agent's judgment. Both merges kept the marked rules verbatim, but only rules that were marked were checked, and the prompt tells the reviewer to inspect the diff before committing.`
* `The prompt pins @praxisbound/cli 0.2.0. tests/bootstrap.sh fails when the package version changes without the prompt, so a release must update the prompt, and these observations must be repeated if the prompt text changes.`
