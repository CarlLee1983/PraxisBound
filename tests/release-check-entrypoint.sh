#!/bin/sh

set -eu

fail() {
  printf 'release-check-entrypoint test failed: %s\n' "$1" >&2
  exit 1
}

test_root=$(CDPATH='' cd -P "$(dirname "$0")/.." && pwd)
test_dir=$(mktemp -d "${TMPDIR:-/tmp}/praxisbound-release-entrypoint.XXXXXX")
trap 'rm -rf "$test_dir"' EXIT
trap 'exit 1' HUP INT TERM

GIT_CONFIG_GLOBAL=/dev/null
GIT_CONFIG_NOSYSTEM=1
export GIT_CONFIG_GLOBAL GIT_CONFIG_NOSYSTEM

real_node=$(command -v node) || fail 'Node is required to run this test'
node_log="$test_dir/node.log"
child_log="$test_dir/child.log"
fallback_log="$test_dir/fallback.log"
mkdir "$test_dir/wrappers" "$test_dir/no-node"
cat >"$test_dir/wrappers/node" <<'EOF'
#!/bin/sh
printf 'node\n' >> "$RELEASE_TEST_NODE_LOG"
exec "$RELEASE_TEST_REAL_NODE" "$@"
EOF
chmod +x "$test_dir/wrappers/node"

new_candidate() {
  candidate="$test_dir/$1"
  mkdir -p "$candidate/scripts" "$candidate/docs/typescript-tooling" \
    "$candidate/packages/cli" "$candidate/packages/core"
  cp "$test_root/scripts/release-check" "$candidate/scripts/"
  cp "$test_root/scripts/release-check-compat.mjs" "$candidate/scripts/"
  cp "$test_root/docs/typescript-tooling/result-envelope-v1.schema.json" \
    "$candidate/docs/typescript-tooling/"
  ln -s "$test_root/packages/core/dist" "$candidate/packages/core/dist"
  printf '0.2.1\n' >"$candidate/VERSION"
  printf 'candidate\n' >"$candidate/tracked.txt"
  cat >"$candidate/Makefile" <<'EOF'
.PHONY: verify
verify:
	@printf 'verify\n' >> "$$RELEASE_TEST_VERIFY_LOG"
	@test "$$RELEASE_TEST_VERIFY_RESULT" = pass || { printf 'verify failed after output\n'; exit 1; }
EOF
  awk '
    /^release-check: verify$/ {
      print
      if (getline <= 0) exit 1
      print
      found=1
    }
    END { if (!found) exit 1 }
  ' "$test_root/Makefile" >>"$candidate/Makefile" ||
    fail 'root Make release-check recipe cannot be copied into the fixture'
  git -C "$candidate" init -q
  git -C "$candidate" add .
  git -C "$candidate" -c user.name='PraxisBound Tests' \
    -c user.email='tests@example.invalid' -c commit.gpgSign=false \
    commit -qm baseline
}

real_candidate() {
  new_candidate "$1"
  ln -s "$test_root/packages/cli/dist" "$candidate/packages/cli/dist"
  git -C "$candidate" add packages/cli/dist
  git -C "$candidate" -c user.name='PraxisBound Tests' \
    -c user.email='tests@example.invalid' -c commit.gpgSign=false \
    commit -qm 'CLI link'
}

fake_candidate() {
  new_candidate fake
  mkdir "$candidate/packages/cli/dist"
  cat >"$candidate/packages/cli/dist/bin.js" <<'EOF'
const fs = require('node:fs');
fs.appendFileSync(process.env.RELEASE_TEST_CHILD_LOG, `${process.argv.slice(2).join('|')}\n`);
process.stdout.write(fs.readFileSync(process.env.RELEASE_TEST_PAYLOAD));
process.stderr.write(process.env.RELEASE_TEST_CHILD_STDERR ?? '');
process.exit(Number(process.env.RELEASE_TEST_CHILD_EXIT));
EOF
  cat >"$candidate/scripts/retired-checker" <<'EOF'
#!/bin/sh
printf 'fallback\n' >> "$RELEASE_TEST_FALLBACK_LOG"
exit 0
EOF
  chmod +x "$candidate/scripts/retired-checker"
  git -C "$candidate" add packages/cli/dist/bin.js scripts/retired-checker
  git -C "$candidate" -c user.name='PraxisBound Tests' \
    -c user.email='tests@example.invalid' -c commit.gpgSign=false \
    commit -qm 'synthetic child and retired fallback'
}

