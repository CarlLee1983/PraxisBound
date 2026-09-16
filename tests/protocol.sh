#!/bin/sh

set -eu

fail() {
  printf 'protocol test failed [%s]: %s\n' "${forgeflow_case_id:-top-level}" "$1" >&2
  exit 1
}

run_case() {
  forgeflow_case_id=$1
  forgeflow_case_function=$2
  "$forgeflow_case_function"
  printf 'PASS %s %s\n' "$forgeflow_case_id" "$forgeflow_case_function"
}

forgeflow_repo=$(
  cd -P "$(dirname "$0")/.." >/dev/null 2>&1
  pwd
)

valid_version_file() {
  forgeflow_version_file=$1

  [ -f "$forgeflow_version_file" ] || return 1

  forgeflow_version_line_count=$(
    wc -l <"$forgeflow_version_file" | tr -d '[:space:]'
  )

  [ "$forgeflow_version_line_count" -eq 1 ] &&
    grep -Eq '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' \
      "$forgeflow_version_file"
}

check_story_headings() {
  forgeflow_heading_file=$1
  forgeflow_heading_label=$2

  for forgeflow_required_heading in \
    '## Goal' \
    '## Context' \
    '## Scope' \
    '## Inputs' \
    '## Outputs' \
    '## Rules' \
    '## Expected Errors' \
    '## Dependencies' \
    '## Classification' \
    '## Constraints'
  do
    grep -Fqx "$forgeflow_required_heading" "$forgeflow_heading_file" ||
      fail "$forgeflow_heading_label is missing: $forgeflow_required_heading"
  done
}

check_acceptance_mapping() {
  forgeflow_mapping_acceptance=$1
  forgeflow_mapping_tests=$2
  shift 2

  for forgeflow_mapping_ac_number in "$@"
  do
    forgeflow_mapping_acceptance_count=$(
      grep -Ec "AC-$forgeflow_mapping_ac_number:" \
        "$forgeflow_mapping_acceptance" || :
    )
    forgeflow_mapping_test_count=$(
      grep -Ec "^run_case 'AC-$forgeflow_mapping_ac_number'" \
        "$forgeflow_mapping_tests" || :
    )

    if [ "$forgeflow_mapping_acceptance_count" -ne 1 ]; then
      fail "$forgeflow_mapping_acceptance must define AC-$forgeflow_mapping_ac_number exactly once"
    fi

    if [ "$forgeflow_mapping_test_count" -ne 1 ]; then
      fail "$forgeflow_mapping_tests must map AC-$forgeflow_mapping_ac_number exactly once"
    fi
  done
}

check_prefixed_acceptance_mapping() {
  forgeflow_mapping_acceptance=$1
  forgeflow_mapping_tests=$2
  forgeflow_mapping_prefix=$3
  shift 3

  for forgeflow_mapping_ac_number in "$@"
  do
    forgeflow_mapping_acceptance_count=$(
      grep -Ec "AC-$forgeflow_mapping_ac_number:" \
        "$forgeflow_mapping_acceptance" || :
    )
    forgeflow_mapping_test_count=$(
      grep -Ec "^run_case '$forgeflow_mapping_prefix-AC-$forgeflow_mapping_ac_number'" \
        "$forgeflow_mapping_tests" || :
    )

    if [ "$forgeflow_mapping_acceptance_count" -ne 1 ]; then
      fail "$forgeflow_mapping_acceptance must define AC-$forgeflow_mapping_ac_number exactly once"
    fi

    if [ "$forgeflow_mapping_test_count" -lt 1 ]; then
      fail "$forgeflow_mapping_tests must map $forgeflow_mapping_prefix-AC-$forgeflow_mapping_ac_number"
    fi
  done
}

check_acceptance_headings() {
  forgeflow_heading_file=$1
  forgeflow_heading_label=$2

  for forgeflow_required_heading in \
    '## Happy Path' \
    '## Business Rules' \
    '## Failure Cases' \
    '## Regression Requirements' \
    '## Verification Notes'
  do
    grep -Fqx "$forgeflow_required_heading" "$forgeflow_heading_file" ||
      fail "$forgeflow_heading_label is missing: $forgeflow_required_heading"
  done
}

