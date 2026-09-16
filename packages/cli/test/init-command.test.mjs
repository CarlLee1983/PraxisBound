import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath, URL } from "node:url";
import test from "node:test";

import { validateResultEnvelope } from "@praxisbound/core";

const bin = fileURLToPath(new URL("../dist/bin.js", import.meta.url));
const bootstrap = fileURLToPath(
  new URL("../../../scripts/bootstrap", import.meta.url),
);

function run(args, cwd) {
  return spawnSync(globalThis.process.execPath, [bin, "init", ...args], {
    cwd,
    encoding: "utf8",
  });
}

async function manifest(root) {
  const entries = [];
  async function visit(directory) {
    const names = await readdir(directory);
    for (const name of names.sort()) {
      const path = join(directory, name);
      const stats = await lstat(path);
      const entry = relative(root, path);
      if (stats.isDirectory()) {
        entries.push([entry, "directory"]);
        await visit(path);
      } else if (stats.isSymbolicLink()) entries.push([entry, "symlink"]);
      else entries.push([entry, "file", await readFile(path, "utf8")]);
    }
  }
  await visit(root);
  return entries;
}

async function temporaryTarget(name) {
  return mkdtemp(join(tmpdir(), `forgeflow-init-${name}-`));
}

test("TST012-AC-001/006: fresh packed CLI preview is deterministic and writes nothing", async () => {
  const root = await temporaryTarget("fresh");
  try {
    const before = await manifest(root);
    const first = run(["--dry-run", "--json", root]);
    const second = run(["--json", "--dry-run", root]);
    const after = await manifest(root);

    assert.equal(first.status, 0);
    assert.equal(first.stderr, "");
    assert.equal(first.stdout, second.stdout);
    assert.deepEqual(after, before);
    const result = JSON.parse(first.stdout);
    assert.deepEqual(validateResultEnvelope(result), {
      ok: true,
      value: result,
    });
    assert.equal(result.outcome, "INIT_PREVIEW");
    assert.equal(
      result.data.provenance,
      "@praxisbound/cli bundled Protocol snapshot",
    );
    const plannedPaths = [
      "AGENTS.md",
      "specs/stories/_template/story.md",
      "specs/stories/_template/acceptance.md",
      "specs/stories/_template/task.md",
      "guidance/ENTRY.md",
      "guidance/PRINCIPLES.md",
      "guidance/DECISIONS.md",
      "guidance/PRACTICES.md",
      "specs/.praxisbound-adoption",
    ];
    assert.deepEqual(
      result.data.changes.map((change) => change.path),
      plannedPaths,
    );
    const retained = spawnSync(bootstrap, ["--dry-run", root], {
      encoding: "utf8",
    });
    assert.equal(retained.status, 0, retained.stderr);
    const physicalRoot = await realpath(root);
    assert.deepEqual(
      retained.stdout
        .split("\n")
        .filter((line) => line.startsWith("Would install "))
        .map((line) =>
          relative(physicalRoot, line.slice("Would install ".length)),
        ),
      plannedPaths,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("TST012-AC-002/003/005/007: force and markerless upgrade preserve exact ownership", async () => {
  const root = await temporaryTarget("ownership");
  try {
    await writeFile(join(root, "AGENTS.md"), "adopter guide\n");
    const conflict = run(["--dry-run", "--json", root]);
    const force = run(["--dry-run", "--force", "--json", root]);
    assert.equal(JSON.parse(conflict.stdout).outcome, "INIT_CONFLICT");
    assert.equal(JSON.parse(force.stdout).outcome, "INIT_PREVIEW");
    assert.equal(JSON.parse(force.stdout).data.changes[0].kind, "replace");

    await mkdir(join(root, "specs", "stories", "_template"), {
      recursive: true,
    });
    const upgrade = run(["--upgrade", "--dry-run", "--json", root]);
    const result = JSON.parse(upgrade.stdout);
    assert.equal(upgrade.status, 0);
    assert.deepEqual(
      result.data.changes.map((change) => change.path),
      [
        "specs/stories/_template/story.md",
        "specs/stories/_template/acceptance.md",
        "specs/stories/_template/task.md",
        "specs/.praxisbound-adoption",
      ],
    );
    assert.equal(
      await readFile(join(root, "AGENTS.md"), "utf8"),
      "adopter guide\n",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("TST012-AC-008/009: unsafe paths and invalid arguments fail without target writes", async () => {
  const root = await temporaryTarget("refusal");
  const outside = join(root, "outside");
  try {
    await writeFile(outside, "outside\n");
    await symlink(outside, join(root, "AGENTS.md"));
    const before = await manifest(root);
    const unsafe = run(["--force", "--dry-run", "--json", root]);
    const invalid = run(["--force", "--upgrade", "--dry-run", "--json", root]);

    assert.equal(unsafe.status, 1);
    assert.equal(JSON.parse(unsafe.stdout).outcome, "INIT_OPERATION_REFUSED");
    assert.equal(invalid.status, 2);
    assert.equal(JSON.parse(invalid.stdout).error.code, "INIT_USAGE");
    assert.deepEqual(await manifest(root), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("TST012-AC-006: npm package content includes the complete bundled snapshot", () => {
  const packed = spawnSync(
    "npm",
    ["pack", "--dry-run", "--json", "--ignore-scripts"],
    {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      encoding: "utf8",
    },
  );
  assert.equal(packed.status, 0, packed.stderr);
  const files = JSON.parse(packed.stdout)[0].files.map((entry) => entry.path);
  for (const path of [
    "dist/snapshot/provenance.json",
    "dist/snapshot/VERSION",
    "dist/snapshot/AGENTS.md",
    "dist/snapshot/templates/story/story.md",
    "dist/snapshot/templates/story/acceptance.md",
    "dist/snapshot/templates/story/task.md",
    "dist/snapshot/guidance/ENTRY.md",
    "dist/snapshot/guidance/PRINCIPLES.md",
    "dist/snapshot/guidance/DECISIONS.md",
    "dist/snapshot/guidance/PRACTICES.md",
  ])
    assert.ok(files.includes(path), `missing packed snapshot asset: ${path}`);
});

// TST-019. These cases assert next-step identifiers, presence and ordering.
// They never assert description wording: rewording a step is not a contract
// change, while removing, reordering or renaming one is.
const gateStepId = "verification-gate";
const confirmStepId = "confirm-adoption";

function stepIds(result) {
  return result.data.nextSteps.map((step) => step.id);
}

test("TST019-AC-001: preview and applied outcomes both carry ordered next steps", async () => {
  const previewRoot = await temporaryTarget("steps-preview");
  const appliedRoot = await temporaryTarget("steps-applied");
  try {
    const preview = run(["--dry-run", "--json", previewRoot]);
    const applied = run(["--json", appliedRoot]);

    assert.equal(preview.status, 0, preview.stderr);
    assert.equal(applied.status, 0, applied.stderr);
    const previewResult = JSON.parse(preview.stdout);
    const appliedResult = JSON.parse(applied.stdout);
    assert.equal(previewResult.outcome, "INIT_PREVIEW");
    assert.equal(appliedResult.outcome, "INIT_APPLIED");

    for (const result of [previewResult, appliedResult]) {
      assert.deepEqual(validateResultEnvelope(result), {
        ok: true,
        value: result,
      });
      assert.ok(Array.isArray(result.data.nextSteps));
      // deepEqual pins presence and order together: the gate step precedes
      // the confirmation step, and no step was added, dropped or renamed.
      assert.deepEqual(stepIds(result), [gateStepId, confirmStepId]);
      for (const step of result.data.nextSteps) {
        assert.equal(typeof step.id, "string");
        assert.ok(step.id.length > 0);
        assert.equal(typeof step.description, "string");
        assert.ok(step.description.length > 0);
      }
    }
    assert.deepEqual(stepIds(previewResult), stepIds(appliedResult));
  } finally {
    await rm(previewRoot, { recursive: true, force: true });
    await rm(appliedRoot, { recursive: true, force: true });
  }
});

test("TST019-AC-002: human output prints the same steps in the same order", async () => {
  const root = await temporaryTarget("steps-human");
  try {
    const machine = run(["--dry-run", "--json", root]);
    const human = run(["--dry-run", root]);

    assert.equal(human.status, 0, human.stderr);
    const steps = JSON.parse(machine.stdout).data.nextSteps;
    let cursor = -1;
    for (const step of steps) {
      const at = human.stdout.indexOf(step.description);
      assert.ok(at >= 0, `human output omits step ${step.id}`);
      assert.ok(at > cursor, `human output misorders step ${step.id}`);
      cursor = at;
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("TST019-AC-003/004: the gate step states an outcome and no mode writes a gate", async () => {
  const root = await temporaryTarget("steps-gate");
  try {
    const applied = run(["--json", root]);
    assert.equal(applied.status, 0, applied.stderr);
    const result = JSON.parse(applied.stdout);

    const gate = result.data.nextSteps.find((step) => step.id === gateStepId);
    assert.ok(gate !== undefined, "the gate step is absent");
    // Structural, not wording: a required outcome fits on one line, a file body
    // does not, and these names belong to no repository's prose.
    assert.ok(!gate.description.includes("\n"));
    assert.doesNotMatch(
      gate.description,
      /\b(?:golang|go\.mod|npm|pnpm|yarn|cargo|pytest|gradle|maven|tsc)\b/i,
      "the gate step must not name a specific toolchain",
    );
    assert.equal(result.schemaVersion, "1.0.0");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("TST019-AC-004: no mode writes a verification gate into the target", async () => {
  const modes = [
    ["safe", []],
    ["force", ["--force"]],
    ["upgrade", ["--upgrade"]],
  ];
  for (const [name, flags] of modes) {
    const root = await temporaryTarget(`steps-nogate-${name}`);
    try {
      if (name === "force") await writeFile(join(root, "AGENTS.md"), "own\n");
      if (name === "upgrade")
        await mkdir(join(root, "specs", "stories", "_template"), {
          recursive: true,
        });
      const applied = run(["--json", ...flags, root]);
      assert.equal(applied.status, 0, `${name}: ${applied.stderr}`);

      for (const [entry] of await manifest(root))
        assert.doesNotMatch(
          entry.split("/").at(-1),
          /^(?:GNU)?[Mm]akefile$/,
          `${name} mode wrote a verification gate: ${entry}`,
        );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("TST019-AC-006: a failed init reports its typed failure and emits no next steps", async () => {
  const root = await temporaryTarget("steps-failure");
  try {
    await writeFile(join(root, "AGENTS.md"), "adopter guide\n");
    const conflict = run(["--dry-run", "--json", root]);
    const usage = run(["--force", "--upgrade", "--json", root]);

    assert.equal(conflict.status, 1);
    assert.equal(usage.status, 2);
    const conflictResult = JSON.parse(conflict.stdout);
    assert.equal(conflictResult.outcome, "INIT_CONFLICT");
    assert.equal(conflictResult.data?.nextSteps, undefined);
    const usageResult = JSON.parse(usage.stdout);
    assert.equal(usageResult.error.code, "INIT_USAGE");
    assert.equal(usageResult.data?.nextSteps, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
