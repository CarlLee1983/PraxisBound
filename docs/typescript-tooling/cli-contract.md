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
praxisbound review confirm <manifest>
praxisbound review preflight <manifest>

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

| New command                                              | Legacy capability                     | Contract                                                                                                                                                             |
| -------------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `praxisbound init [repo]`                                | `scripts/bootstrap`                   | Apply fresh adoption by default; supports `--dry-run`, mutually exclusive `--force`/`--upgrade`.                                                                     |
| `praxisbound doctor [repo]`                              | `scripts/doctor`                      | Static, read-only by default; retains `--run-verify` during compatibility period.                                                                                    |
| `praxisbound verify [repo]`                              | Doctor execution mode / `make verify` | Explicitly runs target-owned `make verify` once from physical root.                                                                                                  |
| `praxisbound story check [story ...]`                    | `scripts/story-check`                 | Discovers Stories when omitted; supports `--ready`.                                                                                                                  |
| `praxisbound verification check [story ...]`             | `scripts/verification-check`          | Resolves plans by default; supports `--result`.                                                                                                                      |
| `praxisbound handoff check [file]`                       | `scripts/handoff-check`               | Defaults to `specs/handoff.md`.                                                                                                                                      |
| `praxisbound release check [repo]`                       | `scripts/release-check` Node wrapper  | Local, read-only release inspection; target defaults to `.`; never performs remote checks.                                                                           |
| `praxisbound review index <manifest>`                    | none (new capability)                 | Reads one Batch Manifest and its declared sources; read-only; writes nothing.                                                                                        |
| `praxisbound review render <manifest> --output <file>`   | none (new capability)                 | Writes an additive, self-contained offline HTML Review Projection; never changes selected sources.                                                                   |
| `praxisbound review import <manifest> <sheet>`           | none (new capability)                 | Reads a Markdown Revision Sheet and records new requests, create-new, under the batch's `records/`; never changes a source.                                          |
| `praxisbound review respond <manifest> <responses.json>` | none (new capability)                 | The only way to record a Revision Response file, create-new, after the contract §7 fingerprint and coverage checks.                                                  |
| `praxisbound review confirm <manifest>`                  | none (new capability)                 | The only way to record a Definition Confirmation, create-new, through an interactive terminal act (contract §8).                                                     |
| `praxisbound review preflight <manifest>`                | none (new capability)                 | Evaluates every contract §9 check — mechanical (including git, `ADR-015`) and the Semantic Report's own — and writes one Preflight Report (Stories TST-027/TST-028). |
| `praxisbound review readiness-digests <manifest>`        | none (new capability)                 | Rewrites only the `story_md_digest`/`acceptance_md_digest` fields of every batch Story's existing `readiness.json` whose digests are stale; creates none (contract §21, Story TST-030). |
| `praxisbound review goal-plan <manifest> --semantic-report <file>` | none (new capability)       | Projects `declaration.json`/`manifest.json`/`coverage-review.json` under `specs/batches/<BATCH-ID>/goal-plan/<plan.id>/` on `REVIEW_READY`; replaces the unimplemented `review packet` (contract §10, Story TST-031). |
| `praxisbound review observe <manifest> <observation.json>` | none (new capability)      | Validates one Agent observation of a contract §11 ForgePilot handoff segment and, only when internally consistent, records it create-new under `records/forgepilot-<fp12>-<n>.json` (contract §22, Story TST-032). |
| `praxisbound codex activate <repo>`                      | `scripts/codex-activate`              | Preview by default; supports `--apply`; stays a late migration wave.                                                                                                 |

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

Story TST-030 adds each batch Story's `<story>/readiness.json` Readiness
Sidecar (contract §21, `ADR-016`) as a source, only when the file is present:
a present Sidecar joins `data.sources` and the Requirement Fingerprint; an
absent one (`ENOENT`) contributes nothing and is never `REVIEW_SOURCE_MISSING`
(adding or removing one still changes the fingerprint). A symlinked
`readiness.json` is `REVIEW_PATH_UNSAFE`, checked the same way as any other
declared path. Unlike every other declared source, a Readiness Sidecar is
exempt from the generic 4 MiB per-source cap: `review index`/`review render`
stay `success` for an otherwise valid manifest (contract §12) regardless of
its size. Its size is checked via `fstat` on the already-safely-opened
handle *before* any content is read (code review round 2 HIGH-1): at or
under the contract-mandated 1 MiB Sidecar bound (§13/§21), it is read and
hashed normally (`sha256Hex` of the bytes); over that bound, its bytes are
never loaded into memory at all — only streamed through a hash — so a
Sidecar of any size, however large, can never make `review index`/`review
render` allocate memory proportional to it. That streamed digest still
covers it in the fingerprint (observation kind `oversized`), and `review
render` shows only a fixed size notice in its place, never any content.
A Sidecar that exists but could not be read (permission denied or similar —
distinct from genuinely absent) is not absent either: it still joins
`data.sources` with `sha256: null` and a `REVIEW_SOURCE_MISSING` diagnostic
worded to say it could not be read, mirroring how any other missing/
unreadable declared source is handled (contract §4) but distinguishing the
two conditions in the message, so it still blocks `confirm`/`goal-plan`. A
batch whose Stories carry no Sidecar produces the exact same `data.sources`,
fingerprint, and diagnostics as before Story TST-030 (no new fields on
`data.stories[]` entries either — they are omitted entirely, not merely
falsy, when there is no Sidecar).

A Sidecar's raw JSON text is scanned for duplicate object keys and
pathological nesting *before* it is ever handed to `JSON.parse` (code review
round 2 HIGH-2, `packages/core/src/review/json-safety.ts`'s `scanJsonSafety`,
ported from `goal-plan-artifacts.ts`): `JSON.parse` itself remains the
parser, so an authored `"__proto__"` key becomes an ordinary own property —
rejected as an unknown field by the schema check — never a route to
repointing the parsed object's prototype, which a hand-written parser that
assigns via `obj[key] = value` would allow.

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

