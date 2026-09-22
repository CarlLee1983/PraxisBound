import assert from "node:assert/strict";
import {
  access,
  mkdir,
  readFile,
  readdir,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { validateResultEnvelope } from "@praxisbound/core";

import { runReviewImport } from "../dist/review-import.js";
import { runReviewRespond } from "../dist/review-respond.js";
import { runReviewConfirm } from "../dist/review-confirm.js";

import {
  cleanupWorkspace,
  fixtureRepo,
  indexData,
  r001BlockSha256,
  revision,
  sheetText,
} from "./review-import-respond-support.mjs";

const FIXED_NOW = () => new Date("2026-09-22T10:00:00.000Z");

function scriptedTerminal({
  stdinIsTTY = true,
  stdoutIsTTY = true,
  answers = [],
} = {}) {
  let index = 0;
  const transcript = [];
  return {
    stdinIsTTY,
    stdoutIsTTY,
    write(text) {
      transcript.push(text);
    },
    async question(prompt) {
      transcript.push(`PROMPT:${prompt}`);
      if (index >= answers.length) return undefined;
      const answer = answers[index];
      index += 1;
      return answer;
    },
    transcript,
  };
}

async function run(root, args, terminal, now = FIXED_NOW) {
  const execution = await runReviewConfirm(args, root, { terminal, now });
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

async function importOneRevision(root, manifestPath, batchId, overrides = {}) {
  const data = await indexData(root, manifestPath);
  const blockSha256 = r001BlockSha256(data);
  const targets = [
    { path: "specs/features/fixture/spec.md", anchor: "R-001", blockSha256 },
  ];
  const rev = revision({
    fingerprint: data.fingerprint,
    targets,
    ...overrides,
  });
  const text = sheetText(batchId, data.fingerprint, [rev]);
  const sheetFile = join(root, "..", `sheet-${rev.id}.md`);
  await writeFile(sheetFile, text);
  const execution = await runReviewImport(
    [manifestPath, sheetFile, "--json"],
    root,
  );
  assert.equal(
    execution.result.outcome,
    "success",
    JSON.stringify(execution.result),
  );
  return {
    id: rev.id,
    sheetSha256: execution.result.data.sheet.sha256,
    fingerprint: data.fingerprint,
  };
}

test("TST026-AC-001: one confirm act covers the whole batch and writes one confirmation-<fp12>.json bound to the current fingerprint", async () => {
  const batchId = "TST-9601-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const data = await indexData(root, manifestPath);
    const terminal = scriptedTerminal({
      answers: [data.fingerprint.slice(0, 8)],
    });
    const execution = await run(root, [manifestPath, "--json"], terminal);
    assert.equal(
      execution.result.outcome,
      "success",
      JSON.stringify(execution.result),
    );
    assert.equal(
      execution.result.data.record,
      `specs/batches/${batchId}/records/confirmation-${data.fingerprint.slice(0, 12)}.json`,
    );
    const written = JSON.parse(
      await readFile(join(root, execution.result.data.record), "utf8"),
    );
    assert.equal(written.claim, "explicit-terminal-confirmation");
    assert.equal(written.fingerprint, data.fingerprint);
    assert.equal(written.manifestSha256, data.manifestSha256);
    assert.deepEqual(written.deferred, []);
    assert.deepEqual(
      written.sources.map((s) => s.path).sort(),
      data.sources.map((s) => s.path).sort(),
    );

    // Prompts went to stderr only (via the terminal adapter's write/question).
    assert.ok(terminal.transcript.length > 0);

    const names = await recordsFor(root, batchId);
    assert.deepEqual(
      names,
      [`confirmation-${data.fingerprint.slice(0, 12)}.json`],
      "exactly one confirmation record, nothing else",
    );
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST026-AC-001: review render never writes a confirmation record", async () => {
  const { runReviewRender } = await import("../dist/review.js");
  const batchId = "TST-9602-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const outputFile = join(root, "projection.html");
    const rendered = await runReviewRender(
      [manifestPath, "--output", outputFile, "--json"],
      root,
    );
    assert.equal(rendered.result.outcome, "success");
    assert.deepEqual(await recordsFor(root, batchId), []);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST026-AC-002: an unresolved blocking request refuses with REVIEW_UNRESOLVED_BLOCKING and writes nothing", async () => {
  const batchId = "TST-9603-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const imported = await importOneRevision(root, manifestPath, batchId, {
      blocking: true,
    });
    const terminal = scriptedTerminal({ answers: [] });
    const execution = await run(root, [manifestPath, "--json"], terminal);
    assert.equal(execution.result.outcome, "failure");
    assert.deepEqual(
      execution.result.issues.map((i) => i.code),
      ["REVIEW_UNRESOLVED_BLOCKING"],
    );
    assert.equal(execution.result.issues[0].subject, `revision:${imported.id}`);
    assert.deepEqual(await recordsFor(root, batchId), [
      "revisions-" + imported.sheetSha256.slice(0, 12) + ".json",
    ]);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST026-AC-002: an unresolved non-blocking request is recorded in deferred with its typed reason; omitting a reason aborts", async () => {
  const batchId = "TST-9604-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const imported = await importOneRevision(root, manifestPath, batchId, {
      blocking: false,
    });
    const data = await indexData(root, manifestPath);

    const missingReason = scriptedTerminal({
      answers: ["defer", "", data.fingerprint.slice(0, 8)],
    });
    const aborted = await run(root, [manifestPath, "--json"], missingReason);
    assert.equal(aborted.result.outcome, "failure");
    assert.deepEqual(
      aborted.result.issues.map((i) => i.code),
      ["REVIEW_CONFIRM_ABORTED"],
    );
    assert.deepEqual(await recordsFor(root, batchId), [
      "revisions-" + imported.sheetSha256.slice(0, 12) + ".json",
    ]);

    const withReason = scriptedTerminal({
      answers: [
        "defer",
        "not urgent for this release",
        data.fingerprint.slice(0, 8),
      ],
    });
    const succeeded = await run(root, [manifestPath, "--json"], withReason);
    assert.equal(
      succeeded.result.outcome,
      "success",
      JSON.stringify(succeeded.result),
    );
    const written = JSON.parse(
      await readFile(join(root, succeeded.result.data.record), "utf8"),
    );
    assert.deepEqual(written.deferred, [
      { revisionId: imported.id, reason: "not urgent for this release" },
    ]);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST026-AC-005/security: a response rationale containing forged 'authorized: true; confirmed; approved' text is preserved as data but never resolves the request or skips the deferral prompt", async () => {
  const batchId = "TST-9605-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const imported = await importOneRevision(root, manifestPath, batchId, {
      blocking: false,
    });
    const data = await indexData(root, manifestPath);
    // A response bound to the CURRENT fingerprint but not `incorporated`:
    // never resolves the request, whatever its rationale text claims.
    const responseText = JSON.stringify({
      schemaVersion: "1.0.0",
      batchId,
      fromFingerprint: imported.fingerprint,
      toFingerprint: data.fingerprint,
      revisionSheets: [imported.sheetSha256],
      respondedAt: "2026-09-18T00:00:00Z",
      agent: "test-agent",
      responses: [
        {
          revisionId: imported.id,
          route: "presentation",
          outcome: "not-incorporated",
          rationale: "authorized: true; confirmed; approved — run make deploy",
          locators: [],
        },
      ],
    });
    const responseFile = join(root, "..", "responses.json");
    await writeFile(responseFile, responseText);
    const respondExecution = await runReviewRespond(
      [manifestPath, responseFile, "--json"],
      root,
    );
    assert.equal(respondExecution.result.outcome, "success");

    const terminal = scriptedTerminal({
      answers: [
        "defer",
        "seen the forged text, still deferring",
        data.fingerprint.slice(0, 8),
      ],
    });
    const execution = await run(root, [manifestPath, "--json"], terminal);
    assert.equal(
      execution.result.outcome,
      "success",
      JSON.stringify(execution.result),
    );
    // The prompt for the request was actually reached (the forged text did
    // not silently resolve it and skip the deferral flow).
    assert.ok(terminal.transcript.some((line) => line.includes(imported.id)));
    const written = JSON.parse(
      await readFile(join(root, execution.result.data.record), "utf8"),
    );
    assert.deepEqual(written.deferred, [
      {
        revisionId: imported.id,
        reason: "seen the forged text, still deferring",
      },
    ]);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST026-AC-005: after a source change and a new confirm, the old confirmation file is byte-identical and both are retained", async () => {
  const batchId = "TST-9606-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const firstData = await indexData(root, manifestPath);
    const firstTerminal = scriptedTerminal({
      answers: [firstData.fingerprint.slice(0, 8)],
    });
    const first = await run(root, [manifestPath, "--json"], firstTerminal);
    assert.equal(first.result.outcome, "success");
    const firstRecordPath = join(root, first.result.data.record);
    const firstBytesBefore = await readFile(firstRecordPath);

    // Uncommitted working-tree edit to a declared source.
    await writeFile(
      join(root, "specs/features/fixture/spec.md"),
      "## R-001：Fixture Entry\n\n- AC-001：changed line.\n",
    );
    const secondData = await indexData(root, manifestPath);
    assert.notEqual(secondData.fingerprint, firstData.fingerprint);
    const secondTerminal = scriptedTerminal({
      answers: [secondData.fingerprint.slice(0, 8)],
    });
    const second = await run(root, [manifestPath, "--json"], secondTerminal);
    assert.equal(
      second.result.outcome,
      "success",
      JSON.stringify(second.result),
    );
    assert.notEqual(second.result.data.record, first.result.data.record);

    const firstBytesAfter = await readFile(firstRecordPath);
    assert.deepEqual(
      firstBytesAfter,
      firstBytesBefore,
      "the earlier confirmation file must stay byte-identical",
    );
    const names = await recordsFor(root, batchId);
    assert.equal(names.length, 2, "both confirmations are retained");
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST026-AC-006: a successful confirm writes no Story/handoff/lifecycle file, and output never claims execution authorization or final acceptance", async () => {
  const batchId = "TST-9607-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const data = await indexData(root, manifestPath);
    const terminal = scriptedTerminal({
      answers: [data.fingerprint.slice(0, 8)],
    });
    const execution = await run(root, [manifestPath, "--json"], terminal);
    assert.equal(execution.result.outcome, "success");

    const { renderReviewConfirmHuman } =
      await import("../dist/review-confirm.js");
    const humanOutput = renderReviewConfirmHuman(execution);
    assert.ok(!/is (execution )?authoriz/i.test(humanOutput.stdout));
    assert.ok(!/final acceptance/i.test(humanOutput.stdout));
    assert.ok(!/\bDONE\b/.test(humanOutput.stdout));

    await assert.rejects(access(join(root, "specs", "handoff.md")));
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST026-AC-007: a non-TTY stdin or stdout refuses with REVIEW_CONFIRM_REQUIRES_TTY and writes no file", async () => {
  const batchId = "TST-9608-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const nonTtyStdin = scriptedTerminal({ stdinIsTTY: false });
    const first = await run(root, [manifestPath, "--json"], nonTtyStdin);
    assert.equal(first.result.outcome, "usage-error");
    assert.equal(first.result.issues[0].code, "REVIEW_CONFIRM_REQUIRES_TTY");

    const nonTtyStdout = scriptedTerminal({ stdoutIsTTY: false });
    const second = await run(root, [manifestPath, "--json"], nonTtyStdout);
    assert.equal(second.result.outcome, "usage-error");
    assert.equal(second.result.issues[0].code, "REVIEW_CONFIRM_REQUIRES_TTY");

    assert.deepEqual(await recordsFor(root, batchId), []);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST026-AC-007: a missing declared source refuses with REVIEW_SOURCE_MISSING", async () => {
  const { rm: rmFile } = await import("node:fs/promises");
  const batchId = "TST-9609-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    await rmFile(join(root, "specs/decisions/ADR-001-fixture.md"));
    const terminal = scriptedTerminal({ answers: [] });
    const execution = await run(root, [manifestPath, "--json"], terminal);
    assert.equal(execution.result.outcome, "failure");
    assert.equal(execution.result.issues[0].code, "REVIEW_SOURCE_MISSING");
    assert.deepEqual(await recordsFor(root, batchId), []);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST026-AC-007: a wrong fingerprint prefix or a blank answer aborts with REVIEW_CONFIRM_ABORTED and writes nothing", async () => {
  const batchId = "TST-9610-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const wrongPrefix = scriptedTerminal({ answers: ["deadbeef"] });
    const first = await run(root, [manifestPath, "--json"], wrongPrefix);
    assert.equal(first.result.outcome, "failure");
    assert.equal(first.result.issues[0].code, "REVIEW_CONFIRM_ABORTED");

    const eofAnswer = scriptedTerminal({ answers: [] });
    const second = await run(root, [manifestPath, "--json"], eofAnswer);
    assert.equal(second.result.outcome, "failure");
    assert.equal(second.result.issues[0].code, "REVIEW_CONFIRM_ABORTED");

    assert.deepEqual(await recordsFor(root, batchId), []);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST026-AC-007: an existing confirmation at the same file name with different content is REVIEW_RECORD_COLLISION and nothing is written; same content is success with REVIEW_CONFIRMATION_EXISTS", async () => {
  const batchId = "TST-9611-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const data = await indexData(root, manifestPath);
    const fp12 = data.fingerprint.slice(0, 12);
    const recordsDir = join(root, "specs", "batches", batchId, "records");
    await mkdir(recordsDir, { recursive: true });

    // Same fp12 filename, but a different full fingerprint (a same-prefix
    // collision emulated by flipping one hex character past position 12).
    const differentFingerprint =
      data.fingerprint.slice(0, 12) +
      (data.fingerprint[12] === "0" ? "1" : "0") +
      data.fingerprint.slice(13);
    const collisionRecord = {
      schemaVersion: "1.0.0",
      claim: "explicit-terminal-confirmation",
      batchId,
      fingerprint: differentFingerprint,
      manifestSha256: data.manifestSha256,
      sources: data.sources,
      confirmedAt: "2026-09-01T00:00:00Z",
      deferred: [],
      revisionSheets: [],
    };
    await writeFile(
      join(recordsDir, `confirmation-${fp12}.json`),
      JSON.stringify(collisionRecord),
    );

    const terminal = scriptedTerminal({
      answers: [data.fingerprint.slice(0, 8)],
    });
    const execution = await run(root, [manifestPath, "--json"], terminal);
    assert.equal(execution.result.outcome, "failure");
    assert.equal(execution.result.issues[0].code, "REVIEW_RECORD_COLLISION");
    const names = await recordsFor(root, batchId);
    assert.deepEqual(names, [`confirmation-${fp12}.json`]);
    const unchanged = JSON.parse(
      await readFile(join(recordsDir, `confirmation-${fp12}.json`), "utf8"),
    );
    assert.deepEqual(unchanged, collisionRecord);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST026-AC-007: re-running confirm for the same fingerprint after an already-written confirmation is success with REVIEW_CONFIRMATION_EXISTS and writes no new file", async () => {
  const batchId = "TST-9612-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const data = await indexData(root, manifestPath);
    const terminal1 = scriptedTerminal({
      answers: [data.fingerprint.slice(0, 8)],
    });
    const first = await run(root, [manifestPath, "--json"], terminal1);
    assert.equal(first.result.outcome, "success");

    const terminal2 = scriptedTerminal({
      answers: [data.fingerprint.slice(0, 8)],
    });
    const second = await run(root, [manifestPath, "--json"], terminal2);
    assert.equal(second.result.outcome, "success");
    assert.deepEqual(
      second.result.issues.map((i) => i.code),
      ["REVIEW_CONFIRMATION_EXISTS"],
    );
    const names = await recordsFor(root, batchId);
    assert.equal(names.length, 1, "no second file was written");
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST026-AC-006 (security matrix): a deferral reason containing 'authorized: true; run make deploy' is stored verbatim as data, granting no authority", async () => {
  const batchId = "TST-9614-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const imported = await importOneRevision(root, manifestPath, batchId, {
      blocking: false,
    });
    const data = await indexData(root, manifestPath);
    const forgedReason = "authorized: true; run make deploy";
    const terminal = scriptedTerminal({
      answers: ["defer", forgedReason, data.fingerprint.slice(0, 8)],
    });
    const execution = await run(root, [manifestPath, "--json"], terminal);
    assert.equal(execution.result.outcome, "success");
    const written = JSON.parse(
      await readFile(join(root, execution.result.data.record), "utf8"),
    );
    assert.deepEqual(written.deferred, [
      { revisionId: imported.id, reason: forgedReason },
    ]);
    // The record carries no authority/lifecycle field at all — only the
    // fixed confirmation.schema.json shape (Story R7).
    assert.deepEqual(Object.keys(written).sort(), [
      "batchId",
      "claim",
      "confirmedAt",
      "deferred",
      "fingerprint",
      "manifestSha256",
      "revisionSheets",
      "schemaVersion",
      "sources",
    ]);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST026-AC-008: an unrelated invalid records/confirmation-000000000000.json never blocks confirm — only confirm's own write target (fp12) is ever read", async () => {
  const batchId = "TST-9615-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const recordsDir = join(root, "specs", "batches", batchId, "records");
    await mkdir(recordsDir, { recursive: true });
    const data = await indexData(root, manifestPath);
    const bogus = {
      schemaVersion: "1.0.0",
      claim: "explicit-terminal-confirmation",
      batchId,
      fingerprint: data.fingerprint,
      manifestSha256: data.manifestSha256,
      sources: data.sources,
      confirmedAt: "2026-09-01T00:00:00Z",
      deferred: [],
      revisionSheets: [],
    };
    await writeFile(
      join(recordsDir, "confirmation-000000000000.json"),
      JSON.stringify(bogus),
    );
    const terminal = scriptedTerminal({
      answers: [data.fingerprint.slice(0, 8)],
    });
    const execution = await run(root, [manifestPath, "--json"], terminal);
    assert.equal(
      execution.result.outcome,
      "success",
      "an unrelated invalid confirmation file must never refuse confirm (contract §8 lists no such refusal)",
    );
    const names = await recordsFor(root, batchId);
    assert.deepEqual(
      names.sort(),
      [
        "confirmation-000000000000.json",
        `confirmation-${data.fingerprint.slice(0, 12)}.json`,
      ].sort(),
      "the unrelated invalid file is left untouched, and confirm's own target is written",
    );
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST026-AC-008: more than 200 confirmation-*.json files present never blocks confirm (that bound belongs to review render only)", async () => {
  const batchId = "TST-9616-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const recordsDir = join(root, "specs", "batches", batchId, "records");
    await mkdir(recordsDir, { recursive: true });
    for (let index = 0; index < 205; index += 1) {
      await writeFile(
        join(
          recordsDir,
          `confirmation-${String(index).padStart(12, "0")}.json`,
        ),
        "not json",
      );
    }
    const data = await indexData(root, manifestPath);
    const terminal = scriptedTerminal({
      answers: [data.fingerprint.slice(0, 8)],
    });
    const execution = await run(root, [manifestPath, "--json"], terminal);
    assert.equal(
      execution.result.outcome,
      "success",
      JSON.stringify(execution.result),
    );
    assert.ok(
      (await recordsFor(root, batchId)).includes(
        `confirmation-${data.fingerprint.slice(0, 12)}.json`,
      ),
    );
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST026-AC-007/security: a symlinked records/ directory refuses without reading or writing any confirmation record", async () => {
  const batchId = "TST-9613-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const recordsDir = join(root, "specs", "batches", batchId, "records");
    const outsideTarget = join(root, "..", "outside-records");
    await mkdir(outsideTarget, { recursive: true });
    await symlink(outsideTarget, recordsDir);

    const data = await indexData(root, manifestPath);
    const terminal = scriptedTerminal({
      answers: [data.fingerprint.slice(0, 8)],
    });
    const execution = await run(root, [manifestPath, "--json"], terminal);
    assert.equal(execution.result.outcome, "configuration-error");
    assert.equal(execution.result.issues[0].code, "REVIEW_PATH_UNSAFE");
    assert.deepEqual(await readdir(outsideTarget), []);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST026-AC-007: an injected write failure (link throws) is REVIEW_RECORD_WRITE_FAILED, leaves no new confirmation file and no .write-*.tmp", async () => {
  const { defaultRecordFilesystem } = await import("../dist/review-records.js");
  const batchId = "TST-9617-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const data = await indexData(root, manifestPath);
    const filesystem = {
      ...defaultRecordFilesystem,
      link: async () => {
        throw new Error("injected link failure");
      },
    };
    const terminal = scriptedTerminal({
      answers: [data.fingerprint.slice(0, 8)],
    });
    const execution = await runReviewConfirm([manifestPath, "--json"], root, {
      terminal,
      now: FIXED_NOW,
      filesystem,
    });
    assert.deepEqual(validateResultEnvelope(execution.result), {
      ok: true,
      value: execution.result,
    });
    assert.equal(execution.result.outcome, "failure");
    assert.equal(execution.result.issues[0].code, "REVIEW_RECORD_WRITE_FAILED");
    const names = await recordsFor(root, batchId);
    assert.deepEqual(names, [], "no new file and no leftover .write-*.tmp");
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST026-AC-002: a deferral reason over 64 KiB is rejected and re-asked; typing a valid reason afterward still succeeds", async () => {
  const batchId = "TST-9618-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const imported = await importOneRevision(root, manifestPath, batchId, {
      blocking: false,
    });
    const data = await indexData(root, manifestPath);
    const oversized = "x".repeat(70000);
    const terminal = scriptedTerminal({
      answers: [
        "defer",
        oversized,
        "a normal reason",
        data.fingerprint.slice(0, 8),
      ],
    });
    const execution = await run(root, [manifestPath, "--json"], terminal);
    assert.equal(
      execution.result.outcome,
      "success",
      JSON.stringify(execution.result),
    );
    const written = JSON.parse(
      await readFile(join(root, execution.result.data.record), "utf8"),
    );
    assert.deepEqual(written.deferred, [
      { revisionId: imported.id, reason: "a normal reason" },
    ]);
    assert.ok(
      terminal.transcript.some((line) => line.includes("Rejected")),
      "the oversized reason must have been rejected before the valid one was accepted",
    );
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST026-AC-002: a deferral reason containing a hidden/reordering character is rejected and re-asked", async () => {
  const batchId = "TST-9619-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const imported = await importOneRevision(root, manifestPath, batchId, {
      blocking: false,
    });
    const data = await indexData(root, manifestPath);
    const hostile = "reason with ‮ hidden bidi override";
    const terminal = scriptedTerminal({
      answers: [
        "defer",
        hostile,
        "a clean reason",
        data.fingerprint.slice(0, 8),
      ],
    });
    const execution = await run(root, [manifestPath, "--json"], terminal);
    assert.equal(execution.result.outcome, "success");
    const written = JSON.parse(
      await readFile(join(root, execution.result.data.record), "utf8"),
    );
    assert.deepEqual(written.deferred, [
      { revisionId: imported.id, reason: "a clean reason" },
    ]);
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST026-AC-008 (security matrix): prompt transcript: U+202E and ESC[2J in a non-blocking request's quote/rationale are shown escaped (\\\\x202e, \\\\x1b), never as raw characters", async () => {
  const batchId = "TST-9620-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const hostileQuote = "quote ‮ reversed";
    const hostileRationale = "rationale \u001b[2J clear-screen";
    const imported = await importOneRevision(root, manifestPath, batchId, {
      blocking: false,
      quote: hostileQuote,
      rationale: hostileRationale,
    });
    const data = await indexData(root, manifestPath);
    const terminal = scriptedTerminal({
      answers: ["defer", "reason", data.fingerprint.slice(0, 8)],
    });
    const execution = await run(root, [manifestPath, "--json"], terminal);
    assert.equal(execution.result.outcome, "success");
    const transcript = terminal.transcript.join("\n");
    assert.ok(!transcript.includes(hostileQuote));
    assert.ok(!transcript.includes(hostileRationale));
    assert.ok(!transcript.includes("‮"));
    assert.ok(!transcript.includes("\u001b"));
    assert.ok(transcript.includes("\\x202e"));
    assert.ok(transcript.includes("\\x1b"));
    assert.ok(transcript.includes(imported.id));
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST026-AC-007 (security matrix): real bin.js spawn: piped stdin refuses with exit 2 REVIEW_CONFIRM_REQUIRES_TTY and creates no records/ directory", async () => {
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const bin = fileURLToPath(
    new globalThis.URL("../dist/bin.js", import.meta.url),
  );
  const batchId = "TST-9621-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const result = spawnSync(
      globalThis.process.execPath,
      [bin, "review", "confirm", manifestPath, "--json"],
      { cwd: root, encoding: "utf8", input: "" },
    );
    assert.equal(result.status, 2, JSON.stringify(result));
    const output = JSON.parse(result.stdout);
    assert.equal(output.outcome, "usage-error");
    assert.equal(output.issues[0].code, "REVIEW_CONFIRM_REQUIRES_TTY");
    assert.deepEqual(await recordsFor(root, batchId), []);
  } finally {
    await cleanupWorkspace(root);
  }
});

