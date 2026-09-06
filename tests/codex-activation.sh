#!/bin/sh

set -eu

repo=$(CDPATH='' cd -P "$(dirname "$0")/.." && pwd)
test_dir=$(mktemp -d "${TMPDIR:-/tmp}/forgeflow-activation-test.XXXXXX")
test_dir=$(CDPATH='' cd -P "$test_dir" && pwd)
trap 'rm -rf "$test_dir"' 0
trap 'exit 1' HUP INT TERM
case_id=setup
fail() { printf 'activation test failed [%s]: %s\n' "$case_id" "$*" >&2; exit 1; }
run_case() { case_id=$1; "$2"; printf 'PASS %s %s\n' "$1" "$2"; }

source_dir="$test_dir/source"
mkdir -p "$source_dir/scripts" "$source_dir/skills"
cp "$repo/scripts/codex-activate" "$repo/scripts/bootstrap" "$source_dir/scripts/"
cp -R "$repo/templates" "$source_dir/templates"
cp -R "$repo/skills/forgeflow" "$repo/skills/story-development" "$source_dir/skills/"
printf '0.4.1\n' >"$source_dir/VERSION"
activate="$source_dir/scripts/codex-activate"
target="$test_dir/target"

new_target() {
  target="$test_dir/$1"
  mkdir -p "$target"
  "$source_dir/scripts/bootstrap" "$target" >/dev/null
  printf 'custom policy\r\nno final newline' >"$target/AGENTS.md"
  printf 'verify:\n\ttouch execution-canary\n' >"$target/Makefile"
}
run() {
  expected=$1; shift
  actual=0
  "$@" >"$test_dir/output" 2>&1 || actual=$?
  if [ "$expected" -ne "$actual" ]; then
    cat "$test_dir/output" >&2
    fail "expected $expected, got $actual: $*"
  fi
}
contains() { grep -Fq -- "$1" "$test_dir/output" || fail "missing diagnostic: $1"; }
manifest() {
  (
    cd "${1:-$target}"
    find . -type d -print | sed 's/^/directory /'
    find . -type f -exec cksum {} \;
    find . -type l -print -exec readlink {} \;
    find . -type p -print | sed 's/^/fifo /'
  ) | LC_ALL=C sort
}
unchanged() {
  manifest >"$test_dir/after"
  cmp -s "$test_dir/before" "$test_dir/after" || fail 'target tree changed'
}
refuse() {
  refusal_outside=${1-}
  manifest >"$test_dir/before"
  if [ -n "$refusal_outside" ]; then manifest "$refusal_outside" >"$test_dir/outside-before"; fi
  for refusal_mode in preview apply; do
    if [ "$refusal_mode" = preview ]; then run 1 "$activate" "$target"
    else run 1 "$activate" --apply "$target"; fi
    unchanged
    if [ -n "$refusal_outside" ]; then
      manifest "$refusal_outside" >"$test_dir/outside-after"
      cmp -s "$test_dir/outside-before" "$test_dir/outside-after" || fail 'outside tree changed'
    fi
  done
}

preview_and_install() {
  new_target 'preview with spaces'
  cp "$target/AGENTS.md" "$test_dir/original-agents"
  chmod 600 "$target/AGENTS.md"
  cp "$target/specs/.forgeflow-adoption" "$test_dir/original-marker"
  manifest >"$test_dir/before"
  run 0 "$activate" "$target"
  contains 'Preview only'
  contains "$target/AGENTS.md"
  contains "$target/.agents/skills/forgeflow/.forgeflow-snapshot"
  contains '+<!-- ForgeFlow Codex: begin -->'
  unchanged
  run 0 "$activate" --apply "$target"
  contains 'Installed ForgeFlow 0.4.1'
  case "$(ls -l "$target/AGENTS.md" | awk '{print $1}')" in
    -rw-------*) ;; # macOS may append an extended-attribute indicator.
    *) fail 'changed AGENTS permissions' ;;
  esac
  [ ! -e "$target/execution-canary" ] || fail 'executed adopter code'
  cmp -s "$test_dir/original-marker" "$target/specs/.forgeflow-adoption" || fail 'changed adoption marker'
  tail -c "$(wc -c <"$test_dir/original-agents" | tr -d ' ')" "$target/AGENTS.md" \
    >"$test_dir/suffix"
  cmp -s "$test_dir/original-agents" "$test_dir/suffix" || fail 'changed original AGENTS bytes'
  cmp -s "$source_dir/skills/story-development/SKILL.md" \
    "$target/.agents/skills/forgeflow/story-development.md" || fail 'workflow differs from source'
  grep -Fq '(story-development.md)' "$target/.agents/skills/forgeflow/SKILL.md" || fail 'reference not local'
}