A present Readiness Sidecar (Story TST-030, contract §21) is shown with its
Story: its exact bytes, decoded and escaped as plain text with the same
`escapeEvidenceProse`/`escapeEvidenceField` helpers the evidence area uses
(`render-evidence.ts`) — HTML metacharacters as entities, and every hidden or
bidi-reordering code point (`isHiddenOrReorderingCodePoint`) as a visible hex
escape — never parsed as Markdown or re-serialized, so the projection shows
precisely the bytes the fingerprint covers, with no raw control or override
character reaching the page. `authorized: true`, an instruction, an ESC
sequence, or a bidi character inside it is data — it renders as escaped text
and never changes any outcome. `#document` (contract §5 rule 3), matched
against the Sidecar's whole-file digest already in `data.sources`, lets a
Revision Request target it without any extra Locator bookkeeping. An
`oversized` Sidecar (over the 1 MiB bound — see `review index` above) shows
only a fixed notice naming its path, never any content, since its bytes were
never read. This Story card is the *only* place a Sidecar's content is ever
shown: the appendix's raw-source dump (「原始 Markdown（不列印）」) excludes
every Readiness Sidecar path, both to avoid printing its content a second
time and because that generic dump's plain HTML-escaping does not also guard
against a hidden/bidi code point (code review round 2 HIGH-1/MEDIUM-1).

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

`review render` also reports Definition Confirmation applicability and
staleness (contract §8, 「修訂，R-006」), always advisory and only on `render`
— `review index` never reads `records/`. One shared `records/` safety check
and one shared directory listing serve both this loader and the evidence
area's (review round 1): a symlinked or unlistable `records/` produces
exactly one `REVIEW_PATH_UNSAFE`/`REVIEW_RECORD_INVALID` issue, not one per
reader. `records/confirmation-*.json` is then counted by name, then
`lstat`-summed by size (never following a symlinked entry), both before any
content is read, using its own separate 200-file/16 MiB bound
(`REVIEW_INPUT_TOO_LARGE`), distinct from the evidence area's
`revisions-`/`responses-` bound; an invalid confirmation record —
including one whose `fingerprint` does not match the contract §4 digest
recomputed from its own `manifestSha256` and `sources` — is
`REVIEW_RECORD_INVALID` naming its path, always blocking, and is neither
applicable nor a comparison baseline; a lone invalid record never displaces
an otherwise-valid one as the baseline. Applicability holds when a valid
confirmation's `fingerprint` equals the current Requirement Fingerprint. When
none applies and at least one valid confirmation exists, the current sources
are compared against the valid confirmation with the latest canonical
`confirmedAt` (ties broken by the later file name in UTF-8 byte order), and
one advisory issue is emitted per added (`REVIEW_SOURCE_ADDED`), removed
(`REVIEW_SOURCE_REMOVED`), or changed (`REVIEW_SOURCE_CHANGED`) source, plus
`REVIEW_MANIFEST_CHANGED` when the manifest itself changed — never emitted
when zero valid confirmations exist at all. The page's title area states one
of three things in Traditional Chinese prose: a confirmation is bound to the
current fingerprint; no confirmation is bound and the changed/added/removed
sources (and manifest change) are listed, each next to the prior
confirmation's `confirmedAt` — a source currently missing (`sha256: null`)
reads 「缺失」 there rather than 「內容變動」, though the envelope still
reports it under the same `REVIEW_SOURCE_CHANGED` issue code; or nothing at
all when no valid confirmation record exists. Every added or changed source
gets a 「需複審」 text badge beside its source-path label everywhere that
label is rendered — the batch Goal/Non-goals doc-group, every requirement
card's own source blocks (需求驗收/需求細節 next to the Spec entry's path,
each Story's 執行驗收/Story 重點 next to its own `acceptance.md`/`story.md`
path), the 未對應需求的 Story section, and the appendix's ADR/leftover-section
summaries and source list (review round 1: every card source block now
carries a visible `.doc-path` label per contract §18, where previously only
the appendix and Goal/Non-goals sections did — an Additive content change to
every rendered page, not only ones with a confirmation). A removed source or
a manifest change is named only in the title-area list, never as a badge
(nothing in the current page corresponds to a removed source). A
confirmation is a human claim, not identity verification, Execution
Authorization, or completion (`ADR-014`); the header text states this
explicitly. This is Additive: `review render`'s
outcome/status/exit mapping and `data`'s minimal shape are unchanged (the new
diagnostics use the same `issues[]`/`data.diagnostics[]` shape every other
advisory/blocking diagnostic already uses).

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

## `praxisbound review confirm` contract

`praxisbound review confirm <manifest> [--json]` (Story TST-026, Additive) is
the only way to write a Definition Confirmation record (contract §8, the
「修訂，R-006」 amendments). No `--yes` flag, environment variable, piped
input, or file input can produce one: both stdin and stdout must be an
interactive terminal, checked before any manifest or filesystem access
(`REVIEW_CONFIRM_REQUIRES_TTY`, `usage-error`, exit 2). Automated tests drive
every prompt through an injected terminal adapter (Story R9(a)); the real
interactive path uses `node:readline`. Prompts and messages go to stderr
only; stdout still carries exactly one JSON envelope in `--json` mode.

It checks, in order:

1. The Requirement Fingerprint is recomputed from the current working tree.
   A missing declared source is `REVIEW_SOURCE_MISSING` (`failure`, exit 1) —
   a fingerprint over a missing source can never back a confirmation (§4).
2. Every existing `records/revisions-*.json` and `records/responses-*.json`
   is read and validated exactly as `review respond` validates them
   (name pattern, schema, §13 limits, and the cross-record §6 security M2
   check); any invalid one is `REVIEW_RECORD_INVALID`, `failure`, listing
   its path, and nothing is written. Unlike `review render`, `confirm` never
   scans the wider `records/confirmation-*.json` collection at this point —
   contract §8 lists no refusal driven by another confirmation file, so an
   unrelated invalid or numerous confirmation collection never blocks
   `confirm` (review round 1); the 200-file/16 MiB confirmation-file bound
   belongs to `review render`'s advisory staleness diagnostics only.
3. Every effective request (§6, across all imported sheets) that is not
   resolved by an `incorporated` response bound to the current fingerprint
   (§7) and is `blocking` refuses the whole command:
   `REVIEW_UNRESOLVED_BLOCKING`, `failure`, one issue per request id
   (`subject: revision:<id>`), nothing written.
