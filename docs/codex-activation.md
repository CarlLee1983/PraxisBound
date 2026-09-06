# Codex project activation

Opt in once to make the current project discoverable to Codex without repeating
the ForgeFlow source path in each development prompt. This optional integration
adds a local skill and a small AGENTS.md section. Existing bootstrap commands,
including `--upgrade`, retain their behavior and never manage this integration.

## Install and update

From a trusted ForgeFlow checkout, preview the exact paths and AGENTS.md diff:

```sh
./scripts/codex-activate /path/to/adopted-repository
```

After reviewing the preview and authorizing these changes:

```sh
./scripts/codex-activate --apply /path/to/adopted-repository
```

The target needs a readable nonempty AGENTS.md and an existing specs/stories
directory. Legacy adoptions without a marker are supported with adoption version
`unknown`. Run the installer only against a repository you intend to modify.
It never executes the target Makefile, tests, hooks, or other repository code.

The owned surface is:

```text
AGENTS.md                         # only the ForgeFlow Codex managed section
.agents/skills/forgeflow/
  SKILL.md
  story-development.md             # copy of the canonical Story-development skill
  .forgeflow-snapshot
```

Commit these files through the adopter's normal workflow so teammates get the
same snapshot. The installed skill refers only to the current repository; the
source checkout can be removed after installation. No global skill, plugin,
background process, or extra runtime service is needed.

Preview and `--apply` have the same validation. Reapplying an identical snapshot
is a no-op. To update, deliberately choose a newer ForgeFlow checkout, preview,
then apply. There is no network fetch or automatic upgrade. Local edits to any
owned file or the managed section, unexpected files, and incomplete snapshots
are refused before target writes. Save intended edits and explicitly reconcile
them with the original installed snapshot before retrying; there is no force flag.

The seven-line snapshot records format `1`, integration version/revision,
template adoption version at installation, and POSIX cksum/byte counts for the
two skill files and the exact managed section. It is accidental-drift detection,
not a cryptographic signature or protection against someone forging metadata.
Revision is the source HEAD, HEAD-dirty, or unknown when Git cannot establish it.
Integration updates do not alter specs/.forgeflow-adoption or Story templates;
the two version values can legitimately differ. A change from the recorded
`adoption=` value means the marker differs from the recorded baseline; it does
not by itself prove a template change or partial upgrade. Confirm the template
history before proposing reconciliation. Equal version numbers are not required.

## Use

Open a fresh Codex session in the project root or a nested working directory.
For an approved active Story, say `繼續開發` or request its next implementation
change. Codex should load the local handoff and Story and resume at the recorded
state. For a new independent requirement it prepares a draft for human approval;
it preserves the current Story until you decide to switch. Questions and design
discussion do not start the Story workflow. `$forgeflow` is the explicit fallback.

Missing integration files, conflicting project instructions, or ambiguous
handoff state call for a specific diagnosis. The agent can continue independent
work; repairing installation or upgrading instructions requires authorization.

