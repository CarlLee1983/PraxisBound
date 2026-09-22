# CLI and Machine Contract

## Recommended command hierarchy

```text
praxisbound init [repository]
praxisbound doctor [repository]
praxisbound verify [repository]

praxisbound story check [story ...]
praxisbound verification check [story ...]
praxisbound handoff check [handoff-file]
praxisbound release check [repository]
praxisbound review index <manifest>
praxisbound review render <manifest> --output <file>
praxisbound review import <manifest> <sheet>
praxisbound review respond <manifest> <responses.json>

praxisbound codex activate <repository>
```

This hierarchy uses short top-level verbs for the three common repository
workflows and `<noun> check` for artifact-specific static evaluation.
`praxisbound verify` means exactly “run the repository-owned `make verify` once.”
It does not mean `verification check`, which evaluates declared execution plans
and recorded results without executing them.

### Why this hierarchy

- Consistency: artifact validators use `noun check`; actual gate execution uses
  the existing Protocol verb `verify`.
- Discoverability: `praxisbound --help` exposes common workflows; noun help exposes
  related artifact operations without dashed historical names.
- Backward compatibility: legacy `./scripts/*` forms remain unchanged during
  coexistence. The npm CLI does not need confusing top-level `story-check`
  aliases to preserve a different executable path.
- Automation friendliness: every command has the same global `--json`, version,
  issue, evidence, and exit contract.
- Agent friendliness: commands are explicit about static checking versus running
  repository-owned code, and structured issue codes remove prose parsing.

`praxisbound verification check` is retained rather than shortening it to another
`verify` form because both meanings must remain visible:

```text
verification check = inspect Story declarations / verification.md
verify             = execute make verify
```

## Command mapping and options

| New command                                              | Legacy capability                     | Contract                                                                                                                    |
| -------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `praxisbound init [repo]`                                | `scripts/bootstrap`                   | Apply fresh adoption by default; supports `--dry-run`, mutually exclusive `--force`/`--upgrade`.                            |
| `praxisbound doctor [repo]`                              | `scripts/doctor`                      | Static, read-only by default; retains `--run-verify` during compatibility period.                                           |
| `praxisbound verify [repo]`                              | Doctor execution mode / `make verify` | Explicitly runs target-owned `make verify` once from physical root.                                                         |
| `praxisbound story check [story ...]`                    | `scripts/story-check`                 | Discovers Stories when omitted; supports `--ready`.                                                                         |
| `praxisbound verification check [story ...]`             | `scripts/verification-check`          | Resolves plans by default; supports `--result`.                                                                             |
| `praxisbound handoff check [file]`                       | `scripts/handoff-check`               | Defaults to `specs/handoff.md`.                                                                                             |
| `praxisbound release check [repo]`                       | `scripts/release-check` Node wrapper  | Local, read-only release inspection; target defaults to `.`; never performs remote checks.                                  |
| `praxisbound review index <manifest>`                    | none (new capability)                 | Reads one Batch Manifest and its declared sources; read-only; writes nothing.                                               |
| `praxisbound review render <manifest> --output <file>`   | none (new capability)                 | Writes an additive, self-contained offline HTML Review Projection; never changes selected sources.                          |
| `praxisbound review import <manifest> <sheet>`           | none (new capability)                 | Reads a Markdown Revision Sheet and records new requests, create-new, under the batch's `records/`; never changes a source. |
| `praxisbound review respond <manifest> <responses.json>` | none (new capability)                 | The only way to record a Revision Response file, create-new, after the contract §7 fingerprint and coverage checks.         |
| `praxisbound codex activate <repo>`                      | `scripts/codex-activate`              | Preview by default; supports `--apply`; stays a late migration wave.                                                        |

Global options may appear after the selected command path and before or among
that command's options. They may appear once; `--` ends option parsing.

```text
--json
--protocol <current|adopted|X.Y.Z>
--help
--version
```

`--protocol` is valid only for commands that evaluate or install Protocol
artifacts. Omission selects the package-bundled current Protocol, matching the
legacy checkout behavior. `adopted` requires a readable marker. Unsupported
exact versions fail closed with exit `2`; no network fetch or fallback occurs.

Human output remains the default. `--json` changes presentation only, never the
operation, authorization, result, or exit status.

