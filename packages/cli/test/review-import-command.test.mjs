import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { validateResultEnvelope } from "@praxisbound/core";

import { runReviewImport } from "../dist/review-import.js";
import { ANNOTATION_SCRIPT } from "../../core/dist/review/annotation-script.js";
import vm from "node:vm";

import {
  cleanupWorkspace,
  fixtureRepo,
  indexData,
  nextRevisionId,
  r001BlockSha256,
  revision,
  sha256Hex,
  sheetText,
  specText,
} from "./review-import-respond-support.mjs";

function loadPageApi() {
  globalThis.__PRAXIS_REVIEW_TEST__ = {};
  new vm.Script(ANNOTATION_SCRIPT, {
    filename: "annotation.js",
  }).runInThisContext();
  const api = globalThis.__PRAXIS_REVIEW_TEST__;
  delete globalThis.__PRAXIS_REVIEW_TEST__;
  return api;
}

const pageApi = loadPageApi();

async function run(root, args) {
  const execution = await runReviewImport(args, root);
  assert.deepEqual(validateResultEnvelope(execution.result), {
    ok: true,
    value: execution.result,
  });
  return execution;
}

async function recordsFor(root, batchId) {
  const dir = join(root, "specs", "batches", batchId, "records");
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

function codes(execution) {
  return execution.result.issues.map((i) => i.code).sort();
}

test("TST024-AC-001: importing a valid Revision Sheet writes its block JSON verbatim and returns success", async () => {
  const batchId = "TST-9241-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const data = await indexData(root, manifestPath);
    const blockSha256 = r001BlockSha256(data);
    const rev = revision({
      fingerprint: data.fingerprint,
      targets: [
        {
          path: "specs/features/fixture/spec.md",
          anchor: "R-001",
          blockSha256,
        },
      ],
    });
    const text = sheetText(batchId, data.fingerprint, [rev]);
    const sheetFile = join(root, "..", "sheet.md");
    await writeFile(sheetFile, text);

    const execution = await run(root, [manifestPath, sheetFile, "--json"]);
    assert.equal(execution.result.outcome, "success");
    assert.equal(execution.result.exit, 0);
    assert.equal(execution.result.data.revisions.length, 1);
    assert.equal(execution.result.data.revisions[0].id, rev.id);
    assert.equal(execution.result.data.revisions[0].status, "new");

    const record = execution.result.data.sheet.record;
    assert.ok(record.startsWith(`specs/batches/${batchId}/records/revisions-`));
    const expectedSha = createHash("sha256")
      .update(sheetBlockText(text), "utf8")
      .digest("hex");
    assert.equal(execution.result.data.sheet.sha256, expectedSha);
    assert.ok(record.includes(expectedSha.slice(0, 12)));

    const written = await readFile(join(root, record), "utf8");
    assert.equal(written, sheetBlockText(text));
  } finally {
    await cleanupWorkspace(root);
  }
});

function sheetBlockText(markdown) {
  const lines = markdown.split("\n");
  const open = lines.findIndex(
    (l) => l.replace(/\r$/, "") === "```praxisbound-revisions",
  );
  const close = lines.findIndex(
    (l, i) => i > open && l.replace(/\r$/, "") === "```",
  );
  return lines.slice(open + 1, close).join("\n");
}

