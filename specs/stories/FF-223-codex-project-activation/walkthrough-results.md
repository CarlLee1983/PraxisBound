# FF-223 final-snapshot walkthrough

Observed on 2026-09-06, macOS Codex CLI 0.153.4, ChatGPT-authenticated,
`gpt-5.6-sol`, reasoning effort `medium`. Each of the twelve cases is a fresh
ephemeral session. This is recorded evidence for Human Review, not automated
approval or a promise that another model invocation will produce identical text.

## Reproduce

Run the repository-owned [fixture builder](walkthrough-fixtures.sh), then the
fresh-session commands in [activation documentation](../../../docs/codex-activation.md).
The builder owns the exact prompts, initial Story/handoff states, Makefile,
deterministic Git identity, and intentional faults. It uses only a new temporary
directory, checks generated contracts, executes C8review's verification before
recording PASS, and removes the generated installation source before returning.

This run's artifact root is `/tmp/forgeflow-codex-walkthrough.FewhAP`.
For each case, `evidence/<case>/` retains `prompt.txt`, `baseline.txt`,
`pre-run-status.txt`, saved integration files, contract results, `session.jsonl`,
and `session.stderr`. The snapshot was compared byte-for-byte across all cases.
The repository-owned builder and observations below survive removal of these local logs;
raw session hashes are recorded below to identify the reviewed local transcripts.

All cases start from Git commit `5e3bf8be72d23e380c36bf18b32e9b139f0eeedb`,
tree `26110df0064ea9cdea941275006afe5070fe099d`, then receive their declared
handoff/fault changes. The builder's POSIX cksum was `722976261 9296`.

Installed identity, identical in every saved pre-fault snapshot:

```text
format=1
version=0.4.1
revision=unknown
adoption=0.4.1
skill=2301200736 3840
workflow=4252943732 4263
block=101329110 788
```

`revision=unknown` is intentional: the generated installation source is a copy,
not a Git checkout. The saved files and checksums identify the tested content.
C9 deliberately removes SKILL.md after recording that identity; C10 changes only
the adoption marker; C11 appends policy outside the managed AGENTS block.

There is no global forgeflow skill in either user skill root. Other user-wide
instructions and skills still load. The host's original checkout remains
readable outside the fixtures; OS read isolation and Codex Desktop behavior are
not claimed. Prompts provide no ForgeFlow checkout path, and the observed entry
workflow uses the project-local files.

## Observations

All twelve sessions emitted `turn.completed`. Exit/completion alone is not the
behavioral verdict: the actions, final artifacts, and limitations below matter.
“Local entry” means the root's `.agents/skills/forgeflow/SKILL.md`; approved work
also loads its `story-development.md`, handoff, Story and acceptance files.

| Case | Loaded sources and observed action | Artifact check / human attention |
| --- | --- | --- |
| C1 | Local entry and approved TST-001; resumed greeting without asking again for approval. | Greeting and task/handoff updated to REVIEW; make verify PASS; no commit/DONE. |
| C2 | From src/, located repository root first, then read local entry and approved Story. | Greeting and task/handoff REVIEW; make verify PASS; no false missing-skill warning or instruction repair. |
| C3 | Local entry, no-current handoff, unapproved greeting draft and template; drafted TST-002 with Acceptance Evidence. | No src/export.sh; current remains none; asked for approval/selection. |
| C4 | Local entry, approved TST-001 and template; drafted independent TST-002 with Acceptance Evidence. | No src/export.sh; current remains TST-001; asked before switching. |
| C5 | Read greeting for the explanation request. | Explained hello plus newline; no Story, lifecycle or file change. |
| C6 | Explicit local skill, Story/handoff and inspected Makefile; reported IMPLEMENTING and unmet AC. | Read-only fixture verify failed as expected; no repair or file change. |
| C7 | Local entry, no-current handoff and unapproved draft. | Requested approval/selection; no implementation or lifecycle change. |
| C8review | Local entry, consistent REVIEW records and completed greeting. | Rechecked make verify PASS; requested Human Review; no self-acceptance or file change. |
| C8conflict | Local entry and current==next handoff. | Stopped without implementation, verification, or normalization; one proposed alternative is invalid—see below. |
| C9 | Root skill missing; used repository guide, approved local Story and handoff. | Diagnosed missing file, suggested considering restoration, preserved deletion; greeting and handoff/task completed to REVIEW, verify PASS; no reinstall. |
| C10 | Explicit local skill, snapshot, marker, Git/template evidence and handoff. | Correctly described marker-only drift, not partial installation or a reason to upgrade skill; no file change. Repair wording remains for human judgment. |
| C11 | Explicit local skill, AGENTS, handoff, Story and greeting. | Reported per-write approval conflict and proposed human rule reconciliation; still explained greeting; no file/rule change. |

The primary additionally reran the known fixture `make verify` for C1/C2/C9;
all passed. C3/C4 were checked for absent `src/export.sh` and preserved
current_story selections. Existing fault edits belong to fixture preparation,
not to the session; the pre-run inventories distinguish them.

## Limits requiring human judgment

C8conflict correctly preserved the repository and asked for a decision, but its
second proposed option said to set `current_story` to `pending`. That is not a
valid absence value: the contract requires a Story ID or `none`; `pending`
belongs to next_story. This proposal was **not applied**. On a separate copied
handoff, the existing checker rejected it with:

```text
FAIL  workflow.current_story must be one Story ID or none
```

This is an observed model-advice limitation, not a passed repair operation.
The guard against automatic selection/normalization held; a human should not
accept the proposed text without checking the contract. Human-method ACs remain
unchecked. C10 accurately diagnoses the version distinction but provides less
explicit repair guidance than C11; assess the response itself during acceptance.

The earlier follow-up run at `/tmp/forgeflow-codex-walkthrough.ZInvYz` exposed
C2's false cwd-relative missing-skill warning. The startup block was then changed
to locate the repository root before testing the skill path, and **all twelve**
cases above were regenerated and rerun. No earlier snapshot's case is substituted
into this final table. Older observations in task.md remain historical only.

## Raw transcript SHA-256

Paths are `evidence/<case>/session.jsonl` under the artifact root above.

```text
C1          108d6514f321f550fb1bd65066ddcb86f7e8ba0db382fe4c476e92a71972237f
C2          cd5e0cbcb12e80c15aa6f1cf7660291399f22fbb2fb46ac92bd9088ab8c1725f
C3          f92a72a8c5ef95f03aaf734e918bd0c9b13cffa39a36f081784ae9507d2685d3
C4          fa426bc39f1c319d84fb36c2101f6bfde22cceea29b8bdbe9d191cde780fcbdf
C5          c501110b7a9524e738fe2b09b13768b7e13ea45cd0ed622f25858363dcae4107
C6          c71535a3b38f7d7606b0611834ebe3039874fdd243aa1a700e8f26abe3d264e6
C7          b884d0ea70854fde04dfa0da27219d704a2ea3786e0a2a2b8db18422cb4e468b
C8review    2f402a77a1c1e09e2f150bdddf28f079948910530b9b3afce18e9c090484dd5b
C8conflict  50806d71a07e291232afff7cda05580ab63724d2ddaa90831a78970e3cf025d8
C9          b27afc5eeff26c2b54fd9a6cad3160331c3a281cb6063a0dd63e8cb06d23c974
C10         6439a36580cb6c2dfcbcf5f1c14fa237faa9e24e8e87b5544bc0a3185971ba57
C11         14a4d0eab62edeb3ef3620c40aba01ae8db21ffbc486a164f89cefc57fb323d4
```
