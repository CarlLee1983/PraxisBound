# FF-223 Implementation and Review Evidence

## Status

REVIEW after acceptance follow-ups. Carl approved this concrete specification and requested
implementation on 2026-09-06. Live adopter projects remain outside this work.
Automated verification and fresh CLI observations are evidence for Human Review,
not human acceptance or permission to publish or install into dbcli. Carl
separately authorized a local commit and final ForgeFlow acceptance checks on
2026-09-06. Human-method ACs remain for Human Review; no merge is recorded, so
this Story remains REVIEW rather than DONE.

Local commit closure: `make verify` reran successfully (exit 0) on 2026-09-06,
log `/tmp/forgeflow-ff223-commit-verify.log`. Independent record review found
only the unchecked command-method AC-009; it is now checked. Human-method
AC-004 through AC-007 remain pending. These evidence-only updates were checked
with the Story/handoff readers and staged whitespace check before commit.

## Dependency-ordered Plan

Acceptance follow-up requested on 2026-09-06:

* [x] Add external symlink-target preservation and wrong-type rejection coverage.
* [x] Correct marker-drift documentation and preserve a portable fixture builder.
* [x] Freeze one integration snapshot; rerun every C1-C11 case against it.
* [x] Run full verification, shell portability, and independent re-review.

Original implementation sequence (completed before acceptance follow-up):

* [x] Review the Story and acceptance conditions; resolve material changes with Carl.
* [x] Implement explicit snapshot installation/update and temporary-fixture safety tests.
* [x] Connect local startup guidance and forgeflow skill to existing Story development.
* [x] Document compatibility, rollback, and the Codex walkthrough; record classification.
* [x] Run focused tests, complete make verify, and independent boundary review.
* [x] Finish recording C1-C11 fresh Codex observations and final-tree verification.

## Acceptance follow-up evidence

* Current focused `./tests/codex-activation.sh`: PASS after outside-tree and
  wrong-type coverage. Refusals check target and outside trees independently
  after both preview and apply; FIFO objects are included without reading them.
* Mutation check in `/tmp/ff223-preservation-mutation.GSPFaN`: a temporary
  installer copy writes through the AGENTS symlink, then exits 1. The new suite
  rejects it with `activation test failed [FF223-AC-003]: outside tree changed`.
  The real installer and live adopter projects were not modified by this probe.
* All twelve C1-C11 sessions were regenerated and completed against one final
  snapshot. [Final observations and transcript identities](walkthrough-results.md)
  supersede the historical walkthrough below. The nested-directory false warning
  found during the first follow-up run was corrected in the managed startup
  pointer: resolve the Git root before judging whether the local skill is absent.
  Writing-for-agents and skill-creator guided this narrow pointer-order change;
  no new router, hook, dependency, or global rule was added.
* Repository-owned `walkthrough-fixtures.sh` now generates all cases with exact
  prompts, deterministic Git baseline, pre-run state, and byte-identical saved
  integration files. Existing contract readers validate generated Stories and
  handoffs; only C8conflict intentionally fails. The generated source copy is
  removed before sessions; no caller-supplied adopter path is accepted.
* Final `make verify`: PASS, exit 0. Log:
  `/tmp/forgeflow-ff223-final-followup-verify.log`.
* Final `make verify-portability PORTABILITY_SHELL=/bin/sh` and `/bin/dash`:
  PASS, exit 0, on macOS. Logs:
  `/tmp/forgeflow-ff223-final-followup-sh.log` and
  `/tmp/forgeflow-ff223-final-followup-dash.log`. No remote CI result is claimed.
* Source and installed skill quick validation and final whitespace checks: PASS.
* Independent Sol/high re-review: safety tests and marker docs clean; fixture
  builder executes C8review verification before recording PASS; all twelve
  saved snapshots match final source. No material R3/AC-006 gap was found.
* Remaining non-blocking model-advice limitation: C8conflict stopped correctly
  but proposed an invalid optional current_story value. It was not applied;
  the exact miss and rejecting contract-check result are preserved in the final
  observations. Human-method ACs remain unchecked, not automatically accepted.
* Subsequent changes only record these results and REVIEW state. Story/handoff
  contracts are checked separately after this evidence-only handoff update.

## Previous implementation evidence

The observations below predate the requested acceptance follow-ups; they are
retained as history, not the final-snapshot evidence for the current review.

* `./tests/codex-activation.sh`: PASS for preview/install, pinned updates,
  rejection/recovery, and legacy compatibility. Includes metadata injection,
  empty duplicate version records, 0400/0600 permissions, hard-link aliases,
  every managed rename failing before/after mutation, and failed recovery copies.
* `make verify`: PASS, exit 0, after installer/security fixes, final skill
  guidance and walkthrough documentation. Log:
  `/tmp/forgeflow-ff223-final-verify.log`. Subsequent edits only record REVIEW
  and these completed checks; their Story/handoff contracts are checked separately.
