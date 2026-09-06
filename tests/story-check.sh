#!/bin/sh

set -eu

fail() {
  printf 'story-check test failed [%s]: %s\n' "$forgeflow_case_id" "$1" >&2
  exit 1
}

assert_status() {
  forgeflow_expected_status=$1

  if [ "$forgeflow_command_status" -ne "$forgeflow_expected_status" ]; then
    fail "expected exit $forgeflow_expected_status, got $forgeflow_command_status"
  fi
}

assert_output_contains() {
  grep -Fq -- "$1" "$forgeflow_command_output" ||
    fail "output is missing: $1"
}

assert_output_excludes() {
  if grep -Fq -- "$1" "$forgeflow_command_output"; then
    fail "output must not contain: $1"
  fi
}

run_story_check() {
  forgeflow_command_output="$forgeflow_test_dir/$forgeflow_case_id.output"

  if "$forgeflow_story_check" "$@" >"$forgeflow_command_output" 2>&1; then
    forgeflow_command_status=0
  else
    forgeflow_command_status=$?
  fi
}

run_case() {
  forgeflow_case_id=$1
  forgeflow_case_function=$2

  "$forgeflow_case_function"
  printf 'PASS %s %s\n' "$forgeflow_case_id" "$forgeflow_case_function"
}

new_story() {
  forgeflow_story_dir="$forgeflow_test_dir/$forgeflow_case_id-$1"
  forgeflow_story_security=$2
  forgeflow_story_baseline=$3

  rm -rf "$forgeflow_story_dir"
  mkdir -p "$forgeflow_story_dir"

  cat >"$forgeflow_story_dir/story.md" <<'FORGEFLOW_FIXTURE'
# Story: TST-001 Fixture Story

## Goal

Provide a deterministic Story fixture.

## Context

Fixture context.

## Classification

FORGEFLOW_FIXTURE

  printf '* Security sensitive: %s\n' "$forgeflow_story_security" \
    >>"$forgeflow_story_dir/story.md"
  printf '* Baseline conformance: %s\n\n' "$forgeflow_story_baseline" \
    >>"$forgeflow_story_dir/story.md"

  cat >>"$forgeflow_story_dir/story.md" <<'FORGEFLOW_FIXTURE'
## Scope

### In Scope

* Fixture behavior.

### Out of Scope

* Everything else.

## Inputs

* Fixture input.

## Outputs

* Fixture output.

## Rules

* R1: Fixture rule.

## Expected Errors

* Fixture error.

## Dependencies

* None.

## Constraints

* None.
FORGEFLOW_FIXTURE

  cat >"$forgeflow_story_dir/acceptance.md" <<'FORGEFLOW_FIXTURE'
# Acceptance Criteria

## Happy Path

* [ ] AC-001: Fixture happy path.

## Business Rules

* [ ] AC-002: Fixture business rule.

## Failure Cases

* [ ] AC-003: Fixture failure case.

## Regression Requirements

* [ ] AC-004: Fixture regression.
FORGEFLOW_FIXTURE

  add_acceptance_evidence AC-001 AC-002 AC-003 AC-004

  cat >>"$forgeflow_story_dir/acceptance.md" <<'FORGEFLOW_FIXTURE'

## Verification Notes

Fixture verification notes.
FORGEFLOW_FIXTURE
}

add_acceptance_evidence() {
  printf '\n## Acceptance Evidence\n\n' >>"$forgeflow_story_dir/acceptance.md"
  printf '| AC | Method | Evidence | Fixture / precondition | Expected observation |\n' \
    >>"$forgeflow_story_dir/acceptance.md"
  printf '| --- | --- | --- | --- | --- |\n' >>"$forgeflow_story_dir/acceptance.md"
  for forgeflow_evidence_ac in "$@"
  do
    printf '| `%s` | test | `tests/story-check.sh` | `fixture` | `passes` |\n' \
      "$forgeflow_evidence_ac" >>"$forgeflow_story_dir/acceptance.md"
  done
}

add_story_section() {
  printf '\n%s\n\n' "$1" >>"$forgeflow_story_dir/story.md"
  shift

  for forgeflow_section_entry in "$@"
  do
    printf '%s\n' "$forgeflow_section_entry" >>"$forgeflow_story_dir/story.md"
  done
}

add_matrix() {
  {
    printf '\n## Security Fixture Matrix\n\n'
    printf '| Source field | Payload | Expected result | Persisted locations | Verification |\n'
    printf '| --- | --- | --- | --- | --- |\n'

    for forgeflow_matrix_row in "$@"
    do
      printf '%s\n' "$forgeflow_matrix_row"
    done
  } >>"$forgeflow_story_dir/acceptance.md"
}

complete_security_story() {
  new_story "$1" yes no
  add_story_section '## Trust Boundary Fields' \
    '* `request.sql` — the raw statement supplied by the caller'
  add_matrix "$forgeflow_valid_row"
}

add_matrix_with_separator() {
  forgeflow_matrix_separator_row=$1
  shift

  {
    printf '\n## Security Fixture Matrix\n\n'
    printf '| Source field | Payload | Expected result | Persisted locations | Verification |\n'
    printf '%s\n' "$forgeflow_matrix_separator_row"

    for forgeflow_matrix_row in "$@"
    do
      printf '%s\n' "$forgeflow_matrix_row"
    done
  } >>"$forgeflow_story_dir/acceptance.md"
}