for forgeflow_required_file in \
  LICENSE \
  VERSION \
  .node-version \
  .github/workflows/verify.yml \
  README.md \
  guidance/ENTRY.md \
  guidance/PRINCIPLES.md \
  guidance/DECISIONS.md \
  guidance/PRACTICES.md \
  protocol/story.md \
  protocol/verification.md \
  protocol/execution.md \
  protocol/architecture.md \
  protocol/lifecycle.md \
  protocol/handoff.md \
  protocol/repository-contract.md \
  protocol/versioning.md \
  skills/story-development/SKILL.md \
  templates/AGENTS.md \
  templates/story/story.md \
  templates/story/acceptance.md \
  templates/story/task.md \
  templates/story/verification.md \
  templates/decision.md \
  templates/handoff.md \
  templates/ci/github-actions.yml \
  docs/code-quality.md \
  docs/codex-activation.md \
  docs/concepts.md \
  docs/contract-checks.md \
  docs/execution-governance.md \
  docs/doctor.md \
  docs/getting-started.md \
  docs/releases/0.5.2.md \
  docs/releases/0.6.0.md \
  docs/releases/0.7.0.md \
  docs/releases/0.8.0.md \
  docs/releases/0.9.0.md \
  docs/releasing.md \
  examples/typescript/Makefile \
  examples/typescript/scripts/check-traceability.sh \
  examples/typescript/tests/traceability.sh \
  examples/go/Makefile \
  scripts/bootstrap \
  scripts/doctor \
  scripts/story-check \
  scripts/handoff-check \
  scripts/release-check \
  specs/handoff.md \
  tests/doctor.sh \
  tests/story-check.sh \
  tests/handoff-check.sh \
  tests/release-check-entrypoint.sh \
  tests/review-integrity.sh \
  specs/stories/FF-216-review-integrity-and-state-consistency/story.md \
  specs/stories/FF-216-review-integrity-and-state-consistency/acceptance.md \
  specs/stories/FF-216-review-integrity-and-state-consistency/task.md \
  specs/stories/P0-001-remove-mutable-lifecycle-state/story.md \
  specs/stories/P0-001-remove-mutable-lifecycle-state/acceptance.md \
  specs/stories/P1-003-structural-contract-simplification/story.md \
  specs/stories/P1-003-structural-contract-simplification/acceptance.md
do
  if [ ! -s "$forgeflow_repo/$forgeflow_required_file" ]; then
    fail "required artifact is missing or empty: $forgeflow_required_file"
  fi
done

# FF226-AC-001, FF226-AC-003 and FF226-AC-006. The five analysis checks are a
# stated non-goal, and the failure this guards is a restatement that renames an
# entry, drops one, or reverts to calling them planned work.
forgeflow_analysis_checks='dependency direction validation
forbidden imports
layer boundaries
public interface drift
architecture drift'

for forgeflow_vocabulary_file in \
  protocol/architecture.md \
  protocol/versioning.md \
  docs/code-quality.md
do
  printf '%s\n' "$forgeflow_analysis_checks" | while IFS= read -r forgeflow_term
  do
    [ -n "$forgeflow_term" ] || continue
    grep -Fq "$forgeflow_term" "$forgeflow_repo/$forgeflow_vocabulary_file" ||
      fail "$forgeflow_vocabulary_file omits the analysis check: $forgeflow_term"
  done

  if grep -Fq 'future extensions' "$forgeflow_repo/$forgeflow_vocabulary_file"; then
    fail "$forgeflow_vocabulary_file still calls the analysis checks future work"
  fi
done

grep -Fq 'scope boundary, not a schedule' "$forgeflow_repo/protocol/architecture.md" ||
  fail 'architecture contract does not state the non-goal as a boundary'
grep -Fq 'ADR-003' "$forgeflow_repo/protocol/architecture.md" ||
  fail 'architecture contract does not reference the decision record'
grep -Fq "unrelated to Doctor's \`CONTRACT_DRIFT\`" \
  "$forgeflow_repo/protocol/architecture.md" ||
  fail 'architecture contract does not distinguish the two drift meanings'

# Doctor keeps the shipped meaning of CONTRACT_DRIFT; only the architectural
# sense moved.
grep -Fq 'CONTRACT_DRIFT' "$forgeflow_repo/docs/doctor.md" ||
  fail 'Doctor documentation lost its CONTRACT_DRIFT result'
if grep -Fq 'public interface drift' "$forgeflow_repo/docs/doctor.md"; then
  fail 'Doctor documentation adopted the architectural drift term'
fi

# The published 0.5.0 notes are a historical record and stay byte-identical.
forgeflow_published_notes=$(cksum <"$forgeflow_repo/docs/releases/0.5.0.md")
if [ "$forgeflow_published_notes" != '1961408805 2836' ]; then
  fail 'docs/releases/0.5.0.md was edited; published release notes are a record'
fi

grep -Fq '**Corrective** for `0.5.2`' "$forgeflow_repo/protocol/versioning.md" ||
  fail 'versioning omits the FF-226 classification'

if ! valid_version_file "$forgeflow_repo/VERSION"; then
  fail 'VERSION must contain one MAJOR.MINOR.PATCH value'
fi

forgeflow_version_test_dir=$(
  mktemp -d "${TMPDIR:-/tmp}/forgeflow-version.XXXXXX"
)

cleanup_version_tests() {
  rm -rf "$forgeflow_version_test_dir"
}

trap cleanup_version_tests EXIT
trap 'exit 1' HUP INT TERM

printf '0.2.0\n' >"$forgeflow_version_test_dir/valid"
valid_version_file "$forgeflow_version_test_dir/valid" ||
  fail 'version validator rejected valid metadata'

