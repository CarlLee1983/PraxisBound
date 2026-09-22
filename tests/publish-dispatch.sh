#!/bin/sh

set -eu

# PB004-AC-009. scripts/publish-dispatch is a human-run helper around the
# publish.yml dispatch. Every GitHub and npm interaction is replaced by a fake
# on PATH, so no case can dispatch a real workflow or reach a registry.

fail() {
  printf 'publish-dispatch test failed [%s]: %s\n' "$case_id" "$1" >&2
  exit 1
}

run_case() {
  case_id=$1
  "$2"
  printf 'PASS %s %s\n' "$1" "$2"
}

test_root=$(CDPATH='' cd -P "$(dirname "$0")/.." && pwd)
test_dir=$(mktemp -d "${TMPDIR:-/tmp}/praxisbound-publish-dispatch.XXXXXX")
trap 'rm -rf "$test_dir"' EXIT
trap 'exit 1' HUP INT TERM

main_sha=e7a87abd52a92ae54b62b7e5ceb438d5219aaf61
other_sha=37c5afb48ab7bcaa97413ce316f4dfb9e6d9a0ff
repository=CarlLee1983/PraxisBound
case_id=setup

mkdir "$test_dir/bin"
# Each fake answers only the exact call shapes the helper makes; anything else
# exits 97, which a refusal assertion then fails on because its stderr does not
# carry the expected explanation.
cat >"$test_dir/bin/gh" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >>"$FAKE_DIR/gh.log"
call="$*"
case "$call" in
  'auth status') exit 0 ;;
  "api repos/$FAKE_REPOSITORY/commits/main --jq .sha")
    # main-later, when present, is what main moves to once main-moves-after
    # reads have happened; the helper reads main twice before confirming.
    reads=$(($(cat "$FAKE_DIR/main-reads" 2>/dev/null || printf 0) + 1))
    printf '%s\n' "$reads" >"$FAKE_DIR/main-reads"
    if [ -f "$FAKE_DIR/main-later" ] && [ "$reads" -gt "$(cat "$FAKE_DIR/main-moves-after")" ]; then
      cat "$FAKE_DIR/main-later"
    else
      cat "$FAKE_DIR/main"
    fi ;;
  "api repos/$FAKE_REPOSITORY/contents/packages/"*"/package.json?ref="*" --jq .content | @base64d | fromjson | .version")
    package=${call#*/contents/packages/}
    package=${package%%/*}
    cat "$FAKE_DIR/version-$package" ;;
  *'--workflow verify.yml'*) cat "$FAKE_DIR/verify" ;;
  *'--workflow publish.yml --limit 20'*) cat "$FAKE_DIR/active" ;;
  *'--workflow publish.yml --event workflow_dispatch'*'max // 0')
    cat "$FAKE_DIR/latest-run" ;;
  *'--workflow publish.yml --event workflow_dispatch'*'select(.databaseId >'*)
    polls=$(($(cat "$FAKE_DIR/polls" 2>/dev/null || printf 0) + 1))
    printf '%s\n' "$polls" >"$FAKE_DIR/polls"
    if [ -f "$FAKE_DIR/dispatched" ] && [ "$polls" -gt "$(cat "$FAKE_DIR/appears-after")" ]; then
      printf '4242\n'
    fi ;;
  'workflow run'*)
    printf '%s\n' "$call" >"$FAKE_DIR/dispatched"
    [ ! -f "$FAKE_DIR/print-url" ] ||
      printf 'https://github.com/%s/actions/runs/4242\n' "$FAKE_REPOSITORY"
    [ ! -f "$FAKE_DIR/publishes" ] || cat "$FAKE_DIR/publishes" >>"$FAKE_DIR/published" ;;
  "run watch 4242 --repo $FAKE_REPOSITORY --exit-status") exit "$(cat "$FAKE_DIR/watch")" ;;
  "run view 4242 --repo $FAKE_REPOSITORY --json status,conclusion --jq "*) cat "$FAKE_DIR/view" ;;
  *"api repos/$FAKE_REPOSITORY/environments/npm-publication --jq "*)
    [ ! -f "$FAKE_DIR/environment-missing" ] || exit 1
    cat "$FAKE_DIR/environment-protection-count" ;;
  *) printf 'unexpected gh call: %s\n' "$call" >&2; exit 97 ;;
esac
EOF
cat >"$test_dir/bin/npm" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >>"$FAKE_DIR/npm.log"
[ "$1" = view ] && [ "$3" = version ] || { printf 'unexpected npm call\n' >&2; exit 97; }
if [ -f "$FAKE_DIR/registry-down" ]; then
  printf 'npm error code ETIMEDOUT\n' >&2
  exit 1
fi
if grep -Fqx -- "$2" "$FAKE_DIR/published" 2>/dev/null; then
  printf '%s\n' "${2##*@}"
else
  printf 'npm error code E404\nnpm error 404 Not Found\n' >&2
  exit 1
fi
EOF
chmod +x "$test_dir/bin/gh" "$test_dir/bin/npm"

# A fresh fake world: main at the candidate, verify green, nothing running,
# both packages at 0.3.0 in source, only 0.2.0 on the registry.
reset_world() {
  FAKE_DIR="$test_dir/$1"
  rm -rf "$FAKE_DIR"
  mkdir "$FAKE_DIR"
  printf '%s\n' "$main_sha" >"$FAKE_DIR/main"
  printf 'completed success\n' >"$FAKE_DIR/verify"
  printf '0\n' >"$FAKE_DIR/active"
  printf '4100\n' >"$FAKE_DIR/latest-run"
  printf '0.3.0\n' >"$FAKE_DIR/version-core"
  printf '0.3.0\n' >"$FAKE_DIR/version-cli"
  printf '0\n' >"$FAKE_DIR/watch"
  printf 'completed success\n' >"$FAKE_DIR/view"
  printf '0\n' >"$FAKE_DIR/appears-after"
  : >"$FAKE_DIR/print-url"
  printf '@praxisbound/core@0.2.0\n@praxisbound/cli@0.2.0\n' >"$FAKE_DIR/published"
  printf '1\n' >"$FAKE_DIR/environment-protection-count"
  export FAKE_DIR
}

dispatch() {
  confirmation=$1
  shift
  if printf '%s\n' "$confirmation" | env PATH="$test_dir/bin:$PATH" \
    FAKE_REPOSITORY="$repository" PRAXISBOUND_REPOSITORY="$repository" \
    PRAXISBOUND_PUBLISH_POLL_SECONDS=0 PRAXISBOUND_PUBLISH_POLL_ATTEMPTS=3 \
    "$test_root/scripts/publish-dispatch" "$@" \
    >"$FAKE_DIR/stdout" 2>"$FAKE_DIR/stderr"; then
    status=0
  else
    status=$?
  fi
}

expect_refusal() {
  [ "$status" -eq "$1" ] ||
    fail "exited $status, expected $1: $(cat "$FAKE_DIR/stderr")"
  [ ! -e "$FAKE_DIR/dispatched" ] || fail 'a refused invocation dispatched publish.yml'
  grep -Fq -- "$2" "$FAKE_DIR/stderr" ||
    fail "stderr does not explain the refusal ($2): $(cat "$FAKE_DIR/stderr")"
}

usage_errors_dispatch_nothing() {
  reset_world usage
  dispatch '' ; expect_refusal 2 'usage'
  dispatch '' docs ; expect_refusal 2 'usage'
  dispatch '' core e7a87ab ; expect_refusal 2 'full 40-character lowercase SHA'
  dispatch '' core E7A87ABD52A92AE54B62B7E5CEB438D5219AAF61 ; expect_refusal 2 'full 40-character lowercase SHA'
  dispatch '' core "$main_sha" extra ; expect_refusal 2 'usage'
}

moved_main_is_refused() {
  reset_world moved
  dispatch '' core "$other_sha"
  expect_refusal 1 'main is at'
}

unverified_candidate_is_refused() {
  reset_world unverified
  printf 'in_progress \n' >"$FAKE_DIR/verify"
  dispatch '' core
  expect_refusal 1 'verify.yml'
}

concurrent_publication_is_refused() {
  reset_world concurrent
  printf '1\n' >"$FAKE_DIR/active"
  dispatch '' core
  expect_refusal 1 'already in progress'
}

published_version_is_refused() {
  reset_world published
  printf '@praxisbound/core@0.3.0\n' >>"$FAKE_DIR/published"
  dispatch '' core
  expect_refusal 1 'already published'
}

cli_before_core_is_refused() {
  reset_world order
  dispatch '' cli
  expect_refusal 1 '@praxisbound/core@0.3.0 is not published'
}

# PB005-AC-007 (Security Fixture Matrix: publish.environment-approval, helper
# precondition). GitHub auto-creates a referenced environment without any
# protection rule, so the helper must refuse before ever dispatching rather
# than rely on the environment existing and being protected.
missing_environment_is_refused() {
  reset_world missing-environment
  : >"$FAKE_DIR/environment-missing"
  dispatch '' core
  expect_refusal 1 'does not exist or is unreachable'
}

unprotected_environment_is_refused() {
  reset_world unprotected-environment
  printf '0\n' >"$FAKE_DIR/environment-protection-count"
  dispatch '' core
  expect_refusal 1 'no required-reviewer protection rule'
}

wrong_confirmation_is_refused() {
  reset_world confirmation
  dispatch 'yes' core
  expect_refusal 1 'not confirmed'
}

confirmed_core_dispatch_is_exact() {
  reset_world core
  printf '@praxisbound/core@0.3.0\n' >"$FAKE_DIR/publishes"
  dispatch 'publish @praxisbound/core@0.3.0' core
  [ "$status" -eq 0 ] || fail "exited $status: $(cat "$FAKE_DIR/stderr")"
  [ "$(cat "$FAKE_DIR/dispatched")" = \
    "workflow run publish.yml --repo $repository --ref main -f candidate_sha=$main_sha -f package=core" ] ||
    fail "dispatch arguments were not exact: $(cat "$FAKE_DIR/dispatched")"
  grep -Fqx "run watch 4242 --repo $repository --exit-status" "$FAKE_DIR/gh.log" ||
    fail 'the dispatched run was not watched'
  grep -Fq 'scripts/publish-dispatch cli' "$FAKE_DIR/stdout" ||
    fail 'a Core publication does not point at the CLI dispatch'
}

# PB005-AC-007. Every dispatch, including a confirmed one, now waits for a
# human to approve the GitHub environment npm-publication before the publish
# job runs; the helper must say so, with the run URL, before it starts
# watching, so the operator does not mistake the pause for a hang.
confirmed_dispatch_prints_the_environment_approval_notice() {
  reset_world approval
  printf '@praxisbound/core@0.3.0\n' >"$FAKE_DIR/publishes"
  dispatch 'publish @praxisbound/core@0.3.0' core
  [ "$status" -eq 0 ] || fail "exited $status: $(cat "$FAKE_DIR/stderr")"
  grep -Fq 'awaits approval of environment npm-publication' "$FAKE_DIR/stdout" ||
    fail "stdout does not mention the npm-publication approval: $(cat "$FAKE_DIR/stdout")"
  grep -Fq "https://github.com/$repository/actions/runs/4242" "$FAKE_DIR/stdout" ||
    fail "stdout does not print the run URL: $(cat "$FAKE_DIR/stdout")"
}

confirmed_cli_dispatch_points_at_promotion() {
  reset_world cli
  printf '@praxisbound/core@0.3.0\n' >>"$FAKE_DIR/published"
  printf '@praxisbound/cli@0.3.0\n' >"$FAKE_DIR/publishes"
  dispatch 'publish @praxisbound/cli@0.3.0' cli "$main_sha"
  [ "$status" -eq 0 ] || fail "exited $status: $(cat "$FAKE_DIR/stderr")"
  grep -Fq 'package=cli' "$FAKE_DIR/dispatched" || fail 'CLI was not dispatched'
  grep -Fq 'npm dist-tag add' "$FAKE_DIR/stdout" ||
    fail 'a CLI publication does not point at the human latest promotion'
  if grep -Fq 'dist-tag' "$FAKE_DIR/npm.log"; then
    fail 'the helper wrote a dist-tag'
  fi
}

failed_workflow_is_reported() {
  reset_world failed
  printf '1\n' >"$FAKE_DIR/watch"
  printf 'completed failure\n' >"$FAKE_DIR/view"
  dispatch 'publish @praxisbound/core@0.3.0' core
  [ "$status" -eq 1 ] || fail "exited $status, expected 1"
  grep -Fq 'publish.yml run 4242 did not succeed (completed failure)' "$FAKE_DIR/stderr" ||
    fail "stderr does not name the failed run: $(cat "$FAKE_DIR/stderr")"
}

lost_watch_is_not_reported_as_failure() {
  reset_world lost
  printf '1\n' >"$FAKE_DIR/watch"
  printf 'in_progress \n' >"$FAKE_DIR/view"
  dispatch 'publish @praxisbound/core@0.3.0' core
  [ "$status" -eq 1 ] || fail "exited $status, expected 1"
  grep -Fq 'lost track of publish.yml run 4242' "$FAKE_DIR/stderr" ||
    fail "a broken watch was not distinguished from a failed run: $(cat "$FAKE_DIR/stderr")"
}

unpropagated_registry_is_reported() {
  reset_world propagation
  dispatch 'publish @praxisbound/core@0.3.0' core
  [ "$status" -eq 1 ] || fail "exited $status, expected 1"
  grep -Fq 'registry does not show @praxisbound/core@0.3.0' "$FAKE_DIR/stderr" ||
    fail "stderr does not report the missing registry version: $(cat "$FAKE_DIR/stderr")"
}

registry_outage_is_not_unpublished() {
  reset_world outage
  : >"$FAKE_DIR/registry-down"
  dispatch 'publish @praxisbound/core@0.3.0' core
  expect_refusal 1 'cannot read @praxisbound/core@0.3.0 from the registry'
  if grep -Fq 'already published' "$FAKE_DIR/stderr"; then
    fail 'a registry outage was reported as an existing version'
  fi
}

main_moving_during_confirmation_is_refused() {
  reset_world moving
  printf '%s\n' "$other_sha" >"$FAKE_DIR/main-later"
  printf '2\n' >"$FAKE_DIR/main-moves-after"
  dispatch 'publish @praxisbound/core@0.3.0' core
  expect_refusal 1 "main is at $other_sha"
  grep -Fq 'Type "publish @praxisbound/core@0.3.0" to dispatch' "$FAKE_DIR/stdout" ||
    fail 'main moved before confirmation, so the post-confirmation re-check was not exercised'
}

run_found_by_polling_without_url() {
  reset_world polling
  rm "$FAKE_DIR/print-url"
  printf '2\n' >"$FAKE_DIR/appears-after"
  printf '@praxisbound/core@0.3.0\n' >"$FAKE_DIR/publishes"
  dispatch 'publish @praxisbound/core@0.3.0' core
  [ "$status" -eq 0 ] || fail "exited $status: $(cat "$FAKE_DIR/stderr")"
  [ "$(cat "$FAKE_DIR/polls")" -eq 3 ] ||
    fail "the run was not found on the poll it appeared: $(cat "$FAKE_DIR/polls")"
}

run_that_never_appears_is_reported() {
  reset_world vanished
  rm "$FAKE_DIR/print-url"
  printf '99\n' >"$FAKE_DIR/appears-after"
  dispatch 'publish @praxisbound/core@0.3.0' core
  [ "$status" -eq 1 ] || fail "exited $status, expected 1"
  grep -Fq 'did not appear' "$FAKE_DIR/stderr" ||
    fail "stderr does not report the missing run: $(cat "$FAKE_DIR/stderr")"
}

run_case 'PB004-AC-009' usage_errors_dispatch_nothing
run_case 'PB004-AC-009' moved_main_is_refused
run_case 'PB004-AC-009' unverified_candidate_is_refused
run_case 'PB004-AC-009' concurrent_publication_is_refused
run_case 'PB004-AC-009' published_version_is_refused
run_case 'PB004-AC-009' cli_before_core_is_refused
run_case 'PB005-AC-007' missing_environment_is_refused
run_case 'PB005-AC-007' unprotected_environment_is_refused
run_case 'PB004-AC-009' wrong_confirmation_is_refused
run_case 'PB004-AC-009' confirmed_core_dispatch_is_exact
run_case 'PB005-AC-007' confirmed_dispatch_prints_the_environment_approval_notice
run_case 'PB004-AC-009' confirmed_cli_dispatch_points_at_promotion
run_case 'PB004-AC-009' failed_workflow_is_reported
run_case 'PB004-AC-009' unpropagated_registry_is_reported
run_case 'PB004-AC-009' lost_watch_is_not_reported_as_failure
run_case 'PB004-AC-009' registry_outage_is_not_unpublished
run_case 'PB004-AC-009' main_moving_during_confirmation_is_refused
run_case 'PB004-AC-009' run_found_by_polling_without_url
run_case 'PB004-AC-009' run_that_never_appears_is_reported
