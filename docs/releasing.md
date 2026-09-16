# Releasing PraxisBound

PraxisBound publication is a human-authorized operation. The repository provides
one repeatable local readiness interface:

```sh
make release-check
```

The command first runs the canonical `make verify` gate, then runs the built
TypeScript CLI's local release inspection through a JSON compatibility adapter.
Node.js and the installed repository tooling are required for this Make target.
The adapter preserves the six success records emitted by the former shell
checker. It checks the local candidate's version, commit, strict worktree
cleanliness, and local tag consistency. Its PASS is local-only evidence. It
never fetches, pushes, changes tags, calls GitHub, or creates a release.

TST-018 ended the TST-017 deprecation period. `scripts/release-check` is now a
thin POSIX wrapper around the TypeScript compatibility adapter, so direct use
of the command also requires a supported Node.js runtime. The former selector
and shell implementation are not fallback paths. A retired or unknown selector
fails before inspection:

```sh
make release-check RELEASE_CHECK_IMPLEMENTATION=legacy # fails closed
```

Migrate callers by removing `RELEASE_CHECK_IMPLEMENTATION` and providing the
same supported Node.js runtime used by the repository tooling. The command
form, six success records, local-only checks, exits, and no-write behavior are
unchanged. The runtime change is Breaking for maintainers who invoked the
portable shell implementation or selected `legacy`; it is outside the adopter
Protocol surface, so Protocol `VERSION` remains `0.10.0`.

Rollback restores the complete pre-TST-018 revision
`fcc5595d5c95a42a82e67bb6f82be7886fdfaa64`. Do not copy the old checker into a
newer checkout: its Make wiring, selector, tests, and documentation form one
compatibility set. Rollback changes no repository data, package, tag, GitHub
Release, or npm dist-tag.

Remote tag, Release, and CI state is time-sensitive evidence. Query it through
this runbook when making a release or review decision; a handoff may preserve a
historical publication fact but is not the long-term source of truth for
current remote state.

## 1. Classify and prepare the change

Classify every adopter-facing change as breaking, additive, or corrective under
the [Protocol Versioning policy](../protocol/versioning.md). Update `VERSION` in
the same release change and add migration guidance when the policy requires it.

Commit the complete release change before continuing. Do not exclude untracked
or generated files from the candidate merely to make the readiness check pass.

## 2. Establish local readiness

Run:

```sh
make release-check
```

PASS reports the candidate version, full commit SHA, expected tag, and whether
that local tag is absent or already resolves to the same `HEAD`. The same-HEAD
case is intentionally idempotent. A tag conflict or dirty worktree is a stop
condition; never move a release tag or clean user-owned files to bypass it.

The final line, `remote_checks=not-performed`, is a required reminder that local
PASS is necessary but insufficient for publication.

Immediately after PASS, record one identity tuple from that verified state and
preserve it throughout the rest of the process:

```sh
candidate_version=$(sed -n '1p' VERSION)
candidate_tag="v$candidate_version"
candidate_sha=$(git rev-parse HEAD)
```

Confirm that these three values match the preceding readiness output. If the
repository changes later, stop, rerun `make release-check`, and record a new
tuple; never mix evidence from two candidate revisions.

Resolve the Git remote and GitHub repository once. The following guard supports
this repository's standard GitHub HTTPS and SSH remote forms:

```sh
candidate_remote=origin
if ! candidate_repository=$(gh repo view --json nameWithOwner --jq .nameWithOwner); then
  printf 'STOP: cannot resolve the GitHub repository\n' >&2
  exit 1
fi
if ! candidate_fetch_urls=$(git remote get-url --all "$candidate_remote"); then
  printf 'STOP: cannot resolve the release remote fetch URL\n' >&2
  exit 1
fi
if ! candidate_push_urls=$(git remote get-url --push --all "$candidate_remote"); then
  printf 'STOP: cannot resolve the release remote push URL\n' >&2
  exit 1
fi
candidate_fetch_url_count=$(printf '%s\n' "$candidate_fetch_urls" | wc -l | tr -d '[:space:]')
candidate_push_url_count=$(printf '%s\n' "$candidate_push_urls" | wc -l | tr -d '[:space:]')

if [ -z "$candidate_repository" ] ||
  [ -z "$candidate_fetch_urls" ] ||
  [ -z "$candidate_push_urls" ] ||
  [ "$candidate_fetch_url_count" -ne 1 ] ||
  [ "$candidate_push_url_count" -ne 1 ] ||
  [ "$candidate_fetch_urls" != "$candidate_push_urls" ]; then
  printf 'STOP: release remote must have one identical fetch/push URL\n' >&2
  exit 1
fi

candidate_remote_url=$candidate_push_urls

case "$candidate_remote_url" in
  "https://github.com/$candidate_repository" | \
  "https://github.com/$candidate_repository.git" | \
  "git@github.com:$candidate_repository.git" | \
  "ssh://git@github.com/$candidate_repository.git")
    ;;
  *)
    printf 'STOP: Git remote and GitHub repository do not match\n' >&2
    exit 1
    ;;
esac

gh repo view "$candidate_repository" --json nameWithOwner,url,sshUrl
```