for forgeflow_invalid_version in empty short prefixed leading-zero multiline
do
  case "$forgeflow_invalid_version" in
    empty)
      : >"$forgeflow_version_test_dir/$forgeflow_invalid_version"
      ;;
    short)
      printf '0.2\n' >"$forgeflow_version_test_dir/$forgeflow_invalid_version"
      ;;
    prefixed)
      printf 'v0.2.0\n' >"$forgeflow_version_test_dir/$forgeflow_invalid_version"
      ;;
    leading-zero)
      printf '00.2.0\n' >"$forgeflow_version_test_dir/$forgeflow_invalid_version"
      ;;
    multiline)
      printf '0.2.0\nextra\n' \
        >"$forgeflow_version_test_dir/$forgeflow_invalid_version"
      ;;
  esac

  if valid_version_file \
    "$forgeflow_version_test_dir/$forgeflow_invalid_version"; then
    fail "version validator accepted $forgeflow_invalid_version metadata"
  fi
done

if valid_version_file "$forgeflow_version_test_dir/missing"; then
  fail 'version validator accepted missing metadata'
fi

grep -Fq "[\`VERSION\`](VERSION)" "$forgeflow_repo/README.md" ||
  fail 'README does not link to the protocol version authority'

grep -Fq '[Protocol Versioning policy](protocol/versioning.md)' \
  "$forgeflow_repo/README.md" ||
  fail 'README does not link to the protocol versioning policy'

for forgeflow_versioning_term in \
  'single authority' \
  'Breaking' \
  'Additive' \
  'Corrective' \
  'Before PraxisBound 1.0' \
  'Starting with 1.0' \
  'vMAJOR.MINOR.PATCH' \
  'private TypeScript example'
do
  grep -Fq "$forgeflow_versioning_term" \
    "$forgeflow_repo/protocol/versioning.md" ||
    fail "versioning policy is missing: $forgeflow_versioning_term"
done

grep -Fq '[Repository Doctor](docs/doctor.md)' "$forgeflow_repo/README.md" ||
  fail 'README does not link to Repository Doctor documentation'

grep -Fq '[Repository Doctor](doctor.md)' \
  "$forgeflow_repo/docs/getting-started.md" ||
  fail 'Getting Started does not link to Repository Doctor documentation'

forgeflow_doctor_document="$forgeflow_repo/docs/doctor.md"

for forgeflow_doctor_document_term in \
  './scripts/doctor [repository-directory]' \
  './scripts/doctor --run-verify [repository-directory]' \
  'Verification: NOT_RUN' \
  'STRUCTURE_OK' \
  'STRUCTURE_INCOMPLETE' \
  'VERIFIED_LOCAL' \
  'VERIFICATION_FAILED' \
  'NOT_CHECKED' \
  'Human review is always still required' \
  'Doctor never authorizes a merge'
do
  grep -Fq -- "$forgeflow_doctor_document_term" \
    "$forgeflow_doctor_document" ||
    fail "Doctor documentation is missing: $forgeflow_doctor_document_term"
done

grep -Fq 'Repository Doctor is an **Additive** capability' \
  "$forgeflow_repo/protocol/versioning.md" ||
  fail 'versioning policy does not classify Repository Doctor as Additive'

for forgeflow_story_directory in \
  specs/stories/FF-201-protocol-version-contract \
  specs/stories/FF-202-bootstrap-dry-run \
  specs/stories/FF-203-executable-story-example \
  specs/stories/FF-204-linux-ci \
  specs/stories/FF-205-release-readiness \
  specs/stories/FF-206-typescript-executable-story-parity \
  specs/stories/FF-207-repository-doctor \
  specs/stories/FF-208-security-fixture-matrix \
  specs/stories/FF-209-handoff-contract \
  examples/typescript/specs/stories/TYP-001-order-total \
  examples/go/specs/stories/ORD-001-order-total
do
  forgeflow_story_file="$forgeflow_repo/$forgeflow_story_directory/story.md"
  forgeflow_acceptance_file="$forgeflow_repo/$forgeflow_story_directory/acceptance.md"

  if [ ! -s "$forgeflow_story_file" ] ||
    [ ! -s "$forgeflow_acceptance_file" ]; then
    fail "approved Story artifacts are missing: $forgeflow_story_directory"
  fi

  check_story_headings "$forgeflow_story_file" "$forgeflow_story_directory"
  check_acceptance_headings \
    "$forgeflow_acceptance_file" "$forgeflow_story_directory"

  if grep -Eq '<ID>|<Title>|Describe the user or business outcome|^\*[[:space:]]*$' \
    "$forgeflow_story_file" "$forgeflow_acceptance_file"; then
    fail "approved Story contains template placeholders: $forgeflow_story_directory"
  fi
done

forgeflow_doctor_acceptance="$forgeflow_repo/specs/stories/FF-207-repository-doctor/acceptance.md"
forgeflow_doctor_tests="$forgeflow_repo/tests/doctor.sh"

check_acceptance_mapping "$forgeflow_doctor_acceptance" \
  "$forgeflow_doctor_tests" \
  001 002 003 004 005 006 007 008 009 010 011 012

for forgeflow_doctor_artifact in scripts/doctor tests/doctor.sh
do
  if [ ! -x "$forgeflow_repo/$forgeflow_doctor_artifact" ]; then
    fail "Doctor artifact is not executable: $forgeflow_doctor_artifact"
  fi
done

