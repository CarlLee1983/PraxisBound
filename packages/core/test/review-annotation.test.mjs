import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { TextEncoder } from "node:util";

import test from "node:test";

import { ANNOTATION_SCRIPT } from "../dist/review/annotation-script.js";
import {
  BATCH_ID,
  BATCH_TARGET,
  DEFS_SCHEMA,
  FENCE,
  FINGERPRINT,
  MANIFEST_PATH,
  NOW,
  OTHER_FINGERPRINT,
  PAGE_LOCATORS,
  TARGET_R001,
  TARGET_R002,
  addOk,
  api,
  asLoaded,
  clone,
  createOk,
  escapeRegExp,
  exportOk,
  hex64,
  nextRandom,
  parseOk,
  schemaErrors,
  sheetFromJson,
  sheetJson,
} from "./review-annotation-support.mjs";

test("TST023-AC-002: kind rules — rationale required, proposal required except delete, blocking defaults true, original text stays visible", () => {
  const base = {
    targets: [TARGET_R001],
    quote: "quote",
    fingerprint: FINGERPRINT,
    now: NOW,
  };
  const missingRationale = api.createRequest({
    ...base,
    kind: "supplement",
    proposal: "x",
    rationale: "",
    random: nextRandom(),
  });
  assert.equal(missingRationale.ok, false);

  const missingProposal = api.createRequest({
    ...base,
    kind: "rewrite",
    rationale: "理由",
    random: nextRandom(),
  });
  assert.equal(missingProposal.ok, false);

  const deleteRequest = api.createRequest({
    ...base,
    kind: "delete",
    rationale: "理由",
    quote: "原文保留可見",
    random: nextRandom(),
  });
  assert.equal(deleteRequest.ok, true);
  assert.equal(deleteRequest.request.proposal, "");
  // delete only proposes; the original text (`quote`) stays on the request.
  assert.equal(deleteRequest.request.quote, "原文保留可見");
  assert.equal(deleteRequest.request.blocking, true);

  for (const kind of ["supplement", "rewrite", "add-requirement", "delete"]) {
    const request = createOk({
      kind,
      proposal: kind === "delete" ? undefined : "提案",
    });
    assert.equal(request.kind, kind);
  }
  assert.equal(createOk({ blocking: false }).blocking, false);

  // Reader text over the §13 string limit is rejected, never silently cut.
  const oversized = api.createRequest({
    ...base,
    kind: "supplement",
    proposal: "a".repeat(65537),
    rationale: "理由",
    random: nextRandom(),
  });
  assert.equal(oversized.ok, false);
  assert.match(oversized.message, /64 KiB/);

  // The kind labels shown in the page come from one table.
  assert.deepEqual(api.kinds, [
    "supplement",
    "rewrite",
    "add-requirement",
    "delete",
  ]);
  assert.deepEqual(api.kinds.map(api.kindLabel), [
    "補充",
    "建議改寫",
    "新增要求",
    "刪除建議",
  ]);
});

test("TST023-AC-003: export -> parse -> restore into an empty state reproduces every field, including supersedes, and attaches in place", () => {
  const original = createOk({
    targets: [TARGET_R001, TARGET_R002],
    quote: api.buildQuote(["原文一", "原文二"]),
  });
  const superseding = createOk({ supersedes: original.id, proposal: "新版" });

  const parsed = parseOk(exportOk([original, superseding]));
  assert.equal(parsed.sheet.revisions.length, 2);

  const result = api.restore(
    api.emptyState(),
    parsed.sheet,
    FINGERPRINT,
    PAGE_LOCATORS,
  );
  assert.equal(result.ok, true);
  assert.equal(result.added, 2);
  assert.equal(result.pending, 0);
  assert.equal(result.skipped, 0);
  const [restored, restoredSuperseding] = result.state.requests;
  assert.equal(restored.pending, false);
  assert.equal(restored.exported, true);
  for (const field of Object.keys(original)) {
    assert.deepEqual(restored[field], original[field], field);
  }
  assert.equal(restoredSuperseding.supersedes, original.id);
  assert.deepEqual(api.supersededIds(result.state), [original.id]);
});