4. The remaining unresolved non-blocking requests are displayed one at a
   time (id, target locator(s), quote, proposal, rationale — every field
   visibly escaping control/bidi/zero-width characters and the byte-order
   mark, the same primitive the Review Projection's evidence area uses),
   after a reminder to compare the shown fingerprint against the HTML page
   header and, when a previous valid confirmation exists but does not apply,
   the same changed/added/removed source list `review render` would show.
   Each must be answered `defer` plus a typed reason; an oversized reason
   (over the §13 64 KiB string bound) or one containing a hidden or
   reordering character (control, bidi, zero-width, or the byte-order mark)
   is rejected and re-asked rather than silently accepted. Any other `defer`
   answer, or EOF at any prompt, aborts: `REVIEW_CONFIRM_ABORTED`, `failure`,
   nothing written.
5. The human types the fingerprint's first 8 characters; a mismatch or EOF
   aborts the same way (`REVIEW_CONFIRM_ABORTED`).
6. The record — `claim` (`explicit-terminal-confirmation`), `batchId`,
   `fingerprint`, `manifestSha256`, the full `sources`, `confirmedAt` (UTC),
   `deferred`, and `revisionSheets` (every valid imported revisions record's
   own sha256, sorted by UTF-8 byte order) — is built and re-validated
   (schema, §13 limits, and the recomputed §4 fingerprint) before any write
   is attempted; a validation failure is `REVIEW_CONFIRM_ABORTED`, and a
   serialized size over the §13 1 MiB record bound is `REVIEW_INPUT_TOO_LARGE`
   (both `failure`, nothing written — this should be unreachable in normal
   operation, since the interactive prompt already rejects the one field a
   human controls before this point, but is never trusted blindly).
7. One exclusive create-new write is attempted to
   `records/confirmation-<fp12>.json` (`fp12` = the current fingerprint's
   first 12 hex characters). A genuine write failure (including an injected
   one) leaves no file at all: `REVIEW_RECORD_WRITE_FAILED`, `failure`. Only
   when the write collides with a file that already exists at that exact
   name is that one target — and only that one target, never the wider
   collection — read back: the same `fingerprint` in its content is
   `success` with `REVIEW_CONFIRMATION_EXISTS` (nothing written; any
   deferral reasons just typed are discarded, never merged into the stored
   record); a different `fingerprint`, or content that fails validation
   outright, is `REVIEW_RECORD_COLLISION` (`failure`, nothing written).

| Outcome               | Status  | Exit | Meaning                                                                                                         |
| --------------------- | ------- | ---- | --------------------------------------------------------------------------------------------------------------- |
| `success`             | `pass`  | `0`  | A confirmation was written, or one already existed for this fingerprint with the same content.                  |
| `failure`             | `fail`  | `1`  | A check failed, the human aborted, or the write itself failed; nothing new is written.                          |
| `usage-error`         | `error` | `2`  | Invalid or missing argv, or stdin/stdout is not an interactive terminal (`REVIEW_CONFIRM_REQUIRES_TTY`).        |
| `configuration-error` | `error` | `2`  | The manifest is invalid or its path is unsafe, or the batch `records/` path (or a parent segment) is a symlink. |
| `ERROR`               | `error` | `3`  | An unexpected internal failure.                                                                                 |

`data` extends the `review index` minimal shape with `record` (the
repo-relative path of the confirmation used or written) and `deferred` (the
`{ revisionId, reason }` list recorded, or read back from an existing
`REVIEW_CONFIRMATION_EXISTS` record). Issue codes this command can emit,
beyond those `review index` already can: `REVIEW_SOURCE_MISSING`,
`REVIEW_UNRESOLVED_BLOCKING`, `REVIEW_CONFIRM_ABORTED`,
`REVIEW_CONFIRM_REQUIRES_TTY`, `REVIEW_CONFIRMATION_EXISTS`,
`REVIEW_RECORD_COLLISION`, `REVIEW_RECORD_INVALID`, `REVIEW_INPUT_TOO_LARGE`,
`REVIEW_RECORD_WRITE_FAILED`, and `REVIEW_PATH_UNSAFE`. A confirmation
record carries no identity, signature, or lifecycle field, grants no modify,
commit, push, deploy, or execution authority, and writes no Story, handoff,
Gate, review, DONE, or Work Item state (`ADR-014`, Story R7); a forged
`authorized: true`, `approved`, or `confirmed` string anywhere in a source or
existing record never creates or implies a confirmation, and never appears
in this command's own output as a claim of authorization or completion.

## `praxisbound review preflight` contract

`praxisbound review preflight <manifest> [--semantic-report <file>]
[--expect-fingerprint <sha256>] [--expect-revision <commit>] [--json]` (Story
TST-027/TST-028, extended by Story TST-032 for independent `--expect-*`,
Additive) evaluates every contract §9 check — mechanical and
the Semantic Report's own — writes one Preflight Report
(`records/preflight-<fp12>-<n>.json`, contract §2), and reports one result
envelope. Mechanical diagnostics go into `mechanical`; the Semantic Report's
own diagnostics go into `semantic`, apart from `mechanical`, though both
count toward the outcome (contract §9 R6, Story TST-028 R1–R6).

Argv (contract §9 as amended, Story TST-032 R7): `--expect-fingerprint` and
`--expect-revision` are independent — either alone, both, or neither is valid
argv; only a flag repeated, given twice, is `usage-error`.
`--expect-fingerprint` must match `^[a-f0-9]{64}$` and `--expect-revision`
must match `^[a-f0-9]{40}$`, checked before either value is used for anything
(`usage-error`, exit 2). An unknown flag, a repeated flag, a missing flag
value, or a missing/extra positional is the same `REVIEW_USAGE` `usage-error`,
exit 2, every other review command uses. An invalid or unreadable manifest, an
unsafe path, or an unsupported `schemaVersion` is `configuration-error`, exit
2, exactly as `review index` reports it.

It gathers, without acting on any of these decisions itself (Core's
`evaluatePreflight` owns every classification, severity, precedence, and
outcome decision, contract §9 R6):

- The current `review index` diagnostics and declared `dependencies`
  (missing source, unknown Story, unmapped requirement, missing acceptance,
  unknown/duplicate anchor, and `REVIEW_DEPENDENCY_UNDECLARED` all surface
  through this path already).
- `REVIEW_DEPENDENCY_CYCLE`, detected over `dependencies` by the pure Core
  module `packages/core/src/review/dependency-graph.ts`.
- Confirmation applicability against the current fingerprint (contract §8);
  an applicable confirmation's `deferred` list exempts its revision ids from
  `REVIEW_REVISION_UNADDRESSED`; a stale one reports `REVIEW_CONFIRMATION_STALE`
  plus its §8 source differences; none at all reports
  `REVIEW_CONFIRMATION_MISSING`.
- Every effective request's resolution (§6/§7): an unresolved `blocking`
  request is `REVIEW_UNRESOLVED_BLOCKING`; an unresolved non-blocking one
  (not deferred in an applicable confirmation) is `REVIEW_REVISION_UNADDRESSED`.
- Every existing `records/revisions-*.json` and `records/responses-*.json`,
  validated the same way `review respond` validates them; an invalid record
  or a cross-record §6 security M2 conflict is `REVIEW_RECORD_INVALID`
  (advisory). Every already-stored responses record is re-checked against
  its listed sheets' effective requests using the same coverage function
  `review respond` uses (`computeResponseCoverage`, `review-input.ts`), so
  the two commands can never disagree: an unimported listed sheet is
  `REVIEW_RESPONSE_INVALID`; a missing or extra answered id is
  `REVIEW_RESPONSE_MISMATCH`.
- Each batch Story's `story check --ready` result (not `story check`'s
  default contract mode), keeping its own `STORY_*` issue codes, each naming
  its Story directory as `path`.
