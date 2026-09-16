#!/bin/sh

set -eu

forgeflow_case_id='FF-202'

fail() {
  printf 'bootstrap test failed [%s]: %s\n' "$forgeflow_case_id" "$1" >&2
  exit 1
}

run_case() {
  forgeflow_case_id=$1
  forgeflow_case_function=$2

  "$forgeflow_case_function"
  printf 'PASS %s %s\n' "$forgeflow_case_id" "$forgeflow_case_function"
}

expect_exit_status() {
  forgeflow_expected_status=$1
  shift

  if "$@" >/dev/null 2>&1; then
    forgeflow_actual_status=0
  else
    forgeflow_actual_status=$?
  fi

  if [ "$forgeflow_actual_status" -ne "$forgeflow_expected_status" ]; then
    fail "expected exit $forgeflow_expected_status, got $forgeflow_actual_status: $*"
  fi
}

inode() {
  # POSIX does not provide an inode query utility; test paths are controlled.
  # shellcheck disable=SC2012
  ls -di "$1" | awk '{ print $1 }'
}

forgeflow_test_dir=$(mktemp -d "${TMPDIR:-/tmp}/forgeflow-bootstrap.XXXXXX")

cleanup() {
  rm -rf "$forgeflow_test_dir"
}

trap cleanup EXIT
trap 'exit 1' HUP INT TERM

forgeflow_repo=$(
  cd -P "$(dirname "$0")/.." >/dev/null 2>&1
  pwd
)
forgeflow_fresh="$forgeflow_test_dir/fresh"

mkdir -p "$forgeflow_fresh"
forgeflow_fresh_canonical=$(cd -P "$forgeflow_fresh" >/dev/null 2>&1 && pwd)

forgeflow_dry_output=$("$forgeflow_repo/scripts/bootstrap" --dry-run "$forgeflow_fresh")

for forgeflow_relative_path in \
  AGENTS.md \
  specs/stories/_template/story.md \
  specs/stories/_template/acceptance.md \
  specs/stories/_template/task.md \
  guidance/ENTRY.md \
  guidance/PRINCIPLES.md \
  guidance/DECISIONS.md \
  guidance/PRACTICES.md
do
  printf '%s\n' "$forgeflow_dry_output" | grep "Would install $forgeflow_fresh_canonical/$forgeflow_relative_path" \
    >/dev/null || fail "dry run did not report $forgeflow_relative_path"
done

forgeflow_fresh_directory_count=$(find "$forgeflow_fresh" -type d | wc -l | tr -d ' ')
if [ "$forgeflow_fresh_directory_count" -ne 1 ]; then
  fail "dry run created directories in an empty target"
fi

"$forgeflow_repo/scripts/bootstrap" "$forgeflow_fresh"

cmp "$forgeflow_repo/templates/AGENTS.md" \
  "$forgeflow_fresh/AGENTS.md" >/dev/null ||
  fail "AGENTS.md was not installed from the template"
cmp "$forgeflow_repo/templates/story/story.md" \
  "$forgeflow_fresh/specs/stories/_template/story.md" >/dev/null ||
  fail "story.md was not installed from the template"
cmp "$forgeflow_repo/templates/story/acceptance.md" \
  "$forgeflow_fresh/specs/stories/_template/acceptance.md" >/dev/null ||
  fail "acceptance.md was not installed from the template"
cmp "$forgeflow_repo/templates/story/task.md" \
  "$forgeflow_fresh/specs/stories/_template/task.md" >/dev/null ||
  fail "task.md was not installed from the template"
for forgeflow_guidance_file in ENTRY.md PRINCIPLES.md DECISIONS.md PRACTICES.md
do
  cmp "$forgeflow_repo/guidance/$forgeflow_guidance_file" \
    "$forgeflow_fresh/guidance/$forgeflow_guidance_file" >/dev/null ||
    fail "guidance/$forgeflow_guidance_file was not installed"
done

if "$forgeflow_repo/scripts/bootstrap" "$forgeflow_fresh" >/dev/null 2>&1; then
  fail "a second install overwrote managed files without --force"
fi

forgeflow_force_dry_output=$("$forgeflow_repo/scripts/bootstrap" --force --dry-run "$forgeflow_fresh")
forgeflow_reverse_force_dry_output=$("$forgeflow_repo/scripts/bootstrap" --dry-run --force "$forgeflow_fresh")

for forgeflow_relative_path in \
  AGENTS.md \
  specs/stories/_template/story.md \
  specs/stories/_template/acceptance.md \
  specs/stories/_template/task.md \
  guidance/ENTRY.md \
  guidance/PRINCIPLES.md \
  guidance/DECISIONS.md \
  guidance/PRACTICES.md
do
  printf '%s\n' "$forgeflow_force_dry_output" | grep "Would replace $forgeflow_fresh_canonical/$forgeflow_relative_path" \
    >/dev/null || fail "--force --dry-run did not preview replacement of $forgeflow_relative_path"
  printf '%s\n' "$forgeflow_reverse_force_dry_output" | grep "Would replace $forgeflow_fresh_canonical/$forgeflow_relative_path" \
    >/dev/null || fail "--dry-run --force did not preview replacement of $forgeflow_relative_path"
done

cmp "$forgeflow_repo/templates/AGENTS.md" "$forgeflow_fresh/AGENTS.md" >/dev/null ||
  fail "force dry run changed AGENTS.md"

forgeflow_conflict_number=0

for forgeflow_relative_path in \
  AGENTS.md \
  specs/stories/_template/story.md \
  specs/stories/_template/acceptance.md \
  specs/stories/_template/task.md \
  guidance/ENTRY.md \
  guidance/PRINCIPLES.md \
  guidance/DECISIONS.md \
  guidance/PRACTICES.md
do
  forgeflow_conflict_number=$((forgeflow_conflict_number + 1))
  forgeflow_conflict="$forgeflow_test_dir/conflict-$forgeflow_conflict_number"
  forgeflow_existing="$forgeflow_conflict/$forgeflow_relative_path"

  mkdir -p "$(dirname "$forgeflow_existing")"
  printf 'preserve existing file\n' >"$forgeflow_existing"

  if "$forgeflow_repo/scripts/bootstrap" "$forgeflow_conflict" >/dev/null 2>&1; then
    fail "existing $forgeflow_relative_path did not block installation"
  fi

  expect_exit_status 1 "$forgeflow_repo/scripts/bootstrap" --dry-run "$forgeflow_conflict"

  if [ "$(sed -n '1p' "$forgeflow_existing")" != \
    "preserve existing file" ]; then
    fail "a refused install changed $forgeflow_relative_path"
  fi

  forgeflow_file_count=$(find "$forgeflow_conflict" -type f | wc -l | tr -d ' ')
  if [ "$forgeflow_file_count" -ne 1 ]; then
    fail "a conflict at $forgeflow_relative_path allowed partial writes"
  fi
done

forgeflow_symlink="$forgeflow_test_dir/symlink-conflict"
mkdir -p "$forgeflow_symlink"
ln -s "$forgeflow_test_dir/missing-guide" "$forgeflow_symlink/AGENTS.md"

if "$forgeflow_repo/scripts/bootstrap" "$forgeflow_symlink" >/dev/null 2>&1; then
  fail "a dangling AGENTS.md symlink did not block installation"
fi

if "$forgeflow_repo/scripts/bootstrap" --force "$forgeflow_symlink" \
  >/dev/null 2>&1; then
  fail "--force followed a dangling AGENTS.md symlink"
fi

expect_exit_status 1 "$forgeflow_repo/scripts/bootstrap" --dry-run --force "$forgeflow_symlink"

if [ ! -L "$forgeflow_symlink/AGENTS.md" ]; then
  fail "a refused install changed a dangling AGENTS.md symlink"
fi

forgeflow_outside="$forgeflow_test_dir/outside"
forgeflow_parent_symlink="$forgeflow_test_dir/parent-symlink"
mkdir -p "$forgeflow_outside" "$forgeflow_parent_symlink"
ln -s "$forgeflow_outside" "$forgeflow_parent_symlink/specs"

if "$forgeflow_repo/scripts/bootstrap" "$forgeflow_parent_symlink" \
  >/dev/null 2>&1; then
  fail "a managed parent symlink did not block installation"
fi

if "$forgeflow_repo/scripts/bootstrap" --force "$forgeflow_parent_symlink" \
  >/dev/null 2>&1; then
  fail "--force followed a managed parent symlink"
fi

expect_exit_status 1 "$forgeflow_repo/scripts/bootstrap" --force --dry-run "$forgeflow_parent_symlink"

if [ -e "$forgeflow_outside/stories" ]; then
  fail "bootstrap wrote through a managed parent symlink"
fi

if [ ! -L "$forgeflow_parent_symlink/specs" ]; then
  fail "dry run changed a managed parent symlink"
fi

forgeflow_outside_guide="$forgeflow_test_dir/outside-guide"
forgeflow_leaf_symlink="$forgeflow_test_dir/leaf-symlink"
mkdir -p "$forgeflow_leaf_symlink"
printf 'outside guide\n' >"$forgeflow_outside_guide"
ln -s "$forgeflow_outside_guide" "$forgeflow_leaf_symlink/AGENTS.md"