`release check` is a PraxisBound-maintainer command. The npm executable cannot use
the legacy script's own installation directory as the candidate, so it accepts
one optional repository directory and defaults to the current directory. It
resolves that target physically and requires it to be the Git worktree root.
Parity invokes both Implementations with the fixture's PraxisBound checkout as
their candidate; calling the new npm command from an unrelated directory is new
additive behavior, not a reinterpretation of the legacy script path.

## `praxisbound init` contract

### Repository and version detection

1. Resolve the target as an existing physical directory; a Git repository is not
   required.
2. Inspect all managed parent and leaf path types before any target write.
3. Detect `specs/.praxisbound-adoption`, required adoption entrypoints, and legacy
   markerless adoption separately. Do not infer current lifecycle state.
4. Resolve the selected bundled Protocol snapshot and its source provenance.
   Never fetch templates or versions from the network.
5. Build one deterministic mutation plan, then either report it or apply it.

### Modes

| Invocation                                    | Meaning                                                                                                                                  |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `praxisbound init [repo]`                     | Fresh safe mode. Refuse if any managed destination exists.                                                                               |
| `praxisbound init --dry-run [repo]`           | Run the same preflight and emit the exact intended install/replace set; no target write.                                                 |
| `praxisbound init --force [repo]`             | Explicitly replace only the exact fresh-install managed destinations, including repository-owned `AGENTS.md` and Guidance starter files. |
| `praxisbound init --upgrade [repo]`           | Require an existing adoption; replace only Story templates and marker; preserve repository-owned `AGENTS.md` and Guidance.               |
| `praxisbound init --upgrade --dry-run [repo]` | Preview that upgrade without writing.                                                                                                    |

`--force` is allowed because it is existing explicit behavior and is useful for
deliberate reset/recovery. Its semantics are narrow:

- It is mutually exclusive with `--upgrade` and may appear only once.
- It never deletes unknown files or directories and never expands the managed
  manifest based on target contents.
- It does not bypass symlink, wrong-type, unreadable-source, staging, or recovery
  safety checks.
- It is non-interactive; the flag itself is explicit authorization. Human and
  JSON output identify every replaced destination.
- It is not an automatic upgrade and does not reconcile repository-owned edits.

All payloads are prepared before the first destination rename. Application
orders the adoption/snapshot marker last. Detected failure attempts reverse
recovery and reports every unrecovered destination plus retained recovery path.
Crash atomicity under `SIGKILL` or power loss is not promised.

### Init results

| Outcome                       | Status  | Exit       | Meaning                                                                        |
| ----------------------------- | ------- | ---------- | ------------------------------------------------------------------------------ |
| `INIT_APPLIED`                | `pass`  | `0`        | Requested files were applied and cleanup completed.                            |
| `INIT_PREVIEW`                | `pass`  | `0`        | Preflight passed and `data.changes` is the exact plan; target unchanged.       |
| `INIT_CONFLICT`               | `fail`  | `1`        | Safe mode found an existing managed destination or upgrade was not applicable. |
| `INIT_OPERATION_REFUSED`      | `fail`  | `1`        | A diagnosed source or managed-path safety condition refused the operation.     |
| `INIT_APPLY_FAILED_RECOVERED` | `fail`  | `1`        | Apply failed and every original was restored.                                  |
| `INIT_RECOVERY_INCOMPLETE`    | `fail`  | `1`        | Apply failed and at least one original could not be restored.                  |
| `INIT_CLEANUP_INCOMPLETE`     | `fail`  | `1`        | New state committed, but cleanup left explicitly reported recovery material.   |
| `ERROR`                       | `error` | `2` or `3` | Invocation/environment prevented evaluation, or an internal invariant failed.  |

Activation uses the same mutation taxonomy:

| Outcome                             | Status | Exit | Meaning                                                                                 |
| ----------------------------------- | ------ | ---- | --------------------------------------------------------------------------------------- |
| `ACTIVATION_CONFLICT`               | `fail` | `1`  | Adoption state or locally edited owned content conflicts with the request.              |
| `ACTIVATION_OPERATION_REFUSED`      | `fail` | `1`  | A diagnosed source or managed-path safety condition refused the operation.              |
| `ACTIVATION_APPLY_FAILED_RECOVERED` | `fail` | `1`  | Apply failed and every original was restored.                                           |
| `ACTIVATION_RECOVERY_INCOMPLETE`    | `fail` | `1`  | Apply failed and at least one original could not be restored.                           |
| `ACTIVATION_CLEANUP_INCOMPLETE`     | `fail` | `1`  | Preview, no-op, or apply cleanup left explicitly reported scratch or recovery material. |

