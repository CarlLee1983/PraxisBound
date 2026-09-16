#!/bin/sh

set -eu

fail() {
  printf 'portability test failed [%s]: %s\n' "$forgeflow_case_id" "$1" >&2
  exit 1
}

run_case() {
  forgeflow_case_id=$1
  forgeflow_case_function=$2

  "$forgeflow_case_function"
  printf 'PASS %s %s\n' "$forgeflow_case_id" "$forgeflow_case_function"
}

validate_shell() {
  case "$forgeflow_portability_shell" in
    /*) ;;
    *) fail 'PORTABILITY_SHELL must name an absolute executable shell' ;;
  esac
  case "$forgeflow_portability_shell" in
    *[!ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_./-]*)
      fail 'PORTABILITY_SHELL contains an unsafe shebang character'
      ;;
  esac

  [ -x "$forgeflow_portability_shell" ] ||
    fail 'PORTABILITY_SHELL is not executable'
  "$forgeflow_portability_shell" -c ':' ||
    fail 'PORTABILITY_SHELL cannot execute a successful command'
  if "$forgeflow_portability_shell" -c 'exit 1'; then
    fail 'PORTABILITY_SHELL does not preserve a nonzero exit status'
  fi
}

forgeflow_repo=$(CDPATH='' cd -P "$(dirname "$0")/.." >/dev/null 2>&1 && pwd)
forgeflow_portability_shell=${PORTABILITY_SHELL:-}
forgeflow_test_dir=$(mktemp -d "${TMPDIR:-/tmp}/forgeflow-portability.XXXXXX")
forgeflow_copy="$forgeflow_test_dir/source"
forgeflow_production_scripts='bootstrap doctor story-check handoff-check release-check verification-check codex-activate'
forgeflow_behavior_suites='bootstrap doctor story-check handoff-check execution-governance codex-activation'

unset GIT_DIR GIT_WORK_TREE GIT_COMMON_DIR GIT_INDEX_FILE GIT_OBJECT_DIRECTORY
unset GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_CEILING_DIRECTORIES
unset GIT_DISCOVERY_ACROSS_FILESYSTEM GIT_NAMESPACE GIT_PREFIX
unset GIT_CONFIG_PARAMETERS GIT_TEMPLATE_DIR
GIT_CONFIG_GLOBAL=/dev/null
GIT_CONFIG_NOSYSTEM=1
GIT_CONFIG_COUNT=0
export GIT_CONFIG_GLOBAL GIT_CONFIG_NOSYSTEM GIT_CONFIG_COUNT

cleanup() {
  rm -rf "$forgeflow_test_dir"
}

trap cleanup EXIT
trap 'exit 1' HUP INT TERM

selected_shell_is_real() {
  validate_shell

  if (
    forgeflow_portability_shell="$forgeflow_test_dir/not-a-shell"
    validate_shell
  ) >/dev/null 2>&1; then
    fail 'an invalid selected shell passed validation'
  fi

  if make -C "$forgeflow_repo" verify-portability PORTABILITY_SHELL=/bin/true \
    >/dev/null 2>&1; then
    fail '/bin/true produced a false portability PASS'
  fi
}

copy_source_tree() {
  mkdir -p "$forgeflow_copy"
  (
    CDPATH='' cd "$forgeflow_repo"
    git ls-files --cached --others --exclude-standard
  ) | while IFS= read -r forgeflow_path
  do
    [ -n "$forgeflow_path" ] || continue
    [ -e "$forgeflow_repo/$forgeflow_path" ] || continue
    mkdir -p "$(dirname "$forgeflow_copy/$forgeflow_path")"
    cp -p "$forgeflow_repo/$forgeflow_path" "$forgeflow_copy/$forgeflow_path"
  done
}

prepare_clean_git_fixture() {
  (
    git init -q "$forgeflow_copy"
    git -C "$forgeflow_copy" add -A
    git -C "$forgeflow_copy" -c user.name='ForgeFlow Portability' \
      -c user.email='forgeflow-portability@example.invalid' \
      -c commit.gpgSign=false -c core.hooksPath=/dev/null \
      commit -q -m 'portability fixture'
    [ -z "$(git -C "$forgeflow_copy" status --porcelain)" ] ||
      exit 1
  ) || fail 'could not create a clean isolated Git fixture'
}

rewrite_production_shebangs() {
  for forgeflow_script in $forgeflow_production_scripts
  do
    forgeflow_source="$forgeflow_repo/scripts/$forgeflow_script"
    forgeflow_copied="$forgeflow_copy/scripts/$forgeflow_script"
    forgeflow_original="$forgeflow_test_dir/$forgeflow_script.original"
    forgeflow_source_body="$forgeflow_test_dir/$forgeflow_script.source"
    forgeflow_copied_body="$forgeflow_test_dir/$forgeflow_script.copied"

    cp -p "$forgeflow_source" "$forgeflow_original"
    sed '1d' "$forgeflow_source" >"$forgeflow_source_body"
    {
      printf '#!%s\n' "$forgeflow_portability_shell"
      sed '1d' "$forgeflow_source"
    } >"$forgeflow_copied"
    chmod +x "$forgeflow_copied"
    sed '1d' "$forgeflow_copied" >"$forgeflow_copied_body"
    cmp "$forgeflow_source_body" "$forgeflow_copied_body" >/dev/null ||
      fail "copied $forgeflow_script body changed"
    [ "$(sed -n '1p' "$forgeflow_copied")" = \
      "#!$forgeflow_portability_shell" ] ||
      fail "copied $forgeflow_script lacks the selected shebang"
    printf 'Portability shell: %s -> scripts/%s\n' \
      "$forgeflow_portability_shell" "$forgeflow_script"
  done
}

source_scripts_remain_unchanged() {
  for forgeflow_script in $forgeflow_production_scripts
  do
    cmp "$forgeflow_test_dir/$forgeflow_script.original" \
      "$forgeflow_repo/scripts/$forgeflow_script" >/dev/null ||
      fail "source $forgeflow_script changed"
  done
}

canonical_verify_keeps_existing_dependencies() {
  grep -Fqx 'verify: verify-protocol verify-bootstrap verify-doctor verify-story verify-handoff verify-release verify-typescript verify-go verify-actions verify-execution verify-tooling verify-praxisbound' \
    "$forgeflow_repo/Makefile" || fail 'canonical verify dependencies changed'
  grep -Fqx 'release-check: verify' "$forgeflow_repo/Makefile" ||
    fail 'release-check no longer depends on canonical verify'
}

copied_scripts_use_selected_shell() {
  copy_source_tree
  rewrite_production_shebangs
  prepare_clean_git_fixture
}

selected_shell_runs_existing_behavior_suites() {
  for forgeflow_suite in $forgeflow_behavior_suites
  do
    "$forgeflow_portability_shell" "$forgeflow_copy/tests/$forgeflow_suite.sh"
  done
  source_scripts_remain_unchanged
}

release_wrapper_is_portable_without_node() {
  forgeflow_stdout="$forgeflow_test_dir/release.stdout"
  forgeflow_stderr="$forgeflow_test_dir/release.stderr"
  mkdir "$forgeflow_test_dir/no-node"
  forgeflow_status=0
  PATH="$forgeflow_test_dir/no-node" \
    "$forgeflow_portability_shell" "$forgeflow_copy/scripts/release-check" \
    >"$forgeflow_stdout" 2>"$forgeflow_stderr" || forgeflow_status=$?
  [ "$forgeflow_status" -eq 1 ] ||
    fail 'release wrapper did not fail with readiness status without Node'
  [ ! -s "$forgeflow_stdout" ] ||
    fail 'release wrapper emitted success without Node'
  grep -Fqx 'release check failed: NODE_UNAVAILABLE' "$forgeflow_stderr" ||
    fail 'release wrapper did not sanitize missing Node'
}

portability_ci_is_separate_and_pinned() {
  grep -Fq 'portability:' "$forgeflow_repo/.github/workflows/verify.yml" ||
    fail 'workflow lacks a portability job'
  grep -Fq 'macos-latest' "$forgeflow_repo/.github/workflows/verify.yml" ||
    fail 'workflow lacks macOS portability coverage'
  grep -Fq 'ubuntu-latest' "$forgeflow_repo/.github/workflows/verify.yml" ||
    fail 'workflow lacks Ubuntu portability coverage'
  grep -Fq '/bin/dash' "$forgeflow_repo/.github/workflows/verify.yml" ||
    fail 'workflow lacks dash coverage'
  grep -Fq 'timeout-minutes: 15' "$forgeflow_repo/.github/workflows/verify.yml" ||
    fail 'portability job lacks its timeout'
}

portability_coverage_is_documented() {
  grep -Fq 'verify-portability' "$forgeflow_repo/README.md" ||
    fail 'README omits the portability command'
  grep -Fq '/bin/dash' "$forgeflow_repo/README.md" ||
    fail 'README omits configured dash coverage'
  grep -Fq 'Remote CI results remain unverified' "$forgeflow_repo/README.md" ||
    fail 'README overstates unobserved remote CI'
}

run_case 'FF220-AC-001' canonical_verify_keeps_existing_dependencies
run_case 'FF220-AC-002' selected_shell_is_real
run_case 'FF220-AC-003' copied_scripts_use_selected_shell
run_case 'FF220-AC-003' release_wrapper_is_portable_without_node
run_case 'FF220-AC-002' selected_shell_runs_existing_behavior_suites
run_case 'FF220-AC-004' portability_ci_is_separate_and_pinned
run_case 'FF220-AC-005' portability_coverage_is_documented

printf 'portability tests passed\n'