run_story_check_without_utilities() {
  forgeflow_empty_path="$forgeflow_test_dir/empty-path"
  mkdir -p "$forgeflow_empty_path"
  forgeflow_command_output="$forgeflow_test_dir/$forgeflow_case_id.no-path"

  if PATH="$forgeflow_empty_path" "$forgeflow_story_check" "$@" \
    >"$forgeflow_command_output" 2>&1; then
    forgeflow_command_status=0
  else
    forgeflow_command_status=$?
  fi
}

assert_same_story_verdict_without_utilities() {
  forgeflow_normal_output="$forgeflow_test_dir/$forgeflow_case_id.normal"

  run_story_check "$@"
  cp "$forgeflow_command_output" "$forgeflow_normal_output"
  forgeflow_normal_status=$forgeflow_command_status

  run_story_check_without_utilities "$@"

  if [ "$forgeflow_command_status" -ne "$forgeflow_normal_status" ]; then
    fail "an empty PATH changed the exit status from $forgeflow_normal_status to $forgeflow_command_status"
  fi

  cmp "$forgeflow_normal_output" "$forgeflow_command_output" >/dev/null ||
    fail 'an empty PATH changed the output'
}

the_story_verdict_does_not_depend_on_external_utilities() {
  complete_security_story empty-path
  assert_same_story_verdict_without_utilities "$forgeflow_story_dir"
  assert_status 0
  assert_output_contains 'Result: STORY_CONTRACT_OK'
}

an_incomplete_story_verdict_does_not_depend_on_external_utilities() {
  new_story empty-path-incomplete yes no
  assert_same_story_verdict_without_utilities "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'Result: STORY_CONTRACT_INCOMPLETE'
}

assert_separator_accepted() {
  new_story "sep-ok-$2" yes no
  add_story_section '## Trust Boundary Fields' \
    '* `request.sql` — the raw statement supplied by the caller'
  add_matrix_with_separator "$1" "$forgeflow_valid_row"
  run_story_check "$forgeflow_story_dir"
  assert_status 0
  assert_output_contains 'Result: STORY_CONTRACT_OK'
}

assert_separator_rejected() {
  new_story "sep-bad-$2" yes no
  add_story_section '## Trust Boundary Fields' \
    '* `request.sql` — the raw statement supplied by the caller'
  add_matrix_with_separator "$1" "$forgeflow_valid_row"
  run_story_check "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'five-column separator row'
}

usage_and_incomplete_results_survive_an_empty_path() {
  new_story empty-path-usage no no
  assert_same_story_verdict_without_utilities "$forgeflow_test_dir/missing-story"
  assert_status 2

  assert_same_story_verdict_without_utilities --unknown
  assert_status 2
  assert_output_contains 'Usage:'
}

the_builtin_guarantee_is_documented() {
  grep -Fq 'shell builtins alone' "$forgeflow_repo/docs/contract-checks.md" ||
    fail 'docs/contract-checks.md does not state the builtin-only guarantee'
  grep -Fq 'share' "$forgeflow_repo/docs/doctor.md" ||
    fail 'docs/doctor.md does not say the checkers share the guarantee'
  grep -Fq "Doctor's builtin-only" "$forgeflow_repo/docs/doctor.md" ||
    fail 'docs/doctor.md no longer names the property it says is shared'
  if grep -Fq 'builtin-only property is Doctor' \
    "$forgeflow_repo/docs/doctor.md"; then
    fail 'docs/doctor.md still claims the guarantee is Doctor own'
  fi
}

story_check_uses_no_external_utilities() {
  # Tests may use external commands; the scripts under test may not. This scan
  # is a tripwire that names the utilities these scripts once used, not proof of
  # the guarantee: the empty-PATH cases are what establish it. Comment lines are
  # dropped after numbering so a reported line refers to the file.
  forgeflow_scan_output="$forgeflow_test_dir/$forgeflow_case_id.scan"

  grep -nE '(^|[ 	(|&;`]|\$\()(grep|sed|awk|sort|uniq|tr|cut|head|tail|wc|expr|cat|find|basename|dirname|readlink|stat|date|mktemp|xargs|git)([ 	]|$)' \
    "$forgeflow_story_check" | grep -v '^[0-9][0-9]*:[[:space:]]*#' \
    >"$forgeflow_scan_output" || :

  if [ -s "$forgeflow_scan_output" ]; then
    fail "the script still calls an external utility: $(cat "$forgeflow_scan_output")"
  fi
}

the_matrix_separator_form_is_unchanged() {
  assert_separator_accepted '| --- | --- | --- | --- | --- |' 1
  assert_separator_accepted '|---|---|---|---|---|' 2
  assert_separator_accepted '| :---: | :--- | ---: | --- | :---: |' 3
  assert_separator_accepted '| - | - | - | - | - |' 4

  assert_separator_rejected '| --- | --- | --- | --- |' 1
  assert_separator_rejected '| --- | --- | --- | --- | --- | --- |' 2
  assert_separator_rejected '--- | --- | --- | --- | --- |' 3
  assert_separator_rejected '| --- | --- | text | --- | --- |' 4
  assert_separator_rejected '| :: | --- | --- | --- | --- |' 5
  assert_separator_rejected '| ---x | --- | --- | --- | --- |' 6
  assert_separator_rejected '| -:- | --- | --- | --- | --- |' 7
  assert_separator_rejected '| --- - | --- | --- | --- | --- |' 8
}

forgeflow_test_dir=$(mktemp -d "${TMPDIR:-/tmp}/forgeflow-story-check.XXXXXX")

