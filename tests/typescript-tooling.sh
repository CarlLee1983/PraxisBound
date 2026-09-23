#!/bin/sh

set -eu

fail() {
  printf 'TypeScript tooling test failed [%s]: %s\n' "$praxisbound_case_id" "$1" >&2
  exit 1
}

run_case() {
  praxisbound_case_id=$1
  praxisbound_case_function=$2

  "$praxisbound_case_function"
  printf 'PASS %s %s\n' "$praxisbound_case_id" "$praxisbound_case_function"
}

praxisbound_repo=$(CDPATH='' cd -P "$(dirname "$0")/.." >/dev/null 2>&1 && pwd)
praxisbound_cli="$praxisbound_repo/packages/cli/dist/bin.js"
praxisbound_test_dir=$(mktemp -d "${TMPDIR:-/tmp}/praxisbound-tooling.XXXXXX")
praxisbound_registry_pid=''
praxisbound_registry_sequence=0

cleanup() {
  if [ -n "$praxisbound_registry_pid" ]; then
    kill "$praxisbound_registry_pid" 2>/dev/null || :
    wait "$praxisbound_registry_pid" 2>/dev/null || :
  fi
  rm -rf "$praxisbound_test_dir"
}

trap cleanup EXIT
trap 'exit 1' HUP INT TERM

run_cli() {
  if node "$praxisbound_cli" "$@" >"$praxisbound_test_dir/stdout" \
    2>"$praxisbound_test_dir/stderr"; then
    praxisbound_cli_status=0
  else
    praxisbound_cli_status=$?
  fi
}

assert_cli_result() {
  praxisbound_expected_status=$1
  praxisbound_expected_stdout=$2
  praxisbound_expected_stderr=$3
  shift 3

  run_cli "$@"
  [ "$praxisbound_cli_status" -eq "$praxisbound_expected_status" ] ||
    fail "CLI exited $praxisbound_cli_status, expected $praxisbound_expected_status"
  cmp "$praxisbound_expected_stdout" "$praxisbound_test_dir/stdout" >/dev/null ||
    fail 'CLI stdout did not match the documented result'
  cmp "$praxisbound_expected_stderr" "$praxisbound_test_dir/stderr" >/dev/null ||
    fail 'CLI stderr did not match the documented result'
}

built_cli_help_and_version_are_exact() {
  praxisbound_version=$(node -p \
    "require('$praxisbound_repo/packages/cli/package.json').version")
  praxisbound_help="$praxisbound_test_dir/help"
  praxisbound_version_output="$praxisbound_test_dir/version"
  praxisbound_empty="$praxisbound_test_dir/empty"

  : >"$praxisbound_empty"
  printf 'PraxisBound CLI v%s\n\nUsage:\n  praxisbound [command]\n\nCommands:\n  init               Plan or apply PraxisBound initialization\n  codex activate     Preview or apply project-local Codex activation\n  doctor             Inspect the static Repository Contract\n  verify             Run the canonical repository verification target\n  handoff check      Check immutable Handoff evidence\n  release check      Inspect local Git release readiness\n  story check        Check the static Story contract\n  review index       Report the batch review source index\n  review render      Write an offline batch review HTML projection\n  review import      Record an exported Revision Sheet\n  review respond     Record a Revision Response file\n  review confirm     Record an explicit terminal Definition Confirmation\n  review preflight   Evaluate every mechanical batch review check\n  verification check Resolve plans and check recorded results\n  help, --help       Show this help\n  version, --version Print the CLI version\n\nOther migration commands are unavailable.\n' \
    "$praxisbound_version" >"$praxisbound_help"
  printf '%s\n' "$praxisbound_version" >"$praxisbound_version_output"

  assert_cli_result 0 "$praxisbound_help" "$praxisbound_empty"
  assert_cli_result 0 "$praxisbound_help" "$praxisbound_empty" help
  assert_cli_result 0 "$praxisbound_help" "$praxisbound_empty" --help
  assert_cli_result 0 "$praxisbound_version_output" "$praxisbound_empty" version
  assert_cli_result 0 "$praxisbound_version_output" "$praxisbound_empty" --version
}

