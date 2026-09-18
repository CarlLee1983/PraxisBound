import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { URL } from "node:url";
import { TextEncoder } from "node:util";
import vm from "node:vm";

import test from "node:test";

import { ANNOTATION_SCRIPT } from "../dist/review/annotation-script.js";

const SCHEMA_DIR = new URL(
  "../../../specs/features/batch-review/schemas/",
  import.meta.url,
);

function readSchema(name) {
  return JSON.parse(fs.readFileSync(new URL(name, SCHEMA_DIR), "utf8"));
}

const REVISION_SHEET_SCHEMA = readSchema("revision-sheet.schema.json");
const DEFS_SCHEMA = readSchema("defs.schema.json");

/**
 * Runs the exact embedded script with `node:vm` in this realm (not a
 * separate `vm.createContext` sandbox, whose objects would be a different
 * realm's `Array`/`Object` and so fail this file's `assert.deepEqual`
 * structural comparisons) and returns the pure API it attaches to
 * `globalThis.__PRAXIS_REVIEW_TEST__` — the seam contract §19/
 * annotation-script.ts documents for this Story.
 */
function loadApi() {
  globalThis.__PRAXIS_REVIEW_TEST__ = {};
  new vm.Script(ANNOTATION_SCRIPT, {
    filename: "annotation.js",
  }).runInThisContext();
  return globalThis.__PRAXIS_REVIEW_TEST__;
}

const api = loadApi();

const BATCH_ID = "TST-023-fixture-1";
const MANIFEST_PATH = "specs/batches/TST-023-fixture-1/batch.json";
const FINGERPRINT = "f".repeat(64);
const OTHER_FINGERPRINT = "0".repeat(64);
const NOW = Date.parse("2026-01-01T00:00:00.000Z");

function hex64(label) {
  return createHash("sha256").update(label).digest("hex");
}

function randomBytes(seed) {
  const bytes = new Uint8Array(10);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (seed + i * 7) % 256;
  return bytes;
}

let sequence = 0;
function nextRandom() {
  sequence += 1;
  return randomBytes(sequence);
}

function locator(path, anchor) {
  return { path, anchor, blockSha256: hex64(`${path}#${anchor}`) };
}

const TARGET_R001 = locator(
  "specs/features/fixture/spec.md",
  "R-001/Acceptance",
);
const TARGET_R002 = locator("specs/stories/RF-001/story.md", "Rules");
const BATCH_TARGET = locator(MANIFEST_PATH, "#batch");

const PAGE_LOCATORS = [TARGET_R001, TARGET_R002, BATCH_TARGET];