test("TST023-AC-004: a request can name several targets or the whole batch; unexportedCount reports what has not been exported", () => {
  let state = api.emptyState();
  const multi = addOk(state, { targets: [TARGET_R001, TARGET_R002] });
  state = multi.state;
  const batch = addOk(state, {
    kind: "add-requirement",
    targets: [BATCH_TARGET],
  });
  state = batch.state;
  assert.equal(multi.request.targets.length, 2);
  assert.deepEqual(batch.request.targets, [BATCH_TARGET]);
  assert.equal(api.unexportedCount(state), 2);
  state = api.markExported(state, [batch.request.id]);
  assert.equal(api.unexportedCount(state), 1);
  assert.equal(api.unexportedCount(api.emptyState()), 0);

  assert.deepEqual(api.batchLocator(MANIFEST_PATH, hex64(FINGERPRINT)), {
    path: MANIFEST_PATH,
    anchor: "#batch",
    blockSha256: hex64(FINGERPRINT),
  });
  const bytes = createHash("sha256").update(FINGERPRINT).digest();
  assert.equal(api.bytesToHex(new Uint8Array(bytes)), bytes.toString("hex"));
});

test("TST023-AC-005/security: the sheet has exactly one column-0 fence whose JSON satisfies every schema constraint; reader text is only '> ' quoted", () => {
  const trickyProposal =
    "line1\n```praxisbound-revisions\n{}\n```\nline2 <img src=x onerror=alert(1)>";
  const request = createOk({ proposal: trickyProposal, rationale: "理由" });
  const sheetText = exportOk([request]);

  const lines = sheetText.split("\n");
  assert.equal(lines.filter((line) => line === FENCE).length, 1);
  assert.equal(lines.filter((line) => line === "```").length, 1);
  for (const line of trickyProposal.split("\n")) {
    assert.match(sheetText, new RegExp(`> ${escapeRegExp(line)}\n`));
  }

  // Walk the accepted schema files themselves, constraint by constraint.
  const json = sheetJson(sheetText);
  assert.deepEqual(schemaErrors(json), []);
  assert.match(
    json.revisions[0].id,
    new RegExp(DEFS_SCHEMA.$defs.revisionId.pattern),
  );

  // The checker is not vacuous: it catches each schema constraint.
  const broken = clone(json);
  broken.extra = 1;
  broken.revisions[0].targets[0].extra = 1;
  broken.revisions[0].targets[0].path = "a/".repeat(600) + "b";
  broken.revisions[0].createdAt = "2026-02-30T00:00:00Z";
  broken.revisions[0].kind = "approve";
  const errors = schemaErrors(broken).join("\n");
  for (const expected of [
    "$: extra key extra",
    "targets[0]: extra key extra",
    "targets[0].path: maxLength",
    "createdAt: date-time",
    "kind: enum",
  ]) {
    assert.ok(errors.includes(expected), `${expected} in\n${errors}`);
  }

  // quote §19 join/truncation rule.
  assert.equal(api.buildQuote(["一", "二"]), "一\n---\n二");
  const quote = api.buildQuote(["a".repeat(70000), "b".repeat(10)]);
  assert.ok(new TextEncoder().encode(quote).length <= 65536);
  assert.match(quote, /…（已截斷）$/);
  const emoji = api.buildQuote(["😀".repeat(20000)]);
  assert.ok(new TextEncoder().encode(emoji).length <= 65536);
  assert.equal(emoji.includes("\uFFFD"), false);
  assert.match(emoji, /^(😀)+…（已截斷）$/u);
});

test("TST023-AC-005/M1: parseSheet rejects everything the schema rejects — extra keys at every level, path length, batchId, real UTC date-times", () => {
  const json = sheetJson(exportOk([createOk({})]));
  const mutations = {
    topExtraKey: (d) => (d.extra = 1),
    revisionExtraKey: (d) => (d.revisions[0].extra = 1),
    locatorExtraKey: (d) => (d.revisions[0].targets[0].extra = 1),
    pathTooLong: (d) =>
      (d.revisions[0].targets[0].path = "a/".repeat(512) + "b"),
    anchorTooLong: (d) =>
      (d.revisions[0].targets[0].anchor = "錨".repeat(1025)),
    emptyAnchor: (d) => (d.revisions[0].targets[0].anchor = ""),
    impossibleDate: (d) => (d.revisions[0].createdAt = "2026-99-99T99:99:99Z"),
    february30: (d) => (d.revisions[0].createdAt = "2026-02-30T00:00:00Z"),
    offsetTime: (d) => (d.revisions[0].createdAt = "2026-01-01T00:00:00+08:00"),
    badExportedAt: (d) => (d.exportedAt = "2026-13-01T00:00:00Z"),
    batchIdTooLong: (d) => (d.batchId = "TST-1-" + "a".repeat(123)),
    kind: (d) => (d.revisions[0].kind = "approve"),
    blockingString: (d) => (d.revisions[0].blocking = "true"),
    tooManyTargets: (d) =>
      (d.revisions[0].targets = Array.from({ length: 101 }, () => TARGET_R001)),
    noTargets: (d) => (d.revisions[0].targets = []),
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    const data = clone(json);
    mutate(data);
    const result = api.parseSheet(sheetFromJson(data), {
      batchId: name === "batchIdTooLong" ? data.batchId : BATCH_ID,
    });
    assert.equal(result.ok, false, name);
    assert.notDeepEqual(
      schemaErrors(data),
      [],
      `${name} is a schema violation`,
    );
  }

  // Forms the schema accepts stay accepted.
  for (const createdAt of [
    "2026-01-01T00:00:00Z",
    "2026-01-01T00:00:00.5Z",
    "2024-02-29T23:59:59.999Z",
  ]) {
    const data = clone(json);
    data.revisions[0].createdAt = createdAt;
    assert.deepEqual(schemaErrors(data), []);
    assert.equal(
      api.parseSheet(sheetFromJson(data), { batchId: BATCH_ID }).ok,
      true,
      createdAt,
    );
  }
});