packed_packages_have_the_bounded_public_contract() {
  praxisbound_pack_dir="$praxisbound_test_dir/pack"
  praxisbound_extract_dir="$praxisbound_test_dir/extract"
  mkdir -p "$praxisbound_pack_dir/core" "$praxisbound_pack_dir/cli" \
    "$praxisbound_extract_dir/core" "$praxisbound_extract_dir/cli"

  npm pack "$praxisbound_repo/packages/core" --json \
    --pack-destination "$praxisbound_pack_dir/core" \
    >"$praxisbound_test_dir/core-pack.json"
  npm pack "$praxisbound_repo/packages/cli" --json \
    --pack-destination "$praxisbound_pack_dir/cli" \
    >"$praxisbound_test_dir/cli-pack.json"

  set -- "$praxisbound_pack_dir/core"/*.tgz
  [ "$#" -eq 1 ] && [ -f "$1" ] || fail 'Core did not produce one tarball'
  praxisbound_core_tarball=$1
  set -- "$praxisbound_pack_dir/cli"/*.tgz
  [ "$#" -eq 1 ] && [ -f "$1" ] || fail 'CLI did not produce one tarball'
  praxisbound_cli_tarball=$1

  tar -xzf "$praxisbound_core_tarball" -C "$praxisbound_extract_dir/core"
  tar -xzf "$praxisbound_cli_tarball" -C "$praxisbound_extract_dir/cli"

  (
    CDPATH='' cd "$praxisbound_extract_dir/core/package"
    find . -type f -print | LC_ALL=C sort
  ) >"$praxisbound_test_dir/core-files"
  printf '%s\n' \
    './LICENSE' \
    './README.md' \
    './dist/activation.d.ts' \
    './dist/activation.js' \
    './dist/adoption-next-steps.d.ts' \
    './dist/adoption-next-steps.js' \
    './dist/declarations.d.ts' \
    './dist/declarations.js' \
    './dist/goal-plan-artifacts.d.ts' \
    './dist/goal-plan-artifacts.js' \
    './dist/handoff.d.ts' \
    './dist/handoff.js' \
    './dist/index.d.ts' \
    './dist/index.js' \
    './dist/init.d.ts' \
    './dist/init.js' \
    './dist/mutation.d.ts' \
    './dist/mutation.js' \
    './dist/protocol.d.ts' \
    './dist/protocol.js' \
    './dist/release.d.ts' \
    './dist/release.js' \
    './dist/repository.d.ts' \
    './dist/repository.js' \
    './dist/result.d.ts' \
    './dist/result.js' \
    './dist/review/annotation-dom.d.ts' \
    './dist/review/annotation-dom.js' \
    './dist/review/annotation-logic.d.ts' \
    './dist/review/annotation-logic.js' \
    './dist/review/annotation-script.d.ts' \
    './dist/review/annotation-script.js' \
    './dist/review/annotation-state.d.ts' \
    './dist/review/annotation-state.js' \
    './dist/review/annotation-ui.d.ts' \
    './dist/review/annotation-ui.js' \
    './dist/review/confirmation.d.ts' \
    './dist/review/confirmation.js' \
    './dist/review/dependency-graph.d.ts' \
    './dist/review/dependency-graph.js' \
    './dist/review/fingerprint.d.ts' \
    './dist/review/fingerprint.js' \
    './dist/review/html.d.ts' \
    './dist/review/html.js' \
    './dist/review/index.d.ts' \
    './dist/review/index.js' \
    './dist/review/manifest.d.ts' \
    './dist/review/manifest.js' \
    './dist/review/markdown-html.d.ts' \
    './dist/review/markdown-html.js' \
    './dist/review/markdown.d.ts' \
    './dist/review/markdown.js' \
    './dist/review/path.d.ts' \
    './dist/review/path.js' \
    './dist/review/preflight-report.d.ts' \
    './dist/review/preflight-report.js' \
    './dist/review/preflight.d.ts' \
    './dist/review/preflight.js' \
    './dist/review/render-confirmation.d.ts' \
    './dist/review/render-confirmation.js' \
    './dist/review/render-evidence.d.ts' \
    './dist/review/render-evidence.js' \
    './dist/review/render-locators.d.ts' \
    './dist/review/render-locators.js' \
    './dist/review/render-source.d.ts' \
    './dist/review/render-source.js' \
    './dist/review/render-spec.d.ts' \
    './dist/review/render-spec.js' \
    './dist/review/render.d.ts' \
    './dist/review/render.js' \
    './dist/review/revision-content.d.ts' \
    './dist/review/revision-content.js' \
    './dist/review/revision-limits.d.ts' \
    './dist/review/revision-limits.js' \
    './dist/review/revision-responses.d.ts' \
    './dist/review/revision-responses.js' \
    './dist/review/revision-sheet.d.ts' \
    './dist/review/revision-sheet.js' \
    './dist/review/revision-targets.d.ts' \
    './dist/review/revision-targets.js' \
    './dist/review/semantic-report.d.ts' \
    './dist/review/semantic-report.js' \
    './dist/review/types.d.ts' \
    './dist/review/types.js' \
    './dist/review/vocabulary.d.ts' \
    './dist/review/vocabulary.js' \
    './dist/story-decision.d.ts' \
    './dist/story-decision.js' \
    './dist/story-governance.d.ts' \
    './dist/story-governance.js' \
    './dist/story-id.d.ts' \
    './dist/story-id.js' \
    './dist/story-literals.d.ts' \
    './dist/story-literals.js' \
    './dist/story-matrix.d.ts' \
    './dist/story-matrix.js' \
    './dist/story-readiness.d.ts' \
    './dist/story-readiness.js' \
    './dist/story-table.d.ts' \
    './dist/story-table.js' \
    './dist/story.d.ts' \
    './dist/story.js' \
    './dist/verification-result.d.ts' \
    './dist/verification-result.js' \
    './dist/verification.d.ts' \
    './dist/verification.js' \
    './dist/version.d.ts' \
    './dist/version.js' \
    './package.json' >"$praxisbound_test_dir/core-files.expected"
  cmp "$praxisbound_test_dir/core-files.expected" \
    "$praxisbound_test_dir/core-files" >/dev/null ||
    fail 'Core tarball contents were not the documented package surface'

  (
    CDPATH='' cd "$praxisbound_extract_dir/cli/package"
    find . -type f -print | LC_ALL=C sort
  ) >"$praxisbound_test_dir/cli-files"
  printf '%s\n' \
    './LICENSE' \
    './README.md' \
    './dist/activation-mutation.d.ts' \
    './dist/activation-mutation.js' \
    './dist/activation-observation.d.ts' \
    './dist/activation-observation.js' \
    './dist/activation-snapshot.d.ts' \
    './dist/activation-snapshot.js' \
    './dist/activation.d.ts' \
    './dist/activation.js' \
    './dist/bin.d.ts' \
    './dist/bin.js' \
    './dist/canonical-verification.d.ts' \
    './dist/canonical-verification.js' \
    './dist/doctor-execution.d.ts' \
    './dist/doctor-execution.js' \
    './dist/doctor.d.ts' \
    './dist/doctor.js' \
    './dist/handoff.d.ts' \
    './dist/handoff.js' \
    './dist/index.d.ts' \
    './dist/index.js' \
    './dist/init-mutation.d.ts' \
    './dist/init-mutation.js' \
    './dist/init-observation.d.ts' \
    './dist/init-observation.js' \
    './dist/init-snapshot.d.ts' \
    './dist/init-snapshot.js' \
    './dist/init.d.ts' \
    './dist/init.js' \
    './dist/machine.d.ts' \
    './dist/machine.js' \
    './dist/packaged-snapshot.d.ts' \
    './dist/packaged-snapshot.js' \
    './dist/release-git.d.ts' \
    './dist/release-git.js' \
    './dist/release.d.ts' \
    './dist/release.js' \
    './dist/review-confirm-interact.d.ts' \
    './dist/review-confirm-interact.js' \
    './dist/review-confirm-load.d.ts' \
    './dist/review-confirm-load.js' \
    './dist/review-confirm-terminal.d.ts' \
    './dist/review-confirm-terminal.js' \
    './dist/review-confirm-write.d.ts' \
    './dist/review-confirm-write.js' \
    './dist/review-confirm.d.ts' \
    './dist/review-confirm.js' \
    './dist/review-confirmation-records.d.ts' \
    './dist/review-confirmation-records.js' \
    './dist/review-evidence.d.ts' \
    './dist/review-evidence.js' \
    './dist/review-git.d.ts' \
    './dist/review-git.js' \
    './dist/review-import.d.ts' \
    './dist/review-import.js' \
    './dist/review-input.d.ts' \
    './dist/review-input.js' \
    './dist/review-paths.d.ts' \
    './dist/review-paths.js' \
    './dist/review-preflight.d.ts' \
    './dist/review-preflight.js' \
    './dist/review-records.d.ts' \
    './dist/review-records.js' \
    './dist/review-respond.d.ts' \
    './dist/review-respond.js' \
    './dist/review-semantic-report.d.ts' \
    './dist/review-semantic-report.js' \
    './dist/review.d.ts' \
    './dist/review.js' \
    './dist/snapshot/AGENTS.md' \
    './dist/snapshot/VERSION' \
    './dist/snapshot/guidance/DECISIONS.md' \
    './dist/snapshot/guidance/ENTRY.md' \
    './dist/snapshot/guidance/PRACTICES.md' \
    './dist/snapshot/guidance/PRINCIPLES.md' \
    './dist/snapshot/provenance.json' \
    './dist/snapshot/skills/praxisbound/SKILL.md' \
    './dist/snapshot/skills/praxisbound/agents-block.md' \
    './dist/snapshot/skills/story-development/SKILL.md' \
    './dist/snapshot/templates/story/acceptance.md' \
    './dist/snapshot/templates/story/story.md' \
    './dist/snapshot/templates/story/task.md' \
    './dist/source.d.ts' \
    './dist/source.js' \
    './dist/story.d.ts' \
    './dist/story.js' \
    './dist/verification.d.ts' \
    './dist/verification.js' \
    './dist/verify.d.ts' \
    './dist/verify.js' \
    './package.json' >"$praxisbound_test_dir/cli-files.expected"
  cmp "$praxisbound_test_dir/cli-files.expected" \
    "$praxisbound_test_dir/cli-files" >/dev/null ||
    fail 'CLI tarball contents were not the documented package surface'

  [ -x "$praxisbound_extract_dir/cli/package/dist/bin.js" ] ||
    fail 'packed CLI executable does not have its executable bit'
  [ "$(sed -n '1p' "$praxisbound_extract_dir/cli/package/dist/bin.js")" = \
    '#!/usr/bin/env node' ] ||
    fail 'packed CLI executable does not have the documented shebang'
  cmp "$praxisbound_repo/LICENSE" \
    "$praxisbound_extract_dir/core/package/LICENSE" >/dev/null ||
    fail 'Core package license does not match the repository license'
  cmp "$praxisbound_repo/LICENSE" \
    "$praxisbound_extract_dir/cli/package/LICENSE" >/dev/null ||
    fail 'CLI package license does not match the repository license'
  cmp "$praxisbound_repo/packages/core/README.md" \
    "$praxisbound_extract_dir/core/package/README.md" >/dev/null ||
    fail 'Core package readme does not match its source'
  cmp "$praxisbound_repo/packages/cli/README.md" \
    "$praxisbound_extract_dir/cli/package/README.md" >/dev/null ||
    fail 'CLI package readme does not match its source'

  node --input-type=module - \
    "$praxisbound_extract_dir/core/package/package.json" \
    "$praxisbound_extract_dir/cli/package/package.json" \
    "$praxisbound_test_dir/core-pack.json" \
    "$praxisbound_test_dir/cli-pack.json" \
    "$praxisbound_core_tarball" "$praxisbound_cli_tarball" <<'NODE'
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const [corePath, cliPath, corePackPath, cliPackPath, coreTarball, cliTarball] =
  process.argv.slice(2);
const readManifest = (path) => JSON.parse(readFileSync(path, "utf8"));
const core = readManifest(corePath);
const cli = readManifest(cliPath);

const packageRoot = {
  types: "./dist/index.d.ts",
  import: "./dist/index.js",
};

assert.equal(core.name, "@praxisbound/core");
assert.equal(cli.name, "@praxisbound/cli");
assert.deepEqual(core.exports, { ".": packageRoot });
assert.deepEqual(cli.exports, { ".": packageRoot });
assert.equal(core.dependencies, undefined);
assert.equal(core.optionalDependencies, undefined);
assert.equal(core.peerDependencies, undefined);
assert.deepEqual(cli.dependencies, { "@praxisbound/core": core.version });
assert.equal(cli.optionalDependencies, undefined);
assert.equal(cli.peerDependencies, undefined);
assert.deepEqual(cli.bin, { praxisbound: "./dist/bin.js" });
assert.equal(cli.version, core.version);
assert.equal(core.engines.node, "^22.13.0 || ^24.0.0 || ^26.0.0");
assert.deepEqual(cli.engines, core.engines);
assert.deepEqual(core.files, ["dist", "README.md", "LICENSE"]);
assert.deepEqual(cli.files, core.files);
assert.deepEqual(core.repository, {
  type: "git",
  url: "git+https://github.com/CarlLee1983/PraxisBound.git",
  directory: "packages/core",
});
assert.deepEqual(cli.repository, {
  ...core.repository,
  directory: "packages/cli",
});
assert.deepEqual(core.publishConfig, { access: "public", provenance: true });
assert.deepEqual(cli.publishConfig, core.publishConfig);
for (const manifest of [core, cli]) {
  for (const lifecycle of ["preinstall", "install", "postinstall", "prepare"]) {
    assert.equal(manifest.scripts?.[lifecycle], undefined);
  }
  for (const target of Object.values(manifest.exports["."])) {
    assert.equal(existsSync(resolve(dirname(manifest === core ? corePath : cliPath), target)), true);
  }
}

for (const [packPath, tarballPath] of [
  [corePackPath, coreTarball],
  [cliPackPath, cliTarball],
]) {
  const [packed] = JSON.parse(readFileSync(packPath, "utf8"));
  const tarball = readFileSync(tarballPath);
  assert.equal(
    packed.integrity,
    `sha512-${createHash("sha512").update(tarball).digest("base64")}`,
  );
  assert.equal(packed.shasum, createHash("sha1").update(tarball).digest("hex"));
  assert.equal(packed.files.some(({ path }) => path === "package.json"), true);
}

const snapshotRoot = resolve(dirname(cliPath), "dist/snapshot");
const provenance = readManifest(join(snapshotRoot, "provenance.json"));
assert.equal(
  readFileSync(join(snapshotRoot, "VERSION"), "utf8").trim(),
  provenance.protocolVersion,
);
assert.equal(provenance.provenance, "@praxisbound/cli bundled Protocol snapshot");
assert.equal(provenance.revision, "unknown");
for (const payload of provenance.payloads) {
  assert.equal(
    createHash("sha256")
      .update(readFileSync(join(snapshotRoot, payload.destination)))
      .digest("hex"),
    payload.sha256,
  );
}
assert.equal(
  createHash("sha256")
    .update(JSON.stringify(provenance.payloads))
    .digest("hex"),
  provenance.snapshotDigest,
);
NODE

  praxisbound_consumer_dir="$praxisbound_test_dir/consumer"
  praxisbound_npm_home="$praxisbound_test_dir/npm-home"
  praxisbound_npm_cache="$praxisbound_test_dir/npm-cache"
  praxisbound_npm_userconfig="$praxisbound_test_dir/npmrc"
  mkdir -p "$praxisbound_consumer_dir" "$praxisbound_npm_home" \
    "$praxisbound_npm_cache"
  : >"$praxisbound_npm_userconfig"
  node --input-type=module - \
    "$praxisbound_consumer_dir/package.json" \
    "$praxisbound_core_tarball" "$praxisbound_cli_tarball" <<'NODE'
import { writeFileSync } from "node:fs";

const [manifestPath, coreTarball, cliTarball] = process.argv.slice(2);
const manifest = {
  name: "praxisbound-tooling-consumer",
  version: "1.0.0",
  private: true,
  type: "module",
  dependencies: {
    "@praxisbound/core": `file:${coreTarball}`,
    "@praxisbound/cli": `file:${cliTarball}`,
  },
};

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
NODE
  (
    CDPATH='' cd "$praxisbound_consumer_dir"
    env -i PATH="$PATH" HOME="$praxisbound_npm_home" \
      npm_config_cache="$praxisbound_npm_cache" \
      npm_config_userconfig="$praxisbound_npm_userconfig" \
      npm_config_offline=true npm_config_audit=false npm_config_fund=false \
      npm install --ignore-scripts >/dev/null
    node --input-type=module <<'NODE'
await import("@praxisbound/core");
await import("@praxisbound/cli");
NODE
    praxisbound_installed_version=$(./node_modules/.bin/praxisbound --version)
    [ "$praxisbound_installed_version" = '0.3.0' ] ||
      fail 'installed CLI bin did not report the packed version'
  )
}

packed_machine_contract_is_consumable() {
  [ -d "$praxisbound_consumer_dir/node_modules" ] ||
    fail 'packed-package consumer fixture is unavailable'

  (
    CDPATH='' cd "$praxisbound_consumer_dir"
    node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import {
  evaluateHandoff,
  getToolingCapabilities,
  validateResultEnvelope,
} from "@praxisbound/core";
import { serializeResultEnvelope } from "@praxisbound/cli";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const envelope = {
  schemaVersion: "1.0.0",
  protocolVersion: "0.10.0",
  status: "pass",
  outcome: "success",
  exit: 0,
  subject: "repository",
  issues: [],
};

assert.equal(validateResultEnvelope(envelope).ok, true);
assert.equal(getToolingCapabilities().implementedProtocolVersion, "0.10.0");
assert.equal(
  serializeResultEnvelope(envelope),
  '{"schemaVersion":"1.0.0","protocolVersion":"0.10.0","status":"pass","outcome":"success","exit":0,"subject":"repository","issues":[]}\n',
);
const handoffSource = `# PraxisBound Handoff Evidence

\`\`\`yaml
handoff:
  story: TST-004
  recorded_at: 2026-09-12T02:30:00Z
  repository: example/repository
  revision: 0123456789abcdef0123456789abcdef01234567

verification:
  command: make verify
  result: pass
\`\`\`
`;
assert.equal(evaluateHandoff(handoffSource).result.exit, 0);

const handoffPath = join(process.cwd(), "handoff.md");
const incompletePath = join(process.cwd(), "handoff-incomplete.md");
const cli = join(process.cwd(), "node_modules", ".bin", "praxisbound");
writeFileSync(join(process.cwd(), "AGENTS.md"), "agent guide\n");
writeFileSync(join(process.cwd(), "Makefile"), "verify:\n\t@:\n");
writeFileSync(handoffPath, handoffSource);
writeFileSync(incompletePath, handoffSource.replace("  story: TST-004\n", ""));

for (const [path, expectedExit, expectedStatus] of [
  [handoffPath, 0, "pass"],
  [incompletePath, 1, "fail"],
  [join(process.cwd(), "absent.md"), 2, "error"],
]) {
  const command = spawnSync(cli, ["handoff", "check", "--json", path], {
    encoding: "utf8",
  });
  assert.equal(command.status, expectedExit);
  assert.equal(command.stderr, "");
  const machine = JSON.parse(command.stdout);
  assert.equal(validateResultEnvelope(machine).ok, true);
  assert.equal(machine.status, expectedStatus);
  assert.equal(machine.exit, expectedExit);
}

const human = spawnSync(cli, ["handoff", "check", handoffPath], {
  encoding: "utf8",
});
assert.equal(human.status, 0);
assert.equal(human.stderr, "");
assert.match(human.stdout, /Result: HANDOFF_CONTRACT_OK/);

const initTarget = join(process.cwd(), "init-preview-target");
mkdirSync(initTarget);
const initPreview = spawnSync(cli, ["init", "--dry-run", "--json", initTarget], {
  encoding: "utf8",
});
assert.equal(initPreview.status, 0);
assert.equal(initPreview.stderr, "");
const initMachine = JSON.parse(initPreview.stdout);
assert.equal(validateResultEnvelope(initMachine).ok, true);
assert.equal(initMachine.status, "pass");
assert.equal(initMachine.outcome, "INIT_PREVIEW");
assert.deepEqual(readdirSync(initTarget), []);
assert.equal(initMachine.data.provenance, "@praxisbound/cli bundled Protocol snapshot");
assert.equal(
  initMachine.data.changes.map((change) => change.path).join(","),
  "AGENTS.md,specs/stories/_template/story.md,specs/stories/_template/acceptance.md,specs/stories/_template/task.md,guidance/ENTRY.md,guidance/PRINCIPLES.md,guidance/DECISIONS.md,guidance/PRACTICES.md,specs/.praxisbound-adoption",
);

const storyDirectory = join(process.cwd(), "specs", "stories", "TST-005-packed");
mkdirSync(storyDirectory, { recursive: true });
writeFileSync(
  join(storyDirectory, "story.md"),
  "# Story: TST-005 Packed\n\n## Classification\n\n* Task mode: evidence\n",
);
writeFileSync(
  join(storyDirectory, "acceptance.md"),
  "# Acceptance Criteria\n\n* [ ] AC-001: Packed fixture.\n",
);

for (const args of [
  ["verify", "--json"],
  ["doctor", "--run-verify", "--json"],
]) {
  const command = spawnSync(cli, args, { encoding: "utf8" });
  assert.equal(command.status, 0);
  assert.equal(command.stdout.trimEnd().split("\n").length, 1);
  const envelope = JSON.parse(command.stdout);
  assert.equal(validateResultEnvelope(envelope).ok, true);
  assert.equal(envelope.status, "pass");
}

const plan = spawnSync(cli, ["verification", "check"], { encoding: "utf8" });
assert.equal(plan.status, 0);
assert.equal(plan.stderr, "");
assert.match(plan.stdout, /Result: VERIFICATION_PLAN_OK/);
assert.match(plan.stdout, /^ {2}Authority: plan=yes modify=no /m);

writeFileSync(
  join(storyDirectory, "verification.md"),
  [
    "# Verification Result: TST-005",
    "",
    "## Checks",
    "",
    "* lint: pass \u2014 `pnpm run lint`",
    "* static: pass \u2014 `pnpm run typecheck`",
    "* unit: pass \u2014 `pnpm test`",
    "",
    "## Evidence",
    "",
    "* `AC-001`: pass \u2014 `the packed fixture proved the happy path`",
    "",
  ].join("\n"),
);

const recorded = spawnSync(cli, ["verification", "check", "--result"], {
  encoding: "utf8",
});
assert.equal(recorded.status, 0);
assert.equal(recorded.stderr, "");
assert.match(recorded.stdout, /^ {2}Checks: lint=pass static=pass unit=pass$/m);
assert.match(recorded.stdout, /^ {2}Status: PASS$/m);
assert.match(recorded.stdout, /Result: VERIFICATION_PASS/);

for (const [args, expectedExit, expectedStatus] of [
  [["verification", "check", "--json"], 0, "pass"],
  [["verification", "check", "--json", "specs/stories/absent"], 2, "error"],
  [["verification", "check", "--result", "--json"], 0, "pass"],
]) {
  const command = spawnSync(cli, args, { encoding: "utf8" });
  assert.equal(command.status, expectedExit);
  assert.equal(command.stderr, "");
  const envelope = JSON.parse(command.stdout);
  assert.equal(validateResultEnvelope(envelope).ok, true);
  assert.equal(envelope.status, expectedStatus);
  assert.equal(envelope.subject, "verification");
}
await assert.rejects(import("@praxisbound/core/result"), {
  code: "ERR_PACKAGE_PATH_NOT_EXPORTED",
});
await assert.rejects(import("@praxisbound/cli/machine"), {
  code: "ERR_PACKAGE_PATH_NOT_EXPORTED",
});
NODE
  )
  : >"$praxisbound_test_dir/packed-machine-passed"
}

packed_process_consumer_contract() {
  [ -x "$praxisbound_consumer_dir/node_modules/.bin/praxisbound" ] ||
    fail 'packed-package consumer fixture is unavailable'
  node "$praxisbound_repo/tests/process-consumer-contract.mjs" \
    all-commands \
    "$praxisbound_consumer_dir/node_modules/.bin/praxisbound" \
    "$praxisbound_test_dir/process-consumer-commands" \
    "$praxisbound_repo/docs/typescript-tooling/result-envelope-v1.schema.json" ||
    fail 'packed process consumer could not handle every command'
}

process_consumer_fail_closed() {
  [ -x "$praxisbound_consumer_dir/node_modules/.bin/praxisbound" ] ||
    fail 'packed-package consumer fixture is unavailable'
  node "$praxisbound_repo/tests/process-consumer-contract.mjs" \
    failure-cases \
    "$praxisbound_consumer_dir/node_modules/.bin/praxisbound" \
    "$praxisbound_test_dir/process-consumer-failures" \
    "$praxisbound_repo/docs/typescript-tooling/result-envelope-v1.schema.json" ||
    fail 'process consumer accepted an incompatible or malformed result'
}

packed_init_apply_is_consumable() {
  [ -d "$praxisbound_consumer_dir/node_modules" ] ||
    fail 'packed-package consumer fixture is unavailable'

  (
    CDPATH='' cd "$praxisbound_consumer_dir"
    node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validateResultEnvelope } from "@praxisbound/core";

const cli = join(process.cwd(), "node_modules", ".bin", "praxisbound");
function apply(target, args = []) {
  const execution = spawnSync(cli, ["init", ...args, "--json", target], {
    encoding: "utf8",
  });
  assert.equal(execution.status, 0, execution.stderr);
  assert.equal(execution.stderr, "");
  const result = JSON.parse(execution.stdout);
  assert.equal(validateResultEnvelope(result).ok, true);
  assert.equal(result.outcome, "INIT_APPLIED");
  assert.equal(result.data.attempted.at(-1), "specs/.praxisbound-adoption");
  assert.equal(
    readdirSync(target, { recursive: true }).some((path) =>
      String(path).includes(".praxisbound-install."),
    ),
    false,
  );
}

for (const mode of ["safe", "force", "upgrade"]) {
  const target = join(process.cwd(), `init-apply-${mode}`);
  mkdirSync(target);
  if (mode !== "safe") apply(target);
  if (mode === "upgrade") {
    writeFileSync(join(target, "AGENTS.md"), "repository guide\n");
    writeFileSync(join(target, "guidance/ENTRY.md"), "repository guidance\n");
  }
  apply(target, mode === "safe" ? [] : [`--${mode}`]);
  assert.equal(
    readFileSync(join(target, "specs/.praxisbound-adoption"), "utf8"),
    "version=0.10.0\nrevision=unknown\n",
  );
  if (mode === "upgrade") {
    assert.equal(readFileSync(join(target, "AGENTS.md"), "utf8"), "repository guide\n");
    assert.equal(
      readFileSync(join(target, "guidance/ENTRY.md"), "utf8"),
      "repository guidance\n",
    );
  }
}
NODE
  )
  : >"$praxisbound_test_dir/packed-init-passed"
}

# TST019-AC-007. The sufficiency proof: a consumer that executes the emitted
# steps literally reaches an Adoption. This does not test an agent and must
# never depend on a language model — the claim "an agent can reach Adoption"
# is untestable and belongs in a Human Review observation. What is tested is
# whether the instructions are sufficient: if a step is absent, misordered or
# insufficient, this case fails.
emitted_next_steps_are_sufficient_for_adoption() {
  [ -d "$praxisbound_consumer_dir/node_modules" ] ||
    fail 'packed-package consumer fixture is unavailable'

  (
    CDPATH='' cd "$praxisbound_consumer_dir"
    node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validateResultEnvelope } from "@praxisbound/core";

const cli = join(process.cwd(), "node_modules", ".bin", "praxisbound");
const target = join(process.cwd(), "next-steps-adoption");
mkdirSync(target);

function doctor() {
  const execution = spawnSync(cli, ["doctor", "--json", target], {
    encoding: "utf8",
  });
  assert.ok(
    execution.stdout.length > 0,
    `doctor produced no result: ${execution.stderr}`,
  );
  const report = JSON.parse(execution.stdout);
  assert.equal(validateResultEnvelope(report).ok, true);
  return report;
}

const applied = spawnSync(cli, ["init", "--json", target], {
  encoding: "utf8",
});
assert.equal(applied.status, 0, applied.stderr);
const result = JSON.parse(applied.stdout);
assert.equal(validateResultEnvelope(result).ok, true);
assert.equal(result.outcome, "INIT_APPLIED");

// The fixture holds no verification gate, so the Adoption is incomplete until
// the emitted steps are followed. Without this, a vacuously passing doctor
// would make the rest of the case prove nothing.
assert.equal(doctor().outcome, "failure");

// Every action is dispatched by the step identifier the command emitted, never
// by this consumer's own knowledge of what adoption requires. A renamed or
// dropped step therefore fails here instead of silently working anyway, and a
// misordered one runs the confirmation before the gate exists.
const performed = [];
const actions = {
  "verification-gate"() {
    // The step states a required outcome rather than a file body, so the gate
    // is this consumer's own: any Makefile whose verify target runs its checks
    // and exits 0 satisfies it.
    writeFileSync(
      join(target, "Makefile"),
      "verify:\n\t@echo consumer checks passed\n",
    );
    // Execute the outcome the step describes. Doctor inspects statically and
    // never runs make, so without this a Makefile with no verify rule, or one
    // that exits nonzero, would still reach the confirmation step.
    const gate = spawnSync("make", ["verify"], { cwd: target, encoding: "utf8" });
    assert.equal(gate.status, 0, `make verify did not pass: ${gate.stderr}`);
  },
  "confirm-adoption"() {
    const report = doctor();
    // A PASSing Adoption: doctor reports the repository contract complete,
    // with no drift and a zero exit.
    assert.equal(
      report.outcome,
      "success",
      "the emitted next steps were not sufficient to reach a PASSing Adoption",
    );
    assert.equal(report.status, "pass");
    assert.equal(report.exit, 0);
  },
};

const steps = result.data.nextSteps;
assert.ok(Array.isArray(steps) && steps.length > 0, "adoption emitted no steps");
for (const step of steps) {
  assert.ok(
    Object.hasOwn(actions, step.id),
    `no consumer action for step ${step.id}`,
  );
  actions[step.id]();
  performed.push(step.id);
}
assert.deepEqual(
  performed,
  Object.keys(actions),
  "an expected next step was never emitted",
);
NODE
  )
  : >"$praxisbound_test_dir/next-steps-sufficient"
}

packed_activation_is_consumable() {
  [ -d "$praxisbound_consumer_dir/node_modules" ] ||
    fail 'packed-package consumer fixture is unavailable'

  (
    CDPATH='' cd "$praxisbound_consumer_dir"
    node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { posixCksum, validateResultEnvelope } from "@praxisbound/core";

const cli = join(process.cwd(), "node_modules", ".bin", "praxisbound");
const target = join(process.cwd(), "activation-target");
mkdirSync(join(target, "specs", "stories"), { recursive: true });
const originalAgents = Buffer.from("custom policy\r\nno final newline");
writeFileSync(join(target, "AGENTS.md"), originalAgents);
writeFileSync(
  join(target, "specs", ".praxisbound-adoption"),
  "version=0.10.0\nrevision=unknown\n",
);

function run(args) {
  const execution = spawnSync(
    cli,
    ["codex", "activate", ...args, "--json", target],
    { encoding: "utf8" },
  );
  assert.equal(execution.status, 0, execution.stderr);
  assert.equal(execution.stderr, "");
  const result = JSON.parse(execution.stdout);
  assert.equal(validateResultEnvelope(result).ok, true);
  return result;
}

const preview = run([]);
assert.equal(preview.outcome, "ACTIVATION_PREVIEW");
assert.equal(readFileSync(join(target, "AGENTS.md")).equals(originalAgents), true);
const applied = run(["--apply"]);
assert.equal(applied.outcome, "ACTIVATION_APPLIED");
assert.equal(
  applied.data.attempted.at(-1),
  ".agents/skills/praxisbound/.praxisbound-snapshot",
);
const unchanged = run(["--apply"]);
assert.equal(unchanged.outcome, "ACTIVATION_UNCHANGED");

const packageSnapshot = join(
  process.cwd(),
  "node_modules",
  "@praxisbound",
  "cli",
  "dist",
  "snapshot",
);
const skill = Buffer.from(
  readFileSync(join(packageSnapshot, "skills/praxisbound/SKILL.md"), "utf8").replaceAll(
    "../story-development/SKILL.md",
    "story-development.md",
  ),
);
const workflow = readFileSync(
  join(packageSnapshot, "skills/story-development/SKILL.md"),
);
const agentBlock = readFileSync(
  join(packageSnapshot, "skills/praxisbound/agents-block.md"),
);
const block = Buffer.concat([
  Buffer.from(
    "<!-- PraxisBound Codex: begin -->\n<!-- snapshot version=0.10.0 revision=unknown adoption=0.10.0 -->\n",
  ),
  agentBlock,
  Buffer.from("<!-- PraxisBound Codex: end -->\n"),
]);
assert.equal(
  readFileSync(join(target, "AGENTS.md")).equals(
    Buffer.concat([block, originalAgents]),
  ),
  true,
);
assert.equal(
  readFileSync(join(target, ".agents/skills/praxisbound/SKILL.md")).equals(skill),
  true,
);
assert.equal(
  readFileSync(join(target, ".agents/skills/praxisbound/story-development.md")).equals(
    workflow,
  ),
  true,
);
assert.equal(
  readFileSync(
    join(target, ".agents/skills/praxisbound/.praxisbound-snapshot"),
    "utf8",
  ),
  `format=1\nversion=0.10.0\nrevision=unknown\nadoption=0.10.0\nskill=${posixCksum(skill)}\nworkflow=${posixCksum(workflow)}\nblock=${posixCksum(block)}\n`,
);
NODE
  )
}

historical_packed_package_contract_is_preserved() {
  [ -f "$praxisbound_core_tarball" ] && [ -f "$praxisbound_cli_tarball" ] ||
    fail 'npm package validation did not preserve both historical tarballs'
  [ -d "$praxisbound_consumer_dir/node_modules/@praxisbound/core" ] &&
    [ -d "$praxisbound_consumer_dir/node_modules/@praxisbound/cli" ] ||
    fail 'npm package validation did not preserve the historical consumer contract'
}

clean_npm_consumer_runs_required_commands() {
  [ -f "$praxisbound_test_dir/packed-machine-passed" ] ||
    fail 'clean npm consumer machine checks did not complete'
  [ -f "$praxisbound_test_dir/packed-init-passed" ] ||
    fail 'clean npm consumer init checks did not complete'
  [ -f "$praxisbound_test_dir/next-steps-sufficient" ] ||
    fail 'clean npm consumer adoption next-step checks did not complete'
  [ -f "$praxisbound_consumer_dir/package-lock.json" ] ||
    fail 'clean consumer has no npm package lock'
  [ ! -e "$praxisbound_consumer_dir/pnpm-lock.yaml" ] &&
    [ ! -e "$praxisbound_consumer_dir/pnpm-workspace.yaml" ] ||
    fail 'clean npm consumer depends on pnpm state'

  (
    CDPATH='' cd "$praxisbound_consumer_dir"
    ./node_modules/.bin/praxisbound --help >"$praxisbound_test_dir/consumer-help"
  )
  grep -Fq 'Usage:' "$praxisbound_test_dir/consumer-help" ||
    fail 'clean npm consumer help did not render'
  grep -Fq '  init               Plan or apply PraxisBound initialization' \
    "$praxisbound_test_dir/consumer-help" ||
    fail 'clean npm consumer help omitted init'
}

start_npm_registry_fixture() {
  praxisbound_registry_mode=$1
  praxisbound_registry_sequence=$((praxisbound_registry_sequence + 1))
  praxisbound_registry_state="$praxisbound_test_dir/registry-$praxisbound_registry_sequence.state"
  praxisbound_registry_log="$praxisbound_test_dir/registry-$praxisbound_registry_sequence.log"
  praxisbound_registry_stdout="$praxisbound_test_dir/registry-$praxisbound_registry_sequence.stdout"
  praxisbound_registry_stderr="$praxisbound_test_dir/registry-$praxisbound_registry_sequence.stderr"
  : >"$praxisbound_registry_log"

  node "$praxisbound_repo/tests/npm-registry-fixture.mjs" \
    "$praxisbound_registry_state" "$praxisbound_registry_log" \
    "$praxisbound_core_tarball" "$praxisbound_cli_tarball" \
    "$praxisbound_extract_dir/core/package/package.json" \
    "$praxisbound_extract_dir/cli/package/package.json" \
    "$praxisbound_registry_mode" \
    >"$praxisbound_registry_stdout" 2>"$praxisbound_registry_stderr" &
  praxisbound_registry_pid=$!

  praxisbound_registry_wait=0
  while [ ! -s "$praxisbound_registry_state" ]; do
    kill -0 "$praxisbound_registry_pid" 2>/dev/null ||
      fail 'npm registry fixture exited before becoming ready'
    praxisbound_registry_wait=$((praxisbound_registry_wait + 1))
    [ "$praxisbound_registry_wait" -lt 10 ] ||
      fail 'npm registry fixture did not become ready'
    sleep 1
  done
  praxisbound_registry=$(node -e \
    'console.log(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).registry)' \
    "$praxisbound_registry_state")
}

stop_npm_registry_fixture() {
  kill "$praxisbound_registry_pid" 2>/dev/null || :
  wait "$praxisbound_registry_pid" 2>/dev/null || :
  praxisbound_registry_pid=''
}

coordinate_is_pinned_cli() {
  praxisbound_coordinate=$1
  praxisbound_tooling_version=$2
  [ "$praxisbound_coordinate" = "@praxisbound/cli@$praxisbound_tooling_version" ]
}

run_isolated_npx() {
  praxisbound_npx_registry=$1
  praxisbound_npx_cache=$2
  praxisbound_npx_coordinate=$3
  praxisbound_npx_stdout=$4
  praxisbound_npx_stderr=$5
  praxisbound_npx_home="$praxisbound_npx_cache/home"
  praxisbound_npx_userconfig="$praxisbound_npx_cache/npmrc"
  mkdir -p "$praxisbound_npx_home" "$praxisbound_npx_cache/cache"
  : >"$praxisbound_npx_userconfig"

  env -i PATH="$PATH" HOME="$praxisbound_npx_home" \
    npm_config_cache="$praxisbound_npx_cache/cache" \
    npm_config_userconfig="$praxisbound_npx_userconfig" \
    npm_config_registry="$praxisbound_npx_registry" \
    npm_config_audit=false npm_config_fund=false \
    npm_config_fetch_retries=0 npm_config_fetch_retry_mintimeout=1 \
    npm_config_fetch_retry_maxtimeout=1 \
    npm_config_update_notifier=false \
    npx --yes "$praxisbound_npx_coordinate" --version \
    >"$praxisbound_npx_stdout" 2>"$praxisbound_npx_stderr"
}

registry_received_no_authorization() {
  if grep -Fq '"authorization":true' "$praxisbound_registry_log"; then
    fail 'isolated npm acquisition sent an authorization header'
  fi
}

sensitive_acquisition_payloads_are_absent() {
  for praxisbound_sensitive_payload in \
    'ambient-node-auth-secret' 'ambient-npm-secret' \
    'ambient-secret' 'https://hostile.invalid/' \
    'http://hostile.invalid/'
  do
    if grep -F "$praxisbound_sensitive_payload" \
      "$praxisbound_registry_log" \
      "$praxisbound_test_dir/npx-good.stdout" \
      "$praxisbound_test_dir/npx-good.stderr" >/dev/null; then
      fail 'isolated npm acquisition exposed inherited credential or routing state'
    fi
  done
}

pinned_acquisition_and_offline_execution_are_distinct() {
  praxisbound_tooling_version=$(node -p \
    "require('$praxisbound_repo/packages/cli/package.json').version")
  praxisbound_pinned_coordinate="@praxisbound/cli@$praxisbound_tooling_version"
  coordinate_is_pinned_cli "$praxisbound_pinned_coordinate" \
    "$praxisbound_tooling_version" ||
    fail 'exact CLI coordinate was not accepted as pinned'
  if coordinate_is_pinned_cli '@praxisbound/cli@latest' \
    "$praxisbound_tooling_version"; then
    fail 'latest dist-tag was accepted for automated acquisition'
  fi
  if coordinate_is_pinned_cli 'praxisbound' "$praxisbound_tooling_version"; then
    fail 'unscoped package was accepted for automated acquisition'
  fi
  if coordinate_is_pinned_cli '@forgeflow/cli@0.1.0' \
    "$praxisbound_tooling_version"; then
    fail 'legacy uncontrolled scope was accepted for automated acquisition'
  fi
  if coordinate_is_pinned_cli 'forgeflow' "$praxisbound_tooling_version"; then
    fail 'legacy unscoped package was accepted for automated acquisition'
  fi

  start_npm_registry_fixture none
  praxisbound_hostile_npmrc="$praxisbound_test_dir/hostile/npmrc"
  praxisbound_registry_authority=${praxisbound_registry#http://}
  praxisbound_registry_authority=${praxisbound_registry_authority%/}
  mkdir -p "$praxisbound_test_dir/hostile"
  printf 'registry=https://hostile.invalid/\n//%s/:_authToken=ambient-secret\nalways-auth=true\n' \
    "$praxisbound_registry_authority" >"$praxisbound_hostile_npmrc"
  (
    NODE_AUTH_TOKEN='ambient-node-auth-secret'
    NPM_TOKEN='ambient-npm-secret'
    npm_config_userconfig="$praxisbound_hostile_npmrc"
    npm_config_registry='https://hostile.invalid/'
    HTTP_PROXY='http://hostile.invalid/'
    HTTPS_PROXY='http://hostile.invalid/'
    export NODE_AUTH_TOKEN NPM_TOKEN npm_config_userconfig npm_config_registry
    export HTTP_PROXY HTTPS_PROXY
    run_isolated_npx "$praxisbound_registry" \
      "$praxisbound_test_dir/npx-good" "$praxisbound_pinned_coordinate" \
      "$praxisbound_test_dir/npx-good.stdout" \
      "$praxisbound_test_dir/npx-good.stderr"
  ) || fail 'version-pinned npx acquisition failed'
  [ "$(sed -n '1p' "$praxisbound_test_dir/npx-good.stdout")" = \
    "$praxisbound_tooling_version" ] ||
    fail 'version-pinned npx did not execute the acquired CLI version'
  grep -Fq '"path":"/@praxisbound/cli"' "$praxisbound_registry_log" ||
    fail 'pinned acquisition did not request scoped CLI metadata'
  grep -Fq '"path":"/@praxisbound/core"' "$praxisbound_registry_log" ||
    fail 'pinned acquisition did not request scoped Core metadata'
  grep -Fq "/@praxisbound/cli/-/cli-$praxisbound_tooling_version.tgz" \
    "$praxisbound_registry_log" ||
    fail 'pinned acquisition did not request the exact CLI tarball'
  grep -Fq "/@praxisbound/core/-/core-$praxisbound_tooling_version.tgz" \
    "$praxisbound_registry_log" ||
    fail 'pinned acquisition did not request the exact Core tarball'
  registry_received_no_authorization
  sensitive_acquisition_payloads_are_absent
  stop_npm_registry_fixture

  for praxisbound_failure_mode in bad-integrity bad-shasum corrupt-tarball; do
    start_npm_registry_fixture "$praxisbound_failure_mode"
    if run_isolated_npx "$praxisbound_registry" \
      "$praxisbound_test_dir/npx-$praxisbound_failure_mode" \
      "$praxisbound_pinned_coordinate" \
      "$praxisbound_test_dir/npx-$praxisbound_failure_mode.stdout" \
      "$praxisbound_test_dir/npx-$praxisbound_failure_mode.stderr"; then
      fail "pinned acquisition accepted $praxisbound_failure_mode package metadata"
    fi
    [ ! -s "$praxisbound_test_dir/npx-$praxisbound_failure_mode.stdout" ] ||
      fail "$praxisbound_failure_mode acquisition executed the CLI"
    registry_received_no_authorization
    stop_npm_registry_fixture
  done

  praxisbound_offline_target="$praxisbound_test_dir/offline-init-target"
  mkdir "$praxisbound_offline_target"
  (
    CDPATH='' cd "$praxisbound_consumer_dir"
    env -i PATH="$PATH" HOME="$praxisbound_npm_home" \
      NODE_OPTIONS="--require=$praxisbound_repo/tests/network-deny.cjs" \
      ./node_modules/.bin/praxisbound --help \
      >"$praxisbound_test_dir/offline-help"
    env -i PATH="$PATH" HOME="$praxisbound_npm_home" \
      NODE_OPTIONS="--require=$praxisbound_repo/tests/network-deny.cjs" \
      ./node_modules/.bin/praxisbound doctor --json \
      >"$praxisbound_test_dir/offline-doctor.json"
    env -i PATH="$PATH" HOME="$praxisbound_npm_home" \
      NODE_OPTIONS="--require=$praxisbound_repo/tests/network-deny.cjs" \
      ./node_modules/.bin/praxisbound verification check --json \
      >"$praxisbound_test_dir/offline-verification.json"
    env -i PATH="$PATH" HOME="$praxisbound_npm_home" \
      NODE_OPTIONS="--require=$praxisbound_repo/tests/network-deny.cjs" \
      ./node_modules/.bin/praxisbound verify --json \
      >"$praxisbound_test_dir/offline-verify.json" \
      2>"$praxisbound_test_dir/offline-verify.stderr"
    env -i PATH="$PATH" HOME="$praxisbound_npm_home" \
      NODE_OPTIONS="--require=$praxisbound_repo/tests/network-deny.cjs" \
      ./node_modules/.bin/praxisbound init --dry-run --json \
      "$praxisbound_offline_target" >"$praxisbound_test_dir/offline-init.json"
  )
  node --input-type=module - \
    "$praxisbound_test_dir/offline-doctor.json" \
    "$praxisbound_test_dir/offline-verification.json" \
    "$praxisbound_test_dir/offline-verify.json" \
    "$praxisbound_test_dir/offline-init.json" <<'NODE'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const [doctorPath, verificationPath, verifyPath, initPath] = process.argv.slice(2);
const results = [doctorPath, verificationPath, verifyPath, initPath].map((path) =>
  JSON.parse(readFileSync(path, "utf8")),
);
assert.equal(["pass", "warning"].includes(results[0].status), true);
for (const result of results.slice(1)) assert.equal(result.status, "pass");
for (const result of results) assert.equal(result.exit, 0);
assert.equal(results[0].subject, "repository");
assert.equal(results[1].subject, "verification");
assert.equal(results[2].outcome, "success");
assert.equal(results[3].outcome, "INIT_PREVIEW");
NODE
}

supported_consumer_matrix_and_acquisition_docs_are_declared() {
  praxisbound_contract_fixture="$praxisbound_test_dir/distribution-contract"
  mkdir "$praxisbound_contract_fixture"
  cp "$praxisbound_repo/.github/workflows/verify.yml" \
    "$praxisbound_contract_fixture/verify.yml"
  cp "$praxisbound_repo/packages/cli/README.md" \
    "$praxisbound_contract_fixture/cli-README.md"
  praxisbound_workflow="$praxisbound_contract_fixture/verify.yml"
  for praxisbound_matrix_value in \
    'ubuntu-latest' 'macos-latest' \
    '22.13.0' '22.x' '24.0.0' '24.x' '26.0.0' '26.x'
  do
    grep -Fq -- "- $praxisbound_matrix_value" "$praxisbound_workflow" ||
      fail "tooling compatibility matrix omits $praxisbound_matrix_value"
  done
  if grep -Fq -- '- 20.19.0' "$praxisbound_workflow"; then
    fail 'tooling compatibility matrix still admits Node 20'
  fi
  grep -Fq 'runs-on: ${{ matrix.runner }}' "$praxisbound_workflow" ||
    fail 'tooling compatibility matrix does not select its declared OS runner'
  grep -Fq 'check-latest: true' "$praxisbound_workflow" ||
    fail 'moving Node matrix lines may use stale runner cache versions'

  praxisbound_cli_readme="$praxisbound_contract_fixture/cli-README.md"
  grep -Fq 'npx --yes @praxisbound/cli@<tooling-version>' \
    "$praxisbound_cli_readme" ||
    fail 'CLI readme omits version-pinned acquisition'
  grep -Fq './node_modules/.bin/praxisbound' "$praxisbound_cli_readme" ||
    fail 'CLI readme omits direct installed-binary execution'
  grep -Fq 'Do not use the unscoped `npx praxisbound`' \
    "$praxisbound_cli_readme" ||
    fail 'CLI readme does not reject the unrelated unscoped package'
}

unavailable_arguments_fail_with_one_usage_result() {
  praxisbound_empty="$praxisbound_test_dir/empty"
  praxisbound_unavailable="$praxisbound_test_dir/unavailable"
  : >"$praxisbound_empty"
  printf '%s\n' \
    'praxisbound: command unavailable; this command is not available. Run praxisbound --help.' \
    >"$praxisbound_unavailable"

  assert_cli_result 2 "$praxisbound_empty" "$praxisbound_unavailable" --json
  assert_cli_result 2 "$praxisbound_empty" "$praxisbound_unavailable" story lint
  assert_cli_result 2 "$praxisbound_empty" "$praxisbound_unavailable" verification lint
  assert_cli_result 2 "$praxisbound_empty" "$praxisbound_unavailable" help extra
  assert_cli_result 2 "$praxisbound_empty" "$praxisbound_unavailable" version extra
}

workspace_lock_is_current_single_document_and_fails_closed() {
  if grep -Fqx -- '---' "$praxisbound_repo/pnpm-lock.yaml"; then
    fail 'the workspace lockfile contains an environment document'
  fi

  praxisbound_stale_lock="$praxisbound_test_dir/stale-lock"
  mkdir -p "$praxisbound_stale_lock/packages/core" \
    "$praxisbound_stale_lock/packages/cli"
  cp "$praxisbound_repo/package.json" \
    "$praxisbound_repo/pnpm-workspace.yaml" \
    "$praxisbound_repo/pnpm-lock.yaml" \
    "$praxisbound_stale_lock/"
  cp "$praxisbound_repo/packages/core/package.json" \
    "$praxisbound_stale_lock/packages/core/"
  cp "$praxisbound_repo/packages/cli/package.json" \
    "$praxisbound_stale_lock/packages/cli/"

  node --input-type=module - "$praxisbound_stale_lock/package.json" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";

const manifestPath = process.argv[2];
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
manifest.devDependencies["praxisbound-stale-lock-fixture"] = "1.0.0";
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
NODE

  if pnpm --dir "$praxisbound_stale_lock" install \
    --frozen-lockfile --lockfile-only --offline --ignore-scripts \
    >"$praxisbound_test_dir/stale-lock-output" 2>&1; then
    fail 'the frozen workspace gate accepted a stale lockfile'
  fi
  grep -Fq 'ERR_PNPM_OUTDATED_LOCKFILE' \
    "$praxisbound_test_dir/stale-lock-output" ||
    fail 'the stale lockfile did not fail with the documented pnpm result'
}

legacy_shell_commands_do_not_delegate_to_node() {
  for legacy_command in bootstrap doctor story-check handoff-check verification-check codex-activate; do
    if grep -E '(^|[[:space:]])(node|nodejs|pnpm)([[:space:]]|$)' \
      "$praxisbound_repo/scripts/$legacy_command" >/dev/null; then
      fail "legacy shell command $legacy_command delegates to the TypeScript runtime"
    fi
  done
}

run_case 'TST001-AC-001' workspace_lock_is_current_single_document_and_fails_closed
run_case 'TST001-AC-002' built_cli_help_and_version_are_exact
run_case 'PB003-AC-001' packed_packages_have_the_bounded_public_contract
run_case 'TST001-AC-003' historical_packed_package_contract_is_preserved
run_case 'TST002-AC-005' packed_machine_contract_is_consumable
run_case 'TST016-AC-001' packed_process_consumer_contract
run_case 'TST016-AC-004' process_consumer_fail_closed
run_case 'TST013-AC-001' packed_init_apply_is_consumable
run_case 'TST019-AC-007' emitted_next_steps_are_sufficient_for_adoption
run_case 'PB003-AC-003' clean_npm_consumer_runs_required_commands
run_case 'TST014-AC-001' packed_activation_is_consumable
run_case 'PB003-AC-003' pinned_acquisition_and_offline_execution_are_distinct
run_case 'PB003-AC-003' supported_consumer_matrix_and_acquisition_docs_are_declared
run_case 'TST001-AC-004' unavailable_arguments_fail_with_one_usage_result
run_case 'TST001-AC-005' legacy_shell_commands_do_not_delegate_to_node

printf 'TypeScript tooling tests passed\n'
