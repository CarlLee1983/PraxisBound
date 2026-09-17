#!/bin/sh

set -eu

# PB005-AC-004, PB005-AC-005, PB005-AC-009. Exercises the publish job's own
# guard and digest logic, extracted from the committed publish.yml by step
# name, so the logic under test is the workflow text itself, not a copy of it.
# Every value the workflow would supply through `env:` is passed the same way
# here; no case ever reaches a real npm registry or credential.

fail() {
  printf 'publication-workflow test failed [%s]: %s\n' "${case_id:-top-level}" "$1" >&2
  exit 1
}

run_case() {
  case_id=$1
  "$2"
  printf 'PASS %s %s\n' "$1" "$2"
}

test_root=$(CDPATH='' cd -P "$(dirname "$0")/.." && pwd)
praxisbound_workflow="$test_root/.github/workflows/publish.yml"
test_dir=$(mktemp -d "${TMPDIR:-/tmp}/praxisbound-publication-workflow.XXXXXX")
trap 'rm -rf "$test_dir"' EXIT
trap 'exit 1' HUP INT TERM

mkdir "$test_dir/bin"

# Answers only the exact call shapes the publish job's run blocks make.
# Anything else exits 97 so an unexpected call surfaces as a test failure
# rather than a silently wrong result.
cat >"$test_dir/bin/npm" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >>"$FAKE_DIR/npm.log"
case "$1" in
  view)
    coordinate=$2
    field=$3
    case "$field" in
      version)
        if grep -Fqx -- "$coordinate" "$FAKE_DIR/published" 2>/dev/null; then
          printf '%s\n' "${coordinate##*@}"
          exit 0
        fi
        printf 'npm error code E404\nnpm error 404 Not Found\n' >&2
        exit 1
        ;;
      dist.integrity)
        if [ -s "$FAKE_DIR/registry-integrity" ]; then
          cat "$FAKE_DIR/registry-integrity"
          exit 0
        fi
        printf 'npm error code E404\n' >&2
        exit 1
        ;;
      *) printf 'unexpected npm view field: %s\n' "$field" >&2; exit 97 ;;
    esac
    ;;
  publish)
    printf '%s\n' "$*" >>"$FAKE_DIR/publish.log"
    case "$*" in
      *--dry-run*)
        if [ -f "$FAKE_DIR/oidc-success" ]; then
          printf 'npm verbose oidc Successfully retrieved and set token\n' >&2
        else
          printf 'npm verbose oidc could not retrieve a token\n' >&2
        fi
        exit "$(cat "$FAKE_DIR/dry-run-exit-code" 2>/dev/null || printf 0)"
        ;;
      *)
        : >"$FAKE_DIR/real-publish-happened"
        exit 0
        ;;
    esac
    ;;
  *) printf 'unexpected npm call: %s\n' "$*" >&2; exit 97 ;;
esac
EOF
chmod +x "$test_dir/bin/npm"

# Extracts one step's `run: |` block by its exact name. A step header is a
# line indented by six spaces; its body ends at the next such line.
extract_run() {
  awk -v praxisbound_step_header="      - name: $1" '
    $0 == praxisbound_step_header { praxisbound_in_step = 1; praxisbound_in_run = 0; next }
    praxisbound_in_step && /^      - name:/ { praxisbound_in_step = 0; praxisbound_in_run = 0 }
    praxisbound_in_step && /^        run: \|/ { praxisbound_in_run = 1; next }
    praxisbound_in_step && praxisbound_in_run && /^        [A-Za-z_][A-Za-z0-9_-]*:/ { praxisbound_in_run = 0 }
    praxisbound_in_step && praxisbound_in_run { print substr($0, 11) }
  ' "$praxisbound_workflow"
}

make_tarball() {
  # $1 = destination .tgz path, $2 = package.json content
  praxisbound_pack_dir=$(mktemp -d "$test_dir/pack.XXXXXX")
  mkdir "$praxisbound_pack_dir/package"
  printf '%s' "$2" >"$praxisbound_pack_dir/package/package.json"
  (CDPATH='' cd "$praxisbound_pack_dir" && tar -czf "$1" package)
  rm -rf "$praxisbound_pack_dir"
}