cleanup() {
  chmod -R u+rwX "$forgeflow_test_dir" 2>/dev/null || :
  rm -rf "$forgeflow_test_dir"
}

trap cleanup EXIT
trap 'exit 1' HUP INT TERM

forgeflow_repo=$(
  cd -P "$(dirname "$0")/.." >/dev/null 2>&1
  pwd
)
forgeflow_story_check="$forgeflow_repo/scripts/story-check"
forgeflow_valid_row='| `request.sql` | `password=hunter2` | redact | `artifact.summary` | `tests/story-check.sh` |'

complete_security_story_passes() {
  complete_security_story ok
  run_story_check "$forgeflow_story_dir"
  assert_status 0
  assert_output_contains 'Result: STORY_CONTRACT_OK'
  assert_output_contains 'security=yes'
  assert_output_contains 'Stories checked: 1'
}

unclassified_story_needs_no_security_sections() {
  new_story plain no no
  run_story_check "$forgeflow_story_dir"
  assert_status 0
  assert_output_contains 'Result: STORY_CONTRACT_OK'
  assert_output_excludes 'FAIL'
}

prose_fixture_cells_are_rejected() {
  new_story prose yes no
  add_story_section '## Trust Boundary Fields' \
    '* `request.sql` — the raw statement supplied by the caller'
  add_matrix \
    '| `request.sql` | no credentials | redact | `artifact.summary` | `tests/story-check.sh` |' \
    '| `request.sql` | `password=hunter2` | redact | the stored artifact | run the suite |'
  run_story_check "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'Result: STORY_CONTRACT_INCOMPLETE'
  assert_output_contains 'row 1 states payload as prose'
  assert_output_contains 'row 2 states persisted locations as prose'
  assert_output_contains 'row 2 states verification as prose'

  new_story empty-literal yes no
  add_story_section '## Trust Boundary Fields' \
    '* `request.sql` — the raw statement supplied by the caller'
  add_matrix '| `` | `` | redact | `` | `` |'
  run_story_check "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'row 1 states payload as prose'

  new_story markup-payload yes no
  add_story_section '## Trust Boundary Fields' \
    '* `comment.body` — the untrusted comment supplied by the caller'
  add_matrix \
    '| `comment.body` | `<script>alert(1)</script>` | redact | `page.html` | `tests/xss.sh` |'
  run_story_check "$forgeflow_story_dir"
  assert_status 0
  assert_output_contains 'Result: STORY_CONTRACT_OK'
}

fixture_shape_and_expected_result_are_constrained() {
  new_story shape yes no
  add_story_section '## Trust Boundary Fields' \
    '* `request.sql` — the raw statement supplied by the caller'
  add_matrix \
    '| `request.sql` | `password=hunter2` | scrubbed | `artifact.summary` | `tests/story-check.sh` |' \
    '| `request.sql` | `password=hunter2` | redact | `artifact.summary` |'
  run_story_check "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'row 1 expected result must be preserve, redact, reject, or omit'
  assert_output_contains 'row 2 must declare five columns'
}

trust_boundary_fields_must_be_enumerated() {
  new_story trust-missing yes no
  add_matrix "$forgeflow_valid_row"
  run_story_check "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'must enumerate its trust-boundary fields'

  new_story trust-prose yes no
  add_story_section '## Trust Boundary Fields' \
    '* every field a user can influence'
  add_matrix "$forgeflow_valid_row"
  run_story_check "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'every trust-boundary field must name an exact field'
}

missing_matrix_is_reported() {
  new_story no-matrix yes no
  add_story_section '## Trust Boundary Fields' \
    '* `request.sql` — the raw statement supplied by the caller'
  run_story_check "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'missing acceptance section: ## Security Fixture Matrix'

  new_story empty-matrix yes no
  add_story_section '## Trust Boundary Fields' \
    '* `request.sql` — the raw statement supplied by the caller'
  add_matrix
  run_story_check "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'declares no fixture rows'
}

missing_superseded_behavior_is_reported() {
  new_story baseline no yes
  run_story_check "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'must list superseded tests or behavior under ## Superseded Behavior'

  new_story baseline-prose no yes
  add_story_section '## Superseded Behavior' \
    '* the old guard behavior changes'
  run_story_check "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'every superseded entry must name an exact test path'
}

classification_must_be_explicit_and_consistent() {
  new_story missing no no
  grep -v 'Security sensitive' "$forgeflow_story_dir/story.md" \
    >"$forgeflow_story_dir/story.trimmed"
  mv "$forgeflow_story_dir/story.trimmed" "$forgeflow_story_dir/story.md"
  run_story_check "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'must declare "Security sensitive" exactly once'

  new_story duplicated no no
  printf '\n## Classification\n\n* Baseline conformance: no\n' \
    >>"$forgeflow_story_dir/story.md"
  run_story_check "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'must declare "Baseline conformance" exactly once'

  new_story invalid maybe no
  run_story_check "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'Security sensitive must be declared as yes or no'

  new_story contradiction no no
  add_matrix "$forgeflow_valid_row"
  run_story_check "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'declares Security sensitive: no but provides a security fixture matrix'

  new_story contradiction-baseline no no
  add_story_section '## Superseded Behavior' \
    '* `tests/legacy.sh` — replaced by the new guard'
  run_story_check "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'declares Baseline conformance: no but declares superseded behavior'
}

