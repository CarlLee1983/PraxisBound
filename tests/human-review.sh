#!/bin/sh

set -eu

forgeflow_repo=$(cd -P "$(dirname "$0")/.." >/dev/null 2>&1 && pwd)

fail() {
  printf 'human review test failed: %s\n' "$1" >&2
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
    printf 'PASS %s\n' "$forgeflow_case_id"
  else
    fail "$forgeflow_case_id"
  fi
}

human_review_keeps_automation_and_acceptance_separate() {
  [ -s "$forgeflow_repo/docs/human-review.md" ] || return 1

  for forgeflow_term in \
    'contextual judgment' \
    'automated gate' \
    '`make verify` PASS' \
    'may enter REVIEW' \
    'An agent may prepare' \
    'cannot approve REVIEW' \
    'Only a human' \
    'not that Human Review passed' \
    'DONE'
  do
    contains docs/human-review.md "$forgeflow_term"
  done
}

guidance_covers_required_review_dimensions() {
  for forgeflow_term in \
    'Intent and behavior' \
    'Naming and readability' \
    'Responsibility and cohesion' \
    'Abstraction and duplication' \
    'Dependencies and architecture' \
    'Error handling and side effects' \
    'Tests' \
    'Scope and maintainability'
  do
    contains docs/human-review.md "$forgeflow_term"
  done
}

solid_is_contextual_not_a_scorecard() {
  for forgeflow_term in \
    'SRP' \
    'OCP' \
    'LSP' \
    'ISP' \
    'DIP' \
    'contextual prompts' \
    'same class structure' \
    'numeric thresholds' \
    'LLM scoring'
  do
    contains docs/human-review.md "$forgeflow_term"
  done
}

accepted_requires_human_authority() {
  for forgeflow_term in \
    'Accepted' \
    'Only a human' \
    'REVIEW → DONE' \
    'product intent' \
    'design' \
    'architecture' \
    'merge policy'
  do
    contains docs/human-review.md "$forgeflow_term"
  done

  contains protocol/lifecycle.md 'REVIEW → DONE'
}

changes_requested_return_to_verification() {
  for forgeflow_term in \
    'Changes requested' \
    'REVIEW → IMPLEMENTING → VERIFYING → REVIEW' \
    'prior PASS insufficient' \
    'complete `make verify`'
  do
    contains docs/human-review.md "$forgeflow_term"
  done

  contains protocol/lifecycle.md 'REVIEW → IMPLEMENTING'
}

specification_blockers_require_human_resolution() {
  for forgeflow_term in \
    'Specification blocked' \
    'REVIEW → SPEC_BLOCKED → READY' \
    'human' \
    'resolve' \
    'revise' \
    'reapprove'
  do
    contains docs/human-review.md "$forgeflow_term"
  done

  contains protocol/lifecycle.md 'REVIEW → SPEC_BLOCKED'
  contains protocol/lifecycle.md 'SPEC_BLOCKED → READY'
}

review_preparation_is_distributed_without_self_approval() {
  for forgeflow_file in templates/AGENTS.md skills/story-development/SKILL.md
  do
    for forgeflow_term in \
      'Review Preparation' \
      'Story and acceptance' \
      'design and boundary' \
      'test and verification' \
      'assumptions' \
      'unresolved risks' \
      'attention points' \
      'self-approval' \
      'SPEC_BLOCKED'
    do
      contains "$forgeflow_file" "$forgeflow_term"
    done
  done
}

navigation_explains_the_human_review_boundary() {
  for forgeflow_file in README.md docs/concepts.md docs/code-quality.md docs/getting-started.md
  do
    contains "$forgeflow_file" 'human-review.md'
  done

  for forgeflow_term in \
    'design judgment remains with Human' \
    'new complete `make verify` PASS' \
    'neither an LLM score nor automated approval'
  do
    contains README.md "$forgeflow_term"
  done

  for forgeflow_term in \
    'other contextual' \
    'design judgments remain with Human Review' \
    'new complete' \
    '`make verify` PASS' \
    'Only a' \
    'human accepts the work'
  do
    contains docs/concepts.md "$forgeflow_term"
  done

  for forgeflow_term in \
    'design and architecture judgment' \
    'complete `make verify` again' \
    'automated approval cannot substitute for human acceptance'
  do
    contains docs/code-quality.md "$forgeflow_term"
  done

  for forgeflow_term in \
    'contextual review questions' \
    'run the complete' \
    '`make verify` again' \
    'only a human can accept the review'
  do
    contains docs/getting-started.md "$forgeflow_term"
  done
}

compatibility_keeps_the_existing_protocol_surface() {
  for forgeflow_state in DRAFT READY IMPLEMENTING VERIFYING REVIEW DONE SPEC_BLOCKED
  do
    grep -Fq "| $forgeflow_state |" "$forgeflow_repo/protocol/lifecycle.md" || return 1
  done

  [ "$(grep -Ec '^\| [^|][^|]* \|' "$forgeflow_repo/protocol/lifecycle.md" || :)" -eq 9 ] || return 1

  for forgeflow_term in \
    'no required adopter artifact' \
    'no Make target' \
    'no automated approval' \
    'PASS, FAIL, or Repair Loop semantics'
  do
    contains docs/human-review.md "$forgeflow_term"
  done

  if grep -Eiq '^[^:#]*(review|approv|accept)[^:]*:' \
    "$forgeflow_repo/Makefile"; then
    return 1
  fi

  lacks scripts/bootstrap 'review.md'
  lacks protocol/repository-contract.md 'review.md'
  lacks templates/AGENTS.md 'review.md'
  lacks templates/story/story.md 'Architecture Impact'
}

versioning_keeps_human_review_history_and_current_version() {
  grep -Fqx '0.4.1' "$forgeflow_repo/VERSION" || return 1
  contains docs/doctor.md 'Adopted version: 0.4.1'
  contains protocol/versioning.md 'Human Review Guidance is **Additive** for `0.3.4`'
  for forgeflow_term in \
    'no required adoption file' \
    'Make target, tool, or artifact' \
    'adds no lifecycle state'
  do
    contains protocol/versioning.md "$forgeflow_term"
  done
}

contract_cases_and_root_gate_are_composed() {
  for forgeflow_case_number in 001 002 003 004 005 006 007 008 009 010 011
  do
    [ "$(grep -Ec "^run_case 'AC-$forgeflow_case_number'" "$forgeflow_repo/tests/human-review.sh" || :)" -eq 1 ] || return 1
  done

  contains Makefile 'verify: verify-protocol verify-bootstrap verify-doctor verify-story verify-handoff verify-release verify-typescript verify-go verify-actions'
  contains Makefile 'sh -n tests/protocol.sh tests/code-quality.sh tests/human-review.sh'
  contains Makefile './tests/human-review.sh'
}

run_case 'AC-001' human_review_keeps_automation_and_acceptance_separate
run_case 'AC-002' guidance_covers_required_review_dimensions
run_case 'AC-003' solid_is_contextual_not_a_scorecard
run_case 'AC-004' accepted_requires_human_authority
run_case 'AC-005' changes_requested_return_to_verification
run_case 'AC-006' specification_blockers_require_human_resolution
run_case 'AC-007' review_preparation_is_distributed_without_self_approval
run_case 'AC-008' navigation_explains_the_human_review_boundary
run_case 'AC-009' compatibility_keeps_the_existing_protocol_surface
run_case 'AC-010' versioning_keeps_human_review_history_and_current_version
run_case 'AC-011' contract_cases_and_root_gate_are_composed

printf 'human review tests passed\n'