digest_of() {
  printf 'sha512-%s' "$(openssl dgst -sha512 -binary "$1" | openssl base64 -A)"
}

reset_world() {
  FAKE_DIR="$test_dir/$1"
  rm -rf "$FAKE_DIR"
  mkdir -p "$FAKE_DIR/workdir/dist/publish"
  : >"$FAKE_DIR/published"
  export FAKE_DIR
}

# Runs one step's extracted run block under sh, with every value the workflow
# would inject through `env:` set exactly as named there; no `${{ }}` is
# interpolated directly into any run body (verified separately below).
run_step() {
  praxisbound_step_name=$1
  extract_run "$praxisbound_step_name" >"$FAKE_DIR/step.sh"
  [ -s "$FAKE_DIR/step.sh" ] || fail "no run block extracted for step: $praxisbound_step_name"
  if (
    CDPATH='' cd "$FAKE_DIR/workdir" &&
      PATH="$test_dir/bin:$PATH" \
        GITHUB_OUTPUT="$FAKE_DIR/github-output" \
        GITHUB_STEP_SUMMARY="$FAKE_DIR/github-summary" \
        sh -e "$FAKE_DIR/step.sh"
  ) >"$FAKE_DIR/stdout" 2>"$FAKE_DIR/stderr"; then
    step_status=0
  else
    step_status=$?
  fi
}

reset_env() {
  unset PACKAGE REHEARSAL NAME VERSION CORE_DEPENDENCY \
    TARBALL TARBALL_NAME EXPECTED_DIGEST DIGEST 2>/dev/null || :
}

# PB005-AC-009 (Security Fixture Matrix: publish.artifact / publish.artifact-digest).
digest_mismatch_is_refused_before_any_npm_command() {
  reset_world digest
  make_tarball "$FAKE_DIR/workdir/dist/publish/tarball.tgz" \
    '{"name":"@praxisbound/core","version":"0.2.0"}'

  reset_env
  export TARBALL_NAME=tarball.tgz
  export EXPECTED_DIGEST='sha512-not-the-real-digest'
  run_step 'Refuse a tarball that does not match the pack job digest'

  [ "$step_status" -ne 0 ] || fail 'a mismatched digest was not refused'
  grep -Fq 'differs from the pack job' "$FAKE_DIR/stderr" ||
    fail "stderr does not explain the digest mismatch: $(cat "$FAKE_DIR/stderr")"
  [ ! -s "$FAKE_DIR/npm.log" ] || fail 'a digest mismatch reached npm before being refused'
}

matching_digest_is_accepted() {
  reset_world digest-ok
  make_tarball "$FAKE_DIR/workdir/dist/publish/tarball.tgz" \
    '{"name":"@praxisbound/core","version":"0.2.0"}'

  reset_env
  export TARBALL_NAME=tarball.tgz
  export EXPECTED_DIGEST=$(digest_of "$FAKE_DIR/workdir/dist/publish/tarball.tgz")
  run_step 'Refuse a tarball that does not match the pack job digest'

  [ "$step_status" -eq 0 ] || fail "a matching digest was refused: $(cat "$FAKE_DIR/stderr")"
  grep -Fq 'tarball=' "$FAKE_DIR/github-output" ||
    fail 'the digest step did not record the verified tarball path'
}

# R4: coordinates come only from the tarball's own package.json, never a
# checkout. Uses an absolute TARBALL path so the step's own cwd is irrelevant.
manifest_step_reads_coordinates_from_the_tarball() {
  reset_world manifest
  make_tarball "$FAKE_DIR/tarball.tgz" \
    '{"name":"@praxisbound/cli","version":"0.3.0","dependencies":{"@praxisbound/core":"0.2.0"}}'

  reset_env
  export TARBALL="$FAKE_DIR/tarball.tgz"
  run_step 'Read package coordinates from the tarball'

  [ "$step_status" -eq 0 ] || fail "manifest read failed: $(cat "$FAKE_DIR/stderr")"
  grep -Fq 'name=@praxisbound/cli' "$FAKE_DIR/github-output" || fail 'manifest step did not read name'
  grep -Fq 'version=0.3.0' "$FAKE_DIR/github-output" || fail 'manifest step did not read version'
  grep -Fq 'core_dependency=0.2.0' "$FAKE_DIR/github-output" ||
    fail 'manifest step did not read the Core dependency'
}