snapshot_updates() {
  new_target update
  chmod 400 "$target/AGENTS.md"
  run 0 "$activate" --apply "$target"
  case "$(ls -l "$target/AGENTS.md" | awk '{print $1}')" in
    -r--------*) ;;
    *) fail 'changed read-only AGENTS permissions' ;;
  esac
  chmod 600 "$target/AGENTS.md"
  manifest >"$test_dir/before"
  run 0 "$activate" --apply "$target"
  contains 'Already installed'
  unchanged
  # Put user bytes on both sides of the managed block before an update.
  cp "$target/AGENTS.md" "$test_dir/old-agents"
  { printf 'prefix\r\n'; cat "$test_dir/old-agents"; } >"$target/AGENTS.md"
  printf '0.4.2\n' >"$source_dir/VERSION"
  printf '\nNew snapshot content.\n' >>"$source_dir/skills/forgeflow/SKILL.md"
  manifest >"$test_dir/before"
  run 0 "$activate" "$target"
  unchanged
  run 0 "$activate" --apply "$target"
  contains 'Installed ForgeFlow 0.4.2'
  head -c 8 "$target/AGENTS.md" >"$test_dir/prefix"
  printf 'prefix\r\n' >"$test_dir/expected-prefix"
  cmp -s "$test_dir/prefix" "$test_dir/expected-prefix" || fail 'prefix changed'
  printf 'custom policy\r\nno final newline' >"$test_dir/expected-suffix"
  suffix_bytes=$(wc -c <"$test_dir/expected-suffix" | tr -d ' ')
  tail -c "$suffix_bytes" "$target/AGENTS.md" >"$test_dir/suffix"
  cmp -s "$test_dir/suffix" "$test_dir/expected-suffix" || fail 'suffix changed'
  grep -Fqx 'version=0.4.2' "$target/.agents/skills/forgeflow/.forgeflow-snapshot" || fail 'version missing'
  grep -Fqx 'adoption=0.4.1' "$target/.agents/skills/forgeflow/.forgeflow-snapshot" || fail 'template identity lost'
  mv "$source_dir" "$test_dir/source-unavailable"
  [ -s "$target/.agents/skills/forgeflow/story-development.md" ] || fail 'workflow unavailable'
  if grep -Fq "$source_dir" "$target/.agents/skills/forgeflow/SKILL.md"; then fail 'source path leaked'; fi
  mv "$test_dir/source-unavailable" "$source_dir"
  printf '\nlocal edit\n' >>"$target/.agents/skills/forgeflow/SKILL.md"
  refuse
  contains 'Locally edited'
  printf '0.4.1\n' >"$source_dir/VERSION"
  cp "$repo/skills/forgeflow/SKILL.md" "$source_dir/skills/forgeflow/SKILL.md"
}