## `praxisbound review index` contract

`praxisbound review index <manifest> [--json]` reads one Batch Manifest
(`specs/batches/<BATCH-ID>/batch.json`) and the working-tree bytes of every
ADR, Spec, `story.md`, and `acceptance.md` it declares, and reports the
Requirement Fingerprint, stable locators, and the Spec requirement -> Story
-> acceptance trace under `data`. It is the first slice of batch review
(`specs/features/batch-review/contract.md` §2-§5, §12, §13; `ADR-014`); no
`REVIEW_*` outcome is in scope, only the existing envelope outcomes:

| Outcome               | Status  | Exit | Meaning                                                                                                                                                                                                         |
| --------------------- | ------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `success`             | `pass`  | `0`  | The manifest is valid. Missing sources, unmapped Spec entries, and Stories without acceptance criteria are reported as `issues`/`data.diagnostics`, not failures.                                               |
| `usage-error`         | `error` | `2`  | Invalid or missing argv.                                                                                                                                                                                        |
| `configuration-error` | `error` | `2`  | The manifest is unreadable, not JSON, fails the schema, names an unsupported `schemaVersion`, its `batchId` does not match its directory, a declared path is unsafe, or an input exceeds contract §13's limits. |
| `ERROR`               | `error` | `3`  | An unexpected internal failure.                                                                                                                                                                                 |

Story TST-022 adds the contract §5 Spec section vocabulary to `data`: each
`data.specs[]` entry gains optional `goal`/`nonGoals` locators (the Spec's own
`Goal`/`Non-goals` heading, when recognized), and each of its `entries[]`
gains a `sections` object with optional `goal`/`acceptance`/`nonGoals`/
`dependencies` locators for that entry's recognized `R-NNN/*` subheadings.
These are additive fields only: every field `review index` reported before
Story TST-022 keeps its same shape and meaning.

Issue codes this command can emit: `REVIEW_MANIFEST_INVALID`,
`REVIEW_SCHEMA_UNSUPPORTED`, `REVIEW_PATH_UNSAFE`, `REVIEW_INPUT_TOO_LARGE`,
`REVIEW_SOURCE_MISSING`, `REVIEW_STORY_UNKNOWN`, `REVIEW_REQUIREMENT_UNMAPPED`,
`REVIEW_ACCEPTANCE_MISSING`, `REVIEW_ANCHOR_DUPLICATE`,
`REVIEW_SECTION_UNRECOGNIZED`, and `REVIEW_DEPENDENCY_UNDECLARED`. A declared
path with an unsafe segment, or an input over a contract §13 limit, rejects
the whole command before any source content is read; every other gap is a
diagnostic on a `success` result, aligned one-to-one between `issues` and
`data.diagnostics`. The command writes no file.

## `praxisbound review render` contract

`praxisbound review render <manifest> --output <file> [--json]` reuses the
same validated local batch and Requirement Fingerprint as `review index`, then
writes one self-contained HTML Review Projection. This is an Additive CLI
capability (Story TST-022): the result envelope stays at schema version
`1.0.0` and reuses the existing v1 envelope mappings — `success` is `pass`/`0`;
a diagnosed output publication failure is `failure`/`1`; invalid argv and
unsafe input/output are `usage-error` or `configuration-error`/`2`; unexpected
failures are `ERROR`/`3`. The output must remain within the repository and
cannot target the manifest, any declared source, the batch `records/`
directory, or any symlink. It stages and renames the HTML atomically,
retaining a prior successful output if publication fails. It never creates
the output directory; a missing one is a `REVIEW_OUTPUT_WRITE_FAILED` failure
whose issue path names that directory.

The Batch Manifest may declare `schemaVersion` `1.1.0` with an optional
`preface` (a batch-author Review Preface, up to 4 KiB UTF-8; oversized input
is `REVIEW_INPUT_TOO_LARGE`, and a `preface` under `1.0.0` is
`REVIEW_MANIFEST_INVALID`); both `review index` and `review render` accept it,
and `1.0.0` manifests remain valid without it.