if "$forgeflow_repo/scripts/bootstrap" --force "$forgeflow_leaf_symlink" \
  >/dev/null 2>&1; then
  fail "--force followed a managed file symlink"
fi

if [ "$(sed -n '1p' "$forgeflow_outside_guide")" != "outside guide" ]; then
  fail "bootstrap changed a file outside the target through a symlink"
fi

expect_exit_status 1 "$forgeflow_repo/scripts/bootstrap" --dry-run --force "$forgeflow_leaf_symlink"

if [ "$(sed -n '1p' "$forgeflow_outside_guide")" != "outside guide" ]; then
  fail "dry run changed a file outside the target through a symlink"
fi

forgeflow_outside_hardlink="$forgeflow_test_dir/outside-hardlink"
forgeflow_hardlink="$forgeflow_test_dir/hardlink"
mkdir -p "$forgeflow_hardlink"
printf 'outside hard link\n' >"$forgeflow_outside_hardlink"
ln "$forgeflow_outside_hardlink" "$forgeflow_hardlink/AGENTS.md"
forgeflow_hardlink_outside_inode_before=$(inode "$forgeflow_outside_hardlink")
forgeflow_hardlink_target_inode_before=$(inode "$forgeflow_hardlink/AGENTS.md")

if [ "$forgeflow_hardlink_outside_inode_before" != \
  "$forgeflow_hardlink_target_inode_before" ]; then
  fail "hard-link fixture did not share an inode before dry run"
fi

"$forgeflow_repo/scripts/bootstrap" --dry-run --force "$forgeflow_hardlink" >/dev/null

forgeflow_hardlink_outside_inode_after=$(inode "$forgeflow_outside_hardlink")
forgeflow_hardlink_target_inode_after=$(inode "$forgeflow_hardlink/AGENTS.md")

if [ "$forgeflow_hardlink_outside_inode_after" != \
  "$forgeflow_hardlink_outside_inode_before" ] || \
  [ "$forgeflow_hardlink_target_inode_after" != \
  "$forgeflow_hardlink_target_inode_before" ] || \
  [ "$forgeflow_hardlink_outside_inode_after" != \
  "$forgeflow_hardlink_target_inode_after" ]; then
  fail "dry run changed the hard-link inode relationship"
fi

if [ "$(sed -n '1p' "$forgeflow_outside_hardlink")" != \
  "outside hard link" ]; then
  fail "dry run changed data outside the target through a hard link"
fi

"$forgeflow_repo/scripts/bootstrap" --force "$forgeflow_hardlink"

if [ "$(sed -n '1p' "$forgeflow_outside_hardlink")" != \
  "outside hard link" ]; then
  fail "--force changed data outside the target through a hard link"
fi

cmp "$forgeflow_repo/templates/AGENTS.md" \
  "$forgeflow_hardlink/AGENTS.md" >/dev/null ||
  fail "--force did not replace the target-side hard link"

"$forgeflow_repo/scripts/bootstrap" --force "$forgeflow_conflict"

cmp "$forgeflow_repo/templates/AGENTS.md" \
  "$forgeflow_conflict/AGENTS.md" >/dev/null ||
  fail "--force did not replace AGENTS.md"
cmp "$forgeflow_repo/templates/story/story.md" \
  "$forgeflow_conflict/specs/stories/_template/story.md" >/dev/null ||
  fail "--force did not install Story templates"

forgeflow_wrong_type="$forgeflow_test_dir/wrong-type"
mkdir -p "$forgeflow_wrong_type/AGENTS.md"
expect_exit_status 1 "$forgeflow_repo/scripts/bootstrap" "$forgeflow_wrong_type"
expect_exit_status 1 "$forgeflow_repo/scripts/bootstrap" --dry-run --force "$forgeflow_wrong_type"

if [ ! -d "$forgeflow_wrong_type/AGENTS.md" ]; then
  fail "dry run changed a managed path with the wrong file type"
fi

expect_exit_status 2 "$forgeflow_repo/scripts/bootstrap" --unknown "$forgeflow_fresh"
expect_exit_status 2 "$forgeflow_repo/scripts/bootstrap" -x "$forgeflow_fresh"
expect_exit_status 2 "$forgeflow_repo/scripts/bootstrap" --dry-run --dry-run "$forgeflow_fresh"
expect_exit_status 2 "$forgeflow_repo/scripts/bootstrap" --force --force "$forgeflow_fresh"
expect_exit_status 2 "$forgeflow_repo/scripts/bootstrap" "$forgeflow_fresh" --dry-run
expect_exit_status 2 "$forgeflow_repo/scripts/bootstrap" "$forgeflow_fresh" "$forgeflow_conflict"
expect_exit_status 2 "$forgeflow_repo/scripts/bootstrap" --dry-run "$forgeflow_test_dir/missing"

forgeflow_marker_relative='specs/.praxisbound-adoption'

marker_field() {
  sed -n "s/^$2=//p" "$1"
}

fresh_bootstrap_records_the_adoption_snapshot() {
  forgeflow_case_target="$forgeflow_test_dir/marker-fresh"
  mkdir -p "$forgeflow_case_target"
  "$forgeflow_repo/scripts/bootstrap" "$forgeflow_case_target" >/dev/null

  forgeflow_case_marker="$forgeflow_case_target/$forgeflow_marker_relative"

  [ -f "$forgeflow_case_marker" ] ||
    fail 'fresh bootstrap did not install the adoption marker'

  forgeflow_case_line_count=$(wc -l <"$forgeflow_case_marker" | tr -d ' ')
  if [ "$forgeflow_case_line_count" -ne 2 ]; then
    fail "the marker must hold exactly two lines, got $forgeflow_case_line_count"
  fi

  forgeflow_case_expected_version=$(cat "$forgeflow_repo/VERSION")
  if [ "$(marker_field "$forgeflow_case_marker" version)" != \
    "$forgeflow_case_expected_version" ]; then
    fail "the marker version is not $forgeflow_case_expected_version"
  fi

  forgeflow_case_expected_revision=$(git -C "$forgeflow_repo" rev-parse HEAD)
  forgeflow_case_revision=$(marker_field "$forgeflow_case_marker" revision)
  case "$forgeflow_case_revision" in
    "$forgeflow_case_expected_revision"|"$forgeflow_case_expected_revision-dirty") ;;
    *) fail "the marker revision is not this checkout's HEAD: $forgeflow_case_revision" ;;
  esac

  if [ -e "$forgeflow_case_target/specs/stories/README.md" ]; then
    fail 'bootstrap installed a Story README it does not manage'
  fi
}

run_case 'AC-001' fresh_bootstrap_records_the_adoption_snapshot

existing_marker_is_managed_and_story_readme_is_not() {
  forgeflow_case_target="$forgeflow_test_dir/marker-conflict"
  forgeflow_case_marker="$forgeflow_case_target/$forgeflow_marker_relative"

  mkdir -p "$(dirname "$forgeflow_case_marker")"
  printf 'version=0.0.1\nrevision=unknown\n' >"$forgeflow_case_marker"

  expect_exit_status 1 "$forgeflow_repo/scripts/bootstrap" "$forgeflow_case_target"

  if [ "$(marker_field "$forgeflow_case_marker" version)" != '0.0.1' ]; then
    fail 'a refused install replaced the existing marker'
  fi

  forgeflow_case_file_count=$(find "$forgeflow_case_target" -type f | wc -l | tr -d ' ')
  if [ "$forgeflow_case_file_count" -ne 1 ]; then
    fail 'a marker conflict allowed partial writes'
  fi

  "$forgeflow_repo/scripts/bootstrap" --force "$forgeflow_case_target" >/dev/null

  if [ "$(marker_field "$forgeflow_case_marker" version)" != \
    "$(cat "$forgeflow_repo/VERSION")" ]; then
    fail '--force did not replace the existing marker'
  fi

  forgeflow_case_readme_target="$forgeflow_test_dir/marker-readme"
  forgeflow_case_readme="$forgeflow_case_readme_target/specs/stories/README.md"

  mkdir -p "$(dirname "$forgeflow_case_readme")"
  printf 'adopter prose\n' >"$forgeflow_case_readme"

  "$forgeflow_repo/scripts/bootstrap" "$forgeflow_case_readme_target" >/dev/null

  if [ "$(cat "$forgeflow_case_readme")" != 'adopter prose' ]; then
    fail 'bootstrap wrote to a Story README it does not manage'
  fi
}

run_case 'AC-007' existing_marker_is_managed_and_story_readme_is_not