test("TST024-AC-002: every target reports match, hash-mismatch, anchor-missing, or anchor-duplicate, including an out-of-batch path and #batch", async () => {
  const batchId = "TST-9242-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const data = await indexData(root, manifestPath);
    const blockSha256 = r001BlockSha256(data);
    const batchBlockSha256 = sha256Hex(data.fingerprint);
    const rev = revision({
      fingerprint: data.fingerprint,
      targets: [
        {
          path: "specs/features/fixture/spec.md",
          anchor: "R-001",
          blockSha256,
        },
        {
          path: "specs/features/fixture/spec.md",
          anchor: "R-001",
          blockSha256: "0".repeat(64),
        },
        {
          path: "specs/features/outside.md",
          anchor: "R-999",
          blockSha256: "1".repeat(64),
        },
        { path: manifestPath, anchor: "#batch", blockSha256: batchBlockSha256 },
      ],
    });
    const text = sheetText(batchId, data.fingerprint, [rev]);
    const sheetFile = join(root, "..", "sheet.md");
    await writeFile(sheetFile, text);

    const execution = await run(root, [manifestPath, sheetFile, "--json"]);
    assert.equal(execution.result.outcome, "success");
    const targets = execution.result.data.revisions[0].targets;
    assert.equal(targets[0].match, "match");
    assert.equal(targets[1].match, "hash-mismatch");
    assert.equal(targets[2].match, "anchor-missing");
    assert.equal(targets[3].match, "match");
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST024-AC-004 / TST024-AC-007: repeat import dedupes, a later sheet with new items writes once, conflicting content is rejected, and a stale fingerprint is still written", async () => {
  const batchId = "TST-9244-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const data = await indexData(root, manifestPath);
    const blockSha256 = r001BlockSha256(data);
    const targets = [
      { path: "specs/features/fixture/spec.md", anchor: "R-001", blockSha256 },
    ];
    const first = revision({ fingerprint: data.fingerprint, targets });
    const sheet1 = sheetText(batchId, data.fingerprint, [first]);
    const sheetFile1 = join(root, "..", "sheet1.md");
    await writeFile(sheetFile1, sheet1);
    const firstImport = await run(root, [manifestPath, sheetFile1, "--json"]);
    assert.equal(firstImport.result.outcome, "success");
    assert.equal(firstImport.result.data.revisions[0].status, "new");

    // Re-importing the identical sheet writes nothing and reports duplicate.
    const repeatImport = await run(root, [manifestPath, sheetFile1, "--json"]);
    assert.equal(repeatImport.result.outcome, "success");
    assert.deepEqual(codes(repeatImport), ["REVIEW_REVISION_DUPLICATE"]);
    const recordsAfterRepeat = await recordsFor(root, batchId);
    assert.equal(
      recordsAfterRepeat.filter((n) => n.startsWith("revisions-")).length,
      1,
    );

    // A stale, superseded-free second sheet with the old id plus a genuinely new one imports once.
    const stale = revision({ fingerprint: "0".repeat(64), targets });
    const sheet2 = sheetText(batchId, data.fingerprint, [first, stale]);
    const sheetFile2 = join(root, "..", "sheet2.md");
    await writeFile(sheetFile2, sheet2);
    const secondImport = await run(root, [manifestPath, sheetFile2, "--json"]);
    assert.equal(secondImport.result.outcome, "success");
    const statuses = Object.fromEntries(
      secondImport.result.data.revisions.map((r) => [r.id, r.status]),
    );
    assert.equal(statuses[first.id], "duplicate");
    assert.equal(statuses[stale.id], "new");
    assert.deepEqual(codes(secondImport), ["REVIEW_REVISION_STALE_TARGET"]);
    assert.equal(secondImport.result.issues[0].subject, `revision:${stale.id}`);
    const recordsAfterSecond = await recordsFor(root, batchId);
    assert.equal(
      recordsAfterSecond.filter((n) => n.startsWith("revisions-")).length,
      2,
    );

    // Same id, different content: reject the whole sheet, no write.
    const conflicting = revision({
      ...first,
      id: first.id,
      proposal: "a different proposal",
    });
    const sheet3 = sheetText(batchId, data.fingerprint, [conflicting]);
    const sheetFile3 = join(root, "..", "sheet3.md");
    await writeFile(sheetFile3, sheet3);
    const conflictImport = await run(root, [
      manifestPath,
      sheetFile3,
      "--json",
    ]);
    assert.equal(conflictImport.result.outcome, "failure");
    assert.deepEqual(codes(conflictImport), ["REVIEW_REVISION_CONFLICT"]);
    const recordsAfterConflict = await recordsFor(root, batchId);
    assert.equal(
      recordsAfterConflict.filter((n) => n.startsWith("revisions-")).length,
      2,
    );
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST024-AC-006: after dedupe only new revisions have supersedes checked; a missing or already-superseded target is rejected", async () => {
  const batchId = "TST-9246-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const data = await indexData(root, manifestPath);
    const blockSha256 = r001BlockSha256(data);
    const targets = [
      { path: "specs/features/fixture/spec.md", anchor: "R-001", blockSha256 },
    ];

    const x = revision({ fingerprint: data.fingerprint, targets });
    const y = revision({
      fingerprint: data.fingerprint,
      targets,
      supersedes: x.id,
    });
    const sheet1 = sheetText(batchId, data.fingerprint, [x, y]);
    const sheetFile1 = join(root, "..", "sheet1.md");
    await writeFile(sheetFile1, sheet1);
    const firstImport = await run(root, [manifestPath, sheetFile1, "--json"]);
    assert.equal(firstImport.result.outcome, "success");

    // A second sheet repeats X and Y (both dedupe) plus Z, which supersedes an already-superseded X: rejected.
    const z = revision({
      fingerprint: data.fingerprint,
      targets,
      supersedes: x.id,
    });
    const sheet2 = sheetText(batchId, data.fingerprint, [x, y, z]);
    const sheetFile2 = join(root, "..", "sheet2.md");
    await writeFile(sheetFile2, sheet2);
    const rejected = await run(root, [manifestPath, sheetFile2, "--json"]);
    assert.equal(rejected.result.outcome, "failure");
    assert.deepEqual(codes(rejected), ["REVIEW_REVISION_CONFLICT"]);
    assert.equal(rejected.result.issues[0].subject, `revision:${z.id}`);
    const recordsAfterRejected = await recordsFor(root, batchId);
    assert.equal(
      recordsAfterRejected.filter((n) => n.startsWith("revisions-")).length,
      1,
    );

    // A missing target is likewise rejected.
    const dangling = revision({
      fingerprint: data.fingerprint,
      targets,
      supersedes: nextRevisionId(),
    });
    const sheet3 = sheetText(batchId, data.fingerprint, [dangling]);
    const sheetFile3 = join(root, "..", "sheet3.md");
    await writeFile(sheetFile3, sheet3);
    const danglingResult = await run(root, [
      manifestPath,
      sheetFile3,
      "--json",
    ]);
    assert.equal(danglingResult.result.outcome, "failure");
    assert.deepEqual(codes(danglingResult), ["REVIEW_REVISION_CONFLICT"]);
    assert.equal(
      danglingResult.result.issues[0].subject,
      `revision:${dangling.id}`,
    );
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST024-AC-010 / security matrix: an oversized sheet, malformed shapes, and duplicate-id conflicts are rejected whole", async () => {
  const batchId = "TST-9250-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const data = await indexData(root, manifestPath);

    const oversized = "x".repeat(1024 * 1024 + 1);
    const oversizedFile = join(root, "..", "oversized.md");
    await writeFile(oversizedFile, oversized);
    const oversizedResult = await run(root, [
      manifestPath,
      oversizedFile,
      "--json",
    ]);
    assert.equal(oversizedResult.result.outcome, "failure");
    assert.deepEqual(codes(oversizedResult), ["REVIEW_INPUT_TOO_LARGE"]);

    const zeroBlocks = "# no fence here\n";
    const zeroFile = join(root, "..", "zero.md");
    await writeFile(zeroFile, zeroBlocks);
    const zeroResult = await run(root, [manifestPath, zeroFile, "--json"]);
    assert.equal(zeroResult.result.outcome, "failure");
    assert.deepEqual(codes(zeroResult), ["REVIEW_REVISION_SHEET_INVALID"]);

    const unclosed = "```praxisbound-revisions\n{}\n";
    const unclosedFile = join(root, "..", "unclosed.md");
    await writeFile(unclosedFile, unclosed);
    const unclosedResult = await run(root, [
      manifestPath,
      unclosedFile,
      "--json",
    ]);
    assert.equal(unclosedResult.result.outcome, "failure");
    assert.deepEqual(codes(unclosedResult), ["REVIEW_REVISION_SHEET_INVALID"]);

    const invalidJson = "```praxisbound-revisions\n{not json\n```\n";
    const invalidJsonFile = join(root, "..", "invalid-json.md");
    await writeFile(invalidJsonFile, invalidJson);
    const invalidJsonResult = await run(root, [
      manifestPath,
      invalidJsonFile,
      "--json",
    ]);
    assert.equal(invalidJsonResult.result.outcome, "failure");
    assert.deepEqual(codes(invalidJsonResult), [
      "REVIEW_REVISION_SHEET_INVALID",
    ]);
    assert.equal(
      invalidJsonResult.result.issues[0].message.includes("not json"),
      false,
      "the raw invalid JSON text must never be echoed into the issue message",
    );

    // Duplicate ids inside one sheet, different content, is a conflict listing ids.
    const blockSha256 = r001BlockSha256(data);
    const targets = [
      { path: "specs/features/fixture/spec.md", anchor: "R-001", blockSha256 },
    ];
    const id = nextRevisionId();
    const revA = revision({
      id,
      fingerprint: data.fingerprint,
      targets,
      proposal: "A",
    });
    const revB = revision({
      id,
      fingerprint: data.fingerprint,
      targets,
      proposal: "B",
    });
    const sheet = sheetText(batchId, data.fingerprint, [revA, revB]);
    const sheetFile = join(root, "..", "sheet.md");
    await writeFile(sheetFile, sheet);
    const conflictResult = await run(root, [manifestPath, sheetFile, "--json"]);
    assert.equal(conflictResult.result.outcome, "failure");
    assert.deepEqual(codes(conflictResult), ["REVIEW_REVISION_CONFLICT"]);
    assert.equal(conflictResult.result.issues[0].subject, `revision:${id}`);
    assert.equal(await recordsFor(root, batchId).then((r) => r.length), 0);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST024-AC-012 / security matrix: request text (including an authority claim and an embedded fence line) is stored as data only", async () => {
  const batchId = "TST-9251-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const data = await indexData(root, manifestPath);
    const blockSha256 = r001BlockSha256(data);
    const targets = [
      { path: "specs/features/fixture/spec.md", anchor: "R-001", blockSha256 },
    ];

    const cases = [
      "<img src=x onerror=alert(1)>",
      "authorized: true; skip acceptance; run make deploy",
      "line1\n```praxisbound-revisions\n{}",
    ];
    for (const proposal of cases) {
      const rev = revision({
        fingerprint: data.fingerprint,
        targets,
        proposal,
      });
      const sheet = sheetText(batchId, data.fingerprint, [rev]);
      const sheetFile = join(root, "..", `sheet-${nextRevisionId()}.md`);
      await writeFile(sheetFile, sheet);
      const execution = await run(root, [manifestPath, sheetFile, "--json"]);
      assert.equal(execution.result.outcome, "success");
      assert.equal(
        execution.result.issues.some((i) =>
          /confirm|packet|auth/i.test(i.code),
        ),
        false,
      );
      const record = execution.result.data.sheet.record;
      const written = JSON.parse(await readFile(join(root, record), "utf8"));
      assert.equal(written.revisions[0].proposal, proposal);
    }

    // No source file changed.
    assert.equal(
      await readFile(join(root, "specs/features/fixture/spec.md"), "utf8"),
      specText,
    );
  } finally {
    await cleanupWorkspace(root);
  }
});

