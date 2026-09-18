import assert from "node:assert/strict";

import test from "node:test";

import {
  BATCH_ID,
  FENCE,
  FINGERPRINT,
  NOW,
  OTHER_FINGERPRINT,
  PAGE_LOCATORS,
  TARGET_R001,
  TARGET_R002,
  addOk,
  api,
  clone,
  createOk,
  exportOk,
  fenceLinesAnyBreak,
  hex64,
  nextRandom,
  parseOk,
  sheetFromJson,
  sheetJson,
} from "./review-annotation-support.mjs";

const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

function exportedState(overrides) {
  const added = addOk(api.emptyState(), overrides);
  return {
    state: api.markExported(added.state, [added.request.id]),
    id: added.request.id,
  };
}

function edit(state, id, changes) {
  return api.editRequest(state, id, changes, NOW + 1000, nextRandom());
}

function storedEntry(overrides) {
  return {
    ...createOk({}),
    exported: false,
    pending: false,
    ...overrides,
  };
}

function stored(requests) {
  return JSON.stringify({ requests });
}

// ---------- H1: supersedes chain ----------

test("TST023-AC-008/H1: editing twice never yields two requests superseding the same id; a superseding draft keeps its supersedes when edited", () => {
  const { state, id: a } = exportedState({ proposal: "A" });

  const first = edit(state, a, { proposal: "B" });
  assert.equal(first.ok, true, first.message);
  const b = first.request.id;
  assert.equal(first.request.supersedes, a);

  // The superseded original is no longer editable.
  assert.equal(api.canEdit(first.state, a), false);
  const again = edit(first.state, a, { proposal: "B'" });
  assert.equal(again.ok, false);
  assert.match(again.message, /已被取代/);
  assert.deepEqual(api.supersededIds(first.state), [a]);

  // Editing the not-yet-exported superseding draft is a draft edit.
  const fixed = edit(first.state, b, { proposal: "B 修正" });
  assert.equal(fixed.ok, true, fixed.message);
  assert.equal(fixed.request.id, b);
  assert.equal(fixed.request.supersedes, a);
  assert.equal(fixed.request.createdAt, first.request.createdAt);
  assert.equal(fixed.request.fingerprint, first.request.fingerprint);
  assert.equal(fixed.state.requests.length, 2);

  // After export, editing B supersedes B, not A.
  const exportedB = api.markExported(fixed.state, [b]);
  const third = edit(exportedB, b, { proposal: "C" });
  assert.equal(third.ok, true, third.message);
  assert.equal(third.request.supersedes, b);

  const sheet = parseOk(exportOk(third.state.requests)).sheet;
  const supersedes = sheet.revisions.map((r) => r.supersedes).filter(Boolean);
  assert.deepEqual(supersedes, [a, b]);

  const badges = third.state.requests.map((r) =>
    api.requestBadges(third.state, r),
  );
  assert.deepEqual(badges, [
    ["補充", "阻擋", "已取代", "已匯出"],
    ["補充", "阻擋", "已取代", "已匯出"],
    ["補充", "阻擋", "未匯出"],
  ]);
});

test("TST023-AC-008/H1: editDraft refuses exported requests; editExported refuses drafts and superseded ones", () => {
  const draft = addOk(api.emptyState(), {});
  assert.equal(
    api.editExported(draft.state, draft.request.id, {}, NOW, nextRandom()).ok,
    false,
  );
  const { state, id } = exportedState({});
  assert.equal(api.editDraft(state, id, { proposal: "x" }).ok, false);
  const next = api.editExported(
    state,
    id,
    { proposal: "x" },
    NOW,
    nextRandom(),
  );
  assert.equal(next.ok, true);
  assert.equal(
    api.editExported(next.state, id, { proposal: "y" }, NOW, nextRandom()).ok,
    false,
  );
  assert.equal(
    api.editRequest(state, "REV-NOPE", {}, NOW, nextRandom()).ok,
    false,
  );
});