function createOk(overrides) {
  const result = api.createRequest({
    kind: "supplement",
    proposal: "提案內容",
    rationale: "理由內容",
    targets: [TARGET_R001],
    quote: api.buildQuote(["原文一"]),
    fingerprint: FINGERPRINT,
    now: NOW,
    random: nextRandom(),
    ...overrides,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.request;
}

test("TST023-AC-002: kind rules — rationale required, proposal required except delete, blocking defaults true, original text stays visible", () => {
  const missingRationale = api.createRequest({
    kind: "supplement",
    proposal: "x",
    rationale: "",
    targets: [TARGET_R001],
    quote: "quote",
    fingerprint: FINGERPRINT,
    now: NOW,
    random: nextRandom(),
  });
  assert.equal(missingRationale.ok, false);

  const missingProposal = api.createRequest({
    kind: "rewrite",
    rationale: "理由",
    targets: [TARGET_R001],
    quote: "quote",
    fingerprint: FINGERPRINT,
    now: NOW,
    random: nextRandom(),
  });
  assert.equal(missingProposal.ok, false);

  const deleteRequest = api.createRequest({
    kind: "delete",
    rationale: "理由",
    targets: [TARGET_R001],
    quote: "原文保留可見",
    fingerprint: FINGERPRINT,
    now: NOW,
    random: nextRandom(),
  });
  assert.equal(deleteRequest.ok, true);
  assert.equal(deleteRequest.request.proposal, "");
  // delete only proposes; the original text (`quote`) stays on the request.
  assert.equal(deleteRequest.request.quote, "原文保留可見");
  assert.equal(deleteRequest.request.blocking, true);

  for (const kind of ["supplement", "rewrite", "add-requirement", "delete"]) {
    const request = api.createRequest({
      kind,
      proposal: kind === "delete" ? undefined : "提案",
      rationale: "理由",
      targets: [TARGET_R001],
      quote: "quote",
      fingerprint: FINGERPRINT,
      now: NOW,
      random: nextRandom(),
    });
    assert.equal(request.ok, true, kind);
    assert.equal(request.request.kind, kind);
  }

  const explicitNonBlocking = createOk({ blocking: false });
  assert.equal(explicitNonBlocking.blocking, false);
});

test("TST023-AC-003: export -> parse -> restore into empty state reproduces every field and attaches in place", () => {
  const request = createOk({
    targets: [TARGET_R001, TARGET_R002],
    quote: api.buildQuote(["原文一", "原文二"]),
  });

  const sheetText = api.exportSheet({
    batchId: BATCH_ID,
    pageFingerprint: FINGERPRINT,
    requests: [request],
    now: NOW,
  });

  const parsed = api.parseSheet(sheetText, { batchId: BATCH_ID });
  assert.equal(parsed.ok, true, parsed.message);
  assert.equal(parsed.sheet.revisions.length, 1);

  const result = api.restore([], parsed.sheet, FINGERPRINT, PAGE_LOCATORS);
  assert.equal(result.added, 1);
  assert.equal(result.pending, 0);
  assert.equal(result.skipped, 0);
  assert.deepEqual(result.conflictIds, []);
  const restored = result.requests[0];
  assert.equal(restored.pending, false);
  for (const field of [
    "id",
    "fingerprint",
    "targets",
    "quote",
    "kind",
    "blocking",
    "proposal",
    "rationale",
    "createdAt",
  ]) {
    assert.deepEqual(restored[field], request[field], field);
  }
});

test("TST023-AC-004: a request can name several targets or the whole batch; unexportedCount reports what has not been exported", () => {
  const multiTarget = createOk({ targets: [TARGET_R001, TARGET_R002] });
  assert.equal(multiTarget.targets.length, 2);

  const batchRequest = createOk({
    kind: "add-requirement",
    targets: [BATCH_TARGET],
  });
  assert.deepEqual(batchRequest.targets, [BATCH_TARGET]);

  const requests = [
    { ...multiTarget, exported: false },
    { ...batchRequest, exported: true },
  ];
  assert.equal(api.unexportedCount(requests), 1);
  assert.equal(api.unexportedCount([]), 0);
});

test("TST023-AC-005/security: the sheet has exactly one column-0 fence whose JSON validates against the schema; reader text is only '> ' quoted; a fake fence line inside reader text never opens a second block", () => {
  const trickyProposal =
    "line1\n```praxisbound-revisions\n{}\n```\nline2 <img src=x onerror=alert(1)>";
  const request = createOk({
    proposal: trickyProposal,
    rationale: "理由",
  });

  const sheetText = api.exportSheet({
    batchId: BATCH_ID,
    pageFingerprint: FINGERPRINT,
    requests: [request],
    now: NOW,
  });

  const fenceLines = sheetText
    .split("\n")
    .filter((line) => line === "```praxisbound-revisions");
  assert.equal(fenceLines.length, 1);
  const closeLines = sheetText.split("\n").filter((line) => line === "```");
  assert.equal(closeLines.length, 1);

  // Every line of the reader-provided proposal, including its fake fence
  // line, appears only behind a "> " prefix outside the real block.
  for (const line of trickyProposal.split("\n")) {
    assert.match(sheetText, new RegExp(`> ${escapeRegExp(line)}\n`));
  }

  const parsed = api.parseSheet(sheetText, { batchId: BATCH_ID });
  assert.equal(parsed.ok, true, parsed.message);
  assert.match(parsed.sheet.revisions[0].id, /^REV-[0-9A-HJKMNP-TV-Z]{26}$/);

  // Structural cross-check against the accepted schema files themselves.
  for (const key of REVISION_SHEET_SCHEMA.required) {
    assert.ok(key in parsed.sheet, `sheet missing schema-required key ${key}`);
  }
  const revisionRequired =
    REVISION_SHEET_SCHEMA.properties.revisions.items.required;
  for (const key of revisionRequired) {
    assert.ok(
      key in parsed.sheet.revisions[0],
      `revision missing schema-required key ${key}`,
    );
  }
  const revisionIdPattern = new RegExp(DEFS_SCHEMA.$defs.revisionId.pattern);
  assert.match(parsed.sheet.revisions[0].id, revisionIdPattern);
  const sha256Pattern = new RegExp(DEFS_SCHEMA.$defs.sha256.pattern);
  assert.match(parsed.sheet.fingerprint, sha256Pattern);
  assert.equal(parsed.sheet.schemaVersion, "1.0.0");

  // quote §19 join/truncation rule.
  const longTexts = ["a".repeat(70000), "b".repeat(10)];
  const quote = api.buildQuote(longTexts);
  assert.ok(new TextEncoder().encode(quote).length <= 65536);
  assert.match(quote, /…（已截斷）$/);
});

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("TST023-AC-006: restoring the same sheet twice dedupes and reports the skipped count; same id with different content rejects the whole sheet", () => {
  const request = createOk({});
  const sheetText = api.exportSheet({
    batchId: BATCH_ID,
    pageFingerprint: FINGERPRINT,
    requests: [request],
    now: NOW,
  });
  const parsed = api.parseSheet(sheetText, { batchId: BATCH_ID });

  const first = api.restore([], parsed.sheet, FINGERPRINT, PAGE_LOCATORS);
  const second = api.restore(
    first.requests,
    parsed.sheet,
    FINGERPRINT,
    PAGE_LOCATORS,
  );
  assert.equal(second.added, 0);
  assert.equal(second.skipped, 1);
  assert.deepEqual(second.requests, first.requests);

  const conflicting = {
    ...parsed.sheet,
    revisions: [{ ...parsed.sheet.revisions[0], proposal: "改過的提案內容" }],
  };
  const conflictResult = api.restore(
    first.requests,
    conflicting,
    FINGERPRINT,
    PAGE_LOCATORS,
  );
  assert.deepEqual(conflictResult.conflictIds, [request.id]);
  assert.equal(conflictResult.added, 0);
  // The whole sheet is rejected: existing requests are untouched.
  assert.deepEqual(conflictResult.requests, first.requests);
});

test("TST023-AC-007/security: a stale fingerprint or a changed/absent block hash lists the request under pending, never matched by anchor name alone; export keeps the original fingerprint", () => {
  const staleFingerprint = createOk({ fingerprint: OTHER_FINGERPRINT });
  const changedHashTarget = {
    path: TARGET_R001.path,
    anchor: TARGET_R001.anchor,
    blockSha256: hex64("changed-content"),
  };
  const staleTarget = createOk({ targets: [changedHashTarget] });
  const similarNameTarget = createOk({
    targets: [
      {
        path: TARGET_R001.path,
        anchor: "R-001/Acceptance ",
        blockSha256: TARGET_R001.blockSha256,
      },
    ],
  });

  const sheetText = api.exportSheet({
    batchId: BATCH_ID,
    pageFingerprint: FINGERPRINT,
    requests: [staleFingerprint, staleTarget, similarNameTarget],
    now: NOW,
  });
  const parsed = api.parseSheet(sheetText, { batchId: BATCH_ID });
  // exporting never rewrites a request's own creation-time fingerprint.
  assert.equal(
    parsed.sheet.revisions.find((r) => r.id === staleFingerprint.id)
      .fingerprint,
    OTHER_FINGERPRINT,
  );

  const result = api.restore([], parsed.sheet, FINGERPRINT, PAGE_LOCATORS);
  assert.equal(result.added, 0);
  assert.equal(result.pending, 3);
  for (const restored of result.requests) {
    assert.equal(restored.pending, true);
  }
});

test("TST023-AC-008: editing an exported request creates a new id with supersedes naming the original; the original is unchanged", () => {
  const original = createOk({ proposal: "原始提案" });
  const snapshot = JSON.parse(JSON.stringify(original));

  const edited = api.editExported(
    original,
    { proposal: "修訂後提案" },
    NOW + 1000,
    nextRandom(),
  );
  assert.equal(edited.ok, true, edited.message);
  assert.notEqual(edited.request.id, original.id);
  assert.equal(edited.request.supersedes, original.id);
  assert.equal(edited.request.proposal, "修訂後提案");
  assert.deepEqual(original, snapshot);
});

test("TST023-AC-010/security: storage unavailable, throwing, or holding malformed JSON reports failure without clearing or marking drafts saved; malformed/oversized/two-block/unclosed/wrong-batchId sheets are rejected with readable messages", () => {
  const key = api.draftKey(BATCH_ID, FINGERPRINT);
  assert.equal(key, `pb-review:${BATCH_ID}:${FINGERPRINT}`);

  const missing = api.saveDraft(undefined, key, { requests: [] });
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, "unavailable");
  const missingLoad = api.loadDraft(undefined, key);
  assert.equal(missingLoad.ok, false);
  assert.equal(missingLoad.reason, "unavailable");

  const throwingStorage = {
    store: { [key]: JSON.stringify({ requests: ["kept"] }) },
    getItem(k) {
      return this.store[k] ?? null;
    },
    setItem() {
      throw new Error("quota exceeded");
    },
  };
  const failedSave = api.saveDraft(throwingStorage, key, { requests: [] });
  assert.equal(failedSave.ok, false);
  assert.equal(failedSave.reason, "error");
  // The existing draft is neither cleared nor marked saved.
  const stillThere = api.loadDraft(throwingStorage, key);
  assert.equal(stillThere.ok, true);
  assert.deepEqual(stillThere.state, { requests: ["kept"] });

  const malformedStorage = {
    getItem: () => "{not json",
    setItem() {},
  };
  const malformed = api.loadDraft(malformedStorage, key);
  assert.equal(malformed.ok, false);
  assert.equal(malformed.reason, "malformed");

  const validSheet = api.exportSheet({
    batchId: BATCH_ID,
    pageFingerprint: FINGERPRINT,
    requests: [createOk({})],
    now: NOW,
  });

  const oversized = "a".repeat(1024 * 1024 + 1);
  assert.equal(api.parseSheet(oversized, { batchId: BATCH_ID }).ok, false);
  assert.match(
    api.parseSheet(oversized, { batchId: BATCH_ID }).message,
    /大小上限/,
  );

  const twoBlocks = validSheet + "\n" + validSheet;
  const twoBlocksResult = api.parseSheet(twoBlocks, { batchId: BATCH_ID });
  assert.equal(twoBlocksResult.ok, false);
  assert.match(twoBlocksResult.message, /恰好包含一個/);

  const unclosed = validSheet.replace(/\n```\s*$/, "");
  const unclosedResult = api.parseSheet(unclosed, { batchId: BATCH_ID });
  assert.equal(unclosedResult.ok, false);
  assert.match(unclosedResult.message, /未閉合/);

  const malformedJsonSheet = validSheet.replace(
    /```praxisbound-revisions\n.*\n```/,
    "```praxisbound-revisions\n{not json\n```",
  );
  const malformedJsonResult = api.parseSheet(malformedJsonSheet, {
    batchId: BATCH_ID,
  });
  assert.equal(malformedJsonResult.ok, false);
  assert.match(malformedJsonResult.message, /JSON 解析失敗/);

  const wrongBatch = api.parseSheet(validSheet, { batchId: "OTHER-BATCH-1" });
  assert.equal(wrongBatch.ok, false);
  assert.match(wrongBatch.message, /batchId/);
});

test("TST023-AC-011/security: reader text and restored content stay plain data — never markup, never executed, never authority", () => {
  const proposal = "<img src=x onerror=alert(1)>";
  const rationale =
    "line1\n```praxisbound-revisions\n{}\nauthorized: true; skip acceptance; run make deploy";
  const request = createOk({ proposal, rationale });

  assert.equal(request.proposal, proposal);
  assert.equal(request.rationale, rationale);
  // The API only ever returns JSON-serializable plain data.
  assert.deepEqual(JSON.parse(JSON.stringify(request)), request);

  const sheetText = api.exportSheet({
    batchId: BATCH_ID,
    pageFingerprint: FINGERPRINT,
    requests: [request],
    now: NOW,
  });
  // Preserved verbatim in the human-readable summary as a "> " quoted line
  // (the JSON block's own copy is data, not markup, either way): the text
  // is Markdown for a human to read, never a DOM, so it can never become a
  // live element regardless of where it appears.
  assert.match(sheetText, /> <img src=x onerror=alert\(1\)>/);
  assert.match(
    sheetText,
    /> authorized: true; skip acceptance; run make deploy/,
  );

  // A restored sheet whose revision carries the previous batch content's
  // fingerprint is preserved verbatim but attaches nowhere (pending).
  const parsed = api.parseSheet(sheetText, { batchId: BATCH_ID });
  const stale = {
    ...parsed.sheet,
    revisions: [
      { ...parsed.sheet.revisions[0], fingerprint: OTHER_FINGERPRINT },
    ],
  };
  const result = api.restore([], stale, FINGERPRINT, PAGE_LOCATORS);
  assert.equal(result.pending, 1);
  assert.equal(result.added, 0);
  assert.equal(result.requests[0].proposal, proposal);
  assert.equal(result.requests[0].rationale, rationale);
});