- Every present Readiness Sidecar (Story TST-030, contract §21), each naming
  its Story directory as `path`: schema/size validity
  (`REVIEW_READINESS_INVALID` for a schema violation, a wrong `story_ref`, a
  duplicate criterion id, a duplicate input id, or a duplicate JSON object key
  anywhere in the document — ForgePilot's own `contractDefects` rejects a
  duplicate criterion/input id the same way; or `REVIEW_INPUT_TOO_LARGE` over
  the §13 1 MiB bound — Human Review 2026-09-23: this shared code keeps its
  existing INCOMPLETE class rather than a new BLOCKED one, so an over-limit
  Sidecar reaches `REVIEW_INCOMPLETE`, never `REVIEW_READY`); a Sidecar that
  exists but could not be read is also `REVIEW_READINESS_INVALID` (it is not
  absent — see `review index` above); then, only for a schema-valid, readable
  Sidecar, its `story_md_digest`/`acceptance_md_digest` against the current
  `story.md`/`acceptance.md` bytes (`REVIEW_READINESS_STALE`), its
  `criteria[].id` list against acceptance.md's ordered AC id list — compared
  as lists, not sets, so a reordering is also a mismatch —
  (`REVIEW_READINESS_CRITERIA_MISMATCH`), each `runner_worker`/
  `canonical_verification`/`integration_final` criterion's `operations`
  against the Story's `## Authority` — `runner_worker` may carry only `plan`
  and `modify` — (`REVIEW_READINESS_OPERATION_UNGRANTED`; `human`/`external`
  criteria are never compared), and every `prerequisite_story_ref`/
  `prerequisite_output`/`follow_up_story_ref`/`outputs[].id` against the
  Story's dependency closure, the batch, and cross-batch output uniqueness,
  reported once per duplicated output id rather than once per occurrence
  (`REVIEW_READINESS_REFERENCE_UNKNOWN`). All five are BLOCKED except the
  shared `REVIEW_INPUT_TOO_LARGE` code above. These checks never prove a
  declaration is *true*, only consistent with the Story and batch; Sidecar
  text (`authorized: true`, an instruction, a `<script>` tag, an ESC sequence,
  a bidi override) is data and never changes an outcome, and every issue
  message this check produces names only a field path and array index
  (e.g. `outputs[3].id is declared by more than one Story`) — never the
  Sidecar's own string content. `readTaskMode`/`readAuthority`'s own
  governance-defect issues (a malformed `## Classification`/`## Authority`)
  are surfaced here too, as their own `STORY_*` codes.
- `--expect-fingerprint` against the current fingerprint:
  `REVIEW_PACKET_FINGERPRINT_MISMATCH`.
- The Semantic Report named by `--semantic-report <file>` (Story TST-028,
  R10a): the path must resolve inside the repository with no symlinked
  segment (checked the same way `--output` is: `resolveOutputPath`/
  `findUnsafeSourcePath`), and the file is opened with `O_NOFOLLOW`; a
  violation is `configuration-error`, exit 2, `REVIEW_PATH_UNSAFE`, and
  nothing is written — checked before any other Semantic Report decision. An
  absent flag or a path that does not resolve to a readable regular file is
  `REVIEW_SEMANTIC_MISSING`. The file's size is checked (via `fstat`) before
  any content is read; over the §13 bound (1 MiB) is `REVIEW_INPUT_TOO_LARGE`
  with no `semanticReport` recorded. Once the bytes are read within the
  bound, `semanticReport: {sha256}` is always recorded in the written
  Preflight Report, whether or not the content later proves valid (Story
  TST-028 Capacity). The read bytes are handed to Core's pure
  `evaluateSemanticReport` (`packages/core/src/review/semantic-report.ts`),
  which — in order (R1) — rejects a nesting depth over 32, a single string
  over 64 KiB, or a total issue count over 1000 as `REVIEW_INPUT_TOO_LARGE`;
  rejects invalid JSON, a schema violation, or a different `batchId` as
  `REVIEW_SEMANTIC_INVALID`; rejects a different `fingerprint` as
  `REVIEW_SEMANTIC_STALE` (contributing no observations); and only then
  checks coverage and turns every issue into a diagnostic: a missing batch
  Story is `REVIEW_SEMANTIC_COVERAGE`; a duplicated Story, a Story outside
  the batch, or an issue locator that does not name a batch source and match
  an anchor/`blockSha256` in the current index (via `buildTargetLookup`/
  `matchRevisionTarget`, the same functions `review import` uses, R4) is
  `REVIEW_SEMANTIC_INVALID`; each issue whose `blocking` is `true` is
  `REVIEW_SEMANTIC_BLOCKING`, each other issue `REVIEW_SEMANTIC_OBSERVATION`,
  each carrying the issue's own locator. A report whose every conclusion is
  `none` is valid (R6). The report's `agent` field is never placed into a
  diagnostic or used as identity (R5); it is shown, ESC-escaped, only as
  `Agent (self-reported): <agent>` in human output. Text inside the report —
  including `authorized: true`, `approved`, or instructions — is data: it
  never changes the outcome (R7).