operational_failures_exit_two() {
  run_story_check --bogus
  assert_status 2
  assert_output_contains 'Result: ERROR'

  run_story_check "$forgeflow_test_dir/$forgeflow_case_id-absent"
  assert_status 2
  assert_output_contains 'Story directory is missing'
  assert_output_excludes 'STORY_CONTRACT_INCOMPLETE'

  new_story unreadable no no
  rm "$forgeflow_story_dir/acceptance.md"
  run_story_check "$forgeflow_story_dir"
  assert_status 2
  assert_output_contains 'required Story file is missing or unreadable'
  assert_output_contains 'Result: ERROR'

  run_story_check --help
  assert_status 0
  assert_output_contains 'ForgeFlow Story Contract Check'
}

root_verify_runs_story_contract_check() {
  forgeflow_root_makefile="$forgeflow_repo/Makefile"

  grep -Eq '^verify:.*verify-protocol.*verify-bootstrap.*verify-doctor.*verify-story.*verify-release.*verify-typescript.*verify-go.*verify-actions' \
    "$forgeflow_root_makefile" ||
    fail 'root verify does not retain all gates and include verify-story'
  grep -Fqx 'verify-story:' "$forgeflow_root_makefile" ||
    fail 'root Makefile does not expose verify-story'
  grep -Fq 'sh -n scripts/story-check tests/story-check.sh' \
    "$forgeflow_root_makefile" ||
    fail 'verify-story does not check Story contract shell syntax'
  grep -Fq './tests/story-check.sh' "$forgeflow_root_makefile" ||
    fail 'verify-story does not execute Story contract acceptance tests'
  grep -Fq './scripts/story-check' "$forgeflow_root_makefile" ||
    fail 'verify-story does not check this repository own Stories'

  forgeflow_case_id='AC-010'
  forgeflow_command_output="$forgeflow_test_dir/AC-010.output"

  if (
    CDPATH='' cd "$forgeflow_repo"
    "$forgeflow_story_check"
  ) >"$forgeflow_command_output" 2>&1; then
    forgeflow_command_status=0
  else
    forgeflow_command_status=$?
  fi

  assert_status 0
  assert_output_contains 'Result: STORY_CONTRACT_OK'
}

every_story_gets_its_own_verdict() {
  complete_security_story valid

  new_story broken-one yes no
  forgeflow_first_broken=$forgeflow_story_dir
  new_story broken-two yes no
  forgeflow_second_broken=$forgeflow_story_dir

  run_story_check "$forgeflow_first_broken" "$forgeflow_second_broken"
  assert_status 1
  assert_output_contains 'Stories checked: 2'
  assert_output_excludes 'PASS'

  forgeflow_broken_verdicts=$(
    grep -c "^FAIL  $forgeflow_second_broken" "$forgeflow_command_output"
  )

  [ "$forgeflow_broken_verdicts" -ge 1 ] ||
    fail 'the second broken Story reported no failure'

  complete_security_story second-valid
  run_story_check "$forgeflow_first_broken" "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'Stories checked: 2'
  grep -Fq "PASS  $forgeflow_story_dir" "$forgeflow_command_output" ||
    fail 'a compliant Story checked after a failing one lost its PASS verdict'
}

fenced_examples_are_not_declarations() {
  new_story fenced no no
  {
    printf '\n## Notes\n\n'
    printf 'The contract is illustrated below.\n\n'
    printf '```markdown\n'
    printf '## Classification\n\n'
    printf '* Security sensitive: yes\n'
    printf '* Baseline conformance: yes\n'
    printf '```\n'
  } >>"$forgeflow_story_dir/story.md"
  run_story_check "$forgeflow_story_dir"
  assert_status 0
  assert_output_contains 'security=no baseline=no'
}

escaped_pipes_obey_backslash_parity() {
  new_story escaped-pipe-one yes no
  add_story_section '## Trust Boundary Fields' \
    '* `request.sql` — raw input'
  add_matrix '| `request.sql` | `a\|b` | redact | `artifact.summary` | `tests/story-check.sh` |'
  run_story_check "$forgeflow_story_dir"
  assert_status 0

  new_story escaped-pipe-three yes no
  add_story_section '## Trust Boundary Fields' \
    '* `request.sql` — raw input'
  add_matrix '| `request.sql` | `a\\\|b` | redact | `artifact.summary` | `tests/story-check.sh` |'
  run_story_check "$forgeflow_story_dir"
  assert_status 0

  new_story escaped-pipe-zero yes no
  add_story_section '## Trust Boundary Fields' \
    '* `request.sql` — raw input'
  add_matrix '| `request.sql` | `a|b` | redact | `artifact.summary` | `tests/story-check.sh` |'
  run_story_check "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'must declare five columns'

  new_story escaped-pipe-two yes no
  add_story_section '## Trust Boundary Fields' \
    '* `request.sql` — raw input'
  add_matrix '| `request.sql` | `a\\|b` | redact | `artifact.summary` | `tests/story-check.sh` |'
  run_story_check "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'must declare five columns'

  new_story escaped-pipe-four yes no
  add_story_section '## Trust Boundary Fields' \
    '* `request.sql` — raw input'
  add_matrix '| `request.sql` | `a\\\\|b` | redact | `artifact.summary` | `tests/story-check.sh` |'
  run_story_check "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'must declare five columns'
}

