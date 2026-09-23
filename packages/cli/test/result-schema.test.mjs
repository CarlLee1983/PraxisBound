import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

import {
  IMPLEMENTED_PROTOCOL_VERSION,
  RESULT_SCHEMA_VERSION,
} from "../../core/dist/index.js";
import { serializeResultEnvelope } from "../dist/index.js";

const schema = JSON.parse(
  await readFile(
    new URL(
      "../../../docs/typescript-tooling/result-envelope-v1.schema.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const repository = fileURLToPath(new URL("../../..", import.meta.url));
const bin = join(repository, "packages/cli/dist/bin.js");

function resolveReference(root, reference) {
  assert.match(reference, /^#\//);
  return reference
    .slice(2)
    .split("/")
    .reduce(
      (value, segment) =>
        value[segment.replaceAll("~1", "/").replaceAll("~0", "~")],
      root,
    );
}

function hasType(value, type) {
  switch (type) {
    case "null":
      return value === null;
    case "array":
      return Array.isArray(value);
    case "object":
      return (
        typeof value === "object" && value !== null && !Array.isArray(value)
      );
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    default:
      return typeof value === type;
  }
}

// This evaluator deliberately supports exactly the JSON Schema vocabulary used
// by the checked-in result schema. An unknown keyword fails the test instead of
// silently weakening the contract.
function schemaAccepts(value, node, root = schema) {
  const allowedKeywords = new Set([
    "$schema",
    "$id",
    "$ref",
    "$defs",
    "title",
    "description",
    "type",
    "const",
    "enum",
    "required",
    "properties",
    "additionalProperties",
    "items",
    "oneOf",
    "minLength",
    "pattern",
  ]);
  for (const keyword of Object.keys(node)) {
    assert.ok(
      allowedKeywords.has(keyword),
      `unsupported schema keyword: ${keyword}`,
    );
  }

  if (node.$ref !== undefined) {
    return schemaAccepts(value, resolveReference(root, node.$ref), root);
  }
  if (node.type !== undefined && !hasType(value, node.type)) return false;
  if (node.const !== undefined && !Object.is(value, node.const)) return false;
  if (
    node.enum !== undefined &&
    !node.enum.some((entry) => Object.is(value, entry))
  ) {
    return false;
  }
  if (node.minLength !== undefined && value.length < node.minLength)
    return false;
  if (
    node.pattern !== undefined &&
    !new RegExp(node.pattern, "u").test(value)
  ) {
    return false;
  }
  if (node.oneOf !== undefined) {
    const matches = node.oneOf.filter((branch) =>
      schemaAccepts(value, branch, root),
    );
    if (matches.length !== 1) return false;
  }
  if (node.required !== undefined) {
    if (!hasType(value, "object")) return false;
    if (!node.required.every((field) => Object.hasOwn(value, field)))
      return false;
  }
  if (node.properties !== undefined && hasType(value, "object")) {
    for (const [field, fieldSchema] of Object.entries(node.properties)) {
      if (
        Object.hasOwn(value, field) &&
        !schemaAccepts(value[field], fieldSchema, root)
      ) {
        return false;
      }
    }
    for (const [field, fieldValue] of Object.entries(value)) {
      if (Object.hasOwn(node.properties, field)) continue;
      if (node.additionalProperties === false) return false;
      if (
        typeof node.additionalProperties === "object" &&
        !schemaAccepts(fieldValue, node.additionalProperties, root)
      ) {
        return false;
      }
    }
  }
  if (node.items !== undefined && Array.isArray(value)) {
    return value.every((entry) => schemaAccepts(entry, node.items, root));
  }
  return true;
}

const resultMappings = [
  ["pass", "success", 0],
  ["fail", "failure", 1],
  ["warning", "warning", 0],
  ["error", "usage-error", 2],
  ["error", "configuration-error", 2],
  ["error", "internal-error", 2],
  ["pass", "RELEASE_READY", 0],
  ["fail", "RELEASE_INCOMPLETE", 1],
  ["pass", "INIT_APPLIED", 0],
  ["pass", "INIT_PREVIEW", 0],
  ["fail", "INIT_CONFLICT", 1],
  ["fail", "INIT_OPERATION_REFUSED", 1],
  ["fail", "INIT_APPLY_FAILED_RECOVERED", 1],
  ["fail", "INIT_RECOVERY_INCOMPLETE", 1],
  ["fail", "INIT_CLEANUP_INCOMPLETE", 1],
  ["pass", "ACTIVATION_PREVIEW", 0],
  ["pass", "ACTIVATION_APPLIED", 0],
  ["pass", "ACTIVATION_UNCHANGED", 0],
  ["fail", "ACTIVATION_CONFLICT", 1],
  ["fail", "ACTIVATION_OPERATION_REFUSED", 1],
  ["fail", "ACTIVATION_APPLY_FAILED_RECOVERED", 1],
  ["fail", "ACTIVATION_RECOVERY_INCOMPLETE", 1],
  ["fail", "ACTIVATION_CLEANUP_INCOMPLETE", 1],
  ["pass", "REVIEW_READY", 0],
  ["fail", "REVIEW_BLOCKED", 1],
  ["fail", "REVIEW_INCOMPLETE", 1],
  ["fail", "REVIEW_STALE", 1],
  ["error", "ERROR", 2],
  ["error", "ERROR", 3],
];

function envelope(status, outcome, exit) {
  return {
    schemaVersion: RESULT_SCHEMA_VERSION,
    protocolVersion: IMPLEMENTED_PROTOCOL_VERSION,
    status,
    outcome,
    exit,
    subject: "schema:fixture",
    path: "specs/stories/PB-003",
    data: { nested: [null, true, 1, "value", { ok: false }] },
    error: { code: "FIXTURE_ERROR", message: "A stable fixture error." },
    issues: [
      {
        code: "FIXTURE_ISSUE",
        message: "A stable fixture issue.",
        subject: "schema:fixture",
        path: "specs/stories/PB-003",
      },
    ],
  };
}

test("PB003-AC-002: the schema accepts every canonical result mapping", () => {
  assert.equal(schema.$id, "urn:praxisbound:cli-result:1");
  assert.equal(schema.properties.schemaVersion.const, RESULT_SCHEMA_VERSION);
  assert.equal(
    schema.properties.protocolVersion.const,
    IMPLEMENTED_PROTOCOL_VERSION,
  );

  for (const [status, outcome, exit] of resultMappings) {
    const serialized = serializeResultEnvelope(envelope(status, outcome, exit));
    assert.equal(serialized.endsWith("\n"), true);
    assert.equal(schemaAccepts(JSON.parse(serialized), schema), true, outcome);
  }
});

test("PB003-AC-002: the schema rejects contract-breaking envelopes", () => {
  const valid = envelope("pass", "success", 0);
  const invalid = [
    { ...valid, schemaVersion: "1" },
    { ...valid, protocolVersion: "0.9.0" },
    { ...valid, status: "fail" },
    { ...valid, exit: 1 },
    { ...valid, subject: "INVALID" },
    { ...valid, path: "../outside" },
    { ...valid, unknown: true },
    { ...valid, issues: [{ code: "invalid-code", message: "bad" }] },
    { ...valid, status: "fail", outcome: "REVIEW_READY", exit: 1 },
    { ...valid, status: "pass", outcome: "REVIEW_STALE", exit: 0 },
  ];

  for (const value of invalid)
    assert.equal(schemaAccepts(value, schema), false);
});

test("PB003-AC-002: every supported CLI JSON command emits schema-valid bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "praxisbound-result-schema-"));
  const target = join(root, "adopter");
  const missing = join(root, "missing");
  try {
    await mkdir(target);
    const bootstrap = spawnSync(
      join(repository, "scripts/bootstrap"),
      [target],
      {
        encoding: "utf8",
      },
    );
    assert.equal(bootstrap.status, 0, bootstrap.stderr);
    await writeFile(join(target, "Makefile"), "verify:\n\t@:\n");

    const cases = [
      ["init preview", ["init", "--dry-run", "--json", target]],
      ["init refusal", ["init", "--upgrade", "--force", "--json", target]],
      ["activation preview", ["codex", "activate", "--json", target]],
      ["activation refusal", ["codex", "activate", "--json", missing]],
      ["doctor", ["doctor", "--json", target]],
      ["doctor error", ["doctor", "--json", missing]],
      ["doctor verification", ["doctor", "--run-verify", "--json", target]],
      ["verify", ["verify", "--json", target]],
      ["verify error", ["verify", "--json", missing]],
      ["handoff", ["handoff", "check", "--json", target]],
      ["handoff error", ["handoff", "check", "--json", missing]],
      ["release", ["release", "check", "--json", target]],
      ["release usage", ["release", "check", "--json", "--unknown"]],
      ["story", ["story", "check", "--json", target]],
      ["story error", ["story", "check", "--json", missing]],
      ["verification", ["verification", "check", "--json", target]],
      ["verification error", ["verification", "check", "--json", missing]],
    ];

    for (const [label, args] of cases) {
      const execution = spawnSync(process.execPath, [bin, ...args], {
        cwd: target,
        encoding: "utf8",
        timeout: 15_000,
      });
      assert.equal(execution.error, undefined, `${label}: ${execution.error}`);
      assert.ok(execution.stdout.endsWith("\n"), `${label}: no final newline`);
      assert.equal(execution.stdout.trim().split("\n").length, 1, label);
      const result = JSON.parse(execution.stdout);
      assert.equal(schemaAccepts(result, schema), true, label);
      assert.equal(execution.status, result.exit, label);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