make_forgeflow_checkout() {
  forgeflow_case_checkout=$1

  mkdir -p "$forgeflow_case_checkout/scripts" \
    "$forgeflow_case_checkout/templates/story" \
    "$forgeflow_case_checkout/guidance"
  cp "$forgeflow_repo/scripts/bootstrap" "$forgeflow_case_checkout/scripts/"
  cp "$forgeflow_repo/VERSION" "$forgeflow_case_checkout/"
  cp "$forgeflow_repo/templates/AGENTS.md" "$forgeflow_case_checkout/templates/"
  cp "$forgeflow_repo/templates/story/story.md" \
    "$forgeflow_repo/templates/story/acceptance.md" \
    "$forgeflow_repo/templates/story/task.md" \
    "$forgeflow_case_checkout/templates/story/"
  cp "$forgeflow_repo/guidance/ENTRY.md" \
    "$forgeflow_repo/guidance/PRINCIPLES.md" \
    "$forgeflow_repo/guidance/DECISIONS.md" \
    "$forgeflow_repo/guidance/PRACTICES.md" \
    "$forgeflow_case_checkout/guidance/"
}

revision_states_what_the_snapshot_can_prove() {
  forgeflow_case_checkout="$forgeflow_test_dir/checkout-plain"
  forgeflow_case_target="$forgeflow_test_dir/revision-plain"

  make_forgeflow_checkout "$forgeflow_case_checkout"
  mkdir -p "$forgeflow_case_target"
  "$forgeflow_case_checkout/scripts/bootstrap" "$forgeflow_case_target" >/dev/null

  if [ "$(marker_field "$forgeflow_case_target/$forgeflow_marker_relative" revision)" != \
    'unknown' ]; then
    fail 'a checkout outside a Git work tree did not record an unknown revision'
  fi

  forgeflow_case_checkout="$forgeflow_test_dir/checkout-git"
  forgeflow_case_target="$forgeflow_test_dir/revision-git"

  make_forgeflow_checkout "$forgeflow_case_checkout"
  git -C "$forgeflow_case_checkout" init -q
  git -C "$forgeflow_case_checkout" -c user.email=test@example.com \
    -c user.name=test -c commit.gpgsign=false add -A
  git -C "$forgeflow_case_checkout" -c user.email=test@example.com \
    -c user.name=test -c commit.gpgsign=false commit -q -m 'snapshot'
  forgeflow_case_head=$(git -C "$forgeflow_case_checkout" rev-parse HEAD)

  mkdir -p "$forgeflow_case_target"
  "$forgeflow_case_checkout/scripts/bootstrap" "$forgeflow_case_target" >/dev/null

  if [ "$(marker_field "$forgeflow_case_target/$forgeflow_marker_relative" revision)" != \
    "$forgeflow_case_head" ]; then
    fail 'a clean Git work tree did not record its HEAD revision'
  fi

  printf 'local edit\n' >>"$forgeflow_case_checkout/templates/AGENTS.md"
  forgeflow_case_target="$forgeflow_test_dir/revision-dirty"
  mkdir -p "$forgeflow_case_target"
  "$forgeflow_case_checkout/scripts/bootstrap" "$forgeflow_case_target" >/dev/null

  if [ "$(marker_field "$forgeflow_case_target/$forgeflow_marker_relative" revision)" != \
    "$forgeflow_case_head-dirty" ]; then
    fail 'a dirty Git work tree claimed a bare HEAD revision'
  fi

  # An inherited Git environment must not redirect the lookup at another
  # repository, whose HEAD would look like exact evidence about this snapshot.
  forgeflow_case_target="$forgeflow_test_dir/revision-foreign-env"
  mkdir -p "$forgeflow_case_target"
  GIT_DIR="$forgeflow_repo/.git" \
    "$forgeflow_test_dir/checkout-plain/scripts/bootstrap" \
    "$forgeflow_case_target" >/dev/null

  if [ "$(marker_field "$forgeflow_case_target/$forgeflow_marker_relative" revision)" != \
    'unknown' ]; then
    fail 'an inherited GIT_DIR was recorded as this snapshot revision'
  fi

  # A non-Git ForgeFlow copy vendored inside an unrelated Git repository must
  # not adopt the enclosing repository's HEAD either.
  forgeflow_case_enclosing="$forgeflow_test_dir/enclosing-repo"
  mkdir -p "$forgeflow_case_enclosing"
  git -C "$forgeflow_case_enclosing" init -q
  printf 'unrelated\n' >"$forgeflow_case_enclosing/README.md"
  git -C "$forgeflow_case_enclosing" -c user.email=test@example.com \
    -c user.name=test -c commit.gpgsign=false add -A
  git -C "$forgeflow_case_enclosing" -c user.email=test@example.com \
    -c user.name=test -c commit.gpgsign=false commit -q -m 'unrelated'

  make_forgeflow_checkout "$forgeflow_case_enclosing/vendor/forgeflow"
  forgeflow_case_target="$forgeflow_test_dir/revision-vendored"
  mkdir -p "$forgeflow_case_target"
  "$forgeflow_case_enclosing/vendor/forgeflow/scripts/bootstrap" \
    "$forgeflow_case_target" >/dev/null

  if [ "$(marker_field "$forgeflow_case_target/$forgeflow_marker_relative" revision)" != \
    'unknown' ]; then
    fail 'an enclosing repository HEAD was recorded as this snapshot revision'
  fi

  # A work tree whose state cannot be read is not evidence of a clean tree.
  forgeflow_case_checkout="$forgeflow_test_dir/checkout-unreadable"
  make_forgeflow_checkout "$forgeflow_case_checkout"
  git -C "$forgeflow_case_checkout" init -q
  git -C "$forgeflow_case_checkout" -c user.email=test@example.com \
    -c user.name=test -c commit.gpgsign=false add -A
  git -C "$forgeflow_case_checkout" -c user.email=test@example.com \
    -c user.name=test -c commit.gpgsign=false commit -q -m 'snapshot'
  printf 'uncommitted\n' >>"$forgeflow_case_checkout/templates/AGENTS.md"
  printf 'corrupt index\n' >"$forgeflow_case_checkout/.git/index"

  forgeflow_case_target="$forgeflow_test_dir/revision-unreadable"
  mkdir -p "$forgeflow_case_target"
  "$forgeflow_case_checkout/scripts/bootstrap" "$forgeflow_case_target" >/dev/null

  if [ "$(marker_field "$forgeflow_case_target/$forgeflow_marker_relative" revision)" != \
    'unknown' ]; then
    fail 'an unreadable work tree was recorded as clean'
  fi
}

run_case 'AC-004' revision_states_what_the_snapshot_can_prove

make_prior_adoption() {
  forgeflow_case_adoption=$1

  mkdir -p "$forgeflow_case_adoption/specs/stories/_template"
  printf 'customized adopter guide\n' >"$forgeflow_case_adoption/AGENTS.md"

  for forgeflow_case_template in story acceptance task
  do
    printf 'old template\n' \
      >"$forgeflow_case_adoption/specs/stories/_template/$forgeflow_case_template.md"
  done
}

upgrade_replaces_templates_and_preserves_the_adopter_guide() {
  forgeflow_case_target="$forgeflow_test_dir/upgrade-basic"

  make_prior_adoption "$forgeflow_case_target"

  "$forgeflow_repo/scripts/bootstrap" --upgrade "$forgeflow_case_target" >/dev/null

  for forgeflow_case_template in story acceptance task
  do
    cmp "$forgeflow_repo/templates/story/$forgeflow_case_template.md" \
      "$forgeflow_case_target/specs/stories/_template/$forgeflow_case_template.md" \
      >/dev/null ||
      fail "--upgrade did not replace $forgeflow_case_template.md"
  done

  if [ "$(cat "$forgeflow_case_target/AGENTS.md")" != \
    'customized adopter guide' ]; then
    fail '--upgrade wrote AGENTS.md'
  fi

  if [ "$(marker_field "$forgeflow_case_target/$forgeflow_marker_relative" version)" != \
    "$(cat "$forgeflow_repo/VERSION")" ]; then
    fail '--upgrade did not create the adoption marker'
  fi

  printf 'version=0.2.1\nrevision=unknown\n' \
    >"$forgeflow_case_target/$forgeflow_marker_relative"
  "$forgeflow_repo/scripts/bootstrap" --upgrade "$forgeflow_case_target" \
    >/dev/null 2>&1

  if [ "$(marker_field "$forgeflow_case_target/$forgeflow_marker_relative" version)" != \
    "$(cat "$forgeflow_repo/VERSION")" ]; then
    fail '--upgrade did not replace a stale adoption marker'
  fi

  # AGENTS.md left the managed surface, so an upgrade must succeed whatever
  # state it is in, and must not reach it through a link.
  forgeflow_case_target="$forgeflow_test_dir/upgrade-absent-guide"
  make_prior_adoption "$forgeflow_case_target"
  rm "$forgeflow_case_target/AGENTS.md"
  "$forgeflow_repo/scripts/bootstrap" --upgrade "$forgeflow_case_target" \
    >/dev/null 2>&1 ||
    fail '--upgrade refused a repository with no AGENTS.md'

  if [ -e "$forgeflow_case_target/AGENTS.md" ]; then
    fail '--upgrade installed AGENTS.md'
  fi

  forgeflow_case_target="$forgeflow_test_dir/upgrade-linked-guide"
  forgeflow_case_outside="$forgeflow_test_dir/upgrade-outside-guide"
  make_prior_adoption "$forgeflow_case_target"
  printf 'outside guide\n' >"$forgeflow_case_outside"
  rm "$forgeflow_case_target/AGENTS.md"
  ln -s "$forgeflow_case_outside" "$forgeflow_case_target/AGENTS.md"

  "$forgeflow_repo/scripts/bootstrap" --upgrade "$forgeflow_case_target" \
    >/dev/null 2>&1 ||
    fail '--upgrade refused a repository whose AGENTS.md is a symlink'

  if [ "$(cat "$forgeflow_case_outside")" != 'outside guide' ]; then
    fail '--upgrade wrote through an AGENTS.md symlink'
  fi

  forgeflow_case_target="$forgeflow_test_dir/upgrade-directory-guide"
  make_prior_adoption "$forgeflow_case_target"
  rm "$forgeflow_case_target/AGENTS.md"
  mkdir "$forgeflow_case_target/AGENTS.md"

  "$forgeflow_repo/scripts/bootstrap" --upgrade "$forgeflow_case_target" \
    >/dev/null 2>&1 ||
    fail '--upgrade refused a repository whose AGENTS.md is a directory'
}