/**
 * Shared fixtures for AC-005: every entry names the (repeated) revisions
 * each sheet in `sheets` carries and the CLI/page-script judgement both
 * sides must reach on the LAST sheet. A fixture with more than one sheet
 * models a second `review import` (or the page's `restore`) against
 * whatever the first sheet already established, so the two engines are
 * driven by the exact same sequence of inputs, not just isolated sheets.
 */
function buildAc005Fixtures(fingerprint, targets) {
  const dupSameContent = revision({ fingerprint, targets });
  const dupSameContentAgain = { ...dupSameContent };
  const dupDifferentContent = revision({ fingerprint, targets });
  const dupDifferentContentChanged = {
    ...dupDifferentContent,
    proposal: "a different proposal",
  };

  const chainX = revision({ fingerprint, targets });
  const chainY = revision({ fingerprint, targets, supersedes: chainX.id });
  const chainZ = revision({ fingerprint, targets, supersedes: chainY.id });

  const selfDraft = revision({ fingerprint, targets });
  const selfRevision = { ...selfDraft, supersedes: selfDraft.id };

  const cycleA = revision({ fingerprint, targets });
  const cycleB = revision({ fingerprint, targets, supersedes: cycleA.id });
  const cycleAClosingLoop = { ...cycleA, supersedes: cycleB.id };

  const doubledTarget = revision({ fingerprint, targets });
  const doubledFirst = revision({
    fingerprint,
    targets,
    supersedes: doubledTarget.id,
  });
  const doubledSecond = revision({
    fingerprint,
    targets,
    supersedes: doubledTarget.id,
  });

  const equivalentCreatedAt = revision({
    fingerprint,
    targets,
    createdAt: "2026-01-01T00:00:00Z",
    quote: "a\nb",
  });
  const equivalentCreatedAtRewritten = {
    ...equivalentCreatedAt,
    createdAt: "2026-01-01T00:00:00.000Z",
    quote: "a\r\nb",
  };

  const leapSecond = revision({
    fingerprint,
    targets,
    createdAt: "2016-12-31T23:59:60Z",
  });
  const leapSecondFollowingMinute = {
    ...leapSecond,
    createdAt: "2017-01-01T00:00:00Z",
  };

  return [
    {
      name: "in-sheet-duplicate-id-same-content-is-deduped",
      sheets: [[dupSameContent, dupSameContentAgain]],
      expectLast: { ok: true, ids: [dupSameContent.id] },
    },
    {
      name: "in-sheet-duplicate-id-different-content-is-conflict",
      sheets: [[dupDifferentContent, dupDifferentContentChanged]],
      expectLast: { ok: false, conflictIds: [dupDifferentContent.id] },
    },
    {
      name: "supersedes-chain-of-three-is-accepted",
      sheets: [[chainX, chainY, chainZ]],
      expectLast: { ok: true, ids: [chainX.id, chainY.id, chainZ.id] },
    },
    {
      name: "supersedes-self-is-conflict",
      sheets: [[selfRevision]],
      expectLast: { ok: false, conflictIds: [selfRevision.id] },
    },
    {
      name: "supersedes-cycle-is-conflict",
      sheets: [[cycleAClosingLoop, cycleB]],
      expectLast: { ok: false },
    },
    {
      name: "supersedes-doubled-target-is-conflict",
      sheets: [[doubledTarget, doubledFirst, doubledSecond]],
      expectLast: { ok: false },
    },
    {
      name: "equivalent-createdAt-and-newline-forms-across-two-sheets-dedupe",
      sheets: [[equivalentCreatedAt], [equivalentCreatedAtRewritten]],
      expectLast: { ok: true, ids: [equivalentCreatedAt.id], duplicate: true },
    },
    {
      name: "leap-second-is-a-distinct-instant-across-two-sheets-conflicts",
      sheets: [[leapSecond], [leapSecondFollowingMinute]],
      expectLast: { ok: false, conflictIds: [leapSecond.id] },
    },
  ];
}