run_make() {
  : >"$test_dir/stdout"
  : >"$test_dir/stderr"
  : >"$node_log"
  : >"$child_log"
  : >"$fallback_log"
  : >"$test_dir/verify.log"
  status=0
  RELEASE_TEST_REAL_NODE="$real_node" RELEASE_TEST_NODE_LOG="$node_log" \
    RELEASE_TEST_CHILD_LOG="$child_log" RELEASE_TEST_FALLBACK_LOG="$fallback_log" \
    RELEASE_TEST_VERIFY_LOG="$test_dir/verify.log" \
    RELEASE_TEST_VERIFY_RESULT="${RELEASE_TEST_VERIFY_RESULT:-pass}" \
    PATH="$test_dir/wrappers:$PATH" make -s -C "$candidate" release-check "$@" \
    >"$test_dir/stdout" 2>"$test_dir/stderr" || status=$?
}

run_direct() {
  : >"$test_dir/stdout"
  : >"$test_dir/stderr"
  : >"$node_log"
  : >"$child_log"
  : >"$fallback_log"
  status=0
  RELEASE_TEST_REAL_NODE="$real_node" RELEASE_TEST_NODE_LOG="$node_log" \
    RELEASE_TEST_CHILD_LOG="$child_log" RELEASE_TEST_FALLBACK_LOG="$fallback_log" \
    PATH="$test_dir/wrappers:$PATH" "$candidate/scripts/release-check" "$@" >"$test_dir/stdout" \
    2>"$test_dir/stderr" || status=$?
}

expect_count() {
  [ "$(wc -l <"$2" | tr -d ' ')" -eq "$1" ] || fail "$3"
}

expect_clean() {
  [ -z "$(git -C "$candidate" status --porcelain=v1 --untracked-files=all)" ] ||
    fail 'release check changed its disposable candidate'
}

write_result() {
  node -e 'const fs=require("node:fs"); const schema=require(process.argv[1]); const result={schemaVersion:schema.properties.schemaVersion.const,protocolVersion:schema.properties.protocolVersion.const,status:"pass",outcome:"RELEASE_READY",exit:0,subject:"release",issues:[],data:{version:"0.2.1",commit:"a".repeat(40),expectedTag:"v0.2.1",localTag:"absent",remoteChecks:"not-performed"}}; Object.assign(result, JSON.parse(process.argv[3])); if (JSON.parse(process.argv[3]).data) result.data={...result.data,...JSON.parse(process.argv[3]).data}; fs.writeFileSync(process.argv[2], JSON.stringify(result)+"\n")' \
    "$test_root/docs/typescript-tooling/result-envelope-v1.schema.json" \
    "$test_dir/payload" "$1"
}

expect_adapter_refusal() {
  label=$1
  expected_code=$2
  : >"$child_log"
  run_make
  [ "$status" -ne 0 ] || fail "$label unexpectedly passed"
  expect_count 1 "$test_dir/verify.log" "$label bypassed verify"
  expect_count 1 "$node_log" "$label did not invoke Node once"
  expect_count 1 "$child_log" "$label did not invoke the child once"
  grep -Fq 'release|check|--json|' "$child_log" ||
    fail "$label changed the local release-check child invocation"
  expect_count 0 "$fallback_log" "$label invoked fallback"
  [ ! -s "$test_dir/stdout" ] || fail "$label emitted success"
  grep -Fqx "release check failed: $expected_code" "$test_dir/stderr" ||
    fail "$label did not emit $expected_code"
  if grep -Fq 'hostile Git diagnostic' "$test_dir/stderr"; then
    fail "$label exposed child stderr"
  fi
  expect_clean
}