run_case 'AC-002' upgrade_replaces_templates_and_preserves_the_adopter_guide

upgrade_reports_the_adopter_guide_status() {
  forgeflow_case_version=$(cat "$forgeflow_repo/VERSION")

  forgeflow_case_target="$forgeflow_test_dir/upgrade-stale"
  make_prior_adoption "$forgeflow_case_target"
  printf 'version=0.2.1\nrevision=unknown\n' \
    >"$forgeflow_case_target/$forgeflow_marker_relative"

  forgeflow_case_output=$("$forgeflow_repo/scripts/bootstrap" --upgrade \
    "$forgeflow_case_target" 2>&1)

  for forgeflow_case_expected in \
    'AGENTS.md' \
    '0.2.1' \
    "$forgeflow_case_version" \
    'docs/upgrading.md'
  do
    printf '%s\n' "$forgeflow_case_output" |
      grep -Fq -- "$forgeflow_case_expected" ||
      fail "a stale upgrade did not report $forgeflow_case_expected"
  done

  # The marker records the last bootstrap or upgrade, not the provenance of
  # AGENTS.md, which this command never reads.
  if printf '%s\n' "$forgeflow_case_output" |
    grep -Fq -- 'AGENTS.md was installed for'; then
    fail 'the upgrade warning claims a provenance the marker cannot prove'
  fi

  # A marker recorded by a newer checkout is still a difference worth naming,
  # and the wording must not call it an older version.
  forgeflow_case_target="$forgeflow_test_dir/upgrade-newer-marker"
  make_prior_adoption "$forgeflow_case_target"
  printf 'version=99.0.0\nrevision=unknown\n' \
    >"$forgeflow_case_target/$forgeflow_marker_relative"
  forgeflow_case_output=$("$forgeflow_repo/scripts/bootstrap" --upgrade \
    "$forgeflow_case_target" 2>&1)

  for forgeflow_case_expected in '99.0.0' "$forgeflow_case_version"
  do
    printf '%s\n' "$forgeflow_case_output" |
      grep -Fq -- "$forgeflow_case_expected" ||
      fail "an upgrade from a newer marker did not name $forgeflow_case_expected"
  done

  # A marker whose value carries trailing blanks or a carriage return records
  # the same version and must not be reported as a difference.
  forgeflow_case_target="$forgeflow_test_dir/upgrade-padded-marker"
  make_prior_adoption "$forgeflow_case_target"
  printf 'version=%s \r\nrevision=unknown\n' "$forgeflow_case_version" \
    >"$forgeflow_case_target/$forgeflow_marker_relative"
  forgeflow_case_output=$("$forgeflow_repo/scripts/bootstrap" --upgrade \
    "$forgeflow_case_target" 2>&1)

  if printf '%s\n' "$forgeflow_case_output" |
    grep -Fq -- 'docs/upgrading.md'; then
    fail 'trailing blanks in the marker were reported as a version difference'
  fi

  forgeflow_case_target="$forgeflow_test_dir/upgrade-no-marker"
  make_prior_adoption "$forgeflow_case_target"
  forgeflow_case_output=$("$forgeflow_repo/scripts/bootstrap" --upgrade \
    "$forgeflow_case_target" 2>&1)

  printf '%s\n' "$forgeflow_case_output" | grep -Fq -- 'AGENTS.md' ||
    fail 'an upgrade without a marker did not report AGENTS.md as unchanged'
  if printf '%s\n' "$forgeflow_case_output" |
    grep -Fq -- 'docs/upgrading.md'; then
    fail 'an upgrade without a marker warned about a version it cannot know'
  fi

  forgeflow_case_target="$forgeflow_test_dir/upgrade-current"
  make_prior_adoption "$forgeflow_case_target"
  printf 'version=%s\nrevision=unknown\n' "$forgeflow_case_version" \
    >"$forgeflow_case_target/$forgeflow_marker_relative"
  forgeflow_case_output=$("$forgeflow_repo/scripts/bootstrap" --upgrade \
    "$forgeflow_case_target" 2>&1)

  if printf '%s\n' "$forgeflow_case_output" |
    grep -Fq -- 'docs/upgrading.md'; then
    fail 'an upgrade from the current version warned about a stale AGENTS.md'
  fi
}

upgrade_without_a_version_difference_stays_quiet() {
  forgeflow_case_version=$(cat "$forgeflow_repo/VERSION")

  forgeflow_case_target="$forgeflow_test_dir/quiet-no-marker"
  make_prior_adoption "$forgeflow_case_target"
  forgeflow_case_output=$("$forgeflow_repo/scripts/bootstrap" --upgrade \
    "$forgeflow_case_target" 2>&1)

  printf '%s\n' "$forgeflow_case_output" | grep -Fq -- 'AGENTS.md' ||
    fail 'an upgrade without a marker did not report AGENTS.md as unchanged'
  if printf '%s\n' "$forgeflow_case_output" |
    grep -Fq -- 'docs/upgrading.md'; then
    fail 'an upgrade without a marker warned about a version it cannot know'
  fi

  if [ "$(marker_field "$forgeflow_case_target/$forgeflow_marker_relative" version)" != \
    "$forgeflow_case_version" ]; then
    fail 'an upgrade without a marker did not create one'
  fi

  forgeflow_case_target="$forgeflow_test_dir/quiet-current-marker"
  make_prior_adoption "$forgeflow_case_target"
  printf 'version=%s\nrevision=unknown\n' "$forgeflow_case_version" \
    >"$forgeflow_case_target/$forgeflow_marker_relative"
  forgeflow_case_output=$("$forgeflow_repo/scripts/bootstrap" --upgrade \
    "$forgeflow_case_target" 2>&1)

  if printf '%s\n' "$forgeflow_case_output" |
    grep -Fq -- 'docs/upgrading.md'; then
    fail 'an upgrade from the current version warned about a stale AGENTS.md'
  fi
}

run_case 'AC-005' upgrade_reports_the_adopter_guide_status
run_case 'AC-006' upgrade_without_a_version_difference_stays_quiet

upgrade_refuses_a_repository_that_never_adopted() {
  forgeflow_case_target="$forgeflow_test_dir/upgrade-unadopted"
  mkdir -p "$forgeflow_case_target"

  forgeflow_case_output=$("$forgeflow_repo/scripts/bootstrap" --upgrade \
    "$forgeflow_case_target" 2>&1) && fail '--upgrade accepted an unadopted repository'

  printf '%s\n' "$forgeflow_case_output" | grep -Fq -- 'bootstrap' ||
    fail '--upgrade did not point at a fresh bootstrap'

  expect_exit_status 1 "$forgeflow_repo/scripts/bootstrap" --upgrade \
    "$forgeflow_case_target"
  expect_exit_status 1 "$forgeflow_repo/scripts/bootstrap" --upgrade --dry-run \
    "$forgeflow_case_target"

  forgeflow_case_entry_count=$(find "$forgeflow_case_target" ! -path "$forgeflow_case_target" | wc -l | tr -d ' ')
  if [ "$forgeflow_case_entry_count" -ne 0 ]; then
    fail '--upgrade wrote into an unadopted repository'
  fi
}

run_case 'AC-009' upgrade_refuses_a_repository_that_never_adopted

# The listing is read from a file rather than a pipe so that a failing inode or
# checksum fails the case instead of silently dropping a line in a subshell.
tree_manifest() {
  forgeflow_manifest_listing="$forgeflow_test_dir/manifest.listing"

  find "$1" | LC_ALL=C sort >"$forgeflow_manifest_listing"

  while IFS= read -r forgeflow_manifest_path
  do
    if [ -f "$forgeflow_manifest_path" ]; then
      printf '%s %s %s\n' "$forgeflow_manifest_path" \
        "$(inode "$forgeflow_manifest_path")" \
        "$(cksum <"$forgeflow_manifest_path")"
    else
      printf '%s %s dir\n' "$forgeflow_manifest_path" \
        "$(inode "$forgeflow_manifest_path")"
    fi
  done <"$forgeflow_manifest_listing"
}