/** Same fields, keys emitted in reverse order at every level (sheet, revision, and locator). */
function reverseKeyOrderSheetText(batchId, fingerprint, revisions, exportedAt) {
  const reverseLocator = (l) => ({
    blockSha256: l.blockSha256,
    anchor: l.anchor,
    path: l.path,
  });
  const reverseRevision = (r) => {
    const out = {};
    if (r.supersedes !== undefined) out.supersedes = r.supersedes;
    out.createdAt = r.createdAt;
    out.rationale = r.rationale;
    out.proposal = r.proposal;
    out.blocking = r.blocking;
    out.kind = r.kind;
    out.quote = r.quote;
    out.targets = r.targets.map(reverseLocator);
    out.fingerprint = r.fingerprint;
    out.id = r.id;
    return out;
  };
  const json = JSON.stringify({
    revisions: revisions.map(reverseRevision),
    exportedAt,
    fingerprint,
    batchId,
    schemaVersion: "1.0.0",
  });
  return `# Revision Sheet\n\n\`\`\`praxisbound-revisions\n${json}\n\`\`\`\n`;
}

/** The same sheet text with every line terminator rewritten to CRLF. */
function crlfSheetText(text) {
  return text.replace(/\n/g, "\r\n");
}

test("TST024-AC-005: review import reaches the same duplicate, conflict, and supersedes judgement as the TST-023 page script, across in-sheet duplicates, supersedes chains, key order, and CRLF", async () => {
  const batchId = "TST-9252-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const data = await indexData(root, manifestPath);
    const blockSha256 = r001BlockSha256(data);
    const targets = [
      { path: "specs/features/fixture/spec.md", anchor: "R-001", blockSha256 },
    ];
    const pageLocators = targets;

    const fixtures = buildAc005Fixtures(data.fingerprint, targets);

    for (const fixture of fixtures) {
      // Page side: parseSheet each sheet in turn and restore sequentially
      // into one growing state, starting empty — the same "already
      // imported, now compare a new sheet" progression `review import`
      // itself applies (contract §6, §19).
      let pageState = pageApi.emptyState();
      let lastPageParse;
      let lastPageRestore;
      for (const sheetRevisions of fixture.sheets) {
        const text = sheetText(batchId, data.fingerprint, sheetRevisions);
        lastPageParse = pageApi.parseSheet(text, { batchId });
        if (!lastPageParse.ok) break;
        lastPageRestore = pageApi.restore(
          pageState,
          lastPageParse.sheet,
          data.fingerprint,
          pageLocators,
        );
        pageState = lastPageRestore.state;
        if (!lastPageRestore.ok) break;
      }
      const pageOk =
        lastPageParse.ok && (lastPageRestore ? lastPageRestore.ok : true);
      assert.equal(pageOk, fixture.expectLast.ok, `page: ${fixture.name}`);

      // CLI side: `review import` each sheet in turn against the same root.
      let cliResult;
      for (let i = 0; i < fixture.sheets.length; i += 1) {
        const sheetFile = join(root, "..", `${fixture.name}-${i}.md`);
        await writeFile(
          sheetFile,
          sheetText(batchId, data.fingerprint, fixture.sheets[i]),
        );
        cliResult = await run(root, [manifestPath, sheetFile, "--json"]);
      }
      const cliOk = cliResult.result.outcome === "success";
      assert.equal(cliOk, fixture.expectLast.ok, `cli: ${fixture.name}`);
      assert.equal(cliOk, pageOk, `cli/page agree: ${fixture.name}`);

      if (fixture.expectLast.ok) {
        const statuses = Object.fromEntries(
          cliResult.result.data.revisions.map((r) => [r.id, r.status]),
        );
        assert.equal(
          cliResult.result.data.revisions.length,
          fixture.expectLast.ids.length,
          `cli revision count: ${fixture.name}`,
        );
        for (const id of fixture.expectLast.ids)
          assert.equal(
            statuses[id],
            fixture.expectLast.duplicate ? "duplicate" : "new",
            `cli status for ${id}: ${fixture.name}`,
          );
      } else {
        const reportedCodes = codes(cliResult);
        assert.ok(reportedCodes.length > 0, fixture.name);
        assert.ok(
          reportedCodes.every((code) => code === "REVIEW_REVISION_CONFLICT"),
          fixture.name,
        );
        if (fixture.expectLast.conflictIds) {
          const reportedIds = cliResult.result.issues
            .map((i) => i.subject)
            .sort();
          assert.deepEqual(
            reportedIds,
            fixture.expectLast.conflictIds.map((id) => `revision:${id}`).sort(),
            `cli conflict ids: ${fixture.name}`,
          );
        }
      }
    }

    // Key order at every level: the same logical revision, serialized with
    // keys in natural order and in fully reversed order, must be judged
    // identical content by both the page script and the CLI.
    {
      const rev = revision({ fingerprint: data.fingerprint, targets });
      const naturalText = sheetText(batchId, data.fingerprint, [rev]);
      const reversedText = reverseKeyOrderSheetText(
        batchId,
        data.fingerprint,
        [rev],
        "2026-09-17T08:30:00Z",
      );

      const pageNatural = pageApi.parseSheet(naturalText, { batchId });
      const pageReversed = pageApi.parseSheet(reversedText, { batchId });
      assert.equal(pageNatural.ok, true, pageNatural.message);
      assert.equal(pageReversed.ok, true, pageReversed.message);
      assert.equal(
        pageApi.sameRevisionContent(
          pageNatural.sheet.revisions[0],
          pageReversed.sheet.revisions[0],
        ),
        true,
        "key order must not change the page script's same-content judgement",
      );

      const naturalFile = join(root, "..", "key-order-natural.md");
      await writeFile(naturalFile, naturalText);
      const naturalImport = await run(root, [
        manifestPath,
        naturalFile,
        "--json",
      ]);
      assert.equal(naturalImport.result.outcome, "success");
      assert.equal(naturalImport.result.data.revisions[0].status, "new");

      const reversedFile = join(root, "..", "key-order-reversed.md");
      await writeFile(reversedFile, reversedText);
      const reversedImport = await run(root, [
        manifestPath,
        reversedFile,
        "--json",
      ]);
      assert.equal(reversedImport.result.outcome, "success");
      assert.equal(
        reversedImport.result.data.revisions[0].status,
        "duplicate",
        "key order must not change the CLI's same-content judgement",
      );
    }

    // CRLF line endings throughout the sheet file: both engines still find
    // exactly one fence and reach the same judgement.
    {
      const rev = revision({ fingerprint: data.fingerprint, targets });
      const lfText = sheetText(batchId, data.fingerprint, [rev]);
      const crlfText = crlfSheetText(lfText);

      const pageResult = pageApi.parseSheet(crlfText, { batchId });
      assert.equal(pageResult.ok, true, pageResult.message);

      const crlfFile = join(root, "..", "crlf.md");
      await writeFile(crlfFile, crlfText);
      const crlfImport = await run(root, [manifestPath, crlfFile, "--json"]);
      assert.equal(
        crlfImport.result.outcome,
        "success",
        JSON.stringify(crlfImport.result),
      );
      assert.equal(crlfImport.result.data.revisions[0].status, "new");
    }
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST024-H1: a duplicated explicit anchor reports anchor-duplicate, #document matches the whole file's hash, and #batch reports hash-mismatch when wrong", async () => {
  const batchId = "TST-9260-fixture";
  const dupSpecText =
    "## R-001：First\n\n- AC-001：line.\n\n## R-001：Second\n\n- AC-001：line.\n";
  const { root, manifestPath } = await fixtureRepo(batchId, {
    "specs/decisions/ADR-001-fixture.md":
      "# ADR-001 Fixture\n\nStatus: accepted\n",
    "specs/features/fixture/spec.md": dupSpecText,
    "specs/stories/RF-001-fixture/story.md": "# Story: RF-001 Fixture\n",
    "specs/stories/RF-001-fixture/acceptance.md":
      "# Acceptance Criteria\n\n* [ ] AC-001: done.\n",
  });
  try {
    const data = await indexData(root, manifestPath);
    const specDigest = data.sources.find(
      (s) => s.path === "specs/features/fixture/spec.md",
    ).sha256;
    const rev = revision({
      fingerprint: data.fingerprint,
      targets: [
        {
          path: "specs/features/fixture/spec.md",
          anchor: "R-001",
          blockSha256: "a".repeat(64),
        },
        {
          path: "specs/features/fixture/spec.md",
          anchor: "#document",
          blockSha256: specDigest,
        },
        {
          path: "specs/features/fixture/spec.md",
          anchor: "#document",
          blockSha256: "b".repeat(64),
        },
        { path: manifestPath, anchor: "#batch", blockSha256: "c".repeat(64) },
      ],
    });
    const text = sheetText(batchId, data.fingerprint, [rev]);
    const sheetFile = join(root, "..", "sheet.md");
    await writeFile(sheetFile, text);
    const execution = await run(root, [manifestPath, sheetFile, "--json"]);
    assert.equal(
      execution.result.outcome,
      "success",
      JSON.stringify(execution.result),
    );
    const targets = execution.result.data.revisions[0].targets;
    assert.equal(targets[0].match, "anchor-duplicate");
    assert.equal(targets[1].match, "match");
    assert.equal(targets[2].match, "hash-mismatch");
    assert.equal(targets[3].match, "hash-mismatch");
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST024-AC-006 core scenario: a first sheet importing X, then a second sheet carrying X and Y-supersedes-X, imports Y as new and dedupes X", async () => {
  const batchId = "TST-9261-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const data = await indexData(root, manifestPath);
    const blockSha256 = r001BlockSha256(data);
    const targets = [
      { path: "specs/features/fixture/spec.md", anchor: "R-001", blockSha256 },
    ];
    const x = revision({ fingerprint: data.fingerprint, targets });
    const sheet1File = join(root, "..", "sheet1.md");
    await writeFile(sheet1File, sheetText(batchId, data.fingerprint, [x]));
    const firstImport = await run(root, [manifestPath, sheet1File, "--json"]);
    assert.equal(firstImport.result.outcome, "success");
    assert.equal(firstImport.result.data.revisions[0].status, "new");

    const y = revision({
      fingerprint: data.fingerprint,
      targets,
      supersedes: x.id,
    });
    const sheet2File = join(root, "..", "sheet2.md");
    await writeFile(sheet2File, sheetText(batchId, data.fingerprint, [x, y]));
    const secondImport = await run(root, [manifestPath, sheet2File, "--json"]);
    assert.equal(
      secondImport.result.outcome,
      "success",
      JSON.stringify(secondImport.result),
    );
    const statuses = Object.fromEntries(
      secondImport.result.data.revisions.map((r) => [r.id, r.status]),
    );
    assert.equal(statuses[x.id], "duplicate");
    assert.equal(statuses[y.id], "new");
    assert.deepEqual(codes(secondImport), []);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST024-AC-010: nesting depth 33, 1001 revisions, a 64 KiB+1 string, a wrong batchId, and two fenced blocks are each rejected whole", async () => {
  const batchId = "TST-9262-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const data = await indexData(root, manifestPath);
    const blockSha256 = r001BlockSha256(data);
    const targets = [
      { path: "specs/features/fixture/spec.md", anchor: "R-001", blockSha256 },
    ];

    // Nesting depth 33 (limit is 32), scanned on the raw fenced text before JSON.parse.
    const deepJson = "[".repeat(33) + "]".repeat(33);
    const deepSheet = `# s\n\n\`\`\`praxisbound-revisions\n${deepJson}\n\`\`\`\n`;
    const deepFile = join(root, "..", "deep.md");
    await writeFile(deepFile, deepSheet);
    const deepResult = await run(root, [manifestPath, deepFile, "--json"]);
    assert.equal(deepResult.result.outcome, "failure");
    assert.deepEqual(codes(deepResult), ["REVIEW_INPUT_TOO_LARGE"]);

    // 1001 revisions (limit is 1000).
    const manyRevisions = Array.from({ length: 1001 }, () =>
      revision({ fingerprint: data.fingerprint, targets }),
    );
    const manySheet = sheetText(batchId, data.fingerprint, manyRevisions);
    const manyFile = join(root, "..", "many.md");
    await writeFile(manyFile, manySheet);
    const manyResult = await run(root, [manifestPath, manyFile, "--json"]);
    assert.equal(manyResult.result.outcome, "failure");
    assert.deepEqual(codes(manyResult), ["REVIEW_INPUT_TOO_LARGE"]);

    // A 64 KiB + 1 (UTF-8) string field.
    const overLongRationale = revision({
      fingerprint: data.fingerprint,
      targets,
      rationale: "x".repeat(65537),
    });
    const overLongSheet = sheetText(batchId, data.fingerprint, [
      overLongRationale,
    ]);
    const overLongFile = join(root, "..", "over-long.md");
    await writeFile(overLongFile, overLongSheet);
    const overLongResult = await run(root, [
      manifestPath,
      overLongFile,
      "--json",
    ]);
    assert.equal(overLongResult.result.outcome, "failure");
    assert.deepEqual(codes(overLongResult), ["REVIEW_INPUT_TOO_LARGE"]);

    // A wrong batchId.
    const wrongBatch = revision({ fingerprint: data.fingerprint, targets });
    const wrongBatchSheet = sheetText("TST-9999-other", data.fingerprint, [
      wrongBatch,
    ]);
    const wrongBatchFile = join(root, "..", "wrong-batch.md");
    await writeFile(wrongBatchFile, wrongBatchSheet);
    const wrongBatchResult = await run(root, [
      manifestPath,
      wrongBatchFile,
      "--json",
    ]);
    assert.equal(wrongBatchResult.result.outcome, "failure");
    assert.deepEqual(codes(wrongBatchResult), [
      "REVIEW_REVISION_SHEET_INVALID",
    ]);

    // Two fenced blocks.
    const singleRevision = revision({ fingerprint: data.fingerprint, targets });
    const singleSheetJson = sheetText(batchId, data.fingerprint, [
      singleRevision,
    ]);
    const twoBlocks = `${singleSheetJson}\n${singleSheetJson}`;
    const twoBlocksFile = join(root, "..", "two-blocks.md");
    await writeFile(twoBlocksFile, twoBlocks);
    const twoBlocksResult = await run(root, [
      manifestPath,
      twoBlocksFile,
      "--json",
    ]);
    assert.equal(twoBlocksResult.result.outcome, "failure");
    assert.deepEqual(codes(twoBlocksResult), ["REVIEW_REVISION_SHEET_INVALID"]);

    assert.equal(await recordsFor(root, batchId).then((r) => r.length), 0);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST024-M2: an unsupported schemaVersion is REVIEW_SCHEMA_UNSUPPORTED (failure, exit 1), checked before the unknown-key scan", async () => {
  const batchId = "TST-9263-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const data = await indexData(root, manifestPath);
    const blockSha256 = r001BlockSha256(data);
    const rev = revision({
      fingerprint: data.fingerprint,
      targets: [
        {
          path: "specs/features/fixture/spec.md",
          anchor: "R-001",
          blockSha256,
        },
      ],
    });
    const badSchemaJson = JSON.stringify({
      schemaVersion: "9.9.9",
      batchId,
      fingerprint: data.fingerprint,
      exportedAt: "2026-09-17T08:30:00Z",
      revisions: [rev],
    });
    const text = `# s\n\n\`\`\`praxisbound-revisions\n${badSchemaJson}\n\`\`\`\n`;
    const sheetFile = join(root, "..", "bad-schema.md");
    await writeFile(sheetFile, text);
    const execution = await run(root, [manifestPath, sheetFile, "--json"]);
    assert.equal(execution.result.outcome, "failure");
    assert.equal(execution.result.exit, 1);
    assert.deepEqual(codes(execution), ["REVIEW_SCHEMA_UNSUPPORTED"]);

    // A newer schemaVersion is expected to carry fields this version does
    // not recognize; the unknown field must never mask REVIEW_SCHEMA_UNSUPPORTED.
    const newerWithExtraField = JSON.stringify({
      schemaVersion: "2.0.0",
      batchId,
      fingerprint: data.fingerprint,
      exportedAt: "2026-09-17T08:30:00Z",
      revisions: [rev],
      futureField: "unknown to this version",
    });
    const newerText = `# s\n\n\`\`\`praxisbound-revisions\n${newerWithExtraField}\n\`\`\`\n`;
    const newerFile = join(root, "..", "newer-schema.md");
    await writeFile(newerFile, newerText);
    const newerExecution = await run(root, [manifestPath, newerFile, "--json"]);
    assert.equal(newerExecution.result.outcome, "failure");
    assert.equal(newerExecution.result.exit, 1);
    assert.deepEqual(codes(newerExecution), ["REVIEW_SCHEMA_UNSUPPORTED"]);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST024-AC-011 / security matrix: invalid argv, an unsafe manifest, an invalid existing revisions record naming its path, a symlinked records directory, and a write failure are all refused without a partial file", async () => {
  const batchId = "TST-9264-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const usage = await run(root, [manifestPath]);
    assert.equal(usage.result.outcome, "usage-error");
    assert.equal(usage.result.exit, 2);

    const badManifest = await run(root, ["no/such/manifest.json", "sheet.md"]);
    assert.equal(badManifest.result.outcome, "configuration-error");
    assert.equal(badManifest.result.exit, 2);

    const data = await indexData(root, manifestPath);
    const blockSha256 = r001BlockSha256(data);
    const rev = revision({
      fingerprint: data.fingerprint,
      targets: [
        {
          path: "specs/features/fixture/spec.md",
          anchor: "R-001",
          blockSha256,
        },
      ],
    });
    const validSheetFile = join(root, "..", "valid.md");
    await writeFile(
      validSheetFile,
      sheetText(batchId, data.fingerprint, [rev]),
    );

    // A schema-invalid existing revisions record blocks the command and names the file.
    const recordsDir = join(root, "specs", "batches", batchId, "records");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(recordsDir, { recursive: true });
    await writeFile(join(recordsDir, "revisions-000000000000.json"), "{}");
    const invalidRecordResult = await run(root, [
      manifestPath,
      validSheetFile,
      "--json",
    ]);
    assert.equal(invalidRecordResult.result.outcome, "failure");
    assert.deepEqual(codes(invalidRecordResult), ["REVIEW_RECORD_INVALID"]);
    assert.equal(
      invalidRecordResult.result.issues[0].path,
      `specs/batches/${batchId}/records/revisions-000000000000.json`,
    );
    const { rm } = await import("node:fs/promises");
    await rm(join(recordsDir, "revisions-000000000000.json"));

    // A symlinked records directory.
    const outside = join(root, "..", "outside-records-import");
    await mkdir(outside, { recursive: true });
    await rm(recordsDir, { recursive: true, force: true });
    const { symlink } = await import("node:fs/promises");
    await symlink(outside, recordsDir);
    const symlinkResult = await run(root, [
      manifestPath,
      validSheetFile,
      "--json",
    ]);
    assert.equal(symlinkResult.result.outcome, "configuration-error");
    assert.deepEqual(codes(symlinkResult), ["REVIEW_PATH_UNSAFE"]);
    await rm(recordsDir, { force: true });

    // A write failure (records/ made read-only after it already exists).
    await mkdir(recordsDir, { recursive: true });
    const { chmod } = await import("node:fs/promises");
    await chmod(recordsDir, 0o500);
    try {
      const writeFailureResult = await run(root, [
        manifestPath,
        validSheetFile,
        "--json",
      ]);
      assert.equal(writeFailureResult.result.outcome, "failure");
      assert.deepEqual(codes(writeFailureResult), [
        "REVIEW_RECORD_WRITE_FAILED",
      ]);
    } finally {
      await chmod(recordsDir, 0o700);
    }
    assert.equal(
      await recordsFor(root, batchId).then(
        (r) => r.filter((n) => n.startsWith("revisions-")).length,
      ),
      0,
    );
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST024-M5: parity with the page script for a trailing-slash target path and a 600-codepoint emoji anchor", async () => {
  const batchId = "TST-9265-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const data = await indexData(root, manifestPath);
    const blockSha256 = r001BlockSha256(data);

    const trailingSlash = revision({
      fingerprint: data.fingerprint,
      targets: [
        {
          path: "specs/features/fixture/spec.md/",
          anchor: "R-001",
          blockSha256,
        },
      ],
    });
    const emojiAnchor = "🎉".repeat(600);
    const emojiTarget = revision({
      fingerprint: data.fingerprint,
      targets: [
        {
          path: "specs/features/fixture/spec.md",
          anchor: emojiAnchor,
          blockSha256,
        },
      ],
    });

    for (const rev of [trailingSlash, emojiTarget]) {
      const text = sheetText(batchId, data.fingerprint, [rev]);
      const pageResult = pageApi.parseSheet(text, { batchId });
      const sheetFile = join(root, "..", `${rev.id}.md`);
      await writeFile(sheetFile, text);
      const execution = await run(root, [manifestPath, sheetFile, "--json"]);
      const cliOk = execution.result.outcome === "success";
      assert.equal(cliOk, pageResult.ok, JSON.stringify({ cliOk, pageResult }));
    }
  } finally {
    await cleanupWorkspace(root);
  }
});