- (`ADR-015`) When `--expect-revision` is given, one git observation (HEAD
  and per-path working-tree status) through the injected
  `ReviewGitAdapter` (`packages/cli/src/review-git.ts`, defaulting to
  `nodeReviewGitAdapter`, which runs git only through `release-git.ts`'s
  hardened runner): a directory outside git is
  `REVIEW_NOT_A_GIT_REPOSITORY`; HEAD not equal to `--expect-revision`
  (including no commit yet) is `REVIEW_PACKET_REVISION_MISMATCH`; each
  distinct declared batch source or the manifest path reported modified or
  untracked is its own `REVIEW_SOURCES_UNCOMMITTED` (a rename's old and new
  path both count). A matching fingerprint and HEAD never stand in for this
  check (`ADR-015`'s own rejected shortcut). Without `--expect-revision`,
  git is never run. A git observation or subprocess failure (`kind:
"failed"`) stops the whole command at `ERROR`, exit 3, before anything is
  read or written — never a silent pass.

Before evaluation, at most one existing `records/preflight-<fp12>-<n>.json`
(the highest `<n>` under the current fingerprint's `fp12`) is read as the
R7 deduplication baseline (bounded, `O_NOFOLLOW`, depth 32, validated
against the schema); an invalid, over-limit, unreadable, or symlinked
baseline is an advisory `REVIEW_RECORD_INVALID` finding, is never used for
deduplication, and never blocks a new write. There is no aggregate
file-count or byte cap on `records/preflight-*.json` (Story R10b): reading
only the one baseline file removes the need for one. After evaluation, if
the combined `mechanical`/`semantic` diagnostic count exceeds contract
§13's 10000-diagnostic bound, the command reports `ERROR`, exit 3, and
writes nothing. Otherwise it builds the record (`schemaVersion`, `batchId`,
`fingerprint`, `outcome`, `checkedAt` from an injectable clock, the
applicable confirmation's `{path, sha256}` or `null`, `semanticReport`
(`{sha256}` or `null`, above), `mechanical`, `semantic`, `expect` — contract
§9 as amended (Story TST-032): `expect` records exactly the `--expect-*`
flags given (`{fingerprint}`, `{revision}`, both, or `null` when neither was
given) — and either reuses the
baseline's path (when it is valid and equal to the new record in every
field but `checkedAt`, `expect` included) or writes a new
`records/preflight-<fp12>-<n>.json` with `<n>` starting at the baseline's
highest `<n>` plus one, create-new, exclusive. A records-directory symlink
discovered at write time is `configuration-error`, `REVIEW_PATH_UNSAFE`,
exit 2, nothing written (consistent with `review respond`); any other write
failure lowers the outcome to `REVIEW_INCOMPLETE` with
`REVIEW_RECORD_WRITE_FAILED` and leaves no partial file — the evaluation
itself already completed, so this is never `ERROR`.

| Outcome               | Status  | Exit | Meaning                                                                                              |
| --------------------- | ------- | ---- | ---------------------------------------------------------------------------------------------------- |
| `REVIEW_READY`        | `pass`  | `0`  | No blocking mechanical check failed. Grants no execution authority and claims no absence of defects. |
| `REVIEW_BLOCKED`      | `fail`  | `1`  | A blocking mechanical check failed.                                                                  |
| `REVIEW_INCOMPLETE`   | `fail`  | `1`  | A required confirmation, response, or Semantic Report is missing or does not cover the batch.        |
| `REVIEW_STALE`        | `fail`  | `1`  | A supplied fingerprint or the current confirmation no longer matches the current working tree.       |
| `usage-error`         | `error` | `2`  | Invalid or missing argv.                                                                             |
| `configuration-error` | `error` | `2`  | The manifest is invalid, unreadable, or its path is unsafe.                                          |
| `ERROR`               | `error` | `3`  | An unexpected internal failure.                                                                      |

`data` extends the `review index` minimal shape (`batchId`, `fingerprint`,
`sources`, `diagnostics`) with `preflightRecord` (the repo-relative path of
the Preflight Report written or reused), `semanticCount` (how many of the
trailing `diagnostics`/`issues` entries are the Semantic Report's own, so a
caller can split the two without a shape change to `diagnostics` itself),
and `semanticAgent` (the report's own `agent`, once read), each omitted only
when not applicable; `preflightRecord` is additionally omitted when a write
failure downgraded the outcome to `REVIEW_INCOMPLETE`. Human output (stderr
not used; stdout in `--json` mode, stdout otherwise) lists a `Record:` line,
then two labelled sections — "Mechanical checks" and "Agent observations
(unverified)" (the latter listing the Semantic Report's own diagnostics, and
an `Agent (self-reported): <agent>` line once a report was parsed) — and, on
`REVIEW_READY`, the fixed line 「只表示未發現阻擋，不宣稱沒有缺陷」 (contract
§9, Story R8). Every line in both sections is labelled `BLOCK` or `NOTE`
(never `ISSUE`) by its diagnostic's severity (Story R10c; `--json` output is
unchanged). Every message and path is ESC-escaped the same way every other
review command escapes untrusted text.

## `praxisbound review readiness-digests` contract

`praxisbound review readiness-digests <manifest> [--json]` (contract §21,
Story TST-030) is the only way to refresh a Readiness Sidecar's own digests.
It reads every present `<story>/readiness.json` first (the same
`observations` `review index` already gathered): if any is schema-invalid,
names the wrong `story_ref`, has a duplicate criterion/input id or a
duplicate JSON key, or exists but could not be read, nothing is written and
the whole command fails, `failure`, exit 1, `REVIEW_READINESS_INVALID`,
naming the offending Story directory as `path`; an over-limit Sidecar (over
the §13 1 MiB bound) likewise fails with nothing written, but reports
`REVIEW_INPUT_TOO_LARGE` — following §13 literally, the same code `review
preflight` uses for the same condition (Human Review 2026-09-23).

Otherwise, for each schema-valid Sidecar whose `story_md_digest` or
`acceptance_md_digest` no longer equals the current `story.md`/
`acceptance.md` bytes, it stages the rewritten content — `sha256:` plus the
lowercase hex of the current bytes in both digest fields, two-space
indentation, one trailing newline, every other field's original key order
unchanged (mutating only the parsed object's two digest fields and
re-serializing it, never reconstructing the document) — as a temporary file
in the same directory, preserving the original file's mode (never leaving it
at the temporary file's own restrictive mode). Before any temporary file is
staged, every planned rewrite's path is re-checked for a symlinked segment
(code review round 2 LOW): only once every one of them passes does staging
begin. Every Sidecar needing a rewrite is then staged before any rename is
attempted; a single staging failure deletes every temporary file already
created and writes nothing at all. Immediately before renaming, each staged
Sidecar's on-disk bytes are re-checked against what was validated; if any
changed since it was read, the whole run aborts with nothing written
(`REVIEW_RECORD_WRITE_FAILED`). Only then are the staged files renamed into
place, one at a time; if a rename fails partway through, `data.updated`
reports exactly the files already renamed (a real, persisted change — never
rounded down to "nothing written") and the command still fails,
`REVIEW_RECORD_WRITE_FAILED`. A Sidecar whose digests already match is left
unwritten. It never creates a `readiness.json` and never touches any other
field. After every rename succeeds, `review readiness-digests` re-reads the
batch once more, so `data.fingerprint` and `data.sources` in its response
reflect the post-rewrite state, never the one read at the start of the run;
if that re-read itself fails (`ERROR`, exit 3), `data.updated` still lists
every file that really was renamed (code review round 2 LOW) — it is never
dropped just because the follow-up read failed. An over-limit Sidecar (§13's
1 MiB bound) is never parsed at all — its size alone, known from `review
index`'s own `fstat` check, is enough to fail the whole run with
`REVIEW_INPUT_TOO_LARGE`, nothing written.

It edits a definition source, so it needs the same Execution Authorization as
any other source edit, and should run before `review confirm`: running it
changes the Requirement Fingerprint, so an earlier confirmation becomes
inapplicable (`REVIEW_CONFIRMATION_STALE` at the next `review preflight`).

Outcome/status/exit: `success`/`pass`/`0` (`data.updated` lists the
repo-relative paths of every Sidecar actually rewritten, possibly empty);
`failure`/`fail`/`1` for any invalid Sidecar (nothing written) or a write
failure (`REVIEW_RECORD_WRITE_FAILED`); `usage-error`/`error`/`2` for invalid
argv; `configuration-error`/`error`/`2` for an unreadable/invalid manifest or
an unsafe path (including a `readiness.json` symlinked at write time,
`REVIEW_PATH_UNSAFE`); `ERROR`/`error`/`3` for an unexpected internal
failure. `data` extends the `review index` minimal shape with `updated`.

## `praxisbound review goal-plan` contract

`praxisbound review goal-plan <manifest> --semantic-report <file>
[--attempt <n>]` (contract §10, Story TST-031) turns a confirmed, preflighted
Review Batch whose every Story carries a Readiness Sidecar into the three
Goal Plan artifacts ForgePilot's `goal preflight` consumes. It replaced the
never-implemented Execution Packet and `review packet` (`ADR-016`); no
released command's outcome, issue format, or `data` shape changed.

It runs exactly the evaluation `review preflight` performs (no
`--expect-*`, sharing `gatherReviewPreflightEvaluation`/
`writeReviewPreflightRecord` so the two commands can never disagree) and
writes a new Preflight Report the same way, with one addition: a batch Story
with no Readiness Sidecar at all is `REVIEW_READINESS_MISSING` (BLOCKED) —
`goal-plan`-only, since `review preflight` never requires a Sidecar. Any
outcome other than `REVIEW_READY` writes no Goal Plan file.

Argv: a missing `--semantic-report` is `usage-error`, exit 2 (Human Review
2026-09-24). `--attempt` accepts a decimal integer from 1 without leading
zeros (`^[1-9][0-9]*$`); anything else, including `0`, `01`, `-1`, or a
shell-injection-shaped value, is `usage-error`, exit 2, checked before
anything else runs.

On `REVIEW_READY`, `plan.id` is `<BATCH-ID>-<fp12>` (or
`<BATCH-ID>-<fp12>-a<n>` with `--attempt <n>`); over 128 characters is
`configuration-error`, `REVIEW_GOAL_PLAN_ID_INVALID`, checked before any
write (including before the Preflight Report). Core's pure `projectGoalPlan`
(`packages/core/src/review/goal-plan.ts`) then projects
`declaration.json`, `manifest.json`, and `coverage-review.json` from the
current sources, every Story's Readiness Sidecar bytes, and the one
Definition Confirmation whose fingerprint matches — reading no clock,
environment, git state, or earlier Goal Plan, so running it twice on
unchanged sources yields identical bytes — on top of Story TST-029's
exporters (`exportGoalPlanDeclaration`/`exportGoalPlanManifest`/
`exportPlanCoverageReview`), each self-validating against its own TST-029
validator before returning; a projection that fails its own validator is
`ERROR`, exit 3, and writes no Goal Plan file. `confirmedAt`'s separator
accepts a lowercase `t` (matching what a real Definition Confirmation's own
validation already accepts) and is always normalized to uppercase `T` in the
exported `reviewedAt`; a `:60` leap-second `confirmedAt` (theoretically
confirmable, though `review confirm` itself never writes one) has no
corresponding `reviewedAt` the artifact schema accepts, so it is left
unhandled and surfaces as the same self-validation `ERROR` rather than a
silently wrong timestamp — a coordinating-agent decision made during code
review round 1 (M-3), pending Human Review, not a settled position.

Immediately before projecting, `batch.json` and the applicable confirmation
record are re-read and their sha256 re-checked against the digests the
evaluation itself already computed; a mismatch (a concurrent edit between
evaluation and projection) is `ERROR`, exit 3, never a Goal Plan silently
different from the one just evaluated (code review M-6). A manifest
declaring more than one dependency entry for the same Story (legal per
manifest validation) has its `dependsOn` edges unioned and deduplicated
across every entry for that Story, never limited to the last one seen (code
review HIGH-1).

The three artifacts are written under the fixed directory
`specs/batches/<BATCH-ID>/goal-plan/<plan.id>/`, no output flag. Each is
written to a same-directory temporary file (`O_EXCL|O_NOFOLLOW`, `fsync`ed)
and then linked to its final name — `link` never overwrites an existing
destination — so a write failure partway through never leaves a truncated
artifact at the final path (code review M-4). An existing file with
identical bytes counts as written and is left untouched; an existing file
with different bytes rejects the whole run, `failure`, `REVIEW_GOAL_PLAN_CONFLICT`,
exit 1, leaving every already-written file (this run's and any pre-existing
one) untouched — never rewritten or deleted. A symlink at the output
directory, at `goal-plan/`, at any parent up to the repository root, or at
an artifact path is `REVIEW_PATH_UNSAFE`, `configuration-error`, exit 2, and
nothing is written through it. Both failures carry the full preflight
evaluation `data` (`batchId`, `fingerprint`, `sources`, `diagnostics`,
`preflightRecord`), plus `goalPlanDirectory` and `files` (every artifact
this run already created or found byte-identical before the failure); the
failure's own issue is appended to `issues[]` and its matching diagnostic to
`data.diagnostics[]`, in the same order, so contract §12's `issues[]` <->
`data.diagnostics[]` one-to-one correspondence holds identically for
`REVIEW_GOAL_PLAN_CONFLICT` and `REVIEW_PATH_UNSAFE` — never a smaller,
ad hoc shape for one of the two (code review M-5, LOW). A directory, FIFO,
or other non-regular file already at an artifact's path is neither a match
nor a conflict — reading it is never attempted as a byte comparison — and
is `ERROR`, exit 3.

| Outcome               | Status  | Exit | Meaning                                                                                    |
| --------------------- | ------- | ---- | ------------------------------------------------------------------------------------------- |
| `REVIEW_READY`        | `pass`  | `0`  | Every artifact was written (or already matched); no execution authority is granted.         |
| `REVIEW_BLOCKED`      | `fail`  | `1`  | Same as `review preflight`, or a Story has no Readiness Sidecar at all.                     |
| `REVIEW_INCOMPLETE`   | `fail`  | `1`  | Same as `review preflight`.                                                                 |
| `REVIEW_STALE`        | `fail`  | `1`  | Same as `review preflight`.                                                                 |
| `failure`             | `fail`  | `1`  | An existing Goal Plan artifact has different bytes (`REVIEW_GOAL_PLAN_CONFLICT`).           |
| `usage-error`         | `error` | `2`  | Invalid argv, including a missing `--semantic-report` or a bad `--attempt`.                 |
| `configuration-error` | `error` | `2`  | Invalid/unreadable manifest, an unsafe path, or `plan.id` over 128 characters.               |
| `ERROR`               | `error` | `3`  | A projection failed its own validator, an artifact write failed, or another internal error. |

`data` extends the `review preflight` shape (`batchId`, `fingerprint`,
`sources`, `diagnostics`, `preflightRecord`) with `goalPlanDirectory` (the
fixed directory) and `files` (every artifact's repo-relative path, written
or already matching) — present on `REVIEW_READY` and on both
`REVIEW_GOAL_PLAN_CONFLICT`/`REVIEW_PATH_UNSAFE` failures, never only on
success. The command never runs
ForgePilot; the artifacts carry no authorization, verification result, or
completion claim, and no source, Sidecar, record, or Semantic Report text —
including `authorized: true` or an instruction — ever changes the outcome or
appears in an artifact as an authorization.

## `praxisbound review observe` contract

`praxisbound review observe <manifest> <observation.json>` (contract §22,
Story TST-032) validates one Agent's observation of a contract §11 ForgePilot
handoff segment and, only when it is internally consistent, writes it once to
`records/forgepilot-<fp12>-<n>.json`. It never runs ForgePilot and never
judges its current state (contract §22, R1): the written record is
historical Evidence of what one handoff session observed, not a claim about
ForgePilot's current state.

Argv: `<manifest> <observation.json> [--json]`, the same two-positional
shape `review import`/`review respond` take
(`parseManifestAndFileArguments`); a missing positional, an extra one, or an
unknown flag is `usage-error`, exit 2. An invalid or unreadable manifest, or
a manifest path with a symlinked segment, is `configuration-error`, exit 2,
exactly as `review index` reports it.

The observation input file is resolved to a repository-relative path,
checked for a symlinked segment at any path component, opened `O_NOFOLLOW`,
and re-checked by `dev`/`ino` identity against a fresh `lstat` after opening
(the same TOCTOU-closing pattern `--semantic-report` uses, Story TST-028
security C1/M1); a symlinked path is `configuration-error`,
`REVIEW_PATH_UNSAFE`, exit 2. Its size is bounded at the same 1 MiB contract
§13 uses for every `records/` JSON document; over the bound, or a JSON
nesting depth over 32, is `failure`, `REVIEW_INPUT_TOO_LARGE`, exit 1,
before the document is otherwise inspected. Invalid UTF-8 or malformed JSON
is `failure`, `REVIEW_OBSERVATION_INVALID`, exit 1.

The parsed document is validated in two stages by Core's pure
`packages/core/src/review/forgepilot-observation.ts`, hand-written against
`schemas/forgepilot-observation.schema.json` (`schemaVersion` `2.0.0`; any
other value, including `1.0.0`, is rejected — a `1.0.0` record already reads
as `REVIEW_RECORD_INVALID` if ever found under `records/`, contract §2):

1. `validateForgepilotObservationShape` — schema only, no filesystem access:
   every field's shape, including `steps[].stdout`/`steps[].stderr`'s own
   1,048,576-character bound (contract §13's deliberate exemption from the
   64 KiB text limit) and a `steps` array capped at 2000 entries. Only once
   this passes is `goalPlan.path` known to be a syntactically safe
   repository-relative path (no `..`, no absolute leading `/`, no control
   character) — so a path-traversal payload in `goalPlan.path` is always
   `REVIEW_OBSERVATION_INVALID` here, never reaching a filesystem check at
   all, and therefore never `REVIEW_PATH_UNSAFE`.
2. Only then is `goalPlan.path` resolved and read (bounded at 8 MiB, the
   same Goal Plan Manifest bound `review goal-plan` uses, `O_NOFOLLOW`,
   symlink-checked the same way as the observation input); a symlinked
   segment anywhere on that path is `configuration-error`,
   `REVIEW_PATH_UNSAFE`, exit 2. `validateForgepilotObservationConsistency`
   then checks contract §22's binding and step-consistency rules against the
   manifest's own `batchId` and the Goal Plan Manifest bytes (or `undefined`
   when the file could not be read at all — missing and wrong-`sha256` fold
   into the same `REVIEW_OBSERVATION_INVALID` rejection, contract §22):
   - `batchId` equals the manifest's own `batchId`.
   - `goalPlan.path` lies under `specs/batches/<BATCH-ID>/goal-plan/`, the
     named file exists, and its sha256 equals `goalPlan.sha256`.
   - `goalId`, when present, equals the Goal Plan Manifest's own `plan.id`
     (parsed directly from its bytes; this check never re-validates the
     Manifest's own schema, and never compares the observation's
     `fingerprint` against the Manifest's `coverageIndex.fingerprint` — out
     of scope for Story TST-032, Human Review 2026-09-24).
   - Step order (contract §11/§22, R2): no `run` without an earlier exit-0
     `run-dry-run`; `run-dry-run`/`run` never share a record with
     `goal-create`/`work-add`; every step but the last exits `0`; an exit-0
     `work-add` has both `workItemId` and `created`.
   - `stoppedBecause` consistency with the last step (R3):
     `awaiting-authorization` ends with an exit-0 `execution-plan`;
     `goal-completed`/`run-needs-human`/`run-limit-reached`/
     `run-interrupted`/`run-failed` end with `run` at the exit contract §11's
     table names for each (`run-failed` accepts any other exit, including
     `null` — Human Review 2026-09-24); `step-failed` ends with a non-zero
     or `null` exit; `authorization-missing` has no steps at all; any other
     `stoppedBecause` value carries no last-step constraint beyond R2 (Human
     Review 2026-09-24).

   Any rejection at this stage is `failure`, `REVIEW_OBSERVATION_INVALID`,
   exit 1 (or `REVIEW_INPUT_TOO_LARGE` when the shape stage's own rejection
   was a size/count bound). No rejection message ever quotes observation
   text — `stdout`, `stderr`, or any other field value (R6): text in the
   observation, including `authorized: true`, an instruction, or an ESC
   sequence, is data, never changes the outcome, and is never echoed.

