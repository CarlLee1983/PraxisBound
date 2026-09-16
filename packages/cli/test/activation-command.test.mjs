import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmod,
  cp,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import test from "node:test";

import { validateResultEnvelope } from "@praxisbound/core";

import {
  nodeActivationFilesystemAdapter,
  runActivation,
} from "../dist/activation.js";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const bin = fileURLToPath(new URL("../dist/bin.js", import.meta.url));
const bootstrap = join(repositoryRoot, "scripts/bootstrap");

function runCli(args, env) {
  return spawnSync(
    globalThis.process.execPath,
    [bin, "codex", "activate", ...args],
    { encoding: "utf8", env },
  );
}

async function manifest(root) {
  const entries = [];
  async function visit(directory) {
    for (const name of (await readdir(directory)).sort()) {
      const path = join(directory, name);
      const stats = await lstat(path);
      const entry = relative(root, path);
      if (stats.isDirectory()) {
        entries.push([entry, "directory", stats.mode & 0o777]);
        await visit(path);
      } else if (stats.isSymbolicLink()) {
        entries.push([entry, "symlink"]);
      } else {
        entries.push([
          entry,
          "file",
          stats.mode & 0o777,
          new Uint8Array(await readFile(path)),
        ]);
      }
    }
  }
  await visit(root);
  return entries;
}