upgrade_dry_run_previews_without_writing() {
  forgeflow_case_target="$forgeflow_test_dir/upgrade-dry-run"
  make_prior_adoption "$forgeflow_case_target"

  forgeflow_case_before="$forgeflow_test_dir/upgrade-dry-run.before"
  forgeflow_case_after="$forgeflow_test_dir/upgrade-dry-run.after"
  tree_manifest "$forgeflow_case_target" >"$forgeflow_case_before"

  forgeflow_case_canonical=$(cd -P "$forgeflow_case_target" >/dev/null 2>&1 && pwd)

  forgeflow_case_output=$("$forgeflow_repo/scripts/bootstrap" --upgrade \
    --dry-run "$forgeflow_case_target")
  forgeflow_case_reversed=$("$forgeflow_repo/scripts/bootstrap" --dry-run \
    --upgrade "$forgeflow_case_target")

  for forgeflow_case_relative in \
    specs/stories/_template/story.md \
    specs/stories/_template/acceptance.md \
    specs/stories/_template/task.md \
    "$forgeflow_marker_relative"
  do
    printf '%s\n' "$forgeflow_case_output" |
      grep -Fq -- "$forgeflow_case_canonical/$forgeflow_case_relative" ||
      fail "--upgrade --dry-run did not preview $forgeflow_case_relative"
    printf '%s\n' "$forgeflow_case_reversed" |
      grep -Fq -- "$forgeflow_case_canonical/$forgeflow_case_relative" ||
      fail "--dry-run --upgrade did not preview $forgeflow_case_relative"
  done

  if printf '%s\n' "$forgeflow_case_output" | grep -Fq -- '/AGENTS.md'; then
    fail '--upgrade --dry-run previewed a write to AGENTS.md'
  fi

  tree_manifest "$forgeflow_case_target" >"$forgeflow_case_after"
  cmp "$forgeflow_case_before" "$forgeflow_case_after" >/dev/null ||
    fail '--upgrade --dry-run changed the repository'
}

run_case 'AC-003' upgrade_dry_run_previews_without_writing

upgrade_argument_errors_are_usage_errors() {
  forgeflow_case_target="$forgeflow_test_dir/upgrade-args"
  make_prior_adoption "$forgeflow_case_target"

  forgeflow_case_before="$forgeflow_test_dir/upgrade-args.before"
  forgeflow_case_after="$forgeflow_test_dir/upgrade-args.after"
  tree_manifest "$forgeflow_case_target" >"$forgeflow_case_before"

  expect_exit_status 2 "$forgeflow_repo/scripts/bootstrap" --upgrade --force \
    "$forgeflow_case_target"
  expect_exit_status 2 "$forgeflow_repo/scripts/bootstrap" --force --upgrade \
    "$forgeflow_case_target"
  expect_exit_status 2 "$forgeflow_repo/scripts/bootstrap" --upgrade --upgrade \
    "$forgeflow_case_target"
  expect_exit_status 2 "$forgeflow_repo/scripts/bootstrap" \
    "$forgeflow_case_target" --upgrade
  expect_exit_status 2 "$forgeflow_repo/scripts/bootstrap" --upgrade \
    "$forgeflow_case_target" "$forgeflow_case_target"

  tree_manifest "$forgeflow_case_target" >"$forgeflow_case_after"
  cmp "$forgeflow_case_before" "$forgeflow_case_after" >/dev/null ||
    fail 'a usage error changed the repository'
}

assert_refusal_changes_nothing() {
  forgeflow_case_before="$forgeflow_test_dir/$forgeflow_case_label.before"
  forgeflow_case_after="$forgeflow_test_dir/$forgeflow_case_label.after"

  tree_manifest "$forgeflow_case_target" >"$forgeflow_case_before"
  expect_exit_status 1 "$forgeflow_repo/scripts/bootstrap" --upgrade \
    "$forgeflow_case_target"
  tree_manifest "$forgeflow_case_target" >"$forgeflow_case_after"

  cmp "$forgeflow_case_before" "$forgeflow_case_after" >/dev/null ||
    fail "a refused upgrade changed the repository: $forgeflow_case_label"
}

upgrade_refuses_unsafe_managed_paths() {
  forgeflow_case_target="$forgeflow_test_dir/upgrade-template-symlink"
  forgeflow_case_outside="$forgeflow_test_dir/upgrade-outside-templates"

  mkdir -p "$forgeflow_case_target/specs/stories" "$forgeflow_case_outside"
  ln -s "$forgeflow_case_outside" "$forgeflow_case_target/specs/stories/_template"

  expect_exit_status 1 "$forgeflow_repo/scripts/bootstrap" --upgrade \
    "$forgeflow_case_target"

  if [ -e "$forgeflow_case_outside/story.md" ]; then
    fail '--upgrade wrote through a template directory symlink'
  fi

  forgeflow_case_target="$forgeflow_test_dir/upgrade-template-directory"
  make_prior_adoption "$forgeflow_case_target"
  rm "$forgeflow_case_target/specs/stories/_template/story.md"
  mkdir "$forgeflow_case_target/specs/stories/_template/story.md"

  forgeflow_case_label='template-directory'
  assert_refusal_changes_nothing

  if [ ! -d "$forgeflow_case_target/specs/stories/_template/story.md" ]; then
    fail '--upgrade replaced a managed path with the wrong file type'
  fi

  forgeflow_case_target="$forgeflow_test_dir/upgrade-marker-symlink"
  forgeflow_case_outside="$forgeflow_test_dir/upgrade-outside-marker"

  make_prior_adoption "$forgeflow_case_target"
  printf 'outside marker\n' >"$forgeflow_case_outside"
  ln -s "$forgeflow_case_outside" "$forgeflow_case_target/$forgeflow_marker_relative"

  forgeflow_case_label='marker-symlink'
  assert_refusal_changes_nothing

  if [ "$(cat "$forgeflow_case_outside")" != 'outside marker' ]; then
    fail '--upgrade wrote through a marker symlink'
  fi

  forgeflow_case_target="$forgeflow_test_dir/upgrade-marker-directory"
  make_prior_adoption "$forgeflow_case_target"
  mkdir "$forgeflow_case_target/$forgeflow_marker_relative"

  forgeflow_case_label='marker-directory'
  assert_refusal_changes_nothing

  if [ ! -d "$forgeflow_case_target/$forgeflow_marker_relative" ]; then
    fail '--upgrade replaced a marker path with the wrong file type'
  fi
}

run_case 'AC-008' upgrade_argument_errors_are_usage_errors
run_case 'AC-010' upgrade_refuses_unsafe_managed_paths

adopter_documentation_agrees_on_the_upgrade_contract() {
  forgeflow_case_upgrading="$forgeflow_repo/docs/upgrading.md"

  [ -f "$forgeflow_case_upgrading" ] ||
    fail 'docs/upgrading.md is missing'

  for forgeflow_case_expected in \
    '--upgrade' \
    '--dry-run' \
    '--force' \
    'specs/.praxisbound-adoption' \
    'AGENTS.md' \
    '../protocol/versioning.md'
  do
    grep -Fq -- "$forgeflow_case_expected" "$forgeflow_case_upgrading" ||
      fail "docs/upgrading.md does not document $forgeflow_case_expected"
  done

  for forgeflow_case_restated in \
    'Trust Boundary Fields' \
    'Superseded Behavior'
  do
    if grep -Fq -- "$forgeflow_case_restated" "$forgeflow_case_upgrading"; then
      fail "docs/upgrading.md restates migration steps owned by protocol/versioning.md"
    fi
  done

  for forgeflow_case_page in README.md docs/getting-started.md
  do
    grep -Fq -- 'upgrading.md' "$forgeflow_repo/$forgeflow_case_page" ||
      fail "$forgeflow_case_page does not link the upgrade page"
  done

  grep -Fq -- 'specs/.praxisbound-adoption' "$forgeflow_repo/docs/getting-started.md" ||
    fail 'docs/getting-started.md does not name the adoption marker path'
  grep -Fq -- 'specs/.praxisbound-adoption' "$forgeflow_repo/protocol/versioning.md" ||
    fail 'protocol/versioning.md does not classify the adoption marker'
  grep -Fq -- '--upgrade' "$forgeflow_repo/docs/getting-started.md" ||
    fail 'docs/getting-started.md does not name the --upgrade option'
}

run_case 'AC-012' adopter_documentation_agrees_on_the_upgrade_contract