test("TST023-AC-005/H1: export and parse reject self, cyclic, and doubled supersedes", () => {
  const a = createOk({});
  const b = createOk({ supersedes: a.id });
  const c = createOk({ supersedes: a.id });
  const doubled = api.exportSheet({
    batchId: BATCH_ID,
    pageFingerprint: FINGERPRINT,
    requests: [a, b, c],
    now: NOW,
  });
  assert.equal(doubled.ok, false);
  assert.match(doubled.message, /同時被/);

  const json = sheetJson(exportOk([a]));
  const self = clone(json);
  self.revisions[0].supersedes = a.id;
  assert.equal(
    api.parseSheet(sheetFromJson(self), { batchId: BATCH_ID }).ok,
    false,
  );

  const x = createOk({});
  const y = createOk({});
  const cycle = clone(json);
  cycle.revisions = [
    { ...sheetJson(exportOk([x])).revisions[0], supersedes: y.id },
    { ...sheetJson(exportOk([y])).revisions[0], supersedes: x.id },
  ];
  const cyclic = api.parseSheet(sheetFromJson(cycle), { batchId: BATCH_ID });
  assert.equal(cyclic.ok, false);
  assert.match(cyclic.message, /循環/);

  // Restoring a sheet whose request supersedes an id a local request
  // already supersedes is a conflict, not a silent second successor.
  const local = { requests: [{ ...b, exported: false, pending: false }] };
  const incoming = parseOk(exportOk([c])).sheet;
  const restored = api.restore(local, incoming, FINGERPRINT, PAGE_LOCATORS);
  assert.equal(restored.ok, false);
  assert.equal(restored.state, local);
});

// ---------- M4: pending requests keep their quote and status ----------

test("TST023-AC-007/M4: editing a pending request keeps its original targets, quote, and pending status", () => {
  const stale = createOk({
    targets: [{ ...TARGET_R001, blockSha256: hex64("old") }],
    quote: "舊原文",
  });
  const restored = api.restore(
    api.emptyState(),
    parseOk(exportOk([stale])).sheet,
    FINGERPRINT,
    PAGE_LOCATORS,
  ).state;
  assert.equal(restored.requests[0].pending, true);

  const edited = edit(restored, stale.id, {
    proposal: "新提案",
    quote: "頁面上重算的文字",
    targets: [TARGET_R002],
  });
  assert.equal(edited.ok, true, edited.message);
  assert.equal(edited.request.supersedes, stale.id);
  assert.equal(edited.request.quote, "舊原文");
  assert.deepEqual(edited.request.targets, stale.targets);
  assert.equal(edited.request.pending, true);
  assert.equal(api.groupPendingRequests(edited.state).pending.length, 2);

  const redraft = api.editDraft(edited.state, edited.request.id, {
    rationale: "再修",
    quote: "又一次重算",
  });
  assert.equal(redraft.ok, true, redraft.message);
  assert.equal(redraft.request.quote, "舊原文");
  assert.equal(redraft.request.pending, true);
  assert.equal(redraft.request.rationale, "再修");
});

// ---------- H3: export limits and marking ----------

test("TST023-AC-010/H3: an export over any §13 limit fails with a clear message and marks nothing", () => {
  let state = api.emptyState();
  const big = "漢".repeat(21000);
  for (let i = 0; i < 20; i++) {
    state = addOk(state, { proposal: big, rationale: big }).state;
  }
  const snapshot = clone(state);
  const oversized = api.exportSheet({
    batchId: BATCH_ID,
    pageFingerprint: FINGERPRINT,
    requests: state.requests,
    now: NOW,
  });
  assert.equal(oversized.ok, false);
  assert.match(oversized.message, /大小上限/);
  assert.equal(oversized.text, undefined);
  assert.deepEqual(state, snapshot);
  assert.equal(api.unexportedCount(state), 20);

  const many = Array.from({ length: 1001 }, () => createOk({}));
  const tooMany = api.exportSheet({
    batchId: BATCH_ID,
    pageFingerprint: FINGERPRINT,
    requests: many,
    now: NOW,
  });
  assert.equal(tooMany.ok, false);
  assert.match(tooMany.message, /修訂數量超過上限/);

  const ok = api.exportSheet({
    batchId: BATCH_ID,
    pageFingerprint: FINGERPRINT,
    requests: state.requests.slice(0, 2),
    now: NOW,
  });
  assert.equal(ok.ok, true);
  assert.deepEqual(
    ok.ids,
    state.requests.slice(0, 2).map((r) => r.id),
  );
  const marked = api.markExported(state, ok.ids);
  assert.equal(api.unexportedCount(marked), 18);
  assert.deepEqual(state, snapshot, "markExported never mutates its input");
});

