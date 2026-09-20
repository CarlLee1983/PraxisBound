#!/bin/sh

set -eu

case_id=PB001-AC-001
fail() { printf 'praxisbound identity failed [%s]: %s\n' "$case_id" "$1" >&2; exit 1; }
run_case() { case_id=$1; "$2"; printf 'PASS %s %s\n' "$case_id" "$2"; }

root=$(cd -P "$(dirname "$0")/.." >/dev/null 2>&1 && pwd)
fixture=$(mktemp -d "${TMPDIR:-/tmp}/praxisbound-identity.XXXXXX")
legacy_revision=0123456789abcdef0123456789abcdef01234567-dirty
trap 'rm -rf "$fixture"' EXIT

fresh_marker() {
  mkdir -p "$fixture/fresh"
  "$root/scripts/bootstrap" "$fixture/fresh" >/dev/null
  test -f "$fixture/fresh/specs/.praxisbound-adoption" || fail 'fresh marker missing'
  test ! -e "$fixture/fresh/specs/.forgeflow-adoption" || fail 'legacy marker written'
}

legacy_upgrade() {
  mkdir -p "$fixture/legacy/specs/stories/_template"
  printf 'version=0.9.0\nrevision=%s\n' "$legacy_revision" > "$fixture/legacy/specs/.forgeflow-adoption"
  "$root/scripts/bootstrap" --upgrade "$fixture/legacy" >/dev/null
  grep -Fqx "revision=$legacy_revision" "$fixture/legacy/specs/.praxisbound-adoption" || fail 'legacy revision not preserved'
  test ! -e "$fixture/legacy/specs/.forgeflow-adoption" || fail 'legacy marker retained'
}

dual_refusal() {
  mkdir -p "$fixture/dual/specs/stories/_template"
  printf 'version=0.9.0\nrevision=old\n' > "$fixture/dual/specs/.forgeflow-adoption"
  printf 'version=0.10.0\nrevision=new\n' > "$fixture/dual/specs/.praxisbound-adoption"
  if "$root/scripts/bootstrap" --upgrade "$fixture/dual" >/dev/null 2>&1; then fail 'dual markers accepted'; fi
}

invalid_legacy_markers_refuse() {
  for invalid in duplicate-version duplicate-revision extra-line reordered unsupported invalid-revision symlink; do
    target="$fixture/invalid-$invalid"
    mkdir -p "$target/specs/stories/_template"
    marker="$target/specs/.forgeflow-adoption"
    case "$invalid" in
      duplicate-version) printf 'version=0.9.0\nversion=0.9.0\nrevision=old\n' >"$marker" ;;
      duplicate-revision) printf 'version=0.9.0\nrevision=old\nrevision=new\n' >"$marker" ;;
      extra-line) printf 'version=0.9.0\nrevision=old\nextra=ignored\n' >"$marker" ;;
      reordered) printf 'revision=old\nversion=0.9.0\n' >"$marker" ;;
      unsupported) printf 'version=0.8.0\nrevision=old\n' >"$marker" ;;
      invalid-revision) printf 'version=0.9.0\nrevision=unsafe/value\n' >"$marker" ;;
      symlink)
        printf 'version=0.9.0\nrevision=old\n' >"$fixture/symlink-source"
        ln -s "$fixture/symlink-source" "$marker" ;;
    esac
    if "$root/scripts/bootstrap" --upgrade "$target" >/dev/null 2>&1; then
      fail "invalid legacy marker accepted: $invalid"
    fi
    test ! -e "$target/specs/.praxisbound-adoption" ||
      fail "invalid legacy marker wrote current identity: $invalid"
  done
}

legacy_deletion_failure_recovers() {
  mkdir -p "$fixture/delete-failure/specs/stories/_template" "$fixture/bin"
  printf 'version=0.9.0\nrevision=%s\n' "$legacy_revision" > "$fixture/delete-failure/specs/.forgeflow-adoption"
  printf '%s\n' '#!/bin/sh' 'for argument in "$@"; do' \
    '  case "$argument" in */specs/.forgeflow-adoption) exit 1 ;; esac' \
    'done' 'exec /bin/rm "$@"' > "$fixture/bin/rm"
  chmod 755 "$fixture/bin/rm"
  if PATH="$fixture/bin:/bin:/usr/bin" "$root/scripts/bootstrap" --upgrade \
    "$fixture/delete-failure" >/dev/null 2>&1; then
    fail 'legacy deletion failure succeeded'
  fi
  test -f "$fixture/delete-failure/specs/.forgeflow-adoption" || fail 'legacy marker not restored'
  test ! -e "$fixture/delete-failure/specs/.praxisbound-adoption" || fail 'current marker survived deletion failure'
}