Review that output before continuing. Reuse the exact `candidate_remote_url`
and `candidate_repository` for every subsequent remote read or write; do not
fall back to the remote alias or a separately typed repository name.

## 3. Verify the exact remote revision

With explicit authorization, publish the candidate commit through the
repository's normal branch workflow. Then use authenticated `gh` commands to
find and inspect the verification run for the exact candidate SHA:

```sh
gh run list --repo "$candidate_repository" --commit "$candidate_sha" \
  --workflow verify.yml \
  --json databaseId,headSha,status,conclusion,url
gh run view RUN_ID --repo "$candidate_repository" \
  --json headSha,status,conclusion,url
```

Continue only when the completed successful run's `headSha` equals
`candidate_sha`. A successful run for a branch name, another commit, or an
outdated local checkout is not release evidence.

## 4. Reconcile remote tag and release state

Inspect both remote objects before creating either one:

```sh
git ls-remote --tags "$candidate_remote_url" \
  "refs/tags/$candidate_tag" "refs/tags/$candidate_tag^{}"
gh release view "$candidate_tag" --repo "$candidate_repository" \
  --json tagName,name,isDraft,isPrerelease,targetCommitish,url,publishedAt
```

Apply these stop/go rules:

* If neither remote tag nor release exists, publication may proceed after
  explicit human approval.
* If both exist and the peeled tag, release, and successful CI evidence resolve
  to `candidate_sha`, treat the operation as resumed or already published. Do
  not recreate it.
* If only one exists, either points elsewhere, the release is unexpectedly
  draft/prerelease, or evidence is missing or stale, stop and reconcile the
  external state before any write.

## 5. Publish only after explicit approval

First re-establish the local invariant and confirm the tuple is unchanged:

```sh
make release-check
test "$(sed -n '1p' VERSION)" = "$candidate_version"
test "$(git rev-parse HEAD)" = "$candidate_sha"
test "$(git remote get-url --all "$candidate_remote")" = \
  "$candidate_remote_url"
test "$(git remote get-url --push --all "$candidate_remote")" = \
  "$candidate_remote_url"
```

Then reconcile the local tag form:

* If `local_tag=absent`, create one annotated tag at `candidate_sha`.
* If `local_tag=same-head` and `git cat-file -t
  "refs/tags/$candidate_tag"` reports `tag`, reuse that annotated tag.
* If `local_tag=same-head` reports `commit`, it is a lightweight tag. Stop and
  obtain an explicit reconciliation decision; do not silently replace, move, or
  publish it as though it were annotated.

When the tag is absent, create it and rerun the readiness gate:

```sh
git tag -a "$candidate_tag" "$candidate_sha" \
  -m "PraxisBound protocol $candidate_version"
make release-check
```

Only after those checks pass, push that exact ref and make the GitHub Release
verify the tag instead of implicitly creating one:

```sh
git push "$candidate_remote_url" "refs/tags/$candidate_tag"
gh release create "$candidate_tag" --repo "$candidate_repository" --verify-tag \
  --title "PraxisBound $candidate_tag" \
  --notes-file /path/to/release-notes.md
```

These are externally visible writes. Resolve the exact repository first and run
them only with explicit authorization. If local tag creation succeeds but push
does not, stop and diagnose; do not move an existing remote tag.

## 6. Verify publication

Repeat the exact-SHA CI check and remote-state inspection. Confirm that:

* the remote tag peels to `candidate_sha`;
* the published release names `candidate_tag` and has the intended publication
  state; and
* the successful required workflow still names `candidate_sha`.

Only this combined evidence establishes publication. `VERSION`, local PASS, a
tag, a release page, or a green run is insufficient on its own.

## 7. Publish the npm packages

The npm packages use their own exact version from
`packages/core/package.json` and `packages/cli/package.json`; do not substitute
the Protocol `VERSION`. Before the first publication, confirm all of the
following against the same `candidate_sha`:

* GitHub identifies the public repository as `CarlLee1983/PraxisBound` and both
  package manifests name that exact repository and package subdirectory.
* `@praxisbound/core@<version>` and `@praxisbound/cli@<version>` do not exist,
  and an authenticated `praxisbound` organization owner or authorized member
  has package-publishing rights for the `@praxisbound` scope.
* Local `make verify` and the required remote `verify.yml` run pass for the
  exact candidate SHA.
* The protected `NPM_TOKEN` Actions secret contains only the short-lived,
  scope-limited bootstrap credential issued by that organization-authorized
  account. For the unattended first `npm publish`, its Packages and scopes
  permission must be `Read and write (publish and stage)` for `@praxisbound`,
  with `Bypass 2FA` enabled only if organization policy permits it. A stage-only
  token or Organizations-settings permission does not grant direct package
  publication. Never place or test the credential in the worktree or a command
  argument; do not substitute a local ambient npm session. If organization
  policy forbids bypass, stop for Human Review.

The [npm granular-token policy](https://docs.npmjs.com/about-access-tokens/)
currently permits this first-publish exception but announces removal of direct
publishing with bypass-2FA tokens in January 2027. Recheck the policy before
dispatch; if the bootstrap path is unavailable, stop for Human Review.

A brand-new npm package cannot use staged publishing and cannot have a Trusted
Publisher configured before it exists. Dispatch `publish.yml` from `main` for
`core` first, supplying the full approved `candidate_sha` input. The workflow
refuses a dispatch or checked-out revision that differs from that SHA, reruns
`make verify`, and accepts only an explicit registry E404 as evidence that the
immutable version is unused. It publishes the package to the non-default `next` tag with
provenance. The [registry metadata contract](https://github.com/npm/registry/blob/main/docs/responses/package-metadata.md)
defines `latest` for every package, and npm may assign it when creating a brand-new package;
record both tags and do not claim that default acquisition was withheld. Verify
its public metadata, integrity, provenance, root import, and clean-consumer
behavior before dispatching the same workflow for `cli`. The CLI job also
refuses to proceed until the exact Core version is public.

After both `next` packages pass the public smoke checks:

1. Configure GitHub Actions Trusted Publishing separately for Core and CLI,
   restricted to repository `CarlLee1983/PraxisBound` and workflow
   `publish.yml`, with direct `npm publish` allowed.
2. Verify the saved repository and workflow identity on both package settings.
   The first OIDC-authenticated publication will be the next immutable package
   version; npm does not validate the trust configuration when it is saved.
   For that future publication, the workflow must use `id-token: write` without
   a traditional `NODE_AUTH_TOKEN` secret or a setup-node-generated registry
   auth file. npm's default public registry is sufficient for these packages.
3. Set each package's publishing access to require 2FA and disallow traditional
   tokens, delete the protected `NPM_TOKEN` secret, and revoke every bootstrap
   token at npm, including any replaced or exposed token from a failed attempt.
4. Confirm `npm view` resolves both `next` and `latest` to the same intended
   immutable versions. An already-correct `latest` needs no dist-tag write; if a
   tag is absent or points elsewhere, stop for Human Review before changing it.
5. Rerun the public smoke suite against exact versions and against `latest`.

Do not rerun `npm publish` to change an existing version or tag: npm versions
are immutable. A failure after either first publication blocks the remaining
release steps and must retain the observed registry state for review, including
any `latest` tag already exposed by the registry.

Authoritative npm references: [scoped public packages](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/),
[staged publishing](https://docs.npmjs.com/staged-publishing/),
[Trusted Publishers](https://docs.npmjs.com/trusted-publishers/), and
[dist-tags](https://docs.npmjs.com/adding-dist-tags-to-packages/).
