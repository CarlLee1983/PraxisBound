#!/bin/sh
# Build the C1--C11 human-review fixtures.  This records inputs, not approval:
# session guidance and any Codex result still require human acceptance.
set -eu

root=$(CDPATH='' cd -P "$(dirname "$0")/../../.." && pwd)
base=$(mktemp -d "${TMPDIR:-/tmp}/forgeflow-codex-walkthrough.XXXXXX")
source="$base/source-snapshot"

unset GIT_DIR GIT_WORK_TREE GIT_COMMON_DIR GIT_INDEX_FILE GIT_OBJECT_DIRECTORY
unset GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_CEILING_DIRECTORIES
unset GIT_DISCOVERY_ACROSS_FILESYSTEM GIT_NAMESPACE GIT_PREFIX
unset GIT_CONFIG_PARAMETERS GIT_TEMPLATE_DIR
GIT_CONFIG_GLOBAL=/dev/null
GIT_CONFIG_NOSYSTEM=1
GIT_CONFIG_COUNT=0
export GIT_CONFIG_GLOBAL GIT_CONFIG_NOSYSTEM GIT_CONFIG_COUNT

mkdir -p "$source/scripts" "$source/skills"
cp "$root/scripts/bootstrap" "$root/scripts/codex-activate" "$source/scripts/"
cp "$root/VERSION" "$source/VERSION"
cp -R "$root/templates" "$source/templates"
cp -R "$root/skills/forgeflow" "$root/skills/story-development" "$source/skills/"
{
  printf 'version='; sed -n '1p' "$source/VERSION"
  find "$source" -type f -print | sed "s|$source/||" | LC_ALL=C sort
} >"$base/source-manifest.txt"
{
  printf 'source_version='; sed -n '1p' "$source/VERSION"
  printf 'source_skill='; cksum "$source/skills/forgeflow/SKILL.md"
  printf 'source_workflow='; cksum "$source/skills/story-development/SKILL.md"
} >"$base/source-identity.txt"

prompt_for() {
  case "$1" in
    C1|C2|C7|C8review|C8conflict|C9) printf '繼續開發\n' ;;
    C3|C4) printf '請新增 CSV 匯出功能：建立 src/export.sh，無參數時將固定單筆 greeting 資料輸出至 stdout，內容精確為 message 換行 hello ForgeFlow 換行，不寫檔、不新增依賴。\n' ;;
    C5) printf '請解釋 src/greet.sh 現在做什麼。\n' ;;
    C6) printf '$forgeflow 請說明目前專案狀態，不要修改檔案。\n' ;;
    C10) printf '$forgeflow 請檢查目前專案狀態與安裝版本是否一致，不要修改檔案。\n' ;;
    C11) printf '$forgeflow 請檢查專案指示是否衝突，並解釋 src/greet.sh 現在做什麼；不要修改檔案。\n' ;;
  esac
}

