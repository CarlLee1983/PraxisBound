#!/bin/sh

set -eu

forgeflow_repo=$(cd -P "$(dirname "$0")/.." >/dev/null 2>&1 && pwd)

fail() {
  printf 'review integrity test failed [%s]: %s\n' "$forgeflow_case_id" "$1" >&2
  exit 1
}

contains() {
  grep -Fq -- "$2" "$forgeflow_repo/$1" ||
    fail "$1 is missing: $2"
}

lacks() {
  if grep -Fq -- "$2" "$forgeflow_repo/$1"; then
    fail "$1 must not contain: $2"
  fi
}

run_case() {
  forgeflow_case_id=$1
  forgeflow_case_function=$2

  if "$forgeflow_case_function"; then
    printf 'PASS %s %s\n' "$forgeflow_case_id" "$forgeflow_case_function"
  else
    fail "$forgeflow_case_function"
  fi
}

ff215_completion_records_agree() {
  contains specs/stories/FF-215-human-review-guidance/task.md \
    'Human Review accepted'
  contains specs/stories/FF-215-human-review-guidance/task.md \
    'FF-215 is DONE'
  lacks specs/stories/FF-215-human-review-guidance/task.md \
    'Human Review remains pending'
  lacks specs/stories/FF-215-human-review-guidance/task.md \
    'Story is not DONE'
  contains protocol/versioning.md \
    'Human Review Guidance is **Additive** for `0.3.4`'
}

handoff_records_release_history_not_live_state() {
  contains specs/stories/FF-216-review-integrity-and-state-consistency/acceptance.md \
    '`v0.3.4` as published'
  contains specs/stories/FF-216-review-integrity-and-state-consistency/acceptance.md \
    '8e0eb8c10bbd3d6d4d654de42ff7eee115d8c8a4'
  contains specs/handoff.md 'immutable'
  contains specs/handoff.md 'intentionally says nothing about current work'
  for forgeflow_file in protocol/handoff.md docs/releasing.md
  do
    contains "$forgeflow_file" 'time-sensitive'
  done
  contains protocol/handoff.md 'query the owning system'
}

review_checks_classification_truthfulness() {
  for forgeflow_term in \
    '### Contract truthfulness and evidence freshness' \
    'Security sensitive' \
    'trust boundaries' \
    'authorization' \
    'confidential data' \
    'external input' \
    'persistence' \
    'Baseline conformance' \
    'behavior or tests' \
    'Trust Boundary Fields' \
    'Security Fixture Matrix' \
    'Superseded Behavior' \
    'avoid the conditional sections' \
    'Story, Acceptance Criteria, Classification, implementation, and tests'
  do
    contains docs/human-review.md "$forgeflow_term"
  done
}

review_checks_current_verification_evidence() {
  for forgeflow_term in \
    'approved Story scope from the implementation' \
    '`make verify` PASS' \
    'A focused record never certifies the full gate' \
    'does not prove that PASS occurred'
  do
    contains docs/human-review.md "$forgeflow_term"
  done
}

behavior_changes_require_complete_reverification() {
  for forgeflow_term in \
    'source code, tests, configuration' \
    'immediately invalidates the prior PASS' \
    'required checks again' \
    'complete `make verify` when required' \
    'handoff evidence edit is also a repository change' \
    'human reviewer' \
    'complete re-verification'
  do
    contains docs/human-review.md "$forgeflow_term"
  done
}

contract_checks_and_human_review_have_distinct_jobs() {
  for forgeflow_term in \
    'validates the declarations themselves' \
    'does not re-run it' \
    'prove the revision exists' \
    'prove the record was never edited'
  do
    contains docs/contract-checks.md "$forgeflow_term"
  done
}

agent_guidance_prepares_truthful_fresh_review() {
  for forgeflow_file in templates/AGENTS.md skills/story-development/SKILL.md
  do
    for forgeflow_term in \
      'Classification truthfulness' \
      'actual trust boundaries' \
      'baseline behavior' \
      'verification freshness' \
      'A source, test, configuration' \
      'full `make verify`'
    do
      contains "$forgeflow_file" "$forgeflow_term"
    done
  done
}

upgrade_requires_manual_agent_guidance_reconciliation() {
  for forgeflow_term in \
    '0.3.3' \
    'Code Quality guidance' \
    '0.3.4' \
    '0.3.5' \
    'Review Preparation' \
    'Classification truthfulness' \
    'verification freshness' \
    'repository-owned `AGENTS.md` is current' \
    'manually compare' \
    'never merges or overwrites' \
    '`AGENTS.md` in upgrade mode'
  do
    contains docs/upgrading.md "$forgeflow_term"
  done
}