tilde_and_length_matched_fences_are_ignored() {
  new_story fences no no
  {
    printf '\n\r~~~markdown\n'
    printf '## Classification\n\n* Security sensitive: yes\n* Baseline conformance: yes\n'
    printf '\r~~~\n\n````markdown\n```\n'
    printf '## Classification\n\n* Security sensitive: yes\n* Baseline conformance: yes\n'
    printf '~~~\n## Classification\n* Security sensitive: yes\n'
    printf '```` not-a-close\n## Classification\n* Baseline conformance: yes\n````\n'
  } >>"$forgeflow_story_dir/story.md"
  run_story_check "$forgeflow_story_dir"
  assert_status 0
  assert_output_contains 'security=no baseline=no'
}

all_contract_readers_ignore_fenced_examples() {
  new_story fenced-readers yes yes
  add_story_section '## Trust Boundary Fields' \
    '* `request.sql` — raw input'
  add_matrix "$forgeflow_valid_row"
  add_story_section '## Superseded Behavior' \
    '* `tests/legacy.sh` — replaced behavior'
  {
    printf '\n## Trust Boundary Fields\n\n~~~\n* prose trust field\n~~~\n'
    printf '\n## Superseded Behavior\n\n~~~\n* prose superseded behavior\n~~~\n'
  } >>"$forgeflow_story_dir/story.md"
  {
    printf '\n~~~\n| extra | row | that | must | stay | ignored |\n~~~\n'
  } >>"$forgeflow_story_dir/acceptance.md"
  run_story_check "$forgeflow_story_dir"
  assert_status 0
}

outside_duplicates_and_unclosed_fences_fail() {
  new_story duplicate no no
  printf '\n## Classification\n\n* Security sensitive: no\n' >>"$forgeflow_story_dir/story.md"
  run_story_check "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'Security sensitive" exactly once'

  new_story unclosed no yes
  printf '\n```markdown\n## Superseded Behavior\n\n* `tests/legacy.sh` — ignored\n' >>"$forgeflow_story_dir/story.md"
  run_story_check "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'must list superseded tests or behavior'

  new_story unclosed-after-real no yes
  add_story_section '## Superseded Behavior' \
    '* `tests/legacy.sh` — real behavior'
  printf '\n~~~markdown\n* prose example through EOF\n' >>"$forgeflow_story_dir/story.md"
  run_story_check "$forgeflow_story_dir"
  assert_status 0
}

markdown_parsing_keeps_empty_path_verdicts() {
  new_story empty-path-escaped yes no
  add_story_section '## Trust Boundary Fields' \
    '* `request.sql` — raw input'
  add_matrix '| `request.sql` | `a\|b` | redact | `artifact.summary` | `tests/story-check.sh` |'
  assert_same_story_verdict_without_utilities "$forgeflow_story_dir"
  assert_status 0

  new_story empty-path-extra-pipe yes no
  add_story_section '## Trust Boundary Fields' \
    '* `request.sql` — raw input'
  add_matrix '| `request.sql` | `a|b` | redact | `artifact.summary` | `tests/story-check.sh` |'
  assert_same_story_verdict_without_utilities "$forgeflow_story_dir"
  assert_status 1
}

markdown_parsing_subset_is_documented() {
  grep -Fq 'odd consecutive run of backslashes' "$forgeflow_repo/docs/contract-checks.md" ||
    fail 'contract checks omit escaped-pipe parity'
  grep -Fq 'same character and at least the' "$forgeflow_repo/docs/contract-checks.md" ||
    fail 'contract checks omit closing-fence rule'
  grep -Fq 'Unclosed fences ignore through EOF' "$forgeflow_repo/protocol/story.md" ||
    fail 'Story protocol omits unclosed-fence rule'
  grep -Fq 'FF-217 is a **Corrective** change for `0.3.6`' "$forgeflow_repo/protocol/versioning.md" ||
    fail 'versioning omits FF-217 corrective classification'
}

readiness_is_opt_in() {
  new_story minimal no no
  printf '## Classification\n* Security sensitive: no\n* Baseline conformance: no\n' \
    >"$forgeflow_story_dir/story.md"
  printf '# Acceptance Criteria\n' >"$forgeflow_story_dir/acceptance.md"
  run_story_check "$forgeflow_story_dir"
  assert_status 0
  assert_output_contains 'Result: STORY_CONTRACT_OK'
  assert_output_excludes 'READINESS'
  run_story_check --ready "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'Structure: STORY_CONTRACT_OK'
  assert_output_contains 'Result: STORY_READINESS_INCOMPLETE'
}

readiness_requires_goal_scope_and_acceptance() {
  for forgeflow_missing in goal scope acceptance
  do
    new_story "missing-$forgeflow_missing" no no
    case "$forgeflow_missing" in
      goal)
        sed '/## Goal/,/## Context/{ /## Context/!d; }' \
          "$forgeflow_story_dir/story.md" >"$forgeflow_story_dir/next.md"
        mv "$forgeflow_story_dir/next.md" "$forgeflow_story_dir/story.md"
        forgeflow_expected='## Goal needs' ;;
      scope)
        sed 's/Fixture behavior\./ /; s/Everything else\./ /' \
          "$forgeflow_story_dir/story.md" >"$forgeflow_story_dir/next.md"
        mv "$forgeflow_story_dir/next.md" "$forgeflow_story_dir/story.md"
        forgeflow_expected='## Scope needs' ;;
      acceptance)
        printf '# Acceptance Criteria\n' >"$forgeflow_story_dir/acceptance.md"
        forgeflow_expected='acceptance.md needs' ;;
    esac
    run_story_check --ready "$forgeflow_story_dir"
    assert_status 1
    assert_output_contains "$forgeflow_expected"
  done
  for forgeflow_heading in '#' '##' "$(printf '#\tOther')" "$(printf '##\tOther')"
  do
    new_story heading-boundary no no
    printf '## Classification\n* Security sensitive: no\n* Baseline conformance: no\n## Goal\n%s\nUnrelated goal prose.\n## Scope\n%s\nUnrelated scope prose.\n' \
      "$forgeflow_heading" "$forgeflow_heading" >"$forgeflow_story_dir/story.md"
    run_story_check --ready "$forgeflow_story_dir"
    assert_status 1
    assert_output_contains '## Goal needs'
    assert_output_contains '## Scope needs'
  done
}

