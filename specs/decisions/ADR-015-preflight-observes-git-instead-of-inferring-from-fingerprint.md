# ADR-015: Preflight observes git instead of inferring a clean tree from the fingerprint

* Status: accepted
* Date: 2026-09-23
* Accepted: 2026-09-23

## Context

Contract §9 has `review preflight` refuse to hand off a batch when any batch
source or the manifest has uncommitted or untracked changes, but only when the
caller passes `--expect-revision`. An Execution Packet (§10) binds a commit, so
work handed to an Agent has to start from that commit's content.

The batch-review code does not touch git anywhere today. The Requirement
Fingerprint already covers uncommitted content, which suggests a shortcut: when
the current fingerprint equals `--expect-fingerprint` and HEAD equals
`--expect-revision`, treat the tree as clean without running git.

That shortcut is unsound. A matching fingerprint proves the working tree has the
expected content. It does not prove the content is committed. A batch edited
and confirmed but never committed matches its fingerprint while HEAD still holds
older bytes, so the packet's commit would not contain the confirmed definition.

The alternatives considered and rejected were:

* **Inferring cleanliness from fingerprint and HEAD.** No subprocess, but it
  can report a clean tree whose confirmed content exists only uncommitted.
* **Hashing the batch sources at HEAD through git plumbing and comparing them
  with the fingerprint.** Proves committed content equals working content, but
  needs more git surface than a status call and still misses untracked files a
  manifest change would pick up.

## Decision

When `--expect-revision` is given, preflight runs git to read HEAD and the
per-path working-tree status (`git status --porcelain=v1
--untracked-files=all`), and reports each modified or untracked batch source or
manifest in its own `REVIEW_SOURCES_UNCOMMITTED` issue. A directory outside git
is `REVIEW_NOT_A_GIT_REPOSITORY`. Without `--expect-revision`, git is not run.

Git is run only through the hardened runner in `release-git.ts`: an argv array,
no shell, a 1 MiB output bound, and a cleaned environment. That runner gains a
per-path status result instead of collapsing the status to one clean/dirty bit.
Preflight receives git through an injected observation adapter, following the
`ReleaseObservationAdapter` seam, so tests run against temporary git
repositories or a fake adapter.

## Boundaries

* The git adapter owns running git and parsing its output into per-path status.
  It knows nothing about batches.
* The `review preflight` CLI command owns matching that status against batch
  paths and turning matches into issues.
* Core stays free of I/O; it never runs git.

## Consequences

Preflight gains a subprocess and a dependency on a `git` executable being
available when `--expect-revision` is given; a missing or failing git is a
reported condition, never a silent pass. Git output is untrusted input under
contract §15, so paths from it are ESC-escaped when shown.

A human can still read, confirm, and preflight a dirty draft without
`--expect-revision`. Only the handoff path, which binds a commit, demands a
clean tree.

## Falsified if

This decision no longer holds if the Execution Packet in
`specs/features/batch-review/contract.md` stops binding a commit, so committed
content no longer matters at handoff; or if the hardened runner in
`packages/cli/src/release-git.ts` stops being the only place a git subprocess
is started, so a second, unhardened path to git exists.
