import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { URL } from "node:url";
import vm from "node:vm";

import { ANNOTATION_SCRIPT } from "../dist/review/annotation-script.js";

const SCHEMA_DIR = new URL(
  "../../../specs/features/batch-review/schemas/",
  import.meta.url,
);

function readSchema(name) {
  return JSON.parse(fs.readFileSync(new URL(name, SCHEMA_DIR), "utf8"));
}

export const REVISION_SHEET_SCHEMA = readSchema("revision-sheet.schema.json");
export const DEFS_SCHEMA = readSchema("defs.schema.json");

/**
 * Runs the exact embedded script with `node:vm` in this realm (not a
 * separate `vm.createContext` sandbox, whose objects would be a different
 * realm's `Array`/`Object` and so fail `assert.deepEqual` structural
 * comparisons) and returns the pure API it attaches to
 * `globalThis.__PRAXIS_REVIEW_TEST__` — the seam annotation-script.ts
 * documents for this Story.
 */
export function loadApi() {
  globalThis.__PRAXIS_REVIEW_TEST__ = {};
  new vm.Script(ANNOTATION_SCRIPT, {
    filename: "annotation.js",
  }).runInThisContext();
  const api = globalThis.__PRAXIS_REVIEW_TEST__;
  delete globalThis.__PRAXIS_REVIEW_TEST__;
  return api;
}

export const api = loadApi();

export const BATCH_ID = "TST-023-fixture-1";
export const MANIFEST_PATH = "specs/batches/TST-023-fixture-1/batch.json";
export const FINGERPRINT = "f".repeat(64);
export const OTHER_FINGERPRINT = "0".repeat(64);
export const NOW = Date.parse("2026-01-01T00:00:00.000Z");
export const FENCE = "```praxisbound-revisions";

export function hex64(label) {
  return createHash("sha256").update(label).digest("hex");
}

let sequence = 0;
export function nextRandom() {
  sequence += 1;
  const bytes = new Uint8Array(10);
  for (let i = 0; i < bytes.length; i++)
    bytes[i] = (sequence * 31 + i * 7) % 256;
  return bytes;
}

export function locator(path, anchor) {
  return { path, anchor, blockSha256: hex64(`${path}#${anchor}`) };
}

export const TARGET_R001 = locator(
  "specs/features/fixture/spec.md",
  "R-001/Acceptance",
);
export const TARGET_R002 = locator("specs/stories/RF-001/story.md", "Rules");
export const BATCH_TARGET = locator(MANIFEST_PATH, "#batch");
export const PAGE_LOCATORS = [TARGET_R001, TARGET_R002, BATCH_TARGET];

export function draftInput(overrides) {
  return {
    kind: "supplement",
    proposal: "提案內容",
    rationale: "理由內容",
    targets: [TARGET_R001],
    quote: api.buildQuote(["原文一"]),
    fingerprint: FINGERPRINT,
    now: NOW,
    random: nextRandom(),
    ...overrides,
  };
}

export function createOk(overrides) {
  const result = api.createRequest(draftInput(overrides));
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.request;
}

/** Adds one draft to `state` and returns `{ state, request }`. */
export function addOk(state, overrides) {
  const result = api.addDraft(state, draftInput(overrides));
  assert.equal(result.ok, true, JSON.stringify(result.message));
  return result;
}

export function exportOk(requests, now = NOW) {
  const result = api.exportSheet({
    batchId: BATCH_ID,
    pageFingerprint: FINGERPRINT,
    requests,
    now,
  });
  assert.equal(result.ok, true, result.message);
  return result.text;
}

export function parseOk(text) {
  const parsed = api.parseSheet(text, { batchId: BATCH_ID });
  assert.equal(parsed.ok, true, parsed.message);
  return parsed;
}

/** The fenced JSON of an exported sheet, as a fresh object. */
export function sheetJson(text) {
  const lines = text.split("\n");
  return JSON.parse(lines[lines.indexOf(FENCE) + 1]);
}

export function sheetFromJson(json) {
  return `# 修訂單\n\n${FENCE}\n${JSON.stringify(json)}\n\`\`\`\n`;
}