forgeflow_typescript_makefile="$forgeflow_repo/examples/typescript/Makefile"

grep -Eq '^traceability:' "$forgeflow_typescript_makefile" ||
  fail 'TypeScript example does not expose the focused traceability target'

grep -Fq "\$(MAKE) traceability" "$forgeflow_typescript_makefile" ||
  fail 'TypeScript verify does not include Story traceability'

for forgeflow_typescript_traceability_artifact in \
  examples/typescript/scripts/check-traceability.sh \
  examples/typescript/tests/traceability.sh
do
  if [ ! -x "$forgeflow_repo/$forgeflow_typescript_traceability_artifact" ]; then
    fail "TypeScript traceability artifact is not executable: $forgeflow_typescript_traceability_artifact"
  fi
done

grep -Fq "[\`specs/stories/TYP-001-order-total\`](specs/stories/TYP-001-order-total/)" \
  "$forgeflow_repo/examples/typescript/README.md" ||
  fail 'TypeScript README does not link to the executable Story'

forgeflow_makefile="$forgeflow_repo/Makefile"

grep -Eq '^verify:.*verify-release' "$forgeflow_makefile" ||
  fail 'root verify does not include release-check tests'

grep -Eq '^verify:.*verify-doctor' "$forgeflow_makefile" ||
  fail 'root verify does not include Doctor tests'

grep -Fqx 'verify-doctor:' "$forgeflow_makefile" ||
  fail 'root Makefile does not expose verify-doctor'

grep -Fq 'sh -n scripts/doctor tests/doctor.sh' "$forgeflow_makefile" ||
  fail 'verify-doctor does not validate shell syntax'

grep -Fq './tests/doctor.sh' "$forgeflow_makefile" ||
  fail 'verify-doctor does not run Doctor acceptance tests'

grep -Eq '^release-check:[[:space:]]+verify$' "$forgeflow_makefile" ||
  fail 'release-check does not depend on canonical verify'

grep -Fq './scripts/release-check' "$forgeflow_makefile" ||
  fail 'release-check target does not invoke the local compatibility wrapper'

grep -Fq './tests/release-check-entrypoint.sh' "$forgeflow_makefile" ||
  fail 'root verify does not include release-check entrypoint acceptance tests'

forgeflow_release_runbook="$forgeflow_repo/docs/releasing.md"

for forgeflow_release_term in \
  'make release-check' \
  'local-only' \
  'candidate_version' \
  'candidate_tag' \
  'candidate_sha' \
  'candidate_remote' \
  'candidate_remote_url' \
  'candidate_repository' \
  'one identical fetch/push URL' \
  'Git remote and GitHub repository do not match' \
  'exact candidate SHA' \
  'git cat-file -t' \
  'gh release create' \
  '--verify-tag' \
  'explicit authorization' \
  'remote tag peels'
do
  grep -Fq -- "$forgeflow_release_term" "$forgeflow_release_runbook" ||
    fail "release runbook is missing: $forgeflow_release_term"
done

grep -Fq '[release runbook](docs/releasing.md)' "$forgeflow_repo/README.md" ||
  fail 'README does not link to the release runbook'

for forgeflow_release_checker_term in \
  'RELEASE_CHECK_IMPLEMENTATION' \
  'unsupported implementation' \
  'NODE_UNAVAILABLE' \
  'release-check-compat.mjs'
do
  grep -Fq -- "$forgeflow_release_checker_term" \
    "$forgeflow_repo/scripts/release-check" ||
    fail "release checker is missing: $forgeflow_release_checker_term"
done

if grep -Eq '(^|[;&|[:space:]])(gh|curl|wget|git)([;&|[:space:]]|$)' \
  "$forgeflow_repo/scripts/release-check"; then
  fail 'release wrapper must not perform Git or network commands'
fi

check_story_headings \
  "$forgeflow_repo/templates/story/story.md" 'Story template'
check_acceptance_headings \
  "$forgeflow_repo/templates/story/acceptance.md" 'Acceptance template'

for forgeflow_state in \
  DRAFT \
  READY \
  IMPLEMENTING \
  VERIFYING \
  REVIEW \
  DONE \
  SPEC_BLOCKED
do
  grep -Fq "$forgeflow_state" "$forgeflow_repo/protocol/lifecycle.md" ||
    fail "lifecycle is missing state: $forgeflow_state"
done

for forgeflow_transition in \
  'DRAFT → READY' \
  'READY → IMPLEMENTING' \
  'IMPLEMENTING → VERIFYING' \
  'VERIFYING → IMPLEMENTING' \
  'VERIFYING → REVIEW' \
  'REVIEW → DONE' \
  'IMPLEMENTING → SPEC_BLOCKED' \
  'SPEC_BLOCKED → READY'
do
  grep -Fq "$forgeflow_transition" \
    "$forgeflow_repo/protocol/lifecycle.md" ||
    fail "lifecycle is missing transition: $forgeflow_transition"
done

grep -Fq 'run: make verify' \
  "$forgeflow_repo/templates/ci/github-actions.yml" ||
  fail "CI template does not invoke make verify"

forgeflow_workflow="$forgeflow_repo/.github/workflows/verify.yml"