// ---------- H4: loadState validates and quarantines ----------

test("TST023-AC-010/H4: loadState quarantines every hostile stored value and never throws", () => {
  const hostile = {
    malformedJson: "{not json",
    nullEntry: stored([null]),
    emptyEntry: stored([{}]),
    topLevelArray: JSON.stringify([{}]),
    requestsNotArray: JSON.stringify({ requests: "x" }),
    extraTopKey: JSON.stringify({ requests: [], extra: 1 }),
    targetsString: stored([storedEntry({ targets: "abc" })]),
    selectorBreakingId: stored([storedEntry({ id: '"]' })]),
    fenceInId: stored([storedEntry({ id: `REV-X\n${FENCE}` })]),
    fenceInKind: stored([storedEntry({ kind: `supplement\n${FENCE}` })]),
    fenceInSupersedes: stored([storedEntry({ supersedes: `REV-X\n${FENCE}` })]),
    exportedNotBoolean: stored([storedEntry({ exported: "yes" })]),
    pendingMissing: stored([{ ...createOk({}), exported: false }]),
    locatorExtraKey: stored([
      storedEntry({ targets: [{ ...TARGET_R001, extra: 1 }] }),
    ]),
    tooDeep: "[".repeat(40) + "]".repeat(40),
  };
  for (const [name, raw] of Object.entries(hostile)) {
    const loaded = api.loadState(raw);
    assert.equal(loaded.ok, false, name);
    assert.deepEqual(loaded.state, { requests: [] }, name);
    assert.ok(loaded.messages.length > 0, name);
    const exported = api.exportSheet({
      batchId: BATCH_ID,
      pageFingerprint: FINGERPRINT,
      requests: loaded.state.requests,
      now: NOW,
    });
    assert.equal(exported.ok, true, name);
    assert.equal(fenceLinesAnyBreak(exported.text), 1, name);
  }
  assert.deepEqual(api.loadState(null), {
    ok: true,
    state: { requests: [] },
    messages: [],
  });
});

test("TST023-AC-010/H4: loadState keeps valid entries and quarantines duplicates, self and cyclic supersedes", () => {
  const good = storedEntry({});
  const loaded = api.loadState(stored([good, null]));
  assert.equal(loaded.ok, false);
  assert.deepEqual(loaded.state.requests, [good]);
  assert.match(loaded.messages[0], /第 2 則/);

  const duplicate = api.loadState(stored([good, { ...good, proposal: "x" }]));
  assert.deepEqual(duplicate.state.requests, [good]);
  assert.match(duplicate.messages[0], /id 重複/);

  const self = api.loadState(stored([{ ...good, supersedes: good.id }]));
  assert.deepEqual(self.state.requests, []);

  const x = storedEntry({});
  const y = storedEntry({});
  const cycle = api.loadState(
    stored([{ ...x, supersedes: y.id }, { ...y, supersedes: x.id }, good]),
  );
  assert.equal(cycle.ok, false);
  assert.deepEqual(cycle.state.requests, [good]);

  // A valid stored state round-trips exactly.
  const state = addOk(addOk(api.emptyState(), {}).state, {}).state;
  const saved = {};
  api.saveDraft(
    { setItem: (k, v) => (saved[k] = v) },
    "k",
    api.markExported(state, [state.requests[0].id]),
  );
  const reloaded = api.loadState(saved.k);
  assert.equal(reloaded.ok, true);
  assert.deepEqual(
    reloaded.state,
    api.markExported(state, [state.requests[0].id]),
  );
});

// ---------- security-M1: every line terminator ----------