# PB005-AC-004 (Security Fixture Matrix: npm.package-version).
published_version_is_refused_on_a_real_run() {
  reset_world published-real
  printf '@praxisbound/core@0.2.0\n' >"$FAKE_DIR/published"

  reset_env
  export PACKAGE=core REHEARSAL=false
  export NAME=@praxisbound/core VERSION=0.2.0 CORE_DEPENDENCY=
  run_step 'Guard the publication coordinate before any npm command authenticates'

  [ "$step_status" -ne 0 ] || fail 'a real run did not refuse an already-published version'
  grep -Fq 'already exists' "$FAKE_DIR/stderr" ||
    fail "stderr does not explain the refusal: $(cat "$FAKE_DIR/stderr")"
  [ ! -f "$FAKE_DIR/real-publish-happened" ] || fail 'a refused guard still published'
}

# PB005-AC-005: rehearsal reports the same collision instead of enforcing it.
published_version_is_reported_on_rehearsal() {
  reset_world published-rehearsal
  printf '@praxisbound/core@0.2.0\n' >"$FAKE_DIR/published"

  reset_env
  export PACKAGE=core REHEARSAL=true
  export NAME=@praxisbound/core VERSION=0.2.0 CORE_DEPENDENCY=
  run_step 'Guard the publication coordinate before any npm command authenticates'

  [ "$step_status" -eq 0 ] ||
    fail "a rehearsal enforced the unused-version guard: $(cat "$FAKE_DIR/stderr")"
  grep -Fq 'rehearsal:' "$FAKE_DIR/stderr" ||
    fail "rehearsal did not report the already-published coordinate: $(cat "$FAKE_DIR/stderr")"
}

# PB005-AC-004: the guard step must not trust the dispatch input package
# choice; it must refuse when the tarball's own name does not match it, before
# branching any CLI-specific check on that untrusted input.
package_input_mismatched_with_tarball_name_is_refused() {
  reset_world name-mismatch
  : >"$FAKE_DIR/published"

  reset_env
  export PACKAGE=core REHEARSAL=false
  export NAME=@praxisbound/cli VERSION=0.2.0 CORE_DEPENDENCY=0.1.0
  run_step 'Guard the publication coordinate before any npm command authenticates'

  [ "$step_status" -ne 0 ] || fail 'a package=core dispatch with a CLI tarball was not refused'
  grep -Fq 'does not match the dispatched package' "$FAKE_DIR/stderr" ||
    fail "stderr does not explain the name mismatch: $(cat "$FAKE_DIR/stderr")"
  [ ! -f "$FAKE_DIR/real-publish-happened" ] || fail 'a refused guard still published'
  [ ! -s "$FAKE_DIR/npm.log" ] || fail 'a name mismatch reached npm before being refused'
}

# PB005-AC-004: Core-before-CLI.
cli_before_core_is_refused() {
  reset_world order
  : >"$FAKE_DIR/published"

  reset_env
  export PACKAGE=cli REHEARSAL=false
  export NAME=@praxisbound/cli VERSION=0.2.0 CORE_DEPENDENCY=0.2.0
  run_step 'Guard the publication coordinate before any npm command authenticates'

  [ "$step_status" -ne 0 ] || fail 'a CLI dispatched before Core was not refused'
  grep -Fq '@praxisbound/core@0.2.0 is not public' "$FAKE_DIR/stderr" ||
    fail "stderr does not explain the ordering refusal: $(cat "$FAKE_DIR/stderr")"
  [ ! -f "$FAKE_DIR/real-publish-happened" ] || fail 'a refused guard still published'
}