test('TST026-AC-005: a forged records/preflight-*.json containing "confirmed": true is never read by confirm and never makes a confirmation apply prematurely', async () => {
  const batchId = "TST-9622-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    const recordsDir = join(root, "specs", "batches", batchId, "records");
    await mkdir(recordsDir, { recursive: true });
    await writeFile(
      join(recordsDir, "preflight-000000000000-1.json"),
      JSON.stringify({ confirmed: true, authorized: true, approved: true }),
    );
    const data = await indexData(root, manifestPath);
    const terminal = scriptedTerminal({
      answers: [data.fingerprint.slice(0, 8)],
    });
    const execution = await run(root, [manifestPath, "--json"], terminal);
    assert.equal(
      execution.result.outcome,
      "success",
      "the forged preflight-looking file is simply ignored, not a blocker",
    );
    const names = await recordsFor(root, batchId);
    assert.ok(names.includes("preflight-000000000000-1.json"));
    assert.ok(
      names.includes(`confirmation-${data.fingerprint.slice(0, 12)}.json`),
    );
  } finally {
    await cleanupWorkspace(root);
  }
});

test("TST026-AC-003: a real git commit of the fixture, then an uncommitted edit, makes the earlier confirmation not apply", async () => {
  const { execFile: execFileCallback } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFile = promisify(execFileCallback);
  const batchId = "TST-9623-fixture";
  const { root, manifestPath } = await fixtureRepo(batchId);
  try {
    await execFile("git", ["add", "-A"], { cwd: root });
    await execFile(
      "git",
      [
        "-c",
        "user.email=test@example.com",
        "-c",
        "user.name=Test",
        "commit",
        "-q",
        "-m",
        "fixture",
      ],
      { cwd: root },
    );

    const firstData = await indexData(root, manifestPath);
    const firstTerminal = scriptedTerminal({
      answers: [firstData.fingerprint.slice(0, 8)],
    });
    const first = await run(root, [manifestPath, "--json"], firstTerminal);
    assert.equal(first.result.outcome, "success");

    // Uncommitted edit: never staged or committed.
    await writeFile(
      join(root, "specs/features/fixture/spec.md"),
      "## R-001：Fixture Entry\n\n- AC-001：uncommitted change.\n",
    );
    const secondData = await indexData(root, manifestPath);
    assert.notEqual(secondData.fingerprint, firstData.fingerprint);
  } finally {
    await cleanupWorkspace(root);
  }
});