Once accepted, the observation's own bytes — exactly as read, never
re-serialized — are written create-new, exclusive, to
`records/forgepilot-<fp12>-<n>.json` (`<fp12>` the first 12 hex characters
of the record's own `fingerprint`; `<n>` from 1, incremented past any
existing name), using the same `createNewRecord` primitive (temp file plus
`link`, identity-checked by `dev`/`ino`) every other batch review record
uses. A `records/` symlink discovered at write time is `configuration-error`,
`REVIEW_PATH_UNSAFE`, exit 2, nothing written; any other write failure is
`ERROR`, exit 3, `REVIEW_RECORD_WRITE_FAILED`, leaving no partial file.

| Outcome               | Status  | Exit | Meaning                                                                                     |
| ---------------------- | ------- | ---- | -------------------------------------------------------------------------------------------- |
| `success`             | `pass`  | `0`  | The observation was internally consistent and written once; `data.record` names the file.    |
| `failure`             | `fail`  | `1`  | Schema/binding/step-consistency rejection (`REVIEW_OBSERVATION_INVALID`) or over-limit (`REVIEW_INPUT_TOO_LARGE`); nothing written. |
| `usage-error`         | `error` | `2`  | Invalid or missing argv.                                                                      |
| `configuration-error` | `error` | `2`  | Invalid/unreadable manifest, or a symlinked path (observation input, `goalPlan.path`, or `records/`). |
| `ERROR`               | `error` | `3`  | The record write failed, or another unexpected internal error.                                |