# PB005-AC-004: exact-Core-dependency.
cli_with_a_non_exact_core_dependency_is_refused() {
  reset_world range
  printf '@praxisbound/core@0.2.0\n' >"$FAKE_DIR/published"

  reset_env
  export PACKAGE=cli REHEARSAL=false
  export NAME=@praxisbound/cli VERSION=0.3.0 CORE_DEPENDENCY='^0.2.0'
  run_step 'Guard the publication coordinate before any npm command authenticates'

  [ "$step_status" -ne 0 ] || fail 'a non-exact Core dependency was not refused'
  grep -Fq 'is not an exact version' "$FAKE_DIR/stderr" ||
    fail "stderr does not explain the non-exact dependency: $(cat "$FAKE_DIR/stderr")"
  [ ! -f "$FAKE_DIR/real-publish-happened" ] || fail 'a refused guard still published'
}

cli_with_an_exact_published_core_dependency_is_accepted() {
  reset_world exact
  printf '@praxisbound/core@0.2.0\n' >"$FAKE_DIR/published"

  reset_env
  export PACKAGE=cli REHEARSAL=false
  export NAME=@praxisbound/cli VERSION=0.3.0 CORE_DEPENDENCY=0.2.0
  run_step 'Guard the publication coordinate before any npm command authenticates'

  [ "$step_status" -eq 0 ] ||
    fail "an exact, published Core dependency was refused: $(cat "$FAKE_DIR/stderr")"
}

# PB005-AC-005/AC-009: a real publish step never accepts --dry-run, and it
# refuses outright when rehearsal is true.
real_publish_step_never_runs_when_rehearsal_is_true() {
  reset_world real-guard
  reset_env
  export REHEARSAL=true TARBALL=irrelevant.tgz
  run_step 'Publish to the next tag with provenance'

  [ "$step_status" -ne 0 ] || fail 'the real publish step ran during a rehearsal'
  grep -Fq 'never reaches a real npm publish' "$FAKE_DIR/stderr" ||
    fail "stderr does not explain the refusal: $(cat "$FAKE_DIR/stderr")"
  [ ! -s "$FAKE_DIR/npm.log" ] || fail 'a refused rehearsal still called npm'
}

real_publish_step_publishes_without_dry_run() {
  reset_world real-publish
  make_tarball "$FAKE_DIR/tarball.tgz" '{"name":"@praxisbound/core","version":"0.2.0"}'

  reset_env
  export REHEARSAL=false TARBALL="$FAKE_DIR/tarball.tgz"
  run_step 'Publish to the next tag with provenance'

  [ "$step_status" -eq 0 ] || fail "a real publish was refused: $(cat "$FAKE_DIR/stderr")"
  [ -f "$FAKE_DIR/real-publish-happened" ] || fail 'the real publish step did not call npm publish'
  if grep -Fq -- '--dry-run' "$FAKE_DIR/publish.log"; then
    fail 'the real publish step passed --dry-run'
  fi
}

# PB005-AC-005/AC-009: the rehearsal step always passes --dry-run and fails
# unless the OIDC success line appears.
rehearsal_step_never_runs_when_rehearsal_is_false() {
  reset_world rehearsal-guard
  reset_env
  export REHEARSAL=false TARBALL=irrelevant.tgz
  run_step 'Rehearse the OIDC exchange without publishing'

  [ "$step_status" -ne 0 ] || fail 'the rehearsal step ran outside a rehearsal dispatch'
  grep -Fq 'ran outside a rehearsal dispatch' "$FAKE_DIR/stderr" ||
    fail "stderr does not explain the refusal: $(cat "$FAKE_DIR/stderr")"
  [ ! -s "$FAKE_DIR/npm.log" ] || fail 'a refused rehearsal guard still called npm'
}