# TST019-AC-009. Both adoption paths are presented as equals: the portable
# shell path needs no language runtime, the package path needs Node, and
# neither is the successor to the other.
adopter_documentation_presents_both_adoption_paths() {
  for forgeflow_case_page in README.md docs/getting-started.md
  do
    forgeflow_case_path="$forgeflow_repo/$forgeflow_case_page"

    for forgeflow_case_expected in \
      'npx @praxisbound/cli init' \
      './scripts/bootstrap' \
      'requires Node' \
      'needs no language runtime' \
      'ordered next steps' \
      'data.nextSteps'
    do
      grep -Fq -- "$forgeflow_case_expected" "$forgeflow_case_path" ||
        fail "$forgeflow_case_page does not document $forgeflow_case_expected"
    done

    # The sentences below span line breaks, and grep is line-oriented, so the
    # text is flattened before matching. The denial is the whole point:
    # asserting that the phrase "repository-owned Makefile" merely appears
    # would pass a page claiming the opposite.
    forgeflow_case_flat=$(tr '\n' ' ' <"$forgeflow_case_path" | tr -s ' ')

    # Scoped to the package section, because a denial elsewhere on the page
    # would otherwise cover for a package section that claims the opposite.
    forgeflow_case_section=$(
      awk '/^### Published package path$/ { inside = 1; next }
           /^#{2,3} / { inside = 0 }
           inside' "$forgeflow_case_path" | tr '\n' ' ' | tr -s ' '
    )
    [ -n "$forgeflow_case_section" ] ||
      fail "$forgeflow_case_page has no published package path section"

    case "$forgeflow_case_section" in
      *'does not write the repository-owned `Makefile`'*) ;;
      *'not write the repository-owned `Makefile`'*) ;;
      *)
        fail "$forgeflow_case_page does not deny writing the Makefile"
        ;;
    esac

    # The unscoped name is not this project's, and it is not published: a
    # reader who guesses it does not get PraxisBound. Saying more than that
    # would be a claim about a package nobody here controls.
    case "$forgeflow_case_flat" in
      *'`praxisbound` name on npm is not controlled by this project'*) ;;
      *)
        fail "$forgeflow_case_page does not disown the unscoped npm name"
        ;;
    esac

    # Neither path replaces the other; the shell path is not being retired.
    case "$forgeflow_case_flat" in
      *deprecat*)
        fail "$forgeflow_case_page contains the word deprecated"
        ;;
    esac
  done

  # The guide no longer assumes the reader has cloned this repository.
  grep -Fq -- 'without a PraxisBound checkout' \
    "$forgeflow_repo/docs/getting-started.md" ||
    fail 'docs/getting-started.md still implies a PraxisBound checkout is required'
}

run_case 'TST019-AC-009' adopter_documentation_presents_both_adoption_paths

prepare_recovery_fault() {
  forgeflow_fault_root="$forgeflow_test_dir/$forgeflow_case_id-$1"
  mkdir -p "$forgeflow_fault_root"
  forgeflow_fault_root=$(cd -P "$forgeflow_fault_root" && pwd)
  forgeflow_fault_target="$forgeflow_fault_root/target"
  forgeflow_fault_bin="$forgeflow_fault_root/bin"
  forgeflow_fault_output="$forgeflow_fault_root/output"
  mkdir -p "$forgeflow_fault_bin" "$forgeflow_fault_target"
  forgeflow_fault_after=0
  forgeflow_fault_rollback=
  forgeflow_fault_invalidate=0
  forgeflow_fault_kind=mv
  forgeflow_fault_relative=specs/stories/_template/acceptance.md
  forgeflow_real_cp=$(command -v cp)
  forgeflow_real_mv=$(command -v mv)
  forgeflow_real_rm=$(command -v rm)
  forgeflow_real_mkdir=$(command -v mkdir)
  cat >"$forgeflow_fault_bin/shim" <<'FORGEFLOW_FAULT'
#!/bin/sh
set -eu
fault_command=${0##*/}
fault_source=
fault_destination=
for fault_arg in "$@"; do
  case "$fault_arg" in
    -*) ;;
    *)
      [ -n "$fault_source" ] || fault_source=$fault_arg
      fault_destination=$fault_arg ;;
  esac
done
case "$fault_command" in
  cp) fault_real=$FF_REAL_CP ;;
  mv) fault_real=$FF_REAL_MV ;;
  rm) fault_real=$FF_REAL_RM ;;
  mkdir) fault_real=$FF_REAL_MKDIR ;;
esac
fault_match=0
if [ ! -f "$FF_FAULT_ROOT/triggered" ]; then
  case "$FF_FAULT_KIND:$fault_command" in
    mv:mv)
      [ "$fault_destination" != "$FF_FAULT_TARGET/$FF_FAULT_RELATIVE" ] || fault_match=1 ;;
    cp:cp)
      case "$FF_FAULT_RELATIVE" in
        guidance/*) fault_expected="$FF_SOURCE/$FF_FAULT_RELATIVE" ;;
        *) fault_expected="$FF_SOURCE/templates/story/$FF_FAULT_RELATIVE" ;;
      esac
      [ "$fault_source" != "$fault_expected" ] || fault_match=1 ;;
    backup:cp)
      case "$fault_destination" in */original) fault_match=1 ;; esac ;;
    mkdir:mkdir)
      if [ "$FF_FAULT_RELATIVE" = stage ]; then
        case "$fault_destination" in
          "$FF_FAULT_TARGET"/.praxisbound-install.*|"$FF_FAULT_TARGET"/*/.praxisbound-install.*) fault_match=1 ;;
        esac
      elif [ "$fault_destination" = "$FF_FAULT_TARGET/$FF_FAULT_RELATIVE" ]; then
        fault_match=1
      fi ;;
  esac
fi
if [ "$fault_match" -eq 1 ]; then
  : >"$FF_FAULT_ROOT/triggered"
  printf 'Injected %s failure: %s\n' "$fault_command" "$fault_destination" >&2
  if [ "$FF_FAULT_AFTER" -eq 1 ]; then "$fault_real" "$@"; fi
  exit 73
fi
if [ -f "$FF_FAULT_ROOT/triggered" ]; then
  case "$fault_command:$fault_source" in
    mv:*/restore)
      if [ "$fault_destination" = "$FF_FAULT_TARGET/$FF_FAULT_ROLLBACK" ]; then
        printf 'Injected rollback failure: %s\n' "$fault_destination" >&2
        exit 74
      fi ;;
    rm:*)
      if [ "$FF_FAULT_INVALIDATE" -eq 1 ] &&
        [ "$fault_destination" = "$FF_FAULT_TARGET/specs/.praxisbound-adoption" ]; then
        printf 'Injected invalidation failure\n' >&2
        exit 75
      fi ;;
  esac
fi
exec "$fault_real" "$@"
FORGEFLOW_FAULT
  for forgeflow_fault_command in cp mv rm mkdir
  do
    cp "$forgeflow_fault_bin/shim" "$forgeflow_fault_bin/$forgeflow_fault_command"
    chmod +x "$forgeflow_fault_bin/$forgeflow_fault_command"
  done
}

run_recovery_fault() {
  if PATH="$forgeflow_fault_bin:$PATH" \
    FF_REAL_CP="$forgeflow_real_cp" FF_REAL_MV="$forgeflow_real_mv" FF_REAL_RM="$forgeflow_real_rm" \
    FF_REAL_MKDIR="$forgeflow_real_mkdir" \
    FF_FAULT_ROOT="$forgeflow_fault_root" FF_FAULT_TARGET="$forgeflow_fault_target" \
    FF_SOURCE="$forgeflow_repo" FF_FAULT_KIND="$forgeflow_fault_kind" \
    FF_FAULT_RELATIVE="$forgeflow_fault_relative" FF_FAULT_AFTER="$forgeflow_fault_after" \
    FF_FAULT_ROLLBACK="$forgeflow_fault_rollback" FF_FAULT_INVALIDATE="$forgeflow_fault_invalidate" \
    "$forgeflow_repo/scripts/bootstrap" "$@" "$forgeflow_fault_target" \
      >"$forgeflow_fault_output" 2>&1; then
    forgeflow_fault_status=0
  else
    forgeflow_fault_status=$?
  fi
}

assert_recovery_failed_safely() {
  [ "$forgeflow_fault_status" -ne 0 ] || fail 'injected failure returned success'
  [ -f "$forgeflow_fault_root/triggered" ] || fail 'fault was not injected'
  if grep -Eq 'ForgeFlow (initialized|templates upgraded)' "$forgeflow_fault_output"; then
    fail 'failure printed installation success'
  fi
}

replacement_failures_restore_every_original() {
  forgeflow_recovery_mismatches=0
  for forgeflow_failure_phase in 0 1
  do
    for forgeflow_failure_path in specs/stories/_template/acceptance.md specs/stories/_template/task.md specs/.praxisbound-adoption
    do
      prepare_recovery_fault "replace-$forgeflow_failure_phase-${forgeflow_failure_path##*/}"
      make_prior_adoption "$forgeflow_fault_target"
      printf 'version=0.2.1\nrevision=unknown\n' >"$forgeflow_fault_target/specs/.praxisbound-adoption"
      cp -R "$forgeflow_fault_target" "$forgeflow_fault_root/before"
      forgeflow_fault_relative=$forgeflow_failure_path
      forgeflow_fault_after=$forgeflow_failure_phase
      run_recovery_fault --upgrade
      assert_recovery_failed_safely
      if ! diff -r "$forgeflow_fault_root/before" "$forgeflow_fault_target" >/dev/null; then
        printf 'Unrestored baseline: phase=%s path=%s\n' "$forgeflow_failure_phase" "$forgeflow_failure_path"
        forgeflow_recovery_mismatches=$((forgeflow_recovery_mismatches + 1))
      fi
    done
  done
  [ "$forgeflow_recovery_mismatches" -eq 0 ] ||
    fail "$forgeflow_recovery_mismatches injected replacement failures left changed files"
}