write_handoff() {
  fixture=$1 sha=$2 current=$3 next=$4 status=$5 result=$6 note=$7 owned=$8 unrelated=$9
  cat >"$fixture/specs/handoff.md" <<EOF
# Handoff

$note

\`\`\`yaml
workflow:
  current_story: $current
  next_story: $next
  completed_stories: []
  status: $status
baseline:
  repository: Fixture/activation
  branch: main
  commit: $sha
  dirty_worktree: true
  story_owned_paths:
$owned
$unrelated
verification:
  last_command: make verify
  result: $result
\`\`\`
EOF
}

make_fixture() {
  case_name=$1
  target="$base/$case_name"
  evidence="$base/evidence/$case_name"
  mkdir -p "$evidence"
  mkdir -p "$target/src" "$target/tests"
  "$source/scripts/bootstrap" "$target" >/dev/null
  "$source/scripts/codex-activate" "$target" >"$base/$case_name-preview.txt"
  "$source/scripts/codex-activate" --apply "$target" >"$base/$case_name-install.txt"
  cp -R "$target/.agents/skills/forgeflow" "$evidence/.forgeflow-snapshot"
  {
    cat "$base/source-identity.txt"
    printf 'installed_snapshot:\n'
    cat "$evidence/.forgeflow-snapshot/.forgeflow-snapshot"
  } >"$evidence/identity.txt"

  cat >"$target/src/greet.sh" <<'EOF'
#!/bin/sh
printf 'hello\n'
EOF
  cat >"$target/Makefile" <<'EOF'
verify:
	@actual=$$(sh src/greet.sh; printf x); expected=$$(printf 'hello ForgeFlow\nx'); test "$$actual" = "$$expected"
EOF
  mkdir -p "$target/specs/stories/TST-001-greeting"
  cat >"$target/specs/stories/TST-001-greeting/story.md" <<'EOF'
# Story: TST-001 Greeting

## Goal

Make src/greet.sh print hello ForgeFlow followed by a newline.

## Classification

* Security sensitive: no
* Baseline conformance: yes

## Scope

Change the greeting only and validate it with make verify.

## Rules

* Human approved this Story and its AC for implementation in this fixture.
* This sandbox repository has no remote; no commit or publication requested.

## Superseded Behavior

* `src/greet.sh` prints hello rather than hello ForgeFlow.
EOF
  cat >"$target/specs/stories/TST-001-greeting/acceptance.md" <<'EOF'
# Acceptance Criteria

* [ ] AC-001: Running sh src/greet.sh prints hello ForgeFlow and a newline.

## Acceptance Evidence

| AC | Method | Evidence | Fixture / precondition | Expected observation |
| --- | --- | --- | --- | --- |
| `AC-001` | command | `make verify` | `src/greet.sh exists` | `exit 0` |
EOF
  cat >"$target/specs/stories/TST-001-greeting/task.md" <<'EOF'
IMPLEMENTING. Human approved the greeting Story. The code still prints hello.
EOF
  git init -q -b main "$target"
  git -C "$target" add -A
  GIT_AUTHOR_NAME=Fixture GIT_AUTHOR_EMAIL=fixture@example.invalid \
  GIT_AUTHOR_DATE='2000-01-01T00:00:00Z' GIT_COMMITTER_NAME=Fixture \
  GIT_COMMITTER_EMAIL=fixture@example.invalid GIT_COMMITTER_DATE='2000-01-01T00:00:00Z' \
    git -C "$target" -c core.hooksPath=/dev/null -c commit.gpgSign=false \
      commit -qm 'approved fixture'
  sha=$(git -C "$target" rev-parse HEAD)
  tree=$(git -C "$target" rev-parse HEAD^{tree})

  owned='    - specs/handoff.md'
  unrelated='  known_unrelated_paths: []'
  current=TST-001 next=pending status=implementing result=not_run
  note='Approved TST-001 is in implementation; continue the greeting change.'
  case "$case_name" in
    C3|C7)
      current=none status=draft
      note='There is no selected current Story; TST-001 remains an unapproved draft.'
      printf 'DRAFT. No Story is selected or approved.\n' >"$target/specs/stories/TST-001-greeting/task.md"
      sed 's/Human approved this Story and its AC for implementation in this fixture./This Story is an unapproved draft, not selected for implementation./' \
        "$target/specs/stories/TST-001-greeting/story.md" >"$evidence/story.tmp"
      mv "$evidence/story.tmp" "$target/specs/stories/TST-001-greeting/story.md"
      owned='    - specs/handoff.md
    - specs/stories/TST-001-greeting/story.md
    - specs/stories/TST-001-greeting/task.md'
      ;;
    C8review)
      status=review
      note='TST-001 is complete and awaits Human Review.'
      printf '#!/bin/sh\nprintf '\''hello ForgeFlow\\n'\''\n' >"$target/src/greet.sh"
      sed 's/\[ \] AC-001/\[x\] AC-001/' "$target/specs/stories/TST-001-greeting/acceptance.md" >"$evidence/acceptance.tmp"
      mv "$evidence/acceptance.tmp" "$target/specs/stories/TST-001-greeting/acceptance.md"
      printf 'REVIEW. Greeting implementation and make verify evidence await Human Review.\n' >"$target/specs/stories/TST-001-greeting/task.md"
      owned='    - specs/handoff.md
    - specs/stories/TST-001-greeting/acceptance.md
    - specs/stories/TST-001-greeting/task.md
    - src/greet.sh'
      ;;
    C8conflict)
      next=TST-001
      note='TST-001 is an approved implementation Story.'
      ;;
    C9)
      rm "$target/.agents/skills/forgeflow/SKILL.md"
      note='TST-001 is an approved implementation Story.'
      unrelated='  known_unrelated_paths:
    - .agents/skills/forgeflow/SKILL.md'
      ;;
    C10)
      sed 's/^version=.*/version=0.5.0/' "$target/specs/.forgeflow-adoption" >"$evidence/marker.tmp"
      mv "$evidence/marker.tmp" "$target/specs/.forgeflow-adoption"
      note='TST-001 is an approved implementation Story.'
      unrelated='  known_unrelated_paths:
    - specs/.forgeflow-adoption'
      ;;
    C11)
      printf '\nImplementation policy conflict: all new implementation requires a separate human review before each file write.\n' >>"$target/AGENTS.md"
      note='TST-001 is an approved implementation Story.'
      unrelated='  known_unrelated_paths:
    - AGENTS.md'
      ;;
  esac
  if [ "$case_name" = C8review ]; then
    (cd "$target" && make verify) >"$evidence/pre-run-verify.txt" 2>&1
    result=pass
  fi
  write_handoff "$target" "$sha" "$current" "$next" "$status" "$result" "$note" "$owned" "$unrelated"
  "$root/scripts/story-check" "$target/specs/stories/TST-001-greeting" >"$evidence/story-contract.txt"
  if [ "$case_name" = C8conflict ]; then
    if "$root/scripts/handoff-check" "$target/specs/handoff.md" >"$evidence/handoff-contract.txt"; then
      printf 'Expected contradictory handoff to fail\n' >&2; exit 1
    fi
    grep -Fq 'the same Story cannot be both current and next' "$evidence/handoff-contract.txt"
  else
    "$root/scripts/handoff-check" "$target/specs/handoff.md" >"$evidence/handoff-contract.txt"
  fi
  prompt_for "$case_name" >"$evidence/prompt.txt"
  {
    printf 'commit=%s\n' "$sha"
    printf 'tree=%s\n' "$tree"
  } >"$evidence/baseline.txt"
  git -C "$target" status --porcelain >"$evidence/pre-run-status.txt"
}

for case_name in C1 C2 C3 C4 C5 C6 C7 C8review C8conflict C9 C10 C11; do
  make_fixture "$case_name"
done

# All installs came from this one generated snapshot.  Its manifest and identity
# remain as evidence; remove only this fixed child of the new mktemp directory.
# The host checkout is outside this fixture, and OS read isolation is not asserted.
for case_name in C2 C3 C4 C5 C6 C7 C8review C8conflict C9 C10 C11; do
  for snapshot_file in SKILL.md story-development.md .forgeflow-snapshot; do
    cmp -s "$base/evidence/C1/.forgeflow-snapshot/$snapshot_file" \
      "$base/evidence/$case_name/.forgeflow-snapshot/$snapshot_file"
  done
done
rm -rf "$source"
printf '%s\n' "$base"