for forgeflow_workflow_term in \
  'pull_request:' \
  'push:' \
  'contents: read' \
  'runs-on: ubuntu-latest' \
  'timeout-minutes:' \
  'node-version-file: .node-version' \
  'require-lockfile: true' \
  'pnpm --dir examples/typescript install --frozen-lockfile' \
  'go-version-file: examples/go/go.mod' \
  'go -C examples/go mod download' \
  'run: make verify'
do
  grep -Fq "$forgeflow_workflow_term" "$forgeflow_workflow" ||
    fail "repository workflow is missing: $forgeflow_workflow_term"
done

if grep -Fq 'working-directory: examples/typescript' "$forgeflow_workflow"; then
  fail 'repository workflow does not install the root tooling workspace'
fi

forgeflow_node_version_line_count=$(
  wc -l <"$forgeflow_repo/.node-version" | tr -d '[:space:]'
)

if [ "$forgeflow_node_version_line_count" -ne 1 ] ||
  ! grep -Eq '^[1-9][0-9]*$' "$forgeflow_repo/.node-version"; then
  fail '.node-version must contain one numeric Node major release'
fi

if grep -Fq 'continue-on-error' "$forgeflow_workflow"; then
  fail 'repository workflow must not ignore failures'
fi

forgeflow_action_count=$(grep -Ec '^[[:space:]]*uses:' "$forgeflow_workflow")
forgeflow_pinned_action_count=$(
  grep -Ec '^[[:space:]]*uses: [^@]+@[0-9a-f]{40}([[:space:]]|$)' \
    "$forgeflow_workflow"
)

if [ "$forgeflow_action_count" -eq 0 ] ||
  [ "$forgeflow_action_count" -ne "$forgeflow_pinned_action_count" ]; then
  fail 'repository workflow actions must use immutable commit SHAs'
fi

forgeflow_story_contract_acceptance="$forgeflow_repo/specs/stories/FF-208-security-fixture-matrix/acceptance.md"
forgeflow_story_contract_tests="$forgeflow_repo/tests/story-check.sh"
forgeflow_handoff_acceptance="$forgeflow_repo/specs/stories/P0-001-remove-mutable-lifecycle-state/acceptance.md"
forgeflow_handoff_tests="$forgeflow_repo/tests/handoff-check.sh"
forgeflow_review_integrity_acceptance="$forgeflow_repo/specs/stories/FF-216-review-integrity-and-state-consistency/acceptance.md"
forgeflow_review_integrity_tests="$forgeflow_repo/tests/review-integrity.sh"

check_acceptance_mapping \
  "$forgeflow_story_contract_acceptance" "$forgeflow_story_contract_tests" \
  001 002 003 004 005 006 007 008 009 010 011 012

check_prefixed_acceptance_mapping \
  "$forgeflow_handoff_acceptance" "$forgeflow_handoff_tests" P0001 \
  002 006 008

check_acceptance_mapping \
  "$forgeflow_review_integrity_acceptance" "$forgeflow_review_integrity_tests" \
  001 002 003 004 005 006 007 008 009 010 011 012

for forgeflow_contract_artifact in \
  scripts/story-check \
  scripts/handoff-check \
  tests/story-check.sh \
  tests/handoff-check.sh
do
  if [ ! -x "$forgeflow_repo/$forgeflow_contract_artifact" ]; then
    fail "contract check artifact is not executable: $forgeflow_contract_artifact"
  fi
done

grep -Eq '^verify:.*verify-story' "$forgeflow_makefile" ||
  fail 'root verify does not include the Story contract check'

grep -Eq '^verify:.*verify-handoff' "$forgeflow_makefile" ||
  fail 'root verify does not include the handoff contract check'

grep -Fqx 'verify-story:' "$forgeflow_makefile" ||
  fail 'root Makefile does not expose verify-story'

grep -Fqx 'verify-handoff:' "$forgeflow_makefile" ||
  fail 'root Makefile does not expose verify-handoff'

grep -Fq '[Handoff](protocol/handoff.md)' "$forgeflow_repo/README.md" ||
  fail 'README does not link to the Handoff Contract'

grep -Fq '[Contract checks](docs/contract-checks.md)' \
  "$forgeflow_repo/README.md" ||
  fail 'README does not link to the contract check documentation'

grep -Fq '[Handoff Evidence Contract](handoff.md)' \
  "$forgeflow_repo/protocol/lifecycle.md" ||
  fail 'lifecycle does not link to the Handoff Evidence Contract'

for forgeflow_story_contract_term in \
  '## Classification' \
  'Security sensitive' \
  'Baseline conformance' \
  '## Trust Boundary Fields' \
  '## Superseded Behavior' \
  '| Source field | Payload | Expected result | Persisted locations | Verification |'
do
  grep -Fq -- "$forgeflow_story_contract_term" \
    "$forgeflow_repo/templates/story/story.md" \
    "$forgeflow_repo/templates/story/acceptance.md" ||
    fail "Story templates are missing: $forgeflow_story_contract_term"
done