preparation_failures_leave_originals_unchanged() {
  for forgeflow_failure_copy in acceptance.md task.md backup
  do
    prepare_recovery_fault "copy-$forgeflow_failure_copy"
    make_prior_adoption "$forgeflow_fault_target"
    cp -R "$forgeflow_fault_target" "$forgeflow_fault_root/before"
    forgeflow_fault_kind=cp
    forgeflow_fault_relative=$forgeflow_failure_copy
    forgeflow_fault_after=1
    [ "$forgeflow_failure_copy" != backup ] || forgeflow_fault_kind=backup
    run_recovery_fault --upgrade
    assert_recovery_failed_safely
    diff -r "$forgeflow_fault_root/before" "$forgeflow_fault_target" >/dev/null ||
      fail "preparation failure changed originals: $forgeflow_failure_copy"
  done
  for forgeflow_failure_directory in specs specs/stories specs/stories/_template guidance stage
  do
    prepare_recovery_fault "mkdir-${forgeflow_failure_directory##*/}"
    cp -R "$forgeflow_fault_target" "$forgeflow_fault_root/before"
    forgeflow_fault_kind=mkdir
    forgeflow_fault_relative=$forgeflow_failure_directory
    forgeflow_fault_after=1
    run_recovery_fault
    assert_recovery_failed_safely
    diff -r "$forgeflow_fault_root/before" "$forgeflow_fault_target" >/dev/null ||
      fail "post-mkdir failure left untracked directories: $forgeflow_failure_directory"
  done
  prepare_recovery_fault collision
  if /bin/sh -c '
    mkdir "$1/.praxisbound-install.$$-AGENTS.md"
    printf "unrelated staging\n" >"$1/.praxisbound-install.$$-AGENTS.md/sentinel"
    exec "$2" "$1"
  ' sh "$forgeflow_fault_target" "$forgeflow_repo/scripts/bootstrap" >"$forgeflow_fault_output" 2>&1; then
    fail 'existing staging collision returned success'
  fi
  for forgeflow_collision_file in "$forgeflow_fault_target"/.praxisbound-install.*/sentinel
  do
    [ "$(cat "$forgeflow_collision_file")" = 'unrelated staging' ] || fail 'deleted pre-existing staging'
  done
  [ ! -e "$forgeflow_fault_target/specs" ] || fail 'collision leaked newly created directories'
}

recovery_preserves_existing_and_absent_files() {
  for forgeflow_recovery_mode in fresh force
  do
    prepare_recovery_fault "$forgeflow_recovery_mode"
    if [ "$forgeflow_recovery_mode" = force ]; then
      mkdir -p "$forgeflow_fault_target/specs/stories/_template"
      printf 'original guide\n' >"$forgeflow_fault_target/AGENTS.md"
      printf 'original story\n' >"$forgeflow_fault_target/specs/stories/_template/story.md"
      mkdir "$forgeflow_fault_target/guidance"
      printf 'team guidance\n' >"$forgeflow_fault_target/guidance/ENTRY.md"
    fi
    printf 'unmanaged\n' >"$forgeflow_fault_target/notes.txt"
    cp -R "$forgeflow_fault_target" "$forgeflow_fault_root/before"
    forgeflow_fault_relative=specs/.praxisbound-adoption
    forgeflow_fault_after=1
    if [ "$forgeflow_recovery_mode" = force ]; then run_recovery_fault --force; else run_recovery_fault; fi
    assert_recovery_failed_safely
    diff -r "$forgeflow_fault_root/before" "$forgeflow_fault_target" >/dev/null ||
      fail "$forgeflow_recovery_mode did not restore original presence/content"
  done
}

rollback_failure_retains_recovery_evidence() {
  for forgeflow_restore_path in specs/stories/_template/story.md specs/.praxisbound-adoption
  do
    prepare_recovery_fault "rollback-${forgeflow_restore_path##*/}"
    make_prior_adoption "$forgeflow_fault_target"
    printf 'version=0.2.1\nrevision=unknown\n' >"$forgeflow_fault_target/specs/.praxisbound-adoption"
    forgeflow_fault_relative=specs/.praxisbound-adoption
    forgeflow_fault_after=1
    forgeflow_fault_rollback=$forgeflow_restore_path
    run_recovery_fault --upgrade
    assert_recovery_failed_safely
    for forgeflow_recovery_message in 'UNRESTORED:' "$forgeflow_fault_target/$forgeflow_restore_path" 'Recovery copies retained' 'Restore' '/original'
    do
      grep -Fq "$forgeflow_recovery_message" "$forgeflow_fault_output" ||
        fail "recovery diagnostic missing: $forgeflow_recovery_message"
    done
    [ "$(cat "$forgeflow_fault_target/specs/stories/_template/acceptance.md")" = 'old template' ] ||
      fail 'rollback stopped before restoring siblings'
    if [ "$forgeflow_restore_path" = specs/.praxisbound-adoption ]; then
      [ ! -e "$forgeflow_fault_target/specs/.praxisbound-adoption" ] || fail 'failed marker restore left a new marker'
    fi
    forgeflow_recovery_copies=$(find "$forgeflow_fault_target" -name original -type f)
    [ -n "$forgeflow_recovery_copies" ] || fail 'recovery destroyed original backups'
  done
  prepare_recovery_fault invalidation
  make_prior_adoption "$forgeflow_fault_target"
  printf 'version=0.2.1\nrevision=unknown\n' >"$forgeflow_fault_target/specs/.praxisbound-adoption"
  forgeflow_fault_relative=specs/.praxisbound-adoption
  forgeflow_fault_after=1
  forgeflow_fault_rollback=specs/.praxisbound-adoption
  forgeflow_fault_invalidate=1
  run_recovery_fault --upgrade
  assert_recovery_failed_safely
  grep -Fq 'Do not trust the adoption marker' "$forgeflow_fault_output" ||
    fail 'invalidation failure gave no actionable marker warning'
}

recovery_preserves_normal_and_dry_run_behavior() {
  prepare_recovery_fault dry-run
  run_recovery_fault --dry-run
  [ "$forgeflow_fault_status" -eq 0 ] || fail 'dry-run failed'
  [ ! -e "$forgeflow_fault_root/triggered" ] || fail 'dry-run called a mutating command'
  [ -z "$(find "$forgeflow_fault_target" -mindepth 1)" ] || fail 'dry-run created entries'
  "$forgeflow_repo/scripts/bootstrap" "$forgeflow_fault_target" >/dev/null
  "$forgeflow_repo/scripts/bootstrap" --force "$forgeflow_fault_target" >/dev/null
  "$forgeflow_repo/scripts/bootstrap" --upgrade "$forgeflow_fault_target" >/dev/null
  cmp "$forgeflow_repo/templates/story/story.md" "$forgeflow_fault_target/specs/stories/_template/story.md" ||
    fail 'normal installation failed'
  [ -z "$(find "$forgeflow_fault_target" -name '.praxisbound-install.*')" ] || fail 'success leaked staging'
}

recovery_guarantees_are_documented() {
  for forgeflow_recovery_term in 'single-file' 'cross-file' 'SIGKILL' 'Restore' 'inode' 'readable'
  do
    grep -Fq "$forgeflow_recovery_term" "$forgeflow_repo/docs/upgrading.md" ||
      fail "recovery documentation omits $forgeflow_recovery_term"
  done
}