decision_root_and_doctor_identity() {
  identity_root="$fixture/identity-contracts"
  story="$identity_root/project/specs/stories/PB-900-case"
  mkdir -p "$story" "$identity_root/project/specs/decisions" \
    "$identity_root/relative-decisions"
  printf '%s\n' '# Story: PB-900 Identity fixture' '' '## Classification' '' \
    '* Security sensitive: no' '* Baseline conformance: no' '' \
    '## Architecture' '' '* Decision: `ADR-900`' >"$story/story.md"
  printf '%s\n' '# Acceptance Criteria' >"$story/acceptance.md"
  printf '%s\n' '# ADR-900' '' '* Status: accepted' \
    >"$identity_root/relative-decisions/ADR-900.md"
  cp "$identity_root/relative-decisions/ADR-900.md" \
    "$identity_root/project/specs/decisions/ADR-900.md"

  env -u PRAXISBOUND_DECISIONS_ROOT -u FORGEFLOW_DECISIONS_ROOT \
    "$root/scripts/story-check" "$story" >"$identity_root/unset.out"
  PRAXISBOUND_DECISIONS_ROOT= FORGEFLOW_DECISIONS_ROOT= \
    "$root/scripts/story-check" "$story" >"$identity_root/empty.out"
  cmp "$identity_root/unset.out" "$identity_root/empty.out" >/dev/null ||
    fail 'empty PraxisBound decision root changed default behavior'
  grep -Fq 'Result: STORY_CONTRACT_OK' "$identity_root/unset.out" ||
    fail 'unset PraxisBound decision root was not accepted'

  (
    cd "$identity_root"
    PRAXISBOUND_DECISIONS_ROOT=relative-decisions \
      "$root/scripts/story-check" project/specs/stories/PB-900-case
  ) >"$identity_root/relative.out"
  grep -Fq 'Result: STORY_CONTRACT_OK' "$identity_root/relative.out" ||
    fail 'relative PraxisBound decision root was not accepted'

  PRAXISBOUND_DECISIONS_ROOT="$identity_root/relative-decisions" \
    "$root/scripts/story-check" "$story" >"$identity_root/absolute.out"
  grep -Fq 'Result: STORY_CONTRACT_OK' "$identity_root/absolute.out" ||
    fail 'absolute PraxisBound decision root was not accepted'

  if PRAXISBOUND_DECISIONS_ROOT="$identity_root/missing-decisions" \
    "$root/scripts/story-check" "$story" >"$identity_root/invalid.out" 2>&1; then
    fail 'invalid PraxisBound decision root was accepted'
  fi
  grep -Fq 'referenced decision record does not exist' "$identity_root/invalid.out" ||
    fail 'invalid PraxisBound decision root had no missing-decision diagnostic'

  if FORGEFLOW_DECISIONS_ROOT="$identity_root/relative-decisions" \
    "$root/scripts/story-check" "$story" >"$identity_root/legacy.out" 2>&1; then
    fail 'legacy decision root was accepted'
  fi
  grep -Fq 'FORGEFLOW_DECISIONS_ROOT is retired' "$identity_root/legacy.out" ||
    fail 'legacy decision root had no migration diagnostic'

  if PRAXISBOUND_DECISIONS_ROOT="$identity_root/relative-decisions" \
    FORGEFLOW_DECISIONS_ROOT="$identity_root/relative-decisions" \
    "$root/scripts/story-check" "$story" >"$identity_root/conflict.out" 2>&1; then
    fail 'conflicting current and legacy decision roots were accepted'
  fi
  grep -Fq 'FORGEFLOW_DECISIONS_ROOT is retired' "$identity_root/conflict.out" ||
    fail 'conflicting decision roots had no retired-name diagnostic'

  doctor_root="$identity_root/doctor"
  mkdir -p "$doctor_root/specs/stories"
  printf 'agent guide\n' >"$doctor_root/AGENTS.md"
  printf 'verify:\n\t@:\n' >"$doctor_root/Makefile"
  printf 'version=0.9.0\nrevision=%s\n' "$legacy_revision" \
    >"$doctor_root/specs/.forgeflow-adoption"
  "$root/scripts/doctor" "$doctor_root" >"$identity_root/doctor.out"
  grep -Fq 'Legacy ForgeFlow adoption requires migration' \
    "$identity_root/doctor.out" || fail 'Doctor did not classify the legacy marker'
  grep -Fq 'Result: CONTRACT_DRIFT' "$identity_root/doctor.out" ||
    fail 'Doctor did not report migration-required drift'
}

residual_identity_matches_allowlist() {
  allowlist="$root/tests/praxisbound-legacy-identity.allowlist"
  residual="$fixture/residual-identity-paths"
  : >"$residual"
  find "$root" -type f -print | while IFS= read -r candidate; do
    relative=${candidate#"$root"/}
    case "$relative" in
      .git|.git/*|graft/*|node_modules/*|*/node_modules/*|packages/core/dist/*|packages/cli/dist/*|.forgepilot/*) continue ;;
    esac
    if grep -Eiq 'forgeflow' "$candidate" 2>/dev/null; then
      printf '%s\n' "$relative"
    fi
  done | LC_ALL=C sort -u >"$residual"

  while IFS= read -r relative; do
    permitted=0
    while IFS= read -r rule; do
      case "$rule" in ''|'#'*) continue ;; esac
      pattern=${rule%%|*}
      case "$relative" in $pattern) permitted=1; break ;; esac
    done <"$allowlist"
    [ "$permitted" -eq 1 ] || fail "unreviewed legacy identity: $relative"
  done <"$residual"

  while IFS= read -r rule; do
    case "$rule" in ''|'#'*) continue ;; esac
    pattern=${rule%%|*}
    matched=0
    while IFS= read -r relative; do
      case "$relative" in $pattern) matched=1; break ;; esac
    done <"$residual"
    [ "$matched" -eq 1 ] || fail "stale legacy-identity allowlist rule: $pattern"
  done <"$allowlist"

  for required in docs/upgrading.md docs/codex-activation.md; do
    grep -Eiq 'forgeflow' "$root/$required" ||
      fail "migration documentation lost its legacy identity: $required"
  done
  test -f "$root/docs/typescript-tooling/archive/result-envelope-v1-planning-draft.schema.json" ||
    fail 'superseded result-schema evidence is missing'
}

run_case PB001-AC-001 fresh_marker
run_case PB001-AC-002 legacy_upgrade
run_case PB001-AC-003 dual_refusal
run_case PB001-AC-003 invalid_legacy_markers_refuse
run_case PB001-AC-003 legacy_deletion_failure_recovers
run_case PB001-AC-004 decision_root_and_doctor_identity
run_case PB001-AC-005 residual_identity_matches_allowlist