readiness_checks_ac_content_and_uniqueness() {
  for forgeflow_ac_text in '' ' ' TBD '<acceptance criterion>'
  do
    new_story empty-ac no no
    printf '* [ ] AC-001: %s\n' "$forgeflow_ac_text" >"$forgeflow_story_dir/acceptance.md"
    run_story_check --ready "$forgeflow_story_dir"
    assert_status 1
    assert_output_contains 'AC-001 needs non-placeholder same-line content'
  done
  new_story duplicate-ac no no
  printf '\n- [x] AC-001: Duplicate in another section.\n' >>"$forgeflow_story_dir/acceptance.md"
  run_story_check --ready "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'duplicate AC ID: AC-001'

  new_story unique-ac no no
  printf '* [ ] AC-1: Returns 0.\n- [x] AC-2: Returns 1.\n* [X] AC-3: Manual inspection.\n' \
    >"$forgeflow_story_dir/acceptance.md"
  add_acceptance_evidence AC-1 AC-2 AC-3
  run_story_check --ready "$forgeflow_story_dir"
  assert_status 0
  assert_output_contains 'Structure: STORY_CONTRACT_OK'
  assert_output_contains 'Result: STORY_READINESS_OK'
  assert_output_contains 'not human-approved READY'
}

readiness_ignores_fenced_content() {
  for forgeflow_fence in '```' '~~~'
  do
    new_story fenced-ready no no
    printf '%smarkdown\n* [ ] AC-999: Example only.\n%s\n' \
      "$forgeflow_fence" "$forgeflow_fence" >"$forgeflow_story_dir/acceptance.md"
    run_story_check --ready "$forgeflow_story_dir"
    assert_status 1
    assert_output_contains 'acceptance.md needs'
    printf '* [ ] AC-999: Real criterion.\n' >>"$forgeflow_story_dir/acceptance.md"
    add_acceptance_evidence AC-999
    run_story_check --ready "$forgeflow_story_dir"
    assert_status 0

    printf '## Classification\n* Security sensitive: no\n* Baseline conformance: no\n## Goal\n%s\nExample goal.\n%s\n## Scope\n### In Scope\n%s\n* Example scope.\n%s\n' \
      "$forgeflow_fence" "$forgeflow_fence" "$forgeflow_fence" "$forgeflow_fence" \
      >"$forgeflow_story_dir/story.md"
    run_story_check --ready "$forgeflow_story_dir"
    assert_status 1
    assert_output_contains '## Goal needs'
    assert_output_contains '## Scope needs'
  done
}

readiness_placeholders_are_exact_not_language_scores() {
  for forgeflow_content in '中文需求：保留原始內容。' '<T>' 'std::vector<T>' '#define VALUE 1' 'TBD is a literal token to preserve.'
  do
    new_story content no no
    printf '## Classification\n* Security sensitive: no\n* Baseline conformance: no\n## Goal\n%s\n## Scope\n### In Scope\n* %s\n' \
      "$forgeflow_content" "$forgeflow_content" >"$forgeflow_story_dir/story.md"
    printf '* [ ] AC-001: %s\n' "$forgeflow_content" >"$forgeflow_story_dir/acceptance.md"
    add_acceptance_evidence AC-001
    run_story_check --ready "$forgeflow_story_dir"
    assert_status 0
  done
  for forgeflow_content in TBD tbd TODO todo N/A n/a '...' '<goal>' '<scope>' '<acceptance criterion>' 'Describe the user or business outcome.'
  do
    new_story placeholder no no
    printf '## Goal\n%s\n## Classification\n* Security sensitive: no\n* Baseline conformance: no\n## Scope\n* Fixture scope.\n' \
      "$forgeflow_content" >"$forgeflow_story_dir/story.md"
    run_story_check --ready "$forgeflow_story_dir"
    assert_status 1
    assert_output_contains '## Goal needs'
  done
}

readiness_is_read_only_deterministic_and_path_independent() {
  new_story ready-path no no
  forgeflow_ready_before=$(cksum "$forgeflow_story_dir/story.md" "$forgeflow_story_dir/acceptance.md")
  assert_same_story_verdict_without_utilities --ready "$forgeflow_story_dir"
  assert_status 0
  [ "$forgeflow_ready_before" = "$(cksum "$forgeflow_story_dir/story.md" "$forgeflow_story_dir/acceptance.md")" ] ||
    fail 'readiness changed fixture content'
  [ "$(find "$forgeflow_story_dir" -type f | wc -l | tr -d ' ')" = 2 ] ||
    fail 'readiness created files'
  printf '# Acceptance\n' >"$forgeflow_story_dir/acceptance.md"
  assert_same_story_verdict_without_utilities --ready "$forgeflow_story_dir"
  assert_status 1
  assert_same_story_verdict_without_utilities --ready "$forgeflow_test_dir/missing"
  assert_status 2
  for forgeflow_bad in --ready --unknown --help
  do
    assert_same_story_verdict_without_utilities --ready "$forgeflow_bad"
    assert_status 2
  done
  new_story discovered no no
  mkdir -p "$forgeflow_test_dir/discovery/specs/stories"
  cp -R "$forgeflow_story_dir" "$forgeflow_test_dir/discovery/specs/stories/TST-001"
  (
    cd "$forgeflow_test_dir/discovery"
    run_story_check --ready
    assert_status 0
    assert_output_contains 'Stories checked: 1'
  )
}