for forgeflow_story_document_term in \
  '## Security Fixture Matrix' \
  'preserve' \
  'redact' \
  'reject' \
  'omit' \
  'STORY_CONTRACT_OK' \
  'STORY_CONTRACT_INCOMPLETE'
do
  grep -Fq -- "$forgeflow_story_document_term" \
    "$forgeflow_repo/docs/contract-checks.md" ||
    fail "contract check documentation is missing: $forgeflow_story_document_term"
done

for forgeflow_handoff_document_term in \
  'handoff:' \
  'story:' \
  'recorded_at:' \
  'repository:' \
  'revision:' \
  'command:' \
  'result:'
do
  grep -Fq -- "$forgeflow_handoff_document_term" \
    "$forgeflow_repo/protocol/handoff.md" ||
    fail "Handoff Contract is missing: $forgeflow_handoff_document_term"

  grep -Fq -- "$forgeflow_handoff_document_term" \
    "$forgeflow_repo/templates/handoff.md" ||
    fail "handoff template is missing: $forgeflow_handoff_document_term"
done

for forgeflow_forbidden_handoff_term in \
  'current_story:' \
  'next_story:' \
  'completed_stories:' \
  'dirty_worktree:' \
  'story_owned_paths:' \
  'known_unrelated_paths:' \
  'last_command:'
do
  if grep -Fq -- "$forgeflow_forbidden_handoff_term" \
    "$forgeflow_repo/protocol/handoff.md" \
    "$forgeflow_repo/templates/handoff.md"; then
    fail "active handoff documents persist mutable state: $forgeflow_forbidden_handoff_term"
  fi
done

for forgeflow_handoff_result_term in \
  'HANDOFF_CONTRACT_OK' \
  'HANDOFF_CONTRACT_INCOMPLETE'
do
  grep -Fq -- "$forgeflow_handoff_result_term" \
    "$forgeflow_repo/protocol/handoff.md" ||
    fail "Handoff Contract is missing: $forgeflow_handoff_result_term"

  grep -Fq -- "$forgeflow_handoff_result_term" \
    "$forgeflow_repo/docs/contract-checks.md" ||
    fail "contract check documentation is missing: $forgeflow_handoff_result_term"
done

grep -Fq 'Story `## Classification` declaration is a **Breaking** change' \
  "$forgeflow_repo/protocol/versioning.md" ||
  fail 'versioning policy does not classify the Classification field'

grep -Fq '**Additive** capabilities' "$forgeflow_repo/protocol/versioning.md" ||
  fail 'versioning policy does not classify the contract checks as additive'

grep -Fqx 'MIT License' "$forgeflow_repo/LICENSE" ||
  fail 'LICENSE does not declare the MIT License'

grep -Fq '[MIT License](LICENSE)' "$forgeflow_repo/README.md" ||
  fail 'README does not link to the MIT License'

guidance_baseline_artifacts_are_selective_and_advisory() {
  for forgeflow_guidance_file in ENTRY.md PRINCIPLES.md DECISIONS.md PRACTICES.md
  do
    [ -s "$forgeflow_repo/guidance/$forgeflow_guidance_file" ] ||
      fail "guidance baseline is missing: $forgeflow_guidance_file"
  done
  for forgeflow_guidance_term in \
    'Load only' \
    'Human Review' \
    'Small coherent changes' \
    'Root cause' \
    'D-001 Example Decision' \
    'Repair loop'
  do
    grep -Fq "$forgeflow_guidance_term" "$forgeflow_repo/guidance/ENTRY.md" \
      "$forgeflow_repo/guidance/PRINCIPLES.md" \
      "$forgeflow_repo/guidance/DECISIONS.md" \
      "$forgeflow_repo/guidance/PRACTICES.md" ||
      fail "guidance baseline omits: $forgeflow_guidance_term"
  done
}

guidance_contract_and_agent_flow_are_documented() {
  for forgeflow_guidance_document in \
    protocol/story.md \
    templates/story/story.md \
    AGENTS.md \
    templates/AGENTS.md \
    skills/story-development/SKILL.md
  do
    grep -Fq 'Guidance' "$forgeflow_repo/$forgeflow_guidance_document" ||
      fail "$forgeflow_guidance_document omits Guidance"
  done
}

guidance_authority_and_version_boundaries_are_documented() {
  grep -Fq 'Intent != Guidance != Verification != Current State != Approval' \
    "$forgeflow_repo/docs/concepts.md" || fail 'concepts omits Guidance boundary'
  grep -Fq '**Additive** for `0.4.1`' "$forgeflow_repo/protocol/versioning.md" ||
    fail 'versioning omits FF-223 additive classification'
  grep -Fq 'agent runtime' "$forgeflow_repo/docs/concepts.md" ||
    fail 'concepts omits agent-runtime boundary'
}

forgeflow_story_id_grammar='hyphen-separated segments of uppercase letters and digits'