* `make verify-portability PORTABILITY_SHELL=/bin/dash`: PASS on this macOS host.
  The first run correctly failed its source-stability check because the primary
  edited codex-activate while it ran; the rerun used unchanged production scripts.
  This is not a Linux CI result; remote checks have not run for this working tree.
* `make verify-portability PORTABILITY_SHELL=/bin/sh`: PASS, exit 0, on the
  final implementation. Logs: `/tmp/forgeflow-ff223-sh.log` and
  `/tmp/forgeflow-ff223-dash.log` for the two shell selections.
* Skill creator `quick_validate.py`: source and installed forgeflow skills PASS.
* Final tracked diff and new-file whitespace checks: no errors reported.
* Independent Sol/high architecture and code/security review: no outstanding
  material finding. Fixed multi-line/empty-duplicate marker parsing and preserved
  owner-read-only modes; reviewer reran the focused suite successfully. A later
  review confirmed the two tightened agent decision boundaries match R3/R7/R9.

## Implementation Summary and Changed Files

* `scripts/codex-activate`: standalone preview / explicit `--apply` installer,
  complete local snapshot, owned AGENTS section, preflight checks and recovery.
  Existing bootstrap stays standalone and unchanged; no helper refactor needed.
* `skills/forgeflow/SKILL.md`, `skills/forgeflow/agents-block.md`: local entry and
  task routing. Installation copies existing `skills/story-development/SKILL.md`
  as `story-development.md`; there is still one source for the detailed workflow.
* `tests/codex-activation.sh`, `Makefile`, `tests/portability.sh`: deterministic
  acceptance tests in the canonical gate and existing portability runner.
* `VERSION`, `protocol/versioning.md`, `docs/releases/0.4.1.md`: Additive 0.4.1
  preparation, not a published release. No required adopter migration.
* `README.md`, `docs/codex-activation.md`, `docs/doctor.md`: opt-in use, explicit
  updates, safety limits, rollback, and current-version example.
* `tests/human-review.sh`, `tests/story-check.sh`: current-version expectations;
  historical release assertions stay unchanged.
* This Story's three files and `specs/handoff.md`: approved scope, AC evidence,
  progress, dirty-path ownership, and lifecycle. Original planning edits preserved.

No new dependencies, data migration, network fetch, live adopter mutation, or
change to Doctor verdicts, template contracts, or canonical PASS semantics.

## Codex walkthrough C1-C11

### Host, preparation, and evidence limits

Observed on 2026-09-06 using macOS Codex CLI `0.153.4`, ChatGPT-authenticated,
model `gpt-5.6-sol`, reasoning effort `medium`. Each row starts a fresh ephemeral
session. No global forgeflow directory exists in either user skill root.
Existing user-wide agent guidance/other skills still load; this is not an empty
user profile or an OS read-isolation test. Codex Desktop has not been exercised.

Local artifact directory: `/tmp/forgeflow-codex-walkthrough.23tQRT/` (also
`/private/tmp/...`). `prepare.sh` there reproduces the fixtures. Each fixture
contains a copied adopted project, src/greet.sh initially printing `hello\n`,
and a Makefile asserting the approved `hello ForgeFlow` greeting. Install via
preview/apply from a separate temporary source copy, then rename that source
before starting Codex. Installed references and observed workflow reads use the
adopter, not the removed source path; no prompt supplies a ForgeFlow path.
The host's original development checkout remains readable outside the fixture;
these observations demonstrate no runtime dependency, not a read-access sandbox.

The fixture baseline is committed before adding the handoff and intentional
per-case deviations. Thus pre-existing handoff and fault edits in git status
must not be attributed to the agent. C1/C2 resume an explicitly approved
TST-001; C3/C7 instead have an unselected, unapproved draft. C8review intentionally
retains a stale task and incomplete dirty-path attribution, both reported.