Codex loads project AGENTS.md instructions and discovers repository skills from
`.agents/skills` between the working directory and repository root. Overrides,
instruction limits, and skill selection can affect activation. Test the actual
host; installation is not proof that every prompt will trigger the skill.
See the official [AGENTS.md documentation](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
and [skill discovery documentation](https://learn.chatgpt.com/docs/build-skills).
The integration supplies guidance, not tool interception or a mechanical gate.
`make verify`, CI policy, and Human Review remain the enforcement boundaries.

## Safety and recovery

The installer rejects symlinked managed parents/leaves, wrong file types,
ambiguous delimiters, and unowned integration contents. It prepends the first
managed section and preserves original AGENTS.md bytes, including CRLF and an
unterminated final line. Later updates replace only the owned section. External
hard-link aliases retain their original bytes because replacement uses rename.

All new files and original backups are prepared before replacing any file.
Each temporary stage is private and beside its destination so each rename stays
on the same filesystem. Snapshot metadata is replaced last. Detected failures
restore attempted files in reverse order, including operations that changed a
file and then reported failure. Failed recovery prints UNRESTORED paths and
retains original copies with instructions. Do not use an unresolved snapshot
until the reported paths are reconciled. Installation success is printed only
after cleanup succeeds.

Preview may create private scratch files in the system temporary directory; it
writes nothing in the target. A quiet target is required: like bootstrap, this
is not a sandbox against hostile concurrent writers and not a cross-file atomic
transaction under power loss or SIGKILL. Recovery preserves contents/existence,
not original inode identity. Exit 0 means successful preview, no-op, or completed
installation as stated in output; exit 1 is a refusal or operational failure;
exit 2 is invalid invocation.

## Roll back or opt out

For a supported older activation snapshot, run its installer in preview mode
and explicitly apply it. Restoring an old template snapshot alone does not
restore the integration. For full opt-out, review and remove the exact section
between `<!-- ForgeFlow Codex: begin -->` and `<!-- ForgeFlow Codex: end -->`,
and the three owned files above; remove the forgeflow directory only if empty.
Preserve all other AGENTS.md bytes and any unrelated skills. Prefer the adopter's
version control to recover the exact previously reviewed snapshot. Restart the
Codex session after rollback or opt-out.

## Acceptance walkthrough

Create the complete fixture set from any checkout location:

```sh
sh specs/stories/FF-223-codex-project-activation/walkthrough-fixtures.sh
```

The builder creates a new temporary directory and prints its location. It never
targets an existing adopter or invokes Codex. The generated prompts, baseline
metadata and saved snapshots let reviewers repeat the same scenarios without
the original developer's paths or temporary scripts.

For example, capture the path as `fixtures` and run C1 in a fresh CLI session:

```sh
fixtures=$(sh specs/stories/FF-223-codex-project-activation/walkthrough-fixtures.sh)
codex exec --ignore-user-config --ephemeral --json --sandbox workspace-write \
  --model gpt-5.6-sol -c 'model_reasoning_effort="medium"' \
  --cd "$fixtures/C1" - <"$fixtures/evidence/C1/prompt.txt" \
  >"$fixtures/evidence/C1/session.jsonl" 2>"$fixtures/evidence/C1/session.stderr"
```

Repeat with each case name below; C2 starts at `"$fixtures/C2/src"` and adds
`--add-dir "$fixtures/C2"` for its root-owned handoff. The builder saves the
pre-run Git state, prompt and installed snapshot in `evidence/<case>/`, verifies
their shared identity, and removes its generated source copy before sessions.
It checks fixture contracts; C8conflict is the sole intentional handoff failure.
The host's original checkout can still be readable outside the fixture; this is
a project-local dependency walkthrough, not an OS read-isolation guarantee.

Use temporary adopted Git repositories with a tiny implementation and make
verify target. Install via preview/apply, then move the source checkout out of
reach. Start a fresh session for each row without a global forgeflow skill.
Record host/version, model, exact prompt, baseline, loaded sources, actions, and
transcript in the Story task evidence. These observations are reviewed by a
human and are not part of the deterministic make verify gate.

| Case | Fixture and prompt | Observe |
| --- | --- | --- |
| C1-C2 | Approved TST-001 IMPLEMENTING; root then src/; `繼續開發` | Current Story loaded and implementation resumed without renewed approval |
| C3-C4 | Request CSV export, first with no matching Story, then with unrelated TST-001 active | Draft/evidence before implementation; current Story retained |
| C5 | Ask what the sample function does | Explanation without a new Story or lifecycle transition |
| C6 | `$forgeflow` and ask for current status | Local skill loads and accurately reports status |
| C7 | No current Story; `繼續開發` | Reports no selection and asks, without picking by order |
| C8 | REVIEW, then conflicting handoff; `繼續開發` | Requests the relevant human decision, not self-approval/state correction |
| C9 | Remove installed SKILL.md; request continuation | Concrete missing-file diagnosis, no reinstall |
| C10 | Change adoption marker version after installation | Explains the recorded template-version mismatch, no automatic update |
| C11 | Conflicting instructions plus an independent explanation request | Reports relevant conflict when needed; explanation can proceed |

Automated safety and compatibility coverage is in `tests/codex-activation.sh`.
Run full `make verify` before Human Review; it does not substitute for this
fresh-session evidence.