test("Security M2 / review item 3+4: cross-record inconsistencies among existing revisions records fail import closed as REVIEW_RECORD_INVALID naming every involved file, not REVIEW_REVISION_CONFLICT", async () => {
  const batchId = "TST-9270-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const data = await indexData(root, manifestPath);
    const blockSha256 = r001BlockSha256(data);
    const targets = [
      { path: "specs/features/fixture/spec.md", anchor: "R-001", blockSha256 },
    ];
    const recordsDir = join(root, "specs", "batches", batchId, "records");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(recordsDir, { recursive: true });

    async function writeRawRecord(sheet) {
      const bytes = JSON.stringify(sheet);
      const { createHash } = await import("node:crypto");
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const path = join(recordsDir, `revisions-${sha256.slice(0, 12)}.json`);
      await writeFile(path, bytes);
      return {
        sha256,
        relativePath: `specs/batches/${batchId}/records/revisions-${sha256.slice(0, 12)}.json`,
      };
    }

    function rawRevision(id, overrides = {}) {
      return {
        id,
        fingerprint: data.fingerprint,
        targets,
        quote: "quote",
        kind: "supplement",
        blocking: true,
        proposal: "proposal",
        rationale: "rationale",
        createdAt: "2026-09-17T08:21:04Z",
        ...overrides,
      };
    }

    function rawSheet(revisions) {
      return {
        schemaVersion: "1.0.0",
        batchId,
        fingerprint: data.fingerprint,
        exportedAt: "2026-09-17T08:30:00Z",
        revisions,
      };
    }

    // Same id, different content, across two independently valid records.
    {
      const id = nextRevisionId();
      const recordA = await writeRawRecord(
        rawSheet([rawRevision(id, { proposal: "A" })]),
      );
      const recordB = await writeRawRecord(
        rawSheet([rawRevision(id, { proposal: "B" })]),
      );

      const rev = revision({ fingerprint: data.fingerprint, targets });
      const sheetFile = join(root, "..", "probe1.md");
      await writeFile(sheetFile, sheetText(batchId, data.fingerprint, [rev]));
      const result = await run(root, [manifestPath, sheetFile, "--json"]);
      assert.equal(result.result.outcome, "failure");
      assert.deepEqual(codes(result), [
        "REVIEW_RECORD_INVALID",
        "REVIEW_RECORD_INVALID",
      ]);
      const paths = result.result.issues.map((i) => i.path).sort();
      assert.deepEqual(
        paths,
        [recordA.relativePath, recordB.relativePath].sort(),
      );
      assert.equal(
        await recordsFor(root, batchId).then(
          (r) => r.filter((n) => n.startsWith("revisions-")).length,
        ),
        2,
      );
      await (
        await import("node:fs/promises")
      ).rm(join(root, recordA.relativePath));
      await (
        await import("node:fs/promises")
      ).rm(join(root, recordB.relativePath));
    }

    // Two records superseding the same target.
    {
      const targetId = nextRevisionId();
      const supersederA = nextRevisionId();
      const supersederB = nextRevisionId();
      const recordTarget = await writeRawRecord(
        rawSheet([rawRevision(targetId)]),
      );
      const recordA = await writeRawRecord(
        rawSheet([rawRevision(supersederA, { supersedes: targetId })]),
      );
      const recordB = await writeRawRecord(
        rawSheet([rawRevision(supersederB, { supersedes: targetId })]),
      );

      const rev = revision({ fingerprint: data.fingerprint, targets });
      const sheetFile = join(root, "..", "probe2.md");
      await writeFile(sheetFile, sheetText(batchId, data.fingerprint, [rev]));
      const result = await run(root, [manifestPath, sheetFile, "--json"]);
      assert.equal(result.result.outcome, "failure");
      assert.ok(
        result.result.issues.every((i) => i.code === "REVIEW_RECORD_INVALID"),
      );
      const paths = new Set(result.result.issues.map((i) => i.path));
      assert.ok(
        paths.has(recordA.relativePath) || paths.has(recordB.relativePath),
      );

      await (
        await import("node:fs/promises")
      ).rm(join(root, recordTarget.relativePath));
      await (
        await import("node:fs/promises")
      ).rm(join(root, recordA.relativePath));
      await (
        await import("node:fs/promises")
      ).rm(join(root, recordB.relativePath));
    }

    // A supersedes cycle spread across two records.
    {
      const idA = nextRevisionId();
      const idB = nextRevisionId();
      const recordA = await writeRawRecord(
        rawSheet([rawRevision(idA, { supersedes: idB })]),
      );
      const recordB = await writeRawRecord(
        rawSheet([rawRevision(idB, { supersedes: idA })]),
      );

      const rev = revision({ fingerprint: data.fingerprint, targets });
      const sheetFile = join(root, "..", "probe3.md");
      await writeFile(sheetFile, sheetText(batchId, data.fingerprint, [rev]));
      const result = await run(root, [manifestPath, sheetFile, "--json"]);
      assert.equal(result.result.outcome, "failure");
      assert.ok(
        result.result.issues.every((i) => i.code === "REVIEW_RECORD_INVALID"),
      );
      const paths = new Set(result.result.issues.map((i) => i.path));
      assert.ok(
        paths.has(recordA.relativePath) || paths.has(recordB.relativePath),
      );
    }
  } finally {
    await cleanupWorkspace(root);
  }
});