test("TST023-AC-006/M2/M3: restoring the same sheet twice dedupes; same id with different content rejects the whole sheet; duplicate ids inside one sheet are deduped or rejected", () => {
  const request = createOk({});
  const parsed = parseOk(exportOk([request]));

  const first = api.restore(
    api.emptyState(),
    parsed.sheet,
    FINGERPRINT,
    PAGE_LOCATORS,
  );
  const second = api.restore(
    first.state,
    parsed.sheet,
    FINGERPRINT,
    PAGE_LOCATORS,
  );
  assert.equal(second.ok, true);
  assert.equal(second.added, 0);
  assert.equal(second.skipped, 1);
  assert.deepEqual(second.state, first.state);

  const conflicting = {
    ...parsed.sheet,
    revisions: [{ ...parsed.sheet.revisions[0], proposal: "改過的提案內容" }],
  };
  const conflict = api.restore(
    first.state,
    conflicting,
    FINGERPRINT,
    PAGE_LOCATORS,
  );
  assert.equal(conflict.ok, false);
  assert.deepEqual(conflict.conflictIds, [request.id]);
  assert.match(conflict.message, new RegExp(request.id));
  assert.equal(conflict.state, first.state);

  // Inside one sheet: same id + same content is kept once and counted.
  const json = sheetJson(exportOk([request]));
  const twice = { ...json, revisions: [json.revisions[0], json.revisions[0]] };
  const deduped = parseOk(sheetFromJson(twice));
  assert.equal(deduped.skipped, 1);
  assert.equal(deduped.sheet.revisions.length, 1);

  // Same id + different content rejects the whole sheet, listing the id.
  const differing = {
    ...json,
    revisions: [json.revisions[0], { ...json.revisions[0], proposal: "不同" }],
  };
  const rejected = api.parseSheet(sheetFromJson(differing), {
    batchId: BATCH_ID,
  });
  assert.equal(rejected.ok, false);
  assert.deepEqual(rejected.conflictIds, [request.id]);
  assert.match(rejected.message, new RegExp(request.id));
});

test("TST023-AC-006/M3: same content is compared in canonical form — key order at every level, createdAt representation, and line endings do not matter", () => {
  const request = createOk({ proposal: "第一行\n第二行" });
  const record = sheetJson(exportOk([request])).revisions[0];
  const reordered = {
    rationale: record.rationale,
    ...record,
    targets: record.targets.map((t) => ({
      blockSha256: t.blockSha256,
      anchor: t.anchor,
      path: t.path,
    })),
  };
  assert.notEqual(JSON.stringify(reordered), JSON.stringify(record));
  assert.equal(api.sameRevisionContent(record, reordered), true);

  for (const createdAt of [
    "2026-01-01T00:00:00Z",
    "2026-01-01T00:00:00.0Z",
    "2026-01-01T00:00:00.000Z",
    "2026-01-01t00:00:00.000000Z",
  ]) {
    assert.equal(
      api.sameRevisionContent(record, { ...record, createdAt }),
      true,
      createdAt,
    );
  }
  assert.equal(
    api.sameRevisionContent(record, {
      ...record,
      createdAt: "2026-01-01T00:00:00.0001Z",
    }),
    false,
  );
  assert.equal(
    api.sameRevisionContent(record, {
      ...record,
      proposal: "第一行\r\n第二行",
    }),
    true,
  );
  assert.equal(
    api.sameRevisionContent(record, { ...record, proposal: "第一行\r第二行" }),
    true,
  );
  assert.equal(
    api.sameRevisionContent(record, { ...record, proposal: "第一行 第二行" }),
    false,
  );
  assert.equal(
    api.sameRevisionContent(record, {
      ...record,
      supersedes: request.id.replace(/.$/, "0"),
    }),
    false,
  );
  // Page flags are not content.
  assert.equal(
    api.sameRevisionContent(record, {
      ...record,
      exported: true,
      pending: true,
    }),
    true,
  );

  // Restore applies the same rule: a reordered, differently-dated copy is a skip.
  const state = api.restore(
    api.emptyState(),
    { ...sheetJson(exportOk([request])), revisions: [record] },
    FINGERPRINT,
    PAGE_LOCATORS,
  ).state;
  const again = api.restore(
    state,
    { revisions: [{ ...reordered, createdAt: "2026-01-01T00:00:00Z" }] },
    FINGERPRINT,
    PAGE_LOCATORS,
  );
  assert.equal(again.ok, true);
  assert.equal(again.skipped, 1);
});

