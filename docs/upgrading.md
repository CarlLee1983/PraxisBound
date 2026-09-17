# Upgrading an Adopting Repository

## PraxisBound Protocol 0.10.0 identity migration

`0.10.0` is a Breaking rename from ForgeFlow to PraxisBound. Before upgrading,
retain a recovery point for the adopter. Run the new Bootstrap with `--upgrade`;
it accepts only a regular, readable legacy `specs/.forgeflow-adoption` with the
supported `version=0.9.0` identity and a revision of `unknown` or a lowercase
40/64-character Git SHA (optionally suffixed `-dirty`). It writes
`specs/.praxisbound-adoption`, preserves that revision, and removes the old
marker. Do not create the new marker by hand: both markers are ambiguous and
Bootstrap refuses them.

Replace `FORGEFLOW_DECISIONS_ROOT` with `PRAXISBOUND_DECISIONS_ROOT`. The old
non-empty variable is rejected rather than aliased. To roll back before
publication, restore the complete pre-upgrade checkout, including the legacy
marker and old environment variable, from the recovery point.

Bootstrap installs a copy-time snapshot. This page covers moving an existing
adoption to a newer snapshot without losing what the repository owns.

## The adoption marker

A fresh bootstrap writes `specs/.praxisbound-adoption`, a machine-readable record
of the snapshot it installed:

```text
version=0.10.0
revision=f14da0095cf04d42df3d7a82822e072639beba9e
```

`version` is the PraxisBound `VERSION` value the snapshot came from. `revision`
is the full commit SHA of the PraxisBound checkout that copied it, with a `-dirty`
suffix when that checkout had uncommitted changes. It is the literal `unknown`
whenever the checkout cannot prove otherwise: Git is unavailable, the checkout
is not itself the root of a Git work tree (a copy vendored inside another
repository included), or the work tree's state cannot be read. A `-dirty` or
`unknown` revision means the snapshot cannot be reproduced from a commit; the
version line is still exact.

The marker is a managed file, classified in
[Protocol Versioning](../protocol/versioning.md).

`specs/stories/README.md` is **not** managed. A repository may keep whatever
prose it likes there; PraxisBound neither reads nor writes it.

## Upgrading the templates

From a newer PraxisBound checkout:

```sh
./scripts/bootstrap --upgrade /path/to/repository
```

This replaces the three `specs/stories/_template/` files and the adoption
marker, and recreates `specs/stories/_template/` if the adoption had removed it.
Outside the temporary private staging/recovery directories described below,
nothing else in the target is written.

Preview it first:

```sh
./scripts/bootstrap --upgrade --dry-run /path/to/repository
```

`--upgrade` and `--dry-run` may appear in either order before the optional
target, and each flag may appear at most once. `--upgrade` and `--force` are
mutually exclusive: `--force` is a fresh installation that replaces every
managed file, `--upgrade` deliberately replaces fewer.

`--upgrade` requires an existing `specs/stories/` directory. A repository that
never adopted PraxisBound exits `1` and is told to run a fresh bootstrap instead.
The static safety rules are the same as a fresh install: managed directory and
file symlinks are refused, a managed path of the wrong file type is refused, and
each replacement uses a single-file atomic rename.

## Failure recovery

Fresh bootstrap, `--force`, and `--upgrade` prepare every replacement and back up
every existing managed file before replacing any of them. Private
`.praxisbound-install.<digest>-<filename>` directories beside the destinations keep
each rename on the same filesystem. Originals must be readable and enough disk
space must be available for staging and recovery copies; preparation failure
leaves managed files unchanged. The adoption marker is replaced last.

Detected command failures and caught HUP/INT/TERM interruptions trigger cross-file
recovery: restore original file contents and existence, including a command that
changed its destination before reporting failure. Other paths keep being
restored even if one recovery operation fails. Recovery uses copies, so it does
not promise original inode identity, hard-link reconstruction, or all filesystem
metadata. Successful cleanup removes staging and newly created empty directories
on a failed installation. `--dry-run` never stages or backs up anything.

An incomplete recovery exits nonzero, prints every `UNRESTORED:` destination,
and retains private recovery directories. Restore each named destination from
its named `original` backup through a temporary copy beside that destination and
rename the copy into place. If the original was absent, remove only that named
destination. Recheck all managed contents before removing retained directories
or retrying bootstrap. Never blindly remove the target repository.

If marker restoration fails, bootstrap attempts to remove the marker so it
cannot claim a successfully installed new snapshot. If removal also fails,
`Do not trust the adoption marker` names the path to remove or restore manually
before using the adoption. No failure prints installation success. A cleanup
failure after all replacements succeeded can leave a complete installation with
staging to remove; it still exits nonzero and reports the cleanup path.

This is single-file atomic replacement with cross-file recovery, **not an atomic
installation transaction**. Power loss, SIGKILL, an unavailable filesystem, or
hostile concurrent changes can prevent recovery; backups alone are not a durable
journal. Run only while controlling the repository. After an uncatchable failure,
inspect all managed files and any retained originals, restore a known complete
snapshot (or deliberately retry with `--force`/`--upgrade`), and confirm the
marker agrees before relying on it. Upgrade staging/recovery never includes
repository-owned `AGENTS.md`.

## What `--upgrade` never does

`--upgrade` never creates, replaces, removes, or reads `AGENTS.md` or
`guidance/`. Once installed, the agent guide and Guidance are owned by the
adopting repository, and repositories customize them heavily.

Bootstrap never writes `AGENTS.md` in upgrade mode, and never reads or writes
`guidance/` in that mode.