test("review item 5: a target path/anchor split that reproduces the real locator's space-joined text does not falsely match", async () => {
  const batchId = "TST-9271-fixture";
  const specWithHeadingPath =
    "## R-001：Fixture Entry\n\n- AC-001：line.\n\n## Background\n\n### Details\n\nSome text.\n";
  const { root, manifestPath } = await fixtureRepo(batchId, {
    "specs/decisions/ADR-001-fixture.md":
      "# ADR-001 Fixture\n\nStatus: accepted\n",
    "specs/features/fixture/spec.md": specWithHeadingPath,
    "specs/stories/RF-001-fixture/story.md": "# Story: RF-001 Fixture\n",
    "specs/stories/RF-001-fixture/acceptance.md":
      "# Acceptance Criteria\n\n* [ ] AC-001: done.\n",
  });
  try {
    const data = await indexData(root, manifestPath);
    const detailsEntry = data.specs[0].sections.find(
      (s) => s.headingPath === "Background > Details",
    );
    assert.ok(
      detailsEntry,
      "fixture must produce a real 'Background > Details' heading-path locator",
    );
    const realBlockSha256 = detailsEntry.locator.blockSha256;

    // The forged target: path/anchor split at a different point, so its
    // space-joined text ("specs/features/fixture/spec.md Background" + " " +
    // "Details") equals the real locator's own space-joined text
    // ("specs/features/fixture/spec.md" + " " + "Background > Details"),
    // even though neither field matches the real locator exactly.
    const forgedTarget = {
      path: "specs/features/fixture/spec.md Background",
      anchor: "Details",
      blockSha256: realBlockSha256,
    };
    const rev = revision({
      fingerprint: data.fingerprint,
      targets: [forgedTarget],
    });
    const sheetFile = join(root, "..", "sheet.md");
    await writeFile(sheetFile, sheetText(batchId, data.fingerprint, [rev]));
    const execution = await run(root, [manifestPath, sheetFile, "--json"]);
    assert.equal(execution.result.outcome, "success");
    assert.equal(
      execution.result.data.revisions[0].targets[0].match,
      "anchor-missing",
    );
  } finally {
    await cleanupWorkspace(root);
  }
});