test("TST023-AC-007/security: a stale fingerprint or a changed/absent block hash lists the request under pending, never matched by anchor name alone; export keeps the original fingerprint", () => {
  const staleFingerprint = createOk({ fingerprint: OTHER_FINGERPRINT });
  const staleTarget = createOk({
    targets: [{ ...TARGET_R001, blockSha256: hex64("changed-content") }],
  });
  const similarName = createOk({
    targets: [{ ...TARGET_R001, anchor: "R-001/Acceptance " }],
  });
  const parsed = parseOk(
    exportOk([staleFingerprint, staleTarget, similarName]),
  );
  assert.equal(
    parsed.sheet.revisions.find((r) => r.id === staleFingerprint.id)
      .fingerprint,
    OTHER_FINGERPRINT,
  );

  const result = api.restore(
    api.emptyState(),
    parsed.sheet,
    FINGERPRINT,
    PAGE_LOCATORS,
  );
  assert.equal(result.added, 0);
  assert.equal(result.pending, 3);
  for (const restored of result.state.requests)
    assert.equal(restored.pending, true);
  const groups = api.groupPendingRequests(result.state);
  assert.equal(groups.pending.length, 3);
  assert.equal(groups.attached.length, 0);

  // Re-exporting keeps each request's own creation-time fingerprint.
  const again = sheetJson(exportOk(result.state.requests));
  assert.equal(
    again.revisions.find((r) => r.id === staleFingerprint.id).fingerprint,
    OTHER_FINGERPRINT,
  );
});

test("TST023-AC-008/H1: an exported request is read-only — editing creates a new id with supersedes; the original is unchanged and no longer editable", () => {
  const added = addOk(api.emptyState(), { proposal: "原始提案" });
  const exported = api.markExported(added.state, [added.request.id]);
  const snapshot = clone(exported);

  const edited = api.editRequest(
    exported,
    added.request.id,
    { proposal: "修訂後提案" },
    NOW + 1000,
    nextRandom(),
  );
  assert.equal(edited.ok, true, edited.message);
  assert.notEqual(edited.request.id, added.request.id);
  assert.equal(edited.request.supersedes, added.request.id);
  assert.equal(edited.request.proposal, "修訂後提案");
  assert.equal(edited.request.exported, false);
  assert.deepEqual(exported, snapshot, "the prior state is never mutated");
  assert.equal(api.canEdit(edited.state, added.request.id), false);
  assert.equal(api.canEdit(edited.state, edited.request.id), true);
});