/** Splits on every line terminator a Markdown reader or editor may honor. */
export function fenceLinesAnyBreak(text) {
  return text.split(/\r\n|\r|\n|\u2028|\u2029/).filter((line) => line === FENCE)
    .length;
}

/** A deep copy of JSON-shaped fixture data. */
export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------- A hand-written checker that walks the accepted schema files ----------

const SCHEMA_DOCUMENTS = {
  [REVISION_SHEET_SCHEMA.$id]: REVISION_SHEET_SCHEMA,
  [DEFS_SCHEMA.$id]: DEFS_SCHEMA,
};

const ANNOTATION_KEYWORDS = new Set([
  "$schema",
  "$id",
  "$defs",
  "title",
  "description",
]);

const RFC3339_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;

function isDateTime(value) {
  const match = RFC3339_DATE_TIME.exec(value);
  if (!match) return false;
  const [year, month, day, hour, minute, second] = match
    .slice(1, 7)
    .map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second);
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second
  );
}

function resolveRef(ref, document) {
  const [base, fragment] = ref.split("#");
  const target = base ? SCHEMA_DOCUMENTS[base] : document;
  assert.ok(target, `unknown schema document ${base}`);
  let node = target;
  for (const part of fragment.split("/").filter(Boolean)) node = node[part];
  assert.ok(node, `unresolved $ref ${ref}`);
  return { schema: node, document: target };
}

function typeMatches(type, value) {
  if (type === "object")
    return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "array") return Array.isArray(value);
  return typeof value === type;
}

function walk(value, schema, document, path, errors) {
  for (const key of Object.keys(schema)) {
    if (ANNOTATION_KEYWORDS.has(key)) continue;
    const rule = schema[key];
    const fail = (why) => errors.push(`${path}: ${why}`);
    switch (key) {
      case "$ref": {
        const resolved = resolveRef(rule, document);
        walk(value, resolved.schema, resolved.document, path, errors);
        break;
      }
      case "type":
        if (!typeMatches(rule, value)) fail(`type ${rule}`);
        break;
      case "const":
        if (value !== rule) fail(`const ${rule}`);
        break;
      case "enum":
        if (!rule.includes(value)) fail("enum");
        break;
      case "required":
        if (typeMatches("object", value))
          for (const name of rule)
            if (!(name in value)) fail(`missing ${name}`);
        break;
      case "properties":
        if (typeMatches("object", value))
          for (const [name, sub] of Object.entries(rule))
            if (name in value)
              walk(value[name], sub, document, `${path}.${name}`, errors);
        break;
      case "additionalProperties":
        assert.equal(rule, false, "only additionalProperties:false is used");
        if (typeMatches("object", value))
          for (const name of Object.keys(value))
            if (!(name in (schema.properties ?? {}))) fail(`extra key ${name}`);
        break;
      case "items":
        if (Array.isArray(value))
          value.forEach((item, i) =>
            walk(item, rule, document, `${path}[${i}]`, errors),
          );
        break;
      case "minItems":
        if (Array.isArray(value) && value.length < rule) fail("minItems");
        break;
      case "maxItems":
        if (Array.isArray(value) && value.length > rule) fail("maxItems");
        break;
      case "minLength":
        if (typeof value === "string" && [...value].length < rule)
          fail("minLength");
        break;
      case "maxLength":
        if (typeof value === "string" && [...value].length > rule)
          fail("maxLength");
        break;
      case "pattern":
        if (typeof value === "string" && !new RegExp(rule).test(value))
          fail(`pattern ${rule}`);
        break;
      case "format":
        assert.equal(rule, "date-time", "only format date-time is used");
        if (typeof value === "string" && !isDateTime(value)) fail("date-time");
        break;
      default:
        // An unsupported keyword must fail loudly, never be ignored.
        throw new Error(`schema checker does not support keyword ${key}`);
    }
  }
}

/** Every violation of the revision-sheet schema (with its defs), or []. */
export function schemaErrors(value) {
  const errors = [];
  walk(value, REVISION_SHEET_SCHEMA, REVISION_SHEET_SCHEMA, "$", errors);
  return errors;
}