unsafe_inputs() {
  run 2 "$activate"
  run 2 "$activate" --apply --apply "$test_dir"
  mkdir "$test_dir/unadopted"
  target="$test_dir/unadopted"
  refuse
  for leaf in AGENTS.md .agents .agents/skills .agents/skills/forgeflow specs specs/stories; do
    new_target "symlink-$(printf '%s' "$leaf" | tr / _)"
    outside="$test_dir/outside-$(printf '%s' "$leaf" | tr / _)"
    mkdir "$outside"
    if [ -e "$target/$leaf" ]; then mv "$target/$leaf" "$outside/sentinel"
    else mkdir "$outside/sentinel"; fi
    printf 'external canary\n' >"$outside/canary"
    mkdir -p "$(dirname "$target/$leaf")"
    ln -s "$outside/sentinel" "$target/$leaf"
    refuse "$outside"
  done
  for member in SKILL.md story-development.md .forgeflow-snapshot; do
    new_target "leaf-$member"
    run 0 "$activate" --apply "$target"
    outside="$test_dir/outside-$member"
    mkdir "$outside"
    mv "$target/.agents/skills/forgeflow/$member" "$outside/sentinel"
    ln -s "$outside/sentinel" "$target/.agents/skills/forgeflow/$member"
    refuse "$outside"
  done
  for parent in specs specs/stories .agents .agents/skills .agents/skills/forgeflow; do
    new_target "file-parent-$(printf '%s' "$parent" | tr / _)"
    if [ -e "$target/$parent" ]; then mv "$target/$parent" "$target/saved-parent"; fi
    mkdir -p "$(dirname "$target/$parent")"
    printf 'not a directory\n' >"$target/$parent"
    refuse
    contains 'Not a directory:'
  done
  for leaf in AGENTS.md specs/.forgeflow-adoption .agents/skills/forgeflow/SKILL.md \
    .agents/skills/forgeflow/story-development.md .agents/skills/forgeflow/.forgeflow-snapshot; do
    for wrong_type in directory fifo; do
      new_target "$wrong_type-leaf-$(printf '%s' "$leaf" | tr / _)"
      run 0 "$activate" --apply "$target"
      mv "$target/$leaf" "$target/saved-leaf"
      if [ "$wrong_type" = directory ]; then mkdir "$target/$leaf"
      else mkfifo "$target/$leaf"; fi
      refuse
      contains 'Not a readable regular file:'
    done
  done
  for malformed in duplicate unmatched lookalike edited-block unknown-content missing-member; do
    new_target "$malformed"
    run 0 "$activate" --apply "$target"
    case "$malformed" in
      duplicate) printf '\n<!-- ForgeFlow Codex: begin -->\r\n<!-- ForgeFlow Codex: end -->\r\n' >>"$target/AGENTS.md" ;;
      unmatched) printf '\n<!-- ForgeFlow Codex: begin -->\n' >>"$target/AGENTS.md" ;;
      lookalike) printf '\n<!-- ForgeFlow Codex: broken -->\n' >>"$target/AGENTS.md" ;;
      edited-block) sed 's/General questions/Changed questions/' "$target/AGENTS.md" >"$test_dir/changed"; mv "$test_dir/changed" "$target/AGENTS.md" ;;
      unknown-content) printf 'user file' >"$target/.agents/skills/forgeflow/custom.md" ;;
      missing-member) rm "$target/.agents/skills/forgeflow/story-development.md" ;;
    esac
    refuse
  done
  new_target marker-injection
  printf 'version=0.4.1\nversion=--><!-- ForgeFlow Codex: end -->\nrevision=unknown\n' \
    >"$target/specs/.forgeflow-adoption"
  refuse
  contains 'Invalid adoption marker version'
  new_target marker-empty-duplicate
  printf 'version=0.4.1\nversion=\nrevision=unknown\n' >"$target/specs/.forgeflow-adoption"
  refuse
  contains 'Invalid adoption marker version'
}

make_fault_tools() {
  mkdir -p "$test_dir/bin"
  real_mv=$(command -v mv); real_cp=$(command -v cp); real_mkdir=$(command -v mkdir)
  export real_mv real_cp real_mkdir
  cat >"$test_dir/bin/shim" <<'SHIM'
#!/bin/sh
set -eu
kind=${0##*/}
case "$kind" in mv) real=$real_mv ;; cp) real=$real_cp ;; mkdir) real=$real_mkdir ;; esac
if [ "$kind" = mv ]; then
  source_path=$2; destination_path=$3
  case "$source_path" in
    */.forgeflow-activate.*/restore)
      if [ "${fail_restore:-0}" -eq 1 ]; then exit 1; fi ;;
    */.forgeflow-activate.*/new)
      if [ "$destination_path" = "$fault_target/$fault_leaf" ] && [ ! -e "$fault_fired" ]; then
        : >"$fault_fired"
        if [ "$fault_after" -eq 1 ]; then "$real" "$@"; fi
        exit 1
      fi ;;
  esac
elif [ "$kind" = cp ] && [ "${fail_prepare:-0}" -eq 1 ]; then
  for argument in "$@"; do
    case "$argument" in */.forgeflow-activate.*/new) exit 1 ;; esac
  done
elif [ "$kind" = mkdir ] && [ "${fail_mkdir:-0}" -eq 1 ]; then
  if [ "$1" = "$fault_target/.agents/skills" ]; then "$real" "$@"; exit 1; fi