test("TST023-AC-011/security-M1: lone \\r and U+2028/U+2029 in reader text or anchors never open a second fence, and restored text is newline-normalized", () => {
  const proposal = `a\r${FENCE}\rb${LINE_SEPARATOR}${FENCE}${LINE_SEPARATOR}c`;
  const rationale = `r1\r\n${FENCE}${PARAGRAPH_SEPARATOR}r2\rr3`;
  const anchor = `Rules\r${FENCE}${LINE_SEPARATOR}x`;
  const request = createOk({
    proposal,
    rationale,
    targets: [{ ...TARGET_R001, anchor }],
    quote: `q\r${FENCE}`,
  });
  // Reader text is normalized on creation: \r\n and lone \r become \n.
  assert.equal(
    request.proposal,
    `a\n${FENCE}\nb${LINE_SEPARATOR}${FENCE}${LINE_SEPARATOR}c`,
  );

  const text = exportOk([request]);
  assert.equal(fenceLinesAnyBreak(text), 1);
  assert.equal(/[\r\u2028\u2029]/.test(text), false, "only \\n line breaks");
  for (const line of text.split("\n")) {
    // Outside the one JSON line, fence text only appears behind "> ".
    if (line.includes(FENCE) && !line.startsWith("{"))
      assert.ok(line === FENCE || line.startsWith("> "), line);
  }

  // A hand-written sheet with raw \r in its JSON strings restores normalized.
  const json = sheetJson(text);
  json.revisions[0].proposal = "x\ry\r\nz";
  const parsed = parseOk(sheetFromJson(json));
  assert.equal(parsed.sheet.revisions[0].proposal, "x\ny\nz");
  assert.equal(
    parsed.sheet.revisions[0].targets[0].anchor,
    anchor,
    "locators are never rewritten",
  );
  const reexported = exportOk(parsed.sheet.revisions);
  assert.equal(fenceLinesAnyBreak(reexported), 1);
});

// ---------- §6 fences and §13 parse-side limits ----------