one_story_id_grammar_is_stated_where_a_story_is_named() {
  # AC-002: the two documents state the same grammar and neither names a
  # constraint the other omits.
  for forgeflow_grammar_document in protocol/story.md protocol/handoff.md
  do
    for forgeflow_grammar_term in \
      "$forgeflow_story_id_grammar" \
      'the first segment starts with an uppercase letter' \
      'each middle segment has an uppercase letter' \
      'the last segment is digits' \
      '`DBCLI-PLAT-001`' \
      '`FF-1-2`'
    do
      grep -Fq -- "$forgeflow_grammar_term" \
        "$forgeflow_repo/$forgeflow_grammar_document" ||
        fail "$forgeflow_grammar_document omits the Story ID grammar: $forgeflow_grammar_term"
    done
  done

  if grep -Fq 'uppercase letters or digits, a hyphen, and digits' \
    "$forgeflow_repo/protocol/handoff.md"; then
    fail 'protocol/handoff.md still states the superseded narrower grammar'
  fi

  grep -Fq 'both checkers' "$forgeflow_repo/docs/contract-checks.md" ||
    fail 'docs/contract-checks.md does not say the two checkers share the grammar'
}

the_story_id_grammar_is_breaking_for_0_6_0() {
  grep -Fq 'FF-227 one Story ID grammar is **Breaking** for `0.6.0`' \
    "$forgeflow_repo/protocol/versioning.md" ||
    fail 'versioning omits the FF-227 Breaking classification'

  for forgeflow_migration_term in \
    './scripts/story-check' \
    'Rename that Story' \
    '../../protocol/versioning.md'
  do
    grep -Fq -- "$forgeflow_migration_term" \
      "$forgeflow_repo/docs/releases/0.6.0.md" ||
      fail "docs/releases/0.6.0.md omits migration guidance: $forgeflow_migration_term"
  done

  grep -Fq 'when upgrading to 0.6.0' "$forgeflow_repo/docs/upgrading.md" ||
    fail 'docs/upgrading.md omits the 0.6.0 migration step'
}

configurable_decision_root_is_additive_for_0_7_0() {
  grep -Fq 'FF-228 configurable decision root is **Additive** for `0.7.0`' \
    "$forgeflow_repo/protocol/versioning.md" ||
    fail 'versioning omits the FF-228 Additive classification'

  for forgeflow_configuration_document in \
    protocol/architecture.md \
    templates/story/story.md \
    docs/contract-checks.md \
    docs/upgrading.md
  do
    grep -Fq 'PRAXISBOUND_DECISIONS_ROOT' \
      "$forgeflow_repo/$forgeflow_configuration_document" ||
      fail "$forgeflow_configuration_document omits the decision-root override"
  done

  grep -Fq 'FORGEFLOW_DECISIONS_ROOT' \
    "$forgeflow_repo/docs/releases/0.7.0.md" ||
    fail 'the immutable 0.7.0 release record lost its decision-root identity'

  grep -Fq 'same-line backticked signal' \
    "$forgeflow_repo/templates/story/story.md" ||
    fail 'Story template omits the risk-reason shape'
}

mutable_lifecycle_state_is_removed_for_0_8_0() {
  grep -Fqx '0.10.0' "$forgeflow_repo/VERSION" ||
    fail 'VERSION is not 0.10.0'

  for forgeflow_authority_document in \
    protocol/handoff.md \
    protocol/lifecycle.md \
    protocol/story.md \
    README.md \
    templates/AGENTS.md \
    skills/praxisbound/SKILL.md \
    skills/story-development/SKILL.md
  do
    grep -Fq 'control plane' "$forgeflow_repo/$forgeflow_authority_document" ||
      fail "$forgeflow_authority_document omits the control-plane authority seam"
  done

  for forgeflow_migration_document in \
    protocol/versioning.md \
    docs/upgrading.md \
    docs/releases/0.8.0.md
  do
    grep -Fq '0.8.0' "$forgeflow_repo/$forgeflow_migration_document" ||
      fail "$forgeflow_migration_document omits the 0.8.0 migration"
  done

  grep -Fq 'P0-001 is **Breaking** for `0.8.0`' \
    "$forgeflow_repo/protocol/versioning.md" ||
    fail 'versioning omits the P0-001 Breaking classification'
  grep -Fq 'does not store what state the work is currently in' \
    "$forgeflow_repo/README.md" ||
    fail 'README omits the final authority principle'
  grep -Fq 'not persisted PraxisBound repository state' \
    "$forgeflow_repo/protocol/lifecycle.md" ||
    fail 'lifecycle does not disclaim repository state persistence'
  for forgeflow_story_note_rule in \
    'not authoritative lifecycle state' \
    'select work or infer a transition'
  do
    grep -Fq "$forgeflow_story_note_rule" \
      "$forgeflow_repo/protocol/story.md" ||
      fail 'Story Contract does not protect optional task notes'
  done

  if grep -Fq 'ForgePilot' \
    "$forgeflow_repo/scripts/story-check" \
    "$forgeflow_repo/scripts/handoff-check" \
    "$forgeflow_repo/scripts/doctor" \
    "$forgeflow_repo/scripts/bootstrap" \
    "$forgeflow_repo/Makefile"; then
    fail 'ForgeFlow executable gates must not depend on ForgePilot'
  fi
}