test("TST023-AC-010/security: storage unavailable or throwing reports failure without clearing drafts; malformed/oversized/two-block/unclosed/wrong-batchId sheets are rejected with readable messages", () => {
  const key = api.draftKey(BATCH_ID, FINGERPRINT);
  assert.equal(key, `pb-review:${BATCH_ID}:${FINGERPRINT}`);
  const state = addOk(api.emptyState(), {}).state;

  assert.deepEqual(api.saveDraft(undefined, key, state), {
    ok: false,
    reason: "unavailable",
  });
  assert.deepEqual(api.readDraft(undefined, key), {
    ok: false,
    reason: "unavailable",
  });

  const stored = JSON.stringify({ requests: state.requests });
  const throwingStorage = {
    store: { [key]: stored },
    getItem(k) {
      return this.store[k] ?? null;
    },
    setItem() {
      throw new Error("quota exceeded");
    },
  };
  assert.deepEqual(api.saveDraft(throwingStorage, key, api.emptyState()), {
    ok: false,
    reason: "error",
  });
  const stillThere = api.readDraft(throwingStorage, key);
  assert.equal(stillThere.raw, stored);
  assert.deepEqual(api.loadState(stillThere.raw).state, {
    requests: asLoaded(state.requests),
  });

  const readThrows = api.readDraft(
    {
      getItem() {
        throw new Error("denied");
      },
    },
    key,
  );
  assert.deepEqual(readThrows, { ok: false, reason: "error" });

  const validSheet = exportOk([createOk({})]);
  const oversized = api.parseSheet("a".repeat(1024 * 1024 + 1), {
    batchId: BATCH_ID,
  });
  assert.equal(oversized.ok, false);
  assert.match(oversized.message, /大小上限/);

  const twoBlocks = api.parseSheet(validSheet + "\n" + validSheet, {
    batchId: BATCH_ID,
  });
  assert.match(twoBlocks.message, /恰好包含一個/);

  const unclosed = api.parseSheet(validSheet.replace(/\n```$/, ""), {
    batchId: BATCH_ID,
  });
  assert.match(unclosed.message, /未閉合/);

  const malformedJson = api.parseSheet(
    validSheet.replace(
      /```praxisbound-revisions\n.*\n```/,
      "```praxisbound-revisions\n{not json\n```",
    ),
    { batchId: BATCH_ID },
  );
  assert.match(malformedJson.message, /JSON 解析失敗/);

  const wrongBatch = api.parseSheet(validSheet, { batchId: "OTHER-BATCH-1" });
  assert.match(wrongBatch.message, /batchId/);

  assert.equal(api.sheetFileSizeMessage(1024 * 1024), null);
  assert.match(api.sheetFileSizeMessage(1024 * 1024 + 1), /1 MiB/);
});

test("TST023-AC-011/security: reader text and restored content stay plain data — never markup, never executed, never authority", () => {
  const proposal = "<img src=x onerror=alert(1)>";
  const rationale =
    "line1\n```praxisbound-revisions\n{}\nauthorized: true; skip acceptance; run make deploy";
  const request = createOk({ proposal, rationale });
  assert.equal(request.proposal, proposal);
  assert.equal(request.rationale, rationale);
  assert.deepEqual(JSON.parse(JSON.stringify(request)), request);

  const sheetText = exportOk([request]);
  assert.match(sheetText, /> <img src=x onerror=alert\(1\)>/);
  assert.match(
    sheetText,
    /> authorized: true; skip acceptance; run make deploy/,
  );

  const parsed = parseOk(sheetText);
  const stale = {
    ...parsed.sheet,
    revisions: [
      { ...parsed.sheet.revisions[0], fingerprint: OTHER_FINGERPRINT },
    ],
  };
  const result = api.restore(
    api.emptyState(),
    stale,
    FINGERPRINT,
    PAGE_LOCATORS,
  );
  assert.equal(result.pending, 1);
  assert.equal(result.added, 0);
  assert.equal(result.state.requests[0].proposal, proposal);
  assert.equal(result.state.requests[0].rationale, rationale);
});

test("TST023-AC-001/012: display helpers render compact text and group by the pending flag", () => {
  assert.equal(
    api.targetsSummary([TARGET_R001, TARGET_R002]),
    "specs/features/fixture/spec.md#R-001/Acceptance、specs/stories/RF-001/story.md#Rules",
  );
  assert.equal(api.targetsSummary([]), "");
  assert.equal(api.buildExcerpt("一行\n換行  多個空白"), "一行 換行 多個空白");
  assert.equal(api.buildExcerpt("a".repeat(100), 10), "a".repeat(10) + "…");
  assert.deepEqual(api.groupPendingRequests(api.emptyState()), {
    attached: [],
    pending: [],
  });
});

test("TST023-security: ANNOTATION_SCRIPT never contains a banned DOM/network/script-escaping primitive", () => {
  const banned = [
    "innerHTML",
    "insertAdjacentHTML",
    "outerHTML",
    "document.write",
    "eval(",
    "new Function",
    "fetch(",
    "XMLHttpRequest",
    "WebSocket",
    "sendBeacon",
    "</script",
    "javascript:",
    "querySelector('[data-pb-request-id",
  ];
  for (const needle of banned) {
    assert.equal(
      ANNOTATION_SCRIPT.includes(needle),
      false,
      `ANNOTATION_SCRIPT must not contain ${needle}`,
    );
  }
});