rehearsal_without_oidc_success_line_fails() {
  reset_world rehearsal-fail
  make_tarball "$FAKE_DIR/tarball.tgz" '{"name":"@praxisbound/core","version":"0.2.0"}'

  reset_env
  export REHEARSAL=true TARBALL="$FAKE_DIR/tarball.tgz"
  run_step 'Rehearse the OIDC exchange without publishing'

  [ "$step_status" -ne 0 ] || fail 'a rehearsal without the OIDC success line was not failed'
  grep -Fq 'did not show a successful OIDC token exchange' "$FAKE_DIR/stderr" ||
    fail "stderr does not explain the missing OIDC line: $(cat "$FAKE_DIR/stderr")"
  grep -Fq -- '--dry-run' "$FAKE_DIR/publish.log" ||
    fail 'the rehearsal step did not call npm publish --dry-run'
}

rehearsal_with_oidc_success_line_passes() {
  reset_world rehearsal-pass
  make_tarball "$FAKE_DIR/tarball.tgz" '{"name":"@praxisbound/core","version":"0.2.0"}'
  : >"$FAKE_DIR/oidc-success"

  reset_env
  export REHEARSAL=true TARBALL="$FAKE_DIR/tarball.tgz"
  run_step 'Rehearse the OIDC exchange without publishing'

  [ "$step_status" -eq 0 ] ||
    fail "a rehearsal with the OIDC success line still failed: $(cat "$FAKE_DIR/stderr")"
  [ ! -f "$FAKE_DIR/real-publish-happened" ] || fail 'a rehearsal reached a real publish'
  if grep -Fq -- '--dry-run' "$FAKE_DIR/publish.log"; then
    :
  else
    fail 'the rehearsal step did not pass --dry-run'
  fi
}

# `npm publish --dry-run` can exit non-zero for reasons unrelated to OIDC (an
# already-published version, for instance); the rehearsal step must judge the
# OIDC exchange by the log line alone, not by the dry-run's own exit status.
rehearsal_passes_on_a_nonzero_dry_run_exit_with_the_oidc_success_line() {
  reset_world rehearsal-nonzero-pass
  make_tarball "$FAKE_DIR/tarball.tgz" '{"name":"@praxisbound/core","version":"0.2.0"}'
  : >"$FAKE_DIR/oidc-success"
  printf '1\n' >"$FAKE_DIR/dry-run-exit-code"

  reset_env
  export REHEARSAL=true TARBALL="$FAKE_DIR/tarball.tgz"
  run_step 'Rehearse the OIDC exchange without publishing'

  [ "$step_status" -eq 0 ] ||
    fail "a nonzero dry-run with the OIDC success line still failed: $(cat "$FAKE_DIR/stderr")"
  [ ! -f "$FAKE_DIR/real-publish-happened" ] || fail 'a rehearsal reached a real publish'
}

rehearsal_fails_on_a_nonzero_dry_run_exit_without_the_oidc_success_line() {
  reset_world rehearsal-nonzero-fail
  make_tarball "$FAKE_DIR/tarball.tgz" '{"name":"@praxisbound/core","version":"0.2.0"}'
  printf '1\n' >"$FAKE_DIR/dry-run-exit-code"

  reset_env
  export REHEARSAL=true TARBALL="$FAKE_DIR/tarball.tgz"
  run_step 'Rehearse the OIDC exchange without publishing'

  [ "$step_status" -ne 0 ] ||
    fail 'a nonzero dry-run without the OIDC success line was not failed'
  grep -Fq 'did not show a successful OIDC token exchange' "$FAKE_DIR/stderr" ||
    fail "stderr does not explain the missing OIDC line: $(cat "$FAKE_DIR/stderr")"
}

# PB005-AC-009 (Security Fixture Matrix: npm.integrity).
registry_integrity_mismatch_fails_after_publication() {
  reset_world integrity-mismatch
  printf 'sha512-different-from-the-artifact\n' >"$FAKE_DIR/registry-integrity"

  reset_env
  export REHEARSAL=false NAME=@praxisbound/core VERSION=0.2.0 DIGEST='sha512-artifact-digest'
  run_step 'Compare registry integrity with the published digest'

  [ "$step_status" -ne 0 ] || fail 'a registry integrity mismatch was not refused'
  grep -Fq 'differs from artifact digest' "$FAKE_DIR/stderr" ||
    fail "stderr does not explain the mismatch: $(cat "$FAKE_DIR/stderr")"
  grep -Fq 'sha512-artifact-digest' "$FAKE_DIR/github-summary" ||
    fail 'the run summary omits the artifact digest'
  grep -Fq 'sha512-different-from-the-artifact' "$FAKE_DIR/github-summary" ||
    fail 'the run summary omits the registry integrity'
}