compatibility_adds_no_required_review_surface() {
  for forgeflow_state in DRAFT READY IMPLEMENTING VERIFYING REVIEW DONE SPEC_BLOCKED
  do
    grep -Fq "| $forgeflow_state |" "$forgeflow_repo/protocol/lifecycle.md" ||
      return 1
  done

  [ "$(grep -Ec '^\| [^|][^|]* \|' "$forgeflow_repo/protocol/lifecycle.md" || :)" -eq 9 ] ||
    return 1

  for forgeflow_term in \
    'no required review artifact' \
    'no reviewer metadata' \
    'no automated approval' \
    'automatic Classification inference' \
    'no Make target'
  do
    contains docs/human-review.md "$forgeflow_term"
  done

  for forgeflow_file in \
    protocol/handoff.md \
    protocol/repository-contract.md \
    templates/AGENTS.md \
    templates/handoff.md \
    templates/story/story.md \
    templates/story/acceptance.md \
    templates/story/task.md
  do
    for forgeflow_forbidden_field in \
      'reviewer:' \
      'reviewed_at:' \
      'verified_commit:' \
      'pr_url:'
    do
      lacks "$forgeflow_file" "$forgeflow_forbidden_field"
    done
    lacks "$forgeflow_file" 'review.md'
  done

  [ ! -e "$forgeflow_repo/templates/review.md" ] ||
    fail 'templates/review.md must not exist'

  if grep -Eiq '(LLM score|reviewer:|reviewed_at:|verified_commit:|classif[^ ]* inference|automatic[^ ]* approv)' \
    "$forgeflow_repo/scripts/bootstrap" \
    "$forgeflow_repo/scripts/doctor" \
    "$forgeflow_repo/scripts/story-check" \
    "$forgeflow_repo/scripts/handoff-check"; then
    fail 'an executable checker or installer contains review automation'
  fi

  if grep -Eiq '^[^:#]*(review|approv|accept)[^:]*:' \
    "$forgeflow_repo/Makefile"; then
    fail 'Makefile contains a review or approval target'
  fi
}

versioning_records_the_corrective_patch() {
  contains protocol/versioning.md \
    'Review integrity and state consistency is **Corrective** for `0.3.5`'
  contains protocol/versioning.md 'Existing valid adoptions remain valid'
  contains specs/stories/FF-216-review-integrity-and-state-consistency/story.md \
    'This change is Corrective'
}

release_metadata_for_036_is_preserved() {
  contains docs/releases/0.3.6.md 'No migration is required'
  contains docs/releases/0.3.6.md 'SIGKILL'
}

every_acceptance_criterion_has_one_case() {
  for forgeflow_case_number in 001 002 003 004 005 006 007 008 009 010 011 012
  do
    [ "$(grep -Ec "^run_case 'AC-$forgeflow_case_number'" \
      "$forgeflow_repo/tests/review-integrity.sh" || :)" -eq 1 ] || return 1
  done
}

root_gate_keeps_all_existing_checks() {
  contains Makefile \
    'verify: verify-protocol verify-bootstrap verify-doctor verify-story verify-handoff verify-release verify-typescript verify-go verify-actions'
  for forgeflow_test in \
    './tests/protocol.sh' \
    './tests/code-quality.sh' \
    './tests/human-review.sh' \
    './tests/review-integrity.sh'
  do
    contains Makefile "$forgeflow_test"
  done
}

focused_scope_guidance_is_explicit() {
  contains protocol/execution.md '## Verification scope'
  contains protocol/verification.md '### Focused scope'
  contains templates/AGENTS.md '## Verification Scope'
  contains templates/story/story.md '### Optional focused verification'
  contains templates/story/verification.md '* documentation: pass'
  contains templates/story/verification.md '* full: skipped'
  contains docs/human-review.md 'Reject a focused scope'
}

run_case 'AC-001' ff215_completion_records_agree
run_case 'AC-002' handoff_records_release_history_not_live_state
run_case 'AC-003' review_checks_classification_truthfulness
run_case 'AC-004' review_checks_current_verification_evidence
run_case 'AC-005' behavior_changes_require_complete_reverification
run_case 'AC-006' contract_checks_and_human_review_have_distinct_jobs
run_case 'AC-007' agent_guidance_prepares_truthful_fresh_review
run_case 'AC-008' upgrade_requires_manual_agent_guidance_reconciliation
run_case 'AC-009' compatibility_adds_no_required_review_surface
run_case 'AC-010' versioning_records_the_corrective_patch
run_case 'FF221-AC-001' release_metadata_for_036_is_preserved
run_case 'FF221-AC-002' versioning_records_the_corrective_patch
run_case 'AC-011' every_acceptance_criterion_has_one_case
run_case 'AC-012' root_gate_keeps_all_existing_checks
run_case 'FF229-AC-006' focused_scope_guidance_is_explicit

printf 'review integrity tests passed\n'