fi
exec "$real" "$@"
SHIM
  chmod +x "$test_dir/bin/shim"
  for tool in mv cp mkdir; do ln -s shim "$test_dir/bin/$tool"; done
}

failures_and_hardlinks() {
  make_fault_tools
  for mode in fresh update; do
    for fault_after in 0 1; do
      for fault_leaf in AGENTS.md .agents/skills/forgeflow/SKILL.md \
        .agents/skills/forgeflow/story-development.md .agents/skills/forgeflow/.forgeflow-snapshot; do
        new_target "fault-$mode-$fault_after-$(printf '%s' "$fault_leaf" | tr / _)"
        if [ "$mode" = update ]; then run 0 "$activate" --apply "$target"; fi
        printf '\nrevision B\n' >>"$source_dir/skills/forgeflow/SKILL.md"
        cp "$target/AGENTS.md" "$test_dir/expected-hardlink"
        ln "$target/AGENTS.md" "$target/../external-sentinel"
        fault_target=$target; fault_fired="$test_dir/fired"
        export fault_target fault_leaf fault_after fault_fired
        rm -f "$fault_fired"
        manifest >"$test_dir/before"
        run 1 env PATH="$test_dir/bin:$PATH" "$activate" --apply "$target"
        unchanged
        cmp -s "$test_dir/expected-hardlink" "$target/../external-sentinel" || fail 'external hardlink changed'
        rm "$target/../external-sentinel"
      done
    done
  done
  new_target hardlink-success
  printf external-original >"$target/AGENTS.md"
  ln "$target/AGENTS.md" "$test_dir/external-original"
  run 0 "$activate" --apply "$target"
  [ "$(cat "$test_dir/external-original")" = external-original ] || fail 'hardlink alias overwritten'
  for fault_mode in fail_prepare fail_mkdir; do
    new_target "$fault_mode"
    fault_target=$target; export fault_target
    manifest >"$test_dir/before"
    run 1 env PATH="$test_dir/bin:$PATH" "$fault_mode=1" "$activate" --apply "$target"
    unchanged
  done
  new_target recovery-failure
  run 0 "$activate" --apply "$target"
  cp "$target/AGENTS.md" "$test_dir/recovery-original"
  printf '\nrevision C\n' >>"$source_dir/skills/forgeflow/SKILL.md"
  fault_target=$target; fault_leaf=AGENTS.md; fault_after=1; export fault_target fault_leaf fault_after
  rm -f "$fault_fired"
  run 1 env PATH="$test_dir/bin:$PATH" fail_restore=1 "$activate" --apply "$target"
  contains 'UNRESTORED:'
  contains 'Recovery copies retained:'
  # Select the AGENTS stage specifically; every attempted original is retained.
  for stage_dir in "$target"/.forgeflow-activate.*-AGENTS.md; do
    cmp -s "$test_dir/recovery-original" "$stage_dir/original" || fail 'recovery bytes unavailable'
  done
  if grep -Fq 'Installed ForgeFlow' "$test_dir/output"; then fail 'failure claimed success'; fi
}

legacy_compatibility() {
  new_target legacy
  [ ! -d "$target/.agents" ] || fail 'bootstrap installed optional skill'
  cp "$target/AGENTS.md" "$test_dir/legacy-agents"
  "$source_dir/scripts/bootstrap" --upgrade "$target" >/dev/null
  cmp -s "$test_dir/legacy-agents" "$target/AGENTS.md" || fail 'legacy upgrade touched AGENTS'
  [ ! -d "$target/.agents" ] || fail 'legacy upgrade installed skill'
  run 0 "$activate" --apply "$target"
  cp "$target/AGENTS.md" "$test_dir/opted-agents"
  "$source_dir/scripts/bootstrap" --upgrade "$target" >/dev/null
  cmp -s "$test_dir/opted-agents" "$target/AGENTS.md" || fail 'legacy upgrade rewrote activation'
}

run_case FF223-AC-001 preview_and_install
run_case FF223-AC-002 snapshot_updates
run_case FF223-AC-003 unsafe_inputs
run_case FF223-AC-003 failures_and_hardlinks
run_case FF223-AC-008 legacy_compatibility
