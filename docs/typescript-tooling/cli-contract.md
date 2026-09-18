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

| New command                                  | Legacy capability                     | Contract                                                                                         |
| -------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `praxisbound init [repo]`                    | `scripts/bootstrap`                   | Apply fresh adoption by default; supports `--dry-run`, mutually exclusive `--force`/`--upgrade`. |
| `praxisbound doctor [repo]`                  | `scripts/doctor`                      | Static, read-only by default; retains `--run-verify` during compatibility period.                |
| `praxisbound verify [repo]`                  | Doctor execution mode / `make verify` | Explicitly runs target-owned `make verify` once from physical root.                              |
| `praxisbound story check [story ...]`        | `scripts/story-check`                 | Discovers Stories when omitted; supports `--ready`.                                              |
| `praxisbound verification check [story ...]` | `scripts/verification-check`          | Resolves plans by default; supports `--result`.                                                  |
| `praxisbound handoff check [file]`           | `scripts/handoff-check`               | Defaults to `specs/handoff.md`.                                                                  |
| `praxisbound release check [repo]`           | `scripts/release-check` Node wrapper  | Local, read-only release inspection; target defaults to `.`; never performs remote checks.       |
| `praxisbound review index <manifest>`        | none (new capability)                 | Reads one Batch Manifest and its declared sources; read-only; writes nothing.                    |
| `praxisbound review render <manifest> --output <file>` | none (new capability) | Writes an additive, self-contained offline HTML Review Projection; never changes selected sources. |
| `praxisbound codex activate <repo>`          | `scripts/codex-activate`              | Preview by default; supports `--apply`; stays a late migration wave.                             |

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

| Outcome               | Status  | Exit | Meaning                                                                          |
| ---------------------- | ------- | ---- | --------------------------------------------------------------------------------- |
| `success`              | `pass`  | `0`  | The manifest is valid. Missing sources, unmapped Spec entries, and Stories without acceptance criteria are reported as `issues`/`data.diagnostics`, not failures. |
| `usage-error`          | `error` | `2`  | Invalid or missing argv.                                                          |
| `configuration-error`  | `error` | `2`  | The manifest is unreadable, not JSON, fails the schema, names an unsupported `schemaVersion`, its `batchId` does not match its directory, a declared path is unsafe, or an input exceeds contract §13's limits. |
| `ERROR`                | `error` | `3`  | An unexpected internal failure.                                                   |

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
writes one self-contained HTML Review Projection. This additive command uses
the existing v1 envelope mappings: `success` is `pass`/`0`; a diagnosed output
publication failure is `failure`/`1`; invalid argv and unsafe input/output are
`usage-error` or `configuration-error`/`2`; unexpected failures are `ERROR`/`3`.
The output must remain within the repository and cannot target the manifest,
any declared source, the batch `records/` directory, or any symlink. It stages
and renames the HTML atomically, retaining a prior successful output if
publication fails. It never creates the output directory; a missing one is a
`REVIEW_OUTPUT_WRITE_FAILED` failure whose issue path names that directory. HTML is an offline, read-only projection: it includes no
external resource loads, executes no source content, and never records
approval, completion, verification, or Agent state.

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
