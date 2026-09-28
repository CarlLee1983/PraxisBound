#!/bin/sh

set -eu

forgeflow_repo=$(
  cd -P "$(dirname "$0")/.." >/dev/null 2>&1
  pwd
)

fail() {
  printf 'code quality test failed: %s\n' "$1" >&2
  exit 1
}

contains() {
  grep -Fq -- "$2" "$forgeflow_repo/$1" ||
    fail "$1 is missing: $2"
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

guidance_defines_the_enforcement_boundary() {
  [ -s "$forgeflow_repo/docs/code-quality.md" ] || return 1

  contains docs/getting-started.md '[Code Quality](code-quality.md)'
  contains docs/getting-started.md 'status check or ruleset'
  contains docs/concepts.md '[Code Quality](code-quality.md)'

  for forgeflow_term in \
    'repository-owned concern' \
    'does not prescribe one cross-language style' \
    'deterministic' \
    'non-interactive' \
    'suitable for CI' \
    'nonzero on failure' \
    'Formatting' \
    'Static quality' \
    'Architecture' \
    'Design judgment' \
    'Human Review' \
    'reproducible machine rule' \
    'arbitrary numeric limits'
  do
    contains docs/code-quality.md "$forgeflow_term"
  done
}

verification_keeps_one_tool_agnostic_gate() {
  for forgeflow_term in \
    'Repository-adopted formatters' \
    'architecture checkers should be placed behind this same command' \
    'constrains the verification interface and its PASS/FAIL semantics' \
    'does not require a language' \
    'additional Make target' \
    'deterministic authority for its point-in-time PASS or FAIL result'
  do
    contains protocol/verification.md "$forgeflow_term"
  done

  ! grep -Fq 'make verify-style' "$forgeflow_repo/protocol/verification.md"
}

agent_template_preserves_quality_rules() {
  for forgeflow_term in \
    'existing formatter, lint, type, and architecture' \
    'disable, bypass, or weaken existing rules' \
    'consistent with neighboring code and the existing architecture' \
    '`make verify` as the canonical full-repository gate' \
    'Focused commands' \
    'cannot be automated to Human Review'
  do
    contains templates/AGENTS.md "$forgeflow_term"
  done
}

typescript_gate_rejects_warnings_and_keeps_checks() {
  contains examples/typescript/package.json \
    '"lint": "eslint . --max-warnings=0"'

  printf 'const unused = 1;\n' | pnpm --dir examples/typescript exec eslint \
    --stdin --stdin-filename warning.ts \
    --rule '@typescript-eslint/no-unused-vars: warn' >/dev/null 2>&1 || return 1

  if printf 'const unused = 1;\n' | pnpm --dir examples/typescript exec eslint \
    --stdin --stdin-filename warning.ts \
    --rule '@typescript-eslint/no-unused-vars: warn' \
    --max-warnings=0 >/dev/null 2>&1; then
    return 1
  fi

  for forgeflow_term in \
    'pnpm run format:check' \
    'pnpm run lint' \
    'pnpm run typecheck' \
    '$(MAKE) traceability' \
    'pnpm test'
  do
    contains examples/typescript/Makefile "$forgeflow_term"
  done
}

go_gate_keeps_quality_and_traceability_checks() {
  contains examples/go/Makefile \
    'verify: format-check vet staticcheck traceability test'
  contains examples/go/Makefile 'go vet ./...'
  contains examples/go/Makefile 'go tool staticcheck ./...'
  contains examples/go/Makefile './scripts/check-traceability.sh'
  contains examples/go/Makefile './tests/traceability.sh'
  contains examples/go/Makefile 'go test ./...'
}

readme_explains_enforcement_and_github_boundary() {
  for forgeflow_term in \
    '[Code Quality](docs/code-quality.md)' \
    'PraxisBound can enforce Code Style' \
    'adopting repository owns' \
    'canonical command' \
    'merge policy' \
    'status check'
  do
    contains README.md "$forgeflow_term"
  done
}

versioning_records_an_additive_patch() {
  contains protocol/versioning.md \
    'Code Quality Guidance is **Additive** for `0.3.3`'
  contains protocol/versioning.md \
    'It adds no required adoption file, Make target, tool, or'
  contains protocol/versioning.md \
    'changes no `make verify` PASS, FAIL, or Repair Loop semantics'
}

guidance_forbids_manufactured_passes() {
  for forgeflow_term in \
    'disabling rules' \
    'lowering their severity' \
    'ignoring files' \
    'bypassing checks' \
    'deleting tests' \
    'blocking gate' \
    'not a substitute for Clean Code'
  do
    contains docs/code-quality.md "$forgeflow_term"
  done
}

root_verify_keeps_existing_gates() {
  contains Makefile \
    'verify: verify-protocol verify-bootstrap verify-doctor verify-story verify-handoff verify-release verify-typescript verify-go verify-actions'
  contains Makefile 'sh -n tests/protocol.sh tests/code-quality.sh'
  contains Makefile './tests/code-quality.sh'
  ! grep -Eq '^verify-style:' "$forgeflow_repo/Makefile"
}

run_case 'AC-001' guidance_defines_the_enforcement_boundary
run_case 'AC-002' verification_keeps_one_tool_agnostic_gate
run_case 'AC-003' agent_template_preserves_quality_rules
run_case 'AC-004' typescript_gate_rejects_warnings_and_keeps_checks
run_case 'AC-005' go_gate_keeps_quality_and_traceability_checks
run_case 'AC-006' readme_explains_enforcement_and_github_boundary
run_case 'AC-007' versioning_records_an_additive_patch
run_case 'AC-008' guidance_forbids_manufactured_passes
run_case 'AC-009' root_verify_keeps_existing_gates

printf 'code quality tests passed\n'