guidance_is_seeded_explicitly_and_preserved_on_upgrade() {
  forgeflow_guidance_owner_target="$forgeflow_test_dir/guidance ownership"
  forgeflow_case_target=$forgeflow_guidance_owner_target
  mkdir -p "$forgeflow_case_target"
  "$forgeflow_repo/scripts/bootstrap" "$forgeflow_case_target" >/dev/null

  printf 'team decision\n' >"$forgeflow_case_target/guidance/DECISIONS.md"
  "$forgeflow_repo/scripts/bootstrap" --upgrade "$forgeflow_case_target" >/dev/null
  [ "$(cat "$forgeflow_case_target/guidance/DECISIONS.md")" = 'team decision' ] ||
    fail '--upgrade replaced repository-owned guidance'

  rm -rf "$forgeflow_case_target/guidance"
  printf 'outside guidance\n' >"$forgeflow_test_dir/outside-guidance"
  ln -s "$forgeflow_test_dir/outside-guidance" "$forgeflow_case_target/guidance"
  "$forgeflow_repo/scripts/bootstrap" --upgrade "$forgeflow_case_target" >/dev/null ||
    fail '--upgrade inspected repository-owned guidance'
  [ "$(cat "$forgeflow_test_dir/outside-guidance")" = 'outside guidance' ] ||
    fail '--upgrade wrote through repository-owned guidance'

  forgeflow_case_target="$forgeflow_test_dir/upgrade absent"
  make_prior_adoption "$forgeflow_case_target"
  "$forgeflow_repo/scripts/bootstrap" --upgrade "$forgeflow_case_target" >/dev/null
  [ ! -e "$forgeflow_case_target/guidance" ] ||
    fail '--upgrade installed absent repository-owned guidance'

  mkdir "$forgeflow_case_target/guidance"
  printf 'partial team guidance\n' >"$forgeflow_case_target/guidance/DECISIONS.md"
  forgeflow_case_output=$("$forgeflow_repo/scripts/bootstrap" --upgrade --dry-run "$forgeflow_case_target")
  if printf '%s\n' "$forgeflow_case_output" | grep -Fq '/guidance'; then
    fail '--upgrade --dry-run previewed repository-owned guidance'
  fi
  "$forgeflow_repo/scripts/bootstrap" --upgrade "$forgeflow_case_target" >/dev/null
  [ "$(cat "$forgeflow_case_target/guidance/DECISIONS.md")" = 'partial team guidance' ] ||
    fail '--upgrade replaced partial repository-owned guidance'
  [ ! -e "$forgeflow_case_target/guidance/ENTRY.md" ] ||
    fail '--upgrade completed partial repository-owned guidance'

  forgeflow_case_target=$forgeflow_guidance_owner_target
  rm "$forgeflow_case_target/guidance"
  mkdir "$forgeflow_case_target/guidance"
  printf 'custom guidance\n' >"$forgeflow_case_target/guidance/ENTRY.md"
  "$forgeflow_repo/scripts/bootstrap" --force "$forgeflow_case_target" >/dev/null
  cmp "$forgeflow_repo/guidance/ENTRY.md" "$forgeflow_case_target/guidance/ENTRY.md" >/dev/null ||
    fail '--force did not explicitly replace guidance baseline'

  forgeflow_case_target="$forgeflow_test_dir/guidance-leaf-symlink"
  forgeflow_case_outside="$forgeflow_test_dir/outside-guidance-leaf"
  mkdir -p "$forgeflow_case_target/guidance"
  printf 'outside leaf\n' >"$forgeflow_case_outside"
  ln -s "$forgeflow_case_outside" "$forgeflow_case_target/guidance/ENTRY.md"
  expect_exit_status 1 "$forgeflow_repo/scripts/bootstrap" "$forgeflow_case_target"
  expect_exit_status 1 "$forgeflow_repo/scripts/bootstrap" --force "$forgeflow_case_target"
  [ "$(cat "$forgeflow_case_outside")" = 'outside leaf' ] ||
    fail 'bootstrap wrote through a Guidance leaf symlink'

  prepare_recovery_fault guidance-copy
  cp -R "$forgeflow_fault_target" "$forgeflow_fault_root/before"
  forgeflow_fault_kind=cp
  forgeflow_fault_relative=guidance/ENTRY.md
  run_recovery_fault
  assert_recovery_failed_safely
  diff -r "$forgeflow_fault_root/before" "$forgeflow_fault_target" >/dev/null ||
    fail 'Guidance source-copy failure changed a fresh target'

  prepare_recovery_fault guidance-mkdir
  cp -R "$forgeflow_fault_target" "$forgeflow_fault_root/before"
  forgeflow_fault_kind=mkdir
  forgeflow_fault_relative=guidance
  run_recovery_fault
  assert_recovery_failed_safely
  diff -r "$forgeflow_fault_root/before" "$forgeflow_fault_target" >/dev/null ||
    fail 'Guidance directory failure changed a fresh target'
}

fresh_guidance_dry_run_is_non_destructive() {
  forgeflow_case_target="$forgeflow_test_dir/fresh guidance dry run"
  mkdir -p "$forgeflow_case_target"
  forgeflow_case_target_canonical=$(cd -P "$forgeflow_case_target" >/dev/null 2>&1 && pwd)
  forgeflow_case_output=$("$forgeflow_repo/scripts/bootstrap" --dry-run "$forgeflow_case_target")
  for forgeflow_guidance_file in ENTRY.md PRINCIPLES.md DECISIONS.md PRACTICES.md
  do
    printf '%s\n' "$forgeflow_case_output" |
      grep -Fq "Would install $forgeflow_case_target_canonical/guidance/$forgeflow_guidance_file" ||
      fail "fresh dry-run omitted guidance/$forgeflow_guidance_file"
  done
  [ -z "$(find "$forgeflow_case_target" -mindepth 1)" ] ||
    fail 'fresh dry-run wrote Guidance paths'
  "$forgeflow_repo/scripts/bootstrap" "$forgeflow_case_target" >/dev/null
  cmp "$forgeflow_repo/guidance/ENTRY.md" "$forgeflow_case_target/guidance/ENTRY.md" >/dev/null ||
    fail 'fresh bootstrap did not seed Guidance'
}

guidance_dry_run_refuses_unsafe_paths() {
  forgeflow_case_target="$forgeflow_test_dir/guidance dry-run leaf symlink"
  forgeflow_case_outside="$forgeflow_test_dir/outside dry-run guidance"
  mkdir -p "$forgeflow_case_target/guidance"
  printf 'outside leaf\n' >"$forgeflow_case_outside"
  ln -s "$forgeflow_case_outside" "$forgeflow_case_target/guidance/ENTRY.md"
  expect_exit_status 1 "$forgeflow_repo/scripts/bootstrap" --dry-run "$forgeflow_case_target"
  expect_exit_status 1 "$forgeflow_repo/scripts/bootstrap" --force --dry-run "$forgeflow_case_target"
  [ "$(cat "$forgeflow_case_outside")" = 'outside leaf' ] ||
    fail 'dry-run wrote through a Guidance leaf symlink'

  forgeflow_case_target="$forgeflow_test_dir/guidance dry-run directory symlink"
  mkdir -p "$forgeflow_case_target"
  ln -s "$forgeflow_test_dir" "$forgeflow_case_target/guidance"
  expect_exit_status 1 "$forgeflow_repo/scripts/bootstrap" --dry-run "$forgeflow_case_target"
  expect_exit_status 1 "$forgeflow_repo/scripts/bootstrap" --force --dry-run "$forgeflow_case_target"

  forgeflow_case_target="$forgeflow_test_dir/guidance dry-run wrong type"
  mkdir -p "$forgeflow_case_target"
  : >"$forgeflow_case_target/guidance"
  expect_exit_status 1 "$forgeflow_repo/scripts/bootstrap" --dry-run "$forgeflow_case_target"
  expect_exit_status 1 "$forgeflow_repo/scripts/bootstrap" --force --dry-run "$forgeflow_case_target"

  forgeflow_case_target="$forgeflow_test_dir/guidance dry-run leaf wrong type"
  mkdir -p "$forgeflow_case_target/guidance/ENTRY.md"
  expect_exit_status 1 "$forgeflow_repo/scripts/bootstrap" --dry-run "$forgeflow_case_target"
  expect_exit_status 1 "$forgeflow_repo/scripts/bootstrap" --force --dry-run "$forgeflow_case_target"
}

bootstrap_inventory_is_not_the_adoption_contract() {
  forgeflow_case_target="$forgeflow_test_dir/contract-not-manifest"
  mkdir -p "$forgeflow_case_target"
  "$forgeflow_repo/scripts/bootstrap" "$forgeflow_case_target" >/dev/null
  rm -rf "$forgeflow_case_target/guidance" \
    "$forgeflow_case_target/specs/stories/_template"
  rm "$forgeflow_case_target/specs/.praxisbound-adoption"
  printf 'verify:\n\t@:\n' >"$forgeflow_case_target/Makefile"

  forgeflow_case_output=$(
    "$forgeflow_repo/scripts/doctor" "$forgeflow_case_target"
  )
  printf '%s\n' "$forgeflow_case_output" |
    grep -Fq 'Guidance: NOT_PRESENT' ||
    fail 'Doctor treated removed bootstrap Guidance as required adoption inventory'
  printf '%s\n' "$forgeflow_case_output" |
    grep -Fq 'Result: STRUCTURE_OK' ||
    fail 'Doctor treated removed bootstrap artifacts as required adoption inventory'
}

run_case 'FF219-AC-001' replacement_failures_restore_every_original
run_case 'FF219-AC-002' preparation_failures_leave_originals_unchanged
run_case 'FF219-AC-003' recovery_preserves_existing_and_absent_files
run_case 'FF219-AC-004' rollback_failure_retains_recovery_evidence
run_case 'FF219-AC-005' recovery_preserves_normal_and_dry_run_behavior
run_case 'FF219-AC-006' recovery_guarantees_are_documented
run_case 'FF223-AC-012-fresh' fresh_guidance_dry_run_is_non_destructive
run_case 'FF223-AC-012-dry-run-safety' guidance_dry_run_refuses_unsafe_paths
run_case 'P1003-AC-003' bootstrap_inventory_is_not_the_adoption_contract
run_case 'P1003-AC-005' guidance_is_seeded_explicitly_and_preserved_on_upgrade

printf 'bootstrap tests passed\n'