`data` is `{ batchId, fingerprint, record }` on success (`record` the
repo-relative path just written); rejections carry only `issues[]`, no
`data`. The command never spawns any process, never reads `.forgepilot`, and
never treats `goal-completed` as Human Review acceptance or `DONE`.

## `review preflight` and `review goal-plan` outcomes

`praxisbound review preflight <manifest> ...` (contract §9) and
`praxisbound review goal-plan <manifest> ...` (contract §10, Story TST-031)
share four new outcome values with the existing `success`/`failure`/
`usage-error`/`configuration-error`/`ERROR` outcomes. This is Additive
(contract §14): a new command group and four new outcomes, `schemaVersion`
unchanged.

| Outcome             | Status | Exit | Meaning                                                                                                        |
| ------------------- | ------ | ---- | -------------------------------------------------------------------------------------------------------------- |
| `REVIEW_READY`      | `pass` | `0`  | No blocking check failed; the batch may proceed to the next step. It never claims the batch is defect-free.    |
| `REVIEW_BLOCKED`    | `fail` | `1`  | A blocking mechanical or semantic check failed; the batch must return to revision or an additional check.      |
| `REVIEW_INCOMPLETE` | `fail` | `1`  | A required confirmation, response, or Semantic Report is missing or does not cover the batch.                  |
| `REVIEW_STALE`      | `fail` | `1`  | A supplied fingerprint, revision, confirmation, or Semantic Report no longer matches the current working tree. |

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