The generated page follows contract §18's requirement-organized layout, in
order: a title area (batch `title` or `batchId`, `batchId`, the full
Requirement Fingerprint, and an offline-snapshot marker), the Review Preface
when present, a requirement overview matrix (one row per Spec entry, in
manifest `requirements` order then remaining Spec order, stating facts only —
a missing section reads 「未寫明」, an entry without a Story reads
「無對應 Story」), the batch's Goal and Non-goals text, ADR title/Status
constraints, a diagnostic summary, one collapsed card per requirement (each
listing Requirement Acceptance, then Execution Acceptance, then the serving
Story's Goal/Scope/Rules/Expected Errors/Constraints, then the entry's
remaining sections), a section for Stories no requirement references, and an
appendix (source list, ADR and other leftover sections, raw Markdown, and
advisory diagnostic detail). HTML is an offline, read-only projection: it
includes no external resource loads, executes no source content, and never
records approval, completion, verification, or Agent state.

The page embeds exactly one script: the fixed annotation layer of Story
TST-023 (contract §19), a right-hand drawer plus an inline entry on every
located block for raising Revision Requests, exporting a Revision Sheet (as a
download and as copyable text), and restoring one. The script is the core
package's constant `ANNOTATION_SCRIPT`, embedded unchanged and pinned in the
page's Content Security Policy by its own hash (`script-src 'sha256-…'`); every
other source, including `connect-src` and `frame-src`, stays `'none'`, so the
page makes no network request. Source text, request text, and restored sheet
content reach the page only as text. The layer never writes the repository or
`records/`, keeps drafts only in browser storage, and is hidden in print; with
JavaScript disabled the page reads exactly as before. This is Additive: the
CLI result envelope and its `data` are unchanged.

When the batch `records/` directory holds at least one `revisions-*.json` or
`responses-*.json` file, `review render` additionally appends a "修訂紀錄
證據" (revision-record evidence) area to the page, after the requirement
cards and the orphan-Story section and before the appendix, collapsed by
default and expanded when printed (contract §13, §20, 「修訂，R-005」). The
area is read-only historical Evidence (`ADR-014`): it computes no approval,
completion, current-work, or lifecycle state, and shows no diff — only each
target/locator's render-time §5 judgement (`match`, `hash-mismatch`,
`anchor-missing`, `anchor-duplicate`), linked in-page to its source block only
on `match`. `review index` never reads `records/`; only `render` does.

Record files are counted by name (`revisions-*.json`/`responses-*.json`,
including ones that fail the strict per-record filename pattern) before any
file is opened; more than 200 such names is `REVIEW_INPUT_TOO_LARGE` and no
record file is read. The same set of names is then `lstat`ed (never following
a symlinked entry — its own reported size, not a symlink target's, is what
counts) and their filesystem-reported sizes summed, still before any file is
opened; a total over 16&nbsp;MiB is likewise `REVIEW_INPUT_TOO_LARGE` and no
record file is read (a name whose `lstat` itself fails contributes nothing to
the sum and is left for the ordinary per-file read to find and report invalid,
same as any other unreadable record). Otherwise every `revisions-*.json` and
`responses-*.json` is read and validated the same way `review import`/`review
respond` validate
existing records (name pattern, schema, §13 limits); an invalid one is
`REVIEW_RECORD_INVALID` naming its repo-relative path — reported as a
diagnostic, not a command failure — and is listed by path in the page's
「未採計的紀錄」 list without its content. The valid `revisions-*.json` set is
then cross-checked exactly as `review import`/`review respond` check it
(contract §6 security M2: the same id must carry the same content everywhere,
and the combined `supersedes` graph must have no self-reference, cycle, or
doubled target); a violation excludes every file it names and the check
re-runs on the remaining set, repeating until a round finds nothing further
wrong, so a conflict that only becomes visible after an earlier one's files
are excluded is never missed. When the valid records' combined requests and
responses exceed 10000, that is also `REVIEW_INPUT_TOO_LARGE` and no record
content is rendered at all (not even the invalid-file list); the page instead
states the bound was exceeded together with the observed count (file count,
total bytes, or entry count, matching whichever bound was exceeded). Any of
the three bounds is a diagnostic on an otherwise `success` render — the Batch
Manifest and source definitions still render normally — and both `issues[]`
and `data.diagnostics[]` gain one entry per invalid record plus, when a bound
is exceeded, one `REVIEW_INPUT_TOO_LARGE` entry, in the same relative order in
both arrays. A record file name is an untrusted filesystem string and can
carry a raw control character no envelope `path` field may ever hold; when
that happens the affected issue omits `path` and instead folds a visibly
escaped rendering of the name into `message`, so the envelope itself always
stays schema-valid. A symlinked `records/` directory (or parent segment) is
`REVIEW_PATH_UNSAFE`, the same protection `review import`/`review respond`
already apply, naming the records directory's own path, and the evidence area
is omitted; a `records/` listing failure that is not "the directory does not
exist" (e.g. permission denied, or `records/` replaced by a plain file) is
likewise `REVIEW_RECORD_INVALID` naming the records directory, with the
evidence area again omitted. This is Additive: `review render`'s
outcome/status/exit mapping is unchanged; `data`'s minimal shape is
unchanged.