risk_driven_readiness_is_additive_for_0_8_0() {
  for forgeflow_risk_document in \
    protocol/story.md \
    protocol/execution.md \
    templates/story/story.md \
    docs/contract-checks.md \
    docs/execution-governance.md \
    docs/releases/0.8.0.md \
    README.md
  do
    for forgeflow_risk_signal in \
      error-projection concurrency bounded-capacity retention-overflow
    do
      grep -Fq "$forgeflow_risk_signal" \
        "$forgeflow_repo/$forgeflow_risk_document" ||
        fail "$forgeflow_risk_document omits $forgeflow_risk_signal"
    done
  done

  for forgeflow_risk_section in \
    '## Error Projection' '## Concurrency' '## Capacity' \
    '## Retention and Overflow'
  do
    if grep -Fqx "$forgeflow_risk_section" \
      "$forgeflow_repo/templates/story/story.md"; then
      fail "Story template activates an unused risk section: $forgeflow_risk_section"
    fi
  done

  grep -Fq 'P0-002 risk-driven Story readiness is **Additive** for `0.8.0`' \
    "$forgeflow_repo/protocol/versioning.md" ||
    fail 'versioning omits the P0-002 Additive classification'
  grep -Fq 'No migration is required' \
    "$forgeflow_repo/protocol/versioning.md" ||
    fail 'versioning omits P0-002 compatibility guidance'
  grep -Fq 'no separate' \
    "$forgeflow_repo/protocol/story.md" ||
    fail 'Story protocol creates or implies a second risk evidence map'
  grep -Fq 'does not infer Signals from prose' \
    "$forgeflow_repo/docs/contract-checks.md" ||
    fail 'contract-check docs omit the risk-inference boundary'
}

structural_contract_is_capability_based_for_0_9_0() {
  grep -Fq 'P1-003 is **Breaking** for `0.9.0`' \
    "$forgeflow_repo/protocol/versioning.md" ||
    fail 'versioning omits the P1-003 Breaking classification'
  grep -Fqx '0.10.0' "$forgeflow_repo/VERSION" ||
    fail 'VERSION is not 0.10.0'

  for forgeflow_contract_term in \
    'AGENTS.md' 'Makefile' 'specs/stories/' 'story.md' 'acceptance.md' \
    '`task.md` is optional' 'internal installation' 'not a repository conformance contract'
  do
    grep -Fq "$forgeflow_contract_term" \
      "$forgeflow_repo/protocol/repository-contract.md" ||
      fail "Repository Contract omits structural contract term: $forgeflow_contract_term"
  done

  for forgeflow_document in \
    README.md \
    docs/doctor.md \
    docs/getting-started.md \
    docs/upgrading.md \
    docs/releases/0.9.0.md
  do
    grep -Fq 'optional' "$forgeflow_repo/$forgeflow_document" ||
      fail "$forgeflow_document does not distinguish optional capabilities"
  done

  grep -Fq 'guidance/ENTRY.md' "$forgeflow_repo/scripts/doctor" ||
    fail 'Doctor does not validate the Guidance entrypoint'
  grep -Fq 'manifest belongs solely to installation' \
    "$forgeflow_repo/scripts/bootstrap" ||
    fail 'Bootstrap does not distinguish its manifest from conformance'

  for forgeflow_guidance_migration_term in \
    'OPTIONAL_LEGACY' \
    'GUIDANCE_BASELINE_OK' \
    'GUIDANCE_INCOMPLETE' \
    'missing or blank `guidance/ENTRY.md`' \
    'than `ENTRY.md` becomes `GUIDANCE_CONTRACT_OK`' \
    'non-entry starter document becomes `GUIDANCE_CONTRACT_OK`'
  do
    grep -Fq "$forgeflow_guidance_migration_term" \
      "$forgeflow_repo/protocol/versioning.md" ||
      fail "versioning omits P1-003 Guidance migration term: $forgeflow_guidance_migration_term"
  done
}

run_case 'FF223-AC-001' guidance_baseline_artifacts_are_selective_and_advisory
run_case 'FF223-AC-005' guidance_contract_and_agent_flow_are_documented
run_case 'FF223-AC-008' guidance_authority_and_version_boundaries_are_documented
run_case 'FF227-AC-002' one_story_id_grammar_is_stated_where_a_story_is_named
run_case 'FF227-AC-006' the_story_id_grammar_is_breaking_for_0_6_0
run_case 'FF228-AC-005' configurable_decision_root_is_additive_for_0_7_0
run_case 'P0001-AC-001' mutable_lifecycle_state_is_removed_for_0_8_0
run_case 'P0001-AC-003' mutable_lifecycle_state_is_removed_for_0_8_0
run_case 'P0001-AC-004' mutable_lifecycle_state_is_removed_for_0_8_0
run_case 'P0001-AC-005' mutable_lifecycle_state_is_removed_for_0_8_0
run_case 'P0001-AC-007' mutable_lifecycle_state_is_removed_for_0_8_0
run_case 'P0002-AC-009' risk_driven_readiness_is_additive_for_0_8_0
run_case 'P1003-AC-008' structural_contract_is_capability_based_for_0_9_0

printf 'protocol tests passed\n'