test("TST023-AC-010: fence rules — \\r\\n accepted; lone \\r, tilde, indented, and longer fences are not the block", () => {
  const good = exportOk([createOk({})]);
  const opts = { batchId: BATCH_ID };
  assert.equal(api.parseSheet(good.replace(/\n/g, "\r\n"), opts).ok, true);
  const variants = {
    loneCr: good.replace(/\n/g, "\r"),
    tilde: good.replace(FENCE, "~~~praxisbound-revisions"),
    indented: good.replace(FENCE, " " + FENCE),
    longer: good.replace(FENCE, "`" + FENCE),
  };
  for (const [name, text] of Object.entries(variants)) {
    const result = api.parseSheet(text, opts);
    assert.equal(result.ok, false, name);
    assert.match(result.message, /找到 0 個/, name);
  }
  const indentedClose = api.parseSheet(good.replace(/\n```$/, "\n ```"), opts);
  assert.match(indentedClose.message, /未閉合/);
  const longerClose = api.parseSheet(good.replace(/\n```$/, "\n````"), opts);
  assert.match(longerClose.message, /未閉合/);
});

test("TST023-AC-010: parse-side §13 limits — 1000 revisions, depth 32, 64 KiB strings measured in UTF-8 bytes", () => {
  const record = sheetJson(exportOk([createOk({})])).revisions[0];
  const base = sheetJson(exportOk([createOk({})]));
  const opts = { batchId: BATCH_ID };
  const withRevisions = (count) => {
    const revisions = [];
    for (let i = 0; i < count; i++)
      revisions.push({
        ...record,
        id:
          "REV-" +
          i
            .toString(32)
            .toUpperCase()
            .padStart(26, "0")
            .replace(/[ILOU]/g, "0"),
      });
    return sheetFromJson({ ...base, revisions });
  };
  assert.equal(api.parseSheet(withRevisions(1000), opts).ok, true);
  assert.match(
    api.parseSheet(withRevisions(1001), opts).message,
    /修訂數量超過上限/,
  );

  const nested = (depth) =>
    `${FENCE}\n${"[".repeat(depth)}${"]".repeat(depth)}\n\`\`\``;
  assert.match(api.parseSheet(nested(33), opts).message, /巢狀深度/);
  assert.doesNotMatch(api.parseSheet(nested(32), opts).message, /巢狀深度/);

  const withProposal = (proposal) =>
    sheetFromJson({ ...base, revisions: [{ ...record, proposal }] });
  assert.equal(api.parseSheet(withProposal("a".repeat(65536)), opts).ok, true);
  assert.match(
    api.parseSheet(withProposal("a".repeat(65537)), opts).message,
    /64 KiB/,
  );
  // 21845 × 3 bytes = 65535 bytes: inside; one more CJK char crosses the byte limit.
  assert.equal(api.parseSheet(withProposal("漢".repeat(21845)), opts).ok, true);
  assert.match(
    api.parseSheet(withProposal("漢".repeat(21846)), opts).message,
    /64 KiB/,
  );
  assert.match(
    api.parseSheet(withProposal("漢".repeat(65536)), opts).message,
    /64 KiB/,
  );
});

// ---------- H2: target quote text without page UI ----------

function textNode(value) {
  return { nodeType: 3, nodeValue: value };
}

function element(tagName, children = [], className = "") {
  children.forEach((child, i) => (child.nextSibling = children[i + 1] ?? null));
  return {
    nodeType: 1,
    tagName,
    className,
    childNodes: children,
    nextSibling: null,
  };
}

function inlineEntry() {
  return element(
    "BUTTON",
    [textNode("＋意見")],
    "pb-annotation pb-annotation-inline-add",
  );
}

function marker() {
  return element(
    "BUTTON",
    [textNode("補充・阻擋：提案")],
    "pb-annotation pb-annotation-marker",
  );
}

test("TST023-AC-005/H2: a target's quote text excludes every .pb-annotation node, and a heading target takes its section up to the next same-or-higher heading", () => {
  const item = element("LI", [
    textNode("AC-001 目標"),
    inlineEntry(),
    marker(),
  ]);
  const heading = element("H4", [textNode("Rules"), inlineEntry()]);
  const sub = element("H5", [textNode("細節"), inlineEntry()]);
  const next = element("H4", [textNode("Constraints")]);
  element("SECTION", [
    heading,
    textNode("\n"),
    element("UL", [item, element("LI", [textNode("第二項")])]),
    sub,
    element("P", [textNode("段落"), element("BR"), textNode("第二行")]),
    next,
    element("P", [textNode("不屬於 Rules")]),
  ]);

  assert.equal(api.targetDisplayText(item), "AC-001 目標");
  assert.equal(
    api.targetDisplayText(heading),
    "Rules\nAC-001 目標\n第二項\n細節\n段落\n第二行",
  );
  assert.equal(api.targetDisplayText(sub), "細節\n段落\n第二行");
  assert.equal(api.targetDisplayText(next), "Constraints\n不屬於 Rules");
  assert.equal(api.targetDisplayText(null), "");

  const quote = api.buildQuote([heading, item].map(api.targetDisplayText));
  assert.equal(quote.includes("＋意見"), false);
  assert.equal(quote.includes("pb-annotation"), false);
  assert.equal(quote.includes("提案"), false);
});

// ---------- H5: target staging is pure ----------

test("TST023-AC-004/H5: target staging functions return new arrays and never mutate", () => {
  const empty = Object.freeze([]);
  const one = api.withTarget(empty, TARGET_R001);
  assert.deepEqual(one, [TARGET_R001]);
  assert.equal(api.withTarget(one, { ...TARGET_R001 }), one);
  const two = api.toggleTarget(one, TARGET_R002);
  assert.deepEqual(two, [TARGET_R001, TARGET_R002]);
  assert.deepEqual(api.toggleTarget(two, TARGET_R001), [TARGET_R002]);
  assert.deepEqual(api.withoutTargetAt(two, 0), [TARGET_R002]);
  assert.deepEqual(one, [TARGET_R001]);
  assert.equal(api.sameTarget(TARGET_R001, { ...TARGET_R001 }), true);
  assert.equal(api.sameTarget(TARGET_R001, TARGET_R002), false);
});

test("TST023-AC-002/M6: badges carry kind, blocking, and status for every request", () => {
  const added = addOk(api.emptyState(), {
    kind: "delete",
    proposal: "",
    blocking: false,
  });
  assert.deepEqual(api.requestBadges(added.state, added.request), [
    "刪除建議",
    "非阻擋",
    "未匯出",
  ]);
  const stale = api.restore(
    api.emptyState(),
    parseOk(exportOk([createOk({ fingerprint: OTHER_FINGERPRINT })])).sheet,
    FINGERPRINT,
    PAGE_LOCATORS,
  ).state;
  assert.deepEqual(api.requestBadges(stale, stale.requests[0]), [
    "補充",
    "阻擋",
    "待比對",
    "已匯出",
  ]);
});