case_make_and_direct_use_adapter_once() {
  real_candidate ready
  head=$(git -C "$candidate" rev-parse HEAD)
  run_make
  [ "$status" -eq 0 ] || fail 'make release-check rejected a clean candidate'
  expect_count 1 "$test_dir/verify.log" 'make did not run canonical verify exactly once'
  expect_count 1 "$node_log" 'make did not invoke the adapter exactly once'
  cat >"$test_dir/expected" <<EOF
release check passed
version=0.2.1
commit=$head
expected_tag=v0.2.1
local_tag=absent
remote_checks=not-performed
EOF
  cmp -s "$test_dir/expected" "$test_dir/stdout" ||
    fail 'make changed the six-line success contract'
  [ ! -s "$test_dir/stderr" ] || fail 'make success wrote stderr'
  expect_clean
  run_direct
  [ "$status" -eq 0 ] || fail 'direct wrapper rejected a clean candidate'
  expect_count 1 "$node_log" 'direct wrapper did not invoke the adapter once'
  cmp -s "$test_dir/expected" "$test_dir/stdout" ||
    fail 'direct wrapper changed the six-line success contract'
  expect_clean
}

case_retires_selectors_and_arguments() {
  fake_candidate
  for selector in legacy unknown
  do
    RELEASE_CHECK_IMPLEMENTATION="$selector" run_make
    [ "$status" -eq 2 ] || fail "$selector selector did not fail with usage status"
    expect_count 1 "$test_dir/verify.log" "$selector selector bypassed verify"
    expect_count 0 "$node_log" "$selector selector invoked Node"
    expect_count 0 "$child_log" "$selector selector invoked child"
    expect_count 0 "$fallback_log" "$selector selector invoked planted fallback"
    [ ! -s "$test_dir/stdout" ] || fail "$selector selector emitted success"
    grep -Fqx 'release check failed: unsupported implementation' "$test_dir/stderr" ||
      fail "$selector selector did not emit a sanitized refusal"
    expect_clean
  done
  run_direct unexpected
  [ "$status" -eq 2 ] || fail 'wrapper arguments did not fail with usage status'
  expect_count 0 "$node_log" 'wrapper arguments invoked Node'
  expect_count 0 "$fallback_log" 'wrapper arguments invoked fallback'
  grep -Fqx 'release check failed: release-check takes no arguments' "$test_dir/stderr" ||
    fail 'wrapper arguments did not emit a sanitized refusal'
}

case_missing_node_fails_closed() {
  candidate="$test_dir/fake"
  : >"$node_log"
  : >"$child_log"
  : >"$fallback_log"
  status=0
  PATH="$test_dir/no-node" "$candidate/scripts/release-check" \
    >"$test_dir/stdout" 2>"$test_dir/stderr" || status=$?
  [ "$status" -ne 0 ] || fail 'missing Node passed'
  expect_count 0 "$child_log" 'missing Node invoked child'
  expect_count 0 "$fallback_log" 'missing Node invoked fallback'
  [ ! -s "$test_dir/stdout" ] || fail 'missing Node emitted success'
  grep -Fqx 'release check failed: NODE_UNAVAILABLE' "$test_dir/stderr" ||
    fail 'missing Node failure was not sanitized'
  expect_clean
}

case_adapter_failures_remain_sanitized() {
  candidate="$test_dir/fake"
  RELEASE_TEST_PAYLOAD="$test_dir/payload"
  RELEASE_TEST_CHILD_STDERR='fatal: hostile Git diagnostic'
  RELEASE_TEST_CHILD_EXIT=0
  export RELEASE_TEST_PAYLOAD RELEASE_TEST_CHILD_STDERR RELEASE_TEST_CHILD_EXIT
  for payload in 'not-json\n' '{}\n{}\n'
  do
    printf '%b' "$payload" >"$test_dir/payload"
    expect_adapter_refusal 'malformed child result' INVALID_JSON_STREAM
  done
  write_result '{"schemaVersion":"9.0.0"}'
  expect_adapter_refusal 'unsupported schema' UNSUPPORTED_RESULT_VERSION
  write_result '{"protocolVersion":"9.0.0"}'
  expect_adapter_refusal 'unsupported Protocol' UNSUPPORTED_RESULT_VERSION
  write_result '{}'
  RELEASE_TEST_CHILD_EXIT=17
  export RELEASE_TEST_CHILD_EXIT
  expect_adapter_refusal 'unsupported child exit' PROCESS_EXIT_MISMATCH
  RELEASE_TEST_CHILD_EXIT=0
  export RELEASE_TEST_CHILD_EXIT
  write_result '{"status":"fail","outcome":"RELEASE_INCOMPLETE","exit":0,"issues":[{"code":"RELEASE_DIRTY","message":"dirty"}]}'
  expect_adapter_refusal 'invalid typed result combination' INVALID_ENVELOPE
  write_result '{"data":{"version":"0.2.1\\nforged"}}'
  expect_adapter_refusal 'hostile release data' INVALID_RELEASE_DATA
}