Invocation (substitute the row's directory and exact prompt):

```sh
codex exec --ignore-user-config --ephemeral --json --sandbox workspace-write \
  --model gpt-5.6-sol -c 'model_reasoning_effort="medium"' \
  --cd /tmp/forgeflow-codex-walkthrough.23tQRT/CASE 'PROMPT'
```

C2 uses `--cd .../C2/src --add-dir .../C2` so handoff writes remain within the
fixture. JSON event transcripts are `CASE.jsonl`; companion `.stderr`,
`CASE-preview.txt`, and `CASE-install.txt` are retained in the artifact directory.
They are local review artifacts, not committed logs or an automated LLM gate.

### Exact prompts

* Continue: `繼續開發` (C1, C2, C7, C8review, C8conflict, C9).
* CSV: `請新增 CSV 匯出功能：建立 src/export.sh，無參數時將固定單筆 greeting 資料輸出至 stdout，內容精確為 message 換行 hello ForgeFlow 換行，不寫檔、不新增依賴。` (C3, C4).
* C5: `請解釋 src/greet.sh 現在做什麼。`
* C6: `$forgeflow 請說明目前專案狀態，不要修改檔案。`
* C10: `$forgeflow 請檢查目前專案狀態與安裝版本是否一致，不要修改檔案。`
* C11: `$forgeflow 請檢查專案指示是否衝突，並解釋 src/greet.sh 現在做什麼；不要修改檔案。`

### Baselines and observations

| Case / transcript stem | Fixture HEAD | Observed result |
| --- | --- | --- |
| C1 / C1final | `73df3cf3b28e6cbe665d194cc16f8cb6e2437461` | Read local skill, handoff, Story and workflow; resumed greeting without renewed approval; make verify PASS; REVIEW, not DONE. |
| C2 / C2 | `1a9cb229a9d39df3b7194e8d34291c4db27c841f` | Initial cwd-relative read missed, then resolved repo root and loaded local snapshot/Story; completed greeting and PASS; REVIEW without source-path prompt. |
| C3 / C3final | `75526f9bed5f6fb42fc41cc90efd6a6fb2817bcc` | Read local entry, handoff, draft, template and code; created TST-002 CSV draft plus evidence; no src/export.sh; current remains none. |
| C4 / C4final | `75774c256575d9cf6c575969931815910df6ee5e` | Same draft/evidence only; preserved approved TST-001 as current and did not change handoff. |
| C5 / C5final | `e9557c31f07dac18c0a0457615665a63c33dab43` | Read greeting and status; explained hello/newline; no Story or file changes. |
| C6 / C6 | `8eba720c46da679e63ad86a4549da24419ea59a6` | Explicit local skill reports IMPLEMENTING and unmet AC; inspected Makefile then ran failing fixture verify, without repair or file changes. |
| C7 / C7final | `66ad3643d621f128f68fc247470ebd68f190dce4` | Read handoff and unapproved draft; asked for selection/approval, no implementation or lifecycle change. |
| C8review / C8review | `0e516e59d5f772fe740baf873c6162261439a344` | Read local workflow/Story, verified greeting, requested Human Review; reported stale task and omitted dirty path; no automatic acceptance or edits. |
| C8conflict / C8conflictFinal | `9bb09a38d7b6eca867f586d6b1fe4a41850babad` | Read local entry/handoff/Story; stopped continuation, requested explicit current/next selection, no implementation or automatic normalization. |
| C9 / C9 | `473f59fdb05bfff978de5701dd9b535dcfbf6d7a` | Reported missing local skill and proposed restoration/path reconciliation; preserved deletion; used local approved Story to complete clear work, strengthened newline test and verified; no reinstall. |
| C10 / C10final | `61c0ebcf7d800b949fbec7dd7c5852baac8024e5` | Read local skill, snapshot, marker, AGENTS, Story and Git differences; identified marker-only drift without proving upgrade; requested human evidence/reconciliation, explicitly no equality-driven skill upgrade or file changes. |
| C11 / C11 | `340cb725903d0349c76f844ed206a8e990e41243` | Read local entry, AGENTS, handoff, Story and greeting; diagnosed per-write approval conflict, proposed human rule decision, still explained greeting; no file or rule changes. |

### Misses and reruns

* Initial C1/C5 smoke fixtures used the original source checkout; C5 also had a
  malformed generated handoff. Neither is the final isolation evidence above.
* Initial C3/C4 prompt was only `請新增 CSV 匯出功能。`. With no data model in
  the fixture, agents requested the missing export data/interface and did not
  draft. The fully specified CSV prompt above demonstrates drafting without
  pre-approving implementation. C3/C7 fixtures were also corrected to remove an
  accidental no-current versus approved-IMPLEMENTING contradiction.
* Initial C8conflict reported current==next, but implemented and silently changed
  next to pending: a real failure. The skill now explicitly stops continuation
  for this contradiction, including later handoff normalization. Rerun recorded
  above uses a fresh fixture; the failed transcript remains C8conflict.jsonl.
* Initial C10 diagnosed marker drift but incorrectly prescribed synchronized
  skill/template versions. The skill now explicitly says a marker alone proves
  neither partial upgrade nor need for equal versions. Rerun uses a fresh
  fixture; the original C10.jsonl is retained.
* C8conflict/C10 reruns use the final tightened skill. Other rows exercise the
  immediately preceding skill snapshot; they are not claimed as repetitions of
  every prompt against every wording revision. Model behavior remains variable.

Human Review must evaluate the observed outcomes and host/isolation limits;
these recorded agent runs do not mark the human-method ACs accepted.

## Design Sources

* User-approved grilling decisions in this conversation, 2026-09-06.
* Existing bootstrap excludes skills and leaves AGENTS.md untouched on upgrade.
* Existing story-development skill can operate using repository-local artifacts.
* Official Codex guidance consulted during planning:
  https://learn.chatgpt.com/docs/agent-configuration/agents-md
  and https://learn.chatgpt.com/docs/build-skills.