readiness_documentation_and_templates_match() {
  for forgeflow_document in docs/contract-checks.md protocol/story.md
  do
    for forgeflow_term in '--ready' STORY_READINESS_OK 'AC-001:' 'human' '<acceptance criterion>'
    do
      grep -Fq -- "$forgeflow_term" "$forgeflow_repo/$forgeflow_document" ||
        fail "$forgeflow_document omits $forgeflow_term"
    done
  done
  grep -Fq '* [ ] AC-001: <acceptance criterion>' "$forgeflow_repo/templates/story/acceptance.md" ||
    fail 'acceptance template omits usable AC syntax'
  grep -Fq 'Doctor' "$forgeflow_repo/docs/contract-checks.md" || fail 'Doctor semantics undocumented'
}

write_valid_acceptance_evidence() {
  cat >"$forgeflow_story_dir/acceptance.md" <<'FORGEFLOW_FIXTURE'
# Acceptance Criteria

* [ ] AC-001: Automated behavior is checked.
* [ ] AC-002: A command reports the outcome.
* [ ] AC-003: A reviewer checks an external invariant.

## Acceptance Evidence

| AC | Method | Evidence | Fixture / precondition | Expected observation |
| --- | --- | --- | --- | --- |
| `AC-001` | test | `tests/story-check.sh:FF222-AC-001` | `valid fixture` | `STORY_READINESS_OK` |
| `AC-002` | command | `make verify-story` | `repository checkout` | `exit 0` |
| `AC-003` | human | `review\|record` | `external lifecycle statement` | `review notes` |

```markdown
| `AC-999` | test | TBD | TBD | TBD |
```
FORGEFLOW_FIXTURE
}

acceptance_evidence_rejects_invalid_maps() {
  new_story missing-evidence no no
  printf '# Acceptance Criteria\n\n* [ ] AC-001: Concrete criterion.\n' \
    >"$forgeflow_story_dir/acceptance.md"
  run_story_check --ready "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'missing ## Acceptance Evidence'

  new_story invalid-evidence no no
  cat >"$forgeflow_story_dir/acceptance.md" <<'FORGEFLOW_FIXTURE'
# Acceptance Criteria

* [ ] AC-001: First concrete criterion.
* [ ] AC-002: Second concrete criterion.

## Acceptance Evidence

| AC | Method | Evidence | Fixture / precondition | Expected observation |
| --- | --- | --- | --- | --- |
| `AC-001` | script | `<evidence>` | `fixture` | `observed` |
| `AC-001` | test | `tests/story-check.sh` | `fixture` | `observed` |
| `AC-999` | human | `review` | `fixture` | `observed` |
FORGEFLOW_FIXTURE
  run_story_check --ready "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'method must be test, command, or human'
  assert_output_contains 'must give evidence as one exact backticked value'
  assert_output_contains 'duplicates AC ID: AC-001'
  assert_output_contains 'names unknown AC ID: AC-999'
  assert_output_contains 'missing AC ID: AC-002'

  new_story malformed-header no no
  cat >"$forgeflow_story_dir/acceptance.md" <<'FORGEFLOW_FIXTURE'
# Acceptance Criteria

* [ ] AC-001: Concrete criterion.

## Acceptance Evidence

| AC | Method | Evidence | Fixture | Expected observation |
| --- | --- | --- | --- | --- |
| `AC-001` | test | `test` | `fixture` | `observation` |
FORGEFLOW_FIXTURE
  run_story_check --ready "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'header must be exactly the documented five columns'

  new_story malformed-separator no no
  cat >"$forgeflow_story_dir/acceptance.md" <<'FORGEFLOW_FIXTURE'
# Acceptance Criteria

* [ ] AC-001: Concrete criterion.

## Acceptance Evidence

| AC | Method | Evidence | Fixture / precondition | Expected observation |
| --- | --- | --- | --- |
| `AC-001` | test | `test` | `fixture` | `observation` |
FORGEFLOW_FIXTURE
  run_story_check --ready "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'header must be followed by a five-column separator row'

  new_story invalid-ac-cell no no
  cat >"$forgeflow_story_dir/acceptance.md" <<'FORGEFLOW_FIXTURE'
# Acceptance Criteria

* [ ] AC-001: Concrete criterion.

## Acceptance Evidence

| AC | Method | Evidence | Fixture / precondition | Expected observation |
| --- | --- | --- | --- | --- |
| AC-001 | test | `test` | `fixture` | `observation` |
FORGEFLOW_FIXTURE
  run_story_check --ready "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'must name one exact backticked AC-<digits> ID'

  new_story duplicate-section no no
  write_valid_acceptance_evidence
  printf '\n## Acceptance Evidence\n' >>"$forgeflow_story_dir/acceptance.md"
  run_story_check --ready "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'must declare ## Acceptance Evidence exactly once'

  new_story trailing-evidence-content no no
  write_valid_acceptance_evidence
  sed 's/`valid fixture` | `STORY_READINESS_OK` |$/`valid fixture` | `STORY_READINESS_OK` | trailing-garbage/' \
    "$forgeflow_story_dir/acceptance.md" >"$forgeflow_story_dir/next.md"
  mv "$forgeflow_story_dir/next.md" "$forgeflow_story_dir/acceptance.md"
  run_story_check --ready "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'must end after the fifth column'
}