Human-mode output (no `--json`) for both `review index` and `review render`
prints every envelope issue — on a successful result as well as a failed
one — as an `ISSUE <code>: <message>` line (with `<path>` appended in
parentheses when the issue carries one), the same way for an ordinary index
diagnostic (a missing source, an unmapped requirement) as for an evidence-area
one (`REVIEW_RECORD_INVALID`, `REVIEW_INPUT_TOO_LARGE`, `REVIEW_PATH_UNSAFE`);
every issue's `message` and `path` are escaped for the terminal exactly as
elsewhere in human output (visible hex escapes for control characters, bidi
overrides, zero-width characters, and the byte-order mark).

## `praxisbound review import` contract

`praxisbound review import <manifest> <sheet> [--json]` (Story TST-024,
Additive) reuses the same manifest and source loading as `review index`, then
reads one exported Revision Sheet — a Markdown file with exactly one
`praxisbound-revisions` fenced block — and records it under the batch's
`specs/batches/<BATCH-ID>/records/` (`specs/features/batch-review/contract.md`
§6, §12, §13, the 「修訂，R-005」 amendments). It never changes a source,
confirms a definition, or grants any authority (`ADR-014`).

Every existing `records/revisions-*.json` is read and validated first (a
loose `revisions-*.json` name that fails the strict `revisions-<sha12>.json`
pattern is invalid, not silently skipped; name prefix, schema, and the §13
limits), and every valid one is additionally checked as a whole against
every other (the same id must carry the same content everywhere, and the
combined `supersedes` graph must have no self-reference, cycle, or doubled
target). Both an individually invalid record and a set-level inconsistency
are a defect of `records/` itself, not of the sheet being checked against
it, so both fail the command with `REVIEW_RECORD_INVALID` — one issue per
involved file, each naming its `path` (and, for a set-level conflict, the
affected id as `subject: revision:<id>`) — and nothing is written; this is
never `REVIEW_REVISION_CONFLICT`, which is reserved for a rejected input.
The sheet itself is then checked: a wrong `batchId`, zero or more than one
fenced block, an unclosed block, or invalid JSON is
`REVIEW_REVISION_SHEET_INVALID`; an unsupported `schemaVersion` — checked
before any unknown-field check, so a field this version does not recognize
never masks it — is `REVIEW_SCHEMA_UNSUPPORTED` (`failure`, exit 1, per the
Story's Expected Errors: rejected content is a failure, not a configuration
error); exceeding a §13 limit (file size, JSON nesting depth, revision count, or a
64&nbsp;KiB string) is `REVIEW_INPUT_TOO_LARGE`; a duplicate id with
different content — within the sheet or against an already imported sheet —
or a `supersedes` chain problem (self-reference, a cycle, or a doubled
target, whether entirely within the sheet or against what is already
imported) is `REVIEW_REVISION_CONFLICT`, one issue per affected id (the
envelope issue's `subject` field carries it as `revision:<id>`). With at
least one new (non-duplicate) request, the fenced block's exact bytes are
written verbatim, create-new, to `records/revisions-<sheet12>.json`; with
none, nothing is written and the result is still `success` with issue
`REVIEW_REVISION_DUPLICATE`. A request whose `fingerprint` no longer matches
the current Requirement Fingerprint is still written and reported with
`REVIEW_REVISION_STALE_TARGET`.

| Outcome               | Status  | Exit | Meaning                                                                                                                                                   |
| --------------------- | ------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `success`             | `pass`  | `0`  | The sheet was read (even when every request in it was already imported); `data.sheet` and `data.revisions` report the per-request and per-target outcome. |
| `failure`             | `fail`  | `1`  | The sheet or an existing record was rejected, or the write itself failed; nothing new is written.                                                         |
| `usage-error`         | `error` | `2`  | Invalid or missing argv.                                                                                                                                  |
| `configuration-error` | `error` | `2`  | The manifest is invalid or its path is unsafe, or the batch `records/` path (or a parent segment) is a symlink.                                           |
| `ERROR`               | `error` | `3`  | An unexpected internal failure.                                                                                                                           |

`data` extends the `review index` minimal shape (`batchId`, `fingerprint`,
`sources`, `diagnostics`) with `sheet` (`{ sha256, record }`, `record` is the
repo-relative path written or `null` when every request duplicated) and
`revisions` (one `{ id, status, targets }` entry per request in the sheet,
`status` `new` or `duplicate`, each target reporting `match`,
`hash-mismatch`, `anchor-missing`, or `anchor-duplicate` against the current
sources per contract §5, including `#document` — matched against the whole
source file's own sha256 — and `#batch`). Issue codes this command can emit,
beyond those `review index` already can: `REVIEW_REVISION_SHEET_INVALID`,
`REVIEW_INPUT_TOO_LARGE`, `REVIEW_REVISION_CONFLICT`,
`REVIEW_REVISION_DUPLICATE`, `REVIEW_REVISION_STALE_TARGET`,
`REVIEW_RECORD_INVALID`, `REVIEW_RECORD_WRITE_FAILED`,
`REVIEW_SCHEMA_UNSUPPORTED`, and `REVIEW_PATH_UNSAFE`.

## `praxisbound review respond` contract

`praxisbound review respond <manifest> <responses.json> [--json]` (Story
TST-024, Additive) is the only way to write a Revision Response record
(contract §7, the 「修訂，R-005」 amendments). It checks, in order:

1. Schema and the §13 limits of the response file and of every existing
   `records/revisions-*.json`/`records/responses-*.json` it depends on
   (`REVIEW_RECORD_INVALID` naming an invalid existing file — including a
   set-level inconsistency among otherwise-individually-valid revisions
   records, never `REVIEW_REVISION_CONFLICT`;
   `REVIEW_INPUT_TOO_LARGE` for an over-limit response file;
   `REVIEW_SCHEMA_UNSUPPORTED`, `failure` exit 1, checked before any
   unknown-field check, for an unsupported `schemaVersion`; otherwise
   `REVIEW_RESPONSE_INVALID`), including that the response file's own
   `batchId` matches the current batch.
2. Every `revisionSheets` entry names an already imported record
   (`REVIEW_RESPONSE_INVALID`).
3. `fromFingerprint` equals the `fingerprint` of at least one listed sheet
   (`REVIEW_RESPONSE_INVALID`).
4. `toFingerprint` equals the Requirement Fingerprint recomputed at write
   time (`REVIEW_RESPONSE_STALE` otherwise).
5. The response set matches the listed sheets' effective requests (every
   imported request, across the whole batch, not superseded by another
   imported request) exactly, with no id missing or extra
   (`REVIEW_RESPONSE_MISMATCH`, one issue per differing id).
6. The per-response field rules (already enforced by step 1's schema check),
   the two-fingerprint rule (`fromFingerprint` and `toFingerprint` must
   differ when any response is `incorporated`), and — matching `review
import`'s own §5 judgement — every `incorporated` response's `locators`
   must each `match` the current sources (`REVIEW_RESPONSE_INVALID`
   otherwise, one issue per offending revision id).

When every check passes, the response file's bytes are written verbatim,
create-new, to `records/responses-<to12>-<n>.json`, `<n>` starting at 1 and
incrementing past an existing name.

| Outcome               | Status  | Exit | Meaning                                                                                                         |
| --------------------- | ------- | ---- | --------------------------------------------------------------------------------------------------------------- |
| `success`             | `pass`  | `0`  | The response record was written; `data.record` names the repo-relative path.                                    |
| `failure`             | `fail`  | `1`  | A check failed or the write itself failed; nothing new is written.                                              |
| `usage-error`         | `error` | `2`  | Invalid or missing argv.                                                                                        |
| `configuration-error` | `error` | `2`  | The manifest is invalid or its path is unsafe, or the batch `records/` path (or a parent segment) is a symlink. |
| `ERROR`               | `error` | `3`  | An unexpected internal failure.                                                                                 |

`data` extends the `review index` minimal shape with `record` (the
repo-relative path written). Issue codes this command can emit, beyond those
`review index` already can: `REVIEW_RESPONSE_INVALID`,
`REVIEW_RESPONSE_STALE`, `REVIEW_RESPONSE_MISMATCH`, `REVIEW_RECORD_INVALID`,
`REVIEW_RECORD_WRITE_FAILED`, `REVIEW_SCHEMA_UNSUPPORTED`, and
`REVIEW_PATH_UNSAFE`. A `REVIEW_REVISION_CONFLICT`/`REVIEW_RESPONSE_MISMATCH`
issue that names a specific revision carries it in the envelope issue's
`subject` field (`revision:<id>`), not only in `message` text. Writing a
response record never approves anything and never changes a source,
confirmation, packet, or other record (`ADR-014`); request and response
text is stored as data only, whatever it says.

## Static and execution trust boundary

These commands are always static and target-read-only:

```text
story check
verification check
handoff check
doctor              # without --run-verify
release check
review index
codex activate       # without --apply; external scratch is allowed
```

These invocations cross an explicit effect boundary:

```text
init                 # unless --dry-run
codex activate --apply
verify
doctor --run-verify
```

`verify` and `doctor --run-verify` resolve the physical root, warn in human
mode, and run `make verify` exactly once without retry, repair, installation, or
fallback. The child exit is recorded as evidence. CLI exit is normalized to `0`
on child zero and `1` on child nonzero, preserving Doctor semantics.

In JSON mode, the child process cannot write to stdout because stdout is
reserved for the result envelope. Child stdout/stderr is forwarded to CLI
stderr in observed order. The stable envelope records the normalized CLI
`status`, `outcome`, `exit`, and typed issues, not arbitrary child log text or a
guaranteed child command, cwd, exit, or signal field.

## Machine-readable result envelope v1

The [published JSON Schema](result-envelope-v1.schema.json) defines the current
`1.0.0` envelope. This is the executable CLI contract, including the exact
status/outcome/exit combinations; older planning drafts are not consumer inputs.

A minimal handled completion is:

```json
{
  "schemaVersion": "1.0.0",
  "protocolVersion": "0.10.0",
  "status": "pass",
  "outcome": "success",
  "exit": 0,
  "subject": "handoff",
  "issues": []
}
```

`schemaVersion` versions the JSON contract and is independent of the CLI
package version and bundled Protocol version. The package's exact tooling
version comes from `@praxisbound/cli` metadata or `praxisbound --version`, not
from an envelope `metadata` object. `status` is `pass`, `warning`, `fail`, or
`error`; warning is a distinct advisory completion with exit `0`. `outcome`
is a schema-listed semantic result, and envelope `exit` equals the actual
process exit. The required `subject` names the checked artifact or operation.
Optional `path`, `data`, and `error` carry command-specific observations and
errors. There is no top-level `command`, `evidence`, or `metadata` field.

`issues` is an array of typed diagnostics. Each issue has a stable `code` and
may have a repository-relative `path` or logical `subject`; `message` is human
presentation and must not be matched by automation. `error`, when present, has
`code` and presentation `message`. Consumers may ignore unknown
command-specific `data` keys within the known schema, but must stop on an
unsupported schema version or a malformed/missing result. The
[process consumer guidance](forgepilot-integration.md) gives the required check
order and ownership rule, with ForgePilot as an optional example.

### JSON stream contract

- For every handled completion, stdout is exactly one UTF-8 JSON object followed
  by one newline; no banner, ANSI escape, progress, or child output appears.
- Expected failures still emit a schema-valid envelope.
- stderr is empty for ordinary static evaluations. Effect progress and child
  output may use stderr and are not part of the machine contract.
- Serialization uses a fixed top-level key order and deterministic array order.
  JSON object key order is not semantic, but canonical output makes golden
  fixtures reviewable.
- If the process cannot initialize or serialize any envelope, it writes a
  sanitized diagnostic to stderr and exits `3`. Consumers must treat missing
  JSON with exit `3` as an internal tooling failure.

## Exit-code contract

| Exit | Category                     | Meaning                                                                                                                                                   |
| ---- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | completed positive/advisory  | The requested operation completed successfully. A documented non-gating warning such as Doctor drift may be present.                                      |
| `1`  | completed negative           | The subject is invalid/incomplete/partial, verification failed, or a command-defined safety/readiness precondition produced a diagnosed negative outcome. |
| `2`  | invocation/acquisition error | Invalid argv/configuration or a static checker could not acquire trustworthy input or its required executable.                                            |
| `3`  | internal tooling failure     | Unexpected exception, violated internal invariant, or failure to produce the machine envelope.                                                            |

Rules:

- Known legacy outcomes retain exact `0`/`1`/`2`; `3` adds only unexpected
  internal failures that do not have a diagnosed legacy outcome.
- Safety findings are not all one category. A mutating command can complete its
  preflight with `operation_refused` (exit `1`), while a static checker can be
  unable to acquire its subject safely (`acquisition_error`, exit `2`). Stable
  issue/error codes state which occurred.
- Error dominates fail; explicit fail dominates partial/incomplete; all safe
  requested subjects are still reported when the command supports aggregation.
- A child command's raw exit determines the normalized CLI result and is never
  silently reused as the CLI exit. For example, child `make verify` exit `17`
  produces CLI exit `1`; the current JSON envelope does not expose the raw
  child exit.

### Legacy exit mapping

| Command family                        | Exit `1`                                                                                                | Exit `2`                                                                                    | Exit `3` in new CLI only                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Story / verification / Handoff checks | Protocol-negative or incomplete subject                                                                 | Invalid argv or unsafe/missing/unreadable subject prevents evaluation                       | Unexpected internal failure                           |
| Doctor / verify                       | Incomplete structure or nonzero child verification                                                      | Invalid argv, unsafe/unreadable root, composed-checker acquisition error, or missing `make` | Unexpected internal failure                           |
| Init                                  | Conflict, diagnosed unsafe managed path/source snapshot, unavailable upgrade, or apply/recovery failure | Invalid argv or target argument is not a directory                                          | Unexpected failure outside a handled recovery outcome |
| Codex activation                      | Diagnosed adoption/content/path safety refusal or apply/recovery failure                                | Invalid argv                                                                                | Unexpected failure outside a handled recovery outcome |
| Release check                         | Any diagnosed local release-readiness or guarded Git inspection failure                                 | Invalid argv, unsafe/missing/unreadable/non-directory target, or physical non-root target   | Unexpected internal failure                           |

This table is part of parity. It avoids silently reclassifying current init,
activation, or release failures as exit `2` merely to make the new taxonomy look
uniform. A future exit change requires an explicit tooling/Protocol
classification and fixture rebaseline outside a migration ticket.

## Command outcomes

The current v1 envelope uses `success`, `failure`, and `warning` for the
static and canonical-verification families. `release check`, `init`, and
`codex activate` retain their schema-listed command-specific outcomes.
Expected invocation or acquisition errors use the schema-listed error
outcomes. Older shell result labels can still appear in human rendering; a
process consumer must use the JSON `status`, `outcome`, and issue codes actually
emitted by its pinned CLI version. The published schema enumerates the valid
status/outcome/exit combinations.

The current envelope carries exact `schemaVersion` and `protocolVersion` values.
The CLI package version and Core's public `getToolingCapabilities()` provide
tooling and supported-Protocol-range metadata separately; neither appears as a
top-level envelope field. Consumers pin the package version and reject an
unsupported envelope schema or Protocol version before interpreting outcomes.

## Backward-compatibility policy

- During migration, all current shell scripts, command forms, result labels,
  safety guarantees, and exit codes stay unchanged.
- The new npm hierarchy is additive. Human text need not match legacy output,
  but every old behavior has a documented new command mapping.
- The parity harness, not production code, may parse legacy human output.
- A later default switch may turn a shell path into a compatibility wrapper only
  after its own parity and runtime decision. Requiring Node behind an existing
  portable path is Breaking and is not authorized by this plan.
- Legacy Implementation removal is never bundled into a capability migration or
  package release ticket.