registry_integrity_match_passes_and_is_recorded() {
  reset_world integrity-match
  printf 'sha512-artifact-digest\n' >"$FAKE_DIR/registry-integrity"

  reset_env
  export REHEARSAL=false NAME=@praxisbound/core VERSION=0.2.0 DIGEST='sha512-artifact-digest'
  run_step 'Compare registry integrity with the published digest'

  [ "$step_status" -eq 0 ] || fail "a matching registry integrity was refused: $(cat "$FAKE_DIR/stderr")"
}

integrity_step_never_runs_when_rehearsal_is_true() {
  reset_world integrity-guard
  reset_env
  export REHEARSAL=true NAME=@praxisbound/core VERSION=0.2.0 DIGEST='sha512-artifact-digest'
  run_step 'Compare registry integrity with the published digest'

  [ "$step_status" -ne 0 ] || fail 'the integrity comparison ran during a rehearsal'
  [ ! -s "$FAKE_DIR/npm.log" ] || fail 'a refused rehearsal integrity check still called npm'
}

# The workflow must inject every dynamic value through `env:`, never by
# interpolating `${{ }}` directly into run text: an interpolated attacker
# string would otherwise become shell syntax instead of a shell value.
run_bodies_never_interpolate_expressions() {
  praxisbound_offenders=$(awk '
    /^        run: \|/ { in_run = 1; next }
    in_run && /^        [A-Za-z_][A-Za-z0-9_-]*:/ { in_run = 0 }
    in_run && /\$\{\{/ { print }
  ' "$praxisbound_workflow")
  [ -z "$praxisbound_offenders" ] ||
    fail "a run body interpolates \${{ }} directly: $praxisbound_offenders"
}

run_case 'PB005-AC-009' digest_mismatch_is_refused_before_any_npm_command
run_case 'PB005-AC-009' matching_digest_is_accepted
run_case 'PB005-AC-004' manifest_step_reads_coordinates_from_the_tarball
run_case 'PB005-AC-004' published_version_is_refused_on_a_real_run
run_case 'PB005-AC-005' published_version_is_reported_on_rehearsal
run_case 'PB005-AC-004' package_input_mismatched_with_tarball_name_is_refused
run_case 'PB005-AC-004' cli_before_core_is_refused
run_case 'PB005-AC-004' cli_with_a_non_exact_core_dependency_is_refused
run_case 'PB005-AC-004' cli_with_an_exact_published_core_dependency_is_accepted
run_case 'PB005-AC-005' real_publish_step_never_runs_when_rehearsal_is_true
run_case 'PB005-AC-005' real_publish_step_publishes_without_dry_run
run_case 'PB005-AC-005' rehearsal_step_never_runs_when_rehearsal_is_false
run_case 'PB005-AC-005' rehearsal_without_oidc_success_line_fails
run_case 'PB005-AC-005' rehearsal_with_oidc_success_line_passes
run_case 'PB005-AC-005' rehearsal_passes_on_a_nonzero_dry_run_exit_with_the_oidc_success_line
run_case 'PB005-AC-005' rehearsal_fails_on_a_nonzero_dry_run_exit_without_the_oidc_success_line
run_case 'PB005-AC-009' registry_integrity_mismatch_fails_after_publication
run_case 'PB005-AC-009' registry_integrity_match_passes_and_is_recorded
run_case 'PB005-AC-009' integrity_step_never_runs_when_rehearsal_is_true
run_case 'PB005-AC-006' run_bodies_never_interpolate_expressions

printf 'publication-workflow tests passed\n'