case_non_root_target_is_typed() {
  candidate="$test_dir/ready"
  status=0
  node "$test_root/packages/cli/dist/bin.js" release check --json "$candidate/.git" \
    >"$test_dir/stdout" 2>"$test_dir/stderr" || status=$?
  [ "$status" -eq 2 ] || fail 'non-root CLI target exit changed'
  [ ! -s "$test_dir/stderr" ] || fail 'non-root CLI target leaked presentation text'
  node -e 'const fs=require("node:fs"); const result=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(result.outcome!=="ERROR" || result.exit!==2 || result.issues[0]?.code!=="RELEASE_TARGET_NOT_ROOT") process.exit(1)' \
    "$test_dir/stdout" || fail 'non-root CLI target lacked typed issue'
}

case_migration_and_full_revision_rollback() {
  rollback_revision=fcc5595d5c95a42a82e67bb6f82be7886fdfaa64
  rollback_dir="$test_dir/rollback"
  mkdir "$rollback_dir"
  git -C "$test_root" archive "$rollback_revision" | tar -x -C "$rollback_dir"
  [ -x "$rollback_dir/scripts/release-check" ] ||
    fail 'rollback revision lacks the shell checker'
  [ -x "$rollback_dir/scripts/release-check-select" ] ||
    fail 'rollback revision lacks the selector'
  [ -x "$rollback_dir/tests/release-check.sh" ] ||
    fail 'rollback revision lacks the legacy suite'
  [ -x "$rollback_dir/tests/release-check-switch.sh" ] ||
    fail 'rollback revision lacks the switch suite'
  grep -Fq './scripts/release-check-select' "$rollback_dir/Makefile" ||
    fail 'rollback revision does not restore selector wiring'
  grep -Fq 'legacy)' "$rollback_dir/scripts/release-check-select" ||
    fail 'rollback revision does not restore legacy selection'
  grep -Fq 'supported Node.js runtime' "$test_root/docs/releasing.md" ||
    fail 'migration guidance omits the Node requirement'
  grep -Fq 'removing `RELEASE_CHECK_IMPLEMENTATION`' "$test_root/docs/releasing.md" ||
    fail 'migration guidance omits selector removal'
  grep -Fq "$rollback_revision" "$test_root/docs/releasing.md" ||
    fail 'rollback guidance omits the complete revision'
  grep -Fq 'Rollback changes no repository data, package, tag, GitHub' \
    "$test_root/docs/releasing.md" ||
    fail 'rollback guidance omits external-state exclusions'
  [ "$(cat "$test_root/VERSION")" = 0.10.0 ] ||
    fail 'maintainer-tooling removal changed Protocol VERSION'
}

case_verify_short_circuits_wrapper() {
  candidate="$test_dir/fake"
  RELEASE_TEST_VERIFY_RESULT=fail
  export RELEASE_TEST_VERIFY_RESULT
  run_make
  [ "$status" -ne 0 ] || fail 'failed verify permitted release check'
  expect_count 1 "$test_dir/verify.log" 'failed verify was not invoked once'
  expect_count 0 "$node_log" 'failed verify invoked Node'
  expect_count 0 "$child_log" 'failed verify invoked child'
  expect_count 0 "$fallback_log" 'failed verify invoked fallback'
  grep -Fqx 'verify failed after output' "$test_dir/stdout" ||
    fail 'failed verify output changed'
  RELEASE_TEST_VERIFY_RESULT=pass
  export RELEASE_TEST_VERIFY_RESULT
}

run_case() {
  case_id=$1
  case_function=$2
  "$case_function" || fail "$case_id"
  printf '%s passed\n' "$case_id"
}

run_case 'TST018-AC-002' case_make_and_direct_use_adapter_once
run_case 'TST018-AC-003' case_retires_selectors_and_arguments
run_case 'TST018-AC-003' case_missing_node_fails_closed
run_case 'TST018-AC-003' case_adapter_failures_remain_sanitized
run_case 'TST018-AC-003' case_non_root_target_is_typed
run_case 'TST018-AC-004' case_migration_and_full_revision_rollback
run_case 'TST018-AC-002' case_verify_short_circuits_wrapper
