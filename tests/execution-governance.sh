#!/bin/sh

set -eu

fail() {
  printf 'execution-governance test failed [%s]: %s\n' "$forgeflow_case_id" "$1" >&2
  exit 1
}

assert_status() {
  if [ "$forgeflow_command_status" -ne "$1" ]; then
    fail "expected exit $1, got $forgeflow_command_status: $(cat "$forgeflow_command_output")"
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

run_command() {
  forgeflow_command_output="$forgeflow_test_dir/$forgeflow_case_id.output"
  forgeflow_runner=$1
  shift

  if "$forgeflow_runner" "$@" >"$forgeflow_command_output" 2>&1; then
    forgeflow_command_status=0
  else
    forgeflow_command_status=$?
  fi
}

run_verification_check() {
  run_command "$forgeflow_verification_check" "$@"
}

run_story_check() {
  run_command "$forgeflow_story_check" "$@"
}

run_story_check_with_decisions_root() {
  forgeflow_configured_decisions_root=$1
  shift
  forgeflow_command_output="$forgeflow_test_dir/$forgeflow_case_id.output"

  if (
    PRAXISBOUND_DECISIONS_ROOT=$forgeflow_configured_decisions_root
    export PRAXISBOUND_DECISIONS_ROOT
    "$forgeflow_story_check" "$@"
  ) >"$forgeflow_command_output" 2>&1; then
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

# A Story fixture with no governance declarations at all: the shape every
# ForgeFlow Story had before this contract existed.
new_story() {
  forgeflow_story_dir="$forgeflow_stories_root/$forgeflow_case_id-$1"

  rm -rf "$forgeflow_story_dir"
  mkdir -p "$forgeflow_story_dir"

  cat >"$forgeflow_story_dir/story.md" <<'FORGEFLOW_FIXTURE'
# Story: TST-001 Fixture Story

## Goal

Provide a deterministic Story fixture.

## Scope

### In Scope

* Fixture behavior.

### Out of Scope

* Everything else.

## Constraints

* None.

## Classification

* Security sensitive: no
* Baseline conformance: no
FORGEFLOW_FIXTURE

  cat >"$forgeflow_story_dir/acceptance.md" <<'FORGEFLOW_FIXTURE'
# Acceptance Criteria

## Happy Path

* [ ] AC-001: Fixture happy path.
* [ ] AC-002: Fixture business rule.

## Acceptance Evidence

| AC | Method | Evidence | Fixture / precondition | Expected observation |
| --- | --- | --- | --- | --- |
| `AC-001` | test | `tests/execution-governance.sh` | `fixture` | `passes` |
| `AC-002` | test | `tests/execution-governance.sh` | `fixture` | `passes` |
FORGEFLOW_FIXTURE
}

add_section() {
  printf '\n%s\n\n' "$1" >>"$forgeflow_story_dir/story.md"
  shift

  for forgeflow_entry in "$@"
  do
    printf '%s\n' "$forgeflow_entry" >>"$forgeflow_story_dir/story.md"
  done
}

add_classification() {
  printf '%s\n' "$1" >>"$forgeflow_story_dir/story.md"
}

write_decision() {
  write_decision_in "$forgeflow_decisions_root" "$@"
}

write_decision_in() {
  forgeflow_decision_root=$1
  forgeflow_decision_id=$2
  forgeflow_decision_status=$3

  cat >"$forgeflow_decision_root/$forgeflow_decision_id.md" <<FORGEFLOW_DECISION
# $forgeflow_decision_id: Fixture decision

* Status: $forgeflow_decision_status

## Decision

Fixture decision body.
FORGEFLOW_DECISION
}

write_result() {
  cat >"$forgeflow_story_dir/verification.md"
}

# --- AC-001 -----------------------------------------------------------------

defaults_preserve_a_story_without_declarations() {
  new_story legacy

  run_story_check "$forgeflow_story_dir"
  assert_status 0
  assert_output_contains 'Result: STORY_CONTRACT_OK'

  run_verification_check "$forgeflow_story_dir"
  assert_status 0
  assert_output_contains 'Task mode: execution'
  assert_output_contains 'Authority: plan=yes modify=yes add_dependency=no migration=no commit=no push=no deploy=no'
  assert_output_contains 'Risk level: low'
  assert_output_contains 'Architecture impact: low'
  assert_output_contains 'Required checks: lint static unit'
  assert_output_contains 'Result: VERIFICATION_PLAN_OK'

  # Every Story this repository already owns predates the contract.
  run_command "$forgeflow_verification_check"
  assert_status 0
  assert_output_contains 'Result: VERIFICATION_PLAN_OK'
}

# --- AC-002 -----------------------------------------------------------------

a_story_can_declare_its_execution_contract() {
  new_story declared
  add_classification '* Task mode: mixed'
  add_section '## Authority' \
    '* plan: yes' '* modify: yes' '* add_dependency: yes' '* migration: no' \
    '* commit: yes' '* push: no' '* deploy: no'
  write_decision ADR-901 accepted
  add_section '## Architecture' \
    '* Impact: high' '* Decision: `ADR-901`' '* Boundary: `Gateway`' \
    '* Contract: `Gateway public interface remains compatible`' \
    '* Owner: `Gateway = gateway-domain`'
  add_section '## Risk' '* Level: high' '* Reason: `payment`'

  run_story_check "$forgeflow_story_dir"
  assert_status 0
  assert_output_contains 'Result: STORY_CONTRACT_OK'

  run_verification_check "$forgeflow_story_dir"
  assert_status 0
  assert_output_contains 'Task mode: mixed'
  assert_output_contains 'Authority: plan=yes modify=yes add_dependency=yes migration=no commit=yes push=no deploy=no'
  assert_output_contains 'Risk level: high'
  assert_output_contains 'Architecture impact: high'
}

# --- AC-003 -----------------------------------------------------------------

evidence_mode_never_authorizes_mutation() {
  new_story evidence-default
  add_classification '* Task mode: evidence'

  run_story_check "$forgeflow_story_dir"
  assert_status 0

  run_verification_check "$forgeflow_story_dir"
  assert_status 0
  assert_output_contains 'Authority: plan=yes modify=no'

  new_story evidence-granting-modify
  add_classification '* Task mode: evidence'
  add_section '## Authority' '* plan: yes' '* modify: yes'

  run_story_check "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'evidence task mode must not authorize modify'
  assert_output_contains 'Result: STORY_CONTRACT_INCOMPLETE'

  new_story evidence-granting-commit
  add_classification '* Task mode: evidence'
  add_section '## Authority' '* modify: no' '* commit: yes'

  run_story_check "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'evidence task mode must not authorize commit'
}

# --- AC-004 -----------------------------------------------------------------

authority_escalation_is_explicit() {
  new_story push-without-commit
  add_section '## Authority' '* modify: yes' '* commit: no' '* push: yes'
  run_story_check "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'authority grants push without commit'

  new_story deploy-without-push
  add_section '## Authority' \
    '* modify: yes' '* commit: yes' '* push: no' '* deploy: yes'
  run_story_check "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'authority grants deploy without push'

  new_story commit-without-modify
  add_section '## Authority' '* modify: no' '* commit: yes'
  run_story_check "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'authority grants commit without modify'

  new_story unknown-and-repeated
  add_section '## Authority' '* merge: yes' '* modify: yes' '* modify: no'
  run_story_check "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'authority declares an unknown operation: merge'
  assert_output_contains 'authority declares modify more than once'

  new_story invalid-value
  add_section '## Authority' '* modify: maybe'
  run_story_check "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'authority modify must be declared as yes or no'

  # Implementation permission never carries commit, push, or deploy with it.
  new_story implementation-only
  add_section '## Authority' '* modify: yes'
  run_verification_check "$forgeflow_story_dir"
  assert_status 0
  assert_output_contains 'commit=no push=no deploy=no'
}

# --- AC-005 -----------------------------------------------------------------

architecture_metadata_must_resolve() {
  new_story impact-without-anchor
  add_section '## Architecture' '* Impact: medium'
  run_story_check "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'architecture impact medium must name at least one decision or contract'

  new_story missing-decision
  add_section '## Architecture' '* Impact: medium' '* Decision: `ADR-902`'
  run_story_check "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'referenced decision record does not exist: ADR-902'

  write_decision ADR-903 proposed
  new_story proposed-decision
  add_section '## Architecture' '* Impact: medium' '* Decision: `ADR-903`'
  run_story_check "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'referenced decision is still proposed: ADR-903'

  # An architecture Story is exactly the work that decides an open question.
  new_story proposed-decision-in-architecture-mode
  add_classification '* Task mode: architecture'
  add_section '## Architecture' '* Impact: medium' '* Decision: `ADR-903`'
  run_story_check "$forgeflow_story_dir"
  assert_status 0

  write_decision ADR-904 superseded
  new_story superseded-decision
  add_section '## Architecture' '* Impact: medium' '* Decision: `ADR-904`'
  run_story_check "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'referenced decision is not usable (superseded): ADR-904'

  write_decision ADR-905 accepted
  new_story duplicate-reference
  add_section '## Architecture' \
    '* Impact: medium' '* Decision: `ADR-905`' '* Decision: `ADR-905`'
  run_story_check "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'architecture references the same decision twice: ADR-905'

  new_story unowned-boundary
  add_section '## Architecture' \
    '* Impact: medium' '* Decision: `ADR-905`' '* Boundary: `Gateway`' \
    '* Owner: `Ledger = ledger-domain`'
  run_story_check "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'architecture owner names an undeclared boundary: Ledger'

  new_story prose-architecture
  add_section '## Architecture' '* Impact: medium' '* Contract: stays compatible'
  run_story_check "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'architecture Contract must state one exact backticked value'

  new_story unknown-architecture-label
  add_section '## Architecture' '* Impact: low' '* Layer: `domain`'
  run_story_check "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'architecture declares an unknown label: Layer'
}

# --- FF228-AC-001 -----------------------------------------------------------

configured_decision_root_is_explicit_and_isolated() {
  forgeflow_external_decisions_root="$forgeflow_test_dir/docs/adr"
  mkdir -p "$forgeflow_external_decisions_root"
  write_decision_in "$forgeflow_external_decisions_root" ADR-907 accepted

  new_story external-decision
  add_section '## Architecture' '* Impact: medium' '* Decision: `ADR-907`'

  run_story_check "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'referenced decision record does not exist: ADR-907'

  run_story_check_with_decisions_root '' "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'referenced decision record does not exist: ADR-907'

  run_story_check_with_decisions_root "$forgeflow_external_decisions_root" \
    "$forgeflow_story_dir"
  assert_status 0
  assert_output_contains 'Result: STORY_CONTRACT_OK'

  write_decision ADR-908 accepted
  new_story configured-root-has-no-fallback
  add_section '## Architecture' '* Impact: medium' '* Decision: `ADR-908`'
  run_story_check_with_decisions_root "$forgeflow_external_decisions_root" \
    "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'referenced decision record does not exist: ADR-908'

  write_decision_in "$forgeflow_external_decisions_root" \
    ADR-909-existing-slug accepted
  new_story external-slugged-decision
  add_section '## Architecture' '* Impact: medium' '* Decision: `ADR-909`'
  run_story_check_with_decisions_root "$forgeflow_external_decisions_root" \
    "$forgeflow_story_dir"
  assert_status 0
}

# --- AC-006 -----------------------------------------------------------------

risk_declarations_stay_honest() {
  new_story risk-without-reason
  add_section '## Risk' '* Level: high'
  run_story_check "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'risk level high must name at least one reason'

  new_story understated-signal
  add_section '## Risk' '* Level: medium' '* Reason: `payment`'
  run_story_check "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'risk reason payment is a high-risk signal but the level is medium'

  new_story understated-default-signal
  add_section '## Risk' '* Reason: `data-loss`'
  run_story_check "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'is a high-risk signal but the level is low'

  new_story honest-signal
  add_section '## Risk' '* Level: high' '* Reason: `schema-migration`'
  run_story_check "$forgeflow_story_dir"
  assert_status 0

  new_story invalid-level
  add_section '## Risk' '* Level: critical'
  run_story_check "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'Risk level must be low, medium, or high'
}

# --- FF228-AC-002 -----------------------------------------------------------

risk_reason_diagnostics_explain_the_literal_shape() {
  new_story prose-risk-reason
  add_section '## Risk' '* Reason: a prose explanation'
  run_story_check "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'risk reason must name one same-line backticked signal'
  run_verification_check "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'risk reason must name one same-line backticked signal'

  new_story line-spanning-risk-reason
  add_section '## Risk' '* Reason: `versioned-' 'surface`'
  run_story_check "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'risk reason must name one same-line backticked signal'
}

# --- AC-007 -----------------------------------------------------------------

# --- P0-002 AC-008 ----------------------------------------------------------

risk_signals_are_opt_in_and_do_not_change_the_profile() {
  for forgeflow_signal in \
    error-projection concurrency bounded-capacity retention-overflow
  do
    new_story "standard-signal-$forgeflow_signal"
    add_section '## Risk' '* Level: medium' '* Reason: `shared-write-path`' \
      "* Signal: \`$forgeflow_signal\`"
    run_verification_check "$forgeflow_story_dir"
    assert_status 0
    assert_output_contains 'Risk level: medium'
    assert_output_contains 'Required checks: lint static unit integration'
    assert_output_contains 'Result: VERIFICATION_PLAN_OK'
  done

  new_story duplicate-signal
  add_section '## Risk' '* Signal: `concurrency`' '* Signal: `concurrency`'
  run_verification_check "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'risk signal declared more than once: concurrency'
  assert_output_contains 'Result: VERIFICATION_PLAN_INCOMPLETE'

  new_story unknown-signal
  add_section '## Risk' '* Signal: `unbounded-retry`'
  run_verification_check "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'risk signal is unknown: unbounded-retry'
  assert_output_contains 'Result: VERIFICATION_PLAN_INCOMPLETE'

  new_story fenced-signal
  add_section '## Risk' '```markdown' '* Signal: `concurrency`' '```'
  run_verification_check "$forgeflow_story_dir"
  assert_status 0
  assert_output_contains 'Result: VERIFICATION_PLAN_OK'

  new_story signal-empty-path
  add_section '## Risk' '* Level: medium' '* Reason: `shared-write-path`' \
    '* Signal: `concurrency`'
  forgeflow_empty_path="$forgeflow_test_dir/$forgeflow_case_id-empty-path"
  mkdir -p "$forgeflow_empty_path"
  forgeflow_command_output="$forgeflow_test_dir/$forgeflow_case_id.no-path"
  if PATH="$forgeflow_empty_path" "$forgeflow_verification_check" \
    "$forgeflow_story_dir" >"$forgeflow_command_output" 2>&1; then
    forgeflow_command_status=0
  else
    forgeflow_command_status=$?
  fi
  assert_status 0
  assert_output_contains 'Result: VERIFICATION_PLAN_OK'
}

the_profile_follows_risk_and_architecture_impact() {
  new_story profile-low
  run_verification_check "$forgeflow_story_dir"
  assert_status 0
  assert_output_contains 'Required checks: lint static unit'
  assert_output_excludes 'integration'

  new_story profile-medium
  add_section '## Risk' '* Level: medium' '* Reason: `external-api`'
  run_verification_check "$forgeflow_story_dir"
  assert_status 0
  assert_output_contains 'Required checks: lint static unit integration'
  assert_output_excludes 'e2e'

  new_story profile-high
  add_section '## Risk' '* Level: high' '* Reason: `payment`'
  run_verification_check "$forgeflow_story_dir"
  assert_status 0
  assert_output_contains 'Required checks: lint static unit integration contract e2e'
  assert_output_excludes 'architecture'

  write_decision ADR-906 accepted
  new_story profile-architecture
  add_section '## Architecture' '* Impact: medium' '* Decision: `ADR-906`'
  run_verification_check "$forgeflow_story_dir"
  assert_status 0
  assert_output_contains 'Required checks: lint static unit architecture'
}

# --- AC-008 -----------------------------------------------------------------

an_unproven_result_is_partial_not_pass() {
  new_story complete-result
  write_result <<'FORGEFLOW_RESULT'
# Verification Result

## Checks

* lint: pass — `make verify`
* static: pass — `make verify`
* unit: pass — `make verify`

## Evidence

* `AC-001`: pass — `fixture observation`
* `AC-002`: pass — `fixture observation`
FORGEFLOW_RESULT
  run_verification_check --result "$forgeflow_story_dir"
  assert_status 0
  assert_output_contains 'Status: PASS'
  assert_output_contains 'Result: VERIFICATION_PASS'

  new_story missing-required-check
  write_result <<'FORGEFLOW_RESULT'
# Verification Result

## Checks

* lint: pass — `make verify`
* static: pass — `make verify`

## Evidence

* `AC-001`: pass — `fixture observation`
* `AC-002`: pass — `fixture observation`

## Residual Risks

* `no unit runner in this fixture`
FORGEFLOW_RESULT
  run_verification_check --result "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'required check is not recorded: unit'
  assert_output_contains 'Status: PARTIAL'
  assert_output_contains 'Result: VERIFICATION_PARTIAL'

  new_story unsupported-required-check
  write_result <<'FORGEFLOW_RESULT'
# Verification Result

## Checks

* lint: pass — `make verify`
* static: pass — `make verify`
* unit: unsupported — `this fixture has no unit runner`

## Evidence

* `AC-001`: pass — `fixture observation`
* `AC-002`: pass — `fixture observation`

## Residual Risks

* `unit layer is unsupported here`
FORGEFLOW_RESULT
  run_verification_check --result "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'required check did not pass: unit'
  assert_output_contains 'Result: VERIFICATION_PARTIAL'

  new_story untraced-criterion
  write_result <<'FORGEFLOW_RESULT'
# Verification Result

## Checks

* lint: pass — `make verify`
* static: pass — `make verify`
* unit: pass — `make verify`

## Evidence

* `AC-001`: pass — `fixture observation`

## Residual Risks

* `AC-002 has no automated observation yet`
FORGEFLOW_RESULT
  run_verification_check --result "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'acceptance criterion has no passing evidence: AC-002'
  assert_output_contains 'Result: VERIFICATION_PARTIAL'

  new_story failing-check
  write_result <<'FORGEFLOW_RESULT'
# Verification Result

## Checks

* lint: pass — `make verify`
* static: pass — `make verify`
* unit: fail — `make verify`

## Evidence

* `AC-001`: pass — `fixture observation`
* `AC-002`: pass — `fixture observation`
FORGEFLOW_RESULT
  run_verification_check --result "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'Status: FAIL'
  assert_output_contains 'Result: VERIFICATION_FAIL'
}

# --- AC-009 -----------------------------------------------------------------

used_authority_must_have_been_granted() {
  new_story ungranted-commit
  write_result <<'FORGEFLOW_RESULT'
# Verification Result

## Checks

* lint: pass — `make verify`
* static: pass — `make verify`
* unit: pass — `make verify`

## Evidence

* `AC-001`: pass — `fixture observation`
* `AC-002`: pass — `fixture observation`

## Authority Used

* modify
* commit
FORGEFLOW_RESULT
  run_verification_check --result "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'authority conflict: commit was used but the Story does not grant it'
  assert_output_contains 'Result: VERIFICATION_FAIL'

  new_story ungranted-dependency
  add_section '## Authority' '* modify: yes' '* add_dependency: no'
  write_result <<'FORGEFLOW_RESULT'
# Verification Result

## Checks

* lint: pass — `make verify`
* static: pass — `make verify`
* unit: pass — `make verify`

## Evidence

* `AC-001`: pass — `fixture observation`
* `AC-002`: pass — `fixture observation`

## Authority Used

* add_dependency
FORGEFLOW_RESULT
  run_verification_check --result "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'authority conflict: add_dependency was used but the Story does not grant it'
}

# --- AC-010 -----------------------------------------------------------------

a_malformed_or_silent_result_is_reported() {
  new_story no-residual-risk
  write_result <<'FORGEFLOW_RESULT'
# Verification Result

## Checks

* lint: pass — `make verify`

## Evidence

* `AC-001`: pass — `fixture observation`
* `AC-002`: pass — `fixture observation`
FORGEFLOW_RESULT
  run_verification_check --result "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'incomplete verification must record at least one residual risk'
  assert_output_contains 'Result: VERIFICATION_RESULT_INCOMPLETE'

  new_story missing-record
  run_verification_check --result "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'verification.md is missing, unreadable, or empty'
  assert_output_contains 'Result: VERIFICATION_RESULT_INCOMPLETE'

  new_story unknown-layer
  write_result <<'FORGEFLOW_RESULT'
# Verification Result

## Checks

* smoke: pass — `make verify`

## Evidence

* `AC-001`: pass — `fixture observation`
FORGEFLOW_RESULT
  run_verification_check --result "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'unknown verification check: smoke'

  new_story unknown-criterion
  write_result <<'FORGEFLOW_RESULT'
# Verification Result

## Checks

* lint: pass — `make verify`

## Evidence

* `AC-404`: pass — `fixture observation`
FORGEFLOW_RESULT
  run_verification_check --result "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'evidence names unknown AC ID: AC-404'

  new_story prose-detail
  write_result <<'FORGEFLOW_RESULT'
# Verification Result

## Checks

* lint: pass — it looked fine

## Evidence

* `AC-001`: pass — `fixture observation`
FORGEFLOW_RESULT
  run_verification_check --result "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'check lint must name one exact backticked command or reason'

  new_story invalid-status
  write_result <<'FORGEFLOW_RESULT'
# Verification Result

## Checks

* lint: green — `make verify`

## Evidence

* `AC-001`: pass — `fixture observation`
FORGEFLOW_RESULT
  run_verification_check --result "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'check lint status must be pass, fail, skipped, blocked, or unsupported'

  run_verification_check --result "$forgeflow_test_dir/absent-story"
  assert_status 2
  assert_output_contains 'Result: ERROR'

  run_verification_check --nonsense
  assert_status 2
  assert_output_contains 'Result: ERROR'
}

# The predicate FF224-AC-011 and FF226-AC-004 share. The former assertion matched
# the bare substring "dependency direction", which also occurs at the unrelated
# sentence listing the concerns architecture metadata carries, so deleting the
# extension-point paragraph left the suite green. Requiring the whole list plus
# the sentence that states the position identifies the paragraph itself.
architecture_extension_point() {
  forgeflow_extension_file=$1
  for forgeflow_extension_term in \
    'dependency direction validation' \
    'forbidden imports' \
    'layer boundaries' \
    'public interface drift' \
    'architecture drift' \
    'PraxisBound does not implement them, and it does not intend to' \
    'This is a scope' \
    'ADR-003'
  do
    grep -Fq "$forgeflow_extension_term" "$forgeflow_extension_file" || return 1
  done
  return 0
}

# --- AC-011 -----------------------------------------------------------------

the_gate_and_the_builtin_guarantee_hold() {
  grep -Eq '^verify:.*verify-execution' "$forgeflow_repo/Makefile" ||
    fail 'the canonical gate does not compose verify-execution'
  grep -Fq './tests/execution-governance.sh' "$forgeflow_repo/Makefile" ||
    fail 'the Makefile does not run the execution governance tests'
  grep -Fq './scripts/verification-check' "$forgeflow_repo/Makefile" ||
    fail 'the Makefile does not run the verification check'

  forgeflow_scan_output="$forgeflow_test_dir/$forgeflow_case_id.scan"

  grep -nE '(^|[ 	(|&;`]|\$\()(grep|sed|awk|sort|uniq|tr|cut|head|tail|wc|expr|cat|find|basename|dirname|readlink|stat|date|mktemp|xargs|git)([ 	]|$)' \
    "$forgeflow_verification_check" "$forgeflow_story_check" |
    grep -v ':[0-9][0-9]*:[[:space:]]*#' >"$forgeflow_scan_output" || :

  if [ -s "$forgeflow_scan_output" ]; then
    fail "a checker still calls an external utility: $(cat "$forgeflow_scan_output")"
  fi

  new_story empty-path
  forgeflow_empty_path="$forgeflow_test_dir/empty-path"
  mkdir -p "$forgeflow_empty_path"
  forgeflow_command_output="$forgeflow_test_dir/$forgeflow_case_id.no-path"

  if PATH="$forgeflow_empty_path" "$forgeflow_verification_check" \
    "$forgeflow_story_dir" >"$forgeflow_command_output" 2>&1; then
    forgeflow_command_status=0
  else
    forgeflow_command_status=$?
  fi

  assert_status 0
  assert_output_contains 'Result: VERIFICATION_PLAN_OK'
}

# --- AC-012 -----------------------------------------------------------------

the_new_model_is_documented() {
  for forgeflow_required_document in \
    protocol/execution.md \
    protocol/architecture.md \
    docs/execution-governance.md \
    templates/story/verification.md \
    templates/decision.md \
    specs/decisions/ADR-001-execution-governance-in-the-story-contract.md
  do
    [ -f "$forgeflow_repo/$forgeflow_required_document" ] ||
      fail "missing document: $forgeflow_required_document"
  done

  for forgeflow_invariant in \
    'Evidence before modification' \
    'Smallest complete change' \
    'Preserve unrelated work' \
    'No authority escalation' \
    'Verification must exercise changed behavior' \
    'Never weaken verification to obtain PASS' \
    'Never claim unexecuted verification' \
    'Report residual risk'
  do
    grep -Fq "$forgeflow_invariant" "$forgeflow_repo/protocol/execution.md" ||
      fail "execution contract omits invariant: $forgeflow_invariant"
  done

  for forgeflow_term in architecture execution evidence mixed
  do
    grep -Fq "\`$forgeflow_term\`" "$forgeflow_repo/protocol/execution.md" ||
      fail "execution contract omits task mode: $forgeflow_term"
  done

  grep -Fq 'add_dependency' "$forgeflow_repo/protocol/execution.md" ||
    fail 'execution contract omits the authority model'
  grep -Fq 'VERIFICATION_PARTIAL' "$forgeflow_repo/protocol/verification.md" ||
    fail 'verification contract omits the partial result'
  grep -Fq 'verification profile' "$forgeflow_repo/protocol/verification.md" ||
    fail 'verification contract omits the profile model'
  grep -Fq 'specs/decisions/' "$forgeflow_repo/protocol/architecture.md" ||
    fail 'architecture contract omits the decision location'
  architecture_extension_point "$forgeflow_repo/protocol/architecture.md" ||
    fail 'architecture contract omits its stated non-goal'
  grep -Fq 'Task mode' "$forgeflow_repo/templates/story/story.md" ||
    fail 'the Story template omits the task mode'
  grep -Fq 'verification-check' "$forgeflow_repo/docs/contract-checks.md" ||
    fail 'contract checks omit the verification check'
  grep -Fq '**Additive** for `0.5.0`' "$forgeflow_repo/protocol/versioning.md" ||
    fail 'versioning omits the FF-224 classification'
  grep -Fq 'protocol/execution.md' "$forgeflow_repo/README.md" ||
    fail 'the README does not link the execution contract'
}

forgeflow_test_dir=$(mktemp -d "${TMPDIR:-/tmp}/forgeflow-execution.XXXXXX")

cleanup() {
  rm -rf "$forgeflow_test_dir"
}

trap cleanup EXIT
trap 'exit 1' HUP INT TERM

forgeflow_repo=$(
  cd -P "$(dirname "$0")/.." >/dev/null 2>&1
  pwd
)
forgeflow_story_check="$forgeflow_repo/scripts/story-check"
forgeflow_verification_check="$forgeflow_repo/scripts/verification-check"
forgeflow_stories_root="$forgeflow_test_dir/specs/stories"
forgeflow_decisions_root="$forgeflow_test_dir/specs/decisions"
mkdir -p "$forgeflow_stories_root" "$forgeflow_decisions_root"

run_case 'FF224-AC-001' defaults_preserve_a_story_without_declarations
run_case 'FF224-AC-002' a_story_can_declare_its_execution_contract
run_case 'FF224-AC-003' evidence_mode_never_authorizes_mutation
run_case 'FF224-AC-004' authority_escalation_is_explicit
run_case 'FF224-AC-005' architecture_metadata_must_resolve
run_case 'FF228-AC-001' configured_decision_root_is_explicit_and_isolated
run_case 'FF224-AC-006' risk_declarations_stay_honest
run_case 'FF228-AC-002' risk_reason_diagnostics_explain_the_literal_shape
run_case 'P0002-AC-008' risk_signals_are_opt_in_and_do_not_change_the_profile
run_case 'FF224-AC-007' the_profile_follows_risk_and_architecture_impact
run_case 'FF224-AC-008' an_unproven_result_is_partial_not_pass
run_case 'FF224-AC-009' used_authority_must_have_been_granted
run_case 'FF224-AC-010' a_malformed_or_silent_result_is_reported
the_extension_point_assertion_pins_the_paragraph() {
  forgeflow_pin_dir="$forgeflow_test_dir/$forgeflow_case_id"
  mkdir -p "$forgeflow_pin_dir"

  architecture_extension_point "$forgeflow_repo/protocol/architecture.md" ||
    fail 'the predicate does not accept the complete paragraph'

  # The paragraph removed entirely.
  awk '
    /^The `architecture` layer in a/ {skip=1}
    /^Whether a declared boundary/ {skip=0}
    skip==0 {print}
  ' "$forgeflow_repo/protocol/architecture.md" >"$forgeflow_pin_dir/removed.md"
  if architecture_extension_point "$forgeflow_pin_dir/removed.md"; then
    fail 'the assertion still passes with the extension point removed'
  fi

  # Only the unrelated sentence retained: this is exactly what the previous
  # substring assertion accepted.
  printf '%s\n' \
    'The concerns this metadata is meant to carry are ownership, boundary,' \
    'dependency direction, public contract, state authority, recovery, migration,' \
    'and retirement.' >"$forgeflow_pin_dir/lookalike.md"
  if architecture_extension_point "$forgeflow_pin_dir/lookalike.md"; then
    fail 'the assertion passes on the unrelated dependency-direction sentence'
  fi

  # A list that silently drops one entry, the defect the restatements carried.
  grep -Fv 'architecture drift' "$forgeflow_repo/protocol/architecture.md" \
    >"$forgeflow_pin_dir/incomplete.md"
  if architecture_extension_point "$forgeflow_pin_dir/incomplete.md"; then
    fail 'the assertion passes with an entry dropped from the list'
  fi
}

run_case 'FF224-AC-011' the_gate_and_the_builtin_guarantee_hold
run_case 'FF226-AC-004' the_extension_point_assertion_pins_the_paragraph
run_case 'FF224-AC-012' the_new_model_is_documented

focused_documentation_uses_its_declared_check() {
  new_story focused-docs
  add_section '## Verification Scope' \
    '* Scope: focused' '* Surface: documentation' \
    '* documentation: `./check-docs`'

  run_story_check "$forgeflow_story_dir"
  assert_status 0
  run_verification_check "$forgeflow_story_dir"
  assert_status 0
  assert_output_contains 'Verification scope: focused documentation'
  assert_output_contains 'Required checks: documentation'

  write_result <<'FORGEFLOW_RESULT'
# Verification Result

## Checks

* documentation: pass — `./check-docs`
* full: skipped — `approved focused documentation scope`

## Evidence

* `AC-001`: pass — `docs review one`
* `AC-002`: pass — `docs review two`

## Authority Used

* modify

## Residual Risks

* `full repository gate intentionally not run`
FORGEFLOW_RESULT
  run_verification_check --result "$forgeflow_story_dir"
  assert_status 0
  assert_output_contains 'Result: VERIFICATION_PASS'

  grep -Fv '* full: skipped' "$forgeflow_story_dir/verification.md" \
    >"$forgeflow_story_dir/verification.new"
  mv "$forgeflow_story_dir/verification.new" "$forgeflow_story_dir/verification.md"
  run_verification_check --result "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'focused result must record the full gate as skipped or passed'
  assert_output_contains 'Result: VERIFICATION_PARTIAL'
}

run_case 'FF229-AC-003' focused_documentation_uses_its_declared_check

focused_scope_rejects_missing_checks_and_ineligible_documents() {
  new_story focused-missing
  add_section '## Verification Scope' \
    '* Scope: focused' '* Surface: documentation'
  run_story_check "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'focused verification check is not declared: documentation'
  run_verification_check "$forgeflow_story_dir"
  assert_status 1

  new_story focused-high-risk-docs
  add_section '## Risk' '* Level: high' '* Reason: `public-contract`'
  add_section '## Verification Scope' \
    '* Scope: focused' '* Surface: documentation' \
    '* documentation: `./check-docs`'
  run_story_check "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'focused documentation requires low risk and low architecture impact'

  new_story focused-high-impact-docs
  add_section '## Architecture' '* Impact: high' '* Contract: `Public boundary stays stable`'
  add_section '## Verification Scope' \
    '* Scope: focused' '* Surface: documentation' \
    '* documentation: `./check-docs`'
  run_story_check "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'focused documentation requires low risk and low architecture impact'
}

run_case 'FF229-AC-007' focused_scope_rejects_missing_checks_and_ineligible_documents

focused_executable_keeps_risk_layers_and_exact_commands() {
  new_story focused-code
  add_section '## Architecture' '* Impact: high' '* Contract: `Boundary stays stable`'
  add_section '## Risk' '* Level: high' '* Reason: `public-contract`'
  add_section '## Verification Scope' \
    '* Scope: focused' '* Surface: executable' \
    '* lint: `make lint-changed`' '* static: `make static-changed`' \
    '* unit: `make unit-changed`' '* integration: `make integration-changed`' \
    '* contract: `make contract-changed`' '* e2e: `make e2e-changed`' \
    '* architecture: `make architecture-changed`'
  run_story_check "$forgeflow_story_dir"
  assert_status 0
  run_verification_check "$forgeflow_story_dir"
  assert_status 0
  assert_output_contains 'Verification scope: focused executable'
  assert_output_contains 'Required checks: lint static unit integration contract e2e architecture'

  write_result <<'FORGEFLOW_RESULT'
# Verification Result

## Checks

* lint: pass — `make lint-changed`
* static: pass — `make static-changed`
* unit: pass — `make unit-changed`
* integration: pass — `make integration-changed`
* contract: pass — `make contract-changed`
* e2e: pass — `make e2e-changed`
* architecture: pass — `make architecture-changed`
* full: skipped — `approved focused executable scope`

## Evidence

* `AC-001`: pass — `changed behavior one`
* `AC-002`: pass — `changed behavior two`

## Authority Used

* modify

## Residual Risks

* `full repository gate intentionally not run`
FORGEFLOW_RESULT
  run_verification_check --result "$forgeflow_story_dir"
  assert_status 0
  assert_output_contains 'Result: VERIFICATION_PASS'

  sed 's/make unit-changed/make unrelated-unit/' \
    "$forgeflow_story_dir/verification.md" >"$forgeflow_story_dir/verification.new"
  mv "$forgeflow_story_dir/verification.new" "$forgeflow_story_dir/verification.md"
  run_verification_check --result "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'does not match its declared focused command'
}

run_case 'FF229-AC-002' focused_executable_keeps_risk_layers_and_exact_commands

full_scope_does_not_accept_only_a_documentation_check() {
  new_story default-full
  write_result <<'FORGEFLOW_RESULT'
# Verification Result

## Checks

* documentation: pass — `./check-docs`

## Evidence

* `AC-001`: pass — `docs review one`
* `AC-002`: pass — `docs review two`

## Authority Used

* modify

## Residual Risks

* `full make verify was not run`
FORGEFLOW_RESULT
  run_verification_check --result "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'required check is not recorded: lint'
  assert_output_contains 'Result: VERIFICATION_PARTIAL'
}

run_case 'FF229-AC-004' full_scope_does_not_accept_only_a_documentation_check

explicit_full_scope_requires_gate_evidence() {
  new_story explicit-full
  add_section '## Verification Scope' '* Scope: full'
  run_story_check "$forgeflow_story_dir"
  assert_status 0
  run_verification_check "$forgeflow_story_dir"
  assert_status 0
  assert_output_contains 'Required checks: lint static unit full'

  write_result <<'FORGEFLOW_RESULT'
# Verification Result

## Checks

* lint: pass — `make verify`
* static: pass — `make verify`
* unit: pass — `make verify`

## Evidence

* `AC-001`: pass — `case one`
* `AC-002`: pass — `case two`

## Authority Used

* modify

## Residual Risks

* `required full gate was not run`
FORGEFLOW_RESULT
  run_verification_check --result "$forgeflow_story_dir"
  assert_status 1
  assert_output_contains 'required check is not recorded: full'

  awk '/^\* unit: pass/ { print; print "* full: pass — `make verify`"; next } { print }' \
    "$forgeflow_story_dir/verification.md" >"$forgeflow_story_dir/verification.new"
  mv "$forgeflow_story_dir/verification.new" "$forgeflow_story_dir/verification.md"
  run_verification_check --result "$forgeflow_story_dir"
  assert_status 0
  assert_output_contains 'Result: VERIFICATION_PASS'
}

run_case 'FF229-AC-004' explicit_full_scope_requires_gate_evidence

focused_result_can_also_record_a_completed_full_gate() {
  new_story focused-with-full
  add_section '## Verification Scope' \
    '* Scope: focused' '* Surface: documentation' \
    '* documentation: `./check-docs`'
  write_result <<'FORGEFLOW_RESULT'
# Verification Result

## Checks

* documentation: pass — `./check-docs`
* full: pass — `make verify`

## Evidence

* `AC-001`: pass — `docs review one`
* `AC-002`: pass — `docs review two`

## Authority Used

* modify
FORGEFLOW_RESULT
  run_verification_check --result "$forgeflow_story_dir"
  assert_status 0
  assert_output_contains 'Result: VERIFICATION_PASS'
}

run_case 'FF229-AC-004' focused_result_can_also_record_a_completed_full_gate

focused_required_failures_remain_visible() {
  new_story focused-statuses
  add_section '## Verification Scope' \
    '* Scope: focused' '* Surface: documentation' \
    '* documentation: `./check-docs`'
  cat >"$forgeflow_story_dir/verification.base" <<'FORGEFLOW_RESULT'
# Verification Result

## Checks

* documentation: STATUS — `document check did not pass`
* full: skipped — `approved focused documentation scope`

## Evidence

* `AC-001`: pass — `docs review one`
* `AC-002`: pass — `docs review two`

## Authority Used

* modify

## Residual Risks

* `document check did not pass`
* `full repository gate intentionally not run`
FORGEFLOW_RESULT
  for forgeflow_check_status in skipped blocked unsupported fail; do
    sed "s/STATUS/$forgeflow_check_status/" \
      "$forgeflow_story_dir/verification.base" >"$forgeflow_story_dir/verification.md"
    run_verification_check --result "$forgeflow_story_dir"
    assert_status 1
    if [ "$forgeflow_check_status" = fail ]; then
      assert_output_contains 'Result: VERIFICATION_FAIL'
    else
      assert_output_contains 'Result: VERIFICATION_PARTIAL'
    fi
  done
}

run_case 'FF229-AC-007' focused_required_failures_remain_visible

printf 'execution governance tests passed\n'