The command reports that it left `AGENTS.md` alone. When the marker it found
records a different protocol version from the templates it just installed, it
also warns, naming both versions and pointing here. The marker records the last
bootstrap or upgrade, not the provenance of `AGENTS.md`, so the warning says
only that the guide may predate either version — it cannot say when the guide
was written. Deciding what to carry across from the new `templates/AGENTS.md` is
the adopter's call; PraxisBound does not diff, merge, or keep historical copies of
it.

`--upgrade` also does not rewrite existing Stories. A newer Story Contract can
make previously valid Stories incomplete, and fixing them is a migration step
you perform and `scripts/story-check` verifies.

## Reconcile repository-owned agent guidance

An adoption marker upgraded to the current version does not mean
repository-owned `AGENTS.md` is current. Bootstrap never merges or overwrites
`AGENTS.md` or `guidance/` in upgrade mode, so adopters manually compare the
current `templates/AGENTS.md` and opt in to baseline Guidance that fits their
repository:

The 0.7.0 and 0.8.0 steps below describe their original ForgeFlow-era commands;
when running them against PraxisBound 0.10.0, replace the old decision-root
variable with `PRAXISBOUND_DECISIONS_ROOT` and use current skill names.

0.8.0 was never released on its own. Its changes reached `main` in the same
pull request as 0.9.0, so no checkout of `main` was ever at 0.8.0 and there is
no `v0.8.0` tag or GitHub Release. An adoption at 0.7.0 upgrades to 0.9.0 and
applies both the 0.8.0 and 0.9.0 steps; moving on to 0.10.0 then follows the
identity migration above, which accepts only a `version=0.9.0` marker.
[`docs/releases/0.8.0.md`](releases/0.8.0.md) remains the record of what 0.8.0
changed.

* when upgrading to 0.3.3 or later, compare the Code Quality guidance;
* when upgrading to 0.3.4 or later, compare Review Preparation and human-only
  acceptance guidance; and
* when upgrading to 0.3.5 or later, compare Classification truthfulness and
  verification freshness guidance; and
* when upgrading to 0.4.0 or later, compare Acceptance Evidence guidance so
  agents plan a fixture or precondition and observable result for every AC.
* when upgrading to 0.5.0 or later, nothing is required: the task mode,
  authority, architecture, and risk declarations are optional and defaulted.
  Copy `templates/story/verification.md` and `templates/decision.md` by hand
  when the repository wants recorded verification results or decision records;
  neither is a managed file;
* when upgrading to 0.6.0 or later, run `./scripts/story-check` once. It now
  validates the Story ID a directory names, so a Story whose ID never conformed
  fails where it previously passed. Slugs need no change: the ID stops before
  the slug begins. [The 0.6.0 release notes](releases/0.6.0.md) state the
  grammar and the repair;
* when upgrading to 0.7.0 or later, keep an existing ADR collection where it
  is. When a Story declares `Decision:`, run `scripts/story-check` with
  `FORGEFLOW_DECISIONS_ROOT` set to that collection, for example
  `FORGEFLOW_DECISIONS_ROOT=docs/adr ./scripts/story-check`. Leaving it unset
  or empty preserves the default `specs/decisions/` root; and
* when upgrading to 0.8.0 or later, move mutable current work, lifecycle,
  blocker/Gate, next-action, review, verification-current, and completion state
  to the external control plane or direct human coordination. Replace a legacy
  `workflow`/`baseline` handoff with the immutable evidence template, or remove
  the optional handoff when no historical record is needed. Reconcile
  repository-owned `AGENTS.md` and installed ForgeFlow skills manually; they
  must no longer select work from `specs/handoff.md`. Run
  `./scripts/handoff-check`, Doctor if used, and `make verify`; and
* when upgrading to 0.9.0 or later, no repository file migration is required.
  ForgeFlow now distinguishes the bootstrap starter layout from the adoption
  contract: the required entrypoints remain `AGENTS.md`, `Makefile` exposing
  `make verify`, and `specs/stories/`. Keep customized optional Guidance as it
  is; Doctor validates `guidance/ENTRY.md` when the capability is present and
  no longer treats the starter's other three documents as conformance files.
  Consumers that parse Doctor output must map `OPTIONAL_LEGACY` to
  `NOT_PRESENT` and `GUIDANCE_BASELINE_OK` to `GUIDANCE_CONTRACT_OK`. Split a
  former `GUIDANCE_INCOMPLETE` by cause: a missing or blank `ENTRY.md` becomes
  `GUIDANCE_CONTRACT_INCOMPLETE`, while a missing or blank non-entry starter
  document becomes `GUIDANCE_CONTRACT_OK`; an unsafe `ENTRY.md` remains
  `ERROR`. A legacy `ERROR` caused only by a symlinked, wrong-type, or
  unreadable non-entry starter document becomes `GUIDANCE_CONTRACT_OK`;
  and
* when upgrading to 0.4.1 or later, optionally copy the four baseline files from
  `guidance/` and reconcile them with repository/team decisions; do not replace
  existing decisions or practices wholesale.

This is a manual reconciliation step. A marker update proves only which managed
Story-template snapshot bootstrap installed; it does not prove that the
repository-owned guide or Guidance carries the same version. Doctor treats an
absent `guidance/` directory as `NOT_PRESENT`; when Guidance is present it
validates its `ENTRY.md` entrypoint. The remaining starter documents are owned
and customizable repository context, and unsafe Guidance paths remain errors.

## Per-version migration steps

The required repository changes for each version, including the `0.3.0` Story
`## Classification` migration and the `0.4.0` Acceptance Evidence migration,
are recorded with the change classification that justifies them in [Protocol
Versioning](../protocol/versioning.md). Read that page's migration guidance for
the version you are moving to, then run `./scripts/story-check --ready` on each
Story that uses readiness.