acceptance_evidence_accepts_declared_methods() {
  new_story exact-evidence no no
  write_valid_acceptance_evidence
  sed 's/`valid fixture`/`<T>`/' "$forgeflow_story_dir/acceptance.md" \
    >"$forgeflow_story_dir/next.md"
  mv "$forgeflow_story_dir/next.md" "$forgeflow_story_dir/acceptance.md"
  run_story_check "$forgeflow_story_dir"
  assert_status 0
  run_story_check --ready "$forgeflow_story_dir"
  assert_status 0
  assert_output_contains 'Result: STORY_READINESS_OK'
}

acceptance_evidence_preserves_portability() {
  new_story portable-evidence no no
  write_valid_acceptance_evidence
  forgeflow_evidence_before=$(cksum "$forgeflow_story_dir/acceptance.md")
  assert_same_story_verdict_without_utilities --ready "$forgeflow_story_dir"
  assert_status 0
  [ "$forgeflow_evidence_before" = "$(cksum "$forgeflow_story_dir/acceptance.md")" ] ||
    fail 'acceptance evidence readiness changed the fixture'
}

acceptance_evidence_guidance_is_complete() {
  for forgeflow_evidence_document in \
    docs/contract-checks.md \
    docs/releases/0.4.0.md \
    protocol/story.md \
    protocol/versioning.md \
    docs/upgrading.md \
    templates/story/acceptance.md \
    templates/AGENTS.md \
    skills/story-development/SKILL.md \
    docs/human-review.md
  do
    grep -Fq 'Acceptance Evidence' "$forgeflow_repo/$forgeflow_evidence_document" ||
      fail "$forgeflow_evidence_document omits Acceptance Evidence guidance"
  done
  grep -Fqx '0.4.1' "$forgeflow_repo/VERSION" || fail 'VERSION is not 0.4.1'
  grep -Fq 'Breaking' "$forgeflow_repo/protocol/versioning.md" ||
    fail 'versioning omits breaking classification'
  grep -Fq '../../protocol/versioning.md' "$forgeflow_repo/docs/releases/0.4.0.md" ||
    fail 'release notes omit the migration guidance link'
}

full_gate_is_the_acceptance_evidence_command() {
  grep -Eq '^verify:' "$forgeflow_repo/Makefile" ||
    fail 'Makefile omits the canonical verify target'
  grep -Fq 'Run `make verify`' "$forgeflow_repo/templates/AGENTS.md" ||
    fail 'agent template omits the canonical verify command'
}

run_case 'FF218-AC-001' readiness_is_opt_in
run_case 'FF218-AC-002' readiness_requires_goal_scope_and_acceptance
run_case 'FF218-AC-003' readiness_checks_ac_content_and_uniqueness
run_case 'FF218-AC-004' readiness_ignores_fenced_content
run_case 'FF218-AC-005' readiness_placeholders_are_exact_not_language_scores
run_case 'FF218-AC-006' readiness_is_read_only_deterministic_and_path_independent
run_case 'FF218-AC-007' readiness_documentation_and_templates_match

run_case 'FF222-AC-001' acceptance_evidence_rejects_invalid_maps
run_case 'FF222-AC-002' acceptance_evidence_accepts_declared_methods
run_case 'FF222-AC-003' acceptance_evidence_preserves_portability
run_case 'FF222-AC-004' acceptance_evidence_guidance_is_complete
run_case 'FF222-AC-005' full_gate_is_the_acceptance_evidence_command

run_case 'AC-001' complete_security_story_passes
run_case 'AC-002' unclassified_story_needs_no_security_sections
run_case 'AC-003' prose_fixture_cells_are_rejected
run_case 'AC-004' fixture_shape_and_expected_result_are_constrained
run_case 'AC-005' trust_boundary_fields_must_be_enumerated
run_case 'AC-006' missing_matrix_is_reported
run_case 'AC-007' missing_superseded_behavior_is_reported
run_case 'AC-008' classification_must_be_explicit_and_consistent
run_case 'AC-009' operational_failures_exit_two
run_case 'AC-010' root_verify_runs_story_contract_check
run_case 'AC-011' every_story_gets_its_own_verdict
run_case 'AC-012' fenced_examples_are_not_declarations

run_case 'FF217-AC-001' escaped_pipes_obey_backslash_parity
run_case 'FF217-AC-002' tilde_and_length_matched_fences_are_ignored
run_case 'FF217-AC-003' all_contract_readers_ignore_fenced_examples
run_case 'FF217-AC-004' outside_duplicates_and_unclosed_fences_fail
run_case 'FF217-AC-005' markdown_parsing_keeps_empty_path_verdicts
run_case 'FF217-AC-006' markdown_parsing_subset_is_documented

run_case 'FF212-AC-002' the_story_verdict_does_not_depend_on_external_utilities
run_case 'FF212-AC-008' an_incomplete_story_verdict_does_not_depend_on_external_utilities
run_case 'FF212-AC-010' usage_and_incomplete_results_survive_an_empty_path
run_case 'FF212-AC-007' the_matrix_separator_form_is_unchanged
run_case 'FF212-AC-012' story_check_uses_no_external_utilities
run_case 'FF212-AC-013' the_builtin_guarantee_is_documented

printf 'story-check tests passed\n'