async function adopted(root, name) {
  const target = join(root, name);
  await mkdir(target);
  const result = spawnSync(bootstrap, [target], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  await writeFile(
    join(target, "AGENTS.md"),
    "custom policy\r\nno final newline",
    {
      mode: 0o600,
    },
  );
  return target;
}

async function copySourceFile(sourceRoot, path) {
  const destination = join(sourceRoot, path);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(join(repositoryRoot, path), destination);
}

async function portableSource(root) {
  const source = join(root, "portable-source");
  for (const path of [
    "scripts/codex-activate",
    "VERSION",
    "skills/praxisbound/SKILL.md",
    "skills/praxisbound/agents-block.md",
    "skills/story-development/SKILL.md",
  ])
    await copySourceFile(source, path);
  await chmod(join(source, "scripts/codex-activate"), 0o755);
  return source;
}

test("TST014-AC-001/002/008: packed preview, apply, and unchanged have retained generated-byte parity", async () => {
  const root = await mkdtemp(join(tmpdir(), "praxisbound-activation-parity-"));
  try {
    const source = await portableSource(root);
    const cliTarget = await adopted(root, "cli");
    const portableTarget = await adopted(root, "portable");
    const before = await manifest(cliTarget);

    const preview = runCli(["--json", cliTarget]);
    assert.equal(preview.status, 0, preview.stderr);
    assert.deepEqual(await manifest(cliTarget), before);
    const previewResult = JSON.parse(preview.stdout);
    assert.equal(previewResult.outcome, "ACTIVATION_PREVIEW");
    assert.deepEqual(
      previewResult.data.changes.map(({ path }) => path),
      [
        "AGENTS.md",
        ".agents/skills/praxisbound/SKILL.md",
        ".agents/skills/praxisbound/story-development.md",
        ".agents/skills/praxisbound/.praxisbound-snapshot",
      ],
    );

    const humanPreview = runCli([cliTarget]);
    const portablePreview = spawnSync(
      join(source, "scripts/codex-activate"),
      [portableTarget],
      { encoding: "utf8" },
    );
    assert.equal(humanPreview.status, 0, humanPreview.stderr);
    assert.equal(portablePreview.status, 0, portablePreview.stderr);
    for (const output of [humanPreview.stdout, portablePreview.stdout]) {
      assert.match(output, /Would write .*AGENTS\.md/);
      assert.match(output, /<!-- PraxisBound Codex: begin -->/);
      assert.match(output, /custom policy/);
      assert.match(output, /Preview only; review the changes/);
    }
    assert.match(humanPreview.stdout, /--- .*\/cli\/AGENTS\.md/);
    assert.match(humanPreview.stdout, /\+\+\+ .*AGENTS\.md \(proposed\)/);
    assert.deepEqual(await manifest(cliTarget), before);

    const cli = runCli(["--apply", "--json", cliTarget]);
    const portable = spawnSync(
      join(source, "scripts/codex-activate"),
      ["--apply", portableTarget],
      { encoding: "utf8" },
    );
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(portable.status, 0, portable.stderr);
    const result = JSON.parse(cli.stdout);
    assert.equal(result.outcome, "ACTIVATION_APPLIED");
    assert.deepEqual(validateResultEnvelope(result), {
      ok: true,
      value: result,
    });
    assert.deepEqual(await manifest(cliTarget), await manifest(portableTarget));
    assert.equal(result.data.attempted.at(-1), result.data.changes.at(-1).path);
    assert.equal(
      result.data.attempted.at(-1),
      ".agents/skills/praxisbound/.praxisbound-snapshot",
    );

    const installed = await manifest(cliTarget);
    const unchanged = runCli(["--json", "--apply", cliTarget]);
    assert.equal(unchanged.status, 0, unchanged.stderr);
    assert.equal(JSON.parse(unchanged.stdout).outcome, "ACTIVATION_UNCHANGED");
    assert.deepEqual(await manifest(cliTarget), installed);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("TST014-AC-005/008: packaged activation provenance is internally consistent", async () => {
  const root = await mkdtemp(join(tmpdir(), "praxisbound-activation-source-"));
  try {
    const dist = fileURLToPath(new URL("../dist/", import.meta.url));
    const modulePath = join(root, "activation-snapshot.mjs");
    const snapshotRoot = join(root, "snapshot");
    await writeFile(join(root, "package.json"), '{"type":"module"}\n');
    await cp(join(dist, "activation-snapshot.js"), modulePath);
    await cp(
      join(dist, "packaged-snapshot.js"),
      join(root, "packaged-snapshot.js"),
    );
    await cp(join(dist, "snapshot"), snapshotRoot, { recursive: true });
    const { loadPackagedActivationSource } = await import(
      pathToFileURL(modulePath).href
    );
    const provenancePath = join(snapshotRoot, "provenance.json");
    const provenance = JSON.parse(await readFile(provenancePath, "utf8"));

    await writeFile(
      provenancePath,
      `${JSON.stringify({ ...provenance, protocolVersion: "0.9.1" })}\n`,
    );
    await assert.rejects(
      loadPackagedActivationSource(),
      /version does not match provenance/,
    );

    await writeFile(
      provenancePath,
      `${JSON.stringify({ ...provenance, snapshotDigest: "0".repeat(64) })}\n`,
    );
    await assert.rejects(
      loadPackagedActivationSource(),
      /manifest digest is invalid/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("TST014-AC-004: unknown and locally edited owned content conflicts before mutation", async () => {
  const root = await mkdtemp(
    join(tmpdir(), "praxisbound-activation-conflict-"),
  );
  try {
    const target = await adopted(root, "target");
    const installed = runCli(["--apply", target]);
    assert.equal(installed.status, 0, installed.stderr || installed.stdout);
    await writeFile(
      join(target, ".agents/skills/praxisbound/local-note.md"),
      "keep me\n",
    );
    const before = await manifest(target);
    const unknown = runCli(["--json", target]);
    assert.equal(unknown.status, 1);
    assert.equal(JSON.parse(unknown.stdout).outcome, "ACTIVATION_CONFLICT");
    assert.deepEqual(await manifest(target), before);

    await rm(join(target, ".agents/skills/praxisbound/local-note.md"));
    await writeFile(
      join(target, ".agents/skills/praxisbound/SKILL.md"),
      "local edit\n",
    );
    const editedBefore = await manifest(target);
    const edited = runCli(["--apply", "--json", target]);
    assert.equal(edited.status, 1);
    assert.equal(JSON.parse(edited.stdout).outcome, "ACTIVATION_CONFLICT");
    assert.deepEqual(await manifest(target), editedBefore);

    const incompleteTarget = await adopted(root, "incomplete");
    assert.equal(runCli(["--apply", incompleteTarget]).status, 0);
    await rm(
      join(incompleteTarget, ".agents/skills/praxisbound/story-development.md"),
    );
    const incompleteBefore = await manifest(incompleteTarget);
    const incomplete = runCli(["--apply", "--json", incompleteTarget]);
    assert.equal(incomplete.status, 1);
    assert.equal(JSON.parse(incomplete.stdout).outcome, "ACTIVATION_CONFLICT");
    assert.deepEqual(await manifest(incompleteTarget), incompleteBefore);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("TST014-AC-004/005: malformed markers, invalid adoption, and unsafe links fail closed", async () => {
  const root = await mkdtemp(join(tmpdir(), "praxisbound-activation-safety-"));
  try {
    const malformedTarget = await adopted(root, "malformed");
    await writeFile(
      join(malformedTarget, "AGENTS.md"),
      "<!-- PraxisBound Codex: begin -->\nunclosed\n",
    );
    const malformedBefore = await manifest(malformedTarget);
    const malformed = runCli(["--apply", "--json", malformedTarget]);
    assert.equal(malformed.status, 1);
    assert.equal(JSON.parse(malformed.stdout).outcome, "ACTIVATION_CONFLICT");
    assert.deepEqual(await manifest(malformedTarget), malformedBefore);

    const adoptionTarget = await adopted(root, "invalid-adoption");
    await writeFile(
      join(adoptionTarget, "specs/.praxisbound-adoption"),
      "version=0.10.0\nversion=0.8.0\n",
    );
    const adoptionBefore = await manifest(adoptionTarget);
    const adoption = runCli(["--json", adoptionTarget]);
    assert.equal(adoption.status, 1);
    assert.equal(JSON.parse(adoption.stdout).outcome, "ACTIVATION_CONFLICT");
    assert.deepEqual(await manifest(adoptionTarget), adoptionBefore);

    const linkedTarget = await adopted(root, "linked");
    const outside = join(root, "outside-agents.md");
    await writeFile(outside, "outside stays unchanged\n");
    await rm(join(linkedTarget, "AGENTS.md"));
    await symlink(outside, join(linkedTarget, "AGENTS.md"));
    const linkedBefore = await manifest(linkedTarget);
    const outsideBefore = await readFile(outside);
    const linked = runCli(["--apply", "--json", linkedTarget]);
    assert.equal(linked.status, 1);
    assert.equal(
      JSON.parse(linked.stdout).outcome,
      "ACTIVATION_OPERATION_REFUSED",
    );
    assert.deepEqual(await manifest(linkedTarget), linkedBefore);
    assert.deepEqual(await readFile(outside), outsideBefore);

    const parentTypeTarget = await adopted(root, "parent-type");
    await writeFile(join(parentTypeTarget, ".agents"), "not a directory\n");
    const parentBefore = await manifest(parentTypeTarget);
    const parentType = runCli(["--apply", "--json", parentTypeTarget]);
    assert.equal(parentType.status, 1);
    assert.equal(
      JSON.parse(parentType.stdout).outcome,
      "ACTIVATION_OPERATION_REFUSED",
    );
    assert.deepEqual(await manifest(parentTypeTarget), parentBefore);

    const leafTypeTarget = await adopted(root, "leaf-type");
    await mkdir(join(leafTypeTarget, ".agents/skills/praxisbound"), {
      recursive: true,
    });
    await mkdir(join(leafTypeTarget, ".agents/skills/praxisbound/SKILL.md"));
    await writeFile(
      join(leafTypeTarget, ".agents/skills/praxisbound/story-development.md"),
      "workflow\n",
    );
    await writeFile(
      join(leafTypeTarget, ".agents/skills/praxisbound/.praxisbound-snapshot"),
      "snapshot\n",
    );
    const leafBefore = await manifest(leafTypeTarget);
    const leafType = runCli(["--json", leafTypeTarget]);
    assert.equal(leafType.status, 1);
    assert.equal(
      JSON.parse(leafType.stdout).outcome,
      "ACTIVATION_OPERATION_REFUSED",
    );
    assert.deepEqual(await manifest(leafTypeTarget), leafBefore);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("TST014-AC-007: preview and unchanged scratch cleanup faults retain evidence without target mutation", async () => {
  const root = await mkdtemp(join(tmpdir(), "praxisbound-activation-scratch-"));
  try {
    const target = await adopted(root, "target");
    const before = await manifest(target);
    const scratch = {
      async prepare() {
        return {
          prepared: true,
          cleaned: false,
          session: {
            path: "/private/tmp/retained-activation",
            token: "scratch/retained-activation",
            async cleanup() {
              return false;
            },
          },
        };
      },
    };
    const preview = await runActivation(
      ["--json", target],
      nodeActivationFilesystemAdapter,
      scratch,
    );
    assert.equal(preview.result.outcome, "ACTIVATION_CLEANUP_INCOMPLETE");
    assert.deepEqual(preview.result.data.cleanupResidue, [
      "scratch/retained-activation",
    ]);
    assert.equal(
      preview.retainedScratchPath,
      "/private/tmp/retained-activation",
    );
    assert.deepEqual(await manifest(target), before);

    assert.equal(runCli(["--apply", target]).status, 0);
    const installed = await manifest(target);
    const unchanged = await runActivation(
      [target],
      nodeActivationFilesystemAdapter,
      {
        async prepare() {
          return {
            prepared: true,
            cleaned: false,
            session: {
              path: "/private/tmp/thrown-activation",
              token: "scratch/thrown-activation",
              async cleanup() {
                throw new Error("EACCES /private/tmp secret-token");
              },
            },
          };
        },
      },
    );
    assert.equal(unchanged.result.outcome, "ACTIVATION_CLEANUP_INCOMPLETE");
    assert.deepEqual(unchanged.result.data.cleanupResidue, [
      "scratch/thrown-activation",
    ]);
    assert.deepEqual(await manifest(target), installed);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("TST014-AC-007: preview and unchanged keep real scratch external to the target", async () => {
  const root = await mkdtemp(
    join(tmpdir(), "praxisbound-activation-external-scratch-"),
  );
  try {
    const target = await adopted(root, "target");
    const targetChild = join(target, "scratch-base");
    const dotDotNamedChild = join(target, "..scratch");
    await mkdir(targetChild);
    await mkdir(dotDotNamedChild);
    const before = await manifest(target);
    await chmod(target, 0o555);
    try {
      await chmod(targetChild, 0o555);
      await chmod(dotDotNamedChild, 0o555);
      try {
        for (const scratchBase of [target, targetChild, dotDotNamedChild]) {
          const preview = runCli(
            ["--json", target],
            Object.freeze({ ...globalThis.process.env, TMPDIR: scratchBase }),
          );
          assert.equal(preview.status, 0, preview.stderr);
          assert.equal(
            JSON.parse(preview.stdout).outcome,
            "ACTIVATION_PREVIEW",
          );
        }
      } finally {
        await chmod(targetChild, 0o755);
        await chmod(dotDotNamedChild, 0o755);
      }
    } finally {
      await chmod(target, 0o700);
    }
    assert.deepEqual(await manifest(target), before);

    const applied = runCli(["--apply", target]);
    assert.equal(applied.status, 0, applied.stderr);
    const installed = await manifest(target);
    await chmod(target, 0o555);
    try {
      await chmod(targetChild, 0o555);
      await chmod(dotDotNamedChild, 0o555);
      for (const scratchBase of [target, targetChild, dotDotNamedChild]) {
        const unchanged = runCli(
          ["--json", target],
          Object.freeze({
            ...globalThis.process.env,
            TMPDIR: scratchBase,
          }),
        );
        assert.equal(unchanged.status, 0, unchanged.stderr);
        assert.equal(
          JSON.parse(unchanged.stdout).outcome,
          "ACTIVATION_UNCHANGED",
        );
      }
    } finally {
      await chmod(targetChild, 0o755);
      await chmod(dotDotNamedChild, 0o755);
      await chmod(target, 0o700);
    }
    assert.deepEqual(await manifest(target), installed);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("TST014 input contract: activation routes each global option once before the delimiter", async () => {
  const help = runCli(["--json", "--help"]);
  assert.equal(help.status, 0, help.stderr);
  assert.ok(help.stdout.includes("Usage:\n  praxisbound codex activate"));
  assert.equal(help.stderr, "");

  const version = runCli(["--apply", "--version"]);
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout, "0.2.0\n");
  assert.equal(version.stderr, "");

  for (const args of [
    ["--help", "--help"],
    ["--version", "--version"],
    ["--help", "--version"],
  ]) {
    const duplicate = runCli(args);
    assert.equal(duplicate.status, 2, duplicate.stderr);
  }

  const afterDelimiter = runCli(["--json", "--", "--help"]);
  assert.equal(afterDelimiter.status, 1, afterDelimiter.stderr);
  assert.equal(
    JSON.parse(afterDelimiter.stdout).issues[0].code,
    "ACTIVATION_TARGET_UNAVAILABLE",
  );

  const positionalJson = await runActivation(["--", "--json"], {
    async inspect() {
      return { kind: "target-unavailable" };
    },
  });
  assert.equal(positionalJson.mode, "human");
});

test("TST014-AC-006/008: invalid invocation is ERROR/2 and packed assets are present", () => {
  const invalid = runCli(["--json", "--apply"]);
  assert.equal(invalid.status, 2);
  assert.equal(JSON.parse(invalid.stdout).error.code, "ACTIVATION_USAGE");

  const packed = spawnSync(
    "npm",
    ["pack", "--dry-run", "--json", "--ignore-scripts"],
    {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      encoding: "utf8",
    },
  );
  assert.equal(packed.status, 0, packed.stderr);
  const files = JSON.parse(packed.stdout)[0].files.map(({ path }) => path);
  for (const path of [
    "dist/snapshot/skills/praxisbound/SKILL.md",
    "dist/snapshot/skills/praxisbound/agents-block.md",
    "dist/snapshot/skills/story-development/SKILL.md",
  ])
    assert.ok(files.includes(path), `missing packed activation asset: ${path}`);
});

test("TST014-AC-005/006: acquisition facts are evaluated by Core without raw diagnostics", async () => {
  for (const kind of ["target-unavailable", "source-unavailable"]) {
    const execution = await runActivation(["--json", "fixture"], {
      async inspect() {
        return { kind };
      },
    });
    assert.equal(execution.result.outcome, "ACTIVATION_OPERATION_REFUSED");
    assert.equal(execution.result.exit, 1);
    assert.doesNotMatch(
      JSON.stringify(execution.result),
      /\/private\/|EACCES|secret-token/,
    );
  }
  const missing = runCli(["--json", join(tmpdir(), "missing-activation")]);
  assert.equal(missing.status, 1);
  assert.equal(
    JSON.parse(missing.stdout).issues[0].code,
    "ACTIVATION_TARGET_UNAVAILABLE",
  );
});
